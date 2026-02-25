//! Libretro API — integração com Genesis Plus GX core.
//!
//! Fluxo: load_rom → loop { run_frame → get_framebuffer → emit } → stop.
//! Sem core .dll instalado, opera em modo simulado (gradiente animado).

use std::path::Path;
use std::sync::{Arc, Mutex};

// ── Libretro C API types ───────────────────────────────────────────────────────

/// Resolução do framebuffer (Mega Drive: 320x224 ou 256x224)
/// Resolução do framebuffer. `pitch` será usado pelo core real na Sprint 1.4 final.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct FrameSize {
    pub width: u32,
    pub height: u32,
    pub pitch: u32,
}

/// Formato de pixel reportado pelo core Libretro.
/// Variantes Xrgb1555/Rgb565 usadas pelo core real (Sprint 1.4 final).
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum PixelFormat {
    Xrgb1555,
    Xrgb8888,
    Rgb565,
}

/// Mapeamento dos botões do joypad Libretro (índices RETRO_DEVICE_ID_JOYPAD_*)
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct JoypadState {
    pub b: bool,      // 0
    pub y: bool,      // 1
    pub select: bool, // 2
    pub start: bool,  // 3
    pub up: bool,     // 4
    pub down: bool,   // 5
    pub left: bool,   // 6
    pub right: bool,  // 7
    pub a: bool,      // 8
    pub x: bool,      // 9
    pub l: bool,      // 10
    pub r: bool,      // 11
}

impl JoypadState {
    /// Retorna o bit correspondente ao índice Libretro. Usado pelo core real (Sprint 1.4 final).
    #[allow(dead_code)]
    pub fn button(&self, id: u8) -> bool {
        match id {
            0  => self.b,
            1  => self.y,
            2  => self.select,
            3  => self.start,
            4  => self.up,
            5  => self.down,
            6  => self.left,
            7  => self.right,
            8  => self.a,
            9  => self.x,
            10 => self.l,
            11 => self.r,
            _  => false,
        }
    }
}

// ── Emulator state (thread-safe singleton) ────────────────────────────────────

#[derive(Debug)]
pub struct EmulatorState {
    pub running: bool,
    pub frame_size: FrameSize,
    /// pixel_format será definido pelo core real via retro_set_pixel_format (Sprint 1.4 final)
    #[allow(dead_code)]
    pub pixel_format: PixelFormat,
    /// XRGB8888 framebuffer: width * height * 4 bytes
    pub framebuffer: Vec<u8>,
    pub joypad: JoypadState,
    pub rom_path: String,
}

impl Default for EmulatorState {
    fn default() -> Self {
        Self {
            running: false,
            frame_size: FrameSize { width: 320, height: 224, pitch: 320 * 4 },
            pixel_format: PixelFormat::Xrgb8888,
            framebuffer: vec![0u8; 320 * 224 * 4],
            joypad: JoypadState::default(),
            rom_path: String::new(),
        }
    }
}

/// Handle global do estado do emulador, compartilhado entre threads Tauri.
pub type EmulatorHandle = Arc<Mutex<EmulatorState>>;

pub fn new_emulator_handle() -> EmulatorHandle {
    Arc::new(Mutex::new(EmulatorState::default()))
}

// ── EmulatorCore — wrapper de alto nível ──────────────────────────────────────

/// Interface de alto nível para o core Libretro.
///
/// Na Fase 1 (sem a .dll presente), opera em modo "headless simulado":
/// gera um framebuffer de teste (gradiente animado) para validar o pipeline
/// React ↔ Rust sem depender do Genesis Plus GX compilado.
pub struct EmulatorCore {
    pub handle: EmulatorHandle,
    frame_counter: u64,
    core_available: bool,
}

impl EmulatorCore {
    /// Cria um novo core. Tenta localizar a .dll do Genesis Plus GX;
    /// se não encontrada, opera em modo simulado.
    pub fn new(core_path: Option<&Path>) -> Self {
        let core_available = core_path.map(|p| p.exists()).unwrap_or(false);
        Self {
            handle: new_emulator_handle(),
            frame_counter: 0,
            core_available,
        }
    }

    /// Carrega uma ROM .md no emulador.
    pub fn load_rom(&mut self, rom_path: &Path) -> Result<(), String> {
        let mut state = self.handle.lock().map_err(|e| e.to_string())?;

        if !rom_path.exists() {
            return Err(format!("ROM não encontrada: {}", rom_path.display()));
        }

        state.rom_path = rom_path.to_string_lossy().to_string();
        state.running = true;
        self.frame_counter = 0;

        Ok(())
    }

    /// Executa um frame e atualiza o framebuffer.
    /// - Com core real: delega para `retro_run()` via FFI
    /// - Sem core (modo simulado): gera gradiente animado para testar o pipeline
    pub fn run_frame(&mut self) -> Result<(), String> {
        let mut state = self.handle.lock().map_err(|e| e.to_string())?;

        if !state.running {
            return Err("Emulador não inicializado. Carregue uma ROM primeiro.".into());
        }

        if self.core_available {
            // TODO Sprint 1.4 final: chamar retro_run() via libloading FFI
            // Por agora usa o simulador mesmo com core detectado
        }

        // Modo simulado: gradiente animado 320x224 XRGB8888
        // Valida que o pipeline completo (Rust → IPC → Canvas) funciona
        let w = state.frame_size.width as usize;
        let h = state.frame_size.height as usize;
        let t = self.frame_counter;

        for y in 0..h {
            for x in 0..w {
                let offset = (y * w + x) * 4;
                let r = (((x as u64 + t) * 255 / w as u64) & 0xFF) as u8;
                let g = (((y as u64 + t / 2) * 255 / h as u64) & 0xFF) as u8;
                let b = ((t * 4) & 0xFF) as u8;
                state.framebuffer[offset]     = 0xFF; // X (padding)
                state.framebuffer[offset + 1] = r;
                state.framebuffer[offset + 2] = g;
                state.framebuffer[offset + 3] = b;
            }
        }

        self.frame_counter = self.frame_counter.wrapping_add(1);
        Ok(())
    }

    /// Retorna uma cópia do framebuffer atual.
    pub fn get_framebuffer(&self) -> Result<(Vec<u8>, FrameSize), String> {
        let state = self.handle.lock().map_err(|e| e.to_string())?;
        Ok((state.framebuffer.clone(), state.frame_size))
    }

    /// Atualiza o estado dos botões do joypad 1.
    pub fn set_joypad(&self, joypad: JoypadState) -> Result<(), String> {
        let mut state = self.handle.lock().map_err(|e| e.to_string())?;
        state.joypad = joypad;
        Ok(())
    }

    /// Para o emulador e libera recursos.
    pub fn stop(&mut self) -> Result<(), String> {
        let mut state = self.handle.lock().map_err(|e| e.to_string())?;
        state.running = false;
        state.framebuffer.fill(0);
        Ok(())
    }

    /// Usado pelo frontend poll loop para verificar estado. Sprint 1.4 final.
    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.handle
            .lock()
            .map(|s| s.running)
            .unwrap_or(false)
    }
}
