use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

use crate::core::project_mgr::{resolve_prefabs, LoadError};
use crate::ugdm::components::{
    AnimationDef, AudioComponent, CollisionComponent, InputComponent, PhysicsComponent,
    SpriteComponent,
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
    SetupParallax {
        layers: Vec<ParallaxLayerConfig>,
    },
    SetupRasterEffect {
        lines: Vec<RasterLineConfig>,
    },
    InitAudio {
        sfx_resources: Vec<(String, String)>,
    },
    PlayBgm {
        resource_name: String,
        asset_path: String,
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
    ApplyPhysics {
        var_name: String,
        gravity: bool,
        gravity_strength: i32,
        max_velocity_x: i32,
        max_velocity_y: i32,
        friction: i32,
        bounce: i32,
    },
    SetAnimation {
        var_name: String,
        resource_name: String,
        anim_index: u32,
        frame_time: u32,
        frames: Vec<u32>,
        looping: bool,
    },
    ScrollTilemap {
        layer: String,
        dx: i32,
        dy: i32,
    },
    MoveCamera {
        target: String,
        x: i32,
        y: i32,
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
    pub animations: Vec<SpriteAnimation>,
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
pub struct PhysicsApplication {
    pub var_name: String,
    pub gravity: bool,
    pub gravity_strength: i32,
    pub max_velocity_x: i32,
    pub max_velocity_y: i32,
    pub friction: i32,
    pub bounce: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParallaxLayerConfig {
    pub layer_name: String,
    pub speed_x: i32,
    pub speed_y: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RasterLineConfig {
    pub scanline: u32,
    pub offset_x: i32,
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
    ConditionBool {
        condition: LogicBoolExpr,
        if_true: Vec<LogicOp>,
        if_false: Vec<LogicOp>,
    },
    PlaySound {
        sfx: String,
    },
    SetVar {
        var_name: String,
        value: LogicMathExpr,
    },
    StateMachine {
        machine_var: String,
        states: Vec<LogicFsmState>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicFsmState {
    pub state_name: String,
    pub state_index: usize,
    pub body: Vec<LogicOp>,
    pub transitions: Vec<LogicFsmTransition>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicFsmTransition {
    pub condition: LogicBoolExpr,
    pub target_state: String,
    pub target_index: usize,
    pub if_matched: Vec<LogicOp>,
    pub if_unmatched: Vec<LogicOp>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogicMathExpr {
    Literal(i32),
    Var(String),
    Add(Box<LogicMathExpr>, Box<LogicMathExpr>),
    Sub(Box<LogicMathExpr>, Box<LogicMathExpr>),
    Mul(Box<LogicMathExpr>, Box<LogicMathExpr>),
    Div(Box<LogicMathExpr>, Box<LogicMathExpr>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogicBoolExpr {
    Literal(bool),
    Overlap {
        left: LogicCollisionTarget,
        right: LogicCollisionTarget,
    },
    Not(Box<LogicBoolExpr>),
    And {
        result_name: String,
        left: Box<LogicBoolExpr>,
        right: Box<LogicBoolExpr>,
    },
    Compare {
        op: CompareOp,
        left: Box<LogicMathExpr>,
        right: Box<LogicMathExpr>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompareOp {
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
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
    sprite: Option<LogicRuntimeSprite>,
    camera: Option<LogicRuntimeCamera>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LogicRuntimeSprite {
    var_name: String,
    resource_name: String,
    animations: Vec<SpriteAnimation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LogicRuntimeCamera {
    follow_sprite_var: Option<String>,
    offset_x: i32,
    offset_y: i32,
}

#[derive(Debug, Default)]
struct CompiledLogicOutput {
    setup_nodes: Vec<AstNode>,
    runtime_nodes: Vec<AstNode>,
    scripts: Vec<LogicScript>,
    parallax_layers: Vec<ParallaxLayerConfig>,
    raster_lines: Vec<RasterLineConfig>,
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
    #[serde(default = "default_exec_port")]
    to_port: String,
}

fn default_exec_port() -> String {
    "exec".to_string()
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
    let mut physics_applications: Vec<PhysicsApplication> = Vec::new();
    let mut audio_sfx_resources: std::collections::BTreeMap<String, String> =
        std::collections::BTreeMap::new();
    let mut bgm_track: Option<(String, String)> = None;
    let mut sprite_var_names: HashMap<String, String> = HashMap::new();
    let mut sprite_resource_names: HashMap<String, String> = HashMap::new();
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
        if let Some(audio) = &entity.components.audio {
            register_audio_nodes(audio, &mut audio_sfx_resources, &mut bgm_track);
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
        sprite_resource_names.insert(entity.entity_id.clone(), resource_name.clone());
        let animations = sprite_animations(project.fps, sprite);
        let default_animation = default_animation(project.fps, sprite);

        if !sprite_assets.iter().any(|asset| asset.asset_path == sprite.asset) {
            sprite_assets.push(SpriteAsset {
                resource_name: resource_name.clone(),
                asset_path: sprite.asset.clone(),
                frame_width: sprite.frame_width,
                frame_height: sprite.frame_height,
                palette_slot: sprite.palette_slot,
                animation_count: count_unique_frames(sprite),
                animations: animations.clone(),
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
                var_name: var_name.clone(),
                resource_name: resource_name.clone(),
                anim_index: 0,
                frame_time: animation.frame_time,
                frames: animation.frames,
                looping: animation.looping,
            });
        }

        if let Some(physics) = &entity.components.physics {
            physics_applications.push(physics_application(
                &var_name,
                physics,
            ));
        }
    }

    let logic_runtime_entities = collect_logic_runtime_entities(
        scene,
        &sprite_var_names,
        &sprite_resource_names,
        project.fps,
    );
    let logic_output = collect_logic_output(scene, &logic_runtime_entities);
    nodes.extend(logic_output.setup_nodes.iter().cloned());
    let mut parallax_layers = enabled_parallax_layers(scene);
    for layer in logic_output.parallax_layers.iter().cloned() {
        push_unique_parallax_layer(&mut parallax_layers, layer);
    }
    let mut raster_lines = enabled_raster_lines(scene);
    for line in logic_output.raster_lines.iter().cloned() {
        push_unique_raster_line(&mut raster_lines, line);
    }
    if !parallax_layers.is_empty() {
        nodes.push(AstNode::SetupParallax {
            layers: parallax_layers,
        });
    }
    if !raster_lines.is_empty() {
        nodes.push(AstNode::SetupRasterEffect { lines: raster_lines });
    }
    if !audio_sfx_resources.is_empty() {
        nodes.push(AstNode::InitAudio {
            sfx_resources: audio_sfx_resources.into_iter().collect(),
        });
    }
    if let Some((resource_name, asset_path)) = bgm_track {
        nodes.push(AstNode::PlayBgm {
            resource_name,
            asset_path,
        });
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
    nodes.extend(physics_applications.iter().cloned().map(|application| {
        AstNode::ApplyPhysics {
            var_name: application.var_name,
            gravity: application.gravity,
            gravity_strength: application.gravity_strength,
            max_velocity_x: application.max_velocity_x,
            max_velocity_y: application.max_velocity_y,
            friction: application.friction,
            bounce: application.bounce,
        }
    }));
    nodes.extend(logic_output.runtime_nodes.iter().cloned());
    nodes.push(AstNode::SpriteUpdate);
    nodes.push(AstNode::VSync);
    nodes.push(AstNode::GameLoopEnd);

    AstOutput {
        nodes,
        sprite_assets,
        logic_scripts: logic_output.scripts,
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

fn sprite_animations(project_fps: u32, sprite: &SpriteComponent) -> Vec<SpriteAnimation> {
    let mut animations = sprite
        .animations
        .iter()
        .map(|(name, animation)| SpriteAnimation {
            name: name.clone(),
            frames: normalized_frames(animation),
            frame_time: animation_frame_time(project_fps, animation.fps),
            looping: animation.looping,
        })
        .collect::<Vec<_>>();
    animations.sort_by(|left, right| left.name.cmp(&right.name));
    animations
}

fn default_animation(project_fps: u32, sprite: &SpriteComponent) -> Option<SpriteAnimation> {
    sprite_animations(project_fps, sprite).into_iter().next()
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

fn physics_application(var_name: &str, physics: &PhysicsComponent) -> PhysicsApplication {
    let (max_velocity_x, max_velocity_y) = physics
        .max_velocity
        .as_ref()
        .map(|velocity| (velocity.x, velocity.y))
        .unwrap_or((i16::MAX as i32, i16::MAX as i32));

    PhysicsApplication {
        var_name: var_name.to_string(),
        gravity: physics.gravity,
        gravity_strength: physics.gravity_strength,
        max_velocity_x,
        max_velocity_y,
        friction: physics.friction,
        bounce: physics.bounce,
    }
}

fn register_audio_nodes(
    audio: &AudioComponent,
    sfx_resources: &mut std::collections::BTreeMap<String, String>,
    bgm_track: &mut Option<(String, String)>,
) {
    for (action, asset_path) in &audio.sfx {
        let action = sanitize_identifier(action);
        let asset_path = asset_path.trim();
        if action.is_empty() || asset_path.is_empty() {
            continue;
        }
        sfx_resources
            .entry(action)
            .or_insert_with(|| asset_path.to_string());
    }

    if bgm_track.is_some() {
        return;
    }

    let Some(asset_path) = audio.bgm.as_deref().map(str::trim) else {
        return;
    };
    if asset_path.is_empty() {
        return;
    }

    let file_stem = Path::new(asset_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("bgm");
    let resource_name = sanitize_identifier(file_stem);
    let resource_name = if resource_name.is_empty() {
        "bgm".to_string()
    } else {
        resource_name
    };

    *bgm_track = Some((resource_name, asset_path.to_string()));
}

fn enabled_parallax_layers(scene: &Scene) -> Vec<ParallaxLayerConfig> {
    scene
        .retrofx
        .as_ref()
        .map(|retrofx| {
            retrofx
                .parallax_layers
                .iter()
                .filter(|layer| layer.enabled)
                .map(|layer| ParallaxLayerConfig {
                    layer_name: layer.name.clone(),
                    speed_x: layer.speed_x,
                    speed_y: layer.speed_y,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn enabled_raster_lines(scene: &Scene) -> Vec<RasterLineConfig> {
    scene
        .retrofx
        .as_ref()
        .map(|retrofx| {
            retrofx
                .raster_lines
                .iter()
                .filter(|line| line.enabled)
                .map(|line| RasterLineConfig {
                    scanline: line.scanline.min(223),
                    offset_x: line.offset_x,
                })
                .collect()
        })
        .unwrap_or_default()
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
    sprite_resource_names: &HashMap<String, String>,
    project_fps: u32,
) -> HashMap<String, LogicRuntimeEntity> {
    scene
        .entities
        .iter()
        .filter_map(|entity| {
            logic_runtime_entity(
                entity,
                sprite_var_names,
                sprite_var_names.get(&entity.entity_id),
                sprite_resource_names.get(&entity.entity_id),
                project_fps,
            )
            .map(|runtime| (entity.entity_id.clone(), runtime))
        })
        .collect()
}

fn logic_runtime_entity(
    entity: &crate::ugdm::entities::Entity,
    sprite_var_names: &HashMap<String, String>,
    sprite_var_name: Option<&String>,
    sprite_resource_name: Option<&String>,
    project_fps: u32,
) -> Option<LogicRuntimeEntity> {
    let (width, height, offset_x, offset_y) = match (&entity.components.collision, &entity.components.sprite) {
        (Some(collision), _) if collision.shape == "aabb" => (
            collision.width,
            collision.height,
            collision.offset.as_ref().map(|offset| offset.x).unwrap_or(0),
            collision.offset.as_ref().map(|offset| offset.y).unwrap_or(0),
        ),
        (_, Some(sprite)) => (sprite.frame_width, sprite.frame_height, 0, 0),
        _ if entity.components.camera.is_some() => (0, 0, 0, 0),
        _ => return None,
    };

    let position = sprite_var_name
        .cloned()
        .map(|var_name| LogicPositionSource::SpriteVar { var_name })
        .unwrap_or(LogicPositionSource::Static {
            x: entity.transform.x,
            y: entity.transform.y,
        });
    let sprite = match (
        sprite_var_name.cloned(),
        sprite_resource_name.cloned(),
        entity.components.sprite.as_ref(),
    ) {
        (Some(var_name), Some(resource_name), Some(sprite)) => Some(LogicRuntimeSprite {
            var_name,
            resource_name,
            animations: sprite_animations(project_fps, sprite),
        }),
        _ => None,
    };
    let camera = entity.components.camera.as_ref().map(|camera| LogicRuntimeCamera {
        follow_sprite_var: camera
            .follow_entity
            .as_ref()
            .and_then(|entity_id| sprite_var_names.get(entity_id))
            .cloned(),
        offset_x: camera.offset_x,
        offset_y: camera.offset_y,
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
        sprite,
        camera,
    })
}

fn push_unique_parallax_layer(
    parallax_layers: &mut Vec<ParallaxLayerConfig>,
    layer: ParallaxLayerConfig,
) {
    if !parallax_layers.iter().any(|existing| existing == &layer) {
        parallax_layers.push(layer);
    }
}

fn push_unique_raster_line(raster_lines: &mut Vec<RasterLineConfig>, line: RasterLineConfig) {
    if !raster_lines.iter().any(|existing| existing == &line) {
        raster_lines.push(line);
    }
}

fn collect_logic_output(
    scene: &Scene,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
) -> CompiledLogicOutput {
    let mut output = CompiledLogicOutput::default();

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

        let compiled = compile_logic_graph(&graph, runtime_entities);
        output.setup_nodes.extend(compiled.setup_nodes);
        output.runtime_nodes.extend(compiled.runtime_nodes);
        output.scripts.extend(compiled.scripts);
        output.parallax_layers.extend(compiled.parallax_layers);
        output.raster_lines.extend(compiled.raster_lines);
    }

    output
}

fn compile_logic_graph(
    graph: &StoredNodeGraph,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
) -> CompiledLogicOutput {
    let mut output = CompiledLogicOutput::default();

    output.scripts.extend(graph.nodes.iter().filter(|node| node.node_type == "event_start").filter_map(|start_node| {
            let mut visited = std::collections::HashSet::new();
            let ops = compile_logic_chain(
                graph,
                &start_node.id,
                "exec",
                runtime_entities,
                &mut visited,
                &mut output.setup_nodes,
                &mut output.runtime_nodes,
                &mut output.parallax_layers,
                &mut output.raster_lines,
            );
            (!ops.is_empty()).then_some(LogicScript { ops })
        }));

    if let Some(fsm_script) = compile_fsm_script(graph, runtime_entities, &mut output) {
        output.scripts.push(fsm_script);
    }

    output
}

fn compile_fsm_script(
    graph: &StoredNodeGraph,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    output: &mut CompiledLogicOutput,
) -> Option<LogicScript> {
    let mut state_nodes = graph
        .nodes
        .iter()
        .filter(|node| node.node_type == "fsm_state")
        .collect::<Vec<_>>();
    if state_nodes.is_empty() {
        return None;
    }

    state_nodes.sort_by(|left, right| {
        let left_initial = param_bool(left, "initial", false);
        let right_initial = param_bool(right, "initial", false);
        right_initial
            .cmp(&left_initial)
            .then_with(|| left.id.cmp(&right.id))
    });

    let states = state_nodes
        .iter()
        .enumerate()
        .map(|(index, node)| compile_fsm_state(graph, node, index, &state_nodes, runtime_entities, output))
        .collect::<Vec<_>>();

    Some(LogicScript {
        ops: vec![LogicOp::StateMachine {
            machine_var: "fsm_state".to_string(),
            states,
        }],
    })
}

fn compile_fsm_state(
    graph: &StoredNodeGraph,
    node: &StoredNodeGraphNode,
    state_index: usize,
    ordered_states: &[&StoredNodeGraphNode],
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    output: &mut CompiledLogicOutput,
) -> LogicFsmState {
    let mut body_visited = std::collections::HashSet::new();
    let body = compile_logic_chain(
        graph,
        &node.id,
        "exec",
        runtime_entities,
        &mut body_visited,
        &mut output.setup_nodes,
        &mut output.runtime_nodes,
        &mut output.parallax_layers,
        &mut output.raster_lines,
    );

    let transitions = compile_fsm_transitions(
        graph,
        &node.id,
        ordered_states,
        runtime_entities,
        output,
    );

    LogicFsmState {
        state_name: sanitize_identifier(
            &param_string(node, "state_name").unwrap_or_else(|| node.id.clone()),
        ),
        state_index,
        body,
        transitions,
    }
}

fn compile_fsm_transitions(
    graph: &StoredNodeGraph,
    state_node_id: &str,
    ordered_states: &[&StoredNodeGraphNode],
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    output: &mut CompiledLogicOutput,
) -> Vec<LogicFsmTransition> {
    let mut transitions = Vec::new();
    let mut next_transition_id = next_exec_target(graph, state_node_id, "transitions");
    let mut visited = std::collections::HashSet::new();

    while let Some(node_id) = next_transition_id {
        if !visited.insert(node_id.clone()) {
            break;
        }

        let Some(node) = graph.nodes.iter().find(|candidate| candidate.id == node_id) else {
            break;
        };
        if node.node_type != "fsm_transition" {
            break;
        }

        let condition = resolve_bool_expr_from_ports(
            graph,
            node,
            &["condition", "guard"],
            runtime_entities,
            &mut std::collections::HashSet::new(),
        )
        .unwrap_or(LogicBoolExpr::Literal(false));

        let target_state_name = sanitize_identifier(
            &param_string(node, "target_state").unwrap_or_else(|| "state".to_string()),
        );
        let target_index = ordered_states
            .iter()
            .position(|candidate| {
                sanitize_identifier(
                    &param_string(candidate, "state_name").unwrap_or_else(|| candidate.id.clone()),
                ) == target_state_name
            })
            .unwrap_or(0);

        let mut matched_visited = std::collections::HashSet::new();
        let if_matched = compile_logic_chain(
            graph,
            &node.id,
            "matched",
            runtime_entities,
            &mut matched_visited,
            &mut output.setup_nodes,
            &mut output.runtime_nodes,
            &mut output.parallax_layers,
            &mut output.raster_lines,
        );

        let mut unmatched_visited = std::collections::HashSet::new();
        let if_unmatched = compile_logic_chain(
            graph,
            &node.id,
            "next",
            runtime_entities,
            &mut unmatched_visited,
            &mut output.setup_nodes,
            &mut output.runtime_nodes,
            &mut output.parallax_layers,
            &mut output.raster_lines,
        );

        transitions.push(LogicFsmTransition {
            condition,
            target_state: target_state_name,
            target_index,
            if_matched,
            if_unmatched,
        });

        next_transition_id = next_exec_target(graph, &node.id, "next");
    }

    transitions
}

#[allow(clippy::too_many_arguments)]
fn compile_logic_chain(
    graph: &StoredNodeGraph,
    source_node_id: &str,
    source_port: &str,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
    setup_nodes: &mut Vec<AstNode>,
    runtime_nodes: &mut Vec<AstNode>,
    parallax_layers: &mut Vec<ParallaxLayerConfig>,
    raster_lines: &mut Vec<RasterLineConfig>,
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

        match compile_logic_node(
            node,
            graph,
            runtime_entities,
            visited,
            setup_nodes,
            runtime_nodes,
            parallax_layers,
            raster_lines,
        ) {
            Some(CompiledLogicNode::Linear(op)) => {
                ops.push(op);
                next_node_id = next_exec_target(graph, &node.id, "exec");
            }
            Some(CompiledLogicNode::Terminal(op)) => {
                ops.push(op);
                next_node_id = None;
            }
            Some(CompiledLogicNode::NoOp) => {
                next_node_id = next_exec_target(graph, &node.id, "exec");
            }
            Some(CompiledLogicNode::SetupNode(ast_node)) => {
                setup_nodes.push(ast_node);
                next_node_id = next_exec_target(graph, &node.id, "exec");
            }
            Some(CompiledLogicNode::RuntimeNode(ast_node)) => {
                runtime_nodes.push(ast_node);
                next_node_id = next_exec_target(graph, &node.id, "exec");
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
    NoOp,
    SetupNode(AstNode),
    RuntimeNode(AstNode),
}

#[allow(clippy::too_many_arguments)]
fn compile_logic_node(
    node: &StoredNodeGraphNode,
    graph: &StoredNodeGraph,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
    setup_nodes: &mut Vec<AstNode>,
    runtime_nodes: &mut Vec<AstNode>,
    parallax_layers: &mut Vec<ParallaxLayerConfig>,
    raster_lines: &mut Vec<RasterLineConfig>,
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
            let if_true = compile_logic_chain(
                graph,
                &node.id,
                "true",
                runtime_entities,
                &mut true_visited,
                setup_nodes,
                runtime_nodes,
                parallax_layers,
                raster_lines,
            );
            let if_false = compile_logic_chain(
                graph,
                &node.id,
                "false",
                runtime_entities,
                &mut false_visited,
                setup_nodes,
                runtime_nodes,
                parallax_layers,
                raster_lines,
            );
            let overlap_expr = LogicBoolExpr::Overlap {
                left: left.clone(),
                right: right.clone(),
            };
            let guard_expr = resolve_bool_expr_from_ports(
                graph,
                node,
                &["guard", "condition"],
                runtime_entities,
                &mut std::collections::HashSet::new(),
            );

            match guard_expr {
                Some(guard) => Some(CompiledLogicNode::Terminal(LogicOp::ConditionBool {
                    condition: LogicBoolExpr::And {
                        result_name: format!("_and_{}", sanitize_identifier(&node.id)),
                        left: Box::new(guard),
                        right: Box::new(overlap_expr),
                    },
                    if_true,
                    if_false,
                })),
                None => Some(CompiledLogicNode::Terminal(LogicOp::ConditionOverlap {
                    left,
                    right,
                    if_true,
                    if_false,
                })),
            }
        }
        "action_sound" => Some(CompiledLogicNode::Linear(LogicOp::PlaySound {
            sfx: sanitize_identifier(
                &param_string(node, "sfx").unwrap_or_else(|| "sfx".to_string()),
            ),
        })),
        "sprite_anim" => {
            let target = param_string(node, "target")?;
            let anim_name = param_string(node, "anim").unwrap_or_else(|| "idle".to_string());
            let runtime = runtime_entities.get(&target)?;
            let Some(sprite) = &runtime.sprite else {
                eprintln!(
                    "[NodeGraph] sprite_anim ignorado para '{}': entidade sem sprite runtime.",
                    target
                );
                return Some(CompiledLogicNode::NoOp);
            };
            let Some((anim_index, animation)) = sprite
                .animations
                .iter()
                .enumerate()
                .find(|(_, animation)| {
                    animation.name == anim_name
                        || sanitize_identifier(&animation.name) == sanitize_identifier(&anim_name)
                })
            else {
                eprintln!(
                    "[NodeGraph] sprite_anim ignorado para '{}': animacao '{}' nao encontrada.",
                    target, anim_name
                );
                return Some(CompiledLogicNode::NoOp);
            };

            Some(CompiledLogicNode::SetupNode(AstNode::SetAnimation {
                var_name: sprite.var_name.clone(),
                resource_name: sprite.resource_name.clone(),
                anim_index: anim_index as u32,
                frame_time: animation.frame_time,
                frames: animation.frames.clone(),
                looping: animation.looping,
            }))
        }
        "scroll_tilemap" => Some(CompiledLogicNode::RuntimeNode(AstNode::ScrollTilemap {
            layer: normalize_scroll_layer(
                &param_string(node, "layer").unwrap_or_else(|| "BG_A".to_string()),
            ),
            dx: param_i32(node, "dx", 0),
            dy: param_i32(node, "dy", 0),
        })),
        "move_camera" => {
            let target = param_string(node, "target").unwrap_or_else(|| "camera".to_string());
            let offset_x = param_i32(node, "x", 0);
            let offset_y = param_i32(node, "y", 0);

            if let Some(runtime) = runtime_entities.get(&target) {
                if let Some(camera) = &runtime.camera {
                    if let Some(follow_sprite_var) = &camera.follow_sprite_var {
                        return Some(CompiledLogicNode::RuntimeNode(AstNode::MoveCamera {
                            target: follow_sprite_var.clone(),
                            x: camera.offset_x + offset_x,
                            y: camera.offset_y + offset_y,
                        }));
                    }
                }
                if let Some(sprite) = &runtime.sprite {
                    return Some(CompiledLogicNode::RuntimeNode(AstNode::MoveCamera {
                        target: sprite.var_name.clone(),
                        x: offset_x,
                        y: offset_y,
                    }));
                }
            }

            Some(CompiledLogicNode::RuntimeNode(AstNode::MoveCamera {
                target,
                x: offset_x,
                y: offset_y,
            }))
        }
        "effect_parallax" => {
            push_unique_parallax_layer(
                parallax_layers,
                ParallaxLayerConfig {
                    layer_name: param_string(node, "layer").unwrap_or_else(|| "BG_A".to_string()),
                    speed_x: param_i32(node, "speed_x", 0),
                    speed_y: param_i32(node, "speed_y", 0),
                },
            );
            Some(CompiledLogicNode::NoOp)
        }
        "effect_raster" => {
            push_unique_raster_line(
                raster_lines,
                RasterLineConfig {
                    scanline: param_i32(node, "scanline", 0).clamp(0, 223) as u32,
                    offset_x: param_i32(node, "offset_x", 0),
                },
            );
            Some(CompiledLogicNode::NoOp)
        }
        "var_set" => {
            let var_name = sanitize_identifier(&param_string(node, "var_name").unwrap_or_else(|| "temp_var".to_string()));
            let value_expr = resolve_math_expr_from_input(graph, &node.id, "value")?;
            Some(CompiledLogicNode::Linear(LogicOp::SetVar {
                var_name,
                value: value_expr,
            }))
        }
        "condition_compare" => {
            let op_str = param_string(node, "operator").unwrap_or_else(|| "==".to_string());
            let op = parse_compare_op(&op_str);
            let left = resolve_math_expr_from_input(graph, &node.id, "a")?;
            let right = resolve_math_expr_from_input(graph, &node.id, "b")?;
            let mut true_visited = visited.clone();
            let mut false_visited = visited.clone();
            let if_true = compile_logic_chain(
                graph,
                &node.id,
                "true",
                runtime_entities,
                &mut true_visited,
                setup_nodes,
                runtime_nodes,
                parallax_layers,
                raster_lines,
            );
            let if_false = compile_logic_chain(
                graph,
                &node.id,
                "false",
                runtime_entities,
                &mut false_visited,
                setup_nodes,
                runtime_nodes,
                parallax_layers,
                raster_lines,
            );
            
            let compare_expr = LogicBoolExpr::Compare {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };

            let guard_expr = resolve_bool_expr_from_ports(
                graph,
                node,
                &["guard", "condition"],
                runtime_entities,
                &mut std::collections::HashSet::new(),
            );

            match guard_expr {
                Some(guard) => Some(CompiledLogicNode::Terminal(LogicOp::ConditionBool {
                    condition: LogicBoolExpr::And {
                        result_name: format!("_and_{}", sanitize_identifier(&node.id)),
                        left: Box::new(guard),
                        right: Box::new(compare_expr),
                    },
                    if_true,
                    if_false,
                })),
                None => Some(CompiledLogicNode::Terminal(LogicOp::ConditionBool {
                    condition: compare_expr,
                    if_true,
                    if_false,
                })),
            }
        }
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

fn resolve_bool_expr_from_ports(
    graph: &StoredNodeGraph,
    node: &StoredNodeGraphNode,
    ports: &[&str],
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
) -> Option<LogicBoolExpr> {
    ports.iter().find_map(|port| {
        resolve_bool_expr_from_input(graph, &node.id, port, runtime_entities, visited)
    })
}

fn resolve_bool_expr_from_input(
    graph: &StoredNodeGraph,
    to_node_id: &str,
    to_port: &str,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
) -> Option<LogicBoolExpr> {
    let edge = graph
        .edges
        .iter()
        .find(|edge| edge.to_node == to_node_id && edge.to_port == to_port)?;
    let source_node = graph
        .nodes
        .iter()
        .find(|node| node.id == edge.from_node)?;
    build_bool_expr_from_node(
        source_node,
        &edge.from_port,
        graph,
        runtime_entities,
        visited,
    )
}

fn build_bool_expr_from_node(
    node: &StoredNodeGraphNode,
    from_port: &str,
    graph: &StoredNodeGraph,
    runtime_entities: &HashMap<String, LogicRuntimeEntity>,
    visited: &mut std::collections::HashSet<String>,
) -> Option<LogicBoolExpr> {
    if !visited.insert(node.id.clone()) {
        return None;
    }

    let expression = match node.node_type.as_str() {
        "condition_overlap" => {
            let left = runtime_entities
                .get(&param_string(node, "a")?)?
                .collision_target
                .clone();
            let right = runtime_entities
                .get(&param_string(node, "b")?)?
                .collision_target
                .clone();
            let overlap = LogicBoolExpr::Overlap { left, right };
            if from_port == "false" {
                Some(LogicBoolExpr::Not(Box::new(overlap)))
            } else {
                Some(overlap)
            }
        }
        "logic_and" => {
            let left = resolve_bool_expr_from_input(graph, &node.id, "a", runtime_entities, visited)
                .unwrap_or(LogicBoolExpr::Literal(false));
            let right =
                resolve_bool_expr_from_input(graph, &node.id, "b", runtime_entities, visited)
                    .unwrap_or(LogicBoolExpr::Literal(false));
            Some(LogicBoolExpr::And {
                result_name: format!("_and_{}", sanitize_identifier(&node.id)),
                left: Box::new(left),
                right: Box::new(right),
            })
        }
        "condition_compare" => {
            let op_str = param_string(node, "operator").unwrap_or_else(|| "==".to_string());
            let op = parse_compare_op(&op_str);
            let left = resolve_math_expr_from_input(graph, &node.id, "a")?;
            let right = resolve_math_expr_from_input(graph, &node.id, "b")?;
            let compare = LogicBoolExpr::Compare {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
            if from_port == "false" {
                Some(LogicBoolExpr::Not(Box::new(compare)))
            } else {
                Some(compare)
            }
        }
        _ => None,
    };

    visited.remove(&node.id);
    expression
}

fn parse_compare_op(op_str: &str) -> CompareOp {
    match op_str {
        "!=" => CompareOp::Neq,
        ">" => CompareOp::Gt,
        ">=" => CompareOp::Gte,
        "<" => CompareOp::Lt,
        "<=" => CompareOp::Lte,
        _ => CompareOp::Eq,
    }
}

fn resolve_math_expr_from_input(
    graph: &StoredNodeGraph,
    to_node_id: &str,
    to_port: &str,
) -> Option<LogicMathExpr> {
    if let Some(edge) = graph.edges.iter().find(|edge| edge.to_node == to_node_id && edge.to_port == to_port) {
        if let Some(source_node) = graph.nodes.iter().find(|node| node.id == edge.from_node) {
            return build_math_expr_from_node(source_node, graph);
        }
    }
    
    let to_node = graph.nodes.iter().find(|node| node.id == to_node_id)?;
    if let Some(Value::Number(num)) = to_node.params.get(to_port) {
        if let Some(val) = num.as_i64() {
            return Some(LogicMathExpr::Literal(val as i32));
        }
    }
    if let Some(Value::String(s)) = to_node.params.get(to_port) {
        if let Ok(val) = s.parse::<i32>() {
            return Some(LogicMathExpr::Literal(val));
        }
    }
    
    Some(LogicMathExpr::Literal(0))
}

fn build_math_expr_from_node(
    node: &StoredNodeGraphNode,
    graph: &StoredNodeGraph,
) -> Option<LogicMathExpr> {
    match node.node_type.as_str() {
        "logic_math" => {
            let op_str = param_string(node, "operator").unwrap_or_else(|| "+".to_string());
            let a = resolve_math_expr_from_input(graph, &node.id, "a").unwrap_or(LogicMathExpr::Literal(0));
            let b = resolve_math_expr_from_input(graph, &node.id, "b").unwrap_or(LogicMathExpr::Literal(0));
            match op_str.as_str() {
                "-" => Some(LogicMathExpr::Sub(Box::new(a), Box::new(b))),
                "*" => Some(LogicMathExpr::Mul(Box::new(a), Box::new(b))),
                "/" => Some(LogicMathExpr::Div(Box::new(a), Box::new(b))),
                _ => Some(LogicMathExpr::Add(Box::new(a), Box::new(b))),
            }
        }
        "var_get" => {
            let var_name = sanitize_identifier(&param_string(node, "var_name").unwrap_or_else(|| "temp_var".to_string()));
            Some(LogicMathExpr::Var(var_name))
        }
        _ => Some(LogicMathExpr::Literal(param_i32(node, "value", 0))),
    }
}

fn normalize_scroll_layer(layer: &str) -> String {
    match sanitize_identifier(layer).as_str() {
        "bg1" | "bg_a" | "bga" => "BG_A".to_string(),
        "bg2" | "bg_b" | "bgb" => "BG_B".to_string(),
        "bg3" | "window" => "WINDOW".to_string(),
        other if !other.is_empty() => other.to_uppercase(),
        _ => "BG_A".to_string(),
    }
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

fn param_bool(node: &StoredNodeGraphNode, key: &str, default: bool) -> bool {
    node.params
        .get(key)
        .and_then(|value| match value {
            Value::Bool(flag) => Some(*flag),
            Value::Number(number) => number.as_i64().map(|value| value != 0),
            Value::String(text) => match text.as_str() {
                "1" | "true" | "TRUE" => Some(true),
                "0" | "false" | "FALSE" => Some(false),
                _ => None,
            },
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

pub fn collect_sfx_resources(ast: &AstOutput) -> Vec<(String, String)> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::InitAudio { sfx_resources } => Some(sfx_resources.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

pub fn collect_parallax_layers(ast: &AstOutput) -> Vec<ParallaxLayerConfig> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::SetupParallax { layers } => Some(layers.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

pub fn collect_raster_lines(ast: &AstOutput) -> Vec<RasterLineConfig> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::SetupRasterEffect { lines } => Some(lines.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

pub fn collect_bgm_tracks(ast: &AstOutput) -> Vec<(String, String)> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::PlayBgm {
                resource_name,
                asset_path,
            } => Some((resource_name.clone(), asset_path.clone())),
            _ => None,
        })
        .collect()
}

pub fn collect_logic_sound_names(ast: &AstOutput) -> Vec<String> {
    let mut sound_names = std::collections::BTreeSet::new();
    for script in &ast.logic_scripts {
        collect_logic_sound_names_from_ops(&script.ops, &mut sound_names);
    }
    sound_names.into_iter().collect()
}

fn collect_logic_sound_names_from_ops(
    ops: &[LogicOp],
    sound_names: &mut std::collections::BTreeSet<String>,
) {
    for op in ops {
        match op {
            LogicOp::PlaySound { sfx } => {
                sound_names.insert(sfx.clone());
            }
            LogicOp::SetVar { .. } => {}
            LogicOp::ConditionOverlap {
                if_true, if_false, ..
            } => {
                collect_logic_sound_names_from_ops(if_true, sound_names);
                collect_logic_sound_names_from_ops(if_false, sound_names);
            }
            LogicOp::ConditionBool {
                if_true, if_false, ..
            } => {
                collect_logic_sound_names_from_ops(if_true, sound_names);
                collect_logic_sound_names_from_ops(if_false, sound_names);
            }
            LogicOp::StateMachine { states, .. } => {
                for state in states {
                    collect_logic_sound_names_from_ops(&state.body, sound_names);
                    for transition in &state.transitions {
                        collect_logic_sound_names_from_ops(&transition.if_matched, sound_names);
                        collect_logic_sound_names_from_ops(&transition.if_unmatched, sound_names);
                    }
                }
            }
            LogicOp::MoveSprite { .. } => {}
        }
    }
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

pub fn collect_physics_applications(ast: &AstOutput) -> Vec<PhysicsApplication> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::ApplyPhysics {
                var_name,
                gravity,
                gravity_strength,
                max_velocity_x,
                max_velocity_y,
                friction,
                bounce,
            } => Some(PhysicsApplication {
                var_name: var_name.clone(),
                gravity: *gravity,
                gravity_strength: *gravity_strength,
                max_velocity_x: *max_velocity_x,
                max_velocity_y: *max_velocity_y,
                friction: *friction,
                bounce: *bounce,
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
    fn generate_ast_emits_apply_physics_for_sprite_entities() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Physics Demo".to_string(),
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
                        palette_slot: 0,
                        animations: HashMap::new(),
                        priority: "foreground".to_string(),
                    }),
                    physics: Some(crate::ugdm::components::PhysicsComponent {
                        gravity: true,
                        gravity_strength: 6,
                        max_velocity: Some(crate::ugdm::components::Velocity { x: 48, y: 96 }),
                        friction: 2,
                        bounce: 35,
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let applications = collect_physics_applications(&ast);

        assert_eq!(
            applications,
            vec![PhysicsApplication {
                var_name: "spr_hero".to_string(),
                gravity: true,
                gravity_strength: 6,
                max_velocity_x: 48,
                max_velocity_y: 96,
                friction: 2,
                bounce: 35,
            }]
        );
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::ApplyPhysics {
                var_name,
                gravity,
                gravity_strength,
                max_velocity_x,
                max_velocity_y,
                friction,
                bounce,
            } if var_name == "spr_hero"
                && *gravity
                && *gravity_strength == 6
                && *max_velocity_x == 48
                && *max_velocity_y == 96
                && *friction == 2
                && *bounce == 35
        )));
    }

    #[test]
    fn generate_ast_emits_audio_nodes_from_audio_components() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Audio Demo".to_string(),
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
        let mut player_sfx = HashMap::new();
        player_sfx.insert("jump".to_string(), "assets/audio/jump.wav".to_string());
        player_sfx.insert("dash".to_string(), "assets/audio/dash.wav".to_string());
        let mut support_sfx = HashMap::new();
        support_sfx.insert("jump".to_string(), "assets/audio/duplicate.wav".to_string());

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
                        audio: Some(crate::ugdm::components::AudioComponent {
                            sfx: player_sfx,
                            bgm: Some("assets/audio/stage_theme.xgm".to_string()),
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "support".to_string(),
                    prefab: None,
                    transform: Transform { x: 40, y: 24 },
                    components: Components {
                        audio: Some(crate::ugdm::components::AudioComponent {
                            sfx: support_sfx,
                            bgm: Some("assets/audio/ignored_theme.xgm".to_string()),
                        }),
                        ..Components::default()
                    },
                },
            ],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);

        assert_eq!(
            collect_sfx_resources(&ast),
            vec![
                ("dash".to_string(), "assets/audio/dash.wav".to_string()),
                ("jump".to_string(), "assets/audio/jump.wav".to_string()),
            ]
        );
        assert_eq!(
            collect_bgm_tracks(&ast),
            vec![(
                "stage_theme".to_string(),
                "assets/audio/stage_theme.xgm".to_string()
            )]
        );
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::InitAudio { sfx_resources }
                if sfx_resources.len() == 2
                    && sfx_resources[0].0 == "dash"
                    && sfx_resources[1].0 == "jump"
        )));
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::PlayBgm {
                resource_name,
                asset_path,
            } if resource_name == "stage_theme"
                && asset_path == "assets/audio/stage_theme.xgm"
        )));
    }

    #[test]
    fn generate_ast_emits_retrofx_nodes_for_enabled_layers_and_lines() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "RetroFX Demo".to_string(),
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
            entities: Vec::new(),
            palettes: Vec::new(),
            retrofx: Some(crate::ugdm::entities::RetroFXConfig {
                parallax_layers: vec![
                    crate::ugdm::entities::RetroFXParallaxLayer {
                        id: "p1".to_string(),
                        name: "BG_A".to_string(),
                        speed_x: 2,
                        speed_y: 1,
                        enabled: true,
                    },
                    crate::ugdm::entities::RetroFXParallaxLayer {
                        id: "p2".to_string(),
                        name: "BG_B".to_string(),
                        speed_x: 4,
                        speed_y: 0,
                        enabled: false,
                    },
                ],
                raster_lines: vec![
                    crate::ugdm::entities::RetroFXRasterLine {
                        id: "r1".to_string(),
                        scanline: 128,
                        offset_x: 6,
                        enabled: true,
                    },
                    crate::ugdm::entities::RetroFXRasterLine {
                        id: "r2".to_string(),
                        scanline: 260,
                        offset_x: 12,
                        enabled: true,
                    },
                ],
            }),
        };

        let ast = generate_ast(&project, &scene);

        assert_eq!(
            collect_parallax_layers(&ast),
            vec![ParallaxLayerConfig {
                layer_name: "BG_A".to_string(),
                speed_x: 2,
                speed_y: 1,
            }]
        );
        assert_eq!(
            collect_raster_lines(&ast),
            vec![
                RasterLineConfig {
                    scanline: 128,
                    offset_x: 6,
                },
                RasterLineConfig {
                    scanline: 223,
                    offset_x: 12,
                },
            ]
        );
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::SetupParallax { layers }
                if layers.len() == 1
                    && layers[0].layer_name == "BG_A"
                    && layers[0].speed_x == 2
                    && layers[0].speed_y == 1
        )));
        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::SetupRasterEffect { lines }
                if lines.len() == 2
                    && lines[0].scanline == 128
                    && lines[1].scanline == 223
        )));
    }

    #[test]
    fn generate_ast_compiles_effect_parallax_nodes_into_retrofx_setup() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic RetroFX".to_string(),
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
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "parallax",
                    "type": "effect_parallax",
                    "label": "Parallax",
                    "x": 120,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "layer": "BG_A", "speed_x": 3, "speed_y": 1 }
                },
                {
                    "id": "raster",
                    "type": "effect_raster",
                    "label": "Raster",
                    "x": 240,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "scanline": 96, "offset_x": 4 }
                }
            ],
            "edges": [
                { "id": "edge_1", "fromNode": "start", "fromPort": "exec", "toNode": "parallax", "toPort": "exec" },
                { "id": "edge_2", "fromNode": "parallax", "fromPort": "exec", "toNode": "raster", "toPort": "exec" }
            ]
        });
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "controller".to_string(),
                prefab: None,
                transform: Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(crate::ugdm::components::LogicComponent {
                        graph: Some(logic_graph.to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let sgdk = crate::compiler::sgdk_emitter::emit_sgdk(&ast, "Logic RetroFX");

        assert_eq!(
            collect_parallax_layers(&ast),
            vec![ParallaxLayerConfig {
                layer_name: "BG_A".to_string(),
                speed_x: 3,
                speed_y: 1,
            }]
        );
        assert_eq!(
            collect_raster_lines(&ast),
            vec![RasterLineConfig {
                scanline: 96,
                offset_x: 4,
            }]
        );
        assert!(sgdk
            .main_c
            .contains("VDP_setHorizontalScrollLine(BG_A, 0, retro_hscroll_table, 224, DMA);"));
        assert!(sgdk.main_c.contains("retro_hscroll_table[96] += 4;"));
    }

    #[test]
    fn generate_ast_compiles_sprite_anim_nodes_into_setup_set_animation() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic Animation".to_string(),
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
        let mut animations = HashMap::new();
        animations.insert(
            "idle".to_string(),
            AnimationDef {
                frames: vec![0],
                fps: 6,
                looping: true,
            },
        );
        animations.insert(
            "run".to_string(),
            AnimationDef {
                frames: vec![1, 2, 3],
                fps: 12,
                looping: true,
            },
        );
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
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "anim",
                    "type": "sprite_anim",
                    "label": "Set Animation",
                    "x": 120,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "target": "hero", "anim": "run" }
                }
            ],
            "edges": [
                { "id": "edge_1", "fromNode": "start", "fromPort": "exec", "toNode": "anim", "toPort": "exec" }
            ]
        });
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "hero".to_string(),
                prefab: None,
                transform: Transform { x: 16, y: 24 },
                components: Components {
                    sprite: Some(SpriteComponent {
                        asset: "assets/sprites/hero.png".to_string(),
                        frame_width: 16,
                        frame_height: 16,
                        pivot: None,
                        palette_slot: 0,
                        animations,
                        priority: "foreground".to_string(),
                    }),
                    logic: Some(crate::ugdm::components::LogicComponent {
                        graph: Some(logic_graph.to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let game_loop_index = ast
            .nodes
            .iter()
            .position(|node| matches!(node, AstNode::GameLoopBegin))
            .expect("game loop should exist");
        let runtime_anim_index = ast
            .nodes
            .iter()
            .enumerate()
            .find_map(|(index, node)| match node {
                AstNode::SetAnimation {
                    var_name,
                    resource_name,
                    anim_index,
                    frame_time,
                    frames,
                    looping,
                } if *anim_index == 1 => Some((
                    index,
                    var_name.clone(),
                    resource_name.clone(),
                    *frame_time,
                    frames.clone(),
                    *looping,
                )),
                _ => None,
            })
            .expect("sprite_anim should emit a SetAnimation node");

        assert!(runtime_anim_index.0 < game_loop_index);
        assert_eq!(runtime_anim_index.1, "spr_hero");
        assert_eq!(runtime_anim_index.2, "hero");
        assert_eq!(runtime_anim_index.3, 5);
        assert_eq!(runtime_anim_index.4, vec![1, 2, 3]);
        assert!(runtime_anim_index.5);
    }

    #[test]
    fn generate_ast_compiles_scroll_tilemap_nodes_into_runtime_scroll_commands() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic Scroll".to_string(),
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
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "scroll",
                    "type": "scroll_tilemap",
                    "label": "Scroll Tilemap",
                    "x": 120,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "layer": "BG_B", "dx": 3, "dy": -2 }
                }
            ],
            "edges": [
                { "id": "edge_1", "fromNode": "start", "fromPort": "exec", "toNode": "scroll", "toPort": "exec" }
            ]
        });
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "controller".to_string(),
                prefab: None,
                transform: Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(crate::ugdm::components::LogicComponent {
                        graph: Some(logic_graph.to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);

        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::ScrollTilemap { layer, dx, dy }
                if layer == "BG_B" && *dx == 3 && *dy == -2
        )));
    }

    #[test]
    fn generate_ast_compiles_move_camera_nodes_with_follow_sprite_offsets() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic Camera".to_string(),
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
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "camera",
                    "type": "move_camera",
                    "label": "Move Camera",
                    "x": 120,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "target": "camera_rig", "x": 4, "y": -6 }
                }
            ],
            "edges": [
                { "id": "edge_1", "fromNode": "start", "fromPort": "exec", "toNode": "camera", "toPort": "exec" }
            ]
        });
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![
                Entity {
                    entity_id: "hero".to_string(),
                    prefab: None,
                    transform: Transform { x: 16, y: 24 },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset: "assets/sprites/hero.png".to_string(),
                            frame_width: 16,
                            frame_height: 16,
                            pivot: None,
                            palette_slot: 0,
                            animations: HashMap::new(),
                            priority: "foreground".to_string(),
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "camera_rig".to_string(),
                    prefab: None,
                    transform: Transform { x: 0, y: 0 },
                    components: Components {
                        camera: Some(crate::ugdm::components::CameraComponent {
                            follow_entity: Some("hero".to_string()),
                            offset_x: 12,
                            offset_y: 8,
                        }),
                        logic: Some(crate::ugdm::components::LogicComponent {
                            graph: Some(logic_graph.to_string()),
                            variables: HashMap::new(),
                        }),
                        ..Components::default()
                    },
                },
            ],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);

        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::MoveCamera { target, x, y }
                if target == "spr_hero" && *x == 16 && *y == 2
        )));
    }

    #[test]
    fn generate_ast_compiles_logic_and_between_overlap_nodes_into_bool_guard() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic And".to_string(),
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
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "overlap_a",
                    "type": "condition_overlap",
                    "label": "Overlap A",
                    "x": 120,
                    "y": 0,
                    "inputs": [],
                    "outputs": [
                        { "id": "true", "label": "True", "kind": "exec" },
                        { "id": "false", "label": "False", "kind": "exec" }
                    ],
                    "params": { "a": "player", "b": "enemy" }
                },
                {
                    "id": "overlap_b",
                    "type": "condition_overlap",
                    "label": "Overlap B",
                    "x": 120,
                    "y": 120,
                    "inputs": [],
                    "outputs": [
                        { "id": "true", "label": "True", "kind": "exec" },
                        { "id": "false", "label": "False", "kind": "exec" }
                    ],
                    "params": { "a": "player", "b": "pickup" }
                },
                {
                    "id": "logic_gate",
                    "type": "logic_and",
                    "label": "AND",
                    "x": 260,
                    "y": 60,
                    "inputs": [
                        { "id": "a", "label": "A", "kind": "data", "dataType": "bool" },
                        { "id": "b", "label": "B", "kind": "data", "dataType": "bool" }
                    ],
                    "outputs": [{ "id": "out", "label": "Out", "kind": "data", "dataType": "bool" }],
                    "params": {}
                },
                {
                    "id": "guarded_overlap",
                    "type": "condition_overlap",
                    "label": "Guarded",
                    "x": 420,
                    "y": 0,
                    "inputs": [{ "id": "guard", "label": "guard", "kind": "data", "dataType": "bool" }],
                    "outputs": [
                        { "id": "true", "label": "True", "kind": "exec" },
                        { "id": "false", "label": "False", "kind": "exec" }
                    ],
                    "params": { "a": "player", "b": "enemy" }
                },
                {
                    "id": "sound",
                    "type": "action_sound",
                    "label": "Play Sound",
                    "x": 580,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "sfx": "jump" }
                }
            ],
            "edges": [
                { "id": "edge_exec_1", "fromNode": "start", "fromPort": "exec", "toNode": "guarded_overlap", "toPort": "exec" },
                { "id": "edge_exec_2", "fromNode": "guarded_overlap", "fromPort": "true", "toNode": "sound", "toPort": "exec" },
                { "id": "edge_data_1", "fromNode": "overlap_a", "fromPort": "true", "toNode": "logic_gate", "toPort": "a" },
                { "id": "edge_data_2", "fromNode": "overlap_b", "fromPort": "true", "toNode": "logic_gate", "toPort": "b" },
                { "id": "edge_data_3", "fromNode": "logic_gate", "fromPort": "out", "toNode": "guarded_overlap", "toPort": "guard" }
            ]
        });
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
                            collides_with: vec!["enemy".to_string(), "pickup".to_string()],
                        }),
                        logic: Some(crate::ugdm::components::LogicComponent {
                            graph: Some(logic_graph.to_string()),
                            variables: HashMap::new(),
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "enemy".to_string(),
                    prefab: None,
                    transform: Transform { x: 32, y: 24 },
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
                            offset: None,
                            solid: true,
                            layer: Some("enemy".to_string()),
                            collides_with: vec!["player".to_string()],
                        }),
                        ..Components::default()
                    },
                },
                Entity {
                    entity_id: "pickup".to_string(),
                    prefab: None,
                    transform: Transform { x: 24, y: 24 },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset: "assets/sprites/pickup.png".to_string(),
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
                            solid: false,
                            layer: Some("pickup".to_string()),
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

        let guarded = ast
            .logic_scripts
            .iter()
            .flat_map(|script| script.ops.iter())
            .find_map(|op| match op {
                LogicOp::ConditionBool { condition, if_true, .. } => Some((condition, if_true)),
                _ => None,
            })
            .expect("logic_and should compile into a guarded condition");

        assert!(matches!(
            guarded.0,
            LogicBoolExpr::And { result_name, .. } if result_name == "_and_guarded_overlap"
        ));
        assert_eq!(
            guarded.1,
            &vec![LogicOp::PlaySound {
                sfx: "jump".to_string(),
            }]
        );
    }

    #[test]
    fn generate_ast_compiles_var_math_compare_and_true_false_branching() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic Vars".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution { width: 320, height: 224 },
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
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": {}
                },
                {
                    "id": "score_get",
                    "type": "var_get",
                    "label": "Get Score",
                    "x": 120,
                    "y": 0,
                    "inputs": [],
                    "outputs": [{ "id": "value", "label": "value", "kind": "data", "dataType": "number" }],
                    "params": { "var_name": "score" }
                },
                {
                    "id": "math_add",
                    "type": "logic_math",
                    "label": "Add",
                    "x": 240,
                    "y": 0,
                    "inputs": [],
                    "outputs": [{ "id": "value", "label": "value", "kind": "data", "dataType": "number" }],
                    "params": { "operator": "+", "b": 2 }
                },
                {
                    "id": "math_mul",
                    "type": "logic_math",
                    "label": "Mul",
                    "x": 360,
                    "y": 0,
                    "inputs": [],
                    "outputs": [{ "id": "value", "label": "value", "kind": "data", "dataType": "number" }],
                    "params": { "operator": "*", "b": 3 }
                },
                {
                    "id": "set_score",
                    "type": "var_set",
                    "label": "Set Score",
                    "x": 480,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "var_name": "score" }
                },
                {
                    "id": "compare",
                    "type": "condition_compare",
                    "label": "Compare",
                    "x": 600,
                    "y": 0,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [
                        { "id": "true", "label": "True", "kind": "exec" },
                        { "id": "false", "label": "False", "kind": "exec" }
                    ],
                    "params": { "operator": ">=", "b": 10 }
                },
                {
                    "id": "true_sound",
                    "type": "action_sound",
                    "label": "True Sound",
                    "x": 720,
                    "y": -40,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "sfx": "win" }
                },
                {
                    "id": "false_sound",
                    "type": "action_sound",
                    "label": "False Sound",
                    "x": 720,
                    "y": 40,
                    "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                    "params": { "sfx": "lose" }
                }
            ],
            "edges": [
                { "id": "exec_1", "fromNode": "start", "fromPort": "exec", "toNode": "set_score", "toPort": "exec" },
                { "id": "exec_2", "fromNode": "set_score", "fromPort": "exec", "toNode": "compare", "toPort": "exec" },
                { "id": "data_1", "fromNode": "score_get", "fromPort": "value", "toNode": "math_add", "toPort": "a" },
                { "id": "data_2", "fromNode": "math_add", "fromPort": "value", "toNode": "math_mul", "toPort": "a" },
                { "id": "data_3", "fromNode": "math_mul", "fromPort": "value", "toNode": "set_score", "toPort": "value" },
                { "id": "data_4", "fromNode": "score_get", "fromPort": "value", "toNode": "compare", "toPort": "a" },
                { "id": "exec_3", "fromNode": "compare", "fromPort": "true", "toNode": "true_sound", "toPort": "exec" },
                { "id": "exec_4", "fromNode": "compare", "fromPort": "false", "toNode": "false_sound", "toPort": "exec" }
            ]
        });
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "logic_host".to_string(),
                prefab: None,
                transform: Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(crate::ugdm::components::LogicComponent {
                        graph: Some(logic_graph.to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let script = ast.logic_scripts.first().expect("logic script should exist");

        assert!(script.ops.iter().any(|op| matches!(
            op,
            LogicOp::SetVar {
                var_name,
                value: LogicMathExpr::Mul(left, right)
            }
            if var_name == "score"
                && matches!(left.as_ref(), LogicMathExpr::Add(add_left, add_right)
                    if matches!(add_left.as_ref(), LogicMathExpr::Var(name) if name == "score")
                    && matches!(add_right.as_ref(), LogicMathExpr::Literal(2)))
                && matches!(right.as_ref(), LogicMathExpr::Literal(3))
        )));

        assert!(script.ops.iter().any(|op| matches!(
            op,
            LogicOp::ConditionBool {
                condition: LogicBoolExpr::Compare { op: CompareOp::Gte, left, right },
                if_true,
                if_false,
            }
            if matches!(left.as_ref(), LogicMathExpr::Var(name) if name == "score")
                && matches!(right.as_ref(), LogicMathExpr::Literal(10))
                && if_true == &vec![LogicOp::PlaySound { sfx: "win".to_string() }]
                && if_false == &vec![LogicOp::PlaySound { sfx: "lose".to_string() }]
        )));
    }

    #[test]
    fn generate_ast_maps_all_compare_operators_from_nodegraph() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "Logic Compare Ops".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution { width: 320, height: 224 },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let operators = [
            ("==", CompareOp::Eq),
            ("!=", CompareOp::Neq),
            (">", CompareOp::Gt),
            (">=", CompareOp::Gte),
            ("<", CompareOp::Lt),
            ("<=", CompareOp::Lte),
        ];

        for (index, (operator, expected_op)) in operators.into_iter().enumerate() {
            let graph = json!({
                "version": 1,
                "nodes": [
                    {
                        "id": "start",
                        "type": "event_start",
                        "label": "On Start",
                        "x": 0,
                        "y": 0,
                        "inputs": [],
                        "outputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                        "params": {}
                    },
                    {
                        "id": "lhs",
                        "type": "var_get",
                        "label": "LHS",
                        "x": 120,
                        "y": 0,
                        "inputs": [],
                        "outputs": [{ "id": "value", "label": "value", "kind": "data", "dataType": "number" }],
                        "params": { "var_name": "score" }
                    },
                    {
                        "id": "compare",
                        "type": "condition_compare",
                        "label": "Compare",
                        "x": 240,
                        "y": 0,
                        "inputs": [{ "id": "exec", "label": "exec", "kind": "exec" }],
                        "outputs": [{ "id": "true", "label": "True", "kind": "exec" }],
                        "params": { "operator": operator, "b": 7 }
                    }
                ],
                "edges": [
                    { "id": "exec_1", "fromNode": "start", "fromPort": "exec", "toNode": "compare", "toPort": "exec" },
                    { "id": "data_1", "fromNode": "lhs", "fromPort": "value", "toNode": "compare", "toPort": "a" }
                ]
            });
            let scene = Scene {
                scene_id: "main".to_string(),
                schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
                display_name: Some("Main".to_string()),
                background_layers: Vec::new(),
                entities: vec![Entity {
                    entity_id: format!("logic_host_{}", index),
                    prefab: None,
                    transform: Transform { x: 0, y: 0 },
                    components: Components {
                        logic: Some(crate::ugdm::components::LogicComponent {
                            graph: Some(graph.to_string()),
                            variables: HashMap::new(),
                        }),
                        ..Components::default()
                    },
                }],
                palettes: Vec::new(),
                retrofx: None,
            };

            let ast = generate_ast(&project, &scene);
            let script = ast.logic_scripts.first().expect("logic script should exist");
            assert!(script.ops.iter().any(|op| matches!(
                op,
                LogicOp::ConditionBool {
                    condition: LogicBoolExpr::Compare { op, .. },
                    ..
                } if *op == expected_op
            )), "operator {} should map to {:?}", operator, expected_op);
        }
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

    #[test]
    fn generate_ast_compiles_fsm_builder_into_state_machine_logic() {
        let project = Project {
            rds_version: "1.0".to_string(),
            schema_version: crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string(),
            name: "FSM Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution { width: 320, height: 224 },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let logic_graph = json!({
            "version": 1,
            "nodes": [
                { "id": "idle", "type": "fsm_state", "label": "Idle", "x": 0, "y": 0, "inputs": [], "outputs": [], "params": { "state_name": "idle", "initial": 1 } },
                { "id": "run", "type": "fsm_state", "label": "Run", "x": 200, "y": 0, "inputs": [], "outputs": [], "params": { "state_name": "run", "initial": 0 } },
                { "id": "speed", "type": "var_get", "label": "Speed", "x": 100, "y": 120, "inputs": [], "outputs": [], "params": { "var_name": "speed" } },
                { "id": "idle_to_run", "type": "fsm_transition", "label": "Go Run", "x": 80, "y": 0, "inputs": [], "outputs": [], "params": { "target_state": "run" } },
                { "id": "run_to_idle", "type": "fsm_transition", "label": "Go Idle", "x": 280, "y": 0, "inputs": [], "outputs": [], "params": { "target_state": "idle" } },
                { "id": "move", "type": "sprite_move", "label": "Move", "x": 360, "y": 0, "inputs": [], "outputs": [], "params": { "target": "player", "dx": 2, "dy": 0 } }
            ],
            "edges": [
                { "id": "e1", "fromNode": "idle", "fromPort": "transitions", "toNode": "idle_to_run", "toPort": "exec" },
                { "id": "e2", "fromNode": "speed", "fromPort": "value", "toNode": "idle_to_run", "toPort": "condition" },
                { "id": "e3", "fromNode": "run", "fromPort": "exec", "toNode": "move", "toPort": "exec" },
                { "id": "e4", "fromNode": "run", "fromPort": "transitions", "toNode": "run_to_idle", "toPort": "exec" },
                { "id": "e5", "fromNode": "speed", "fromPort": "value", "toNode": "run_to_idle", "toPort": "condition" }
            ]
        });
        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
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
                    logic: Some(crate::ugdm::components::LogicComponent {
                        graph: Some(logic_graph.to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
        };

        let ast = generate_ast(&project, &scene);
        let state_machine = ast
            .logic_scripts
            .iter()
            .flat_map(|script| script.ops.iter())
            .find_map(|op| match op {
                LogicOp::StateMachine { machine_var, states } => Some((machine_var, states)),
                _ => None,
            })
            .expect("fsm graph should compile into a state machine");

        assert_eq!(state_machine.0, "fsm_state");
        assert_eq!(state_machine.1.len(), 2);
        assert_eq!(state_machine.1[0].state_name, "idle");
        assert_eq!(state_machine.1[1].state_name, "run");
        assert_eq!(state_machine.1[0].transitions[0].target_state, "run");
        assert_eq!(state_machine.1[1].transitions[0].target_state, "idle");
        assert_eq!(
            state_machine.1[1].body,
            vec![LogicOp::MoveSprite {
                target_var: "spr_player".to_string(),
                dx: 2,
                dy: 0,
            }]
        );
    }
}
