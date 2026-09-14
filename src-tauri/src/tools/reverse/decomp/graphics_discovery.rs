// REX-04 fatia 2 — descoberta e organização de candidatos gráficos (Mega
// Drive): tiles 4bpp NÃO comprimidos e paletas, com offset, tamanho, método,
// evidência e confiança.
//
// Contrato da fatia (critérios do revisor):
// - CANDIDATO HEURÍSTICO ≠ RECURSO CONFIRMADO: todo candidato nasce com
//   status `candidate` e confiança < 1.0; NÃO existe caminho para
//   "confirmado" nesta fatia;
// - BYTES CONTINUAM UNKNOWN: candidatos vivem em artefato PRÓPRIO
//   (`rex-graphic-discovery/v1`) vinculado ao SHA da ROM e ao SHA do
//   catálogo — nunca alteram as regiões/estados do catálogo da fatia 1;
// - PRÉVIAS E METADADOS: PNGs gerados com o crate `image` (já dependência),
//   escritos com o mesmo padrão imutável endereçado por hash, referenciados
//   por `ArtifactRef` (label/path/sha256);
// - LIMITAÇÕES DECLARADAS: compressão, dados dinâmicos, streaming e
//   montagem de sprites permanecem desconhecidos — nada aqui "recupera"
//   sprites montados em runtime.
#![allow(dead_code)]

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::extract::{
    canonical_dir_under, reject_if_symlink, sha256_path_component, write_file_immutable,
    ExtractionCatalog,
};
use super::rom_library::{
    now_unix, record_scenario_run, sha256_hex, ArtifactRef, ScenarioRunRecord,
};

pub const GRAPHIC_DISCOVERY_SCHEMA_V1: &str = "rex-graphic-discovery/v1";
pub const GRAPHIC_DISCOVERY_SCENARIO_ID: &str = "rex04-md-graphic-discovery-v1";

pub const STATUS_CANDIDATE: &str = "candidate";
pub const KIND_TILE_BLOCK: &str = "tile4bpp_block";
pub const KIND_PALETTE16: &str = "palette16";
pub const KIND_PALETTE64: &str = "palette64";

/// Um tile tem 8x8 pixels 4bpp planares: 8 linhas × 4 bytes (1 por plano).
pub const TILE_BYTES: usize = 32;
/// Passo de varredura: dados de recursos MD são word-aligned (2 bytes).
const SCAN_STEP: u64 = 2;
/// Bloco mínimo de tiles para virar candidato (4 tiles = 128 bytes): menos
/// que isso é ruído mesmo para heurística.
const MIN_TILES_PER_BLOCK: u64 = 4;
/// Score mínimo por tile para pertencer a um bloco.
const MIN_TILE_SCORE: f32 = 0.5;
/// Teto de confiança: NUNCA 1.0 — confirmado não é alcançável nesta fatia.
const MAX_CONFIDENCE: f32 = 0.95;

/// Candidato heurístico: hipótese de recurso gráfico, com evidência
/// reprocessável. Nunca altera o catálogo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphicCandidate {
    pub offset: u64,
    pub size: u64,
    /// `tile4bpp_block`, `palette16`, `palette64`.
    pub kind: String,
    /// Sempre `candidate` nesta fatia — separação explícita de "confirmado".
    pub status: String,
    pub method: String,
    /// 0.0..0.95 — heurístico, nunca confirmado.
    pub confidence: f32,
    pub evidence: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub previews: Vec<ArtifactRef>,
}

/// Relatório de descoberta: vinculado ao SHA da ROM (original e normalizado)
/// e ao SHA do ARTEFATO do catálogo sobre o qual foi construído.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphicDiscovery {
    pub schema_version: String,
    pub original_sha256: String,
    pub normalized_sha256: String,
    pub catalog_sha256: String,
    /// Política explícita: candidatos nunca alteram as regiões unknown do
    /// catálogo — bytes "interpretáveis como pixels" continuam unknown.
    pub unknown_policy: String,
    pub candidates: Vec<GraphicCandidate>,
}

/// Score de um tile 4bpp (32 bytes): fração de linhas "graficamente
/// plausíveis" — vazias (transparente), 1bpp-like (planos 2 e 3 zerados,
/// típico de fonte/bitmaps) ou repetidas (preenchimento flat). Público para
/// as provas de confronto usarem o MESMO critério do detector.
pub fn graphic_score_tile(tile: &[u8]) -> f32 {
    if tile.len() < TILE_BYTES {
        return 0.0;
    }
    let constant = tile[..TILE_BYTES].iter().all(|byte| *byte == tile[0]);
    if constant {
        return 0.0; // padding (0x00/0xFF repetido) não é gráfico
    }
    let mut good = 0u32;
    let mut previous: Option<[u8; 4]> = None;
    for row in 0..8 {
        let bytes = [
            tile[row * 4],
            tile[row * 4 + 1],
            tile[row * 4 + 2],
            tile[row * 4 + 3],
        ];
        let empty = bytes == [0, 0, 0, 0];
        let onebpp = bytes[2] == 0 && bytes[3] == 0;
        let flat = previous == Some(bytes);
        if empty || onebpp || flat {
            good += 1;
        }
        previous = Some(bytes);
    }
    good as f32 / 8.0
}

fn plausible_tile(data: &[u8], offset: u64) -> bool {
    let start = offset as usize;
    if start + TILE_BYTES > data.len() {
        return false;
    }
    graphic_score_tile(&data[start..start + TILE_BYTES]) >= MIN_TILE_SCORE
}

/// Agrega blocos maximais de tiles plausíveis contíguos (stride de 32 bytes
/// dentro do bloco) na faixa [start, end).
///
/// SNAP DE GRADE: uma janela desalinhada (junk + começo de um tile real)
/// pode pontuar acima do piso e sequestrar o início do bloco. Para cada
/// semente, o início do bloco é escolhido entre os inícios possíveis num
/// raio de ±30 bytes (passo 2) pelo MAIOR score médio (desempate:
/// comprimento) — o grid verdadeiro do recurso vence porque todos os seus
/// tiles pontuam alto. O raio precisa alcançar TAMBÉM À FRENTE: a semente
/// desalinhada pode estar até 31 bytes antes do grid real.
fn scan_tile_blocks(data: &[u8], start: u64, end: u64) -> Vec<GraphicCandidate> {
    let mut candidates = Vec::new();
    let mut offset = start;
    while offset + TILE_BYTES as u64 <= end {
        if !plausible_tile(data, offset) {
            offset += SCAN_STEP;
            continue;
        }
        let mut best: Option<(f32, u64, u64)> = None; // (avg_score, block_end, block_start)
        let snap_lo = start.max(offset.saturating_sub(30));
        let snap_hi = (offset + 30).min(end.saturating_sub(TILE_BYTES as u64));
        let mut block_start = snap_lo + (offset - snap_lo) % SCAN_STEP;
        while block_start <= snap_hi {
            let mut block_end = block_start + TILE_BYTES as u64;
            while block_end + TILE_BYTES as u64 <= end && plausible_tile(data, block_end) {
                block_end += TILE_BYTES as u64;
            }
            let tiles = (block_end - block_start) / TILE_BYTES as u64;
            if tiles >= 1 {
                let start_index = block_start as usize;
                let avg = (0..tiles)
                    .map(|t| {
                        graphic_score_tile(
                            &data[start_index + t as usize * TILE_BYTES
                                ..start_index + t as usize * TILE_BYTES + TILE_BYTES],
                        )
                    })
                    .sum::<f32>()
                    / tiles as f32;
                let better = match best {
                    None => true,
                    Some((best_avg, _, best_size)) => {
                        avg > best_avg || (avg == best_avg && block_end - block_start > best_size)
                    }
                };
                if better {
                    best = Some((avg, block_end, block_start));
                }
            }
            block_start += SCAN_STEP;
        }
        let Some((_, block_end, block_start)) = best else {
            offset += SCAN_STEP;
            continue;
        };
        let tiles = (block_end - block_start) / TILE_BYTES as u64;
        if tiles >= MIN_TILES_PER_BLOCK {
            candidates.push(build_tile_candidate(data, block_start, block_end, tiles));
        }
        offset = block_end;
    }
    candidates
}

fn build_tile_candidate(data: &[u8], offset: u64, block_end: u64, tiles: u64) -> GraphicCandidate {
    let start = offset as usize;
    let mut empty_rows = 0u64;
    let mut onebpp_rows = 0u64;
    let mut score_sum = 0.0f32;
    let mut occurrences: std::collections::HashMap<u64, u32> = std::collections::HashMap::new();
    let mut duplicate_tiles = 0u64;

    for t in 0..tiles {
        let base = start + (t as usize) * TILE_BYTES;
        let tile = &data[base..base + TILE_BYTES];
        score_sum += graphic_score_tile(tile);
        for row in 0..8 {
            let row_bytes = &tile[row * 4..row * 4 + 4];
            if row_bytes == [0, 0, 0, 0] {
                empty_rows += 1;
            } else if row_bytes[2] == 0 && row_bytes[3] == 0 {
                onebpp_rows += 1;
            }
        }
        *occurrences.entry(fnv1a64(tile)).or_insert(0) += 1;
    }
    for count in occurrences.values() {
        if *count > 1 {
            duplicate_tiles += u64::from(*count);
        }
    }
    let avg_score = score_sum / tiles.max(1) as f32;
    let total_rows = tiles * 8;
    let confidence = (0.2
        + 0.3 * avg_score
        + 0.25 * (duplicate_tiles.min(8) as f32 / 8.0)
        + 0.1 * (tiles.min(32) as f32 / 32.0))
        .min(MAX_CONFIDENCE);

    GraphicCandidate {
        offset,
        size: block_end - offset,
        kind: KIND_TILE_BLOCK.into(),
        status: STATUS_CANDIDATE.into(),
        method: "tile_plausibility_run_v1".into(),
        confidence,
        evidence: serde_json::json!({
            "tiles": tiles,
            "duplicate_tiles": duplicate_tiles,
            "distinct_tiles": occurrences.len(),
            "empty_rows_pct": (empty_rows as f64 / total_rows as f64 * 100.0),
            "onebpp_rows_pct": (onebpp_rows as f64 / total_rows as f64 * 100.0),
            "avg_tile_score": avg_score,
        }),
        previews: Vec::new(),
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn palette_word(data: &[u8], offset: u64) -> Option<u16> {
    let start = offset as usize;
    if start + 2 > data.len() {
        return None;
    }
    Some(u16::from_be_bytes([data[start], data[start + 1]]))
}

/// Varre pares de bytes e agrega runs maximais de words no formato de cor MD
/// (bits 15..9 zerados). Runs de 16 words viram `palette16`; de 64+ viram
/// `palette64` (um único candidato maximal — sem aninhamento).
fn scan_palettes(data: &[u8], start: u64, end: u64) -> Vec<GraphicCandidate> {
    let mut candidates = Vec::new();
    let mut offset = start;
    while offset + 2 <= end {
        let Some(word) = palette_word(data, offset) else {
            break;
        };
        if word & 0xFE00 != 0 {
            offset += SCAN_STEP;
            continue;
        }
        let mut run = 1u64;
        while offset + (run + 1) * 2 <= end {
            let Some(word) = palette_word(data, offset + run * 2) else {
                break;
            };
            if word & 0xFE00 != 0 {
                break;
            }
            run += 1;
        }
        if run >= 16 {
            let mut distinct: std::collections::HashSet<u16> = std::collections::HashSet::new();
            for w in 0..run {
                distinct.insert(palette_word(data, offset + w * 2).unwrap_or(0xFFFF));
            }
            let first_zero = palette_word(data, offset) == Some(0);
            let confidence = (0.45
                + u32::from(first_zero) as f32 * 0.25
                + f32::from(distinct.len() >= 4) * 0.15
                + f32::from(run >= 32) * 0.10)
                .min(MAX_CONFIDENCE);
            let kind = if run >= 64 {
                KIND_PALETTE64
            } else {
                KIND_PALETTE16
            };
            candidates.push(GraphicCandidate {
                offset,
                size: run * 2,
                kind: kind.into(),
                status: STATUS_CANDIDATE.into(),
                method: "palette_format_run_v1".into(),
                confidence,
                evidence: serde_json::json!({
                    "words": run,
                    "distinct_words": distinct.len(),
                    "first_word_zero": first_zero,
                    "high_bits_zero_pct": 100.0,
                }),
                previews: Vec::new(),
            });
            offset += run * 2;
            continue;
        }
        offset += SCAN_STEP;
    }
    candidates
}

/// Constrói a descoberta a partir do catálogo da fatia 1: varre SOMENTE as
/// regiões `unknown` do catálogo e valida o vínculo por conteúdo
/// (bytes ↔ catálogo) e o formato do SHA do artefato do catálogo.
pub fn discover_graphic_candidates(
    catalog: &ExtractionCatalog,
    normalized: &[u8],
    catalog_sha256: &str,
) -> Result<GraphicDiscovery, String> {
    let rom_sha = sha256_hex(normalized);
    if rom_sha != catalog.normalized_sha256 {
        return Err(format!(
            "bytes normalizados não correspondem ao catálogo: esperado {}, obtido {}",
            catalog.normalized_sha256, rom_sha
        ));
    }
    sha256_path_component(catalog_sha256)?;

    let mut candidates = Vec::new();
    for region in &catalog.regions {
        if region.status != super::extract::STATUS_UNKNOWN {
            continue; // somente o corpo desconhecido é varrido
        }
        let start = region.offset;
        let end = region.offset + region.size;
        candidates.extend(scan_palettes(normalized, start, end));
        candidates.extend(scan_tile_blocks(normalized, start, end));
    }
    candidates.sort_by_key(|candidate| (candidate.offset, candidate.kind.clone()));

    Ok(GraphicDiscovery {
        schema_version: GRAPHIC_DISCOVERY_SCHEMA_V1.into(),
        original_sha256: catalog.original_sha256.clone(),
        normalized_sha256: catalog.normalized_sha256.clone(),
        catalog_sha256: catalog_sha256.to_string(),
        unknown_policy: "candidatos nunca alteram as regiões unknown do catálogo; \
                         interpretação possível como pixels não vira identificação"
            .into(),
        candidates,
    })
}

/// Escreve bytes imutáveis endereçados por hash como `{prefixo}-{sha}.png`
/// sob `dir`; reutiliza (idempotente) arquivo regular idêntico; symlinks são
/// rejeitados.
fn write_immutable_artifact(dir: &Path, prefix: &str, bytes: &[u8]) -> ArtifactRef {
    let sha = sha256_hex(bytes);
    let path = dir.join(format!("{prefix}-{sha}.png"));
    let write_result =
        reject_if_symlink(&path).and_then(|()| write_file_immutable(&path, bytes, &sha));
    write_result.unwrap_or_else(|error| panic!("falha ao escrever artefato imutável: {error}"));
    ArtifactRef {
        label: prefix.to_string(),
        path: path.display().to_string(),
        sha256: sha,
    }
}

/// Exporta prévias PNG para os candidatos (limite: 16 de cada tipo), com o
/// mesmo padrão imutável endereçado por hash; anexa os `ArtifactRef` ao
/// candidato correspondente. Retorna o número de prévias escritas.
pub fn export_candidate_previews(
    work_dir: &Path,
    discovery: &mut GraphicDiscovery,
    normalized: &[u8],
) -> Result<usize, String> {
    let previews_dir = canonical_dir_under(
        work_dir,
        &["extract", &discovery.normalized_sha256, "previews"],
    )?;
    let mut written = 0usize;
    let mut tile_blocks = 0usize;
    let mut palettes = 0usize;
    for candidate in &mut discovery.candidates {
        match candidate.kind.as_str() {
            KIND_TILE_BLOCK => {
                tile_blocks += 1;
                if tile_blocks > 16 {
                    continue;
                }
                let png = render_tile_block_png(normalized, candidate)?;
                let artifact = write_immutable_artifact(&previews_dir, "tiles", &png);
                candidate.previews.push(artifact);
                written += 1;
            }
            KIND_PALETTE16 | KIND_PALETTE64 => {
                palettes += 1;
                if palettes > 16 {
                    continue;
                }
                let png = render_palette_png(normalized, candidate)?;
                let artifact = write_immutable_artifact(&previews_dir, "palette", &png);
                candidate.previews.push(artifact);
                written += 1;
            }
            _ => {}
        }
    }
    Ok(written)
}

/// Renderiza os primeiros tiles do bloco como uma faixa PNG em tons de cinza
/// fixos (16 níveis — a paleta da ROM é candidato separado; os tons são
/// apenas apresentacionais).
fn render_tile_block_png(
    normalized: &[u8],
    candidate: &GraphicCandidate,
) -> Result<Vec<u8>, String> {
    use image::{ImageBuffer, Rgba, RgbaImage};
    const COLS: usize = 16;
    const SCALE: usize = 2;
    let tiles = (candidate.size as usize / TILE_BYTES).min(COLS * 2);
    let rows = tiles.div_ceil(COLS);
    let width = (COLS * 8 * SCALE) as u32;
    let height = (rows * 8 * SCALE) as u32;
    let mut canvas: ImageBuffer<Rgba<u8>, Vec<u8>> = RgbaImage::new(width, height);
    for tile_index in 0..tiles {
        let base = candidate.offset as usize + tile_index * TILE_BYTES;
        let tile = &normalized[base..base + TILE_BYTES];
        let col = tile_index % COLS;
        let row = tile_index / COLS;
        for pixel_y in 0..8u32 {
            for pixel_x in 0..8u32 {
                let shift = 7 - pixel_x;
                let planes = [
                    tile[(pixel_y * 4) as usize],
                    tile[(pixel_y * 4 + 1) as usize],
                    tile[(pixel_y * 4 + 2) as usize],
                    tile[(pixel_y * 4 + 3) as usize],
                ];
                let value = ((planes[0] >> shift) & 1)
                    | (((planes[1] >> shift) & 1) << 1)
                    | (((planes[2] >> shift) & 1) << 2)
                    | (((planes[3] >> shift) & 1) << 3);
                let shade = (u16::from(value) * 17) as u8;
                for scale_y in 0..SCALE as u32 {
                    for scale_x in 0..SCALE as u32 {
                        let px = ((col as u32 * 8 + pixel_x) * SCALE as u32) + scale_x;
                        let py = ((row as u32 * 8 + pixel_y) * SCALE as u32) + scale_y;
                        canvas.put_pixel(px, py, Rgba([shade, shade, shade, 255]));
                    }
                }
            }
        }
    }
    encode_rgba_png(&canvas, width, height)
}

/// Renderiza as cores da paleta como swatches (3 bits/canal escalados).
fn render_palette_png(normalized: &[u8], candidate: &GraphicCandidate) -> Result<Vec<u8>, String> {
    use image::{ImageBuffer, Rgba, RgbaImage};
    const CELL: u32 = 16;
    let words = (candidate.size as usize / 2).min(64);
    let width = words as u32 * CELL;
    let height = CELL;
    let mut canvas: ImageBuffer<Rgba<u8>, Vec<u8>> = RgbaImage::new(width, height);
    for index in 0..words {
        let base = candidate.offset as usize + index * 2;
        let word = u16::from_be_bytes([normalized[base], normalized[base + 1]]);
        let red = (word & 0x7) as u8 * 36;
        let green = ((word >> 3) & 0x7) as u8 * 36;
        let blue = ((word >> 6) & 0x7) as u8 * 36;
        for y in 0..CELL {
            for x in 0..CELL {
                canvas.put_pixel(index as u32 * CELL + x, y, Rgba([red, green, blue, 255]));
            }
        }
    }
    encode_rgba_png(&canvas, width, height)
}

/// Codifica PNG com o mesmo padrão do photo2sgdk (PngEncoder explícito,
/// buffer em memória — sem dependência nova).
fn encode_rgba_png(
    canvas: &image::ImageBuffer<image::Rgba<u8>, Vec<u8>>,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};
    let mut output = Vec::new();
    let encoder = PngEncoder::new(&mut output);
    encoder
        .write_image(canvas.as_raw(), width, height, ExtendedColorType::Rgba8)
        .map_err(|error| format!("falha ao codificar prévia PNG: {error}"))?;
    Ok(output)
}

/// Registra o run de descoberta no ledger (append-only) com o artefato
/// imutável `discovery-<sha>.json` vinculado à ROM e ao catálogo.
pub fn record_discovery_run(
    work_dir: &Path,
    discovery: &GraphicDiscovery,
) -> Result<(String, ArtifactRef), String> {
    let dir = canonical_dir_under(work_dir, &["extract", &discovery.normalized_sha256])?;
    let discovery_json = serde_json::to_vec_pretty(discovery).map_err(|error| error.to_string())?;
    let discovery_sha = sha256_hex(&discovery_json);
    let path = dir.join(format!("discovery-{discovery_sha}.json"));
    write_file_immutable(&path, &discovery_json, &discovery_sha)?;

    let artifact = ArtifactRef {
        label: "graphic-discovery".into(),
        path: path.display().to_string(),
        sha256: discovery_sha,
    };
    let mut artifacts = vec![artifact.clone()];
    for candidate in &discovery.candidates {
        artifacts.extend(candidate.previews.iter().cloned());
    }
    let mut by_kind = std::collections::BTreeMap::new();
    for candidate in &discovery.candidates {
        *by_kind.entry(candidate.kind.as_str()).or_insert(0u64) += 1;
    }
    let seq = EXTRACTION_RUN_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let record = ScenarioRunRecord {
        run_id: format!("rex04-md-gfx-{}-{seq:04x}", now_unix()),
        scenario_id: GRAPHIC_DISCOVERY_SCENARIO_ID.into(),
        kind: "graphic_discovery".into(),
        reference_sha256: discovery.original_sha256.clone(),
        candidate_sha256: Some(discovery.normalized_sha256.clone()),
        input_script_sha256: None,
        core_label: String::new(),
        core_sha256: None,
        frames: 0,
        verdict: "discovered".into(),
        oracle_results: serde_json::json!({
            "catalog_sha256": discovery.catalog_sha256,
            "candidates_total": discovery.candidates.len(),
            "by_kind": by_kind,
            "unknown_policy": discovery.unknown_policy,
        }),
        gaps: vec![
            "candidatos heurísticos — nenhum recurso confirmado nesta fatia".into(),
            "compressão/dados dinâmicos/streaming/montagem de sprites permanecem unknown".into(),
        ],
        artifacts,
        executed_at_unix: now_unix(),
        previous_run_id: None,
        notes: String::new(),
    };
    let run_id = record_scenario_run(work_dir, record)?;
    Ok((run_id, artifact))
}

/// Sequenciador de run_id (resolução de segundos do relógio colidiria).
static EXTRACTION_RUN_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::reverse::loader::rex_identify_bytes;
    use std::fs;
    use std::path::PathBuf;

    /// LCG determinístico (junk reprodutível para fixtures e negativos).
    struct Lcg(u64);
    impl Lcg {
        fn next_byte(&mut self) -> u8 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (self.0 >> 33) as u8
        }
        fn fill(&mut self, slice: &mut [u8]) {
            for byte in slice.iter_mut() {
                *byte = self.next_byte();
            }
        }
    }

    fn fixture_rom(len: usize) -> Vec<u8> {
        let mut rom = vec![0u8; len];
        rom[0x100..0x100 + "SEGA GENESIS".len()].copy_from_slice(b"SEGA GENESIS");
        rom[0x1A4..0x1A8].copy_from_slice(&((len as u32) - 1).to_be_bytes());
        let mut junk = Lcg(0x1234_5678_9abc_def0);
        junk.fill(&mut rom[0x200..]);
        rom
    }

    /// Tile "fonte-like": planos 2 e 3 zerados, linhas variadas.
    fn fontlike_tile(seed: u8) -> [u8; 32] {
        let mut tile = [0u8; 32];
        for row in 0u8..8 {
            tile[(row * 4) as usize] = seed.wrapping_add(row * 7);
            tile[(row * 4 + 1) as usize] = seed.wrapping_mul(3).wrapping_add(row);
        }
        tile
    }

    fn catalog_and_sha(rom: &[u8]) -> (ExtractionCatalog, String) {
        let identity = rex_identify_bytes(rom).expect("identidade");
        let catalog =
            crate::tools::reverse::decomp::extract::build_md_extraction_catalog(&identity, rom)
                .expect("catálogo");
        let catalog_json =
            serde_json::to_vec_pretty(&catalog).expect("serialização determinística");
        (catalog, sha256_hex(&catalog_json))
    }

    #[test]
    fn fixture_tile_block_at_known_offset_is_candidate() {
        let mut rom = fixture_rom(0x8000);
        // 8 tiles font-like em 0x4000, sendo 4 idênticos (repetição real).
        let tile = fontlike_tile(0x11);
        for t in 0usize..8 {
            let source: &[u8; 32] = if t % 2 == 0 {
                &tile
            } else {
                &fontlike_tile(0x20 + t as u8)
            };
            rom[0x4000 + t * 32..0x4000 + t * 32 + 32].copy_from_slice(source);
        }
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");

        let covering = discovery
            .candidates
            .iter()
            .filter(|candidate| {
                candidate.kind == KIND_TILE_BLOCK
                    && candidate.offset <= 0x4000
                    && candidate.offset + candidate.size >= 0x4100
            })
            .count();
        assert_eq!(covering, 1, "exatamente um bloco cobre o offset conhecido");
        let candidate = discovery
            .candidates
            .iter()
            .find(|candidate| candidate.kind == KIND_TILE_BLOCK)
            .expect("candidato de tiles");
        assert_eq!(candidate.offset, 0x4000, "snap acerta o grid do fixture");
        assert_eq!(candidate.status, STATUS_CANDIDATE);
        assert!(candidate.confidence < 1.0, "nunca confirmado");
        assert!(candidate.confidence >= 0.5, "fixture forte: {candidate:?}");
        let duplicates = candidate.evidence["duplicate_tiles"].as_u64().unwrap_or(0);
        assert!(duplicates >= 4, "evidência de repetição: {candidate:?}");
    }

    #[test]
    fn fixture_palettes_at_known_offsets() {
        let mut rom = fixture_rom(0x8000);
        for i in 0..16u16 {
            // formato MD: bits 15..9 zerados (3 bits por canal)
            let word: u16 = if i == 0 { 0 } else { (i * 0x49) & 0x1FF };
            rom[0x2000 + (i as usize) * 2..0x2000 + (i as usize) * 2 + 2]
                .copy_from_slice(&word.to_be_bytes());
        }
        for i in 0..64u16 {
            let word: u16 = ((i % 8 + 1) * 0x49) & 0x1FF;
            rom[0x3000 + (i as usize) * 2..0x3000 + (i as usize) * 2 + 2]
                .copy_from_slice(&word.to_be_bytes());
        }
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");

        let palette16 = discovery
            .candidates
            .iter()
            .find(|candidate| candidate.kind == KIND_PALETTE16)
            .expect("palette16");
        assert_eq!(palette16.offset, 0x2000, "offset exato do fixture");
        assert_eq!(palette16.size, 32);
        assert_eq!(
            palette16.evidence["first_word_zero"], true,
            "cor 0 transparente como evidência"
        );

        let palette64 = discovery
            .candidates
            .iter()
            .find(|candidate| candidate.kind == KIND_PALETTE64)
            .expect("palette64");
        assert_eq!(palette64.offset, 0x3000);
        assert_eq!(palette64.size, 128);
    }

    #[test]
    fn negative_random_region_has_no_candidates() {
        let rom = fixture_rom(0x8000); // junk LCG em todo o corpo
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");
        assert!(
            discovery.candidates.is_empty(),
            "junk pseudoaleatório não pode virar candidato: {:#?}",
            discovery.candidates
        );
    }

    #[test]
    fn palette_high_bit_breaks_run() {
        let mut rom = fixture_rom(0x8000);
        // 8 words válidas, depois uma com bit 15 setado, depois 7 válidas.
        for i in 0..16u16 {
            let mut word: u16 = 0x0111 * (i + 1);
            if i == 8 {
                word |= 0x8000;
            }
            rom[0x4000 + (i as usize) * 2..0x4000 + (i as usize) * 2 + 2]
                .copy_from_slice(&word.to_be_bytes());
        }
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");
        let overlapping = discovery
            .candidates
            .iter()
            .filter(|candidate| {
                candidate.kind.starts_with("palette")
                    && candidate.offset < 0x4020
                    && candidate.offset + candidate.size > 0x4000
            })
            .count();
        assert_eq!(
            overlapping, 0,
            "bit 15 setado quebra o run — nenhuma paleta atravessa"
        );
    }

    #[test]
    fn candidates_never_alter_catalog_unknown_regions() {
        let mut rom = fixture_rom(0x8000);
        let tile = fontlike_tile(0x33);
        rom[0x5000..0x5000 + 128].copy_from_slice(&tile.repeat(4));
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let catalog_json_before =
            serde_json::to_vec_pretty(&catalog).expect("serialização determinística");

        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");
        let catalog_json_after =
            serde_json::to_vec_pretty(&catalog).expect("serialização determinística");
        assert_eq!(
            catalog_json_before, catalog_json_after,
            "catálogo imutável à descoberta"
        );
        assert!(
            discovery
                .candidates
                .iter()
                .all(|candidate| candidate.status == STATUS_CANDIDATE),
            "nenhum candidato vira identified/confirmed"
        );
        let unknown = catalog
            .regions
            .iter()
            .filter(|region| {
                region.status == crate::tools::reverse::decomp::extract::STATUS_UNKNOWN
            })
            .count();
        assert!(unknown >= 1, "corpo segue unknown no catálogo");
        assert!(!discovery.unknown_policy.is_empty());
    }

    #[test]
    fn discovery_validates_catalog_link_and_rom_bytes() {
        let rom = fixture_rom(0x8000);
        let (catalog, catalog_sha) = catalog_and_sha(&rom);

        let error = discover_graphic_candidates(&catalog, &rom, "nao-e-hex")
            .expect_err("catalog sha inválido");
        assert!(error.contains("hex"), "{error}");

        let mut other = rom.clone();
        other[0x3000] ^= 0xFF;
        let error = discover_graphic_candidates(&catalog, &other, &catalog_sha)
            .expect_err("bytes divergentes");
        assert!(error.contains("não correspondem"), "{error}");
    }

    #[test]
    fn discovery_artifact_immutable_and_runs_appended() {
        let work = std::env::temp_dir().join(format!(
            "rex04-gfx-run-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let mut rom = fixture_rom(0x8000);
        let tile = fontlike_tile(0x44);
        rom[0x6000..0x6000 + 160].copy_from_slice(&tile.repeat(5));
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");
        assert!(
            !discovery.candidates.is_empty(),
            "fixture deve gerar candidato"
        );

        let (first, artifact) = record_discovery_run(&work, &discovery).expect("primeiro run");
        let stored = fs::read(&artifact.path).expect("artefato legível");
        assert_eq!(sha256_hex(&stored), artifact.sha256);
        let reparsed: GraphicDiscovery = serde_json::from_slice(&stored).expect("reparseável");
        assert_eq!(reparsed, discovery);

        // Re-gravação do MESMO discovery reutiliza o arquivo imutável; um
        // run novo é anexado com o MESMO artefato (idempotente).
        let (second, artifact2) = record_discovery_run(&work, &discovery).expect("segundo run");
        assert_ne!(first, second);
        assert_eq!(artifact.path, artifact2.path);

        let ledger =
            crate::tools::reverse::decomp::rom_library::load_ledger(&work).expect("ledger");
        let gfx_runs: Vec<_> = ledger
            .scenario_runs
            .iter()
            .filter(|run| run.kind == "graphic_discovery")
            .collect();
        assert_eq!(gfx_runs.len(), 2);
        assert_eq!(gfx_runs[0].scenario_id, GRAPHIC_DISCOVERY_SCENARIO_ID);
        assert_eq!(gfx_runs[0].verdict, "discovered");

        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn preview_export_hashes_and_reuses_files() {
        let work = std::env::temp_dir().join(format!(
            "rex04-gfx-preview-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let mut rom = fixture_rom(0x8000);
        let tile = fontlike_tile(0x55);
        rom[0x6000..0x6000 + 192].copy_from_slice(&tile.repeat(6));
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let mut discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");

        let written = export_candidate_previews(&work, &mut discovery, &rom).expect("prévias");
        assert!(written > 0, "pelo menos uma prévia");
        let with_preview = discovery
            .candidates
            .iter()
            .find(|candidate| !candidate.previews.is_empty())
            .expect("candidato com prévia");
        let artifact = &with_preview.previews[0];
        let stored = fs::read(&artifact.path).expect("png legível");
        assert_eq!(sha256_hex(&stored), artifact.sha256, "png íntegro");
        assert!(
            stored.starts_with(&[0x89, b'P', b'N', b'G']),
            "é PNG de verdade"
        );

        // Re-exportação reutiliza os MESMOS arquivos (imutáveis por hash).
        let previews_dir = canonical_dir_under(
            &work,
            &["extract", &discovery.normalized_sha256, "previews"],
        )
        .expect("dir");
        let preview_count = fs::read_dir(&previews_dir).expect("listar").count();
        let written2 = export_candidate_previews(&work, &mut discovery, &rom).expect("re-export");
        assert_eq!(written, written2);
        let preview_count2 = fs::read_dir(&previews_dir).expect("listar").count();
        assert_eq!(preview_count, preview_count2, "nenhum arquivo novo");

        let _ = std::fs::remove_dir_all(&work);
    }

    /// Prova real: descoberta com CONFRONTO a regiões conhecidas — dados
    /// compartilhados do SGDK (libmd.a) presentes verbatim na ROM, localizados
    /// por busca de conteúdo. Regiões conhecidas com conteúdo graficamente
    /// plausível DEVEM estar cobertas por candidatos; regiões conhecidas sem
    /// plausibilidade (código) NÃO devem virar candidatos — a separação
    /// heurística é o ponto da fatia.
    #[test]
    #[ignore = "prova real BYOR: requer ROM de referência + libmd.a do corpus"]
    fn rex04_hamoopig_graphic_discovery_confrontation() {
        let test_name = "rex04_hamoopig_graphic_discovery_confrontation";
        let Some((_identity, bytes)) = rex04_reference_rom(test_name) else {
            return;
        };
        let Some(lib) = optional_donor_lib(test_name) else {
            return;
        };
        run_confrontation(test_name, &bytes, &lib);
    }

    /// Prova real: mesma confrontação para a ROM de referência do Taiketsu.
    #[test]
    #[ignore = "prova real BYOR: requer ROM de referência + libmd.a do corpus"]
    fn rex04_taiketsu_graphic_discovery_confrontation() {
        let test_name = "rex04_taiketsu_graphic_discovery_confrontation";
        let Some((_identity, bytes)) = rex04_reference_rom(test_name) else {
            return;
        };
        let Some(lib) = optional_donor_lib(test_name) else {
            return;
        };
        run_confrontation(test_name, &bytes, &lib);
    }

    fn rex04_reference_rom(
        test_name: &str,
    ) -> Option<(crate::tools::reverse::loader::RexRomIdentity, Vec<u8>)> {
        let (env_key, default_path, expected_sha) = if test_name.contains("hamoopig") {
            (
                "RDS_REX_HAMOOPIG_ROM",
                "/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/hamoopig/reference.bin",
                "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9",
            )
        } else {
            (
                "RDS_REX_TAIKETSU_ROM",
                "/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/taiketsu/reference.bin",
                "3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c",
            )
        };
        let configured = std::env::var(env_key).ok();
        let path = match &configured {
            Some(value) => PathBuf::from(value),
            None => PathBuf::from(default_path),
        };
        if !path.is_file() {
            if configured.is_some() {
                panic!("{test_name}: {env_key} aponta para arquivo inexistente");
            }
            eprintln!("SKIP {test_name}: ROM ausente em {}", path.display());
            return None;
        }
        let (identity, bytes) = crate::tools::reverse::loader::rex_read_rom(&path)
            .unwrap_or_else(|error| panic!("{test_name}: {error}"));
        assert_eq!(sha256_hex(&bytes), expected_sha, "{test_name}: ROM mudou");
        Some((identity, bytes))
    }

    fn optional_donor_lib(test_name: &str) -> Option<Vec<u8>> {
        let path = std::env::var("RDS_REX_SGDK_LIBMD")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(
                    "/mnt/sdcard/Projects/Sgdk Forge/SGDK_Engines/SGDK-source/lib/libmd.a",
                )
            });
        if !path.is_file() {
            eprintln!("SKIP {test_name}: libmd.a ausente em {}", path.display());
            return None;
        }
        crate::tools::reverse::loader::rex_read_host_file(&path).ok()
    }

    /// Localiza regiões conhecidas (janelas da lib presentes verbatim na
    /// ROM) via mapa de hashes com janelas em TODOS os offsets da lib
    /// (alinhamento de posicionamento na ROM é arbitrário), agrega runs
    /// maximais ≥ 256B e confronta com os candidatos.
    fn run_confrontation(test_name: &str, bytes: &[u8], lib: &[u8]) {
        const CHUNK: usize = 16;
        const MIN_RUN_CHUNKS: usize = 16; // 256 bytes

        let identity = crate::tools::reverse::loader::rex_identify_bytes(bytes)
            .expect("ROM identificável (REX-02)");
        let (catalog, catalog_sha) = {
            let catalog = crate::tools::reverse::decomp::extract::build_md_extraction_catalog(
                &identity, bytes,
            )
            .expect("catálogo");
            let json = serde_json::to_vec_pretty(&catalog).expect("serialização");
            (catalog, sha256_hex(&json))
        };

        // Mapa hash → offsets de janelas de 16B da lib em TODOS os offsets.
        let mut lib_windows: std::collections::HashMap<u64, Vec<usize>> =
            std::collections::HashMap::new();
        for start in 0..lib.len().saturating_sub(CHUNK) {
            lib_windows
                .entry(fnv1a64(&lib[start..start + CHUNK]))
                .or_default()
                .push(start);
        }
        // Marca blocos de 16B da ROM cujos bytes existem na lib (com
        // verificação de bytes — hash só filtra).
        let rom_blocks = bytes.len() / CHUNK;
        let mut matched = vec![false; rom_blocks];
        for index in 0..rom_blocks {
            let chunk = &bytes[index * CHUNK..index * CHUNK + CHUNK];
            if let Some(offsets) = lib_windows.get(&fnv1a64(chunk)) {
                if offsets
                    .iter()
                    .any(|start| &lib[*start..*start + CHUNK] == chunk)
                {
                    matched[index] = true;
                }
            }
        }
        // Runs maximais de blocos marcados.
        let mut known_regions: Vec<(u64, u64)> = Vec::new();
        let mut index = 0;
        while index < rom_blocks {
            if !matched[index] {
                index += 1;
                continue;
            }
            let start = index;
            while index < rom_blocks && matched[index] {
                index += 1;
            }
            let len_blocks = index - start;
            if len_blocks >= MIN_RUN_CHUNKS {
                known_regions.push(((start * CHUNK) as u64, (len_blocks * CHUNK) as u64));
            }
        }
        eprintln!(
            "{test_name}: regiões conhecidas ≥256B: {}",
            known_regions.len()
        );

        let work = crate::tools::reverse::decomp::rom_library::decomp_work_dir();
        let mut discovery =
            discover_graphic_candidates(&catalog, bytes, &catalog_sha).expect("descoberta");
        let previews = export_candidate_previews(&work, &mut discovery, bytes).expect("prévias");
        let (run_id, artifact) =
            record_discovery_run(&work, &discovery).expect("run no ledger real");

        let mut plausible_known = 0usize;
        let mut covered_plausible = 0usize;
        let mut implausible_known = 0usize;
        for (offset, size) in &known_regions {
            if *offset < 0x200 {
                continue;
            }
            let tiles = (*size as usize) / TILE_BYTES;
            if tiles == 0 {
                continue;
            }
            let avg: f32 = (0..tiles)
                .map(|t| {
                    graphic_score_tile(
                        &bytes[*offset as usize + t * TILE_BYTES
                            ..*offset as usize + t * TILE_BYTES + TILE_BYTES],
                    )
                })
                .sum::<f32>()
                / tiles as f32;
            if avg < MIN_TILE_SCORE {
                implausible_known += 1;
                continue;
            }
            plausible_known += 1;
            // Cobertura por UNIÃO dos candidatos (as bordas da região
            // conhecida vêm do grid de chunks da lib — a exigência de
            // contenção borda-a-borda é irrealista; 90% dos bytes é o piso
            // de "essencialmente coberta").
            let region_start = *offset;
            let region_end = offset + size;
            let mut covered_bytes = 0u64;
            for candidate in discovery
                .candidates
                .iter()
                .filter(|c| c.kind == KIND_TILE_BLOCK)
            {
                let lo = candidate.offset.max(region_start);
                let hi = (candidate.offset + candidate.size).min(region_end);
                if hi > lo {
                    covered_bytes += hi - lo;
                }
            }
            let fraction = covered_bytes as f32 / *size as f32;
            if fraction >= 0.9 {
                covered_plausible += 1;
            } else {
                eprintln!(
                    "{test_name}: região conhecida PLAUSÍVEL mal coberta: 0x{offset:X} \
                     ({size}B, avg={avg:.2}, cobertura={:.1}%)",
                    fraction * 100.0
                );
            }
        }
        eprintln!(
            "{test_name}: candidatos={}, prévias={previews}, run={run_id}, artifact={}",
            discovery.candidates.len(),
            artifact.path
        );
        eprintln!(
            "{test_name}: conhecidas plausíveis={plausible_known} \
             cobertas={covered_plausible} implausíveis(código)={implausible_known}"
        );
        assert!(
            discovery
                .candidates
                .iter()
                .any(|candidate| candidate.kind == KIND_TILE_BLOCK),
            "ROM real deve ter blocos de tiles candidatos"
        );
        assert!(
            plausible_known == 0 || covered_plausible >= 1,
            "região conhecida graficamente plausível deve estar coberta por candidato"
        );
        assert_eq!(
            covered_plausible, plausible_known,
            "TODAS as regiões conhecidas plausíveis devem estar cobertas"
        );
    }
}
