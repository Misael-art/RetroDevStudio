use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

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

    let core_label = core
        .loaded_core_label()
        .unwrap_or("unknown")
        .to_string();

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

    let mut report_a =
        run_parity_capture(core, rom_path, &rom_sha256, &initial_state, &inputs)?;
    let report_b =
        run_parity_capture(core, rom_path, &rom_sha256, &initial_state, &inputs)?;

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
    }
    if reference.frames_run != observed.frames_run {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "frames_run_mismatch".to_string(),
            expected: reference.frames_run.to_string(),
            observed: observed.frames_run.to_string(),
        });
    }
    let limit = reference.frame_hashes.len().min(observed.frame_hashes.len());
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
        }
        if a.non_black_pixels != b.non_black_pixels {
            divergences.push(ParityDivergence {
                frame_index: a.frame_index,
                kind: "non_black_pixels_mismatch".to_string(),
                expected: a.non_black_pixels.to_string(),
                observed: b.non_black_pixels.to_string(),
            });
        }
    }
    if reference.frame_hashes.len() != observed.frame_hashes.len() {
        divergences.push(ParityDivergence {
            frame_index: limit as u32,
            kind: "frame_hashes_length_mismatch".to_string(),
            expected: reference.frame_hashes.len().to_string(),
            observed: observed.frame_hashes.len().to_string(),
        });
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

pub fn write_parity_report(
    report_dir: &Path,
    report: &ParityReport,
) -> Result<PathBuf, String> {
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

pub const CROSS_CORE_REPORT_SCHEMA: &str = "rds-cross-core-parity/v1";
pub const CYCLE_REPORT_SCHEMA: &str = "rds-cycle-report/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrossCoreDivergence {
    pub frame_index: u32,
    pub kind: String,
    pub core_a_hash: String,
    pub core_b_hash: String,
    pub core_a_non_black: usize,
    pub core_b_non_black: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrossCoreReport {
    pub schema: String,
    pub rom_path: String,
    pub rom_sha256: String,
    pub golden_path: String,
    pub golden_source: String,
    pub core_a_label: String,
    pub core_b_label: String,
    pub frames_run: u32,
    pub report_a: ParityReport,
    pub report_b: ParityReport,
    pub cross_divergences: Vec<CrossCoreDivergence>,
    pub cores_agree: bool,
    pub not_measured_by_this_harness: Vec<String>,
}

impl CrossCoreReport {
    fn not_measured_default() -> Vec<String> {
        vec![
            "audio_exact_match".to_string(),
            "m68k_cycle_trace".to_string(),
            "z80_cycle_trace".to_string(),
            "vdp_scanline_trace".to_string(),
            "dma_timing".to_string(),
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CycleFrameSample {
    pub frame_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_frame_time_micros: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_frame_budget_cycles: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimate_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CycleEvidenceSource {
    pub kind: String,
    pub label: String,
    pub path: String,
    pub observed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CycleTraceEvidence {
    pub status: String,
    pub source: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CycleReportLimitations {
    pub not_cycle_accurate: bool,
    pub missing: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CycleReport {
    pub schema: String,
    pub rom_path: String,
    pub rom_sha256: String,
    pub golden_path: String,
    pub core_label: String,
    pub frames_run: u32,
    pub frame_samples: Vec<CycleFrameSample>,
    pub evidence_sources: Vec<CycleEvidenceSource>,
    pub m68k_cycle_trace: CycleTraceEvidence,
    pub z80_cycle_trace: CycleTraceEvidence,
    pub vdp_scanline_trace: CycleTraceEvidence,
    pub dma_timing: CycleTraceEvidence,
    pub limitations: CycleReportLimitations,
    pub report_path: String,
}

fn missing_trace(field: &str) -> CycleTraceEvidence {
    CycleTraceEvidence {
        status: "missing".to_string(),
        source: "libretro".to_string(),
        detail: format!(
            "{field} nao e exposto pela API Libretro padrao usada por este harness."
        ),
    }
}

pub fn build_missing_cycle_report(
    golden_path: &Path,
    parity_report: &ParityReport,
    frames_run: u32,
    frame_samples: Vec<CycleFrameSample>,
) -> CycleReport {
    let missing = vec![
        "m68k_cycle_trace".to_string(),
        "z80_cycle_trace".to_string(),
        "vdp_scanline_trace".to_string(),
        "dma_timing".to_string(),
    ];

    CycleReport {
        schema: CYCLE_REPORT_SCHEMA.to_string(),
        rom_path: parity_report.rom_path.clone(),
        rom_sha256: parity_report.rom_sha256.clone(),
        golden_path: golden_path.to_string_lossy().to_string(),
        core_label: parity_report.core_label.clone(),
        frames_run,
        frame_samples,
        evidence_sources: vec![CycleEvidenceSource {
            kind: "libretro_frame_replay".to_string(),
            label: parity_report.core_label.clone(),
            path: parity_report.rom_path.clone(),
            observed: true,
        }],
        m68k_cycle_trace: missing_trace("m68k_cycle_trace"),
        z80_cycle_trace: missing_trace("z80_cycle_trace"),
        vdp_scanline_trace: missing_trace("vdp_scanline_trace"),
        dma_timing: missing_trace("dma_timing"),
        limitations: CycleReportLimitations {
            not_cycle_accurate: true,
            missing,
            notes: vec![
                "Este relatório evidencia replay/frame timing, mas nao mede ciclos internos de CPU/VDP/DMA.".to_string(),
                "Sem fonte de trace estruturada (ex.: adapter BlastEm ou core com trace), cycle accuracy permanece nao medida.".to_string(),
            ],
        },
        report_path: String::new(),
    }
}

pub fn run_cross_core_parity(
    rom_path: &Path,
    golden_path: &Path,
    core_a_path: &Path,
    core_b_path: &Path,
    frame_limit: Option<u32>,
    report_dir: &Path,
) -> Result<(CrossCoreReport, PathBuf), String> {
    if !rom_path.exists() {
        return Err(format!(
            "ROM '{}' nao existe para cross-core parity.",
            rom_path.display()
        ));
    }
    if !golden_path.exists() {
        return Err(format!(
            "Golden input '{}' nao existe para cross-core parity.",
            golden_path.display()
        ));
    }
    if !core_a_path.exists() {
        return Err(format!(
            "Core A '{}' nao existe para cross-core parity.",
            core_a_path.display()
        ));
    }
    if !core_b_path.exists() {
        return Err(format!(
            "Core B '{}' nao existe para cross-core parity.",
            core_b_path.display()
        ));
    }

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
            "Golden input '{}' produced zero frames; refusing to capture a cross-core parity report.",
            golden_path.display()
        ));
    }

    let rom_bytes = fs::read(rom_path).map_err(|error| {
        format!(
            "Could not read ROM '{}' for cross-core parity: {}",
            rom_path.display(),
            error
        )
    })?;
    let rom_sha256 = sha256_hex(&rom_bytes);

    let mut core_a = EmulatorCore::new(Some(core_a_path));
    core_a.load_rom(rom_path)?;
    let core_a_initial = core_a.capture_runtime_state_bytes()?;
    let report_a = run_parity_capture(
        &mut core_a,
        rom_path,
        &rom_sha256,
        &core_a_initial,
        &inputs,
    )?;
    core_a.stop().ok();

    let mut core_b = EmulatorCore::new(Some(core_b_path));
    core_b.load_rom(rom_path)?;
    let core_b_initial = core_b.capture_runtime_state_bytes()?;
    let report_b = run_parity_capture(
        &mut core_b,
        rom_path,
        &rom_sha256,
        &core_b_initial,
        &inputs,
    )?;
    core_b.stop().ok();

    let cross_divergences = compare_cross_core(&report_a, &report_b);
    let cores_agree = cross_divergences.is_empty();

    let report = CrossCoreReport {
        schema: CROSS_CORE_REPORT_SCHEMA.to_string(),
        rom_path: rom_path.to_string_lossy().to_string(),
        rom_sha256,
        golden_path: golden_path.to_string_lossy().to_string(),
        golden_source: golden.source_label().to_string(),
        core_a_label: report_a.core_label.clone(),
        core_b_label: report_b.core_label.clone(),
        frames_run: inputs.len() as u32,
        report_a,
        report_b,
        cross_divergences,
        cores_agree,
        not_measured_by_this_harness: CrossCoreReport::not_measured_default(),
    };

    let written = write_cross_core_report(report_dir, &report)?;
    Ok((report, written))
}

pub fn run_cycle_report(
    rom_path: &Path,
    golden_path: &Path,
    core_path: &Path,
    frame_limit: Option<u32>,
    report_dir: &Path,
) -> Result<(CycleReport, PathBuf), String> {
    if !rom_path.exists() {
        return Err(format!(
            "ROM '{}' nao existe para cycle report.",
            rom_path.display()
        ));
    }
    if !golden_path.exists() {
        return Err(format!(
            "Golden input '{}' nao existe para cycle report.",
            golden_path.display()
        ));
    }
    if !core_path.exists() {
        return Err(format!(
            "Core/reference '{}' nao existe para cycle report.",
            core_path.display()
        ));
    }

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
            "Golden input '{}' produced zero frames; refusing to generate an empty cycle report.",
            golden_path.display()
        ));
    }

    let rom_bytes = fs::read(rom_path).map_err(|error| {
        format!(
            "Could not read ROM '{}' for cycle report: {}",
            rom_path.display(),
            error
        )
    })?;
    let rom_sha256 = sha256_hex(&rom_bytes);

    let mut core = EmulatorCore::new(Some(core_path));
    core.load_rom(rom_path)?;
    let initial_state = core.capture_runtime_state_bytes()?;
    core.restore_runtime_state_bytes(&initial_state)?;
    let core_label = core.loaded_core_label().unwrap_or("unknown").to_string();

    let mut frame_hashes = Vec::with_capacity(inputs.len());
    let mut frame_samples = Vec::with_capacity(inputs.len());
    for (index, joypad) in inputs.iter().enumerate() {
        core.set_joypad(joypad.clone())?;
        let started = Instant::now();
        core.run_frame()?;
        let elapsed = started.elapsed();
        let (framebuffer, _size, _pixel_format) = core.get_framebuffer()?;
        frame_hashes.push(FrameHash {
            frame_index: index as u32,
            framebuffer_sha256: sha256_hex(&framebuffer),
            non_black_pixels: count_non_black_pixels(&framebuffer),
        });
        frame_samples.push(CycleFrameSample {
            frame_index: index as u32,
            host_frame_time_micros: Some(
                u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX),
            ),
            estimated_frame_budget_cycles: None,
            estimate_label: None,
        });
    }

    let final_state = core.capture_runtime_state_bytes()?;
    core.stop().ok();
    let parity_report = ParityReport::new(
        rom_path.to_string_lossy().to_string(),
        rom_sha256,
        core_label,
        inputs.len() as u32,
        frame_hashes,
        sha256_hex(&final_state),
        true,
        Vec::new(),
        false,
    );

    let mut report = build_missing_cycle_report(
        golden_path,
        &parity_report,
        inputs.len() as u32,
        frame_samples,
    );
    if let Some(source) = report.evidence_sources.first_mut() {
        source.path = core_path.to_string_lossy().to_string();
    }
    let written = write_cycle_report(report_dir, &report)?;
    report.report_path = written.to_string_lossy().to_string();
    Ok((report, written))
}

pub fn compare_cross_core(
    report_a: &ParityReport,
    report_b: &ParityReport,
) -> Vec<CrossCoreDivergence> {
    let mut divergences = Vec::new();
    if report_a.rom_sha256 != report_b.rom_sha256 {
        divergences.push(CrossCoreDivergence {
            frame_index: u32::MAX,
            kind: "rom_sha256_mismatch".to_string(),
            core_a_hash: report_a.rom_sha256.clone(),
            core_b_hash: report_b.rom_sha256.clone(),
            core_a_non_black: 0,
            core_b_non_black: 0,
        });
        return divergences;
    }
    if report_a.frames_run != report_b.frames_run {
        divergences.push(CrossCoreDivergence {
            frame_index: u32::MAX,
            kind: "frames_run_mismatch".to_string(),
            core_a_hash: report_a.frames_run.to_string(),
            core_b_hash: report_b.frames_run.to_string(),
            core_a_non_black: 0,
            core_b_non_black: 0,
        });
        return divergences;
    }
    let limit = report_a.frame_hashes.len().min(report_b.frame_hashes.len());
    for index in 0..limit {
        let a = &report_a.frame_hashes[index];
        let b = &report_b.frame_hashes[index];
        if a.framebuffer_sha256 != b.framebuffer_sha256 {
            divergences.push(CrossCoreDivergence {
                frame_index: a.frame_index,
                kind: "cross_core_frame_hash_mismatch".to_string(),
                core_a_hash: a.framebuffer_sha256.clone(),
                core_b_hash: b.framebuffer_sha256.clone(),
                core_a_non_black: a.non_black_pixels,
                core_b_non_black: b.non_black_pixels,
            });
        }
    }
    if report_a.frame_hashes.len() != report_b.frame_hashes.len() {
        divergences.push(CrossCoreDivergence {
            frame_index: limit as u32,
            kind: "frame_hashes_length_mismatch".to_string(),
            core_a_hash: report_a.frame_hashes.len().to_string(),
            core_b_hash: report_b.frame_hashes.len().to_string(),
            core_a_non_black: 0,
            core_b_non_black: 0,
        });
    }
    if report_a.final_state_sha256 != report_b.final_state_sha256 {
        divergences.push(CrossCoreDivergence {
            frame_index: u32::MAX,
            kind: "cross_core_final_state_mismatch".to_string(),
            core_a_hash: report_a.final_state_sha256.clone(),
            core_b_hash: report_b.final_state_sha256.clone(),
            core_a_non_black: 0,
            core_b_non_black: 0,
        });
    }
    divergences
}

pub fn write_cross_core_report(
    report_dir: &Path,
    report: &CrossCoreReport,
) -> Result<PathBuf, String> {
    fs::create_dir_all(report_dir).map_err(|error| {
        format!(
            "Could not create cross-core report dir '{}': {}",
            report_dir.display(),
            error
        )
    })?;
    let json_path = report_dir.join("cross-core-parity-report.json");
    let md_path = report_dir.join("cross-core-parity-report.md");

    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("Could not serialize cross-core parity report: {error}"))?;
    fs::write(&json_path, format!("{json}\n")).map_err(|error| {
        format!(
            "Could not write cross-core parity report '{}': {}",
            json_path.display(),
            error
        )
    })?;
    let markdown = render_cross_core_markdown(report);
    fs::write(&md_path, markdown).map_err(|error| {
        format!(
            "Could not write cross-core parity report markdown '{}': {}",
            md_path.display(),
            error
        )
    })?;
    Ok(json_path)
}

fn render_cross_core_markdown(report: &CrossCoreReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", report.schema));
    out.push_str(&format!("- **ROM**: `{}`\n", report.rom_path));
    out.push_str(&format!("- **ROM SHA-256**: `{}`\n", report.rom_sha256));
    out.push_str(&format!("- **Golden**: `{}`\n", report.golden_path));
    out.push_str(&format!("- **Golden source**: `{}`\n", report.golden_source));
    out.push_str(&format!("- **Core A**: `{}`\n", report.core_a_label));
    out.push_str(&format!("- **Core B**: `{}`\n", report.core_b_label));
    out.push_str(&format!("- **Frames run**: {}\n", report.frames_run));
    out.push_str(&format!(
        "- **Cores agree**: {}\n",
        if report.cores_agree { "sim" } else { "nao" }
    ));
    out.push_str(&format!(
        "- **Cross-core divergences**: {}\n",
        report.cross_divergences.len()
    ));
    if !report.cross_divergences.is_empty() {
        out.push_str("\n## Cross-core divergences\n\n");
        for d in &report.cross_divergences {
            out.push_str(&format!(
                "- frame {}: `{}` core_a=`{}` core_b=`{}` (non_black: {} vs {})\n",
                d.frame_index,
                d.kind,
                d.core_a_hash,
                d.core_b_hash,
                d.core_a_non_black,
                d.core_b_non_black
            ));
        }
    }
    out.push_str("\n## Per-core deterministic\n\n");
    out.push_str(&format!(
        "- Core A deterministic: {}\n",
        if report.report_a.deterministic { "sim" } else { "nao" }
    ));
    out.push_str(&format!(
        "- Core B deterministic: {}\n",
        if report.report_b.deterministic { "sim" } else { "nao" }
    ));
    out.push_str(&format!(
        "- Core A report: `{}`\n",
        report_dir_suffix(&report.report_a)
    ));
    out.push_str(&format!(
        "- Core B report: `{}`\n",
        report_dir_suffix(&report.report_b)
    ));
    if !report.not_measured_by_this_harness.is_empty() {
        out.push_str("\n## Not measured by this harness\n\n");
        for field in &report.not_measured_by_this_harness {
            out.push_str(&format!("- {field}\n"));
        }
    }
    out
}

pub fn write_cycle_report(report_dir: &Path, report: &CycleReport) -> Result<PathBuf, String> {
    fs::create_dir_all(report_dir).map_err(|error| {
        format!(
            "Could not create cycle report dir '{}': {}",
            report_dir.display(),
            error
        )
    })?;
    let json_path = report_dir.join("cycle-report.json");
    let md_path = report_dir.join("cycle-report.md");
    let mut persisted = report.clone();
    persisted.report_path = json_path.to_string_lossy().to_string();

    let json = serde_json::to_string_pretty(&persisted)
        .map_err(|error| format!("Could not serialize cycle report: {error}"))?;
    fs::write(&json_path, format!("{json}\n")).map_err(|error| {
        format!(
            "Could not write cycle report '{}': {}",
            json_path.display(),
            error
        )
    })?;
    let markdown = render_cycle_markdown(&persisted);
    fs::write(&md_path, markdown).map_err(|error| {
        format!(
            "Could not write cycle report markdown '{}': {}",
            md_path.display(),
            error
        )
    })?;
    Ok(json_path)
}

fn render_cycle_markdown(report: &CycleReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", report.schema));
    out.push_str(&format!("- **ROM**: `{}`\n", report.rom_path));
    out.push_str(&format!("- **ROM SHA-256**: `{}`\n", report.rom_sha256));
    out.push_str(&format!("- **Golden**: `{}`\n", report.golden_path));
    out.push_str(&format!("- **Core/reference**: `{}`\n", report.core_label));
    out.push_str(&format!("- **Frames run**: {}\n", report.frames_run));
    out.push_str(&format!(
        "- **not cycle accurate**: {}\n",
        report.limitations.not_cycle_accurate
    ));
    out.push_str("\n## Cycle Trace Availability\n\n");
    out.push_str(&format!(
        "- m68k_cycle_trace: `{}` - {}\n",
        report.m68k_cycle_trace.status, report.m68k_cycle_trace.detail
    ));
    out.push_str(&format!(
        "- z80_cycle_trace: `{}` - {}\n",
        report.z80_cycle_trace.status, report.z80_cycle_trace.detail
    ));
    out.push_str(&format!(
        "- vdp_scanline_trace: `{}` - {}\n",
        report.vdp_scanline_trace.status, report.vdp_scanline_trace.detail
    ));
    out.push_str(&format!(
        "- dma_timing: `{}` - {}\n",
        report.dma_timing.status, report.dma_timing.detail
    ));
    if !report.frame_samples.is_empty() {
        out.push_str("\n## Frame Samples\n\n");
        for sample in report.frame_samples.iter().take(12) {
            let timing = sample
                .host_frame_time_micros
                .map(|micros| format!("{micros}us host"))
                .unwrap_or_else(|| "timing missing".to_string());
            out.push_str(&format!("- frame {}: {timing}\n", sample.frame_index));
        }
    }
    if !report.limitations.missing.is_empty() {
        out.push_str("\n## Missing Evidence\n\n");
        for item in &report.limitations.missing {
            out.push_str(&format!("- {item}\n"));
        }
    }
    if !report.limitations.notes.is_empty() {
        out.push_str("\n## Notes\n\n");
        for note in &report.limitations.notes {
            out.push_str(&format!("- {note}\n"));
        }
    }
    out
}

// ============================================================================
// Reference-vs-Candidate parity contract (Experimental)
//
// This is a SEPARATE contract from `compare_runs`/`compare_cross_core`. Those
// prove determinism of the *same* ROM and short-circuit on a ROM SHA mismatch.
// Here the two ROMs are EXPECTED to differ (a reference ROM and a candidate ROM
// with a different SHA-256), run on the SAME core/version/config, each cold
// booted independently (no cross-restoring of save state), against the SAME
// deterministic input script.
//
// The comparator classifies the *evidence level* only. It NEVER emits a
// "functionally equivalent" / "matched" claim just because a scenario passed.
// The strongest per-scenario claim is `ObservedStateParity`; the strongest
// suite-level claim is `FunctionalEvidence` ("scenarios passed"), which is
// still explicitly NOT total equivalence.
// ============================================================================

pub const REFERENCE_CANDIDATE_REPORT_SCHEMA: &str = "rds-reference-candidate-parity/v1";

/// Evidence produced by a reference-vs-candidate comparison. Intentionally has
/// NO "Equivalent"/"MatchExact" variant: this harness cannot and must not claim
/// total functional equivalence from framebuffer/observed-state evidence alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParityEvidenceLevel {
    /// Divergence detected, or no frames were compared. No positive claim.
    InsufficientEvidence,
    /// Every compared frame's framebuffer hash matched. Visual signal only —
    /// no normalized memory state was available to corroborate.
    VisualParity,
    /// Framebuffers matched AND normalized memory regions were actually
    /// available and matched. Strongest per-scenario evidence; still not
    /// "equivalence".
    ObservedStateParity,
    /// Suite-level verdict: one or more deterministic scenarios ran to
    /// completion without divergence. Records that scenarios passed WITHOUT
    /// asserting total equivalence.
    FunctionalEvidence,
}

/// Normalized memory observation for a single scenario. `available` is `false`
/// whenever the core/host cannot expose comparable normalized regions (the case
/// on hosts without a memory-introspecting core); the comparison then records a
/// limitation instead of silently comparing full, ROM-specific save states.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservedState {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_regions_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_regions_sha256: Option<String>,
    #[serde(default)]
    pub region_labels: Vec<String>,
}

impl ObservedState {
    /// Explicitly unavailable observation (host without normalized memory
    /// extraction). Comparisons downgrade to visual-only and log the limitation.
    pub fn unavailable() -> Self {
        Self {
            available: false,
            reference_regions_sha256: None,
            candidate_regions_sha256: None,
            region_labels: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceCandidateComparison {
    pub evidence_level: ParityEvidenceLevel,
    /// True only when >0 frames compared and all framebuffer hashes matched.
    pub visual_parity: bool,
    /// True only when observed state was available and matched.
    pub observed_state_parity: bool,
    /// True when no divergence was recorded and at least one frame was compared.
    pub scenario_passed: bool,
    pub frames_compared: u32,
    pub reference_rom_sha256: String,
    pub candidate_rom_sha256: String,
    pub divergences: Vec<ParityDivergence>,
    pub limitations: Vec<String>,
}

/// Pure comparison of a reference report against a candidate report. The two
/// reports come from DIFFERENT ROMs (different SHA is expected, not an error).
pub fn compare_reference_candidate(
    reference: &ParityReport,
    candidate: &ParityReport,
    observed: &ObservedState,
) -> ReferenceCandidateComparison {
    let mut divergences = Vec::new();
    let mut limitations = Vec::new();

    // Same-core/version/config is a HARD requirement of this contract. Differing
    // core labels invalidate any parity claim.
    if reference.core_label != candidate.core_label {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "core_label_mismatch".to_string(),
            expected: reference.core_label.clone(),
            observed: candidate.core_label.clone(),
        });
    }

    if reference.frames_run != candidate.frames_run {
        divergences.push(ParityDivergence {
            frame_index: u32::MAX,
            kind: "frames_run_mismatch".to_string(),
            expected: reference.frames_run.to_string(),
            observed: candidate.frames_run.to_string(),
        });
    }

    let limit = reference
        .frame_hashes
        .len()
        .min(candidate.frame_hashes.len());
    for index in 0..limit {
        let a = &reference.frame_hashes[index];
        let b = &candidate.frame_hashes[index];
        if a.framebuffer_sha256 != b.framebuffer_sha256 {
            divergences.push(ParityDivergence {
                frame_index: a.frame_index,
                kind: "reference_candidate_frame_hash_mismatch".to_string(),
                expected: a.framebuffer_sha256.clone(),
                observed: b.framebuffer_sha256.clone(),
            });
        }
    }
    if reference.frame_hashes.len() != candidate.frame_hashes.len() {
        divergences.push(ParityDivergence {
            frame_index: limit as u32,
            kind: "frame_hashes_length_mismatch".to_string(),
            expected: reference.frame_hashes.len().to_string(),
            observed: candidate.frame_hashes.len().to_string(),
        });
    }

    // Observed (normalized) memory state: compare ONLY when actually available.
    // We deliberately do NOT compare `final_state_sha256` here: for two distinct
    // ROMs the full runtime save state always differs and proves nothing.
    let mut observed_state_parity = false;
    if observed.available {
        match (
            &observed.reference_regions_sha256,
            &observed.candidate_regions_sha256,
        ) {
            (Some(a), Some(b)) if a == b => {
                observed_state_parity = true;
            }
            (Some(a), Some(b)) => {
                divergences.push(ParityDivergence {
                    frame_index: u32::MAX,
                    kind: "observed_state_mismatch".to_string(),
                    expected: a.clone(),
                    observed: b.clone(),
                });
            }
            _ => {
                limitations.push(
                    "observed_state marked available but region hashes were missing".to_string(),
                );
            }
        }
    } else {
        limitations.push(
            "normalized memory observation unavailable on this host/core; evidence is visual-only"
                .to_string(),
        );
    }

    let frames_compared = limit as u32;
    let has_frames = frames_compared > 0;
    let visual_parity = has_frames
        && !divergences.iter().any(|d| {
            d.kind == "reference_candidate_frame_hash_mismatch"
                || d.kind == "frame_hashes_length_mismatch"
                || d.kind == "frames_run_mismatch"
                || d.kind == "core_label_mismatch"
        });
    let scenario_passed = has_frames && divergences.is_empty();

    let evidence_level = if !visual_parity {
        ParityEvidenceLevel::InsufficientEvidence
    } else if observed.available {
        if observed_state_parity {
            ParityEvidenceLevel::ObservedStateParity
        } else {
            // frames matched but observed state diverged/incomplete
            ParityEvidenceLevel::InsufficientEvidence
        }
    } else {
        ParityEvidenceLevel::VisualParity
    };

    ReferenceCandidateComparison {
        evidence_level,
        visual_parity,
        observed_state_parity,
        scenario_passed,
        frames_compared,
        reference_rom_sha256: reference.rom_sha256.clone(),
        candidate_rom_sha256: candidate.rom_sha256.clone(),
        divergences,
        limitations,
    }
}

/// Suite-level aggregate over several scenario comparisons. Returns
/// `FunctionalEvidence` only when EVERY scenario passed without divergence and
/// at least one scenario was present — and even then this is "scenarios
/// passed", never "equivalent". Any failing/empty scenario yields
/// `InsufficientEvidence`.
pub fn aggregate_functional_evidence(
    comparisons: &[ReferenceCandidateComparison],
) -> ParityEvidenceLevel {
    if comparisons.is_empty() || comparisons.iter().any(|c| !c.scenario_passed) {
        return ParityEvidenceLevel::InsufficientEvidence;
    }
    ParityEvidenceLevel::FunctionalEvidence
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceCandidateReport {
    pub schema: String,
    pub reference_rom_path: String,
    pub reference_rom_sha256: String,
    pub candidate_rom_path: String,
    pub candidate_rom_sha256: String,
    pub core_label: String,
    pub golden_path: String,
    pub golden_source: String,
    pub frames_run: u32,
    pub report_reference: ParityReport,
    pub report_candidate: ParityReport,
    pub comparison: ReferenceCandidateComparison,
    /// Suite-level verdict over the scenario(s) in this report. `FunctionalEvidence`
    /// only when every scenario passed; still never "total equivalence".
    pub functional_evidence: ParityEvidenceLevel,
    pub not_measured_by_this_harness: Vec<String>,
}

/// Runs the reference and candidate ROMs on the SAME core, each cold booted
/// independently (its own captured initial state — the reference's save state is
/// NEVER restored into the candidate), against the same deterministic script.
///
/// Requires a real Libretro core, so it is exercised by gated/`#[ignore]` tests
/// on hosts that ship a core. The pure comparator/aggregator/writer above carry
/// the deterministic unit coverage.
pub fn run_reference_candidate_parity(
    reference_rom: &Path,
    candidate_rom: &Path,
    golden_path: &Path,
    core_path: &Path,
    frame_limit: Option<u32>,
    report_dir: &Path,
) -> Result<(ReferenceCandidateReport, PathBuf), String> {
    for (label, path) in [
        ("Reference ROM", reference_rom),
        ("Candidate ROM", candidate_rom),
        ("Golden input", golden_path),
        ("Core", core_path),
    ] {
        if !path.exists() {
            return Err(format!(
                "{label} '{}' nao existe para reference/candidate parity.",
                path.display()
            ));
        }
    }

    let reference_bytes = fs::read(reference_rom)
        .map_err(|error| format!("Could not read reference ROM '{}': {}", reference_rom.display(), error))?;
    let candidate_bytes = fs::read(candidate_rom)
        .map_err(|error| format!("Could not read candidate ROM '{}': {}", candidate_rom.display(), error))?;
    let reference_sha = sha256_hex(&reference_bytes);
    let candidate_sha = sha256_hex(&candidate_bytes);

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
            "Golden input '{}' produced zero frames; refusing to capture a reference/candidate report.",
            golden_path.display()
        ));
    }

    // Reference ROM: independent cold boot, capture its OWN initial state.
    let mut ref_core = EmulatorCore::new(Some(core_path));
    ref_core.load_rom(reference_rom)?;
    let ref_initial = ref_core.capture_runtime_state_bytes()?;
    let report_reference =
        run_parity_capture(&mut ref_core, reference_rom, &reference_sha, &ref_initial, &inputs)?;
    ref_core.stop().ok();

    // Candidate ROM: independent cold boot, capture its OWN initial state.
    // The reference's save state is intentionally never restored here.
    let mut cand_core = EmulatorCore::new(Some(core_path));
    cand_core.load_rom(candidate_rom)?;
    let cand_initial = cand_core.capture_runtime_state_bytes()?;
    let report_candidate =
        run_parity_capture(&mut cand_core, candidate_rom, &candidate_sha, &cand_initial, &inputs)?;
    cand_core.stop().ok();

    // Normalized memory observation is not exposed by the standard Libretro path
    // used here, so the comparison is honestly visual-only for now.
    let comparison = compare_reference_candidate(
        &report_reference,
        &report_candidate,
        &ObservedState::unavailable(),
    );
    let functional_evidence = aggregate_functional_evidence(std::slice::from_ref(&comparison));

    let report = ReferenceCandidateReport {
        schema: REFERENCE_CANDIDATE_REPORT_SCHEMA.to_string(),
        reference_rom_path: reference_rom.to_string_lossy().to_string(),
        reference_rom_sha256: reference_sha,
        candidate_rom_path: candidate_rom.to_string_lossy().to_string(),
        candidate_rom_sha256: candidate_sha,
        core_label: report_reference.core_label.clone(),
        golden_path: golden_path.to_string_lossy().to_string(),
        golden_source: golden.source_label().to_string(),
        frames_run: inputs.len() as u32,
        report_reference,
        report_candidate,
        comparison,
        functional_evidence,
        not_measured_by_this_harness: ParityReport::not_measured_default(),
    };

    let written = write_reference_candidate_report(report_dir, &report)?;
    Ok((report, written))
}

pub fn write_reference_candidate_report(
    report_dir: &Path,
    report: &ReferenceCandidateReport,
) -> Result<PathBuf, String> {
    fs::create_dir_all(report_dir).map_err(|error| {
        format!(
            "Could not create reference/candidate report dir '{}': {}",
            report_dir.display(),
            error
        )
    })?;
    let json_path = report_dir.join("reference-candidate-parity-report.json");
    let md_path = report_dir.join("reference-candidate-parity-report.md");

    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("Could not serialize reference/candidate report: {error}"))?;
    fs::write(&json_path, format!("{json}\n")).map_err(|error| {
        format!("Could not write report '{}': {}", json_path.display(), error)
    })?;
    fs::write(&md_path, render_reference_candidate_markdown(report)).map_err(|error| {
        format!("Could not write report markdown '{}': {}", md_path.display(), error)
    })?;
    Ok(json_path)
}

fn render_reference_candidate_markdown(report: &ReferenceCandidateReport) -> String {
    let cmp = &report.comparison;
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", report.schema));
    out.push_str(&format!("- **Core**: `{}`\n", report.core_label));
    out.push_str(&format!("- **Golden input**: `{}` ({})\n", report.golden_path, report.golden_source));
    out.push_str(&format!("- **Frames run**: {}\n", report.frames_run));
    out.push_str(&format!(
        "- **Reference ROM**: `{}` sha=`{}`\n",
        report.reference_rom_path, report.reference_rom_sha256
    ));
    out.push_str(&format!(
        "- **Candidate ROM**: `{}` sha=`{}`\n",
        report.candidate_rom_path, report.candidate_rom_sha256
    ));
    out.push_str(&format!("- **Evidence level**: `{:?}`\n", cmp.evidence_level));
    out.push_str(&format!(
        "- **Suite functional evidence**: `{:?}`\n",
        report.functional_evidence
    ));
    out.push_str(&format!("- **Visual parity**: {}\n", cmp.visual_parity));
    out.push_str(&format!("- **Observed-state parity**: {}\n", cmp.observed_state_parity));
    out.push_str(&format!("- **Scenario passed**: {}\n", cmp.scenario_passed));
    out.push_str(&format!("- **Frames compared**: {}\n", cmp.frames_compared));
    out.push_str(
        "\n> This report does NOT assert total functional equivalence. The strongest claim it can\n> make is scenario-level evidence.\n",
    );
    if !cmp.divergences.is_empty() {
        out.push_str("\n## Divergences\n\n");
        for d in &cmp.divergences {
            out.push_str(&format!(
                "- frame {}: `{}` reference=`{}` candidate=`{}`\n",
                d.frame_index, d.kind, d.expected, d.observed
            ));
        }
    }
    if !cmp.limitations.is_empty() {
        out.push_str("\n## Limitations\n\n");
        for item in &cmp.limitations {
            out.push_str(&format!("- {item}\n"));
        }
    }
    if !report.not_measured_by_this_harness.is_empty() {
        out.push_str("\n## Not measured by this harness\n\n");
        for field in &report.not_measured_by_this_harness {
            out.push_str(&format!("- {field}\n"));
        }
    }
    out
}

fn report_dir_suffix(report: &ParityReport) -> String {
    format!(
        "frames={} det={} div={}",
        report.frames_run,
        if report.deterministic { 1 } else { 0 },
        report.divergences.len()
    )
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
                FrameHash { frame_index: 0, framebuffer_sha256: "h0".to_string(), non_black_pixels: 10 },
                FrameHash { frame_index: 1, framebuffer_sha256: "h1".to_string(), non_black_pixels: 11 },
                FrameHash { frame_index: 2, framebuffer_sha256: "h2".to_string(), non_black_pixels: 12 },
                FrameHash { frame_index: 3, framebuffer_sha256: "h3".to_string(), non_black_pixels: 13 },
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
        let divergences = compare_runs(&a, &b);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "frame_hash_mismatch");
        assert_eq!(divergences[0].frame_index, 2);
    }

    #[test]
    fn compare_runs_keeps_final_state_divergence_when_frame_hash_differs() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frame_hashes[2].framebuffer_sha256 = "different".to_string();
        b.final_state_sha256 = "different-state".to_string();

        let divergences = compare_runs(&a, &b);

        assert!(divergences
            .iter()
            .any(|divergence| divergence.kind == "frame_hash_mismatch"));
        assert!(divergences
            .iter()
            .any(|divergence| divergence.kind == "final_state_mismatch"));
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
        assert!(name.contains("parity"), "file name should contain parity substring, got: {name}");
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
                JoypadState { a: true, ..JoypadState::default() },
                JoypadState::default(),
                JoypadState { start: true, ..JoypadState::default() },
            ],
            final_framebuffer: vec![0u8; 32],
            final_frame_size: crate::emulator::libretro_ffi::FrameSize { width: 256, height: 224, pitch: 1024 },
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
            JoypadState { up: true, ..JoypadState::default() },
            JoypadState { b: true, a: true, ..JoypadState::default() },
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
            final_frame_size: crate::emulator::libretro_ffi::FrameSize { width: 256, height: 224, pitch: 1024 },
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
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};
        use crate::emulator::libretro_ffi::EmulatorCore;

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("parity-golden-limit");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "limit_rom", "gen");

        let script = InputScript::from_frames(vec![
            JoypadState { a: true, ..JoypadState::default() },
            JoypadState { b: true, ..JoypadState::default() },
            JoypadState { x: true, ..JoypadState::default() },
            JoypadState { y: true, ..JoypadState::default() },
        ]);
        let golden_path = dir.join("many.rds-input.json");
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");

        let report_dir = dir.join(".rds").join("reports");
        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator.load_rom(&rom_path).expect("load rom");

        let (report, _) = run_parity_capture_against_golden(&mut emulator, &rom_path, &golden_path, Some(2), &report_dir).expect("capture with frame_limit");
        assert_eq!(report.frames_run, 2);
        assert_eq!(report.frame_hashes.len(), 2);

        emulator.stop().expect("stop");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_parity_capture_against_golden_rejects_empty_script() {
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};
        use crate::emulator::libretro_ffi::EmulatorCore;

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("parity-golden-empty");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "empty_rom", "gen");
        let golden_path = dir.join("empty.rds-input.json");
        let script = InputScript::from_frames(Vec::new());
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");

        let report_dir = dir.join(".rds").join("reports");
        let mut emulator = EmulatorCore::new(Some(&core_path));
        emulator.load_rom(&rom_path).expect("load rom");

        let err = run_parity_capture_against_golden(&mut emulator, &rom_path, &golden_path, None, &report_dir).expect_err("must reject empty script");
        assert!(err.contains("zero frames"), "got: {err}");

        emulator.stop().expect("stop");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── Cross-core tests ───────────────────────────────────────────────────────

    fn sample_cross_core_report(agree: bool, frame_hash_diff_at: Option<u32>) -> CrossCoreReport {
        let core_a = sample_report(true, None);
        let mut core_b = core_a.clone();
        if let Some(frame_idx) = frame_hash_diff_at {
            if let Some(frame) = core_b
                .frame_hashes
                .iter_mut()
                .find(|f| f.frame_index == frame_idx)
            {
                frame.framebuffer_sha256 = "different_core_hash".to_string();
                frame.non_black_pixels = 99;
            }
            core_b.final_state_sha256 = "different_final".to_string();
        }
        let cross_divergences = compare_cross_core(&core_a, &core_b);
        CrossCoreReport {
            schema: CROSS_CORE_REPORT_SCHEMA.to_string(),
            rom_path: "/tmp/rom.bin".to_string(),
            rom_sha256: "abc123".to_string(),
            golden_path: "/tmp/golden.rds-input.json".to_string(),
            golden_source: "script".to_string(),
            core_a_label: "MockCoreA".to_string(),
            core_b_label: "MockCoreB".to_string(),
            frames_run: 4,
            report_a: core_a,
            report_b: core_b,
            cross_divergences,
            cores_agree: agree,
            not_measured_by_this_harness: CrossCoreReport::not_measured_default(),
        }
    }

    #[test]
    fn compare_cross_core_returns_empty_for_identical_reports() {
        let divs = compare_cross_core(&sample_report(true, None), &sample_report(true, None));
        assert!(divs.is_empty());
    }

    #[test]
    fn compare_cross_core_detects_frame_hash_divergence() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frame_hashes[2].framebuffer_sha256 = "core_b_hash".to_string();
        b.final_state_sha256 = "core_b_final".to_string();
        let divs = compare_cross_core(&a, &b);
        assert!(!divs.is_empty());
        assert_eq!(divs[0].kind, "cross_core_frame_hash_mismatch");
        assert_eq!(divs[0].frame_index, 2);
    }

    #[test]
    fn compare_cross_core_keeps_final_state_divergence_when_frame_hash_differs() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frame_hashes[1].framebuffer_sha256 = "core_b_hash".to_string();
        b.final_state_sha256 = "core_b_final".to_string();

        let divs = compare_cross_core(&a, &b);

        assert!(divs
            .iter()
            .any(|divergence| divergence.kind == "cross_core_frame_hash_mismatch"));
        assert!(divs
            .iter()
            .any(|divergence| divergence.kind == "cross_core_final_state_mismatch"));
    }

    #[test]
    fn compare_cross_core_detects_final_state_divergence_when_hashes_agree() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frame_hashes = a.frame_hashes.clone();
        b.final_state_sha256 = "core_b_final".to_string();
        let divs = compare_cross_core(&a, &b);
        assert!(!divs.is_empty());
        assert_eq!(divs[0].kind, "cross_core_final_state_mismatch");
    }

    #[test]
    fn compare_cross_core_detects_rom_sha256_mismatch_early() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.rom_sha256 = "different-rom".to_string();
        let divs = compare_cross_core(&a, &b);
        assert_eq!(divs.len(), 1);
        assert_eq!(divs[0].kind, "rom_sha256_mismatch");
    }

    #[test]
    fn compare_cross_core_detects_frames_run_mismatch() {
        let a = sample_report(true, None);
        let mut b = a.clone();
        b.frames_run = a.frames_run + 1;
        let divs = compare_cross_core(&a, &b);
        assert_eq!(divs.len(), 1);
        assert_eq!(divs[0].kind, "frames_run_mismatch");
    }

    #[test]
    fn write_cross_core_report_creates_json_and_md() {
        let dir = temp_dir("cross-core-writer");
        let report = sample_cross_core_report(true, None);
        let path = write_cross_core_report(&dir, &report).expect("write cross-core report");
        assert!(path.exists());
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        assert!(
            name.contains("cross-core"),
            "file name should contain cross-core, got: {name}"
        );

        let json = fs::read_to_string(&path).expect("read json");
        assert!(json.contains(CROSS_CORE_REPORT_SCHEMA));
        assert!(json.contains("MockCoreA"));
        assert!(json.contains("MockCoreB"));

        let md_path = dir.join("cross-core-parity-report.md");
        assert!(md_path.exists());
        let md = fs::read_to_string(&md_path).expect("read md");
        assert!(md.contains("Cross-core"));
        assert!(md.contains("Cores agree"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_cross_core_report_shows_divergences_in_markdown() {
        let dir = temp_dir("cross-core-writer-div");
        let report = sample_cross_core_report(false, Some(1));
        write_cross_core_report(&dir, &report).expect("write");
        let md = fs::read_to_string(dir.join("cross-core-parity-report.md")).expect("read");
        assert!(md.contains("Cross-core divergences"));
        assert!(md.contains("cross_core_frame_hash_mismatch"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_missing_cycle_report_marks_trace_sources_as_missing() {
        let base = sample_report(true, None);
        let report = build_missing_cycle_report(
            Path::new("/tmp/golden.rds-input.json"),
            &base,
            4,
            Vec::new(),
        );

        assert_eq!(report.schema, CYCLE_REPORT_SCHEMA);
        assert_eq!(report.frames_run, 4);
        assert_eq!(report.m68k_cycle_trace.status, "missing");
        assert_eq!(report.z80_cycle_trace.status, "missing");
        assert_eq!(report.vdp_scanline_trace.status, "missing");
        assert_eq!(report.dma_timing.status, "missing");
        assert!(report.limitations.not_cycle_accurate);
    }

    #[test]
    fn write_cycle_report_creates_json_and_markdown_with_limitations() {
        let dir = temp_dir("cycle-writer");
        let base = sample_report(true, None);
        let report = build_missing_cycle_report(
            Path::new("/tmp/golden.rds-input.json"),
            &base,
            4,
            vec![CycleFrameSample {
                frame_index: 0,
                host_frame_time_micros: Some(1234),
                estimated_frame_budget_cycles: None,
                estimate_label: None,
            }],
        );

        let path = write_cycle_report(&dir, &report).expect("write cycle report");

        assert!(path.exists());
        let json = fs::read_to_string(&path).expect("read json");
        assert!(json.contains(CYCLE_REPORT_SCHEMA));
        assert!(json.contains("\"report_path\""));
        let md = fs::read_to_string(dir.join("cycle-report.md")).expect("read md");
        assert!(md.contains("not cycle accurate"));
        assert!(md.contains("m68k_cycle_trace"));
        assert!(md.contains("1234us host"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_cross_core_parity_rejects_empty_script() {
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("cross-core-empty");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "cross_empty_rom", "gen");
        let golden_path = dir.join("empty.rds-input.json");
        let script = InputScript::from_frames(Vec::new());
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");
        let report_dir = dir.join(".rds").join("reports");

        let err = run_cross_core_parity(
            &rom_path,
            &golden_path,
            &core_path,
            &core_path,
            None,
            &report_dir,
        )
        .expect_err("must reject empty script");
        assert!(err.contains("zero frames"), "got: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_cross_core_parity_respects_frame_limit() {
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("cross-core-limit");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "cross_limit_rom", "gen");

        let script = InputScript::from_frames(vec![
            JoypadState { a: true, ..JoypadState::default() },
            JoypadState { b: true, ..JoypadState::default() },
            JoypadState { x: true, ..JoypadState::default() },
        ]);
        let golden_path = dir.join("limit.rds-input.json");
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");
        let report_dir = dir.join(".rds").join("reports");

        let (report, _) = run_cross_core_parity(
            &rom_path,
            &golden_path,
            &core_path,
            &core_path,
            Some(2),
            &report_dir,
        )
        .expect("cross-core with frame_limit");
        assert_eq!(report.frames_run, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_cross_core_parity_rejects_missing_core_path() {
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("cross-core-missing-core");
        let core_path = compile_mock_core(&dir);
        let missing_core = dir.join("missing_core.dll");
        let rom_path = write_test_rom(&dir, "cross_missing_core_rom", "gen");
        let script = InputScript::from_frames(vec![JoypadState::default()]);
        let golden_path = dir.join("one.rds-input.json");
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");
        let report_dir = dir.join(".rds").join("reports");

        let err = run_cross_core_parity(
            &rom_path,
            &golden_path,
            &core_path,
            &missing_core,
            None,
            &report_dir,
        )
        .expect_err("missing core must fail before loading");
        assert!(err.contains("Core B"), "got: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_cycle_report_rejects_empty_script() {
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("cycle-empty");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "cycle_empty_rom", "gen");
        let golden_path = dir.join("empty.rds-input.json");
        let script = InputScript::from_frames(Vec::new());
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");
        let report_dir = dir.join(".rds").join("reports");

        let err = run_cycle_report(
            &rom_path,
            &golden_path,
            &core_path,
            None,
            &report_dir,
        )
        .expect_err("must reject empty cycle input");
        assert!(err.contains("zero frames"), "got: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_cycle_report_respects_frame_limit_and_writes_reports() {
        use crate::emulator::libretro_ffi::test_helpers::{compile_mock_core, temp_dir as emu_temp_dir, test_serial_guard, write_test_rom};

        let _serial = test_serial_guard();
        let dir = emu_temp_dir("cycle-limit");
        let core_path = compile_mock_core(&dir);
        let rom_path = write_test_rom(&dir, "cycle_limit_rom", "gen");
        let script = InputScript::from_frames(vec![
            JoypadState { a: true, ..JoypadState::default() },
            JoypadState { b: true, ..JoypadState::default() },
            JoypadState { x: true, ..JoypadState::default() },
        ]);
        let golden_path = dir.join("cycle.rds-input.json");
        fs::write(&golden_path, serde_json::to_vec_pretty(&script).expect("serialize")).expect("write golden");
        let report_dir = dir.join(".rds").join("reports");

        let (report, written) = run_cycle_report(
            &rom_path,
            &golden_path,
            &core_path,
            Some(2),
            &report_dir,
        )
        .expect("cycle report");

        assert_eq!(report.frames_run, 2);
        assert_eq!(report.frame_samples.len(), 2);
        assert!(written.ends_with("cycle-report.json"));
        assert!(report_dir.join("cycle-report.md").exists());
        assert_eq!(report.m68k_cycle_trace.status, "missing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "host-local W7.4/W7.5 validation with real Libretro Mega Drive cores"]
    fn w7_4_w7_5_real_cores_generate_reports_when_available() {
        use crate::emulator::libretro_ffi::test_helpers::test_serial_guard;

        let _serial = test_serial_guard();
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .to_path_buf();
        let validation_root = repo_root
            .join("src-tauri")
            .join("target-test")
            .join("validation")
            .join("w7-4-w7-5-real-parity");
        let project_dir = validation_root.join("project");
        let rom_dir = project_dir.join("build").join("megadrive").join("out");
        let report_dir = project_dir.join(".rds").join("reports");
        fs::create_dir_all(&rom_dir).expect("create validation rom dir");
        fs::create_dir_all(&report_dir).expect("create validation reports dir");

        let fixture_rom = repo_root
            .join("src-tauri")
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join("megadrive_dummy")
            .join("build")
            .join("megadrive")
            .join("out")
            .join("rom.bin");
        let rom_path = rom_dir.join("rom.bin");
        fs::copy(&fixture_rom, &rom_path).expect("copy safe dummy ROM");

        let golden_path = project_dir.join("golden.rds-input.json");
        let script = InputScript::from_frames(vec![
            JoypadState::default(),
            JoypadState { start: true, ..JoypadState::default() },
            JoypadState { right: true, ..JoypadState::default() },
        ]);
        fs::write(
            &golden_path,
            serde_json::to_vec_pretty(&script).expect("serialize golden"),
        )
        .expect("write golden");

        let cores_dir = repo_root.join("toolchains").join("libretro").join("cores");
        let core_a = cores_dir.join("genesis_plus_gx_libretro.dll");
        let core_b = cores_dir.join("picodrive_libretro.dll");
        assert!(core_a.exists(), "Genesis Plus GX core missing at {}", core_a.display());
        assert!(core_b.exists(), "Picodrive core missing at {}", core_b.display());

        let (cross_report, cross_path) = run_cross_core_parity(
            &rom_path,
            &golden_path,
            &core_a,
            &core_b,
            Some(3),
            &report_dir,
        )
        .expect("real cross-core parity");
        assert_eq!(cross_report.frames_run, 3);
        assert!(cross_path.exists());
        assert!(report_dir.join("cross-core-parity-report.md").exists());

        let (cycle_report, cycle_path) = run_cycle_report(
            &rom_path,
            &golden_path,
            &core_a,
            Some(3),
            &report_dir,
        )
        .expect("real cycle report");
        assert_eq!(cycle_report.frames_run, 3);
        assert_eq!(cycle_report.m68k_cycle_trace.status, "missing");
        assert!(cycle_path.exists());
        assert!(report_dir.join("cycle-report.md").exists());
    }

    #[test]
    #[ignore = "host-local: real Libretro core reference/candidate parity (needs core .so/.dll + fixture ROM)"]
    fn reference_candidate_real_core_generates_report() {
        use crate::emulator::libretro_ffi::test_helpers::test_serial_guard;

        let _serial = test_serial_guard();
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .to_path_buf();
        let fixture_rom = repo_root
            .join("src-tauri")
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join("megadrive_dummy")
            .join("build")
            .join("megadrive")
            .join("out")
            .join("rom.bin");
        let core_ext = if cfg!(target_os = "windows") {
            "dll"
        } else if cfg!(target_os = "macos") {
            "dylib"
        } else {
            "so"
        };
        let core = repo_root
            .join("toolchains")
            .join("libretro")
            .join("cores")
            .join(format!("genesis_plus_gx_libretro.{core_ext}"));
        if !fixture_rom.exists() || !core.exists() {
            eprintln!(
                "skipping: fixture ROM or core missing (rom={}, core={})",
                fixture_rom.display(),
                core.display()
            );
            return;
        }

        let work = repo_root
            .join("src-tauri")
            .join("target-test")
            .join("validation")
            .join("reference-candidate-real");
        fs::create_dir_all(&work).expect("create work dir");
        let golden_path = work.join("golden.rds-input.json");
        let script = InputScript::from_frames(vec![
            JoypadState::default(),
            JoypadState { start: true, ..JoypadState::default() },
            JoypadState { right: true, ..JoypadState::default() },
        ]);
        fs::write(
            &golden_path,
            serde_json::to_vec_pretty(&script).expect("serialize golden"),
        )
        .expect("write golden");

        // Smoke: the same ROM as reference and candidate must run end-to-end on
        // the real core (two independent cold boots) and reach visual parity.
        let (report, written) = run_reference_candidate_parity(
            &fixture_rom,
            &fixture_rom,
            &golden_path,
            &core,
            Some(3),
            &work,
        )
        .expect("real reference/candidate parity");

        assert_eq!(report.frames_run, 3);
        assert!(written.exists());
        assert!(work.join("reference-candidate-parity-report.md").exists());
        assert!(report.comparison.scenario_passed, "identical ROM must pass");
        assert!(report.comparison.visual_parity);
        assert_eq!(
            report.comparison.evidence_level,
            ParityEvidenceLevel::VisualParity
        );
    }

    // ---- Reference-vs-Candidate contract -----------------------------------

    fn candidate_of(reference: &ParityReport, candidate_sha: &str) -> ParityReport {
        let mut candidate = reference.clone();
        candidate.rom_sha256 = candidate_sha.to_string();
        candidate.rom_path = "/tmp/candidate.bin".to_string();
        candidate
    }

    #[test]
    fn reference_candidate_accepts_different_roms() {
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "different-rom-sha");
        assert_ne!(reference.rom_sha256, candidate.rom_sha256);

        let cmp = compare_reference_candidate(
            &reference,
            &candidate,
            &ObservedState::unavailable(),
        );

        // Different SHA is EXPECTED here, not a divergence.
        assert!(cmp.divergences.is_empty(), "different ROMs must be accepted");
        assert!(cmp.visual_parity);
        assert!(cmp.scenario_passed);
        assert_eq!(cmp.evidence_level, ParityEvidenceLevel::VisualParity);
        assert_eq!(cmp.frames_compared, 4);
    }

    #[test]
    fn compare_runs_still_rejects_different_roms() {
        // The old same-ROM determinism contract must keep short-circuiting.
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "different-rom-sha");
        let divergences = compare_runs(&reference, &candidate);
        assert_eq!(divergences.len(), 1);
        assert_eq!(divergences[0].kind, "rom_sha256_mismatch");
    }

    #[test]
    fn reference_candidate_detects_divergent_frame() {
        let reference = sample_report(true, None);
        let mut candidate = candidate_of(&reference, "different-rom-sha");
        candidate.frame_hashes[2].framebuffer_sha256 = "diverged".to_string();

        let cmp = compare_reference_candidate(
            &reference,
            &candidate,
            &ObservedState::unavailable(),
        );

        assert!(cmp
            .divergences
            .iter()
            .any(|d| d.kind == "reference_candidate_frame_hash_mismatch"
                && d.frame_index == 2));
        assert!(!cmp.visual_parity);
        assert!(!cmp.scenario_passed);
        assert_eq!(cmp.evidence_level, ParityEvidenceLevel::InsufficientEvidence);
    }

    #[test]
    fn reference_candidate_detects_observed_state_divergence() {
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "different-rom-sha");
        let observed = ObservedState {
            available: true,
            reference_regions_sha256: Some("state-a".to_string()),
            candidate_regions_sha256: Some("state-b".to_string()),
            region_labels: vec!["work_ram".to_string()],
        };

        let cmp = compare_reference_candidate(&reference, &candidate, &observed);

        assert!(cmp
            .divergences
            .iter()
            .any(|d| d.kind == "observed_state_mismatch"));
        assert!(!cmp.observed_state_parity);
        // Frames matched visually, but observed state diverged -> not enough.
        assert_eq!(cmp.evidence_level, ParityEvidenceLevel::InsufficientEvidence);
    }

    #[test]
    fn reference_candidate_reaches_observed_state_parity_when_regions_match() {
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "different-rom-sha");
        let observed = ObservedState {
            available: true,
            reference_regions_sha256: Some("normalized-state".to_string()),
            candidate_regions_sha256: Some("normalized-state".to_string()),
            region_labels: vec!["work_ram".to_string()],
        };

        let cmp = compare_reference_candidate(&reference, &candidate, &observed);

        assert!(cmp.divergences.is_empty());
        assert!(cmp.observed_state_parity);
        assert_eq!(cmp.evidence_level, ParityEvidenceLevel::ObservedStateParity);
    }

    #[test]
    fn reference_candidate_visual_only_never_becomes_total_equivalence() {
        // Two "equivalent" candidates pass the fixture, but visual-only evidence
        // must NOT be promoted past FunctionalEvidence, and never to anything
        // named equivalence (the enum has no such variant).
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "different-rom-sha");
        let cmp = compare_reference_candidate(
            &reference,
            &candidate,
            &ObservedState::unavailable(),
        );

        assert_eq!(cmp.evidence_level, ParityEvidenceLevel::VisualParity);
        assert_ne!(cmp.evidence_level, ParityEvidenceLevel::ObservedStateParity);

        let suite = aggregate_functional_evidence(std::slice::from_ref(&cmp));
        assert_eq!(suite, ParityEvidenceLevel::FunctionalEvidence);
        // Sanity: the suite verdict is scenario evidence, not observed-state
        // proof, when only visual signal exists.
        assert!(!cmp.observed_state_parity);
    }

    #[test]
    fn reference_candidate_detects_core_mismatch() {
        let reference = sample_report(true, None);
        let mut candidate = candidate_of(&reference, "different-rom-sha");
        candidate.core_label = "OtherCore".to_string();

        let cmp = compare_reference_candidate(
            &reference,
            &candidate,
            &ObservedState::unavailable(),
        );

        assert!(cmp
            .divergences
            .iter()
            .any(|d| d.kind == "core_label_mismatch"));
        assert!(!cmp.visual_parity);
        assert_eq!(cmp.evidence_level, ParityEvidenceLevel::InsufficientEvidence);
    }

    #[test]
    fn aggregate_functional_evidence_requires_all_scenarios_to_pass() {
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "different-rom-sha");
        let pass = compare_reference_candidate(
            &reference,
            &candidate,
            &ObservedState::unavailable(),
        );

        let mut broken_candidate = candidate.clone();
        broken_candidate.frame_hashes[0].framebuffer_sha256 = "diverged".to_string();
        let fail = compare_reference_candidate(
            &reference,
            &broken_candidate,
            &ObservedState::unavailable(),
        );

        assert_eq!(
            aggregate_functional_evidence(&[]),
            ParityEvidenceLevel::InsufficientEvidence
        );
        assert_eq!(
            aggregate_functional_evidence(&[pass.clone(), fail]),
            ParityEvidenceLevel::InsufficientEvidence
        );
        assert_eq!(
            aggregate_functional_evidence(&[pass.clone(), pass]),
            ParityEvidenceLevel::FunctionalEvidence
        );
    }

    #[test]
    fn write_reference_candidate_report_records_hashes_core_inputs_limitations() {
        let reference = sample_report(true, None);
        let candidate = candidate_of(&reference, "candidate-sha-999");
        let comparison = compare_reference_candidate(
            &reference,
            &candidate,
            &ObservedState::unavailable(),
        );
        let functional_evidence = aggregate_functional_evidence(std::slice::from_ref(&comparison));
        let report = ReferenceCandidateReport {
            schema: REFERENCE_CANDIDATE_REPORT_SCHEMA.to_string(),
            reference_rom_path: reference.rom_path.clone(),
            reference_rom_sha256: reference.rom_sha256.clone(),
            candidate_rom_path: candidate.rom_path.clone(),
            candidate_rom_sha256: candidate.rom_sha256.clone(),
            core_label: reference.core_label.clone(),
            golden_path: "/tmp/golden.rds-input.json".to_string(),
            golden_source: "script".to_string(),
            frames_run: reference.frames_run,
            report_reference: reference.clone(),
            report_candidate: candidate.clone(),
            comparison,
            functional_evidence,
            not_measured_by_this_harness: ParityReport::not_measured_default(),
        };

        let dir = temp_dir("refcand");
        let written = write_reference_candidate_report(&dir, &report).expect("write report");
        assert!(written.exists());
        let md = fs::read_to_string(dir.join("reference-candidate-parity-report.md"))
            .expect("read markdown");
        assert!(md.contains(&reference.rom_sha256));
        assert!(md.contains("candidate-sha-999"));
        assert!(md.contains(&reference.core_label));
        assert!(md.contains("golden.rds-input.json"));
        assert!(md.contains("Limitations"));
        assert!(md.contains("does NOT assert total functional equivalence"));
    }
}
