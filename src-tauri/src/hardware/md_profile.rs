use crate::ugdm::entities::Scene;
use crate::hardware::HwStatus;

// ── Mega Drive Hardware Constraints (doc 04 — imutável) ───────────────────────
// Constantes marcadas como allow(dead_code) são specs de hardware documentais;
// serão referenciadas pelo Hardware Constraint Engine na Sprint 1.5.
#[allow(dead_code)]
pub const MD_VRAM_BYTES: u32 = 65_536; // 64 KB
pub const MD_SPRITES_PER_SCREEN: u32 = 80;
#[allow(dead_code)]
pub const MD_SPRITES_PER_SCANLINE: u32 = 20;
pub const MD_PALETTE_SLOTS: u8 = 4;
pub const MD_PALETTE_COLORS: u8 = 16;
pub const MD_TILE_BYTES: u32 = 32; // 8x8 @ 4bpp
#[allow(dead_code)]
pub const MD_DMA_VBLANK_BYTES: u32 = 7_372; // ~7.2 KB/frame (H40 NTSC)
#[allow(dead_code)]
pub const MD_RESOLUTION_W: u32 = 320;
#[allow(dead_code)]
pub const MD_RESOLUTION_H: u32 = 224;

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

/// Valida uma Scene contra as hardware constraints do Mega Drive.
/// Retorna lista de erros/avisos. Erros fatais bloqueiam o build.
pub fn validate_scene(scene: &Scene) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();

    // ── Contagem de sprites ───────────────────────────────────────────────────
    let sprite_count = scene
        .entities
        .iter()
        .filter(|e| e.components.sprite.is_some())
        .count() as u32;

    if sprite_count > MD_SPRITES_PER_SCREEN {
        errors.push(ValidationError::fatal(format!(
            "Sprite overflow: a cena tem {} sprites. Limite do Mega Drive (H40): {}.",
            sprite_count, MD_SPRITES_PER_SCREEN
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

            // Sprite size máximo: 32x32 px (4x4 tiles)
            if spr.frame_width > 32 || spr.frame_height > 32 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': sprite {}x{} excede o tamanho máximo nativo do Mega Drive (32x32). \
                     Use meta-sprites compostos.",
                    entity.entity_id, spr.frame_width, spr.frame_height
                )));
            }

            // Palette slot inválido
            if spr.palette_slot >= MD_PALETTE_SLOTS {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': palette_slot {} inválido. O Mega Drive suporta slots 0-3.",
                    entity.entity_id, spr.palette_slot
                )));
            }
        }
    }

    // ── Validação de background layers ────────────────────────────────────────
    // MD suporta 2 scroll planes (A e B) + 1 Window plane
    if scene.background_layers.len() > 3 {
        errors.push(ValidationError::fatal(format!(
            "A cena tem {} background layers. O Mega Drive suporta no máximo 3 (Scroll A, Scroll B, Window).",
            scene.background_layers.len()
        )));
    }

    // ── Estimativa de VRAM ────────────────────────────────────────────────────
    // Heurística: cada sprite frame ocupa (frame_w/8 * frame_h/8) tiles
    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(spr) = &entity.components.sprite {
            let tiles_w = spr.frame_width / 8;
            let tiles_h = spr.frame_height / 8;
            let total_frames: u32 = spr.animations
                .values()
                .flat_map(|a| a.frames.iter())
                .count() as u32;
            let unique_frames = total_frames.max(1);
            vram_used += tiles_w * tiles_h * unique_frames * MD_TILE_BYTES;
        }
    }

    if vram_used > MD_VRAM_BYTES {
        errors.push(ValidationError::fatal(format!(
            "VRAM Overflow: a cena consome {}KB de sprites. Limite do Mega Drive: 64KB.",
            vram_used / 1024
        )));
    } else if vram_used > (MD_VRAM_BYTES * 80 / 100) {
        errors.push(ValidationError::warning(format!(
            "VRAM Warning: uso de VRAM estimado em {}KB ({}% do limite de 64KB). Pouco espaço para tiles de background.",
            vram_used / 1024,
            vram_used * 100 / MD_VRAM_BYTES
        )));
    }

    // ── Validação de paletas ──────────────────────────────────────────────────
    for palette in &scene.palettes {
        if palette.slot >= MD_PALETTE_SLOTS {
            errors.push(ValidationError::fatal(format!(
                "Palette slot {} inválido. O Mega Drive tem apenas slots 0-3.",
                palette.slot
            )));
        }
        if palette.colors.len() > MD_PALETTE_COLORS as usize {
            errors.push(ValidationError::fatal(format!(
                "Paleta no slot {}: {} cores definidas. O Mega Drive suporta no máximo 16 cores por paleta.",
                palette.slot,
                palette.colors.len()
            )));
        }
    }

    // ── Coordenadas inteiras (sem float — verificação semântica) ──────────────
    // Rust garante isso pelo tipo i32 em Transform — sem verificação em runtime.

    errors
}

/// Calcula o `HwStatus` de uma cena sem retornar apenas pass/fail.
/// Usado pelo comando IPC `get_hw_status` para alimentar o painel UI.
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
            vram_used += tiles_w * tiles_h * unique_frames * MD_TILE_BYTES;
        }
    }

    let bg_layers = scene.background_layers.len() as u32;

    let validation = validate_scene(scene);
    let errors: Vec<String> = validation.iter().filter(|e| e.is_fatal).map(|e| e.message.clone()).collect();
    let warnings: Vec<String> = validation.iter().filter(|e| !e.is_fatal).map(|e| e.message.clone()).collect();

    HwStatus {
        vram_used,
        vram_limit: MD_VRAM_BYTES,
        sprite_count,
        sprite_limit: MD_SPRITES_PER_SCREEN,
        bg_layers,
        bg_layers_limit: 3,
        errors,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::components::{Components, SpriteComponent};
    use crate::ugdm::entities::{Entity, PaletteEntry, Scene, Transform};

    fn sprite_entity(id: &str, frame_width: u32, frame_height: u32, palette_slot: u8) -> Entity {
        Entity {
            entity_id: id.to_string(),
            prefab: None,
            transform: Transform { x: 0, y: 0 },
            components: Components {
                sprite: Some(SpriteComponent {
                    asset: "assets/sprites/test.png".to_string(),
                    frame_width,
                    frame_height,
                    pivot: None,
                    palette_slot,
                    animations: Default::default(),
                    priority: "foreground".to_string(),
                }),
                ..Default::default()
            },
        }
    }

    fn empty_scene() -> Scene {
        Scene {
            scene_id: "main".to_string(),
            display_name: Some("Main Scene".to_string()),
            background_layers: Vec::new(),
            entities: Vec::new(),
            palettes: Vec::new(),
        }
    }

    #[test]
    fn rejects_sprite_overflow() {
        let mut scene = empty_scene();
        scene.entities = (0..=MD_SPRITES_PER_SCREEN)
            .map(|index| sprite_entity(&format!("entity_{index}"), 8, 8, 0))
            .collect();

        let errors = validate_scene(&scene);

        assert!(errors.iter().any(|error| {
            error.is_fatal && error.message.contains("Sprite overflow")
        }));
    }

    #[test]
    fn rejects_invalid_palette_slots() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("bad_palette", 8, 8, MD_PALETTE_SLOTS));
        scene.palettes.push(PaletteEntry {
            slot: MD_PALETTE_SLOTS,
            colors: vec!["#000000".to_string(); MD_PALETTE_COLORS as usize],
        });

        let errors = validate_scene(&scene);

        assert!(errors.iter().any(|error| {
            error.is_fatal && error.message.contains("palette_slot")
        }));
        assert!(errors.iter().any(|error| {
            error.is_fatal && error.message.contains("Palette slot")
        }));
    }

    #[test]
    fn reports_hw_status_for_valid_scene() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("player", 16, 16, 0));

        let status = hw_status(&scene);

        assert_eq!(status.sprite_count, 1);
        assert_eq!(status.sprite_limit, MD_SPRITES_PER_SCREEN);
        assert_eq!(status.bg_layers_limit, 3);
        assert!(status.errors.is_empty());
    }
}
