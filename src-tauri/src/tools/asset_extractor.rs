use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::tools::reverse;

const TILE_BYTES_4BPP: usize = 32;
const TILE_BYTES_2BPP: usize = 16;
const TILE_SIZE: usize = 8;
const CRAM_COLORS: usize = 64;
const CRAM_COLOR_BYTES: usize = 2;

#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ExtractedTile {
    pub index: u32,
    pub rom_offset: u32,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Debug, Serialize)]
pub struct ExtractedPalette {
    pub slot: u8,
    pub colors: Vec<RgbColor>,
}

#[derive(Debug, Default, Serialize)]
pub struct ExtractionResult {
    pub ok: bool,
    pub error: String,
    pub tiles_extracted: u32,
    pub palettes_extracted: u32,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BppMode {
    Auto,
    TwoBpp,
    FourBpp,
}

impl BppMode {
    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "2bpp" => Self::TwoBpp,
            "4bpp" => Self::FourBpp,
            _ => Self::Auto,
        }
    }
}

fn record_extraction_error(result: &mut ExtractionResult, message: impl Into<String>) {
    if result.error.is_empty() {
        result.error = message.into();
    }
    result.ok = false;
}

fn md_color_to_rgb(word: u16) -> RgbColor {
    let r = ((word & 0x000E) >> 1) as u8;
    let g = ((word & 0x00E0) >> 5) as u8;
    let b = ((word & 0x0E00) >> 9) as u8;
    RgbColor {
        r: r * 36,
        g: g * 36,
        b: b * 36,
    }
}

fn decode_tile(data: &[u8]) -> Vec<u8> {
    let mut pixels = vec![0u8; TILE_SIZE * TILE_SIZE];
    for row in 0..TILE_SIZE {
        for col_pair in 0..4 {
            let byte = data[row * 4 + col_pair];
            pixels[row * TILE_SIZE + col_pair * 2] = (byte >> 4) & 0x0F;
            pixels[row * TILE_SIZE + col_pair * 2 + 1] = byte & 0x0F;
        }
    }
    pixels
}

fn decode_tile_2bpp(data: &[u8; TILE_BYTES_2BPP]) -> Vec<u8> {
    let mut pixels = vec![0u8; TILE_SIZE * TILE_SIZE];
    for row in 0..TILE_SIZE {
        let plane0 = data[row * 2];
        let plane1 = data[row * 2 + 1];
        for col in 0..TILE_SIZE {
            let shift = 7 - col;
            let low = (plane0 >> shift) & 0x01;
            let high = (plane1 >> shift) & 0x01;
            pixels[row * TILE_SIZE + col] = low | (high << 1);
        }
    }
    pixels
}

fn looks_like_tile(data: &[u8]) -> bool {
    let zeros = data.iter().filter(|&&byte| byte == 0).count();
    let ffs = data.iter().filter(|&&byte| byte == 0xFF).count();
    let limit = data.len().saturating_sub(2);
    zeros < limit && ffs < limit
}

fn should_try_2bpp(block: &[u8]) -> bool {
    if block.is_empty() {
        return false;
    }

    let high_nibble_zeroes = block.iter().filter(|&&byte| (byte & 0xF0) == 0).count();
    high_nibble_zeroes * 100 / block.len() > 70
}

fn find_cram_candidate(rom: &[u8]) -> Option<usize> {
    let cram_bytes = CRAM_COLORS * CRAM_COLOR_BYTES;
    let candidates = [
        rom.len().saturating_sub(cram_bytes + 4),
        0x8000usize,
        0x10000usize,
    ];

    for &offset in &candidates {
        if offset + cram_bytes > rom.len() {
            continue;
        }

        let block = &rom[offset..offset + cram_bytes];
        let valid = (0..CRAM_COLORS)
            .filter(|&index| {
                let word = u16::from_be_bytes([block[index * 2], block[index * 2 + 1]]);
                word & 0xF111 == 0
            })
            .count();
        if valid >= CRAM_COLORS * 60 / 100 {
            return Some(offset);
        }
    }

    None
}

fn extract_palettes(rom: &[u8]) -> Vec<ExtractedPalette> {
    let mut palettes = Vec::new();
    let cram_offset = find_cram_candidate(rom).unwrap_or(0);
    let cram_bytes = CRAM_COLORS * CRAM_COLOR_BYTES;
    if cram_offset + cram_bytes > rom.len() {
        return palettes;
    }

    for slot in 0u8..4 {
        let mut colors = Vec::new();
        for color_index in 0..16usize {
            let offset = cram_offset + (slot as usize * 16 + color_index) * 2;
            let word = u16::from_be_bytes([rom[offset], rom[offset + 1]]);
            colors.push(md_color_to_rgb(word));
        }
        palettes.push(ExtractedPalette { slot, colors });
    }

    palettes
}

fn extract_tiles_from_candidates(
    rom: &[u8],
    candidates: &[reverse::manifest::GraphicsCandidate],
    max_tiles: u32,
    bpp_mode: BppMode,
) -> Vec<ExtractedTile> {
    let mut tiles = Vec::new();

    for candidate in candidates {
        let candidate_bpp = candidate.bpp;
        let tile_bytes = if candidate_bpp == 2 {
            TILE_BYTES_2BPP
        } else {
            TILE_BYTES_4BPP
        };
        let allowed = match bpp_mode {
            BppMode::Auto => true,
            BppMode::TwoBpp => candidate_bpp == 2,
            BppMode::FourBpp => candidate_bpp == 4,
        };
        if !allowed {
            continue;
        }

        let mut offset = candidate.start as usize;
        let end = (candidate.end as usize).min(rom.len());
        while offset + tile_bytes <= end && tiles.len() < max_tiles as usize {
            let pixels = if candidate_bpp == 2 {
                let mut raw = [0u8; TILE_BYTES_2BPP];
                raw.copy_from_slice(&rom[offset..offset + TILE_BYTES_2BPP]);
                decode_tile_2bpp(&raw)
            } else {
                decode_tile(&rom[offset..offset + TILE_BYTES_4BPP])
            };
            tiles.push(ExtractedTile {
                index: tiles.len() as u32,
                rom_offset: offset as u32,
                pixels,
            });
            offset += tile_bytes;
        }
        if tiles.len() >= max_tiles as usize {
            break;
        }
    }

    tiles
}

fn write_png_minimal(
    path: &Path,
    pixels_indexed: &[u8],
    width: u32,
    height: u32,
    palette: &[RgbColor],
) -> std::io::Result<()> {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for &index in pixels_indexed {
        let (r, g, b) = if (index as usize) < palette.len() {
            let color = &palette[index as usize];
            (color.r, color.g, color.b)
        } else {
            (0, 0, 0)
        };
        let alpha = if index == 0 { 0u8 } else { 255u8 };
        rgba.extend_from_slice(&[r, g, b, alpha]);
    }

    write_raw_png(path, &rgba, width, height)
}

fn write_raw_png(path: &Path, rgba: &[u8], width: u32, height: u32) -> std::io::Result<()> {
    let mut out = Vec::new();
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    let ihdr_data = {
        let mut data = Vec::new();
        data.extend_from_slice(&width.to_be_bytes());
        data.extend_from_slice(&height.to_be_bytes());
        data.push(8);
        data.push(6);
        data.push(0);
        data.push(0);
        data.push(0);
        data
    };
    write_chunk(&mut out, b"IHDR", &ihdr_data);

    let mut raw_scanlines = Vec::new();
    for row in 0..height as usize {
        raw_scanlines.push(0u8);
        let start = row * width as usize * 4;
        let end = start + width as usize * 4;
        raw_scanlines.extend_from_slice(&rgba[start..end]);
    }
    let compressed = deflate_store(&raw_scanlines);
    write_chunk(&mut out, b"IDAT", &compressed);
    write_chunk(&mut out, b"IEND", &[]);

    fs::write(path, &out)
}

fn write_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let crc = crc32_png(chunk_type, data);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32_png(chunk_type: &[u8], data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in chunk_type.iter().chain(data.iter()) {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn deflate_store(data: &[u8]) -> Vec<u8> {
    let cmf: u8 = 0x78;
    let fcheck = (31 - ((cmf as u16 * 256) % 31)) as u8;

    let mut out = vec![cmf, fcheck];
    let chunks: Vec<&[u8]> = data.chunks(65_535).collect();
    for (index, chunk) in chunks.iter().enumerate() {
        let bfinal = if index + 1 == chunks.len() { 1u8 } else { 0u8 };
        out.push(bfinal);
        let len = chunk.len() as u16;
        let nlen = !len;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&nlen.to_le_bytes());
        out.extend_from_slice(chunk);
    }

    let (mut s1, mut s2) = (1u32, 0u32);
    for &byte in data {
        s1 = (s1 + byte as u32) % 65_521;
        s2 = (s2 + s1) % 65_521;
    }
    out.extend_from_slice(&((s2 << 16) | s1).to_be_bytes());
    out
}

fn extract_tiles_from_rom(rom: &[u8], max_tiles: u32, bpp_mode: BppMode) -> Vec<ExtractedTile> {
    let mut tiles = Vec::new();
    let mut tile_index = 0u32;
    let mut offset = 0x200usize;

    while tile_index < max_tiles && offset + TILE_BYTES_2BPP <= rom.len() {
        let (stride, pixels) = match bpp_mode {
            BppMode::TwoBpp => {
                let tile_data = &rom[offset..offset + TILE_BYTES_2BPP];
                let pixels = if looks_like_tile(tile_data) {
                    tile_data
                        .try_into()
                        .ok()
                        .map(|raw: &[u8; TILE_BYTES_2BPP]| decode_tile_2bpp(raw))
                } else {
                    None
                };
                (TILE_BYTES_2BPP, pixels)
            }
            BppMode::FourBpp => {
                if offset + TILE_BYTES_4BPP > rom.len() {
                    break;
                }
                let tile_data = &rom[offset..offset + TILE_BYTES_4BPP];
                let pixels = looks_like_tile(tile_data).then(|| decode_tile(tile_data));
                (TILE_BYTES_4BPP, pixels)
            }
            BppMode::Auto => {
                let remaining = rom.len() - offset;
                let block_len = remaining.min(TILE_BYTES_4BPP);
                let block = &rom[offset..offset + block_len];
                if block_len >= TILE_BYTES_2BPP && should_try_2bpp(block) {
                    let tile_data = &rom[offset..offset + TILE_BYTES_2BPP];
                    let pixels = if looks_like_tile(tile_data) {
                        tile_data
                            .try_into()
                            .ok()
                            .map(|raw: &[u8; TILE_BYTES_2BPP]| decode_tile_2bpp(raw))
                    } else {
                        None
                    };
                    (TILE_BYTES_2BPP, pixels)
                } else {
                    if offset + TILE_BYTES_4BPP > rom.len() {
                        break;
                    }
                    let tile_data = &rom[offset..offset + TILE_BYTES_4BPP];
                    let pixels = looks_like_tile(tile_data).then(|| decode_tile(tile_data));
                    (TILE_BYTES_4BPP, pixels)
                }
            }
        };

        if let Some(pixels) = pixels {
            tiles.push(ExtractedTile {
                index: tile_index,
                rom_offset: offset as u32,
                pixels,
            });
            tile_index += 1;
        }

        offset += stride;
    }

    tiles
}

pub fn extract_assets(
    rom_path: &Path,
    output_dir: &Path,
    max_tiles: u32,
    palette_slot: u8,
    bpp_mode: BppMode,
) -> ExtractionResult {
    let rom = match fs::read(rom_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return ExtractionResult {
                ok: false,
                error: format!("Erro ao ler ROM: {error}"),
                ..Default::default()
            };
        }
    };

    if let Err(error) = fs::create_dir_all(output_dir) {
        return ExtractionResult {
            ok: false,
            error: format!("Erro ao criar pasta de saida: {error}"),
            ..Default::default()
        };
    }

    let palettes = extract_palettes(&rom);
    let palette_colors = palettes
        .iter()
        .find(|palette| palette.slot == palette_slot)
        .map(|palette| palette.colors.clone())
        .unwrap_or_else(|| vec![RgbColor { r: 0, g: 0, b: 0 }; 16]);

    let mut result = ExtractionResult::default();

    let palette_path = output_dir.join("palettes.json");
    match serde_json::to_string_pretty(&palettes) {
        Ok(json) => {
            if let Err(error) = fs::write(&palette_path, json) {
                record_extraction_error(&mut result, format!("Erro ao salvar paletas: {error}"));
            } else {
                result.palettes_extracted = palettes.len() as u32;
                result
                    .files
                    .push(palette_path.to_string_lossy().to_string());
            }
        }
        Err(error) => {
            record_extraction_error(&mut result, format!("Erro ao serializar paletas: {error}"));
        }
    }

    let candidate_tiles = reverse::analyze_rom(rom_path.to_string_lossy().as_ref())
        .map(|manifest| extract_tiles_from_candidates(&rom, &manifest.graphics_regions, max_tiles, bpp_mode))
        .unwrap_or_default();
    let tiles = if candidate_tiles.is_empty() {
        extract_tiles_from_rom(&rom, max_tiles, bpp_mode)
    } else {
        candidate_tiles
    };

    for tile in tiles {
        let tile_name = format!("tile_{:05}.png", tile.index);
        let tile_path = output_dir.join(&tile_name);
        match write_png_minimal(
            &tile_path,
            &tile.pixels,
            TILE_SIZE as u32,
            TILE_SIZE as u32,
            &palette_colors,
        ) {
            Ok(()) => {
                result.files.push(tile_path.to_string_lossy().to_string());
                result.tiles_extracted += 1;
            }
            Err(error) => {
                record_extraction_error(
                    &mut result,
                    format!("Erro ao salvar tile '{}': {}", tile_path.display(), error),
                );
            }
        }
    }

    result.ok = result.error.is_empty();
    result
}

#[allow(dead_code)]
pub fn build_spritesheet(
    tiles: &[ExtractedTile],
    palette: &[RgbColor],
    output_path: &Path,
) -> ExtractionResult {
    let cols = 16usize;
    let rows = tiles.len().div_ceil(cols);
    let width = (cols * TILE_SIZE) as u32;
    let height = (rows * TILE_SIZE) as u32;
    let mut rgba = vec![0u8; (width * height * 4) as usize];

    for (index, tile) in tiles.iter().enumerate() {
        let col = index % cols;
        let row = index / cols;
        for py in 0..TILE_SIZE {
            for px in 0..TILE_SIZE {
                let color_index = tile.pixels[py * TILE_SIZE + px];
                let (r, g, b, a) = if color_index == 0 {
                    (0u8, 0u8, 0u8, 0u8)
                } else if (color_index as usize) < palette.len() {
                    let color = &palette[color_index as usize];
                    (color.r, color.g, color.b, 255u8)
                } else {
                    (0, 0, 0, 255)
                };
                let sx = col * TILE_SIZE + px;
                let sy = row * TILE_SIZE + py;
                let offset = (sy * width as usize + sx) * 4;
                rgba[offset] = r;
                rgba[offset + 1] = g;
                rgba[offset + 2] = b;
                rgba[offset + 3] = a;
            }
        }
    }

    let mut result = ExtractionResult::default();
    match write_raw_png(output_path, &rgba, width, height) {
        Ok(()) => {
            result.ok = true;
            result.tiles_extracted = tiles.len() as u32;
            result.files.push(output_path.to_string_lossy().to_string());
        }
        Err(error) => {
            result.ok = false;
            result.error = format!("Erro ao escrever spritesheet: {error}");
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-asset-extractor-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("create temp test dir");
        path
    }

    fn sample_rom_with_4bpp_tile() -> Vec<u8> {
        let mut rom = vec![0u8; 0x200 + TILE_BYTES_4BPP];
        for (index, byte) in rom[0x200..0x200 + TILE_BYTES_4BPP].iter_mut().enumerate() {
            *byte = if index % 2 == 0 { 0x12 } else { 0x34 };
        }
        rom
    }

    fn sample_rom_with_2bpp_tile() -> Vec<u8> {
        let mut rom = vec![0u8; 0x200 + TILE_BYTES_4BPP];
        let tile = [
            0b1100_0000,
            0b0000_0000,
            0b0110_0000,
            0b0000_0000,
            0b0011_0000,
            0b0000_0000,
            0b0001_1000,
            0b0000_0000,
            0b0000_1100,
            0b0000_0000,
            0b0000_0110,
            0b0000_0000,
            0b0000_0011,
            0b0000_0000,
            0b1111_1111,
            0b0000_0000,
        ];
        rom[0x200..0x200 + TILE_BYTES_2BPP].copy_from_slice(&tile);
        rom
    }

    #[test]
    fn record_extraction_error_marks_result_failed_once() {
        let mut result = ExtractionResult::default();
        record_extraction_error(&mut result, "primeira falha");
        record_extraction_error(&mut result, "segunda falha");

        assert!(!result.ok);
        assert_eq!(result.error, "primeira falha");
    }

    #[test]
    fn extract_assets_writes_expected_outputs_for_simple_rom() {
        let workspace = temp_dir("public-success");
        let rom_path = workspace.join("sample.md");
        let output_dir = workspace.join("out");
        fs::write(&rom_path, sample_rom_with_4bpp_tile()).expect("write sample rom");

        let result = extract_assets(&rom_path, &output_dir, 1, 0, BppMode::Auto);

        assert!(result.ok, "unexpected extractor error: {}", result.error);
        assert_eq!(result.palettes_extracted, 4);
        assert_eq!(result.tiles_extracted, 1);
        assert!(output_dir.join("palettes.json").exists());
        assert!(output_dir.join("tile_00000.png").exists());

        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn decode_tile_2bpp_expands_bitplanes_into_palette_indices() {
        let raw = [
            0b1000_0000,
            0b0100_0000,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];

        let pixels = decode_tile_2bpp(&raw);

        assert_eq!(pixels[0], 1);
        assert_eq!(pixels[1], 2);
        assert!(pixels.iter().skip(2).all(|value| *value == 0));
    }

    #[test]
    fn extract_tiles_from_rom_auto_detects_2bpp_layout() {
        let rom = sample_rom_with_2bpp_tile();

        let tiles = extract_tiles_from_rom(&rom, 1, BppMode::Auto);

        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].rom_offset, 0x200);
        assert!(tiles[0].pixels.iter().any(|value| *value > 0));
        assert!(tiles[0].pixels.iter().all(|value| *value <= 3));
    }
}
