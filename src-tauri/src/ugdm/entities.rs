use serde::{Deserialize, Serialize};
use super::components::Components;

// ── Transform ─────────────────────────────────────────────────────────────────

/// Posição em pixels inteiros (hardware 16-bit não usa float).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Transform {
    pub x: i32,
    pub y: i32,
}

// ── Entity ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entity {
    pub entity_id: String,
    pub prefab: Option<String>,
    pub transform: Transform,
    #[serde(default)]
    pub components: Components,
}

// ── Background Layer ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ScrollSpeed {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackgroundLayer {
    pub layer_id: String,
    pub depth: u32,
    pub tileset: String,
    pub scroll_speed: Option<ScrollSpeed>,
    pub tilemap: Option<String>,
}

// ── Palette ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PaletteEntry {
    pub slot: u8,
    pub colors: Vec<String>, // Hex strings "#RRGGBB"
}

// ── Scene ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Scene {
    pub scene_id: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub background_layers: Vec<BackgroundLayer>,
    #[serde(default)]
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub palettes: Vec<PaletteEntry>,
}

// ── Build Config ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BuildConfig {
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
    #[serde(default = "default_optimization")]
    pub optimization: String,
}

fn default_output_dir() -> String {
    "build/".to_string()
}

fn default_optimization() -> String {
    "size".to_string()
}

// ── Project ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Project {
    pub rds_version: String,
    pub name: String,
    pub target: String, // "megadrive" | "snes"
    pub resolution: Resolution,
    pub fps: u32,
    #[serde(default = "default_palette_mode")]
    pub palette_mode: String,
    pub entry_scene: String,
    pub build: Option<BuildConfig>,
}

fn default_palette_mode() -> String {
    "4x16".to_string()
}
