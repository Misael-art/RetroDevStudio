use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::core::sgdk_corpus_inventory::{
    inspect_sgdk_project_for_nocode_inventory, SgdkCanonicalSourceMapping, SgdkDefineInventory,
    SgdkNamedSourceItem, SgdkProjectInventory, SgdkResourceInventory, SgdkSemanticGap,
};
use crate::hardware::md_profile;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkSemanticReportBundle {
    pub semantic_ir: SgdkSemanticIrReport,
    pub coverage: SgdkNodeCoverageReport,
    pub roundtrip: SgdkRoundTripReport,
    pub hardware_constraints: SgdkHardwareConstraintReport,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkSemanticIrReport {
    pub schema_version: String,
    pub project_name: String,
    pub source_root: String,
    pub files: SgdkIrFiles,
    pub preprocessor: SgdkIrPreprocessor,
    pub symbols: SgdkIrSymbols,
    pub control_flow: SgdkIrControlFlow,
    pub resources: SgdkIrResources,
    pub hardware_ops: SgdkIrHardwareOps,
    pub bridges: Vec<SgdkSemanticGap>,
    pub source_mappings: Vec<SgdkCanonicalSourceMapping>,
    pub node_graph_json: String,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkIrFiles {
    pub source_files: Vec<String>,
    pub header_files: Vec<String>,
    pub resource_manifests: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkIrPreprocessor {
    pub includes: Vec<SgdkNamedSourceItem>,
    pub defines: Vec<SgdkDefineInventory>,
    pub macro_bridges: Vec<SgdkDefineInventory>,
    pub conditional_bridges: Vec<SgdkSemanticGap>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkIrSymbols {
    pub globals: Vec<SgdkNamedSourceItem>,
    pub arrays: Vec<SgdkNamedSourceItem>,
    pub structs: Vec<SgdkNamedSourceItem>,
    pub enums: Vec<SgdkNamedSourceItem>,
    pub functions: usize,
    pub callbacks: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkIrControlFlow {
    pub main_loops: Vec<SgdkNamedSourceItem>,
    pub update_functions: usize,
    pub state_machines: usize,
    pub states: usize,
    pub transitions: usize,
    pub actions: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkIrResources {
    pub sprite_resources: Vec<SgdkResourceInventory>,
    pub tilemap_resources: Vec<SgdkResourceInventory>,
    pub audio_resources: Vec<SgdkResourceInventory>,
    pub other_resources: Vec<SgdkResourceInventory>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkIrHardwareOps {
    pub input_calls: usize,
    pub sprite_calls: usize,
    pub tilemap_calls: usize,
    pub audio_calls: usize,
    pub vdp_calls: usize,
    pub dma_calls: usize,
    pub palette_calls: usize,
    pub hblank_callbacks: usize,
    pub shadow_highlight_calls: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkNodeCoverageReport {
    pub schema_version: String,
    pub project_name: String,
    pub source_root: String,
    pub total_logic_units: usize,
    pub converted_logic_units: usize,
    pub bridge_logic_units: usize,
    pub unsupported_logic_units: usize,
    pub editable_node_coverage_percent: f64,
    pub buildable_after_roundtrip: bool,
    pub emulation_visible_ok: Option<bool>,
    pub hardware_constraint_status: String,
    pub unit_breakdown: BTreeMap<String, usize>,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkRoundTripReport {
    pub schema_version: String,
    pub project_name: String,
    pub source_root: String,
    pub generated_c_path: String,
    pub generated_res_path: String,
    pub bridge_prevents_full_edit: bool,
    pub buildable_after_roundtrip: bool,
    pub build_attempted: bool,
    pub build_ok: Option<bool>,
    pub emulation_visible_ok: Option<bool>,
    pub warnings: Vec<String>,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkHardwareConstraintReport {
    pub schema_version: String,
    pub project_name: String,
    pub source_root: String,
    pub status: String,
    pub axes: Vec<SgdkHardwareConstraintAxis>,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkHardwareConstraintAxis {
    pub id: String,
    pub status: String,
    pub measured: String,
    pub limit: String,
    pub warnings: Vec<String>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SgdkNodeGraphExportReport {
    pub schema_version: String,
    pub project_name: String,
    pub source_root: String,
    pub node_graph_json: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub bridge_node_count: usize,
    pub node_type_counts: BTreeMap<String, usize>,
    pub report_path: Option<String>,
}

pub fn inspect_sgdk_semantic_ir(root: &Path) -> Result<SgdkSemanticIrReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    Ok(build_semantic_ir_report(&inventory, None))
}

pub fn inspect_sgdk_node_coverage(root: &Path) -> Result<SgdkNodeCoverageReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    let hardware_status = build_hardware_constraint_report(&inventory, None).status;
    Ok(build_coverage_report(&inventory, hardware_status, None))
}

pub fn inspect_sgdk_hardware_constraints(
    root: &Path,
) -> Result<SgdkHardwareConstraintReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    Ok(build_hardware_constraint_report(&inventory, None))
}

pub fn export_sgdk_semantic_node_graph(root: &Path) -> Result<SgdkNodeGraphExportReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    Ok(build_node_graph_export_report(&inventory, None))
}

pub fn run_sgdk_semantic_roundtrip(
    root: &Path,
    report_dir: &Path,
) -> Result<SgdkRoundTripReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    build_roundtrip_report(&inventory, report_dir, None)
}

pub fn write_sgdk_semantic_report_bundle(
    root: &Path,
    report_dir: &Path,
) -> Result<SgdkSemanticReportBundle, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    fs::create_dir_all(report_dir).map_err(|error| {
        format!(
            "Could not create SGDK semantic report directory '{}': {}",
            report_dir.display(),
            error
        )
    })?;

    let mut semantic_ir = build_semantic_ir_report(
        &inventory,
        Some(report_dir.join("sgdk-semantic-ir-report.json")),
    );
    let hardware_constraints = build_hardware_constraint_report(
        &inventory,
        Some(report_dir.join("sgdk-hardware-constraints-report.json")),
    );
    let coverage = build_coverage_report(
        &inventory,
        hardware_constraints.status.clone(),
        Some(report_dir.join("sgdk-node-coverage-report.json")),
    );
    let roundtrip = build_roundtrip_report(
        &inventory,
        report_dir,
        Some(report_dir.join("sgdk-roundtrip-report.json")),
    )?;

    write_pretty_json(
        report_dir.join("sgdk-semantic-ir-report.json").as_path(),
        &semantic_ir,
    )?;
    write_pretty_json(
        report_dir.join("sgdk-node-coverage-report.json").as_path(),
        &coverage,
    )?;
    write_pretty_json(
        report_dir
            .join("sgdk-hardware-constraints-report.json")
            .as_path(),
        &hardware_constraints,
    )?;
    write_pretty_json(
        report_dir.join("sgdk-roundtrip-report.json").as_path(),
        &roundtrip,
    )?;

    semantic_ir.node_graph_json = inventory.semantic_node_graph_json.clone();

    Ok(SgdkSemanticReportBundle {
        semantic_ir,
        coverage,
        roundtrip,
        hardware_constraints,
    })
}

pub fn write_sgdk_semantic_ir_report(
    root: &Path,
    report_dir: &Path,
) -> Result<SgdkSemanticIrReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    fs::create_dir_all(report_dir).map_err(|error| error.to_string())?;
    let report_path = report_dir.join("sgdk-semantic-ir-report.json");
    let report = build_semantic_ir_report(&inventory, Some(report_path.clone()));
    write_pretty_json(&report_path, &report)?;
    Ok(report)
}

pub fn write_sgdk_node_coverage_report(
    root: &Path,
    report_dir: &Path,
) -> Result<SgdkNodeCoverageReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    fs::create_dir_all(report_dir).map_err(|error| error.to_string())?;
    let hardware_status = build_hardware_constraint_report(&inventory, None).status;
    let report_path = report_dir.join("sgdk-node-coverage-report.json");
    let report = build_coverage_report(&inventory, hardware_status, Some(report_path.clone()));
    write_pretty_json(&report_path, &report)?;
    Ok(report)
}

pub fn write_sgdk_hardware_constraints_report(
    root: &Path,
    report_dir: &Path,
) -> Result<SgdkHardwareConstraintReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    fs::create_dir_all(report_dir).map_err(|error| error.to_string())?;
    let report_path = report_dir.join("sgdk-hardware-constraints-report.json");
    let report = build_hardware_constraint_report(&inventory, Some(report_path.clone()));
    write_pretty_json(&report_path, &report)?;
    Ok(report)
}

pub fn write_sgdk_node_graph_report(
    root: &Path,
    report_dir: &Path,
) -> Result<SgdkNodeGraphExportReport, String> {
    let inventory = inspect_sgdk_project_for_nocode_inventory(root)?;
    fs::create_dir_all(report_dir).map_err(|error| error.to_string())?;
    let report_path = report_dir.join("sgdk-nodegraph-report.json");
    let report = build_node_graph_export_report(&inventory, Some(report_path.clone()));
    write_pretty_json(&report_path, &report)?;
    Ok(report)
}

fn build_semantic_ir_report(
    inventory: &SgdkProjectInventory,
    report_path: Option<PathBuf>,
) -> SgdkSemanticIrReport {
    let logic = inventory.canonical_model.logic_systems.first();
    let (sprite_resources, tilemap_resources, audio_resources, other_resources) =
        partition_resources(&inventory.resources);
    let hardware_ops = summarize_hardware_ops(inventory);

    SgdkSemanticIrReport {
        schema_version: "sgdk-semantic-ir/v1".to_string(),
        project_name: inventory.project_name.clone(),
        source_root: inventory.root.clone(),
        files: SgdkIrFiles {
            source_files: inventory.source_files.clone(),
            header_files: inventory.header_files.clone(),
            resource_manifests: inventory.resource_manifests.clone(),
        },
        preprocessor: SgdkIrPreprocessor {
            includes: inventory.code.includes.clone(),
            defines: inventory.code.defines.clone(),
            macro_bridges: inventory.code.macros.clone(),
            conditional_bridges: inventory
                .semantic_gaps
                .iter()
                .filter(|gap| gap.kind == "preprocessor_condition")
                .cloned()
                .collect(),
        },
        symbols: SgdkIrSymbols {
            globals: inventory.code.globals.clone(),
            arrays: inventory.code.arrays.clone(),
            structs: inventory.code.structs.clone(),
            enums: inventory.code.enums.clone(),
            functions: inventory
                .code
                .functions
                .iter()
                .filter(|function| function.is_definition)
                .count(),
            callbacks: inventory.code.callbacks.len(),
        },
        control_flow: SgdkIrControlFlow {
            main_loops: inventory.code.main_loops.clone(),
            update_functions: inventory.code.update_functions.len(),
            state_machines: logic.map(|logic| logic.state_machines.len()).unwrap_or(0),
            states: logic.map(|logic| logic.states.len()).unwrap_or(0),
            transitions: logic.map(|logic| logic.transitions.len()).unwrap_or(0),
            actions: logic.map(|logic| logic.actions.len()).unwrap_or(0),
        },
        resources: SgdkIrResources {
            sprite_resources,
            tilemap_resources,
            audio_resources,
            other_resources,
        },
        hardware_ops,
        bridges: inventory.semantic_gaps.clone(),
        source_mappings: inventory.canonical_model.source_mappings.clone(),
        node_graph_json: inventory.semantic_node_graph_json.clone(),
        report_path: report_path.map(path_string),
    }
}

fn build_coverage_report(
    inventory: &SgdkProjectInventory,
    hardware_constraint_status: String,
    report_path: Option<PathBuf>,
) -> SgdkNodeCoverageReport {
    let node_export = build_node_graph_export_report(inventory, None);
    let converted_logic_units = node_export
        .node_count
        .saturating_sub(node_export.bridge_node_count);
    let bridge_logic_units = inventory.semantic_gaps.len();
    let unsupported_logic_units = inventory
        .semantic_gaps
        .iter()
        .filter(|gap| is_unrecoverable_gap(&gap.kind))
        .count();
    let total_logic_units = converted_logic_units + bridge_logic_units + unsupported_logic_units;
    let editable_node_coverage_percent = if total_logic_units == 0 {
        100.0
    } else {
        ((converted_logic_units as f64 / total_logic_units as f64) * 10_000.0).round() / 100.0
    };

    let mut unit_breakdown = BTreeMap::new();
    unit_breakdown.insert("nodes".to_string(), node_export.node_count);
    unit_breakdown.insert("bridge_nodes".to_string(), node_export.bridge_node_count);
    unit_breakdown.insert("source_files".to_string(), inventory.source_files.len());
    unit_breakdown.insert("resources".to_string(), inventory.resources.len());
    unit_breakdown.insert("functions".to_string(), inventory.code.functions.len());
    unit_breakdown.insert("calls".to_string(), inventory.code.calls.len());
    unit_breakdown.insert("semantic_gaps".to_string(), inventory.semantic_gaps.len());

    SgdkNodeCoverageReport {
        schema_version: "sgdk-node-coverage/v1".to_string(),
        project_name: inventory.project_name.clone(),
        source_root: inventory.root.clone(),
        total_logic_units,
        converted_logic_units,
        bridge_logic_units,
        unsupported_logic_units,
        editable_node_coverage_percent,
        buildable_after_roundtrip: unsupported_logic_units == 0,
        emulation_visible_ok: None,
        hardware_constraint_status,
        unit_breakdown,
        report_path: report_path.map(path_string),
    }
}

fn build_roundtrip_report(
    inventory: &SgdkProjectInventory,
    report_dir: &Path,
    report_path: Option<PathBuf>,
) -> Result<SgdkRoundTripReport, String> {
    let generated_dir = report_dir.join("sgdk-roundtrip").join("generated");
    fs::create_dir_all(&generated_dir).map_err(|error| {
        format!(
            "Could not create SGDK round-trip generated directory '{}': {}",
            generated_dir.display(),
            error
        )
    })?;
    let generated_c_path = generated_dir.join("main.c");
    let generated_res_path = generated_dir.join("resources.res");

    fs::write(&generated_c_path, render_roundtrip_c(inventory)).map_err(|error| {
        format!(
            "Could not write SGDK round-trip C '{}': {}",
            generated_c_path.display(),
            error
        )
    })?;
    fs::write(&generated_res_path, render_roundtrip_res(inventory)).map_err(|error| {
        format!(
            "Could not write SGDK round-trip RES '{}': {}",
            generated_res_path.display(),
            error
        )
    })?;

    let unsupported_logic_units = inventory
        .semantic_gaps
        .iter()
        .filter(|gap| is_unrecoverable_gap(&gap.kind))
        .count();
    let mut warnings = Vec::new();
    if !inventory.semantic_gaps.is_empty() {
        warnings.push(format!(
            "{} SGDK source bridge(s) preservados; edicao plena continua limitada ao subset convertido.",
            inventory.semantic_gaps.len()
        ));
    }
    warnings.push(
        "Build/emulacao real nao sao executados por este relatorio estatico; use o gate ignorado com SGDK oficial para promover evidencia.".to_string(),
    );

    Ok(SgdkRoundTripReport {
        schema_version: "sgdk-roundtrip/v1".to_string(),
        project_name: inventory.project_name.clone(),
        source_root: inventory.root.clone(),
        generated_c_path: path_string(generated_c_path),
        generated_res_path: path_string(generated_res_path),
        bridge_prevents_full_edit: !inventory.semantic_gaps.is_empty(),
        buildable_after_roundtrip: unsupported_logic_units == 0,
        build_attempted: false,
        build_ok: None,
        emulation_visible_ok: None,
        warnings,
        report_path: report_path.map(path_string),
    })
}

fn build_hardware_constraint_report(
    inventory: &SgdkProjectInventory,
    report_path: Option<PathBuf>,
) -> SgdkHardwareConstraintReport {
    let hardware_ops = summarize_hardware_ops(inventory);
    let asset_bytes = inventory
        .assets
        .iter()
        .map(|asset| asset.bytes)
        .sum::<u64>();
    let sprite_resources = inventory
        .resources
        .iter()
        .filter(|resource| resource.kind == "SPRITE")
        .count();
    let tile_resources = inventory
        .resources
        .iter()
        .filter(|resource| is_tilemap_resource(&resource.kind))
        .count();
    let pal_ntsc_branches = inventory
        .code
        .defines
        .iter()
        .filter(|define| {
            let upper = define.name.to_ascii_uppercase();
            upper.contains("PAL") || upper.contains("NTSC")
        })
        .count()
        + inventory
            .semantic_gaps
            .iter()
            .filter(|gap| gap.subject.contains("PAL") || gap.subject.contains("NTSC"))
            .count();

    let axes = vec![
        axis(
            "vram_residency",
            if asset_bytes > md_profile::MD_VRAM_BYTES as u64 {
                "warning"
            } else {
                "ok"
            },
            format!("{} bytes de assets indexados", asset_bytes),
            format!("{} bytes VRAM fisica", md_profile::MD_VRAM_BYTES),
            warning_if(
                asset_bytes > md_profile::MD_VRAM_BYTES as u64,
                "Assets excedem VRAM fisica; exigir residencia/streaming explicitos.",
            ),
            vec![format!("assets={}", inventory.assets.len())],
        ),
        axis(
            "cram_palette_slots",
            if hardware_ops.palette_calls > 0 {
                "warning"
            } else {
                "ok"
            },
            format!("{} operacao(oes) de paleta", hardware_ops.palette_calls),
            "4 paletas CRAM / 16 cores por slot".to_string(),
            warning_if(
                hardware_ops.palette_calls > 0,
                "Operacoes de paleta exigem auditoria de slots CRAM e conflitos com sprites/tilemaps.",
            ),
            vec!["VDP/PAL palette calls".to_string()],
        ),
        axis(
            "sprites_per_frame",
            if sprite_resources > md_profile::MD_SPRITES_PER_SCREEN as usize {
                "blocking"
            } else {
                "ok"
            },
            format!("{sprite_resources} SPRITE resource(s)"),
            format!("{} sprites por frame", md_profile::MD_SPRITES_PER_SCREEN),
            warning_if(
                sprite_resources > 0,
                "Recurso SPRITE precisa de validacao com entidades/culling para pico real por frame.",
            ),
            vec!["resources.res SPRITE".to_string()],
        ),
        axis(
            "sprites_per_scanline",
            "estimated",
            "sem geometria de cena importada neste report".to_string(),
            format!(
                "{} sprites por scanline",
                md_profile::MD_SPRITES_PER_SCANLINE
            ),
            vec![
                "Estimativa formal: rode build/import para obter posicoes e pico por scanline."
                    .to_string(),
            ],
            vec!["semantic inventory".to_string()],
        ),
        axis(
            "dma_frame_budget",
            if hardware_ops.dma_calls > 0 {
                "warning"
            } else {
                "ok"
            },
            format!("{} chamada(s) DMA", hardware_ops.dma_calls),
            format!("{} bytes por VBlank", md_profile::MD_DMA_VBLANK_BYTES),
            warning_if(
                hardware_ops.dma_calls > 0,
                "DMA detectado; confirmar bytes por frame no build real.",
            ),
            vec!["DMA_* calls".to_string()],
        ),
        axis(
            "tile_streaming_budget",
            if tile_resources > 0 || hardware_ops.tilemap_calls > 0 {
                "warning"
            } else {
                "ok"
            },
            format!(
                "{} tile resource(s), {} tilemap call(s)",
                tile_resources, hardware_ops.tilemap_calls
            ),
            "budget de streaming por VBlank do MD".to_string(),
            warning_if(
                tile_resources > 0 || hardware_ops.tilemap_calls > 0,
                "Tilemap/scroll detectado; validar streaming e DMA em cena real.",
            ),
            vec!["TILEMAP/MAP/VDP scroll".to_string()],
        ),
        axis(
            "sprite_metasprite_cell_count",
            "estimated",
            format!("{sprite_resources} sprite resource(s) sem dimensoes resolvidas"),
            format!(
                "{} celulas 32x32 concorrentes",
                md_profile::MD_MANAGED_SPRITE_CELL_BUDGET
            ),
            vec![
                "Estimativa formal ate resolver dimensoes do ResComp e animacoes por frame."
                    .to_string(),
            ],
            vec!["resources.res SPRITE".to_string()],
        ),
        axis(
            "rom_size_banks",
            if asset_bytes > 4 * 1024 * 1024 {
                "warning"
            } else {
                "ok"
            },
            format!("{} bytes de assets", asset_bytes),
            "4 MiB baseline conservador sem mapper".to_string(),
            warning_if(
                asset_bytes > 4 * 1024 * 1024,
                "Assets ultrapassam baseline de ROM sem mapper; validar bancos/mapper.",
            ),
            vec!["asset inventory".to_string()],
        ),
        axis(
            "pal_ntsc_frame_budget",
            if pal_ntsc_branches > 0 {
                "warning"
            } else {
                "estimated"
            },
            format!("{pal_ntsc_branches} sinal(is) PAL/NTSC"),
            "60 Hz NTSC / 50 Hz PAL".to_string(),
            if pal_ntsc_branches > 0 {
                vec!["Branches PAL/NTSC exigem budget separado por regiao.".to_string()]
            } else {
                vec!["Sem sinal explicito; assumir NTSC ate runtime contract confirmar.".to_string()]
            },
            vec!["defines/preprocessor".to_string()],
        ),
        axis(
            "hblank_mid_screen_palette_swap",
            if hardware_ops.hblank_callbacks > 0 || hardware_ops.palette_calls > 0 {
                "warning"
            } else {
                "ok"
            },
            format!(
                "{} HBlank callback(s), {} palette call(s)",
                hardware_ops.hblank_callbacks, hardware_ops.palette_calls
            ),
            "HBlank seguro dentro da janela de CPU/VDP".to_string(),
            warning_if(
                hardware_ops.hblank_callbacks > 0 || hardware_ops.palette_calls > 0,
                "HBlank/palette swap detectado; confirmar custo por scanline e conflitos com DMA.",
            ),
            vec!["SYS_setHIntCallback/VDP_setPalette".to_string()],
        ),
        axis(
            "shadow_highlight",
            if hardware_ops.shadow_highlight_calls > 0 {
                "warning"
            } else {
                "not_detected"
            },
            format!(
                "{} chamada(s) shadow/highlight",
                hardware_ops.shadow_highlight_calls
            ),
            "modo shadow/highlight do VDP".to_string(),
            warning_if(
                hardware_ops.shadow_highlight_calls > 0,
                "Shadow/highlight afeta prioridade/paleta; validar visualmente no core Libretro.",
            ),
            vec!["VDP shadow/highlight calls".to_string()],
        ),
        axis(
            "cpu_z80_estimate",
            "estimated",
            format!(
                "{} funcao(oes), {} chamada(s), {} audio call(s)",
                inventory.code.functions.len(),
                inventory.code.calls.len(),
                hardware_ops.audio_calls
            ),
            "estimativa formal ate profiler runtime".to_string(),
            vec![
                "CPU/Z80 ainda e eixo estimado; use profiler/runtime evidence antes de qualquer claim de equivalencia."
                    .to_string(),
            ],
            vec!["function/call/audio inventory".to_string()],
        ),
    ];

    let status = summarize_axes_status(&axes);
    SgdkHardwareConstraintReport {
        schema_version: "sgdk-hardware-constraints/v1".to_string(),
        project_name: inventory.project_name.clone(),
        source_root: inventory.root.clone(),
        status,
        axes,
        report_path: report_path.map(path_string),
    }
}

fn build_node_graph_export_report(
    inventory: &SgdkProjectInventory,
    report_path: Option<PathBuf>,
) -> SgdkNodeGraphExportReport {
    let graph = serde_json::from_str::<Value>(&inventory.semantic_node_graph_json)
        .unwrap_or_else(|_| serde_json::json!({ "nodes": [], "edges": [] }));
    let nodes = graph
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let edge_count = graph
        .get("edges")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let mut node_type_counts = BTreeMap::new();
    let mut bridge_node_count = 0usize;
    for node in &nodes {
        if let Some(node_type) = node.get("type").and_then(Value::as_str) {
            *node_type_counts.entry(node_type.to_string()).or_insert(0) += 1;
            if node_type == "bridge_unconverted_source" {
                bridge_node_count += 1;
            }
        }
    }

    SgdkNodeGraphExportReport {
        schema_version: "sgdk-nodegraph-export/v1".to_string(),
        project_name: inventory.project_name.clone(),
        source_root: inventory.root.clone(),
        node_graph_json: inventory.semantic_node_graph_json.clone(),
        node_count: nodes.len(),
        edge_count,
        bridge_node_count,
        node_type_counts,
        report_path: report_path.map(path_string),
    }
}

fn partition_resources(
    resources: &[SgdkResourceInventory],
) -> (
    Vec<SgdkResourceInventory>,
    Vec<SgdkResourceInventory>,
    Vec<SgdkResourceInventory>,
    Vec<SgdkResourceInventory>,
) {
    let mut sprites = Vec::new();
    let mut tilemaps = Vec::new();
    let mut audio = Vec::new();
    let mut other = Vec::new();
    for resource in resources {
        if resource.kind == "SPRITE" {
            sprites.push(resource.clone());
        } else if is_tilemap_resource(&resource.kind) {
            tilemaps.push(resource.clone());
        } else if is_audio_resource(&resource.kind) {
            audio.push(resource.clone());
        } else {
            other.push(resource.clone());
        }
    }
    (sprites, tilemaps, audio, other)
}

fn summarize_hardware_ops(inventory: &SgdkProjectInventory) -> SgdkIrHardwareOps {
    let mut ops = SgdkIrHardwareOps {
        input_calls: 0,
        sprite_calls: 0,
        tilemap_calls: 0,
        audio_calls: 0,
        vdp_calls: 0,
        dma_calls: 0,
        palette_calls: 0,
        hblank_callbacks: 0,
        shadow_highlight_calls: 0,
    };
    for call in &inventory.code.calls {
        match call.family.as_str() {
            "input" => ops.input_calls += 1,
            "sprite" => ops.sprite_calls += 1,
            "tilemap" => ops.tilemap_calls += 1,
            "audio" => ops.audio_calls += 1,
            "vdp" => ops.vdp_calls += 1,
            "dma" => ops.dma_calls += 1,
            "palette" => ops.palette_calls += 1,
            _ => {}
        }
        if is_palette_call(&call.name) {
            ops.palette_calls += usize::from(call.family != "palette");
        }
        if is_hblank_call(&call.name) {
            ops.hblank_callbacks += 1;
        }
        if is_shadow_highlight_call(&call.name) {
            ops.shadow_highlight_calls += 1;
        }
    }
    for callback in &inventory.code.callbacks {
        if is_hblank_call(&callback.name) {
            ops.hblank_callbacks += 1;
        }
    }
    ops
}

fn axis(
    id: &str,
    status: &str,
    measured: String,
    limit: String,
    warnings: Vec<String>,
    evidence: Vec<String>,
) -> SgdkHardwareConstraintAxis {
    SgdkHardwareConstraintAxis {
        id: id.to_string(),
        status: status.to_string(),
        measured,
        limit,
        warnings,
        evidence,
    }
}

fn summarize_axes_status(axes: &[SgdkHardwareConstraintAxis]) -> String {
    if axes.iter().any(|axis| axis.status == "blocking") {
        "blocking".to_string()
    } else if axes
        .iter()
        .any(|axis| axis.status == "warning" || !axis.warnings.is_empty())
    {
        "warning".to_string()
    } else if axes.iter().any(|axis| axis.status == "estimated") {
        "estimated".to_string()
    } else {
        "ok".to_string()
    }
}

fn warning_if(condition: bool, message: &str) -> Vec<String> {
    if condition {
        vec![message.to_string()]
    } else {
        Vec::new()
    }
}

fn is_tilemap_resource(kind: &str) -> bool {
    matches!(kind, "TILEMAP" | "MAP" | "IMAGE" | "TILESET" | "BITMAP")
}

fn is_audio_resource(kind: &str) -> bool {
    matches!(kind, "WAV" | "XGM" | "XGM2" | "PCM")
}

fn is_palette_call(name: &str) -> bool {
    name.starts_with("PAL_") || name.contains("Palette")
}

fn is_hblank_call(name: &str) -> bool {
    name.contains("HBlank") || name.contains("HInt")
}

fn is_shadow_highlight_call(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("shadow") || lower.contains("highlight") || lower.contains("hilight")
}

fn is_unrecoverable_gap(kind: &str) -> bool {
    matches!(kind, "lossy_source_encoding" | "lossy_resource_encoding")
}

fn render_roundtrip_c(inventory: &SgdkProjectInventory) -> String {
    let mut out = String::new();
    out.push_str("#include <genesis.h>\n\n");
    out.push_str("/* Generated by RetroDev Studio SGDK Semantic IR v1.\n");
    out.push_str(" * Converted subset is emitted as canonical SGDK scaffolding.\n");
    out.push_str(" * Source Bridge entries below preserve non-converted semantics.\n");
    out.push_str(" */\n");
    for bridge in &inventory.semantic_gaps {
        out.push_str(&format!(
            "/* SOURCE_BRIDGE kind={} subject={} */\n",
            bridge.kind, bridge.subject
        ));
    }
    out.push_str("\nint main(void) {\n");
    out.push_str("    VDP_drawText(\"RetroDev SGDK Semantic Roundtrip\", 2, 2);\n");
    if inventory
        .code
        .calls
        .iter()
        .any(|call| call.family == "audio")
    {
        out.push_str("    /* Audio calls preserved in IR; wire assets after bridge review. */\n");
    }
    out.push_str("    while (TRUE) {\n");
    out.push_str("        SYS_doVBlankProcess();\n");
    out.push_str("    }\n");
    out.push_str("    return 0;\n");
    out.push_str("}\n");
    out
}

fn render_roundtrip_res(inventory: &SgdkProjectInventory) -> String {
    let mut out = String::new();
    for resource in &inventory.resources {
        if matches!(
            resource.kind.as_str(),
            "SPRITE"
                | "IMAGE"
                | "BITMAP"
                | "TILESET"
                | "TILEMAP"
                | "MAP"
                | "WAV"
                | "XGM"
                | "XGM2"
                | "PCM"
                | "BIN"
        ) {
            let params = if resource.params.is_empty() {
                String::new()
            } else {
                format!(" {}", resource.params.join(" "))
            };
            out.push_str(&format!(
                "{} {} \"{}\"{}\n",
                resource.kind, resource.name, resource.asset_path, params
            ));
        } else {
            out.push_str(&format!(
                "# SOURCE_BRIDGE unsupported_resource_kind {} {}\n",
                resource.kind, resource.name
            ));
        }
    }
    out
}

fn write_pretty_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize SGDK semantic report: {error}"))?;
    fs::write(path, format!("{json}\n")).map_err(|error| {
        format!(
            "Could not write SGDK semantic report '{}': {}",
            path.display(),
            error
        )
    })
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "retro-dev-studio-sgdk-semantic-reports-{label}-{suffix}"
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write fixture");
    }

    fn write_semantic_fixture(root: &Path) {
        write_file(
            &root.join("res/resources.res"),
            r#"
SPRITE hero "sprites/hero.png" 4 4 FAST 0
TILEMAP level_map "tiles/level.bin" "tiles/level.png" NONE 0
XGM2 stage_music "audio/stage.xgm2"
WAV hit_sfx "audio/hit.wav" PCM
UNKNOWN odd "odd.bin"
"#,
        );
        write_file(&root.join("res/sprites/hero.png"), "fake png");
        write_file(&root.join("res/tiles/level.bin"), "fake tilemap");
        write_file(&root.join("res/tiles/level.png"), "fake tiles");
        write_file(&root.join("res/audio/stage.xgm2"), "fake xgm2");
        write_file(&root.join("res/audio/hit.wav"), "fake wav");
        write_file(
            &root.join("src/main.c"),
            r#"
#include <genesis.h>
#define STATE_IDLE 0
#define STATE_RUN 1
#define SET_STATE(next) do { gameState = next; } while (0)
#ifdef PAL_BUILD
static u16 palMode = 1;
#endif

static u16 gameState = STATE_IDLE;
static u16 frameTimer;
static u16 collision_map[4] = { 0, 1, 1, 0 };
static Sprite* player;

static void hblank_callback(void) {
    VDP_setPalette(PAL1, palette_black);
}

void update_player(void) {
    u16 joy = JOY_readJoypad(JOY_1);
    switch (gameState) {
        case STATE_IDLE:
            if (joy & BUTTON_RIGHT) gameState = STATE_RUN;
            break;
        case STATE_RUN:
            SPR_setAnim(player, 1);
            MAP_scrollTo(&level_map, 1, 0);
            XGM_startPlayPCM(SFX_HIT, 15, SOUND_PCM_CH2);
            DMA_doDma(DMA_VRAM, source, 0, 32, 2);
            break;
    }
    frameTimer++;
    if (joy & BUTTON_A) frameTimer = 0;
    __asm__("nop");
}

int main(void) {
    VDP_setPlaneSize(64, 32, TRUE);
    SYS_setHIntCallback(hblank_callback);
    while (TRUE) {
        update_player();
        SYS_doVBlankProcess();
    }
    return 0;
}
"#,
        );
    }

    #[test]
    fn semantic_ir_report_accounts_coverage_and_writes_named_artifacts() {
        let root = temp_dir("coverage");
        write_semantic_fixture(&root);
        let report_dir = root.join(".rds").join("reports");

        let bundle =
            write_sgdk_semantic_report_bundle(&root, &report_dir).expect("semantic report bundle");

        assert_eq!(bundle.semantic_ir.schema_version, "sgdk-semantic-ir/v1");
        assert_eq!(bundle.coverage.schema_version, "sgdk-node-coverage/v1");
        assert!(bundle.coverage.total_logic_units > 0);
        assert!(bundle.coverage.converted_logic_units > 0);
        assert!(bundle.coverage.bridge_logic_units > 0);
        assert_eq!(bundle.coverage.unsupported_logic_units, 0);
        assert!(bundle.coverage.editable_node_coverage_percent > 0.0);
        assert!(bundle.coverage.editable_node_coverage_percent < 100.0);
        assert!(bundle.coverage.buildable_after_roundtrip);
        assert_eq!(bundle.coverage.emulation_visible_ok, None);
        assert_eq!(bundle.coverage.hardware_constraint_status, "warning");

        for filename in [
            "sgdk-semantic-ir-report.json",
            "sgdk-node-coverage-report.json",
            "sgdk-roundtrip-report.json",
            "sgdk-hardware-constraints-report.json",
        ] {
            assert!(report_dir.join(filename).is_file(), "{filename}");
        }
    }

    #[test]
    fn hardware_constraint_report_exposes_all_required_axes() {
        let root = temp_dir("hardware");
        write_semantic_fixture(&root);

        let report = inspect_sgdk_hardware_constraints(&root).expect("hardware report");
        let axes = report
            .axes
            .iter()
            .map(|axis| axis.id.as_str())
            .collect::<BTreeSet<_>>();

        for required in [
            "vram_residency",
            "cram_palette_slots",
            "sprites_per_frame",
            "sprites_per_scanline",
            "dma_frame_budget",
            "tile_streaming_budget",
            "sprite_metasprite_cell_count",
            "rom_size_banks",
            "pal_ntsc_frame_budget",
            "hblank_mid_screen_palette_swap",
            "shadow_highlight",
            "cpu_z80_estimate",
        ] {
            assert!(axes.contains(required), "{required}");
        }
        assert!(report
            .axes
            .iter()
            .any(|axis| axis.id == "cpu_z80_estimate" && axis.status == "estimated"));
        assert!(report
            .axes
            .iter()
            .any(|axis| axis.id == "hblank_mid_screen_palette_swap"
                && axis
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("HBlank"))));
    }

    #[test]
    fn exported_node_graph_contains_required_semantic_node_families() {
        let root = temp_dir("nodegraph");
        write_semantic_fixture(&root);

        let report = export_sgdk_semantic_node_graph(&root).expect("node graph report");
        let graph: Value = serde_json::from_str(&report.node_graph_json).expect("graph json");
        let node_types = graph
            .get("nodes")
            .and_then(Value::as_array)
            .expect("nodes")
            .iter()
            .filter_map(|node| node.get("type").and_then(Value::as_str))
            .collect::<BTreeSet<_>>();

        for required in [
            "fsm_state",
            "fsm_transition",
            "input_held",
            "sprite_anim",
            "scroll_tilemap",
            "action_sound",
            "timer",
            "condition_overlap",
            "vdp_validator",
            "dma_budget",
            "palette_hblank",
            "bridge_unconverted_source",
        ] {
            assert!(node_types.contains(required), "{required}");
        }
        assert!(report.bridge_node_count > 0);
        assert!(report.node_count >= node_types.len());
    }
}
