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

// ── App Builder ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
