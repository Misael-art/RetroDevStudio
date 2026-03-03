use crate::hardware::HwStatus;
use crate::ugdm::entities::Scene;

pub const SNES_VRAM_BYTES: u32 = 65_536;
pub const SNES_SPRITES_PER_SCREEN: u32 = 128;
#[allow(dead_code)]
pub const SNES_SPRITES_PER_SCANLINE: u32 = 32;
pub const SNES_PALETTE_SLOTS: u8 = 8;
pub const SNES_PALETTE_COLORS: u8 = 16;
pub const SNES_TILE_BYTES: u32 = 32;
#[allow(dead_code)]
pub const SNES_RESOLUTION_W: u32 = 256;
#[allow(dead_code)]
pub const SNES_RESOLUTION_H: u32 = 224;
pub const SNES_BG_LAYERS_MAX: u32 = 4;

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

fn supported_simple_sprite_size(size: u32) -> bool {
    matches!(size, 8 | 16 | 32 | 64)
}

pub fn validate_scene(scene: &Scene) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();
    let mut canonical_sprite_size: Option<(u32, u32)> = None;

    let sprite_count = scene
        .entities
        .iter()
        .filter(|entity| entity.components.sprite.is_some())
        .count() as u32;

    if sprite_count > SNES_SPRITES_PER_SCREEN {
        errors.push(ValidationError::fatal(format!(
            "Sprite overflow: a cena tem {} sprites. Limite do SNES: {}.",
            sprite_count, SNES_SPRITES_PER_SCREEN
        )));
    }

    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            if sprite.frame_width % 8 != 0 || sprite.frame_height % 8 != 0 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': dimensoes de sprite ({} x {}) nao sao multiplas de 8.",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            if sprite.frame_width > 64 || sprite.frame_height > 64 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': sprite {}x{} excede o tamanho maximo nativo do SNES (64x64).",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            if sprite.frame_width != sprite.frame_height {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': o exporter SNES atual suporta apenas sprites simples quadrados (8x8, 16x16, 32x32 ou 64x64). Recebido: {}x{}.",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            if !supported_simple_sprite_size(sprite.frame_width)
                || !supported_simple_sprite_size(sprite.frame_height)
            {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': tamanho de sprite {}x{} nao suportado pelo caminho SNES atual. Use 8x8, 16x16, 32x32 ou 64x64.",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            match canonical_sprite_size {
                Some((width, height))
                    if width != sprite.frame_width || height != sprite.frame_height =>
                {
                    errors.push(ValidationError::fatal(format!(
                        "Entidade '{}': o exporter SNES atual exige uma unica classe de tamanho por cena. Esperado {}x{}, recebido {}x{}.",
                        entity.entity_id, width, height, sprite.frame_width, sprite.frame_height
                    )));
                }
                None => canonical_sprite_size = Some((sprite.frame_width, sprite.frame_height)),
                _ => {}
            }

            if sprite.palette_slot >= SNES_PALETTE_SLOTS {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': palette_slot {} invalido. O SNES suporta slots 0-7 (modo 1).",
                    entity.entity_id, sprite.palette_slot
                )));
            }
        }
    }

    if scene.background_layers.len() as u32 > SNES_BG_LAYERS_MAX {
        errors.push(ValidationError::fatal(format!(
            "A cena tem {} background layers. O SNES suporta no maximo {} (BG1-BG4).",
            scene.background_layers.len(),
            SNES_BG_LAYERS_MAX
        )));
    }

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

    for palette in &scene.palettes {
        if palette.slot >= SNES_PALETTE_SLOTS {
            errors.push(ValidationError::fatal(format!(
                "Palette slot {} invalido. O SNES (modo 1) suporta slots 0-7.",
                palette.slot
            )));
        }
        if palette.colors.len() > SNES_PALETTE_COLORS as usize {
            errors.push(ValidationError::fatal(format!(
                "Paleta no slot {}: {} cores definidas. O SNES suporta no maximo 16 cores por paleta.",
                palette.slot,
                palette.colors.len()
            )));
        }
    }

    errors
}

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
            vram_used += tiles_w * tiles_h * unique_frames * SNES_TILE_BYTES;
        }
    }

    let bg_layers = scene.background_layers.len() as u32;
    let validation = validate_scene(scene);
    let errors = validation
        .iter()
        .filter(|error| error.is_fatal)
        .map(|error| error.message.clone())
        .collect();
    let warnings = validation
        .iter()
        .filter(|error| !error.is_fatal)
        .map(|error| error.message.clone())
        .collect();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::components::{Components, SpriteComponent};
    use crate::ugdm::entities::{BackgroundLayer, Entity, Scene, Transform};

    fn sprite_entity(id: &str, frame_width: u32, frame_height: u32, palette_slot: u8) -> Entity {
        Entity {
            entity_id: id.to_string(),
            prefab: None,
            transform: Transform { x: 0, y: 0 },
            components: Components {
                sprite: Some(SpriteComponent {
                    asset: "assets/sprites/test.ppm".to_string(),
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
    fn rejects_background_layer_overflow() {
        let mut scene = empty_scene();
        scene.background_layers = (0..=SNES_BG_LAYERS_MAX)
            .map(|index| BackgroundLayer {
                layer_id: format!("bg_{index}"),
                depth: index,
                tileset: format!("assets/tilesets/bg_{index}.png"),
                scroll_speed: None,
                tilemap: None,
            })
            .collect();

        let errors = validate_scene(&scene);

        assert!(errors.iter().any(|error| {
            error.is_fatal && error.message.contains("background layers")
        }));
    }

    #[test]
    fn rejects_large_sprite_sizes() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("boss", 72, 64, 0));

        let errors = validate_scene(&scene);

        assert!(errors.iter().any(|error| {
            error.is_fatal && error.message.contains("64x64")
        }));
    }

    #[test]
    fn rejects_non_square_simple_sprite_shapes() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("runner", 16, 32, 0));

        let errors = validate_scene(&scene);

        assert!(errors.iter().any(|error| {
            error.is_fatal && error.message.contains("sprites simples quadrados")
        }));
    }

    #[test]
    fn reports_hw_status_for_valid_scene() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("player", 16, 16, 0));

        let status = hw_status(&scene);

        assert_eq!(status.sprite_count, 1);
        assert_eq!(status.sprite_limit, SNES_SPRITES_PER_SCREEN);
        assert_eq!(status.bg_layers_limit, SNES_BG_LAYERS_MAX);
        assert!(status.errors.is_empty());
    }
}
