use crate::core::diagnostics::{DiagnosticArea, DiagnosticSeverity};
use crate::core::project_capability::{
    capability_axis, capability_diagnostic, evidence_ref, CapabilityAxisReport,
};
use image::GenericImageView;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AssetStatus {
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DuplicateTileReport {
    pub total_tiles: usize,
    pub unique_tiles: usize,
    pub duplicate_count: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AssetQualityEntry {
    pub path: String,
    pub source_art: String,
    pub lineage: Vec<String>,
    pub palette: AssetStatus,
    pub palette_color_count: usize,
    pub index_zero_transparency: AssetStatus,
    pub tile_efficiency: AssetStatus,
    pub duplicate_tiles: DuplicateTileReport,
    pub res_compression: AssetStatus,
    pub source_to_rom_map: Vec<String>,
    pub warnings: Vec<String>,
    pub blockers: Vec<String>,
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AssetQualityReport {
    pub project_dir: String,
    pub axis: CapabilityAxisReport,
    pub assets: Vec<AssetQualityEntry>,
}

pub fn inspect_asset_quality(
    project_dir: &Path,
    asset_id_or_path: Option<&str>,
) -> Result<AssetQualityReport, String> {
    if !project_dir.exists() {
        return Err(format!(
            "O que quebrou: projeto nao encontrado para asset quality. Por que importa: Qualidade ROM precisa resolver assets dentro do projeto. Onde corrigir: '{}'. Proxima acao: abra um projeto valido.",
            project_dir.display()
        ));
    }
    let paths = match asset_id_or_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(asset) => vec![resolve_asset_path(project_dir, asset)],
        None => collect_project_image_assets(project_dir),
    };
    let mut assets = Vec::new();
    for path in paths {
        if path.exists() {
            assets.push(inspect_asset(project_dir, &path)?);
        }
    }
    let warnings = assets
        .iter()
        .flat_map(|asset| asset.warnings.iter().cloned())
        .collect::<Vec<_>>();
    let blocking_statuses = assets
        .iter()
        .flat_map(|asset| asset.blockers.iter().cloned())
        .collect::<Vec<_>>();
    let diagnostics = blocking_statuses
        .iter()
        .map(|status| {
            capability_diagnostic(
                DiagnosticArea::AssetQuality,
                DiagnosticSeverity::Error,
                "Asset possui bloqueio de Qualidade ROM.",
                status.clone(),
                "Abra ArtStudio > Qualidade ROM, corrija paleta/transparencia/tiles e reimporte o asset canonico.",
                true,
                Some(project_dir.to_string_lossy().to_string()),
            )
        })
        .collect::<Vec<_>>();
    let axis = capability_axis(
        if assets.is_empty() {
            "not_applicable"
        } else if blocking_statuses.is_empty() {
            "partial"
        } else {
            "blocked"
        },
        assets
            .iter()
            .map(|asset| {
                evidence_ref(
                    "asset_quality",
                    &asset.path,
                    "Asset inspecionado para Qualidade ROM",
                )
            })
            .collect(),
        blocking_statuses,
        warnings,
        if assets.is_empty() {
            vec!["Adicionar assets visuais em assets/sprites ou assets/tilesets.".to_string()]
        } else {
            vec!["Corrigir bloqueios antes de usar o asset como evidencia de ROM.".to_string()]
        },
        Some("assets/".to_string()),
        Some("ArtStudio".to_string()),
        diagnostics,
    );
    Ok(AssetQualityReport {
        project_dir: project_dir.to_string_lossy().to_string(),
        axis,
        assets,
    })
}

fn inspect_asset(project_dir: &Path, path: &Path) -> Result<AssetQualityEntry, String> {
    let image = image::open(path).map_err(|error| {
        format!(
            "O que quebrou: falha ao decodificar asset visual. Por que importa: Qualidade ROM precisa medir paleta/tiles reais. Onde corrigir: '{}'. Proxima acao: reexporte PNG/BMP/JPG suportado pelo ArtStudio. Detalhe: {}",
            path.display(),
            error
        )
    })?;
    let rgba = image.to_rgba8();
    let (width, height) = image.dimensions();
    let mut unique = BTreeSet::new();
    let mut has_transparency = false;
    for pixel in rgba.pixels() {
        unique.insert(pixel.0);
        if pixel.0[3] == 0 {
            has_transparency = true;
        }
    }
    let first_alpha = rgba.get_pixel(0, 0).0[3];
    let palette_status = if unique.len() > 16 { "overflow" } else { "ok" };
    let transparency_status = if has_transparency {
        if first_alpha == 0 {
            "ok"
        } else {
            "incorrect"
        }
    } else {
        "not_applicable"
    };
    let duplicate_tiles = duplicate_tiles(&rgba, width, height);
    let total_tiles = duplicate_tiles.total_tiles.max(1);
    let efficiency = duplicate_tiles.unique_tiles as f64 / total_tiles as f64;
    let source_to_rom_map = find_source_to_rom_map(project_dir, path);
    let mut warnings = Vec::new();
    let mut blockers = Vec::new();
    if palette_status == "overflow" {
        blockers.push(format!(
            "palette_overflow: {} usa {} cores unicas (>16)",
            relative_display(project_dir, path),
            unique.len()
        ));
    }
    if transparency_status == "incorrect" {
        blockers.push(format!(
            "index_zero_incorrect: {} contem transparencia mas o pixel/indice inicial nao e transparente",
            relative_display(project_dir, path)
        ));
    }
    if duplicate_tiles.duplicate_count > 0 {
        warnings.push(format!(
            "{} possui {} tile(s) duplicados que podem ser deduplicados.",
            relative_display(project_dir, path),
            duplicate_tiles.duplicate_count
        ));
    }
    Ok(AssetQualityEntry {
        path: relative_display(project_dir, path),
        source_art: path.to_string_lossy().to_string(),
        lineage: vec!["source_art".to_string(), "project_asset".to_string()],
        palette: AssetStatus {
            status: palette_status.to_string(),
            detail: format!("{} cores unicas", unique.len()),
        },
        palette_color_count: unique.len(),
        index_zero_transparency: AssetStatus {
            status: transparency_status.to_string(),
            detail: if has_transparency {
                "Transparencia detectada no RGBA.".to_string()
            } else {
                "Sem alfa transparente detectado.".to_string()
            },
        },
        tile_efficiency: AssetStatus {
            status: if efficiency < 0.75 { "warning" } else { "ok" }.to_string(),
            detail: format!(
                "{} unico(s) / {} total ({:.0}%)",
                duplicate_tiles.unique_tiles,
                duplicate_tiles.total_tiles,
                efficiency * 100.0
            ),
        },
        duplicate_tiles,
        res_compression: AssetStatus {
            status: if source_to_rom_map.is_empty() {
                "not_mapped"
            } else {
                "mapped"
            }
            .to_string(),
            detail: if source_to_rom_map.is_empty() {
                ".res nao referencia este asset.".to_string()
            } else {
                "Asset referenciado por .res; compressao depende do resource kind.".to_string()
            },
        },
        source_to_rom_map,
        warnings,
        blockers,
        next_actions: vec![
            "Reduzir paleta para limite do target e preservar transparencia no indice 0."
                .to_string(),
            "Deduplicar tiles ou confirmar que duplicatas sao intencionais.".to_string(),
        ],
    })
}

fn duplicate_tiles(
    image: &image::ImageBuffer<image::Rgba<u8>, Vec<u8>>,
    width: u32,
    height: u32,
) -> DuplicateTileReport {
    let cols = width / 8;
    let rows = height / 8;
    let mut counts = BTreeMap::<Vec<u8>, usize>::new();
    for row in 0..rows {
        for col in 0..cols {
            let mut tile = Vec::with_capacity(8 * 8 * 4);
            for y in 0..8 {
                for x in 0..8 {
                    tile.extend_from_slice(&image.get_pixel(col * 8 + x, row * 8 + y).0);
                }
            }
            *counts.entry(tile).or_insert(0) += 1;
        }
    }
    let total_tiles = (cols * rows) as usize;
    let unique_tiles = counts.len();
    let duplicate_count = counts.values().map(|count| count.saturating_sub(1)).sum();
    DuplicateTileReport {
        total_tiles,
        unique_tiles,
        duplicate_count,
    }
}

fn resolve_asset_path(project_dir: &Path, asset: &str) -> PathBuf {
    let path = PathBuf::from(asset);
    if path.is_absolute() {
        path
    } else {
        project_dir.join(path)
    }
}

fn collect_project_image_assets(project_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for rel in ["assets/sprites", "assets/tilesets", "assets/gfx"] {
        collect_images(&project_dir.join(rel), &mut out);
    }
    out
}

fn collect_images(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_images(&path, out);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(
            ext.as_str(),
            "png" | "bmp" | "jpg" | "jpeg" | "gif" | "webp" | "ppm"
        ) {
            out.push(path);
        }
    }
}

fn find_source_to_rom_map(project_dir: &Path, path: &Path) -> Vec<String> {
    let relative = relative_display(project_dir, path).replace('\\', "/");
    let basename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let mut res_files = Vec::new();
    collect_res_files(project_dir, &mut res_files);
    res_files
        .into_iter()
        .filter_map(|res| {
            let content = fs::read_to_string(&res).ok()?;
            if content.contains(&relative) || (!basename.is_empty() && content.contains(basename)) {
                Some(relative_display(project_dir, &res))
            } else {
                None
            }
        })
        .collect()
}

fn collect_res_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| matches!(name, "target" | "node_modules" | "build"))
            {
                continue;
            }
            collect_res_files(&path, out);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("res") {
            out.push(path);
        }
    }
}

fn relative_display(project_dir: &Path, path: &Path) -> String {
    path.strip_prefix(project_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rds-asset-quality-{name}-{stamp}"));
        fs::create_dir_all(dir.join("assets").join("sprites")).expect("sprites dir");
        dir
    }

    #[test]
    fn asset_quality_flags_palette_overflow_bad_transparency_and_duplicate_tiles() {
        let project = temp_project("sprite");
        let image_path = project.join("assets").join("sprites").join("sheet.png");
        let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(24, 8);
        for y in 0..8 {
            for x in 0..8 {
                image.put_pixel(x, y, Rgba([255, 0, 255, 255]));
                image.put_pixel(x + 8, y, Rgba([255, 0, 255, 255]));
            }
        }
        for y in 0..8 {
            for x in 16..24 {
                let n = ((y * 8) + (x - 16)) as u8;
                image.put_pixel(x, y, Rgba([n.saturating_mul(3), 10 + n, 20 + n, 255]));
            }
        }
        image.put_pixel(17, 0, Rgba([0, 0, 0, 0]));
        image.save(&image_path).expect("image");

        let report =
            inspect_asset_quality(&project, Some("assets/sprites/sheet.png")).expect("quality");

        assert_eq!(report.assets.len(), 1);
        let asset = &report.assets[0];
        assert_eq!(asset.palette.status, "overflow");
        assert_eq!(asset.index_zero_transparency.status, "incorrect");
        assert!(asset.duplicate_tiles.duplicate_count > 0);
        assert!(report
            .axis
            .blocking_statuses
            .iter()
            .any(|status| status.contains("palette")));
    }

    #[test]
    fn asset_quality_reports_source_to_rom_map_when_res_references_asset() {
        let project = temp_project("map");
        fs::create_dir_all(project.join("res")).expect("res dir");
        fs::write(
            project.join("res").join("resources.res"),
            "SPRITE hero assets/sprites/hero.png 4 4 NONE",
        )
        .expect("res");
        let image_path = project.join("assets").join("sprites").join("hero.png");
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(8, 8, Rgba([0, 0, 0, 0]))
            .save(&image_path)
            .expect("image");

        let report =
            inspect_asset_quality(&project, Some("assets/sprites/hero.png")).expect("quality");

        assert!(report.assets[0]
            .source_to_rom_map
            .iter()
            .any(|entry| entry.contains("resources.res")));
    }
}
