//! Contrato de suporte de nos logicos por plataforma (Experimental).
//!
//! Antes de gerar qualquer codigo, o build recusa grafos com nos que o emissor da
//! plataforma nao sabe traduzir, com diagnostico estruturado (plataforma, entidade, no).
//! Vale para grafos editados no app, importados ou alterados fora dele.

use crate::core::diagnostics::{ActionableDiagnostic, DiagnosticArea};
use crate::ugdm::entities::Scene;

/// Nos sem traducao por plataforma. `condition_on_ground` depende do estado de apoio
/// da fisica do emissor Mega Drive, que o emissor SNES nao tem.
const UNSUPPORTED: &[(&str, &str, &str)] = &[(
    "snes",
    "condition_on_ground",
    "o estado de apoio no chao so existe na fisica do Mega Drive",
)];

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LogicSupportIssue {
    pub platform: String,
    pub entity_id: String,
    pub node_id: String,
    pub node_type: String,
    pub reason: String,
}

#[derive(serde::Deserialize)]
struct GraphNodes {
    #[serde(default)]
    nodes: Vec<GraphNode>,
}

#[derive(serde::Deserialize)]
struct GraphNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
}

/// Varre os grafos de logica ja resolvidos (prefab e graph_ref aplicados).
pub fn logic_support_issues(target: &str, resolved_scene: &Scene) -> Vec<LogicSupportIssue> {
    let mut issues = Vec::new();
    for entity in &resolved_scene.entities {
        let Some(graph) = entity
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_deref())
        else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<GraphNodes>(graph) else {
            continue;
        };
        for node in parsed.nodes {
            if let Some((platform, node_type, reason)) =
                UNSUPPORTED.iter().find(|(platform, node_type, _)| {
                    *platform == target && *node_type == node.node_type
                })
            {
                issues.push(LogicSupportIssue {
                    platform: platform.to_string(),
                    entity_id: entity.entity_id.clone(),
                    node_id: node.id,
                    node_type: node_type.to_string(),
                    reason: reason.to_string(),
                });
            }
        }
    }
    issues
}

pub fn issue_diagnostic(issue: &LogicSupportIssue) -> ActionableDiagnostic {
    let area = if issue.platform == "snes" {
        DiagnosticArea::BuildSnes
    } else {
        DiagnosticArea::BuildSgdk
    };
    ActionableDiagnostic::blocking_error(
        area,
        format!(
            "A entidade '{}' usa o no '{}' ({}), que nao e suportado em {}: {}.",
            issue.entity_id, issue.node_id, issue.node_type, issue.platform, issue.reason
        ),
        format!(
            "platform={} entity={} node={} type={}",
            issue.platform, issue.entity_id, issue.node_id, issue.node_type
        ),
        "Remova o no (ou o comportamento que o gerou) dessa entidade, ou compile para Mega Drive.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::components::{Components, LogicComponent};
    use crate::ugdm::entities::{Entity, Transform};
    use std::collections::HashMap;

    fn scene_with(graph: &str) -> Scene {
        Scene {
            scene_id: "main".to_string(),
            schema_version: None,
            display_name: None,
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "fox".to_string(),
                display_name: None,
                prefab: None,
                transform: Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(LogicComponent {
                        graph: Some(graph.to_string()),
                        graph_ref: None,
                        graph_origin: None,
                        logic_hints: Vec::new(),
                        external_source_refs: Vec::new(),
                        imported_semantics: None,
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
            collision_map: None,
            layers: None,
        }
    }

    #[test]
    fn snes_refuses_condition_on_ground_but_megadrive_and_other_graphs_pass() {
        let with_node = scene_with(
            r#"{"nodes":[{"id":"g","type":"condition_on_ground","params":{"target":"fox"}}],"edges":[]}"#,
        );
        let without = scene_with(
            r#"{"nodes":[{"id":"m","type":"sprite_move","params":{"target":"fox"}}],"edges":[]}"#,
        );
        let issues = logic_support_issues("snes", &with_node);
        assert_eq!(
            issues,
            vec![LogicSupportIssue {
                platform: "snes".to_string(),
                entity_id: "fox".to_string(),
                node_id: "g".to_string(),
                node_type: "condition_on_ground".to_string(),
                reason: "o estado de apoio no chao so existe na fisica do Mega Drive".to_string(),
            }]
        );
        assert!(issue_diagnostic(&issues[0]).blocking);
        assert!(logic_support_issues("megadrive", &with_node).is_empty());
        assert!(logic_support_issues("snes", &without).is_empty());
    }
}
