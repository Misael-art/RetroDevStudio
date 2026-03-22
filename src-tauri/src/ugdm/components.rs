use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::serde_helpers::deserialize_f64_to_i32;

// ── Sprite ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pivot {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MugenCollisionBox {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x1: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub y1: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x2: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub y2: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MugenAnimationFrame {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub group: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub image: i32,
    pub axis: Option<Pivot>,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub duration: i32,
    #[serde(default)]
    pub flags: Vec<String>,
    #[serde(default)]
    pub clsn1: Vec<MugenCollisionBox>,
    #[serde(default)]
    pub clsn2: Vec<MugenCollisionBox>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnimationDef {
    pub frames: Vec<u32>,
    pub fps: u32,
    #[serde(rename = "loop")]
    pub looping: bool,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_durations: Option<Vec<i32>>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_start: Option<u32>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mugen_frames: Option<Vec<MugenAnimationFrame>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpriteComponent {
    pub asset: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub pivot: Option<Pivot>,
    #[serde(default)]
    pub palette_slot: u8,
    #[serde(default)]
    pub animations: HashMap<String, AnimationDef>,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub meta_sprite: bool,
}

fn default_priority() -> String {
    "foreground".to_string()
}

// ── Collision ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollisionOffset {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollisionComponent {
    pub shape: String,
    pub width: u32,
    pub height: u32,
    pub offset: Option<CollisionOffset>,
    #[serde(default = "default_true")]
    pub solid: bool,
    pub layer: Option<String>,
    #[serde(default)]
    pub collides_with: Vec<String>,
}

fn default_true() -> bool {
    true
}

// ── Input ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InputComponent {
    pub device: String,
    pub mapping: HashMap<String, String>,
}

// ── Physics ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Velocity {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PhysicsComponent {
    #[serde(default = "default_true")]
    pub gravity: bool,
    #[serde(
        default = "default_gravity",
        deserialize_with = "deserialize_f64_to_i32"
    )]
    pub gravity_strength: i32,
    pub max_velocity: Option<Velocity>,
    #[serde(default, deserialize_with = "deserialize_f64_to_i32")]
    pub friction: i32,
    #[serde(default, deserialize_with = "deserialize_f64_to_i32")]
    pub bounce: i32,
}

fn default_gravity() -> i32 {
    6
}

// ── Audio ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AudioComponent {
    #[serde(default)]
    pub sfx: HashMap<String, String>,
    pub bgm: Option<String>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogicVariable {
    #[serde(rename = "type")]
    pub var_type: String,
    pub default: serde_json::Value,
    pub min: Option<i64>,
    pub max: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogicComponent {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph_ref: Option<String>,
    #[serde(default)]
    pub variables: HashMap<String, LogicVariable>,
}

// ── Camera ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CameraComponent {
    pub follow_entity: Option<String>,
    #[serde(default, deserialize_with = "deserialize_f64_to_i32")]
    pub offset_x: i32,
    #[serde(default, deserialize_with = "deserialize_f64_to_i32")]
    pub offset_y: i32,
}

// ── Tilemap ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TilemapComponent {
    pub tileset: String,
    pub map_width: u32,
    pub map_height: u32,
    #[serde(default, deserialize_with = "deserialize_f64_to_i32")]
    pub scroll_x: i32,
    #[serde(default, deserialize_with = "deserialize_f64_to_i32")]
    pub scroll_y: i32,
}

// ── Components container ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Components {
    pub sprite: Option<SpriteComponent>,
    pub collision: Option<CollisionComponent>,
    pub input: Option<InputComponent>,
    pub physics: Option<PhysicsComponent>,
    pub audio: Option<AudioComponent>,
    pub logic: Option<LogicComponent>,
    pub camera: Option<CameraComponent>,
    pub tilemap: Option<TilemapComponent>,
}
