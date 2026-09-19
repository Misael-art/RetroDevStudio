//! Composição de um frame real do doador HAMOOPIG.
//!
//! Esta superfície é deliberadamente separada da descoberta heurística de
//! tiles. O manifesto abaixo só é aplicável à ROM BYOR histórica cujo hash
//! está travado; os offsets e descritores foram conferidos contra os bytes
//! compilados e o layout documentado pelo ResComp do SGDK.

use std::path::Path;

use base64::Engine;
use image::{codecs::png::PngEncoder, ImageEncoder, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

use super::extract::{canonical_dir_under, write_file_immutable};
use super::inspection::InspectionSession;
use super::rom_library::{decomp_work_dir, sha256_hex, ArtifactRef};
use crate::tools::reverse::loader::rex_read_rom;

pub const HAMOOPIG_REFERENCE_SHA256: &str =
    "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
const RESOURCE_ID: &str = "spr_ryo_100";
const FRAME_ID: &str = "spr_ryo_100/frame-0";
const FRAME_WIDTH: u32 = 64;
const FRAME_HEIGHT: u32 = 104;
const TILE_BYTES: usize = 32;
const TILE_DATA_OFFSET: usize = 0x863a0;
const TILE_DATA_SIZE: usize = 0x800;
const PALETTE_OFFSET: usize = 0x2cc68;
const PALETTE_SIZE: usize = 0x20;
const DESCRIPTORS_OFFSET: usize = 0x22260;
const DESCRIPTORS_SIZE: usize = 8 * 6;
const SOURCE_PNG_SHA256: &str = "1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpriteFramePart {
    pub tile_start: u16,
    pub tile_count: u16,
    pub tile_width: u8,
    pub tile_height: u8,
    pub x: u16,
    pub y: u16,
    pub x_flip: u16,
    pub y_flip: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionSpriteFrame {
    pub session_id: String,
    pub resource_id: String,
    pub frame_id: String,
    pub available: bool,
    pub reason: Option<String>,
    pub width: u32,
    pub height: u32,
    pub data_url: Option<String>,
    pub artifact: Option<ArtifactRef>,
    pub png_sha256: Option<String>,
    pub pixels_sha256: Option<String>,
    pub rom_sha256: String,
    pub tile_data_offset: u64,
    pub tile_data_size: u64,
    pub palette_offset: u64,
    pub palette_size: u64,
    pub descriptor_offset: u64,
    pub flip_x: bool,
    pub flip_y: bool,
    pub transparency_index: u8,
    pub parts: Vec<SpriteFramePart>,
    pub metadata_source: String,
    pub rom_evidence: Vec<String>,
    pub donor_evidence: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Part {
    tile_start: usize,
    tile_count: usize,
    tile_width: usize,
    tile_height: usize,
    x: usize,
    y: usize,
    x_flip: usize,
    y_flip: usize,
}

const EXPECTED_DESCRIPTOR_BYTES: [u8; DESCRIPTORS_SIZE] = [
    0x2c, 0x1c, 0x0f, 0x05, 0x1b, 0x10, 0x0c, 0x3c, 0x0f, 0x04, 0x1c, 0x10, 0x37, 0x11, 0x07, 0x25,
    0x0b, 0x08, 0x14, 0x3c, 0x06, 0x24, 0x0c, 0x06, 0x4c, 0x0c, 0x09, 0x05, 0x23, 0x06, 0x57, 0x01,
    0x09, 0x25, 0x03, 0x06, 0x58, 0x00, 0x05, 0x00, 0x30, 0x04, 0x04, 0x5c, 0x04, 0x15, 0x1b, 0x02,
];

fn decode_parts(descriptors: &[u8]) -> Result<Vec<Part>, String> {
    if descriptors != EXPECTED_DESCRIPTOR_BYTES {
        return Err("descritores do frame não correspondem ao manifesto ResComp".to_string());
    }
    let mut tile_start = 0usize;
    let mut parts = Vec::with_capacity(descriptors.len() / 6);
    for descriptor in descriptors.chunks_exact(6) {
        let tile_width = usize::from(descriptor[2] >> 2) + 1;
        let tile_height = usize::from(descriptor[2] & 0x03) + 1;
        let tile_count = usize::from(descriptor[5]);
        if tile_count != tile_width * tile_height {
            return Err("quantidade de tiles incompatível com o tamanho VDP".to_string());
        }
        parts.push(Part {
            tile_start,
            tile_count,
            tile_width,
            tile_height,
            x: usize::from(descriptor[3]),
            y: usize::from(descriptor[0]),
            x_flip: usize::from(descriptor[4]),
            y_flip: usize::from(descriptor[1]),
        });
        tile_start += tile_count;
    }
    if tile_start * TILE_BYTES != TILE_DATA_SIZE {
        return Err("descritores não cobrem exatamente os bytes compilados".to_string());
    }
    Ok(parts)
}

fn expand_channel(value: u16) -> u8 {
    (value as u8) * 36
}

fn palette_rgba(palette: &[u8], index: u8) -> Rgba<u8> {
    let word = u16::from_be_bytes([palette[index as usize * 2], palette[index as usize * 2 + 1]]);
    let red = expand_channel((word >> 1) & 0x7);
    let green = expand_channel((word >> 5) & 0x7);
    let blue = expand_channel((word >> 9) & 0x7);
    Rgba([red, green, blue, if index == 0 { 0 } else { 255 }])
}

/// Compõe bytes 4bpp nibble-high-first e descritores VDP sem depender do
/// PNG do doador. A função é pura para que os negativos de ordem, paleta e
/// flip possam provar que o oráculo rejeita alterações.
fn compose_rgba(
    tile_data: &[u8],
    palette: &[u8],
    parts: &[Part],
    flip_x: bool,
    flip_y: bool,
) -> Result<RgbaImage, String> {
    if tile_data.len() != TILE_DATA_SIZE || palette.len() != PALETTE_SIZE {
        return Err("tamanho de bytes compilados incompatível com o manifesto".to_string());
    }
    let mut canvas = RgbaImage::from_pixel(FRAME_WIDTH, FRAME_HEIGHT, palette_rgba(palette, 0));
    for part in parts {
        for local_y in 0..part.tile_height {
            for local_x in 0..part.tile_width {
                let source_x = if flip_x {
                    part.tile_width - 1 - local_x
                } else {
                    local_x
                };
                let source_y = if flip_y {
                    part.tile_height - 1 - local_y
                } else {
                    local_y
                };
                // ResComp's Sprite Tileset deliberately stores each VDP
                // sprite vertically: x column, then y row (not row-major).
                let tile_index = part.tile_start + source_x * part.tile_height + source_y;
                let tile = &tile_data[tile_index * TILE_BYTES..(tile_index + 1) * TILE_BYTES];
                let dest_x = (if flip_x { part.x_flip } else { part.x }) + local_x * 8;
                let dest_y = (if flip_y { part.y_flip } else { part.y }) + local_y * 8;
                for pixel_y in 0..8usize {
                    for pixel_x in 0..8usize {
                        let source_pixel_x = if flip_x { 7 - pixel_x } else { pixel_x };
                        let source_pixel_y = if flip_y { 7 - pixel_y } else { pixel_y };
                        let packed = tile[source_pixel_y * 4 + source_pixel_x / 2];
                        let index = if source_pixel_x % 2 == 0 {
                            packed >> 4
                        } else {
                            packed & 0x0f
                        };
                        canvas.put_pixel(
                            (dest_x + pixel_x) as u32,
                            (dest_y + pixel_y) as u32,
                            palette_rgba(palette, index),
                        );
                    }
                }
            }
        }
    }
    Ok(canvas)
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("falha ao codificar frame composto: {error}"))?;
    Ok(bytes)
}

fn parts_wire(parts: &[Part]) -> Vec<SpriteFramePart> {
    let mut tile_start = 0u16;
    parts
        .iter()
        .map(|part| {
            let result = SpriteFramePart {
                tile_start,
                tile_count: part.tile_count as u16,
                tile_width: part.tile_width as u8,
                tile_height: part.tile_height as u8,
                x: part.x as u16,
                y: part.y as u16,
                x_flip: part.x_flip as u16,
                y_flip: part.y_flip as u16,
            };
            tile_start += part.tile_count as u16;
            result
        })
        .collect()
}

pub fn compose_for_session(
    session: &InspectionSession,
    resource_id: &str,
    flip_x: bool,
    flip_y: bool,
) -> Result<InspectionSpriteFrame, String> {
    if resource_id != RESOURCE_ID {
        return Err(format!(
            "sprite_manifest_missing: nenhum frame HAMOOPIG rastreável para '{resource_id}'"
        ));
    }
    let rom_path = Path::new(&session.rom_path);
    let (identity, rom) = rex_read_rom(rom_path)?;
    if identity.normalized_sha256 != HAMOOPIG_REFERENCE_SHA256 {
        return Err(format!(
            "sprite_manifest_rom_mismatch: spr_ryo_100 exige ROM BYOR {HAMOOPIG_REFERENCE_SHA256}, observado {}",
            identity.normalized_sha256
        ));
    }
    let required_end = [
        TILE_DATA_OFFSET + TILE_DATA_SIZE,
        PALETTE_OFFSET + PALETTE_SIZE,
        DESCRIPTORS_OFFSET + DESCRIPTORS_SIZE,
    ]
    .into_iter()
    .max()
    .unwrap();
    if rom.len() < required_end {
        return Err("sprite_manifest_rom_short: ROM não contém o frame compilado".to_string());
    }
    let parts = decode_parts(&rom[DESCRIPTORS_OFFSET..DESCRIPTORS_OFFSET + DESCRIPTORS_SIZE])?;
    let image = compose_rgba(
        &rom[TILE_DATA_OFFSET..TILE_DATA_OFFSET + TILE_DATA_SIZE],
        &rom[PALETTE_OFFSET..PALETTE_OFFSET + PALETTE_SIZE],
        &parts,
        flip_x,
        flip_y,
    )?;
    let pixels = image.as_raw();
    let png = encode_png(&image)?;
    let png_sha256 = sha256_hex(&png);
    let pixels_sha256 = sha256_hex(pixels);
    let previews_dir = canonical_dir_under(
        &decomp_work_dir(),
        &["extract", &identity.normalized_sha256, "previews"],
    )?;
    let path = previews_dir.join(format!("sprite-frame-{RESOURCE_ID}-{png_sha256}.png"));
    write_file_immutable(&path, &png, &png_sha256)?;
    let artifact = ArtifactRef {
        label: "sprite-frame-composition".to_string(),
        path: path.display().to_string(),
        sha256: png_sha256.clone(),
    };
    Ok(InspectionSpriteFrame {
        session_id: session.session_id.clone(),
        resource_id: RESOURCE_ID.to_string(),
        frame_id: FRAME_ID.to_string(),
        available: true,
        reason: None,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        data_url: Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&png)
        )),
        artifact: Some(artifact),
        png_sha256: Some(png_sha256),
        pixels_sha256: Some(pixels_sha256),
        rom_sha256: identity.normalized_sha256,
        tile_data_offset: TILE_DATA_OFFSET as u64,
        tile_data_size: TILE_DATA_SIZE as u64,
        palette_offset: PALETTE_OFFSET as u64,
        palette_size: PALETTE_SIZE as u64,
        descriptor_offset: DESCRIPTORS_OFFSET as u64,
        flip_x,
        flip_y,
        transparency_index: 0,
        parts: parts_wire(&parts),
        metadata_source: "Metadado doador + bytes compilados verificáveis; não é descoberta automática".to_string(),
        rom_evidence: vec![
            format!("normalized_sha256={HAMOOPIG_REFERENCE_SHA256}"),
            format!("tile_data=0x{TILE_DATA_OFFSET:06X}+0x{TILE_DATA_SIZE:X}"),
            format!("palette=0x{PALETTE_OFFSET:06X}+0x{PALETTE_SIZE:X}"),
            format!("descriptors=0x{DESCRIPTORS_OFFSET:06X}+0x{DESCRIPTORS_SIZE:X}"),
        ],
        donor_evidence: vec![
            "res/sprite.res: SPRITE spr_ryo_100 sprite/ryo/100.png 8 13 NONE 0".to_string(),
            format!("source_png_sha256={SOURCE_PNG_SHA256}"),
            "SGDK ResComp: FrameVDPSprite (offsetY, offsetYFlip, size, offsetX, offsetXFlip, numTile)".to_string(),
            "transformação: tiles 4bpp nibble alto primeiro, ordem vertical por VDP sprite (x→y); paleta MD RGB333; índice 0 transparente".to_string(),
        ],
        limitations: vec![
            "Somente spr_ryo_100/frame-0 da ROM HAMOOPIG de referência está automatizado".to_string(),
            "A identidade semântica, frame e ordem dos VDP sprites vêm do projeto doador".to_string(),
            "Não cobre animação, runtime de hitbox, streaming ou reconstrução do jogo".to_string(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_parts() -> Vec<Part> {
        vec![Part {
            tile_start: 0,
            tile_count: 2,
            tile_width: 2,
            tile_height: 1,
            x: 0,
            y: 0,
            x_flip: 0,
            y_flip: 0,
        }]
    }

    fn fixture_palette() -> Vec<u8> {
        let mut palette = vec![0u8; PALETTE_SIZE];
        palette[2..4].copy_from_slice(&0x000e_u16.to_be_bytes());
        palette[4..6].copy_from_slice(&0x00e0_u16.to_be_bytes());
        palette[6..8].copy_from_slice(&0x0e00_u16.to_be_bytes());
        palette
    }

    fn fixture_tiles() -> Vec<u8> {
        let mut tiles = vec![0u8; TILE_DATA_SIZE];
        tiles[0] = 0x12;
        tiles[TILE_BYTES] = 0x30;
        tiles
    }

    #[test]
    fn md_nibble_order_and_transparency_are_composed() {
        let image = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            false,
            false,
        )
        .unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [252, 0, 0, 255]);
        assert_eq!(image.get_pixel(1, 0).0, [0, 252, 0, 255]);
        assert_eq!(image.get_pixel(8, 0).0, [0, 0, 252, 255]);
        assert_eq!(image.get_pixel(9, 0).0, [0, 0, 0, 0]);
    }

    #[test]
    fn wrong_tile_order_is_detected_by_literal_pixels() {
        let mut parts = fixture_parts();
        parts[0].tile_start = 1;
        let expected = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            false,
            false,
        )
        .unwrap();
        let wrong =
            compose_rgba(&fixture_tiles(), &fixture_palette(), &parts, false, false).unwrap();
        assert_ne!(expected.as_raw(), wrong.as_raw());
    }

    #[test]
    fn wrong_palette_is_detected_by_literal_pixels() {
        let expected = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            false,
            false,
        )
        .unwrap();
        let mut palette = fixture_palette();
        palette[2..4].copy_from_slice(&0x0e00_u16.to_be_bytes());
        let wrong =
            compose_rgba(&fixture_tiles(), &palette, &fixture_parts(), false, false).unwrap();
        assert_ne!(expected.as_raw(), wrong.as_raw());
    }

    #[test]
    fn wrong_flip_is_detected_by_literal_pixels() {
        let expected = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            false,
            false,
        )
        .unwrap();
        let wrong = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            true,
            false,
        )
        .unwrap();
        assert_ne!(expected.as_raw(), wrong.as_raw());
    }
}
