use super::manifest::{CompressionRegion, GraphicsCandidate};
use super::platform::LoadedRom;

const TILE_BYTES_4BPP: usize = 32;
const TILE_BYTES_2BPP: usize = 16;

fn looks_like_tile(block: &[u8]) -> bool {
    let zeroes = block.iter().filter(|value| **value == 0).count();
    let ff = block.iter().filter(|value| **value == 0xFF).count();
    zeroes < block.len().saturating_sub(2) && ff < block.len().saturating_sub(2)
}

fn collect_tile_runs(
    bytes: &[u8],
    tile_bytes: usize,
    min_tiles: usize,
    limit: usize,
) -> Vec<(usize, usize, usize)> {
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset + tile_bytes <= bytes.len() && out.len() < limit {
        if looks_like_tile(&bytes[offset..offset + tile_bytes]) {
            let start = offset;
            let mut tile_count = 0usize;
            while offset + tile_bytes <= bytes.len()
                && looks_like_tile(&bytes[offset..offset + tile_bytes])
                && tile_count < 256
            {
                tile_count += 1;
                offset += tile_bytes;
            }
            if tile_count >= min_tiles {
                out.push((start, offset, tile_count));
            }
        } else {
            offset += tile_bytes;
        }
    }
    out
}

fn scan_palette_slot_candidates(loaded: &LoadedRom) -> Vec<(u32, u8)> {
    let bytes = &loaded.bytes;
    let mut out = Vec::new();
    let mut offset = 0usize;
    let mut found = 0u8;

    while offset + 32 <= bytes.len() && found < 4 {
        let region = &bytes[offset..offset + 32];
        let valid_words = region
            .chunks_exact(2)
            .filter(|word| {
                let value = u16::from_le_bytes([word[0], word[1]]);
                value & 0x8000 == 0
            })
            .count();
        if valid_words >= 12 {
            out.push((offset as u32, found));
            found += 1;
            offset += 32;
        } else {
            offset += 2;
        }
    }

    out
}

pub fn analyze_graphics(loaded: &LoadedRom) -> (Vec<GraphicsCandidate>, Vec<CompressionRegion>) {
    let mut candidates = Vec::new();
    let mut compression_regions = Vec::new();

    let palette_slots = scan_palette_slot_candidates(loaded);
    let mut tile_runs = if loaded.target == "megadrive" {
        collect_tile_runs(&loaded.bytes, TILE_BYTES_4BPP, 4, 10)
            .into_iter()
            .map(|(start, end, tile_count)| (start, end, tile_count, 4u8))
            .collect::<Vec<_>>()
    } else {
        let mut out = collect_tile_runs(&loaded.bytes, TILE_BYTES_4BPP, 4, 6)
            .into_iter()
            .map(|(start, end, tile_count)| (start, end, tile_count, 4u8))
            .collect::<Vec<_>>();
        out.extend(
            collect_tile_runs(&loaded.bytes, TILE_BYTES_2BPP, 4, 6)
                .into_iter()
                .map(|(start, end, tile_count)| (start, end, tile_count, 2u8)),
        );
        out
    };

    tile_runs.sort_by_key(|(_, _, tile_count, _)| std::cmp::Reverse(*tile_count));
    tile_runs.truncate(8);

    for (index, (start, end, tile_count, bpp)) in tile_runs.into_iter().enumerate() {
        let palette_slot = if palette_slots.is_empty() {
            None
        } else {
            Some(palette_slots[index % palette_slots.len()].1)
        };
        candidates.push(GraphicsCandidate {
            id: format!("gfx_{:03}", index),
            start: start as u32,
            end: end as u32,
            kind: if tile_count >= 32 {
                "tileset".to_string()
            } else {
                "tiles".to_string()
            },
            bpp,
            tile_width: 8,
            tile_height: 8,
            tile_count: tile_count as u32,
            palette_slot,
            confidence: if tile_count >= 32 { 82 } else { 64 },
            note: format!(
                "Bloco grafico heuristico {}bpp com {} tiles.",
                bpp, tile_count
            ),
        });
    }

    for candidate in &candidates {
        if candidate.tile_count >= 128 {
            compression_regions.push(CompressionRegion {
                start: candidate.start,
                end: candidate.end,
                scheme: "unknown_tiles_block".to_string(),
                confidence: 25,
                note: "Regiao grafica densa; candidata a pipeline de compressao futura."
                    .to_string(),
            });
        }
    }

    (candidates, compression_regions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::reverse::manifest::RomHeader;
    use crate::tools::reverse::platform::LoadedRom;

    fn sample_loaded(target: &str, tile_bytes: usize) -> LoadedRom {
        let mut bytes = vec![0u8; 0x400];
        for index in 0..(tile_bytes * 8) {
            bytes[0x100 + index] = if index % 2 == 0 { 0x12 } else { 0x34 };
        }
        LoadedRom {
            target: target.to_string(),
            source_path: "dummy.rom".to_string(),
            bytes,
            detected_format: "bin".to_string(),
            stripped_header_bytes: 0,
            header: RomHeader::default(),
            mapper: String::new(),
            special_chips: Vec::new(),
            segments: Vec::new(),
            entry_points: vec![0],
            trace_note: String::new(),
        }
    }

    #[test]
    fn analyze_graphics_detects_megadrive_tile_runs() {
        let loaded = sample_loaded("megadrive", TILE_BYTES_4BPP);
        let (candidates, _) = analyze_graphics(&loaded);
        assert!(!candidates.is_empty());
        assert_eq!(candidates[0].bpp, 4);
    }

    #[test]
    fn analyze_graphics_detects_snes_tile_runs() {
        let loaded = sample_loaded("snes", TILE_BYTES_2BPP);
        let (candidates, _) = analyze_graphics(&loaded);
        assert!(!candidates.is_empty());
    }

    #[test]
    fn analyze_graphics_detects_palette_slot_candidates() {
        // Build ROM with a valid 32-byte palette block (all LE16 words with bit15==0)
        // followed by a run of 4BPP tiles
        let mut bytes = vec![0u8; 0x400];
        // Palette at offset 0: 16 LE16 words all with bit15==0
        for i in 0..16 {
            let offset = i * 2;
            bytes[offset] = 0x1F;
            bytes[offset + 1] = 0x00; // value 0x001F, bit15==0
        }
        // 4BPP tile run at offset 0x100 (8 tiles * 32 bytes = 256 bytes of non-trivial data)
        for i in 0..(TILE_BYTES_4BPP * 8) {
            bytes[0x100 + i] = if i % 2 == 0 { 0x12 } else { 0x34 };
        }

        let loaded = LoadedRom {
            target: "megadrive".to_string(),
            source_path: "dummy.rom".to_string(),
            bytes,
            detected_format: "bin".to_string(),
            stripped_header_bytes: 0,
            header: RomHeader::default(),
            mapper: String::new(),
            special_chips: Vec::new(),
            segments: Vec::new(),
            entry_points: vec![0],
            trace_note: String::new(),
        };

        let (candidates, _) = analyze_graphics(&loaded);
        assert!(!candidates.is_empty(), "should find tile candidates");
        assert!(
            candidates.iter().any(|c| c.palette_slot.is_some()),
            "at least one candidate should have a palette_slot assigned"
        );
    }

    #[test]
    fn analyze_graphics_produces_compression_candidates_for_large_runs() {
        // Build ROM with 130 tiles of 4BPP (130 * 32 = 4160 bytes) of non-trivial data
        let tile_count = 130;
        let data_size = tile_count * TILE_BYTES_4BPP;
        let mut bytes = vec![0u8; 0x100 + data_size];
        for i in 0..data_size {
            bytes[0x100 + i] = if i % 3 == 0 {
                0xAB
            } else if i % 3 == 1 {
                0xCD
            } else {
                0x12
            };
        }

        let loaded = LoadedRom {
            target: "megadrive".to_string(),
            source_path: "dummy.rom".to_string(),
            bytes,
            detected_format: "bin".to_string(),
            stripped_header_bytes: 0,
            header: RomHeader::default(),
            mapper: String::new(),
            special_chips: Vec::new(),
            segments: Vec::new(),
            entry_points: vec![0],
            trace_note: String::new(),
        };

        let (candidates, compression_regions) = analyze_graphics(&loaded);
        assert!(!candidates.is_empty(), "should find tile candidates");
        assert!(
            !compression_regions.is_empty(),
            "large tile run should produce compression candidates"
        );
        assert_eq!(compression_regions[0].scheme, "unknown_tiles_block");
        assert_eq!(compression_regions[0].confidence, 25);
    }
}
