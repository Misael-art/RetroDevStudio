use serde::{Deserialize, Serialize};

use super::components::Components;
use super::serde_helpers::deserialize_f64_to_i32;

pub const CURRENT_SCHEMA_VERSION: &str = "1.6.0";

fn default_schema_version() -> String {
    CURRENT_SCHEMA_VERSION.to_string()
}

// ── Transform ─────────────────────────────────────────────────────────────────

/// Posição em pixels inteiros (hardware 16-bit não usa float).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Transform {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub y: i32,
}

// ── Entity ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entity {
    pub entity_id: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub prefab: Option<String>,
    pub transform: Transform,
    #[serde(default)]
    pub components: Components,
}

// ── Background Layer ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ScrollSpeed {
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub x: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetroFXParallaxLayer {
    pub id: String,
    pub name: String,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub speed_x: i32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub speed_y: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetroFXRasterLine {
    pub id: String,
    pub scanline: u32,
    #[serde(deserialize_with = "deserialize_f64_to_i32")]
    pub offset_x: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct RetroFXConfig {
    #[serde(default)]
    pub parallax_layers: Vec<RetroFXParallaxLayer>,
    #[serde(default)]
    pub raster_lines: Vec<RetroFXRasterLine>,
}

// ── Collision Map (grid-based, tile-aligned) ───────────────────────────────────

/// Mapa de colisão baseado em grid de tiles.
/// Cada byte em `data` é 0 (livre) ou 1 (sólido).
/// Índice = tile_y * width + tile_x.
/// Limites: MD = 40x28 tiles (320x224 @ 8x8), SNES = 32x28 tiles (256x224 @ 8x8).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollisionMap {
    /// Tamanho do tile em pixels (horizontal). Deve ser múltiplo de 8.
    #[serde(default = "default_tile_size")]
    pub tile_width: u8,
    /// Tamanho do tile em pixels (vertical). Deve ser múltiplo de 8.
    #[serde(default = "default_tile_size")]
    pub tile_height: u8,
    /// Número de tiles na horizontal.
    pub width: u32,
    /// Número de tiles na vertical.
    pub height: u32,
    /// Dados do mapa: 0 = livre, 1 = sólido. Tamanho esperado = width * height.
    #[serde(default)]
    pub data: Vec<u8>,
}

fn default_tile_size() -> u8 {
    8
}

impl CollisionMap {
    /// Cria um mapa de colisão vazio com as dimensões fornecidas.
    #[allow(dead_code)]
    pub fn empty(tile_width: u8, tile_height: u8, width: u32, height: u32) -> Self {
        Self {
            tile_width,
            tile_height,
            width,
            height,
            data: vec![0u8; (width * height) as usize],
        }
    }

    /// Retorna o índice correto no vetor `data` para a posição (tx, ty).
    #[allow(dead_code)]
    pub fn tile_index(&self, tx: u32, ty: u32) -> Option<usize> {
        if tx < self.width && ty < self.height {
            Some((ty * self.width + tx) as usize)
        } else {
            None
        }
    }

    /// Retorna se o tile em (tx, ty) é sólido.
    #[allow(dead_code)]
    pub fn is_solid(&self, tx: u32, ty: u32) -> bool {
        self.tile_index(tx, ty)
            .and_then(|i| self.data.get(i))
            .copied()
            .unwrap_or(0)
            != 0
    }

    /// Retorna `data` normalizado para o tamanho correto (width * height), preenchendo com 0
    /// se o slice for menor, ou truncando se for maior. Não muta `self`.
    pub fn normalize(&self) -> Vec<u8> {
        let expected = (self.width * self.height) as usize;
        let mut data = self.data.clone();
        data.resize(expected, 0);
        data
    }
}

// ── Scene Layer (editor metadata, no codegen impact) ─────────────────────────────

/// Camada de editor (schema 1.5.0+). Agrupa entidades por visibilidade e lock.
/// Puramente metadado de editor — não afeta codegen nem hardware profiles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SceneLayer {
    /// Identificador único da camada (slug, e.g. "layer_sprites").
    pub id: String,
    /// Nome exibido no painel de camadas.
    pub name: String,
    /// Tipo da camada: "sprite" | "tile" | "background" | "object".
    pub kind: String,
    /// Se false, entidades desta camada são omitidas do viewport.
    #[serde(default = "default_visible")]
    pub visible: bool,
    /// Se true, bloqueia edição das entidades no viewport.
    #[serde(default)]
    pub locked: bool,
    /// Ordem visual (z-order). Menor = mais atrás.
    #[serde(default)]
    pub depth: u32,
    /// IDs das entidades atribuídas a esta camada.
    #[serde(default)]
    pub entity_ids: Vec<String>,
}

fn default_visible() -> bool {
    true
}

// ── Scene ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Scene {
    pub scene_id: String,
    #[serde(default)]
    pub schema_version: Option<String>,
    pub display_name: Option<String>,
    #[serde(default)]
    pub background_layers: Vec<BackgroundLayer>,
    #[serde(default)]
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub palettes: Vec<PaletteEntry>,
    #[serde(default)]
    pub retrofx: Option<RetroFXConfig>,
    /// Mapa de colisão grid-based (schema 1.4.0+). None = sem mapa de colisão.
    #[serde(default)]
    pub collision_map: Option<CollisionMap>,
    /// Camadas de editor (schema 1.5.0+). None = sem sistema de camadas.
    #[serde(default)]
    pub layers: Option<Vec<SceneLayer>>,
}

// ── Build Config ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BuildConfig {
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
    #[serde(default = "default_optimization")]
    pub optimization: String,
    #[serde(default = "default_artifact_prefix")]
    pub artifact_prefix: String,
    #[serde(default)]
    pub patch_audit_log: Vec<PatchAuditEntry>,
}

fn default_output_dir() -> String {
    "build/".to_string()
}

fn default_optimization() -> String {
    "size".to_string()
}

fn default_artifact_prefix() -> String {
    "game".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchAuditEntry {
    pub timestamp_ms: u128,
    pub format: String,
    pub patch_path: String,
    pub patch_hash: String,
}

// ── Project ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TemplateMetadata {
    pub template_id: String,
    pub template_version: String,
    pub source_kind: String,
    pub source_path: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_engine: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_profile: Option<String>,
    pub imported_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Project {
    pub rds_version: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
    pub name: String,
    pub target: String, // "megadrive" | "snes"
    pub resolution: Resolution,
    pub fps: u32,
    #[serde(default = "default_palette_mode")]
    pub palette_mode: String,
    pub entry_scene: String,
    pub build: Option<BuildConfig>,
    #[serde(default)]
    pub template_metadata: Option<TemplateMetadata>,
}

fn default_palette_mode() -> String {
    "4x16".to_string()
}
