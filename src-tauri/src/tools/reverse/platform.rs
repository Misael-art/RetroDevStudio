use std::path::Path;

use super::manifest::{NormalizationStep, RomContainerInfo, RomHeader, RomSegment};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedRom {
    pub target: String,
    pub source_path: String,
    pub bytes: Vec<u8>,
    pub detected_format: String,
    pub stripped_header_bytes: usize,
    pub header: RomHeader,
    pub mapper: String,
    pub special_chips: Vec<String>,
    pub segments: Vec<RomSegment>,
    pub entry_points: Vec<u32>,
    pub trace_note: String,
    /// REX-02: contêiner de origem e passos de normalização aplicados sobre os
    /// bytes originais (todos reversíveis; desfazer restitui o SHA original).
    pub container: Option<RomContainerInfo>,
    pub normalization: Vec<NormalizationStep>,
}

/// REX-02: variante física de uma imagem Mega Drive, identificada por
/// conteúdo — nunca pela extensão do arquivo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MdVariant {
    /// Dados crus (`.bin`/`.md`/`.gen` compartilham o mesmo layout).
    Raw,
    /// Dump intercalado `.smd` em blocos de 512 bytes, com ou sem header
    /// de 512 bytes.
    SmdInterleaved { header_len: usize },
    /// Ordem de bytes trocada em palavras de 16 bits.
    ByteSwapped16,
}

impl MdVariant {
    pub fn label(&self) -> &'static str {
        match self {
            MdVariant::Raw => "raw",
            MdVariant::SmdInterleaved { header_len: 0 } => "smd_interleaved",
            MdVariant::SmdInterleaved { .. } => "smd_interleaved_512",
            MdVariant::ByteSwapped16 => "byteswapped16",
        }
    }
}

/// Falhas de identificação REX-02, com mensagem acionável por caso.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MdIdentifyError {
    /// Arquivo pequeno demais para qualquer variante MD.
    TooSmall,
    /// Mais de uma variante produz um header SEGA plausível; seleção seria
    /// arbitrária.
    Ambiguous(Vec<&'static str>),
    /// Nenhuma variante casa: fora do perfil MD/cartucho.
    OutOfProfile,
    /// A variante casa, mas o tamanho é inconsistente com o formato.
    Truncated(String),
}

impl MdIdentifyError {
    pub fn message(&self) -> String {
        match self {
            MdIdentifyError::TooSmall => {
                "imagem pequena demais para conter um header Mega Drive (minimo 0x110 bytes). \
                 Se for um contêiner (zip/7z), extraia o membro explicitamente antes."
                    .to_string()
            }
            MdIdentifyError::Ambiguous(variants) => format!(
                "imagem ambigua: as variantes {variants:?} produzem headers SEGA plausiveis; \
                 seleção arbitrária recusada"
            ),
            MdIdentifyError::OutOfProfile => {
                "imagem fora do perfil Mega Drive/cartucho: nenhuma variante conhecida \
                 (raw, smd intercalado, byteswap 16) produz um header SEGA valido"
                    .to_string()
            }
            MdIdentifyError::Truncated(detail) => {
                format!("imagem truncada ou inconsistente: {detail}")
            }
        }
    }
}

/// Frame de interleave SMD: 16 KiB, conforme o formato padrão (referência
/// primária Genesis Plus GX `core/loadrom.c`, `deinterleave_block`).
const SMD_FRAME: usize = 0x4000;
const SMD_HALF: usize = SMD_FRAME / 2;
const SMD_HEADER: usize = 512;

/// Header SEGA presente em bytes normalizados (0x100..0x110 contém "SEGA").
fn md_has_sega_header(bytes: &[u8]) -> bool {
    bytes.len() >= 0x110 && String::from_utf8_lossy(&bytes[0x100..0x110]).contains("SEGA")
}

/// Desfaz o interleave SMD no formato padrão: dentro de cada frame de 16 KiB
/// a primeira metade do dump guarda os bytes de posição ÍMPAR da ROM e a
/// segunda metade os de posição PAR. Idêntico a `deinterleave_block` do
/// Genesis Plus GX: `out[2i] = frame[0x2000 + i]; out[2i + 1] = frame[i]`.
pub fn deinterleave_smd(payload: &[u8]) -> Option<Vec<u8>> {
    if payload.len() < SMD_FRAME || !payload.len().is_multiple_of(SMD_FRAME) {
        return None;
    }
    let mut out = vec![0u8; payload.len()];
    for (frame_in, frame_out) in payload
        .chunks_exact(SMD_FRAME)
        .zip(out.chunks_exact_mut(SMD_FRAME))
    {
        for i in 0..SMD_HALF {
            frame_out[i * 2] = frame_in[SMD_HALF + i];
            frame_out[i * 2 + 1] = frame_in[i];
        }
    }
    Some(out)
}

/// Inverso exato de [`deinterleave_smd`]: reconstrói o dump intercalado no
/// formato padrão (primeira metade do frame = bytes ímpares, segunda =
/// pares). Consumido por `rex_undo_normalization` (loader) e por testes.
#[allow(dead_code)]
pub fn interleave_smd(normalized: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; normalized.len()];
    for (frame_in, frame_out) in normalized
        .chunks_exact(SMD_FRAME)
        .zip(out.chunks_exact_mut(SMD_FRAME))
    {
        for i in 0..SMD_HALF {
            frame_out[SMD_HALF + i] = frame_in[i * 2];
            frame_out[i] = frame_in[i * 2 + 1];
        }
    }
    out
}

/// Troca os bytes dentro de cada palavra de 16 bits; a operação é a própria
/// inversa. Tamanho ímpar não é variante válida.
pub fn swap_bytes16(payload: &[u8]) -> Option<Vec<u8>> {
    if !payload.len().is_multiple_of(2) {
        return None;
    }
    let mut out = payload.to_vec();
    for pair in out.chunks_exact_mut(2) {
        pair.swap(0, 1);
    }
    Some(out)
}

fn smd_candidate(raw: &[u8], header_len: usize) -> Option<Vec<u8>> {
    let payload = raw.get(header_len..)?;
    deinterleave_smd(payload)
}

/// Identifica a variante MD por conteúdo e devolve os bytes normalizados.
/// Regras (alinhadas ao Genesis Plus GX `loadrom.c`): um dump SMD com header
/// tem tamanho múltiplo de 512 com contagem ÍMPAR de blocos de 512 (o header
/// extra torna a contagem ímpar) e o payload pós-header é efêmero em frames
/// de 16 KiB; SEM header, o tamanho é múltiplo de 16 KiB. Em ambos, a ROM raw
/// NÃO contém "SEGA" em 0x100 — se contém, é raw (precedência GPGX). Exatamente
/// um candidato deve produzir header SEGA; mais de um é ambíguo (erro), nenhum
/// está fora do perfil. Conteúdo reconhecido com o último frame de 16 KiB
/// incompleto é erro de truncamento. O fim de ROM declarado no header NÃO é
/// sinal de truncamento: dumps reais declaram endereços além do arquivo
/// (HAMOOPIG declara 0xFFFFF para 0xE0000 bytes) — isso vira nota, via
/// [`md_size_note`]. Entradas abaixo do header canônico de 0x200 bytes são
/// rejeitadas antes de qualquer indexação de campo (REX-REV-02).
pub fn identify_md(raw: &[u8]) -> Result<(MdVariant, Vec<u8>), MdIdentifyError> {
    if raw.len() < 0x200 {
        return Err(MdIdentifyError::TooSmall);
    }
    let sega_raw = md_has_sega_header(raw);

    // Truncamento provável e verificável: prefixo de frames completos de
    // 16 KiB reconhecido como SMD com resto de frame incompleto no fim.
    if !sega_raw {
        for start in [0usize, SMD_HEADER] {
            if raw.len() <= start {
                continue;
            }
            let available_frames = (raw.len() - start) / SMD_FRAME;
            if available_frames == 0 || (raw.len() - start).is_multiple_of(SMD_FRAME) {
                continue;
            }
            let complete = start + available_frames * SMD_FRAME;
            let Some(bytes) = deinterleave_smd(&raw[start..complete]) else {
                continue;
            };
            if md_has_sega_header(&bytes) {
                return Err(MdIdentifyError::Truncated(format!(
                    "dump intercalado SMD termina com frame de {SMD_FRAME:#x} bytes incompleto \
                     ({} bytes além de {available_frames} frame(s) completo(s))",
                    raw.len() - complete
                )));
            }
        }
    }

    let mut candidates: Vec<(MdVariant, Vec<u8>)> = Vec::new();
    if sega_raw {
        candidates.push((MdVariant::Raw, raw.to_vec()));
    }
    // SMD com header de 512: múltiplo de 512 com contagem ímpar (GPGX) E o
    // deinterleave precisa produzir um header SEGA válido.
    if !sega_raw && raw.len().is_multiple_of(SMD_HEADER) && (raw.len() / SMD_HEADER) % 2 == 1 {
        if let Some(bytes) = smd_candidate(raw, SMD_HEADER) {
            if md_has_sega_header(&bytes) {
                candidates.push((
                    MdVariant::SmdInterleaved {
                        header_len: SMD_HEADER,
                    },
                    bytes,
                ));
            }
        }
    }
    // SMD sem header: múltiplo exato de 16 KiB cujo deinterleave produz um
    // header SEGA válido (extensão tolerante; GPGX só reconhece a forma com
    // header, mas dumps sem header existem).
    if !sega_raw && raw.len().is_multiple_of(SMD_FRAME) {
        if let Some(bytes) = smd_candidate(raw, 0) {
            if md_has_sega_header(&bytes) {
                candidates.push((MdVariant::SmdInterleaved { header_len: 0 }, bytes));
            }
        }
    }
    if let Some(bytes) = swap_bytes16(raw) {
        if md_has_sega_header(&bytes) {
            candidates.push((MdVariant::ByteSwapped16, bytes));
        }
    }

    match candidates.len() {
        0 => Err(MdIdentifyError::OutOfProfile),
        1 => Ok(candidates.remove(0)),
        _ => Err(MdIdentifyError::Ambiguous(
            candidates
                .iter()
                .map(|(variant, _)| variant.label())
                .collect(),
        )),
    }
}

/// Nota de consistência de tamanho: compara o fim de ROM declarado no header
/// (0x1A4, inclusivo) com o tamanho real. Divergência é comum em dumps reais
/// e fica registrada como nota — nunca como erro de identificação.
#[allow(dead_code)]
pub fn md_size_note(normalized: &[u8]) -> Option<String> {
    if normalized.len() < 0x1A8 {
        return None;
    }
    let rom_end = u32::from_be_bytes([
        normalized[0x1A4],
        normalized[0x1A5],
        normalized[0x1A6],
        normalized[0x1A7],
    ]) as usize;
    if rom_end >= normalized.len() {
        Some(format!(
            "header declara fim de ROM em 0x{rom_end:X}, arquivo tem 0x{:X} bytes; \
             divergência comum em dumps reais, registrada sem bloquear identificação",
            normalized.len()
        ))
    } else {
        None
    }
}

/// Passos de normalização (raw -> bytes normalizados) com proveniência por
/// SHA-256. Todo passo desta fatia é reversível.
pub fn md_normalization_steps(
    original_sha256: &str,
    original: &[u8],
    variant: MdVariant,
    normalized_sha256: &str,
) -> Vec<NormalizationStep> {
    match variant {
        MdVariant::Raw => Vec::new(),
        MdVariant::SmdInterleaved { header_len } => {
            let mut steps = Vec::new();
            if header_len > 0 {
                steps.push(NormalizationStep {
                    name: "strip_smd_header".to_string(),
                    parameters: format!("header_len={header_len}"),
                    input_sha256: original_sha256.to_string(),
                    output_sha256: crate::core::rom_mastering::sha256_hex(&original[header_len..]),
                    reversible: true,
                });
            }
            steps.push(NormalizationStep {
                name: "deinterleave_smd_frame16k".to_string(),
                parameters: format!("frame={SMD_FRAME:#x}"),
                input_sha256: steps
                    .last()
                    .map(|step| step.output_sha256.clone())
                    .unwrap_or_else(|| original_sha256.to_string()),
                output_sha256: normalized_sha256.to_string(),
                reversible: true,
            });
            steps
        }
        MdVariant::ByteSwapped16 => {
            vec![NormalizationStep {
                name: "swap_bytes16".to_string(),
                parameters: String::new(),
                input_sha256: original_sha256.to_string(),
                output_sha256: normalized_sha256.to_string(),
                reversible: true,
            }]
        }
    }
}

pub trait ReversePlatformAdapter {
    fn detect_score(&self, rom_path: &Path, raw_bytes: &[u8]) -> u8;
    fn load(&self, rom_path: &Path, raw_bytes: &[u8]) -> Result<LoadedRom, String>;
}

pub struct MegaDriveAdapter;
pub struct SnesAdapter;

impl MegaDriveAdapter {
    fn trim_ascii(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes)
            .trim_matches(char::from(0))
            .trim()
            .to_string()
    }
}

impl ReversePlatformAdapter for MegaDriveAdapter {
    fn detect_score(&self, rom_path: &Path, raw_bytes: &[u8]) -> u8 {
        // REX-02: identificação por conteúdo tem prioridade absoluta —
        // variante MD reconhecida vence qualquer heurística de outra família.
        if identify_md(raw_bytes).is_ok() {
            return 140;
        }
        let mut score = 0u8;
        let ext = rom_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(ext.as_str(), "bin" | "gen" | "md") {
            score = score.saturating_add(30);
        }
        if raw_bytes.len() >= 0x110 {
            let console = &raw_bytes[0x100..0x110];
            if String::from_utf8_lossy(console).contains("SEGA") {
                score = score.saturating_add(70);
            }
        }
        score
    }

    fn load(&self, rom_path: &Path, raw_bytes: &[u8]) -> Result<LoadedRom, String> {
        // REX-02: identifica a variante por conteúdo e normaliza uma única vez.
        let (variant, bytes) = identify_md(raw_bytes).map_err(|error| error.message())?;
        let original_sha256 = crate::core::rom_mastering::sha256_hex(raw_bytes);
        let normalized_sha256 = crate::core::rom_mastering::sha256_hex(&bytes);
        let normalization = md_normalization_steps(
            &original_sha256,
            raw_bytes,
            variant.clone(),
            &normalized_sha256,
        );
        let stripped_header_bytes = match &variant {
            MdVariant::SmdInterleaved { header_len } => *header_len,
            _ => 0,
        };

        let console_name = Self::trim_ascii(&bytes[0x100..0x110]);
        let internal_title = Self::trim_ascii(&bytes[0x150..0x180]);
        let version = Some(Self::trim_ascii(&bytes[0x18C..0x18E]));
        let region = Some(Self::trim_ascii(&bytes[0x1F0..0x1F3]));
        let entry_point = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);

        let mut segments = vec![
            RomSegment {
                start: 0,
                end: 0x100,
                kind: "vectors".to_string(),
                label: "68k vectors".to_string(),
                bank_index: None,
                confidence: 100,
            },
            RomSegment {
                start: 0x100,
                end: 0x200,
                kind: "header".to_string(),
                label: "Mega Drive header".to_string(),
                bank_index: None,
                confidence: 100,
            },
        ];

        for (index, start) in (0..bytes.len()).step_by(0x10000).enumerate() {
            let end = bytes.len().min(start + 0x10000);
            segments.push(RomSegment {
                start: start as u32,
                end: end as u32,
                kind: "bank".to_string(),
                label: format!("ROM bank {:03}", index),
                bank_index: Some(index as u32),
                confidence: 90,
            });
        }

        let normalized_len = bytes.len();
        let clamped_entry = entry_point.min(normalized_len.saturating_sub(1) as u32);
        Ok(LoadedRom {
            target: "megadrive".to_string(),
            source_path: rom_path.to_string_lossy().to_string(),
            bytes,
            detected_format: rom_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("bin")
                .to_ascii_lowercase(),
            stripped_header_bytes,
            header: RomHeader {
                console_name,
                internal_title,
                region,
                version,
                publisher: None,
                entry_point: Some(entry_point),
            },
            mapper: "linear_rom".to_string(),
            special_chips: Vec::new(),
            segments,
            entry_points: vec![clamped_entry],
            trace_note: "Trace Libretro ainda nao instrumentado para Mega Drive nesta wave; manifesto preparado para overlay futuro.".to_string(),
            container: Some(RomContainerInfo {
                kind: "plain_file".to_string(),
                member: None,
                note: format!(
                    "variante fisica identificada por conteudo: {} (extensao ignorada)",
                    variant.label()
                ),
            }),
            normalization,
        })
    }
}

#[derive(Debug, Clone)]
struct SnesHeaderCandidate {
    offset: usize,
    mapper: String,
    title: String,
    region: Option<String>,
    version: Option<String>,
    reset_vector: u16,
    special_chips: Vec<String>,
    score: u8,
}

impl SnesAdapter {
    fn score_header(bytes: &[u8], offset: usize, mapper: &str) -> Option<SnesHeaderCandidate> {
        if offset + 0x40 > bytes.len() {
            return None;
        }

        let title_bytes = &bytes[offset..offset + 21];
        let printable = title_bytes
            .iter()
            .filter(|value| matches!(**value, 32..=126))
            .count();
        let title = String::from_utf8_lossy(title_bytes)
            .trim_matches(char::from(0))
            .trim()
            .to_string();
        let country = bytes[offset + 0x19];
        let rom_type = bytes[offset + 0x16];
        let version = Some(format!("{:02X}", bytes[offset + 0x1B]));
        let reset_vector = u16::from_le_bytes([bytes[offset + 0x3C], bytes[offset + 0x3D]]);

        let mut score = printable as u8;
        if !title.is_empty() {
            score = score.saturating_add(20);
        }
        if reset_vector >= 0x8000 {
            score = score.saturating_add(25);
        }
        if mapper == "lorom" || mapper == "hirom" {
            score = score.saturating_add(10);
        }

        let mut special_chips = Vec::new();
        match rom_type {
            0x34 | 0x35 => special_chips.push("SA-1".to_string()),
            0x13..=0x15 => special_chips.push("SuperFX".to_string()),
            _ => {}
        }

        Some(SnesHeaderCandidate {
            offset,
            mapper: mapper.to_string(),
            title,
            region: Some(format!("{:02X}", country)),
            version,
            reset_vector,
            special_chips,
            score,
        })
    }

    fn reset_vector_to_offset(candidate: &SnesHeaderCandidate) -> u32 {
        match candidate.mapper.as_str() {
            "hirom" | "exhirom" => candidate.reset_vector as u32,
            _ => (candidate.reset_vector as u32) & 0x7FFF,
        }
    }
}

impl ReversePlatformAdapter for SnesAdapter {
    fn detect_score(&self, rom_path: &Path, raw_bytes: &[u8]) -> u8 {
        let ext = rom_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mut score = if matches!(ext.as_str(), "smc" | "sfc" | "fig") {
            35
        } else {
            0
        };

        let stripped = if raw_bytes.len() % 0x8000 == 512 && raw_bytes.len() > 512 {
            &raw_bytes[512..]
        } else {
            raw_bytes
        };

        for (offset, mapper) in [
            (0x7FC0usize, "lorom"),
            (0xFFC0usize, "hirom"),
            (0x40FFC0usize, "exhirom"),
        ] {
            if let Some(candidate) = Self::score_header(stripped, offset, mapper) {
                score = score.max(candidate.score.saturating_add(25));
            }
        }

        score
    }

    fn load(&self, rom_path: &Path, raw_bytes: &[u8]) -> Result<LoadedRom, String> {
        let (bytes, stripped_header_bytes) =
            if raw_bytes.len() % 0x8000 == 512 && raw_bytes.len() > 512 {
                (raw_bytes[512..].to_vec(), 512usize)
            } else {
                (raw_bytes.to_vec(), 0usize)
            };

        let mut best = None;
        for (offset, mapper) in [
            (0x7FC0usize, "lorom"),
            (0xFFC0usize, "hirom"),
            (0x40FFC0usize, "exhirom"),
        ] {
            if let Some(candidate) = Self::score_header(&bytes, offset, mapper) {
                if best
                    .as_ref()
                    .map(|current: &SnesHeaderCandidate| candidate.score > current.score)
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }

        let header =
            best.ok_or_else(|| "Nao foi possivel reconhecer um header SNES valido.".to_string())?;
        let entry_point =
            Self::reset_vector_to_offset(&header).min(bytes.len().saturating_sub(1) as u32);
        let bank_size = if header.mapper == "lorom" {
            0x8000
        } else {
            0x10000
        };

        let mut segments = vec![RomSegment {
            start: header.offset as u32,
            end: (header.offset + 0x40) as u32,
            kind: "header".to_string(),
            label: format!("SNES header ({})", header.mapper),
            bank_index: None,
            confidence: 100,
        }];
        for (index, start) in (0..bytes.len()).step_by(bank_size).enumerate() {
            let end = bytes.len().min(start + bank_size);
            segments.push(RomSegment {
                start: start as u32,
                end: end as u32,
                kind: "bank".to_string(),
                label: format!("ROM bank {:03}", index),
                bank_index: Some(index as u32),
                confidence: 90,
            });
        }

        Ok(LoadedRom {
            target: "snes".to_string(),
            source_path: rom_path.to_string_lossy().to_string(),
            bytes,
            detected_format: rom_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("sfc")
                .to_ascii_lowercase(),
            stripped_header_bytes,
            header: RomHeader {
                console_name: "SNES".to_string(),
                internal_title: header.title,
                region: header.region,
                version: header.version,
                publisher: None,
                entry_point: Some(entry_point),
            },
            mapper: header.mapper,
            special_chips: header.special_chips,
            segments,
            entry_points: vec![entry_point],
            trace_note: "Trace Libretro ainda nao instrumentado para SNES nesta wave; manifesto preparado para overlay futuro.".to_string(),
            container: Some(RomContainerInfo {
                kind: "plain_file".to_string(),
                member: None,
                note: "contêiner SNES cru; copiador header removido quando detectado".to_string(),
            }),
            normalization: Vec::new(),
        })
    }
}
