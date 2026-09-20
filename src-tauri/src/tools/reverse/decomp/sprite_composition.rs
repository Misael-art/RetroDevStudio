//! Composição de um frame real do doador HAMOOPIG.
//!
//! Esta superfície é deliberadamente separada da descoberta heurística de
//! tiles. O manifesto abaixo só é aplicável à ROM BYOR histórica cujo hash
//! está travado; os offsets e descritores foram conferidos contra os bytes
//! compilados e o layout documentado pelo ResComp do SGDK.

use std::fs;
use std::path::Path;

use base64::Engine;
use image::{codecs::png::PngEncoder, ImageEncoder, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

use super::extract::{canonical_dir_under, reject_if_symlink, write_file_immutable};
use super::inspection::InspectionSession;
use super::rom_library::{decomp_work_dir, sha256_hex, ArtifactRef};
use crate::tools::reverse::loader::rex_read_rom;

pub const HAMOOPIG_REFERENCE_SHA256: &str =
    "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
pub const TAIKETSU_REFERENCE_SHA256: &str =
    "3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c";
pub const SONIC1_REFERENCE_SHA256: &str =
    "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
const SONIC1_DISASM_REV00_BUILD_SHA256: &str =
    "46160baa06362c711c9f1a5017cb7371026444936c8af5e93a78996cf32ff2a6";
const TILE_BYTES: usize = 32;
const TILE_DATA_SIZE: usize = 0x800;
const PALETTE_SIZE: usize = 0x20;
const HAMOOPIG_SOURCE_PNG_SHA256: &str =
    "1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b";
const TAIKETSU_SPARK0_SOURCE_PNG_SHA256: &str =
    "cafaf180ba006903242aa822fb3c0dceb42424a9e0bd07a5a19b75f33a4bf196";
const SONIC1_SOURCE_ART_SHA256: &str =
    "934e48178cfddd8af1627493114a25d09671bbb4a5626f4d95a93001c8b78589";
const SONIC1_SOURCE_PALETTE_SHA256: &str =
    "8391d8af82c19043c89e32abf87bdd057dbe2a845c58a3a58761edceaeeb9f8a";
const SONIC1_SOURCE_MAPPING_SHA256: &str =
    "18749e9ba7ab2eae27ebafd451a6f8a05e42b426b841d03d6ef28b08ed0abae1";
const SONIC1_STAND_PIXELS_SHA256: &str =
    "ce95ea66f2cfcec40a0fb12cb35fe5e88530de036de9f897333ce762f06b40d4";
const SONIC1_STAND_MAPPING: [u8; 21] = [
    0x04, 0xec, 0x08, 0x00, 0x00, 0xf0, 0xf4, 0x0d, 0x00, 0x03, 0xf0, 0x04, 0x08, 0x00, 0x0b, 0xf0,
    0x0c, 0x08, 0x00, 0x0e, 0xf8,
];

const FRAME0_DESCRIPTORS: [u8; 8 * 6] = [
    0x2c, 0x1c, 0x0f, 0x05, 0x1b, 0x10, 0x0c, 0x3c, 0x0f, 0x04, 0x1c, 0x10, 0x37, 0x11, 0x07, 0x25,
    0x0b, 0x08, 0x14, 0x3c, 0x06, 0x24, 0x0c, 0x06, 0x4c, 0x0c, 0x09, 0x05, 0x23, 0x06, 0x57, 0x01,
    0x09, 0x25, 0x03, 0x06, 0x58, 0x00, 0x05, 0x00, 0x30, 0x04, 0x04, 0x5c, 0x04, 0x15, 0x1b, 0x02,
];
const FRAME1_DESCRIPTORS: [u8; 8 * 6] = [
    0x11, 0x37, 0x0f, 0x07, 0x19, 0x10, 0x31, 0x1f, 0x0e, 0x08, 0x18, 0x0c, 0x37, 0x11, 0x07, 0x24,
    0x0c, 0x08, 0x11, 0x3f, 0x06, 0x27, 0x09, 0x06, 0x49, 0x0f, 0x09, 0x05, 0x23, 0x06, 0x57, 0x01,
    0x09, 0x24, 0x04, 0x06, 0x58, 0x00, 0x09, 0x00, 0x28, 0x06, 0x04, 0x54, 0x09, 0x0c, 0x1c, 0x06,
];
const FRAME2_DESCRIPTORS: [u8; 7 * 6] = [
    0x0b, 0x3d, 0x0f, 0x01, 0x1f, 0x10, 0x2b, 0x1d, 0x0f, 0x08, 0x18, 0x10, 0x0b, 0x3d, 0x0b, 0x21,
    0x07, 0x0c, 0x48, 0x00, 0x0b, 0x00, 0x28, 0x0c, 0x48, 0x00, 0x0b, 0x24, 0x04, 0x0c, 0x38, 0x20,
    0x05, 0x28, 0x08, 0x04, 0x03, 0x5d, 0x04, 0x15, 0x1b, 0x02,
];
const FRAME3_DESCRIPTORS: [u8; 7 * 6] = [
    0x0a, 0x3e, 0x0f, 0x04, 0x1c, 0x10, 0x2a, 0x1e, 0x0f, 0x08, 0x18, 0x10, 0x0a, 0x3e, 0x0b, 0x24,
    0x04, 0x0c, 0x48, 0x00, 0x0b, 0x00, 0x28, 0x0c, 0x48, 0x00, 0x0b, 0x24, 0x04, 0x0c, 0x38, 0x20,
    0x05, 0x28, 0x08, 0x04, 0x02, 0x5e, 0x04, 0x15, 0x1b, 0x02,
];
const SPARK0_FRAME0_DESCRIPTORS: [u8; 6] = [0x00, 0x00, 0x0a, 0x00, 0x00, 0x09];

struct SpriteManifest {
    resource_id: &'static str,
    frame_id: &'static str,
    frame_label: &'static str,
    rom_sha256: &'static str,
    source_png_sha256: &'static str,
    width: u32,
    height: u32,
    tile_data_offset: usize,
    tile_data_size: usize,
    palette_offset: usize,
    descriptor_offset: usize,
    descriptors: &'static [u8],
}

const FRAME_MANIFESTS: [SpriteManifest; 6] = [
    SpriteManifest {
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-0",
        frame_label: "frame 0",
        rom_sha256: HAMOOPIG_REFERENCE_SHA256,
        source_png_sha256: HAMOOPIG_SOURCE_PNG_SHA256,
        width: 64,
        height: 104,
        tile_data_offset: 0x863a0,
        tile_data_size: 0x800,
        palette_offset: 0x2cc68,
        descriptor_offset: 0x22260,
        descriptors: &FRAME0_DESCRIPTORS,
    },
    SpriteManifest {
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-1",
        frame_label: "frame 1",
        rom_sha256: HAMOOPIG_REFERENCE_SHA256,
        source_png_sha256: HAMOOPIG_SOURCE_PNG_SHA256,
        width: 64,
        height: 104,
        tile_data_offset: 0x86ba0,
        tile_data_size: 0x840,
        palette_offset: 0x2cc68,
        descriptor_offset: 0x222a2,
        descriptors: &FRAME1_DESCRIPTORS,
    },
    SpriteManifest {
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-2",
        frame_label: "frame 2",
        rom_sha256: HAMOOPIG_REFERENCE_SHA256,
        source_png_sha256: HAMOOPIG_SOURCE_PNG_SHA256,
        width: 64,
        height: 104,
        tile_data_offset: 0x873e0,
        tile_data_size: 0x940,
        palette_offset: 0x2cc68,
        descriptor_offset: 0x222e4,
        descriptors: &FRAME2_DESCRIPTORS,
    },
    SpriteManifest {
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-3",
        frame_label: "frame 3",
        rom_sha256: HAMOOPIG_REFERENCE_SHA256,
        source_png_sha256: HAMOOPIG_SOURCE_PNG_SHA256,
        width: 64,
        height: 104,
        tile_data_offset: 0x87d20,
        tile_data_size: 0x940,
        palette_offset: 0x2cc68,
        descriptor_offset: 0x22320,
        descriptors: &FRAME3_DESCRIPTORS,
    },
    SpriteManifest {
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-4",
        frame_label: "frame 4 (deduplicated with frame 2)",
        rom_sha256: HAMOOPIG_REFERENCE_SHA256,
        source_png_sha256: HAMOOPIG_SOURCE_PNG_SHA256,
        width: 64,
        height: 104,
        tile_data_offset: 0x873e0,
        tile_data_size: 0x940,
        palette_offset: 0x2cc68,
        descriptor_offset: 0x222e4,
        descriptors: &FRAME2_DESCRIPTORS,
    },
    SpriteManifest {
        resource_id: "spr_spark0",
        frame_id: "spr_spark0/frame-0",
        frame_label: "frame 0",
        rom_sha256: TAIKETSU_REFERENCE_SHA256,
        source_png_sha256: TAIKETSU_SPARK0_SOURCE_PNG_SHA256,
        width: 24,
        height: 24,
        tile_data_offset: 0x80060,
        tile_data_size: 0x120,
        palette_offset: 0x2e134,
        descriptor_offset: 0x22f94,
        descriptors: &SPARK0_FRAME0_DESCRIPTORS,
    },
];

struct SonicManifest {
    resource_id: &'static str,
    frame_id: &'static str,
    rom_sha256: &'static str,
    width: u32,
    height: u32,
    tile_data_offset: usize,
    tile_data_size: usize,
    palette_offset: usize,
    descriptor_offset: usize,
    descriptors: &'static [u8],
}

const SONIC1_MANIFEST: SonicManifest = SonicManifest {
    resource_id: "sonic1_sonic",
    frame_id: "sonic1_sonic/stand",
    rom_sha256: SONIC1_REFERENCE_SHA256,
    width: 32,
    height: 40,
    tile_data_offset: 0x21afe,
    tile_data_size: 0xa120,
    palette_offset: 0x2388,
    descriptor_offset: 0x21293,
    descriptors: &SONIC1_STAND_MAPPING,
};

fn manifest_for(resource_id: &str, frame_id: &str) -> Result<&'static SpriteManifest, String> {
    FRAME_MANIFESTS
        .iter()
        .find(|manifest| manifest.frame_id == frame_id && manifest.resource_id == resource_id)
        .ok_or_else(|| {
            format!(
                "sprite_manifest_missing: nenhum frame rastreável para '{resource_id}/{frame_id}'"
            )
        })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpriteFramePart {
    pub tile_start: u16,
    pub tile_count: u16,
    pub tile_width: u8,
    pub tile_height: u8,
    pub x: i16,
    pub y: i16,
    pub x_flip: i16,
    pub y_flip: i16,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SonicPart {
    tile_start: usize,
    tile_width: usize,
    tile_height: usize,
    x: i16,
    y: i16,
}

fn decode_parts(descriptors: &[u8], expected: &[u8]) -> Result<Vec<Part>, String> {
    if descriptors != expected {
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
    if tile_start == 0 {
        return Err("descritores não cobrem exatamente os bytes compilados".to_string());
    }
    Ok(parts)
}

fn decode_sonic_parts(descriptors: &[u8]) -> Result<Vec<SonicPart>, String> {
    if descriptors != SONIC1_STAND_MAPPING.as_slice() || descriptors.len() != 21 {
        return Err("mapping Sonic 1 não corresponde ao frame stand fixado".to_string());
    }
    let count = usize::from(descriptors[0]);
    let mut parts = Vec::with_capacity(count);
    for descriptor in descriptors[1..].chunks_exact(5) {
        let size = descriptor[1];
        let tile_width = usize::from((size >> 2) & 0x03) + 1;
        let tile_height = usize::from(size & 0x03) + 1;
        parts.push(SonicPart {
            tile_start: usize::from(u16::from_be_bytes([descriptor[2], descriptor[3]])),
            tile_width,
            tile_height,
            x: i16::from(i8::from_be_bytes([descriptor[4]])),
            y: i16::from(i8::from_be_bytes([descriptor[0]])),
        });
    }
    if parts.len() != count {
        return Err("mapping Sonic 1 tem contagem de peças inconsistente".to_string());
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
    width: u32,
    height: u32,
    flip_x: bool,
    flip_y: bool,
) -> Result<RgbaImage, String> {
    let required_tiles = parts
        .iter()
        .map(|part| part.tile_start + part.tile_count)
        .max()
        .unwrap_or_default();
    if tile_data.len() < required_tiles * TILE_BYTES || palette.len() != PALETTE_SIZE {
        return Err("tamanho de bytes compilados incompatível com o manifesto".to_string());
    }
    let mut canvas = RgbaImage::from_pixel(width, height, palette_rgba(palette, 0));
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

fn compose_sonic_rgba(
    tile_data: &[u8],
    palette: &[u8],
    parts: &[SonicPart],
    width: u32,
    height: u32,
    flip_x: bool,
    flip_y: bool,
) -> Result<RgbaImage, String> {
    if palette.len() != PALETTE_SIZE {
        return Err("paleta Sonic 1 incompatível com o manifesto".to_string());
    }
    let required_tiles = parts
        .iter()
        .map(|part| part.tile_start + part.tile_width * part.tile_height)
        .max()
        .unwrap_or_default();
    if tile_data.len() < required_tiles * TILE_BYTES {
        return Err("art bruto Sonic 1 curto para o mapping stand".to_string());
    }
    let mut canvas = RgbaImage::from_pixel(width, height, palette_rgba(palette, 0));
    let origin_x = 16i32;
    let origin_y = 20i32;
    for part in parts {
        for local_y in 0..part.tile_height {
            for local_x in 0..part.tile_width {
                let tile_index = part.tile_start + local_y * part.tile_width + local_x;
                let tile = &tile_data[tile_index * TILE_BYTES..(tile_index + 1) * TILE_BYTES];
                for pixel_y in 0..8i32 {
                    for pixel_x in 0..8i32 {
                        let packed = tile[pixel_y as usize * 4 + pixel_x as usize / 2];
                        let palette_index = if pixel_x % 2 == 0 {
                            packed >> 4
                        } else {
                            packed & 0x0f
                        };
                        let source_x = origin_x + i32::from(part.x) + local_x as i32 * 8 + pixel_x;
                        let source_y = origin_y + i32::from(part.y) + local_y as i32 * 8 + pixel_y;
                        let dest_x = if flip_x {
                            width as i32 - 1 - source_x
                        } else {
                            source_x
                        };
                        let dest_y = if flip_y {
                            height as i32 - 1 - source_y
                        } else {
                            source_y
                        };
                        if dest_x < 0
                            || dest_y < 0
                            || dest_x >= width as i32
                            || dest_y >= height as i32
                        {
                            return Err("mapping Sonic 1 ultrapassa o canvas nativo".to_string());
                        }
                        canvas.put_pixel(
                            dest_x as u32,
                            dest_y as u32,
                            palette_rgba(palette, palette_index),
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
                x: part.x as i16,
                y: part.y as i16,
                x_flip: part.x_flip as i16,
                y_flip: part.y_flip as i16,
            };
            tile_start += part.tile_count as u16;
            result
        })
        .collect()
}

fn sonic_parts_wire(parts: &[SonicPart]) -> Vec<SpriteFramePart> {
    parts
        .iter()
        .map(|part| SpriteFramePart {
            tile_start: part.tile_start as u16,
            tile_count: (part.tile_width * part.tile_height) as u16,
            tile_width: part.tile_width as u8,
            tile_height: part.tile_height as u8,
            x: part.x,
            y: part.y,
            x_flip: 0,
            y_flip: 0,
        })
        .collect()
}

fn artifact_name_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn compose_sonic_stand(
    session: &InspectionSession,
    flip_x: bool,
    flip_y: bool,
) -> Result<InspectionSpriteFrame, String> {
    let manifest = &SONIC1_MANIFEST;
    if session.identity.normalized_sha256 != manifest.rom_sha256 {
        return Err(format!(
            "sprite_manifest_session_mismatch: {} exige sessão com ROM BYOR {}, observado {}",
            manifest.resource_id, manifest.rom_sha256, session.identity.normalized_sha256
        ));
    }
    let selected_rom_path = session
        .edit
        .as_ref()
        .map(|edit| edit.modified_rom_path.as_str())
        .unwrap_or(session.rom_path.as_str());
    let rom_path = Path::new(selected_rom_path);
    if session.edit.is_some() {
        let edits_dir = canonical_dir_under(
            &decomp_work_dir(),
            &["extract", &session.identity.normalized_sha256, "edits"],
        )?;
        reject_if_symlink(rom_path)?;
        let canonical_rom_path = fs::canonicalize(rom_path)
            .map_err(|error| format!("sprite_edit_path_unreadable: {error}"))?;
        if canonical_rom_path.parent() != Some(edits_dir.as_path()) {
            return Err(
                "sprite_edit_path_scope: cópia editada fora do diretório da sessão".to_string(),
            );
        }
    }
    let (identity, rom) = rex_read_rom(rom_path)?;
    if let Some(edit) = &session.edit {
        if edit.resource_id != manifest.resource_id
            || edit.frame_id != manifest.frame_id
            || edit.original_rom_sha256 != session.identity.normalized_sha256
            || edit.modified_rom_sha256 != identity.normalized_sha256
        {
            return Err(
                "sprite_edit_identity_mismatch: edição não corresponde à sessão Sonic".to_string(),
            );
        }
    } else if identity.normalized_sha256 != manifest.rom_sha256 {
        return Err(format!(
            "sprite_manifest_rom_mismatch: {} exige ROM BYOR {}, observado {}",
            manifest.resource_id, manifest.rom_sha256, identity.normalized_sha256
        ));
    }
    let required_end = [
        manifest.tile_data_offset + manifest.tile_data_size,
        manifest.palette_offset + PALETTE_SIZE,
        manifest.descriptor_offset + manifest.descriptors.len(),
    ]
    .into_iter()
    .max()
    .unwrap();
    if rom.len() < required_end {
        return Err("sprite_manifest_rom_short: ROM não contém o recurso Sonic 1".to_string());
    }
    let parts = decode_sonic_parts(
        &rom[manifest.descriptor_offset..manifest.descriptor_offset + manifest.descriptors.len()],
    )?;
    let image = compose_sonic_rgba(
        &rom[manifest.tile_data_offset..manifest.tile_data_offset + manifest.tile_data_size],
        &rom[manifest.palette_offset..manifest.palette_offset + PALETTE_SIZE],
        &parts,
        manifest.width,
        manifest.height,
        flip_x,
        flip_y,
    )?;
    let pixels = image.as_raw();
    let png = encode_png(&image)?;
    let png_sha256 = sha256_hex(&png);
    let pixels_sha256 = sha256_hex(pixels);
    if session.edit.is_none() && !flip_x && !flip_y && pixels_sha256 != SONIC1_STAND_PIXELS_SHA256 {
        return Err(format!(
            "sprite_oracle_mismatch: frame stand esperado {}, observado {}",
            SONIC1_STAND_PIXELS_SHA256, pixels_sha256
        ));
    }
    let previews_dir = canonical_dir_under(
        &decomp_work_dir(),
        &["extract", &session.identity.normalized_sha256, "previews"],
    )?;
    let path = previews_dir.join(format!(
        "sprite-frame-{}-{}-{png_sha256}.png",
        artifact_name_component(manifest.resource_id),
        artifact_name_component(manifest.frame_id),
    ));
    write_file_immutable(&path, &png, &png_sha256)?;
    let artifact = ArtifactRef {
        label: "sprite-frame-composition".to_string(),
        path: path.display().to_string(),
        sha256: png_sha256.clone(),
    };
    let selected_rom_sha256 = identity.normalized_sha256.clone();
    Ok(InspectionSpriteFrame {
        session_id: session.session_id.clone(),
        resource_id: manifest.resource_id.to_string(),
        frame_id: manifest.frame_id.to_string(),
        available: true,
        reason: None,
        width: manifest.width,
        height: manifest.height,
        data_url: Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&png)
        )),
        artifact: Some(artifact),
        png_sha256: Some(png_sha256),
        pixels_sha256: Some(pixels_sha256),
        rom_sha256: selected_rom_sha256.clone(),
        tile_data_offset: manifest.tile_data_offset as u64,
        tile_data_size: manifest.tile_data_size as u64,
        palette_offset: manifest.palette_offset as u64,
        palette_size: PALETTE_SIZE as u64,
        descriptor_offset: manifest.descriptor_offset as u64,
        flip_x,
        flip_y,
        transparency_index: 0,
        parts: sonic_parts_wire(&parts),
        metadata_source: "Perfil assistido Sonic 1 Rev00: mapping público fixado + bytes locais conferidos; não é descoberta automática".to_string(),
        rom_evidence: vec![
            format!("base_normalized_sha256={SONIC1_REFERENCE_SHA256}"),
            format!("selected_rom_sha256={selected_rom_sha256}"),
            format!("reference_s1disasm_rev00_build_sha256={SONIC1_DISASM_REV00_BUILD_SHA256}"),
            format!("art_unc=0x{:06X}+0x{:X}", manifest.tile_data_offset, manifest.tile_data_size),
            format!("palette=0x{:06X}+0x{PALETTE_SIZE:X}", manifest.palette_offset),
            format!("mapping=0x{:06X}+0x{:X}", manifest.descriptor_offset, manifest.descriptors.len()),
            format!("art_bytes_sha256={SONIC1_SOURCE_ART_SHA256}"),
            format!("palette_bytes_sha256={SONIC1_SOURCE_PALETTE_SHA256}"),
            format!("mapping_bytes_sha256={SONIC1_SOURCE_MAPPING_SHA256}"),
        ],
        donor_evidence: vec![
            "s1disasm 064e3c68… com Revision=0 (Rev00)".to_string(),
            "_maps/Sonic.asm · MS_Stand · SonicMappingsVer=1".to_string(),
            "artunc/Sonic.unc + palette/Sonic.bin".to_string(),
            "decoder independente: tiles MD 4bpp row-major, RGB333, índice 0 transparente".to_string(),
        ],
        limitations: vec![
            "ROM local diverge do build Rev00 em 675 bytes no prefixo de 512 KiB e possui bytes extras após 0x80000; o perfil é restrito ao SHA local".to_string(),
            "Identidade do recurso, frame e mapping vêm do disassembly doador; os bytes e hashes do recurso foram conferidos na ROM".to_string(),
            "Não cobre compressão, animação, runtime, lógica recuperada ou extração automática universal".to_string(),
        ],
    })
}

pub fn compose_for_session(
    session: &InspectionSession,
    resource_id: &str,
    frame_id: &str,
    flip_x: bool,
    flip_y: bool,
) -> Result<InspectionSpriteFrame, String> {
    if resource_id == SONIC1_MANIFEST.resource_id && frame_id == SONIC1_MANIFEST.frame_id {
        return compose_sonic_stand(session, flip_x, flip_y);
    }
    let manifest = manifest_for(resource_id, frame_id)?;
    let rom_path = Path::new(&session.rom_path);
    let (identity, rom) = rex_read_rom(rom_path)?;
    if identity.normalized_sha256 != manifest.rom_sha256 {
        return Err(format!(
            "sprite_manifest_rom_mismatch: {} exige ROM BYOR {}, observado {}",
            manifest.resource_id, manifest.rom_sha256, identity.normalized_sha256
        ));
    }
    let required_end = [
        manifest.tile_data_offset + manifest.tile_data_size,
        manifest.palette_offset + PALETTE_SIZE,
        manifest.descriptor_offset + manifest.descriptors.len(),
    ]
    .into_iter()
    .max()
    .unwrap();
    if rom.len() < required_end {
        return Err("sprite_manifest_rom_short: ROM não contém o frame compilado".to_string());
    }
    let parts = decode_parts(
        &rom[manifest.descriptor_offset..manifest.descriptor_offset + manifest.descriptors.len()],
        manifest.descriptors,
    )?;
    let image = compose_rgba(
        &rom[manifest.tile_data_offset..manifest.tile_data_offset + manifest.tile_data_size],
        &rom[manifest.palette_offset..manifest.palette_offset + PALETTE_SIZE],
        &parts,
        manifest.width,
        manifest.height,
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
    let path = previews_dir.join(format!(
        "sprite-frame-{}-{}-{png_sha256}.png",
        artifact_name_component(resource_id),
        artifact_name_component(frame_id),
    ));
    write_file_immutable(&path, &png, &png_sha256)?;
    let artifact = ArtifactRef {
        label: "sprite-frame-composition".to_string(),
        path: path.display().to_string(),
        sha256: png_sha256.clone(),
    };
    Ok(InspectionSpriteFrame {
        session_id: session.session_id.clone(),
        resource_id: manifest.resource_id.to_string(),
        frame_id: manifest.frame_id.to_string(),
        available: true,
        reason: None,
        width: manifest.width,
        height: manifest.height,
        data_url: Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&png)
        )),
        artifact: Some(artifact),
        png_sha256: Some(png_sha256),
        pixels_sha256: Some(pixels_sha256),
        rom_sha256: identity.normalized_sha256,
        tile_data_offset: manifest.tile_data_offset as u64,
        tile_data_size: manifest.tile_data_size as u64,
        palette_offset: manifest.palette_offset as u64,
        palette_size: PALETTE_SIZE as u64,
        descriptor_offset: manifest.descriptor_offset as u64,
        flip_x,
        flip_y,
        transparency_index: 0,
        parts: parts_wire(&parts),
        metadata_source: "Metadado doador + bytes compilados verificáveis; não é descoberta automática".to_string(),
        rom_evidence: vec![
            format!("normalized_sha256={HAMOOPIG_REFERENCE_SHA256}"),
            format!("tile_data=0x{:06X}+0x{:X}", manifest.tile_data_offset, manifest.tile_data_size),
            format!("palette=0x{:06X}+0x{PALETTE_SIZE:X}", manifest.palette_offset),
            format!("descriptors=0x{:06X}+0x{:X}", manifest.descriptor_offset, manifest.descriptors.len()),
        ],
        donor_evidence: vec![
            format!("res/sprite.res: SPRITE {} · {}", manifest.resource_id, manifest.frame_label),
            format!("source_png_sha256={}", manifest.source_png_sha256),
            "SGDK ResComp: FrameVDPSprite (offsetY, offsetYFlip, size, offsetX, offsetXFlip, numTile)".to_string(),
            "transformação: tiles 4bpp nibble alto primeiro, ordem vertical por VDP sprite (x→y); paleta MD RGB333; índice 0 transparente".to_string(),
        ],
        limitations: vec![
            "Manifesto assistido: não é descoberta automática nem cobre animação ou todos os recursos".to_string(),
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
            64,
            104,
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
            64,
            104,
            false,
            false,
        )
        .unwrap();
        let wrong = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &parts,
            64,
            104,
            false,
            false,
        )
        .unwrap();
        assert_ne!(expected.as_raw(), wrong.as_raw());
    }

    #[test]
    fn wrong_palette_is_detected_by_literal_pixels() {
        let expected = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            64,
            104,
            false,
            false,
        )
        .unwrap();
        let mut palette = fixture_palette();
        palette[2..4].copy_from_slice(&0x0e00_u16.to_be_bytes());
        let wrong = compose_rgba(
            &fixture_tiles(),
            &palette,
            &fixture_parts(),
            64,
            104,
            false,
            false,
        )
        .unwrap();
        assert_ne!(expected.as_raw(), wrong.as_raw());
    }

    #[test]
    fn wrong_flip_is_detected_by_literal_pixels() {
        let expected = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            64,
            104,
            false,
            false,
        )
        .unwrap();
        let wrong = compose_rgba(
            &fixture_tiles(),
            &fixture_palette(),
            &fixture_parts(),
            64,
            104,
            true,
            false,
        )
        .unwrap();
        assert_ne!(expected.as_raw(), wrong.as_raw());
    }

    #[test]
    fn manifest_exposes_five_hamoopig_frames_and_a_second_resource() {
        assert_eq!(FRAME_MANIFESTS.len(), 6);
        assert_eq!(FRAME_MANIFESTS[0].frame_id, "spr_ryo_100/frame-0");
        assert_eq!(FRAME_MANIFESTS[1].frame_id, "spr_ryo_100/frame-1");
        assert_eq!(FRAME_MANIFESTS[4].frame_id, "spr_ryo_100/frame-4");
        assert_eq!(FRAME_MANIFESTS[5].frame_id, "spr_spark0/frame-0");
        let parts = decode_parts(FRAME1_DESCRIPTORS.as_slice(), &FRAME1_DESCRIPTORS).unwrap();
        assert_eq!(parts.iter().map(|part| part.tile_count).sum::<usize>(), 66);
        assert_eq!(FRAME_MANIFESTS[1].tile_data_offset, 0x86ba0);
        assert_eq!(FRAME_MANIFESTS[1].descriptor_offset, 0x222a2);
        assert_eq!(
            decode_parts(&FRAME2_DESCRIPTORS, &FRAME2_DESCRIPTORS)
                .unwrap()
                .len(),
            7
        );
        assert_eq!(
            decode_parts(&FRAME3_DESCRIPTORS, &FRAME3_DESCRIPTORS)
                .unwrap()
                .len(),
            7
        );
        assert_eq!(
            decode_parts(&SPARK0_FRAME0_DESCRIPTORS, &SPARK0_FRAME0_DESCRIPTORS).unwrap()[0]
                .tile_count,
            9
        );
        assert_eq!(
            FRAME_MANIFESTS[4].tile_data_offset,
            FRAME_MANIFESTS[2].tile_data_offset
        );
        assert_eq!(
            FRAME_MANIFESTS[4].descriptor_offset,
            FRAME_MANIFESTS[2].descriptor_offset
        );
    }

    #[test]
    fn unknown_or_mismatched_manifest_is_rejected_without_fallback() {
        assert!(manifest_for("spr_ryo_100", "spr_ryo_100/frame-9").is_err());
        assert!(manifest_for("spr_ryo_101", "spr_ryo_100/frame-1").is_err());
        assert!(manifest_for("spr_spark0", "spr_ryo_100/frame-0").is_err());
    }

    #[test]
    fn sonic_stand_manifest_uses_literal_asymmetric_mapping() {
        let parts = decode_sonic_parts(&SONIC1_STAND_MAPPING).expect("mapping Sonic válido");
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0].x, -16);
        assert_eq!(parts[0].y, -20);
        assert_eq!(parts[1].tile_width, 4);
        assert_eq!(parts[1].tile_height, 2);
        assert_eq!(SONIC1_MANIFEST.tile_data_offset, 0x21AFE);
        assert_eq!(SONIC1_MANIFEST.palette_offset, 0x2388);
        assert_eq!(SONIC1_MANIFEST.descriptor_offset, 0x21293);
    }

    #[test]
    fn sonic_wrong_tile_order_palette_and_flip_change_pixels() {
        let mut tiles = vec![0u8; 18 * TILE_BYTES];
        tiles[0] = 0x12;
        tiles[3 * TILE_BYTES] = 0x30;
        let mut palette = fixture_palette();
        let parts = vec![SonicPart {
            tile_start: 0,
            tile_width: 1,
            tile_height: 1,
            x: -16,
            y: -20,
        }];
        let expected = compose_sonic_rgba(&tiles, &palette, &parts, 32, 40, false, false).unwrap();
        let wrong_tile = compose_sonic_rgba(
            &tiles,
            &palette,
            &[SonicPart {
                tile_start: 3,
                ..parts[0]
            }],
            32,
            40,
            false,
            false,
        )
        .unwrap();
        assert_ne!(expected.as_raw(), wrong_tile.as_raw());
        palette[2..4].copy_from_slice(&0x0e00_u16.to_be_bytes());
        let wrong_palette =
            compose_sonic_rgba(&tiles, &palette, &parts, 32, 40, false, false).unwrap();
        assert_ne!(expected.as_raw(), wrong_palette.as_raw());
        let wrong_flip =
            compose_sonic_rgba(&tiles, &fixture_palette(), &parts, 32, 40, true, false).unwrap();
        assert_ne!(expected.as_raw(), wrong_flip.as_raw());
    }

    #[test]
    fn artifact_name_components_cannot_turn_resource_ids_into_paths() {
        assert_eq!(
            artifact_name_component("spr_ryo_100/frame-1"),
            "spr_ryo_100_frame-1"
        );
        assert!(!artifact_name_component("spr_ryo_100/frame-1").contains('/'));
    }
}
