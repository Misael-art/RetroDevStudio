use crate::hardware::HwStatus;
use crate::ugdm::entities::Scene;

// Mega Drive Hardware Constraints (doc 04 — imutavel)
// Constantes marcadas como allow(dead_code) sao specs de hardware documentais;
// serao referenciadas pelo Hardware Constraint Engine na Sprint 1.5.
#[allow(dead_code)]
pub const MD_VRAM_BYTES: u32 = 65_536; // 64 KB
pub const MD_SPRITES_PER_SCREEN: u32 = 80;
pub const MD_SPRITE_WARNING_THRESHOLD: u32 = MD_SPRITES_PER_SCREEN * 80 / 100;
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
        Self {
            message: msg.into(),
            is_fatal: true,
        }
    }

    fn warning(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            is_fatal: false,
        }
    }
}

fn count_palette_banks_used(scene: &Scene) -> u32 {
    let mut used_slots = std::collections::BTreeSet::new();
    for palette in &scene.palettes {
        used_slots.insert(palette.slot);
    }
    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            used_slots.insert(sprite.palette_slot);
        }
    }
    used_slots.len() as u32
}

fn estimate_max_scanline_sprites(scene: &Scene) -> u32 {
    let mut y_events = Vec::new();
    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            let start_y = entity.transform.y;
            let end_y = start_y + sprite.frame_height as i32;
            y_events.push((start_y, 1i32));
            y_events.push((end_y, -1i32));
        }
    }

    y_events.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let mut max_scanline_sprites = 0i32;
    let mut current_scanline_sprites = 0i32;
    for (_, diff) in y_events {
        current_scanline_sprites += diff;
        if current_scanline_sprites > max_scanline_sprites {
            max_scanline_sprites = current_scanline_sprites;
        }
    }

    max_scanline_sprites.max(0) as u32
}

/// Valida uma Scene contra as hardware constraints do Mega Drive.
/// Retorna lista de erros/avisos. Erros fatais bloqueiam o build.
pub fn validate_scene(scene: &Scene) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();

    let sprite_count = scene
        .entities
        .iter()
        .filter(|entity| entity.components.sprite.is_some())
        .count() as u32;

    if sprite_count > MD_SPRITES_PER_SCREEN {
        errors.push(ValidationError::fatal(format!(
            "Sprite overflow: a cena tem {} sprites. Limite do Mega Drive (H40): {}.",
            sprite_count, MD_SPRITES_PER_SCREEN
        )));
    } else if sprite_count > MD_SPRITE_WARNING_THRESHOLD {
        errors.push(ValidationError::warning(format!(
            "Sprite Warning: a cena tem {} sprites ({}% do limite do Mega Drive (H40): {}). Pouca folga para efeitos e HUD.",
            sprite_count,
            sprite_count * 100 / MD_SPRITES_PER_SCREEN,
            MD_SPRITES_PER_SCREEN
        )));
    }

    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            if sprite.frame_width % 8 != 0 || sprite.frame_height % 8 != 0 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': dimensoes de sprite ({} x {}) nao sao multiplas de 8 (tile-aligned).",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            if sprite.frame_width > 32 || sprite.frame_height > 32 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': sprite {}x{} excede o tamanho maximo nativo do Mega Drive (32x32). Use meta-sprites compostos.",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            if sprite.palette_slot >= MD_PALETTE_SLOTS {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': palette_slot {} invalido. O Mega Drive suporta slots 0-3.",
                    entity.entity_id, sprite.palette_slot
                )));
            }
        }
    }

    let max_scanline_sprites = estimate_max_scanline_sprites(scene);
    if max_scanline_sprites > MD_SPRITES_PER_SCANLINE {
        errors.push(ValidationError::warning(format!(
            "Sprite Scanline Warning: ha ate {} sprites alinhados horizontalmente. O Mega Drive exibe no maximo {} sprites por linha. Sprites extras piscarao (flicker).",
            max_scanline_sprites, MD_SPRITES_PER_SCANLINE
        )));
    }

    if scene.background_layers.len() > 3 {
        errors.push(ValidationError::fatal(format!(
            "A cena tem {} background layers. O Mega Drive suporta no maximo 3 (Scroll A, Scroll B, Window).",
            scene.background_layers.len()
        )));
    }

    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            let tiles_w = sprite.frame_width / 8;
            let tiles_h = sprite.frame_height / 8;
            let total_frames = sprite
                .animations
                .values()
                .flat_map(|animation| animation.frames.iter())
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
            "VRAM Warning: uso de VRAM estimado em {}KB ({}% do limite de 64KB). Pouco espaco para tiles de background.",
            vram_used / 1024,
            vram_used * 100 / MD_VRAM_BYTES
        )));
    }

    let dma_used = vram_used;
    if dma_used > (MD_DMA_VBLANK_BYTES * 80 / 100) {
        errors.push(ValidationError::warning(format!(
            "DMA Warning: upload estimado em {}KB por frame ({}% do budget de {}KB no VBlank).",
            dma_used / 1024,
            dma_used * 100 / MD_DMA_VBLANK_BYTES,
            MD_DMA_VBLANK_BYTES / 1024
        )));
    }

    for palette in &scene.palettes {
        if palette.slot >= MD_PALETTE_SLOTS {
            errors.push(ValidationError::fatal(format!(
                "Palette slot {} invalido. O Mega Drive tem apenas slots 0-3.",
                palette.slot
            )));
        }
        if palette.colors.len() > MD_PALETTE_COLORS as usize {
            errors.push(ValidationError::fatal(format!(
                "Paleta no slot {}: {} cores definidas. O Mega Drive suporta no maximo 16 cores por paleta.",
                palette.slot,
                palette.colors.len()
            )));
        }
    }

    let palette_banks_used = count_palette_banks_used(scene);
    if palette_banks_used > MD_PALETTE_SLOTS as u32 {
        errors.push(ValidationError::warning(format!(
            "Palette Warning: {} bancos de paleta em uso. Limite do Mega Drive: {}.",
            palette_banks_used, MD_PALETTE_SLOTS
        )));
    }

    errors
}

/// Calcula o `HwStatus` de uma cena sem retornar apenas pass/fail.
/// Usado pelo comando IPC `get_hw_status` para alimentar o painel UI.
pub fn hw_status(scene: &Scene) -> HwStatus {
    let sprite_count = scene
        .entities
        .iter()
        .filter(|entity| entity.components.sprite.is_some())
        .count() as u32;

    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            let tiles_w = (sprite.frame_width / 8).max(1);
            let tiles_h = (sprite.frame_height / 8).max(1);
            let total_frames = sprite
                .animations
                .values()
                .flat_map(|animation| animation.frames.iter())
                .count() as u32;
            let unique_frames = total_frames.max(1);
            vram_used += tiles_w * tiles_h * unique_frames * MD_TILE_BYTES;
        }
    }

    let validation = validate_scene(scene);
    let errors: Vec<String> = validation
        .iter()
        .filter(|error| error.is_fatal)
        .map(|error| error.message.clone())
        .collect();
    let warnings: Vec<String> = validation
        .iter()
        .filter(|error| !error.is_fatal)
        .map(|error| error.message.clone())
        .collect();

    HwStatus {
        vram_used,
        vram_limit: MD_VRAM_BYTES,
        sprite_count,
        sprite_limit: MD_SPRITES_PER_SCREEN,
        scanline_sprite_peak: estimate_max_scanline_sprites(scene),
        scanline_sprite_limit: MD_SPRITES_PER_SCANLINE,
        dma_used: vram_used,
        dma_limit: MD_DMA_VBLANK_BYTES,
        palette_banks_used: count_palette_banks_used(scene),
        palette_banks_limit: MD_PALETTE_SLOTS as u32,
        bg_layers: scene.background_layers.len() as u32,
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
            schema_version: Some(crate::ugdm::entities::CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main Scene".to_string()),
            background_layers: Vec::new(),
            entities: Vec::new(),
            palettes: Vec::new(),
            retrofx: None,
        }
    }

    #[test]
    fn rejects_sprite_overflow() {
        let mut scene = empty_scene();
        scene.entities = (0..=MD_SPRITES_PER_SCREEN)
            .map(|index| sprite_entity(&format!("entity_{index}"), 8, 8, 0))
            .collect();

        let errors = validate_scene(&scene);

        assert!(
            errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("Sprite overflow"))
        );
    }

    #[test]
    fn warns_when_sprite_pressure_is_high() {
        let mut scene = empty_scene();
        scene.entities = (0..=MD_SPRITE_WARNING_THRESHOLD)
            .map(|index| sprite_entity(&format!("entity_{index}"), 8, 8, 0))
            .collect();

        let errors = validate_scene(&scene);

        assert!(
            errors
                .iter()
                .any(|error| !error.is_fatal && error.message.contains("Sprite Warning"))
        );
        assert!(!errors.iter().any(|error| error.is_fatal));
    }

    #[test]
    fn warns_when_sprite_scanline_limit_exceeded() {
        let mut scene = empty_scene();
        scene.entities = (0..=(MD_SPRITES_PER_SCANLINE + 1))
            .map(|index| {
                let mut entity = sprite_entity(&format!("entity_{index}"), 8, 8, 0);
                entity.transform.y = 10;
                entity
            })
            .collect();

        let errors = validate_scene(&scene);

        assert!(
            errors.iter().any(|error| {
                !error.is_fatal && error.message.contains("Sprite Scanline Warning")
            })
        );
    }

    #[test]
    fn rejects_invalid_palette_slots() {
        let mut scene = empty_scene();
        scene
            .entities
            .push(sprite_entity("bad_palette", 8, 8, MD_PALETTE_SLOTS));
        scene.palettes.push(PaletteEntry {
            slot: MD_PALETTE_SLOTS,
            colors: vec!["#000000".to_string(); MD_PALETTE_COLORS as usize],
        });

        let errors = validate_scene(&scene);

        assert!(
            errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("palette_slot"))
        );
        assert!(
            errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("Palette slot"))
        );
    }

    #[test]
    fn reports_hw_status_for_valid_scene() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("player", 16, 16, 0));

        let status = hw_status(&scene);

        assert_eq!(status.sprite_count, 1);
        assert_eq!(status.sprite_limit, MD_SPRITES_PER_SCREEN);
        assert_eq!(status.scanline_sprite_peak, 1);
        assert_eq!(status.scanline_sprite_limit, MD_SPRITES_PER_SCANLINE);
        assert_eq!(status.dma_limit, MD_DMA_VBLANK_BYTES);
        assert_eq!(status.palette_banks_used, 1);
        assert_eq!(status.palette_banks_limit, MD_PALETTE_SLOTS as u32);
        assert_eq!(status.bg_layers_limit, 3);
        assert!(status.errors.is_empty());
    }
}
