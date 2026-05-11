pub mod constraint_engine;
pub mod md_profile;
pub mod snes_profile;

use serde::Serialize;

/// Snapshot de uso de hardware de uma cena — tipo canônico compartilhado por todos os targets.
#[derive(Debug, Default, Serialize, Clone, PartialEq, Eq)]
pub struct HwStatus {
    pub vram_used: u32,
    pub vram_limit: u32,
    /// Modo de análise aplicado ao orçamento de VRAM.
    /// `native_static` (conservador) | `sgdk_managed` (residência/streaming).
    pub analysis_mode: String,
    /// Volume total de assets considerados na cena/projeto.
    pub project_asset_bytes: u32,
    /// Estimativa de bytes simultaneamente residentes na VRAM.
    pub resident_vram_bytes: u32,
    /// Estimativa de bytes potencialmente streamáveis (não residentes ao mesmo tempo).
    pub streamable_vram_bytes: u32,
    /// Estimativa de transferência por frame (janela de VBlank).
    pub dma_frame_bytes: u32,
    /// Mega Drive — bytes residentes atribuíveis a sprites (inclui HUD/overlays contados em `hud_resident_bytes`).
    pub sprite_resident_bytes: u32,
    /// Mega Drive — bytes residentes em tilemaps (mapa + tileset deduplicado por entidade).
    pub tilemap_resident_bytes: u32,
    /// Mega Drive — subconjunto auditável: residente em entidades com sinal canônico de HUD/overlay/UI.
    pub hud_resident_bytes: u32,
    /// Mega Drive — bytes de sprite fora do conjunto residente simultâneo (streaming).
    pub streamable_sprite_bytes: u32,
    /// Mega Drive — bytes por frame estimados para troca de animação (VRAM churn).
    pub animated_swap_bytes: u32,
    /// SGDK managed — bancos de sprite contados como residentes nesta rodada da heurística.
    pub managed_concurrent_sprite_banks: u32,
    /// SGDK managed — soma de `cell_cost` dos bancos residentes (orçamento vs `MD_MANAGED_SPRITE_CELL_BUDGET`).
    pub managed_sprite_cells_used: u32,
    /// Teto de bancos concorrentes da heurística `sgdk_managed` (referência auditável).
    pub managed_sprite_banks_limit: u32,
    /// Orçamento de células 32×32 da heurística `sgdk_managed` (referência auditável).
    pub managed_sprite_cells_budget: u32,
    pub sprite_count: u32,
    pub sprite_limit: u32,
    pub scanline_sprite_peak: u32,
    pub scanline_sprite_limit: u32,
    pub dma_used: u32,
    pub dma_limit: u32,
    pub palette_banks_used: u32,
    pub palette_banks_limit: u32,
    pub bg_layers: u32,
    pub bg_layers_limit: u32,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}
