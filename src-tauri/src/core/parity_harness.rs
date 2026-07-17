use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::rom_mastering::sha256_hex;
use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState, ReplayCapture};

pub const PARITY_REPORT_SCHEMA: &str = "rds-gameplay-parity/v1";
pub const INPUT_SCRIPT_SCHEMA: &str = "rds-input-script/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameHash {
    pub frame_index: u32,
    pub framebuffer_sha256: String,
    pub non_black_pixels: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParityDivergence {
    pub frame_index: u32,
    pub kind: String,
    pub expected: String,
    pub observed: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParityReport {
    pub schema: String,
    pub rom_path: String,
    pub rom_sha256: String,
    pub core_label: String,
    pub frames_run: u32,
    pub frame_hashes: Vec<FrameHash>,
    pub final_state_sha256: String,
    pub deterministic: bool,
    pub divergences: Vec<ParityDivergence>,
    pub fake_toolchain_used: bool,
    pub not_measured_by_this_harness: Vec<String>,
}

impl ParityReport {
    fn not_measured_default() -> Vec<String> {
        vec![
            "audio_exact_match".to_string(),
            "m68k_cycle_trace".to_string(),
            "z80_cycle_trace".to_string(),
            "vdp_scanline_trace".to_string(),
            "dma_timing".to_string(),
        ]
    }

    #[allow(clippy::too_many_arguments)]
    fn new(
        rom_path: String,
        rom_sha256: String,
        core_label: String,
        frames_run: u32,
        frame_hashes: Vec<FrameHash>,
        final_state_sha256: String,
        deterministic: bool,
        divergences: Vec<ParityDivergence>,
        fake_toolchain_used: bool,
    ) -> Self {
        Self {
            schema: PARITY_REPORT_SCHEMA.to_string(),
            rom_path,
            rom_sha256,
            core_label,
            frames_run,
            frame_hashes,
            final_state_sha256,
            deterministic,
            divergences,
            fake_toolchain_used,
            not_measured_by_this_harness: Self::not_measured_default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InputScript {
    pub schema: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub frames: Vec<JoypadState>,
}

impl InputScript {
    #[allow(dead_code)]
    pub fn from_frames(frames: Vec<JoypadState>) -> Self {
        Self {
            schema: INPUT_SCRIPT_SCHEMA.to_string(),
            name: None,
            target: None,
            description: None,
            frames,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GoldenInputs {
    Replay(ReplayCapture),
    Script(InputScript),
}

impl GoldenInputs {
    pub fn inputs(&self) -> &[JoypadState] {
        match self {
            GoldenInputs::Replay(replay) => &replay.frames,
            GoldenInputs::Script(script) => &script.frames,
        }
    }

    pub fn source_label(&self) -> &'static str {
        match self {
            GoldenInputs::Replay(_) => "replay",
            GoldenInputs::Script(_) => "script",
        }
    }
}

pub fn load_golden(path: &Path) -> Result<GoldenInputs, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "Could not read golden input '{}': {}",
            path.display(),
            error
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if file_name.ends_with(".rds-replay") {
        let replay: ReplayCapture = serde_json::from_slice(&bytes).map_err(|error| {
            format!(
                "Could not parse replay capture '{}': {}",
                path.display(),
                error
            )
        })?;
        return Ok(GoldenInputs::Replay(replay));
    }

    if file_name.ends_with(".rds-input.json") || file_name.ends_with(".rds-input") {
        let script: InputScript = serde_json::from_slice(&bytes).map_err(|error| {
            format!(
                "Could not parse input script '{}': {}",
                path.display(),
                error
            )
        })?;
        if script.schema != INPUT_SCRIPT_SCHEMA {
            return Err(format!(
                "Input script schema mismatch in '{}': expected '{}', got '{}'.",
                path.display(),
                INPUT_SCRIPT_SCHEMA,
                script.schema
            ));
        }
        return Ok(GoldenInputs::Script(script));
    }

    if let Ok(script) = serde_json::from_slice::<InputScript>(&bytes) {
        if script.schema == INPUT_SCRIPT_SCHEMA {
            return Ok(GoldenInputs::Script(script));
        }
    }
    if let Ok(replay) = serde_json::from_slice::<ReplayCapture>(&bytes) {
        return Ok(GoldenInputs::Replay(replay));
    }
    Err(format!(
        "Golden input '{}' did not match any known format (expected .rds-replay or .rds-input.json).",
        path.display()
    ))
}

pub fn run_parity_capture(
    core: &mut EmulatorCore,
    rom_path: &Path,
    rom_sha256: &str,
    initial_state: &[u8],
    inputs: &[JoypadState],
) -> Result<ParityReport, String> {
    core.restore_runtime_state_bytes(initial_state)?;

    let core_label = core.loaded_core_label().unwrap_or("unknown").to_string();

    let mut frame_hashes: Vec<FrameHash> = Vec::with_capacity(inputs.len());
    for (index, joypad) in inputs.iter().enumerate() {
        core.set_joypad(joypad.clone())?;
        core.run_frame()?;
        let (framebuffer, _size, _pixel_format) = core.get_framebuffer()?;
        let non_black = count_non_black_pixels(&framebuffer);
        let frame_hash = FrameHash {
            frame_index: index as u32,
            framebuffer_sha256: sha256_hex(&framebuffer),
            non_black_pixels: non_black,
        };
        frame_hashes.push(frame_hash);
    }

    let final_bytes = core.capture_runtime_state_bytes()?;
    let final_state_sha256 = sha256_hex(&final_bytes);

    Ok(ParityReport::new(
        rom_path.to_string_lossy().to_string(),
        rom_sha256.to_string(),
        core_label,
        inputs.len() as u32,
        frame_hashes,
        final_state_sha256,
        true,
        Vec::new(),
        false,
    ))
}

pub fn run_parity_capture_against_golden(
    core: &mut EmulatorCore,
    rom_path: &Path,
    golden_path: &Path,
    frame_limit: Option<u32>,
    report_dir: &Path,
) -> Result<(ParityReport, PathBuf), String> {
    let golden = load_golden(golden_path)?;
    let mut inputs: Vec<JoypadState> = golden.inputs().to_vec();
    if let Some(limit) = frame_limit {
        let limit = limit as usize;
        if inputs.len() > limit {
            inputs.truncate(limit);
        }
    }
    if inputs.is_empty() {
        return Err(format!(
            "Golden input '{}' produced zero frames; refusing to capture an empty parity report.",
            golden_path.display()
        ));
    }

    let rom_bytes = fs::read(rom_path).map_err(|error| {
        format!(
            "Could not read ROM '{}' for parity capture: {}",
            rom_path.display(),
            error
        )
    })?;
    let rom_sha256 = sha256_hex(&rom_bytes);
    let initial_state = core.capture_runtime_state_bytes()?;

    let mut report_a = run_parity_capture(core, rom_path, &rom_sha256, &initial_state, &inputs)?;
    let report_b = run_parity_capture(core, rom_path, &rom_sha256, &initial_state, &inputs)?;

    let divergences = compare_runs(&report_a, &report_b);
    report_a.divergences = divergences.clone();
    report_a.deterministic = divergences.is_empty();

    let written = write_parity_report(report_dir, &report_a)?;
    Ok((report_a, written))
}

pub fn compare_runs(reference: &ParityReport, observed: &ParityReport) -> Vec<ParityDivergence> {
    let mut divergences = Vec::new();
    if reference.rom_sha256 != observed.rom_sha256 {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "rom_sha256_mismatch".to_string(),
            expected: reference.rom_sha256.clone(),
            observed: observed.rom_sha256.clone(),
        });
        return divergences;
    }
    if reference.core_label != observed.core_label {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "core_label_mismatch".to_string(),
            expected: reference.core_label.clone(),
            observed: observed.core_label.clone(),
        });
        return divergences;
    }
    if reference.frames_run != observed.frames_run {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "frames_run_mismatch".to_string(),
            expected: reference.frames_run.to_string(),
            observed: observed.frames_run.to_string(),
        });
        return divergences;
    }
    let limit = reference
        .frame_hashes
        .len()
        .min(observed.frame_hashes.len());
    for index in 0..limit {
        let a = &reference.frame_hashes[index];
        let b = &observed.frame_hashes[index];
        if a.framebuffer_sha256 != b.framebuffer_sha256 {
            divergences.push(ParityDivergence {
                frame_index: a.frame_index,
                kind: "frame_hash_mismatch".to_string(),
                expected: a.framebuffer_sha256.clone(),
                observed: b.framebuffer_sha256.clone(),
            });
            return divergences;
        }
        if a.non_black_pixels != b.non_black_pixels {
            divergences.push(ParityDivergence {
                frame_index: a.frame_index,
                kind: "non_black_pixels_mismatch".to_string(),
                expected: a.non_black_pixels.to_string(),
                observed: b.non_black_pixels.to_string(),
            });
            return divergences;
        }
    }
    if reference.frame_hashes.len() != observed.frame_hashes.len() {
        divergences.push(ParityDivergence {
            frame_index: limit as u32,
            kind: "frame_hashes_length_mismatch".to_string(),
            expected: reference.frame_hashes.len().to_string(),
            observed: observed.frame_hashes.len().to_string(),
        });
        return divergences;
    }
    if reference.final_state_sha256 != observed.final_state_sha256 {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "final_state_mismatch".to_string(),
            expected: reference.final_state_sha256.clone(),
            observed: observed.final_state_sha256.clone(),
        });
    }
    divergences
}

pub fn write_parity_report(report_dir: &Path, report: &ParityReport) -> Result<PathBuf, String> {
    fs::create_dir_all(report_dir).map_err(|error| {
        format!(
            "Could not create parity report dir '{}': {}",
            report_dir.display(),
            error
        )
    })?;
    let json_path = report_dir.join("gameplay-parity-report.json");
    let md_path = report_dir.join("gameplay-parity-report.md");

    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("Could not serialize parity report: {error}"))?;
    fs::write(&json_path, format!("{json}\n")).map_err(|error| {
        format!(
            "Could not write parity report '{}': {}",
            json_path.display(),
            error
        )
    })?;
    let markdown = render_parity_markdown(report);
    fs::write(&md_path, markdown).map_err(|error| {
        format!(
            "Could not write parity report markdown '{}': {}",
            md_path.display(),
            error
        )
    })?;
    Ok(json_path)
}

fn render_parity_markdown(report: &ParityReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", report.schema));
    out.push_str(&format!("- **ROM**: `{}`\n", report.rom_path));
    out.push_str(&format!("- **ROM SHA-256**: `{}`\n", report.rom_sha256));
    out.push_str(&format!("- **Core**: `{}`\n", report.core_label));
    out.push_str(&format!("- **Frames run**: {}\n", report.frames_run));
    out.push_str(&format!(
        "- **Deterministic**: {}\n",
        if report.deterministic { "sim" } else { "nao" }
    ));
    out.push_str(&format!(
        "- **Divergences**: {}\n",
        report.divergences.len()
    ));
    out.push_str(&format!(
        "- **Final state SHA-256**: `{}`\n",
        report.final_state_sha256
    ));
    if !report.divergences.is_empty() {
        out.push_str("\n## Divergences\n\n");
        for d in &report.divergences {
            out.push_str(&format!(
                "- frame {}: `{}` expected=`{}` observed=`{}`\n",
                d.frame_index, d.kind, d.expected, d.observed
            ));
        }
    }
    if !report.not_measured_by_this_harness.is_empty() {
        out.push_str("\n## Not measured by this harness\n\n");
        for field in &report.not_measured_by_this_harness {
            out.push_str(&format!("- {field}\n"));
        }
    }
    out.push_str("\n## First frame hashes\n\n");
    let preview = report.frame_hashes.iter().take(8);
    for frame in preview {
        out.push_str(&format!(
            "- frame {}: hash=`{}` non_black_pixels={}\n",
            frame.frame_index, frame.framebuffer_sha256, frame.non_black_pixels
        ));
    }
    out
}

fn count_non_black_pixels(framebuffer: &[u8]) -> usize {
    framebuffer
        .chunks_exact(4)
        .filter(|px| px[0] != 0 || px[1] != 0 || px[2] != 0)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "retro-dev-studio-parity-{label}-{}-{}",
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn sample_report(deterministic: bool, divergence_kind: Option<&str>) -> ParityReport {
        let mut divergences = Vec::new();
        if let Some(kind) = divergence_kind {
            divergences.push(ParityDivergence {
                frame_index: 2,
                kind: kind.to_string(),
                expected: "deadbeef".to_string(),
                observed: "cafebabe".to_string(),
            });
        }
        ParityReport::new(
            "/tmp/rom.bin".to_string(),
            "abc123".to_string(),
            "MockLibretroCore".to_string(),
            4,
            vec![
                FrameHash {
                    frame_index: 0,
                    framebuffer_sha256: "h0".to_string(),
                    non_black_pixels: 10,
                },
                FrameHash {
                    frame_index: 1,
                    framebuffer_sha256: "h1".to_string(),
                    non_black_pixels: 11,
                },
                FrameHash {
                    frame_index: 2,
                    framebuffer_sha256: "h2".to_string(),
                    non_black_pixels: 12,
                },
                FrameHash {
                    frame_index: 3,
                    framebuffer_sha256: "h3".to_string(),
                    non_black_pixels: 13,
                },
            ],
            "final".to_string(),
            deterministic,
            divergences,
            false,
        )
    }

    #[test]
    fn compare_runs_returns_empty_for_identical_reports() {
        let a = sample_report(true, None);
        let b = sample_report(true, None);
        assert!(compare_runs(&a, &b).is_empty());
    }

    #[test]
    fn compare_runs_detects_frame_hash_divergence() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frame_hashes[2].framebuffer_sha256 = "different".to_string();
        b.final_state_sha256 = "different".to_string();
        let divergences = compare_runs(&a, &b);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "frame_hash_mismatch");
        assert_eq!(divergences[0].frame_index, 2);
    }

    #[test]
    fn compare_runs_detects_non_black_pixels_divergence() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frame_hashes[1].framebuffer_sha256 = a.frame_hashes[1].framebuffer_sha256.clone();
        b.frame_hashes[1].non_black_pixels = 9999;
        let divergences = compare_runs(&a, &b);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "non_black_pixels_mismatch");
        assert_eq!(divergences[0].frame_index, 1);
    }

    #[test]
    fn compare_runs_detects_final_state_divergence() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.final_state_sha256 = "different-state".to_string();
        let divergences = compare_runs(&a, &b);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "final_state_mismatch");
    }

    #[test]
    fn compare_runs_detects_rom_sha256_mismatch_early() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.rom_sha256 = "different-rom".to_string();
        b.frame_hashes[0].framebuffer_sha256 = "anything-else".to_string();
        let divergences = compare_runs(&a, &b);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "rom_sha256_mismatch");
    }

    #[test]
    fn compare_runs_detects_frames_run_mismatch() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frames_run = a.frames_run + 1;
        let divergences = compare_runs(&a, &b);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "frames_run_mismatch");
    }

    #[test]
    fn write_parity_report_creates_files_with_parity_substring() {
        let dir = temp_dir("writer");
        let report = sample_report(true, None);
        let path = write_parity_report(&dir, &report).expect("write report");
        assert!(path.exists());
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        assert!(
            name.contains("parity"),
            "file name should contain parity substring, got: {name}"
        );
        let md_path = dir.join("gameplay-parity-report.md");
        assert!(md_path.exists());

        let json = fs::read_to_string(&path).expect("read json");
        assert!(json.contains("\"schema\""));
        assert!(json.contains(PARITY_REPORT_SCHEMA));

        let md = fs::read_to_string(&md_path).expect("read md");
        assert!(md.contains("# rds-gameplay-parity/v1"));
        assert!(md.contains("Deterministic"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_parity_report_marks_divergences_in_markdown() {
        let dir = temp_dir("writer-div");
        let report = sample_report(false, Some("frame_hash_mismatch"));
        write_parity_report(&dir, &report).expect("write");
        let md = fs::read_to_string(dir.join("gameplay-parity-report.md")).expect("read");
        assert!(md.contains("Divergences"));
        assert!(md.contains("frame_hash_mismatch"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn count_non_black_pixels_skips_pure_black() {
        let mut framebuffer = vec![0u8; 16 * 4];
        framebuffer[4..8].copy_from_slice(&[0xFF, 0x00, 0x00, 0xFF]);
        framebuffer[8..12].copy_from_slice(&[0x00, 0x00, 0x00, 0xFF]);
        framebuffer[12..16].copy_from_slice(&[0x12, 0x34, 0x56, 0xFF]);
        assert_eq!(count_non_black_pixels(&framebuffer), 2);
    }

    #[test]
    fn load_golden_round_trips_replay_capture() {
        let dir = temp_dir("load-golden-replay");
        let replay_path = dir.join("sample.rds-replay");
        let original = ReplayCapture {
            rom_path: "/tmp/sample.bin".to_string(),
            initial_state: vec![1, 2, 3, 4, 5, 6, 7, 8],
            frames: vec![
                JoypadState {
                    a: true,
                    ..JoypadState::default()
                },
                JoypadState::default(),
                JoypadState {
                    start: true,
                    ..JoypadState::default()
                },
            ],
            final_framebuffer: vec![0u8; 32],
            final_frame_size: crate::emulator::libretro_ffi::FrameSize {
                width: 256,
                height: 224,
                pitch: 1024,
            },
            final_pixel_format: crate::emulator::libretro_ffi::PixelFormat::Xrgb8888,
        };
        let bytes = serde_json::to_vec_pretty(&original).expect("serialize replay");
        fs::write(&replay_path, bytes).expect("write replay");

        let loaded = load_golden(&replay_path).expect("load_golden replay");
        match &loaded {
            GoldenInputs::Replay(replay) => {
                assert_eq!(replay.rom_path, original.rom_path);
                assert_eq!(replay.frames.len(), 3);
                assert!(replay.frames[0].a);
                assert!(replay.frames[2].start);
            }
            GoldenInputs::Script(_) => panic!("expected replay, got script"),
        }
        assert_eq!(loaded.source_label(), "replay");
        assert_eq!(loaded.inputs().len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_golden_parses_input_script_with_canonical_schema() {
        let dir = temp_dir("load-golden-script");
        let script_path = dir.join("stage1.rds-input.json");
        let mut script = InputScript::from_frames(vec![
            JoypadState::default(),
            JoypadState {
                up: true,
                ..JoypadState::default()
            },
            JoypadState {
                b: true,
                a: true,
                ..JoypadState::default()
            },
        ]);
        script.name = Some("stage1-boss".to_string());
        script.target = Some("megadrive".to_string());
        script.description = Some("deterministic intro".to_string());
        let bytes = serde_json::to_vec_pretty(&script).expect("serialize script");
        fs::write(&script_path, bytes).expect("write script");

        let loaded = load_golden(&script_path).expect("load_golden script");
        match &loaded {
            GoldenInputs::Script(s) => {
                assert_eq!(s.schema, INPUT_SCRIPT_SCHEMA);
                assert_eq!(s.frames.len(), 3);
                assert_eq!(s.name.as_deref(), Some("stage1-boss"));
            }
            GoldenInputs::Replay(_) => panic!("expected script, got replay"),
        }
        assert_eq!(loaded.source_label(), "script");
        assert_eq!(loaded.inputs().len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_golden_rejects_unknown_schema() {
        let dir = temp_dir("load-golden-bad-schema");
        let bad_path = dir.join("bad.rds-input.json");
        let raw = serde_json::json!({ "schema": "rds-input-script/v0", "frames": [] });
        fs::write(&bad_path, serde_json::to_vec_pretty(&raw).unwrap()).expect("write");
        let err = load_golden(&bad_path).expect_err("must reject unknown schema");
        assert!(err.contains("schema mismatch"), "got: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_golden_rejects_unknown_extension() {
        let dir = temp_dir("load-golden-bad-ext");
        let bad_path = dir.join("garbage.txt");
        fs::write(&bad_path, b"not json").expect("write");
        let err = load_golden(&bad_path).expect_err("must reject");
        assert!(err.contains("did not match any known format"), "got: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_golden_falls_back_to_replay_when_no_extension_hint() {
        let dir = temp_dir("load-golden-fallback");
        let no_ext = dir.join("recording");
        let replay = ReplayCapture {
            rom_path: "/tmp/rom.bin".to_string(),
            initial_state: vec![0u8; 8],
            frames: vec![JoypadState::default()],
            final_framebuffer: vec![0u8; 8],
            final_frame_size: crate::emulator::libretro_ffi::FrameSize {
                width: 256,
                height: 224,
                pitch: 1024,
            },
            final_pixel_format: crate::emulator::libretro_ffi::PixelFormat::Xrgb8888,
        };
        let bytes = serde_json::to_vec_pretty(&replay).expect("serialize");
        fs::write(&no_ext, bytes).expect("write");
        let loaded = load_golden(&no_ext).expect("fallback load");
        assert_eq!(loaded.source_label(), "replay");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_parity_capture_against_golden_respects_frame_limit() {
        use crate::emulator::libretro_ffi::test_helpers::{
            compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom,
        };
        use crate::emulator::libretro_ffi::EmulatorCore;

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("parity-golden-limit");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "limit_rom", "gen");

        let script = InputScript::from_frames(vec![
            JoypadState {
                a: true,
                ..JoypadState::default()
            },
            JoypadState {
                b: true,
                ..JoypadState::default()
            },
            JoypadState {
                x: true,
                ..JoypadState::default()
            },
            JoypadState {
                y: true,
                ..JoypadState::default()
            },
        ]);
        let golden_path = dir.join("many.rds-input.json");
        fs::write(
            &golden_path,
            serde_json::to_vec_pretty(&script).expect("serialize"),
        )
        .expect("write golden");

        let report_dir = dir.join(".rds").join("reports");
        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator.load_rom(&rom_path).expect("load rom");

        let (report, _) = run_parity_capture_against_golden(
            &mut emulator,
            &rom_path,
            &golden_path,
            Some(2),
            &report_dir,
        )
        .expect("capture with frame_limit");
        assert_eq!(report.frames_run, 2);
        assert_eq!(report.frame_hashes.len(), 2);

        emulator.stop().expect("stop");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_parity_capture_against_golden_rejects_empty_script() {
        use crate::emulator::libretro_ffi::test_helpers::{
            compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom,
        };
        use crate::emulator::libretro_ffi::EmulatorCore;

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("parity-golden-empty");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "empty_rom", "gen");
        let golden_path = dir.join("empty.rds-input.json");
        let script = InputScript::from_frames(Vec::new());
        fs::write(
            &golden_path,
            serde_json::to_vec_pretty(&script).expect("serialize"),
        )
        .expect("write golden");

        let report_dir = dir.join(".rds").join("reports");
        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator.load_rom(&rom_path).expect("load rom");

        let err = run_parity_capture_against_golden(
            &mut emulator,
            &rom_path,
            &golden_path,
            None,
            &report_dir,
        )
        .expect_err("must reject empty script");
        assert!(err.contains("zero frames"), "got: {err}");

        emulator.stop().expect("stop");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
