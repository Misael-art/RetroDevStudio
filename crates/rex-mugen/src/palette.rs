//! Paleta de hardware (Mega Drive) a partir dos indices SFF.
//!
//! * Indice 0 e transparente e vira o slot 0.
//! * Cada cor usada e levada a grade de 9 bits do VDP (3 bits por canal).
//! * Se couberem ate 15 cores VDP distintas, cada indice MUGEN recebe o seu slot.
//! * Acima disso, as cores com mais pixels ficam e as demais vao para a mais proxima;
//!   os pixels afetados sao contados e declarados (nunca em silencio).

use std::collections::BTreeMap;

use crate::sff::Rgb;

/// Nivel VDP (0..7) de um canal de 8 bits, arredondado ao mais proximo.
pub fn vdp_level(c: u8) -> u8 {
    ((c as u32 * 7 + 127) / 255) as u8
}

/// Cor de 8 bits que o VDP de fato exibe para um nivel.
pub fn level_rgb(level: u8) -> u8 {
    ((level as u32 * 255 + 3) / 7) as u8
}

pub fn to_vdp(c: Rgb) -> Rgb {
    [
        level_rgb(vdp_level(c[0])),
        level_rgb(vdp_level(c[1])),
        level_rgb(vdp_level(c[2])),
    ]
}

/// Palavra CRAM `0000 BBB0 GGG0 RRR0`.
pub fn cram_word(c: Rgb) -> u16 {
    let (r, g, b) = (vdp_level(c[0]), vdp_level(c[1]), vdp_level(c[2]));
    ((b as u16) << 9) | ((g as u16) << 5) | ((r as u16) << 1)
}

fn dist(a: Rgb, b: Rgb) -> u32 {
    let d = |x: u8, y: u8| (x as i32 - y as i32).pow(2) as u32;
    2 * d(a[0], b[0]) + 4 * d(a[1], b[1]) + 3 * d(a[2], b[2])
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HardwarePalette {
    /// Slot 0..15 para cada indice MUGEN (0 = transparente).
    pub slot_of_index: [u8; 256],
    /// Cores dos 16 slots, ja na grade do VDP (slot 0 nao exibido).
    pub colors: [Rgb; 16],
    pub used_indices: usize,
    pub distinct_vdp_colors: usize,
    /// Pixels cuja cor exibida difere da original fora do arredondamento de 9 bits.
    pub merged_pixels: u64,
    /// Pixels cuja cor mudou so pelo arredondamento de 9 bits.
    pub rounded_pixels: u64,
    pub total_opaque_pixels: u64,
}

/// `pixel_counts[i]` = quantos pixels opacos usam o indice `i` (0 ignorado).
pub fn build(palette: &[Rgb], pixel_counts: &[u64; 256]) -> HardwarePalette {
    let mut by_color: BTreeMap<Rgb, u64> = BTreeMap::new();
    let mut used = 0;
    let mut rounded = 0;
    let mut total = 0;
    for i in 1..256 {
        let n = pixel_counts[i];
        if n == 0 {
            continue;
        }
        used += 1;
        total += n;
        let v = to_vdp(palette[i]);
        if v != palette[i] {
            rounded += n;
        }
        *by_color.entry(v).or_default() += n;
    }
    let distinct = by_color.len();
    // Ordem deterministica: mais pixels primeiro; empate pela cor.
    let mut ranked: Vec<(Rgb, u64)> = by_color.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let kept: Vec<Rgb> = ranked.iter().take(15).map(|(c, _)| *c).collect();
    let mut colors = [[0u8; 3]; 16];
    for (slot, c) in kept.iter().enumerate() {
        colors[slot + 1] = *c;
    }
    let mut slot_of_index = [0u8; 256];
    let mut merged = 0;
    for i in 1..256 {
        if pixel_counts[i] == 0 {
            continue;
        }
        let v = to_vdp(palette[i]);
        let (slot, exact) = match kept.iter().position(|c| *c == v) {
            Some(p) => (p + 1, true),
            None => {
                let p = (0..kept.len())
                    .min_by_key(|&k| (dist(kept[k], v), k))
                    .unwrap();
                (p + 1, false)
            }
        };
        if !exact {
            merged += pixel_counts[i];
        }
        slot_of_index[i] = slot as u8;
    }
    HardwarePalette {
        slot_of_index,
        colors,
        used_indices: used,
        distinct_vdp_colors: distinct,
        merged_pixels: merged,
        rounded_pixels: rounded,
        total_opaque_pixels: total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdp_grid_round_trips() {
        for level in 0..8 {
            assert_eq!(vdp_level(level_rgb(level)), level);
        }
        assert_eq!(cram_word([255, 0, 0]), 0x000E);
        assert_eq!(cram_word([0, 0, 255]), 0x0E00);
    }

    #[test]
    fn at_most_fifteen_colors_map_exactly_and_excess_is_counted() {
        let pal: Vec<Rgb> = (0..256)
            .map(|i| [level_rgb((i % 8) as u8), level_rgb((i / 8 % 8) as u8), 0])
            .collect();
        let mut counts = [0u64; 256];
        for (i, c) in counts.iter_mut().enumerate().take(16).skip(1) {
            *c = 100 + i as u64;
        }
        let exact = build(&pal, &counts);
        assert_eq!(
            (
                exact.distinct_vdp_colors,
                exact.merged_pixels,
                exact.rounded_pixels
            ),
            (15, 0, 0)
        );
        for (i, color) in pal.iter().enumerate().take(16).skip(1) {
            assert_eq!(exact.colors[exact.slot_of_index[i] as usize], *color);
        }
        counts[16] = 7; // 16a cor, a menos usada
        let over = build(&pal, &counts);
        assert_eq!(over.distinct_vdp_colors, 16);
        assert_eq!(over.merged_pixels, 7, "so os pixels da cor excedente");
        assert_ne!(over.slot_of_index[16], 0);
    }
}
