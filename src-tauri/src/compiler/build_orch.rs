use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::compiler::ast_generator::{
    collect_bgm_tracks, collect_sfx_resources, collect_tilemap_assets, generate_ast_with_prefabs,
    AstOutput,
};
use crate::compiler::sgdk_emitter::emit_sgdk;
use crate::compiler::snes_emitter::emit_snes;
use crate::core::project_mgr::{load_project, load_scene, resolve_prefabs, target_spec, TargetSpec};
use crate::hardware::md_profile;
use crate::hardware::snes_profile;
use crate::ugdm::entities::Project;

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

    emit!("info", format!("Carregando projeto em: {}", project_dir.display()));

    let project = match load_project(project_dir) {
        Ok(project) => project,
        Err(error) => {
            emit!("error", format!("Falha ao carregar project.rds: {}", error));
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
        }
    };

    let mut result = run_build_for_project_with_environment(project_dir, &project, environment, on_log);
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

    emit!("info", format!("Carregando projeto em: {}", project_dir.display()));

    let project = match load_project(project_dir) {
        Ok(project) => project,
        Err(error) => {
            emit!("error", format!("Falha ao carregar project.rds: {}", error));
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
                }],
            };
        }
    };

    let mut results = Vec::new();

    for target_name in targets {
        emit!("info", format!("Iniciando build para target '{}'.", target_name));

        let entry = match project_with_target_override(&project, target_name) {
            Ok(project_override) => {
                let prefixed_result =
                    run_build_for_project_with_environment(project_dir, &project_override, environment, |line| {
                        on_log(BuildLogLine {
                            level: line.level.clone(),
                            message: format!("[{}] {}", target_name, line.message),
                        });
                    });

                build_entry_from_result(target_name, prefixed_result)
            }
            Err(error) => MultiTargetBuildEntry {
                target: target_name.clone(),
                ok: false,
                rom_path: String::new(),
                rom_size_bytes: 0,
                warnings: Vec::new(),
                errors: vec![error],
                log: vec![BuildLogLine {
                    level: "error".to_string(),
                    message: format!("[{}] target override invalido", target_name),
                }],
            },
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
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
        }
    };

    emit!(
        "info",
        format!("Projeto '{}' carregado. Target: {}", project.name, project.target)
    );

    let scene = match load_scene(project_dir, &project.entry_scene) {
        Ok(scene) => scene,
        Err(error) => {
            emit!(
                "error",
                format!("Falha ao carregar cena '{}': {}", project.entry_scene, error)
            );
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
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
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
        }
    };

    let hw_errors = match target.target {
        "megadrive" => md_profile::validate_scene(&resolved_scene)
            .into_iter()
            .map(|error| (error.message, error.is_fatal))
            .collect::<Vec<_>>(),
        "snes" => snes_profile::validate_scene(&resolved_scene)
            .into_iter()
            .map(|error| (error.message, error.is_fatal))
            .collect::<Vec<_>>(),
        _ => unreachable!("validated by target_spec"),
    };

    for (message, is_fatal) in &hw_errors {
        emit!(if *is_fatal { "error" } else { "warn" }, message);
    }

    if hw_errors.iter().any(|(_, is_fatal)| *is_fatal) {
        emit!("error", "Build abortado: erros de hardware constraints.");
        return BuildResult {
            ok: false,
            rom_path: String::new(),
            log,
        };
    }

    emit!("info", "Gerando codigo C e manifestos...");
    let ast = match generate_ast_with_prefabs(project_dir, project, &scene) {
        Ok(ast) => ast,
        Err(error) => {
            emit!("error", format!("Falha ao gerar AST com prefabs: {}", error));
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
        }
    };
    let artifacts = match target.target {
        "snes" => {
            let output = emit_snes(&ast, &project.name);
            EmitArtifacts {
                main_c: output.main_c,
                resources_res: output.resources_res,
            }
        }
        _ => {
            let output = emit_sgdk(&ast, &project.name);
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
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
        }
    };

    emit!(
        "success",
        format!("Workspace de build preparado em: {}", workspace.root.display())
    );

    let toolchain = match resolve_toolchain(environment, target) {
        Ok(toolchain) => toolchain,
        Err(error) => {
            emit!("error", error);
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
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
            "warn",
            "Git Bash/MSYS2 nao encontrado. Tentando build SNES com make direto; o snes_rules pode exigir shell Unix-like no Windows."
        );
    }

    if let Err(error) = invoke_make(&toolchain, &workspace, target, &mut log, &on_log) {
        emit!("error", error);
        return BuildResult {
            ok: false,
            rom_path: String::new(),
            log,
        };
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
            return BuildResult {
                ok: false,
                rom_path: String::new(),
                log,
            };
        }
    };

    emit!("success", format!("ROM gerada: {}", rom_path.display()));

    BuildResult {
        ok: true,
        rom_path: rom_path.to_string_lossy().to_string(),
        log,
    }
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
    }
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
    let root = project_dir.join(output_root).join(target.target);
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|e| format!("Nao foi possivel limpar workspace '{}': {}", root.display(), e))?;
    }

    let src_dir = root.join("src");
    let res_dir = root.join("res");
    let out_dir = root.join("out");
    fs::create_dir_all(&src_dir)
        .and_then(|_| fs::create_dir_all(&res_dir))
        .and_then(|_| fs::create_dir_all(&out_dir))
        .map_err(|e| format!("Nao foi possivel criar workspace '{}': {}", root.display(), e))?;

    let makefile_path = root.join("Makefile");
    let project_slug = sanitize_project_name(&project.name);
    let main_c_path = src_dir.join("main.c");
    let resources_res_path = res_dir.join("resources.res");

    fs::write(&main_c_path, &artifacts.main_c)
        .map_err(|e| format!("Falha ao gravar '{}': {}", main_c_path.display(), e))?;
    fs::write(&resources_res_path, &artifacts.resources_res).map_err(|e| {
        format!(
            "Falha ao gravar '{}': {}",
            resources_res_path.display(),
            e
        )
    })?;

    match target.target {
        "snes" => {
            stage_snes_assets(project_dir, &src_dir, ast)?;
            let data_asm = render_snes_data_asm(ast);
            let hdr_asm = render_snes_header(project);
            fs::write(root.join("data.asm"), &data_asm).map_err(|e| {
                format!("Falha ao gravar 'data.asm' do SNES em '{}': {}", root.display(), e)
            })?;
            fs::write(root.join("hdr.asm"), &hdr_asm).map_err(|e| {
                format!("Falha ao gravar 'hdr.asm' do SNES em '{}': {}", root.display(), e)
            })?;
            fs::write(&makefile_path, render_pvsneslib_makefile(&project_slug, ast)).map_err(
                |e| format!("Falha ao gravar '{}': {}", makefile_path.display(), e),
            )?;
        }
        _ => {
            stage_project_assets(project_dir, &res_dir, ast)?;
            fs::write(&makefile_path, render_sgdk_makefile(&project_slug))
                .map_err(|e| format!("Falha ao gravar '{}': {}", makefile_path.display(), e))?;
        }
    }

    Ok(BuildWorkspace {
        root,
        out_dir,
    })
}

fn stage_project_assets(
    project_dir: &Path,
    workspace_root: &Path,
    ast: &AstOutput,
) -> Result<(), String> {
    for asset in &ast.sprite_assets {
        let asset_rel = sanitize_relative_asset_path(&asset.asset_path)?;
        let source = project_dir.join(&asset_rel);
        if !source.exists() {
            return Err(format!(
                "Asset referenciado nao encontrado: '{}'.",
                source.display()
            ));
        }
        let destination = workspace_root.join(&asset_rel);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Falha ao preparar pasta de asset '{}': {}", parent.display(), e)
            })?;
        }
        fs::copy(&source, &destination).map_err(|e| {
            format!(
                "Falha ao copiar asset '{}' para '{}': {}",
                source.display(),
                destination.display(),
                e
            )
        })?;
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
                format!("Falha ao preparar pasta de asset '{}': {}", parent.display(), e)
            })?;
        }

        stage_bitmap_asset(&source, &destination, "SGDK")?;
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
            format!("Falha ao preparar pasta de asset '{}': {}", parent.display(), e)
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

    let destination = src_dir.join(snes_audio_staging_filename(resource_name, asset_path, suffix));
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

fn sgdk_tilemap_staging_path(asset_path: &Path) -> PathBuf {
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
    let rgba = image.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let row_stride = (width + 3) & !3;
    let pixel_data_size = row_stride * height;
    let palette_size = 256 * 4;
    let pixel_offset = 14 + 40 + palette_size;
    let file_size = pixel_offset + pixel_data_size;

    let mut palette: Vec<[u8; 4]> = Vec::new();
    let mut indices = Vec::with_capacity(width * height);

    for pixel in rgba.pixels() {
        let color = [pixel[2], pixel[1], pixel[0], 0];
        let palette_index = palette
            .iter()
            .position(|entry| *entry == color)
            .or_else(|| {
                if palette.len() < 256 {
                    palette.push(color);
                    Some(palette.len() - 1)
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                format!(
                    "Asset usa mais de 256 cores e nao pode ser convertido para BMP indexado: {}x{}",
                    width, height
                )
            })?;
        indices.push(palette_index as u8);
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

    fs::write(destination, bytes)
        .map_err(|e| format!("falha ao gravar BMP indexado '{}': {}", destination.display(), e))
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

    let mut pic_targets = Vec::new();
    for asset in &tilemap_assets {
        let pic_target = format!("src/{}.pic", asset.resource_name);
        let bmp_target = format!("src/{}.bmp", asset.resource_name);
        pic_targets.push(pic_target.clone());
        out.push_str(&format!("{}: {}\n", pic_target, bmp_target));
        out.push_str("\t@echo convert bitmap ... $(notdir $<)\n");
        out.push_str("\t$(GFXCONV) -s 8 -o 16 -u 16 -e 0 -p -m -t bmp -i $<\n\n");
    }

    for asset in &ast.sprite_assets {
        let pic_target = format!("src/{}.pic", asset.resource_name);
        let bmp_target = format!("src/{}.bmp", asset.resource_name);
        let sprite_size = asset.frame_width.max(asset.frame_height);
        pic_targets.push(pic_target.clone());
        out.push_str(&format!("{}: {}\n", pic_target, bmp_target));
        out.push_str("\t@echo convert bitmap ... $(notdir $<)\n");
        out.push_str(&format!(
            "\t$(GFXCONV) -s {} -o 16 -u 16 -p -t bmp -i $<\n\n",
            sprite_size
        ));
    }

    if pic_targets.is_empty() {
        out.push_str("bitmaps:\n\t@echo no sprite assets to convert for SNES\n");
    } else {
        out.push_str(&format!("bitmaps: {}\n", pic_targets.join(" ")));
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
        out.push_str(&format!(".include \"src/{}_data.as\"\n", asset.resource_name));
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
                    "Toolchain SGDK nao encontrada. Configure SGDK_ROOT ou instale em toolchains/sgdk/."
                        .to_string()
                })?;
            let make_program = environment
                .sgdk_make_program
                .clone()
                .or_else(|| (!environment.disable_auto_detect).then(|| detect_make_program(&root)).flatten())
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
                .or_else(|| (!environment.disable_auto_detect).then(|| detect_make_program(&root)).flatten())
                .or_else(|| (!environment.disable_auto_detect).then(|| find_in_path(&["make", "mingw32-make"])).flatten())
                .or_else(|| {
                    (!environment.disable_auto_detect)
                        .then(|| detect_root("SGDK_ROOT", "sgdk").as_deref().and_then(detect_make_program))
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
                bash_program: environment
                    .pvsneslib_bash_program
                    .clone()
                    .or_else(|| (!environment.disable_auto_detect).then(detect_bash_program).flatten()),
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
            command.env("PVSNESLIB_LIBDIR_WIN", snes_library_dir_windows(&toolchain.root));
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
            command.env("PVSNESLIB_LIBDIR_WIN", snes_library_dir_windows(&toolchain.root));
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
        match target.target {
            "snes" => {
                if cfg!(target_os = "windows") {
                    command.env("PVSNESLIB_HOME", to_shell_friendly_path(&toolchain.root));
                    command.env("PVSNESLIB_LIBDIR_WIN", snes_library_dir_windows(&toolchain.root));
                } else {
                    command.env("PVSNESLIB_HOME", &toolchain.root);
                }
            }
            _ => {
                command.env("SGDK", &toolchain.root);
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
        return Err(format!(
            "Build externo falhou com codigo {:?}.",
            output.status.code()
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

    for entry in fs::read_dir(dir).map_err(|e| format!("Falha ao listar '{}': {}", dir.display(), e))? {
        let entry = entry.map_err(|e| format!("Falha ao ler entrada em '{}': {}", dir.display(), e))?;
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

fn detect_root(env_var: &str, local_dir_name: &str) -> Option<PathBuf> {
    if let Ok(path) = std::env::var(env_var) {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    let local = repo_root().join("toolchains").join(local_dir_name);
    if local_dir_name == "sgdk" {
        if local.join("makefile.gen").exists() || (local.join("bin").exists() && local.join("inc").exists()) {
            return Some(local);
        }
    } else if local_dir_name == "pvsneslib"
        && local.join("devkitsnes").join("snes_rules").exists()
    {
        return Some(local);
    }

    None
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
    let locator = if cfg!(target_os = "windows") { "where" } else { "which" };
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
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_serial_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_SERIAL: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_SERIAL
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
        assert!(project_dir.join("build").join("megadrive").join("src").join("main.c").exists());
        assert!(project_dir.join("build").join("megadrive").join("res").join("resources.res").exists());
        assert!(project_dir
            .join("build")
            .join("megadrive")
            .join("res")
            .join("assets")
            .join("sprites")
            .join("onboarding_player.ppm")
            .exists());

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
            disable_auto_detect: true,
            ..BuildEnvironment::default()
        };

        let result = run_build_with_environment(&project_dir, &environment, |_| {});

        assert!(result.ok, "build log: {:?}", result.log);
        assert!(result.rom_path.ends_with(".sfc"));
        assert!(project_dir.join("build").join("snes").join("Makefile").exists());
        let hdr_path = project_dir.join("build").join("snes").join("hdr.asm");
        let data_path = project_dir.join("build").join("snes").join("data.asm");
        let bmp_path = project_dir.join("build").join("snes").join("src").join("controller_root.bmp");
        assert!(bmp_path.exists());
        assert!(hdr_path.exists());
        assert!(data_path.exists());
        assert!(!project_dir.join("build").join("snes").join("src").join("data.asm").exists());
        assert!(!project_dir.join("build").join("snes").join("src").join("hdr.asm").exists());
        let bmp_bytes = fs::read(&bmp_path).expect("read staged bmp");
        assert_eq!(&bmp_bytes[0..2], b"BM");
        assert_eq!(u16::from_le_bytes([bmp_bytes[28], bmp_bytes[29]]), 8);
        let data_asm = fs::read_to_string(&data_path).expect("read snes data asm");
        assert!(data_asm.contains(".include \"hdr.asm\""));
        assert!(data_asm.contains(".include \"src/controller_root_data.as\""));

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
        assert!(resources_res.contains("IMAGE background_tilemap \"assets/tilesets/level.bmp\" NONE"));
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
        let data_asm = fs::read_to_string(
            project_dir.join("build").join("snes").join("data.asm"),
        )
        .expect("read SNES data asm");
        assert!(data_asm.contains("background_tilemap_map:"));
        assert!(data_asm.contains(".incbin \"src/background_tilemap.map\""));
        let makefile = fs::read_to_string(
            project_dir.join("build").join("snes").join("Makefile"),
        )
        .expect("read SNES makefile");
        assert!(makefile.contains("$(GFXCONV) -s 8 -o 16 -u 16 -e 0 -p -m -t bmp -i $<"));
        let main_c = fs::read_to_string(
            project_dir.join("build").join("snes").join("src").join("main.c"),
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
        assert!(resources_res.contains("WAV jump \"assets/audio/jump.wav\" 2ADPCM"));
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
        let data_asm = fs::read_to_string(
            project_dir.join("build").join("snes").join("data.asm"),
        )
        .expect("read SNES audio data asm");
        assert!(data_asm.contains("jump_sfx:"));
        assert!(data_asm.contains(".incbin \"src/jump_sfx.brr\""));
        assert!(data_asm.contains("stage_theme_bgm:"));
        assert!(data_asm.contains(".incbin \"src/stage_theme_bgm.spc\""));
        let main_c = fs::read_to_string(
            project_dir.join("build").join("snes").join("src").join("main.c"),
        )
        .expect("read SNES audio main.c");
        assert!(main_c.contains("spcSetSoundEntry(SFX_JUMP, 8, 0, (u8*)&jump_sfx);"));
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
        assert!(result.results[0].ok, "megadrive log: {:?}", result.results[0].log);
        assert!(result.results[0].rom_path.ends_with(".md"));
        assert!(result.results[0].rom_size_bytes > 0);
        assert_eq!(result.results[1].target, "snes");
        assert!(result.results[1].ok, "snes log: {:?}", result.results[1].log);
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
}
