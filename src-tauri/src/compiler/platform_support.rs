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

#[derive(serde::Deserialize)]
struct GraphBehaviors {
    #[serde(default)]
    nodes: Vec<BehaviorNode>,
    #[serde(default)]
    behaviors: Vec<BehaviorRecord>,
}

#[derive(serde::Deserialize)]
struct BehaviorNode {
    id: String,
    #[serde(default)]
    params: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct BehaviorRecord {
    id: String,
    #[serde(rename = "behaviorId")]
    behavior_id: String,
    #[serde(default)]
    params: std::collections::HashMap<String, serde_json::Value>,
}

/// Referencias quebradas de comportamentos (grafo importado/editado fora do app):
/// nos gerados apontando para entidade inexistente, ou item/objetivo/passagem
/// apontando para contador/movimento que nao existe mais. Recusam o build.
pub fn behavior_reference_issues(resolved_scene: &Scene) -> Vec<LogicSupportIssue> {
    let entity_ids: std::collections::HashSet<&str> = resolved_scene
        .entities
        .iter()
        .map(|entity| entity.entity_id.as_str())
        .collect();
    let parsed: Vec<(String, GraphBehaviors)> = resolved_scene
        .entities
        .iter()
        .filter_map(|entity| {
            let graph = entity.components.logic.as_ref()?.graph.as_deref()?;
            serde_json::from_str::<GraphBehaviors>(graph)
                .ok()
                .map(|parsed| (entity.entity_id.clone(), parsed))
        })
        .collect();
    let counters: std::collections::HashSet<&str> = parsed
        .iter()
        .flat_map(|(_, graph)| graph.behaviors.iter())
        .filter(|record| record.behavior_id == "counter")
        .map(|record| record.id.as_str())
        .collect();
    let mut issues = Vec::new();
    let param = |params: &std::collections::HashMap<String, serde_json::Value>, key: &str| {
        params
            .get(key)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string()
    };
    for (entity_id, graph) in &parsed {
        for node in &graph.nodes {
            if param(&node.params, "behavior_instance").is_empty() {
                continue;
            }
            for key in ["target", "a", "b"] {
                let value = param(&node.params, key);
                if !value.is_empty() && value != "self" && !entity_ids.contains(value.as_str()) {
                    issues.push(LogicSupportIssue {
                        platform: "any".to_string(),
                        entity_id: entity_id.clone(),
                        node_id: node.id.clone(),
                        node_type: "behavior_reference".to_string(),
                        reason: format!(
                            "o comportamento aponta para a entidade '{value}', que nao existe"
                        ),
                    });
                }
            }
        }
        let local: std::collections::HashSet<&str> = graph
            .behaviors
            .iter()
            .map(|record| record.id.as_str())
            .collect();
        for record in &graph.behaviors {
            let counter = param(&record.params, "counter");
            if matches!(record.behavior_id.as_str(), "collectible" | "objective")
                && !counter.is_empty()
                && !counters.contains(counter.as_str())
            {
                issues.push(LogicSupportIssue {
                    platform: "any".to_string(),
                    entity_id: entity_id.clone(),
                    node_id: record.id.clone(),
                    node_type: record.behavior_id.clone(),
                    reason: format!("o contador '{counter}' nao existe mais"),
                });
            }
            let movement = param(&record.params, "movement");
            if record.behavior_id == "gated_passage" && !local.contains(movement.as_str()) {
                issues.push(LogicSupportIssue {
                    platform: "any".to_string(),
                    entity_id: entity_id.clone(),
                    node_id: record.id.clone(),
                    node_type: record.behavior_id.clone(),
                    reason: format!(
                        "o movimento '{movement}' bloqueado pela passagem nao existe mais"
                    ),
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
        if issue.platform == "any" {
            format!(
                "A logica da entidade '{}' tem uma referencia quebrada em '{}': {}.",
                issue.entity_id, issue.node_id, issue.reason
            )
        } else {
            format!(
                "A entidade '{}' usa o no '{}' ({}), que nao e suportado em {}: {}.",
                issue.entity_id, issue.node_id, issue.node_type, issue.platform, issue.reason
            )
        },
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

    #[test]
    fn refuses_broken_behavior_references_from_external_edits() {
        let orphan_entity = scene_with(
            r#"{"nodes":[{"id":"bh_item_x_1__hide","type":"destroy_entity","params":{"target":"ghost","behavior_instance":"bh_item_x_1"}}],"edges":[]}"#,
        );
        let issues = behavior_reference_issues(&orphan_entity);
        assert_eq!(issues.len(), 1);
        assert!(issues[0].reason.contains("'ghost'"));
        let orphan_counter = scene_with(
            r#"{"nodes":[],"edges":[],"behaviors":[{"id":"bh_item_x_1","behaviorId":"collectible","label":"x","params":{"counter":"bh_ctr_gone_1","item":"fox"},"nodeIds":[],"edgeIds":[],"generated":{}}]}"#,
        );
        assert!(behavior_reference_issues(&orphan_counter)[0]
            .reason
            .contains("bh_ctr_gone_1"));
        let fine = scene_with(
            r#"{"nodes":[{"id":"n","type":"destroy_entity","params":{"target":"fox","behavior_instance":"bh"}}],"edges":[]}"#,
        );
        assert!(behavior_reference_issues(&fine).is_empty());
    }
}
