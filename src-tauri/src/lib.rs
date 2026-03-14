mod compiler;
mod core;
mod emulator;
mod hardware;
mod tools;
mod ugdm;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use compiler::ast_generator::generate_ast;
use compiler::build_orch::{
    run_build,
    run_build_multi_target,
    BuildLogLine,
    BuildResult,
    MultiTargetBuildResult,
};
use compiler::sgdk_emitter::emit_sgdk;
use compiler::snes_emitter::emit_snes;
use core::editor_validation::{
    authoritative_hw_status,
    validate_scene_draft as validate_scene_draft_impl,
    DraftValidationResult,
};
use core::project_mgr::{
    create_scene as create_project_scene,
    create_project_skeleton,
    list_scenes as list_project_scenes,
    load_project,
    load_scene,
    resolve_prefabs,
    save_scene,
    set_entry_scene,
    update_project_target,
    SceneInfo,
};
use emulator::frame_buffer::framebuffer_to_rgba;
use emulator::libretro_ffi::{EmulatorCore, JoypadState};
use hardware::constraint_engine;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

// HwStatus canônico definido em hardware::mod
use hardware::HwStatus;

// ── App State ─────────────────────────────────────────────────────────────────

/// Estado global do emulador, gerenciado pelo Tauri via `manage()`.
struct EmulatorCoreState(Mutex<EmulatorCore>);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AssetFingerprint {
    modified_ms: u128,
    size: u64,
}

#[derive(Default)]
struct ProjectAssetWatchState(Mutex<HashMap<String, HashMap<String, AssetFingerprint>>>);

// ── IPC Response types ────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct ValidationResult {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct GenerateResult {
    pub ok: bool,
    pub main_c: String,
    pub resources_res: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct EmulatorCommandResult {
    pub ok: bool,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct EmulatorMemoryResult {
    pub ok: bool,
    pub data: Vec<u8>,
    pub total_size: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectAssetEntry {
    pub relative_path: String,
    pub absolute_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AudioPayload {
    pub sample_rate: u32,
    pub samples: Vec<i16>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ProjectAssetWatchResult {
    pub changed: bool,
    pub changed_paths: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ProjectAssetsChangedEvent {
    pub project_dir: String,
    pub changed_paths: Vec<String>,
}

// ── Build commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn validate_project(project_dir: String) -> ValidationResult {
    let dir = PathBuf::from(&project_dir);
    let hw_status = match authoritative_hw_status(&dir) {
        Ok(status) => status,
        Err(error) => return ValidationResult { ok: false, errors: vec![error], warnings: vec![] },
    };

    ValidationResult {
        ok: hw_status.errors.is_empty(),
        errors: hw_status.errors,
        warnings: hw_status.warnings,
    }
}

#[tauri::command]
fn generate_c_code(project_dir: String) -> GenerateResult {
    let dir = PathBuf::from(&project_dir);

    let project = match load_project(&dir) {
        Ok(p) => p,
        Err(e) => return GenerateResult { ok: false, main_c: String::new(), resources_res: String::new(), errors: vec![e.to_string()], warnings: vec![] },
    };
    let scene = match load_scene(&dir, &project.entry_scene) {
        Ok(s) => s,
        Err(e) => return GenerateResult { ok: false, main_c: String::new(), resources_res: String::new(), errors: vec![e.to_string()], warnings: vec![] },
    };
    let resolved_scene = match resolve_prefabs(&dir, &scene) {
        Ok(scene) => scene,
        Err(error) => {
            return GenerateResult {
                ok: false,
                main_c: String::new(),
                resources_res: String::new(),
                errors: vec![error.to_string()],
                warnings: vec![],
            }
        }
    };
    let hw_status = match constraint_engine::hw_status_for_target(&project.target, &resolved_scene) {
        Ok(status) => status,
        Err(error) => {
            return GenerateResult {
                ok: false,
                main_c: String::new(),
                resources_res: String::new(),
                errors: vec![error],
                warnings: vec![],
            }
        }
    };

    let errors = hw_status.errors;
    let warnings = hw_status.warnings;
    if !errors.is_empty() {
        return GenerateResult { ok: false, main_c: String::new(), resources_res: String::new(), errors, warnings };
    }

    let ast = generate_ast(&project, &resolved_scene);
    let (main_c, resources_res) = match project.target.as_str() {
        "snes" => { let o = emit_snes(&ast, &project.name); (o.main_c, o.resources_res) }
        _ => { let o = emit_sgdk(&ast, &project.name); (o.main_c, o.resources_res) }
    };
    GenerateResult { ok: true, main_c, resources_res, errors: vec![], warnings }
}

#[tauri::command]
fn validate_scene_draft(project_dir: String, scene_json: String) -> DraftValidationResult {
    if project_dir.trim().is_empty() {
        return DraftValidationResult::failure("Nenhum projeto aberto.");
    }

    validate_scene_draft_impl(Path::new(&project_dir), &scene_json)
}

#[tauri::command]
fn build_project(app: AppHandle, project_dir: String) -> BuildResult {
    let dir = PathBuf::from(&project_dir);
    run_build(&dir, move |line: BuildLogLine| {
        let _ = app.emit("build://log", &line);
    })
}

#[tauri::command]
fn build_multi_target(
    app: AppHandle,
    project_dir: String,
    targets: Vec<String>,
) -> MultiTargetBuildResult {
    let dir = PathBuf::from(&project_dir);
    run_build_multi_target(&dir, &targets, move |line: BuildLogLine| {
        let _ = app.emit("build://log", &line);
    })
}

// ── Hardware status command ───────────────────────────────────────────────────

/// Retorna o uso atual de hardware (VRAM, sprites) para o painel Hardware Limits.
/// Aceita um project_dir opcional; se vazio, retorna zeros (projeto novo/sem dados).
#[tauri::command]
fn get_hw_status(project_dir: String) -> HwStatus {
    if project_dir.is_empty() {
        return HwStatus::default();
    }
    let dir = PathBuf::from(&project_dir);
    authoritative_hw_status(&dir).unwrap_or_default()
}

// ── Emulator commands ─────────────────────────────────────────────────────────

/// Carrega uma ROM .md no emulador e inicia o modo simulado/real.
#[tauri::command]
fn emulator_load_rom(
    rom_path: String,
    emu: State<EmulatorCoreState>,
) -> EmulatorCommandResult {
    let mut core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    match core.load_rom(Path::new(&rom_path)) {
        Ok(()) => EmulatorCommandResult {
            ok: true,
            message: match core.loaded_core_label() {
                Some(label) if !label.is_empty() => {
                    format!("ROM carregada: {} ({})", rom_path, label)
                }
                _ => format!("ROM carregada: {}", rom_path),
            },
        },
        Err(e) => EmulatorCommandResult { ok: false, message: e },
    }
}

/// Executa um frame do emulador e emite o resultado via evento `emulator://frame`.
/// O frontend chama este comando a cada ~16ms (60fps) via `setInterval`.
#[tauri::command]
fn emulator_run_frame(
    app: AppHandle,
    emu: State<EmulatorCoreState>,
) -> EmulatorCommandResult {
    let mut core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    if let Err(e) = core.run_frame() {
        return EmulatorCommandResult { ok: false, message: e };
    }

    if let Err(error) = emit_emulator_frame_events(&app, &mut core) {
        return EmulatorCommandResult {
            ok: false,
            message: error,
        };
    }

    EmulatorCommandResult { ok: true, message: String::new() }
}

trait EmulatorEventSink {
    fn emit_frame(&self, payload: &emulator::frame_buffer::FramePayload) -> Result<(), String>;
    fn emit_audio(&self, payload: &AudioPayload) -> Result<(), String>;
}

impl<R: tauri::Runtime> EmulatorEventSink for AppHandle<R> {
    fn emit_frame(&self, payload: &emulator::frame_buffer::FramePayload) -> Result<(), String> {
        self.emit("emulator://frame", payload)
            .map_err(|error| format!("Falha ao emitir frame do emulador: {}", error))
    }

    fn emit_audio(&self, payload: &AudioPayload) -> Result<(), String> {
        self.emit("emulator://audio", payload)
            .map_err(|error| format!("Falha ao emitir audio do emulador: {}", error))
    }
}

fn emit_emulator_frame_events<S: EmulatorEventSink>(
    sink: &S,
    core: &mut EmulatorCore,
) -> Result<(), String> {
    let (fb, size, pixel_format) = core.get_framebuffer()?;

    let payload = framebuffer_to_rgba(&fb, size, pixel_format);
    sink.emit_frame(&payload)?;

    let (sample_rate, samples) = core.take_audio_samples()?;
    if !samples.is_empty() {
        let audio_payload = AudioPayload {
            sample_rate,
            samples,
        };
        sink.emit_audio(&audio_payload)?;
    }

    Ok(())
}

#[tauri::command]
fn emulator_save_state(emu: State<EmulatorCoreState>) -> EmulatorCommandResult {
    let mut core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    match core.save_state() {
        Ok(size) => EmulatorCommandResult {
            ok: true,
            message: format!("Save state salvo ({} bytes).", size),
        },
        Err(error) => EmulatorCommandResult { ok: false, message: error },
    }
}

#[tauri::command]
fn emulator_load_state(emu: State<EmulatorCoreState>) -> EmulatorCommandResult {
    let mut core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    match core.load_state() {
        Ok(()) => EmulatorCommandResult {
            ok: true,
            message: "Save state restaurado.".to_string(),
        },
        Err(error) => EmulatorCommandResult { ok: false, message: error },
    }
}

#[tauri::command]
fn emulator_rewind_step(emu: State<EmulatorCoreState>) -> EmulatorCommandResult {
    let mut core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    match core.rewind_step() {
        Ok((frame_index, remaining, interval)) => EmulatorCommandResult {
            ok: true,
            message: format!(
                "Rewind restaurado para o frame {} ({} snapshot(s) restantes, intervalo {} frame(s)).",
                frame_index, remaining, interval
            ),
        },
        Err(error) => EmulatorCommandResult { ok: false, message: error },
    }
}

/// Le uma faixa da memoria exposta pelo core Libretro ativo.
#[tauri::command]
fn emulator_read_memory(
    region: u32,
    offset: usize,
    length: usize,
    emu: State<EmulatorCoreState>,
) -> Result<EmulatorMemoryResult, String> {
    let core = emu.0.lock().map_err(|e| e.to_string())?;
    let (data, total_size) = core.read_memory(region, offset, length)?;
    Ok(EmulatorMemoryResult {
        ok: true,
        data,
        total_size,
    })
}

/// Envia o estado dos botões do joypad 1 para o emulador.
#[tauri::command]
fn emulator_send_input(
    joypad: JoypadState,
    emu: State<EmulatorCoreState>,
) -> EmulatorCommandResult {
    let core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    match core.set_joypad(joypad) {
        Ok(()) => EmulatorCommandResult { ok: true, message: String::new() },
        Err(e) => EmulatorCommandResult { ok: false, message: e },
    }
}

/// Para o emulador e limpa o framebuffer.
#[tauri::command]
fn emulator_stop(emu: State<EmulatorCoreState>) -> EmulatorCommandResult {
    let mut core = match emu.0.lock() {
        Ok(c) => c,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };

    match core.stop() {
        Ok(()) => EmulatorCommandResult { ok: true, message: "Emulador parado.".into() },
        Err(e) => EmulatorCommandResult { ok: false, message: e },
    }
}

// ── Fase 4: Tools commands ────────────────────────────────────────────────────

use tools::patch_studio::{PatchResult, create_ips_file, apply_ips_file, create_bps_file, apply_bps_file};
use tools::deep_profiler::{ProfileReport, profile_rom};
use tools::asset_extractor::{BppMode, ExtractionResult, extract_assets};
use tools::dependency_manager::{
    DependencyInstallResult,
    DependencyLogLine,
    DependencyStatusReport,
    RomDependencyResult,
    dependency_for_rom_path,
    dependency_status_report,
    install_dependency,
};
use tools::reverse_explorer::ReverseExplorerResult;

#[tauri::command]
fn patch_create_ips(original_path: String, modified_path: String, patch_path: String) -> PatchResult {
    create_ips_file(Path::new(&original_path), Path::new(&modified_path), Path::new(&patch_path))
}

#[tauri::command]
fn patch_apply_ips(rom_path: String, patch_path: String, output_path: String) -> PatchResult {
    apply_ips_file(Path::new(&rom_path), Path::new(&patch_path), Path::new(&output_path))
}

#[tauri::command]
fn patch_create_bps(original_path: String, modified_path: String, patch_path: String) -> PatchResult {
    create_bps_file(Path::new(&original_path), Path::new(&modified_path), Path::new(&patch_path))
}

#[tauri::command]
fn patch_apply_bps(rom_path: String, patch_path: String, output_path: String) -> PatchResult {
    apply_bps_file(Path::new(&rom_path), Path::new(&patch_path), Path::new(&output_path))
}

#[tauri::command]
fn profiler_analyze_rom(rom_path: String) -> ProfileReport {
    profile_rom(Path::new(&rom_path))
}

#[tauri::command]
fn assets_extract(
    rom_path: String,
    output_dir: String,
    max_tiles: u32,
    palette_slot: u8,
    bpp_mode: String,
) -> ExtractionResult {
    extract_assets(
        Path::new(&rom_path),
        Path::new(&output_dir),
        max_tiles,
        palette_slot,
        BppMode::from_str(&bpp_mode),
    )
}

#[tauri::command]
fn reverse_explorer_read(
    rom_path: String,
    target: String,
    offset: usize,
    length: usize,
) -> ReverseExplorerResult {
    tools::reverse_explorer::inspect_rom(&rom_path, &target, offset, length)
}

#[tauri::command]
fn list_project_assets(project_dir: String) -> Result<Vec<ProjectAssetEntry>, String> {
    let trimmed = project_dir.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let assets_dir = Path::new(trimmed).join("assets");
    if !assets_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    collect_project_assets(&assets_dir, &assets_dir, &mut entries)?;
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(entries)
}

fn collect_project_assets(
    root: &Path,
    current: &Path,
    entries: &mut Vec<ProjectAssetEntry>,
) -> Result<(), String> {
    for dir_entry in fs::read_dir(current)
        .map_err(|error| format!("Falha ao listar '{}': {}", current.display(), error))?
    {
        let dir_entry = dir_entry
            .map_err(|error| format!("Falha ao ler entrada de '{}': {}", current.display(), error))?;
        let path = dir_entry.path();
        let file_type = dir_entry
            .file_type()
            .map_err(|error| format!("Falha ao ler tipo de '{}': {}", path.display(), error))?;

        if file_type.is_dir() {
            collect_project_assets(root, &path, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let relative = path
            .strip_prefix(root.parent().unwrap_or(root))
            .map_err(|error| format!("Falha ao relativizar asset '{}': {}", path.display(), error))?
            .to_string_lossy()
            .replace('\\', "/");

        entries.push(ProjectAssetEntry {
            relative_path: relative,
            absolute_path: path.to_string_lossy().to_string(),
            kind: project_asset_kind(&path),
        });
    }

    Ok(())
}

fn collect_asset_fingerprints(
    project_root: &Path,
    current: &Path,
    entries: &mut HashMap<String, AssetFingerprint>,
) -> Result<(), String> {
    for dir_entry in fs::read_dir(current)
        .map_err(|error| format!("Falha ao listar '{}': {}", current.display(), error))?
    {
        let dir_entry = dir_entry
            .map_err(|error| format!("Falha ao ler entrada de '{}': {}", current.display(), error))?;
        let path = dir_entry.path();
        let file_type = dir_entry
            .file_type()
            .map_err(|error| format!("Falha ao ler tipo de '{}': {}", path.display(), error))?;

        if file_type.is_dir() {
            collect_asset_fingerprints(project_root, &path, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = dir_entry
            .metadata()
            .map_err(|error| format!("Falha ao ler metadados de '{}': {}", path.display(), error))?;
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis())
            .unwrap_or_default();
        let relative = path
            .strip_prefix(project_root)
            .map_err(|error| format!("Falha ao relativizar asset '{}': {}", path.display(), error))?
            .to_string_lossy()
            .replace('\\', "/");

        entries.insert(
            relative,
            AssetFingerprint {
                modified_ms,
                size: metadata.len(),
            },
        );
    }

    Ok(())
}

fn snapshot_project_assets(project_dir: &Path) -> Result<HashMap<String, AssetFingerprint>, String> {
    let assets_dir = project_dir.join("assets");
    let mut entries = HashMap::new();
    if !assets_dir.exists() {
        return Ok(entries);
    }

    collect_asset_fingerprints(project_dir, &assets_dir, &mut entries)?;
    Ok(entries)
}

fn diff_asset_fingerprints(
    previous: &HashMap<String, AssetFingerprint>,
    current: &HashMap<String, AssetFingerprint>,
) -> Vec<String> {
    let mut changed_paths = Vec::new();

    for (path, fingerprint) in current {
        match previous.get(path) {
            Some(previous_fingerprint) if previous_fingerprint == fingerprint => {}
            _ => changed_paths.push(path.clone()),
        }
    }

    for path in previous.keys() {
        if !current.contains_key(path) {
            changed_paths.push(path.clone());
        }
    }

    changed_paths.sort();
    changed_paths.dedup();
    changed_paths
}

#[tauri::command]
fn poll_project_asset_changes(
    app: AppHandle,
    project_dir: String,
    watch_state: State<ProjectAssetWatchState>,
) -> Result<ProjectAssetWatchResult, String> {
    let trimmed = project_dir.trim();
    if trimmed.is_empty() {
        return Ok(ProjectAssetWatchResult {
            changed: false,
            changed_paths: Vec::new(),
        });
    }

    let current = snapshot_project_assets(Path::new(trimmed))?;
    let mut snapshots = watch_state.0.lock().map_err(|error| error.to_string())?;
    let changed_paths = match snapshots.get(trimmed) {
        Some(previous) => diff_asset_fingerprints(previous, &current),
        None => Vec::new(),
    };
    snapshots.insert(trimmed.to_string(), current);

    if !changed_paths.is_empty() {
        let payload = ProjectAssetsChangedEvent {
            project_dir: trimmed.to_string(),
            changed_paths: changed_paths.clone(),
        };
        let _ = app.emit("project://assets-changed", &payload);
    }

    Ok(ProjectAssetWatchResult {
        changed: !changed_paths.is_empty(),
        changed_paths,
    })
}

fn project_asset_kind(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "png" | "bmp" | "ppm" | "pal" | "pic" | "map" | "json" => "image".to_string(),
        "wav" | "xgm" | "brr" | "spc" | "vgm" => "audio".to_string(),
        _ => "other".to_string(),
    }
}

#[tauri::command]
fn third_party_get_status() -> DependencyStatusReport {
    dependency_status_report()
}

#[tauri::command]
fn third_party_install(app: AppHandle, dependency_id: String) -> DependencyInstallResult {
    install_dependency(&dependency_id, move |line: DependencyLogLine| {
        let _ = app.emit("deps://log", &line);
    })
}

#[tauri::command]
fn third_party_detect_rom_dependency(rom_path: String) -> RomDependencyResult {
    RomDependencyResult {
        dependency_id: dependency_for_rom_path(Path::new(&rom_path))
            .unwrap_or_default()
            .to_string(),
    }
}

// ── Cena: leitura e escrita ───────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SceneDataResult {
    pub ok: bool,
    pub error: String,
    pub scene_json: String,   // JSON da cena serializado
    pub project_name: String,
    pub target: String,
    pub scene_path: String,
}

/// Retorna o JSON completo da cena de entrada do projeto (entry_scene).
#[tauri::command]
fn get_scene_data(project_dir: String, scene_path: Option<String>) -> SceneDataResult {
    load_scene_result(Path::new(&project_dir), scene_path.as_deref())
}

#[tauri::command]
fn switch_scene(project_dir: String, scene_path: String) -> SceneDataResult {
    if let Err(error) = set_entry_scene(Path::new(&project_dir), &scene_path) {
        return SceneDataResult {
            ok: false,
            error: error.to_string(),
            scene_json: String::new(),
            project_name: String::new(),
            target: String::new(),
            scene_path,
        };
    }
    load_scene_result(Path::new(&project_dir), Some(scene_path.as_str()))
}

fn load_scene_result(project_dir: &Path, scene_path: Option<&str>) -> SceneDataResult {
    let project_dir_str = project_dir.to_string_lossy();
    if project_dir_str.trim().is_empty() {
        return SceneDataResult {
            ok: false,
            error: "Nenhum projeto aberto.".into(),
            scene_json: String::new(),
            project_name: String::new(),
            target: String::new(),
            scene_path: String::new(),
        };
    }

    let dir = PathBuf::from(project_dir);
    let project = match load_project(&dir) {
        Ok(p) => p,
        Err(e) => return SceneDataResult { ok: false, error: e.to_string(),
            scene_json: String::new(), project_name: String::new(), target: String::new(), scene_path: String::new() },
    };
    let resolved_scene_path = scene_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or(project.entry_scene.as_str())
        .to_string();
    let scene = match load_scene(&dir, &resolved_scene_path) {
        Ok(s) => s,
        Err(e) => return SceneDataResult { ok: false, error: e.to_string(),
            scene_json: String::new(), project_name: project.name, target: project.target, scene_path: resolved_scene_path },
    };
    let scene_json = serde_json::to_string_pretty(&scene).unwrap_or_default();
    SceneDataResult { ok: true, error: String::new(), scene_json,
        project_name: project.name, target: project.target, scene_path: resolved_scene_path }
}

#[tauri::command]
fn list_scenes(project_dir: String) -> Result<Vec<SceneInfo>, String> {
    if project_dir.is_empty() {
        return Ok(Vec::new());
    }
    list_project_scenes(Path::new(&project_dir)).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_scene(project_dir: String, display_name: Option<String>) -> Result<SceneInfo, String> {
    if project_dir.trim().is_empty() {
        return Err("Nenhum projeto aberto.".into());
    }
    create_project_scene(Path::new(&project_dir), display_name.as_deref())
        .map_err(|error| error.to_string())
}

/// Salva o JSON de cena de volta para o arquivo entry_scene do projeto.
#[tauri::command]
fn save_scene_data(project_dir: String, scene_json: String, scene_path: Option<String>) -> EmulatorCommandResult {
    if project_dir.is_empty() {
        return EmulatorCommandResult { ok: false, message: "Nenhum projeto aberto.".into() };
    }
    let dir = PathBuf::from(&project_dir);
    let project = match load_project(&dir) {
        Ok(p) => p,
        Err(e) => return EmulatorCommandResult { ok: false, message: e.to_string() },
    };
    // Valida que é JSON válido antes de salvar
    if serde_json::from_str::<serde_json::Value>(&scene_json).is_err() {
        return EmulatorCommandResult { ok: false, message: "JSON de cena inválido.".into() };
    }
    let scene = match serde_json::from_str::<ugdm::entities::Scene>(&scene_json) {
        Ok(scene) => scene,
        Err(e) => return EmulatorCommandResult {
            ok: false,
            message: format!("JSON de cena invalido: {}", e),
        },
    };
    let target_scene_path = scene_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or(project.entry_scene.as_str());
    match save_scene(&dir, target_scene_path, &scene) {
        Ok(()) => EmulatorCommandResult { ok: true, message: "Cena salva.".into() },
        Err(e) => EmulatorCommandResult { ok: false, message: e.to_string() },
    }
}

/// Altera o campo `target` do project.rds e retorna o novo target.
#[tauri::command]
fn set_project_target(project_dir: String, target: String) -> EmulatorCommandResult {
    if project_dir.is_empty() {
        return EmulatorCommandResult { ok: false, message: "Nenhum projeto aberto.".into() };
    }
    let dir = PathBuf::from(&project_dir);
    match update_project_target(&dir, &target) {
        Ok(project) => EmulatorCommandResult { ok: true, message: project.target },
        Err(e) => EmulatorCommandResult { ok: false, message: e.to_string() },
    }
}

// ── Projeto: diálogos de FS ───────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct OpenProjectResult {
    pub selected: bool,
    pub path: String,
    pub name: String,
}

/// Abre o diálogo nativo "Selecionar pasta do projeto" e retorna o caminho.
#[tauri::command]
fn open_project_dialog(app: AppHandle) -> OpenProjectResult {
    let result = app.dialog().file().blocking_pick_folder();
    match result {
        Some(path) => {
            let path_str = path.to_string();
            let name = std::path::Path::new(&path_str)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Projeto".to_string());
            // Tenta carregar project.rds para obter nome real do projeto
            let project_name = {
                let dir = PathBuf::from(&path_str);
                load_project(&dir).map(|p| p.name).unwrap_or(name)
            };
            OpenProjectResult { selected: true, path: path_str, name: project_name }
        }
        None => OpenProjectResult { selected: false, path: String::new(), name: String::new() },
    }
}

/// Cria um projeto novo minimal em uma pasta selecionada.
#[tauri::command]
fn new_project_dialog(app: AppHandle, project_name: String) -> OpenProjectResult {
    let result = app.dialog().file().blocking_pick_folder();
    match result {
        Some(base) => {
            let base_str = base.to_string();
            let safe_name: String = project_name.chars()
                .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
                .collect();
            let proj_dir = PathBuf::from(&base_str).join(&safe_name);

            match create_project_skeleton(&proj_dir, &project_name, "megadrive") {
                Ok(project) => {
                    let path_str = proj_dir.to_string_lossy().to_string();
                    OpenProjectResult { selected: true, path: path_str, name: project.name }
                }
                Err(_) => OpenProjectResult { selected: false, path: String::new(), name: String::new() },
            }
        }
        None => OpenProjectResult { selected: false, path: String::new(), name: String::new() },
    }
}

/// Resolve um diretório de projeto sem depender de diálogo nativo.
#[tauri::command]
fn open_project_path(project_dir: String) -> OpenProjectResult {
    let trimmed = project_dir.trim();
    if trimmed.is_empty() {
        return OpenProjectResult { selected: false, path: String::new(), name: String::new() };
    }

    let dir = PathBuf::from(trimmed);
    let project = match load_project(&dir) {
        Ok(project) => project,
        Err(_) => {
            return OpenProjectResult { selected: false, path: String::new(), name: String::new() };
        }
    };

    OpenProjectResult {
        selected: true,
        path: dir.to_string_lossy().to_string(),
        name: project.name,
    }
}

// ── App Builder ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(EmulatorCoreState(Mutex::new(EmulatorCore::new(None))))
        .manage(ProjectAssetWatchState::default())
        .invoke_handler(tauri::generate_handler![
            // Build pipeline
            validate_project,
            generate_c_code,
            build_project,
            build_multi_target,
            validate_scene_draft,
            poll_project_asset_changes,
            // Hardware status
            get_hw_status,
            // Emulator
            emulator_load_rom,
            emulator_run_frame,
            emulator_save_state,
            emulator_load_state,
            emulator_rewind_step,
            emulator_read_memory,
            emulator_send_input,
            emulator_stop,
            // Cena
            get_scene_data,
            switch_scene,
            list_scenes,
            create_scene,
            save_scene_data,
            set_project_target,
            // Projeto
            open_project_dialog,
            open_project_path,
            new_project_dialog,
            // Fase 4: Tools
            patch_create_ips,
            patch_apply_ips,
            patch_create_bps,
            patch_apply_bps,
            profiler_analyze_rom,
            assets_extract,
            reverse_explorer_read,
            list_project_assets,
            third_party_get_status,
            third_party_install,
            third_party_detect_rom_dependency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use compiler::build_orch::{run_build_with_environment, BuildEnvironment};
    use emulator::libretro_ffi::test_serial_guard;
    use std::fs;
    use std::hash::{Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tools::dependency_manager::{dependency_status_report, install_dependency};

    fn temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-e2e-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("failed to create temp dir");
        path
    }

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
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

    fn compile_mock_core(dir: &Path) -> PathBuf {
        let source_path = dir.join("mock_core.rs");
        let output_path = dir.join(if cfg!(target_os = "windows") {
            "mock_core.dll"
        } else if cfg!(target_os = "macos") {
            "mock_core.dylib"
        } else {
            "mock_core.so"
        });

        fs::write(&source_path, mock_core_source()).expect("write mock core source");
        let output = std::process::Command::new("rustc")
            .arg("--crate-type")
            .arg("cdylib")
            .arg("--edition")
            .arg("2021")
            .arg(&source_path)
            .arg("-O")
            .arg("-o")
            .arg(&output_path)
            .output()
            .expect("spawn rustc for mock core");

        if !output.status.success() {
            panic!(
                "mock core compilation failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }

        for _ in 0..20 {
            if unsafe { libloading::Library::new(&output_path) }.is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        output_path
    }

    fn write_test_rom(dir: &Path, name: &str, extension: &str) -> PathBuf {
        let path = dir.join(format!("{}.{}", name, extension));
        let mut bytes = vec![0u8; 0x200];
        bytes[0x100..0x10F].copy_from_slice(b"SEGA MEGA DRIVE");
        fs::write(&path, bytes).expect("write test rom");
        path
    }

    fn stable_hash(bytes: &[u8]) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        bytes.hash(&mut hasher);
        hasher.finish()
    }

    fn fake_make_script(dir: &Path) -> PathBuf {
        let path = if cfg!(target_os = "windows") {
            dir.join("fake-make.cmd")
        } else {
            dir.join("fake-make.sh")
        };

        let content = if cfg!(target_os = "windows") {
            "@echo off\r\n\
             if not exist out mkdir out\r\n\
             powershell -NoProfile -Command \"$bytes = New-Object byte[] 512; [System.Text.Encoding]::ASCII.GetBytes('SEGA MEGA DRIVE').CopyTo($bytes, 256); [IO.File]::WriteAllBytes('out\\\\artifact.md', $bytes)\"\r\n\
             echo fake build completed\r\n\
             exit /b 0\r\n"
                .to_string()
        } else {
            "#!/bin/sh\n\
             mkdir -p out\n\
             python - <<'PY'\n\
import pathlib\n\
rom = bytearray(512)\n\
rom[0x100:0x10F] = b'SEGA MEGA DRIVE'\n\
pathlib.Path('out/artifact.md').write_bytes(rom)\n\
PY\n\
             echo fake build completed\n"
                .to_string()
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

    fn mock_core_source() -> String {
        r#"
use std::ffi::{c_char, c_void, CStr};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

type RetroEnvironmentCallback = extern "C" fn(cmd: u32, data: *mut c_void) -> bool;
type RetroVideoRefreshCallback = extern "C" fn(data: *const c_void, width: u32, height: u32, pitch: usize);
type RetroAudioSampleCallback = extern "C" fn(left: i16, right: i16);
type RetroAudioSampleBatchCallback = extern "C" fn(data: *const i16, frames: usize) -> usize;
type RetroInputPollCallback = extern "C" fn();
type RetroInputStateCallback = extern "C" fn(port: u32, device: u32, index: u32, id: u32) -> i16;

#[repr(C)]
struct RetroGameInfo {
    path: *const c_char,
    data: *const c_void,
    size: usize,
    meta: *const c_char,
}

#[repr(C)]
struct RetroSystemInfo {
    library_name: *const c_char,
    library_version: *const c_char,
    valid_extensions: *const c_char,
    need_fullpath: bool,
    block_extract: bool,
}

#[repr(C)]
struct RetroGameGeometry {
    base_width: u32,
    base_height: u32,
    max_width: u32,
    max_height: u32,
    aspect_ratio: f32,
}

#[repr(C)]
struct RetroSystemTiming {
    fps: f64,
    sample_rate: f64,
}

#[repr(C)]
struct RetroSystemAvInfo {
    geometry: RetroGameGeometry,
    timing: RetroSystemTiming,
}

static LIB_NAME: &[u8] = b"MockLibretroCore\0";
static LIB_VERSION: &[u8] = b"1.0.0\0";
static VALID_EXTENSIONS: &[u8] = b"md|bin|gen\0";
static FRAME_COUNTER: AtomicUsize = AtomicUsize::new(0);
static mut ENV: Option<RetroEnvironmentCallback> = None;
static mut VIDEO: Option<RetroVideoRefreshCallback> = None;
static mut AUDIO: Option<RetroAudioSampleCallback> = None;
static mut AUDIO_BATCH: Option<RetroAudioSampleBatchCallback> = None;
static mut INPUT_POLL: Option<RetroInputPollCallback> = None;
static mut INPUT_STATE: Option<RetroInputStateCallback> = None;
static mut FRAMEBUFFER: [u8; 256 * 224 * 4] = [0; 256 * 224 * 4];
static mut SAVE_RAM: [u8; 32] = [0; 32];
static mut SYSTEM_RAM: [u8; 64] = [0; 64];
static mut VIDEO_RAM: [u8; 128] = [0; 128];

#[no_mangle]
pub extern "C" fn retro_set_environment(callback: Option<RetroEnvironmentCallback>) {
    unsafe {
        ENV = callback;
        if let Some(env) = ENV {
            let mut pixel_format = 1u32;
            env(10, &mut pixel_format as *mut _ as *mut c_void);
        }
    }
}

#[no_mangle]
pub extern "C" fn retro_set_video_refresh(callback: Option<RetroVideoRefreshCallback>) {
    unsafe { VIDEO = callback; }
}

#[no_mangle]
pub extern "C" fn retro_set_audio_sample(callback: Option<RetroAudioSampleCallback>) {
    unsafe { AUDIO = callback; }
}

#[no_mangle]
pub extern "C" fn retro_set_audio_sample_batch(callback: Option<RetroAudioSampleBatchCallback>) {
    unsafe { AUDIO_BATCH = callback; }
}

#[no_mangle]
pub extern "C" fn retro_set_input_poll(callback: Option<RetroInputPollCallback>) {
    unsafe { INPUT_POLL = callback; }
}

#[no_mangle]
pub extern "C" fn retro_set_input_state(callback: Option<RetroInputStateCallback>) {
    unsafe { INPUT_STATE = callback; }
}

#[no_mangle]
pub extern "C" fn retro_init() {}

#[no_mangle]
pub extern "C" fn retro_deinit() {}

#[no_mangle]
pub extern "C" fn retro_api_version() -> u32 { 1 }

#[no_mangle]
pub extern "C" fn retro_get_system_info(info: *mut RetroSystemInfo) {
    unsafe {
        (*info).library_name = LIB_NAME.as_ptr().cast::<c_char>();
        (*info).library_version = LIB_VERSION.as_ptr().cast::<c_char>();
        (*info).valid_extensions = VALID_EXTENSIONS.as_ptr().cast::<c_char>();
        (*info).need_fullpath = true;
        (*info).block_extract = false;
    }
}

#[no_mangle]
pub extern "C" fn retro_get_system_av_info(info: *mut RetroSystemAvInfo) {
    unsafe {
        (*info).geometry.base_width = 256;
        (*info).geometry.base_height = 224;
        (*info).geometry.max_width = 256;
        (*info).geometry.max_height = 224;
        (*info).geometry.aspect_ratio = 256.0 / 224.0;
        (*info).timing.fps = 60.0;
        (*info).timing.sample_rate = 44100.0;
    }
}

#[no_mangle]
pub extern "C" fn retro_load_game(info: *const RetroGameInfo) -> bool {
    unsafe {
        if info.is_null() || (*info).path.is_null() {
            return false;
        }
        let path = CStr::from_ptr((*info).path).to_string_lossy().into_owned();
        let exists = Path::new(&path).exists();
        if exists {
            for index in 0..32 {
                SAVE_RAM[index] = 0xA0u8.wrapping_add(index as u8);
            }
            for index in 0..64 {
                SYSTEM_RAM[index] = index as u8;
            }
            for index in 0..128 {
                VIDEO_RAM[index] = 0xF0u8.wrapping_sub(index as u8);
            }
        }
        exists
    }
}

#[no_mangle]
pub extern "C" fn retro_unload_game() {}

#[no_mangle]
pub extern "C" fn retro_serialize_size() -> usize { 8 }

#[no_mangle]
pub extern "C" fn retro_serialize(data: *mut c_void, size: usize) -> bool {
    if data.is_null() || size < 8 {
        return false;
    }

    let bytes = (FRAME_COUNTER.load(Ordering::SeqCst) as u64).to_le_bytes();
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), data.cast::<u8>(), bytes.len());
    }
    true
}

#[no_mangle]
pub extern "C" fn retro_unserialize(data: *const c_void, size: usize) -> bool {
    if data.is_null() || size < 8 {
        return false;
    }

    let mut bytes = [0u8; 8];
    unsafe {
        std::ptr::copy_nonoverlapping(data.cast::<u8>(), bytes.as_mut_ptr(), bytes.len());
    }
    FRAME_COUNTER.store(u64::from_le_bytes(bytes) as usize, Ordering::SeqCst);
    true
}

#[no_mangle]
pub extern "C" fn retro_get_memory_data(id: u32) -> *mut c_void {
    unsafe {
        match id {
            0 => SAVE_RAM.as_mut_ptr().cast::<c_void>(),
            2 => SYSTEM_RAM.as_mut_ptr().cast::<c_void>(),
            3 => VIDEO_RAM.as_mut_ptr().cast::<c_void>(),
            _ => std::ptr::null_mut(),
        }
    }
}

#[no_mangle]
pub extern "C" fn retro_get_memory_size(id: u32) -> usize {
    match id {
        0 => 32,
        2 => 64,
        3 => 128,
        _ => 0,
    }
}

#[no_mangle]
pub extern "C" fn retro_run() {
    let frame = FRAME_COUNTER.fetch_add(1, Ordering::SeqCst) as u8;
    let audio_samples = [
        frame as i16,
        -(frame as i16),
        frame.wrapping_add(1) as i16,
        -((frame.wrapping_add(1)) as i16),
    ];
    unsafe {
        if let Some(input_poll) = INPUT_POLL {
            input_poll();
        }
        let blue = INPUT_STATE
            .map(|input| if input(0, 1, 0, 8) != 0 { 0xFF } else { frame.wrapping_mul(3) })
            .unwrap_or(frame.wrapping_mul(3));
        for index in 0..(256 * 224) {
            let offset = index * 4;
            let pixel = u32::from(0x00220000u32 | ((frame as u32) << 8) | blue as u32);
            FRAMEBUFFER[offset..offset + 4].copy_from_slice(&pixel.to_le_bytes());
        }
        if let Some(video) = VIDEO {
            video(FRAMEBUFFER.as_ptr().cast::<c_void>(), 256, 224, 256 * 4);
        }
        if let Some(audio_batch) = AUDIO_BATCH {
            audio_batch(audio_samples.as_ptr(), 2);
        } else if let Some(audio) = AUDIO {
            audio(audio_samples[0], audio_samples[1]);
            audio(audio_samples[2], audio_samples[3]);
        }
    }
}
"#
        .to_string()
    }

    #[test]
    fn e2e_build_load_and_run_frame() {
        let _serial = test_serial_guard();
        let project_dir = temp_dir("megadrive-e2e");
        copy_dir_all(&fixture_dir("megadrive_dummy"), &project_dir);

        let toolchain_root = temp_dir("fake-sgdk");
        let bin_dir = toolchain_root.join("bin");
        fs::create_dir_all(&bin_dir).expect("create fake bin");
        let make_program = fake_make_script(&bin_dir);
        let environment = BuildEnvironment {
            sgdk_root: Some(toolchain_root),
            sgdk_make_program: Some(make_program),
            ..BuildEnvironment::default()
        };

        let build_result = run_build_with_environment(&project_dir, &environment, |_| {});
        assert!(build_result.ok, "build failed: {:?}", build_result.log);

        let core_dir = temp_dir("mock-core");
        let core_path = compile_mock_core(&core_dir);
        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(Path::new(&build_result.rom_path))
            .expect("load built rom");
        emulator
            .set_joypad(JoypadState {
                a: true,
                ..JoypadState::default()
            })
            .expect("set joypad");
        emulator.run_frame().expect("run frame");

        let (framebuffer, size, pixel_format) =
            emulator.get_framebuffer().expect("read framebuffer");

        assert_eq!(size.width, 256);
        assert_eq!(size.height, 224);
        assert_eq!(pixel_format, emulator::libretro_ffi::PixelFormat::Xrgb8888);
        assert!(framebuffer.iter().any(|byte| *byte != 0));

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(project_dir);
        let _ = fs::remove_dir_all(core_dir);
    }

    #[test]
    fn emit_emulator_frame_events_emits_audio_payload_from_mock_core() {
        let _serial = test_serial_guard();
        let dir = temp_dir("mock-audio-event");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "audio_event", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator.load_rom(&rom_path).expect("load rom into mock core");
        emulator.run_frame().expect("run frame");

        #[derive(Default)]
        struct MockEventSink {
            frames: std::sync::Mutex<Vec<emulator::frame_buffer::FramePayload>>,
            audios: std::sync::Mutex<Vec<AudioPayload>>,
        }

        impl EmulatorEventSink for MockEventSink {
            fn emit_frame(
                &self,
                payload: &emulator::frame_buffer::FramePayload,
            ) -> Result<(), String> {
                self.frames
                    .lock()
                    .expect("lock frame events")
                    .push(payload.clone());
                Ok(())
            }

            fn emit_audio(&self, payload: &AudioPayload) -> Result<(), String> {
                self.audios
                    .lock()
                    .expect("lock audio events")
                    .push(payload.clone());
                Ok(())
            }
        }

        let sink = MockEventSink::default();
        emit_emulator_frame_events(&sink, &mut emulator).expect("emit emulator events");

        let payload = sink
            .audios
            .lock()
            .expect("lock audio events")
            .first()
            .cloned()
            .expect("receive audio payload");
        assert_eq!(
            payload,
            AudioPayload {
                sample_rate: 44_100,
                samples: vec![0, 0, 1, -1],
            }
        );
        assert_eq!(
            sink.frames
                .lock()
                .expect("lock frame events")
                .len(),
            1
        );
        assert!(
            emulator
                .take_audio_samples()
                .expect("audio buffer should be drained")
                .1
                .is_empty()
        );

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "Downloads official upstream dependencies and requires Windows with network access"]
    fn official_windows_upstream_validation_smoke_test() {
        if !cfg!(target_os = "windows") {
            panic!("official_windows_upstream_validation_smoke_test requires Windows");
        }

        let _serial = test_serial_guard();

        for dependency_id in [
            "sgdk",
            "pvsneslib",
            "libretro_megadrive",
            "libretro_snes",
        ] {
            let result = install_dependency(dependency_id, |_| {});
            assert!(
                result.ok,
                "failed to install {}: {}",
                dependency_id,
                result.message
            );
        }

        let status_report = dependency_status_report();
        for dependency_id in [
            "sgdk",
            "pvsneslib",
            "libretro_megadrive",
            "libretro_snes",
        ] {
            let item = status_report
                .items
                .iter()
                .find(|item| item.id == dependency_id)
                .unwrap_or_else(|| panic!("missing dependency status for {}", dependency_id));
            assert!(
                item.installed,
                "dependency {} still not installed: {:?}",
                dependency_id,
                item.issues
            );
        }

        for (target, fixture_name) in [("megadrive", "megadrive_dummy"), ("snes", "snes_dummy")] {
            let project_dir = temp_dir(&format!("official-{}", target));
            copy_dir_all(&fixture_dir(fixture_name), &project_dir);

            let build_result = run_build(&project_dir, |_| {});
            assert!(
                build_result.ok,
                "{} build failed: {:?}",
                target,
                build_result.log
            );

            let mut emulator = EmulatorCore::new(None);
            emulator
                .load_rom(Path::new(&build_result.rom_path))
                .unwrap_or_else(|error| panic!("failed to load {} rom: {}", target, error));
            for _ in 0..5 {
                emulator
                    .run_frame()
                    .unwrap_or_else(|error| panic!("failed to run {} frame: {}", target, error));
            }

            let (framebuffer, size, _) = emulator
                .get_framebuffer()
                .unwrap_or_else(|error| panic!("failed to read {} framebuffer: {}", target, error));

            assert!(size.width > 0, "{} framebuffer width should be non-zero", target);
            assert!(size.height > 0, "{} framebuffer height should be non-zero", target);
            assert!(
                !framebuffer.is_empty(),
                "{} framebuffer should not be empty after running frames",
                target
            );

            emulator
                .stop()
                .unwrap_or_else(|error| panic!("failed to stop {} emulator: {}", target, error));
            let _ = fs::remove_dir_all(project_dir);
        }
    }

    #[test]
    fn patch_studio_bps_roundtrip_preserves_modified_project_rom_hash() {
        let dir = temp_dir("patch-project");
        let original = fixture_dir("snes_dummy")
            .join("build")
            .join("snes")
            .join("canonical_snes_dummy.sfc");
        let modified = dir.join("canonical_snes_dummy_modified.sfc");
        let patch = dir.join("project_assets.bps");
        let restored = dir.join("canonical_snes_dummy_restored.sfc");

        let mut modified_bytes = fs::read(&original).expect("read canonical snes rom");
        let replacement_asset = fs::read(
            fixture_dir("snes_dummy")
                .join("assets")
                .join("sprites")
                .join("hero.ppm"),
        )
        .expect("read replacement asset");
        let replacement_start = 0x2000usize;
        let replacement_end = replacement_start + replacement_asset.len().min(512);
        modified_bytes[replacement_start..replacement_end]
            .copy_from_slice(&replacement_asset[..replacement_end - replacement_start]);
        fs::write(&modified, &modified_bytes).expect("write modified rom");

        let create = patch_create_bps(
            original.to_string_lossy().to_string(),
            modified.to_string_lossy().to_string(),
            patch.to_string_lossy().to_string(),
        );
        assert!(create.ok, "create patch failed: {}", create.message);

        let apply = patch_apply_bps(
            original.to_string_lossy().to_string(),
            patch.to_string_lossy().to_string(),
            restored.to_string_lossy().to_string(),
        );
        assert!(apply.ok, "apply patch failed: {}", apply.message);

        let restored_bytes = fs::read(&restored).expect("read restored rom");
        assert_eq!(restored_bytes, modified_bytes);
        assert_eq!(stable_hash(&restored_bytes), stable_hash(&modified_bytes));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn profiler_command_reports_detected_sat_activity() {
        let dir = temp_dir("profiler-command");
        let rom_path = dir.join("profile_test.md");
        let mut rom = vec![0u8; 0x4000];
        rom[0x100..0x10F].copy_from_slice(b"SEGA MEGA DRIVE");
        let sat_offset = 0x1800usize;

        for sprite_idx in 0..6usize {
            let base = sat_offset + (sprite_idx * 8);
            let y = (128 + sprite_idx as u16 * 4) & 0x01FF;
            let x = 192u16 & 0x01FF;
            rom[base..base + 2].copy_from_slice(&y.to_be_bytes());
            rom[base + 2] = 0b0000_0101;
            rom[base + 3] = if sprite_idx == 5 { 0 } else { (sprite_idx + 1) as u8 };
            rom[base + 6..base + 8].copy_from_slice(&x.to_be_bytes());
        }
        fs::write(&rom_path, rom).expect("write profiler rom");

        let report = profiler_analyze_rom(rom_path.to_string_lossy().to_string());
        assert!(report.ok, "profiler failed: {}", report.error);
        assert_eq!(report.sprite_count, 6);
        assert!(report.sprite_peak >= 1);
        assert!(!report.issues.is_empty());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn open_project_path_accepts_canonical_fixture() {
        let project_dir = fixture_dir("megadrive_dummy");
        let result = open_project_path(project_dir.to_string_lossy().to_string());

        assert!(result.selected);
        assert_eq!(result.path, project_dir.to_string_lossy());
        assert!(!result.name.trim().is_empty());
    }

    #[test]
    fn open_project_path_rejects_invalid_directory() {
        let project_dir = temp_dir("invalid-project-path");
        let result = open_project_path(project_dir.to_string_lossy().to_string());

        assert!(!result.selected);
        assert!(result.path.is_empty());
        assert!(result.name.is_empty());

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn diff_asset_fingerprints_detects_added_changed_and_removed_assets() {
        let previous = HashMap::from([
            (
                "assets/sprites/hero.ppm".to_string(),
                AssetFingerprint {
                    modified_ms: 10,
                    size: 128,
                },
            ),
            (
                "assets/audio/theme.wav".to_string(),
                AssetFingerprint {
                    modified_ms: 20,
                    size: 256,
                },
            ),
        ]);
        let current = HashMap::from([
            (
                "assets/sprites/hero.ppm".to_string(),
                AssetFingerprint {
                    modified_ms: 11,
                    size: 128,
                },
            ),
            (
                "assets/backgrounds/intro.ppm".to_string(),
                AssetFingerprint {
                    modified_ms: 30,
                    size: 512,
                },
            ),
        ]);

        let changed = diff_asset_fingerprints(&previous, &current);

        assert_eq!(
            changed,
            vec![
                "assets/audio/theme.wav".to_string(),
                "assets/backgrounds/intro.ppm".to_string(),
                "assets/sprites/hero.ppm".to_string(),
            ]
        );
    }

    #[test]
    fn snapshot_project_assets_returns_empty_when_project_has_no_assets_directory() {
        let dir = temp_dir("snapshot-project-assets-empty");

        let snapshot = snapshot_project_assets(&dir).expect("snapshot assets without directory");

        assert!(snapshot.is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
