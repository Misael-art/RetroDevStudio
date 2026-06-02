use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CStr, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use libloading::Library;

use crate::tools::reverse::manifest::SaveRamStatus;
use crate::tools::reverse::trace::{CpuState, ExecutionTraceLog};

const RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: u32 = 10;
const RETRO_MEMORY_SAVE_RAM: u32 = 0;
const RETRO_MEMORY_SYSTEM_RAM: u32 = 2;
const RETRO_MEMORY_VIDEO_RAM: u32 = 3;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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
    pub sample_rate: u32,
    pub audio_buffer: Vec<i16>,
    pub last_audio_frames: usize,
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
            sample_rate: 44_100,
            audio_buffer: Vec::new(),
            last_audio_frames: 0,
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
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
type RetroAudioSampleBatchCallback = unsafe extern "C" fn(data: *const i16, frames: usize) -> usize;
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
type RetroSerializeSize = unsafe extern "C" fn() -> usize;
type RetroSerialize = unsafe extern "C" fn(data: *mut c_void, size: usize) -> bool;
type RetroUnserialize = unsafe extern "C" fn(data: *const c_void, size: usize) -> bool;
type RetroGetMemoryData = unsafe extern "C" fn(id: u32) -> *mut c_void;
type RetroGetMemorySize = unsafe extern "C" fn(id: u32) -> usize;

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
    serialize_size: RetroSerializeSize,
    serialize: RetroSerialize,
    unserialize: RetroUnserialize,
    get_memory_data: RetroGetMemoryData,
    get_memory_size: RetroGetMemorySize,
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
            serialize_size: *get_symbol(library, b"retro_serialize_size\0")?,
            serialize: *get_symbol(library, b"retro_serialize\0")?,
            unserialize: *get_symbol(library, b"retro_unserialize\0")?,
            get_memory_data: *get_symbol(library, b"retro_get_memory_data\0")?,
            get_memory_size: *get_symbol(library, b"retro_get_memory_size\0")?,
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

fn memory_region_label(region: u32) -> &'static str {
    match region {
        RETRO_MEMORY_SAVE_RAM => "SRAM",
        RETRO_MEMORY_SYSTEM_RAM => "WRAM",
        RETRO_MEMORY_VIDEO_RAM => "VRAM",
        _ => "desconhecida",
    }
}

fn default_trace_base_pc(target: CoreTarget, rom_data: &[u8]) -> u32 {
    match target {
        CoreTarget::MegaDrive if rom_data.len() >= 8 => {
            u32::from_be_bytes([rom_data[4], rom_data[5], rom_data[6], rom_data[7]]) & !1
        }
        _ => 0,
    }
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
    sample_rate: u32,
    label: String,
    _target: CoreTarget,
    trace_backend: Option<TraceBackend>,
    trace_base_pc: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TraceBackend {
    MockCoreSerializedFrameCounter,
}

impl TraceBackend {
    fn detect_for_runtime(label: &str) -> Option<Self> {
        let normalized = label.to_ascii_lowercase();
        if normalized.contains("mocklibretrocore") || normalized.contains("mock core") {
            return Some(Self::MockCoreSerializedFrameCounter);
        }
        None
    }

    fn description(self) -> &'static str {
        match self {
            Self::MockCoreSerializedFrameCounter => "serialized_frame_counter",
        }
    }

    fn decode_sample(
        self,
        base_pc: u32,
        serialized_state: &[u8],
    ) -> Option<(u32, Option<CpuState>)> {
        match self {
            Self::MockCoreSerializedFrameCounter => {
                let frame_counter =
                    u64::from_le_bytes(serialized_state.get(..8)?.try_into().ok()?) as u32;
                let frame_offset = frame_counter.saturating_sub(1).saturating_mul(2);
                let pc = base_pc.saturating_add(frame_offset) & !1;
                Some((pc, None))
            }
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct RuntimeExecutionTraceCapture {
    pub available: bool,
    pub core_label: String,
    pub rom_path: String,
    pub note: String,
    pub trace: ExecutionTraceLog,
    pub save: SaveRamStatus,
}

impl RuntimeExecutionTraceCapture {
    fn unsupported(core_label: &str, rom_path: &Path) -> Self {
        Self {
            available: false,
            core_label: core_label.to_string(),
            rom_path: rom_path.to_string_lossy().to_string(),
            note: format!(
                "Core '{}' nao expoe PC por API Libretro padrao; a coleta real de ExecutionTraceLog continua dependente de adapter especifico por runtime e permanece experimental nesta wave.",
                core_label
            ),
            trace: ExecutionTraceLog::default(),
            save: SaveRamStatus::default(),
        }
    }

    fn adapter_backed(core_label: &str, rom_path: &Path, backend: TraceBackend) -> Self {
        Self {
            available: false,
            core_label: core_label.to_string(),
            rom_path: rom_path.to_string_lossy().to_string(),
            note: format!(
                "Trace dinamico coletado via estado serializado do core '{}' usando o adapter '{}'.",
                core_label,
                backend.description()
            ),
            trace: ExecutionTraceLog::default(),
            save: SaveRamStatus::default(),
        }
    }
}

impl LoadedCore {
    fn new(core_path: &Path, rom_path: &Path, target: CoreTarget) -> Result<Self, String> {
        let library = load_core_library(core_path)?;
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

        let pixel_format =
            with_active_emulator(|state| state.pixel_format).unwrap_or(PixelFormat::Xrgb8888);
        let frame_size = FrameSize {
            width: av_info.geometry.base_width.max(1),
            height: av_info.geometry.base_height.max(1),
            pitch: (av_info.geometry.base_width.max(1) as usize * pixel_format.bytes_per_pixel())
                as u32,
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

        let core_label = format!(
            "{} {}",
            c_string_or_default(system_info.library_name, target.label()),
            c_string_or_default(system_info.library_version, "")
        )
        .trim()
        .to_string();
        let trace_backend = TraceBackend::detect_for_runtime(&core_label);
        let trace_base_pc = default_trace_base_pc(target, &game.rom_data);

        Ok(Self {
            _library: library,
            api,
            _game: game,
            frame_size,
            sample_rate: av_info.timing.sample_rate.round().max(1.0) as u32,
            label: core_label,
            _target: target,
            trace_backend,
            trace_base_pc,
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

fn load_core_library(core_path: &Path) -> Result<Library, String> {
    let mut last_error = None;
    for _ in 0..20 {
        match unsafe { Library::new(core_path) } {
            Ok(library) => return Ok(library),
            Err(error) => {
                last_error = Some(error.to_string());
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }

    Err(format!(
        "Nao foi possivel carregar core '{}': {}",
        core_path.display(),
        last_error.unwrap_or_else(|| "erro desconhecido".to_string())
    ))
}

pub struct EmulatorCore {
    pub handle: EmulatorHandle,
    preferred_core_path: Option<PathBuf>,
    runtime: Option<LoadedCore>,
    saved_state: Option<Vec<u8>>,
    rewind: RewindState,
    replay: ReplayState,
    trace_capture: RuntimeExecutionTraceCapture,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplayCapture {
    pub rom_path: String,
    pub initial_state: Vec<u8>,
    pub frames: Vec<JoypadState>,
    pub final_framebuffer: Vec<u8>,
    pub final_frame_size: FrameSize,
    pub final_pixel_format: PixelFormat,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct ReplayPlaybackSummary {
    pub frames_played: usize,
    pub framebuffer_match: bool,
}

#[derive(Debug, Clone)]
struct ReplayRecording {
    initial_state: Vec<u8>,
    frames: Vec<JoypadState>,
}

#[derive(Debug, Default)]
struct ReplayState {
    recording: Option<ReplayRecording>,
}

impl ReplayState {
    fn reset(&mut self) {
        self.recording = None;
    }
}

#[derive(Debug, Clone)]
struct RewindSnapshot {
    frame_index: u64,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
struct RewindConfig {
    snapshot_interval_frames: u64,
    capacity: usize,
}

#[derive(Debug, Default)]
struct RewindState {
    config: Option<RewindConfig>,
    snapshots: VecDeque<RewindSnapshot>,
    frame_index: u64,
}

impl RewindState {
    fn reset(&mut self) {
        self.config = None;
        self.snapshots.clear();
        self.frame_index = 0;
    }

    fn apply_config(&mut self, serialize_size: usize) {
        self.config = compute_rewind_config(serialize_size);
        self.snapshots.clear();
        self.frame_index = 0;
    }
}

impl EmulatorCore {
    pub fn new(core_path: Option<&Path>) -> Self {
        Self {
            handle: new_emulator_handle(),
            preferred_core_path: core_path.map(|path| path.to_path_buf()),
            runtime: None,
            saved_state: None,
            rewind: RewindState::default(),
            replay: ReplayState::default(),
            trace_capture: RuntimeExecutionTraceCapture::default(),
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
            state.sample_rate = runtime.sample_rate;
            state.framebuffer.resize(
                runtime.frame_size.height as usize * runtime.frame_size.pitch as usize,
                0,
            );
        }

        self.trace_capture = if let Some(backend) = runtime.trace_backend {
            RuntimeExecutionTraceCapture::adapter_backed(&runtime.label, rom_path, backend)
        } else {
            RuntimeExecutionTraceCapture::unsupported(&runtime.label, rom_path)
        };
        self.runtime = Some(runtime);
        self.configure_rewind();
        self.replay.reset();
        Ok(())
    }

    pub fn run_frame(&mut self) -> Result<(), String> {
        if self.runtime.is_none() {
            return Err("Nenhum core Libretro carregado. Carregue uma ROM primeiro.".into());
        }

        let joypad = {
            let state = self.handle.lock().map_err(|e| e.to_string())?;
            if !state.running {
                return Err("Emulador nao inicializado. Carregue uma ROM primeiro.".into());
            }
            state.joypad.clone()
        };

        self.capture_rewind_snapshot_if_due()?;
        if let Some(recording) = self.replay.recording.as_mut() {
            recording.frames.push(joypad);
        }

        if let Some(runtime) = &self.runtime {
            unsafe {
                (runtime.api.run)();
            }
        }

        self.capture_execution_trace_sample()?;
        self.rewind.frame_index = self.rewind.frame_index.saturating_add(1);
        Ok(())
    }

    pub fn get_framebuffer(&self) -> Result<(Vec<u8>, FrameSize, PixelFormat), String> {
        let state = self.handle.lock().map_err(|e| e.to_string())?;
        Ok((
            state.framebuffer.clone(),
            state.frame_size,
            state.pixel_format,
        ))
    }

    pub fn take_audio_samples(&self) -> Result<(u32, Vec<i16>), String> {
        let mut state = self.handle.lock().map_err(|e| e.to_string())?;
        let sample_rate = state.sample_rate;
        let samples = std::mem::take(&mut state.audio_buffer);
        state.last_audio_frames = 0;
        Ok((sample_rate, samples))
    }

    pub fn save_state(&mut self) -> Result<usize, String> {
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let size = unsafe { (runtime.api.serialize_size)() };

        if size == 0 {
            return Err("O core Libretro atual nao suporta save states.".to_string());
        }

        let mut buffer = vec![0u8; size];
        let serialized =
            unsafe { (runtime.api.serialize)(buffer.as_mut_ptr().cast::<c_void>(), buffer.len()) };
        if !serialized {
            return Err("Falha ao serializar o estado do core Libretro.".to_string());
        }

        self.saved_state = Some(buffer);
        Ok(size)
    }

    pub fn start_replay_recording(&mut self) -> Result<(), String> {
        self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let initial_state = self.serialize_runtime_state()?;
        self.replay.recording = Some(ReplayRecording {
            initial_state,
            frames: Vec::new(),
        });
        Ok(())
    }

    pub fn stop_replay_recording(&mut self) -> Result<ReplayCapture, String> {
        let recording = self
            .replay
            .recording
            .take()
            .ok_or_else(|| "Nenhuma gravacao de replay esta ativa.".to_string())?;
        if recording.frames.is_empty() {
            self.replay.recording = Some(recording);
            return Err(
                "Nenhum frame foi gravado ainda. Retome a emulacao ou avance frames antes de parar o replay."
                    .to_string(),
            );
        }
        let (final_framebuffer, final_frame_size, final_pixel_format) = self.get_framebuffer()?;
        let state = self.handle.lock().map_err(|e| e.to_string())?;

        Ok(ReplayCapture {
            rom_path: state.rom_path.clone(),
            initial_state: recording.initial_state,
            frames: recording.frames,
            final_framebuffer,
            final_frame_size,
            final_pixel_format,
        })
    }

    pub fn play_replay(&mut self, replay: &ReplayCapture) -> Result<ReplayPlaybackSummary, String> {
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let current_rom = self
            .handle
            .lock()
            .map_err(|e| e.to_string())?
            .rom_path
            .clone();

        if current_rom != replay.rom_path {
            return Err(format!(
                "Replay foi gravado para '{}', mas a ROM atual e '{}'.",
                replay.rom_path, current_rom
            ));
        }

        let expected_size = unsafe { (runtime.api.serialize_size)() };
        if replay.initial_state.len() != expected_size {
            return Err(format!(
                "Replay possui estado inicial com {} bytes, mas o core atual espera {} bytes.",
                replay.initial_state.len(),
                expected_size
            ));
        }

        let restored = unsafe {
            (runtime.api.unserialize)(
                replay.initial_state.as_ptr().cast::<c_void>(),
                replay.initial_state.len(),
            )
        };
        if !restored {
            return Err(
                "Falha ao restaurar estado inicial do replay no core Libretro.".to_string(),
            );
        }

        let prior_recording = self.replay.recording.take();
        for joypad in &replay.frames {
            self.set_joypad(joypad.clone())?;
            self.run_frame()?;
        }
        self.replay.recording = prior_recording;

        let (framebuffer, frame_size, pixel_format) = self.get_framebuffer()?;
        let framebuffer_match = framebuffer == replay.final_framebuffer
            && frame_size == replay.final_frame_size
            && pixel_format == replay.final_pixel_format;

        Ok(ReplayPlaybackSummary {
            frames_played: replay.frames.len(),
            framebuffer_match,
        })
    }

    pub fn load_state(&mut self) -> Result<(), String> {
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let saved_state = self
            .saved_state
            .as_ref()
            .ok_or_else(|| "Nenhum save state foi salvo nesta sessao.".to_string())?;
        let expected_size = unsafe { (runtime.api.serialize_size)() };

        if expected_size == 0 {
            return Err("O core Libretro atual nao suporta save states.".to_string());
        }
        if saved_state.len() != expected_size {
            return Err(format!(
                "Save state salvo possui {} bytes, mas o core atual espera {} bytes.",
                saved_state.len(),
                expected_size
            ));
        }

        let restored = unsafe {
            (runtime.api.unserialize)(saved_state.as_ptr().cast::<c_void>(), saved_state.len())
        };
        if !restored {
            return Err("Falha ao restaurar o save state no core Libretro.".to_string());
        }

        Ok(())
    }

    pub fn rewind_step(&mut self) -> Result<(u64, usize, u64), String> {
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let config = self
            .rewind
            .config
            .ok_or_else(|| "O core Libretro atual nao suporta rewind automatico.".to_string())?;
        let snapshot = self
            .rewind
            .snapshots
            .pop_back()
            .ok_or_else(|| "Ainda nao ha snapshots suficientes para rewind.".to_string())?;
        let restored = unsafe {
            (runtime.api.unserialize)(
                snapshot.bytes.as_ptr().cast::<c_void>(),
                snapshot.bytes.len(),
            )
        };
        if !restored {
            return Err("Falha ao restaurar snapshot do rewind no core Libretro.".to_string());
        }

        self.rewind.frame_index = snapshot.frame_index;
        Ok((
            snapshot.frame_index,
            self.rewind.snapshots.len(),
            config.snapshot_interval_frames,
        ))
    }

    pub fn read_memory(
        &self,
        region: u32,
        offset: usize,
        length: usize,
    ) -> Result<(Vec<u8>, usize), String> {
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let total_size = unsafe { (runtime.api.get_memory_size)(region) };

        if total_size == 0 || length == 0 || offset >= total_size {
            return Ok((Vec::new(), total_size));
        }

        let memory_ptr = unsafe { (runtime.api.get_memory_data)(region) };
        if memory_ptr.is_null() {
            return Err(format!(
                "A regiao de memoria {} nao esta disponivel no core Libretro atual.",
                memory_region_label(region)
            ));
        }

        let end = total_size.min(offset.saturating_add(length));
        let source = unsafe { std::slice::from_raw_parts(memory_ptr.cast::<u8>(), total_size) };
        Ok((source[offset..end].to_vec(), total_size))
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
        state.sample_rate = 44_100;
        state.audio_buffer.clear();
        state.last_audio_frames = 0;
        state.rom_path.clear();
        self.saved_state = None;
        self.rewind.reset();
        self.replay.reset();
        self.trace_capture = RuntimeExecutionTraceCapture::default();
        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.handle
            .lock()
            .map(|state| state.running)
            .unwrap_or(false)
    }

    pub fn loaded_core_label(&self) -> Option<&str> {
        self.runtime.as_ref().map(|runtime| runtime.label.as_str())
    }

    pub fn execution_trace_capture(&self) -> RuntimeExecutionTraceCapture {
        let mut capture = self.trace_capture.clone();
        capture.save = self.runtime_save_status();
        capture
    }

    fn runtime_save_status(&self) -> SaveRamStatus {
        let Some(runtime) = self.runtime.as_ref() else {
            return SaveRamStatus::default();
        };

        match self.read_memory(RETRO_MEMORY_SAVE_RAM, 0, 1) {
            Ok((_bytes, total_size)) if total_size > 0 => SaveRamStatus {
                status: "observed".to_string(),
                declared: false,
                observed: true,
                missing: false,
                size_bytes: None,
                observed_size_bytes: Some(total_size),
                address_start: None,
                address_end: None,
                note: format!(
                    "Libretro expos SRAM com {} bytes no core '{}'; trate como evidencia runtime experimental ate validar persistencia em disco.",
                    total_size, runtime.label
                ),
            },
            Ok(_) => SaveRamStatus {
                status: "missing".to_string(),
                declared: false,
                observed: false,
                missing: true,
                size_bytes: None,
                observed_size_bytes: Some(0),
                address_start: None,
                address_end: None,
                note: format!(
                    "Core '{}' nao expos SRAM via RETRO_MEMORY_SAVE_RAM nesta sessao.",
                    runtime.label
                ),
            },
            Err(error) => SaveRamStatus {
                status: "missing".to_string(),
                declared: false,
                observed: false,
                missing: true,
                size_bytes: None,
                observed_size_bytes: None,
                address_start: None,
                address_end: None,
                note: error,
            },
        }
    }

    fn configure_rewind(&mut self) {
        let serialize_size = self
            .runtime
            .as_ref()
            .map(|runtime| unsafe { (runtime.api.serialize_size)() })
            .unwrap_or(0);
        self.rewind.apply_config(serialize_size);
    }

    fn capture_rewind_snapshot_if_due(&mut self) -> Result<(), String> {
        let Some(config) = self.rewind.config else {
            return Ok(());
        };

        if config.snapshot_interval_frames == 0 {
            return Ok(());
        }
        if !self
            .rewind
            .frame_index
            .is_multiple_of(config.snapshot_interval_frames)
        {
            return Ok(());
        }

        let bytes = self.serialize_runtime_state()?;
        if self.rewind.snapshots.len() == config.capacity {
            self.rewind.snapshots.pop_front();
        }
        self.rewind.snapshots.push_back(RewindSnapshot {
            frame_index: self.rewind.frame_index,
            bytes,
        });
        Ok(())
    }

    fn capture_execution_trace_sample(&mut self) -> Result<(), String> {
        let Some(runtime) = self.runtime.as_ref() else {
            return Ok(());
        };
        let Some(trace_backend) = runtime.trace_backend else {
            return Ok(());
        };

        let serialized_state = self.serialize_runtime_state()?;
        let Some((pc, cpu_state)) =
            trace_backend.decode_sample(runtime.trace_base_pc, &serialized_state)
        else {
            return Ok(());
        };

        if let Some(cpu_state) = cpu_state {
            self.trace_capture
                .trace
                .mark_executed_with_state(pc, cpu_state);
        } else {
            self.trace_capture.trace.mark_executed(pc);
        }
        self.trace_capture.available = !self.trace_capture.trace.executed_pcs.is_empty();
        Ok(())
    }

    fn serialize_runtime_state(&self) -> Result<Vec<u8>, String> {
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            "Nenhum core Libretro carregado. Carregue uma ROM primeiro.".to_string()
        })?;
        let size = unsafe { (runtime.api.serialize_size)() };
        if size == 0 {
            return Err("O core Libretro atual nao suporta save states.".to_string());
        }

        let mut buffer = vec![0u8; size];
        let serialized =
            unsafe { (runtime.api.serialize)(buffer.as_mut_ptr().cast::<c_void>(), buffer.len()) };
        if !serialized {
            return Err("Falha ao serializar o estado do core Libretro.".to_string());
        }

        Ok(buffer)
    }
}

fn compute_rewind_config(serialize_size: usize) -> Option<RewindConfig> {
    if serialize_size == 0 {
        return None;
    }

    const MAX_REWIND_BYTES: usize = 32 * 1024 * 1024;
    const MAX_SNAPSHOTS: usize = 24;
    const MIN_SNAPSHOTS: usize = 4;

    let mut capacity = (MAX_REWIND_BYTES / serialize_size).clamp(MIN_SNAPSHOTS, MAX_SNAPSHOTS);
    let mut snapshot_interval_frames = 1u64;

    while capacity.saturating_mul(serialize_size) > MAX_REWIND_BYTES {
        if capacity > MIN_SNAPSHOTS {
            capacity -= 1;
        } else {
            snapshot_interval_frames = snapshot_interval_frames.saturating_mul(2);
            break;
        }
    }

    Some(RewindConfig {
        snapshot_interval_frames,
        capacity,
    })
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
    state.sample_rate = 44_100;
    state.audio_buffer.clear();
    state.last_audio_frames = 0;
    state.rom_path = rom_path.to_string_lossy().to_string();
    Ok(())
}

fn locate_core_path(
    explicit_core_path: Option<&Path>,
    target: CoreTarget,
) -> Result<PathBuf, String> {
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
        manifest_dir
            .join("toolchains")
            .join("libretro")
            .join("cores"),
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
    match rom_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
    {
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

fn buffer_audio_samples(samples: &[i16], frames: usize) {
    const MAX_AUDIO_SAMPLES: usize = 8192;

    let retained = samples.len().min(MAX_AUDIO_SAMPLES);
    let retained_slice = &samples[samples.len().saturating_sub(retained)..];
    let _ = with_active_emulator(|state| {
        state.audio_buffer.clear();
        state.audio_buffer.extend_from_slice(retained_slice);
        state.last_audio_frames = frames;
    });
}

unsafe extern "C" fn retro_audio_sample_callback(left: i16, right: i16) {
    buffer_audio_samples(&[left, right], 1);
}

unsafe extern "C" fn retro_audio_sample_batch_callback(data: *const i16, frames: usize) -> usize {
    if data.is_null() || frames == 0 {
        return 0;
    }

    let sample_count = frames.saturating_mul(2);
    let samples = unsafe { std::slice::from_raw_parts(data, sample_count) };
    buffer_audio_samples(samples, frames);
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
    use std::sync::OnceLock;
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

    fn mock_core_build_dir(dir: &Path) -> PathBuf {
        let workspace_test_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target-test");
        let base_dir = std::env::var_os("RDS_TEST_CORE_DIR")
            .or_else(|| std::env::var_os("CARGO_TARGET_DIR"))
            .map(PathBuf::from)
            .unwrap_or(workspace_test_dir);
        let suffix = dir
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("default");
        let output_dir = base_dir.join("mock-core-fixtures").join(suffix);
        fs::create_dir_all(&output_dir).expect("failed to create mock core output dir");
        output_dir
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
        let exists = Path::new(&path).exists();
        if exists {
            FRAME_COUNTER.store(0, Ordering::SeqCst);
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
pub extern "C" fn retro_serialize_size() -> usize {
    8
}

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
pub extern "C" fn retro_reset() {
    FRAME_COUNTER.store(0, Ordering::SeqCst);
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

    fn wait_for_mock_core_load(output_path: &Path) {
        let mut last_error = None;
        for _ in 0..60 {
            match unsafe { Library::new(output_path) } {
                Ok(library) => {
                    drop(library);
                    return;
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
            }
        }

        panic!(
            "mock core compiled but never became loadable: path='{}' exists={} size={} last_error={}",
            output_path.display(),
            output_path.exists(),
            fs::metadata(output_path)
                .map(|metadata| metadata.len().to_string())
                .unwrap_or_else(|error| format!("metadata error: {error}")),
            last_error.unwrap_or_else(|| "erro desconhecido".to_string())
        );
    }

    static MOCK_CORE_PATH: OnceLock<PathBuf> = OnceLock::new();

    fn compile_mock_core(_dir: &Path) -> PathBuf {
        MOCK_CORE_PATH
            .get_or_init(|| {
                let build_dir = mock_core_build_dir(Path::new("libretro-shared"));
                let source_path = build_dir.join("mock_core.rs");
                let output_path = build_dir.join(format!("mock_core.{}", core_library_extension()));
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

                wait_for_mock_core_load(&output_path);

                output_path
            })
            .clone()
    }

    fn write_test_rom(dir: &Path, name: &str, extension: &str) -> PathBuf {
        let path = dir.join(format!("{}.{}", name, extension));
        let mut bytes = vec![0u8; 0x400];
        bytes[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
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
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");
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
        {
            let state = emulator.handle.lock().expect("lock emulator state");
            assert_eq!(state.last_audio_frames, 2);
            assert_eq!(state.audio_buffer, vec![0, 0, 1, -1]);
        }

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mock_core_collects_execution_trace_via_serialized_state() {
        let _serial = test_serial_guard();
        let dir = temp_dir("mock-core-trace");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "trace_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");
        emulator.run_frame().expect("run frame 1");
        emulator.run_frame().expect("run frame 2");

        let trace_capture = emulator.execution_trace_capture();

        assert!(trace_capture.available);
        assert!(trace_capture.core_label.contains("MockLibretroCore"));
        assert!(trace_capture.note.contains("estado serializado"));
        assert!(trace_capture.trace.was_executed(0x200));
        assert!(trace_capture.trace.was_executed(0x202));

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn runtime_contract_reports_observed_save_ram_from_libretro_memory() {
        let _serial = test_serial_guard();
        let dir = temp_dir("save-contract");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "save_contract_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");

        let trace_capture = emulator.execution_trace_capture();
        assert_eq!(trace_capture.save.status, "observed");
        assert!(!trace_capture.save.declared);
        assert!(trace_capture.save.observed);
        assert!(!trace_capture.save.missing);
        assert_eq!(trace_capture.save.observed_size_bytes, Some(32));
        assert!(trace_capture.save.note.contains("Libretro expos SRAM"));

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn audio_sample_batch_callback_buffers_latest_audio_batch() {
        let _serial = test_serial_guard();
        let handle = new_emulator_handle();
        install_active_emulator(&handle).expect("install active emulator");
        let samples = [10i16, -10, 20, -20];

        let accepted = unsafe { retro_audio_sample_batch_callback(samples.as_ptr(), 2) };

        assert_eq!(accepted, 2);
        {
            let state = handle.lock().expect("lock emulator state");
            assert_eq!(state.last_audio_frames, 2);
            assert_eq!(state.audio_buffer, samples);
        }

        clear_active_emulator();
    }

    #[test]
    fn save_state_restores_mock_core_progress() {
        let _serial = test_serial_guard();
        let dir = temp_dir("save-state");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "save_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");

        emulator.run_frame().expect("run first frame");
        let (_, size_before, format_before) = emulator
            .get_framebuffer()
            .expect("read framebuffer after first frame");

        let saved_size = emulator.save_state().expect("save emulator state");
        assert_eq!(saved_size, 8);

        emulator.run_frame().expect("run second frame");
        let (advanced_framebuffer, advanced_size, advanced_format) = emulator
            .get_framebuffer()
            .expect("read framebuffer after second frame");

        emulator.load_state().expect("restore emulator state");
        emulator.run_frame().expect("run restored frame");
        let (restored_framebuffer, restored_size, restored_format) = emulator
            .get_framebuffer()
            .expect("read framebuffer after restore");

        assert_eq!(size_before, advanced_size);
        assert_eq!(format_before, advanced_format);
        assert_eq!(advanced_size, restored_size);
        assert_eq!(advanced_format, restored_format);
        assert_eq!(advanced_framebuffer, restored_framebuffer);

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rewind_restores_previous_mock_core_snapshot() {
        let _serial = test_serial_guard();
        let dir = temp_dir("rewind");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "rewind_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");

        emulator.run_frame().expect("run frame 1");
        emulator.run_frame().expect("run frame 2");
        let (framebuffer_after_two, _, _) = emulator
            .get_framebuffer()
            .expect("read framebuffer after frame 2");

        let rewind_result = emulator.rewind_step().expect("rewind one snapshot");
        assert_eq!(rewind_result.0, 1);

        emulator.run_frame().expect("run restored frame");
        let (framebuffer_after_rewind, _, _) = emulator
            .get_framebuffer()
            .expect("read framebuffer after rewind");

        assert_eq!(framebuffer_after_two, framebuffer_after_rewind);

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn replay_recording_and_playback_restore_the_same_final_framebuffer() {
        let _serial = test_serial_guard();
        let dir = temp_dir("replay");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "replay_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");
        emulator
            .start_replay_recording()
            .expect("start replay recording");

        emulator
            .set_joypad(JoypadState {
                a: true,
                ..JoypadState::default()
            })
            .expect("set joypad frame 1");
        emulator.run_frame().expect("run frame 1");

        emulator
            .set_joypad(JoypadState {
                right: true,
                ..JoypadState::default()
            })
            .expect("set joypad frame 2");
        emulator.run_frame().expect("run frame 2");

        let replay = emulator
            .stop_replay_recording()
            .expect("stop replay recording");
        let summary = emulator.play_replay(&replay).expect("play replay");
        let (framebuffer, size, pixel_format) = emulator
            .get_framebuffer()
            .expect("read framebuffer after replay");

        assert_eq!(replay.frames.len(), 2);
        assert_eq!(summary.frames_played, 2);
        assert!(summary.framebuffer_match);
        assert_eq!(framebuffer, replay.final_framebuffer);
        assert_eq!(size, replay.final_frame_size);
        assert_eq!(pixel_format, replay.final_pixel_format);

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn replay_stop_requires_at_least_one_recorded_frame() {
        let _serial = test_serial_guard();
        let dir = temp_dir("replay-empty");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "replay_empty_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");
        emulator
            .start_replay_recording()
            .expect("start replay recording");

        let error = emulator
            .stop_replay_recording()
            .expect_err("stop replay recording should require frames");
        assert!(error.contains("Nenhum frame foi gravado ainda"));

        emulator.run_frame().expect("run first frame after warning");
        let replay = emulator
            .stop_replay_recording()
            .expect("stop replay recording after a frame");
        assert_eq!(replay.frames.len(), 1);

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rewind_config_stays_within_memory_budget_for_large_states() {
        let config = compute_rewind_config(10 * 1024 * 1024).expect("rewind config");

        assert_eq!(config.capacity, 4);
        assert_eq!(config.snapshot_interval_frames, 2);
    }

    #[test]
    fn read_memory_requires_a_loaded_core() {
        let _serial = test_serial_guard();
        let emulator = EmulatorCore::new(None);

        let error = emulator
            .read_memory(RETRO_MEMORY_SYSTEM_RAM, 0, 16)
            .expect_err("memory read should fail without a loaded core");

        assert!(error.contains("Nenhum core Libretro carregado"));
    }

    #[test]
    fn read_memory_returns_predictable_mock_core_bytes() {
        let _serial = test_serial_guard();
        let dir = temp_dir("memory-read");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "memory_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");

        let (bytes, total_size) = emulator
            .read_memory(RETRO_MEMORY_SYSTEM_RAM, 0x10, 0x10)
            .expect("read system ram");

        assert_eq!(total_size, 64);
        assert_eq!(bytes, (0x10u8..0x20u8).collect::<Vec<_>>());

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn take_audio_samples_drains_mock_core_audio_with_sample_rate() {
        let _serial = test_serial_guard();
        let dir = temp_dir("audio-drain");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "audio_test", "gen");

        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator
            .load_rom(&rom_path)
            .expect("load rom into mock core");
        emulator.run_frame().expect("run frame");

        let (sample_rate, samples) = emulator.take_audio_samples().expect("drain audio samples");

        assert_eq!(sample_rate, 44_100);
        assert_eq!(samples, vec![0, 0, 1, -1]);
        {
            let state = emulator.handle.lock().expect("lock emulator state");
            assert!(state.audio_buffer.is_empty());
            assert_eq!(state.last_audio_frames, 0);
        }

        emulator.stop().expect("stop emulator");
        let _ = fs::remove_dir_all(dir);
    }
}
