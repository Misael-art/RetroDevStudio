use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Sprite ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnimationDef {
    pub frames: Vec<u32>,
    pub fps: u32,
    #[serde(rename = "loop")]
    pub looping: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pivot {
    pub x: i32,
    pub y: i32,
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
}

fn default_priority() -> String {
    "foreground".to_string()
}

// ── Collision ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollisionOffset {
    pub x: i32,
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
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PhysicsComponent {
    #[serde(default = "default_true")]
    pub gravity: bool,
    #[serde(default = "default_gravity")]
    pub gravity_strength: i32,
    pub max_velocity: Option<Velocity>,
    #[serde(default)]
    pub friction: i32,
    #[serde(default)]
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
    pub graph: Option<String>,
    #[serde(default)]
    pub variables: HashMap<String, LogicVariable>,
}

// ── Camera ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CameraComponent {
    pub follow_entity: Option<String>,
    #[serde(default)]
    pub offset_x: i32,
    #[serde(default)]
    pub offset_y: i32,
}

// ── Tilemap ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TilemapComponent {
    pub tileset: String,
    pub map_width: u32,
    pub map_height: u32,
    #[serde(default)]
    pub scroll_x: i32,
    #[serde(default)]
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
