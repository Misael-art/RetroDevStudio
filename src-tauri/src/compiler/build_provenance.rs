use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::core::rom_mastering::sha256_hex;
use crate::ugdm::entities::Scene;

pub const SOURCE_MAP_SCHEMA_VERSION: u32 = 1;
pub const SOURCE_MAP_FILE_NAME: &str = "rds-node-source-map.v1.json";
pub const BUILD_PROVENANCE_EVIDENCE_LABEL: &str = "Proveniência de build observada";

const MARKER_BEGIN: &str = "// RDS-BUILD-PROVENANCE-BEGIN";
const MARKER_END: &str = "// RDS-BUILD-PROVENANCE-END";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BuildSourceMap {
    pub schema_version: u32,
    pub kind: String,
    pub evidence_label: String,
    pub target: String,
    pub generated_file: String,
    pub generated_source_sha256: String,
    pub artifact: BuildArtifactProvenance,
    pub limitations: Vec<String>,
    pub graphs: Vec<GraphBuildProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BuildArtifactProvenance {
    pub path: Option<String>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphBuildProvenance {
    pub graph_version: u32,
    pub graph_sha256: String,
    pub entries: Vec<NodeBuildProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeBuildProvenance {
    pub node_id: String,
    pub semantic_stage: String,
    pub status: BuildMappingStatus,
    pub generated_locations: Vec<GeneratedSourceLocation>,
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuildMappingStatus {
    Mapped,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeneratedSourceLocation {
    pub file: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Debug, Deserialize)]
struct StoredGraphEnvelope {
    #[serde(default = "default_graph_version")]
    version: u32,
    #[serde(default)]
    nodes: Vec<StoredGraphNode>,
}

#[derive(Debug, Deserialize)]
struct StoredGraphNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
}

#[derive(Debug)]
struct ActiveMarker {
    graph_sha256: String,
    node_id: String,
    semantic_stage: String,
    marker_line: usize,
}

fn default_graph_version() -> u32 {
    1
}

pub fn graph_revision_hash(serialized_graph: &str) -> String {
    sha256_hex(serialized_graph.as_bytes())
}

pub fn begin_marker(graph_sha256: &str, node_id: &str, semantic_stage: &str) -> String {
    format!(
        "{MARKER_BEGIN} {graph_sha256} {} {}",
        hex_encode(node_id.as_bytes()),
        hex_encode(semantic_stage.as_bytes())
    )
}

pub fn end_marker(graph_sha256: &str, node_id: &str) -> String {
    format!(
        "{MARKER_END} {graph_sha256} {}",
        hex_encode(node_id.as_bytes())
    )
}

pub fn build_source_map(scene: &Scene, target: &str, main_c: &str) -> BuildSourceMap {
    let locations = collect_generated_locations(main_c);
    let mut graphs = BTreeMap::<String, GraphBuildProvenance>::new();

    for entity in &scene.entities {
        let Some(serialized_graph) = entity
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_deref())
        else {
            continue;
        };
        let Ok(mut graph) = serde_json::from_str::<StoredGraphEnvelope>(serialized_graph) else {
            continue;
        };

        let graph_sha256 = graph_revision_hash(serialized_graph);
        graph.nodes.sort_by(|left, right| left.id.cmp(&right.id));
        let entry = graphs
            .entry(graph_sha256.clone())
            .or_insert_with(|| GraphBuildProvenance {
                graph_version: graph.version,
                graph_sha256: graph_sha256.clone(),
                entries: Vec::new(),
            });

        for node in graph.nodes {
            if entry
                .entries
                .iter()
                .any(|candidate| candidate.node_id == node.id)
            {
                continue;
            }
            let key = (graph_sha256.clone(), node.id.clone());
            let generated_locations = locations.get(&key).cloned().unwrap_or_default();
            let mapped = !generated_locations.is_empty();
            entry.entries.push(NodeBuildProvenance {
                node_id: node.id,
                semantic_stage: node.node_type,
                status: if mapped {
                    BuildMappingStatus::Mapped
                } else {
                    BuildMappingStatus::Unsupported
                },
                generated_locations,
                unsupported_reason: (!mapped).then(|| {
                    "Nenhum trecho C autônomo foi emitido para este nó nesta revisão; ele pode ser uma âncora de fluxo, expressão incorporada, setup agregado ou tipo ainda não mapeável.".to_string()
                }),
            });
        }
        entry
            .entries
            .sort_by(|left, right| left.node_id.cmp(&right.node_id));
    }

    BuildSourceMap {
        schema_version: SOURCE_MAP_SCHEMA_VERSION,
        kind: "node_build_source_map".to_string(),
        evidence_label: BUILD_PROVENANCE_EVIDENCE_LABEL.to_string(),
        target: target.to_string(),
        generated_file: "src/main.c".to_string(),
        generated_source_sha256: sha256_hex(main_c.as_bytes()),
        artifact: BuildArtifactProvenance {
            path: None,
            sha256: None,
        },
        limitations: vec![
            "Este mapa registra proveniência do build; não observa execução, PC, registradores ou estado do emulador.".to_string(),
            "Nós sem intervalo C verificável permanecem unsupported com motivo explícito.".to_string(),
        ],
        graphs: graphs.into_values().collect(),
    }
}

pub fn attach_rom_artifact(source_map: &mut BuildSourceMap, rom_path: &Path) -> Result<(), String> {
    let bytes = std::fs::read(rom_path).map_err(|error| {
        format!(
            "Falha ao ler ROM para proveniência de build '{}': {}",
            rom_path.display(),
            error
        )
    })?;
    source_map.artifact = BuildArtifactProvenance {
        path: Some(rom_path.to_string_lossy().to_string()),
        sha256: Some(sha256_hex(&bytes)),
    };
    Ok(())
}

pub fn serialize_source_map(source_map: &BuildSourceMap) -> Result<String, String> {
    serde_json::to_string_pretty(source_map)
        .map(|json| format!("{json}\n"))
        .map_err(|error| format!("Falha ao serializar source map de build: {error}"))
}

fn collect_generated_locations(
    main_c: &str,
) -> BTreeMap<(String, String), Vec<GeneratedSourceLocation>> {
    let lines = main_c.lines().collect::<Vec<_>>();
    let mut active = Vec::<ActiveMarker>::new();
    let mut locations = BTreeMap::<(String, String), Vec<GeneratedSourceLocation>>::new();

    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim();
        if let Some(payload) = trimmed.strip_prefix(MARKER_BEGIN) {
            let fields = payload.split_whitespace().collect::<Vec<_>>();
            if fields.len() == 3 {
                if let (Some(node_id), Some(semantic_stage)) =
                    (hex_decode(fields[1]), hex_decode(fields[2]))
                {
                    active.push(ActiveMarker {
                        graph_sha256: fields[0].to_string(),
                        node_id,
                        semantic_stage,
                        marker_line: line_number,
                    });
                }
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix(MARKER_END) {
            let fields = payload.split_whitespace().collect::<Vec<_>>();
            if fields.len() != 2 {
                continue;
            }
            let Some(node_id) = hex_decode(fields[1]) else {
                continue;
            };
            let Some(position) = active
                .iter()
                .rposition(|marker| marker.graph_sha256 == fields[0] && marker.node_id == node_id)
            else {
                continue;
            };
            let marker = active.remove(position);
            let start_line = marker.marker_line + 1;
            let end_line = line_number.saturating_sub(1);
            if start_line <= end_line {
                let end_column = lines
                    .get(end_line.saturating_sub(1))
                    .map(|line| line.chars().count() + 1)
                    .unwrap_or(1);
                locations
                    .entry((marker.graph_sha256, marker.node_id))
                    .or_default()
                    .push(GeneratedSourceLocation {
                        file: "src/main.c".to_string(),
                        start_line,
                        start_column: 1,
                        end_line,
                        end_column,
                    });
            }
            let _ = marker.semantic_stage;
        }
    }

    locations
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode(value: &str) -> Option<String> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    let mut bytes = Vec::with_capacity(value.len() / 2);
    for pair in value.as_bytes().chunks_exact(2) {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        bytes.push((high << 4) | low);
    }
    String::from_utf8(bytes).ok()
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::components::{Components, LogicComponent};
    use crate::ugdm::entities::{Entity, Transform};

    fn scene_with_graph(graph: &str) -> Scene {
        Scene {
            scene_id: "source-map".to_string(),
            schema_version: None,
            display_name: None,
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "player".to_string(),
                display_name: None,
                prefab: None,
                transform: Transform::default(),
                components: Components {
                    logic: Some(LogicComponent {
                        graph: Some(graph.to_string()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
            collision_map: None,
            layers: None,
        }
    }

    #[test]
    fn source_map_serialization_is_deterministic_and_maps_real_lines() {
        let graph = r#"{"version":1,"nodes":[{"id":"move-1","type":"sprite_move"},{"id":"event-1","type":"event_update"}],"edges":[]}"#;
        let hash = graph_revision_hash(graph);
        let main_c = format!(
            "void tick(void) {{\n    {}\n    player_x += 1;\n    {}\n}}\n",
            begin_marker(&hash, "move-1", "sprite_move"),
            end_marker(&hash, "move-1")
        );
        let scene = scene_with_graph(graph);
        let first = build_source_map(&scene, "megadrive", &main_c);
        let second = build_source_map(&scene, "megadrive", &main_c);

        assert_eq!(
            serialize_source_map(&first).unwrap(),
            serialize_source_map(&second).unwrap()
        );
        let entries = &first.graphs[0].entries;
        let mapped = entries
            .iter()
            .find(|entry| entry.node_id == "move-1")
            .unwrap();
        assert_eq!(mapped.status, BuildMappingStatus::Mapped);
        assert_eq!(mapped.generated_locations[0].start_line, 3);
        assert_eq!(main_c.lines().nth(2), Some("    player_x += 1;"));
        let unsupported = entries
            .iter()
            .find(|entry| entry.node_id == "event-1")
            .unwrap();
        assert_eq!(unsupported.status, BuildMappingStatus::Unsupported);
        assert!(unsupported
            .unsupported_reason
            .as_deref()
            .unwrap()
            .contains("Nenhum trecho C"));
    }

    #[test]
    fn graph_revision_hash_rejects_any_serialized_revision_change() {
        let first = graph_revision_hash(r#"{"version":1,"nodes":[],"edges":[]}"#);
        let second = graph_revision_hash(r#"{"version":1,"nodes":[1],"edges":[]}"#);
        assert_ne!(first, second);
        assert_eq!(first.len(), 64);
    }
}
