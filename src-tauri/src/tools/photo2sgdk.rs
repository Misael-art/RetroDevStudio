//! Photo2SGDK / ArtStudio backend pipeline.
//! Centraliza decode, heuristicas de transparencia, quantizacao para Mega Drive
//! e preview pronto para a UI, sem bloquear a thread principal do Tauri.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::codecs::gif::GifDecoder;
use image::{AnimationDecoder, ImageEncoder, ImageFormat, ImageReader, Rgba, RgbaImage};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};

/// Niveis RGB do Mega Drive (3 bits por canal = 8 niveis).
const MD_LEVELS: [u8; 8] = [0, 36, 73, 109, 146, 182, 219, 255];

/// Maximo de cores utilizaveis (indice 0 reservado para transparente).
const MAX_PALETTE_COLORS: usize = 15;

/// Threshold para considerar um pixel totalmente transparente.
const ALPHA_TRANSPARENT_THRESHOLD: u8 = 128;

/// Distancia maxima por canal para considerar a cor como parte do fundo.
const BACKGROUND_CHANNEL_TOLERANCE: i16 = 24;

/// Proporcao minima de borda que precisa combinar com a cor do canto superior esquerdo
/// para a heuristica de background ser aceita.
const BORDER_MATCH_THRESHOLD: f32 = 0.35;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ArtContentBounds {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub aligned_x: u32,
    pub aligned_y: u32,
    pub aligned_width: u32,
    pub aligned_height: u32,
    pub tile_cols: u32,
    pub tile_rows: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ArtSuggestedFrame {
    pub index: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtProcessResult {
    pub ok: bool,
    pub processed_base64: Option<String>,
    pub error: Option<String>,
    pub format: Option<String>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    pub processed_width: Option<u32>,
    pub processed_height: Option<u32>,
    pub frame_count: Option<u32>,
    pub background_mode: Option<String>,
    pub transparent_pixels: Option<u32>,
    pub palette: Vec<String>,
    pub palette_size: usize,
    pub content_bounds: Option<ArtContentBounds>,
    pub suggested_frame_width: Option<u32>,
    pub suggested_frame_height: Option<u32>,
    pub recommended_output_width: Option<u32>,
    pub recommended_output_height: Option<u32>,
    pub recommended_scale_percent: Option<u32>,
    pub meta_sprite_candidate: bool,
    pub slicing_mode: Option<String>,
    pub suggested_frames: Vec<ArtSuggestedFrame>,
    pub warnings: Vec<String>,
}

impl ArtProcessResult {
    fn failure(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            processed_base64: None,
            error: Some(error.into()),
            format: None,
            source_width: None,
            source_height: None,
            processed_width: None,
            processed_height: None,
            frame_count: None,
            background_mode: None,
            transparent_pixels: None,
            palette: Vec::new(),
            palette_size: 0,
            content_bounds: None,
            suggested_frame_width: None,
            suggested_frame_height: None,
            recommended_output_width: None,
            recommended_output_height: None,
            recommended_scale_percent: None,
            meta_sprite_candidate: false,
            slicing_mode: None,
            suggested_frames: Vec::new(),
            warnings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtImportResult {
    pub ok: bool,
    pub error: Option<String>,
    pub relative_path: Option<String>,
    pub absolute_path: Option<String>,
    pub sprite_name: Option<String>,
    pub frame_width: Option<u32>,
    pub frame_height: Option<u32>,
    pub frame_count: u32,
    pub generated_width: Option<u32>,
    pub generated_height: Option<u32>,
}

impl ArtImportResult {
    fn failure(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(error.into()),
            relative_path: None,
            absolute_path: None,
            sprite_name: None,
            frame_width: None,
            frame_height: None,
            frame_count: 0,
            generated_width: None,
            generated_height: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct RgbColor {
    r: u8,
    g: u8,
    b: u8,
}

impl RgbColor {
    fn from_rgba(pixel: Rgba<u8>) -> Self {
        Self {
            r: pixel[0],
            g: pixel[1],
            b: pixel[2],
        }
    }

    fn distance_sq(&self, other: &RgbColor) -> u32 {
        let dr = self.r as i32 - other.r as i32;
        let dg = self.g as i32 - other.g as i32;
        let db = self.b as i32 - other.b as i32;
        (dr * dr + dg * dg + db * db) as u32
    }

    fn within_tolerance(&self, other: &RgbColor, tolerance: i16) -> bool {
        (self.r as i16 - other.r as i16).abs() <= tolerance
            && (self.g as i16 - other.g as i16).abs() <= tolerance
            && (self.b as i16 - other.b as i16).abs() <= tolerance
    }

    fn snapped(&self) -> Self {
        let (r, g, b) = snap_rgb_to_md(self.r, self.g, self.b);
        Self { r, g, b }
    }

    fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BackgroundMode {
    Alpha,
    Corner,
    None,
}

impl BackgroundMode {
    fn label(self) -> &'static str {
        match self {
            Self::Alpha => "alpha",
            Self::Corner => "corner",
            Self::None => "none",
        }
    }
}

#[derive(Debug)]
struct TransparencyAnalysis {
    mask: Vec<bool>,
    mode: BackgroundMode,
    transparent_pixels: usize,
}

#[derive(Debug)]
struct DecodedImage {
    image: RgbaImage,
    format: ImageFormat,
    frame_count: usize,
}

#[derive(Debug)]
struct SpriteRecommendations {
    suggested_frame_width: u32,
    suggested_frame_height: u32,
    recommended_output_width: u32,
    recommended_output_height: u32,
    recommended_scale_percent: u32,
    meta_sprite_candidate: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SlicingMode {
    Auto,
    Grid,
    AutoIslands,
}

impl SlicingMode {
    fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("auto").trim().to_ascii_lowercase().as_str() {
            "grid" => Self::Grid,
            "auto_islands" | "auto-islands" | "islands" => Self::AutoIslands,
            _ => Self::Auto,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Grid => "grid",
            Self::AutoIslands => "auto_islands",
        }
    }
}

fn snap_to_md_level(value: u8) -> u8 {
    let level = ((value as u32 * 7 + 127) / 255).min(7) as usize;
    MD_LEVELS[level]
}

fn snap_rgb_to_md(r: u8, g: u8, b: u8) -> (u8, u8, u8) {
    (
        snap_to_md_level(r),
        snap_to_md_level(g),
        snap_to_md_level(b),
    )
}

fn align_down(value: u32, multiple: u32) -> u32 {
    if multiple == 0 {
        return value;
    }
    value - (value % multiple)
}

fn align_up(value: u32, multiple: u32) -> u32 {
    if multiple == 0 {
        return value;
    }
    if value == 0 {
        multiple
    } else {
        let remainder = value % multiple;
        if remainder == 0 {
            value
        } else {
            value + (multiple - remainder)
        }
    }
}

fn clamp_to_supported_sprite_dimension(value: u32) -> u32 {
    match value {
        0..=8 => 8,
        9..=16 => 16,
        17..=24 => 24,
        _ => 32,
    }
}

fn format_label(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "PNG",
        ImageFormat::Bmp => "BMP",
        ImageFormat::Jpeg => "JPEG",
        ImageFormat::Gif => "GIF",
        ImageFormat::WebP => "WebP",
        ImageFormat::Pnm => "PPM",
        _ => "Imagem",
    }
}

fn decode_source_image(path: &Path) -> Result<DecodedImage, String> {
    let reader =
        ImageReader::open(path).map_err(|error| format!("Falha ao abrir imagem: {}", error))?;
    let reader = reader
        .with_guessed_format()
        .map_err(|error| format!("Falha ao identificar formato da imagem: {}", error))?;
    let format = reader
        .format()
        .ok_or_else(|| format!("Formato nao suportado para '{}'.", path.display()))?;

    match format {
        ImageFormat::Gif => {
            let file =
                File::open(path).map_err(|error| format!("Falha ao abrir GIF: {}", error))?;
            let decoder = GifDecoder::new(BufReader::new(file))
                .map_err(|error| format!("Falha ao criar decoder GIF: {}", error))?;
            let frames = decoder
                .into_frames()
                .collect_frames()
                .map_err(|error| format!("Falha ao decodificar frames do GIF: {}", error))?;

            let first_frame = frames
                .first()
                .ok_or_else(|| format!("GIF sem frames em '{}'.", path.display()))?;
            Ok(DecodedImage {
                image: first_frame.buffer().clone(),
                format,
                frame_count: frames.len(),
            })
        }
        _ => {
            let image = reader
                .decode()
                .map_err(|error| format!("Falha ao decodificar imagem: {}", error))?
                .into_rgba8();
            Ok(DecodedImage {
                image,
                format,
                frame_count: 1,
            })
        }
    }
}

fn detect_transparency(image: &RgbaImage) -> TransparencyAnalysis {
    let width = image.width();
    let height = image.height();
    let pixel_count = (width * height) as usize;
    let mut mask = vec![false; pixel_count];
    let mut transparent_pixels = 0usize;

    for (index, pixel) in image.pixels().enumerate() {
        if pixel[3] < ALPHA_TRANSPARENT_THRESHOLD {
            mask[index] = true;
            transparent_pixels += 1;
        }
    }

    if transparent_pixels > 0 {
        return TransparencyAnalysis {
            mask,
            mode: BackgroundMode::Alpha,
            transparent_pixels,
        };
    }

    let candidate = RgbColor::from_rgba(*image.get_pixel(0, 0));
    let mut border_total = 0u32;
    let mut border_matches = 0u32;

    let mut visit_border = |x: u32, y: u32| {
        border_total += 1;
        if RgbColor::from_rgba(*image.get_pixel(x, y))
            .within_tolerance(&candidate, BACKGROUND_CHANNEL_TOLERANCE)
        {
            border_matches += 1;
        }
    };

    for x in 0..width {
        visit_border(x, 0);
        if height > 1 {
            visit_border(x, height - 1);
        }
    }
    if width > 1 && height > 2 {
        for y in 1..(height - 1) {
            visit_border(0, y);
            visit_border(width - 1, y);
        }
    }

    if border_total == 0 || (border_matches as f32 / border_total as f32) < BORDER_MATCH_THRESHOLD {
        return TransparencyAnalysis {
            mask,
            mode: BackgroundMode::None,
            transparent_pixels: 0,
        };
    }

    let mut queue = VecDeque::new();
    let mut visited = vec![false; pixel_count];
    let push_if_match = |x: u32,
                         y: u32,
                         queue: &mut VecDeque<(u32, u32)>,
                         visited: &mut [bool],
                         mask: &mut [bool],
                         transparent_pixels: &mut usize| {
        let index = (y * width + x) as usize;
        if visited[index] {
            return;
        }
        visited[index] = true;
        if RgbColor::from_rgba(*image.get_pixel(x, y))
            .within_tolerance(&candidate, BACKGROUND_CHANNEL_TOLERANCE)
        {
            mask[index] = true;
            *transparent_pixels += 1;
            queue.push_back((x, y));
        }
    };

    for x in 0..width {
        push_if_match(
            x,
            0,
            &mut queue,
            &mut visited,
            &mut mask,
            &mut transparent_pixels,
        );
        if height > 1 {
            push_if_match(
                x,
                height - 1,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
        }
    }
    if width > 1 && height > 2 {
        for y in 1..(height - 1) {
            push_if_match(
                0,
                y,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
            push_if_match(
                width - 1,
                y,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
        }
    }

    while let Some((x, y)) = queue.pop_front() {
        if x > 0 {
            push_if_match(
                x - 1,
                y,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
        }
        if x + 1 < width {
            push_if_match(
                x + 1,
                y,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
        }
        if y > 0 {
            push_if_match(
                x,
                y - 1,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
        }
        if y + 1 < height {
            push_if_match(
                x,
                y + 1,
                &mut queue,
                &mut visited,
                &mut mask,
                &mut transparent_pixels,
            );
        }
    }

    TransparencyAnalysis {
        mask,
        mode: if transparent_pixels > 0 {
            BackgroundMode::Corner
        } else {
            BackgroundMode::None
        },
        transparent_pixels,
    }
}

fn median_cut_quantize(colors: &[RgbColor], max_colors: usize) -> Vec<RgbColor> {
    if colors.is_empty() || max_colors == 0 {
        return Vec::new();
    }

    if colors.len() <= max_colors {
        let mut unique = Vec::new();
        for color in colors {
            if !unique.contains(color) {
                unique.push(*color);
            }
        }
        return unique.into_iter().take(max_colors).collect();
    }

    #[derive(Clone)]
    struct ColorBox {
        colors: Vec<RgbColor>,
    }

    let mut boxes = vec![ColorBox {
        colors: colors.to_vec(),
    }];

    while boxes.len() < max_colors {
        let split_index = boxes
            .iter()
            .enumerate()
            .filter(|(_, bucket)| bucket.colors.len() > 1)
            .max_by_key(|(_, bucket)| {
                let (min_r, max_r, min_g, max_g, min_b, max_b) = bucket.colors.iter().fold(
                    (u8::MAX, 0, u8::MAX, 0, u8::MAX, 0),
                    |(min_r, max_r, min_g, max_g, min_b, max_b), color| {
                        (
                            min_r.min(color.r),
                            max_r.max(color.r),
                            min_g.min(color.g),
                            max_g.max(color.g),
                            min_b.min(color.b),
                            max_b.max(color.b),
                        )
                    },
                );
                (max_r - min_r).max(max_g - min_g).max(max_b - min_b)
            })
            .map(|(index, _)| index);

        let Some(index) = split_index else {
            break;
        };

        let mut bucket = boxes.swap_remove(index);
        let (min_r, max_r, min_g, max_g, min_b, max_b) = bucket.colors.iter().fold(
            (u8::MAX, 0, u8::MAX, 0, u8::MAX, 0),
            |(min_r, max_r, min_g, max_g, min_b, max_b), color| {
                (
                    min_r.min(color.r),
                    max_r.max(color.r),
                    min_g.min(color.g),
                    max_g.max(color.g),
                    min_b.min(color.b),
                    max_b.max(color.b),
                )
            },
        );

        let axis = if (max_r - min_r) >= (max_g - min_g) && (max_r - min_r) >= (max_b - min_b) {
            0
        } else if (max_g - min_g) >= (max_b - min_b) {
            1
        } else {
            2
        };

        bucket.colors.sort_by_key(|color| match axis {
            0 => color.r,
            1 => color.g,
            _ => color.b,
        });

        let mid = bucket.colors.len() / 2;
        let right = bucket.colors.split_off(mid);
        boxes.push(ColorBox {
            colors: bucket.colors,
        });
        boxes.push(ColorBox { colors: right });
    }

    boxes
        .into_iter()
        .filter(|bucket| !bucket.colors.is_empty())
        .map(|bucket| {
            let len = bucket.colors.len() as u32;
            let (sum_r, sum_g, sum_b) =
                bucket
                    .colors
                    .iter()
                    .fold((0u32, 0u32, 0u32), |(sum_r, sum_g, sum_b), color| {
                        (
                            sum_r + color.r as u32,
                            sum_g + color.g as u32,
                            sum_b + color.b as u32,
                        )
                    });
            RgbColor {
                r: (sum_r / len) as u8,
                g: (sum_g / len) as u8,
                b: (sum_b / len) as u8,
            }
            .snapped()
        })
        .fold(Vec::new(), |mut acc, color| {
            if !acc.contains(&color) && acc.len() < max_colors {
                acc.push(color);
            }
            acc
        })
}

fn build_palette(image: &RgbaImage, transparency: &TransparencyAnalysis) -> Vec<RgbColor> {
    let mut opaque_colors = Vec::new();
    for (index, pixel) in image.pixels().enumerate() {
        if transparency.mask[index] {
            continue;
        }
        opaque_colors.push(RgbColor::from_rgba(*pixel));
    }

    if opaque_colors.is_empty() {
        return Vec::new();
    }

    let mut quantized = median_cut_quantize(&opaque_colors, MAX_PALETTE_COLORS);
    if quantized.is_empty() {
        quantized = opaque_colors.into_iter().map(|color| color.snapped()).fold(
            Vec::new(),
            |mut acc, color| {
                if !acc.contains(&color) && acc.len() < MAX_PALETTE_COLORS {
                    acc.push(color);
                }
                acc
            },
        );
    }

    quantized
}

fn render_quantized_preview(
    image: &RgbaImage,
    transparency: &TransparencyAnalysis,
    palette: &[RgbColor],
) -> RgbaImage {
    let mut preview = image.clone();

    for (index, pixel) in preview.pixels_mut().enumerate() {
        if transparency.mask[index] {
            *pixel = Rgba([0, 0, 0, 0]);
            continue;
        }

        let source = RgbColor::from_rgba(*pixel);
        let nearest = palette
            .iter()
            .min_by_key(|candidate| source.distance_sq(candidate))
            .copied()
            .unwrap_or_else(|| source.snapped());

        *pixel = Rgba([nearest.r, nearest.g, nearest.b, 255]);
    }

    preview
}

fn detect_content_bounds(
    image: &RgbaImage,
    transparency: &TransparencyAnalysis,
) -> ArtContentBounds {
    let width = image.width();
    let height = image.height();
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut found = false;

    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) as usize;
            if transparency.mask[index] {
                continue;
            }
            found = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }

    let (x, y, bounds_width, bounds_height) = if found {
        (min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)
    } else {
        (0, 0, width.max(1), height.max(1))
    };

    let aligned_x = align_down(x, 8);
    let aligned_y = align_down(y, 8);
    let aligned_max_x = align_up(x + bounds_width, 8);
    let aligned_max_y = align_up(y + bounds_height, 8);
    let aligned_width = (aligned_max_x - aligned_x).max(8);
    let aligned_height = (aligned_max_y - aligned_y).max(8);

    ArtContentBounds {
        x,
        y,
        width: bounds_width.max(1),
        height: bounds_height.max(1),
        aligned_x,
        aligned_y,
        aligned_width,
        aligned_height,
        tile_cols: (aligned_width / 8).max(1),
        tile_rows: (aligned_height / 8).max(1),
    }
}

fn recommend_sprite_dimensions(bounds: &ArtContentBounds) -> SpriteRecommendations {
    let max_dimension = bounds.aligned_width.max(bounds.aligned_height);
    let scale_percent = if max_dimension <= 32 {
        100
    } else {
        ((32.0 / max_dimension as f32) * 100.0).floor().max(1.0) as u32
    };

    let recommended_output_width = align_up(
        ((bounds.aligned_width * scale_percent).max(100) / 100).max(8),
        8,
    )
    .min(32);
    let recommended_output_height = align_up(
        ((bounds.aligned_height * scale_percent).max(100) / 100).max(8),
        8,
    )
    .min(32);

    SpriteRecommendations {
        suggested_frame_width: clamp_to_supported_sprite_dimension(bounds.aligned_width),
        suggested_frame_height: clamp_to_supported_sprite_dimension(bounds.aligned_height),
        recommended_output_width,
        recommended_output_height,
        recommended_scale_percent: scale_percent,
        meta_sprite_candidate: bounds.aligned_width > 32 || bounds.aligned_height > 32,
    }
}

fn normalize_grid_dimension(value: Option<u32>, fallback: u32) -> u32 {
    match value.unwrap_or(fallback).max(8) {
        0..=8 => 8,
        9..=16 => 16,
        17..=24 => 24,
        25..=32 => 32,
        other => align_up(other, 8),
    }
}

fn cell_has_visible_pixels(
    transparency: &TransparencyAnalysis,
    image_width: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> bool {
    for sample_y in y..(y + height) {
        for sample_x in x..(x + width) {
            let index = (sample_y * image_width + sample_x) as usize;
            if !transparency.mask[index] {
                return true;
            }
        }
    }

    false
}

fn build_grid_frames(
    image: &RgbaImage,
    transparency: &TransparencyAnalysis,
    frame_width: u32,
    frame_height: u32,
) -> Vec<ArtSuggestedFrame> {
    if frame_width == 0 || frame_height == 0 {
        return Vec::new();
    }

    let mut frames = Vec::new();
    let mut index = 0u32;

    let max_x = image.width().saturating_sub(frame_width);
    let max_y = image.height().saturating_sub(frame_height);

    let mut y = 0u32;
    while y <= max_y {
        let mut x = 0u32;
        while x <= max_x {
            if cell_has_visible_pixels(transparency, image.width(), x, y, frame_width, frame_height)
            {
                frames.push(ArtSuggestedFrame {
                    index,
                    x,
                    y,
                    width: frame_width,
                    height: frame_height,
                });
                index += 1;
            }
            x += frame_width;
        }
        y += frame_height;
    }

    frames
}

fn build_auto_island_frames(
    image: &RgbaImage,
    transparency: &TransparencyAnalysis,
) -> Vec<ArtSuggestedFrame> {
    let width = image.width();
    let height = image.height();
    let pixel_count = (width * height) as usize;
    let mut visited = vec![false; pixel_count];
    let mut components = Vec::new();

    for y in 0..height {
        for x in 0..width {
            let start_index = (y * width + x) as usize;
            if visited[start_index] || transparency.mask[start_index] {
                continue;
            }

            let mut queue = VecDeque::from([(x, y)]);
            visited[start_index] = true;
            let mut min_x = x;
            let mut min_y = y;
            let mut max_x = x;
            let mut max_y = y;

            while let Some((current_x, current_y)) = queue.pop_front() {
                min_x = min_x.min(current_x);
                min_y = min_y.min(current_y);
                max_x = max_x.max(current_x);
                max_y = max_y.max(current_y);

                let neighbors = [
                    current_x.checked_sub(1).map(|next_x| (next_x, current_y)),
                    (current_x + 1 < width).then_some((current_x + 1, current_y)),
                    current_y.checked_sub(1).map(|next_y| (current_x, next_y)),
                    (current_y + 1 < height).then_some((current_x, current_y + 1)),
                ];

                for neighbor in neighbors.into_iter().flatten() {
                    let neighbor_index = (neighbor.1 * width + neighbor.0) as usize;
                    if visited[neighbor_index] || transparency.mask[neighbor_index] {
                        continue;
                    }
                    visited[neighbor_index] = true;
                    queue.push_back(neighbor);
                }
            }

            components.push(ArtContentBounds {
                x: min_x,
                y: min_y,
                width: max_x - min_x + 1,
                height: max_y - min_y + 1,
                aligned_x: align_down(min_x, 8),
                aligned_y: align_down(min_y, 8),
                aligned_width: align_up(max_x - min_x + 1, 8).max(8),
                aligned_height: align_up(max_y - min_y + 1, 8).max(8),
                tile_cols: 0,
                tile_rows: 0,
            });
        }
    }

    if components.is_empty() {
        return Vec::new();
    }

    components.sort_by_key(|component| (component.y, component.x));
    let frame_width = components
        .iter()
        .map(|component| component.aligned_width)
        .max()
        .unwrap_or(8);
    let frame_height = components
        .iter()
        .map(|component| component.aligned_height)
        .max()
        .unwrap_or(8);

    components
        .into_iter()
        .enumerate()
        .map(|(index, component)| {
            let max_x = width.saturating_sub(frame_width);
            let max_y = height.saturating_sub(frame_height);
            let origin_x = component.aligned_x.min(max_x);
            let origin_y = component.aligned_y.min(max_y);

            ArtSuggestedFrame {
                index: index as u32,
                x: origin_x,
                y: origin_y,
                width: frame_width,
                height: frame_height,
            }
        })
        .collect()
}

fn select_suggested_frames(
    mode: SlicingMode,
    image: &RgbaImage,
    transparency: &TransparencyAnalysis,
    recommendations: &SpriteRecommendations,
    requested_frame_width: Option<u32>,
    requested_frame_height: Option<u32>,
) -> (SlicingMode, Vec<ArtSuggestedFrame>, u32, u32) {
    let grid_width =
        normalize_grid_dimension(requested_frame_width, recommendations.suggested_frame_width);
    let grid_height = normalize_grid_dimension(
        requested_frame_height,
        recommendations.suggested_frame_height,
    );
    let grid_frames = build_grid_frames(image, transparency, grid_width, grid_height);
    let auto_frames = build_auto_island_frames(image, transparency);
    let auto_frame_width = auto_frames
        .first()
        .map(|frame| frame.width)
        .unwrap_or(grid_width);
    let auto_frame_height = auto_frames
        .first()
        .map(|frame| frame.height)
        .unwrap_or(grid_height);
    let auto_safe = !auto_frames.is_empty()
        && auto_frames.len() <= 128
        && auto_frame_width <= 64
        && auto_frame_height <= 64;

    match mode {
        SlicingMode::Grid => (SlicingMode::Grid, grid_frames, grid_width, grid_height),
        SlicingMode::AutoIslands if auto_safe => (
            SlicingMode::AutoIslands,
            auto_frames,
            auto_frame_width,
            auto_frame_height,
        ),
        SlicingMode::AutoIslands => (SlicingMode::Grid, grid_frames, grid_width, grid_height),
        SlicingMode::Auto if auto_safe && auto_frames.len() > 1 => (
            SlicingMode::AutoIslands,
            auto_frames,
            auto_frame_width,
            auto_frame_height,
        ),
        SlicingMode::Auto => (SlicingMode::Grid, grid_frames, grid_width, grid_height),
    }
}

fn build_warnings(
    decoded: &DecodedImage,
    transparency: &TransparencyAnalysis,
    bounds: &ArtContentBounds,
    palette_size: usize,
    recommendations: &SpriteRecommendations,
    slicing_mode: SlicingMode,
    suggested_frames: &[ArtSuggestedFrame],
) -> Vec<String> {
    let mut warnings = Vec::new();

    if decoded.frame_count > 1 {
        warnings.push(
            "GIF animado detectado: o preview do ArtStudio usa o primeiro frame para analise."
                .to_string(),
        );
    }

    if transparency.mode == BackgroundMode::None && transparency.transparent_pixels == 0 {
        warnings.push(
            "Nenhuma transparencia automatica foi detectada. Revise o fundo da imagem antes de aplicar."
                .to_string(),
        );
    }

    if palette_size >= 16 {
        warnings.push(
            "A imagem ocupou os 16 slots da paleta do Mega Drive. Talvez seja necessario simplificar as cores."
                .to_string(),
        );
    }

    if recommendations.meta_sprite_candidate {
        warnings.push(
            "O conteudo alinhado excede 32x32 e deve ser tratado como meta-sprite ou redimensionado."
                .to_string(),
        );
    }

    if recommendations.recommended_scale_percent < 100 {
        warnings.push(format!(
            "Recomendacao de downscale para {}% antes da montagem final no Mega Drive.",
            recommendations.recommended_scale_percent
        ));
    }

    if bounds.tile_cols * bounds.tile_rows > 16 {
        warnings.push(
            "O bounding box alinhado ocupa muitos tiles. Considere recorte adicional ou particionamento."
                .to_string(),
        );
    }

    if suggested_frames.is_empty() {
        warnings.push(
            "Nenhum frame nao vazio foi detectado para o slicing atual. Ajuste o grid ou revise a transparencia."
                .to_string(),
        );
    } else {
        warnings.push(format!(
            "Slicing '{}' sugeriu {} frame(s) canonicamente reutilizaveis.",
            slicing_mode.label(),
            suggested_frames.len()
        ));
    }

    warnings
}

fn encode_preview_png(image: &RgbaImage) -> Result<String, String> {
    let mut bytes = Vec::new();
    {
        let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
        encoder
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|error| format!("Falha ao serializar preview PNG: {}", error))?;
    }
    Ok(BASE64.encode(bytes))
}

fn sanitize_sprite_name(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .replace("__", "_");

    if sanitized.is_empty() {
        "sprite".to_string()
    } else {
        sanitized
    }
}

fn build_unique_import_path(
    project_root: &Path,
    sprite_name: &str,
) -> Result<(PathBuf, String), String> {
    let sprites_dir = project_root.join("assets").join("sprites");
    fs::create_dir_all(&sprites_dir).map_err(|error| {
        format!(
            "Falha ao garantir a pasta canonica assets/sprites no projeto: {}",
            error
        )
    })?;

    for suffix in 0..256u32 {
        let filename = if suffix == 0 {
            format!("{}.png", sprite_name)
        } else {
            format!("{}-{}.png", sprite_name, suffix)
        };
        let absolute = sprites_dir.join(&filename);
        if !absolute.exists() {
            let relative = format!("assets/sprites/{}", filename);
            return Ok((absolute, relative));
        }
    }

    Err("Falha ao encontrar um nome livre para o asset canonico em assets/sprites.".to_string())
}

fn decode_preview_from_result(result: &ArtProcessResult) -> Result<RgbaImage, String> {
    let base64 = result
        .processed_base64
        .as_ref()
        .ok_or_else(|| "O preview processado nao foi gerado pelo backend.".to_string())?;
    let bytes = BASE64
        .decode(base64)
        .map_err(|error| format!("Falha ao decodificar preview base64: {}", error))?;
    image::load_from_memory_with_format(&bytes, ImageFormat::Png)
        .map_err(|error| format!("Falha ao reabrir preview PNG para importacao: {}", error))
        .map(|image| image.into_rgba8())
}

fn build_canonical_sprite_sheet(
    preview: &RgbaImage,
    frames: &[ArtSuggestedFrame],
    frame_width: u32,
    frame_height: u32,
) -> RgbaImage {
    if frames.is_empty() {
        return RgbaImage::new(frame_width.max(1), frame_height.max(1));
    }

    let columns = ((frames.len() as f32).sqrt().ceil() as u32).max(1);
    let rows = (frames.len() as u32).div_ceil(columns).max(1);
    let mut sheet = RgbaImage::from_pixel(
        columns * frame_width,
        rows * frame_height,
        Rgba([0, 0, 0, 0]),
    );

    for (frame_index, frame) in frames.iter().enumerate() {
        let destination_x = (frame_index as u32 % columns) * frame_width;
        let destination_y = (frame_index as u32 / columns) * frame_height;

        for offset_y in 0..frame.height.min(preview.height().saturating_sub(frame.y)) {
            for offset_x in 0..frame.width.min(preview.width().saturating_sub(frame.x)) {
                let source_pixel = preview.get_pixel(frame.x + offset_x, frame.y + offset_y);
                sheet.put_pixel(
                    destination_x + offset_x,
                    destination_y + offset_y,
                    *source_pixel,
                );
            }
        }
    }

    sheet
}

pub(crate) fn import_art_asset_internal(
    image_path: String,
    project_root: String,
    sprite_name: Option<String>,
    grid_width: Option<u32>,
    grid_height: Option<u32>,
    slicing_mode: Option<String>,
) -> Result<ArtImportResult, String> {
    let project_root = PathBuf::from(project_root);
    if !project_root.exists() || !project_root.is_dir() {
        return Err(
            "O diretorio do projeto informado nao existe ou nao e uma pasta valida.".to_string(),
        );
    }

    let result =
        process_art_image_with_options(image_path.clone(), grid_width, grid_height, slicing_mode)?;
    if !result.ok {
        return Err(result
            .error
            .clone()
            .unwrap_or_else(|| "Falha desconhecida ao processar asset.".to_string()));
    }

    let frame_width = result.suggested_frame_width.unwrap_or(32).max(8);
    let frame_height = result.suggested_frame_height.unwrap_or(32).max(8);
    let preview = decode_preview_from_result(&result)?;
    let frames = result.suggested_frames.clone();
    if frames.is_empty() {
        return Err(
            "Nenhum frame reutilizavel foi detectado. Ajuste o slicing antes de importar para o projeto."
                .to_string(),
        );
    }

    let source_stem = Path::new(&image_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("sprite");
    let sprite_name = sanitize_sprite_name(sprite_name.as_deref().unwrap_or(source_stem));
    let (absolute_path, relative_path) = build_unique_import_path(&project_root, &sprite_name)?;
    let sheet = build_canonical_sprite_sheet(&preview, &frames, frame_width, frame_height);

    image::save_buffer_with_format(
        &absolute_path,
        sheet.as_raw(),
        sheet.width(),
        sheet.height(),
        image::ColorType::Rgba8,
        ImageFormat::Png,
    )
    .map_err(|error| format!("Falha ao gravar asset canonico do ArtStudio: {}", error))?;

    Ok(ArtImportResult {
        ok: true,
        error: None,
        relative_path: Some(relative_path),
        absolute_path: Some(absolute_path.to_string_lossy().into_owned()),
        sprite_name: Some(sprite_name),
        frame_width: Some(frame_width),
        frame_height: Some(frame_height),
        frame_count: frames.len() as u32,
        generated_width: Some(sheet.width()),
        generated_height: Some(sheet.height()),
    })
}

fn process_art_image_with_options(
    image_path: String,
    grid_width: Option<u32>,
    grid_height: Option<u32>,
    slicing_mode: Option<String>,
) -> Result<ArtProcessResult, String> {
    let path = PathBuf::from(&image_path);
    if !path.exists() {
        return Err(format!("Arquivo nao encontrado: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!(
            "O caminho informado nao e um arquivo valido: {}",
            path.display()
        ));
    }

    let decoded = decode_source_image(&path)?;
    let transparency = detect_transparency(&decoded.image);
    let palette = build_palette(&decoded.image, &transparency);
    let palette_hex: Vec<String> = std::iter::once("transparent".to_string())
        .chain(palette.iter().map(|color| color.to_hex()))
        .collect();
    let preview = render_quantized_preview(&decoded.image, &transparency, &palette);
    let bounds = detect_content_bounds(&decoded.image, &transparency);
    let recommendations = recommend_sprite_dimensions(&bounds);
    let requested_mode = SlicingMode::parse(slicing_mode.as_deref());
    let (resolved_slicing_mode, suggested_frames, suggested_frame_width, suggested_frame_height) =
        select_suggested_frames(
            requested_mode,
            &decoded.image,
            &transparency,
            &recommendations,
            grid_width,
            grid_height,
        );
    let warnings = build_warnings(
        &decoded,
        &transparency,
        &bounds,
        palette_hex.len(),
        &recommendations,
        resolved_slicing_mode,
        &suggested_frames,
    );

    Ok(ArtProcessResult {
        ok: true,
        processed_base64: Some(encode_preview_png(&preview)?),
        error: None,
        format: Some(format_label(decoded.format).to_string()),
        source_width: Some(decoded.image.width()),
        source_height: Some(decoded.image.height()),
        processed_width: Some(preview.width()),
        processed_height: Some(preview.height()),
        frame_count: Some(decoded.frame_count as u32),
        background_mode: Some(transparency.mode.label().to_string()),
        transparent_pixels: Some(transparency.transparent_pixels as u32),
        palette: palette_hex.clone(),
        palette_size: palette_hex.len(),
        content_bounds: Some(bounds.clone()),
        suggested_frame_width: Some(suggested_frame_width),
        suggested_frame_height: Some(suggested_frame_height),
        recommended_output_width: Some(recommendations.recommended_output_width),
        recommended_output_height: Some(recommendations.recommended_output_height),
        recommended_scale_percent: Some(recommendations.recommended_scale_percent),
        meta_sprite_candidate: recommendations.meta_sprite_candidate,
        slicing_mode: Some(resolved_slicing_mode.label().to_string()),
        suggested_frames,
        warnings,
    })
}

#[cfg(test)]
fn process_art_image(image_path: String) -> Result<ArtProcessResult, String> {
    process_art_image_with_options(image_path, None, None, None)
}

#[tauri::command]
pub async fn art_process_palette(
    image_path: String,
    grid_width: Option<u32>,
    grid_height: Option<u32>,
    slicing_mode: Option<String>,
) -> Result<ArtProcessResult, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        process_art_image_with_options(image_path, grid_width, grid_height, slicing_mode)
    })
    .await
    {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) => Ok(ArtProcessResult::failure(error)),
        Err(error) => Err(format!("Falha ao processar imagem no backend: {}", error)),
    }
}

#[tauri::command]
pub async fn import_art_asset(
    image_path: String,
    project_root: String,
    sprite_name: Option<String>,
    grid_width: Option<u32>,
    grid_height: Option<u32>,
    slicing_mode: Option<String>,
) -> Result<ArtImportResult, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        import_art_asset_internal(
            image_path,
            project_root,
            sprite_name,
            grid_width,
            grid_height,
            slicing_mode,
        )
    })
    .await
    {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) => Ok(ArtImportResult::failure(error)),
        Err(error) => Err(format!("Falha ao importar asset do ArtStudio: {}", error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_temp_png(image: &RgbaImage, suffix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        path.push(format!(
            "rds-artstudio-{}-{}-{}.png",
            std::process::id(),
            suffix,
            nonce
        ));

        DynamicImage::ImageRgba8(image.clone())
            .save_with_format(&path, ImageFormat::Png)
            .expect("failed to write temp png");

        path
    }

    fn temp_project_root(suffix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        path.push(format!(
            "rds-artstudio-project-{}-{}-{}",
            std::process::id(),
            suffix,
            nonce
        ));
        fs::create_dir_all(&path).expect("failed to create temp project root");
        path
    }

    fn repo_data_file(name: &str) -> Option<PathBuf> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri should have repo root parent")
            .join("data")
            .join(name);
        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    fn require_repo_data(name: &str) -> Option<PathBuf> {
        let path = repo_data_file(name);
        if path.is_none() {
            eprintln!("Pulando fixture real ausente: {}", name);
        }
        path
    }

    fn assert_real_asset_profile(label: &str, result: &ArtProcessResult) {
        let bounds = result
            .content_bounds
            .as_ref()
            .expect("expected content bounds");
        println!(
            "[ArtStudio::AssetProfile] {} => format={} src={}x{} processed={}x{} frames={} bg={} transparent={} palette={} bounds={}x{} aligned={}x{} suggested={}x{} output={}x{} scale={} meta={} warnings={}",
            label,
            result.format.as_deref().unwrap_or("N/A"),
            result.source_width.unwrap_or_default(),
            result.source_height.unwrap_or_default(),
            result.processed_width.unwrap_or_default(),
            result.processed_height.unwrap_or_default(),
            result.frame_count.unwrap_or_default(),
            result.background_mode.as_deref().unwrap_or("N/A"),
            result.transparent_pixels.unwrap_or_default(),
            result.palette_size,
            bounds.width,
            bounds.height,
            bounds.aligned_width,
            bounds.aligned_height,
            result.suggested_frame_width.unwrap_or_default(),
            result.suggested_frame_height.unwrap_or_default(),
            result.recommended_output_width.unwrap_or_default(),
            result.recommended_output_height.unwrap_or_default(),
            result.recommended_scale_percent.unwrap_or_default(),
            result.meta_sprite_candidate,
            result.warnings.len()
        );
    }

    #[test]
    fn snap_to_md_level_maps_into_expected_buckets() {
        assert_eq!(snap_to_md_level(0), 0);
        assert_eq!(snap_to_md_level(255), 255);
        assert_eq!(snap_to_md_level(128), 146);
    }

    #[test]
    fn detects_alpha_transparency_before_corner_heuristic() {
        let image = ImageBuffer::from_fn(4, 4, |x, y| {
            if x == 0 && y == 0 {
                Rgba([255, 0, 0, 0])
            } else {
                Rgba([32, 64, 96, 255])
            }
        });

        let analysis = detect_transparency(&image);
        assert_eq!(analysis.mode, BackgroundMode::Alpha);
        assert!(analysis.transparent_pixels > 0);
    }

    #[test]
    fn detects_corner_background_when_no_alpha_exists() {
        let image = ImageBuffer::from_fn(12, 12, |x, y| {
            if (3..9).contains(&x) && (3..9).contains(&y) {
                Rgba([255, 200, 64, 255])
            } else {
                Rgba([4, 8, 12, 255])
            }
        });

        let analysis = detect_transparency(&image);
        assert_eq!(analysis.mode, BackgroundMode::Corner);
        assert!(analysis.transparent_pixels > 0);
    }

    #[test]
    fn process_art_image_reports_missing_file_cleanly() {
        let result = process_art_image("Z:/nao-existe/rds-missing.png".to_string());
        assert!(result.is_err());
        assert!(result
            .expect_err("missing file should fail")
            .contains("Arquivo nao encontrado"));
    }

    #[test]
    fn process_art_image_quantizes_palette_to_md_limit() {
        let image = ImageBuffer::from_fn(32, 32, |x, y| {
            let r = ((x * 7) % 255) as u8;
            let g = ((y * 13) % 255) as u8;
            let b = (((x + y) * 17) % 255) as u8;
            Rgba([r, g, b, 255])
        });
        let path = write_temp_png(&image, "palette-limit");

        let result = process_art_image(path.to_string_lossy().into_owned())
            .expect("synthetic image should process");
        fs::remove_file(path).ok();

        assert!(result.ok);
        assert!(result.palette_size <= 16);
        assert_eq!(
            result.palette.first().map(String::as_str),
            Some("transparent")
        );
    }

    #[test]
    fn grid_slicing_skips_fully_empty_cells_and_stays_aligned() {
        let image = ImageBuffer::from_fn(64, 32, |x, _y| {
            if x < 32 {
                Rgba([255, 255, 255, 255])
            } else {
                Rgba([0, 0, 0, 0])
            }
        });
        let path = write_temp_png(&image, "grid-slice");

        let result = process_art_image_with_options(
            path.to_string_lossy().into_owned(),
            Some(32),
            Some(32),
            Some("grid".to_string()),
        )
        .expect("grid slicing should process");
        fs::remove_file(path).ok();

        assert_eq!(result.slicing_mode.as_deref(), Some("grid"));
        assert_eq!(result.suggested_frames.len(), 1);
        let frame = &result.suggested_frames[0];
        assert_eq!(frame.x % 8, 0);
        assert_eq!(frame.y % 8, 0);
        assert_eq!(frame.width % 8, 0);
        assert_eq!(frame.height % 8, 0);
    }

    #[test]
    fn auto_islands_detects_multiple_components_and_normalizes_frame_size() {
        let image = ImageBuffer::from_fn(80, 40, |x, y| {
            if ((4..12).contains(&x) && (8..16).contains(&y))
                || ((40..52).contains(&x) && (8..24).contains(&y))
            {
                Rgba([255, 255, 255, 255])
            } else {
                Rgba([0, 0, 0, 0])
            }
        });
        let path = write_temp_png(&image, "auto-islands");

        let result = process_art_image_with_options(
            path.to_string_lossy().into_owned(),
            None,
            None,
            Some("auto_islands".to_string()),
        )
        .expect("auto islands should process");
        fs::remove_file(path).ok();

        assert_eq!(result.slicing_mode.as_deref(), Some("auto_islands"));
        assert_eq!(result.suggested_frames.len(), 2);
        assert!(result
            .suggested_frames
            .iter()
            .all(|frame| frame.width % 8 == 0 && frame.height % 8 == 0));
    }

    #[test]
    fn import_art_asset_internal_creates_canonical_sprite_sheet_inside_project() {
        let image = ImageBuffer::from_fn(96, 48, |x, y| {
            if (8..24).contains(&x) && (8..24).contains(&y) {
                Rgba([255, 255, 255, 255])
            } else if (40..56).contains(&x) && (8..24).contains(&y) {
                Rgba([255, 0, 0, 255])
            } else {
                Rgba([0, 0, 0, 0])
            }
        });
        let source_path = write_temp_png(&image, "import-source");
        let project_root = temp_project_root("import-target");

        let result = import_art_asset_internal(
            source_path.to_string_lossy().into_owned(),
            project_root.to_string_lossy().into_owned(),
            Some("hero_sheet".to_string()),
            Some(32),
            Some(32),
            Some("grid".to_string()),
        )
        .expect("canonical import should succeed");

        let absolute_path = PathBuf::from(
            result
                .absolute_path
                .clone()
                .expect("absolute path should be returned"),
        );
        assert!(absolute_path.exists());
        assert_eq!(
            result.relative_path.as_deref(),
            Some("assets/sprites/hero_sheet.png")
        );
        assert_eq!(result.frame_count, 2);

        fs::remove_file(source_path).ok();
        fs::remove_dir_all(project_root).ok();
    }

    #[test]
    fn blackheart_gif_profile_is_processed_with_frames_and_palette() {
        let Some(path) = require_repo_data("Blackheart_grande.gif") else {
            return;
        };
        let result = process_art_image(path.to_string_lossy().into_owned())
            .expect("blackheart gif should process");

        assert_real_asset_profile("Blackheart_grande.gif", &result);
        assert!(result.ok);
        assert_eq!(result.format.as_deref(), Some("GIF"));
        assert!(result.frame_count.unwrap_or_default() >= 1);
        assert!(result.transparent_pixels.unwrap_or_default() > 0);
        assert!(result.palette_size <= 16);
        assert!(result
            .processed_base64
            .as_ref()
            .is_some_and(|value| !value.is_empty()));
    }

    #[test]
    fn earthquake_large_recommends_downscale_and_meta_sprite_handling() {
        let Some(path) = require_repo_data("Earthquake_large.png") else {
            return;
        };
        let result = process_art_image(path.to_string_lossy().into_owned())
            .expect("earthquake large should process");

        assert_real_asset_profile("Earthquake_large.png", &result);
        assert!(result.ok);
        assert!(result.meta_sprite_candidate);
        assert!(result.recommended_scale_percent.unwrap_or(100) < 100);
        assert!(result.palette_size <= 16);
    }

    #[test]
    fn metalslug_backgrounds_reduce_palette_and_keep_bounds_aligned() {
        let Some(path) = require_repo_data("MetalSlug_Backgrounds.png") else {
            return;
        };
        let result = process_art_image(path.to_string_lossy().into_owned())
            .expect("metalslug background should process");

        let bounds = result
            .content_bounds
            .as_ref()
            .expect("content bounds should exist");
        assert_real_asset_profile("MetalSlug_Backgrounds.png", &result);
        assert!(result.ok);
        assert!(result.palette_size <= 16);
        assert_eq!(bounds.aligned_width % 8, 0);
        assert_eq!(bounds.aligned_height % 8, 0);
    }

    #[test]
    fn kenmasters_uses_corner_background_heuristic_for_transparency() {
        let Some(path) = require_repo_data("KenMasters_normal.png") else {
            return;
        };
        let result = process_art_image(path.to_string_lossy().into_owned())
            .expect("ken masters should process");

        assert_real_asset_profile("KenMasters_normal.png", &result);
        assert!(result.ok);
        assert_eq!(result.background_mode.as_deref(), Some("corner"));
        assert!(result.transparent_pixels.unwrap_or_default() > 0);
        assert!(result.palette_size <= 16);
    }

    #[test]
    fn megaman_small_snaps_to_supported_md_sprite_sizes() {
        let Some(path) = require_repo_data("MegaMan_pequeno.png") else {
            return;
        };
        let result = process_art_image(path.to_string_lossy().into_owned())
            .expect("megaman small should process");

        let width = result.suggested_frame_width.unwrap_or_default();
        let height = result.suggested_frame_height.unwrap_or_default();
        assert_real_asset_profile("MegaMan_pequeno.png", &result);
        assert!(result.ok);
        assert!([8, 16, 24, 32].contains(&width));
        assert!([8, 16, 24, 32].contains(&height));
        assert!(result.transparent_pixels.unwrap_or_default() > 0);
        assert!(result.suggested_frames.len() > 1);
        assert!(result.suggested_frames.iter().all(|frame| frame.x % 8 == 0
            && frame.y % 8 == 0
            && frame.width % 8 == 0
            && frame.height % 8 == 0));
    }
}
