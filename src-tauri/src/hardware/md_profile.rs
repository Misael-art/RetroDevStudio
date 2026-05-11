use crate::hardware::HwStatus;
use crate::ugdm::entities::{Entity, Scene};

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
/// Heurística SGDK-managed: no pico, consideramos no máximo 8 bancos de sprite
/// relevantes simultaneamente.
pub const MD_MANAGED_MAX_CONCURRENT_BANKS: u32 = 8;
/// Heurística SGDK-managed: orçamento de células de sprite 32x32 simultâneas
/// para estimar residência em cena ativa.
pub const MD_MANAGED_SPRITE_CELL_BUDGET: u32 = 32;
#[allow(dead_code)]
pub const MD_RESOLUTION_W: u32 = 320;
#[allow(dead_code)]
pub const MD_RESOLUTION_H: u32 = 224;

/// Limite de tiles por eixo para `CollisionMap` em nivel de mundo (scroll/plataforma).
/// Nao confundir com viewport 320x224: mapas de colisao podem ser maiores que a area visivel.
pub const MD_COLLISION_MAP_MAX_TILES_PER_AXIS: u32 = 4096;
/// Teto de memoria para `collision_map.data` (integridade / DoS guard no host do editor).
pub const MD_COLLISION_MAP_MAX_DATA_BYTES: u64 = 16 * 1024 * 1024;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MdVramAnalysisMode {
    NativeStatic,
    SgdkManaged,
}

impl MdVramAnalysisMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::NativeStatic => "native_static",
            Self::SgdkManaged => "sgdk_managed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MdVramAnalysis {
    mode: MdVramAnalysisMode,
    project_asset_bytes: u32,
    resident_vram_bytes: u32,
    streamable_vram_bytes: u32,
    dma_frame_bytes: u32,
    sprite_resident_bytes: u32,
    tilemap_resident_bytes: u32,
    hud_resident_bytes: u32,
    streamable_sprite_bytes: u32,
    animated_swap_bytes: u32,
    managed_concurrent_sprite_banks: u32,
    managed_sprite_cells_used: u32,
}

fn is_sgdk_managed_source(source_kind: Option<&str>) -> bool {
    matches!(source_kind, Some("external_sgdk") | Some("imported_sgdk"))
}

fn sprite_total_frames(sprite: &crate::ugdm::components::SpriteComponent) -> u32 {
    let total_frames = sprite
        .animations
        .values()
        .flat_map(|animation| animation.frames.iter())
        .count() as u32;
    total_frames.max(1)
}

/// Prioriza sinais canônicos do importador (`logic_hints`) para HUD/overlay.
/// Em ausência de metadata explícita, aplica fallback conservador por prioridade/nome.
fn md_entity_hud_overlay_hint(entity: &Entity) -> bool {
    if entity
        .components
        .logic
        .as_ref()
        .map(|logic| {
            logic.logic_hints
                .iter()
                .any(|hint| {
                    let normalized = hint.trim().to_ascii_lowercase();
                    normalized == "sgdk_import:hud_overlay"
                        || normalized == "sgdk_import:canonical_hud_signal"
                        || normalized == "import:hud_overlay"
                })
        })
        .unwrap_or(false)
    {
        return true;
    }
    if entity
        .components
        .sprite
        .as_ref()
        .map(|sprite| {
            sprite.priority.eq_ignore_ascii_case("ui_overlay")
                || sprite.priority.eq_ignore_ascii_case("hud_overlay")
        })
        .unwrap_or(false)
    {
        return true;
    }
    let id = entity.entity_id.to_lowercase();
    if id.contains("hud")
        || id.contains("status_bar")
        || id.contains("statusbar")
        || id.contains("ui_overlay")
        || id.contains("overlay_ui")
    {
        return true;
    }
    if let Some(name) = &entity.display_name {
        let n = name.to_lowercase();
        if n.contains("hud")
            || n.contains("status")
            || n.contains("overlay")
            || n.contains("health bar")
        {
            return true;
        }
    }
    if let Some(sprite) = &entity.components.sprite {
        let p = sprite.priority.to_lowercase();
        if p.contains("hud")
            || p.contains("overlay")
            || p.contains("window")
            || p == "ui"
        {
            return true;
        }
    }
    false
}

fn tilemap_entity_resident_bytes(entity: &Entity) -> u32 {
    let Some(tilemap) = entity.components.tilemap.as_ref() else {
        return 0;
    };

    let map_bytes = tilemap
        .map_width
        .saturating_mul(tilemap.map_height)
        .saturating_mul(2);
    let map_bytes_capped = map_bytes.min(32 * 1024);

    let tileset_bytes = if tilemap.cells.is_empty() {
        0
    } else {
        let mut unique_nonzero = std::collections::HashSet::new();
        for &cell in &tilemap.cells {
            if cell > 0 {
                unique_nonzero.insert(cell);
            }
        }
        (unique_nonzero.len() as u32).saturating_mul(MD_TILE_BYTES)
    };

    map_bytes_capped.saturating_add(tileset_bytes)
}

/// Retorna `(total_tilemap_resident, hud_tilemap_resident)` com HUD derivado de `md_entity_hud_overlay_hint`.
fn estimate_tilemap_resident_bytes_split(scene: &Scene) -> (u32, u32) {
    let mut total: u32 = 0;
    let mut hud: u32 = 0;
    for entity in &scene.entities {
        let bytes = tilemap_entity_resident_bytes(entity);
        if bytes == 0 {
            continue;
        }
        total = total.saturating_add(bytes);
        if md_entity_hud_overlay_hint(entity) {
            hud = hud.saturating_add(bytes);
        }
    }
    (total, hud)
}

fn analyze_md_vram(scene: &Scene, source_kind: Option<&str>) -> MdVramAnalysis {
    #[derive(Debug, Clone, Copy)]
    struct SpriteBankCandidate {
        project_bytes: u32,
        resident_bytes: u32,
        frame_bytes: u32,
        cell_cost: u32,
        animated: bool,
        hud_hint: bool,
    }

    let mode = if is_sgdk_managed_source(source_kind) {
        MdVramAnalysisMode::SgdkManaged
    } else {
        MdVramAnalysisMode::NativeStatic
    };

    let mut project_sprite_bytes: u32 = 0;
    let mut resident_sprite_bytes: u32 = 0;
    let mut streamable_sprite_bytes: u32 = 0;
    let mut animated_swap_bytes: u32 = 0;
    let mut hud_sprite_resident_bytes: u32 = 0;
    let mut managed_candidates: Vec<SpriteBankCandidate> = Vec::new();

    for entity in &scene.entities {
        let Some(sprite) = entity.components.sprite.as_ref() else {
            continue;
        };
        if sprite.frame_width == 0 || sprite.frame_height == 0 {
            continue;
        }

        let tiles_w = (sprite.frame_width / 8).max(1);
        let tiles_h = (sprite.frame_height / 8).max(1);
        let frame_bytes = tiles_w.saturating_mul(tiles_h).saturating_mul(MD_TILE_BYTES);
        let total_frames = sprite_total_frames(sprite);

        let sprite_project = frame_bytes.saturating_mul(total_frames);
        project_sprite_bytes = project_sprite_bytes.saturating_add(sprite_project);
        let hud_hint = md_entity_hud_overlay_hint(entity);

        match mode {
            MdVramAnalysisMode::NativeStatic => {
                resident_sprite_bytes = resident_sprite_bytes.saturating_add(sprite_project);
                animated_swap_bytes = animated_swap_bytes.saturating_add(sprite_project);
                if hud_hint {
                    hud_sprite_resident_bytes =
                        hud_sprite_resident_bytes.saturating_add(sprite_project);
                }
            }
            MdVramAnalysisMode::SgdkManaged => {
                let resident_frames = if total_frames <= 1 {
                    1
                } else {
                    2.min(total_frames)
                };
                let sprite_resident = frame_bytes.saturating_mul(resident_frames);
                let cell_cost = (sprite.frame_width.saturating_add(31) / 32)
                    .max(1)
                    .saturating_mul((sprite.frame_height.saturating_add(31) / 32).max(1));
                managed_candidates.push(SpriteBankCandidate {
                    project_bytes: sprite_project,
                    resident_bytes: sprite_resident,
                    frame_bytes,
                    cell_cost: cell_cost.max(1),
                    animated: total_frames > 1,
                    hud_hint,
                });
            }
        }
    }

    let mut managed_concurrent_sprite_banks: u32 = 0;
    let mut managed_sprite_cells_used: u32 = 0;

    if mode == MdVramAnalysisMode::SgdkManaged {
        // Conservador sem ser mágico: seleciona um conjunto concorrente plausível
        // de bancos de sprite sob orçamento de células e quantidade de bancos.
        managed_candidates.sort_by(|a, b| {
            b.resident_bytes
                .cmp(&a.resident_bytes)
                .then_with(|| b.cell_cost.cmp(&a.cell_cost))
        });
        let mut cells_used: u32 = 0;
        let mut banks_used: u32 = 0;
        for candidate in managed_candidates {
            if banks_used >= MD_MANAGED_MAX_CONCURRENT_BANKS {
                streamable_sprite_bytes = streamable_sprite_bytes.saturating_add(candidate.project_bytes);
                continue;
            }
            let can_fit_cells = cells_used.saturating_add(candidate.cell_cost) <= MD_MANAGED_SPRITE_CELL_BUDGET;
            if banks_used == 0 || can_fit_cells {
                resident_sprite_bytes = resident_sprite_bytes.saturating_add(candidate.resident_bytes);
                if candidate.hud_hint {
                    hud_sprite_resident_bytes = hud_sprite_resident_bytes
                        .saturating_add(candidate.resident_bytes);
                }
                if candidate.animated {
                    animated_swap_bytes = animated_swap_bytes.saturating_add(candidate.frame_bytes);
                }
                streamable_sprite_bytes = streamable_sprite_bytes
                    .saturating_add(candidate.project_bytes.saturating_sub(candidate.resident_bytes));
                cells_used = cells_used.saturating_add(candidate.cell_cost);
                banks_used = banks_used.saturating_add(1);
            } else {
                streamable_sprite_bytes = streamable_sprite_bytes.saturating_add(candidate.project_bytes);
            }
        }
        managed_concurrent_sprite_banks = banks_used;
        managed_sprite_cells_used = cells_used;
    }

    let (tilemap_resident_bytes, hud_tilemap_resident_bytes) =
        estimate_tilemap_resident_bytes_split(scene);
    let hud_resident_bytes = hud_sprite_resident_bytes.saturating_add(hud_tilemap_resident_bytes);
    let project_asset_bytes = project_sprite_bytes.saturating_add(tilemap_resident_bytes);
    let resident_vram_bytes = resident_sprite_bytes.saturating_add(tilemap_resident_bytes);
    let streamable_vram_bytes = streamable_sprite_bytes;
    let dma_frame_bytes = match mode {
        MdVramAnalysisMode::NativeStatic => resident_vram_bytes,
        MdVramAnalysisMode::SgdkManaged => {
            let stream_step = streamable_vram_bytes / 4;
            let tilemap_step = tilemap_resident_bytes.min(1024);
            animated_swap_bytes
                .saturating_add(stream_step)
                .saturating_add(tilemap_step)
        }
    };

    MdVramAnalysis {
        mode,
        project_asset_bytes,
        resident_vram_bytes,
        streamable_vram_bytes,
        dma_frame_bytes,
        sprite_resident_bytes: resident_sprite_bytes,
        tilemap_resident_bytes,
        hud_resident_bytes,
        streamable_sprite_bytes,
        animated_swap_bytes,
        managed_concurrent_sprite_banks,
        managed_sprite_cells_used,
    }
}

/// Valida uma Scene contra as hardware constraints do Mega Drive.
/// Retorna lista de erros/avisos. Erros fatais bloqueiam o build.
#[allow(dead_code)]
pub fn validate_scene(scene: &Scene) -> Vec<ValidationError> {
    validate_scene_with_source_kind(scene, None)
}

/// Valida uma Scene com contexto de `source_kind`.
/// Para `imported_sgdk`/`external_sgdk`, aplica análise de residência/streaming:
/// - overflow de conjunto **residente** continua fatal;
/// - excesso apenas no volume total streamável vira warning auditável.
pub fn validate_scene_with_source_kind(
    scene: &Scene,
    source_kind: Option<&str>,
) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();
    let is_sgdk = is_sgdk_managed_source(source_kind);

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

    let analysis = analyze_md_vram(scene, source_kind);
    if is_sgdk {
        errors.push(ValidationError::warning(format!(
            "[SGDK Gerenciado] VRAM Analysis: mode={} asset_total={}KB resident={}KB streamable={}KB dma_est/frame={}KB | spr_res={}KB tile={}KB hud={}KB strm_spr={}KB anim_sw={}KB | banks={}/{} cells={}/{} (limites: vram={}KB dma={}KB).",
            analysis.mode.as_str(),
            analysis.project_asset_bytes / 1024,
            analysis.resident_vram_bytes / 1024,
            analysis.streamable_vram_bytes / 1024,
            analysis.dma_frame_bytes / 1024,
            analysis.sprite_resident_bytes / 1024,
            analysis.tilemap_resident_bytes / 1024,
            analysis.hud_resident_bytes / 1024,
            analysis.streamable_sprite_bytes / 1024,
            analysis.animated_swap_bytes / 1024,
            analysis.managed_concurrent_sprite_banks,
            MD_MANAGED_MAX_CONCURRENT_BANKS,
            analysis.managed_sprite_cells_used,
            MD_MANAGED_SPRITE_CELL_BUDGET,
            MD_VRAM_BYTES / 1024,
            MD_DMA_VBLANK_BYTES / 1024
        )));
    }

    if analysis.resident_vram_bytes > MD_VRAM_BYTES {
        errors.push(ValidationError::fatal(format!(
            "{}VRAM Overflow (resident): conjunto residente estimado em {}KB. Limite do Mega Drive: 64KB.",
            if is_sgdk { "[SGDK Gerenciado] " } else { "" },
            analysis.resident_vram_bytes / 1024
        )));
    } else if analysis.resident_vram_bytes > (MD_VRAM_BYTES * 80 / 100) {
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        errors.push(ValidationError::warning(format!(
            "{}VRAM Warning (resident): {}KB ({}% do limite de 64KB).",
            prefix,
            analysis.resident_vram_bytes / 1024,
            analysis.resident_vram_bytes * 100 / MD_VRAM_BYTES
        )));
    }

    if is_sgdk
        && analysis.project_asset_bytes > MD_VRAM_BYTES
        && analysis.resident_vram_bytes <= MD_VRAM_BYTES
    {
        errors.push(ValidationError::warning(format!(
            "[SGDK Gerenciado] Asset total acima da VRAM fisica ({}KB), mas residencia simultanea estimada em {}KB. Build segue com streaming gerenciado; valide transicoes/latencia de carga.",
            analysis.project_asset_bytes / 1024,
            analysis.resident_vram_bytes / 1024
        )));
    }

    let dma_used = analysis.dma_frame_bytes;
    if dma_used > (MD_DMA_VBLANK_BYTES * 80 / 100) {
        let prefix = if is_sgdk { "[SGDK Gerenciado] " } else { "" };
        let dma_ctx = if is_sgdk {
            format!(
                " spr_res={}KB anim_sw={}KB strm_spr={}KB tile={}KB | banks={}/{} cells={}/{}.",
                analysis.sprite_resident_bytes / 1024,
                analysis.animated_swap_bytes / 1024,
                analysis.streamable_sprite_bytes / 1024,
                analysis.tilemap_resident_bytes / 1024,
                analysis.managed_concurrent_sprite_banks,
                MD_MANAGED_MAX_CONCURRENT_BANKS,
                analysis.managed_sprite_cells_used,
                MD_MANAGED_SPRITE_CELL_BUDGET
            )
        } else {
            String::new()
        };
        errors.push(ValidationError::warning(format!(
            "{}DMA Warning: upload estimado em {}KB por frame ({}% do budget de {}KB no VBlank). Total={}KB / Residente={}KB / Streamable={}KB.{}",
            prefix,
            dma_used / 1024,
            dma_used * 100 / MD_DMA_VBLANK_BYTES,
            MD_DMA_VBLANK_BYTES / 1024,
            analysis.project_asset_bytes / 1024,
            analysis.resident_vram_bytes / 1024,
            analysis.streamable_vram_bytes / 1024,
            dma_ctx
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
    // Mapas "world-sized" (maior que 320x224 px) sao validos para scroll/plataforma;
    // validamos tile, grid, integridade de `data` e teto de memoria plausivel.
    if let Some(cmap) = &scene.collision_map {
        if cmap.tile_width == 0 || cmap.tile_height == 0 {
            errors.push(ValidationError::fatal(
                "CollisionMap: tile_width/tile_height nao podem ser zero.".to_string(),
            ));
        } else if cmap.tile_width % 8 != 0 || cmap.tile_height % 8 != 0 {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: tile_width={} tile_height={} devem ser multiplos de 8 (alinhamento MD).",
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
        } else if cmap.width > MD_COLLISION_MAP_MAX_TILES_PER_AXIS
            || cmap.height > MD_COLLISION_MAP_MAX_TILES_PER_AXIS
        {
            errors.push(ValidationError::fatal(format!(
                "CollisionMap: grid {}x{} tiles excede limite conservador {}x{} tiles.",
                cmap.width,
                cmap.height,
                MD_COLLISION_MAP_MAX_TILES_PER_AXIS,
                MD_COLLISION_MAP_MAX_TILES_PER_AXIS
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
                if data_bytes > MD_COLLISION_MAP_MAX_DATA_BYTES {
                    errors.push(ValidationError::fatal(format!(
                        "CollisionMap: data ocupa {} bytes (limite conservador {} bytes).",
                        data_bytes, MD_COLLISION_MAP_MAX_DATA_BYTES
                    )));
                }

                if pixel_width > MD_RESOLUTION_W || pixel_height > MD_RESOLUTION_H {
                    errors.push(ValidationError::warning(format!(
                        "CollisionMap: mapa de mundo {}x{} px excede viewport MD {}x{} px; exige scroll/camera no runtime (nao bloqueia build).",
                        pixel_width, pixel_height, MD_RESOLUTION_W, MD_RESOLUTION_H
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

    let analysis = analyze_md_vram(scene, source_kind);

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
        vram_used: analysis.resident_vram_bytes,
        vram_limit: MD_VRAM_BYTES,
        analysis_mode: analysis.mode.as_str().to_string(),
        project_asset_bytes: analysis.project_asset_bytes,
        resident_vram_bytes: analysis.resident_vram_bytes,
        streamable_vram_bytes: analysis.streamable_vram_bytes,
        dma_frame_bytes: analysis.dma_frame_bytes,
        sprite_resident_bytes: analysis.sprite_resident_bytes,
        tilemap_resident_bytes: analysis.tilemap_resident_bytes,
        hud_resident_bytes: analysis.hud_resident_bytes,
        streamable_sprite_bytes: analysis.streamable_sprite_bytes,
        animated_swap_bytes: analysis.animated_swap_bytes,
        managed_concurrent_sprite_banks: analysis.managed_concurrent_sprite_banks,
        managed_sprite_cells_used: analysis.managed_sprite_cells_used,
        managed_sprite_banks_limit: MD_MANAGED_MAX_CONCURRENT_BANKS,
        managed_sprite_cells_budget: MD_MANAGED_SPRITE_CELL_BUDGET,
        sprite_count,
        sprite_limit: MD_SPRITES_PER_SCREEN,
        scanline_sprite_peak: estimate_max_scanline_sprites(scene),
        scanline_sprite_limit: MD_SPRITES_PER_SCANLINE,
        dma_used: analysis.dma_frame_bytes,
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
    use crate::ugdm::components::{AnimationDef, Components, SpriteComponent};
    use crate::ugdm::entities::{CollisionMap, Entity, PaletteEntry, Scene, Transform};

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

    fn animated_meta_sprite_entity(
        id: &str,
        frame_width: u32,
        frame_height: u32,
        frames: u32,
    ) -> Entity {
        let mut entity = meta_sprite_entity(id, frame_width, frame_height);
        let frame_list: Vec<u32> = (0..frames).collect();
        if let Some(sprite) = entity.components.sprite.as_mut() {
            sprite.animations.insert(
                "run".to_string(),
                AnimationDef {
                    frames: frame_list,
                    fps: 12,
                    looping: true,
                    frame_durations: None,
                    loop_start: None,
                    mugen_frames: None,
                },
            );
        }
        entity
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
    fn collision_map_wider_than_viewport_is_non_fatal_with_warning() {
        let mut scene = empty_scene();
        scene.collision_map = Some(CollisionMap {
            tile_width: 8,
            tile_height: 8,
            width: 128,
            height: 28,
            data: vec![0u8; (128 * 28) as usize],
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
                    && e.message.contains("1024")
                    && e.message.contains("320")
            }),
            "expected viewport exceed warning for 128x8-wide map: {:?}",
            errors
        );
    }

    #[test]
    fn collision_map_with_invalid_data_len_keeps_fatal_guardrails() {
        let mut scene = empty_scene();
        scene.collision_map = Some(CollisionMap {
            tile_width: 8,
            tile_height: 8,
            width: 32,
            height: 32,
            data: vec![0u8; ((32 * 32) - 7) as usize],
        });
        let errors = validate_scene(&scene);
        assert!(
            errors
                .iter()
                .any(|e| !e.is_fatal && e.message.contains("data.len()")),
            "data.len inconsistente deve continuar sinalizado: {:?}",
            errors
        );
        assert!(
            errors
                .iter()
                .all(|e| !e.is_fatal || !e.message.contains("mapa de mundo")),
            "overflow de viewport nao pode virar fatal por regressao: {:?}",
            errors
        );
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
        assert_eq!(status.analysis_mode, "native_static");
        assert_eq!(status.project_asset_bytes, status.resident_vram_bytes);
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
    fn sgdk_project_asset_total_can_exceed_limit_without_resident_overflow() {
        let mut scene = empty_scene();
        // 6 × (64x64 with 6 frames) => total > 64KB, resident (2 frames/sprite) < 64KB.
        for i in 0..6 {
            scene
                .entities
                .push(animated_meta_sprite_entity(&format!("spr_{i}"), 64, 64, 6));
        }

        let errors_native = validate_scene_with_source_kind(&scene, None);
        let errors_sgdk = validate_scene_with_source_kind(&scene, Some("external_sgdk"));

        // Native project: all frames are considered resident -> fatal overflow.
        assert!(
            errors_native
                .iter()
                .any(|error| error.is_fatal && error.message.contains("VRAM Overflow (resident)")),
            "Native project should have fatal VRAM overflow"
        );

        // SGDK managed: resident stays below limit; asset total overflow is warning.
        assert!(
            !errors_sgdk
                .iter()
                .any(|error| error.is_fatal && error.message.contains("VRAM Overflow")),
            "SGDK project should not have fatal overflow for total-only excess: {:?}",
            errors_sgdk
        );
        assert!(
            errors_sgdk
                .iter()
                .any(|error| !error.is_fatal && error.message.contains("Asset total acima da VRAM")),
            "SGDK project should warn about total vs resident split"
        );
        assert!(
            errors_sgdk
                .iter()
                .any(|error| error.message.contains("VRAM Analysis: mode=sgdk_managed")),
            "SGDK warning should expose residency breakdown"
        );
    }

    #[test]
    fn hw_status_residency_breakdown_sums_to_resident_vram() {
        let mut scene = empty_scene();
        scene.entities.push(sprite_entity("player", 16, 16, 0));
        scene.entities.push(sprite_entity("hud_bar", 8, 8, 0));

        let status = hw_status(&scene);
        assert_eq!(
            status.sprite_resident_bytes.saturating_add(status.tilemap_resident_bytes),
            status.resident_vram_bytes,
            "sprite + tilemap deve fechar o residente total"
        );
        assert!(
            status.hud_resident_bytes > 0,
            "entidade com id contendo hud deve contribuir para hud_resident_bytes"
        );
        assert!(
            status.hud_resident_bytes <= status.sprite_resident_bytes,
            "hud_resident_bytes e subconjunto auditavel do sprite residente"
        );
        assert_eq!(status.managed_sprite_banks_limit, MD_MANAGED_MAX_CONCURRENT_BANKS);
        assert_eq!(status.managed_sprite_cells_budget, MD_MANAGED_SPRITE_CELL_BUDGET);
    }

    #[test]
    fn imported_hud_hint_token_takes_precedence_over_name_heuristic() {
        let mut scene = empty_scene();
        let mut entity = sprite_entity("gameplay_actor", 16, 16, 0);
        if let Some(sprite) = entity.components.sprite.as_mut() {
            sprite.priority = "ui_overlay".to_string();
        }
        entity.display_name = Some("Combat actor".to_string());
        if let Some(logic) = entity.components.logic.as_mut() {
            logic.logic_hints.push("sgdk_import:hud_overlay".to_string());
        } else {
            entity.components.logic = Some(crate::ugdm::components::LogicComponent {
                graph: None,
                graph_ref: None,
                graph_origin: None,
                logic_hints: vec!["sgdk_import:hud_overlay".to_string()],
                external_source_refs: Vec::new(),
                imported_semantics: None,
                variables: std::collections::HashMap::new(),
            });
        }
        scene.entities.push(entity);

        let status = hw_status(&scene);
        assert!(
            status.hud_resident_bytes > 0,
            "token canônico do importador SGDK deve marcar HUD mesmo sem nome/prioridade heurística textual"
        );
    }

    #[test]
    fn imported_tilemap_hud_hint_from_logic_metadata_is_accounted() {
        let mut scene = empty_scene();
        let mut entity = Entity {
            entity_id: "tilemap_playfield".to_string(),
            display_name: Some("Arena Main".to_string()),
            prefab: None,
            transform: Transform { x: 0, y: 0 },
            components: Components {
                tilemap: Some(crate::ugdm::components::TilemapComponent {
                    tileset: "assets/tilesets/hud.png".to_string(),
                    map_width: 8,
                    map_height: 8,
                    scroll_x: 0,
                    scroll_y: 0,
                    cells: vec![1; 64],
                }),
                ..Default::default()
            },
        };
        entity.components.logic = Some(crate::ugdm::components::LogicComponent {
            graph: None,
            graph_ref: None,
            graph_origin: None,
            logic_hints: vec!["sgdk_import:canonical_hud_signal".to_string()],
            external_source_refs: Vec::new(),
            imported_semantics: None,
            variables: std::collections::HashMap::new(),
        });
        scene.entities.push(entity);

        let status = hw_status(&scene);
        assert!(
            status.hud_resident_bytes > 0,
            "metadata explícita do importador deve marcar tilemap HUD sem depender de heurística por nome"
        );
        assert!(
            status.hud_resident_bytes <= status.tilemap_resident_bytes,
            "HUD de tilemap precisa ser subconjunto auditável do residente em tilemap"
        );
    }

    #[test]
    fn sgdk_managed_warning_includes_residency_category_tokens() {
        let mut scene = empty_scene();
        for i in 0..6 {
            scene
                .entities
                .push(animated_meta_sprite_entity(&format!("spr_{i}"), 64, 64, 6));
        }
        let warnings: Vec<_> = validate_scene_with_source_kind(&scene, Some("external_sgdk"))
            .into_iter()
            .filter(|e| !e.is_fatal)
            .collect();
        let joined: String = warnings.iter().map(|w| w.message.as_str()).collect::<Vec<_>>().join(" ");
        assert!(
            joined.contains("spr_res=") && joined.contains("tile=") && joined.contains("strm_spr="),
            "avisos SGDK devem listar categorias auditaveis: {}",
            joined
        );
        assert!(joined.contains("banks=") && joined.contains("cells="));
    }

    #[test]
    fn imported_sgdk_project_still_fails_when_resident_overflows() {
        let mut scene = empty_scene();
        // Um único banco residente gigante já ultrapassa o limite físico de VRAM.
        scene
            .entities
            .push(meta_sprite_entity("spr_huge", 512, 512));

        let errors = validate_scene_with_source_kind(&scene, Some("imported_sgdk"));

        assert!(
            errors
                .iter()
                .any(|error| error.is_fatal && error.message.contains("VRAM Overflow (resident)")),
            "imported_sgdk must stay fatal when resident set really overflows: {:?}",
            errors
        );
        assert!(
            errors
                .iter()
                .any(|error| !error.is_fatal && error.message.contains("VRAM Analysis")),
            "imported_sgdk should expose analysis breakdown"
        );
    }
}
