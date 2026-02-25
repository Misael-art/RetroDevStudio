//! asset_extractor.rs — Asset Extraction Pipeline para ROMs Mega Drive.
//!
//! Extrai tiles gráficos (4bpp) e paletas de uma ROM binária e os converte
//! para formatos portáveis (PNG 8bpp, paleta JSON).
//!
//! Compliance legal: extrai apenas dados da ROM fornecida pelo usuário.
//! NÃO distribui ROMs nem assets de terceiros.

use std::path::Path;
use std::fs;
use serde::Serialize;

// ── Constants ─────────────────────────────────────────────────────────────────

const TILE_BYTES: usize = 32;    // 8×8 @ 4bpp
const TILE_SIZE:  usize = 8;     // pixels per side
const CRAM_COLORS: usize = 64;   // 4 paletas × 16 cores
const CRAM_COLOR_BYTES: usize = 2; // cada cor é 2 bytes (0BGR format MD)

// ── Output types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ExtractedTile {
    /// Índice do tile na ROM.
    pub index: u32,
    /// Offset de bytes na ROM onde o tile começa.
    pub rom_offset: u32,
    /// Pixels do tile como bytes de índice de paleta (64 bytes, 8×8).
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
    /// Arquivos escritos em output_dir.
    pub files: Vec<String>,
}

// ── Color conversion ──────────────────────────────────────────────────────────

/// Converte cor MD (0BGR 9-bit: 0000BBB0GGG0RRR0) para RGB888.
fn md_color_to_rgb(word: u16) -> RgbColor {
    let r = ((word & 0x000E) >> 1) as u8; // bits 3-1
    let g = ((word & 0x00E0) >> 5) as u8; // bits 7-5
    let b = ((word & 0x0E00) >> 9) as u8; // bits 11-9
    // Escala 3-bit → 8-bit: multiplica por 36 (0..7 → 0..252)
    RgbColor { r: r * 36, g: g * 36, b: b * 36 }
}

// ── Tile decoding ─────────────────────────────────────────────────────────────

/// Decodifica um tile 4bpp da ROM em 64 bytes de índice de paleta (0-15).
fn decode_tile(data: &[u8]) -> Vec<u8> {
    let mut pixels = vec![0u8; 64];
    for row in 0..TILE_SIZE {
        for col_pair in 0..4 {
            let byte = data[row * 4 + col_pair];
            pixels[row * 8 + col_pair * 2]     = (byte >> 4) & 0x0F;
            pixels[row * 8 + col_pair * 2 + 1] = byte & 0x0F;
        }
    }
    pixels
}

// ── Tile heuristic ────────────────────────────────────────────────────────────

/// Retorna true se um bloco de 32 bytes parece um tile gráfico válido
/// (não todos zeros, não todos 0xFF, entropia razoável).
fn looks_like_tile(data: &[u8]) -> bool {
    let zeros = data.iter().filter(|&&b| b == 0).count();
    let ffs   = data.iter().filter(|&&b| b == 0xFF).count();
    zeros < 30 && ffs < 30
}

// ── Palette extraction ────────────────────────────────────────────────────────

/// Procura um candidato a CRAM na ROM (64 words de 2 bytes).
/// Heurística: busca bloco de 128 bytes onde as cores têm padrão 0BGR válido.
fn find_cram_candidate(rom: &[u8]) -> Option<usize> {
    let cram_bytes = CRAM_COLORS * CRAM_COLOR_BYTES; // 128 bytes
    // Candidatos comuns: fim da ROM - 128, 0x8000, 0x10000
    let candidates = [
        rom.len().saturating_sub(cram_bytes + 4),
        0x8000usize,
        0x10000usize,
    ];
    for &off in &candidates {
        if off + cram_bytes > rom.len() { continue; }
        let block = &rom[off..off + cram_bytes];
        // Valida: todas as words devem ter bits não-MD em zero (bits 0,4,8,12,13,14,15 = 0)
        let valid = (0..CRAM_COLORS).filter(|&i| {
            let word = u16::from_be_bytes([block[i * 2], block[i * 2 + 1]]);
            word & 0xF111 == 0 // bits que nunca são setados em cores MD
        }).count();
        if valid >= CRAM_COLORS * 60 / 100 { return Some(off); }
    }
    None
}

fn extract_palettes(rom: &[u8]) -> Vec<ExtractedPalette> {
    let mut palettes = Vec::new();
    let cram_off = find_cram_candidate(rom).unwrap_or(0);
    let cram_bytes = CRAM_COLORS * CRAM_COLOR_BYTES;
    if cram_off + cram_bytes > rom.len() { return palettes; }

    for slot in 0u8..4 {
        let mut colors = Vec::new();
        for ci in 0..16usize {
            let off = cram_off + (slot as usize * 16 + ci) * 2;
            let word = u16::from_be_bytes([rom[off], rom[off + 1]]);
            colors.push(md_color_to_rgb(word));
        }
        palettes.push(ExtractedPalette { slot, colors });
    }
    palettes
}

// ── PNG writer (sem dependência externa — formato PNG mínimo) ─────────────────

fn write_png_minimal(
    path: &Path,
    pixels_indexed: &[u8],
    width: u32,
    height: u32,
    palette: &[RgbColor],
) -> std::io::Result<()> {
    // Converte pixels indexados → RGBA usando a paleta
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for &idx in pixels_indexed {
        let (r, g, b) = if (idx as usize) < palette.len() {
            let c = &palette[idx as usize];
            (c.r, c.g, c.b)
        } else {
            (0, 0, 0)
        };
        // alpha: índice 0 = transparente (cor MD convencional)
        let a = if idx == 0 { 0u8 } else { 255u8 };
        rgba.extend_from_slice(&[r, g, b, a]);
    }
    write_raw_png(path, &rgba, width, height)
}

/// Escreve um PNG RGBA mínimo sem dependência externa (zlib deflate store).
fn write_raw_png(path: &Path, rgba: &[u8], width: u32, height: u32) -> std::io::Result<()> {
    let mut out = Vec::new();

    // PNG signature
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    let ihdr_data = {
        let mut d = Vec::new();
        d.extend_from_slice(&width.to_be_bytes());
        d.extend_from_slice(&height.to_be_bytes());
        d.push(8);  // bit depth
        d.push(6);  // color type RGBA
        d.push(0);  // compression
        d.push(0);  // filter
        d.push(0);  // interlace
        d
    };
    write_chunk(&mut out, b"IHDR", &ihdr_data);

    // IDAT chunk — raw scanlines with filter byte 0 (None), stored (no compression)
    let mut raw_scanlines = Vec::new();
    for row in 0..height as usize {
        raw_scanlines.push(0u8); // filter None
        let start = row * width as usize * 4;
        let end   = start + width as usize * 4;
        raw_scanlines.extend_from_slice(&rgba[start..end]);
    }
    let compressed = deflate_store(&raw_scanlines);
    write_chunk(&mut out, b"IDAT", &compressed);

    // IEND
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
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in chunk_type.iter().chain(data.iter()) {
        crc ^= b as u32;
        for _ in 0..8 {
            if crc & 1 != 0 { crc = (crc >> 1) ^ 0xEDB8_8320; }
            else             { crc >>= 1; }
        }
    }
    !crc
}

/// Compressão deflate no modo "stored" (sem compressão — simples e sem deps).
fn deflate_store(data: &[u8]) -> Vec<u8> {
    // zlib header: CMF=0x78, FLG calculado para FCHECK
    let cmf: u8 = 0x78; // deflate, window 32KB
    let fcheck = (31 - ((cmf as u16 * 256) % 31)) as u8;

    let mut out = vec![cmf, fcheck];

    // deflate stored blocks (max 65535 bytes each)
    let chunks: Vec<&[u8]> = data.chunks(65535).collect();
    for (i, chunk) in chunks.iter().enumerate() {
        let bfinal: u8 = if i + 1 == chunks.len() { 1 } else { 0 };
        out.push(bfinal); // BFINAL | BTYPE=00 (stored)
        let len = chunk.len() as u16;
        let nlen = !len;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&nlen.to_le_bytes());
        out.extend_from_slice(chunk);
    }

    // Adler-32 checksum
    let (mut s1, mut s2) = (1u32, 0u32);
    for &b in data {
        s1 = (s1 + b as u32) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    out.extend_from_slice(&((s2 << 16) | s1).to_be_bytes());
    out
}

// ── Public IPC-level entry point ──────────────────────────────────────────────

/// Extrai tiles e paletas de uma ROM Mega Drive.
///
/// - `rom_path`:    arquivo .md/.bin da ROM
/// - `output_dir`:  pasta de destino para os PNGs e paleta.json
/// - `max_tiles`:   limite de tiles a extrair (evita extrair ROMs inteiras de uma vez)
/// - `palette_slot`: qual slot de paleta usar para colorir os tiles (0-3)
pub fn extract_assets(
    rom_path: &Path,
    output_dir: &Path,
    max_tiles: u32,
    palette_slot: u8,
) -> ExtractionResult {
    let rom = match fs::read(rom_path) {
        Ok(b) => b,
        Err(e) => return ExtractionResult { ok: false, error: format!("Erro ao ler ROM: {e}"), ..Default::default() },
    };

    if let Err(e) = fs::create_dir_all(output_dir) {
        return ExtractionResult { ok: false, error: format!("Erro ao criar pasta de saída: {e}"), ..Default::default() };
    }

    let palettes = extract_palettes(&rom);
    let palette_colors: Vec<RgbColor> = palettes
        .iter()
        .find(|p| p.slot == palette_slot)
        .map(|p| p.colors.clone())
        .unwrap_or_else(|| vec![RgbColor { r: 0, g: 0, b: 0 }; 16]);

    let mut result = ExtractionResult { ok: true, ..Default::default() };

    // ── Salva paleta como JSON ─────────────────────────────────────────────
    let pal_path = output_dir.join("palettes.json");
    match serde_json::to_string_pretty(&palettes) {
        Ok(json) => {
            if let Err(e) = fs::write(&pal_path, json) {
                result.error = format!("Erro ao salvar paletas: {e}");
            } else {
                result.palettes_extracted = palettes.len() as u32;
                result.files.push(pal_path.to_string_lossy().to_string());
            }
        }
        Err(e) => {
            result.error = format!("Erro ao serializar paletas: {e}");
        }
    }

    // ── Extrai tiles ───────────────────────────────────────────────────────
    // Começa no offset 0x200 (depois do cabeçalho MD) e varre em blocos de 32 bytes
    let start_offset = 0x200usize;
    let mut tile_index = 0u32;
    let mut offset = start_offset;

    while offset + TILE_BYTES <= rom.len() && tile_index < max_tiles {
        let tile_data = &rom[offset..offset + TILE_BYTES];
        if looks_like_tile(tile_data) {
            let pixels = decode_tile(tile_data);
            let tile_name = format!("tile_{:05}.png", tile_index);
            let tile_path = output_dir.join(&tile_name);

            if write_png_minimal(&tile_path, &pixels, TILE_SIZE as u32, TILE_SIZE as u32, &palette_colors).is_ok() {
                result.files.push(tile_path.to_string_lossy().to_string());
                result.tiles_extracted += 1;
            }
            tile_index += 1;
        }
        offset += TILE_BYTES;
    }

    result
}

// ── Spritesheet builder ───────────────────────────────────────────────────────

/// Agrupa tiles em um spritesheet PNG (16 tiles por linha).
#[allow(dead_code)]
pub fn build_spritesheet(
    tiles: &[ExtractedTile],
    palette: &[RgbColor],
    output_path: &Path,
) -> ExtractionResult {
    let cols = 16usize;
    let rows = tiles.len().div_ceil(cols);
    let width  = (cols * TILE_SIZE) as u32;
    let height = (rows * TILE_SIZE) as u32;
    let mut rgba = vec![0u8; (width * height * 4) as usize];

    for (i, tile) in tiles.iter().enumerate() {
        let col = i % cols;
        let row = i / cols;
        for py in 0..TILE_SIZE {
            for px in 0..TILE_SIZE {
                let idx = tile.pixels[py * TILE_SIZE + px];
                let (r, g, b, a) = if idx == 0 {
                    (0u8, 0u8, 0u8, 0u8)
                } else if (idx as usize) < palette.len() {
                    let c = &palette[idx as usize];
                    (c.r, c.g, c.b, 255u8)
                } else {
                    (0, 0, 0, 255)
                };
                let sx = col * TILE_SIZE + px;
                let sy = row * TILE_SIZE + py;
                let offset = (sy * width as usize + sx) * 4;
                rgba[offset]     = r;
                rgba[offset + 1] = g;
                rgba[offset + 2] = b;
                rgba[offset + 3] = a;
            }
        }
    }

    let mut res = ExtractionResult::default();
    match write_raw_png(output_path, &rgba, width, height) {
        Ok(()) => {
            res.ok = true;
            res.tiles_extracted = tiles.len() as u32;
            res.files.push(output_path.to_string_lossy().to_string());
        }
        Err(e) => {
            res.ok = false;
            res.error = format!("Erro ao escrever spritesheet: {e}");
        }
    }
    res
}
