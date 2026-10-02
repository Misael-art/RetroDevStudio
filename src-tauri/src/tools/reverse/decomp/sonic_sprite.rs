//! Geometry of the bounded Sonic 1 Rev00 BYOR profile.
//! Mapping slots are resolved through DPLC; they are never art indices.
//! VDP sprite cells advance vertically, then horizontally. Both rendering
//! and painting use `source_pixel`, including piece flips and the anchor.

use serde::{Deserialize, Serialize};

pub const ART_OFFSET: usize = 0x21afe;
pub const ART_SIZE: usize = 0xa120;
pub const MAP_TABLE: usize = 0x211e2;
pub const DPLC_TABLE: usize = 0x217fe;
pub const FRAME_COUNT: usize = 88;
pub const PALETTE_OFFSET: usize = 0x2388;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrameChoice {
    pub id: String,
    pub label: String,
    pub mapping_index: usize,
}

const FRAMES: [(&str, &str, usize); 10] = [
    ("stand", "Parado", 1),
    ("wait-1", "Esperando", 2),
    ("look-up", "Olhando para cima", 5),
    ("walk-1", "Caminhada · 1", 6),
    ("walk-2", "Caminhada · 2", 7),
    ("walk-3", "Caminhada · 3", 8),
    ("walk-4", "Caminhada · 4", 9),
    ("walk-5", "Caminhada · 5", 10),
    ("walk-6", "Caminhada · 6", 11),
    ("run-1", "Corrida · 1", 30),
];

pub fn choices() -> Vec<FrameChoice> {
    FRAMES
        .iter()
        .map(|(id, label, mapping_index)| FrameChoice {
            id: format!("sonic1_sonic/{id}"),
            label: (*label).into(),
            mapping_index: *mapping_index,
        })
        .collect()
}

pub fn frame_index(id: &str) -> Result<usize, String> {
    FRAMES
        .iter()
        .find(|(name, _, _)| id == format!("sonic1_sonic/{name}"))
        .map(|(_, _, index)| *index)
        .ok_or_else(|| "sprite_manifest_missing: frame Sonic não comprovado neste perfil".into())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Piece {
    pub slot: usize,
    pub columns: usize,
    pub rows: usize,
    pub x: i32,
    pub y: i32,
    pub flip_x: bool,
    pub flip_y: bool,
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub index: usize,
    pub mapping_offset: usize,
    pub dplc_offset: usize,
    pub width: u32,
    pub height: u32,
    pub anchor_x: i32,
    pub anchor_y: i32,
    pub pieces: Vec<Piece>,
    pub slots: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelLocation {
    pub art_tile: usize,
    pub byte_offset: usize,
    pub high_nibble: bool,
}

fn word(rom: &[u8], offset: usize) -> Result<usize, String> {
    rom.get(offset..offset + 2)
        .map(|b| usize::from(u16::from_be_bytes([b[0], b[1]])))
        .ok_or_else(|| "sprite_structure_short: palavra fora da ROM".into())
}

pub fn dplc_tiles(rom: &[u8]) -> Result<Vec<Vec<usize>>, String> {
    if word(rom, DPLC_TABLE)? != FRAME_COUNT * 2 {
        return Err("sprite_dplc_invalid: tabela não tem a fronteira de 88 frames".into());
    }
    (0..FRAME_COUNT)
        .map(|frame| {
            let start = DPLC_TABLE + word(rom, DPLC_TABLE + frame * 2)?;
            if !(DPLC_TABLE + FRAME_COUNT * 2..ART_OFFSET).contains(&start) {
                return Err("sprite_dplc_invalid: entrada fora do intervalo do perfil".into());
            }
            let count = usize::from(
                *rom.get(start)
                    .ok_or("sprite_structure_short: DPLC ausente")?,
            );
            if start + 1 + count * 2 > ART_OFFSET {
                return Err("sprite_dplc_invalid: entrada atravessa a arte".into());
            }
            let mut tiles = Vec::new();
            for entry in 0..count {
                let value = word(rom, start + 1 + entry * 2)?;
                let first = value & 0xfff;
                let end = first + (value >> 12) + 1;
                if end > ART_SIZE / 32 {
                    return Err("sprite_dplc_invalid: tile fora da arte".into());
                }
                tiles.extend(first..end);
            }
            Ok(tiles)
        })
        .collect()
}

pub fn read_frame(rom: &[u8], id: &str) -> Result<Frame, String> {
    let index = frame_index(id)?;
    if rom.len() < ART_OFFSET + ART_SIZE {
        return Err("sprite_structure_short: arte incompleta".into());
    }
    let mapping_offset = MAP_TABLE + word(rom, MAP_TABLE + index * 2)?;
    if !(MAP_TABLE + FRAME_COUNT * 2..DPLC_TABLE).contains(&mapping_offset) {
        return Err("sprite_mapping_invalid: mapping fora do intervalo do perfil".into());
    }
    let count = usize::from(rom[mapping_offset]);
    if count == 0 || count > 20 || mapping_offset + 1 + count * 5 > DPLC_TABLE {
        return Err("sprite_mapping_invalid: contagem de peças inválida".into());
    }
    let slots = dplc_tiles(rom)?.remove(index);
    let mut pieces = Vec::with_capacity(count);
    for b in rom[mapping_offset + 1..mapping_offset + 1 + count * 5].chunks_exact(5) {
        let attr = u16::from_be_bytes([b[2], b[3]]);
        if b[1] > 15 || attr & 0x6000 != 0 {
            return Err(
                "sprite_mapping_unsupported: tamanho ou banco de paleta não comprovado".into(),
            );
        }
        let p = Piece {
            slot: usize::from(attr & 0x7ff),
            columns: usize::from(b[1] >> 2) + 1,
            rows: usize::from(b[1] & 3) + 1,
            x: i32::from(b[4] as i8),
            y: i32::from(b[0] as i8),
            flip_x: attr & 0x800 != 0,
            flip_y: attr & 0x1000 != 0,
        };
        if p.slot + p.columns * p.rows > slots.len() {
            return Err("sprite_dplc_gap: mapping exige estado de VRAM de outro frame".into());
        }
        if pieces.iter().any(|q: &Piece| {
            p.x < q.x + q.columns as i32 * 8
                && q.x < p.x + p.columns as i32 * 8
                && p.y < q.y + q.rows as i32 * 8
                && q.y < p.y + p.rows as i32 * 8
        }) {
            return Err(
                "sprite_mapping_unsupported: peças sobrepostas exigem prioridade comprovada".into(),
            );
        }
        pieces.push(p);
    }
    let left = pieces.iter().map(|p| p.x).min().unwrap().min(0);
    let top = pieces.iter().map(|p| p.y).min().unwrap().min(0);
    let right = pieces
        .iter()
        .map(|p| p.x + p.columns as i32 * 8)
        .max()
        .unwrap()
        .max(0);
    let bottom = pieces
        .iter()
        .map(|p| p.y + p.rows as i32 * 8)
        .max()
        .unwrap()
        .max(0);
    Ok(Frame {
        index,
        mapping_offset,
        dplc_offset: DPLC_TABLE + word(rom, DPLC_TABLE + index * 2)?,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
        anchor_x: -left,
        anchor_y: -top,
        pieces,
        slots,
    })
}

impl Frame {
    pub fn source_pixel(&self, x: u32, y: u32) -> Option<PixelLocation> {
        if x >= self.width || y >= self.height {
            return None;
        }
        for p in &self.pieces {
            let x = x as i32 - self.anchor_x - p.x;
            let y = y as i32 - self.anchor_y - p.y;
            if x < 0 || y < 0 || x >= p.columns as i32 * 8 || y >= p.rows as i32 * 8 {
                continue;
            }
            let sx = if p.flip_x {
                p.columns * 8 - 1 - x as usize
            } else {
                x as usize
            };
            let sy = if p.flip_y {
                p.rows * 8 - 1 - y as usize
            } else {
                y as usize
            };
            let art_tile = *self.slots.get(p.slot + (sx / 8) * p.rows + sy / 8)?;
            if art_tile >= ART_SIZE / 32 {
                return None;
            }
            return Some(PixelLocation {
                art_tile,
                byte_offset: ART_OFFSET + art_tile * 32 + (sy % 8) * 4 + (sx % 8) / 2,
                high_nibble: sx % 2 == 0,
            });
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Frame {
        Frame {
            index: 0,
            mapping_offset: 0,
            dplc_offset: 0,
            width: 16,
            height: 16,
            anchor_x: 0,
            anchor_y: 0,
            pieces: vec![Piece {
                slot: 0,
                columns: 2,
                rows: 2,
                x: 0,
                y: 0,
                flip_x: false,
                flip_y: false,
            }],
            slots: vec![40, 10, 30, 20],
        }
    }
    #[test]
    fn column_major_and_dplc_are_independent_of_mapping_slot_numbers() {
        let f = frame();
        for (x, y, tile) in [(0, 0, 40), (0, 8, 10), (8, 0, 30), (8, 8, 20)] {
            assert_eq!(f.source_pixel(x, y).unwrap().art_tile, tile);
        }
        assert_eq!(
            f.source_pixel(1, 0).unwrap().byte_offset,
            ART_OFFSET + 40 * 32
        );
        assert!(!f.source_pixel(1, 0).unwrap().high_nibble);
    }
    #[test]
    fn flips_anchor_and_unmapped_coordinates_are_resolved_before_editing() {
        let mut f = frame();
        f.pieces[0].flip_x = true;
        f.pieces[0].flip_y = true;
        let loc = f.source_pixel(0, 0).unwrap();
        assert_eq!(loc.art_tile, 20);
        assert_eq!(loc.byte_offset, ART_OFFSET + 20 * 32 + 31);
        assert!(!loc.high_nibble);
        assert_eq!(f.source_pixel(16, 0), None);
        assert_eq!(f.source_pixel(u32::MAX, u32::MAX), None);
        f.pieces[0].x = -3;
        f.anchor_x = 3;
        assert_eq!(f.source_pixel(0, 0).unwrap(), loc);
    }
    #[test]
    fn unknown_frames_and_short_structures_are_rejected() {
        assert!(frame_index("sonic1_sonic/frame-87").is_err());
        for n in [0, 1, MAP_TABLE, DPLC_TABLE, ART_OFFSET] {
            assert!(read_frame(&vec![0; n], "sonic1_sonic/stand").is_err());
        }
    }

    #[test]
    fn mapping_slots_missing_from_dplc_never_become_art_indices() {
        let mut f = frame();
        f.pieces[0].slot = 4;
        assert!(f.source_pixel(0, 0).is_none());
        f.pieces[0].slot = 0;
        f.slots[0] = ART_SIZE / 32;
        assert!(f.source_pixel(0, 0).is_none());
    }

    fn authored_rom() -> Vec<u8> {
        let mut rom = vec![0; ART_OFFSET + ART_SIZE];
        for i in 0..FRAME_COUNT {
            rom[MAP_TABLE + i * 2..MAP_TABLE + i * 2 + 2].copy_from_slice(&176u16.to_be_bytes());
            rom[DPLC_TABLE + i * 2..DPLC_TABLE + i * 2 + 2].copy_from_slice(&176u16.to_be_bytes());
        }
        // One 2x2 VDP piece, four slots loaded from art tiles 10..13.
        rom[MAP_TABLE + 176..MAP_TABLE + 182].copy_from_slice(&[1, 0xf8, 5, 0, 0, 0xf8]);
        rom[DPLC_TABLE + 176..DPLC_TABLE + 179].copy_from_slice(&[1, 0x30, 10]);
        rom
    }

    #[test]
    fn header_parsing_preserves_anchor_and_refuses_unproved_geometry() {
        let mut rom = authored_rom();
        let f = read_frame(&rom, "sonic1_sonic/stand").unwrap();
        assert_eq!((f.width, f.height, f.anchor_x, f.anchor_y), (16, 16, 8, 8));
        assert_eq!(f.source_pixel(8, 0).unwrap().art_tile, 12);
        rom[MAP_TABLE + 179] = 0x20;
        assert!(read_frame(&rom, "sonic1_sonic/stand")
            .unwrap_err()
            .contains("banco"));
        rom[MAP_TABLE + 179] = 0;
        rom[MAP_TABLE + 180] = 4;
        assert!(read_frame(&rom, "sonic1_sonic/stand")
            .unwrap_err()
            .contains("VRAM"));
        rom[DPLC_TABLE + 177] = 0x3f;
        rom[DPLC_TABLE + 178] = 0xff;
        assert!(dplc_tiles(&rom).unwrap_err().contains("fora da arte"));
    }
}
