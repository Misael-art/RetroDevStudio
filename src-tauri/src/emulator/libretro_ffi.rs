use std::ffi::{c_char, c_void, CStr, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use libloading::Library;

const RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: u32 = 10;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Xrgb1555 = 0,
    Xrgb8888 = 1,
    Rgb565 = 2,
}

impl PixelFormat {
    fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Xrgb8888 => 4,
            Self::Xrgb1555 | Self::Rgb565 => 2,
        }
    }

    fn from_raw(raw: u32) -> Option<Self> {
        match raw {
            0 => Some(Self::Xrgb1555),
            1 => Some(Self::Xrgb8888),
            2 => Some(Self::Rgb565),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameSize {
    pub width: u32,
    pub height: u32,
    pub pitch: u32,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct JoypadState {
    pub b: bool,
    pub y: bool,
    pub select: bool,
    pub start: bool,
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub a: bool,
    pub x: bool,
    pub l: bool,
    pub r: bool,
}

impl JoypadState {
    pub fn button(&self, id: u8) -> bool {
        match id {
            0 => self.b,
            1 => self.y,
            2 => self.select,
            3 => self.start,
            4 => self.up,
            5 => self.down,
            6 => self.left,
            7 => self.right,
            8 => self.a,
            9 => self.x,
            10 => self.l,
            11 => self.r,
            _ => false,
        }
    }
}

#[derive(Debug)]
pub struct EmulatorState {
    pub running: bool,
    pub frame_size: FrameSize,
    pub pixel_format: PixelFormat,
    pub framebuffer: Vec<u8>,
    pub joypad: JoypadState,
    pub rom_path: String,
}

impl Default for EmulatorState {
    fn default() -> Self {
        Self {
            running: false,
            frame_size: FrameSize {
                width: 320,
                height: 224,
                pitch: 320 * 4,
            },
            pixel_format: PixelFormat::Xrgb8888,
            framebuffer: vec![0u8; 320 * 224 * 4],
            joypad: JoypadState::default(),
            rom_path: String::new(),
        }
    }
}

pub type EmulatorHandle = Arc<Mutex<EmulatorState>>;

pub fn new_emulator_handle() -> EmulatorHandle {
    Arc::new(Mutex::new(EmulatorState::default()))
}

static ACTIVE_EMULATOR: OnceLock<Mutex<Option<EmulatorHandle>>> = OnceLock::new();
#[cfg(test)]
static TEST_SERIAL: OnceLock<Mutex<()>> = OnceLock::new();

fn active_emulator_slot() -> &'static Mutex<Option<EmulatorHandle>> {
    ACTIVE_EMULATOR.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
pub(crate) fn test_serial_guard() -> std::sync::MutexGuard<'static, ()> {
    TEST_SERIAL
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("failed to lock libretro test mutex")
}

fn install_active_emulator(handle: &EmulatorHandle) -> Result<(), String> {
    let mut slot = active_emulator_slot().lock().map_err(|e| e.to_string())?;
    *slot = Some(handle.clone());
    Ok(())
}

fn clear_active_emulator() {
    if let Ok(mut slot) = active_emulator_slot().lock() {
        *slot = None;
    }
}

fn with_active_emulator<R>(f: impl FnOnce(&mut EmulatorState) -> R) -> Option<R> {
    let handle = {
        let slot = active_emulator_slot().lock().ok()?;
        slot.clone()?
    };
    let mut state = handle.lock().ok()?;
    Some(f(&mut state))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoreTarget {
    MegaDrive,
    Snes,
}

impl CoreTarget {
    fn label(self) -> &'static str {
        match self {
            Self::MegaDrive => "Mega Drive",
            Self::Snes => "SNES",
        }
    }

    fn env_var(self) -> &'static str {
        match self {
            Self::MegaDrive => "RETRODEV_LIBRETRO_CORE_MEGADRIVE",
            Self::Snes => "RETRODEV_LIBRETRO_CORE_SNES",
        }
    }

    fn candidate_names(self) -> &'static [&'static str] {
        match self {
            Self::MegaDrive => &["genesis_plus_gx_libretro", "picodrive_libretro"],
            Self::Snes => &["snes9x_libretro", "bsnes_libretro"],
        }
    }
}

type RetroEnvironmentCallback = unsafe extern "C" fn(cmd: u32, data: *mut c_void) -> bool;
type RetroVideoRefreshCallback =
    unsafe extern "C" fn(data: *const c_void, width: u32, height: u32, pitch: usize);
type RetroAudioSampleCallback = unsafe extern "C" fn(left: i16, right: i16);
type RetroAudioSampleBatchCallback =
    unsafe extern "C" fn(data: *const i16, frames: usize) -> usize;
type RetroInputPollCallback = unsafe extern "C" fn();
type RetroInputStateCallback =
    unsafe extern "C" fn(port: u32, device: u32, index: u32, id: u32) -> i16;

type RetroSetEnvironment = unsafe extern "C" fn(callback: Option<RetroEnvironmentCallback>);
type RetroSetVideoRefresh = unsafe extern "C" fn(callback: Option<RetroVideoRefreshCallback>);
type RetroSetAudioSample = unsafe extern "C" fn(callback: Option<RetroAudioSampleCallback>);
type RetroSetAudioSampleBatch =
    unsafe extern "C" fn(callback: Option<RetroAudioSampleBatchCallback>);
type RetroSetInputPoll = unsafe extern "C" fn(callback: Option<RetroInputPollCallback>);
type RetroSetInputState = unsafe extern "C" fn(callback: Option<RetroInputStateCallback>);
type RetroInit = unsafe extern "C" fn();
type RetroDeinit = unsafe extern "C" fn();
type RetroApiVersion = unsafe extern "C" fn() -> u32;
type RetroGetSystemInfo = unsafe extern "C" fn(info: *mut RetroSystemInfo);
type RetroGetSystemAvInfo = unsafe extern "C" fn(info: *mut RetroSystemAvInfo);
type RetroLoadGame = unsafe extern "C" fn(game: *const RetroGameInfo) -> bool;
type RetroUnloadGame = unsafe extern "C" fn();
type RetroRun = unsafe extern "C" fn();

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

struct CoreApi {
    set_environment: RetroSetEnvironment,
    set_video_refresh: RetroSetVideoRefresh,
    set_audio_sample: RetroSetAudioSample,
    set_audio_sample_batch: RetroSetAudioSampleBatch,
    set_input_poll: RetroSetInputPoll,
    set_input_state: RetroSetInputState,
    init: RetroInit,
    deinit: RetroDeinit,
    api_version: RetroApiVersion,
    get_system_info: RetroGetSystemInfo,
    get_system_av_info: RetroGetSystemAvInfo,
    load_game: RetroLoadGame,
    unload_game: RetroUnloadGame,
    run: RetroRun,
}

impl CoreApi {
    unsafe fn load(library: &Library) -> Result<Self, String> {
        Ok(Self {
            set_environment: *get_symbol(library, b"retro_set_environment\0")?,
            set_video_refresh: *get_symbol(library, b"retro_set_video_refresh\0")?,
            set_audio_sample: *get_symbol(library, b"retro_set_audio_sample\0")?,
            set_audio_sample_batch: *get_symbol(library, b"retro_set_audio_sample_batch\0")?,
            set_input_poll: *get_symbol(library, b"retro_set_input_poll\0")?,
            set_input_state: *get_symbol(library, b"retro_set_input_state\0")?,
            init: *get_symbol(library, b"retro_init\0")?,
            deinit: *get_symbol(library, b"retro_deinit\0")?,
            api_version: *get_symbol(library, b"retro_api_version\0")?,
            get_system_info: *get_symbol(library, b"retro_get_system_info\0")?,
            get_system_av_info: *get_symbol(library, b"retro_get_system_av_info\0")?,
            load_game: *get_symbol(library, b"retro_load_game\0")?,
            unload_game: *get_symbol(library, b"retro_unload_game\0")?,
            run: *get_symbol(library, b"retro_run\0")?,
        })
    }
}

unsafe fn get_symbol<'lib, T>(
    library: &'lib Library,
    name: &[u8],
) -> Result<libloading::Symbol<'lib, T>, String> {
    library
        .get::<T>(name)
        .map_err(|e| format!("Simbolo Libretro ausente '{}': {}", symbol_name(name), e))
}

fn symbol_name(name: &[u8]) -> String {
    String::from_utf8_lossy(name)
        .trim_end_matches(char::from(0))
        .to_string()
}

struct LoadedGame {
    rom_path: CString,
    rom_data: Vec<u8>,
}

struct LoadedCore {
    _library: Library,
    api: CoreApi,
    _game: LoadedGame,
    frame_size: FrameSize,
    label: String,
    _target: CoreTarget,
}

impl LoadedCore {
    fn new(core_path: &Path, rom_path: &Path, target: CoreTarget) -> Result<Self, String> {
        let library = unsafe { Library::new(core_path) }
            .map_err(|e| format!("Nao foi possivel carregar core '{}': {}", core_path.display(), e))?;
        let api = unsafe { CoreApi::load(&library) }?;

        unsafe {
            (api.set_environment)(Some(retro_environment_callback));
            (api.set_video_refresh)(Some(retro_video_refresh_callback));
            (api.set_audio_sample)(Some(retro_audio_sample_callback));
            (api.set_audio_sample_batch)(Some(retro_audio_sample_batch_callback));
            (api.set_input_poll)(Some(retro_input_poll_callback));
            (api.set_input_state)(Some(retro_input_state_callback));
            (api.init)();
        }

        let mut system_info = RetroSystemInfo {
            library_name: std::ptr::null(),
            library_version: std::ptr::null(),
            valid_extensions: std::ptr::null(),
            need_fullpath: false,
            block_extract: false,
        };
        unsafe {
            (api.get_system_info)(&mut system_info);
        }

        let rom_path_cstr = CString::new(rom_path.to_string_lossy().to_string())
            .map_err(|_| format!("Caminho da ROM contem byte nulo: {}", rom_path.display()))?;
        let rom_data = fs::read(rom_path)
            .map_err(|e| format!("Nao foi possivel ler ROM '{}': {}", rom_path.display(), e))?;
        let game = LoadedGame {
            rom_path: rom_path_cstr,
            rom_data,
        };

        let game_info = if system_info.need_fullpath {
            RetroGameInfo {
                path: game.rom_path.as_ptr(),
                data: std::ptr::null(),
                size: 0,
                meta: std::ptr::null(),
            }
        } else {
            RetroGameInfo {
                path: game.rom_path.as_ptr(),
                data: game.rom_data.as_ptr().cast::<c_void>(),
                size: game.rom_data.len(),
                meta: std::ptr::null(),
            }
        };

        let loaded = unsafe { (api.load_game)(&game_info) };
        if !loaded {
            unsafe {
                (api.deinit)();
            }
            return Err(format!(
                "Core '{}' recusou a ROM '{}'.",
                core_path.display(),
                rom_path.display()
            ));
        }

        let mut av_info = RetroSystemAvInfo {
            geometry: RetroGameGeometry {
                base_width: 0,
                base_height: 0,
                max_width: 0,
                max_height: 0,
                aspect_ratio: 0.0,
            },
            timing: RetroSystemTiming {
                fps: 0.0,
                sample_rate: 0.0,
            },
        };
        unsafe {
            (api.get_system_av_info)(&mut av_info);
        }

        let pixel_format = with_active_emulator(|state| state.pixel_format)
            .unwrap_or(PixelFormat::Xrgb8888);
        let frame_size = FrameSize {
            width: av_info.geometry.base_width.max(1),
            height: av_info.geometry.base_height.max(1),
            pitch: (av_info.geometry.base_width.max(1) as usize
                * pixel_format.bytes_per_pixel()) as u32,
        };

        let api_version = unsafe { (api.api_version)() };
        if api_version == 0 {
            unsafe {
                (api.unload_game)();
                (api.deinit)();
            }
            return Err(format!(
                "Core '{}' retornou API version invalida.",
                core_path.display()
            ));
        }

        Ok(Self {
            _library: library,
            api,
            _game: game,
            frame_size,
            label: format!(
                "{} {}",
                c_string_or_default(system_info.library_name, target.label()),
                c_string_or_default(system_info.library_version, "")
            )
            .trim()
            .to_string(),
            _target: target,
        })
    }

    fn shutdown(self) {
        let api = self.api;
        unsafe {
            (api.unload_game)();
            (api.deinit)();
        }
    }
}

pub struct EmulatorCore {
    pub handle: EmulatorHandle,
    preferred_core_path: Option<PathBuf>,
    runtime: Option<LoadedCore>,
}

impl EmulatorCore {
    pub fn new(core_path: Option<&Path>) -> Self {
        Self {
            handle: new_emulator_handle(),
            preferred_core_path: core_path.map(|path| path.to_path_buf()),
            runtime: None,
        }
    }

    pub fn load_rom(&mut self, rom_path: &Path) -> Result<(), String> {
        if !rom_path.exists() {
            return Err(format!("ROM nao encontrada: {}", rom_path.display()));
        }

        let target = detect_rom_target(rom_path).ok_or_else(|| {
            format!(
                "Nao foi possivel inferir a plataforma da ROM '{}'. Use extensoes .md/.gen/.bin para Mega Drive ou .sfc/.smc para SNES.",
                rom_path.display()
            )
        })?;
        let core_path = locate_core_path(self.preferred_core_path.as_deref(), target)?;

        self.stop().ok();
        install_active_emulator(&self.handle)?;
        reset_emulator_state(&self.handle, rom_path)?;

        let runtime = LoadedCore::new(&core_path, rom_path, target).inspect_err(|_| {
            clear_active_emulator();
        })?;

        {
            let mut state = self.handle.lock().map_err(|e| e.to_string())?;
            state.running = true;
            state.rom_path = rom_path.to_string_lossy().to_string();
            state.frame_size = runtime.frame_size;
            state.framebuffer.resize(
                runtime.frame_size.height as usize * runtime.frame_size.pitch as usize,
                0,
            );
        }

        self.runtime = Some(runtime);
        Ok(())
    }

    pub fn run_frame(&mut self) -> Result<(), String> {
        if self.runtime.is_none() {
            return Err("Nenhum core Libretro carregado. Carregue uma ROM primeiro.".into());
        }

        {
            let state = self.handle.lock().map_err(|e| e.to_string())?;
            if !state.running {
                return Err("Emulador nao inicializado. Carregue uma ROM primeiro.".into());
            }
        }

        if let Some(runtime) = &self.runtime {
            unsafe {
                (runtime.api.run)();
            }
        }

        Ok(())
    }

    pub fn get_framebuffer(&self) -> Result<(Vec<u8>, FrameSize, PixelFormat), String> {
        let state = self.handle.lock().map_err(|e| e.to_string())?;
        Ok((state.framebuffer.clone(), state.frame_size, state.pixel_format))
    }

    pub fn set_joypad(&self, joypad: JoypadState) -> Result<(), String> {
        let mut state = self.handle.lock().map_err(|e| e.to_string())?;
        state.joypad = joypad;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown();
        }

        clear_active_emulator();

        let mut state = self.handle.lock().map_err(|e| e.to_string())?;
        state.running = false;
        state.pixel_format = PixelFormat::Xrgb8888;
        state.frame_size = FrameSize {
            width: 320,
            height: 224,
            pitch: 320 * 4,
        };
        state.framebuffer = vec![0u8; 320 * 224 * 4];
        state.rom_path.clear();
        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.handle.lock().map(|state| state.running).unwrap_or(false)
    }

    pub fn loaded_core_label(&self) -> Option<&str> {
        self.runtime.as_ref().map(|runtime| runtime.label.as_str())
    }
}

impl Drop for EmulatorCore {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn reset_emulator_state(handle: &EmulatorHandle, rom_path: &Path) -> Result<(), String> {
    let mut state = handle.lock().map_err(|e| e.to_string())?;
    state.running = false;
    state.pixel_format = PixelFormat::Xrgb8888;
    state.frame_size = FrameSize {
        width: 320,
        height: 224,
        pitch: 320 * 4,
    };
    state.framebuffer = vec![0u8; 320 * 224 * 4];
    state.rom_path = rom_path.to_string_lossy().to_string();
    Ok(())
}

fn locate_core_path(explicit_core_path: Option<&Path>, target: CoreTarget) -> Result<PathBuf, String> {
    if let Some(path) = explicit_core_path {
        if path.exists() {
            return Ok(path.to_path_buf());
        }
        return Err(format!(
            "Core Libretro explicito nao encontrado: {}",
            path.display()
        ));
    }

    if let Ok(path) = std::env::var("RETRODEV_LIBRETRO_CORE") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    if let Ok(path) = std::env::var(target.env_var()) {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    let extension = core_library_extension();
    for root in core_search_roots() {
        for candidate in target.candidate_names() {
            let full_path = root.join(format!("{}.{}", candidate, extension));
            if full_path.exists() {
                return Ok(full_path);
            }
        }
    }

    let searched = core_search_roots()
        .into_iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "Nenhum core Libretro para {} foi encontrado. Configure {} ou RETRODEV_LIBRETRO_CORE e use um dos nomes {:?}. Pastas verificadas: {}.",
        target.label(),
        target.env_var(),
        target.candidate_names(),
        searched
    ))
}

fn core_search_roots() -> Vec<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut roots = vec![
        manifest_dir.join("cores"),
        manifest_dir.join("libretro"),
        manifest_dir.join("toolchains").join("libretro"),
        manifest_dir.join("toolchains").join("libretro").join("cores"),
    ];

    if let Some(repo_root) = manifest_dir.parent() {
        roots.extend([
            repo_root.join("cores"),
            repo_root.join("libretro"),
            repo_root.join("toolchains").join("libretro"),
            repo_root.join("toolchains").join("libretro").join("cores"),
        ]);
    }

    roots.sort();
    roots.dedup();
    roots
}

fn core_library_extension() -> &'static str {
    if cfg!(target_os = "windows") {
        "dll"
    } else if cfg!(target_os = "macos") {
        "dylib"
    } else {
        "so"
    }
}

fn detect_rom_target(rom_path: &Path) -> Option<CoreTarget> {
    match rom_path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()) {
        Some(ext) if ext == "md" || ext == "gen" => Some(CoreTarget::MegaDrive),
        Some(ext) if ext == "sfc" || ext == "smc" => Some(CoreTarget::Snes),
        Some(ext) if ext == "bin" => sniff_rom_target(rom_path),
        _ => sniff_rom_target(rom_path),
    }
}

fn sniff_rom_target(rom_path: &Path) -> Option<CoreTarget> {
    let header = fs::read(rom_path).ok()?;
    if header.len() >= 0x110 && &header[0x100..0x10F] == b"SEGA MEGA DRIVE" {
        return Some(CoreTarget::MegaDrive);
    }
    None
}

fn c_string_or_default(ptr: *const c_char, fallback: &str) -> String {
    if ptr.is_null() {
        return fallback.to_string();
    }

    unsafe {
        CStr::from_ptr(ptr)
            .to_str()
            .map(|value| value.to_string())
            .unwrap_or_else(|_| fallback.to_string())
    }
}

unsafe extern "C" fn retro_environment_callback(cmd: u32, data: *mut c_void) -> bool {
    if cmd == RETRO_ENVIRONMENT_SET_PIXEL_FORMAT && !data.is_null() {
        let raw = *(data as *const u32);
        if let Some(pixel_format) = PixelFormat::from_raw(raw) {
            let _ = with_active_emulator(|state| {
                state.pixel_format = pixel_format;
                state.frame_size.pitch =
                    (state.frame_size.width as usize * pixel_format.bytes_per_pixel()) as u32;
            });
            return true;
        }
        return false;
    }

    false
}

unsafe extern "C" fn retro_video_refresh_callback(
    data: *const c_void,
    width: u32,
    height: u32,
    pitch: usize,
) {
    if data.is_null() {
        return;
    }

    let _ = with_active_emulator(|state| {
        let bytes_per_pixel = state.pixel_format.bytes_per_pixel();
        let packed_pitch = width as usize * bytes_per_pixel;
        if pitch < packed_pitch {
            return;
        }

        let frame_bytes = pitch * height as usize;
        let src = std::slice::from_raw_parts(data.cast::<u8>(), frame_bytes);
        let required = packed_pitch * height as usize;

        state.framebuffer.resize(required, 0);
        state.frame_size = FrameSize {
            width,
            height,
            pitch: packed_pitch as u32,
        };

        for row in 0..height as usize {
            let src_offset = row * pitch;
            let dst_offset = row * packed_pitch;
            state.framebuffer[dst_offset..dst_offset + packed_pitch]
                .copy_from_slice(&src[src_offset..src_offset + packed_pitch]);
        }
    });
}

unsafe extern "C" fn retro_audio_sample_callback(_left: i16, _right: i16) {}

unsafe extern "C" fn retro_audio_sample_batch_callback(_data: *const i16, frames: usize) -> usize {
    frames
}

unsafe extern "C" fn retro_input_poll_callback() {}

unsafe extern "C" fn retro_input_state_callback(
    port: u32,
    _device: u32,
    index: u32,
    id: u32,
) -> i16 {
    if port != 0 || index != 0 {
        return 0;
    }

    with_active_emulator(|state| if state.joypad.button(id as u8) { 1 } else { 0 }).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-emu-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("failed to create temp dir");
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
static VALID_EXTENSIONS: &[u8] = b"md|bin|gen|sfc|smc\0";
static FRAME_COUNTER: AtomicUsize = AtomicUsize::new(0);
static mut ENV: Option<RetroEnvironmentCallback> = None;
static mut VIDEO: Option<RetroVideoRefreshCallback> = None;
static mut AUDIO: Option<RetroAudioSampleCallback> = None;
static mut AUDIO_BATCH: Option<RetroAudioSampleBatchCallback> = None;
static mut INPUT_POLL: Option<RetroInputPollCallback> = None;
static mut INPUT_STATE: Option<RetroInputStateCallback> = None;
static mut FRAMEBUFFER: [u8; 256 * 224 * 4] = [0; 256 * 224 * 4];

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
    unsafe {
        VIDEO = callback;
    }
}

#[no_mangle]
pub extern "C" fn retro_set_audio_sample(callback: Option<RetroAudioSampleCallback>) {
    unsafe {
        AUDIO = callback;
    }
}

#[no_mangle]
pub extern "C" fn retro_set_audio_sample_batch(callback: Option<RetroAudioSampleBatchCallback>) {
    unsafe {
        AUDIO_BATCH = callback;
    }
}

#[no_mangle]
pub extern "C" fn retro_set_input_poll(callback: Option<RetroInputPollCallback>) {
    unsafe {
        INPUT_POLL = callback;
    }
}

#[no_mangle]
pub extern "C" fn retro_set_input_state(callback: Option<RetroInputStateCallback>) {
    unsafe {
        INPUT_STATE = callback;
    }
}

#[no_mangle]
pub extern "C" fn retro_init() {}

#[no_mangle]
pub extern "C" fn retro_deinit() {}

#[no_mangle]
pub extern "C" fn retro_api_version() -> u32 {
    1
}

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
        Path::new(&path).exists()
    }
}

#[no_mangle]
pub extern "C" fn retro_unload_game() {}

#[no_mangle]
pub extern "C" fn retro_reset() {
    FRAME_COUNTER.store(0, Ordering::SeqCst);
}

#[no_mangle]
pub extern "C" fn retro_run() {
    let frame = FRAME_COUNTER.fetch_add(1, Ordering::SeqCst) as u8;

    unsafe {
        if let Some(input_poll) = INPUT_POLL {
            input_poll();
        }
        let button_a = INPUT_STATE
            .map(|input| input(0, 1, 0, 8) != 0)
            .unwrap_or(false);
        let blue = if button_a { 0xFF } else { frame.wrapping_mul(3) };
        for index in 0..(256 * 224) {
            let offset = index * 4;
            let pixel = u32::from(0x00110000u32 | ((frame as u32) << 8) | blue as u32);
            FRAMEBUFFER[offset..offset + 4].copy_from_slice(&pixel.to_le_bytes());
        }
        if let Some(video) = VIDEO {
            video(FRAMEBUFFER.as_ptr().cast::<c_void>(), 256, 224, 256 * 4);
        }
    }
}
"#
        .to_string()
    }

    fn compile_mock_core(dir: &Path) -> PathBuf {
        let source_path = dir.join("mock_core.rs");
        let output_path = dir.join(format!("mock_core.{}", core_library_extension()));
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

        output_path
    }

    fn write_test_rom(dir: &Path, name: &str, extension: &str) -> PathBuf {
        let path = dir.join(format!("{}.{}", name, extension));
        let mut bytes = vec![0u8; 0x200];
        bytes[0x100..0x10F].copy_from_slice(b"SEGA MEGA DRIVE");
        fs::write(&path, bytes).expect("write test rom");
        path
    }

    #[test]
    fn detects_megadrive_rom_from_extension_and_header() {
        let _serial = test_serial_guard();
        let dir = temp_dir("detect");
        let md_rom = write_test_rom(&dir, "test_md", "gen");
        let bin_rom = write_test_rom(&dir, "test_bin", "bin");
        let snes_rom = dir.join("test.sfc");
        fs::write(&snes_rom, vec![0u8; 0x8000]).expect("write snes rom");

        assert_eq!(detect_rom_target(&md_rom), Some(CoreTarget::MegaDrive));
        assert_eq!(detect_rom_target(&bin_rom), Some(CoreTarget::MegaDrive));
        assert_eq!(detect_rom_target(&snes_rom), Some(CoreTarget::Snes));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn loads_mock_core_and_runs_frames() {
        let _serial = test_serial_guard();
        let dir = temp_dir("mock-core");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "sonic_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator.load_rom(&rom_path).expect("load rom into mock core");
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
        assert_eq!(pixel_format, PixelFormat::Xrgb8888);
        assert!(framebuffer.iter().any(|byte| *byte != 0));

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }
}
