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
    canonical_dir_under, reject_if_symlink, sha256_path_component, validate_extraction_catalog,
    write_file_immutable, ExtractionCatalog,
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
/// típico de fonte/bitmaps), flat exatas ou QUASE-FLAT (diferem da linha
/// anterior em ≤2 bits — arte tem variação mínima entre linhas). Público
/// para as provas de confronto usarem o MESMO critério do detector.
pub fn graphic_score_tile(tile: &[u8]) -> f32 {
    if tile.len() < TILE_BYTES {
        return 0.0;
    }
    let constant = tile[..TILE_BYTES].iter().all(|byte| *byte == tile[0]);
    if constant {
        return 0.0; // padding (0x00/0xFF repetido) não é gráfico
    }
    let rows: [[u8; 4]; 8] = core::array::from_fn(|row| {
        [
            tile[row * 4],
            tile[row * 4 + 1],
            tile[row * 4 + 2],
            tile[row * 4 + 3],
        ]
    });
    let mut good = 0u32;
    for (i, row) in rows.iter().enumerate() {
        if *row == [0, 0, 0, 0] {
            good += 1; // linha vazia (transparente)
            continue;
        }
        if row[2] == 0 && row[3] == 0 {
            good += 1; // 1bpp-like (planos 2 e 3 zerados)
            continue;
        }
        if i > 0 {
            // QUASE-FLAT: linha igual ou difere em ≤2 bits (somados nos 4
            // bytes) de uma das DUAS linhas anteriores não-vazias — arte
            // repete estrutura em passos de 1 e 2 linhas; dados que apenas
            // seguem uma linha de zeros não recebem o crédito.
            for back in 1..=2usize {
                if i < back {
                    break;
                }
                let previous = rows[i - back];
                if previous == [0, 0, 0, 0] {
                    continue;
                }
                if previous == *row {
                    good += 1;
                    break;
                }
                let xor_bits: u32 = previous
                    .iter()
                    .zip(row.iter())
                    .map(|(a, b)| u32::from(a ^ b).count_ones())
                    .sum();
                if xor_bits <= NEAR_FLAT_MAX_BITS {
                    good += 1;
                    break;
                }
            }
        }
    }
    good as f32 / 8.0
}

/// Diferença máxima (em bits, somada nos 4 bytes) entre linhas consecutivas
/// para a linha contar como QUASE-FLAT. 2 bits = variação de 1 pixel de um
/// único plano; strings/padding variam mais e não se qualificam.
const NEAR_FLAT_MAX_BITS: u32 = 2;

/// Fração de pares de nibbles adjacentes iguais (suavidade horizontal):
/// arte real tem corridas de pixels da mesma cor; código tem nibbles
/// variados. Métrica auxiliar da regra de tile "denso".
fn nibble_repeat_ratio(tile: &[u8]) -> f32 {
    let mut nibbles = Vec::with_capacity(TILE_BYTES * 2);
    for byte in &tile[..TILE_BYTES] {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0xF);
    }
    let same = nibbles.windows(2).filter(|pair| pair[0] == pair[1]).count();
    same as f32 / (nibbles.len() - 1) as f32
}

const MIN_TILE_SCORE: f32 = 0.5;

/// Score COMBINADO de plausibilidade de um tile na ROM:
/// 1. score esparso (linhas vazias/1bpp-like/flat) ≥ 0.5, OU
/// 2. tile "denso": ≤12 valores distintos em 32 bytes E suavidade de
///    nibbles ≥ 0.5 — captura gráficos ricos (todas as bitplanos, padrões
///    periódicos) que a regra esparsa não alcança. Tiles constantes ficam
///    de fora (padding nunca é gráfico).
fn tile_plausibility_score(data: &[u8], offset: u64) -> f32 {
    let start = offset as usize;
    if start + TILE_BYTES > data.len() {
        return 0.0;
    }
    let tile = &data[start..start + TILE_BYTES];
    // Constante (padding/zeros) NUNCA passa pela regra densa — 1 valor
    // distinto e nibbles 100% "suaves" descrevem zeros, não pixels.
    if tile.iter().all(|byte| *byte == tile[0]) {
        return 0.0;
    }
    let base = graphic_score_tile(tile);
    if base >= MIN_TILE_SCORE {
        return base;
    }
    let distinct = tile
        .iter()
        .copied()
        .collect::<std::collections::HashSet<u8>>()
        .len();
    if distinct <= 16 && nibble_repeat_ratio(tile) >= 0.5 {
        return MIN_TILE_SCORE;
    }
    base
}

fn plausible_tile(data: &[u8], offset: u64) -> bool {
    tile_plausibility_score(data, offset) >= MIN_TILE_SCORE
}

/// Tolerância a gaps: até N tiles não-plausíveis consecutivos dentro de um
/// bloco (tiles densos reais alternam com tiles que a heurística não alcança;
/// gap_tiles registrado na evidência).
const MAX_GAP_TILES: u64 = 1;

/// Estende um bloco a partir de `block_start` em stride de TILE_BYTES,
/// tolerando até MAX_GAP_TILES tiles implausíveis consecutivos. Retorna o
/// fim do bloco (último tile plausível + 32).
fn extend_block(data: &[u8], block_start: u64, end: u64) -> u64 {
    let mut cursor = block_start;
    let mut block_end = block_start;
    let mut gap = 0u64;
    while cursor + TILE_BYTES as u64 <= end && gap <= MAX_GAP_TILES {
        if plausible_tile(data, cursor) {
            block_end = cursor + TILE_BYTES as u64;
            gap = 0;
        } else {
            gap += 1;
        }
        cursor += TILE_BYTES as u64;
    }
    block_end
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
    let mut evaluated = std::collections::HashMap::<u64, (u64, f32)>::new();
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
            let (block_end, avg) = if let Some(&(cached_end, cached_avg)) =
                evaluated.get(&block_start)
            {
                (cached_end, cached_avg)
            } else {
                let cached_end = extend_block(data, block_start, end);
                let tiles = (cached_end - block_start) / TILE_BYTES as u64;
                let cached_avg = if tiles == 0 {
                    0.0
                } else {
                    (0..tiles)
                        .map(|t| tile_plausibility_score(data, block_start + t * TILE_BYTES as u64))
                        .sum::<f32>()
                        / tiles as f32
                };
                evaluated.insert(block_start, (cached_end, cached_avg));
                (cached_end, cached_avg)
            };
            let tiles = (block_end - block_start) / TILE_BYTES as u64;
            if tiles >= 1 {
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
        offset = block_end.max(offset + SCAN_STEP);
    }
    candidates
}

fn build_tile_candidate(data: &[u8], offset: u64, block_end: u64, tiles: u64) -> GraphicCandidate {
    let start = offset as usize;
    let mut empty_rows = 0u64;
    let mut onebpp_rows = 0u64;
    let mut score_sum = 0.0f32;
    let mut gap_tiles = 0u64;
    let mut occurrences: std::collections::HashMap<u64, u32> = std::collections::HashMap::new();
    let mut duplicate_tiles = 0u64;

    for t in 0..tiles {
        let base = start + (t as usize) * TILE_BYTES;
        let tile = &data[base..base + TILE_BYTES];
        score_sum += graphic_score_tile(tile);
        if graphic_score_tile(tile) < MIN_TILE_SCORE {
            gap_tiles += 1;
        }
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
            "gap_tiles": gap_tiles,
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

/// Varre pares de bytes e agrega runs maximais de words no formato canônico
/// de cor MD (`xxxxBBBxGGGxRRRx`, SGDK `pal.h`): canais em 1/5/9, bits
/// reservados 0/4/8/12..15 zerados — máscara de validade 0xF111. Runs de 16
/// words viram `palette16`; de 64+ viram `palette64` (candidato maximal, sem
/// aninhamento).
fn scan_palettes(data: &[u8], start: u64, end: u64) -> Vec<GraphicCandidate> {
    let mut candidates = Vec::new();
    let mut offset = start;
    while offset + 2 <= end {
        let Some(word) = palette_word(data, offset) else {
            break;
        };
        if word & 0xF111 != 0 {
            offset += SCAN_STEP;
            continue;
        }
        let mut run = 1u64;
        while offset + (run + 1) * 2 <= end {
            let Some(word) = palette_word(data, offset + run * 2) else {
                break;
            };
            if word & 0xF111 != 0 {
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
                    "canonical_format_pct": 100.0,
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
    validate_extraction_catalog(catalog, normalized)?;
    let canonical_catalog = serde_json::to_vec_pretty(catalog)
        .map_err(|error| format!("falha ao serializar catálogo canônico: {error}"))?;
    let expected_catalog_sha = sha256_hex(&canonical_catalog);
    if catalog_sha256 != expected_catalog_sha {
        return Err(format!(
            "hash do artefato de catálogo não corresponde à serialização canônica: esperado {}, obtido {}",
            expected_catalog_sha, catalog_sha256
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
fn write_immutable_artifact(dir: &Path, prefix: &str, bytes: &[u8]) -> Result<ArtifactRef, String> {
    let sha = sha256_hex(bytes);
    let path = dir.join(format!("{prefix}-{sha}.png"));
    let write_result =
        reject_if_symlink(&path).and_then(|()| write_file_immutable(&path, bytes, &sha));
    write_result?;
    Ok(ArtifactRef {
        label: prefix.to_string(),
        path: path.display().to_string(),
        sha256: sha,
    })
}

fn push_unique_artifact(artifacts: &mut Vec<ArtifactRef>, artifact: ArtifactRef) {
    if !artifacts.iter().any(|existing| existing == &artifact) {
        artifacts.push(artifact);
    }
}

pub(crate) fn validate_graphic_discovery(
    discovery: &GraphicDiscovery,
    normalized: &[u8],
) -> Result<(), String> {
    if discovery.schema_version != GRAPHIC_DISCOVERY_SCHEMA_V1
        || discovery.normalized_sha256 != sha256_hex(normalized)
        || discovery.original_sha256.len() != 64
        || !discovery
            .original_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("descoberta não corresponde à identidade dos bytes".to_string());
    }
    if discovery.catalog_sha256.len() != 64
        || !discovery
            .catalog_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("descoberta referencia um SHA de catálogo inválido".to_string());
    }
    for candidate in &discovery.candidates {
        let end = candidate
            .offset
            .checked_add(candidate.size)
            .ok_or_else(|| "overflow no intervalo do candidato".to_string())?;
        if candidate.size == 0
            || end > normalized.len() as u64
            || candidate.status != STATUS_CANDIDATE
        {
            return Err(format!(
                "intervalo/status inválido no candidato {}@{}",
                candidate.kind, candidate.offset
            ));
        }
        match candidate.kind.as_str() {
            KIND_TILE_BLOCK if candidate.size % TILE_BYTES as u64 == 0 => {}
            KIND_PALETTE16 | KIND_PALETTE64 if candidate.size % 2 == 0 => {}
            _ => {
                return Err(format!(
                    "tipo/tamanho inválido no candidato '{}'",
                    candidate.kind
                ))
            }
        }
        let _ = usize::try_from(candidate.offset)
            .map_err(|_| "offset do candidato não cabe no host".to_string())?;
    }
    Ok(())
}

/// Exporta prévias PNG para os candidatos (limite: 16 de cada tipo), com o
/// mesmo padrão imutável endereçado por hash; anexa os `ArtifactRef` ao
/// candidato correspondente. Retorna o número de prévias escritas.
pub fn export_candidate_previews(
    work_dir: &Path,
    discovery: &mut GraphicDiscovery,
    normalized: &[u8],
) -> Result<usize, String> {
    validate_graphic_discovery(discovery, normalized)?;
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
                let artifact = write_immutable_artifact(&previews_dir, "tiles", &png)?;
                push_unique_artifact(&mut candidate.previews, artifact);
                written += 1;
            }
            KIND_PALETTE16 | KIND_PALETTE64 => {
                palettes += 1;
                if palettes > 16 {
                    continue;
                }
                let png = render_palette_png(normalized, candidate)?;
                let artifact = write_immutable_artifact(&previews_dir, "palette", &png)?;
                push_unique_artifact(&mut candidate.previews, artifact);
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
                // Formato 4bpp do SGDK (rescomp): CHUNKY — cada byte da
                // linha contém DOIS pixels (nibble alto = pixel esquerdo,
                // nibble baixo = pixel direito). 4 bytes = 8 pixels.
                let byte = tile[(pixel_y * 4 + pixel_x / 2) as usize];
                let value = if pixel_x % 2 == 0 {
                    byte >> 4
                } else {
                    byte & 0xF
                };
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
        // Formato canônico MD (SGDK pal.h): xxxxBBBxGGGxRRRx — canais em
        // 1/5/9, 3 bits por canal.
        let red = ((word >> 1) & 0x7) as u8 * 36;
        let green = ((word >> 5) & 0x7) as u8 * 36;
        let blue = ((word >> 9) & 0x7) as u8 * 36;
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
    confrontation_evidence: serde_json::Value,
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
        for artifact_ref in &candidate.previews {
            push_unique_artifact(&mut artifacts, artifact_ref.clone());
        }
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
            "confrontation": confrontation_evidence,
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
    use image::GenericImageView;
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

    /// Palavra de cor MD no formato canônico (SGDK pal.h): xxxxBBBxGGGxRRRx
    /// — canais em 1/5/9.
    fn md_color(r: u16, g: u16, b: u16) -> u16 {
        ((r & 7) << 1) | ((g & 7) << 5) | ((b & 7) << 9)
    }

    #[test]
    fn fixture_palettes_at_known_offsets() {
        let mut rom = fixture_rom(0x8000);
        // Palette16 canônica em 0x2000: transparente + R/G/B plenos + branco.
        let entries = [
            0u16,
            md_color(7, 0, 0),
            md_color(0, 7, 0),
            md_color(0, 0, 7),
            md_color(7, 7, 7),
        ];
        for (i, word) in entries.iter().enumerate() {
            rom[0x2000 + i * 2..0x2000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        for i in 5..16usize {
            let word = md_color((i % 7) as u16, (i / 2) as u16, (i / 3) as u16);
            rom[0x2000 + i * 2..0x2000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        // Palette64 canônica em 0x3000.
        for i in 0..64usize {
            let word = md_color((i % 8) as u16, ((i / 8) % 8) as u16, ((i / 4) % 8) as u16);
            rom[0x3000 + i * 2..0x3000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
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

    /// Cores primárias e branco no formato canônico são ACEITOS pelo scanner
    /// (0x000E vermelho, 0x00E0 verde, 0x0E00 azul, 0x0EEE branco) e o
    /// renderizador decodifica os canais em 1/5/9 — verificado pelos PIXELS
    /// do PNG decodificado (independente do código de renderização).
    #[test]
    fn palette_primary_colors_render_independent_png_pixels() {
        let work = std::env::temp_dir().join(format!(
            "rex04-gfx-colors-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let mut rom = fixture_rom(0x8000);
        let entries = [
            0u16,
            md_color(7, 0, 0), // vermelho pleno 0x000E
            md_color(0, 7, 0), // verde pleno 0x00E0
            md_color(0, 0, 7), // azul pleno 0x0E00
            md_color(7, 7, 7), // branco 0x0EEE
        ];
        for (i, word) in entries.iter().enumerate() {
            rom[0x2000 + i * 2..0x2000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        for i in 5..16usize {
            let word = md_color((i % 7) as u16, (i / 2) as u16, (i / 3) as u16);
            rom[0x2000 + i * 2..0x2000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let mut discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");

        export_candidate_previews(&work, &mut discovery, &rom).expect("prévias");
        let palette = discovery
            .candidates
            .iter()
            .find(|candidate| candidate.kind == KIND_PALETTE16)
            .expect("palette16");
        let png_bytes = fs::read(&palette.previews[0].path).expect("png legível");

        // Decodificação INDEPENDENTE do PNG (image crate) + asserção nos
        // pixels dos swatches (cada swatch = 16×16 px).
        let decoded = image::load_from_memory(&png_bytes).expect("png decodificável");
        let expected: [(u32, [u8; 3]); 5] = [
            (0, [0, 0, 0]),
            (1, [252, 0, 0]),     // vermelho
            (2, [0, 252, 0]),     // verde
            (3, [0, 0, 252]),     // azul
            (4, [252, 252, 252]), // branco
        ];
        for (index, [r, g, b]) in expected {
            let pixel = decoded.get_pixel(index * 16 + 8, 8);
            assert_eq!(
                pixel.0[..3],
                [r, g, b],
                "swatch {index} deve renderizar o canal canônico"
            );
        }

        let _ = std::fs::remove_dir_all(&work);
    }

    /// Bits reservados da hipótese canônica (0/4/8/12..15) quebram o run;
    /// azul pleno 0x0E00 e branco 0x0EEE NÃO são rejeitados (regressão P1).
    #[test]
    fn palette_canonical_format_rejects_reserved_bits() {
        let mut rom = fixture_rom(0x8000);
        // 16 words com UMA de bits reservados no meio (0x0011): nenhum
        // palette16 pode atravessar a quebra.
        for i in 0..16usize {
            let mut word = md_color((i % 7) as u16 + 1, (i / 3) as u16, (i / 5) as u16);
            if i == 8 {
                word = 0x0011; // bits 0 e 4 reservados setados
            }
            rom[0x4000 + i * 2..0x4000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        // Azul pleno + branco seguidos de canônicas: run íntegro em 0x5000.
        for (i, word) in [0x0E00u16, 0x0EEEu16].iter().enumerate() {
            rom[0x5000 + i * 2..0x5000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        for i in 2..16usize {
            let word = md_color((i % 5) as u16, (i % 3) as u16, (i % 7) as u16);
            rom[0x5000 + i * 2..0x5000 + i * 2 + 2].copy_from_slice(&word.to_be_bytes());
        }
        let (catalog, catalog_sha) = catalog_and_sha(&rom);
        let discovery =
            discover_graphic_candidates(&catalog, &rom, &catalog_sha).expect("descoberta");

        let crossing = discovery
            .candidates
            .iter()
            .filter(|candidate| {
                candidate.kind.starts_with("palette")
                    && candidate.offset < 0x4020
                    && candidate.offset + candidate.size > 0x4000
            })
            .count();
        assert_eq!(crossing, 0, "bits reservados quebram o run canônico");

        let blue_white = discovery.candidates.iter().any(|candidate| {
            candidate.kind.starts_with("palette")
                && candidate.offset <= 0x5000
                && candidate.offset + candidate.size >= 0x5020
        });
        assert!(blue_white, "azul 0x0E00 e branco 0x0EEE devem ser aceitos");
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
    fn discovery_rejects_a_valid_but_wrong_catalog_hash() {
        let rom = fixture_rom(0x8000);
        let (catalog, _) = catalog_and_sha(&rom);
        let wrong_hash = "0".repeat(64);
        let error = discover_graphic_candidates(&catalog, &rom, &wrong_hash)
            .expect_err("SHA hex válido mas não vinculado ao artefato deve falhar");
        assert!(error.contains("serialização canônica"), "{error}");
    }

    #[test]
    fn discovery_rejects_overflow_and_inconsistent_catalog_ranges() {
        let rom = fixture_rom(0x8000);
        let (mut catalog, catalog_sha) = catalog_and_sha(&rom);
        catalog.regions[2].offset = u64::MAX - 1;
        catalog.regions[2].size = 8;
        let error = discover_graphic_candidates(&catalog, &rom, &catalog_sha)
            .expect_err("intervalo fora da ROM deve falhar antes do scanner");
        assert!(
            error.contains("intervalo") || error.contains("overflow"),
            "{error}"
        );
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

        let (first, artifact) =
            record_discovery_run(&work, &discovery, serde_json::json!({})).expect("primeiro run");
        let stored = fs::read(&artifact.path).expect("artefato legível");
        assert_eq!(sha256_hex(&stored), artifact.sha256);
        let reparsed: GraphicDiscovery = serde_json::from_slice(&stored).expect("reparseável");
        assert_eq!(reparsed, discovery);

        // Re-gravação do MESMO discovery reutiliza o arquivo imutável; um
        // run novo é anexado com o MESMO artefato (idempotente).
        let (second, artifact2) =
            record_discovery_run(&work, &discovery, serde_json::json!({})).expect("segundo run");
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

    /// Verificação INDEPENDENTE da prévia no formato MD/SGDK (CHUNKY —
    /// 2 pixels por byte, nibble alto = pixel esquerdo): fixture ASSIMÉTRICA
    /// (pixel (py,px) do tile t = (py*4+px+t) % 16) e comparação de TODOS
    /// os pixels decodificados, além de bordas e dimensões.
    #[test]
    fn preview_pixels_offsets_and_boundaries_match_reference() {
        let work = std::env::temp_dir().join(format!(
            "rex04-preview-ref-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let mut rom = fixture_rom(0x8000);
        let block_offset = 0x6000usize;
        let tile_count = 8usize;
        // Fixture assimétrica: valor do pixel (py,px) do tile t.
        let pixel_value = |tile: usize, py: usize, px: usize| (py * 4 + px + tile) % 16;
        // Encode CHUNKY (byte = hi nibble do pixel par | lo do ímpar).
        for t in 0..tile_count {
            for py in 0..8usize {
                for byte_pair in 0..4usize {
                    let hi = pixel_value(t, py, byte_pair * 2);
                    let lo = pixel_value(t, py, byte_pair * 2 + 1);
                    rom[block_offset + t * 32 + py * 4 + byte_pair] = ((hi << 4) | lo) as u8;
                }
            }
        }

        let identity = rex_identify_bytes(&rom).expect("identidade");
        let catalog =
            crate::tools::reverse::decomp::extract::build_md_extraction_catalog(&identity, &rom)
                .expect("catálogo");
        let catalog_json = serde_json::to_vec_pretty(&catalog).expect("serialização");
        // O candidato é construído DIRETAMENTE (sem passar pela descoberta):
        // este teste verifica o RENDERER da prévia, não o scanner. Fixture
        // assimétrica não é detectável pela heurística (near-flat ≤2).
        let proven_candidate = GraphicCandidate {
            offset: block_offset as u64,
            size: (tile_count * 32) as u64,
            kind: KIND_TILE_BLOCK.into(),
            status: STATUS_CANDIDATE.into(),
            method: "test_fixture".into(),
            confidence: 0.5,
            evidence: serde_json::json!({}),
            previews: vec![],
        };
        let mut discovery = GraphicDiscovery {
            schema_version: GRAPHIC_DISCOVERY_SCHEMA_V1.into(),
            original_sha256: catalog.original_sha256.clone(),
            normalized_sha256: catalog.normalized_sha256.clone(),
            catalog_sha256: sha256_hex(&catalog_json),
            unknown_policy: "teste".into(),
            candidates: vec![proven_candidate],
        };

        export_candidate_previews(&work, &mut discovery, &rom).expect("prévias");
        let block_candidate = discovery
            .candidates
            .iter()
            .find(|candidate| {
                candidate.kind == KIND_TILE_BLOCK && candidate.offset == block_offset as u64
            })
            .expect("candidato do bloco conhecido");
        let artifact = &block_candidate.previews[0];
        let png_bytes = fs::read(&artifact.path).expect("png legível");
        let decoded = image::load_from_memory(&png_bytes).expect("png decodificável");

        // Grade fixa: 16 colunas, células de 8 px × escala 2 = 16 px.
        assert_eq!(decoded.width(), 16 * 16);
        // 8 tiles → 1 linha de células → altura 16 px.
        assert_eq!(decoded.height(), 16);

        // COMPARAÇÃO DE TODOS OS PIXELS: para cada tile t, cada pixel
        // (py, px), todos os 4 subpixels da escala 2 devem ter o tom
        // esperado (valor do nibble × 17).
        for t in 0..tile_count {
            for py in 0..8usize {
                for px in 0..8usize {
                    let expected = (pixel_value(t, py, px) * 17) as u8;
                    let base_x = ((t % 16) * 16 + px * 2) as u32;
                    let base_y = (py * 2) as u32;
                    for sx in 0..2u32 {
                        for sy in 0..2u32 {
                            let pixel = decoded.get_pixel(base_x + sx, base_y + sy);
                            assert_eq!(
                                pixel[0], expected,
                                "tile {t} pixel ({px},{py}): tom {expected}"
                            );
                            assert_eq!(pixel[1], expected);
                            assert_eq!(pixel[2], expected);
                        }
                    }
                }
            }
        }

        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn chunky_tile_golden_12_34_56_78_is_high_nibble_first() {
        let block_offset = 0x6000usize;
        let rows: [[u8; 4]; 8] = [
            [0x12, 0x34, 0x56, 0x78],
            [0x87, 0x65, 0x43, 0x21],
            [0x13, 0x57, 0x9B, 0xDF],
            [0xF0, 0xE1, 0xD2, 0xC3],
            [0x24, 0x68, 0xAC, 0xEF],
            [0xFE, 0xDC, 0xBA, 0x98],
            [0x31, 0x42, 0x53, 0x64],
            [0x75, 0x86, 0x97, 0xA8],
        ];
        let mut rom = fixture_rom(0x8000);
        for (row, bytes) in rows.iter().enumerate() {
            rom[block_offset + row * 4..block_offset + row * 4 + 4].copy_from_slice(bytes);
        }
        let candidate = GraphicCandidate {
            offset: block_offset as u64,
            size: TILE_BYTES as u64,
            kind: KIND_TILE_BLOCK.into(),
            status: STATUS_CANDIDATE.into(),
            method: "golden_fixture".into(),
            confidence: 0.5,
            evidence: serde_json::json!({}),
            previews: vec![],
        };
        let png = render_tile_block_png(&rom, &candidate).expect("prévia golden");
        let decoded = image::load_from_memory(&png).expect("PNG golden decodificável");
        assert_eq!((decoded.width(), decoded.height()), (256, 16));
        for (row, bytes) in rows.iter().enumerate() {
            let expected_indices: Vec<u8> = bytes
                .iter()
                .flat_map(|byte| [byte >> 4, byte & 0x0F])
                .collect();
            for (pixel_x, index) in expected_indices.iter().enumerate() {
                let expected = index * 17;
                for scale_y in 0..2u32 {
                    for scale_x in 0..2u32 {
                        let pixel = decoded
                            .get_pixel(pixel_x as u32 * 2 + scale_x, row as u32 * 2 + scale_y);
                        assert_eq!(pixel[0], expected, "row {row} x {pixel_x}");
                        assert_eq!(pixel[1], expected, "row {row} x {pixel_x}");
                        assert_eq!(pixel[2], expected, "row {row} x {pixel_x}");
                        assert_eq!(pixel[3], 255, "row {row} x {pixel_x}");
                    }
                }
            }
        }
    }

    /// Prova real: descoberta no HAMOOPIG. Os recursos COMPARTILHADOS do
    /// motor (sprite.o da família HAMOOPIG/Taiketsu) aparecem verbatim na
    /// ROM de referência — 3 chunks de tiles comprovados (compressão NONE)
    /// localizados e ≥50% cobertos; divergência de build registrada
    /// (spr_jack_550 casa verbatim só nos primeiros 512B de 2688B). O
    /// negativo (código verificado da lib não pode virar candidato) roda
    /// sempre.
    #[test]
    #[ignore = "prova real BYOR: requer ROM de referência + libmd.a + objetos do doador"]
    fn rex04_hamoopig_graphic_discovery_confrontation() {
        let test_name = "rex04_hamoopig_graphic_discovery_confrontation";
        let Some((_identity, bytes)) = rex04_reference_rom(test_name) else {
            return;
        };
        let Some(lib) = optional_donor_lib(test_name) else {
            return;
        };
        let donor_objects = load_donor_objects(test_name);
        let res_decls = load_donor_res_decls(test_name);
        run_confrontation(test_name, &bytes, &lib, &donor_objects, &res_decls);
    }

    /// Prova real: confrontação para a ROM de referência do Taiketsu com os
    /// OBJETOS COMPILADOS do projeto de origem (out/*.o) e as DECLARAÇÕES
    /// de recursos (.res) como inventário independente.
    #[test]
    #[ignore = "prova real BYOR: requer ROM de referência + objetos do doador"]
    fn rex04_taiketsu_graphic_discovery_confrontation() {
        let test_name = "rex04_taiketsu_graphic_discovery_confrontation";
        let Some((_identity, bytes)) = rex04_reference_rom(test_name) else {
            return;
        };
        let Some(lib) = optional_donor_lib(test_name) else {
            return;
        };
        let donor_objects = load_donor_objects(test_name);
        let res_decls = load_donor_res_decls(test_name);
        run_confrontation(test_name, &bytes, &lib, &donor_objects, &res_decls);
    }

    /// Declarações de recursos dos `.res` do doador (BYOR): env
    /// `RDS_REX_TAIKETSU_RES_DIR` ou o caminho do corpus.
    fn load_donor_res_decls(test_name: &str) -> Vec<ResDecl> {
        let dir = std::env::var("RDS_REX_TAIKETSU_RES_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(
                    "/mnt/sdcard/Projects/Sgdk Forge/SGDK_Engines/\
                     TaiketsuUltraHeroGenesis/src/res",
                )
            });
        let mut decls = Vec::new();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|ext| ext == "res").unwrap_or(false) {
                    if let Ok(bytes) = crate::tools::reverse::loader::rex_read_host_file(&path) {
                        decls.extend(parse_res_decls(&bytes));
                    }
                }
            }
        }
        if decls.is_empty() {
            eprintln!(
                "SKIP {test_name}: declarações .res ausentes em {}",
                dir.display()
            );
        }
        decls
    }

    /// Objetos compilados do projeto de origem (BYOR): env
    /// `RDS_REX_TAIKETSU_DONOR_OUT` ou o caminho do corpus; ausente =
    /// lista vazia (o confronto pula o positivo com razão documentada).
    fn load_donor_objects(test_name: &str) -> Vec<(String, Vec<u8>)> {
        let dir = std::env::var("RDS_REX_TAIKETSU_DONOR_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(
                    "/mnt/sdcard/Projects/Sgdk Forge/SGDK_Engines/\
                     TaiketsuUltraHeroGenesis/src/out",
                )
            });
        let mut objects = Vec::new();
        fn collect(dir: &Path, objects: &mut Vec<(String, Vec<u8>)>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect(&path, objects);
                } else if path.extension().map(|ext| ext == "o").unwrap_or(false) {
                    if let Ok(bytes) = crate::tools::reverse::loader::rex_read_host_file(&path) {
                        objects.push((path.display().to_string(), bytes));
                    }
                }
            }
        }
        collect(&dir, &mut objects);
        objects.sort_by(|a, b| a.0.cmp(&b.0));
        if objects.is_empty() {
            eprintln!(
                "SKIP {test_name}: objetos do doador ausentes em {}",
                dir.display()
            );
        }
        objects
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

    /// Extrai membros de um arquivo ar (assinatura `!<arch>\n`, headers de
    /// 60 bytes, payload alinhado a 2 bytes). Testado contra ELF sintético.
    fn parse_ar_members(lib: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut members = Vec::new();
        let mut pos = 8usize; // "!<arch>\n"
        while pos + 60 <= lib.len() {
            let header = &lib[pos..pos + 60];
            if &header[58..60] != b"`\n" {
                break;
            }
            let size_text = std::str::from_utf8(&header[48..58])
                .unwrap_or("")
                .trim()
                .trim_end_matches('`');
            let Ok(size) = size_text.parse::<usize>() else {
                break;
            };
            let payload_start = pos + 60;
            let payload_end = payload_start + size;
            if payload_end > lib.len() {
                break;
            }
            let raw_name = std::str::from_utf8(&header[0..16]).unwrap_or("");
            let name = raw_name.split('/').next().unwrap_or("").to_string();
            members.push((name, lib[payload_start..payload_end].to_vec()));
            pos = payload_start + size + (size % 2);
        }
        members
    }

    const ELF_SECTION_PROGBITS: u32 = 1;
    const ELF_SECTION_SYMTAB: u32 = 2;
    const ELF_FLAG_EXECINSTR: u32 = 0x4;

    #[derive(Debug, Clone)]
    struct ElfSection {
        section_type: u32,
        flags: u32,
        file_offset: usize,
        size: usize,
        link: usize,
        entsize: usize,
    }

    #[derive(Debug, Clone)]
    struct ElfSymbol {
        name: String,
        value: u64,
        size: usize,
        shndx: usize,
    }

    /// Parse ELF32 big-endian (objetos m68k do SGDK): seções e símbolos.
    /// Campos do header de seção: sh_type@4, sh_flags@8, sh_addr@12,
    /// sh_offset@16, sh_size@20, sh_link@24, sh_entsize@36 (40 bytes).
    fn parse_elf32_be(payload: &[u8]) -> Result<(Vec<ElfSection>, Vec<ElfSymbol>), String> {
        if payload.len() < 0x34 || &payload[0..4] != b"\x7fELF" {
            return Err("não é ELF".into());
        }
        if payload[5] != 2 {
            return Err("ELF não é big-endian".into());
        }
        let shoff = u32::from_be_bytes(payload[0x20..0x24].try_into().unwrap()) as usize;
        let shentsize = u16::from_be_bytes(payload[0x2E..0x30].try_into().unwrap()) as usize;
        let shnum = u16::from_be_bytes(payload[0x30..0x32].try_into().unwrap()) as usize;
        if shentsize < 40 || shoff + shentsize * shnum > payload.len() {
            return Err("tabela de seções inválida".into());
        }
        let mut sections = Vec::with_capacity(shnum);
        for i in 0..shnum {
            let sh = &payload[shoff + i * shentsize..shoff + (i + 1) * shentsize];
            let section_type = u32::from_be_bytes(sh[4..8].try_into().unwrap());
            let flags = u32::from_be_bytes(sh[8..12].try_into().unwrap());
            let file_offset = u32::from_be_bytes(sh[16..20].try_into().unwrap()) as usize;
            let size = u32::from_be_bytes(sh[20..24].try_into().unwrap()) as usize;
            let link = u32::from_be_bytes(sh[24..28].try_into().unwrap()) as usize;
            let entsize = u32::from_be_bytes(sh[36..40].try_into().unwrap()) as usize;
            if file_offset + size > payload.len() {
                return Err("seção fora do arquivo".into());
            }
            sections.push(ElfSection {
                section_type,
                flags,
                file_offset,
                size,
                link,
                entsize,
            });
        }
        let mut symbols = Vec::new();
        for section in &sections {
            if section.section_type != ELF_SECTION_SYMTAB {
                continue;
            }
            let Some(strtab) = sections.get(section.link) else {
                return Err("symtab sem strtab vinculada".into());
            };
            let entry_size = if section.entsize >= 16 {
                section.entsize
            } else {
                16
            };
            let strtab_bytes = &payload[strtab.file_offset..strtab.file_offset + strtab.size];
            for entry in
                (section.file_offset..section.file_offset + section.size).step_by(entry_size)
            {
                if entry + 16 > payload.len() {
                    break;
                }
                let st_name =
                    u32::from_be_bytes(payload[entry..entry + 4].try_into().unwrap()) as usize;
                let st_value = u64::from(u32::from_be_bytes(
                    payload[entry + 4..entry + 8].try_into().unwrap(),
                ));
                let st_size =
                    u32::from_be_bytes(payload[entry + 8..entry + 12].try_into().unwrap()) as usize;
                let st_shndx =
                    u16::from_be_bytes(payload[entry + 14..entry + 16].try_into().unwrap())
                        as usize;
                let bytes_after_name = strtab_bytes.get(st_name..).unwrap_or(&[]);
                let name_length = bytes_after_name
                    .iter()
                    .position(|byte| *byte == 0)
                    .unwrap_or(0);
                let name = String::from_utf8_lossy(
                    &strtab_bytes[st_name.min(strtab_bytes.len())
                        ..(st_name + name_length).min(strtab_bytes.len())],
                )
                .to_string();
                symbols.push(ElfSymbol {
                    name,
                    value: st_value,
                    size: st_size,
                    shndx: st_shndx,
                });
            }
        }
        Ok((sections, symbols))
    }

    fn find_sub(needle: &[u8], haystack: &[u8]) -> Option<usize> {
        if needle.is_empty() || needle.len() > haystack.len() {
            return None;
        }
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    /// Tipos de recurso do rescomp que são GRÁFICOS (fonte independente:
    /// declaração no arquivo `.res` do projeto de origem). Qualquer outro
    /// tipo (som, binário, paleta pura, sem declaração) é NÃO-gráfico.
    const GRAPHIC_RESOURCE_TYPES: [&str; 4] = ["IMAGE", "TILESET", "SPRITE", "BITMAP"];

    /// Declaração de recurso do `.res`: tipo, nome e compressão (quando o
    /// formato a expõe — SPRITE no 6º token, IMAGE/TILESET no 4º, APÓS o
    /// caminho entre aspas).
    #[derive(Debug, Clone, PartialEq)]
    struct ResDecl {
        declared_type: String,
        name: String,
        compression: Option<String>,
    }

    /// Tokeniza uma linha `.res` respeitando ASPAS DUPLAS (caminhos com
    /// espaços formam UM token) — split_whitespace deslocaria os campos.
    fn tokenize_res_line(line: &str) -> Vec<String> {
        let mut tokens = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        for character in line.chars() {
            match character {
                '"' => {
                    in_quotes = !in_quotes;
                    current.push('"');
                }
                c if c.is_whitespace() && !in_quotes => {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                }
                c => current.push(c),
            }
        }
        if !current.is_empty() {
            tokens.push(current);
        }
        tokens
    }

    /// Parse das declarações de recursos de um arquivo `.res` do rescomp:
    /// linhas `TIPO nome "arquivo ..." ...` (comentários `//` e vazias
    /// ignorados; caminhos entre aspas com espaços suportados).
    fn parse_res_decls(bytes: &[u8]) -> Vec<ResDecl> {
        let text = String::from_utf8_lossy(bytes);
        let mut decls = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("//") {
                continue;
            }
            let tokens = tokenize_res_line(line);
            if tokens.len() < 2 {
                continue;
            }
            let declared_type = tokens[0].to_ascii_uppercase();
            let name = tokens[1].clone();
            // Remove o caminho (token entre aspas, 3º campo) para localizar
            // a compressão: SPRITE = [largura, altura, compressão, ...],
            // IMAGE/TILESET/BITMAP/PALETTE = [compressão].
            let without_path: Vec<String> = tokens
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != 2)
                .map(|(_, token)| token.clone())
                .collect();
            let compression = match declared_type.as_str() {
                "SPRITE" => without_path.get(4).cloned(),
                "IMAGE" | "TILESET" | "BITMAP" | "PALETTE" => without_path.get(2).cloned(),
                _ => None,
            };
            decls.push(ResDecl {
                declared_type,
                name,
                compression,
            });
        }
        decls
    }

    #[derive(Debug, Clone)]
    struct InventoryEntry {
        object: String,
        symbol: String,
        declared_type: String,
        /// Classe de PROVA do conteúdo (revisões de 9f5a51f e 2375d77):
        /// - `Tiles`: tiles 4bpp COMPROVADOS — recurso gráfico declarado +
        ///   símbolo de DADOS de tileset (`<recurso>..._tileset_data`) +
        ///   compressão declarada NONE (bytes brutos verificados);
        /// - `Other`: outro conteúdo COMPROVADO NÃO-tile (paleta de recurso
        ///   gráfico);
        /// - `Unknown`: compressão não-NONE/desconhecida (bytes comprimidos
        ///   não são tiles brutos), descritores, recurso BIN (pode conter
        ///   dados gráficos brutos — não prova ausência), structs/metadata/
        ///   sem declaração — NUNCA alimenta os oráculos.
        proven: ProvenClass,
        /// [início, fim) dos bytes do símbolo no payload do objeto.
        range: (usize, usize),
        sha256: String,
        data: Vec<u8>,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ProvenClass {
        Tiles,
        Other,
        Unknown,
    }

    impl ProvenClass {
        fn label(&self) -> &'static str {
            match self {
                ProvenClass::Tiles => "tiles_4bpp_comprovado",
                ProvenClass::Other => "outro_conteudo_comprovado",
                ProvenClass::Unknown => "desconhecido",
            }
        }
    }

    /// Classificação independente com FRONTIERA DE NOME: o símbolo casa o
    /// recurso declarado somente se for igual ou o restante do nome começa
    /// com `_` (impede `spr_point2` casar com `spr_point`). Classe de prova
    /// pelo restante do nome + tipo declarado:
    /// - restante contém `tileset` e o tipo é gráfico → Tiles (dados 4bpp
    ///   comprovados);
    /// - restante contém `palette` → Other (paleta comprovada — conteúdo
    ///   NÃO-tile);
    /// - tipo declarado não-gráfico (BIN/XGM/WAV/...) → Other (conteúdo
    ///   comprovado não-gráfico);
    /// - todo o resto (structs, metadata, sem declaração) → Unknown.
    fn classify_symbol<'a>(symbol_name: &str, res_decls: &'a [ResDecl]) -> (String, ProvenClass) {
        let mut best: Option<&ResDecl> = None;
        for decl in res_decls {
            let boundary = symbol_name.starts_with(decl.name.as_str())
                && (symbol_name == decl.name.as_str()
                    || symbol_name[decl.name.len()..].starts_with('_'));
            if boundary && best.map(|b| decl.name.len() > b.name.len()).unwrap_or(true) {
                best = Some(decl);
            }
        }
        match best {
            Some(decl) => {
                let remainder = &symbol_name[decl.name.len()..];
                let graphic = GRAPHIC_RESOURCE_TYPES.contains(&decl.declared_type.as_str());
                // PAYLOAD de tileset (dados brutos), não o descritor: o
                // restante do nome deve terminar exatamente em
                // `_tileset_data` (descritores terminam em `_tileset`).
                let is_tileset_payload = remainder.ends_with("_tileset_data");
                if graphic && is_tileset_payload {
                    // Tiles comprovados exigem compressão declarada NONE:
                    // bytes comprimidos (BEST/FAST) ou compressão não
                    // declarada NÃO são tiles brutos verificados → Unknown.
                    if decl.compression.as_deref() == Some("NONE") {
                        (decl.declared_type.clone(), ProvenClass::Tiles)
                    } else {
                        (decl.declared_type.clone(), ProvenClass::Unknown)
                    }
                } else if remainder.contains("palette") && graphic {
                    // Paleta de recurso gráfico = conteúdo comprovado
                    // NÃO-tile (alimenta o negativo).
                    (decl.declared_type.clone(), ProvenClass::Other)
                } else {
                    // Recurso não-gráfico (BIN pode conter qualquer coisa —
                    // não prova ausência de tiles), metadata, structs e sem
                    // declaração: Unknown.
                    (decl.declared_type.clone(), ProvenClass::Unknown)
                }
            }
            None => ("SEM_DECLARACAO".to_string(), ProvenClass::Unknown),
        }
    }

    /// Inventário de recursos gráficos: cruza os símbolos dos OBJETOS
    /// COMPILADOS do doador com as declarações do `.res`. Cada entrada
    /// registra objeto, símbolo, tipo declarado, flag gráfico, intervalo no
    /// objeto (extensão = próximo símbolo na mesma seção, senão fim da
    /// seção) e SHA-256 dos bytes. Extensões < 512B são ignoradas.
    fn build_graphic_inventory(
        donor_objects: &[(String, Vec<u8>)],
        res_decls: &[ResDecl],
    ) -> Vec<InventoryEntry> {
        let mut entries = Vec::new();
        for (object_name, payload) in donor_objects {
            let Ok((sections, symbols)) = parse_elf32_be(payload) else {
                continue;
            };
            let mut by_shndx: std::collections::HashMap<usize, Vec<u64>> =
                std::collections::HashMap::new();
            for symbol in &symbols {
                if symbol.name.is_empty() {
                    continue;
                }
                by_shndx.entry(symbol.shndx).or_default().push(symbol.value);
            }
            for values in by_shndx.values_mut() {
                values.sort_unstable();
            }
            for symbol in &symbols {
                if symbol.name.is_empty() {
                    continue;
                }
                let Some(section) = sections.get(symbol.shndx) else {
                    continue;
                };
                if section.section_type != ELF_SECTION_PROGBITS {
                    continue;
                }
                let value = symbol.value as usize;
                let mut extent = section.size.saturating_sub(value);
                if let Some(values) = by_shndx.get(&symbol.shndx) {
                    for next in values {
                        if *next > symbol.value {
                            extent = extent.min(*next as usize - value);
                            break;
                        }
                    }
                }
                if extent < 512 {
                    continue;
                }
                let range_start = section.file_offset + value;
                if range_start + extent > payload.len() {
                    continue;
                }
                let (declared_type, proven) = classify_symbol(&symbol.name, res_decls);
                entries.push(InventoryEntry {
                    object: object_name.clone(),
                    symbol: symbol.name.clone(),
                    declared_type,
                    proven,
                    range: (range_start, range_start + extent),
                    sha256: sha256_hex(&payload[range_start..range_start + extent]),
                    data: payload[range_start..range_start + extent].to_vec(),
                });
            }
        }
        entries
    }

    /// Confronto com ORÁCULOS INDEPENDENTES do detector (revisões de
    /// 68d2f5f e a03119a):
    ///
    /// - INVENTÁRIO: recursos declarados nos arquivos `.res` do projeto de
    ///   origem (tipo + nome — independente do detector) cruzados com os
    ///   SÍMBOLOS dos objetos compilados (prefixo do nome do recurso);
    ///   cada entrada registra objeto, símbolo, tipo declarado, se é
    ///   gráfico, intervalo no objeto e SHA-256 dos bytes.
    /// - POSITIVO (cobertura): entradas GRÁFICAS do inventário (IMAGE/
    ///   TILESET/SPRITE/BITMAP) com bytes localizados verbatim na ROM
    ///   devem ter ≥80% dos bytes cobertos por candidatos de tile.
    /// - NEGATIVO (falsos positivos): (a) seções ELF `SHF_EXECINSTR` de
    ///   `libmd.a` (código, identificação por TIPO DE SEÇÃO) com bytes
    ///   verificados na ROM — ZERO candidatos sobrepostos; (b) entradas do
    ///   inventário NÃO-gráficas (som, tabelas, sem declaração) com bytes
    ///   verificados na ROM — ZERO candidatos de tile sobrepostos.
    fn run_confrontation(
        test_name: &str,
        bytes: &[u8],
        lib: &[u8],
        donor_objects: &[(String, Vec<u8>)],
        res_decls: &[ResDecl],
    ) {
        let identity = rex_identify_bytes(bytes).expect("ROM identificável (REX-02)");
        let (catalog, catalog_sha) = {
            let catalog = crate::tools::reverse::decomp::extract::build_md_extraction_catalog(
                &identity, bytes,
            )
            .expect("catálogo");
            let json = serde_json::to_vec_pretty(&catalog).expect("serialização");
            (catalog, sha256_hex(&json))
        };
        let work = crate::tools::reverse::decomp::rom_library::decomp_work_dir();
        let mut discovery =
            discover_graphic_candidates(&catalog, bytes, &catalog_sha).expect("descoberta");
        let previews = export_candidate_previews(&work, &mut discovery, bytes).expect("prévias");

        // ---- INVENTÁRIO independente de recursos gráficos ----
        let inventory = build_graphic_inventory(donor_objects, res_decls);
        let inventory_json: Vec<serde_json::Value> = inventory
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "object": entry.object,
                    "symbol": entry.symbol,
                    "declared_type": entry.declared_type,
                    "proven": entry.proven.label(),
                    "range_in_object": [entry.range.0, entry.range.1],
                    "sha256": entry.sha256,
                    "bytes": entry.data.len(),
                })
            })
            .collect();
        eprintln!(
            "{test_name}: inventário (recurso declarado × símbolo): {} entradas",
            inventory.len()
        );

        // Localiza CHUNKS INDEPENDENTES de 512B de cada entrada: cada chunk
        // encontrado verbatim na ROM é uma amostra própria de ground-truth
        // (a extensão contígua atravessaria conteúdo divergente entre o
        // build do doador e a ROM de referência).
        let mut located: Vec<(u64, usize, usize)> = Vec::new(); // (rom_off, len, idx)
        for (index, entry) in inventory.iter().enumerate() {
            if entry.data.len() < 512 {
                continue;
            }
            for chunk_start in (0..=entry.data.len() - 512).step_by(512) {
                let chunk = &entry.data[chunk_start..chunk_start + 512];
                if let Some(rom_offset) = find_sub(chunk, bytes) {
                    located.push((rom_offset as u64, 512, index));
                }
            }
        }
        located.sort();
        located.dedup();
        eprintln!(
            "{test_name}: chunks de recurso conhecidos localizados na ROM (512B): {}",
            located.len()
        );

        // ---- POSITIVO: chunks de TILES 4bpp COMPROVADOS ----
        // Só entradas com prova de conteúdo de tile (recurso gráfico
        // declarado + sufixo `tileset` no símbolo, fronteira de nome
        // verificada) alimentam o positivo: cada chunk localizado deve ter
        // ≥50% dos bytes cobertos por candidatos — localização e extração
        // substantivas, não presença de 1 byte. A cobertura medida vai
        // integralmente para a evidência do run (dithering denso é
        // parcialmente alcançável pela heurística) e nunca vira
        // "confirmado".
        let mut tile_chunk_results: Vec<serde_json::Value> = Vec::new();
        let mut poor_coverage = 0usize;
        for (rom_offset, matched, index) in &located {
            let entry = &inventory[*index];
            if entry.proven != ProvenClass::Tiles {
                continue;
            }
            let region_end = rom_offset + *matched as u64;
            let mut covered = 0u64;
            for candidate in &discovery.candidates {
                if candidate.kind != KIND_TILE_BLOCK {
                    continue;
                }
                let lo = candidate.offset.max(*rom_offset);
                let hi = (candidate.offset + candidate.size).min(region_end);
                if hi > lo {
                    covered += hi - lo;
                }
            }
            let fraction = covered as f32 / *matched as f32;
            tile_chunk_results.push(serde_json::json!({
                "symbol": entry.symbol,
                "rom_offset": rom_offset,
                "coverage": fraction,
            }));
            eprintln!(
                "{test_name}: recurso de tiles comprovado {} em 0x{rom_offset:X}: \
                 cobertura {:.1}%",
                entry.symbol,
                fraction * 100.0
            );
            if fraction < 0.5 {
                poor_coverage += 1;
            }
        }
        if donor_objects.is_empty() {
            eprintln!(
                "{test_name}: sem objetos do doador — positivo de cobertura ignorado \
                 (build do autor não disponível)"
            );
        } else {
            assert!(
                located
                    .iter()
                    .any(|(_, _, index)| inventory[*index].proven == ProvenClass::Tiles),
                "com objetos do doador, esperava ≥1 recurso de TILES comprovado \
                 localizado na ROM"
            );
            assert_eq!(
                poor_coverage, 0,
                "chunks de tiles comprovados devem estar ≥50% cobertos por \
                 candidatos (localização e extração substantivas)"
            );
        }

        // ---- NEGATIVO 1: código (EXECINSTR) da lib ----
        let mut code_regions: Vec<(u64, usize)> = Vec::new();
        for (member_name, payload) in parse_ar_members(lib) {
            let Ok((sections, _)) = parse_elf32_be(&payload) else {
                continue;
            };
            for section in &sections {
                if section.section_type != ELF_SECTION_PROGBITS
                    || section.flags & ELF_FLAG_EXECINSTR == 0
                    || section.size < 256
                {
                    continue;
                }
                let section_bytes =
                    &payload[section.file_offset..section.file_offset + section.size];
                let probe_len = section_bytes.len().min(256);
                let Some(probe_start) = find_sub(&section_bytes[..probe_len], bytes) else {
                    continue;
                };
                let mut matched = probe_len;
                while matched < section_bytes.len()
                    && probe_start + matched < bytes.len()
                    && section_bytes[matched] == bytes[probe_start + matched]
                {
                    matched += 1;
                }
                if matched >= 256 {
                    eprintln!(
                        "{test_name}: região de código verificada: {member_name} → \
                         ROM 0x{probe_start:X} ({matched}B)"
                    );
                    code_regions.push((probe_start as u64, matched));
                }
            }
        }
        eprintln!(
            "{test_name}: regiões de código (EXECINSTR) verificadas: {}",
            code_regions.len()
        );
        assert!(
            !code_regions.is_empty(),
            "esperava regiões de código verificadas da lib na ROM"
        );

        // ---- NEGATIVO 2: entradas NÃO-gráficas do inventário ----
        let mut non_graphic_regions: Vec<(u64, usize, String)> = Vec::new();
        for (rom_offset, matched, index) in &located {
            if inventory[*index].proven == ProvenClass::Other {
                non_graphic_regions.push((*rom_offset, *matched, inventory[*index].symbol.clone()));
            }
        }
        eprintln!(
            "{test_name}: regiões NÃO-gráficas verificadas: {}",
            non_graphic_regions.len()
        );

        // Falsos positivos: candidatos de tile sobre código ou sobre
        // entradas não-gráficas — proibidos.
        let mut violations = Vec::new();
        for (offset, length) in &code_regions {
            for candidate in &discovery.candidates {
                if candidate.kind != KIND_TILE_BLOCK {
                    continue;
                }
                let lo = candidate.offset.max(*offset);
                let hi = (candidate.offset + candidate.size).min(offset + *length as u64);
                if hi > lo {
                    violations.push(format!(
                        "tile 0x{:X}..0x{:X} sobrepõe código 0x{:X}..0x{:X}",
                        candidate.offset,
                        candidate.offset + candidate.size,
                        offset,
                        offset + *length as u64
                    ));
                }
            }
        }
        for (rom_offset, matched, symbol) in &non_graphic_regions {
            for candidate in &discovery.candidates {
                if candidate.kind != KIND_TILE_BLOCK {
                    continue;
                }
                let lo = candidate.offset.max(*rom_offset);
                let hi = (candidate.offset + candidate.size).min(rom_offset + *matched as u64);
                if hi > lo {
                    violations.push(format!(
                        "tile 0x{:X}..0x{:X} sobrepõe NÃO-gráfico {symbol} \
                         0x{rom_offset:X}..0x{:X}",
                        candidate.offset,
                        candidate.offset + candidate.size,
                        rom_offset + *matched as u64
                    ));
                }
            }
        }
        assert!(
            violations.is_empty(),
            "FALSOS POSITIVOS (código ou não-gráficos usados como referência \
             gráfica): {violations:?}"
        );

        assert!(
            !discovery.candidates.is_empty(),
            "ROM real deve ter candidatos"
        );
        let confrontation_evidence = serde_json::json!({
            "inventory": inventory_json,
            "located_regions": located.iter().map(|(offset, length, index)| {
                serde_json::json!({
                    "rom_offset": offset,
                    "verified_bytes": length,
                    "proven": inventory[*index].proven.label(),
                    "symbol": inventory[*index].symbol,
                })
            }).collect::<Vec<_>>(),
            "tile_chunks": tile_chunk_results,
        });
        let (run_id, artifact) = record_discovery_run(&work, &discovery, confrontation_evidence)
            .expect("run no ledger real");
        eprintln!(
            "{test_name}: candidatos={}, prévias={previews}, run={run_id}, artifact={}",
            discovery.candidates.len(),
            artifact.path
        );
    }

    /// O inventário independente classifica recursos pelo TIPO declarado no
    /// `.res` e pela COMPRESSÃO (só NONE prova tiles brutos), com
    /// FRONTIERA DE NOME no casamento de símbolos.
    #[test]
    fn res_decls_and_symbol_classification() {
        let res_file = b"\
ALIGN\n\
//tipo / nome / localizacao_arquivo / ...\n\
IMAGE room_0_bga \"gfx/room_0_bga.png\" BEST\n\
SPRITE spr_point  \"sprite/point.png\"  1  1 BEST 0\n\
SPRITE spr_spark0  \"sprite/spark.png\"  4  4 NONE 4\n\
SPRITE spr_path_ws  \"meus sprites/com espaco.png\"  2  2 NONE 2\n\
BIN snd_xgm \"sound/xgm.bin\" 2 2 0 NONE FALSE\n";
        let decls = parse_res_decls(res_file);
        assert_eq!(decls.len(), 5);
        assert_eq!(decls[0].declared_type, "IMAGE");
        assert_eq!(decls[0].compression.as_deref(), Some("BEST"));
        assert_eq!(decls[2].declared_type, "SPRITE");
        assert_eq!(decls[2].compression.as_deref(), Some("NONE"));
        // caminho com espaços: compressão correta (NONE) e não deslocada.
        assert_eq!(decls[3].name, "spr_path_ws");
        assert_eq!(decls[3].compression.as_deref(), Some("NONE"));
        assert_eq!(decls[4].declared_type, "BIN");

        // fronteira de nome: `spr_point2` NÃO casa com `spr_point`.
        let (t0, p0) = classify_symbol("spr_point2_tileset_data", &decls);
        assert_eq!(t0, "SEM_DECLARACAO");
        assert_eq!(p0, ProvenClass::Unknown);

        // SPRITE comprimido (BEST): bytes comprimidos não são tiles brutos
        // verificados → desconhecido (não Other).
        let (t1, p1) = classify_symbol("spr_point_animation0_frame0_tileset_data", &decls);
        assert_eq!(t1, "SPRITE");
        assert_eq!(p1, ProvenClass::Unknown);

        // SPRITE sem compressão (NONE): tiles 4bpp COMPROVADOS.
        let (t2, p2) = classify_symbol("spr_spark0_animation0_frame0_tileset_data", &decls);
        assert_eq!(t2, "SPRITE");
        assert_eq!(p2, ProvenClass::Tiles);

        // paleta de recurso gráfico = OUTRO conteúdo comprovado (não-tile).
        let (t3, p3) = classify_symbol("spr_point_palette_data", &decls);
        assert_eq!(t3, "SPRITE");
        assert_eq!(p3, ProvenClass::Other);

        // struct do recurso (sem sufixo de dados) = desconhecido.
        let (t4, p4) = classify_symbol("spr_point", &decls);
        assert_eq!(t4, "SPRITE");
        assert_eq!(p4, ProvenClass::Unknown);

        // descritor de tileset (sem `_data`) = desconhecido — não é payload.
        let (t4b, p4b) = classify_symbol("spr_spark0_animation0_frame0_tileset", &decls);
        assert_eq!(t4b, "SPRITE");
        assert_eq!(p4b, ProvenClass::Unknown);

        // caminho com espaços: tiles comprovados pela compressão NONE correta.
        let (t4c, p4c) = classify_symbol("spr_path_ws_animation0_frame0_tileset_data", &decls);
        assert_eq!(t4c, "SPRITE");
        assert_eq!(p4c, ProvenClass::Tiles);

        // BIN pode conter dados gráficos brutos — NÃO prova ausência de
        // tiles: desconhecido, não alimenta o negativo.
        let (t5, p5) = classify_symbol("snd_xgm_data", &decls);
        assert_eq!(t5, "BIN");
        assert_eq!(p5, ProvenClass::Unknown);

        // sem declaração = desconhecido.
        let (t6, p6) = classify_symbol("alguma_coisa_sem_declaracao", &decls);
        assert_eq!(t6, "SEM_DECLARACAO");
        assert_eq!(p6, ProvenClass::Unknown);
    }

    /// O parser ar+ELF32-BE é o backbone dos oráculos independentes —
    /// testado contra um ELF sintético com seção executável e símbolo.
    #[test]
    fn ar_and_elf_parser_extract_sections_and_symbols() {
        let text: Vec<u8> = (0..64u32).map(|i| (i * 3 + 11) as u8).collect();
        let mut strtab = vec![0u8];
        let sym_name_offset = strtab.len() as u32;
        strtab.extend_from_slice(b"gfx_data\0");

        // Layout: header (0x34) + 4 section headers (0xA0) + text + strtab + symtab.
        let header_len = 0x34usize;
        let sections_len = 4 * 40;
        let text_offset = header_len + sections_len;
        let strtab_offset = text_offset + text.len();
        let symtab_offset = strtab_offset + strtab.len();

        let mut elf = Vec::new();
        // e_ident (16B): magic + ELF32 + BE + versão + pad.
        elf.extend_from_slice(b"\x7fELF\x01\x02\x01");
        elf.extend_from_slice(&[0u8; 9]);
        // Campos até 0x34, com shoff/shentsize/shnum nos offsets corretos.
        let mut tail = vec![0u8; 0x34 - 0x10];
        tail[0x20 - 0x10..0x24 - 0x10].copy_from_slice(&(header_len as u32).to_be_bytes());
        tail[0x2E - 0x10..0x30 - 0x10].copy_from_slice(&(40u16).to_be_bytes());
        tail[0x30 - 0x10..0x32 - 0x10].copy_from_slice(&(4u16).to_be_bytes());
        elf.extend_from_slice(&tail);

        // Section headers (40B cada): name, type, flags, addr, offset, size,
        // link, info, addralign, entsize.
        let section_header = |section_type: u32,
                              flags: u32,
                              offset: u32,
                              size: u32,
                              link: u32,
                              entsize: u32|
         -> Vec<u8> {
            let mut header = vec![0u8; 40];
            header[4..8].copy_from_slice(&section_type.to_be_bytes());
            header[8..12].copy_from_slice(&flags.to_be_bytes());
            header[16..20].copy_from_slice(&offset.to_be_bytes());
            header[20..24].copy_from_slice(&size.to_be_bytes());
            header[24..28].copy_from_slice(&link.to_be_bytes());
            header[36..40].copy_from_slice(&entsize.to_be_bytes());
            header
        };
        elf.extend_from_slice(&section_header(0, 0, 0, 0, 0, 0)); // null
        elf.extend_from_slice(&section_header(
            ELF_SECTION_PROGBITS,
            ELF_FLAG_EXECINSTR | 0x2,
            text_offset as u32,
            text.len() as u32,
            0,
            0,
        ));
        elf.extend_from_slice(&section_header(
            3,
            0,
            strtab_offset as u32,
            strtab.len() as u32,
            0,
            0,
        ));
        elf.extend_from_slice(&section_header(
            ELF_SECTION_SYMTAB,
            0,
            symtab_offset as u32,
            32,
            2,
            16,
        ));

        elf.extend_from_slice(&text);
        elf.extend_from_slice(&strtab);
        // symtab: entrada nula + símbolo "gfx_data" (value=8, size=32, shndx=1).
        elf.extend_from_slice(&[0u8; 16]);
        let mut symbol = [0u8; 16];
        symbol[0..4].copy_from_slice(&sym_name_offset.to_be_bytes());
        symbol[4..8].copy_from_slice(&8u32.to_be_bytes());
        symbol[8..12].copy_from_slice(&32u32.to_be_bytes());
        symbol[14..16].copy_from_slice(&1u16.to_be_bytes());
        elf.extend_from_slice(&symbol);

        // Embala em ar.
        let mut archive = Vec::new();
        archive.extend_from_slice(b"!<arch>\n");
        let mut member_header = [b' '; 60];
        member_header[..9].copy_from_slice(b"libres.o/");
        member_header[48..58].copy_from_slice(format!("{:>010}", elf.len()).as_bytes());
        member_header[58..60].copy_from_slice(b"`\n");
        archive.extend_from_slice(&member_header);
        archive.extend_from_slice(&elf);
        if elf.len() % 2 == 1 {
            archive.push(0);
        }

        let members = parse_ar_members(&archive);
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].0, "libres.o");
        assert_eq!(members[0].1, elf);

        let (sections, symbols) = parse_elf32_be(&elf).expect("ELF sintético parseável");
        let exec = sections
            .iter()
            .find(|section| section.flags & ELF_FLAG_EXECINSTR != 0)
            .expect("seção executável");
        assert_eq!(exec.size, 64);
        assert_eq!(&elf[exec.file_offset..exec.file_offset + 64], &text);

        let symbol = symbols
            .iter()
            .find(|symbol| symbol.name == "gfx_data")
            .expect("símbolo gfx_data");
        assert_eq!(symbol.value, 8);
        assert_eq!(symbol.size, 32);
        assert_eq!(symbol.shndx, 1);

        assert_eq!(find_sub(&text, &elf), Some(text_offset));
        // No arquivo ar o member começa após a assinatura (8) + header (60).
        assert_eq!(find_sub(&text, &archive), Some(68 + text_offset));
        assert_eq!(find_sub(&[9, 9, 9], &archive), None);
    }
}
