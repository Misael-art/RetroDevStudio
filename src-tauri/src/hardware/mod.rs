pub mod constraint_engine;
pub mod md_profile;
pub mod snes_profile;

use serde::Serialize;

/// Snapshot de uso de hardware de uma cena — tipo canônico compartilhado por todos os targets.
#[derive(Debug, Default, Serialize, Clone, PartialEq, Eq)]
pub struct HwStatus {
    pub vram_used: u32,
    pub vram_limit: u32,
    pub sprite_count: u32,
    pub sprite_limit: u32,
    pub bg_layers: u32,
    pub bg_layers_limit: u32,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}
