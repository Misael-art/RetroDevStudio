mod compiler;
mod core;
mod emulator;
mod hardware;
mod tools;
mod ugdm;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use compiler::ast_generator::generate_ast;
use compiler::build_orch::{run_build, BuildLogLine, BuildResult};
use compiler::sgdk_emitter::emit_sgdk;
use compiler::snes_emitter::emit_snes;
use core::project_mgr::{load_project, load_scene};
use emulator::frame_buffer::xrgb8888_to_rgba;
use emulator::libretro_ffi::{EmulatorCore, JoypadState};
use hardware::md_profile;
use hardware::snes_profile;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

// HwStatus canônico definido em hardware::mod
use hardware::HwStatus;

// ── App State ─────────────────────────────────────────────────────────────────

/// Estado global do emulador, gerenciado pelo Tauri via `manage()`.
struct EmulatorCoreState(Mutex<EmulatorCore>);

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

// ── Build commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn validate_project(project_dir: String) -> ValidationResult {
    let dir = PathBuf::from(&project_dir);

    let project = match load_project(&dir) {
        Ok(p) => p,
        Err(e) => return ValidationResult { ok: false, errors: vec![e.to_string()], warnings: vec![] },
    };
    let scene = match load_scene(&dir, &project.entry_scene) {
        Ok(s) => s,
        Err(e) => return ValidationResult { ok: false, errors: vec![e.to_string()], warnings: vec![] },
    };
    let hw_errors: Vec<(String, bool)> = match project.target.as_str() {
        "megadrive" => md_profile::validate_scene(&scene)
            .into_iter().map(|e| (e.message, e.is_fatal)).collect(),
        "snes" => snes_profile::validate_scene(&scene)
            .into_iter().map(|e| (e.message, e.is_fatal)).collect(),
        other => return ValidationResult {
            ok: false,
            errors: vec![format!("Target '{}' não suportado. Use 'megadrive' ou 'snes'.", other)],
            warnings: vec![],
        },
    };

    let errors: Vec<String> = hw_errors.iter().filter(|(_, f)| *f).map(|(m, _)| m.clone()).collect();
    let warnings: Vec<String> = hw_errors.iter().filter(|(_, f)| !*f).map(|(m, _)| m.clone()).collect();
    ValidationResult { ok: errors.is_empty(), errors, warnings }
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
    let hw_errors: Vec<(String, bool)> = match project.target.as_str() {
        "megadrive" => md_profile::validate_scene(&scene)
            .into_iter().map(|e| (e.message, e.is_fatal)).collect(),
        "snes" => snes_profile::validate_scene(&scene)
            .into_iter().map(|e| (e.message, e.is_fatal)).collect(),
        other => return GenerateResult {
            ok: false, main_c: String::new(), resources_res: String::new(),
            errors: vec![format!("Target '{}' não suportado. Use 'megadrive' ou 'snes'.", other)],
            warnings: vec![],
        },
    };

    let errors: Vec<String> = hw_errors.iter().filter(|(_, f)| *f).map(|(m, _)| m.clone()).collect();
    let warnings: Vec<String> = hw_errors.iter().filter(|(_, f)| !*f).map(|(m, _)| m.clone()).collect();
    if !errors.is_empty() {
        return GenerateResult { ok: false, main_c: String::new(), resources_res: String::new(), errors, warnings };
    }

    let ast = generate_ast(&project, &scene);
    let (main_c, resources_res) = match project.target.as_str() {
        "snes" => { let o = emit_snes(&ast, &project.name); (o.main_c, o.resources_res) }
        _ => { let o = emit_sgdk(&ast, &project.name); (o.main_c, o.resources_res) }
    };
    GenerateResult { ok: true, main_c, resources_res, errors: vec![], warnings }
}

#[tauri::command]
fn build_project(app: AppHandle, project_dir: String) -> BuildResult {
    let dir = PathBuf::from(&project_dir);
    run_build(&dir, move |line: BuildLogLine| {
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
    let project = match load_project(&dir) {
        Ok(p) => p,
        Err(_) => return HwStatus::default(),
    };
    let scene = match load_scene(&dir, &project.entry_scene) {
        Ok(s) => s,
        Err(_) => return HwStatus::default(),
    };
    match project.target.as_str() {
        "snes" => snes_profile::hw_status(&scene),
        _ => md_profile::hw_status(&scene),
    }
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
            message: format!("ROM carregada: {}", rom_path),
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

    let (fb, size) = match core.get_framebuffer() {
        Ok(r) => r,
        Err(e) => return EmulatorCommandResult { ok: false, message: e },
    };

    let payload = xrgb8888_to_rgba(&fb, size);
    let _ = app.emit("emulator://frame", &payload);

    EmulatorCommandResult { ok: true, message: String::new() }
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
use tools::asset_extractor::{ExtractionResult, extract_assets};

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
fn assets_extract(rom_path: String, output_dir: String, max_tiles: u32, palette_slot: u8) -> ExtractionResult {
    extract_assets(Path::new(&rom_path), Path::new(&output_dir), max_tiles, palette_slot)
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
            let _ = std::fs::create_dir_all(&proj_dir);

            // Escreve project.rds mínimo
            let rds = serde_json::json!({
                "name": project_name,
                "version": "1.0.0",
                "target": "megadrive",
                "fps": 60,
                "entry_scene": "scenes/main.json"
            });
            let scenes_dir = proj_dir.join("scenes");
            let _ = std::fs::create_dir_all(&scenes_dir);
            let _ = std::fs::write(proj_dir.join("project.rds"), rds.to_string());

            // Escreve cena vazia
            let scene = serde_json::json!({
                "name": "main",
                "entities": []
            });
            let _ = std::fs::write(scenes_dir.join("main.json"), scene.to_string());

            let path_str = proj_dir.to_string_lossy().to_string();
            OpenProjectResult { selected: true, path: path_str, name: project_name }
        }
        None => OpenProjectResult { selected: false, path: String::new(), name: String::new() },
    }
}

// ── App Builder ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(EmulatorCoreState(Mutex::new(EmulatorCore::new(None))))
        .invoke_handler(tauri::generate_handler![
            // Build pipeline
            validate_project,
            generate_c_code,
            build_project,
            // Hardware status
            get_hw_status,
            // Emulator
            emulator_load_rom,
            emulator_run_frame,
            emulator_send_input,
            emulator_stop,
            // Projeto
            open_project_dialog,
            new_project_dialog,
            // Fase 4: Tools
            patch_create_ips,
            patch_apply_ips,
            patch_create_bps,
            patch_apply_bps,
            profiler_analyze_rom,
            assets_extract,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
