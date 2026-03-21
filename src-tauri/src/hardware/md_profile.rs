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
    validate_scene_with_source_kind(scene, None)
}

/// Valida uma Scene com contexto de `source_kind`.
/// Quando `source_kind` é `Some("external_sgdk")`, VRAM overflow e DMA budget
/// são reclassificados como warnings (não fatais), pois o SGDK gerencia esses
/// recursos internamente.
pub fn validate_scene_with_source_kind(
    scene: &Scene,
    source_kind: Option<&str>,
) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();
    let is_sgdk = matches!(source_kind, Some("external_sgdk") | Some("imported_sgdk"));

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
            // Skip validation for 0×0 sprites (e.g. entities without real sprite data)
            if sprite.frame_width == 0 && sprite.frame_height == 0 {
                continue;
            }

            if sprite.frame_width % 8 != 0 || sprite.frame_height % 8 != 0 {
                errors.push(ValidationError::fatal(format!(
                    "Entidade '{}': dimensoes de sprite ({} x {}) nao sao multiplas de 8 (tile-aligned).",
                    entity.entity_id, sprite.frame_width, sprite.frame_height
                )));
            }

            // Meta-sprites (SGDK ResComp decomposes automatically) bypass the 32x32 limit
            if !sprite.meta_sprite && (sprite.frame_width > 32 || sprite.frame_height > 32) {
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
            // Skip VRAM calc for 0×0 sprites (camera/audio entities with empty sprite stub)
            if sprite.frame_width == 0 || sprite.frame_height == 0 {
                continue;
            }
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
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        if is_sgdk {
            errors.push(ValidationError::warning(format!(
                "{}VRAM Overflow: a cena consome {}KB de sprites. Limite do Mega Drive: 64KB.",
                prefix,
                vram_used / 1024
            )));
        } else {
            errors.push(ValidationError::fatal(format!(
                "VRAM Overflow: a cena consome {}KB de sprites. Limite do Mega Drive: 64KB.",
                vram_used / 1024
            )));
        }
    } else if vram_used > (MD_VRAM_BYTES * 80 / 100) {
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        errors.push(ValidationError::warning(format!(
            "{}VRAM Warning: uso de VRAM estimado em {}KB ({}% do limite de 64KB). Pouco espaco para tiles de background.",
            prefix, vram_used / 1024,
            vram_used * 100 / MD_VRAM_BYTES
        )));
    }

    let dma_used = vram_used;
    if dma_used > (MD_DMA_VBLANK_BYTES * 80 / 100) {
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        errors.push(ValidationError::warning(format!(
            "{}DMA Warning: upload estimado em {}KB por frame ({}% do budget de {}KB no VBlank).",
            prefix,
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

    // ── CollisionMap constraint (schema 1.4.0+) ──────────────────────────────
    if let Some(cmap) = &scene.collision_map {
        let pixel_width = cmap.width * cmap.tile_width as u32;
        let pixel_height = cmap.height * cmap.tile_height as u32;
        if pixel_width > MD_RESOLUTION_W {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: largura em pixels ({} tiles * {} px = {} px) excede a resolucao horizontal do Mega Drive ({} px).",
                cmap.width, cmap.tile_width, pixel_width, MD_RESOLUTION_W
            )));
        }
        if pixel_height > MD_RESOLUTION_H {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: altura em pixels ({} tiles * {} px = {} px) excede a resolucao vertical do Mega Drive ({} px).",
                cmap.height, cmap.tile_height, pixel_height, MD_RESOLUTION_H
            )));
        }
        let expected_len = (cmap.width * cmap.height) as usize;
        if cmap.data.len() != expected_len {
            errors.push(ValidationError::warning(format!(
                "CollisionMap: data.len()={} mas width*height={}. O mapa pode estar corrompido.",
                cmap.data.len(),
                expected_len
            )));
        }
    }

    errors
}

/// Calcula o `HwStatus` de uma cena sem retornar apenas pass/fail.
/// Usado pelo comando IPC `get_hw_status` para alimentar o painel UI.
#[allow(dead_code)]
pub fn hw_status(scene: &Scene) -> HwStatus {
    hw_status_with_source_kind(scene, None)
}

/// Calcula o `HwStatus` com contexto de `source_kind` para projetos importados.
pub fn hw_status_with_source_kind(scene: &Scene, source_kind: Option<&str>) -> HwStatus {
    let sprite_count = scene
        .entities
        .iter()
        .filter(|entity| entity.components.sprite.is_some())
        .count() as u32;

    let mut vram_used: u32 = 0;
    for entity in &scene.entities {
        if let Some(sprite) = &entity.components.sprite {
            // Skip VRAM calc for 0×0 sprites (camera/audio entities)
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
            vram_used += tiles_w * tiles_h * unique_frames * MD_TILE_BYTES;
        }
    }

    let validation = validate_scene_with_source_kind(scene, source_kind);
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
            display_name: None,
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
                    meta_sprite: false,
                }),
                ..Default::default()
            },
        }
    }

    fn meta_sprite_entity(id: &str, frame_width: u32, frame_height: u32) -> Entity {
        Entity {
            entity_id: id.to_string(),
            display_name: None,
            prefab: None,
            transform: Transform { x: 0, y: 0 },
            components: Components {
                sprite: Some(SpriteComponent {
                    asset: "assets/sprites/test.png".to_string(),
                    frame_width,
                    frame_height,
                    pivot: None,
                    palette_slot: 0,
                    animations: Default::default(),
                    priority: "foreground".to_string(),
                    meta_sprite: true,
                }),
                ..Default::default()
            },
        }
    }

    fn camera_entity(id: &str) -> Entity {
        Entity {
            entity_id: id.to_string(),
            display_name: None,
            prefab: None,
            transform: Transform { x: 0, y: 0 },
            components: Components {
                camera: Some(crate::ugdm::components::CameraComponent {
                    follow_entity: None,
                    offset_x: 0,
                    offset_y: 0,
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
    fn rejects_sprite_overflow() {
        let mut scene = empty_scene();
        scene.entities = (0..=MD_SPRITES_PER_SCREEN)
            .map(|index| sprite_entity(&format!("entity_{index}"), 8, 8, 0))
            .collect();

        let errors = validate_scene(&scene);

        assert!(errors
            .iter()
            .any(|error| error.is_fatal && error.message.contains("Sprite overflow")));
    }

    #[test]
    fn warns_when_sprite_pressure_is_high() {
        let mut scene = empty_scene();
        scene.entities = (0..=MD_SPRITE_WARNING_THRESHOLD)
            .map(|index| sprite_entity(&format!("entity_{index}"), 8, 8, 0))
            .collect();

        let errors = validate_scene(&scene);

        assert!(errors
            .iter()
            .any(|error| !error.is_fatal && error.message.contains("Sprite Warning")));
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

        assert!(errors
            .iter()
            .any(|error| { !error.is_fatal && error.message.contains("Sprite Scanline Warning") }));
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

        assert!(errors
            .iter()
            .any(|error| error.is_fatal && error.message.contains("palette_slot")));
        assert!(errors
            .iter()
            .any(|error| error.is_fatal && error.message.contains("Palette slot")));
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

    // ── PROMPT 8: Camera entity does not produce false sprite errors ──

    #[test]
    fn camera_entity_does_not_produce_sprite_errors() {
        let mut scene = empty_scene();
        scene.entities.push(camera_entity("main_camera"));

        let errors = validate_scene(&scene);

        assert!(
            !errors.iter().any(|error| error.is_fatal),
            "Camera-only entity should not produce fatal errors: {:?}",
            errors
        );
        let status = hw_status(&scene);
        assert!(status.errors.is_empty());
        assert_eq!(status.vram_used, 0);
    }

    // ── PROMPT 1: Meta-sprite bypasses 32x32 limit ──

    #[test]
    fn meta_sprite_bypasses_32x32_limit() {
        let mut scene = empty_scene();
        scene.entities.push(meta_sprite_entity("boss", 128, 120));

        let errors = validate_scene(&scene);

        assert!(
            !errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("32x32")),
            "Meta-sprite should not trigger 32x32 limit: {:?}",
            errors
        );
    }

    #[test]
    fn non_meta_sprite_still_rejects_above_32x32() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("boss", 64, 64, 0));

        let errors = validate_scene(&scene);

        assert!(
            errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("32x32")),
            "Non-meta sprite >32x32 should be rejected"
        );
    }

    #[test]
    fn meta_sprite_still_counts_vram() {
        let mut scene = empty_scene();
        scene.entities.push(meta_sprite_entity("boss", 128, 128));

        let status = hw_status(&scene);

        assert!(
            status.vram_used > 0,
            "Meta-sprite VRAM should be calculated"
        );
    }

    // ── PROMPT 4: SGDK source_kind reclassifies VRAM overflow ──

    #[test]
    fn sgdk_project_vram_overflow_is_warning_not_error() {
        let mut scene = empty_scene();
        // 10 × 128x128 meta-sprites = 10 × 8,192 B = 80 KB > 64 KB VRAM limit.
        // Keeps sprite count below the 80 sprites per screen constraint.
        for i in 0..10 {
            scene
                .entities
                .push(meta_sprite_entity(&format!("spr_{i}"), 128, 128));
        }

        let errors_native = validate_scene_with_source_kind(&scene, None);
        let errors_sgdk = validate_scene_with_source_kind(&scene, Some("external_sgdk"));

        // Native project: VRAM overflow is fatal
        assert!(
            errors_native
                .iter()
                .any(|error| error.is_fatal && error.message.contains("VRAM Overflow")),
            "Native project should have fatal VRAM overflow"
        );

        // SGDK project: VRAM overflow is warning (not fatal)
        assert!(
            !errors_sgdk
                .iter()
                .any(|error| error.is_fatal && error.message.contains("VRAM Overflow")),
            "SGDK project should not have fatal VRAM overflow: {:?}",
            errors_sgdk
        );
        assert!(
            errors_sgdk
                .iter()
                .any(|error| !error.is_fatal && error.message.contains("VRAM Overflow")),
            "SGDK project should have VRAM overflow as warning"
        );
        assert!(
            errors_sgdk
                .iter()
                .any(|error| error.message.contains("SGDK Gerenciado")),
            "SGDK warning should have [SGDK Gerenciado] prefix"
        );
    }

    #[test]
    fn imported_sgdk_project_vram_overflow_is_also_warning() {
        let mut scene = empty_scene();
        for i in 0..10 {
            scene
                .entities
                .push(meta_sprite_entity(&format!("spr_{i}"), 128, 128));
        }

        let errors = validate_scene_with_source_kind(&scene, Some("imported_sgdk"));

        assert!(
            !errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("VRAM Overflow")),
            "imported_sgdk should not have fatal VRAM overflow: {:?}",
            errors
        );
        assert!(
            errors
                .iter()
                .any(|error| !error.is_fatal && error.message.contains("SGDK Gerenciado")),
            "imported_sgdk should produce [SGDK Gerenciado] warning"
        );
    }
}
