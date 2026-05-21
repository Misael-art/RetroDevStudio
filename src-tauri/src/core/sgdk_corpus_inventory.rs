use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::hardware::md_profile;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SourceLocation {
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkNamedSourceItem {
    pub name: String,
    pub source: SourceLocation,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkDefineInventory {
    pub name: String,
    pub function_like: bool,
    pub value: String,
    pub source: SourceLocation,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkFunctionInventory {
    pub name: String,
    pub source: SourceLocation,
    pub end_line: usize,
    pub is_definition: bool,
    pub is_prototype: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCallInventory {
    pub name: String,
    pub family: String,
    pub caller: Option<String>,
    pub source: SourceLocation,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkResourceInventory {
    pub kind: String,
    pub name: String,
    pub asset_path: String,
    pub params: Vec<String>,
    pub asset_exists: bool,
    pub source: SourceLocation,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkAssetInventory {
    pub relative_path: String,
    pub kind: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkSemanticGap {
    pub kind: String,
    pub subject: String,
    pub detail: String,
    pub source: Option<SourceLocation>,
    #[serde(default)]
    pub impact: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub suggestion: String,
    #[serde(default)]
    pub blocks_nocode: bool,
    #[serde(default)]
    pub blocks_build: bool,
    #[serde(default)]
    pub blocks_round_trip: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkNodeCandidate {
    pub node_type: String,
    pub label: String,
    pub system: String,
    pub source: Option<SourceLocation>,
    #[serde(default)]
    pub blocked_by_gap: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalProjectModel {
    pub schema_version: String,
    pub project: SgdkCanonicalProject,
    pub scenes: Vec<SgdkCanonicalScene>,
    pub hardware_budget: SgdkCanonicalHardwareBudget,
    pub source_mappings: Vec<SgdkCanonicalSourceMapping>,
    pub compatibility_bridges: Vec<SgdkCompatibilityBridge>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalProject {
    pub name: String,
    pub source_root: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalScene {
    pub id: String,
    pub entities: Vec<SgdkCanonicalEntity>,
    pub state_machines: Vec<String>,
    pub timers: Vec<String>,
    pub variables: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalEntity {
    pub id: String,
    pub components: Vec<SgdkCanonicalComponent>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalComponent {
    pub kind: String,
    pub name: String,
    pub source: Option<SourceLocation>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalHardwareBudget {
    pub target: String,
    pub vram_bytes: u32,
    pub dma_frame_bytes: u32,
    pub sprite_limit: u32,
    pub scanline_sprite_limit: u32,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCanonicalSourceMapping {
    pub source: SourceLocation,
    pub model_path: String,
    pub impact: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCompatibilityBridge {
    pub kind: String,
    pub subject: String,
    pub source: Option<SourceLocation>,
    pub preservation: String,
    pub lossless: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCodeInventory {
    pub includes: Vec<SgdkNamedSourceItem>,
    pub defines: Vec<SgdkDefineInventory>,
    pub macros: Vec<SgdkDefineInventory>,
    pub structs: Vec<SgdkNamedSourceItem>,
    pub enums: Vec<SgdkNamedSourceItem>,
    pub globals: Vec<SgdkNamedSourceItem>,
    pub arrays: Vec<SgdkNamedSourceItem>,
    pub functions: Vec<SgdkFunctionInventory>,
    pub calls: Vec<SgdkCallInventory>,
    pub callbacks: Vec<SgdkCallInventory>,
    pub main_loops: Vec<SgdkNamedSourceItem>,
    pub update_functions: Vec<SgdkFunctionInventory>,
    pub game_states: Vec<SgdkNamedSourceItem>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkProjectInventory {
    pub project_name: String,
    pub root: String,
    pub source_files: Vec<String>,
    pub header_files: Vec<String>,
    pub resource_manifests: Vec<String>,
    pub assets: Vec<SgdkAssetInventory>,
    pub resources: Vec<SgdkResourceInventory>,
    pub code: SgdkCodeInventory,
    pub semantic_gaps: Vec<SgdkSemanticGap>,
    #[serde(default)]
    pub node_candidates: Vec<SgdkNodeCandidate>,
    #[serde(default)]
    pub canonical_model: SgdkCanonicalProjectModel,
    /// Grafo semantico NodeGraph serializado (JSON) derivado do inventario.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub semantic_node_graph_json: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCorpusInventorySummary {
    pub project_name: String,
    pub root: String,
    pub source_files: usize,
    pub header_files: usize,
    pub resource_manifests: usize,
    pub resources: usize,
    pub assets: usize,
    pub functions: usize,
    pub sgdk_calls: usize,
    pub semantic_gaps: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct SgdkCorpusInventoryReport {
    pub corpus_root: String,
    pub total_projects: usize,
    pub projects: Vec<SgdkCorpusInventorySummary>,
    pub project_details: Vec<SgdkProjectInventory>,
    pub gap_totals: BTreeMap<String, usize>,
}

pub fn inspect_sgdk_project_for_nocode_inventory(
    root: &Path,
) -> Result<SgdkProjectInventory, String> {
    if !root.is_dir() {
        return Err(format!(
            "SGDK inventory root is not a directory: {}",
            root.display()
        ));
    }

    let mut files = Vec::new();
    collect_project_files(root, root, &mut files)?;
    files.sort();

    let mut source_files = Vec::new();
    let mut header_files = Vec::new();
    let mut resource_manifests = Vec::new();
    let mut assets = Vec::new();
    let mut resources = Vec::new();
    let mut code = SgdkCodeInventory::default();
    let mut semantic_gaps = Vec::new();

    for rel in &files {
        let full_path = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let extension = path_extension_lower(rel);
        match extension.as_deref() {
            Some("c") => source_files.push(rel.clone()),
            Some("h") => header_files.push(rel.clone()),
            Some("s") | Some("asm") => {
                source_files.push(rel.clone());
                semantic_gaps.push(make_semantic_gap(
                    "assembly_source",
                    rel.clone(),
                    "Assembly source is indexed but not represented as editable no-code nodes.",
                    Some(SourceLocation {
                        file: rel.clone(),
                        line: 1,
                    }),
                ));
            }
            Some("res") => resource_manifests.push(rel.clone()),
            _ => {}
        }

        if let Some(kind) = classify_asset_extension(extension.as_deref()) {
            let bytes = fs::metadata(&full_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            assets.push(SgdkAssetInventory {
                relative_path: rel.clone(),
                kind: kind.to_string(),
                bytes,
            });
        }
    }

    for rel in &resource_manifests {
        let manifest_path = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let content = read_text_lossy_with_gap(
            &manifest_path,
            rel,
            "lossy_resource_encoding",
            &mut semantic_gaps,
        )?;
        let manifest_dir = Path::new(rel)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        for parsed in parse_resource_manifest(rel, &content) {
            if !is_supported_resource_kind(&parsed.kind) {
                semantic_gaps.push(make_semantic_gap(
                    "unsupported_resource_kind",
                    parsed.kind.clone(),
                    format!(
                        "Resource '{}' uses SGDK kind '{}' without a canonical no-code mapping.",
                        parsed.name, parsed.kind
                    ),
                    Some(parsed.source.clone()),
                ));
            }
            let asset_rel = normalize_joined_rel_path(&manifest_dir, &parsed.asset_path);
            resources.push(SgdkResourceInventory {
                asset_exists: root
                    .join(asset_rel.replace('/', std::path::MAIN_SEPARATOR_STR))
                    .is_file(),
                ..parsed
            });
        }
    }

    let code_files = source_files
        .iter()
        .chain(header_files.iter())
        .filter(|rel| matches!(path_extension_lower(rel).as_deref(), Some("c") | Some("h")))
        .cloned()
        .collect::<Vec<_>>();

    for rel in &code_files {
        let full_path = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let content =
            read_text_lossy_with_gap(&full_path, rel, "lossy_source_encoding", &mut semantic_gaps)?;
        parse_code_file(rel, &content, &mut code, &mut semantic_gaps);
    }

    let mut node_candidates = derive_sgdk_node_candidates(&resources, &code, &semantic_gaps);
    apply_formal_bridge_resolution(&mut semantic_gaps);

    sort_project_inventory(
        &mut source_files,
        &mut header_files,
        &mut resource_manifests,
        &mut assets,
        &mut resources,
        &mut code,
        &mut semantic_gaps,
    );
    sort_node_candidates(&mut node_candidates);

    let project_name = root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root.display().to_string());
    let canonical_model = derive_sgdk_canonical_model(
        &project_name,
        &root.to_string_lossy(),
        &resources,
        &code,
        &semantic_gaps,
    );

    let inventory = SgdkProjectInventory {
        project_name,
        root: root.to_string_lossy().to_string(),
        source_files,
        header_files,
        resource_manifests,
        assets,
        resources,
        code,
        semantic_gaps,
        node_candidates,
        canonical_model,
        semantic_node_graph_json: String::new(),
    };
    let semantic_node_graph_json =
        crate::core::sgdk_semantic_graph::convert_sgdk_inventory_to_node_graph(&inventory);

    Ok(SgdkProjectInventory {
        semantic_node_graph_json,
        ..inventory
    })
}

pub fn inspect_sgdk_corpus_for_nocode_inventory(
    corpus_root: &Path,
) -> Result<SgdkCorpusInventoryReport, String> {
    if !corpus_root.is_dir() {
        return Err(format!(
            "SGDK corpus root is not a directory: {}",
            corpus_root.display()
        ));
    }

    let mut project_roots = Vec::new();
    for entry in fs::read_dir(corpus_root).map_err(|error| {
        format!(
            "Could not read corpus root '{}': {}",
            corpus_root.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Could not read corpus entry under '{}': {}",
                corpus_root.display(),
                error
            )
        })?;
        let path = entry.path();
        if path.is_dir() {
            project_roots.push(path);
        }
    }
    project_roots.sort_by(|a, b| {
        let an = a
            .file_name()
            .map(|v| v.to_string_lossy())
            .unwrap_or_default();
        let bn = b
            .file_name()
            .map(|v| v.to_string_lossy())
            .unwrap_or_default();
        an.cmp(&bn)
    });

    let mut projects = Vec::new();
    let mut project_details = Vec::new();
    let mut gap_totals = BTreeMap::new();
    for project_root in project_roots {
        let inventory = inspect_sgdk_project_for_nocode_inventory(&project_root)?;
        for gap in &inventory.semantic_gaps {
            *gap_totals.entry(gap.kind.clone()).or_insert(0) += 1;
        }
        projects.push(SgdkCorpusInventorySummary {
            project_name: inventory.project_name.clone(),
            root: inventory.root.clone(),
            source_files: inventory.source_files.len(),
            header_files: inventory.header_files.len(),
            resource_manifests: inventory.resource_manifests.len(),
            resources: inventory.resources.len(),
            assets: inventory.assets.len(),
            functions: inventory
                .code
                .functions
                .iter()
                .filter(|function| function.is_definition)
                .count(),
            sgdk_calls: inventory
                .code
                .calls
                .iter()
                .filter(|call| call.family != "project")
                .count(),
            semantic_gaps: inventory.semantic_gaps.len(),
        });
        project_details.push(inventory);
    }

    Ok(SgdkCorpusInventoryReport {
        corpus_root: corpus_root.to_string_lossy().to_string(),
        total_projects: projects.len(),
        projects,
        project_details,
        gap_totals,
    })
}

pub fn write_sgdk_corpus_inventory_report(
    corpus_root: &Path,
    report_path: &Path,
) -> Result<SgdkCorpusInventoryReport, String> {
    let report = inspect_sgdk_corpus_for_nocode_inventory(corpus_root)?;
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create SGDK inventory report directory '{}': {}",
                parent.display(),
                error
            )
        })?;
    }
    let serialized = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("Could not serialize SGDK inventory report: {error}"))?;
    fs::write(report_path, serialized).map_err(|error| {
        format!(
            "Could not write SGDK inventory report '{}': {}",
            report_path.display(),
            error
        )
    })?;
    Ok(report)
}

fn collect_project_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    if should_skip_dir(root, current) {
        return Ok(());
    }
    for entry in fs::read_dir(current).map_err(|error| {
        format!(
            "Could not read directory '{}': {}",
            current.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| {
            format!("Could not read entry in '{}': {}", current.display(), error)
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_project_files(root, &path, files)?;
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        files.push(normalize_rel_path(relative));
    }
    Ok(())
}

fn should_skip_dir(root: &Path, current: &Path) -> bool {
    if current == root {
        return false;
    }
    let Ok(relative) = current.strip_prefix(root) else {
        return false;
    };
    let first = relative
        .components()
        .next()
        .and_then(|component| match component {
            std::path::Component::Normal(value) => {
                Some(value.to_string_lossy().to_ascii_lowercase())
            }
            _ => None,
        })
        .unwrap_or_default();
    matches!(
        first.as_str(),
        ".git" | "rds" | "build" | "out" | "target" | "bin"
    )
}

fn normalize_rel_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(segment) => Some(segment.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_joined_rel_path(parent: &Path, child: &str) -> String {
    let child_path = Path::new(child);
    if child_path.is_absolute() {
        return normalize_rel_path(child_path);
    }
    normalize_rel_path(&parent.join(child_path))
}

fn path_extension_lower(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

fn classify_asset_extension(extension: Option<&str>) -> Option<&'static str> {
    match extension {
        Some("png") | Some("bmp") | Some("jpg") | Some("jpeg") | Some("gif") | Some("ppm") => {
            Some("image")
        }
        Some("wav") | Some("xgm") | Some("xgm2") | Some("pcm") | Some("vgm") => Some("audio"),
        Some("bin") | Some("map") | Some("tmx") | Some("json") | Some("csv") => Some("data"),
        _ => None,
    }
}

fn classify_semantic_gap(
    kind: &str,
) -> (&'static str, &'static str, &'static str, bool, bool, bool) {
    match kind {
        "preprocessor_condition" => (
            "Conditional branch changes the SGDK source shape and needs branch-aware source mapping.",
            "warning",
            "Create a Source Bridge node for the inactive/ambiguous branch until branch-specific AST is available.",
            true,
            false,
            true,
        ),
        "function_like_macro" | "multiline_macro" => (
            "Macro expansion may hide editable behavior from the no-code graph.",
            "warning",
            "Create a typed macro Bridge node or replace with an explicit SGDK node template.",
            true,
            false,
            true,
        ),
        "unsupported_resource_kind" => (
            "Resource can stay buildable, but the editor cannot expose a canonical authoring surface.",
            "warning",
            "Route the declaration through a Source Bridge node and add a resource mapper before promoting compatibility.",
            true,
            false,
            true,
        ),
        "assembly_source" | "inline_assembly" => (
            "Assembly is preserved as source but cannot be edited safely as no-code logic.",
            "warning",
            "Keep assembly behind a Source Bridge node and mark generated output as non-round-trippable.",
            true,
            false,
            true,
        ),
        "lossy_source_encoding" | "lossy_resource_encoding" => (
            "Source offsets may be approximate after UTF-8 replacement decoding.",
            "warning",
            "Normalize file encoding before relying on precise source mapping.",
            false,
            false,
            true,
        ),
        _ => (
            "SGDK construct is indexed but not fully represented in the canonical no-code model.",
            "warning",
            "Track this construct through a Source Bridge node and keep build output conservative.",
            true,
            false,
            true,
        ),
    }
}

fn make_semantic_gap(
    kind: &str,
    subject: impl Into<String>,
    detail: impl Into<String>,
    source: Option<SourceLocation>,
) -> SgdkSemanticGap {
    let (impact, severity, suggestion, blocks_nocode, blocks_build, blocks_round_trip) =
        classify_semantic_gap(kind);
    SgdkSemanticGap {
        kind: kind.to_string(),
        subject: subject.into(),
        detail: detail.into(),
        source,
        impact: impact.to_string(),
        severity: severity.to_string(),
        suggestion: suggestion.to_string(),
        blocks_nocode,
        blocks_build,
        blocks_round_trip,
    }
}

fn apply_formal_bridge_resolution(gaps: &mut [SgdkSemanticGap]) {
    for gap in gaps {
        gap.blocks_nocode = false;
        gap.blocks_build = false;
        gap.blocks_round_trip = false;
        gap.suggestion = format!(
            "Formal SGDK Source Bridge preserves '{}' with source mapping; edit through canonical nodes when available and keep bridge payload for lossless reopen/build.",
            gap.kind
        );
    }
}

fn derive_sgdk_canonical_model(
    project_name: &str,
    source_root: &str,
    resources: &[SgdkResourceInventory],
    code: &SgdkCodeInventory,
    gaps: &[SgdkSemanticGap],
) -> SgdkCanonicalProjectModel {
    let mut entities = Vec::new();
    let mut source_mappings = Vec::new();
    let mut capabilities = BTreeSet::new();

    for resource in resources {
        let mut components = Vec::new();
        match resource.kind.as_str() {
            "SPRITE" => {
                components.push(canonical_component(
                    "Sprite",
                    &resource.name,
                    Some(resource.source.clone()),
                ));
                components.push(canonical_component(
                    "Animation",
                    &resource.name,
                    Some(resource.source.clone()),
                ));
                capabilities.insert("SPR".to_string());
            }
            "TILEMAP" | "MAP" | "IMAGE" | "TILESET" | "BITMAP" => {
                components.push(canonical_component(
                    "Tilemap",
                    &resource.name,
                    Some(resource.source.clone()),
                ));
                capabilities.insert("VDP".to_string());
            }
            "WAV" | "XGM" | "XGM2" | "PCM" => {
                components.push(canonical_component(
                    "Audio",
                    &resource.name,
                    Some(resource.source.clone()),
                ));
                capabilities.insert("XGM".to_string());
            }
            _ => {
                components.push(canonical_component(
                    "CompatibilityBridge",
                    &resource.name,
                    Some(resource.source.clone()),
                ));
            }
        }

        source_mappings.push(SgdkCanonicalSourceMapping {
            source: resource.source.clone(),
            model_path: format!("scenes/main/entities/{}/components", resource.name),
            impact: resource.kind.clone(),
        });
        entities.push(SgdkCanonicalEntity {
            id: canonical_id(&resource.name),
            components,
        });
    }

    let mut input_entity = SgdkCanonicalEntity {
        id: "input_system".to_string(),
        components: Vec::new(),
    };
    let mut hardware_entity = SgdkCanonicalEntity {
        id: "hardware_budget".to_string(),
        components: Vec::new(),
    };
    let mut audio_entity = SgdkCanonicalEntity {
        id: "audio_system".to_string(),
        components: Vec::new(),
    };
    let mut camera_entity = SgdkCanonicalEntity {
        id: "camera_system".to_string(),
        components: Vec::new(),
    };
    let mut collision_entity = SgdkCanonicalEntity {
        id: "collision_system".to_string(),
        components: Vec::new(),
    };

    for call in &code.calls {
        match call.family.as_str() {
            "input" => {
                input_entity.components.push(canonical_component(
                    "Input",
                    &call.name,
                    Some(call.source.clone()),
                ));
                capabilities.insert("JOY".to_string());
                source_mappings.push(SgdkCanonicalSourceMapping {
                    source: call.source.clone(),
                    model_path: "scenes/main/entities/input_system/components/Input".to_string(),
                    impact: "Input".to_string(),
                });
            }
            "vdp" | "dma" => {
                hardware_entity.components.push(canonical_component(
                    "HardwareBudget",
                    &call.name,
                    Some(call.source.clone()),
                ));
                capabilities.insert(call.family.to_ascii_uppercase());
                source_mappings.push(SgdkCanonicalSourceMapping {
                    source: call.source.clone(),
                    model_path: "scenes/main/entities/hardware_budget/components/HardwareBudget"
                        .to_string(),
                    impact: "HardwareBudget".to_string(),
                });
                if call.name.contains("Scroll") {
                    camera_entity.components.push(canonical_component(
                        "Camera",
                        &call.name,
                        Some(call.source.clone()),
                    ));
                }
            }
            "tilemap" => {
                camera_entity.components.push(canonical_component(
                    "Camera",
                    &call.name,
                    Some(call.source.clone()),
                ));
                capabilities.insert("VDP".to_string());
            }
            "audio" => {
                audio_entity.components.push(canonical_component(
                    "Audio",
                    &call.name,
                    Some(call.source.clone()),
                ));
                capabilities.insert("XGM".to_string());
            }
            _ => {}
        }
    }

    for array in &code.arrays {
        if array.name.to_ascii_lowercase().contains("collision") {
            collision_entity.components.push(canonical_component(
                "Collision",
                &array.name,
                Some(array.source.clone()),
            ));
        }
    }

    push_entity_if_has_components(&mut entities, input_entity);
    push_entity_if_has_components(&mut entities, hardware_entity);
    push_entity_if_has_components(&mut entities, audio_entity);
    push_entity_if_has_components(&mut entities, camera_entity);
    push_entity_if_has_components(&mut entities, collision_entity);
    entities.sort_by(|left, right| left.id.cmp(&right.id));

    let mut state_machines = code
        .game_states
        .iter()
        .map(|state| state.name.clone())
        .collect::<Vec<_>>();
    state_machines.sort();
    state_machines.dedup();

    let mut timers = code
        .main_loops
        .iter()
        .map(|loop_item| loop_item.name.clone())
        .chain(
            code.update_functions
                .iter()
                .map(|function| function.name.clone()),
        )
        .collect::<Vec<_>>();
    timers.sort();
    timers.dedup();

    let mut variables = code
        .globals
        .iter()
        .map(|global| global.name.clone())
        .chain(code.defines.iter().map(|define| define.name.clone()))
        .collect::<Vec<_>>();
    variables.sort();
    variables.dedup();

    let mut compatibility_bridges = gaps
        .iter()
        .map(|gap| SgdkCompatibilityBridge {
            kind: gap.kind.clone(),
            subject: gap.subject.clone(),
            source: gap.source.clone(),
            preservation: bridge_preservation(&gap.kind).to_string(),
            lossless: !matches!(
                gap.kind.as_str(),
                "lossy_source_encoding" | "lossy_resource_encoding"
            ),
        })
        .collect::<Vec<_>>();
    compatibility_bridges.sort_by(|left, right| {
        (
            left.kind.as_str(),
            left.subject.as_str(),
            left.source
                .as_ref()
                .map(|source| source.file.as_str())
                .unwrap_or(""),
            left.source.as_ref().map(|source| source.line).unwrap_or(0),
        )
            .cmp(&(
                right.kind.as_str(),
                right.subject.as_str(),
                right
                    .source
                    .as_ref()
                    .map(|source| source.file.as_str())
                    .unwrap_or(""),
                right.source.as_ref().map(|source| source.line).unwrap_or(0),
            ))
    });

    SgdkCanonicalProjectModel {
        schema_version: "sgdk-canonical/v1".to_string(),
        project: SgdkCanonicalProject {
            name: project_name.to_string(),
            source_root: source_root.to_string(),
        },
        scenes: vec![SgdkCanonicalScene {
            id: "main".to_string(),
            entities,
            state_machines,
            timers,
            variables,
        }],
        hardware_budget: SgdkCanonicalHardwareBudget {
            target: "megadrive".to_string(),
            vram_bytes: md_profile::MD_VRAM_BYTES,
            dma_frame_bytes: md_profile::MD_DMA_VBLANK_BYTES,
            sprite_limit: md_profile::MD_SPRITES_PER_SCREEN,
            scanline_sprite_limit: md_profile::MD_SPRITES_PER_SCANLINE,
            capabilities: capabilities.into_iter().collect(),
        },
        source_mappings,
        compatibility_bridges,
    }
}

fn canonical_component(
    kind: &str,
    name: &str,
    source: Option<SourceLocation>,
) -> SgdkCanonicalComponent {
    SgdkCanonicalComponent {
        kind: kind.to_string(),
        name: name.to_string(),
        source,
    }
}

fn push_entity_if_has_components(
    entities: &mut Vec<SgdkCanonicalEntity>,
    entity: SgdkCanonicalEntity,
) {
    if !entity.components.is_empty() {
        entities.push(entity);
    }
}

fn canonical_id(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if normalized.is_empty() {
        "sgdk_entity".to_string()
    } else {
        normalized
    }
}

fn bridge_preservation(kind: &str) -> &'static str {
    match kind {
        "preprocessor_condition" => "branch_source_mapping",
        "function_like_macro" | "multiline_macro" => "macro_signature_and_body",
        "unsupported_resource_kind" => "resource_manifest_line",
        "assembly_source" | "inline_assembly" => "assembly_source_reference",
        "lossy_source_encoding" | "lossy_resource_encoding" => {
            "raw_source_path_with_lossy_text_view"
        }
        _ => "source_mapping",
    }
}

fn read_text_lossy_with_gap(
    path: &Path,
    relative_path: &str,
    gap_kind: &str,
    gaps: &mut Vec<SgdkSemanticGap>,
) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "Could not read SGDK text file '{}': {}",
            path.display(),
            error
        )
    })?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(error) => {
            gaps.push(make_semantic_gap(
                gap_kind,
                relative_path.to_string(),
                "File was decoded with UTF-8 replacement characters; source mapping remains approximate.",
                Some(SourceLocation {
                    file: relative_path.to_string(),
                    line: 1,
                }),
            ));
            Ok(String::from_utf8_lossy(error.as_bytes()).to_string())
        }
    }
}

fn is_supported_resource_kind(kind: &str) -> bool {
    matches!(
        kind,
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
    )
}

fn tokenize_sgdk_resource_line(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for character in line.chars() {
        match character {
            '"' => in_quotes = !in_quotes,
            '#' if !in_quotes => break,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(character),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn parse_resource_manifest(file: &str, content: &str) -> Vec<SgdkResourceInventory> {
    let mut resources = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let tokens = tokenize_sgdk_resource_line(trimmed);
        if tokens.len() < 3 {
            continue;
        }
        resources.push(SgdkResourceInventory {
            kind: tokens[0].to_ascii_uppercase(),
            name: tokens[1].clone(),
            asset_path: tokens[2].replace('\\', "/"),
            params: tokens[3..].to_vec(),
            asset_exists: false,
            source: SourceLocation {
                file: file.to_string(),
                line: index + 1,
            },
        });
    }
    resources
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StripMode {
    Normal,
    LineComment,
    BlockComment,
    String,
    Char,
}

fn strip_c_comments_and_strings_preserving_lines(content: &str) -> String {
    let mut output = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    let mut mode = StripMode::Normal;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        match mode {
            StripMode::Normal => match ch {
                '/' if chars.peek() == Some(&'/') => {
                    chars.next();
                    output.push(' ');
                    output.push(' ');
                    mode = StripMode::LineComment;
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    output.push(' ');
                    output.push(' ');
                    mode = StripMode::BlockComment;
                }
                '"' => {
                    output.push(' ');
                    mode = StripMode::String;
                    escaped = false;
                }
                '\'' => {
                    output.push(' ');
                    mode = StripMode::Char;
                    escaped = false;
                }
                _ => output.push(ch),
            },
            StripMode::LineComment => {
                if ch == '\n' {
                    output.push('\n');
                    mode = StripMode::Normal;
                } else {
                    output.push(' ');
                }
            }
            StripMode::BlockComment => {
                if ch == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    output.push(' ');
                    output.push(' ');
                    mode = StripMode::Normal;
                } else if ch == '\n' {
                    output.push('\n');
                } else {
                    output.push(' ');
                }
            }
            StripMode::String => {
                if ch == '\n' {
                    output.push('\n');
                    mode = StripMode::Normal;
                    escaped = false;
                } else {
                    output.push(' ');
                    if ch == '"' && !escaped {
                        mode = StripMode::Normal;
                    }
                    escaped = ch == '\\' && !escaped;
                    if ch != '\\' {
                        escaped = false;
                    }
                }
            }
            StripMode::Char => {
                if ch == '\n' {
                    output.push('\n');
                    mode = StripMode::Normal;
                    escaped = false;
                } else {
                    output.push(' ');
                    if ch == '\'' && !escaped {
                        mode = StripMode::Normal;
                    }
                    escaped = ch == '\\' && !escaped;
                    if ch != '\\' {
                        escaped = false;
                    }
                }
            }
        }
    }
    output
}

fn parse_code_file(
    file: &str,
    content: &str,
    code: &mut SgdkCodeInventory,
    gaps: &mut Vec<SgdkSemanticGap>,
) {
    let stripped = strip_c_comments_and_strings_preserving_lines(content);
    parse_preprocessor(file, &stripped, code, gaps);
    parse_symbols(file, &stripped, code, gaps);
    parse_calls_and_control_flow(file, &stripped, code, gaps);
}

fn parse_preprocessor(
    file: &str,
    stripped: &str,
    code: &mut SgdkCodeInventory,
    gaps: &mut Vec<SgdkSemanticGap>,
) {
    for (index, line) in stripped.lines().enumerate() {
        let trimmed = line.trim();
        let location = SourceLocation {
            file: file.to_string(),
            line: index + 1,
        };
        if let Some(rest) = trimmed.strip_prefix("#include") {
            let value = rest.trim().to_string();
            if !value.is_empty() {
                code.includes.push(SgdkNamedSourceItem {
                    name: value.clone(),
                    source: location,
                });
            }
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("#define") {
            let rest = rest.trim_start();
            let (name, function_like, value) = parse_define(rest);
            if name.is_empty() {
                continue;
            }
            let item = SgdkDefineInventory {
                name: name.clone(),
                function_like,
                value,
                source: location.clone(),
            };
            if function_like {
                code.macros.push(item.clone());
                gaps.push(make_semantic_gap(
                    "function_like_macro",
                    name,
                    "Function-like macro requires explicit no-code bridge or typed expansion.",
                    Some(location),
                ));
            } else {
                code.defines.push(item);
            }
            if trimmed.ends_with('\\') {
                gaps.push(make_semantic_gap(
                    "multiline_macro",
                    rest.to_string(),
                    "Multiline macro cannot be safely round-tripped by the C-lite inventory.",
                    Some(SourceLocation {
                        file: file.to_string(),
                        line: index + 1,
                    }),
                ));
            }
            continue;
        }
        if trimmed.starts_with("#if")
            || trimmed.starts_with("#ifdef")
            || trimmed.starts_with("#ifndef")
            || trimmed.starts_with("#elif")
        {
            gaps.push(make_semantic_gap(
                "preprocessor_condition",
                trimmed.to_string(),
                "Conditional compilation is indexed as a semantic gap until branch-specific AST is available.",
                Some(location),
            ));
        }
    }
}

fn parse_define(rest: &str) -> (String, bool, String) {
    let mut name = String::new();
    let mut chars = rest.chars().peekable();
    while let Some(ch) = chars.peek().copied() {
        if is_ident_char(ch) {
            name.push(ch);
            chars.next();
        } else {
            break;
        }
    }
    let function_like = chars.peek() == Some(&'(');
    let value = chars.collect::<String>().trim().to_string();
    (name, function_like, value)
}

fn parse_symbols(
    file: &str,
    stripped: &str,
    code: &mut SgdkCodeInventory,
    gaps: &mut Vec<SgdkSemanticGap>,
) {
    let mut brace_depth = 0i32;
    let mut active_function: Option<(String, usize, i32)> = None;
    for (index, line) in stripped.lines().enumerate() {
        let line_no = index + 1;
        let trimmed = line.trim();
        let depth_at_start = brace_depth;

        if depth_at_start == 0 && !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(name) = parse_struct_or_enum_name(trimmed, "struct") {
                code.structs.push(SgdkNamedSourceItem {
                    name,
                    source: SourceLocation {
                        file: file.to_string(),
                        line: line_no,
                    },
                });
            }
            if let Some(name) = parse_struct_or_enum_name(trimmed, "enum") {
                code.enums.push(SgdkNamedSourceItem {
                    name,
                    source: SourceLocation {
                        file: file.to_string(),
                        line: line_no,
                    },
                });
            }
            for state in extract_state_tokens(trimmed) {
                code.game_states.push(SgdkNamedSourceItem {
                    name: state,
                    source: SourceLocation {
                        file: file.to_string(),
                        line: line_no,
                    },
                });
            }
            if let Some(function) = parse_function_signature(trimmed, file, line_no) {
                if function.is_prototype {
                    code.functions.push(function);
                } else {
                    active_function = Some((function.name.clone(), function.source.line, 0));
                    code.functions.push(function);
                }
            } else if let Some(name) = parse_global_name(trimmed) {
                if trimmed.contains("(*") {
                    gaps.push(make_semantic_gap(
                        "function_pointer",
                        name.clone(),
                        "Function pointer declarations need an explicit callback/bridge node.",
                        Some(SourceLocation {
                            file: file.to_string(),
                            line: line_no,
                        }),
                    ));
                }
                let item = SgdkNamedSourceItem {
                    name: name.clone(),
                    source: SourceLocation {
                        file: file.to_string(),
                        line: line_no,
                    },
                };
                if trimmed.contains('[') && trimmed.contains(']') {
                    code.arrays.push(item.clone());
                }
                code.globals.push(item);
            }
        }

        let delta = brace_delta(trimmed);
        if let Some((_, _, ref mut local_depth)) = active_function {
            *local_depth += delta;
        }
        brace_depth += delta;
        if let Some((name, start_line, local_depth)) = active_function.clone() {
            if local_depth <= 0 && line_no > start_line {
                if let Some(function) = code.functions.iter_mut().rev().find(|candidate| {
                    candidate.name == name
                        && candidate.source.file == file
                        && candidate.source.line == start_line
                        && candidate.is_definition
                }) {
                    function.end_line = line_no;
                }
                active_function = None;
            }
        }
    }
}

fn parse_struct_or_enum_name(line: &str, keyword: &str) -> Option<String> {
    let mut tokens = tokenize_identifiers(line);
    if tokens.first().is_some_and(|token| token == "typedef") {
        tokens.remove(0);
    }
    if tokens.first().is_some_and(|token| token == keyword) {
        tokens.get(1).cloned()
    } else {
        None
    }
}

fn extract_state_tokens(line: &str) -> Vec<String> {
    tokenize_identifiers(line)
        .into_iter()
        .filter(|token| token.starts_with("STATE_") || token.ends_with("_STATE"))
        .collect()
}

fn parse_function_signature(
    line: &str,
    file: &str,
    line_no: usize,
) -> Option<SgdkFunctionInventory> {
    if !line.contains('(') || !line.contains(')') {
        return None;
    }
    if line.starts_with("if ")
        || line.starts_with("if(")
        || line.starts_with("while ")
        || line.starts_with("while(")
        || line.starts_with("for ")
        || line.starts_with("for(")
        || line.starts_with("switch ")
        || line.starts_with("switch(")
    {
        return None;
    }
    let paren = line.find('(')?;
    let before = line[..paren].trim_end();
    let name = trailing_identifier(before)?;
    if matches!(
        name.as_str(),
        "if" | "while" | "for" | "switch" | "return" | "sizeof"
    ) {
        return None;
    }
    let is_prototype = line.ends_with(';') && !line.contains('{');
    let is_definition = line.contains('{');
    if !is_prototype && !is_definition {
        return None;
    }
    Some(SgdkFunctionInventory {
        name,
        source: SourceLocation {
            file: file.to_string(),
            line: line_no,
        },
        end_line: line_no,
        is_definition,
        is_prototype,
    })
}

fn parse_global_name(line: &str) -> Option<String> {
    if !line.ends_with(';')
        || line.starts_with("typedef")
        || line.starts_with("struct ")
        || line.starts_with("enum ")
        || line.contains('(')
    {
        return None;
    }
    let left = line
        .split('=')
        .next()
        .unwrap_or(line)
        .trim_end_matches(';')
        .trim();
    let left = left.split('[').next().unwrap_or(left).trim();
    trailing_identifier(left)
}

fn parse_calls_and_control_flow(
    file: &str,
    stripped: &str,
    code: &mut SgdkCodeInventory,
    gaps: &mut Vec<SgdkSemanticGap>,
) {
    let definitions = code
        .functions
        .iter()
        .filter(|function| function.is_definition && function.source.file == file)
        .cloned()
        .collect::<Vec<_>>();
    let mut seen_calls = BTreeSet::new();
    for (index, line) in stripped.lines().enumerate() {
        let line_no = index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.contains("__asm") || trimmed.contains(" asm(") || trimmed.starts_with("asm(") {
            gaps.push(make_semantic_gap(
                "inline_assembly",
                file.to_string(),
                "Inline assembly cannot be represented as editable no-code nodes.",
                Some(SourceLocation {
                    file: file.to_string(),
                    line: line_no,
                }),
            ));
        }
        let caller = definitions
            .iter()
            .find(|function| line_no >= function.source.line && line_no <= function.end_line)
            .map(|function| function.name.clone());
        if trimmed.contains("while") && trimmed.contains("TRUE") {
            code.main_loops.push(SgdkNamedSourceItem {
                name: caller.clone().unwrap_or_else(|| "global_loop".to_string()),
                source: SourceLocation {
                    file: file.to_string(),
                    line: line_no,
                },
            });
        }
        for name in extract_call_identifiers(trimmed) {
            if should_skip_call_identifier(&name) {
                continue;
            }
            let key = format!("{file}:{line_no}:{name}");
            if !seen_calls.insert(key) {
                continue;
            }
            let call = SgdkCallInventory {
                family: classify_sgdk_call_family(&name).to_string(),
                name: name.clone(),
                caller: caller.clone(),
                source: SourceLocation {
                    file: file.to_string(),
                    line: line_no,
                },
            };
            if is_callback_registration(&name) {
                code.callbacks.push(call.clone());
            }
            code.calls.push(call);
        }
    }
    code.update_functions = code
        .functions
        .iter()
        .filter(|function| {
            function.is_definition && {
                let lower = function.name.to_ascii_lowercase();
                lower.contains("update")
                    || lower.contains("tick")
                    || lower.contains("process")
                    || lower.contains("frame")
            }
        })
        .cloned()
        .collect();
}

fn extract_call_identifiers(line: &str) -> Vec<String> {
    let chars = line.chars().collect::<Vec<_>>();
    let mut calls = Vec::new();
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        if !is_ident_start(ch) {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < chars.len() && is_ident_char(chars[index]) {
            index += 1;
        }
        let name = chars[start..index].iter().collect::<String>();
        let mut cursor = index;
        while cursor < chars.len() && chars[cursor].is_whitespace() {
            cursor += 1;
        }
        if cursor < chars.len() && chars[cursor] == '(' {
            calls.push(name);
        }
    }
    calls
}

fn should_skip_call_identifier(name: &str) -> bool {
    matches!(
        name,
        "if" | "while" | "for" | "switch" | "return" | "sizeof"
    )
}

fn classify_sgdk_call_family(name: &str) -> &'static str {
    if name.starts_with("JOY_") {
        "input"
    } else if name.starts_with("SPR_") {
        "sprite"
    } else if name.starts_with("DMA_") || name.contains("DMA") {
        "dma"
    } else if name.starts_with("VDP_") {
        "vdp"
    } else if name.starts_with("MAP_") {
        "tilemap"
    } else if name.starts_with("XGM") || name.starts_with("SND_") || name.starts_with("PSG_") {
        "audio"
    } else if name.starts_with("SYS_") {
        "system"
    } else {
        "project"
    }
}

fn is_callback_registration(name: &str) -> bool {
    name.contains("setEventHandler")
        || name.contains("setVIntCallback")
        || name.contains("setHIntCallback")
        || name.contains("setCallback")
}

fn push_node_candidate(
    candidates: &mut Vec<SgdkNodeCandidate>,
    seen: &mut BTreeSet<String>,
    node_type: &str,
    label: impl Into<String>,
    system: &str,
    source: Option<SourceLocation>,
    blocked_by_gap: Option<String>,
) {
    let source_key = source
        .as_ref()
        .map(|location| format!("{}:{}", location.file, location.line))
        .unwrap_or_else(|| "global".to_string());
    let blocked_key = blocked_by_gap.as_deref().unwrap_or("");
    let key = format!("{node_type}:{system}:{source_key}:{blocked_key}");
    if !seen.insert(key) {
        return;
    }
    candidates.push(SgdkNodeCandidate {
        node_type: node_type.to_string(),
        label: label.into(),
        system: system.to_string(),
        source,
        blocked_by_gap,
    });
}

fn derive_sgdk_node_candidates(
    resources: &[SgdkResourceInventory],
    code: &SgdkCodeInventory,
    gaps: &[SgdkSemanticGap],
) -> Vec<SgdkNodeCandidate> {
    let mut candidates = Vec::new();
    let mut seen = BTreeSet::new();

    if code
        .functions
        .iter()
        .any(|function| function.name == "main" && function.is_definition)
    {
        push_node_candidate(
            &mut candidates,
            &mut seen,
            "event_start",
            "main entrypoint",
            "event",
            code.functions
                .iter()
                .find(|function| function.name == "main")
                .map(|function| function.source.clone()),
            None,
        );
    }

    for item in &code.main_loops {
        push_node_candidate(
            &mut candidates,
            &mut seen,
            "event_update",
            format!("update loop: {}", item.name),
            "event",
            Some(item.source.clone()),
            None,
        );
    }

    for function in &code.update_functions {
        push_node_candidate(
            &mut candidates,
            &mut seen,
            "event_update",
            format!("update function: {}", function.name),
            "event",
            Some(function.source.clone()),
            None,
        );
    }

    for resource in resources {
        match resource.kind.as_str() {
            "SPRITE" => {
                push_node_candidate(
                    &mut candidates,
                    &mut seen,
                    "spawn_entity",
                    format!("sprite resource: {}", resource.name),
                    "sprite",
                    Some(resource.source.clone()),
                    None,
                );
                push_node_candidate(
                    &mut candidates,
                    &mut seen,
                    "sprite_anim",
                    format!("sprite animation resource: {}", resource.name),
                    "sprite",
                    Some(resource.source.clone()),
                    None,
                );
            }
            "TILEMAP" | "MAP" | "IMAGE" | "TILESET" | "BITMAP" => {
                push_node_candidate(
                    &mut candidates,
                    &mut seen,
                    "scroll_tilemap",
                    format!("tilemap resource: {}", resource.name),
                    "tilemap",
                    Some(resource.source.clone()),
                    None,
                );
            }
            "WAV" | "XGM" | "XGM2" | "PCM" => {
                push_node_candidate(
                    &mut candidates,
                    &mut seen,
                    "action_sound",
                    format!("audio resource: {}", resource.name),
                    "audio",
                    Some(resource.source.clone()),
                    None,
                );
            }
            _ => {
                push_node_candidate(
                    &mut candidates,
                    &mut seen,
                    "bridge_unconverted_source",
                    format!("resource bridge: {}", resource.name),
                    "bridge",
                    Some(resource.source.clone()),
                    Some("unsupported_resource_kind".to_string()),
                );
            }
        }
    }

    for call in &code.calls {
        match call.family.as_str() {
            "input" => push_node_candidate(
                &mut candidates,
                &mut seen,
                "input_held",
                format!("input call: {}", call.name),
                "input",
                Some(call.source.clone()),
                None,
            ),
            "sprite" => {
                let node_type = if call.name.contains("Anim") || call.name.contains("Frame") {
                    "sprite_anim"
                } else {
                    "sprite_move"
                };
                push_node_candidate(
                    &mut candidates,
                    &mut seen,
                    node_type,
                    format!("sprite call: {}", call.name),
                    "sprite",
                    Some(call.source.clone()),
                    None,
                );
            }
            "tilemap" => push_node_candidate(
                &mut candidates,
                &mut seen,
                "scroll_tilemap",
                format!("tilemap call: {}", call.name),
                "tilemap",
                Some(call.source.clone()),
                None,
            ),
            "audio" => push_node_candidate(
                &mut candidates,
                &mut seen,
                "action_sound",
                format!("audio call: {}", call.name),
                "audio",
                Some(call.source.clone()),
                None,
            ),
            "dma" | "vdp" => push_node_candidate(
                &mut candidates,
                &mut seen,
                "hardware_budget_check",
                format!("hardware call: {}", call.name),
                "hardware",
                Some(call.source.clone()),
                None,
            ),
            _ => {}
        }
    }

    if !resources.is_empty() || code.calls.iter().any(|call| call.family != "project") {
        push_node_candidate(
            &mut candidates,
            &mut seen,
            "hardware_budget_check",
            "project hardware budget",
            "hardware",
            None,
            None,
        );
    }

    for gap in gaps
        .iter()
        .filter(|gap| gap.blocks_nocode || gap.blocks_round_trip)
    {
        push_node_candidate(
            &mut candidates,
            &mut seen,
            "bridge_unconverted_source",
            format!("bridge: {}", gap.subject),
            "bridge",
            gap.source.clone(),
            Some(gap.kind.clone()),
        );
    }

    candidates
}

fn brace_delta(line: &str) -> i32 {
    line.chars().fold(0i32, |acc, ch| match ch {
        '{' => acc + 1,
        '}' => acc - 1,
        _ => acc,
    })
}

fn tokenize_identifiers(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in line.chars() {
        if current.is_empty() {
            if is_ident_start(ch) {
                current.push(ch);
            }
        } else if is_ident_char(ch) {
            current.push(ch);
        } else {
            tokens.push(current.clone());
            current.clear();
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn trailing_identifier(value: &str) -> Option<String> {
    tokenize_identifiers(value).pop()
}

fn is_ident_start(ch: char) -> bool {
    ch == '_' || ch.is_ascii_alphabetic()
}

fn is_ident_char(ch: char) -> bool {
    ch == '_' || ch.is_ascii_alphanumeric()
}

fn sort_project_inventory(
    source_files: &mut Vec<String>,
    header_files: &mut Vec<String>,
    resource_manifests: &mut Vec<String>,
    assets: &mut [SgdkAssetInventory],
    resources: &mut [SgdkResourceInventory],
    code: &mut SgdkCodeInventory,
    gaps: &mut [SgdkSemanticGap],
) {
    source_files.sort();
    source_files.dedup();
    header_files.sort();
    header_files.dedup();
    resource_manifests.sort();
    resource_manifests.dedup();
    assets.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    resources.sort_by(|a, b| {
        (
            a.source.file.as_str(),
            a.source.line,
            a.kind.as_str(),
            a.name.as_str(),
        )
            .cmp(&(
                b.source.file.as_str(),
                b.source.line,
                b.kind.as_str(),
                b.name.as_str(),
            ))
    });
    code.includes.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.defines.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.macros.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.structs.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.enums.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.globals.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.arrays.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.functions.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.calls.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.callbacks.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.main_loops.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.update_functions.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.game_states.sort_by(|a, b| {
        (a.source.file.as_str(), a.source.line, a.name.as_str()).cmp(&(
            b.source.file.as_str(),
            b.source.line,
            b.name.as_str(),
        ))
    });
    code.game_states
        .dedup_by(|a, b| a.name == b.name && a.source == b.source);
    gaps.sort_by(|a, b| {
        (
            a.kind.as_str(),
            a.subject.as_str(),
            a.source.as_ref().map(|s| s.file.as_str()).unwrap_or(""),
            a.source.as_ref().map(|s| s.line).unwrap_or(0),
        )
            .cmp(&(
                b.kind.as_str(),
                b.subject.as_str(),
                b.source.as_ref().map(|s| s.file.as_str()).unwrap_or(""),
                b.source.as_ref().map(|s| s.line).unwrap_or(0),
            ))
    });
}

fn sort_node_candidates(node_candidates: &mut [SgdkNodeCandidate]) {
    node_candidates.sort_by(|a, b| {
        (
            a.system.as_str(),
            a.node_type.as_str(),
            a.source.as_ref().map(|s| s.file.as_str()).unwrap_or(""),
            a.source.as_ref().map(|s| s.line).unwrap_or(0),
            a.label.as_str(),
        )
            .cmp(&(
                b.system.as_str(),
                b.node_type.as_str(),
                b.source.as_ref().map(|s| s.file.as_str()).unwrap_or(""),
                b.source.as_ref().map(|s| s.line).unwrap_or(0),
                b.label.as_str(),
            ))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_inventory_dir(label: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("retro-dev-studio-sgdk-inventory-{label}-{suffix}"));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write fixture");
    }

    #[test]
    fn sgdk_inventory_extracts_structural_code_resources_and_gaps() {
        let root = temp_inventory_dir("structural");
        write_file(
            &root.join("res/resources.res"),
            r#"
SPRITE hero "sprites/hero.png" 4 4 FAST 0
IMAGE level_bg "tiles/level.png" BEST
WAV jump_sfx "audio/jump.wav" PCM
UNKNOWN odd "odd.bin"
"#,
        );
        write_file(&root.join("res/sprites/hero.png"), "fake png");
        write_file(&root.join("res/tiles/level.png"), "fake png");
        write_file(&root.join("res/audio/jump.wav"), "fake wav");
        write_file(
            &root.join("inc/game.h"),
            r#"
#ifndef GAME_H
#define GAME_H
typedef enum GameState { STATE_TITLE, STATE_PLAY } GameState;
typedef struct Player {
    s16 x;
    s16 y;
} Player;
void player_update(void);
#endif
"#,
        );
        write_file(
            &root.join("src/main.c"),
            r#"
#include <genesis.h>
#include "game.h"
#define PLAYER_SPEED 2
#define TILE_ATTR_FULL(pal, prio, flipV, flipH, index) ((pal) | (index))

static Player player;
static u16 collision_map[4] = { 0, 1, 1, 0 };
static void joy_callback(u16 joy, u16 changed, u16 state) {
    if (state & BUTTON_A) XGM_startPlayPCM(jump_sfx, 1, SOUND_PCM_CH2);
}

void player_update(void) {
    u16 value = JOY_readJoypad(JOY_1);
    if (value & BUTTON_RIGHT) player.x += PLAYER_SPEED;
    SPR_setPosition(NULL, player.x, player.y);
    VDP_waitVSync();
}

int main(void) {
    JOY_setEventHandler(joy_callback);
    SPR_init();
    while (TRUE) {
        player_update();
        SPR_update();
    }
}
"#,
        );
        write_file(
            &root.join("src/vdp_dma.c"),
            r#"
#include <genesis.h>
void stream_tiles(void) {
    VDP_doVRamDMA((u32)0, 0x0000, 32);
}
"#,
        );

        let inventory = inspect_sgdk_project_for_nocode_inventory(&root).expect("inventory");

        assert_eq!(inventory.source_files.len(), 2);
        assert_eq!(inventory.header_files.len(), 1);
        assert_eq!(inventory.resource_manifests.len(), 1);
        assert_eq!(inventory.resources.len(), 4);
        assert!(inventory.resources.iter().any(|resource| {
            resource.kind == "SPRITE"
                && resource.name == "hero"
                && resource.asset_path == "sprites/hero.png"
                && resource.source.file == "res/resources.res"
                && resource.source.line == 2
        }));
        assert!(inventory.assets.iter().any(|asset| {
            asset.relative_path == "res/sprites/hero.png" && asset.kind == "image"
        }));
        assert!(inventory.code.includes.iter().any(|include| {
            include.name == "<genesis.h>" && include.source.file == "src/main.c"
        }));
        assert!(inventory
            .code
            .defines
            .iter()
            .any(|define| define.name == "PLAYER_SPEED" && !define.function_like));
        assert!(inventory
            .code
            .macros
            .iter()
            .any(|macro_def| macro_def.name == "TILE_ATTR_FULL" && macro_def.function_like));
        assert!(inventory
            .code
            .structs
            .iter()
            .any(|item| item.name == "Player"));
        assert!(inventory
            .code
            .enums
            .iter()
            .any(|item| item.name == "GameState"));
        assert!(inventory
            .code
            .globals
            .iter()
            .any(|global| global.name == "player"));
        assert!(inventory
            .code
            .arrays
            .iter()
            .any(|array| array.name == "collision_map"));
        assert!(inventory
            .code
            .functions
            .iter()
            .any(|function| function.name == "player_update" && function.is_definition));
        assert!(inventory
            .code
            .functions
            .iter()
            .any(|function| function.name == "player_update" && function.is_prototype));
        assert!(inventory
            .code
            .calls
            .iter()
            .any(|call| call.name == "JOY_readJoypad" && call.family == "input"));
        assert!(inventory
            .code
            .calls
            .iter()
            .any(|call| call.name == "SPR_update" && call.family == "sprite"));
        assert!(inventory
            .code
            .calls
            .iter()
            .any(|call| call.name == "VDP_doVRamDMA" && call.family == "dma"));
        assert_eq!(inventory.code.main_loops.len(), 1);
        assert!(inventory
            .code
            .update_functions
            .iter()
            .any(|function| function.name == "player_update"));
        assert!(inventory
            .code
            .callbacks
            .iter()
            .any(|callback| callback.name == "JOY_setEventHandler"));
        assert!(inventory
            .semantic_gaps
            .iter()
            .any(|gap| gap.kind == "unsupported_resource_kind" && gap.subject == "UNKNOWN"));
        assert!(inventory
            .semantic_gaps
            .iter()
            .any(|gap| gap.kind == "function_like_macro"));
    }

    #[test]
    fn sgdk_inventory_emits_actionable_gaps_and_node_candidates() {
        let root = temp_inventory_dir("actionable");
        write_file(
            &root.join("res/resources.res"),
            r#"
SPRITE hero "sprites/hero.png" 4 4 FAST 0
TILEMAP level_map "maps/level.bin" level_tiles BEST
"#,
        );
        write_file(&root.join("res/sprites/hero.png"), "fake png");
        write_file(&root.join("res/maps/level.bin"), "fake map");
        write_file(
            &root.join("src/main.c"),
            r#"
#include <genesis.h>
#define MOVE_BY(dx, dy) SPR_setPosition(player, dx, dy)
#ifdef ENABLE_DEMO
void update_player(void) {
    u16 joy = JOY_readJoypad(JOY_1);
    if (joy & BUTTON_RIGHT) SPR_setPosition(player, 16, 0);
    MAP_scrollTo(level_map, 1, 0);
    XGM_startPlayPCM(jump_sfx, 1, SOUND_PCM_CH2);
}
#endif
"#,
        );

        let inventory = inspect_sgdk_project_for_nocode_inventory(&root).expect("inventory");

        let macro_gap = inventory
            .semantic_gaps
            .iter()
            .find(|gap| gap.kind == "function_like_macro")
            .expect("function-like macro gap");
        assert_eq!(macro_gap.severity, "warning");
        assert!(!macro_gap.blocks_nocode);
        assert!(!macro_gap.blocks_round_trip);
        assert!(!macro_gap.blocks_build);
        assert!(macro_gap.suggestion.contains("Bridge"));

        let preprocessor_gap = inventory
            .semantic_gaps
            .iter()
            .find(|gap| gap.kind == "preprocessor_condition")
            .expect("preprocessor gap");
        assert!(!preprocessor_gap.blocks_nocode);
        assert!(!preprocessor_gap.blocks_round_trip);
        assert!(preprocessor_gap.impact.contains("branch"));

        let model = &inventory.canonical_model;
        assert_eq!(model.schema_version, "sgdk-canonical/v1");
        assert_eq!(model.project.name, inventory.project_name);
        assert!(model
            .scenes
            .iter()
            .flat_map(|scene| scene.entities.iter())
            .flat_map(|entity| entity.components.iter())
            .any(|component| component.kind == "Sprite"));
        assert!(model
            .scenes
            .iter()
            .flat_map(|scene| scene.entities.iter())
            .flat_map(|entity| entity.components.iter())
            .any(|component| component.kind == "Tilemap"));
        assert!(model
            .scenes
            .iter()
            .flat_map(|scene| scene.entities.iter())
            .flat_map(|entity| entity.components.iter())
            .any(|component| component.kind == "Audio"));
        assert!(model
            .scenes
            .iter()
            .flat_map(|scene| scene.entities.iter())
            .flat_map(|entity| entity.components.iter())
            .any(|component| component.kind == "Input"));
        assert!(model
            .hardware_budget
            .capabilities
            .iter()
            .any(|capability| capability == "VDP"));
        assert!(model
            .source_mappings
            .iter()
            .any(|mapping| mapping.source.file == "src/main.c" && mapping.impact == "Input"));
        assert!(model
            .compatibility_bridges
            .iter()
            .any(|bridge| { bridge.kind == "function_like_macro" && bridge.subject == "MOVE_BY" }));
        assert!(model
            .compatibility_bridges
            .iter()
            .any(|bridge| { bridge.kind == "preprocessor_condition" && bridge.lossless }));

        assert!(inventory
            .node_candidates
            .iter()
            .any(|node| { node.node_type == "input_held" && node.system == "input" }));
        assert!(inventory
            .node_candidates
            .iter()
            .any(|node| { node.node_type == "sprite_move" && node.system == "sprite" }));
        assert!(inventory
            .node_candidates
            .iter()
            .any(|node| { node.node_type == "scroll_tilemap" && node.system == "tilemap" }));
        assert!(inventory.node_candidates.iter().any(|node| {
            node.node_type == "hardware_budget_check" && node.system == "hardware"
        }));
    }

    #[test]
    fn sgdk_corpus_inventory_report_is_deterministic_and_totals_projects() {
        let corpus = temp_inventory_dir("corpus");
        let alpha = corpus.join("Alpha Demo");
        let beta = corpus.join("Beta Demo");
        fs::create_dir_all(&alpha).expect("alpha");
        fs::create_dir_all(&beta).expect("beta");
        write_file(&beta.join("src/main.c"), "int main(void) { return 0; }\n");
        write_file(
            &alpha.join("res/resources.res"),
            "IMAGE bg \"bg.png\" BEST\n",
        );
        write_file(&alpha.join("res/bg.png"), "fake png");

        let report_path = corpus.join("inventory-report.json");
        let report =
            write_sgdk_corpus_inventory_report(&corpus, &report_path).expect("corpus report");
        let first_json = serde_json::to_string_pretty(&report).expect("serialize first");
        let second_json = serde_json::to_string_pretty(
            &inspect_sgdk_corpus_for_nocode_inventory(&corpus).expect("corpus report second"),
        )
        .expect("serialize second");

        assert_eq!(report.total_projects, 2);
        assert_eq!(report.projects[0].project_name, "Alpha Demo");
        assert_eq!(report.projects[1].project_name, "Beta Demo");
        assert_eq!(report.project_details.len(), 2);
        assert_eq!(report.project_details[0].project_name, "Alpha Demo");
        assert!(report.project_details[0]
            .resources
            .iter()
            .any(|resource| resource.name == "bg"));
        assert!(report_path.is_file());
        assert_eq!(first_json, second_json);
    }

    #[test]
    fn sgdk_inventory_keeps_lossy_encoded_source_as_gap_instead_of_aborting() {
        let root = temp_inventory_dir("lossy");
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::write(
            root.join("src/main.c"),
            b"#include <genesis.h>\nconst char label[] = \"ol\xe1\";\nint main(void) { return 0; }\n",
        )
        .expect("write latin1-ish source");

        let inventory = inspect_sgdk_project_for_nocode_inventory(&root).expect("inventory");

        assert_eq!(inventory.source_files, vec!["src/main.c".to_string()]);
        assert!(inventory
            .code
            .functions
            .iter()
            .any(|function| function.name == "main"));
        assert!(inventory
            .semantic_gaps
            .iter()
            .any(|gap| { gap.kind == "lossy_source_encoding" && gap.subject == "src/main.c" }));
    }

    #[test]
    #[ignore = "requires local SGDK_Engines corpus outside the repository"]
    fn sgdk_corpus_inventory_real_corpus_report() {
        let corpus_root = std::env::var("RDS_SGDK_CORPUS_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(r"F:\Projects\MegaDrive_DEV\SGDK_Engines"));
        assert!(
            corpus_root.is_dir(),
            "SGDK corpus root missing: {}",
            corpus_root.display()
        );

        let report_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target-test")
            .join("validation")
            .join("sgdk-corpus-inventory.json");
        let report = write_sgdk_corpus_inventory_report(&corpus_root, &report_path)
            .expect("write real corpus inventory");

        println!(
            "SGDK_CORPUS_INVENTORY total_projects={} report={}",
            report.total_projects,
            report_path.display()
        );
        for (kind, count) in &report.gap_totals {
            println!("SGDK_CORPUS_GAP kind={} count={}", kind, count);
        }
        assert!(
            report.total_projects > 0,
            "real corpus inventory must include at least one project"
        );
    }
}
