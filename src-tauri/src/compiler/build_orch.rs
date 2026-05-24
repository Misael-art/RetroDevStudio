use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::compiler::ast_generator::{
    collect_bgm_tracks, collect_sfx_resources, collect_tilemap_assets, generate_ast,
    generate_ast_with_prefabs, AstOutput, SpriteAsset,
};
use crate::compiler::sgdk_emitter::emit_sgdk_with_collision;
use crate::compiler::snes_emitter::emit_snes_with_collision;
use crate::core::diagnostics::{build_diagnostics_from_log, ActionableDiagnostic};
use crate::core::project_mgr::{
    load_project, load_scene, resolve_prefabs, target_spec, TargetSpec,
};
use crate::hardware::md_profile;
use crate::hardware::snes_profile;
use crate::ugdm::entities::{Entity, Project, Scene};

#[derive(Debug, serde::Serialize, Clone)]
pub struct BuildLogLine {
    pub level: String,
    pub message: String,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct BuildResult {
    pub ok: bool,
    pub rom_path: String,
    pub log: Vec<BuildLogLine>,
    pub diagnostics: Vec<ActionableDiagnostic>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct MultiTargetBuildEntry {
    pub target: String,
    pub ok: bool,
    pub rom_path: String,
    pub rom_size_bytes: u64,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub log: Vec<BuildLogLine>,
    pub diagnostics: Vec<ActionableDiagnostic>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct MultiTargetBuildResult {
    pub ok: bool,
    pub results: Vec<MultiTargetBuildEntry>,
}

#[derive(Debug, Clone, Default)]
pub struct BuildEnvironment {
    pub sgdk_root: Option<PathBuf>,
    pub sgdk_make_program: Option<PathBuf>,
    pub pvsneslib_root: Option<PathBuf>,
    pub pvsneslib_make_program: Option<PathBuf>,
    pub pvsneslib_bash_program: Option<PathBuf>,
    pub disable_auto_detect: bool,
}

impl BuildEnvironment {
    pub fn detect() -> Self {
        let sgdk_root = detect_root("SGDK_ROOT", "sgdk");
        let pvsneslib_root = detect_root("PVSNESLIB_HOME", "pvsneslib");
        Self {
            sgdk_make_program: sgdk_root.as_deref().and_then(detect_make_program),
            pvsneslib_make_program: pvsneslib_root.as_deref().and_then(detect_make_program),
            pvsneslib_bash_program: detect_bash_program(),
            sgdk_root,
            pvsneslib_root,
            disable_auto_detect: false,
        }
    }
}

#[derive(Debug, Clone)]
struct EmitArtifacts {
    main_c: String,
    resources_res: String,
}

#[derive(Debug, Clone)]
struct BuildWorkspace {
    root: PathBuf,
    out_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct Toolchain {
    root: PathBuf,
    make_program: PathBuf,
    bash_program: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct SgdkCompatibilityProfile {
    scene: Scene,
    active_sprite_count: usize,
    culled_sprite_count: usize,
}

fn failed_build_result(
    target: &str,
    log: Vec<BuildLogLine>,
    evidence_path: Option<&Path>,
) -> BuildResult {
    let diagnostics = build_diagnostics_from_log(target, &log, evidence_path);
    BuildResult {
        ok: false,
        rom_path: String::new(),
        log,
        diagnostics,
    }
}

fn successful_build_result(rom_path: PathBuf, log: Vec<BuildLogLine>) -> BuildResult {
    BuildResult {
        ok: true,
        rom_path: rom_path.to_string_lossy().to_string(),
        log,
        diagnostics: Vec::new(),
    }
}

fn build_evidence_path(
    project_dir: &Path,
    project: &Project,
    target: TargetSpec,
) -> Option<PathBuf> {
    let output_root = project
        .build
        .as_ref()
        .map(|build| build.output_dir.as_str())
        .unwrap_or("build/");
    sanitize_build_output_dir(output_root)
        .ok()
        .map(|root| project_dir.join(root).join(target.target))
}

fn is_sgdk_compatibility_source(source_kind: Option<&str>) -> bool {
    matches!(source_kind, Some("external_sgdk") | Some("imported_sgdk"))
}

fn build_sgdk_compatibility_profile(
    scene: &Scene,
    source_kind: Option<&str>,
) -> Option<SgdkCompatibilityProfile> {
    if !is_sgdk_compatibility_source(source_kind) {
        return None;
    }

    let sprite_count = scene
        .entities
        .iter()
        .filter(|entity| entity.components.sprite.is_some())
        .count();

    let sprite_profiles = if sprite_count == 0 {
        vec![SgdkCompatibilityProfile {
            scene: scene.clone(),
            active_sprite_count: 0,
            culled_sprite_count: 0,
        }]
    } else {
        let conservative_window = md_profile::MD_SPRITES_PER_SCANLINE as usize;
        let initial_limit = sprite_count.min(conservative_window.max(1));
        let mut limits = vec![initial_limit, 16, 8, 4, 1];
        limits.retain(|limit| *limit > 0 && *limit <= sprite_count);
        limits.sort_unstable_by(|a, b| b.cmp(a));
        limits.dedup();
        limits
            .into_iter()
            .map(|limit| cull_sgdk_scene_to_active_sprite_window(scene, limit))
            .collect::<Vec<_>>()
    };

    let tile_budgets = [1024usize, 768, 512, 256, 128, 64, 32, 16];

    let mut fallback = None;
    for sprite_profile in sprite_profiles {
        for max_unique_tiles in tile_budgets {
            let candidate = SgdkCompatibilityProfile {
                scene: limit_sgdk_tilemap_residency(
                    &limit_sgdk_sprite_frame_dimensions(&sprite_profile.scene),
                    max_unique_tiles,
                ),
                active_sprite_count: sprite_profile.active_sprite_count,
                culled_sprite_count: sprite_profile.culled_sprite_count,
            };
            let fatal_count =
                md_profile::validate_scene_with_source_kind(&candidate.scene, source_kind)
                    .into_iter()
                    .filter(|error| error.is_fatal)
                    .count();
            if fatal_count == 0 {
                return Some(candidate);
            }
            fallback = Some(candidate);
        }
    }

    fallback
}

fn limit_sgdk_sprite_frame_dimensions(scene: &Scene) -> Scene {
    let mut transformed = scene.clone();
    for entity in &mut transformed.entities {
        let Some(sprite) = entity.components.sprite.as_mut() else {
            continue;
        };
        sprite.frame_width = clamp_sgdk_sprite_frame_dimension(sprite.frame_width);
        sprite.frame_height = clamp_sgdk_sprite_frame_dimension(sprite.frame_height);
    }
    transformed
}

fn clamp_sgdk_sprite_frame_dimension(value: u32) -> u32 {
    value.clamp(8, 128) / 8 * 8
}

fn limit_sgdk_tilemap_residency(scene: &Scene, max_unique_tiles: usize) -> Scene {
    let mut transformed = scene.clone();
    for entity in &mut transformed.entities {
        let Some(tilemap) = entity.components.tilemap.as_mut() else {
            continue;
        };
        if tilemap.cells.is_empty() {
            continue;
        }
        let mut unique = tilemap
            .cells
            .iter()
            .copied()
            .filter(|cell| *cell > 0)
            .collect::<Vec<_>>();
        unique.sort_unstable();
        unique.dedup();
        if unique.len() <= max_unique_tiles {
            continue;
        }
        let keep = unique
            .into_iter()
            .take(max_unique_tiles)
            .collect::<std::collections::HashSet<_>>();
        for cell in &mut tilemap.cells {
            if *cell > 0 && !keep.contains(cell) {
                *cell = 0;
            }
        }
    }
    transformed
}

fn cull_sgdk_scene_to_active_sprite_window(
    scene: &Scene,
    active_limit: usize,
) -> SgdkCompatibilityProfile {
    let mut ranked = scene
        .entities
        .iter()
        .enumerate()
        .filter(|(_, entity)| entity.components.sprite.is_some())
        .map(|(index, entity)| (index, sgdk_compatibility_sprite_score(index, entity)))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));

    let mut kept_indices = ranked
        .iter()
        .take(active_limit)
        .map(|(index, _)| *index)
        .collect::<Vec<_>>();
    kept_indices.sort_unstable();

    let mut transformed = scene.clone();
    transformed.entities = scene
        .entities
        .iter()
        .enumerate()
        .filter(|(index, entity)| {
            entity.components.sprite.is_none() || kept_indices.binary_search(index).is_ok()
        })
        .map(|(_, entity)| entity.clone())
        .collect();

    SgdkCompatibilityProfile {
        scene: transformed,
        active_sprite_count: kept_indices.len(),
        culled_sprite_count: ranked.len().saturating_sub(kept_indices.len()),
    }
}

fn sgdk_compatibility_sprite_score(index: usize, entity: &Entity) -> i32 {
    let mut score = 10_000i32.saturating_sub(index as i32);
    let id = entity.entity_id.to_ascii_lowercase();
    let name = entity
        .display_name
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();

    if entity.components.input.is_some() {
        score += 5_000;
    }
    if id.contains("player") || id.contains("hero") || name.contains("player") {
        score += 4_000;
    }
    if entity.components.logic.is_some() {
        score += 2_000;
    }
    if entity.components.collision.is_some() {
        score += 1_000;
    }
    if let Some(sprite) = entity.components.sprite.as_ref() {
        let priority = sprite.priority.to_ascii_lowercase();
        if priority.contains("hud") || priority.contains("ui") || priority.contains("overlay") {
            score += 1_500;
        }
        if priority == "foreground" {
            score += 750;
        }
    }
    if entity.transform.x >= -32
        && entity.transform.x <= md_profile::MD_RESOLUTION_W as i32
        && entity.transform.y >= -32
        && entity.transform.y <= md_profile::MD_RESOLUTION_H as i32
    {
        score += 500;
    }

    score
}

pub fn run_build<F>(project_dir: &Path, on_log: F) -> BuildResult
where
    F: Fn(BuildLogLine),
{
    let environment = BuildEnvironment::detect();
    run_build_with_environment(project_dir, &environment, on_log)
}

pub fn run_build_with_environment<F>(
    project_dir: &Path,
    environment: &BuildEnvironment,
    on_log: F,
) -> BuildResult
where
    F: Fn(BuildLogLine),
{
    let mut log = Vec::new();

    macro_rules! emit {
        ($level:expr, $message:expr) => {{
            let entry = BuildLogLine {
                level: $level.to_string(),
                message: $message.to_string(),
            };
            on_log(entry.clone());
            log.push(entry);
        }};
    }

    emit!(
        "info",
        format!("Carregando projeto em: {}", project_dir.display())
    );

    let project = match load_project(project_dir) {
        Ok(project) => project,
        Err(error) => {
            emit!("error", format!("Falha ao carregar project.rds: {}", error));
            return failed_build_result("project", log, Some(project_dir));
        }
    };

    let mut result =
        run_build_for_project_with_environment(project_dir, &project, environment, on_log);
    let mut combined_log = log;
    combined_log.append(&mut result.log);
    result.log = combined_log;
    result
}

pub fn run_build_multi_target<F>(
    project_dir: &Path,
    targets: &[String],
    on_log: F,
) -> MultiTargetBuildResult
where
    F: Fn(BuildLogLine),
{
    let environment = BuildEnvironment::detect();
    run_build_multi_target_with_environment(project_dir, targets, &environment, on_log)
}

pub fn run_build_multi_target_with_environment<F>(
    project_dir: &Path,
    targets: &[String],
    environment: &BuildEnvironment,
    on_log: F,
) -> MultiTargetBuildResult
where
    F: Fn(BuildLogLine),
{
    let mut log = Vec::new();

    macro_rules! emit {
        ($level:expr, $message:expr) => {{
            let entry = BuildLogLine {
                level: $level.to_string(),
                message: $message.to_string(),
            };
            on_log(entry.clone());
            log.push(entry);
        }};
    }

    emit!(
        "info",
        format!("Carregando projeto em: {}", project_dir.display())
    );

    let project = match load_project(project_dir) {
        Ok(project) => project,
        Err(error) => {
            emit!("error", format!("Falha ao carregar project.rds: {}", error));
            let diagnostics = build_diagnostics_from_log("project", &log, Some(project_dir));
            return MultiTargetBuildResult {
                ok: false,
                results: vec![MultiTargetBuildEntry {
                    target: "load_project".to_string(),
                    ok: false,
                    rom_path: String::new(),
                    rom_size_bytes: 0,
                    warnings: Vec::new(),
                    errors: vec![format!("Falha ao carregar project.rds: {}", error)],
                    log,
                    diagnostics,
                }],
            };
        }
    };

    let mut results = Vec::new();

    for target_name in targets {
        emit!(
            "info",
            format!("Iniciando build para target '{}'.", target_name)
        );

        let entry = match project_with_target_override(&project, target_name) {
            Ok(project_override) => {
                let prefixed_result = run_build_for_project_with_environment(
                    project_dir,
                    &project_override,
                    environment,
                    |line| {
                        on_log(BuildLogLine {
                            level: line.level.clone(),
                            message: format!("[{}] {}", target_name, line.message),
                        });
                    },
                );

                build_entry_from_result(target_name, prefixed_result)
            }
            Err(error) => {
                let entry_log = vec![BuildLogLine {
                    level: "error".to_string(),
                    message: format!("[{}] target override invalido: {}", target_name, error),
                }];
                let diagnostics =
                    build_diagnostics_from_log(target_name, &entry_log, Some(project_dir));
                MultiTargetBuildEntry {
                    target: target_name.clone(),
                    ok: false,
                    rom_path: String::new(),
                    rom_size_bytes: 0,
                    warnings: Vec::new(),
                    errors: vec![error],
                    log: entry_log,
                    diagnostics,
                }
            }
        };

        results.push(entry);
    }

    MultiTargetBuildResult {
        ok: !results.is_empty() && results.iter().all(|entry| entry.ok),
        results,
    }
}

fn run_build_for_project_with_environment<F>(
    project_dir: &Path,
    project: &Project,
    environment: &BuildEnvironment,
    on_log: F,
) -> BuildResult
where
    F: Fn(BuildLogLine),
{
    let mut log = Vec::new();

    macro_rules! emit {
        ($level:expr, $message:expr) => {{
            let entry = BuildLogLine {
                level: $level.to_string(),
                message: $message.to_string(),
            };
            on_log(entry.clone());
            log.push(entry);
        }};
    }

    let target = match target_spec(&project.target) {
        Ok(target) => target,
        Err(error) => {
            emit!("error", error.to_string());
            return failed_build_result(&project.target, log, Some(project_dir));
        }
    };

    emit!(
        "info",
        format!(
            "Projeto '{}' carregado. Target: {}",
            project.name, project.target
        )
    );

    let legacy_host_root = match legacy_sgdk_host_root(project_dir, project) {
        Ok(root) => root,
        Err(error) => {
            emit!("error", error);
            return failed_build_result(target.target, log, Some(project_dir));
        }
    };

    if let Some(host_root) = legacy_host_root {
        if target.target != "megadrive" {
            emit!(
                "error",
                "Projetos SGDK legados em modo overlay suportam apenas build Mega Drive."
            );
            return failed_build_result(target.target, log, Some(project_dir));
        }

        if !host_root.is_dir() {
            emit!(
                "error",
                format!(
                    "Raiz do projeto SGDK legado nao encontrada: {}",
                    host_root.display()
                )
            );
            return failed_build_result(target.target, log, Some(&host_root));
        }

        let Some(makefile_path) = find_makefile(&host_root) else {
            emit!(
                "error",
                format!(
                    "Projeto SGDK legado em '{}' nao possui Makefile nativo para delegacao.",
                    host_root.display()
                )
            );
            return failed_build_result(target.target, log, Some(&host_root));
        };

        emit!(
            "info",
            format!(
                "Modo overlay SGDK legado detectado. Delegando build para host '{}'.",
                host_root.display()
            )
        );
        emit!(
            "info",
            format!("Makefile host localizado: {}", makefile_path.display())
        );

        let toolchain = match resolve_toolchain(environment, target) {
            Ok(toolchain) => toolchain,
            Err(error) => {
                emit!("error", error);
                return failed_build_result(target.target, log, Some(&host_root));
            }
        };

        emit!(
            "info",
            format!(
                "Toolchain localizada: {} (make: {})",
                toolchain.root.display(),
                toolchain.make_program.display()
            )
        );

        let workspace = BuildWorkspace {
            root: host_root.clone(),
            out_dir: host_root.join("out"),
        };

        if let Err(error) = invoke_make(&toolchain, &workspace, target, &mut log, &on_log) {
            emit!("error", error);
            return failed_build_result(target.target, log, Some(&workspace.root));
        }

        let rom_path = match detect_rom_artifact(&workspace, target) {
            Some(path) => path,
            None => {
                emit!(
                    "error",
                    format!(
                        "Build legado terminou sem artefato de ROM valido em '{}'.",
                        host_root.display()
                    )
                );
                return failed_build_result(target.target, log, Some(&workspace.root));
            }
        };

        if let Err(error) = validate_rom_signature(&rom_path, target) {
            emit!("warn", error);
        }
        emit!("success", format!("ROM gerada: {}", rom_path.display()));

        return successful_build_result(rom_path, log);
    }

    let scene = match load_scene(project_dir, &project.entry_scene) {
        Ok(scene) => scene,
        Err(error) => {
            emit!(
                "error",
                format!(
                    "Falha ao carregar cena '{}': {}",
                    project.entry_scene, error
                )
            );
            return failed_build_result(target.target, log, Some(project_dir));
        }
    };

    emit!(
        "info",
        format!(
            "Cena '{}' carregada ({} entidade(s)).",
            scene.scene_id,
            scene.entities.len()
        )
    );

    let resolved_scene = match resolve_prefabs(project_dir, &scene) {
        Ok(scene) => scene,
        Err(error) => {
            emit!("error", format!("Falha ao resolver prefabs: {}", error));
            return failed_build_result(target.target, log, Some(project_dir));
        }
    };

    let source_kind = project
        .template_metadata
        .as_ref()
        .map(|metadata| metadata.source_kind.as_str());
    if target.target == "megadrive" {
        let md_status = md_profile::hw_status_with_source_kind(&resolved_scene, source_kind);
        let managed_tail = if md_status.analysis_mode == "sgdk_managed" {
            format!(
                " banks={}/{} cells={}/{}",
                md_status.managed_concurrent_sprite_banks,
                md_profile::MD_MANAGED_MAX_CONCURRENT_BANKS,
                md_status.managed_sprite_cells_used,
                md_profile::MD_MANAGED_SPRITE_CELL_BUDGET
            )
        } else {
            String::new()
        };
        emit!(
            "info",
            format!(
                "MD VRAM analysis: mode={} total={}KB resident={}KB spr_res={}KB tile={}KB hud={}KB strm_spr={}KB anim_sw={}KB streamable={}KB dma/frame={}KB{} (limits: vram={}KB dma={}KB).",
                md_status.analysis_mode,
                md_status.project_asset_bytes / 1024,
                md_status.resident_vram_bytes / 1024,
                md_status.sprite_resident_bytes / 1024,
                md_status.tilemap_resident_bytes / 1024,
                md_status.hud_resident_bytes / 1024,
                md_status.streamable_sprite_bytes / 1024,
                md_status.animated_swap_bytes / 1024,
                md_status.streamable_vram_bytes / 1024,
                md_status.dma_frame_bytes / 1024,
                managed_tail,
                md_status.vram_limit / 1024,
                md_status.dma_limit / 1024
            )
        );
    }
    let mut scene_for_build = resolved_scene.clone();
    let mut compatibility_profile_applied = false;
    let mut hw_errors = match target.target {
        "megadrive" => md_profile::validate_scene_with_source_kind(&scene_for_build, source_kind)
            .into_iter()
            .map(|error| (error.message, error.is_fatal))
            .collect::<Vec<_>>(),
        "snes" => snes_profile::validate_scene_with_source_kind(&resolved_scene, source_kind)
            .into_iter()
            .map(|error| (error.message, error.is_fatal))
            .collect::<Vec<_>>(),
        _ => unreachable!("validated by target_spec"),
    };

    let needs_hardware_compatibility = hw_errors.iter().any(|(_, is_fatal)| *is_fatal);
    let needs_resource_compatibility = target.target == "megadrive"
        && is_sgdk_compatibility_source(source_kind)
        && scene_requires_sgdk_resource_compatibility(&scene_for_build);
    if target.target == "megadrive"
        && (needs_hardware_compatibility || needs_resource_compatibility)
        && is_sgdk_compatibility_source(source_kind)
    {
        if let Some(profile) = build_sgdk_compatibility_profile(&resolved_scene, source_kind) {
            let compat_errors =
                md_profile::validate_scene_with_source_kind(&profile.scene, source_kind)
                    .into_iter()
                    .map(|error| (error.message, error.is_fatal))
                    .collect::<Vec<_>>();
            if compat_errors.iter().any(|(_, is_fatal)| *is_fatal) {
                emit!(
                    "warn",
                    format!(
                        "SGDK compatibility profile could not clear fatal hardware blockers; original scene remains blocked. attempted active_sprites={} culled_sprites={}.",
                        profile.active_sprite_count, profile.culled_sprite_count
                    )
                );
            } else {
                let original_blockers = hw_errors
                    .iter()
                    .filter(|(_, is_fatal)| *is_fatal)
                    .map(|(message, _)| message.as_str())
                    .collect::<Vec<_>>()
                    .join(" | ");
                emit!(
                    "warn",
                    format!(
                        "SGDK compatibility profile applied: sprite culling + multiplex/tilemap streaming plan keeps {} active sprite(s) and marks {} as streamable; original blockers: {}.",
                        profile.active_sprite_count, profile.culled_sprite_count, original_blockers
                    )
                );
                let compat_status =
                    md_profile::hw_status_with_source_kind(&profile.scene, source_kind);
                emit!(
                    "info",
                    format!(
                        "MD VRAM compatibility: mode={} total={}KB resident={}KB spr_res={}KB tile={}KB hud={}KB strm_spr={}KB anim_sw={}KB streamable={}KB dma/frame={}KB banks={}/{} cells={}/{}.",
                        compat_status.analysis_mode,
                        compat_status.project_asset_bytes / 1024,
                        compat_status.resident_vram_bytes / 1024,
                        compat_status.sprite_resident_bytes / 1024,
                        compat_status.tilemap_resident_bytes / 1024,
                        compat_status.hud_resident_bytes / 1024,
                        compat_status.streamable_sprite_bytes / 1024,
                        compat_status.animated_swap_bytes / 1024,
                        compat_status.streamable_vram_bytes / 1024,
                        compat_status.dma_frame_bytes / 1024,
                        compat_status.managed_concurrent_sprite_banks,
                        md_profile::MD_MANAGED_MAX_CONCURRENT_BANKS,
                        compat_status.managed_sprite_cells_used,
                        md_profile::MD_MANAGED_SPRITE_CELL_BUDGET
                    )
                );
                scene_for_build = profile.scene;
                compatibility_profile_applied = true;
                hw_errors = compat_errors;
            }
        }
    }

    for (message, is_fatal) in &hw_errors {
        emit!(if *is_fatal { "error" } else { "warn" }, message);
    }

    if hw_errors.iter().any(|(_, is_fatal)| *is_fatal) {
        emit!("error", "Build abortado: erros de hardware constraints.");
        return failed_build_result(target.target, log, Some(project_dir));
    }

    emit!(
        "info",
        "Gerando codigo C e manifestos a partir do modelo canónico RDS (cena + project.rds); nao le o C do doador SGDK em runtime."
    );
    let ast = if !compatibility_profile_applied {
        match generate_ast_with_prefabs(project_dir, project, &scene) {
            Ok(ast) => ast,
            Err(error) => {
                emit!(
                    "error",
                    format!("Falha ao gerar AST com prefabs: {}", error)
                );
                return failed_build_result(target.target, log, Some(project_dir));
            }
        }
    } else {
        generate_ast(project, &scene_for_build)
    };
    // Normalise collision map data before passing to emitter (handles null and length mismatches)
    let collision_data = scene_for_build
        .collision_map
        .as_ref()
        .map(|m| m.normalize());
    let collision_slice = collision_data.as_deref();
    let artifacts = match target.target {
        "snes" => {
            let output = emit_snes_with_collision(&ast, &project.name, collision_slice);
            EmitArtifacts {
                main_c: output.main_c,
                resources_res: output.resources_res,
            }
        }
        _ => {
            let output = emit_sgdk_with_collision(&ast, &project.name, collision_slice);
            EmitArtifacts {
                main_c: output.main_c,
                resources_res: output.resources_res,
            }
        }
    };

    let workspace = match prepare_workspace(project_dir, project, target, &ast, &artifacts) {
        Ok(workspace) => workspace,
        Err(error) => {
            emit!("error", error);
            let evidence_path = build_evidence_path(project_dir, project, target);
            return failed_build_result(target.target, log, evidence_path.as_deref());
        }
    };

    emit!(
        "success",
        format!(
            "Workspace de build preparado em: {}",
            workspace.root.display()
        )
    );

    let toolchain = match resolve_toolchain(environment, target) {
        Ok(toolchain) => toolchain,
        Err(error) => {
            emit!("error", error);
            return failed_build_result(target.target, log, Some(&workspace.root));
        }
    };

    emit!(
        "info",
        format!(
            "Toolchain localizada: {} (make: {})",
            toolchain.root.display(),
            toolchain.make_program.display()
        )
    );

    if target.target == "snes" && cfg!(target_os = "windows") && toolchain.bash_program.is_none() {
        emit!(
            "error",
            "Git Bash/MSYS2 real e obrigatorio para builds SNES/PVSnesLib no Windows. Instale Git Bash ou MSYS2; o shim WSL nao e suportado."
        );
        return failed_build_result(target.target, log, Some(&workspace.root));
    }

    if let Err(error) = invoke_make(&toolchain, &workspace, target, &mut log, &on_log) {
        emit!("error", error);
        return failed_build_result(target.target, log, Some(&workspace.root));
    }

    let rom_path = match detect_rom_artifact(&workspace, target) {
        Some(path) => path,
        None => {
            emit!(
                "error",
                format!(
                    "Build terminou sem artefato de ROM valido em '{}'.",
                    workspace.root.display()
                )
            );
            return failed_build_result(target.target, log, Some(&workspace.root));
        }
    };

    if let Err(error) = validate_rom_signature(&rom_path, target) {
        emit!("warn", error);
    }
    emit!("success", format!("ROM gerada: {}", rom_path.display()));

    successful_build_result(rom_path, log)
}

fn scene_requires_sgdk_resource_compatibility(scene: &Scene) -> bool {
    scene.entities.iter().any(|entity| {
        entity
            .components
            .sprite
            .as_ref()
            .map(|sprite| sprite.frame_width > 128 || sprite.frame_height > 128)
            .unwrap_or(false)
    })
}

fn project_with_target_override(project: &Project, target_name: &str) -> Result<Project, String> {
    let target = target_spec(target_name).map_err(|error| error.to_string())?;
    let mut project_override = project.clone();
    project_override.target = target.target.to_string();
    project_override.resolution = target.resolution();
    project_override.palette_mode = target.palette_mode.to_string();
    Ok(project_override)
}

fn build_entry_from_result(target: &str, result: BuildResult) -> MultiTargetBuildEntry {
    let rom_size_bytes = if result.ok && !result.rom_path.is_empty() {
        fs::metadata(&result.rom_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    } else {
        0
    };
    let warnings = result
        .log
        .iter()
        .filter(|line| line.level == "warn")
        .map(|line| line.message.clone())
        .collect::<Vec<_>>();
    let errors = result
        .log
        .iter()
        .filter(|line| line.level == "error")
        .map(|line| line.message.clone())
        .collect::<Vec<_>>();

    MultiTargetBuildEntry {
        target: target.to_string(),
        ok: result.ok,
        rom_path: result.rom_path,
        rom_size_bytes,
        warnings,
        errors,
        log: result.log,
        diagnostics: result.diagnostics,
    }
}

fn legacy_sgdk_host_root(project_dir: &Path, project: &Project) -> Result<Option<PathBuf>, String> {
    let Some(metadata) = project.template_metadata.as_ref() else {
        return Ok(None);
    };

    if metadata.source_kind != "external_sgdk" {
        return Ok(None);
    }

    let is_legacy_overlay = metadata.template_id == "legacy_sgdk_overlay"
        || project_dir.join("legacy_sgdk_index.json").is_file();
    if !is_legacy_overlay {
        return Ok(None);
    }

    let source_path = metadata.source_path.trim();
    if source_path.is_empty() {
        return Err("Projeto SGDK legado sem caminho raiz do host.".to_string());
    }

    Ok(Some(PathBuf::from(source_path)))
}

fn find_makefile(root: &Path) -> Option<PathBuf> {
    ["Makefile", "makefile"]
        .into_iter()
        .map(|candidate| root.join(candidate))
        .find(|candidate| candidate.is_file())
}

fn prepare_workspace(
    project_dir: &Path,
    project: &Project,
    target: TargetSpec,
    ast: &AstOutput,
    artifacts: &EmitArtifacts,
) -> Result<BuildWorkspace, String> {
    let output_root = project
        .build
        .as_ref()
        .map(|build| build.output_dir.as_str())
        .unwrap_or("build/");
    let output_root = sanitize_build_output_dir(output_root)?;
    let root = project_dir.join(output_root).join(target.target);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| {
            format!(
                "Nao foi possivel limpar workspace '{}': {}",
                root.display(),
                e
            )
        })?;
    }

    let src_dir = root.join("src");
    let res_dir = root.join("res");
    let out_dir = root.join("out");
    fs::create_dir_all(&src_dir)
        .and_then(|_| fs::create_dir_all(&res_dir))
        .and_then(|_| fs::create_dir_all(&out_dir))
        .map_err(|e| {
            format!(
                "Nao foi possivel criar workspace '{}': {}",
                root.display(),
                e
            )
        })?;

    let makefile_path = root.join("Makefile");
    let project_slug = sanitize_project_name(&project.name);
    let main_c_path = src_dir.join("main.c");
    let resources_res_path = res_dir.join("resources.res");

    fs::write(&main_c_path, &artifacts.main_c)
        .map_err(|e| format!("Falha ao gravar '{}': {}", main_c_path.display(), e))?;
    fs::write(&resources_res_path, &artifacts.resources_res)
        .map_err(|e| format!("Falha ao gravar '{}': {}", resources_res_path.display(), e))?;

    match target.target {
        "snes" => {
            stage_snes_assets(project_dir, &src_dir, ast)?;
            let data_asm = render_snes_data_asm(ast);
            let hdr_asm = render_snes_header(project);
            fs::write(root.join("data.asm"), &data_asm).map_err(|e| {
                format!(
                    "Falha ao gravar 'data.asm' do SNES em '{}': {}",
                    root.display(),
                    e
                )
            })?;
            fs::write(root.join("hdr.asm"), &hdr_asm).map_err(|e| {
                format!(
                    "Falha ao gravar 'hdr.asm' do SNES em '{}': {}",
                    root.display(),
                    e
                )
            })?;
            fs::write(
                &makefile_path,
                render_pvsneslib_makefile(&project_slug, ast),
            )
            .map_err(|e| format!("Falha ao gravar '{}': {}", makefile_path.display(), e))?;
        }
        _ => {
            stage_project_assets(project_dir, &res_dir, ast)?;
            fs::write(&makefile_path, render_sgdk_makefile(&project_slug))
                .map_err(|e| format!("Falha ao gravar '{}': {}", makefile_path.display(), e))?;
        }
    }

    Ok(BuildWorkspace { root, out_dir })
}

fn stage_project_assets(
    project_dir: &Path,
    workspace_root: &Path,
    ast: &AstOutput,
) -> Result<(), String> {
    for asset in &ast.sprite_assets {
        let source_rel = sanitize_relative_asset_path(&asset.asset_path)?;
        let source = project_dir.join(&source_rel);
        if !source.exists() {
            return Err(format!(
                "Asset referenciado nao encontrado: '{}'.",
                source.display()
            ));
        }

        let destination_rel = sgdk_bitmap_staging_path(&source_rel);
        let destination = workspace_root.join(&destination_rel);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Falha ao preparar pasta de asset '{}': {}",
                    parent.display(),
                    e
                )
            })?;
        }

        stage_sgdk_sprite_asset(&source, &destination, asset)?;
    }

    for asset in collect_tilemap_assets(ast) {
        let source_rel = sanitize_relative_asset_path(&asset.asset_path)?;
        let source = project_dir.join(&source_rel);
        if !source.exists() {
            return Err(format!(
                "Asset referenciado nao encontrado: '{}'.",
                source.display()
            ));
        }

        let destination_rel = sgdk_tilemap_staging_path(&source_rel);
        let destination = workspace_root.join(&destination_rel);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Falha ao preparar pasta de asset '{}': {}",
                    parent.display(),
                    e
                )
            })?;
        }

        stage_sgdk_tilemap_asset(&source, &destination)?;
    }

    for (_, asset_path) in collect_sfx_resources(ast) {
        stage_project_raw_asset(project_dir, workspace_root, &asset_path, "SGDK audio")?;
    }
    for (_, asset_path) in collect_bgm_tracks(ast) {
        stage_project_raw_asset(project_dir, workspace_root, &asset_path, "SGDK audio")?;
    }

    Ok(())
}

fn stage_snes_assets(project_dir: &Path, src_dir: &Path, ast: &AstOutput) -> Result<(), String> {
    for asset in &ast.sprite_assets {
        let source_rel = sanitize_relative_asset_path(&asset.asset_path)?;
        let source = project_dir.join(source_rel);
        if !source.exists() {
            return Err(format!(
                "Asset referenciado nao encontrado: '{}'.",
                source.display()
            ));
        }

        let destination = src_dir.join(format!("{}.bmp", asset.resource_name));
        stage_bitmap_asset(&source, &destination, "SNES")?;
    }

    for asset in collect_tilemap_assets(ast) {
        let source_rel = sanitize_relative_asset_path(&asset.asset_path)?;
        let source = project_dir.join(source_rel);
        if !source.exists() {
            return Err(format!(
                "Asset referenciado nao encontrado: '{}'.",
                source.display()
            ));
        }

        let destination = src_dir.join(format!("{}.bmp", asset.resource_name));
        stage_bitmap_asset(&source, &destination, "SNES")?;
    }

    for (resource_name, asset_path) in collect_sfx_resources(ast) {
        stage_snes_audio_asset(project_dir, src_dir, &resource_name, &asset_path, "sfx")?;
    }
    for (resource_name, asset_path) in collect_bgm_tracks(ast) {
        stage_snes_audio_asset(project_dir, src_dir, &resource_name, &asset_path, "bgm")?;
    }

    Ok(())
}

fn stage_project_raw_asset(
    project_dir: &Path,
    workspace_root: &Path,
    asset_path: &str,
    target_label: &str,
) -> Result<(), String> {
    let source_rel = sanitize_relative_asset_path(asset_path)?;
    let source = project_dir.join(&source_rel);
    if !source.exists() {
        return Err(format!(
            "Asset referenciado nao encontrado: '{}'.",
            source.display()
        ));
    }

    let destination = workspace_root.join(&source_rel);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Falha ao preparar pasta de asset '{}': {}",
                parent.display(),
                e
            )
        })?;
    }
    fs::copy(&source, &destination).map_err(|e| {
        format!(
            "Falha ao copiar asset {} '{}' para '{}': {}",
            target_label,
            source.display(),
            destination.display(),
            e
        )
    })?;

    Ok(())
}

fn stage_snes_audio_asset(
    project_dir: &Path,
    src_dir: &Path,
    resource_name: &str,
    asset_path: &str,
    suffix: &str,
) -> Result<(), String> {
    let source_rel = sanitize_relative_asset_path(asset_path)?;
    let source = project_dir.join(&source_rel);
    if !source.exists() {
        return Err(format!(
            "Asset referenciado nao encontrado: '{}'.",
            source.display()
        ));
    }

    let destination = src_dir.join(snes_audio_staging_filename(
        resource_name,
        asset_path,
        suffix,
    ));
    fs::copy(&source, &destination).map_err(|e| {
        format!(
            "Falha ao copiar asset SNES audio '{}' para '{}': {}",
            source.display(),
            destination.display(),
            e
        )
    })?;

    Ok(())
}

fn stage_bitmap_asset(source: &Path, destination: &Path, target_label: &str) -> Result<(), String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("bmp") => fs::copy(source, destination).map(|_| ()).map_err(|e| {
            format!(
                "Falha ao copiar asset {} '{}' para '{}': {}",
                target_label,
                source.display(),
                destination.display(),
                e
            )
        }),
        _ => {
            let image = image::open(source).map_err(|e| {
                format!(
                    "Falha ao ler asset {} '{}': {}",
                    target_label,
                    source.display(),
                    e
                )
            })?;
            write_indexed_bmp_8bit(&image, destination).map_err(|e| {
                format!(
                    "Falha ao converter asset {} '{}' para '{}': {}",
                    target_label,
                    source.display(),
                    destination.display(),
                    e
                )
            })
        }
    }
}

fn stage_sgdk_sprite_asset(
    source: &Path,
    destination: &Path,
    asset: &SpriteAsset,
) -> Result<(), String> {
    let frame_width = asset.frame_width.max(8);
    let frame_height = asset.frame_height.max(8);
    let image = image::open(source).map_err(|e| {
        format!(
            "Falha ao ler asset SGDK sprite '{}' para recurso '{}': {}",
            source.display(),
            asset.resource_name,
            e
        )
    })?;
    let width = image.width();
    let height = image.height();
    let canvas_width = round_up_to_multiple(width, frame_width).max(frame_width);
    let canvas_height = round_up_to_multiple(height, frame_height).max(frame_height);

    write_indexed_bmp_8bit_with_canvas_palette_limit(
        &image,
        destination,
        canvas_width,
        canvas_height,
        16,
    )
    .map_err(|e| {
        format!(
            "Falha ao converter asset SGDK sprite '{}' para '{}' (frame {}x{}, canvas {}x{}): {}",
            source.display(),
            destination.display(),
            frame_width,
            frame_height,
            canvas_width,
            canvas_height,
            e
        )
    })
}

fn stage_sgdk_tilemap_asset(source: &Path, destination: &Path) -> Result<(), String> {
    let image = image::open(source).map_err(|e| {
        format!(
            "Falha ao ler asset SGDK tilemap '{}': {}",
            source.display(),
            e
        )
    })?;
    write_indexed_bmp_8bit_with_canvas_palette_limit(
        &image,
        destination,
        image.width(),
        image.height(),
        16,
    )
    .map_err(|e| {
        format!(
            "Falha ao converter asset SGDK tilemap '{}' para '{}': {}",
            source.display(),
            destination.display(),
            e
        )
    })
}

fn round_up_to_multiple(value: u32, multiple: u32) -> u32 {
    if multiple == 0 {
        return value;
    }
    value.saturating_add(multiple.saturating_sub(1)) / multiple * multiple
}

fn sgdk_tilemap_staging_path(asset_path: &Path) -> PathBuf {
    sgdk_bitmap_staging_path(asset_path)
}

fn sgdk_bitmap_staging_path(asset_path: &Path) -> PathBuf {
    let mut staged = asset_path.to_path_buf();
    staged.set_extension("bmp");
    staged
}

fn snes_audio_staging_filename(resource_name: &str, asset_path: &str, suffix: &str) -> String {
    let extension = Path::new(asset_path)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("bin");
    format!("{}_{}.{}", resource_name, suffix, extension)
}

fn write_indexed_bmp_8bit(image: &image::DynamicImage, destination: &Path) -> Result<(), String> {
    write_indexed_bmp_8bit_with_canvas(image, destination, image.width(), image.height())
}

fn write_indexed_bmp_8bit_with_canvas(
    image: &image::DynamicImage,
    destination: &Path,
    canvas_width: u32,
    canvas_height: u32,
) -> Result<(), String> {
    write_indexed_bmp_8bit_with_canvas_palette_limit(
        image,
        destination,
        canvas_width,
        canvas_height,
        256,
    )
}

fn write_indexed_bmp_8bit_with_canvas_palette_limit(
    image: &image::DynamicImage,
    destination: &Path,
    canvas_width: u32,
    canvas_height: u32,
    max_palette_colors: usize,
) -> Result<(), String> {
    let rgba = image.to_rgba8();
    let width = canvas_width as usize;
    let height = canvas_height as usize;
    let row_stride = (width + 3) & !3;
    let pixel_data_size = row_stride * height;
    let palette_size = 256 * 4;
    let pixel_offset = 14 + 40 + palette_size;
    let file_size = pixel_offset + pixel_data_size;

    let max_palette_colors = max_palette_colors.clamp(1, 256);
    let mut palette: Vec<[u8; 4]> = vec![[0, 0, 0, 0]];
    let mut indices = vec![0u8; width * height];

    for y in 0..rgba.height() as usize {
        for x in 0..rgba.width() as usize {
            let pixel = rgba.get_pixel(x as u32, y as u32);
            if pixel[3] == 0 {
                indices[y * width + x] = 0;
                continue;
            }
            let color = [pixel[2], pixel[1], pixel[0], 0];
            let palette_index = palette
                .iter()
                .position(|entry| *entry == color)
                .or_else(|| {
                    if palette.len() < max_palette_colors {
                        palette.push(color);
                        Some(palette.len() - 1)
                    } else if max_palette_colors < 256 {
                        nearest_palette_index(&palette, color)
                    } else {
                        None
                    }
                })
                .ok_or_else(|| {
                    format!(
                        "Asset usa mais de 256 cores e nao pode ser convertido para BMP indexado: {}x{}",
                        rgba.width(),
                        rgba.height()
                    )
                })?;
            indices[y * width + x] = palette_index as u8;
        }
    }

    let mut bytes = Vec::with_capacity(file_size);
    bytes.extend_from_slice(b"BM");
    bytes.extend_from_slice(&(file_size as u32).to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
    bytes.extend_from_slice(&40u32.to_le_bytes());
    bytes.extend_from_slice(&(width as i32).to_le_bytes());
    bytes.extend_from_slice(&(height as i32).to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&8u16.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&(pixel_data_size as u32).to_le_bytes());
    bytes.extend_from_slice(&2835u32.to_le_bytes());
    bytes.extend_from_slice(&2835u32.to_le_bytes());
    bytes.extend_from_slice(&256u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());

    for color in &palette {
        bytes.extend_from_slice(color);
    }
    for _ in palette.len()..256 {
        bytes.extend_from_slice(&[0, 0, 0, 0]);
    }

    for row in (0..height).rev() {
        let start = row * width;
        let end = start + width;
        bytes.extend_from_slice(&indices[start..end]);
        bytes.resize(bytes.len() + (row_stride - width), 0);
    }

    fs::write(destination, bytes).map_err(|e| {
        format!(
            "falha ao gravar BMP indexado '{}': {}",
            destination.display(),
            e
        )
    })
}

fn nearest_palette_index(palette: &[[u8; 4]], color: [u8; 4]) -> Option<usize> {
    palette
        .iter()
        .enumerate()
        .min_by_key(|(_, candidate)| {
            let db = i32::from(candidate[0]) - i32::from(color[0]);
            let dg = i32::from(candidate[1]) - i32::from(color[1]);
            let dr = i32::from(candidate[2]) - i32::from(color[2]);
            db * db + dg * dg + dr * dr
        })
        .map(|(index, _)| index)
}

fn render_sgdk_makefile(project_slug: &str) -> String {
    format!(
        "PROJECT_NAME := {project_slug}\n\
         ROM_NAME := {project_slug}\n\
         SRC := $(wildcard src/*.c)\n\
         RES := $(wildcard res/*.*)\n\
         BINDIR := out\n\
         include $(SGDK)/makefile.gen\n"
    )
}

fn render_pvsneslib_makefile(project_slug: &str, ast: &AstOutput) -> String {
    let tilemap_assets = collect_tilemap_assets(ast);
    let mut out = String::new();
    out.push_str("ifeq ($(strip $(PVSNESLIB_HOME)),)\n");
    out.push_str("$(error \"Please create an environment variable PVSNESLIB_HOME by following this guide: https://github.com/alekmaul/pvsneslib/wiki/Installation\")\n");
    out.push_str("endif\n\n");
    out.push_str("include ${PVSNESLIB_HOME}/devkitsnes/snes_rules\n\n");
    out.push_str("ifeq ($(OS),Windows_NT)\n");
    out.push_str("ifeq ($(strip $(PVSNESLIB_LIBDIR_WIN)),)\n");
    out.push_str("$(error \"PVSNESLIB_LIBDIR_WIN environment variable is required for Windows SNES builds\")\n");
    out.push_str("endif\n");
    out.push_str("override LIBDIRSOBJSW := $(PVSNESLIB_LIBDIR_WIN)\n");
    out.push_str("endif\n\n");
    out.push_str(".PHONY: bitmaps all postbuild\n\n");
    out.push_str(&format!("export ROMNAME := {}\n\n", project_slug));
    out.push_str("all: bitmaps postbuild\n\n");
    out.push_str("postbuild: $(ROMNAME).sfc\n");
    out.push_str("\t@mkdir -p out\n");
    out.push_str("\t@cp $(ROMNAME).sfc out/$(ROMNAME).sfc\n");
    out.push_str("\t@if [ -f $(ROMNAME).sym ]; then cp $(ROMNAME).sym out/$(ROMNAME).sym; fi\n\n");
    out.push_str("clean: cleanBuildRes cleanRom cleanGfx\n\n");

    let mut bitmap_targets = Vec::new();
    for asset in &tilemap_assets {
        let pic_target = format!("src/{}.pic", asset.resource_name);
        let map_target = format!("src/{}.map", asset.resource_name);
        let pal_target = format!("src/{}.pal", asset.resource_name);
        let bmp_target = format!("src/{}.bmp", asset.resource_name);
        bitmap_targets.push(pic_target.clone());
        bitmap_targets.push(map_target.clone());
        bitmap_targets.push(pal_target.clone());
        out.push_str(&format!(
            "{} {} {}: {}\n",
            pic_target, map_target, pal_target, bmp_target
        ));
        out.push_str("\t@echo convert bitmap ... $(notdir $<)\n");
        out.push_str("\t$(GFXCONV) -s 8 -o 16 -u 16 -e 0 -p -m -t bmp -i $<\n\n");
    }

    for asset in &ast.sprite_assets {
        let pic_target = format!("src/{}.pic", asset.resource_name);
        let pal_target = format!("src/{}.pal", asset.resource_name);
        let data_target = format!("src/{}_data.as", asset.resource_name);
        let bmp_target = format!("src/{}.bmp", asset.resource_name);
        let sprite_size = asset.frame_width.max(asset.frame_height);
        bitmap_targets.push(pic_target.clone());
        bitmap_targets.push(pal_target.clone());
        bitmap_targets.push(data_target.clone());
        out.push_str(&format!(
            "{} {} {}: {}\n",
            pic_target, pal_target, data_target, bmp_target
        ));
        out.push_str("\t@echo convert bitmap ... $(notdir $<)\n");
        out.push_str(&format!(
            "\t$(GFXCONV) -s {} -o 16 -u 16 -p -t bmp -i $<\n\n",
            sprite_size
        ));
    }

    if bitmap_targets.is_empty() {
        out.push_str("bitmaps:\n\t@echo no sprite assets to convert for SNES\n");
    } else {
        out.push_str(&format!("bitmaps: {}\n", bitmap_targets.join(" ")));
    }
    out.push('\n');
    out
}

fn render_snes_data_asm(ast: &AstOutput) -> String {
    let mut out = String::new();
    let tilemap_assets = collect_tilemap_assets(ast);
    let sfx_resources = collect_sfx_resources(ast);
    let bgm_tracks = collect_bgm_tracks(ast);
    out.push_str(".include \"hdr.asm\"\n\n");

    if !tilemap_assets.is_empty() {
        out.push_str(".section \".rodata_bg\" superfree\n\n");
        for asset in &tilemap_assets {
            out.push_str(&format!("{}_til:\n", asset.resource_name));
            out.push_str(&format!(".incbin \"src/{}.pic\"\n", asset.resource_name));
            out.push_str(&format!("{}_tilend:\n\n", asset.resource_name));
            out.push_str(&format!("{}_map:\n", asset.resource_name));
            out.push_str(&format!(".incbin \"src/{}.map\"\n", asset.resource_name));
            out.push_str(&format!("{}_mapend:\n\n", asset.resource_name));
            out.push_str(&format!("{}_pal:\n", asset.resource_name));
            out.push_str(&format!(".incbin \"src/{}.pal\"\n", asset.resource_name));
            out.push_str(&format!("{}_palend:\n\n", asset.resource_name));
        }
        out.push_str(".ends\n\n");
    }

    out.push_str(".section \".rosprite\" superfree\n\n");
    for asset in &ast.sprite_assets {
        out.push_str(&format!(
            ".include \"src/{}_data.as\"\n",
            asset.resource_name
        ));
    }
    out.push_str("\n.ends\n");

    if !sfx_resources.is_empty() || !bgm_tracks.is_empty() {
        out.push_str("\n\n.section \".roaudio\" superfree\n\n");
        for (resource_name, asset_path) in sfx_resources {
            out.push_str(&format!("{}_sfx:\n", resource_name));
            out.push_str(&format!(
                ".incbin \"src/{}\"\n",
                snes_audio_staging_filename(&resource_name, &asset_path, "sfx")
            ));
            out.push_str(&format!("{}_sfxend:\n\n", resource_name));
        }
        for (resource_name, asset_path) in bgm_tracks {
            out.push_str(&format!("{}_bgm:\n", resource_name));
            out.push_str(&format!(
                ".incbin \"src/{}\"\n",
                snes_audio_staging_filename(&resource_name, &asset_path, "bgm")
            ));
            out.push_str(&format!("{}_bgmend:\n\n", resource_name));
        }
        out.push_str(".ends\n");
    }

    out
}

fn render_snes_header(project: &Project) -> String {
    let mut title = project
        .name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == ' ' || *ch == '_')
        .collect::<String>()
        .to_ascii_uppercase();
    title.truncate(21);

    format!(
        ".MEMORYMAP\n\
           SLOTSIZE $8000\n\
           DEFAULTSLOT 0\n\
           SLOT 0 $8000\n\
           SLOT 1 $0 $2000\n\
           SLOT 2 $2000 $E000\n\
           SLOT 3 $0 $10000\n\
         .ENDME\n\n\
         .ROMBANKSIZE $8000\n\
         .ROMBANKS 8\n\n\
         .SNESHEADER\n\
           ID \"SNES\"\n\
           NAME \"{title:<21}\"\n\
           SLOWROM\n\
           LOROM\n\
           CARTRIDGETYPE $00\n\
           ROMSIZE $08\n\
           SRAMSIZE $00\n\
           COUNTRY $01\n\
           LICENSEECODE $00\n\
           VERSION $00\n\
         .ENDSNES\n\n\
         .SNESNATIVEVECTOR\n\
           COP EmptyHandler\n\
           BRK EmptyHandler\n\
           ABORT EmptyHandler\n\
           NMI VBlank\n\
           IRQ EmptyHandler\n\
         .ENDNATIVEVECTOR\n\n\
         .SNESEMUVECTOR\n\
           COP EmptyHandler\n\
           ABORT EmptyHandler\n\
           NMI EmptyHandler\n\
           RESET tcc__start\n\
           IRQBRK EmptyHandler\n\
         .ENDEMUVECTOR\n"
    )
}

fn resolve_toolchain(
    environment: &BuildEnvironment,
    target: TargetSpec,
) -> Result<Toolchain, String> {
    match target.target {
        "megadrive" => {
            let root = environment
                .sgdk_root
                .clone()
                .or_else(|| (!environment.disable_auto_detect).then(|| detect_root("SGDK_ROOT", "sgdk")).flatten())
                .ok_or_else(|| {
                    "Toolchain SGDK nao encontrada. Configure SGDK_ROOT/GDK ou instale em toolchains/sgdk/."
                        .to_string()
                })?;
            let make_program = environment
                .sgdk_make_program
                .clone()
                .or_else(|| {
                    (!environment.disable_auto_detect)
                        .then(|| detect_make_program(&root))
                        .flatten()
                })
                .ok_or_else(|| {
                    format!(
                        "Nao foi possivel localizar 'make' para SGDK em '{}'.",
                        root.display()
                    )
                })?;
            Ok(Toolchain {
                root,
                make_program,
                bash_program: None,
            })
        }
        "snes" => {
            let root = environment
                .pvsneslib_root
                .clone()
                .or_else(|| (!environment.disable_auto_detect).then(|| detect_root("PVSNESLIB_HOME", "pvsneslib")).flatten())
                .ok_or_else(|| {
                    "Toolchain PVSnesLib nao encontrada. Configure PVSNESLIB_HOME ou instale em toolchains/pvsneslib/."
                        .to_string()
                })?;
            let make_program = environment
                .pvsneslib_make_program
                .clone()
                .or_else(|| {
                    (!environment.disable_auto_detect)
                        .then(|| detect_make_program(&root))
                        .flatten()
                })
                .or_else(|| {
                    (!environment.disable_auto_detect)
                        .then(|| find_in_path(&["make", "mingw32-make"]))
                        .flatten()
                })
                .or_else(|| {
                    (!environment.disable_auto_detect)
                        .then(|| {
                            detect_root("SGDK_ROOT", "sgdk")
                                .as_deref()
                                .and_then(detect_make_program)
                        })
                        .flatten()
                })
                .ok_or_else(|| {
                    format!(
                        "Nao foi possivel localizar 'make' para PVSnesLib em '{}'.",
                        root.display()
                    )
                })?;
            Ok(Toolchain {
                root,
                make_program,
                bash_program: environment.pvsneslib_bash_program.clone().or_else(|| {
                    (!environment.disable_auto_detect)
                        .then(detect_bash_program)
                        .flatten()
                }),
            })
        }
        other => Err(format!("Target '{}' nao suportado.", other)),
    }
}

fn invoke_make<F>(
    toolchain: &Toolchain,
    workspace: &BuildWorkspace,
    target: TargetSpec,
    log: &mut Vec<BuildLogLine>,
    on_log: &F,
) -> Result<(), String>
where
    F: Fn(BuildLogLine),
{
    macro_rules! emit {
        ($level:expr, $message:expr) => {{
            let entry = BuildLogLine {
                level: $level.to_string(),
                message: $message.to_string(),
            };
            on_log(entry.clone());
            log.push(entry);
        }};
    }

    let make_extension = toolchain
        .make_program
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());
    let should_use_bash = target.target == "snes"
        && cfg!(target_os = "windows")
        && toolchain.bash_program.is_some()
        && !matches!(make_extension.as_deref(), Some("cmd") | Some("bat"));

    let output = if should_use_bash {
        if let Some(bash_program) = &toolchain.bash_program {
            let bash_make = to_shell_friendly_path(&toolchain.make_program);
            let mut command = Command::new(bash_program);
            command.current_dir(&workspace.root);
            command.env("PVSNESLIB_HOME", to_shell_friendly_path(&toolchain.root));
            command.env(
                "PVSNESLIB_LIBDIR_WIN",
                snes_library_dir_windows(&toolchain.root),
            );
            command
                .arg("-lc")
                .arg(format!("'{}'", bash_make.replace('\'', "'\\''")));
            command.output().map_err(|e| {
                format!(
                    "Falha ao iniciar build SNES em '{}': {}",
                    workspace.root.display(),
                    e
                )
            })?
        } else {
            let mut command = Command::new(&toolchain.make_program);
            command.current_dir(&workspace.root);
            command.env("PVSNESLIB_HOME", to_shell_friendly_path(&toolchain.root));
            command.env(
                "PVSNESLIB_LIBDIR_WIN",
                snes_library_dir_windows(&toolchain.root),
            );
            command.output().map_err(|e| {
                format!(
                    "Falha ao iniciar build SNES em '{}': {}",
                    workspace.root.display(),
                    e
                )
            })?
        }
    } else {
        let mut command = Command::new(&toolchain.make_program);
        command.current_dir(&workspace.root);
        if cfg!(target_os = "windows") {
            command.env("OS", "Windows_NT");
        }
        match target.target {
            "snes" => {
                if cfg!(target_os = "windows") {
                    command.env("PVSNESLIB_HOME", to_shell_friendly_path(&toolchain.root));
                    command.env(
                        "PVSNESLIB_LIBDIR_WIN",
                        snes_library_dir_windows(&toolchain.root),
                    );
                } else {
                    command.env("PVSNESLIB_HOME", &toolchain.root);
                }
            }
            _ => {
                command.env("SGDK", &toolchain.root);
                configure_java_for_sgdk(&mut command);
                if let Ok(extra_flags) = std::env::var("RDS_EXTRA_FLAGS") {
                    let extra_flags = extra_flags.trim();
                    if !extra_flags.is_empty() {
                        command.env("EXTRA_FLAGS", extra_flags);
                    }
                }
            }
        }
        command.output().map_err(|e| {
            format!(
                "Falha ao iniciar build em '{}': {}",
                workspace.root.display(),
                e
            )
        })?
    };

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if !line.trim().is_empty() {
            emit!("info", line);
        }
    }

    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if line.trim().is_empty() {
            continue;
        }
        if line.to_ascii_lowercase().contains("error") {
            emit!("error", line);
        } else {
            emit!("warn", line);
        }
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let classified = classify_make_failure(stderr.as_ref());
        return Err(format!(
            "[{}] Build externo falhou com codigo {:?}.",
            classified,
            output.status.code()
        ));
    }

    Ok(())
}

fn classify_make_failure(stderr: &str) -> &'static str {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("resources.res") || lower.contains("rescomp") {
        return "emitter_resources_failed";
    }
    if lower.contains("java") && (lower.contains("not found") || lower.contains("nao encontrado")) {
        return "java_missing";
    }
    if lower.contains("make") && (lower.contains("not found") || lower.contains("nao reconhecido"))
    {
        return "toolchain_missing";
    }
    if lower.contains("asset referenciado nao encontrado") {
        return "asset_staging_failed";
    }
    "build_failed"
}

fn validate_rom_signature(rom_path: &Path, target: TargetSpec) -> Result<(), String> {
    if target.target != "megadrive" {
        return Ok(());
    }
    let bytes = fs::read(rom_path).map_err(|error| {
        format!(
            "Falha ao ler ROM gerada para validar assinatura '{}': {}",
            rom_path.display(),
            error
        )
    })?;
    let has_sega = bytes.windows(4).any(|window| window == b"SEGA");
    if !has_sega {
        return Err(format!(
            "[rom_signature_missing] ROM Mega Drive sem assinatura 'SEGA': '{}'.",
            rom_path.display()
        ));
    }
    Ok(())
}

fn detect_rom_artifact(workspace: &BuildWorkspace, target: TargetSpec) -> Option<PathBuf> {
    let mut files = collect_files(&workspace.out_dir).ok()?;
    files.extend(collect_files(&workspace.root).ok()?);
    files.sort();
    files.dedup();

    files.into_iter().find(|path| {
        target.rom_extensions.iter().any(|extension| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case(extension))
                .unwrap_or(false)
        })
    })
}

fn collect_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    if !dir.exists() {
        return Ok(files);
    }

    for entry in
        fs::read_dir(dir).map_err(|e| format!("Falha ao listar '{}': {}", dir.display(), e))?
    {
        let entry =
            entry.map_err(|e| format!("Falha ao ler entrada em '{}': {}", dir.display(), e))?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_files(&path)?);
        } else {
            files.push(path);
        }
    }

    Ok(files)
}

fn sanitize_project_name(name: &str) -> String {
    let slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();

    let sanitized: String = slug.trim_matches('_').chars().take(48).collect();
    if sanitized.is_empty() {
        "retrodev_project".to_string()
    } else {
        sanitized
    }
}

fn sanitize_relative_asset_path(asset_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(asset_path.trim());
    if asset_path.trim().is_empty() {
        return Err("Asset com caminho vazio encontrado no projeto.".to_string());
    }
    if path.is_absolute() {
        return Err(format!(
            "Asset '{}' deve usar caminho relativo ao projeto.",
            asset_path
        ));
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!(
            "Asset '{}' nao pode escapar da raiz do projeto.",
            asset_path
        ));
    }
    Ok(path.to_path_buf())
}

fn sanitize_build_output_dir(output_dir: &str) -> Result<PathBuf, String> {
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return Err("Build.output_dir nao pode ser vazio.".to_string());
    }

    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(format!(
            "Build.output_dir '{}' deve permanecer relativo ao projeto.",
            output_dir
        ));
    }

    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!(
            "Build.output_dir '{}' nao pode escapar da raiz do projeto.",
            output_dir
        ));
    }

    let normalized = path
        .components()
        .filter_map(|component| match component {
            Component::CurDir => None,
            Component::Normal(segment) => Some(segment),
            _ => None,
        })
        .collect::<PathBuf>();

    if normalized.as_os_str().is_empty() {
        return Err(format!(
            "Build.output_dir '{}' nao pode resolver para a raiz do projeto.",
            output_dir
        ));
    }

    Ok(normalized)
}

fn detect_root(env_var: &str, local_dir_name: &str) -> Option<PathBuf> {
    let env_vars = if local_dir_name == "sgdk" {
        vec![env_var, "GDK", "GDK_WIN"]
    } else {
        vec![env_var]
    };

    for candidate_env_var in env_vars {
        if let Ok(path) = std::env::var(candidate_env_var) {
            let path = PathBuf::from(path);
            if path.exists() {
                return Some(path);
            }
        }
    }

    let local = repo_root().join("toolchains").join(local_dir_name);
    if local_dir_name == "sgdk" {
        if local.join("makefile.gen").exists()
            || (local.join("bin").exists() && local.join("inc").exists())
        {
            return Some(local);
        }
    } else if local_dir_name == "pvsneslib" && local.join("devkitsnes").join("snes_rules").exists()
    {
        return Some(local);
    }

    None
}

fn configure_java_for_sgdk(command: &mut Command) {
    let Some(java_home) = detect_java_home() else {
        return;
    };

    command.env("JAVA_HOME", &java_home);
    prepend_to_path(command, &java_home.join("bin"));
}

fn detect_make_program(root: &Path) -> Option<PathBuf> {
    for candidate in [
        root.join("bin").join(platform_make_name()),
        root.join(platform_make_name()),
        root.join("bin").join("mingw32-make.exe"),
        root.join("mingw32-make.exe"),
    ] {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    find_in_path(&["make", "mingw32-make"])
}

fn detect_java_home() -> Option<PathBuf> {
    std::env::var_os("JAVA_HOME")
        .map(PathBuf::from)
        .filter(|path| is_java_home_candidate(path))
        .or_else(|| {
            let local = repo_root().join("toolchains").join("jdk");
            is_java_home_candidate(&local).then_some(local)
        })
}

fn detect_bash_program() -> Option<PathBuf> {
    [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\msys64\usr\bin\bash.exe",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
    .or_else(|| {
        let output = Command::new("where").arg("bash").output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(PathBuf::from)
            .find(|path| {
                path.exists()
                    && !path
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .contains("\\windows\\system32\\bash.exe")
            })
    })
}

fn is_java_home_candidate(path: &Path) -> bool {
    path.join("bin").join(platform_java_name()).exists()
}

fn platform_java_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

fn prepend_to_path(command: &mut Command, entry: &Path) {
    if !entry.exists() {
        return;
    }

    let existing = std::env::var_os("PATH").unwrap_or_default();
    let mut path_value = OsString::new();
    path_value.push(entry.as_os_str());
    if !existing.is_empty() {
        path_value.push(if cfg!(target_os = "windows") {
            ";"
        } else {
            ":"
        });
        path_value.push(existing);
    }

    command.env("PATH", path_value);
}

fn to_shell_friendly_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn snes_library_dir_windows(root: &Path) -> String {
    root.join("pvsneslib")
        .join("lib")
        .join("LoROM_SlowROM")
        .to_string_lossy()
        .replace('\\', "/")
}

fn platform_make_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "make.exe"
    } else {
        "make"
    }
}

fn find_in_path(candidates: &[&str]) -> Option<PathBuf> {
    let locator = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    for candidate in candidates {
        if let Ok(output) = Command::new(locator).arg(candidate).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(PathBuf::from)?;
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::diagnostics::{ActionableDiagnostic, DiagnosticArea, DiagnosticSeverity};
    use crate::tools::photo2sgdk::import_art_asset_internal;
    use image::{ImageBuffer, Rgba};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_serial_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_SERIAL: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_SERIAL
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn remove(key: &'static str) -> Self {
            let previous = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, previous }
        }

        fn set_path(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                std::env::set_var(self.key, previous);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    fn temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-build-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("failed to create temp dir");
        path
    }

    fn fixture_dir(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join(name)
    }

    fn copy_dir_all(src: &Path, dst: &Path) {
        fs::create_dir_all(dst).expect("create fixture dst");
        for entry in fs::read_dir(src).expect("read fixture dir") {
            let entry = entry.expect("read fixture entry");
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if src_path.is_dir() {
                if entry.file_name() == std::ffi::OsStr::new("build") {
                    continue;
                }
                copy_dir_all(&src_path, &dst_path);
            } else {
                fs::copy(&src_path, &dst_path).expect("copy fixture file");
            }
        }
    }

    fn workspace_copy(fixture_name: &str) -> PathBuf {
        let dst = temp_dir(fixture_name);
        copy_dir_all(&fixture_dir(fixture_name), &dst);
        dst
    }

    fn write_project_fixture(project_dir: &Path, project: &Project) {
        fs::write(
            project_dir.join("project.rds"),
            serde_json::to_string_pretty(project).expect("serialize fixture project"),
        )
        .expect("write fixture project");
    }

    fn fake_make_script(dir: &Path, extension: &str) -> PathBuf {
        let path = if cfg!(target_os = "windows") {
            dir.join("fake-make.cmd")
        } else {
            dir.join("fake-make.sh")
        };

        let content = if cfg!(target_os = "windows") {
            format!(
                "@echo off\r\n\
                 if not exist out mkdir out\r\n\
                 echo fake build for %CD%\r\n\
                 echo ROM> out\\artifact.{extension}\r\n\
                 exit /b 0\r\n"
            )
        } else {
            format!(
                "#!/bin/sh\n\
                 mkdir -p out\n\
                 echo \"fake build for $(pwd)\"\n\
                 printf 'ROM' > out/artifact.{extension}\n"
            )
        };

        fs::write(&path, content).expect("write fake make script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&path).expect("stat fake make").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&path, permissions).expect("chmod fake make");
        }
        path
    }

    fn fake_toolchain(root_name: &str, extension: &str) -> (PathBuf, PathBuf) {
        let root = temp_dir(root_name);
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).expect("create fake toolchain bin");
        let make_program = fake_make_script(&bin_dir, extension);
        (root, make_program)
    }

    #[test]
    fn build_environment_detects_sgdk_from_gdk_env_alias() {
        let _serial = test_serial_guard();
        let (sgdk_root, make_program) = fake_toolchain("sgdk-gdk-env-alias", "md");
        let detected_make = sgdk_root.join("bin").join(platform_make_name());
        fs::copy(&make_program, &detected_make).expect("copy fake make to canonical name");
        let _sgdk_root_env = EnvVarGuard::remove("SGDK_ROOT");
        let _gdk_win_env = EnvVarGuard::remove("GDK_WIN");
        let _gdk_env = EnvVarGuard::set_path("GDK", &sgdk_root);

        let env = BuildEnvironment::detect();

        assert_eq!(env.sgdk_root.as_deref(), Some(sgdk_root.as_path()));
        assert_eq!(env.sgdk_make_program.as_deref(), Some(detected_make.as_path()));

        let _ = fs::remove_dir_all(sgdk_root);
    }

    #[test]
    fn actionable_diagnostic_serializes_common_contract() {
        let diagnostic = ActionableDiagnostic {
            severity: DiagnosticSeverity::Error,
            area: DiagnosticArea::BuildSgdk,
            source_path: Some("F:/Games/Demo/src/main.c".to_string()),
            line: Some(42),
            column: Some(7),
            user_message: "Build falhou porque o compilador SGDK encontrou um erro em main.c:42.".to_string(),
            technical_detail: "src/main.c:42:7: error: expected ';' before '}' token".to_string(),
            suggested_action: "Abra F:/Games/Demo/src/main.c na linha 42 e corrija a sintaxe indicada pelo compilador.".to_string(),
            blocking: true,
            evidence_path: Some("F:/Games/Demo/build/megadrive".to_string()),
        };

        let value = serde_json::to_value(&diagnostic).expect("serialize diagnostic");

        assert_eq!(value["severity"], "error");
        assert_eq!(value["area"], "build_sgdk");
        assert_eq!(value["source_path"], "F:/Games/Demo/src/main.c");
        assert_eq!(value["line"], 42);
        assert_eq!(value["column"], 7);
        assert_eq!(value["blocking"], true);
        assert_eq!(value["evidence_path"], "F:/Games/Demo/build/megadrive");
    }

    #[test]
    fn missing_asset_build_returns_actionable_diagnostic() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_sprite_fixture(&project_dir);
        let missing_asset = project_dir
            .join("assets")
            .join("sprites")
            .join("onboarding_player.ppm");
        fs::remove_file(&missing_asset).expect("remove sprite fixture");

        let (sgdk_root, make_program) = fake_toolchain("sgdk-missing-asset", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(!result.ok);
        let diagnostic = result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.area == DiagnosticArea::BuildSgdk)
            .expect("build diagnostic");
        assert_eq!(diagnostic.severity, DiagnosticSeverity::Error);
        let missing_asset_label = missing_asset.to_string_lossy().replace('\\', "/");
        assert_eq!(
            diagnostic
                .source_path
                .as_deref()
                .map(|path| path.replace('\\', "/")),
            Some(missing_asset_label)
        );
        assert!(diagnostic.user_message.contains("Build falhou porque"));
        assert!(diagnostic.user_message.contains("asset"));
        assert!(diagnostic.suggested_action.contains("Restaure"));
        assert!(diagnostic.blocking);
        assert!(diagnostic.evidence_path.as_deref().is_some_and(|path| path
            .ends_with("build\\megadrive")
            || path.ends_with("build/megadrive")));

        let _ = fs::remove_dir_all(project_dir);
    }

    fn fake_bash_program() -> PathBuf {
        let root = temp_dir("fake-git-bash");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).expect("create fake bash bin");
        let path = if cfg!(target_os = "windows") {
            bin_dir.join("bash.cmd")
        } else {
            bin_dir.join("bash")
        };
        let content = if cfg!(target_os = "windows") {
            "@echo off\r\nexit /b 0\r\n"
        } else {
            "#!/bin/sh\nexit 0\n"
        };
        fs::write(&path, content).expect("write fake bash");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&path).expect("stat fake bash").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&path, permissions).expect("chmod fake bash");
        }
        path
    }

    fn fake_toolchain_with_sega_rom(root_name: &str, extension: &str) -> (PathBuf, PathBuf) {
        let root = temp_dir(root_name);
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).expect("create fake toolchain bin");
        let make_program = if cfg!(target_os = "windows") {
            let path = bin_dir.join("fake-make.cmd");
            fs::write(
                &path,
                format!(
                    "@echo off\r\n\
                     if not exist out mkdir out\r\n\
                     powershell -NoProfile -Command \"$bytes = New-Object byte[] 512; [System.Text.Encoding]::ASCII.GetBytes('SEGA MEGA DRIVE').CopyTo($bytes, 256); [IO.File]::WriteAllBytes('out\\artifact.{extension}', $bytes)\"\r\n\
                     exit /b 0\r\n"
                ),
            )
            .expect("write fake sega make script");
            path
        } else {
            let path = bin_dir.join("fake-make.sh");
            fs::write(
                &path,
                format!(
                    "#!/bin/sh\n\
                     mkdir -p out\n\
                     python3 - <<'PY'\n\
import pathlib\n\
rom = bytearray(512)\n\
rom[0x100:0x10F] = b'SEGA MEGA DRIVE'\n\
pathlib.Path('out/artifact.{extension}').write_bytes(rom)\n\
PY\n"
                ),
            )
            .expect("write fake sega make script");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = fs::metadata(&path).expect("stat fake make").permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(&path, permissions).expect("chmod fake make");
            }
            path
        };
        (root, make_program)
    }

    fn install_nocode_sgdk_game_fixture(project_dir: &Path) {
        let sprite_dir = project_dir.join("assets").join("sprites");
        let tilemap_dir = project_dir.join("assets").join("tilemaps");
        let audio_dir = project_dir.join("assets").join("audio");
        fs::create_dir_all(&sprite_dir).expect("create sprite dir");
        fs::create_dir_all(&tilemap_dir).expect("create tilemap dir");
        fs::create_dir_all(&audio_dir).expect("create audio dir");
        let source_sprite = fixture_dir("snes_dummy")
            .join("assets")
            .join("sprites")
            .join("hero.ppm");
        fs::copy(&source_sprite, sprite_dir.join("player.ppm")).expect("copy player sprite");
        fs::copy(&source_sprite, sprite_dir.join("enemy.ppm")).expect("copy enemy sprite");
        fs::copy(&source_sprite, tilemap_dir.join("stage.ppm")).expect("copy stage tilemap");
        fs::write(audio_dir.join("step.wav"), b"RIFFstep").expect("write step sfx");
        fs::write(audio_dir.join("fire.wav"), b"RIFFfire").expect("write fire sfx");

        let graph = serde_json::json!({
            "version": 1,
            "nodes": [
                { "id": "start", "type": "event_start", "label": "Start", "x": 0, "y": 0, "params": {} },
                { "id": "spawn_enemy", "type": "spawn_entity", "label": "Spawn", "x": 140, "y": 0, "params": { "prefab": "enemy", "x": 200, "y": 96 } },
                { "id": "paint_floor", "type": "set_tile", "label": "Set Tile", "x": 280, "y": 0, "params": { "layer": "BG_A", "tile": 12, "x": 3, "y": 14 } },
                { "id": "update", "type": "event_update", "label": "Update", "x": 0, "y": 160, "params": {} },
                { "id": "right", "type": "input_held", "label": "Right", "x": 140, "y": 160, "params": { "pad": "JOY_1", "button": "BUTTON_RIGHT" } },
                { "id": "velocity", "type": "set_velocity", "label": "Velocity", "x": 280, "y": 160, "params": { "target": "player", "vx": 2, "vy": 0 } },
                { "id": "position", "type": "set_position", "label": "Position", "x": 420, "y": 160, "params": { "target": "player", "x": 72, "y": 96 } },
                { "id": "run_anim", "type": "set_animation_state", "label": "Animation", "x": 560, "y": 160, "params": { "target": "player", "state": "run" } },
                { "id": "camera_follow", "type": "camera_follow", "label": "Camera", "x": 700, "y": 160, "params": { "target": "player", "damping": 0 } },
                { "id": "budget", "type": "hardware_budget_check", "label": "Budget", "x": 840, "y": 160, "params": { "vram_kb": 64, "sprites": 80, "scanline_sprites": 20 } },
                { "id": "step_sfx", "type": "action_sound", "label": "Step", "x": 980, "y": 160, "params": { "sfx": "step" } },
                { "id": "destroy_enemy", "type": "destroy_entity", "label": "Destroy", "x": 1120, "y": 160, "params": { "target": "enemy" } },
                { "id": "update_fire", "type": "event_update", "label": "Update Fire", "x": 0, "y": 320, "params": {} },
                { "id": "fire", "type": "input_pressed", "label": "Fire", "x": 140, "y": 320, "params": { "pad": "JOY_1", "button": "BUTTON_A" } },
                { "id": "fire_sfx", "type": "action_sound", "label": "Fire SFX", "x": 280, "y": 320, "params": { "sfx": "fire" } }
            ],
            "edges": [
                { "id": "s1", "fromNode": "start", "fromPort": "exec", "toNode": "spawn_enemy", "toPort": "exec" },
                { "id": "s2", "fromNode": "spawn_enemy", "fromPort": "exec", "toNode": "paint_floor", "toPort": "exec" },
                { "id": "u1", "fromNode": "update", "fromPort": "exec", "toNode": "right", "toPort": "exec" },
                { "id": "u2", "fromNode": "right", "fromPort": "true", "toNode": "velocity", "toPort": "exec" },
                { "id": "u3", "fromNode": "velocity", "fromPort": "exec", "toNode": "position", "toPort": "exec" },
                { "id": "u4", "fromNode": "position", "fromPort": "exec", "toNode": "run_anim", "toPort": "exec" },
                { "id": "u5", "fromNode": "run_anim", "fromPort": "exec", "toNode": "camera_follow", "toPort": "exec" },
                { "id": "u6", "fromNode": "camera_follow", "fromPort": "exec", "toNode": "budget", "toPort": "exec" },
                { "id": "u7", "fromNode": "budget", "fromPort": "ok", "toNode": "step_sfx", "toPort": "exec" },
                { "id": "u8", "fromNode": "step_sfx", "fromPort": "exec", "toNode": "destroy_enemy", "toPort": "exec" },
                { "id": "f1", "fromNode": "update_fire", "fromPort": "exec", "toNode": "fire", "toPort": "exec" },
                { "id": "f2", "fromNode": "fire", "fromPort": "true", "toNode": "fire_sfx", "toPort": "exec" }
            ]
        });
        let scene = serde_json::json!({
            "scene_id": "main",
            "schema_version": "1.6.0",
            "display_name": "No-Code SGDK Game",
            "background_layers": [],
            "entities": [
                {
                    "entity_id": "world",
                    "prefab": null,
                    "transform": { "x": 0, "y": 0 },
                    "components": {
                        "sprite": null,
                        "collision": null,
                        "input": null,
                        "physics": null,
                        "audio": null,
                        "logic": null,
                        "camera": null,
                        "tilemap": {
                            "tileset": "assets/tilemaps/stage.ppm",
                            "map_width": 64,
                            "map_height": 32,
                            "scroll_x": 0,
                            "scroll_y": 0
                        }
                    }
                },
                {
                    "entity_id": "player",
                    "prefab": null,
                    "transform": { "x": 40, "y": 96 },
                    "components": {
                        "sprite": {
                            "asset": "assets/sprites/player.ppm",
                            "frame_width": 16,
                            "frame_height": 16,
                            "pivot": null,
                            "palette_slot": 0,
                            "animations": {
                                "idle": { "frames": [0], "fps": 6, "loop": true },
                                "run": { "frames": [1, 2, 3], "fps": 12, "loop": true }
                            },
                            "priority": "foreground",
                            "meta_sprite": false
                        },
                        "collision": { "shape": "aabb", "width": 16, "height": 16, "offset": null, "solid": true, "layer": "player", "collides_with": ["enemy"] },
                        "input": { "device": "joypad_1", "mapping": {} },
                        "physics": null,
                        "audio": { "sfx": { "step": "assets/audio/step.wav", "fire": "assets/audio/fire.wav" }, "bgm": null },
                        "logic": { "graph": graph.to_string(), "variables": {} },
                        "camera": null,
                        "tilemap": null
                    }
                },
                {
                    "entity_id": "enemy",
                    "prefab": null,
                    "transform": { "x": 160, "y": 96 },
                    "components": {
                        "sprite": {
                            "asset": "assets/sprites/enemy.ppm",
                            "frame_width": 16,
                            "frame_height": 16,
                            "pivot": null,
                            "palette_slot": 1,
                            "animations": {
                                "idle": { "frames": [0], "fps": 6, "loop": true },
                                "run": { "frames": [1, 2, 3], "fps": 12, "loop": true }
                            },
                            "priority": "foreground",
                            "meta_sprite": false
                        },
                        "collision": { "shape": "aabb", "width": 16, "height": 16, "offset": null, "solid": true, "layer": "enemy", "collides_with": ["player"] },
                        "input": null,
                        "physics": null,
                        "audio": null,
                        "logic": null,
                        "camera": null,
                        "tilemap": null
                    }
                }
            ],
            "palettes": [],
            "retrofx": null,
            "collision_map": null,
            "layers": null
        });
        fs::write(
            project_dir.join("scenes").join("main.json"),
            serde_json::to_string_pretty(&scene).expect("serialize no-code scene"),
        )
        .expect("write no-code scene");
    }

    fn install_tilemap_fixture(project_dir: &Path) {
        let tilemap_asset = project_dir
            .join("assets")
            .join("tilesets")
            .join("level.ppm");
        fs::create_dir_all(
            tilemap_asset
                .parent()
                .expect("tilemap asset should have parent directory"),
        )
        .expect("create tilemap asset dir");
        fs::copy(
            fixture_dir("snes_dummy")
                .join("assets")
                .join("sprites")
                .join("hero.ppm"),
            &tilemap_asset,
        )
        .expect("copy tilemap fixture");

        let scene_json = r#"{
  "scene_id": "main",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {
      "entity_id": "background",
      "prefab": null,
      "transform": {
        "x": 16,
        "y": 24
      },
      "components": {
        "sprite": null,
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": {
          "tileset": "assets/tilesets/level.ppm",
          "map_width": 64,
          "map_height": 32,
          "scroll_x": 8,
          "scroll_y": 4
        }
      }
    }
  ],
  "palettes": []
}"#;
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write tilemap scene fixture");
    }

    fn install_megadrive_sprite_fixture(project_dir: &Path) {
        let sprite_asset = project_dir
            .join("assets")
            .join("sprites")
            .join("onboarding_player.ppm");
        fs::create_dir_all(
            sprite_asset
                .parent()
                .expect("sprite asset should have parent directory"),
        )
        .expect("create megadrive sprite asset dir");
        fs::copy(
            fixture_dir("snes_dummy")
                .join("assets")
                .join("sprites")
                .join("hero.ppm"),
            &sprite_asset,
        )
        .expect("copy megadrive sprite fixture");

        let scene_json = r#"{
  "scene_id": "main",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {
      "entity_id": "player",
      "prefab": null,
      "transform": {
        "x": 48,
        "y": 64
      },
      "components": {
        "sprite": {
          "asset": "assets/sprites/onboarding_player.ppm",
          "frame_width": 16,
          "frame_height": 16,
          "pivot": null,
          "palette_slot": 0,
          "animations": {},
          "priority": "foreground"
        },
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": null
      }
    }
  ],
  "palettes": []
}"#;
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write megadrive sprite scene fixture");
    }

    fn install_megadrive_vram_overflow_fixture(project_dir: &Path) {
        let sprite_asset = project_dir
            .join("assets")
            .join("sprites")
            .join("vram_stress.ppm");
        fs::create_dir_all(
            sprite_asset
                .parent()
                .expect("sprite asset should have parent directory"),
        )
        .expect("create megadrive vram stress sprite dir");
        fs::copy(
            fixture_dir("snes_dummy")
                .join("assets")
                .join("sprites")
                .join("hero.ppm"),
            &sprite_asset,
        )
        .expect("copy megadrive vram stress sprite");

        let frames_csv = (0..600)
            .map(|idx| idx.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        let scene_json = format!(
            r#"{{
  "scene_id": "main",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {{
      "entity_id": "vram_stress",
      "prefab": null,
      "transform": {{
        "x": 48,
        "y": 64
      }},
      "components": {{
        "sprite": {{
          "asset": "assets/sprites/vram_stress.ppm",
          "frame_width": 16,
          "frame_height": 16,
          "pivot": null,
          "palette_slot": 0,
          "animations": {{
            "idle": {{
              "frames": [{frames_csv}],
              "fps": 12,
              "loop": true
            }}
          }},
          "priority": "foreground",
          "meta_sprite": false
        }},
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": null
      }}
    }}
  ],
  "palettes": []
}}"#
        );
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write megadrive vram overflow scene fixture");
    }

    fn write_artstudio_source_png(path: &Path) {
        let image = ImageBuffer::from_fn(32, 16, |x, y| {
            if (2..14).contains(&x) && (2..14).contains(&y) {
                Rgba([255u8, 255, 255, 255])
            } else if (18..30).contains(&x) && (2..14).contains(&y) {
                Rgba([255u8, 0, 0, 255])
            } else {
                Rgba([0u8, 0, 0, 0])
            }
        });
        image
            .save(path)
            .expect("write synthetic ArtStudio source image");
    }

    fn install_artstudio_scene_fixture(
        project_dir: &Path,
        relative_asset_path: &str,
        frame_width: u32,
        frame_height: u32,
    ) {
        let scene_json = format!(
            r#"{{
  "scene_id": "main",
  "schema_version": "1.6.0",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {{
      "entity_id": "artstudio_hero",
      "display_name": "ArtStudio Hero",
      "prefab": null,
      "transform": {{
        "x": 48,
        "y": 64
      }},
      "components": {{
        "sprite": {{
          "asset": "{relative_asset_path}",
          "frame_width": {frame_width},
          "frame_height": {frame_height},
          "pivot": null,
          "palette_slot": 0,
          "animations": {{
            "idle": {{
              "frames": [0, 1],
              "fps": 15,
              "loop": true
            }}
          }},
          "priority": "foreground",
          "meta_sprite": false
        }},
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": null
      }}
    }}
  ],
  "palettes": [],
  "retrofx": null,
  "collision_map": null,
  "layers": null
}}"#
        );
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write ArtStudio scene fixture");
    }

    fn install_megadrive_audio_fixture(project_dir: &Path) {
        let audio_dir = project_dir.join("assets").join("audio");
        fs::create_dir_all(&audio_dir).expect("create megadrive audio dir");
        fs::write(audio_dir.join("jump.wav"), b"RIFFretro").expect("write jump wav");
        fs::write(audio_dir.join("stage_theme.xgm"), b"XGMretro").expect("write stage theme xgm");

        let scene_json = r#"{
  "scene_id": "main",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {
      "entity_id": "audio_driver",
      "prefab": null,
      "transform": {
        "x": 0,
        "y": 0
      },
      "components": {
        "sprite": null,
        "collision": null,
        "input": null,
        "physics": null,
        "audio": {
          "sfx": {
            "jump": "assets/audio/jump.wav"
          },
          "bgm": "assets/audio/stage_theme.xgm"
        },
        "logic": null,
        "camera": null,
        "tilemap": null
      }
    }
  ],
  "palettes": []
}"#;
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write megadrive audio scene fixture");
    }

    fn install_snes_audio_fixture(project_dir: &Path) {
        let audio_dir = project_dir.join("assets").join("audio");
        fs::create_dir_all(&audio_dir).expect("create snes audio dir");
        fs::write(audio_dir.join("jump.brr"), b"BRRretro").expect("write jump brr");
        fs::write(audio_dir.join("stage_theme.spc"), b"SPCretro").expect("write stage theme spc");

        let scene_json = r#"{
  "scene_id": "main",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {
      "entity_id": "audio_driver",
      "prefab": null,
      "transform": {
        "x": 0,
        "y": 0
      },
      "components": {
        "sprite": null,
        "collision": null,
        "input": null,
        "physics": null,
        "audio": {
          "sfx": {
            "jump": "assets/audio/jump.brr"
          },
          "bgm": "assets/audio/stage_theme.spc"
        },
        "logic": null,
        "camera": null,
        "tilemap": null
      }
    }
  ],
  "palettes": []
}"#;
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write snes audio scene fixture");
    }

    #[test]
    fn sanitize_build_output_dir_rejects_paths_outside_project_root() {
        let _serial = test_serial_guard();
        assert!(sanitize_build_output_dir("../outside").is_err());
        assert!(sanitize_build_output_dir("./build/output").is_ok());

        if cfg!(target_os = "windows") {
            assert!(sanitize_build_output_dir(r"C:\outside").is_err());
        } else {
            assert!(sanitize_build_output_dir("/outside").is_err());
        }
    }

    #[test]
    fn build_fails_when_toolchain_is_missing() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        let environment = BuildEnvironment {
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };
        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(!result.ok);
        assert!(result.rom_path.is_empty());
        assert!(result
            .log
            .iter()
            .any(|entry| entry.message.contains("Toolchain SGDK nao encontrada")));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_rejects_output_dir_that_escapes_project_without_touching_sibling_dir() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_sprite_fixture(&project_dir);

        let sibling_name = format!(
            "retro-dev-studio-build-sibling-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before unix epoch")
                .as_nanos()
        );
        let sibling_dir = project_dir
            .parent()
            .expect("workspace should have parent dir")
            .join(&sibling_name);
        fs::create_dir_all(&sibling_dir).expect("create sibling dir");
        let sibling_marker = sibling_dir.join("marker.txt");
        fs::write(&sibling_marker, "keep").expect("write sibling marker");

        let mut project = load_project(&project_dir).expect("load project fixture");
        project
            .build
            .as_mut()
            .expect("fixture should contain build config")
            .output_dir = format!("../{}", sibling_name);
        write_project_fixture(&project_dir, &project);

        let (sgdk_root, make_program) = fake_toolchain("sgdk-output-dir-escape", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(!result.ok);
        assert!(result
            .log
            .iter()
            .any(|entry| entry.message.contains("Build.output_dir '../")
                && entry
                    .message
                    .contains("nao pode escapar da raiz do projeto")));
        assert!(sibling_dir.exists());
        assert_eq!(
            fs::read_to_string(&sibling_marker).expect("read sibling marker"),
            "keep"
        );

        let _ = fs::remove_dir_all(project_dir);
        let _ = fs::remove_dir_all(sibling_dir);
    }

    #[test]
    fn build_generates_megadrive_rom_artifact_with_fake_toolchain() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_sprite_fixture(&project_dir);
        let (sgdk_root, make_program) = fake_toolchain("sgdk", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        assert!(result.rom_path.ends_with(".md"));
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("src")
            .join("main.c")
            .exists());
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("resources.res")
            .exists());
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("assets")
            .join("sprites")
            .join("onboarding_player.bmp")
            .exists());
        let resources_res = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("res")
                .join("resources.res"),
        )
        .expect("read SGDK resources");
        assert!(resources_res
            .contains("SPRITE player \"assets/sprites/onboarding_player.bmp\" 2 2 NONE 4"));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_fake_rom_from_nocode_sgdk_game_nodes_as_unit_fallback() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_nocode_sgdk_game_fixture(&project_dir);
        let (sgdk_root, make_program) = fake_toolchain_with_sega_rom("sgdk-nocode-game", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let first = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(first.ok, "build log: {:?}", first.log);
        assert!(first.rom_path.ends_with(".md"));
        let main_c_path = project_dir
            .join("build")
            .join("megadrive")
            .join("src")
            .join("main.c");
        let resources_res_path = project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("resources.res");
        let main_c = fs::read_to_string(&main_c_path).expect("read no-code SGDK main.c");
        let resources_res =
            fs::read_to_string(&resources_res_path).expect("read no-code SGDK resources.res");
        let rom = fs::read(project_dir.join(&first.rom_path)).expect("read no-code SGDK ROM");

        assert!(main_c.contains("if ((JOY_readJoypad(JOY_1) & BUTTON_RIGHT)) {"));
        assert!(main_c.contains("logic_var_player_vx = 2;"));
        assert!(main_c.contains("SPR_setPosition(spr_player, spr_player_x, spr_player_y);"));
        assert!(main_c.contains("SPR_setAnim(spr_player, 1);"));
        assert!(main_c.contains("VDP_setHorizontalScroll(BG_A, spr_player_x - 160);"));
        assert!(main_c.contains(
            "VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, 12), 3, 14);"
        ));
        assert!(
            main_c.contains("// Hardware budget check: VRAM 64KB, sprites 80, sprites/scanline 20")
        );
        assert!(main_c.contains("SPR_setVisibility(spr_enemy, VISIBLE);"));
        assert!(main_c.contains("SPR_setVisibility(spr_enemy, HIDDEN);"));
        assert!(resources_res.contains("SPRITE player \"assets/sprites/player.bmp\" 2 2 NONE"));
        assert!(resources_res.contains("SPRITE enemy \"assets/sprites/enemy.bmp\" 2 2 NONE"));
        assert!(resources_res.contains("IMAGE world_tilemap \"assets/tilemaps/stage.bmp\" NONE"));
        assert!(resources_res.contains("WAV step \"assets/audio/step.wav\" XGM"));
        assert!(resources_res.contains("WAV fire \"assets/audio/fire.wav\" XGM"));
        assert!(
            rom.windows(4).any(|window| window == b"SEGA"),
            "ROM deve conter assinatura SEGA para smoke de emulacao/build"
        );

        let second = run_build_with_environment(&project_dir, &environment, |_| {});
        assert!(second.ok, "second build log: {:?}", second.log);
        let second_main_c =
            fs::read_to_string(&main_c_path).expect("read regenerated no-code SGDK main.c");
        assert_eq!(
            main_c, second_main_c,
            "SGDK C gerado deve ser deterministico"
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn megadrive_build_forces_windows_os_env_for_sgdk_make() {
        if !cfg!(target_os = "windows") {
            return;
        }

        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_sprite_fixture(&project_dir);

        let root = temp_dir("sgdk-windows-os-env");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).expect("create fake toolchain bin");
        let make_program = bin_dir.join("capture-os.cmd");
        fs::write(
            &make_program,
            "@echo off\r\n\
             if not exist out mkdir out\r\n\
             echo %OS%> out\\os-env.txt\r\n\
             echo ROM> out\\artifact.md\r\n\
             exit /b 0\r\n",
        )
        .expect("write os capture make");

        let environment = BuildEnvironment {
            sgdk_root: Some(root.clone()),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        let recorded = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("out")
                .join("os-env.txt"),
        )
        .expect("read recorded os env");
        assert_eq!(recorded.trim(), "Windows_NT");

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn sgdk_managed_vram_overflow_warns_but_native_still_aborts() {
        let _serial = test_serial_guard();
        let native_dir = workspace_copy("megadrive_dummy");
        let imported_dir = workspace_copy("megadrive_dummy");
        install_megadrive_vram_overflow_fixture(&native_dir);
        install_megadrive_vram_overflow_fixture(&imported_dir);

        let mut imported_project = load_project(&imported_dir).expect("load imported project");
        imported_project.template_metadata = Some(crate::ugdm::entities::TemplateMetadata {
            template_id: "sgdk_import".to_string(),
            template_version: "1.0.0".to_string(),
            source_kind: "imported_sgdk".to_string(),
            source_path: r"F:\Projects\MegaDrive_DEV\SGDK_Engines\NEXZR MD [VER.001] [SGDK 211] [GEN] [GAME] [SHMUP]".to_string(),
            source_engine: Some("sgdk".to_string()),
            import_profile: Some("sgdk".to_string()),
            imported_at_ms: 0,
        });
        write_project_fixture(&imported_dir, &imported_project);

        let (sgdk_root, make_program) = fake_toolchain("sgdk-vram-source-kind", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root.clone()),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let native_result = run_build_with_environment(&native_dir, &environment, |_| {});
        assert!(
            !native_result.ok,
            "native deve abortar; log: {:?}",
            native_result.log
        );
        assert!(native_result
            .log
            .iter()
            .any(|entry| { entry.level == "error" && entry.message.contains("VRAM Overflow") }));
        assert!(native_result.log.iter().any(|entry| {
            entry.level == "error"
                && entry
                    .message
                    .contains("Build abortado: erros de hardware constraints")
        }));

        let imported_result = run_build_with_environment(&imported_dir, &environment, |_| {});
        assert!(
            imported_result.ok,
            "imported_sgdk nao deve abortar apenas por VRAM; log: {:?}",
            imported_result.log
        );
        assert!(imported_result.log.iter().any(|entry| {
            entry.level == "warn"
                && entry.message.contains("Asset total acima da VRAM")
                && entry.message.contains("[SGDK Gerenciado]")
        }));
        assert!(imported_result.log.iter().any(|entry| {
            entry.level == "info"
                && entry
                    .message
                    .contains("MD VRAM analysis: mode=sgdk_managed")
                && entry.message.contains("spr_res=")
                && entry.message.contains("strm_spr=")
                && entry.message.contains("anim_sw=")
        }));
        assert!(
            !imported_result.log.iter().any(|entry| {
                entry.level == "error"
                    && entry
                        .message
                        .contains("Build abortado: erros de hardware constraints")
            }),
            "imported_sgdk nao deve abortar por overflow de VRAM; log: {:?}",
            imported_result.log
        );

        let _ = fs::remove_dir_all(native_dir);
        let _ = fs::remove_dir_all(imported_dir);
        let _ = fs::remove_dir_all(sgdk_root);
    }

    /// Quando `SGDK_ROOT`/`GDK` ou `toolchains/sgdk` apontam para uma instalação real com `makefile.gen`
    /// e `make` funcional, prova build canónico sem fake-make. Em hosts sem toolchain, retorna cedo.
    #[test]
    fn megadrive_build_runs_with_detected_sgdk_toolchain_when_present() {
        let _serial = test_serial_guard();
        let env = BuildEnvironment::detect();
        let Some(root) = env.sgdk_root.as_ref() else {
            return;
        };
        if !root.join("makefile.gen").is_file() {
            return;
        }
        if env.sgdk_make_program.is_none() {
            return;
        }

        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_sprite_fixture(&project_dir);

        let result = run_build_with_environment(&project_dir, &env, |_| {});

        assert!(
            result.ok,
            "build com SGDK real deve concluir quando toolchain completa; log: {:?}",
            result.log
        );
        assert!(!result.rom_path.is_empty());
        let rom_full = project_dir.join(&result.rom_path);
        assert!(rom_full.is_file(), "rom em {}", rom_full.display());
        let rom_bytes = fs::read(&rom_full).expect("read rom bytes");
        assert!(
            rom_bytes.windows(4).any(|w| w == b"SEGA"),
            "ROM Mega Drive deve conter marca SEGA (cabecalho MD ou bootstrap); len={} primeiros 64B={:02x?}",
            rom_bytes.len(),
            &rom_bytes[..rom_bytes.len().min(64)]
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_megadrive_workspace_for_artstudio_imported_asset() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        let source_image = temp_dir("artstudio-source").join("artstudio_hero.png");
        write_artstudio_source_png(&source_image);

        let import_result = import_art_asset_internal(
            source_image.to_string_lossy().into_owned(),
            project_dir.to_string_lossy().into_owned(),
            Some("artstudio_hero".to_string()),
            Some(16),
            Some(16),
            Some("grid".to_string()),
        )
        .expect("import ArtStudio asset into canonical project tree");

        assert!(import_result.ok);
        assert_eq!(
            import_result.relative_path.as_deref(),
            Some("assets/sprites/artstudio_hero.png")
        );
        assert_eq!(import_result.frame_width, Some(16));
        assert_eq!(import_result.frame_height, Some(16));
        assert_eq!(import_result.frame_count, 2);

        install_artstudio_scene_fixture(
            &project_dir,
            import_result
                .relative_path
                .as_deref()
                .expect("relative asset path should be present"),
            import_result.frame_width.expect("imported frame width"),
            import_result.frame_height.expect("imported frame height"),
        );

        let (sgdk_root, make_program) = fake_toolchain("sgdk-artstudio", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        assert!(result.rom_path.ends_with(".md"));
        let resources_res = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("res")
                .join("resources.res"),
        )
        .expect("read SGDK resources");
        assert!(resources_res
            .contains("SPRITE artstudio_hero \"assets/sprites/artstudio_hero.bmp\" 2 2 NONE 4"));
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("assets")
            .join("sprites")
            .join("artstudio_hero.bmp")
            .exists());
        assert!(result
            .log
            .iter()
            .any(|entry| entry.message.contains("Workspace de build preparado")));
        assert!(result
            .log
            .iter()
            .any(|entry| entry.message.contains("ROM gerada")));

        let _ = fs::remove_file(source_image);
        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    #[ignore = "manual proof with official SGDK toolchain"]
    fn artstudio_imported_asset_builds_with_detected_sgdk() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        let source_image = temp_dir("artstudio-live-source").join("artstudio_live.png");
        write_artstudio_source_png(&source_image);

        let import_result = import_art_asset_internal(
            source_image.to_string_lossy().into_owned(),
            project_dir.to_string_lossy().into_owned(),
            Some("artstudio_live".to_string()),
            Some(16),
            Some(16),
            Some("grid".to_string()),
        )
        .expect("import ArtStudio asset with live SGDK");

        install_artstudio_scene_fixture(
            &project_dir,
            import_result
                .relative_path
                .as_deref()
                .expect("relative asset path should exist"),
            import_result.frame_width.expect("frame width"),
            import_result.frame_height.expect("frame height"),
        );

        let environment = BuildEnvironment::detect();
        let result = run_build_with_environment(&project_dir, &environment, |line| {
            println!("[build:{}] {}", line.level, line.message);
        });

        assert!(result.ok, "live build log: {:?}", result.log);
        let resources_res = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("res")
                .join("resources.res"),
        )
        .expect("read live SGDK resources");
        println!("[resources.res]\n{}", resources_res);
        assert!(resources_res
            .contains("SPRITE artstudio_hero \"assets/sprites/artstudio_live.bmp\" 2 2 NONE 4"));

        let _ = fs::remove_file(source_image);
        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_snes_workspace_with_real_asset_staging() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("snes_dummy");
        let (pvsneslib_root, make_program) = fake_toolchain("pvsneslib", "sfc");
        fs::create_dir_all(pvsneslib_root.join("devkitsnes")).expect("create fake devkitsnes");
        fs::write(
            pvsneslib_root.join("devkitsnes").join("snes_rules"),
            "dummy rules",
        )
        .expect("write fake snes_rules");
        let environment = BuildEnvironment {
            pvsneslib_root: Some(pvsneslib_root),
            pvsneslib_make_program: Some(make_program),
            pvsneslib_bash_program: Some(fake_bash_program()),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        assert!(result.rom_path.ends_with(".sfc"));
        assert!(project_dir
            .join("build")
            .join("snes")
            .join("Makefile")
            .exists());
        let hdr_path = project_dir.join("build").join("snes").join("hdr.asm");
        let data_path = project_dir.join("build").join("snes").join("data.asm");
        let bmp_path = project_dir
            .join("build")
            .join("snes")
            .join("src")
            .join("controller_root.bmp");
        assert!(bmp_path.exists());
        assert!(hdr_path.exists());
        assert!(data_path.exists());
        assert!(!project_dir
            .join("build")
            .join("snes")
            .join("src")
            .join("data.asm")
            .exists());
        assert!(!project_dir
            .join("build")
            .join("snes")
            .join("src")
            .join("hdr.asm")
            .exists());
        let bmp_bytes = fs::read(&bmp_path).expect("read staged bmp");
        assert_eq!(&bmp_bytes[0..2], b"BM");
        assert_eq!(u16::from_le_bytes([bmp_bytes[28], bmp_bytes[29]]), 8);
        let data_asm = fs::read_to_string(&data_path).expect("read snes data asm");
        assert!(data_asm.contains(".include \"hdr.asm\""));
        assert!(data_asm.contains(".include \"src/controller_root_data.as\""));
        let makefile = fs::read_to_string(project_dir.join("build").join("snes").join("Makefile"))
            .expect("read SNES makefile");
        assert!(makefile.contains(
            "bitmaps: src/controller_root.pic src/controller_root.pal src/controller_root_data.as"
        ));
        assert!(makefile.contains("src/controller_root.pic src/controller_root.pal src/controller_root_data.as: src/controller_root.bmp"));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn snes_windows_build_requires_git_bash_or_msys2() {
        if !cfg!(target_os = "windows") {
            return;
        }

        let _serial = test_serial_guard();
        let project_dir = workspace_copy("snes_dummy");
        let (pvsneslib_root, make_program) = fake_toolchain("pvsneslib-no-bash", "sfc");
        fs::create_dir_all(pvsneslib_root.join("devkitsnes")).expect("create fake devkitsnes");
        fs::write(
            pvsneslib_root.join("devkitsnes").join("snes_rules"),
            "dummy rules",
        )
        .expect("write fake snes_rules");
        let environment = BuildEnvironment {
            pvsneslib_root: Some(pvsneslib_root),
            pvsneslib_make_program: Some(make_program),
            pvsneslib_bash_program: None,
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(
            !result.ok,
            "SNES build must not continue without Git Bash/MSYS2"
        );
        assert!(
            result.log.iter().any(|line| line.level == "error"
                && line.message.contains("Git Bash/MSYS2")
                && line.message.contains("SNES")),
            "expected actionable Git Bash/MSYS2 error, got {:?}",
            result.log
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_megadrive_workspace_with_tilemap_assets() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_tilemap_fixture(&project_dir);
        let (sgdk_root, make_program) = fake_toolchain("sgdk-tilemap", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        let staged_tilemap = project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("assets")
            .join("tilesets")
            .join("level.bmp");
        assert!(staged_tilemap.exists());
        let resources_res = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("res")
                .join("resources.res"),
        )
        .expect("read SGDK resources");
        assert!(
            resources_res.contains("IMAGE background_tilemap \"assets/tilesets/level.bmp\" NONE")
        );
        let main_c = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("src")
                .join("main.c"),
        )
        .expect("read SGDK main.c");
        assert!(main_c.contains("VDP_drawImageEx(BG_B, &background_tilemap"));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_snes_workspace_with_tilemap_data_files() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("snes_dummy");
        install_tilemap_fixture(&project_dir);
        let (pvsneslib_root, make_program) = fake_toolchain("pvsneslib-tilemap", "sfc");
        fs::create_dir_all(pvsneslib_root.join("devkitsnes")).expect("create fake devkitsnes");
        fs::write(
            pvsneslib_root.join("devkitsnes").join("snes_rules"),
            "dummy rules",
        )
        .expect("write fake snes_rules");
        let environment = BuildEnvironment {
            pvsneslib_root: Some(pvsneslib_root),
            pvsneslib_make_program: Some(make_program),
            pvsneslib_bash_program: Some(fake_bash_program()),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        let staged_bmp = project_dir
            .join("build")
            .join("snes")
            .join("src")
            .join("background_tilemap.bmp");
        assert!(staged_bmp.exists());
        let data_asm = fs::read_to_string(project_dir.join("build").join("snes").join("data.asm"))
            .expect("read SNES data asm");
        assert!(data_asm.contains("background_tilemap_map:"));
        assert!(data_asm.contains(".incbin \"src/background_tilemap.map\""));
        let makefile = fs::read_to_string(project_dir.join("build").join("snes").join("Makefile"))
            .expect("read SNES makefile");
        assert!(makefile.contains("$(GFXCONV) -s 8 -o 16 -u 16 -e 0 -p -m -t bmp -i $<"));
        let bitmaps_line = makefile
            .lines()
            .find(|line| line.starts_with("bitmaps:"))
            .expect("SNES Makefile must expose a bitmaps target");
        for expected in [
            "src/background_tilemap.pic",
            "src/background_tilemap.map",
            "src/background_tilemap.pal",
        ] {
            assert!(
                bitmaps_line.contains(expected),
                "SNES bitmaps target missing {expected}: {bitmaps_line}"
            );
        }
        assert!(makefile.contains("src/background_tilemap.pic src/background_tilemap.map src/background_tilemap.pal: src/background_tilemap.bmp"));
        let main_c = fs::read_to_string(
            project_dir
                .join("build")
                .join("snes")
                .join("src")
                .join("main.c"),
        )
        .expect("read SNES main.c");
        assert!(main_c.contains("bgInitMapSet(0, (u8*)&background_tilemap_map"));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_megadrive_workspace_with_audio_assets() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_audio_fixture(&project_dir);
        let (sgdk_root, make_program) = fake_toolchain("sgdk-audio", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("assets")
            .join("audio")
            .join("jump.wav")
            .exists());
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("assets")
            .join("audio")
            .join("stage_theme.xgm")
            .exists());
        let resources_res = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("res")
                .join("resources.res"),
        )
        .expect("read SGDK audio resources");
        assert!(resources_res.contains("WAV jump \"assets/audio/jump.wav\" XGM"));
        assert!(resources_res.contains("XGM stage_theme \"assets/audio/stage_theme.xgm\""));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn build_generates_snes_workspace_with_audio_data_files() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("snes_dummy");
        install_snes_audio_fixture(&project_dir);
        let (pvsneslib_root, make_program) = fake_toolchain("pvsneslib-audio", "sfc");
        fs::create_dir_all(pvsneslib_root.join("devkitsnes")).expect("create fake devkitsnes");
        fs::write(
            pvsneslib_root.join("devkitsnes").join("snes_rules"),
            "dummy rules",
        )
        .expect("write fake snes_rules");
        let environment = BuildEnvironment {
            pvsneslib_root: Some(pvsneslib_root),
            pvsneslib_make_program: Some(make_program),
            pvsneslib_bash_program: Some(fake_bash_program()),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        assert!(project_dir
            .join("build")
            .join("snes")
            .join("src")
            .join("jump_sfx.brr")
            .exists());
        assert!(project_dir
            .join("build")
            .join("snes")
            .join("src")
            .join("stage_theme_bgm.spc")
            .exists());
        let data_asm = fs::read_to_string(project_dir.join("build").join("snes").join("data.asm"))
            .expect("read SNES audio data asm");
        assert!(data_asm.contains("jump_sfx:"));
        assert!(data_asm.contains(".incbin \"src/jump_sfx.brr\""));
        assert!(data_asm.contains("stage_theme_bgm:"));
        assert!(data_asm.contains(".incbin \"src/stage_theme_bgm.spc\""));
        let main_c = fs::read_to_string(
            project_dir
                .join("build")
                .join("snes")
                .join("src")
                .join("main.c"),
        )
        .expect("read SNES audio main.c");
        assert!(main_c.contains(
            "spcSetSoundEntry(15, 8, 6, (&jump_sfxend - &jump_sfx), (u8*)&jump_sfx, &jump_sfx_sample);"
        ));
        assert!(main_c.contains("spcLoad((u8*)&stage_theme_bgm);"));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn multi_target_build_generates_reports_for_megadrive_and_snes() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        let (sgdk_root, sgdk_make_program) = fake_toolchain("sgdk-multi", "md");
        let (pvsneslib_root, pvsneslib_make_program) = fake_toolchain("pvsneslib-multi", "sfc");
        fs::create_dir_all(pvsneslib_root.join("devkitsnes")).expect("create fake devkitsnes");
        fs::write(
            pvsneslib_root.join("devkitsnes").join("snes_rules"),
            "dummy rules",
        )
        .expect("write fake snes_rules");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(sgdk_make_program),
            pvsneslib_root: Some(pvsneslib_root),
            pvsneslib_make_program: Some(pvsneslib_make_program),
            pvsneslib_bash_program: Some(fake_bash_program()),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_multi_target_with_environment(
            &project_dir,
            &["megadrive".to_string(), "snes".to_string()],
            &environment,
            |_| {},
        );

        assert!(result.ok, "multi-target result: {:?}", result.results);
        assert_eq!(result.results.len(), 2);
        assert_eq!(result.results[0].target, "megadrive");
        assert!(
            result.results[0].ok,
            "megadrive log: {:?}",
            result.results[0].log
        );
        assert!(result.results[0].rom_path.ends_with(".md"));
        assert!(result.results[0].rom_size_bytes > 0);
        assert_eq!(result.results[1].target, "snes");
        assert!(
            result.results[1].ok,
            "snes log: {:?}",
            result.results[1].log
        );
        assert!(result.results[1].rom_path.ends_with(".sfc"));
        assert!(result.results[1].rom_size_bytes > 0);

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn multi_target_build_reports_partial_failure_when_one_toolchain_is_missing() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        let (sgdk_root, sgdk_make_program) = fake_toolchain("sgdk-multi-partial", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(sgdk_make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_multi_target_with_environment(
            &project_dir,
            &["megadrive".to_string(), "snes".to_string()],
            &environment,
            |_| {},
        );

        assert!(!result.ok);
        assert_eq!(result.results.len(), 2);
        assert!(result.results[0].ok);
        assert!(!result.results[1].ok);
        assert!(result.results[1]
            .errors
            .iter()
            .any(|error| error.contains("Toolchain PVSnesLib nao encontrada")));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn legacy_sgdk_overlay_build_delegates_to_host_workspace() {
        let _serial = test_serial_guard();
        let host_dir = temp_dir("legacy-host-build");
        fs::create_dir_all(host_dir.join("src")).expect("create legacy src");
        fs::create_dir_all(host_dir.join("inc")).expect("create legacy inc");
        fs::write(
            host_dir.join("src").join("main.c"),
            b"int main(void){return 0;}",
        )
        .expect("write legacy main.c");
        fs::write(host_dir.join("inc").join("game.h"), b"void game(void);")
            .expect("write legacy header");
        fs::write(host_dir.join("Makefile"), "PROJECT_NAME := legacy_host\n")
            .expect("write legacy makefile");

        let overlay_dir = crate::core::project_mgr::import_legacy_sgdk_project(
            &host_dir,
            Some("Legacy Host Wrapper"),
        )
        .expect("wrap legacy sgdk host");
        println!(
            "[legacy-build-delegate] host='{}' overlay='{}'",
            host_dir.display(),
            overlay_dir.display()
        );

        let (sgdk_root, sgdk_make_program) = fake_toolchain("sgdk-legacy-host", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(sgdk_make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&overlay_dir, &environment, |_| {});

        assert!(result.ok, "legacy build log: {:?}", result.log);
        assert!(host_dir.join("out").join("artifact.md").is_file());
        assert!(PathBuf::from(&result.rom_path).starts_with(host_dir.join("out")));
        assert!(!overlay_dir.join("build").join("megadrive").exists());
        assert!(result
            .log
            .iter()
            .any(|line| line.message.contains("Delegando build para host")));

        let _ = fs::remove_dir_all(host_dir);
    }

    #[test]
    fn legacy_sgdk_overlay_multi_target_marks_snes_as_unsupported() {
        let _serial = test_serial_guard();
        let host_dir = temp_dir("legacy-host-multi-target");
        fs::create_dir_all(host_dir.join("src")).expect("create legacy src");
        fs::create_dir_all(host_dir.join("inc")).expect("create legacy inc");
        fs::write(
            host_dir.join("src").join("main.c"),
            b"int main(void){return 0;}",
        )
        .expect("write legacy main.c");
        fs::write(host_dir.join("inc").join("game.h"), b"void game(void);")
            .expect("write legacy header");
        fs::write(host_dir.join("Makefile"), "PROJECT_NAME := legacy_host\n")
            .expect("write legacy makefile");

        let overlay_dir = crate::core::project_mgr::import_legacy_sgdk_project(
            &host_dir,
            Some("Legacy Host Multi"),
        )
        .expect("wrap legacy sgdk host");
        let (sgdk_root, sgdk_make_program) = fake_toolchain("sgdk-legacy-host-multi", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(sgdk_make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_multi_target_with_environment(
            &overlay_dir,
            &["megadrive".to_string(), "snes".to_string()],
            &environment,
            |_| {},
        );

        assert!(!result.ok);
        assert_eq!(result.results.len(), 2);
        assert!(
            result.results[0].ok,
            "legacy megadrive log: {:?}",
            result.results[0].log
        );
        assert!(!result.results[1].ok);
        assert!(result.results[1]
            .errors
            .iter()
            .any(|error| error.contains("apenas build Mega Drive")));

        let _ = fs::remove_dir_all(host_dir);
    }

    #[test]
    fn shell_friendly_path_conversion_matches_windows_layout() {
        let _serial = test_serial_guard();
        if cfg!(target_os = "windows") {
            assert_eq!(
                to_shell_friendly_path(Path::new(r"C:\Retro\toolchains\pvsneslib")),
                "C:/Retro/toolchains/pvsneslib"
            );
            assert_eq!(
                snes_library_dir_windows(Path::new(r"C:\Retro\toolchains\pvsneslib")),
                "C:/Retro/toolchains/pvsneslib/pvsneslib/lib/LoROM_SlowROM"
            );
        }
    }

    // ── Step 1: ArtStudio multi-frame animation → runtime proof ─────────────

    #[test]
    fn artstudio_multiframe_animation_reaches_resources_res_and_main_c() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        let source_image = temp_dir("artstudio-multiframe").join("hero_anim.png");
        // 64x16 PNG → 4 frames of 16x16
        let image = ImageBuffer::from_fn(64, 16, |x, _y| {
            let frame = x / 16;
            match frame {
                0 => Rgba([255u8, 0, 0, 255]),
                1 => Rgba([0u8, 255, 0, 255]),
                2 => Rgba([0u8, 0, 255, 255]),
                _ => Rgba([255u8, 255, 0, 255]),
            }
        });
        image.save(&source_image).expect("write multiframe source");

        let import_result = import_art_asset_internal(
            source_image.to_string_lossy().into_owned(),
            project_dir.to_string_lossy().into_owned(),
            Some("hero_anim".to_string()),
            Some(16),
            Some(16),
            Some("grid".to_string()),
        )
        .expect("import multiframe asset");
        assert!(import_result.ok);
        assert_eq!(import_result.frame_count, 4);

        // Scene with two named animations referencing the 4 frames
        let scene_json = format!(
            r#"{{
  "scene_id": "main",
  "schema_version": "1.6.0",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {{
      "entity_id": "hero_anim",
      "display_name": "Hero Animated",
      "prefab": null,
      "transform": {{ "x": 48, "y": 64 }},
      "components": {{
        "sprite": {{
          "asset": "{}",
          "frame_width": 16,
          "frame_height": 16,
          "pivot": null,
          "palette_slot": 0,
          "animations": {{
            "idle": {{ "frames": [0, 1], "fps": 8, "loop": true }},
            "run": {{ "frames": [2, 3], "fps": 15, "loop": true }}
          }},
          "priority": "foreground",
          "meta_sprite": false
        }},
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": null
      }}
    }}
  ],
  "palettes": [],
  "retrofx": null,
  "collision_map": null,
  "layers": null
}}"#,
            import_result
                .relative_path
                .as_deref()
                .expect("relative path")
        );
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write multiframe scene");

        let (sgdk_root, make_program) = fake_toolchain("sgdk-multiframe", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});
        assert!(result.ok, "multiframe build log: {:?}", result.log);

        // Verify resources.res contains the SPRITE with correct tile dimensions
        let resources_res = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("res")
                .join("resources.res"),
        )
        .expect("read resources.res");
        assert!(
            resources_res.contains("SPRITE hero_anim \"assets/sprites/hero_anim.bmp\""),
            "resources.res should reference the ArtStudio sprite: {}",
            resources_res
        );

        // Verify main.c contains animation setup (SPR_setAnim)
        let main_c = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("src")
                .join("main.c"),
        )
        .expect("read main.c");
        assert!(
            main_c.contains("SPR_setAnim("),
            "main.c should set initial animation: {}",
            main_c
        );
        // Verify the sprite is spawned
        assert!(
            main_c.contains("SPR_addSprite("),
            "main.c should spawn the sprite: {}",
            main_c
        );

        let _ = fs::remove_file(source_image);
        let _ = fs::remove_dir_all(project_dir);
    }

    // ── Step 2: RetroFX scene config → parallax/raster in main.c ────────────

    #[test]
    fn retrofx_scene_config_generates_parallax_and_raster_in_main_c() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("megadrive_dummy");
        install_megadrive_sprite_fixture(&project_dir);

        // Overwrite scene with RetroFX parallax + raster config
        let scene_json = r#"{
  "scene_id": "main",
  "schema_version": "1.6.0",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {
      "entity_id": "player",
      "prefab": null,
      "transform": { "x": 48, "y": 64 },
      "components": {
        "sprite": {
          "asset": "assets/sprites/onboarding_player.ppm",
          "frame_width": 16,
          "frame_height": 16,
          "pivot": null,
          "palette_slot": 0,
          "animations": {},
          "priority": "foreground"
        },
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": null
      }
    }
  ],
  "palettes": [],
  "retrofx": {
    "parallax_layers": [
      {
        "id": "layer_far",
        "name": "BG_B",
        "speed_x": 1,
        "speed_y": 0,
        "enabled": true
      },
      {
        "id": "layer_near",
        "name": "BG_A",
        "speed_x": 3,
        "speed_y": 0,
        "enabled": true
      }
    ],
    "raster_lines": [
      {
        "id": "raster_1",
        "scanline": 100,
        "offset_x": 4,
        "enabled": true
      }
    ]
  },
  "collision_map": null,
  "layers": null
}"#;
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write retrofx scene");

        let (sgdk_root, make_program) = fake_toolchain("sgdk-retrofx", "md");
        let environment = BuildEnvironment {
            sgdk_root: Some(sgdk_root),
            sgdk_make_program: Some(make_program),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});
        assert!(result.ok, "retrofx build log: {:?}", result.log);

        let main_c = fs::read_to_string(
            project_dir
                .join("build")
                .join("megadrive")
                .join("src")
                .join("main.c"),
        )
        .expect("read main.c");

        // RetroFX init: HSCROLL_LINE mode
        assert!(
            main_c.contains("VDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE)"),
            "main.c should init line scrolling: {}",
            main_c
        );

        // Parallax offset updates in game loop
        assert!(
            main_c.contains("retro_parallax_offset_0_x += 1"),
            "main.c should update far layer offset: {}",
            main_c
        );
        assert!(
            main_c.contains("retro_parallax_offset_1_x += 3"),
            "main.c should update near layer offset: {}",
            main_c
        );

        // Raster line offset applied
        assert!(
            main_c.contains("retro_hscroll_table[100] += 4"),
            "main.c should apply raster offset at scanline 100: {}",
            main_c
        );

        // Scroll table declaration
        assert!(
            main_c.contains("static s16 retro_hscroll_table[224]"),
            "main.c should declare hscroll table: {}",
            main_c
        );

        // DMA push for scroll
        assert!(
            main_c.contains("VDP_setHorizontalScrollLine("),
            "main.c should push scroll table via DMA: {}",
            main_c
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    // ── Step 2b: RetroFX SNES smoke ─────────────────────────────────────────

    #[test]
    fn retrofx_scene_config_generates_hdma_parallax_in_snes_main_c() {
        let _serial = test_serial_guard();
        let project_dir = workspace_copy("snes_dummy");

        let scene_json = r#"{
  "scene_id": "main",
  "schema_version": "1.6.0",
  "display_name": "Main Scene",
  "background_layers": [],
  "entities": [
    {
      "entity_id": "controller_root",
      "prefab": null,
      "transform": { "x": 16, "y": 24 },
      "components": {
        "sprite": {
          "asset": "assets/sprites/hero.ppm",
          "frame_width": 16,
          "frame_height": 16,
          "pivot": null,
          "palette_slot": 0,
          "animations": {},
          "priority": "foreground"
        },
        "collision": null,
        "input": null,
        "physics": null,
        "audio": null,
        "logic": null,
        "camera": null,
        "tilemap": null
      }
    }
  ],
  "palettes": [],
  "retrofx": {
    "parallax_layers": [
      {
        "id": "bg_slow",
        "name": "BG_A",
        "speed_x": 2,
        "speed_y": 0,
        "enabled": true
      }
    ],
    "raster_lines": []
  },
  "collision_map": null,
  "layers": null
}"#;
        fs::write(project_dir.join("scenes").join("main.json"), scene_json)
            .expect("write snes retrofx scene");

        let (pvsneslib_root, make_program) = fake_toolchain("pvsneslib-retrofx", "sfc");
        fs::create_dir_all(pvsneslib_root.join("devkitsnes")).expect("create fake devkitsnes");
        fs::write(
            pvsneslib_root.join("devkitsnes").join("snes_rules"),
            "dummy rules",
        )
        .expect("write fake snes_rules");
        let environment = BuildEnvironment {
            pvsneslib_root: Some(pvsneslib_root),
            pvsneslib_make_program: Some(make_program),
            pvsneslib_bash_program: Some(fake_bash_program()),
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});
        assert!(result.ok, "snes retrofx build log: {:?}", result.log);

        let main_c = fs::read_to_string(
            project_dir
                .join("build")
                .join("snes")
                .join("src")
                .join("main.c"),
        )
        .expect("read snes main.c");

        // SNES RetroFX uses HDMA parallax (HDMATable16 / setParallaxScrolling)
        assert!(
            main_c.contains("HDMATable16")
                || main_c.contains("setParallaxScrolling")
                || main_c.contains("retro_parallax"),
            "snes main.c should contain HDMA parallax setup: {}",
            main_c
        );

        let _ = fs::remove_dir_all(project_dir);
    }
}
