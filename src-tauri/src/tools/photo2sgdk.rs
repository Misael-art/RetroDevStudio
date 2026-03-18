//! Photo2SGDK — Transformador de Assets para Mega Drive.
//! Módulo 100% isolado: não altera sgdk_emitter, build_orch ou project.rds.
//! Apenas lê imagens, processa (quantização + palette snapping) e retorna resultado.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::{GenericImageView, ImageBuffer, ImageEncoder, Rgba};
use serde::Serialize;
use std::path::Path;

/// Níveis RGB do Mega Drive (3 bits por canal = 8 níveis).
const MD_LEVELS: [u8; 8] = [0, 36, 73, 109, 146, 182, 219, 255];

/// Máximo de cores utilizáveis (índice 0 reservado para transparente).
const MAX_PALETTE_COLORS: usize = 15;

#[derive(Debug, Serialize)]
pub struct ArtProcessResult {
    pub ok: bool,
    pub processed_base64: Option<String>,
    pub error: Option<String>,
}

fn snap_to_md_level(v: u8) -> u8 {
    let level = ((v as u32 * 7 + 127) / 255).min(7) as usize;
    MD_LEVELS[level]
}

fn snap_rgb_to_md(r: u8, g: u8, b: u8) -> (u8, u8, u8) {
    (
        snap_to_md_level(r),
        snap_to_md_level(g),
        snap_to_md_level(b),
    )
}

#[derive(Clone, Copy, Debug)]
struct RgbColor {
    r: u8,
    g: u8,
    b: u8,
}

impl RgbColor {
    fn from_rgba(p: Rgba<u8>) -> Self {
        Self {
            r: p[0],
            g: p[1],
            b: p[2],
        }
    }

    fn distance_sq(&self, other: &RgbColor) -> u32 {
        let dr = self.r as i32 - other.r as i32;
        let dg = self.g as i32 - other.g as i32;
        let db = self.b as i32 - other.b as i32;
        (dr * dr + dg * dg + db * db) as u32
    }

    fn snapped(&self) -> Self {
        let (r, g, b) = snap_rgb_to_md(self.r, self.g, self.b);
        Self { r, g, b }
    }
}

/// Median cut: divide bucket pelo canal com maior range até obter MAX_PALETTE_COLORS buckets.
fn median_cut_quantize(pixels: &[RgbColor], target_count: usize) -> Vec<RgbColor> {
    if pixels.is_empty() {
        return vec![];
    }
    if target_count <= 1 {
        let (r, g, b) = pixels.iter().fold((0u64, 0u64, 0u64), |acc, p| {
            (acc.0 + p.r as u64, acc.1 + p.g as u64, acc.2 + p.b as u64)
        });
        let n = pixels.len() as u64;
        return vec![RgbColor {
            r: (r / n) as u8,
            g: (g / n) as u8,
            b: (b / n) as u8,
        }];
    }

    let mut buckets: Vec<Vec<RgbColor>> = vec![pixels.to_vec()];

    while buckets.len() < target_count {
        let mut max_range = 0u32;
        let mut split_idx = 0;
        let mut split_channel = 0; // 0=R, 1=G, 2=B

        for (idx, bucket) in buckets.iter().enumerate() {
            if bucket.len() < 2 {
                continue;
            }
            let (min_r, max_r) = bucket.iter().map(|p| p.r).minmax().unwrap_or((0, 0));
            let (min_g, max_g) = bucket.iter().map(|p| p.g).minmax().unwrap_or((0, 0));
            let (min_b, max_b) = bucket.iter().map(|p| p.b).minmax().unwrap_or((0, 0));
            let range_r = (max_r - min_r) as u32;
            let range_g = (max_g - min_g) as u32;
            let range_b = (max_b - min_b) as u32;

            let (range, channel) = if range_r >= range_g && range_r >= range_b {
                (range_r, 0)
            } else if range_g >= range_r && range_g >= range_b {
                (range_g, 1)
            } else {
                (range_b, 2)
            };

            if range > max_range {
                max_range = range;
                split_idx = idx;
                split_channel = channel;
            }
        }

        if max_range == 0 {
            break;
        }

        let bucket = std::mem::take(&mut buckets[split_idx]);
        let mut sorted = bucket;
        match split_channel {
            0 => sorted.sort_by_key(|p| p.r),
            1 => sorted.sort_by_key(|p| p.g),
            _ => sorted.sort_by_key(|p| p.b),
        }
        let mid = sorted.len() / 2;
        let right = sorted.split_off(mid);
        buckets[split_idx] = sorted;
        buckets.insert(split_idx + 1, right);
    }

    buckets
        .into_iter()
        .map(|bucket| {
            if bucket.is_empty() {
                RgbColor { r: 0, g: 0, b: 0 }
            } else {
                let (r, g, b) = bucket.iter().fold((0u64, 0u64, 0u64), |acc, p| {
                    (acc.0 + p.r as u64, acc.1 + p.g as u64, acc.2 + p.b as u64)
                });
                let n = bucket.len() as u64;
                RgbColor {
                    r: (r / n) as u8,
                    g: (g / n) as u8,
                    b: (b / n) as u8,
                }
            }
        })
        .collect()
}

trait MinMax {
    fn minmax(self) -> Option<(u8, u8)>;
}

impl<I: Iterator<Item = u8>> MinMax for I {
    fn minmax(mut self) -> Option<(u8, u8)> {
        let first = self.next()?;
        let mut min = first;
        let mut max = first;
        for v in self {
            min = min.min(v);
            max = max.max(v);
        }
        Some((min, max))
    }
}

#[tauri::command]
pub fn art_process_palette(image_path: String) -> Result<ArtProcessResult, String> {
    let path = Path::new(&image_path);
    if !path.exists() {
        return Ok(ArtProcessResult {
            ok: false,
            processed_base64: None,
            error: Some(format!("Arquivo não encontrado: {}", image_path)),
        });
    }

    let img = image::open(path).map_err(|e| format!("Falha ao abrir imagem: {}", e))?;
    let (width, height) = img.dimensions();

    let mut pixels: Vec<RgbColor> = Vec::with_capacity((width * height) as usize);
    let mut transparent_indices: Vec<bool> = Vec::with_capacity((width * height) as usize);
    let has_alpha = img.color().has_alpha();

    for y in 0..height {
        for x in 0..width {
            let p = img.get_pixel(x, y);
            let is_transparent = has_alpha && p[3] < 128;
            transparent_indices.push(is_transparent);
            if !is_transparent {
                pixels.push(RgbColor::from_rgba(p));
            }
        }
    }

    let palette = if pixels.is_empty() {
        vec![RgbColor { r: 0, g: 0, b: 0 }]
    } else {
        median_cut_quantize(&pixels, MAX_PALETTE_COLORS)
    };

    let palette_snapped: Vec<RgbColor> = palette.iter().map(|c| c.snapped()).collect();

    let mut out = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(width, height);
    let mut non_trans_idx = 0usize;

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) as usize;
            let trans = transparent_indices[idx];

            if trans {
                out.put_pixel(x, y, Rgba([0, 0, 0, 0]));
                continue;
            }

            let pixel = pixels.get(non_trans_idx).copied().unwrap_or(RgbColor { r: 0, g: 0, b: 0 });
            non_trans_idx += 1;
            let best = palette_snapped
                .iter()
                .min_by_key(|c| pixel.distance_sq(c))
                .copied()
                .unwrap_or(RgbColor { r: 0, g: 0, b: 0 });

            out.put_pixel(x, y, Rgba([best.r, best.g, best.b, 255]));
        }
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png_bytes)
        .write_image(out.as_raw(), width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("Falha ao codificar PNG: {}", e))?;

    let base64_out = BASE64.encode(&png_bytes);

    Ok(ArtProcessResult {
        ok: true,
        processed_base64: Some(base64_out),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn art_process_palette_returns_ok_for_valid_image() {
        let dir = std::env::temp_dir().join("photo2sgdk_test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test_4x4.png");

        let mut img = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(4, 4);
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, Rgba([x as u8 * 64, y as u8 * 64, 128, 255]));
            }
        }

        let mut png_bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png_bytes)
            .write_image(img.as_raw(), 4, 4, image::ExtendedColorType::Rgba8)
            .unwrap();
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(&png_bytes).unwrap();
        drop(f);

        let result = art_process_palette(path.to_string_lossy().to_string()).unwrap();
        assert!(result.ok);
        assert!(result.processed_base64.is_some());
        assert!(result.error.is_none());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn art_process_palette_returns_error_for_missing_file() {
        let result = art_process_palette("/nonexistent/path/image.png".to_string()).unwrap();
        assert!(!result.ok);
        assert!(result.error.is_some());
    }

    #[test]
    fn snap_to_md_level_maps_correctly() {
        assert_eq!(snap_to_md_level(0), 0);
        assert_eq!(snap_to_md_level(255), 255);
        assert_eq!(snap_to_md_level(128), 146);
    }
}
