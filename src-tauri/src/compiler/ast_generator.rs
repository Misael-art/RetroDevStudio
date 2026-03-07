use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

use crate::core::project_mgr::{resolve_prefabs, LoadError};
use crate::ugdm::components::{
    AnimationDef, CollisionComponent, InputComponent, SpriteComponent,
};
use crate::ugdm::entities::{Project, Scene};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum AstNode {
    SpriteSystemInit,
    LoadTilemap {
        resource_name: String,
        asset_path: String,
        map_width: u32,
        map_height: u32,
    },
    LoadSpritesheet {
        resource_name: String,
        asset_path: String,
        frame_width: u32,
        frame_height: u32,
        palette_slot: u8,
    },
    SpawnSprite {
        var_name: String,
        resource_name: String,
        x: i32,
        y: i32,
        priority_high: bool,
    },
    DrawTilemap {
        resource_name: String,
        x: i32,
        y: i32,
        scroll_x: i32,
        scroll_y: i32,
    },
    ReadInputDevice {
        device: String,
        state_var: String,
    },
    MapInputAction {
        result_name: String,
        entity_id: String,
        action_name: String,
        state_var: String,
        button: String,
    },
    CheckCollisionAabb {
        result_name: String,
        left: CollisionBox,
        right: CollisionBox,
    },
    SetAnimation {
        var_name: String,
        resource_name: String,
        anim_index: u32,
        frame_time: u32,
        frames: Vec<u32>,
        looping: bool,
    },
    DrawText {
        x: u32,
        y: u32,
        text: String,
        palette_slot: u8,
    },
    GameLoopBegin,
    GameLoopEnd,
    SpriteUpdate,
    VSync,
}

#[derive(Debug)]
pub struct AstOutput {
    pub nodes: Vec<AstNode>,
    pub sprite_assets: Vec<SpriteAsset>,
    pub logic_scripts: Vec<LogicScript>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SpriteAsset {
    pub resource_name: String,
    pub asset_path: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub palette_slot: u8,
    pub animation_count: u32,
    pub default_animation: Option<SpriteAnimation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpriteAnimation {
    pub name: String,
    pub frames: Vec<u32>,
    pub frame_time: u32,
    pub looping: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilemapAsset {
    pub resource_name: String,
    pub asset_path: String,
    pub map_width: u32,
    pub map_height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollisionBox {
    pub entity_id: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CollisionSource {
    box_def: CollisionBox,
    layer: Option<String>,
    collides_with: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AabbCollisionCheck {
    pub result_name: String,
    pub left: CollisionBox,
    pub right: CollisionBox,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputRead {
    pub device: String,
    pub state_var: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputActionBinding {
    pub result_name: String,
    pub entity_id: String,
    pub action_name: String,
    pub state_var: String,
    pub button: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicScript {
    pub ops: Vec<LogicOp>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogicOp {
    MoveSprite {
        target_var: String,
        dx: i32,
        dy: i32,
    },
    ConditionOverlap {
        left: LogicCollisionTarget,
        right: LogicCollisionTarget,
        if_true: Vec<LogicOp>,
        if_false: Vec<LogicOp>,
    },
    PlaySound {
        sfx: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicCollisionTarget {
    pub entity_id: String,
    pub position: LogicPositionSource,
    pub offset_x: i32,
    pub offset_y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogicPositionSource {
    SpriteVar { var_name: String },
    Static { x: i32, y: i32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LogicRuntimeEntity {
    collision_target: LogicCollisionTarget,
}

#[derive(Debug, Clone, Deserialize)]
struct StoredNodeGraph {
    #[serde(default)]
    nodes: Vec<StoredNodeGraphNode>,
    #[serde(default)]
    edges: Vec<StoredNodeGraphEdge>,
}

#[derive(Debug, Clone, Deserialize)]
struct StoredNodeGraphNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    params: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNodeGraphEdge {
    from_node: String,
    from_port: String,
    to_node: String,
}

pub fn generate_ast_with_prefabs(
    project_dir: &Path,
    project: &Project,
    scene: &Scene,
) -> Result<AstOutput, LoadError> {
    let resolved_scene = resolve_prefabs(project_dir, scene)?;
    Ok(generate_ast(project, &resolved_scene))
}

pub fn generate_ast(project: &Project, scene: &Scene) -> AstOutput {
    let mut nodes: Vec<AstNode> = Vec::new();
    let mut sprite_assets: Vec<SpriteAsset> = Vec::new();
    let mut tilemap_assets: Vec<TilemapAsset> = Vec::new();
    let mut collision_sources: Vec<CollisionSource> = Vec::new();
    let mut input_reads: Vec<InputRead> = Vec::new();
    let mut input_actions: Vec<InputActionBinding> = Vec::new();
    let mut sprite_var_names: HashMap<String, String> = HashMap::new();
    let mut asset_resource_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut tilemap_resource_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut input_state_vars: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    nodes.push(AstNode::SpriteSystemInit);
    nodes.push(AstNode::DrawText {
        x: 1,
        y: 1,
        text: format!("{} - {}", project.name, scene.scene_id),
        palette_slot: 0,
    });

    for entity in &scene.entities {
        if let Some(collision) = &entity.components.collision {
            if let Some(source) = collision_source(entity.entity_id.as_str(), entity.transform.x, entity.transform.y, collision) {
                collision_sources.push(source);
            }
        }
        if let Some(input) = &entity.components.input {
            register_input_nodes(
                entity.entity_id.as_str(),
                input,
                &mut input_reads,
                &mut input_actions,
                &mut input_state_vars,
            );
        }

        if let Some(tilemap) = &entity.components.tilemap {
            let resource_name = tilemap_resource_names
                .get(&tilemap.tileset)
                .cloned()
                .unwrap_or_else(|| sanitize_identifier(&format!("{}_tilemap", entity.entity_id)));

            if !tilemap_assets
                .iter()
                .any(|asset| asset.asset_path == tilemap.tileset)
            {
                tilemap_assets.push(TilemapAsset {
                    resource_name: resource_name.clone(),
                    asset_path: tilemap.tileset.clone(),
                    map_width: tilemap.map_width,
                    map_height: tilemap.map_height,
                });
                tilemap_resource_names.insert(tilemap.tileset.clone(), resource_name.clone());

                nodes.push(AstNode::LoadTilemap {
                    resource_name: resource_name.clone(),
                    asset_path: tilemap.tileset.clone(),
                    map_width: tilemap.map_width,
                    map_height: tilemap.map_height,
                });
            }

            nodes.push(AstNode::DrawTilemap {
                resource_name,
                x: entity.transform.x,
                y: entity.transform.y,
                scroll_x: tilemap.scroll_x,
                scroll_y: tilemap.scroll_y,
            });
        }

        let Some(sprite) = &entity.components.sprite else {
            continue;
        };

        let resource_name = asset_resource_names
            .get(&sprite.asset)
            .cloned()
            .unwrap_or_else(|| sanitize_identifier(&entity.entity_id));
        let var_name = format!("spr_{}", resource_name);
        sprite_var_names.insert(entity.entity_id.clone(), var_name.clone());
        let default_animation = default_animation(project.fps, sprite);

        if !sprite_assets.iter().any(|asset| asset.asset_path == sprite.asset) {
            sprite_assets.push(SpriteAsset {
                resource_name: resource_name.clone(),
                asset_path: sprite.asset.clone(),
                frame_width: sprite.frame_width,
                frame_height: sprite.frame_height,
                palette_slot: sprite.palette_slot,
                animation_count: count_unique_frames(sprite),
                default_animation: default_animation.clone(),
            });
            asset_resource_names.insert(sprite.asset.clone(), resource_name.clone());

            nodes.push(AstNode::LoadSpritesheet {
                resource_name: resource_name.clone(),
                asset_path: sprite.asset.clone(),
                frame_width: sprite.frame_width,
                frame_height: sprite.frame_height,
                palette_slot: sprite.palette_slot,
            });
        }

        nodes.push(AstNode::SpawnSprite {
            var_name: var_name.clone(),
            resource_name: resource_name.clone(),
            x: entity.transform.x,
            y: entity.transform.y,
            priority_high: sprite.priority == "foreground",
        });

        if let Some(animation) = default_animation {
            nodes.push(AstNode::SetAnimation {
                var_name,
                resource_name,
                anim_index: 0,
                frame_time: animation.frame_time,
                frames: animation.frames,
                looping: animation.looping,
            });
        }
    }

    nodes.push(AstNode::GameLoopBegin);
    nodes.extend(input_reads.iter().cloned().map(|read| AstNode::ReadInputDevice {
        device: read.device,
        state_var: read.state_var,
    }));
    nodes.extend(
        input_actions
            .iter()
            .cloned()
            .map(|binding| AstNode::MapInputAction {
                result_name: binding.result_name,
                entity_id: binding.entity_id,
                action_name: binding.action_name,
                state_var: binding.state_var,
                button: binding.button,
            }),
    );
    nodes.extend(collision_nodes(&collision_sources));
    nodes.push(AstNode::SpriteUpdate);
    nodes.push(AstNode::VSync);
    nodes.push(AstNode::GameLoopEnd);

    let logic_runtime_entities = collect_logic_runtime_entities(scene, &sprite_var_names);
    let logic_scripts = collect_logic_scripts(scene, &logic_runtime_entities);

    AstOutput {
        nodes,
        sprite_assets,
        logic_scripts,
    }
}

fn sanitize_identifier(id: &str) -> String {
    id.chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

fn count_unique_frames(sprite: &SpriteComponent) -> u32 {
    use std::collections::HashSet;

    let unique: HashSet<u32> = sprite
        .animations
        .values()
        .flat_map(|animation| animation.frames.iter().copied())
        .collect();
    unique.len().max(1) as u32
}

fn default_animation(project_fps: u32, sprite: &SpriteComponent) -> Option<SpriteAnimation> {
    let (name, animation) = sprite
        .animations
        .iter()
        .min_by(|(left_name, _), (right_name, _)| left_name.cmp(right_name))?;

    Some(SpriteAnimation {
        name: name.clone(),
        frames: normalized_frames(animation),
        frame_time: animation_frame_time(project_fps, animation.fps),
        looping: animation.looping,
    })
}

fn normalized_frames(animation: &AnimationDef) -> Vec<u32> {
    if animation.frames.is_empty() {
        vec![0]
    } else {
        animation.frames.clone()
    }
}

fn animation_frame_time(project_fps: u32, animation_fps: u32) -> u32 {
    if animation_fps == 0 {
        return 0;
    }

    ((project_fps + (animation_fps / 2)) / animation_fps).max(1)
}

fn register_input_nodes(
    entity_id: &str,
    input: &InputComponent,
    input_reads: &mut Vec<InputRead>,
    input_actions: &mut Vec<InputActionBinding>,
    input_state_vars: &mut std::collections::HashMap<String, String>,
) {
    if input.mapping.is_empty() {
        return;
    }

    let state_var = input_state_vars
        .get(&input.device)
        .cloned()
        .unwrap_or_else(|| {
            let state_var = sanitize_identifier(&format!("{}_state", input.device));
            input_reads.push(InputRead {
                device: input.device.clone(),
                state_var: state_var.clone(),
            });
            input_state_vars.insert(input.device.clone(), state_var.clone());
            state_var
        });

    let mut mappings = input.mapping.iter().collect::<Vec<_>>();
    mappings.sort_by(|(left_action, _), (right_action, _)| left_action.cmp(right_action));

    for (action_name, button) in mappings {
        input_actions.push(InputActionBinding {
            result_name: sanitize_identifier(&format!("input_{}_{}", entity_id, action_name)),
            entity_id: entity_id.to_string(),
            action_name: action_name.clone(),
            state_var: state_var.clone(),
            button: button.clone(),
        });
    }
}

fn collision_source(
    entity_id: &str,
    entity_x: i32,
    entity_y: i32,
    collision: &CollisionComponent,
) -> Option<CollisionSource> {
    if collision.shape != "aabb" {
        return None;
    }

    let offset_x = collision.offset.as_ref().map(|offset| offset.x).unwrap_or(0);
    let offset_y = collision.offset.as_ref().map(|offset| offset.y).unwrap_or(0);

    Some(CollisionSource {
        box_def: CollisionBox {
            entity_id: entity_id.to_string(),
            x: entity_x.saturating_add(offset_x),
            y: entity_y.saturating_add(offset_y),
            width: collision.width,
            height: collision.height,
        },
        layer: collision.layer.clone(),
        collides_with: collision.collides_with.clone(),
    })
}

fn collision_nodes(collision_sources: &[CollisionSource]) -> Vec<AstNode> {
    let mut nodes = Vec::new();

    for (index, left) in collision_sources.iter().enumerate() {
        for right in collision_sources.iter().skip(index + 1) {
            if !should_emit_collision_check(left, right) {
                continue;
            }

            nodes.push(AstNode::CheckCollisionAabb {
                result_name: sanitize_identifier(&format!(
                    "collision_{}_{}",
                    left.box_def.entity_id, right.box_def.entity_id
                )),
                left: left.box_def.clone(),
                right: right.box_def.clone(),
            });
        }
    }

    nodes
}

fn should_emit_collision_check(left: &CollisionSource, right: &CollisionSource) -> bool {
    collision_targets_allow(left, right.layer.as_deref())
        && collision_targets_allow(right, left.layer.as_deref())
}

fn collision_targets_allow(source: &CollisionSource, target_layer: Option<&str>) -> bool {
    if source.collides_with.is_empty() {
        return true;
    }

    target_layer.is_some_and(|layer| {
        source
            .collides_with
            .iter()
            .any(|candidate| candidate == layer)
    })
}

fn collect_logic_runtime_entities(
    scene: &Scene,
    sprite_var_names: &HashMap<String, String>,
) -> HashMap<String, LogicRuntimeEntity> {
    scene
        .entities
        .iter()
        .filter_map(|entity| {
            logic_runtime_entity(entity, sprite_var_names.get(&entity.entity_id))
                .map(|runtime| (entity.entity_id.clone(), runtime))
        })
        .collect()
}

fn logic_runtime_entity(
    entity: &crate::ugdm::entities::Entity,
    sprite_var_name: Option<&String>,
) -> Option<LogicRuntimeEntity> {
    let (width, height, offset_x, offset_y) = match (&entity.components.collision, &entity.components.sprite) {
        (Some(collision), _) if collision.shape == "aabb" => (
            collision.width,
            collision.height,
            collision.offset.as_ref().map(|offset| offset.x).unwrap_or(0),
            collision.offset.as_ref().map(|offset| offset.y).unwrap_or(0),
        ),
        (_, Some(sprite)) => (sprite.frame_width, sprite.frame_height, 0, 0),
        _ => return None,
    };

    let position = sprite_var_name
        .cloned()
        .map(|var_name| LogicPositionSource::SpriteVar { var_name })
        .unwrap_or(LogicPositionSource::Static {
            x: entity.transform.x,
            y: entity.transform.y,
        });

    Some(LogicRuntimeEntity {
        collision_target: LogicCollisionTarget {
            entity_id: entity.entity_id.clone(),
            position,
            offset_x,
            offset_y,
            width,
            height,
        },
    })
}

fn collect_logic_scripts(
    scene: &Scene,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
) -> Vec<LogicScript> {
    let mut scripts = Vec::new();

    for entity in &scene.entities {
        let Some(logic) = &entity.components.logic else {
            continue;
        };
        let Some(serialized_graph) = logic.graph.as_deref() else {
            continue;
        };
        let Ok(graph) = serde_json::from_str::<StoredNodeGraph>(serialized_graph) else {
            continue;
        };

        scripts.extend(compile_logic_graph(&graph, runtime_entities));
    }

    scripts
}

fn compile_logic_graph(
    graph: &StoredNodeGraph,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
) -> Vec<LogicScript> {
    graph
        .nodes
        .iter()
        .filter(|node| node.node_type == "event_start")
        .filter_map(|start_node| {
            let mut visited = std::collections::HashSet::new();
            let ops = compile_logic_chain(
                graph,
                &start_node.id,
                "exec",
                runtime_entities,
                &mut visited,
            );
            (!ops.is_empty()).then_some(LogicScript { ops })
        })
        .collect()
}

fn compile_logic_chain(
    graph: &StoredNodeGraph,
    source_node_id: &str,
    source_port: &str,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
) -> Vec<LogicOp> {
    let mut ops = Vec::new();
    let mut next_node_id = next_exec_target(graph, source_node_id, source_port);

    while let Some(node_id) = next_node_id {
        if !visited.insert(node_id.clone()) {
            break;
        }

        let Some(node) = graph.nodes.iter().find(|node| node.id == node_id) else {
            visited.remove(&node_id);
            break;
        };

        match compile_logic_node(node, graph, runtime_entities, visited) {
            Some(CompiledLogicNode::Linear(op)) => {
                ops.push(op);
                next_node_id = next_exec_target(graph, &node.id, "exec");
            }
            Some(CompiledLogicNode::Terminal(op)) => {
                ops.push(op);
                next_node_id = None;
            }
            None => {
                next_node_id = next_exec_target(graph, &node.id, "exec");
            }
        }

        visited.remove(&node_id);
    }

    ops
}

enum CompiledLogicNode {
    Linear(LogicOp),
    Terminal(LogicOp),
}

fn compile_logic_node(
    node: &StoredNodeGraphNode,
    graph: &StoredNodeGraph,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
) -> Option<CompiledLogicNode> {
    match node.node_type.as_str() {
        "sprite_move" => {
            let target = param_string(node, "target")?;
            let runtime = runtime_entities.get(&target)?;
            let LogicPositionSource::SpriteVar { var_name } = &runtime.collision_target.position else {
                return None;
            };

            Some(CompiledLogicNode::Linear(LogicOp::MoveSprite {
                target_var: var_name.clone(),
                dx: param_i32(node, "dx", 0),
                dy: param_i32(node, "dy", 0),
            }))
        }
        "condition_overlap" => {
            let left = runtime_entities
                .get(&param_string(node, "a")?)?
                .collision_target
                .clone();
            let right = runtime_entities
                .get(&param_string(node, "b")?)?
                .collision_target
                .clone();
            let mut true_visited = visited.clone();
            let mut false_visited = visited.clone();
            let if_true =
                compile_logic_chain(graph, &node.id, "true", runtime_entities, &mut true_visited);
            let if_false = compile_logic_chain(
                graph,
                &node.id,
                "false",
                runtime_entities,
                &mut false_visited,
            );

            Some(CompiledLogicNode::Terminal(LogicOp::ConditionOverlap {
                left,
                right,
                if_true,
                if_false,
            }))
        }
        "action_sound" => Some(CompiledLogicNode::Linear(LogicOp::PlaySound {
            sfx: sanitize_identifier(
                &param_string(node, "sfx").unwrap_or_else(|| "sfx".to_string()),
            ),
        })),
        _ => None,
    }
}

fn next_exec_target(
    graph: &StoredNodeGraph,
    source_node_id: &str,
    source_port: &str,
) -> Option<String> {
    graph
        .edges
        .iter()
        .find(|edge| edge.from_node == source_node_id && edge.from_port == source_port)
        .map(|edge| edge.to_node.clone())
}

fn param_string(node: &StoredNodeGraphNode, key: &str) -> Option<String> {
    node.params.get(key).and_then(|value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn param_i32(node: &StoredNodeGraphNode, key: &str, default: i32) -> i32 {
    node.params
        .get(key)
        .and_then(|value| match value {
            Value::Number(number) => number.as_i64().and_then(|value| i32::try_from(value).ok()),
            Value::String(text) => text.parse::<i32>().ok(),
            _ => None,
        })
        .unwrap_or(default)
}

pub fn collect_tilemap_assets(ast: &AstOutput) -> Vec<TilemapAsset> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::LoadTilemap {
                resource_name,
                asset_path,
                map_width,
                map_height,
            } => Some(TilemapAsset {
                resource_name: resource_name.clone(),
                asset_path: asset_path.clone(),
                map_width: *map_width,
                map_height: *map_height,
            }),
            _ => None,
        })
        .collect()
}

pub fn collect_collision_checks(ast: &AstOutput) -> Vec<AabbCollisionCheck> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::CheckCollisionAabb {
                result_name,
                left,
                right,
            } => Some(AabbCollisionCheck {
                result_name: result_name.clone(),
                left: left.clone(),
                right: right.clone(),
            }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
pub fn collect_input_reads(ast: &AstOutput) -> Vec<InputRead> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::ReadInputDevice { device, state_var } => Some(InputRead {
                device: device.clone(),
                state_var: state_var.clone(),
            }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
pub fn collect_input_actions(ast: &AstOutput) -> Vec<InputActionBinding> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::MapInputAction {
                result_name,
                entity_id,
                action_name,
                state_var,
                button,
            } => Some(InputActionBinding {
                result_name: result_name.clone(),
                entity_id: entity_id.clone(),
                action_name: action_name.clone(),
                state_var: state_var.clone(),
                button: button.clone(),
            }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::project_mgr::{load_project, load_scene};
    use crate::ugdm::components::Components;
    use crate::ugdm::entities::{Entity, Resolution, Transform};
    use serde_json::json;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    fn fixture_dir(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join(name)
    }

    #[test]
    fn generate_ast_uses_default_animation_timing_from_sprite_component() {
        let mut animations = HashMap::new();
        animations.insert(
            "walk".to_string(),
            AnimationDef {
                frames: vec![1, 2, 3, 4],
                fps: 10,
                looping: true,
            },
        );

        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Timing Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "hero".to_string(),
                prefab: None,
                transform: Transform { x: 32, y: 48 },
                components: Components {
                    sprite: Some(SpriteComponent {
                        asset: "assets/sprites/hero.png".to_string(),
                        frame_width: 16,
                        frame_height: 16,
                        pivot: None,
                        palette_slot: 1,
                        animations,
                        priority: "foreground".to_string(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let asset = ast
            .sprite_assets
            .first()
            .expect("sprite asset should be registered");
        let default_animation = asset
            .default_animation
            .as_ref()
            .expect("default animation should be captured");

        assert_eq!(default_animation.frame_time, 6);
        assert_eq!(default_animation.frames, vec![1, 2, 3, 4]);
        assert!(default_animation.looping);

        let set_animation = ast
            .nodes
            .iter()
            .find_map(|node| match node {
                AstNode::SetAnimation {
                    resource_name,
                    frame_time,
                    frames,
                    looping,
                    ..
                } => Some((resource_name, frame_time, frames, looping)),
                _ => None,
            })
            .expect("animation node should be emitted");

        assert_eq!(set_animation.0, "hero");
        assert_eq!(*set_animation.1, 6);
        assert_eq!(set_animation.2, &vec![1, 2, 3, 4]);
        assert!(*set_animation.3);
    }

    #[test]
    fn animation_frame_time_disables_auto_animation_when_fps_is_zero() {
        assert_eq!(animation_frame_time(60, 0), 0);
    }

    #[test]
    fn generate_ast_emits_tilemap_nodes_for_tilemap_component() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Tilemap Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "background".to_string(),
                prefab: None,
                transform: Transform { x: 16, y: 24 },
                components: Components {
                    tilemap: Some(crate::ugdm::components::TilemapComponent {
                        tileset: "assets/tilesets/level.ppm".to_string(),
                        map_width: 32,
                        map_height: 32,
                        scroll_x: 4,
                        scroll_y: 8,
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let tilemap_assets = collect_tilemap_assets(&ast);

        assert_eq!(tilemap_assets.len(), 1);
        assert_eq!(tilemap_assets[0].resource_name, "background_tilemap");
        assert_eq!(tilemap_assets[0].asset_path, "assets/tilesets/level.ppm");

        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::DrawTilemap {
                resource_name,
                x,
                y,
                scroll_x,
                scroll_y
            } if resource_name == "background_tilemap"
                && *x == 16
                && *y == 24
                && *scroll_x == 4
                && *scroll_y == 8
        )));
    }

    #[test]
    fn generate_ast_emits_aabb_collision_checks_for_compatible_layers() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Collision Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![
                Entity {
                    entity_id: "player".to_string(),
                    prefab: None,
                    transform: Transform { x: 16, y: 24 },
                    components: Components {
                        collision: Some(crate::ugdm::components::CollisionComponent {
                            shape: "aabb".to_string(),
                            width: 16,
                            height: 24,
                            offset: Some(crate::ugdm::components::CollisionOffset { x: 2, y: 4 }),
                            solid: true,
                            layer: Some("player".to_string()),
                            collides_with: vec!["enemy".to_string()],
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "badnik".to_string(),
                    prefab: None,
                    transform: Transform { x: 40, y: 28 },
                    components: Components {
                        collision: Some(crate::ugdm::components::CollisionComponent {
                            shape: "aabb".to_string(),
                            width: 24,
                            height: 24,
                            offset: None,
                            solid: true,
                            layer: Some("enemy".to_string()),
                            collides_with: vec!["player".to_string()],
                        }),
                        ..Components::default()
                    },
                },
            ],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let collision_checks = collect_collision_checks(&ast);

        assert_eq!(collision_checks.len(), 1);
        assert_eq!(collision_checks[0].result_name, "collision_player_badnik");
        assert_eq!(
            collision_checks[0].left,
            CollisionBox {
                entity_id: "player".to_string(),
                x: 18,
                y: 28,
                width: 16,
                height: 24,
            }
        );
        assert_eq!(
            collision_checks[0].right,
            CollisionBox {
                entity_id: "badnik".to_string(),
                x: 40,
                y: 28,
                width: 24,
                height: 24,
            }
        );
    }

    #[test]
    fn generate_ast_skips_aabb_collision_checks_for_non_matching_layers() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Collision Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![
                Entity {
                    entity_id: "player".to_string(),
                    prefab: None,
                    transform: Transform { x: 16, y: 24 },
                    components: Components {
                        collision: Some(crate::ugdm::components::CollisionComponent {
                            shape: "aabb".to_string(),
                            width: 16,
                            height: 24,
                            offset: None,
                            solid: true,
                            layer: Some("player".to_string()),
                            collides_with: vec!["enemy".to_string()],
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "ring".to_string(),
                    prefab: None,
                    transform: Transform { x: 40, y: 28 },
                    components: Components {
                        collision: Some(crate::ugdm::components::CollisionComponent {
                            shape: "aabb".to_string(),
                            width: 8,
                            height: 8,
                            offset: None,
                            solid: false,
                            layer: Some("collectible".to_string()),
                            collides_with: vec!["terrain".to_string()],
                        }),
                        ..Components::default()
                    },
                },
            ],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);

        assert!(collect_collision_checks(&ast).is_empty());
    }

    #[test]
    fn generate_ast_emits_input_reads_and_action_bindings() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Input Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let mut player_mapping = HashMap::new();
        player_mapping.insert("move_left".to_string(), "DPAD_LEFT".to_string());
        player_mapping.insert("jump".to_string(), "BUTTON_A".to_string());
        let mut support_mapping = HashMap::new();
        support_mapping.insert("move_right".to_string(), "DPAD_RIGHT".to_string());

        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![
                Entity {
                    entity_id: "player".to_string(),
                    prefab: None,
                    transform: Transform { x: 16, y: 24 },
                    components: Components {
                        input: Some(crate::ugdm::components::InputComponent {
                            device: "joypad_1".to_string(),
                            mapping: player_mapping,
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "support".to_string(),
                    prefab: None,
                    transform: Transform { x: 40, y: 24 },
                    components: Components {
                        input: Some(crate::ugdm::components::InputComponent {
                            device: "joypad_1".to_string(),
                            mapping: support_mapping,
                        }),
                        ..Components::default()
                    },
                },
            ],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let input_reads = collect_input_reads(&ast);
        let input_actions = collect_input_actions(&ast);

        assert_eq!(
            input_reads,
            vec![InputRead {
                device: "joypad_1".to_string(),
                state_var: "joypad_1_state".to_string(),
            }]
        );
        assert_eq!(input_actions.len(), 3);
        assert_eq!(input_actions[0].result_name, "input_player_jump");
        assert_eq!(input_actions[0].button, "BUTTON_A");
        assert_eq!(input_actions[1].result_name, "input_player_move_left");
        assert_eq!(input_actions[1].button, "DPAD_LEFT");
        assert_eq!(input_actions[2].result_name, "input_support_move_right");
        assert_eq!(input_actions[2].button, "DPAD_RIGHT");
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::ReadInputDevice { device, state_var }
                if device == "joypad_1" && state_var == "joypad_1_state"
        )));
    }

    #[test]
    fn generate_ast_compiles_logic_graph_into_runtime_scripts() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };

        let logic_graph = json!({
            "version": 1,
            "nodes": [
                {
                    "id": "start",
                    "type": "event_start",
                    "label": "On Start",
                    "x": 0,
                    "y": 0,
                    "inputs": [],
                    "outputs": [{ "id": "exec", "label": "▶", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "move",
                    "type": "sprite_move",
                    "label": "Move Sprite",
                    "x": 120,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "▶", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "▶", "kind": "exec" }],
                    "params": { "target": "player", "dx": 2, "dy": -1 }
                },
                {
                    "id": "overlap",
                    "type": "condition_overlap",
                    "label": "On Overlap",
                    "x": 240,
                    "y": 0,
                    "inputs": [],
                    "outputs": [
                        { "id": "true", "label": "True ▶", "kind": "exec" },
                        { "id": "false", "label": "False ▶", "kind": "exec" }
                    ],
                    "params": { "a": "player", "b": "enemy" }
                },
                {
                    "id": "sound",
                    "type": "action_sound",
                    "label": "Play Sound",
                    "x": 360,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "▶", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "▶", "kind": "exec" }],
                    "params": { "sfx": "jump" }
                }
            ],
            "edges": [
                { "id": "edge_1", "fromNode": "start", "fromPort": "exec", "toNode": "move", "toPort": "exec" },
                { "id": "edge_2", "fromNode": "move", "fromPort": "exec", "toNode": "overlap", "toPort": "exec" },
                { "id": "edge_3", "fromNode": "overlap", "fromPort": "true", "toNode": "sound", "toPort": "exec" }
            ]
        })
        .to_string();

        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![
                Entity {
                    entity_id: "player".to_string(),
                    prefab: None,
                    transform: Transform { x: 16, y: 24 },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset: "assets/sprites/player.png".to_string(),
                            frame_width: 16,
                            frame_height: 16,
                            pivot: None,
                            palette_slot: 0,
                            animations: HashMap::new(),
                            priority: "foreground".to_string(),
                        }),
                        collision: Some(crate::ugdm::components::CollisionComponent {
                            shape: "aabb".to_string(),
                            width: 16,
                            height: 16,
                            offset: None,
                            solid: true,
                            layer: Some("player".to_string()),
                            collides_with: vec!["enemy".to_string()],
                        }),
                        logic: Some(crate::ugdm::components::LogicComponent {
                            graph: Some(logic_graph),
                            variables: HashMap::new(),
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "enemy".to_string(),
                    prefab: None,
                    transform: Transform { x: 48, y: 24 },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset: "assets/sprites/enemy.png".to_string(),
                            frame_width: 16,
                            frame_height: 16,
                            pivot: None,
                            palette_slot: 0,
                            animations: HashMap::new(),
                            priority: "foreground".to_string(),
                        }),
                        collision: Some(crate::ugdm::components::CollisionComponent {
                            shape: "aabb".to_string(),
                            width: 16,
                            height: 16,
                            offset: Some(crate::ugdm::components::CollisionOffset { x: 1, y: 2 }),
                            solid: true,
                            layer: Some("enemy".to_string()),
                            collides_with: vec!["player".to_string()],
                        }),
                        ..Components::default()
                    },
                },
            ],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);

        assert_eq!(ast.logic_scripts.len(), 1);
        assert_eq!(
            ast.logic_scripts[0].ops[0],
            LogicOp::MoveSprite {
                target_var: "spr_player".to_string(),
                dx: 2,
                dy: -1,
            }
        );

        let LogicOp::ConditionOverlap {
            left,
            right,
            if_true,
            if_false,
        } = &ast.logic_scripts[0].ops[1]
        else {
            panic!("expected overlap condition");
        };

        assert_eq!(left.entity_id, "player");
        assert_eq!(right.entity_id, "enemy");
        assert_eq!(right.offset_x, 1);
        assert_eq!(right.offset_y, 2);
        assert!(matches!(
            left.position,
            LogicPositionSource::SpriteVar { ref var_name } if var_name == "spr_player"
        ));
        assert!(matches!(
            right.position,
            LogicPositionSource::SpriteVar { ref var_name } if var_name == "spr_enemy"
        ));
        assert_eq!(
            if_true,
            &vec![LogicOp::PlaySound {
                sfx: "jump".to_string(),
            }]
        );
        assert!(if_false.is_empty());
    }

    #[test]
    fn generate_ast_with_prefabs_uses_inherited_prefab_components() {
        let project_dir = fixture_dir("prefab_dummy");
        let project = load_project(&project_dir).expect("load prefab fixture");
        let scene = load_scene(&project_dir, &project.entry_scene).expect("load prefab scene");

        let ast = generate_ast_with_prefabs(&project_dir, &project, &scene)
            .expect("generate ast with prefabs");

        assert!(ast.sprite_assets.iter().any(|asset| {
            asset.resource_name == "hero_instance" && asset.asset_path == "assets/sprites/hero.png"
        }));
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::SpawnSprite { resource_name, x, y, .. }
                if resource_name == "hero_instance" && *x == 48 && *y == 80
        )));
    }
}
