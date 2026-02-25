use crate::ugdm::entities::Scene;
use crate::hardware::HwStatus;

// ── SNES Hardware Constraints (doc 04 — imutável) ────────────────────────────
pub const SNES_VRAM_BYTES: u32 = 65_536;       // 64 KB (mesmo que MD)
pub const SNES_SPRITES_PER_SCREEN: u32 = 128;
#[allow(dead_code)]
pub const SNES_SPRITES_PER_SCANLINE: u32 = 32;
pub const SNES_PALETTE_SLOTS: u8 = 8;          // 8 paletas de 16 cores (modo 1)
pub const SNES_PALETTE_COLORS: u8 = 16;
pub const SNES_TILE_BYTES: u32 = 32;           // 8x8 @ 4bpp
#[allow(dead_code)]
pub const SNES_RESOLUTION_W: u32 = 256;
#[allow(dead_code)]
pub const SNES_RESOLUTION_H: u32 = 224;
pub const SNES_BG_LAYERS_MAX: u32 = 4;         // BG1-BG4 (modo 1 suporta 3 scrolling + window)

#[derive(Debug)]
pub struct ValidationError {
    pub message: String,
    pub is_fatal: bool,
}

impl ValidationError {
    fn fatal(msg: impl Into<String>) -> Self {
        Self { message: msg.into(), is_fatal: true }
    }
    fn warning(msg: impl Into<String>) -> Self {
        Self { message: msg.into(), is_fatal: false }
    }
}

/// Valida uma Scene contra as hardware constraints do SNES.
pub fn validate_scene(scene: &Scene) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();

    // ── Contagem de sprites ───────────────────────────────────────────────────
    let sprite_count = scene
        .entities
        .iter()
        .filter(|e| e.components.sprite.is_some())
        .count() as u32;

    if sprite_count > SNES_SPRITES_PER_SCREEN {
        errors.push(ValidationError::fatal(format!(
            "Sprite overflow: a cena tem {} sprites. Limite do SNES: {}.",
            sprite_count, SNES_SPRITES_PER_SCREEN
        )));
    }

    // ── Validação de dimensões de sprites (múltiplos de 8) ────────────────────
    for entity in &scene.entities {
        if let Some(spr) = &entity.components.sprite {
            if spr.frame_width % 8 != 0 || spr.frame_height % 8 != 0 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': dimensões de sprite ({} x {}) não são múltiplas de 8 (tile-aligned).",
                    entity.entity_id, spr.frame_width, spr.frame_height
                )));
            }

            // SNES suporta sprites de até 64x64 px
            if spr.frame_width > 64 || spr.frame_height > 64 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': sprite {}x{} excede o tamanho máximo nativo do SNES (64x64).",
                    entity.entity_id, spr.frame_width, spr.frame_height
                )));
            }

            if spr.palette_slot >= SNES_PALETTE_SLOTS {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': palette_slot {} inválido. O SNES suporta slots 0-7 (modo 1).",
                    entity.entity_id, spr.palette_slot
                )));
            }
        }
    }

    // ── Validação de background layers ────────────────────────────────────────
    if scene.background_layers.len() as u32 > SNES_BG_LAYERS_MAX {
        errors.push(ValidationError::fatal(format!(
            "A cena tem {} background layers. O SNES suporta no máximo {} (BG1-BG4).",
            scene.background_layers.len(),
            SNES_BG_LAYERS_MAX
        )));
    }

    // ── Estimativa de VRAM ────────────────────────────────────────────────────
    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(spr) = &entity.components.sprite {
            let tiles_w = (spr.frame_width / 8).max(1);
            let tiles_h = (spr.frame_height / 8).max(1);
            let total_frames: u32 = spr.animations
                .values()
                .flat_map(|a| a.frames.iter())
                .count() as u32;
            let unique_frames = total_frames.max(1);
            vram_used += tiles_w * tiles_h * unique_frames * SNES_TILE_BYTES;
        }
    }

    if vram_used > SNES_VRAM_BYTES {
        errors.push(ValidationError::fatal(format!(
            "VRAM Overflow: a cena consome {}KB de sprites. Limite do SNES: 64KB.",
            vram_used / 1024
        )));
    } else if vram_used > (SNES_VRAM_BYTES * 80 / 100) {
        errors.push(ValidationError::warning(format!(
            "VRAM Warning: uso de VRAM estimado em {}KB ({}% do limite de 64KB).",
            vram_used / 1024,
            vram_used * 100 / SNES_VRAM_BYTES
        )));
    }

    // ── Validação de paletas ──────────────────────────────────────────────────
    for palette in &scene.palettes {
        if palette.slot >= SNES_PALETTE_SLOTS {
            errors.push(ValidationError::fatal(format!(
                "Palette slot {} inválido. O SNES (modo 1) suporta slots 0-7.",
                palette.slot
            )));
        }
        if palette.colors.len() > SNES_PALETTE_COLORS as usize {
            errors.push(ValidationError::fatal(format!(
                "Paleta no slot {}: {} cores definidas. O SNES suporta no máximo 16 cores por paleta.",
                palette.slot,
                palette.colors.len()
            )));
        }
    }

    errors
}

// ── Hardware Status (para painel Hardware Limits) ─────────────────────────────

pub fn hw_status(scene: &Scene) -> HwStatus {
    let sprite_count = scene
        .entities
        .iter()
        .filter(|e| e.components.sprite.is_some())
        .count() as u32;

    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(spr) = &entity.components.sprite {
            let tiles_w = (spr.frame_width / 8).max(1);
            let tiles_h = (spr.frame_height / 8).max(1);
            let total_frames: u32 = spr.animations
                .values()
                .flat_map(|a| a.frames.iter())
                .count() as u32;
            let unique_frames = total_frames.max(1);
            vram_used += tiles_w * tiles_h * unique_frames * SNES_TILE_BYTES;
        }
    }

    let bg_layers = scene.background_layers.len() as u32;
    let validation = validate_scene(scene);
    let errors = validation.iter().filter(|e| e.is_fatal).map(|e| e.message.clone()).collect();
    let warnings = validation.iter().filter(|e| !e.is_fatal).map(|e| e.message.clone()).collect();

    HwStatus {
        vram_used,
        vram_limit: SNES_VRAM_BYTES,
        sprite_count,
        sprite_limit: SNES_SPRITES_PER_SCREEN,
        bg_layers,
        bg_layers_limit: SNES_BG_LAYERS_MAX,
        errors,
        warnings,
    }
}
