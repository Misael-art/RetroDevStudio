use crate::hardware::HwStatus;
use crate::ugdm::entities::Scene;

pub const SNES_VRAM_BYTES: u32 = 65_536;
pub const SNES_SPRITES_PER_SCREEN: u32 = 128;
pub const SNES_SPRITE_WARNING_THRESHOLD: u32 = SNES_SPRITES_PER_SCREEN * 80 / 100;
#[allow(dead_code)]
pub const SNES_SPRITES_PER_SCANLINE: u32 = 32;
pub const SNES_PALETTE_SLOTS: u8 = 8;
pub const SNES_PALETTE_COLORS: u8 = 16;
pub const SNES_TILE_BYTES: u32 = 32;
pub const SNES_DMA_VBLANK_BYTES: u32 = 8_192;
#[allow(dead_code)]
pub const SNES_RESOLUTION_W: u32 = 256;
#[allow(dead_code)]
pub const SNES_RESOLUTION_H: u32 = 224;

/// Limite de tiles por eixo para `CollisionMap` em nivel de mundo (scroll/plataforma).
pub const SNES_COLLISION_MAP_MAX_TILES_PER_AXIS: u32 = 4096;
/// Teto de memoria para `collision_map.data` (integridade / DoS guard no host do editor).
pub const SNES_COLLISION_MAP_MAX_DATA_BYTES: u64 = 16 * 1024 * 1024;

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

pub fn validate_scene(scene: &Scene) -> Vec<ValidationError> {
    validate_scene_with_source_kind(scene, None)
}

pub fn validate_scene_with_source_kind(
    scene: &Scene,
    source_kind: Option<&str>,
) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();
    let is_sgdk = matches!(source_kind, Some("external_sgdk") | Some("imported_sgdk"));
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
    } else if sprite_count > SNES_SPRITE_WARNING_THRESHOLD {
        errors.push(ValidationError::warning(format!(
            "Sprite Warning: a cena tem {} sprites ({}% do limite do SNES: {}). Pouca folga para objetos dinamicos.",
            sprite_count,
            sprite_count * 100 / SNES_SPRITES_PER_SCREEN,
            SNES_SPRITES_PER_SCREEN
        )));
    }

    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            // Skip validation for 0×0 sprites (camera/audio entities)
            if sprite.frame_width == 0 && sprite.frame_height == 0 {
                continue;
            }

            if sprite.frame_width % 8 != 0 || sprite.frame_height % 8 != 0 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': dimensoes de sprite ({} x {}) nao sao multiplas de 8.",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            // Meta-sprites bypass the native size limit
            if !sprite.meta_sprite {
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

    let max_scanline_sprites = estimate_max_scanline_sprites(scene);
    if max_scanline_sprites > SNES_SPRITES_PER_SCANLINE {
        errors.push(ValidationError::warning(format!(
            "Sprite Scanline Warning: ha ate {} sprites alinhados horizontalmente. O SNES exibe no maximo {} sprites por linha. Sprites extras piscarao (flicker).",
            max_scanline_sprites, SNES_SPRITES_PER_SCANLINE
        )));
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
            if sprite.frame_width == 0 || sprite.frame_height == 0 {
                continue;
            }
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
        if is_sgdk {
            errors.push(ValidationError::warning(format!(
                "[SGDK Gerenciado] VRAM Overflow: a cena consome {}KB de sprites. Limite do SNES: 64KB.",
                vram_used / 1024
            )));
        } else {
            errors.push(ValidationError::fatal(format!(
                "VRAM Overflow: a cena consome {}KB de sprites. Limite do SNES: 64KB.",
                vram_used / 1024
            )));
        }
    } else if vram_used > (SNES_VRAM_BYTES * 80 / 100) {
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        errors.push(ValidationError::warning(format!(
            "{}VRAM Warning: uso de VRAM estimado em {}KB ({}% do limite de 64KB).",
            prefix,
            vram_used / 1024,
            vram_used * 100 / SNES_VRAM_BYTES
        )));
    }

    let dma_used = vram_used;
    if dma_used > (SNES_DMA_VBLANK_BYTES * 80 / 100) {
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        errors.push(ValidationError::warning(format!(
            "{}DMA Warning: upload estimado em {}KB por frame ({}% do budget de {}KB no VBlank).",
            prefix,
            dma_used / 1024,
            dma_used * 100 / SNES_DMA_VBLANK_BYTES,
            SNES_DMA_VBLANK_BYTES / 1024
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

    let palette_banks_used = count_palette_banks_used(scene);
    if palette_banks_used > SNES_PALETTE_SLOTS as u32 {
        errors.push(ValidationError::warning(format!(
            "Palette Warning: {} bancos de paleta em uso. Limite do SNES: {}.",
            palette_banks_used, SNES_PALETTE_SLOTS
        )));
    }

    // ── CollisionMap constraint (schema 1.4.0+) ──────────────────────────────
    // Mapas "world-sized" (maior que 256x224 px) sao validos para scroll/plataforma;
    // validamos tile, grid, integridade de `data` e teto de memoria plausivel.
    if let Some(cmap) = &scene.collision_map {
        if cmap.tile_width == 0 || cmap.tile_height == 0 {
            errors.push(ValidationError::fatal(
                "CollisionMap: tile_width/tile_height nao podem ser zero.".to_string(),
            ));
        } else if cmap.tile_width % 8 != 0 || cmap.tile_height % 8 != 0 {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: tile_width={} tile_height={} devem ser multiplos de 8 (alinhamento SNES).",
                cmap.tile_width, cmap.tile_height
            )));
        } else if cmap.tile_width > 64 || cmap.tile_height > 64 {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: tile_width={} tile_height={} excedem limite conservador (64 px).",
                cmap.tile_width, cmap.tile_height
            )));
        }

        if cmap.width == 0 || cmap.height == 0 {
            errors.push(ValidationError::fatal(
                "CollisionMap: width/height em tiles nao podem ser zero.".to_string(),
            ));
        } else if cmap.width > SNES_COLLISION_MAP_MAX_TILES_PER_AXIS
            || cmap.height > SNES_COLLISION_MAP_MAX_TILES_PER_AXIS
        {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: grid {}x{} tiles excede limite conservador {}x{} tiles.",
                cmap.width,
                cmap.height,
                SNES_COLLISION_MAP_MAX_TILES_PER_AXIS,
                SNES_COLLISION_MAP_MAX_TILES_PER_AXIS
            )));
        }

        let pixel_width_opt = cmap.width.checked_mul(cmap.tile_width as u32);
        let pixel_height_opt = cmap.height.checked_mul(cmap.tile_height as u32);
        let tile_cells_opt = cmap.width.checked_mul(cmap.height);

        match (pixel_width_opt, pixel_height_opt, tile_cells_opt) {
            (Some(pixel_width), Some(pixel_height), Some(tile_cells)) => {
                let expected_len = tile_cells as usize;
                if cmap.data.len() != expected_len {
                    errors.push(ValidationError::warning(format!(
                        "CollisionMap: data.len()={} mas width*height={}. O mapa pode estar corrompido.",
                        cmap.data.len(),
                        expected_len
                    )));
                }
                let data_bytes = cmap.data.len() as u64;
                if data_bytes > SNES_COLLISION_MAP_MAX_DATA_BYTES {
                    errors.push(ValidationError::fatal(format!(
                        "CollisionMap: data ocupa {} bytes (limite conservador {} bytes).",
                        data_bytes, SNES_COLLISION_MAP_MAX_DATA_BYTES
                    )));
                }

                if pixel_width > SNES_RESOLUTION_W || pixel_height > SNES_RESOLUTION_H {
                    errors.push(ValidationError::warning(format!(
                        "CollisionMap: mapa de mundo {}x{} px excede viewport SNES {}x{} px; exige scroll/camera no runtime (nao bloqueia build).",
                        pixel_width, pixel_height, SNES_RESOLUTION_W, SNES_RESOLUTION_H
                    )));
                }
            }
            _ => errors.push(ValidationError::fatal(
                "CollisionMap: overflow ao calcular dimensoes em pixels ou numero de tiles."
                    .to_string(),
            )),
        }
    }

    errors
}

#[allow(dead_code)]
pub fn hw_status(scene: &Scene) -> HwStatus {
    hw_status_with_source_kind(scene, None)
}

pub fn hw_status_with_source_kind(scene: &Scene, source_kind: Option<&str>) -> HwStatus {
    let sprite_count = scene
        .entities
        .iter()
        .filter(|entity| entity.components.sprite.is_some())
        .count() as u32;

    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            if sprite.frame_width == 0 || sprite.frame_height == 0 {
                continue;
            }
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

    let validation = validate_scene_with_source_kind(scene, source_kind);
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
        scanline_sprite_peak: estimate_max_scanline_sprites(scene),
        scanline_sprite_limit: SNES_SPRITES_PER_SCANLINE,
        dma_used: vram_used,
        dma_limit: SNES_DMA_VBLANK_BYTES,
        palette_banks_used: count_palette_banks_used(scene),
        palette_banks_limit: SNES_PALETTE_SLOTS as u32,
        bg_layers: scene.background_layers.len() as u32,
        bg_layers_limit: SNES_BG_LAYERS_MAX,
        errors,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::components::{Components, SpriteComponent};
    use crate::ugdm::entities::{BackgroundLayer, CollisionMap, Entity, Scene, Transform};

    fn sprite_entity(id: &str, frame_width: u32, frame_height: u32, palette_slot: u8) -> Entity {
        Entity {
            entity_id: id.to_string(),
            display_name: None,
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
                    meta_sprite: false,
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
            collision_map: None,
            layers: None,
        }
    }

    #[test]
    fn collision_map_wider_than_viewport_is_non_fatal_with_warning() {
        let mut scene = empty_scene();
        scene.collision_map = Some(CollisionMap {
            tile_width: 8,
            tile_height: 8,
            width: 64,
            height: 28,
            data: vec![0u8; (64 * 28) as usize],
        });
        let errors = validate_scene(&scene);
        assert!(
            !errors.iter().any(|e| e.is_fatal && e.message.contains("CollisionMap")),
            "world-sized collision must not be fatal: {:?}",
            errors
        );
        assert!(
            errors.iter().any(|e| {
                !e.is_fatal
                    && e.message.contains("mapa de mundo")
                    && e.message.contains("512")
                    && e.message.contains("256")
            }),
            "expected viewport exceed warning for 64x8-wide map: {:?}",
            errors
        );
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

        assert!(errors
            .iter()
            .any(|error| error.is_fatal && error.message.contains("background layers")));
    }

    #[test]
    fn rejects_large_sprite_sizes() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("boss", 72, 64, 0));

        let errors = validate_scene(&scene);

        assert!(errors
            .iter()
            .any(|error| error.is_fatal && error.message.contains("64x64")));
    }

    #[test]
    fn warns_when_sprite_pressure_is_high() {
        let mut scene = empty_scene();
        scene.entities = (0..=SNES_SPRITE_WARNING_THRESHOLD)
            .map(|index| sprite_entity(&format!("entity_{index}"), 8, 8, 0))
            .collect();

        let errors = validate_scene(&scene);

        assert!(errors
            .iter()
            .any(|error| !error.is_fatal && error.message.contains("Sprite Warning")));
        assert!(!errors.iter().any(|error| error.is_fatal));
    }

    #[test]
    fn rejects_non_square_simple_sprite_shapes() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("runner", 16, 32, 0));

        let errors = validate_scene(&scene);

        assert!(errors
            .iter()
            .any(|error| error.is_fatal && error.message.contains("sprites simples quadrados")));
    }

    #[test]
    fn warns_when_sprite_scanline_limit_exceeded() {
        let mut scene = empty_scene();
        scene.entities = (0..=(SNES_SPRITES_PER_SCANLINE + 1))
            .map(|index| {
                let mut entity = sprite_entity(&format!("entity_{index}"), 8, 8, 0);
                entity.transform.y = 10;
                entity
            })
            .collect();

        let errors = validate_scene(&scene);

        assert!(errors
            .iter()
            .any(|error| { !error.is_fatal && error.message.contains("Sprite Scanline Warning") }));
    }

    #[test]
    fn reports_hw_status_for_valid_scene() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("player", 16, 16, 0));

        let status = hw_status(&scene);

        assert_eq!(status.sprite_count, 1);
        assert_eq!(status.sprite_limit, SNES_SPRITES_PER_SCREEN);
        assert_eq!(status.scanline_sprite_peak, 1);
        assert_eq!(status.scanline_sprite_limit, SNES_SPRITES_PER_SCANLINE);
        assert_eq!(status.dma_limit, SNES_DMA_VBLANK_BYTES);
        assert_eq!(status.palette_banks_used, 1);
        assert_eq!(status.palette_banks_limit, SNES_PALETTE_SLOTS as u32);
        assert_eq!(status.bg_layers_limit, SNES_BG_LAYERS_MAX);
        assert!(status.errors.is_empty());
    }
}
