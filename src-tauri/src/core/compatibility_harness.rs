//! Canonical compatibility harness for external engine vertical slices.

use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};
use crate::core::gml_to_nodes::GmlConversionResult;
use crate::core::project_mgr::{
    create_project_skeleton, import_external_project, load_scene,
    stamp_imported_external_profile_metadata, DEFAULT_ENTRY_SCENE,
};
use crate::emulator::frame_buffer::framebuffer_to_rgba;
use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityHarnessReport {
    pub source_path: String,
    pub source_engine: String,
    pub source_format: String,
    pub import_status: String,
    pub scenes_detected: usize,
    pub sprites_detected: usize,
    pub objects_detected: usize,
    pub rooms_detected: usize,
    pub events_detected: usize,
    pub nodes_generated: usize,
    pub unsupported_semantics: Vec<String>,
    pub blocking_gaps: Vec<String>,
    pub generated_sgdk_status: String,
    pub rom_status: String,
    pub emulator_status: String,
    pub non_black_pixels: usize,
    pub stable_candidate: bool,
    pub fake_toolchain_used: bool,
    pub report_path: String,
    pub screenshot_path: Option<String>,
    pub rom_path: Option<String>,
    pub build_log_path: Option<String>,
}

pub fn validation_report_dir(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target-test")
        .join("validation")
        .join(name)
}

pub fn detect_source_format(source_path: &Path) -> String {
    if source_path.is_dir() {
        let has_yyp = fs::read_dir(source_path)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .any(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("yyp"))
            });
        if has_yyp {
            return "yyp_folder".to_string();
        }
        return "gmx_folder".to_string();
    }
    source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn write_compatibility_report(
    artifact_root: &Path,
    stem: &str,
    report: &CompatibilityHarnessReport,
) -> Result<(PathBuf, PathBuf), String> {
    fs::create_dir_all(artifact_root).map_err(|error| {
        format!(
            "Nao foi possivel criar diretorio de report '{}': {}",
            artifact_root.display(),
            error
        )
    })?;
    let json_path = artifact_root.join(format!("{stem}-report.json"));
    let md_path = artifact_root.join(format!("{stem}-report.md"));
    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("serializacao JSON do harness falhou: {error}"))?;
    fs::write(&json_path, format!("{json}\n"))
        .map_err(|error| format!("escrita JSON falhou: {error}"))?;
    let md = render_compatibility_report_markdown(report);
    fs::write(&md_path, md).map_err(|error| format!("escrita Markdown falhou: {error}"))?;
    Ok((json_path, md_path))
}

pub fn render_compatibility_report_markdown(report: &CompatibilityHarnessReport) -> String {
    format!(
        "# Compatibility Harness Report\n\n\
## Source\n- Path: `{}`\n- Engine: `{}`\n- Format: `{}`\n- Import: `{}`\n\n\
## Inventory\n- Scenes: `{}`\n- Sprites: `{}`\n- Objects: `{}`\n- Rooms: `{}`\n- Events: `{}`\n- Nodes generated: `{}`\n\n\
## Semantics\n- Unsupported: `{}`\n- Blocking gaps: `{}`\n\n\
## Pipeline\n- SGDK C: `{}`\n- ROM: `{}`\n- Emulator: `{}`\n- Non-black pixels: `{}`\n- Fake toolchain used: `{}`\n- Stable candidate: `{}`\n\n\
## Evidence\n- Report JSON: `{}`\n- ROM: `{}`\n- Screenshot: `{}`\n- Build log: `{}`\n",
        report.source_path,
        report.source_engine,
        report.source_format,
        report.import_status,
        report.scenes_detected,
        report.sprites_detected,
        report.objects_detected,
        report.rooms_detected,
        report.events_detected,
        report.nodes_generated,
        report.unsupported_semantics.len(),
        report.blocking_gaps.len(),
        report.generated_sgdk_status,
        report.rom_status,
        report.emulator_status,
        report.non_black_pixels,
        report.fake_toolchain_used,
        report.stable_candidate,
        report.report_path,
        report.rom_path.as_deref().unwrap_or("(none)"),
        report.screenshot_path.as_deref().unwrap_or("(none)"),
        report.build_log_path.as_deref().unwrap_or("(none)"),
    )
}

pub fn run_gamemaker_compatibility_harness(
    source_path: &Path,
    artifact_root: &Path,
    report_stem: &str,
) -> Result<CompatibilityHarnessReport, String> {
    if !source_path.exists() {
        return Err(format!(
            "Projeto GameMaker ausente em '{}'.",
            source_path.display()
        ));
    }

    let _ = fs::remove_dir_all(artifact_root);
    fs::create_dir_all(artifact_root).map_err(|error| {
        format!(
            "Nao foi possivel criar artifact root '{}': {}",
            artifact_root.display(),
            error
        )
    })?;

    let project_dir = artifact_root.join("project");
    create_project_skeleton(&project_dir, "GameMaker Compatibility Harness", "megadrive")
        .map_err(|error| format!("create_project_skeleton falhou: {}", error.0))?;

    let import_report = import_external_project(&project_dir, "gamemaker", source_path)
        .map_err(|error| format!("import GameMaker falhou: {}", error.0))?;
    let _ = stamp_imported_external_profile_metadata(&project_dir, "gamemaker", source_path)
        .map_err(|error| format!("stamp metadata falhou: {}", error.0))?;

    let scene = load_scene(&project_dir, DEFAULT_ENTRY_SCENE)
        .map_err(|error| format!("load scene falhou: {}", error.0))?;

    let inventory = analyze_imported_gamemaker_scene(&scene, &project_dir);
    let mut unsupported_semantics = import_report
        .skipped_sources
        .iter()
        .filter(|entry| !entry.contains("GML preservado como bridge semantica"))
        .cloned()
        .collect::<Vec<_>>();
    unsupported_semantics.extend(inventory.unsupported_semantics);

    let environment = BuildEnvironment::detect();
    let fake_toolchain_used = !environment
        .sgdk_root
        .as_ref()
        .is_some_and(|root| root.join("makefile.gen").is_file())
        || environment.sgdk_make_program.is_none();

    let build_log_path = artifact_root.join(format!("{report_stem}-build.log"));
    let build_log = std::sync::Mutex::new(Vec::new());
    let build_result = run_build_with_environment(&project_dir, &environment, |line| {
        if let Ok(mut log) = build_log.lock() {
            log.push(format!("[{}] {}", line.level, line.message));
        }
    });
    let build_log = build_log.into_inner().unwrap_or_default();
    fs::write(&build_log_path, build_log.join("\n")).map_err(|error| {
        format!(
            "Nao foi possivel escrever build log '{}': {}",
            build_log_path.display(),
            error
        )
    })?;

    let generated_sgdk_status = if build_result.ok {
        "ok".to_string()
    } else {
        let last_error = build_result
            .log
            .iter()
            .rev()
            .find(|entry| entry.level == "error")
            .map(|entry| entry.message.as_str())
            .unwrap_or("unknown");
        format!("failed:{last_error}")
    };

    let mut rom_status = "missing".to_string();
    let mut emulator_status = "not_run".to_string();
    let mut non_black_pixels = 0usize;
    let mut screenshot_path = None;
    let mut persistent_rom_path = None;

    if build_result.ok && !build_result.rom_path.is_empty() {
        let rom_path = {
            let path = PathBuf::from(&build_result.rom_path);
            if path.is_absolute() {
                path
            } else {
                project_dir.join(path)
            }
        };
        if rom_path.is_file() {
            let rom_bytes =
                fs::read(&rom_path).map_err(|error| format!("leitura ROM falhou: {error}"))?;
            if rom_bytes.windows(4).any(|window| window == b"SEGA") {
                rom_status = "ok_sega_header".to_string();
            } else {
                rom_status = "ok_no_sega_header".to_string();
            }
            let copied = artifact_root.join(format!("{report_stem}.bin"));
            fs::copy(&rom_path, &copied)
                .map_err(|error| format!("copia ROM persistente falhou: {error}"))?;
            let rom_for_smoke = copied.clone();
            persistent_rom_path = Some(copied);

            match run_libretro_visible_smoke(&rom_for_smoke) {
                Ok((pixels, rgba, width, height, core_label, frames_run)) => {
                    non_black_pixels = pixels;
                    emulator_status = format!("ok:{core_label}:{frames_run}frames");
                    if pixels > 0 {
                        let ppm = artifact_root.join(format!("{report_stem}-frame.ppm"));
                        write_rgba_ppm(&ppm, width, height, &rgba)?;
                        screenshot_path = Some(ppm.to_string_lossy().to_string());
                    } else {
                        emulator_status = "failed:black_framebuffer".to_string();
                    }
                }
                Err(error) => {
                    emulator_status = format!("failed:{error}");
                }
            }
        }
    }

    let (json_path, _md_path) = write_compatibility_report(
        artifact_root,
        report_stem,
        &CompatibilityHarnessReport {
            source_path: source_path.display().to_string(),
            source_engine: "gamemaker".to_string(),
            source_format: detect_source_format(source_path),
            import_status: "ok".to_string(),
            scenes_detected: import_report.imported_scenes,
            sprites_detected: inventory.sprites_detected,
            objects_detected: inventory.objects_detected,
            rooms_detected: inventory.rooms_detected,
            events_detected: inventory.events_detected,
            nodes_generated: inventory.nodes_generated,
            unsupported_semantics: unsupported_semantics.clone(),
            blocking_gaps: inventory.blocking_gaps.clone(),
            generated_sgdk_status: generated_sgdk_status.clone(),
            rom_status: rom_status.clone(),
            emulator_status: emulator_status.clone(),
            non_black_pixels,
            stable_candidate: false,
            fake_toolchain_used,
            report_path: String::new(),
            screenshot_path: screenshot_path.clone(),
            rom_path: persistent_rom_path
                .as_ref()
                .map(|path| path.display().to_string()),
            build_log_path: Some(build_log_path.display().to_string()),
        },
    )?;

    let pipeline_green = !fake_toolchain_used
        && build_result.ok
        && non_black_pixels > 0
        && inventory.blocking_gaps.is_empty()
        && inventory.nodes_generated > 0;

    let final_report = CompatibilityHarnessReport {
        source_path: source_path.display().to_string(),
        source_engine: "gamemaker".to_string(),
        source_format: detect_source_format(source_path),
        import_status: "ok".to_string(),
        scenes_detected: import_report.imported_scenes,
        sprites_detected: inventory.sprites_detected,
        objects_detected: inventory.objects_detected,
        rooms_detected: inventory.rooms_detected,
        events_detected: inventory.events_detected,
        nodes_generated: inventory.nodes_generated,
        unsupported_semantics,
        blocking_gaps: inventory.blocking_gaps,
        generated_sgdk_status: if build_result.ok {
            "ok".to_string()
        } else {
            "failed".to_string()
        },
        rom_status,
        emulator_status,
        non_black_pixels,
        stable_candidate: false,
        fake_toolchain_used,
        report_path: json_path.display().to_string(),
        screenshot_path,
        rom_path: persistent_rom_path.map(|path| path.display().to_string()),
        build_log_path: Some(build_log_path.display().to_string()),
    };

    let _ = write_compatibility_report(artifact_root, report_stem, &final_report)?;
    if pipeline_green {
        eprintln!(
            "GameMaker harness pipeline verde; status do engine permanece Experimental/subset."
        );
    }
    Ok(final_report)
}

pub fn run_openbor_compatibility_harness(
    source_path: &Path,
    artifact_root: &Path,
    report_stem: &str,
) -> Result<CompatibilityHarnessReport, String> {
    if !source_path.exists() {
        return Err(format!(
            "Projeto OpenBOR ausente em '{}'.",
            source_path.display()
        ));
    }

    let _ = fs::remove_dir_all(artifact_root);
    fs::create_dir_all(artifact_root).map_err(|error| {
        format!(
            "Nao foi possivel criar artifact root '{}': {}",
            artifact_root.display(),
            error
        )
    })?;

    let project_dir = artifact_root.join("project");
    create_project_skeleton(&project_dir, "OpenBOR Compatibility Harness", "megadrive")
        .map_err(|error| format!("create_project_skeleton falhou: {}", error.0))?;

    let import_report = import_external_project(&project_dir, "openbor", source_path)
        .map_err(|error| format!("import OpenBOR falhou: {}", error.0))?;
    let _ = stamp_imported_external_profile_metadata(&project_dir, "openbor", source_path)
        .map_err(|error| format!("stamp metadata falhou: {}", error.0))?;

    let scene = load_scene(&project_dir, DEFAULT_ENTRY_SCENE)
        .map_err(|error| format!("load scene falhou: {}", error.0))?;
    let inventory = analyze_imported_openbor_scene(&scene);

    let environment = BuildEnvironment::detect();
    let fake_toolchain_used = !environment
        .sgdk_root
        .as_ref()
        .is_some_and(|root| root.join("makefile.gen").is_file())
        || environment.sgdk_make_program.is_none();

    let build_log_path = artifact_root.join(format!("{report_stem}-build.log"));
    let build_log = std::sync::Mutex::new(Vec::new());
    let build_result = run_build_with_environment(&project_dir, &environment, |line| {
        if let Ok(mut log) = build_log.lock() {
            log.push(format!("[{}] {}", line.level, line.message));
        }
    });
    let build_log = build_log.into_inner().unwrap_or_default();
    fs::write(&build_log_path, build_log.join("\n")).map_err(|error| {
        format!(
            "Nao foi possivel escrever build log '{}': {}",
            build_log_path.display(),
            error
        )
    })?;

    let generated_sgdk_status = if build_result.ok {
        "ok".to_string()
    } else {
        let last_error = build_result
            .log
            .iter()
            .rev()
            .find(|entry| entry.level == "error")
            .map(|entry| entry.message.as_str())
            .unwrap_or("unknown");
        format!("failed:{last_error}")
    };

    let mut rom_status = "missing".to_string();
    let mut emulator_status = "not_run".to_string();
    let mut non_black_pixels = 0usize;
    let mut screenshot_path = None;
    let mut persistent_rom_path = None;

    if build_result.ok && !build_result.rom_path.is_empty() {
        let rom_path = {
            let path = PathBuf::from(&build_result.rom_path);
            if path.is_absolute() {
                path
            } else {
                project_dir.join(path)
            }
        };
        if rom_path.is_file() {
            let rom_bytes =
                fs::read(&rom_path).map_err(|error| format!("leitura ROM falhou: {error}"))?;
            if rom_bytes.windows(4).any(|window| window == b"SEGA") {
                rom_status = "ok_sega_header".to_string();
            } else {
                rom_status = "ok_no_sega_header".to_string();
            }
            let copied = artifact_root.join(format!("{report_stem}.bin"));
            fs::copy(&rom_path, &copied)
                .map_err(|error| format!("copia ROM persistente falhou: {error}"))?;
            let rom_for_smoke = copied.clone();
            persistent_rom_path = Some(copied);

            match run_libretro_visible_smoke(&rom_for_smoke) {
                Ok((pixels, rgba, width, height, core_label, frames_run)) => {
                    non_black_pixels = pixels;
                    emulator_status = format!("ok:{core_label}:{frames_run}frames");
                    if pixels > 0 {
                        let ppm = artifact_root.join(format!("{report_stem}-frame.ppm"));
                        write_rgba_ppm(&ppm, width, height, &rgba)?;
                        screenshot_path = Some(ppm.to_string_lossy().to_string());
                    } else {
                        emulator_status = "failed:black_framebuffer".to_string();
                    }
                }
                Err(error) => {
                    emulator_status = format!("failed:{error}");
                }
            }
        }
    }

    let mut unsupported_semantics = import_report.skipped_sources.clone();
    unsupported_semantics.extend(inventory.unsupported_semantics.clone());
    let report = CompatibilityHarnessReport {
        source_path: source_path.display().to_string(),
        source_engine: "openbor".to_string(),
        source_format: "openbor_folder".to_string(),
        import_status: "ok".to_string(),
        scenes_detected: import_report.imported_scenes,
        sprites_detected: inventory.sprites_detected,
        objects_detected: inventory.objects_detected,
        rooms_detected: inventory.stages_detected,
        events_detected: inventory.events_detected,
        nodes_generated: inventory.nodes_generated,
        unsupported_semantics,
        blocking_gaps: inventory.blocking_gaps,
        generated_sgdk_status,
        rom_status,
        emulator_status,
        non_black_pixels,
        stable_candidate: false,
        fake_toolchain_used,
        report_path: String::new(),
        screenshot_path,
        rom_path: persistent_rom_path.map(|path| path.display().to_string()),
        build_log_path: Some(build_log_path.display().to_string()),
    };

    let (json_path, _md_path) = write_compatibility_report(artifact_root, report_stem, &report)?;
    let final_report = CompatibilityHarnessReport {
        report_path: json_path.display().to_string(),
        ..report
    };
    let _ = write_compatibility_report(artifact_root, report_stem, &final_report)?;
    Ok(final_report)
}

#[derive(Debug, Default)]
struct GamemakerSceneInventory {
    sprites_detected: usize,
    objects_detected: usize,
    rooms_detected: usize,
    events_detected: usize,
    nodes_generated: usize,
    unsupported_semantics: Vec<String>,
    blocking_gaps: Vec<String>,
}

#[derive(Debug, Default)]
struct OpenBorSceneInventory {
    sprites_detected: usize,
    objects_detected: usize,
    stages_detected: usize,
    events_detected: usize,
    nodes_generated: usize,
    unsupported_semantics: Vec<String>,
    blocking_gaps: Vec<String>,
}

fn analyze_imported_gamemaker_scene(
    scene: &crate::ugdm::entities::Scene,
    project_dir: &Path,
) -> GamemakerSceneInventory {
    let mut inventory = GamemakerSceneInventory {
        rooms_detected: 1,
        ..GamemakerSceneInventory::default()
    };

    for entity in &scene.entities {
        if entity.components.sprite.is_some() {
            inventory.sprites_detected += 1;
        }
        if entity.components.collision.is_some() {
            inventory.objects_detected += 1;
        }
        if let Some(logic) = &entity.components.logic {
            inventory.events_detected += logic.logic_hints.len();
            if let Some(graph_ref) = &logic.graph_ref {
                let graph_path = project_dir.join("graphs").join(
                    graph_ref
                        .trim_start_matches("graphs/")
                        .trim_start_matches("graphs\\"),
                );
                if let Ok(content) = fs::read_to_string(&graph_path) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                        inventory.nodes_generated += value
                            .get("nodes")
                            .and_then(|nodes| nodes.as_array())
                            .map(|nodes| nodes.len())
                            .unwrap_or(0);
                        if let Some(gaps) = value.get("gaps").and_then(|gaps| gaps.as_array()) {
                            for gap in gaps {
                                let id = gap
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("gap")
                                    .to_string();
                                let reason = gap
                                    .get("reason")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("gap")
                                    .to_string();
                                inventory
                                    .unsupported_semantics
                                    .push(format!("{id}: {reason}"));
                                if gap
                                    .get("blocks_build")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false)
                                {
                                    inventory.blocking_gaps.push(id);
                                }
                            }
                        }
                    }
                }
            }
            if logic.graph_origin.as_deref() == Some("gamemaker_gmx_bridge") {
                inventory
                    .unsupported_semantics
                    .push(format!("{}: bridge graph", entity.entity_id));
            }
        }
    }

    inventory
}

fn analyze_imported_openbor_scene(scene: &crate::ugdm::entities::Scene) -> OpenBorSceneInventory {
    let mut inventory = OpenBorSceneInventory {
        stages_detected: 1,
        ..OpenBorSceneInventory::default()
    };

    for entity in &scene.entities {
        if entity.components.sprite.is_some() {
            inventory.sprites_detected += 1;
        }
        if entity.components.collision.is_some() {
            inventory.objects_detected += 1;
        }
        if entity.components.tilemap.is_some() {
            inventory.stages_detected += 1;
        }
        if let Some(logic) = &entity.components.logic {
            inventory.events_detected += logic.logic_hints.len();
            if let Some(graph) = logic.graph.as_deref() {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(graph) {
                    let nodes = value
                        .get("nodes")
                        .and_then(|nodes| nodes.as_array())
                        .cloned()
                        .unwrap_or_default();
                    inventory.nodes_generated += nodes.len();
                    for node in nodes {
                        if node.get("type").and_then(|value| value.as_str())
                            == Some("bridge_unconverted_source")
                        {
                            let source = node
                                .get("params")
                                .and_then(|params| params.get("source"))
                                .and_then(|value| value.as_str())
                                .unwrap_or("openbor:bridge");
                            inventory
                                .unsupported_semantics
                                .push(format!("{source}: bridge_unconverted_source"));
                        }
                    }
                }
            }
        }
    }

    inventory
}

type LibretroVisibleSmokeResult = (usize, Vec<u8>, u32, u32, String, u32);

fn run_libretro_visible_smoke(rom_path: &Path) -> Result<LibretroVisibleSmokeResult, String> {
    let mut emulator = EmulatorCore::new(None);
    emulator
        .load_rom(rom_path)
        .map_err(|error| format!("load_rom: {error}"))?;

    let joypad_phases = [
        (90u32, JoypadState::default()),
        (
            90,
            JoypadState {
                right: true,
                ..JoypadState::default()
            },
        ),
        (
            90,
            JoypadState {
                right: true,
                a: true,
                ..JoypadState::default()
            },
        ),
    ];

    let mut total_frames = 0u32;
    let mut best_non_black = 0usize;
    let mut best_frame = None;
    let mut core_label = "unknown".to_string();

    for (budget, joypad) in joypad_phases {
        emulator
            .set_joypad(joypad)
            .map_err(|error| format!("set_joypad: {error}"))?;
        for _ in 0..budget {
            emulator
                .run_frame()
                .map_err(|error| format!("run_frame: {error}"))?;
            total_frames += 1;
        }
        let (framebuffer, size, pixel_format) = emulator
            .get_framebuffer()
            .map_err(|error| format!("get_framebuffer: {error}"))?;
        core_label = emulator
            .loaded_core_label()
            .unwrap_or("unknown-libretro-core")
            .to_string();
        let frame = framebuffer_to_rgba(&framebuffer, size, pixel_format);
        let non_black = frame
            .rgba
            .chunks_exact(4)
            .filter(|px| px[0] != 0 || px[1] != 0 || px[2] != 0)
            .count();
        if non_black > best_non_black {
            best_non_black = non_black;
            best_frame = Some((frame.width, frame.height, frame.rgba));
        }
        if best_non_black > 0 {
            break;
        }
    }

    emulator.stop().ok();
    let Some((width, height, rgba)) = best_frame else {
        return Err("empty framebuffer".to_string());
    };
    Ok((
        best_non_black,
        rgba,
        width,
        height,
        core_label,
        total_frames,
    ))
}

fn write_rgba_ppm(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let mut bytes = format!("P6\n{width} {height}\n255\n").into_bytes();
    for px in rgba.chunks_exact(4) {
        bytes.extend_from_slice(&px[..3]);
    }
    fs::write(path, bytes).map_err(|error| format!("write ppm: {error}"))
}

pub fn merge_gml_conversion_into_report(
    report: &mut CompatibilityHarnessReport,
    conversion: &GmlConversionResult,
) {
    report.nodes_generated = report
        .nodes_generated
        .saturating_add(conversion.nodes_generated);
    for gap in &conversion.gaps {
        report
            .unsupported_semantics
            .push(format!("{}: {}", gap.id, gap.reason));
        if gap.blocks_build {
            report.blocking_gaps.push(gap.id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_png(path: &Path, width: u32, height: u32, rgba: [u8; 4]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create png parent");
        }
        let image: image::RgbaImage =
            image::ImageBuffer::from_fn(width, height, |_x, _y| image::Rgba(rgba));
        image.save(path).expect("write png");
    }

    fn minimal_wav_bytes() -> Vec<u8> {
        b"RIFF$\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0@>\0\0@>\0\0\x01\0\x08\0data\0\0\0\0".to_vec()
    }

    fn write_openbor_harness_fixture(root: &Path) {
        let hero_dir = root.join("data").join("chars").join("hero");
        let enemy_dir = root.join("data").join("chars").join("punk");
        let level_dir = root.join("data").join("levels");
        fs::create_dir_all(&hero_dir).expect("create hero");
        fs::create_dir_all(&enemy_dir).expect("create enemy");
        fs::create_dir_all(&level_dir).expect("create levels");
        fs::create_dir_all(root.join("data").join("music")).expect("create music");
        write_png(
            &hero_dir.join("hero_sheet.png"),
            64,
            32,
            [220, 200, 40, 255],
        );
        write_png(
            &enemy_dir.join("punk_sheet.png"),
            64,
            32,
            [200, 80, 80, 255],
        );
        write_png(
            &root.join("data").join("bgs").join("stage.png"),
            320,
            128,
            [40, 90, 130, 255],
        );
        fs::write(
            root.join("data").join("music").join("theme.wav"),
            minimal_wav_bytes(),
        )
        .expect("write wav");
        fs::write(
            root.join("data").join("models.txt"),
            [
                "load Hero data/chars/hero/hero.txt",
                "load Punk data/chars/punk/punk.txt",
            ]
            .join("\n"),
        )
        .expect("write models");
        fs::write(
            root.join("data").join("levels.txt"),
            "file data/levels/stage1.txt\n",
        )
        .expect("write levels manifest");
        fs::write(
            hero_dir.join("hero.txt"),
            [
                "name Hero",
                "type player",
                "speed 2",
                "load hero_sheet.png",
                "anim idle",
                " delay 8",
                " loop 1",
                " bbox 4 4 20 28",
                " frame hero_sheet.png",
                "anim attack",
                " delay 4",
                " attack 18 8 20 12 5",
                " frame hero_sheet.png",
            ]
            .join("\n"),
        )
        .expect("write hero");
        fs::write(
            enemy_dir.join("punk.txt"),
            [
                "name Punk",
                "type enemy",
                "facing -1",
                "load punk_sheet.png",
                "anim idle",
                " delay 8",
                " bbox 4 4 20 28",
                " frame punk_sheet.png",
            ]
            .join("\n"),
        )
        .expect("write enemy");
        fs::write(
            level_dir.join("stage1.txt"),
            [
                "name Downtown",
                "music data/music/theme.wav",
                "background data/bgs/stage.png",
                "scrollspeed 1 0",
                "spawn Punk",
                "at 160 0 96",
                "@script",
                "void main(){ changeopenborvariant(); }",
                "@end_script",
            ]
            .join("\n"),
        )
        .expect("write level");
    }

    #[test]
    #[ignore = "host-local vertical: GameMaker .gmez -> ROM -> Libretro framebuffer"]
    fn gamemaker_vertical_compatibility_harness_basic_platform() {
        let candidates = [
            PathBuf::from("F:\\Projects\\Game Maker\\Basic_platform_game_example.gmez"),
            PathBuf::from(
                "F:\\Projects\\Engine Template\\Game Maker\\Basic_platform_game_example.gmez",
            ),
        ];
        let source = candidates
            .iter()
            .find(|candidate| candidate.is_file())
            .cloned()
            .unwrap_or_else(|| candidates[0].clone());
        if !source.is_file() {
            eprintln!(
                "[skip] GameMaker sample ausente. Candidatos: {}",
                candidates
                    .iter()
                    .map(|candidate| candidate.display().to_string())
                    .collect::<Vec<_>>()
                    .join(" | ")
            );
            return;
        }
        let artifact_root = validation_report_dir("gamemaker-vertical");
        let report = run_gamemaker_compatibility_harness(
            &source,
            &artifact_root,
            "gamemaker-basic-platform",
        )
        .expect("harness");
        eprintln!(
            "harness report: import={} sgdk={} rom={} emu={} pixels={} fake={}",
            report.import_status,
            report.generated_sgdk_status,
            report.rom_status,
            report.emulator_status,
            report.non_black_pixels,
            report.fake_toolchain_used
        );
        assert_eq!(report.import_status, "ok");
        assert!(report.nodes_generated > 0);
        assert!(!report.fake_toolchain_used, "SGDK oficial obrigatorio");
        assert!(
            report.generated_sgdk_status.starts_with("ok"),
            "build SGDK falhou: {}",
            report.generated_sgdk_status
        );
        assert!(
            report.rom_status.starts_with("ok"),
            "ROM invalida: {}",
            report.rom_status
        );
        assert!(
            report.non_black_pixels > 0,
            "framebuffer preto: {}",
            report.emulator_status
        );
        assert!(PathBuf::from(&report.report_path).is_file());
    }

    #[test]
    #[ignore = "host-local vertical: OpenBOR fixture -> SGDK C -> ROM -> Libretro framebuffer"]
    fn openbor_vertical_compatibility_harness_fixture() {
        let source = temp_dir("openbor-harness-source");
        write_openbor_harness_fixture(&source);
        let artifact_root = validation_report_dir("openbor-vertical");
        let report =
            run_openbor_compatibility_harness(&source, &artifact_root, "openbor-beatemup-fixture")
                .expect("harness");
        eprintln!(
            "openbor harness report: import={} sgdk={} rom={} emu={} pixels={} fake={}",
            report.import_status,
            report.generated_sgdk_status,
            report.rom_status,
            report.emulator_status,
            report.non_black_pixels,
            report.fake_toolchain_used
        );
        assert_eq!(report.import_status, "ok");
        assert!(report.sprites_detected >= 2);
        assert!(report.nodes_generated > 0);
        assert!(!report.fake_toolchain_used, "SGDK oficial obrigatorio");
        assert!(report.generated_sgdk_status.starts_with("ok"));
        assert!(report.rom_status.starts_with("ok"));
        assert!(report.non_black_pixels > 0);
        assert!(PathBuf::from(&report.report_path).is_file());
        let _ = fs::remove_dir_all(source);
    }

    #[test]
    #[ignore = "host-local OpenBOR sample harness when an extracted module exists"]
    fn openbor_host_sample_compatibility_harness_when_present() {
        let candidates = [
            PathBuf::from(
                r"F:\Projects\Engine Template\Games Engines\OpenBOR\Projects\Real-Bout-Pro-Wrestling",
            ),
            PathBuf::from(
                r"F:\Projects\Engine Template\Games Engines\OpenBOR\Projects\Super-Final-Fight-Gold",
            ),
            PathBuf::from(
                r"F:\Projects\Engine Template\Games Engines\OpenBOR\Projects\World-Heroes-Supreme-Justice",
            ),
            PathBuf::from(
                r"F:\Projects\Engine Template\Games Engines\OpenBOR\Templates\Aki-Shiki-Character-Template",
            ),
        ];
        let source = candidates.into_iter().find(|candidate| {
            candidate.join("data").join("models.txt").is_file()
                || candidate.join("models.txt").is_file()
                || candidate.join("data").join("levels.txt").is_file()
                || candidate.join("levels.txt").is_file()
        });
        let Some(source) = source else {
            eprintln!("[skip] nenhum sample OpenBOR extraido com manifests encontrado.");
            return;
        };
        let artifact_root = validation_report_dir("openbor-host-sample");
        let report =
            run_openbor_compatibility_harness(&source, &artifact_root, "openbor-host-sample")
                .expect("harness");
        assert_eq!(report.import_status, "ok");
        assert!(report.nodes_generated > 0 || !report.unsupported_semantics.is_empty());
        assert!(PathBuf::from(&report.report_path).is_file());
    }
}
