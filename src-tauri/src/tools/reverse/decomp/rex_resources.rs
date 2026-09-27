//! Cadeia de recurso comprimido REX v1 (CONTRATOS §5).
//!
//! Identificação estrutural **assistida e rotulada**: um header TileSet do
//! SGDK (`{u16 compression; u16 numTile; u32 *tiles}`) declara o codec e o
//! tamanho exato esperado (`numTile * 32`), e o codec declarado é o contrato
//! efetivamente usado no decode — LZ4W com dicionário = prefixo da ROM antes do
//! stream, aPLib raw com o histórico do próprio stream, que se autodelimita no
//! EOD. Nenhum caminho escolhe decoder ou encoder por suposição. Não é detecção
//! automática geral e não assume mapeamento linear entre bytes decodificados e
//! offsets da ROM.
//!
//! A reinserção canônica é uma **transação** (`reinsert_transaction`,
//! `reinsert_transaction_aplib`): só produz cópia modificada se identidade da
//! ROM, evidência do recurso, limites de espaço e preservação de dependentes
//! passarem. A verificação de dependentes cobre o conjunto analisável declarado
//! no resultado (recursos verificados dos dois codecs nesta ROM) — os limites
//! estão no resultado, nunca apresentados como equivalência global do jogo.

use super::rex_aplib::{aplib_decode, aplib_encode, AplibEncodeLimits, AplibLimits};
use super::rex_codecs::{lz4w_decode_with_dictionary, CodecError, Lz4wLimits};

/// Codec declarado por um header TileSet do SGDK.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TilesetCompression {
    None,
    Aplib,
    Lz4w,
}

impl TilesetCompression {
    /// Rótulo estável do codec REAL de um recurso verificado: aparece na UI e no
    /// nome dos artefatos, para nenhum caminho (nem teste, nem operador) ter que
    /// pressupor o codec a partir do offset.
    pub fn as_str(&self) -> &'static str {
        match self {
            TilesetCompression::None => "none",
            TilesetCompression::Aplib => "aplib",
            TilesetCompression::Lz4w => "lz4w",
        }
    }
}

/// Candidato estrutural de recurso tileset na ROM.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilesetCandidate {
    /// Offset do header TileSet na ROM.
    pub header_offset: usize,
    pub compression: TilesetCompression,
    pub num_tiles: usize,
    /// Offset do stream (ponteiro do header, endereçamento MD linear).
    pub stream_offset: usize,
    /// Tamanho esperado dos dados decodificados (`numTile * 32`).
    pub expected_len: usize,
}

fn parse_tileset_header(rom: &[u8], header_offset: usize) -> Option<TilesetCandidate> {
    if header_offset + 8 > rom.len() {
        return None;
    }
    let compression = u16::from_be_bytes([rom[header_offset], rom[header_offset + 1]]);
    let num_tiles = u16::from_be_bytes([rom[header_offset + 2], rom[header_offset + 3]]) as usize;
    let ptr = u32::from_be_bytes([
        rom[header_offset + 4],
        rom[header_offset + 5],
        rom[header_offset + 6],
        rom[header_offset + 7],
    ]) as usize;
    let compression = match compression {
        0 => TilesetCompression::None,
        1 => TilesetCompression::Aplib,
        2 => TilesetCompression::Lz4w,
        _ => return None,
    };
    if num_tiles == 0 || num_tiles > 2048 || ptr == 0 || ptr >= rom.len() || !ptr.is_multiple_of(2)
    {
        return None;
    }
    Some(TilesetCandidate {
        header_offset,
        compression,
        num_tiles,
        stream_offset: ptr,
        expected_len: num_tiles * 32,
    })
}

/// Varre a ROM por headers TileSet estruturalmente plausíveis.
///
/// Custo linear no tamanho da ROM com passo 2 (headers são word-aligned).
/// Candidatos são HIPÓTESES: só viram recursos verificados após o decode
/// bater com o tamanho declarado.
pub fn scan_tileset_headers(rom: &[u8]) -> Vec<TilesetCandidate> {
    let mut out = Vec::new();
    if rom.len() < 8 {
        return out;
    }
    for header_offset in (0..rom.len() - 8).step_by(2) {
        if let Some(candidate) = parse_tileset_header(rom, header_offset) {
            out.push(candidate);
        }
    }
    out
}

/// Recurso LZ4W verificado: o stream decodifica exatamente para o tamanho
/// declarado pelo header com o dicionário = prefixo da ROM.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedLz4wResource {
    pub candidate: TilesetCandidate,
    pub decoded: Vec<u8>,
    pub bytes_consumed: usize,
}

/// Verifica um candidato LZ4W: decode com dicionário e tamanho exato.
pub fn verify_lz4w_resource(
    rom: &[u8],
    candidate: &TilesetCandidate,
    limits: &Lz4wLimits,
) -> Result<VerifiedLz4wResource, CodecError> {
    if candidate.compression != TilesetCompression::Lz4w {
        return Err(CodecError::new(
            "invalid_reference",
            "verificação LZ4W exige header com compression=2",
        ));
    }
    let stream = rom
        .get(candidate.stream_offset..)
        .ok_or_else(|| CodecError::new("invalid_reference", "stream fora da ROM"))?;
    let decoded =
        lz4w_decode_with_dictionary(stream, Some(&rom[..candidate.stream_offset]), limits)?;
    if decoded.data.len() != candidate.expected_len {
        return Err(CodecError::new(
            "invalid_reference",
            format!(
                "decode produziu {} bytes, header declara {}",
                decoded.data.len(),
                candidate.expected_len
            ),
        ));
    }
    Ok(VerifiedLz4wResource {
        candidate: candidate.clone(),
        decoded: decoded.data,
        bytes_consumed: decoded.bytes_consumed,
    })
}

/// Recurso aPLib verificado: o stream decodifica exatamente para o tamanho
/// declarado pelo header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedAplibResource {
    pub candidate: TilesetCandidate,
    pub decoded: Vec<u8>,
    pub bytes_consumed: usize,
}

/// Verifica um candidato aPLib: decode **sem dicionário** e tamanho exato.
///
/// Diferente do LZ4W, o stream aPLib é autônomo: não consome o prefixo da ROM,
/// então não há dependentes por dicionário — em contrapartida é
/// `bytes_consumed` que separa o recurso do bloco vizinho, e o decode lê até o
/// EOD sem saber onde a ROM termina.
pub fn verify_aplib_resource(
    rom: &[u8],
    candidate: &TilesetCandidate,
    limits: &AplibLimits,
) -> Result<VerifiedAplibResource, CodecError> {
    if candidate.compression != TilesetCompression::Aplib {
        return Err(CodecError::new(
            "invalid_reference",
            "verificação aPLib exige header com compression=1",
        ));
    }
    let stream = rom
        .get(candidate.stream_offset..)
        .ok_or_else(|| CodecError::new("invalid_reference", "stream fora da ROM"))?;
    let decoded = aplib_decode(stream, limits)?;
    if decoded.data.len() != candidate.expected_len {
        return Err(CodecError::new(
            "invalid_reference",
            format!(
                "decode aPLib produziu {} bytes, header declara {}",
                decoded.data.len(),
                candidate.expected_len
            ),
        ));
    }
    Ok(VerifiedAplibResource {
        candidate: candidate.clone(),
        decoded: decoded.data,
        bytes_consumed: decoded.bytes_consumed,
    })
}

/// Conjunto de recursos LZ4W verificados desta ROM, com os limites do
/// conjunto analisável declarados (base da verificação de dependentes).
pub struct VerifiedResourceSet {
    pub resources: Vec<VerifiedLz4wResource>,
    /// Quantos headers LZ4W candidatos existiram.
    pub candidates: usize,
    /// Limites declarados do conjunto analisado.
    pub analyzed_scope: String,
}

/// Verifica todos os candidatos LZ4W da ROM. Recursos com streams
/// sobrepostos são recusados (ambiguidade estrutural impede edição segura).
pub fn verify_lz4w_resource_set(
    rom: &[u8],
    limits: &Lz4wLimits,
) -> Result<VerifiedResourceSet, CodecError> {
    let candidates = scan_tileset_headers(rom);
    let lz4w_count = candidates
        .iter()
        .filter(|c| c.compression == TilesetCompression::Lz4w)
        .count();
    let mut resources = Vec::new();
    for candidate in &candidates {
        if candidate.compression != TilesetCompression::Lz4w {
            continue;
        }
        if let Ok(resource) = verify_lz4w_resource(rom, candidate, limits) {
            resources.push(resource);
        }
    }
    // Streams devem ser disjuntos para a edição ser bem definida.
    let mut sorted: Vec<&VerifiedLz4wResource> = resources.iter().collect();
    sorted.sort_by_key(|r| r.candidate.stream_offset);
    for pair in sorted.windows(2) {
        let end = pair[0].candidate.stream_offset + pair[0].bytes_consumed;
        if end > pair[1].candidate.stream_offset {
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "streams LZ4W sobrepostos em {:#x}..{:#x} e {:#x}",
                    pair[0].candidate.stream_offset, end, pair[1].candidate.stream_offset
                ),
            ));
        }
    }
    let analyzed_scope = format!(
        "recursos LZ4W estruturalmente verificados nesta ROM: {}/{} candidatos; \
         preservação garantida apenas para este conjunto, não para o jogo inteiro",
        resources.len(),
        lz4w_count
    );
    Ok(VerifiedResourceSet {
        resources,
        candidates: lz4w_count,
        analyzed_scope,
    })
}

/// Limites da transação canônica sobre uma ROM que pode misturar os dois
/// codecs. O agrupamento é por contrato, não por escolha: cada recurso
/// verificado carrega o seu, então nenhum caminho seleciona decoder/encoder
/// por suposição sobre o header.
#[derive(Debug, Clone, Copy, Default)]
pub struct TransactionLimits {
    pub lz4w: Lz4wLimits,
    pub aplib_decode: AplibLimits,
    pub aplib_encode: AplibEncodeLimits,
}

/// Recurso verificado dos dois codecs suportados pela transação.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecursoVerificado {
    Lz4w(VerifiedLz4wResource),
    Aplib(VerifiedAplibResource),
}

impl RecursoVerificado {
    pub fn candidate(&self) -> &TilesetCandidate {
        match self {
            Self::Lz4w(r) => &r.candidate,
            Self::Aplib(r) => &r.candidate,
        }
    }
    pub fn decoded(&self) -> &[u8] {
        match self {
            Self::Lz4w(r) => &r.decoded,
            Self::Aplib(r) => &r.decoded,
        }
    }
    pub fn bytes_consumed(&self) -> usize {
        match self {
            Self::Lz4w(r) => r.bytes_consumed,
            Self::Aplib(r) => r.bytes_consumed,
        }
    }
}

/// Conjunto verificado dos dois codecs, base da verificação de dependentes
/// quando a ROM misturar LZ4W e aPLib.
#[derive(Debug)]
pub struct ConjuntoVerificado {
    pub resources: Vec<RecursoVerificado>,
    /// Candidatos estruturais dos codecs suportados (denominador declarado).
    pub candidates: usize,
    pub lz4w_candidates: usize,
    pub aplib_candidates: usize,
    pub analyzed_scope: String,
}

/// Verifica todos os candidatos LZ4W **e** aPLib da ROM. Streams de codecs
/// diferentes também não podem se sobrepor: se o fim de um alcança o início do
/// outro, a edição deixa de ter um dono único para aqueles bytes.
pub fn verify_resource_set(
    rom: &[u8],
    limits: &TransactionLimits,
) -> Result<ConjuntoVerificado, CodecError> {
    let candidatos = scan_tileset_headers(rom);
    let lz4w_count = candidatos
        .iter()
        .filter(|c| c.compression == TilesetCompression::Lz4w)
        .count();
    let aplib_count = candidatos
        .iter()
        .filter(|c| c.compression == TilesetCompression::Aplib)
        .count();
    let mut resources = Vec::new();
    for candidate in &candidatos {
        let verificado = match candidate.compression {
            TilesetCompression::Lz4w => verify_lz4w_resource(rom, candidate, &limits.lz4w)
                .ok()
                .map(RecursoVerificado::Lz4w),
            TilesetCompression::Aplib => {
                verify_aplib_resource(rom, candidate, &limits.aplib_decode)
                    .ok()
                    .map(RecursoVerificado::Aplib)
            }
            TilesetCompression::None => None,
        };
        if let Some(recurso) = verificado {
            resources.push(recurso);
        }
    }
    let mut sorted: Vec<&RecursoVerificado> = resources.iter().collect();
    sorted.sort_by_key(|r| r.candidate().stream_offset);
    for pair in sorted.windows(2) {
        let fim = pair[0].candidate().stream_offset + pair[0].bytes_consumed();
        if fim > pair[1].candidate().stream_offset {
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "streams verificados sobrepostos em {:#x}..{:#x} e {:#x}",
                    pair[0].candidate().stream_offset,
                    fim,
                    pair[1].candidate().stream_offset
                ),
            ));
        }
    }
    let analyzed_scope = format!(
        "recursos estruturalmente verificados nesta ROM: {}/{} candidatos \
         (LZ4W {}/{} de LZ4W, aPLib {}/{} de aPLib); preservação garantida \
         apenas para este conjunto, não para o jogo inteiro",
        resources.len(),
        lz4w_count + aplib_count,
        resources
            .iter()
            .filter(|r| matches!(r, RecursoVerificado::Lz4w(_)))
            .count(),
        lz4w_count,
        resources
            .iter()
            .filter(|r| matches!(r, RecursoVerificado::Aplib(_)))
            .count(),
        aplib_count
    );
    Ok(ConjuntoVerificado {
        resources,
        candidates: lz4w_count + aplib_count,
        lz4w_candidates: lz4w_count,
        aplib_candidates: aplib_count,
        analyzed_scope,
    })
}

/// O mesmo recurso, visto pela transação: o dispatch do contrato de
/// desempacotamento mora aqui, um ponto, e é dirigido pelo tipo do recurso já
/// verificado — nunca por suposição sobre a ROM.
enum RecursoEditavel<'a> {
    Lz4w(&'a VerifiedLz4wResource),
    Aplib(&'a VerifiedAplibResource),
}

impl<'a> RecursoEditavel<'a> {
    fn de(recurso: &'a RecursoVerificado) -> Self {
        match recurso {
            RecursoVerificado::Lz4w(r) => Self::Lz4w(r),
            RecursoVerificado::Aplib(r) => Self::Aplib(r),
        }
    }

    fn candidate(&self) -> &TilesetCandidate {
        match self {
            Self::Lz4w(r) => &r.candidate,
            Self::Aplib(r) => &r.candidate,
        }
    }

    fn decoded(&self) -> &[u8] {
        match self {
            Self::Lz4w(r) => &r.decoded,
            Self::Aplib(r) => &r.decoded,
        }
    }

    fn bytes_consumed(&self) -> usize {
        match self {
            Self::Lz4w(r) => r.bytes_consumed,
            Self::Aplib(r) => r.bytes_consumed,
        }
    }

    /// Desempacota `stream` no contexto desta `rom`: o LZ4W usa o prefixo da
    /// ROM antes do próprio stream como dicionário (contrato dependente de
    /// contexto); o aPLib raw é autônomo e se autodelimita pelo EOD.
    fn desempacotar(
        &self,
        stream: &[u8],
        rom: &[u8],
        limits: &TransactionLimits,
    ) -> Result<(Vec<u8>, usize), CodecError> {
        match self {
            Self::Lz4w(_) => {
                let d = lz4w_decode_with_dictionary(
                    stream,
                    Some(&rom[..self.candidate().stream_offset]),
                    &limits.lz4w,
                )?;
                Ok((d.data, d.bytes_consumed))
            }
            Self::Aplib(_) => {
                let d = aplib_decode(stream, &limits.aplib_decode)?;
                Ok((d.data, d.bytes_consumed))
            }
        }
    }

    /// Recodifica a edição dentro do espaço comprovado e confere ida e volta
    /// no mesmo contexto em que o recurso vive.
    fn recodificar_no_espaco(
        &self,
        editado: &[u8],
        rom: &[u8],
        espaco: usize,
        limits: &TransactionLimits,
    ) -> Result<Vec<u8>, CodecError> {
        let start = self.candidate().stream_offset;
        let novo = match self {
            Self::Lz4w(_) => {
                let index = super::rex_codecs::Lz4wDictionaryIndex::build(&rom[..start])?;
                let (stream, _estrategia) =
                    super::rex_codecs::lz4w_encode_with_dictionary_index_fitting(
                        editado,
                        Some(&index),
                        espaco,
                    )?;
                stream
            }
            Self::Aplib(_) => {
                let orcamento = AplibEncodeLimits {
                    max_stream: espaco,
                    max_work: limits.aplib_encode.max_work,
                };
                aplib_encode(editado, &orcamento).map_err(|e| {
                    if e.code == "needs_space" {
                        CodecError::new(
                            "excessive_output",
                            format!(
                                "edição do recurso em {start:#x} não cabe no slot comprovado: {}",
                                e.detail
                            ),
                        )
                    } else {
                        e
                    }
                })?
            }
        };
        let (devolvido, _consumido) = self.desempacotar(&novo, rom, limits)?;
        if devolvido != editado {
            let first_diff = devolvido
                .iter()
                .zip(editado.iter())
                .position(|(a, b)| a != b)
                .unwrap_or_else(|| devolvido.len().min(editado.len()));
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "o stream re-codificado não decodifica para a edição (primeiro byte divergente em {first_diff})"
                ),
            ));
        }
        Ok(novo)
    }
}

/// Desfecho da transação canônica compartilhada pelos dois codecs. A sequência
/// de guardas é: identidade da ROM; evidência do recurso re-verificada contra
/// ESTA ROM; tamanhos; no-op explícito; re-codificação respeitando o espaço
/// comprovado; ida e volta no contexto real; escrita em cópia com os bytes
/// externos ao slot intactos e verificação de dependentes sobre o conjunto
/// analisável (dos dois codecs); patch BPS e re-aplicação com hash exato.
///
/// Os contratos não são unificados: o que é compartilhado é a sequência de
/// guardas. A diferença LZ4W/aPLib vive em `RecursoEditavel`, e nenhuma
/// validação específica do LZ4W foi removida para generalizar a API.
fn transacao_canonica(
    recurso: RecursoEditavel<'_>,
    rom: &[u8],
    expected_rom_sha256: &str,
    edited_data: &[u8],
    limits: &TransactionLimits,
) -> Result<ReinsertOutcome, CodecError> {
    // 1. Identidade da ROM.
    let actual_sha = super::rom_library::sha256_hex(rom);
    if actual_sha != expected_rom_sha256 {
        return Err(CodecError::new(
            "rom_identity_mismatch",
            format!(
                "ROM base mudou: esperado {}, atual {actual_sha}",
                expected_rom_sha256
            ),
        ));
    }
    let start = recurso.candidate().stream_offset;
    // 2. Evidência do recurso contra esta ROM, com o contrato do próprio codec.
    let stream = rom
        .get(start..)
        .ok_or_else(|| CodecError::new("invalid_reference", "stream fora da ROM"))?;
    let (redecodificado, consumido) = recurso.desempacotar(stream, rom, limits)?;
    if redecodificado != recurso.decoded() || consumido != recurso.bytes_consumed() {
        return Err(CodecError::new(
            "evidence_mismatch",
            "evidência do recurso não corresponde aos bytes desta ROM",
        ));
    }
    // 3. Tamanhos.
    if edited_data.len() != recurso.candidate().expected_len {
        return Err(CodecError::new(
            "overflow",
            format!(
                "dados editados têm {} bytes; esperado {}",
                edited_data.len(),
                recurso.candidate().expected_len
            ),
        ));
    }
    // No-op explícito: nada é escrito, padding preservado.
    if edited_data == recurso.decoded() {
        return Ok(ReinsertOutcome::NoOp);
    }
    // Conjunto analisável (para dependentes) antes de qualquer escrita.
    let set = verify_resource_set(rom, limits)?;
    let edited_index = set
        .resources
        .iter()
        .position(|r| r.candidate() == recurso.candidate())
        .ok_or_else(|| {
            CodecError::new(
                "evidence_mismatch",
                "recurso não pertence ao conjunto verificado desta ROM",
            )
        })?;
    // 4. Re-codificação com o espaço comprovadamente disponível + 5. ida e volta
    // no contexto real.
    let original_stream_len = recurso.bytes_consumed();
    let new_stream =
        recurso.recodificar_no_espaco(edited_data, rom, original_stream_len, limits)?;
    if new_stream.len() > original_stream_len {
        return Err(CodecError::new(
            "excessive_output",
            format!(
                "stream re-codificado de {} bytes excede o espaço original de {original_stream_len}; sem expansão no v1",
                new_stream.len()
            ),
        ));
    }
    // 6. Escrita em cópia: só o novo stream; bytes originais além dele
    //    permanecem (padding e possíveis referências de dependentes).
    let mut modified = rom.to_vec();
    modified[start..start + new_stream.len()].copy_from_slice(&new_stream);
    // 6. Dependentes verificados no produto sobre o conjunto analisável.
    let mut verified_preserved = 0usize;
    for (index, other) in set.resources.iter().enumerate() {
        if index == edited_index {
            continue;
        }
        let other_start = other.candidate().stream_offset;
        let outra_stream = modified
            .get(other_start..)
            .ok_or_else(|| CodecError::new("invalid_reference", "stream fora da ROM"))?;
        let decoded = RecursoEditavel::de(other).desempacotar(outra_stream, &modified, limits)?;
        if decoded.0 != other.decoded() {
            return Err(CodecError::new(
                "dependent_modified",
                format!(
                    "recurso dependente em {other_start:#x} mudaria de decode com a edição em {start:#x}; transação recusada"
                ),
            ));
        }
        verified_preserved += 1;
    }
    // Sanity: a cópia tem o mesmo tamanho (sem expansão de ROM).
    if modified.len() != rom.len() {
        return Err(CodecError::new(
            "overflow",
            "tamanho da ROM mudaria; recusado",
        ));
    }
    let modified_rom_sha256 = super::rom_library::sha256_hex(&modified);
    // 7. Patch pelo pipeline canônico + re-aplicação com hash exato.
    let patch_bps = crate::tools::patch_studio::create_bps(rom, &modified)
        .map_err(|message| CodecError::new("overflow", message))?;
    let reapplied = crate::tools::patch_studio::apply_bps(rom, &patch_bps)
        .map_err(|message| CodecError::new("overflow", message))?;
    if reapplied != modified {
        return Err(CodecError::new(
            "overflow",
            "patch BPS re-aplicado não reproduz a cópia modificada",
        ));
    }
    let patch_bps_sha256 = super::rom_library::sha256_hex(&patch_bps);
    Ok(ReinsertOutcome::Applied(ReinsertApplied {
        modified_rom: modified,
        modified_rom_sha256,
        patch_bps,
        patch_bps_sha256,
        stream_written: new_stream.len(),
        original_stream_len,
        verified_preserved,
        analyzed_scope: set.analyzed_scope,
    }))
}

/// Pedido de reinserção canônica LZ4W.
pub struct ReinsertRequest<'a> {
    pub rom: &'a [u8],
    /// SHA-256 esperado da ROM base (identidade obrigatória).
    pub expected_rom_sha256: &'a str,
    pub resource: &'a VerifiedLz4wResource,
    pub edited_data: &'a [u8],
}

/// Resultado de reinserção aplicada.
#[derive(Debug)]
pub struct ReinsertApplied {
    pub modified_rom: Vec<u8>,
    pub modified_rom_sha256: String,
    /// Patch BPS gerado pelo pipeline canônico (`tools::patch_studio`).
    pub patch_bps: Vec<u8>,
    pub patch_bps_sha256: String,
    pub stream_written: usize,
    /// Espaço original do stream (limite comprovadamente disponível).
    pub original_stream_len: usize,
    /// Quantos recursos verificados foram conferidos como preservados.
    pub verified_preserved: usize,
    /// Limites declarados do conjunto analisado.
    pub analyzed_scope: String,
}

/// Desfecho da transação: no-op explícito ou aplicação com patch.
#[derive(Debug)]
pub enum ReinsertOutcome {
    /// Dados editados iguais aos verificados: nada é escrito, nem padding.
    NoOp,
    Applied(ReinsertApplied),
}

/// Reinserção canônica de um recurso LZ4W (CONTRATOS §5).
///
/// Assinatura inalterada: delega na transação compartilhada com os limites do
/// seu próprio contrato. Ver `transacao_canonica` para as sete guardas.
pub fn reinsert_transaction(
    request: &ReinsertRequest<'_>,
    limits: &Lz4wLimits,
) -> Result<ReinsertOutcome, CodecError> {
    let limites = TransactionLimits {
        lz4w: *limits,
        ..Default::default()
    };
    transacao_canonica(
        RecursoEditavel::Lz4w(request.resource),
        request.rom,
        request.expected_rom_sha256,
        request.edited_data,
        &limites,
    )
}

/// Pedido de reinserção canônica de um recurso APLIB verificado.
pub struct ReinsertRequestAplib<'a> {
    pub rom: &'a [u8],
    /// SHA-256 esperado da ROM base (identidade obrigatória).
    pub expected_rom_sha256: &'a str,
    pub resource: &'a VerifiedAplibResource,
    pub edited_data: &'a [u8],
}

/// Reinserção canônica de um recurso APLIB: as mesmas sete guardas do LZ4W, com
/// o contrato aPLib (stream autônomo, sem dicionário de prefixo) aplicado na
/// re-verificação, na re-codificação e nos dependentes.
pub fn reinsert_transaction_aplib(
    request: &ReinsertRequestAplib<'_>,
    limits: &TransactionLimits,
) -> Result<ReinsertOutcome, CodecError> {
    transacao_canonica(
        RecursoEditavel::Aplib(request.resource),
        request.rom,
        request.expected_rom_sha256,
        request.edited_data,
        limits,
    )
}

/// Contrato único de endereçamento de pixel em tiles MD 4bpp **chunky**
/// (packed nibble), o mesmo formato emitido pelo rescomp do SGDK
/// (`ImageUtil.convert8bppTo4bpp`: nibble alto = pixel par) e usado pelo
/// editor de tiles Sonic do produto (`sprite_composition`, byte =
/// base + tile*32 + linha*4 + col/2, nibble alto na coluna par).
/// Retorna (offset do byte dentro do dado do recurso, nibble alto?).
pub fn md_pixel_location(tile: usize, row: usize, col: usize) -> Result<(usize, bool), CodecError> {
    if tile > 0xFFFF || row > 7 || col > 7 {
        return Err(CodecError::new(
            "overflow",
            format!("pixel ({tile},{row},{col}) fora dos limites do tile 8x8"),
        ));
    }
    let offset = tile * 32 + row * 4 + col / 2;
    Ok((offset, col.is_multiple_of(2)))
}

/// Lê o índice (0..15) de um pixel no formato chunky.
pub fn md_read_pixel_index(
    data: &[u8],
    tile: usize,
    row: usize,
    col: usize,
) -> Result<u8, CodecError> {
    let (offset, high) = md_pixel_location(tile, row, col)?;
    let byte = data
        .get(offset)
        .ok_or_else(|| CodecError::new("overflow", "pixel fora do buffer de tiles"))?;
    Ok(if high { byte >> 4 } else { byte & 0x0F })
}

/// Escreve o índice (0..15) de um pixel no formato chunky, preservando o
/// outro nibble do byte e todos os demais bytes.
pub fn md_write_pixel_index(
    data: &mut [u8],
    tile: usize,
    row: usize,
    col: usize,
    index: u8,
) -> Result<(), CodecError> {
    if index > 15 {
        return Err(CodecError::new(
            "overflow",
            format!("índice de paleta {index} fora de 0..15"),
        ));
    }
    let (offset, high) = md_pixel_location(tile, row, col)?;
    let byte = data
        .get_mut(offset)
        .ok_or_else(|| CodecError::new("overflow", "pixel fora do buffer de tiles"))?;
    *byte = if high {
        (*byte & 0x0F) | (index << 4)
    } else {
        (*byte & 0xF0) | index
    };
    Ok(())
}

/// Renderiza tiles MD 4bpp **chunky** (packed nibble) como RGBA, uma faixa
/// de tiles. Formato idêntico ao emitido pelo rescomp do SGDK.
pub fn md_tiles_to_rgba(tiles: &[u8]) -> Vec<u8> {
    let num_tiles = tiles.len() / 32;
    let width = num_tiles * 8;
    let mut rgba = vec![0u8; width * 8 * 4];
    for tile in 0..num_tiles {
        for row in 0..8 {
            for col in 0..8 {
                let index =
                    md_read_pixel_index(tiles, tile, row, col).expect("tile dentro dos limites");
                let x = tile * 8 + col;
                let y = row;
                let offset = (y * width + x) * 4;
                rgba[offset] = index * 16;
                rgba[offset + 1] = index * 16;
                rgba[offset + 2] = index * 16;
                rgba[offset + 3] = 255;
            }
        }
    }
    rgba
}

/// Resumo de um recurso verificado para IPC/UI.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ResourceSummary {
    pub header_offset: u64,
    pub stream_offset: u64,
    pub num_tiles: u32,
    pub data_len: u32,
    pub stream_len: u32,
    /// Codec verificado do recurso (`lz4w` | `aplib`), lido do header.
    pub codec: String,
}

/// Prévia PNG chunky (4x) dos tiles decodificados, com 16 tiles por linha.
/// Retorna (bytes_png, largura, altura, sha256 dos pixels RGBA).
pub fn render_resource_png(data: &[u8]) -> Result<(Vec<u8>, u32, u32, String), CodecError> {
    if data.is_empty() || !data.len().is_multiple_of(32) {
        return Err(CodecError::new(
            "invalid_reference",
            "dado de tiles deve ser múltiplo de 32 bytes (tiles MD 4bpp)",
        ));
    }
    let num_tiles = data.len() / 32;
    let per_row = 16usize;
    let rows = num_tiles.div_ceil(per_row);
    let width = per_row * 8;
    let height = rows * 8;
    // RGBA canônico: tiles na ordem, com padding transparente no fim.
    let mut rgba = vec![0u8; width * height * 4];
    let strip = md_tiles_to_rgba(data);
    let strip_width = num_tiles * 8;
    for tile in 0..num_tiles {
        let row = tile / per_row;
        let col = tile % per_row;
        for y in 0..8 {
            for x in 0..8 {
                // Fonte: posição REAL do tile na faixa (linha y, coluna
                // tile*8+x) — a faixa tem strip_width px por linha.
                let src = (y * strip_width + tile * 8 + x) * 4;
                let dst = (((row * 8 + y) * width) + col * 8 + x) * 4;
                rgba[dst..dst + 4].copy_from_slice(&strip[src..src + 4]);
            }
        }
    }
    let pixels_sha256 = super::rom_library::sha256_hex(&rgba);
    let mut png_bytes: Vec<u8> = Vec::new();
    let image = image::RgbaImage::from_raw(width as u32, height as u32, rgba.clone())
        .ok_or_else(|| CodecError::new("overflow", "dimensões da prévia inválidas"))?;
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| CodecError::new("overflow", format!("falha ao codificar PNG: {e}")))?;
    Ok((png_bytes, width as u32, height as u32, pixels_sha256))
}

/// Lista os recursos verificados de uma ROM (por conteúdo), LZ4W e aPLib, cada
/// um com o codec lido do próprio header, com o SHA-256 da ROM (identidade para
/// a UI).
pub fn list_resources(rom_path: &str) -> Result<(String, Vec<ResourceSummary>), String> {
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    let sha = super::rom_library::sha256_hex(&rom);
    let set = verify_resource_set(&rom, &TransactionLimits::default())
        .map_err(|e| format!("falha ao verificar recursos: {e}"))?;
    let summaries = set
        .resources
        .iter()
        .map(|r| ResourceSummary {
            header_offset: r.candidate().header_offset as u64,
            stream_offset: r.candidate().stream_offset as u64,
            num_tiles: r.candidate().num_tiles as u32,
            data_len: r.candidate().expected_len as u32,
            stream_len: r.bytes_consumed() as u32,
            codec: r.candidate().compression.as_str().to_string(),
        })
        .collect();
    Ok((sha, summaries))
}

/// Edição de pixel por (tile, linha, coluna) com índice 0..15, aplicada pela
/// transação canônica. Zero edições = no-op explícito.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PixelEdit {
    pub tile: u32,
    pub row: u32,
    pub col: u32,
    pub index: u8,
}

/// Resultado IPC da edição.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ResourceEditResult {
    pub outcome: String,
    pub rom_sha256: String,
    pub modified_rom_sha256: Option<String>,
    pub modified_rom_path: Option<String>,
    pub patch_bps_sha256: Option<String>,
    pub patch_bps_path: Option<String>,
    pub stream_offset: u64,
    /// Codec do recurso sobre o qual a prévia/edição/incidência rodou.
    pub codec: String,
    pub stream_written: Option<u32>,
    pub original_stream_len: u32,
    pub verified_preserved: Option<usize>,
    pub analyzed_scope: String,
    pub preview_png_sha256: Option<String>,
    pub preview_pixels_sha256: Option<String>,
    pub preview_width: Option<u32>,
    pub preview_height: Option<u32>,
    pub preview_data_url: Option<String>,
}

/// Prévia somente leitura de um recurso verificado (sem transação), LZ4W ou
/// aPLib.
pub fn preview_resource(rom_path: &str, stream_offset: u64) -> Result<ResourceEditResult, String> {
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    let rom_sha = super::rom_library::sha256_hex(&rom);
    let set = verify_resource_set(&rom, &TransactionLimits::default())
        .map_err(|e| format!("falha ao verificar recursos: {e}"))?;
    let resource = set
        .resources
        .iter()
        .find(|r| r.candidate().stream_offset as u64 == stream_offset)
        .ok_or_else(|| format!("recurso {stream_offset:#x} não verificado nesta ROM"))?;
    let (preview_png, pw, ph, pixels_sha) =
        render_resource_png(resource.decoded()).map_err(|e| format!("{}: {}", e.code, e.detail))?;
    let preview_data_url = format!("data:image/png;base64,{}", {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        BASE64.encode(&preview_png)
    });
    Ok(ResourceEditResult {
        outcome: "preview".into(),
        rom_sha256: rom_sha,
        modified_rom_sha256: None,
        modified_rom_path: None,
        patch_bps_sha256: None,
        patch_bps_path: None,
        stream_offset,
        codec: resource.candidate().compression.as_str().to_string(),
        stream_written: None,
        original_stream_len: resource.bytes_consumed() as u32,
        verified_preserved: None,
        analyzed_scope: set.analyzed_scope,
        preview_png_sha256: Some(super::rom_library::sha256_hex(&preview_png)),
        preview_pixels_sha256: Some(pixels_sha),
        preview_width: Some(pw),
        preview_height: Some(ph),
        preview_data_url: Some(preview_data_url),
    })
}

/// Aplica edições de pixels via transação canônica e materializa cópia
/// modificada + patch BPS no diretório canônico de artefatos.
pub fn apply_resource_edit(
    rom_path: &str,
    stream_offset: u64,
    edits: &[PixelEdit],
    expected_rom_sha256: &str,
) -> Result<ResourceEditResult, String> {
    use super::extract::{canonical_dir_under, write_file_immutable};
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    let rom_sha = super::rom_library::sha256_hex(&rom);
    let limits = TransactionLimits::default();
    let ConjuntoVerificado {
        resources,
        analyzed_scope,
        ..
    } = verify_resource_set(&rom, &limits)
        .map_err(|e| format!("falha ao verificar recursos: {e}"))?;
    let resource = resources
        .iter()
        .find(|r| r.candidate().stream_offset as u64 == stream_offset)
        .ok_or_else(|| format!("recurso {stream_offset:#x} não verificado nesta ROM"))?;
    let codec = resource.candidate().compression.as_str();
    let original_stream_len = resource.bytes_consumed() as u32;
    let verificados = resource.decoded().to_vec();
    let mut edited = verificados.clone();
    for edit in edits {
        let tile = edit.tile as usize;
        if tile >= resource.candidate().num_tiles {
            return Err(format!("tile {} fora do recurso", edit.tile));
        }
        // Contrato chunky único (md_write_pixel_index): preserva o outro
        // nibble e todos os demais bytes.
        md_write_pixel_index(
            &mut edited,
            tile,
            edit.row as usize,
            edit.col as usize,
            edit.index,
        )
        .map_err(|e| format!("{}: {}", e.code, e.detail))?;
    }
    // O dispatch é pelo recurso verificado, nunca por suposição: cada variante
    // carrega o próprio contrato de histórico (dicionário = prefixo da ROM no
    // LZ4W, stream autônomo no aPLib raw).
    let outcome = match resource {
        RecursoVerificado::Lz4w(r) => reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256,
                resource: r,
                edited_data: &edited,
            },
            &limits.lz4w,
        ),
        RecursoVerificado::Aplib(r) => reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256,
                resource: r,
                edited_data: &edited,
            },
            &limits,
        ),
    }
    .map_err(|e| format!("{}: {}", e.code, e.detail))?;
    let (preview_png, pw, ph, pixels_sha) = render_resource_png(if edits.is_empty() {
        &verificados
    } else {
        &edited
    })
    .map_err(|e| format!("{}: {}", e.code, e.detail))?;
    let preview_data_url = format!("data:image/png;base64,{}", {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        BASE64.encode(&preview_png)
    });
    match outcome {
        ReinsertOutcome::NoOp => Ok(ResourceEditResult {
            outcome: "noop".into(),
            rom_sha256: rom_sha,
            modified_rom_sha256: None,
            modified_rom_path: None,
            patch_bps_sha256: None,
            patch_bps_path: None,
            stream_offset,
            codec: codec.to_string(),
            stream_written: None,
            original_stream_len,
            verified_preserved: None,
            analyzed_scope,
            preview_png_sha256: Some(super::rom_library::sha256_hex(&preview_png)),
            preview_pixels_sha256: Some(pixels_sha),
            preview_width: Some(pw),
            preview_height: Some(ph),
            preview_data_url: Some(preview_data_url),
        }),
        ReinsertOutcome::Applied(applied) => {
            let edit_dir = canonical_dir_under(
                &super::rom_library::decomp_work_dir(),
                &["extract", &rom_sha, "edits"],
            )?;
            // Nome do artefato carrega o codec efetivamente editado: um dump
            // `rex-aplib-*` não pode ser confundido com um do tronco LZ4W.
            let modified_path = edit_dir.join(format!(
                "rex-{codec}-modified-{}.bin",
                applied.modified_rom_sha256
            ));
            write_file_immutable(
                &modified_path,
                &applied.modified_rom,
                &applied.modified_rom_sha256,
            )?;
            let patch_path = edit_dir.join(format!(
                "rex-{codec}-patch-{}.bps",
                applied.patch_bps_sha256
            ));
            write_file_immutable(&patch_path, &applied.patch_bps, &applied.patch_bps_sha256)?;
            Ok(ResourceEditResult {
                outcome: "applied".into(),
                rom_sha256: rom_sha,
                modified_rom_sha256: Some(applied.modified_rom_sha256),
                modified_rom_path: Some(modified_path.to_string_lossy().into_owned()),
                patch_bps_sha256: Some(applied.patch_bps_sha256),
                patch_bps_path: Some(patch_path.to_string_lossy().into_owned()),
                stream_offset,
                codec: codec.to_string(),
                stream_written: Some(applied.stream_written as u32),
                original_stream_len: applied.original_stream_len as u32,
                verified_preserved: Some(applied.verified_preserved),
                analyzed_scope: applied.analyzed_scope,
                preview_png_sha256: Some(super::rom_library::sha256_hex(&preview_png)),
                preview_pixels_sha256: Some(pixels_sha),
                preview_width: Some(pw),
                preview_height: Some(ph),
                preview_data_url: Some(preview_data_url),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::rex_codecs::lz4w_encode_with_dictionary;
    use super::*;
    use std::path::PathBuf;

    /// Stream aPLib real de oráculo, lido da fixture autoral versionada e
    /// conferido contra o SHA-256 pinado no `manifest.tsv` dos vetores.
    /// Ausência é falha de teste, não skip.
    fn vetor_aplib(rel: &str, sha256_pinado: &str) -> Vec<u8> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/rex_profiles/integrator/aplib/vectors");
        let caminho = dir.join(rel);
        let bytes = std::fs::read(&caminho).unwrap_or_else(|e| {
            panic!(
                "vetor aPLib obrigatório ausente: {}: {e}",
                caminho.display()
            )
        });
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&bytes),
            sha256_pinado,
            "vetor aPLib divergiu do hash pinado: {}",
            caminho.display()
        );
        bytes
    }

    // `tile_like`: 8 192 B de dados em formato de tile (= 256 tiles de 32 B),
    // comprimido por apultra e apj em streams idênticos de 41 B.
    const SHA_STREAM_TILE_LIKE: &str =
        "f494516d9e040b423342e2f1d120c31853d69d16798f99b2fcb00031e7989fa9";
    const SHA_PLAIN_TILE_LIKE: &str =
        "b81313391be143a836534d3a4ef99c978db8e730170c0d207893f2d8b2b5a03f";
    const TILE_LIKE: &str = "plain/tile_like.apj.ap";
    const TILE_LIKE_TILES: u16 = 256;
    const TILE_LIKE_LEN: usize = 8192;

    /// ROM sintética com um header TileSet APLIB (`compression=1`) apontando
    /// para o stream, seguido de sentinela: os bytes depois do EOD pertencem ao
    /// bloco vizinho e não podem ser consumidos.
    fn rom_aplib_sintetica(num_tiles: u16) -> Vec<u8> {
        let stream = vetor_aplib(TILE_LIKE, SHA_STREAM_TILE_LIKE);
        let mut rom = vec![0u8; 16];
        rom[0..2].copy_from_slice(&1u16.to_be_bytes());
        rom[2..4].copy_from_slice(&num_tiles.to_be_bytes());
        rom[4..8].copy_from_slice(&16u32.to_be_bytes());
        rom.extend_from_slice(&stream);
        rom.extend_from_slice(&[0xA5u8; 8]);
        rom
    }

    #[test]
    fn verify_aplib_resource_decodifica_header_aplib_e_para_no_eod() {
        let rom = rom_aplib_sintetica(TILE_LIKE_TILES);
        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == 0 && c.compression == TilesetCompression::Aplib)
            .expect("header TileSet APLIB em 0 não foi scanneado");
        assert_eq!(candidato.stream_offset, 16);
        assert_eq!(candidato.num_tiles, TILE_LIKE_TILES as usize);
        assert_eq!(candidato.expected_len, TILE_LIKE_LEN);
        let verificado = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .expect("recurso aPLib sintético foi recusado");
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&verificado.decoded),
            SHA_PLAIN_TILE_LIKE,
            "o decode não bate com o plain pinado pelo oráculo"
        );
        assert_eq!(verificado.decoded.len(), TILE_LIKE_LEN);
        assert_eq!(
            verificado.bytes_consumed,
            vetor_aplib(TILE_LIKE, SHA_STREAM_TILE_LIKE).len(),
            "consumo deveria parar no byte seguinte ao EOD"
        );
        assert_eq!(
            &rom[16 + verificado.bytes_consumed..16 + verificado.bytes_consumed + 8],
            &[0xA5u8; 8],
            "a sentinela do bloco vizinho foi lida como parte do stream"
        );
    }

    #[test]
    fn verify_aplib_resource_recusa_tamanho_declarado_divergente_e_header_de_outro_codec() {
        // 255 tiles declarados (8 160 B) contra um stream que produz 8 192 B: o
        // tamanho do header é a condição de verificação, não uma dica.
        let rom = rom_aplib_sintetica(TILE_LIKE_TILES - 1);
        let candidato = TilesetCandidate {
            header_offset: 0,
            compression: TilesetCompression::Aplib,
            num_tiles: (TILE_LIKE_TILES - 1) as usize,
            stream_offset: 16,
            expected_len: TILE_LIKE_LEN - 32,
        };
        let erro = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .err()
            .expect("header com tamanho declarado errado deveria ser recusado");
        assert_eq!(erro.code, "invalid_reference", "{erro}");

        let mut rom_lz4w = rom_aplib_sintetica(TILE_LIKE_TILES);
        rom_lz4w[1] = 2; // compression=2 (LZ4W) no mesmo header
        let candidato_aplib = TilesetCandidate {
            header_offset: 0,
            compression: TilesetCompression::Lz4w,
            num_tiles: TILE_LIKE_TILES as usize,
            stream_offset: 16,
            expected_len: TILE_LIKE_LEN,
        };
        let erro = verify_aplib_resource(&rom_lz4w, &candidato_aplib, &AplibLimits::default())
            .err()
            .expect("verificação aPLib deveria recusar header LZ4W");
        assert_eq!(erro.code, "invalid_reference", "{erro}");
    }

    #[test]
    fn verify_lz4w_resource_continua_recusando_header_aplib() {
        // Guarda simétrica: o incremento aPLib não abre a via LZ4W para
        // compression=1.
        let rom = rom_aplib_sintetica(TILE_LIKE_TILES);
        let candidato = TilesetCandidate {
            header_offset: 0,
            compression: TilesetCompression::Aplib,
            num_tiles: TILE_LIKE_TILES as usize,
            stream_offset: 16,
            expected_len: TILE_LIKE_LEN,
        };
        let erro = verify_lz4w_resource(&rom, &candidato, &Lz4wLimits::default())
            .err()
            .expect("guarda LZ4W foi aberta");
        assert_eq!(erro.code, "invalid_reference", "{erro}");
    }

    /// Aceite BYOR (ignorado por padrão: corpus nunca é dependência
    /// provisionável). Os dois streams APLIB do TiledImage visível da ROM
    /// comercial, decodificados pelo decoder do produto e conferidos byte a byte
    /// contra o SHA-256 que os DOIS decodificadores de referência produzem sobre
    /// o stream extraído da ROM (`apultra -d` e `apj.jar u`, 16 000 B e 2 240 B);
    /// a implementação JS independente da agente A — caminho já validado por
    /// correspondência de pixel contra checkpoint-129 — concorda com os dois.
    /// Este aceite foi o que expôs o bug de histórico de offset do `110`
    /// (`rex_aplib.rs`), invisível nos 49 vetores importados. Arquivo ou
    /// identidade ausentes são falha, nunca skip silencioso.
    #[test]
    #[ignore = "aceite BYOR aPLib: requer ROM local com SHA esperado; rodar com --ignored"]
    fn byor_aplib_decodifica_os_dois_streams_do_tiledimage_visivel() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        const SHA_TILESET: &str =
            "dd7affc3971a73840b84b028c0f41372b49c52df3f4f29d09885c59e83b80f5f";
        const SHA_TILEMAP: &str =
            "c196aa5ba9b29a440b2680afb000795cebee242346503fb2342fd11ee5a704f1";

        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: o aceite exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        // (a) TileSet 0x21b44: o header real tem que aparecer no scan
        // estrutural e verificar com o tamanho declarado.
        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == 0x21b44)
            .expect("header TileSet 0x21b44 não apareceu no scan estrutural");
        assert_eq!(candidato.compression, TilesetCompression::Aplib);
        assert_eq!(candidato.num_tiles, 500);
        assert_eq!(candidato.stream_offset, 0x2e4d4);
        assert_eq!(candidato.expected_len, 16000);
        let tileset = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .expect("o decoder do produto recusou o TileSet APLIB real");
        assert_eq!(
            tileset.bytes_consumed, 4485,
            "consumo diverge da medida estrutural de A"
        );
        assert_eq!(tileset.decoded.len(), 16000);
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&tileset.decoded),
            SHA_TILESET,
            "o decode do produto divergiu dos dois decodificadores de referência"
        );

        // (b) TileMap 0x21b4c: 40x28 words = 2 240 B a partir de 0x2d534. Não é
        // um header TileSet, então é decode direto do mesmo decoder, lendo até o
        // fim da ROM — o EOD é o que delimita o recurso.
        let tilemap =
            aplib_decode(&rom[0x2d534..], &AplibLimits::default()).expect("TileMap APLIB");
        assert_eq!(tilemap.bytes_consumed, 1196);
        assert_eq!(tilemap.data.len(), 40 * 28 * 2);
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&tilemap.data),
            SHA_TILEMAP,
            "o decode do produto divergiu da implementação JS independente"
        );

        // (c) Fronteira: os dois streams terminam dentro da ROM e não se
        // tocam (0x2d534+1196 = 0x2d9e0 < 0x2e4d4).
        assert!(0x2d534 + tilemap.bytes_consumed < candidato.stream_offset);
    }

    // ---- Alvo da transação de edição na ROM comercial (passo 4 da ordem de
    // aceite). Toda constante aqui foi relida dos bytes desta ROM nesta data,
    // com o decoder em espelho do script versionado
    // `scripts/rex_profiles/integrator/aplib/audit_aplib_candidates.py` (que
    // abre conferindo os 9 goldens pinados), e não copiada de documento.

    /// `Palette` SGDK em `0x21b56`: `{u16 numColor; u32 *data}` (packed, data em
    /// +2) → 16 words em `0x2cbe8`. Os dois índices da edição-alvo têm que
    /// diferir aqui, senão a prova de tela não vale nada.
    const BYOR_SHA_PALETE_16W: &str =
        "4ee0d60ef2de539c81e5d037e77376386b1b70b381dcc38d663b093c0c39ea60";

    /// `font_08x08` embutido do SGDK 2.11: o MESMO stream de 609 B aparece na
    /// fixture autoral (header `0x59d14` / stream `0x5f2ec`) e nesta ROM
    /// (`0x270de` / `0x2cd94`), byte a byte, produzindo o mesmo plain de 3 072 B.
    /// É recurso legítimo da toolchain, não material comercial escolhido à mão:
    /// por isso serve de segunda evidência de decode no produto.
    const BYOR_SHA_STREAM_FONT: &str =
        "e9b88ab50ad575f340a6c31cb12cdf3d666577a8fc1eeeb88b083be3c36b1256";
    const BYOR_SHA_PLAIN_FONT: &str =
        "20ee7dcc463262ad2172344b567496b66e8cea3dd9cb1d27b8ff0f736bb26f29";

    fn u16_be(rom: &[u8], at: usize) -> u16 {
        u16::from_be_bytes([rom[at], rom[at + 1]])
    }

    fn u32_be(rom: &[u8], at: usize) -> u32 {
        u32::from_be_bytes([rom[at], rom[at + 1], rom[at + 2], rom[at + 3]])
    }

    /// Re-lê a cadeia estrutural do TiledImage visível direto dos bytes da ROM
    /// (nada aqui vem de tabela de documento), confere o TileMap e o `font_08x08`
    /// da toolchain, e mede as fronteiras: os streams encostam uns nos outros,
    /// então o orçamento de reinserção de um recurso é o próprio tamanho dele.
    #[test]
    #[ignore = "aceite BYOR aPLib: requer ROM local com SHA esperado; rodar com --ignored"]
    fn byor_aplib_re_le_a_cadeia_do_tiledimage_e_pina_o_font_da_toolchain() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: o aceite exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        // (a) TiledImage em 0x21b5c = {palette*, tileset*, tilemap*}, três u32.
        assert_eq!(u32_be(&rom, 0x21b5c), 0x21b56, "ponteiro da paleta");
        assert_eq!(u32_be(&rom, 0x21b60), 0x21b44, "ponteiro do tileset");
        assert_eq!(u32_be(&rom, 0x21b64), 0x21b4c, "ponteiro do tilemap");

        // (b) TileSet: compression=1 (aPLib raw), 500 tiles, dados em 0x2e4d4.
        assert_eq!(u16_be(&rom, 0x21b44), 1);
        assert_eq!(u16_be(&rom, 0x21b46), 500);
        assert_eq!(u32_be(&rom, 0x21b48), 0x2e4d4);

        // (c) TileMap: {u16 compression; u16 w; u16 h; u32 data} = 40x28 em
        // 0x2d534. Não é header TileSet, então passa pelo decoder direto — o EOD
        // é o que delimita — e produz as 1 120 entradas de 2 bytes.
        assert_eq!(u16_be(&rom, 0x21b4c), 1);
        assert_eq!(u16_be(&rom, 0x21b4e), 40);
        assert_eq!(u16_be(&rom, 0x21b50), 28);
        assert_eq!(u32_be(&rom, 0x21b52), 0x2d534);
        let tilemap =
            aplib_decode(&rom[0x2d534..], &AplibLimits::default()).expect("TileMap APLIB");
        assert_eq!(tilemap.bytes_consumed, 1196);
        assert_eq!(tilemap.data.len(), 40 * 28 * 2);

        // (d) Palette: numColor=16 com data packed em +2 → 0x2cbe8.
        assert_eq!(u16_be(&rom, 0x21b56), 16);
        assert_eq!(u32_be(&rom, 0x21b58), 0x2cbe8);
        let paleta = &rom[0x2cbe8..0x2cbe8 + 32];
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(paleta),
            BYOR_SHA_PALETE_16W,
            "a paleta do plano visível mudou de identidade"
        );
        // Os dois índices da edição-alvo (ver o teste de capacidade): 2 = preto,
        // 14 = branco. Se a palavra for a mesma, a edição não apareceria em tela.
        assert_eq!(u16_be(paleta, 2 * 2), 0x0000);
        assert_eq!(u16_be(paleta, 14 * 2), 0x0eee);
        assert_ne!(u16_be(paleta, 2 * 2), u16_be(paleta, 14 * 2));

        // (e) font_08x08 da toolchain: header estrutural, verificação pelo
        // produto e identidade do stream E do plain.
        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == 0x270de)
            .expect("header TileSet do font 0x270de não apareceu no scan");
        assert_eq!(candidato.compression, TilesetCompression::Aplib);
        assert_eq!(candidato.num_tiles, 96);
        assert_eq!(candidato.stream_offset, 0x2cd94);
        assert_eq!(candidato.expected_len, 96 * 32);
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&rom[0x2cd94..0x2cd94 + 609]),
            BYOR_SHA_STREAM_FONT,
            "o stream do font não é o byte-idêntico ao da fixture autoral"
        );
        let font = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .expect("o produto recusou o font_08x08 real");
        assert_eq!(font.bytes_consumed, 609);
        assert_eq!(font.decoded.len(), 3072);
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&font.decoded),
            BYOR_SHA_PLAIN_FONT,
            "decode do font divergiu do par medido na fixture autoral"
        );

        // (f) Fronteiras encostadas: o stream do TileMap termina exatamente onde
        // começa o TileMap do SEGUNDO TiledImage (0x21b70 → 0x2d9e0). Não há
        // folga entre blocos, então o orçamento de cada recurso é o próprio
        // `bytes_consumed` — que é também o que a transação usa.
        assert_eq!(0x2d534 + tilemap.bytes_consumed, 0x2d9e0);
        assert_eq!(u16_be(&rom, 0x21b70), 1, "compression do segundo TileMap");
        assert_eq!(u32_be(&rom, 0x21b76), 0x2d9e0);
        // E o stream do TileSet visível tem UMA byte de folga antes do próximo
        // TileSet verificado (`0x21b68 → 0x2f65a`): orçamento folgado não existe
        // nesta ROM.
        let ts_visivel = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == 0x21b44)
            .expect("header TileSet 0x21b44 não apareceu no scan");
        let tileset = verify_aplib_resource(&rom, &ts_visivel, &AplibLimits::default())
            .expect("TileSet visível");
        assert_eq!(tileset.bytes_consumed, 4485);
        assert_eq!(u32_be(&rom, 0x21b6c), 0x2f65a);
        assert_eq!(0x2e4d4 + tileset.bytes_consumed + 1, 0x2f65a);
    }

    fn hamoopig_rom() -> Option<(Vec<u8>, String)> {
        let rom = std::fs::read(hamoopig_rom_path()).ok()?;
        let sha = super::super::rom_library::sha256_hex(&rom);
        Some((rom, sha))
    }

    /// Caminho canônico local da ROM BYOR: corpus somente leitura, fora do git.
    /// Os aceites que escrevem leem **deste** arquivo, nunca de cópia em `/tmp` —
    /// é o que permite a uma execução posterior conferir a identidade sem
    /// re-provisionar nada.
    fn hamoopig_rom_path() -> std::path::PathBuf {
        match std::env::var("RDS_HAMOOPIG_ROM") {
            Ok(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
            _ => std::path::PathBuf::from(
                "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin",
            ),
        }
    }

    /// O que a transação consegue fazer num recurso real: re-codifica o plain
    /// do TileSet visível (a) sem edição e (b) com a edição de UM pixel que a
    /// prova de tela vai usar, contra o orçamento que a própria ROM dá
    /// (`bytes_consumed`, porque os blocos encostam uns nos outros — medido no
    /// aceite anterior). Os comprimentos são um registro de capacidade: servem
    /// para detectar regressão do encoder e para não descobrir no meio do fluxo
    /// pela interface que a edição não cabe.
    ///
    /// A edição-alvo é a menor discriminação possível no plano: tile 1, linha 3,
    /// coluna 5, índice 2 → 14 (preto → branco na paleta pinada). O tile 1 é
    /// referenciado por exatamente UMA célula do tilemap 40x28, sem flip, sem
    /// prioridade e no banco 0, então a posição prevista em tela é
    /// x = 24*8 = 192, y = 1*8 = 8 (retângulo 192..199 x 8..15). Tudo isso é
    /// conferido abaixo a partir do plain decodificado pelo produto, não de
    /// anotação.
    #[test]
    #[ignore = "registro de capacidade BYOR aPLib: requer ROM local com SHA esperado"]
    fn byor_aplib_registra_capacidade_de_reinsercao_no_tileset_visivel() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        const SHA_TILESET: &str =
            "dd7affc3971a73840b84b028c0f41372b49c52df3f4f29d09885c59e83b80f5f";
        const SHA_TILEMAP: &str =
            "c196aa5ba9b29a440b2680afb000795cebee242346503fb2342fd11ee5a704f1";
        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: o aceite exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == 0x21b44)
            .expect("header TileSet 0x21b44 não apareceu no scan estrutural");
        let verificado = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .expect("o decoder do produto recusou o TileSet real");
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&verificado.decoded),
            SHA_TILESET
        );
        let plain = &verificado.decoded;
        let orcamento = verificado.bytes_consumed;

        // ---- a edição-alvo: um byte do tile 1, mudando um pixel de 2 para 14.
        // Chunky packed-nibble 4bpp: byte = linha*4 + coluna/2, nibble ALTO para
        // coluna par. Linha 3, coluna 5 → byte 14 do tile, nibble baixo.
        let byte_editado = 1 * 32 + 3 * 4 + 5 / 2;
        assert_eq!(plain[byte_editado] & 0x0f, 2, "índice original do pixel");
        assert_eq!(plain[byte_editado] >> 4, 2, "pixel vizinho não pode mudar");
        let mut editado = plain.clone();
        editado[byte_editado] = (plain[byte_editado] & 0xf0) | 0x0e; // 2 -> 14
        assert_eq!(
            plain
                .iter()
                .zip(editado.iter())
                .filter(|(a, b)| a != b)
                .count(),
            1,
            "a prova exige edição de exatamente um byte"
        );

        // ---- posição prevista em tela, medida do tilemap real.
        let tilemap =
            aplib_decode(&rom[0x2d534..], &AplibLimits::default()).expect("TileMap APLIB");
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&tilemap.data),
            SHA_TILEMAP
        );
        let mut celulas = Vec::new();
        for i in 0..(40 * 28) {
            let e = u16_be(&tilemap.data, i * 2);
            if usize::from(e & 0x7ff) == 1 {
                celulas.push((i % 40, i / 40, e));
            }
        }
        assert_eq!(celulas.len(), 1, "o tile 1 tem que aparecer uma vez");
        let (coluna, linha, entrada) = celulas[0];
        assert_eq!(entrada & 0x7ff, 1);
        assert_eq!(entrada >> 11 & 1, 0, "hflip mudaria a posição do pixel");
        assert_eq!(entrada >> 12 & 1, 0, "vflip mudaria a posição do pixel");
        assert_eq!(entrada >> 13 & 3, 0, "banco de paleta");
        let (x, y) = (coluna * 8 + 5, linha * 8 + 3);
        println!(
            "edição-alvo: byte {byte_editado} do tile 1; célula ({coluna},{linha}) \
                  -> pixel de tela ({x},{y}); orçamento do stream {orcamento} B"
        );

        // ---- capacidade. `usize::MAX` mostra o que o encoder produz por
        // natureza; o orçamento mostra o que entra no slot.
        let solto =
            aplib_encode(plain, &AplibEncodeLimits::default()).expect("encode sem orçamento");
        let no_slot = aplib_encode(
            plain,
            &AplibEncodeLimits {
                max_stream: orcamento,
                ..Default::default()
            },
        );
        let editado_slot = aplib_encode(
            &editado,
            &AplibEncodeLimits {
                max_stream: orcamento,
                ..Default::default()
            },
        );
        // A recusa é estruturada e cita plain, stream e orçamento, senão quem
        // está na interface não sabe o que falta.
        for (nome, resultado, stream) in [
            ("plain intacto", &no_slot, solto.len()),
            ("plain editado", &editado_slot, 4550),
        ] {
            let erro = resultado
                .as_ref()
                .expect_err(&format!("{nome} não pode caber num slot de {orcamento} B"));
            assert_eq!(erro.code, "needs_space", "{nome}: {erro}");
            assert!(
                erro.detail.contains(&format!("{} bytes de stream", stream))
                    && erro.detail.contains(&format!("orçamento de {orcamento}")),
                "{nome}: recusa sem os dois números: {}",
                erro.detail
            );
            println!("{nome}: {erro}");
        }
        // ---- Tabela de capacidade dos quatro TileSets aPLib verificados nesta
        // ROM: o slot é o tamanho do stream que a toolchain produziu. Um
        // encoder que não iguala o do build não consegue re-inserir nada, nem
        // sem edição — por isso a linha é medida antes de escolher edição. O
        // `assert_eq!` no final é o registro congelado: mexer no encoder tem
        // que quebrá-lo e a quebra tem que ser deliberada.
        println!("--- capacidade por recurso (stream do produto vs slot real) ---");
        let mut tabela = Vec::new();
        for header in [0x270deusize, 0x21b20, 0x21b44, 0x21b68] {
            let c = scan_tileset_headers(&rom)
                .into_iter()
                .find(|x| x.header_offset == header)
                .expect("candidato conhecido sumiu do scan");
            let r =
                verify_aplib_resource(&rom, &c, &AplibLimits::default()).expect("recurso sumiu");
            let natural = aplib_encode(&r.decoded, &AplibEncodeLimits::default())
                .expect("encoder do produto recusou o próprio plain");
            println!(
                "header {header:#x}: plain {} B | slot {} B | produto {} B | folga {} B | {}",
                r.decoded.len(),
                r.bytes_consumed,
                natural.len(),
                r.bytes_consumed as isize - natural.len() as isize,
                if natural.len() <= r.bytes_consumed {
                    "CABE"
                } else {
                    "NÃO CABE"
                }
            );
            tabela.push((header, r.decoded.len(), r.bytes_consumed, natural.len()));
        }
        assert_eq!(
            tabela,
            [
                (0x270de, 3072, 609, 609),
                (0x21b20, 3200, 938, 937),
                (0x21b44, 16000, 4485, 4544),
                (0x21b68, 17376, 7420, 7442),
            ],
            "registro de capacidade aPLib em ROM comercial: (header, plain, slot, \
             stream do produto). Dois recursos não comportam nem o re-encode sem \
             edição — o visível fica 59 B acima do slot, e é o alvo da prova de tela"
        );

        // Não caber é fato de ESPAÇO, não de stream inválido: os dois streams
        // (plain intacto e editado), medidos sem orçamento, têm que voltar byte a
        // byte pelo decoder do produto consumindo o stream inteiro. Se isso
        // falhar, a conclusão "não coube" não vale nada.
        let editado_solto = aplib_encode(&editado, &AplibEncodeLimits::default())
            .expect("a edição de 1 byte não é representável pelo formato?");
        assert_eq!(editado_solto.len(), 4550, "custo da edição medida");
        for (nome, stream, esperado) in [
            ("plain intacto", &solto, plain.as_slice()),
            ("plain com a edição", &editado_solto, editado.as_slice()),
        ] {
            let d = aplib_decode(stream, &AplibLimits::default())
                .unwrap_or_else(|e| panic!("{nome}: o próprio produto não relê seu stream: {e}"));
            assert_eq!(d.bytes_consumed, stream.len(), "{nome}: lê além do EOD");
            assert_eq!(d.data, esperado, "{nome}: ida e volta não bate");
        }
    }

    /// Varredura de **edição que cabe**: para cada pixel em tela de um TileSet
    /// real, quanto custa re-codificar o plain com aquele índice trocado, contra
    /// o slot que a ROM dá. Instrumento de escolha, não aceite — roda `#[ignore]`
    /// e não publica bytes.
    ///
    /// Rodar: `cargo test --lib byor_varre -- --ignored --nocapture`
    ///
    /// Existe porque a prova de tela precisa de uma edição que caiba. O TileSet
    /// visível da cadeia 40x28 (0x21b44) não comporta nem o re-encode sem
    /// edição, então a escolha tem que sair de medida, não de preferência. Os
    /// critérios estruturais vêm do censo das cadeias
    /// (`scripts/rex_profiles/integrator/aplib/survey_tiledimage_refs.py`): só
    /// entram tiles referenciados por exatamente UMA célula, sem flip e sem
    /// banco, porque isso é o que dá uma posição prevista em tela; e só entram
    /// índices cuja palavra de paleta difere, porque edição invisível não prova
    /// nada.
    #[test]
    #[ignore = "varredura BYOR: requer ROM local com SHA esperado"]
    fn byor_varre_as_edicoes_de_pixel_que_cabem_no_slot() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        // TileSet de 100 tiles com 1 byte de folga (slot 938, natural 937) e
        // TiledImage próprio em 0x21b38 → paleta 0x21b32, TileMap 0x21b28.
        const HEADER: usize = 0x21b20;
        const TILEDIMAGE: usize = 0x21b38;
        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: a medida exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == HEADER)
            .expect("header do TileSet varrido não apareceu no scan");
        let verificado = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .expect("recurso sumiu");
        let plain = &verificado.decoded;
        let slot = verificado.bytes_consumed;
        let natural = aplib_encode(plain, &AplibEncodeLimits::default()).expect("natural");
        println!(
            "recurso {HEADER:#x}: plain {} B | slot {slot} B | natural {} B | folga {} B",
            plain.len(),
            natural.len(),
            slot as isize - natural.len() as isize,
        );

        // ---- a cadeia, lida do ROM (não de anotação): TiledImage empacotado
        // {palette*, tileset*, tilemap*}.
        assert_eq!(
            u32_be(&rom, TILEDIMAGE + 4) as usize,
            HEADER,
            "o TiledImage não aponta o TileSet varrido"
        );
        let (palette_ptr, tilemap_ptr) = (
            u32_be(&rom, TILEDIMAGE) as usize,
            u32_be(&rom, TILEDIMAGE + 8) as usize,
        );
        let pal_data = u32_be(&rom, palette_ptr + 2) as usize;
        let cor = |idx: usize| u16_be(&rom, pal_data + idx * 2);
        let (w, h) = (
            usize::from(u16_be(&rom, tilemap_ptr + 2)),
            usize::from(u16_be(&rom, tilemap_ptr + 4)),
        );
        let mapa = aplib_decode(
            &rom[u32_be(&rom, tilemap_ptr + 6) as usize..],
            &AplibLimits::default(),
        )
        .expect("TileMap da cadeia");
        assert_eq!(mapa.data.len(), w * h * 2, "tilemap {w}x{h}");

        // Tile → TODAS as células (com flip e banco), porque a prova exige
        // enumerar cada lugar onde o tile aparece: uma edição num tile
        // multi-célula muda a tela em todos eles, e a previsão tem que cobri-los.
        let mut por_tile: std::collections::BTreeMap<usize, Vec<(usize, usize, bool, bool)>> =
            Default::default();
        for i in 0..(w * h) {
            let e = u16_be(&mapa.data, i * 2);
            por_tile.entry(usize::from(e & 0x7ff)).or_default().push((
                i % w,
                i / w,
                e >> 11 & 1 == 1,
                e >> 12 & 1 == 1,
            ));
        }
        // `RDS_APLIB_SWEEP_TILES` restringe a varredura a tiles concretos
        // (medição dirigida: os tiles que o censo de pixels prova estarem em
        // tela); sem a variável, varre os de célula única sem flip.
        let alvo: Vec<usize> = match std::env::var("RDS_APLIB_SWEEP_TILES") {
            Ok(v) => v
                .split(',')
                .map(|s| s.trim().parse::<usize>().expect("tile inválido"))
                .collect(),
            Err(_) => por_tile
                .iter()
                .filter(|(_, c)| c.len() == 1 && !c[0].2 && !c[0].3)
                .map(|(t, _)| *t)
                .collect(),
        };
        println!(
            "tilemap {w}x{h}: {} tiles referenciados, {} na varredura",
            por_tile.len(),
            alvo.len()
        );

        // ---- a varredura: byte a byte dos tiles-alvo, nibble alto (coluna
        // par) e baixo (coluna ímpar), para cada índice novo de cor diferente.
        let mut testados = 0usize;
        let mut cabem: Vec<(usize, usize, usize, usize, usize, usize, String)> = Vec::new();
        for &tile in &alvo {
            for byte_em_tile in 0..32usize {
                let byte = tile * 32 + byte_em_tile;
                let linha_pixel = byte_em_tile / 4;
                for (mascara, desloc, coluna_pixel_base) in
                    [(0x0fu8, 0usize, 1usize), (0xf0u8, 4, 0usize)]
                {
                    let original = usize::from((plain[byte] & mascara) >> desloc);
                    for novo in 0..16usize {
                        if novo == original || cor(novo) == cor(original) {
                            continue;
                        }
                        let coluna_pixel = (byte_em_tile % 4) * 2 + coluna_pixel_base;
                        let mut editado = plain.clone();
                        editado[byte] = (plain[byte] & !mascara) | ((novo as u8) << desloc);
                        assert_eq!(
                            editado
                                .iter()
                                .zip(plain.iter())
                                .filter(|(a, b)| a != b)
                                .count(),
                            1
                        );
                        testados += 1;
                        let r = aplib_encode(
                            &editado,
                            &AplibEncodeLimits {
                                max_stream: slot,
                                ..Default::default()
                            },
                        );
                        if let Ok(s) = r {
                            let celulas = por_tile[&tile]
                                .iter()
                                .map(|(a, b, hf, vf)| {
                                    format!(
                                        "({},{}){}{} → pixel de tela ({},{})",
                                        a,
                                        b,
                                        if *hf { "H" } else { "" },
                                        if *vf { "V" } else { "" },
                                        a * 8 + coluna_pixel,
                                        b * 8 + linha_pixel
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join(" | ");
                            cabem.push((
                                s.len(),
                                tile,
                                coluna_pixel,
                                linha_pixel,
                                original,
                                novo,
                                celulas,
                            ));
                        }
                    }
                }
            }
        }
        cabem.sort();
        println!(
            "varredura: {testados} edições de 1 pixel candidatas | {} cabem no slot de {slot} B",
            cabem.len()
        );
        for (len, tile, cp, lp, orig, novo, celulas) in cabem.iter().take(12) {
            println!(
                "  CABE {len} B: tile {tile} pixel do tile ({cp},{lp}) índice {orig}→{novo} | \
                 cores {:#06x}→{:#06x} | {celulas}",
                cor(*orig),
                cor(*novo)
            );
        }
    }

    /// A edição escolhida para a prova de tela, pinada com os números que a
    /// justificam. Diferente do registro de capacidade do TileSet visível (que
    /// não comporta nem o re-encode sem edição): este recurso **comporta**, e a
    /// escolha não é preferência — saiu da varredura acima cruzada com a
    /// evidência de quadro da perna A.
    ///
    /// Por que este pixel: o TileSet `0x21b20` é o recurso cuja paleta (`0x2cbc8`)
    /// a perna A usou para atribuir 100% dos 2 938 pixels residuais do
    /// `checkpoint-129` (captura determinista, Genesis Plus GX v1.7.4 `46a5521`,
    /// sequência REX-00) a oclusão total — ou seja, são pixels observados em tela
    /// que pertencem a ESTE recurso, não ao fundo. As duas evidências são
    /// citadas por SHA, não copiadas para este arquivo:
    /// `dbdc122:docs/rex_profiles/lz4w/VISIBLE-RESOURCE-EVIDENCE.md` =
    /// `ac850f420f1fd8f6d1d3aa46e1f0c11badbe9b8cbbf55d889e9f58b252c8f0c8`,
    /// `dbdc122:data/rex_profiles/lz4w/residual-attribution-cp129.json` =
    /// `febb6d0edded4b9e206145ead7abe5a3258de8f15067b588eda7354b5fb02ed5`. Os
    /// dois retângulos das células deste tile estão **inteiros** dentro do
    /// conjunto de pixels residuais daquele JSON (`x 280..287, y 128..135` no
    /// cluster 4 e `x 208..215, y 200..207` no cluster 0), então o pixel editado
    /// é observado, não inferido — e a re-execuição da comparação é tarefa do
    /// passo 5, não alegação desta pin.
    #[test]
    #[ignore = "edição-alvo BYOR aPLib: requer ROM local com SHA esperado"]
    fn byor_aplib_pina_a_edicao_de_pixel_que_cabe_e_eh_observada_em_tela() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        const HEADER: usize = 0x21b20;
        const TILEDIMAGE: usize = 0x21b38;
        const TILE: usize = 53;
        const COLUNA_PIXEL: usize = 4;
        const LINHA_PIXEL: usize = 0;
        const INDICE_ORIGINAL: usize = 5;
        const INDICE_NOVO: usize = 0;
        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: a prova exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        // ---- recurso e slot.
        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.header_offset == HEADER)
            .expect("TileSet 0x21b20 sumiu do scan estrutural");
        let verificado = verify_aplib_resource(&rom, &candidato, &AplibLimits::default())
            .expect("recurso sumiu");
        let plain = &verificado.decoded;
        let slot = verificado.bytes_consumed;
        assert_eq!((plain.len(), slot), (3200, 938), "recurso/slot mudaram");
        assert_eq!(candidato.stream_offset, 0x2e12a);
        // O bloco vizinho encosta: 0x2e12a + 938 = 0x2e4d4, que é o `data` do
        // TileSet visível. Escrever mais de 938 bytes esmagaria outro recurso.
        assert_eq!(candidato.stream_offset + slot, 0x2e4d4, "fronteira do slot");

        // ---- a cadeia lida da ROM: TiledImage → paleta e TileMap.
        assert_eq!(u32_be(&rom, TILEDIMAGE + 4) as usize, HEADER);
        let (palette_ptr, tilemap_ptr) = (
            u32_be(&rom, TILEDIMAGE) as usize,
            u32_be(&rom, TILEDIMAGE + 8) as usize,
        );
        let pal_data = u32_be(&rom, palette_ptr + 2) as usize;
        assert_eq!(
            pal_data, 0x2cbc8,
            "a paleta é a da tabela de oclusão atribuída"
        );
        let cor = |idx: usize| u16_be(&rom, pal_data + idx * 2);
        // As duas cores da edição, e por que elas são distinguíveis no quadro:
        // 5 = 0x0468 → (137,102,68) em canle8; 0 = preto. O comparador da perna A
        // trabalha com tolerância ±4 por canal, então a distância é ~34× o ruído.
        assert_eq!((cor(INDICE_ORIGINAL), cor(INDICE_NOVO)), (0x0468, 0x0000));
        let (w, h) = (
            usize::from(u16_be(&rom, tilemap_ptr + 2)),
            usize::from(u16_be(&rom, tilemap_ptr + 4)),
        );
        assert_eq!((w, h), (40, 28));
        let mapa = aplib_decode(
            &rom[u32_be(&rom, tilemap_ptr + 6) as usize..],
            &AplibLimits::default(),
        )
        .expect("TileMap da cadeia");

        // ---- TODAS as células que usam o tile, com flip e banco: a previsão de
        // tela tem que cobrir cada uma delas.
        let celulas: Vec<(usize, usize, u16)> = (0..w * h)
            .map(|i| (i % w, i / w, u16_be(&mapa.data, i * 2)))
            .filter(|(_, _, e)| usize::from(e & 0x7ff) == TILE)
            .collect();
        assert_eq!(
            celulas,
            vec![(35, 16, 0x0035), (26, 25, 0x0035)],
            "as colocações/flags do tile {TILE} mudaram — a previsão de tela precisa ser re-derivada"
        );
        for (_, _, e) in &celulas {
            assert_eq!(e >> 11 & 1, 0, "hflip moveria o pixel");
            assert_eq!(e >> 12 & 1, 0, "vflip moveria o pixel");
            assert_eq!(e >> 13 & 3, 0, "banco de paleta diferente mudaria a cor");
        }
        let previstos: Vec<(usize, usize)> = celulas
            .iter()
            .map(|(c, l, _)| (c * 8 + COLUNA_PIXEL, l * 8 + LINHA_PIXEL))
            .collect();
        assert_eq!(previstos, vec![(284, 128), (212, 200)]);

        // ---- a edição: um byte, um nibble, exatamente um pixel por colocação.
        let byte = TILE * 32 + LINHA_PIXEL * 4 + COLUNA_PIXEL / 2;
        assert_eq!(byte, 1698);
        assert_eq!(
            plain[byte], 0x55,
            "o tile {TILE} é sólido de índice 5; se deixou de ser, a previsão de 2 pixels cai"
        );
        let mut editado = plain.clone();
        editado[byte] = (plain[byte] & 0x0f) | ((INDICE_NOVO as u8) << 4); // 0x55 -> 0x05
        assert_eq!(
            editado
                .iter()
                .zip(plain.iter())
                .filter(|(a, b)| a != b)
                .count(),
            1,
            "a prova exige edição de exatamente um byte"
        );

        // ---- capacidade: cabe no slot com 1 byte de folga, e o que cabe tem que
        // ser lido de volta pelo decoder do produto consumindo o stream inteiro.
        let novo = aplib_encode(
            &editado,
            &AplibEncodeLimits {
                max_stream: slot,
                ..Default::default()
            },
        )
        .expect("a edição escolhida deixou de caber no slot");
        assert_eq!(
            novo.len(),
            937,
            "custo congelado da edição (slot 938): mexer aqui é decisão registrada"
        );
        let lido = aplib_decode(&novo, &AplibLimits::default())
            .expect("o produto não relê o próprio stream");
        assert_eq!(lido.data, editado, "ida e volta não bate");
        assert_eq!(lido.bytes_consumed, novo.len(), "leu além do EOD");

        // Não-regressão da transação: o stream encurtado deixa 1 byte do stream
        // antigo no slot (é a regra de escrita — só os `novo.len()` bytes primeiros
        // são reescritos), e o bloco vizinho continua intacto.
        assert!(novo.len() < slot, "sem folga não há escrita em slot fixo");
    }

    /// Passo 5, perna 1 — o **fluxo do produto** sobre o recurso aPLib real
    /// pinado no passo 4: listar → prévia → no-op → editar → conferir os bytes
    /// escritos por fora → reaplicar o BPS numa cópia íntegra → reabrir a
    /// modificada. Roda pelo mesmo caminho que a UI chama
    /// (`list_resources`/`preview_resource`/`apply_resource_edit` são os
    /// comandos Tauri), com a ROM lida do corpus somente leitura e os artefatos
    /// no diretório de trabalho canônico do produto.
    ///
    /// O que este aceite **não** é: nem o WebDriver (perna 2) nem o oráculo
    /// decisivo. Ele prova a transação sobre bytes reais; só a execução do
    /// recurso modificado pelo desempacotador do próprio jogo (perna 3) prova o
    /// efeito em tela.
    ///
    /// **Medido com mutante, para não alegar o que não pega.** (a) Trocando o
    /// re-encode aPLib para codificar o plain **original** em vez do editado, este
    /// teste cai em `expect("edição aPLib no recurso real")` — o guarda de ida e
    /// volta de `recodificar_no_espaco` recusa a escrita, então a asserção
    /// `aplicada.outcome == "applied"` tem dente. Caem juntos com o mesmo mutante
    /// `reinsert_aplib_edita_tile_e_preserva_lz4w_na_mesma_rom`,
    /// `reinsert_aplib_exige_identidade_de_rom_e_evidencia_deste_tronco`,
    /// `reinsert_aplib_recusa_edicao_que_nao_cabe_no_slot`,
    /// `reinsert_aplib_recusa_edicao_que_mudaria_lz4w_dependente` e
    /// `ui_edite_recurso_aplib_pela_mesma_fronteira_do_lz4w` (5 reprovados).
    /// (b) Enfraquecendo a guarda de dependente (comparar só o comprimento do
    /// plain em vez do conteúdo) este teste **continua verde com os mesmos
    /// hashes** — nesta ROM e nesta edição nenhum recurso verificado muda de
    /// decode, e a asserção `divergentes == [STREAM]` registra esse fato, não o
    /// funcionamento da guarda. Quem prova a guarda são
    /// `reinsert_aplib_recusa_edicao_que_mudaria_lz4w_dependente` e
    /// `transaction_rejects_known_dependent_modified`, que caem com o mesmo
    /// mutante. Os dois mutantes foram revertidos e a árvore conferida por diff.
    ///
    /// Rodar: `cargo test --lib byor_aplib_edite_o_recurso_pelo_fluxo -- --ignored --nocapture`
    #[test]
    #[ignore = "fluxo BYOR aPLib: requer ROM local com SHA esperado"]
    fn byor_aplib_edite_o_recurso_pelo_fluxo_do_produto() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        const HEADER: u64 = 0x21b20;
        const STREAM: u64 = 0x2e12a;
        const SLOT: u32 = 938;
        const CUSTO: u32 = 937;
        const TILE: u32 = 53;
        const LINHA: u32 = 0;
        const COLUNA: u32 = 4;
        const INDICE_NOVO: u8 = 0;
        const BYTE: usize = 1698;
        let caminho_os = hamoopig_rom_path();
        let caminho = caminho_os.to_str().expect("caminho utf8 do corpus");
        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: o aceite exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        // ---- abrir e selecionar: a lista do produto tem que trazer o recurso
        // pinado com o codec do header, e o escopo tem que declarar o denominador.
        let (sha_listado, listados) = list_resources(caminho).expect("listar recursos");
        assert_eq!(sha_listado, SHA_ROM, "a lista anunciou outra ROM");
        let com_o_stream: Vec<&ResourceSummary> = listados
            .iter()
            .filter(|r| r.stream_offset == STREAM)
            .collect();
        assert_eq!(
            com_o_stream.len(),
            1,
            "o stream pinado tem que aparecer exatamente uma vez"
        );
        let pino = com_o_stream[0];
        assert_eq!(
            (
                pino.codec.as_str(),
                pino.header_offset,
                pino.num_tiles,
                pino.data_len,
                pino.stream_len
            ),
            ("aplib", HEADER, 100, 3200, SLOT),
            "o recurso pinado no passo 4 mudou de identidade na lista"
        );
        assert_eq!(
            listados.iter().filter(|r| r.codec == "aplib").count(),
            4,
            "os quatro aPLib verificados do censo têm que estar na lista"
        );

        // ---- pre-visualizar: leitura pura, sem escrita.
        let previa = preview_resource(caminho, STREAM).expect("prévia do recurso pinado");
        assert_eq!(previa.outcome, "preview");
        assert_eq!(previa.codec, "aplib");
        assert_eq!(previa.original_stream_len, SLOT);
        assert_eq!(previa.stream_written, None, "prévia não pode escrever");
        assert_eq!(previa.modified_rom_path, None);
        assert_eq!(previa.patch_bps_path, None);
        assert_eq!(
            (previa.preview_width, previa.preview_height),
            (Some(128), Some(56)),
            "100 tiles em grade de 16 por linha = 7 linhas"
        );
        assert!(
            previa.analyzed_scope.contains("164/205")
                && previa.analyzed_scope.contains("aPLib 4/14"),
            "escopo sem denominador por codec: {}",
            previa.analyzed_scope
        );

        // ---- controle de no-op: mesmo estado, mesmas entradas, nenhuma escrita.
        let noop = apply_resource_edit(caminho, STREAM, &[], &sha).expect("no-op pela fronteira");
        assert_eq!(noop.outcome, "noop", "{noop:?}");
        assert_eq!(noop.modified_rom_path, None, "no-op escreveu cópia");
        assert_eq!(noop.patch_bps_path, None, "no-op escreveu patch");
        assert_eq!(noop.stream_written, None);
        assert_eq!(
            noop.preview_pixels_sha256, previa.preview_pixels_sha256,
            "o no-op mudou a prévia: entrada igual, saída diferente"
        );

        // ---- editar: a edição pinada do passo 4, pelos mesmos parâmetros que a
        // UI envia (tile, linha, coluna, índice).
        let aplicada = apply_resource_edit(
            caminho,
            STREAM,
            &[PixelEdit {
                tile: TILE,
                row: LINHA,
                col: COLUNA,
                index: INDICE_NOVO,
            }],
            &sha,
        )
        .expect("edição aPLib no recurso real");
        assert_eq!(aplicada.outcome, "applied", "{aplicada:?}");
        assert_eq!(aplicada.codec, "aplib");
        assert_eq!(aplicada.original_stream_len, SLOT);
        assert_eq!(
            aplicada.stream_written,
            Some(CUSTO),
            "custo congelado no passo 4: a edição cabe com 1 B de folga"
        );
        assert_eq!(
            aplicada.verified_preserved,
            Some(listados.len() - 1),
            "preservação tem que cobrir os outros recursos verificados"
        );
        assert_ne!(
            aplicada.preview_pixels_sha256, previa.preview_pixels_sha256,
            "a edição não mudou a prévia: nada foi pintado"
        );

        // Proveniência: os artefatos existem no diretório de trabalho canônico,
        // com o codec no nome e os SHA-256 que o produto declarou.
        let trabalho = super::super::rom_library::decomp_work_dir();
        let copia = std::path::Path::new(aplicada.modified_rom_path.as_deref().expect("cópia"));
        let patch = std::path::Path::new(aplicada.patch_bps_path.as_deref().expect("patch"));
        assert!(
            copia.starts_with(&trabalho) && patch.starts_with(&trabalho),
            "artefatos fora do diretório de trabalho do produto: {copia:?} {patch:?}"
        );
        assert!(
            copia
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("rex-aplib-modified-"),
            "nome sem codec: {copia:?}"
        );
        let bytes_copia = std::fs::read(copia).expect("ler cópia");
        let bytes_patch = std::fs::read(patch).expect("ler patch");
        assert_eq!(bytes_copia.len(), rom.len(), "a cópia expandiu a ROM");
        assert_eq!(
            super::super::rom_library::sha256_hex(&bytes_copia),
            aplicada
                .modified_rom_sha256
                .as_deref()
                .expect("sha da cópia")
        );
        assert_eq!(
            super::super::rom_library::sha256_hex(&bytes_patch),
            aplicada.patch_bps_sha256.as_deref().expect("sha do patch")
        );
        // A ROM do corpus não é tocada: a edição só existe na cópia endereçada
        // por hash e no patch.
        assert_eq!(std::fs::read(caminho).expect("reler corpus"), rom);

        // ---- conferência por fora do que o produto declara: o que foi escrito
        // no slot, byte a byte.
        let diferentes: Vec<usize> = (0..rom.len())
            .filter(|&i| rom[i] != bytes_copia[i])
            .collect();
        assert!(!diferentes.is_empty(), "a escrita foi vazia");
        assert!(
            diferentes
                .iter()
                .all(|&i| (STREAM as usize..STREAM as usize + SLOT as usize).contains(&i)),
            "fora do slot: {:?} primeiro de {}",
            &diferentes[..diferentes.len().min(4)],
            diferentes.len()
        );
        let lido = aplib_decode(&bytes_copia[STREAM as usize..], &AplibLimits::default())
            .expect("o desempacotador do produto não relê o que o produto escreveu");
        let plain_original = aplib_decode(&rom[STREAM as usize..], &AplibLimits::default())
            .expect("plain original")
            .data;
        assert_eq!(lido.bytes_consumed, CUSTO as usize);
        assert_eq!(lido.data.len(), plain_original.len());
        let mudados: Vec<usize> = (0..lido.data.len())
            .filter(|&i| lido.data[i] != plain_original[i])
            .collect();
        assert_eq!(mudados, vec![BYTE], "mais de um byte de plain mudou");
        assert_eq!(
            (plain_original[BYTE], lido.data[BYTE]),
            (0x55, 0x05),
            "não é o nibble da edição pinada"
        );
        // O bloco vizinho (o TileSet visível do §2 do plano) encosta em
        // `STREAM + SLOT` e tem que continuar decodificando no mesmo plain.
        let vizinho = aplib_decode(&bytes_copia[0x2e4d4..], &AplibLimits::default())
            .expect("vizinho esmagado");
        assert_eq!(vizinho.data.len(), 16000);
        assert_eq!(
            vizinho.data,
            aplib_decode(&rom[0x2e4d4..], &AplibLimits::default())
                .expect("vizinho original")
                .data,
            "o re-encode alterou o recurso encostado"
        );

        // Conferência geométrica por fora da prévia: no **canvas do recurso** a
        // edição pinta um pixel (cada tile aparece uma vez na grade); na **tela**
        // são dois, porque o TileMap coloca o tile 53 em duas células. Essa
        // diferença de 1 para 2 é justamente o que a perna de execução cobra.
        let largura_tira = 100 * 8;
        let tira_original = md_tiles_to_rgba(&plain_original);
        let tira_editada = md_tiles_to_rgba(&lido.data);
        let pintados: Vec<(usize, usize)> = (0..largura_tira * 8)
            .map(|p| (p % largura_tira, p / largura_tira))
            .filter(|(x, y)| {
                let i = (y * largura_tira + x) * 4;
                tira_original[i..i + 4] != tira_editada[i..i + 4]
            })
            .collect();
        assert_eq!(
            pintados,
            vec![(TILE as usize * 8 + COLUNA as usize, LINHA as usize)],
            "a edição pintou outro pixel no canvas além do pinado"
        );

        // ---- preservação de dependentes medida **por fora** do auto-relato: o
        // produto diz quantos recursos preservou (`verified_preserved`), mas isso
        // é uma palavra dele. Aqui o conjunto da cópia é re-verificado do zero e
        // cada plain é comparado com o plain correspondente da ROM íntegra. É
        // isto que pega um LZ4W cujo dicionário contém a cauda do stream aPLib —
        // o caso que fez a transação nascer com essa guarda.
        let mut antes = std::collections::BTreeMap::new();
        for r in verify_resource_set(&rom, &TransactionLimits::default())
            .expect("conjunto da ROM íntegra")
            .resources
        {
            antes.insert(r.candidate().stream_offset, r.decoded().to_vec());
        }
        let depois = verify_resource_set(&bytes_copia, &TransactionLimits::default())
            .expect("conjunto da cópia modificada");
        let agora: std::collections::BTreeMap<usize, Vec<u8>> = depois
            .resources
            .iter()
            .map(|r| (r.candidate().stream_offset, r.decoded().to_vec()))
            .collect();
        assert_eq!(
            agora.keys().collect::<Vec<_>>(),
            antes.keys().collect::<Vec<_>>(),
            "a escrita ganhou ou perdeu recursos verificáveis"
        );
        let divergentes: Vec<usize> = antes
            .iter()
            .filter(|(offset, plain)| agora[*offset] != **plain)
            .map(|(offset, _)| *offset)
            .collect();
        assert_eq!(
            divergentes,
            vec![STREAM as usize],
            "algum recurso além do editado mudou de decode — dependente atingido"
        );
        assert_eq!(agora[&(STREAM as usize)], lido.data);

        // ---- reaplicar: o BPS produzido, aplicado sobre a ROM íntegra, tem que
        // reproduzir a cópia byte a byte (oráculo do patch, não do codec).
        let reaplicado =
            crate::tools::patch_studio::apply_bps(&rom, &bytes_patch).expect("reaplicar BPS");
        assert_eq!(
            reaplicado, bytes_copia,
            "BPS reaplicado não reproduz a cópia do produto"
        );

        // ---- reabrir: a prévia lida da cópia modificada é a prévia declarada
        // pela edição (ida e volta pela fronteira da interface).
        let previa_modificada =
            preview_resource(copia.to_str().expect("caminho utf8 da cópia"), STREAM)
                .expect("reabrir a cópia");
        assert_eq!(
            previa_modificada.preview_pixels_sha256, aplicada.preview_pixels_sha256,
            "a cópia reaberta não reflete a edição aplicada"
        );
        assert_eq!(
            previa_modificada.rom_sha256,
            aplicada.modified_rom_sha256.as_deref().expect("sha")
        );

        println!(
            "fluxo BYOR aPLib: cópia {} B sha {} | BPS {} B sha {} | recursos verificados {} | \
             stream editado {} B escritos, {} posições do slot diferentes | \
             prévia original {} | prévia editada {}",
            bytes_copia.len(),
            aplicada.modified_rom_sha256.expect("sha"),
            bytes_patch.len(),
            aplicada.patch_bps_sha256.expect("sha"),
            antes.len(),
            aplicada.stream_written.expect("custo"),
            diferentes.len(),
            previa.preview_pixels_sha256.expect("sha"),
            aplicada.preview_pixels_sha256.expect("sha"),
        );
    }

    /// Censo dos headers aPLib que o produto verifica nesta ROM, com o custo do
    /// conjunto completo (`verify_resource_set`, que é o caminho da UI).
    #[test]
    #[ignore = "censo BYOR: requer ROM local com SHA esperado"]
    fn byor_aplib_censa_os_headers_verificaveis_e_o_custo_do_conjunto() {
        const SHA_ROM: &str = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
        let (rom, sha) = hamoopig_rom().expect("ROM BYOR ausente: o aceite exige o arquivo");
        assert_eq!(sha, SHA_ROM, "identidade da ROM BYOR divergente");

        let candidatos = scan_tileset_headers(&rom);
        let aplib: Vec<_> = candidatos
            .iter()
            .filter(|c| c.compression == TilesetCompression::Aplib)
            .collect();
        let mut verificados = 0usize;
        for c in &aplib {
            match verify_aplib_resource(&rom, c, &AplibLimits::default()) {
                Ok(r) => {
                    verificados += 1;
                    println!(
                        "aPLib verificado: header {:#x} → stream {:#x}, {} tiles, \
                         plain {} B, consumo {} B",
                        c.header_offset,
                        c.stream_offset,
                        c.num_tiles,
                        r.decoded.len(),
                        r.bytes_consumed
                    );
                }
                Err(e) => println!(
                    "aPLib recusado: header {:#x} → {:#x}: {}",
                    c.header_offset, c.stream_offset, e.code
                ),
            }
        }
        println!(
            "censo: {} headers aPLib candidatos, {} verificados; {} LZ4W candidatos",
            aplib.len(),
            verificados,
            candidatos
                .iter()
                .filter(|c| c.compression == TilesetCompression::Lz4w)
                .count()
        );
        assert!(
            verificados >= 4,
            "os quatro tilesets conhecidos têm que verificar"
        );

        let inicio = std::time::Instant::now();
        let conjunto =
            verify_resource_set(&rom, &TransactionLimits::default()).expect("conjunto da ROM");
        println!(
            "verify_resource_set: {} recursos em {:?} — {}",
            conjunto.resources.len(),
            inicio.elapsed(),
            conjunto.analyzed_scope
        );
    }

    /// ROM sintética com dois recursos LZ4W dependentes: R2 é empacotado com
    /// os bytes de R1 no dicionário, então editar R1 quebraria R2.
    fn synthetic_rom() -> (Vec<u8>, VerifiedLz4wResource, VerifiedLz4wResource) {
        let limits = Lz4wLimits::default();
        // Região-dicionário autoral: 256 bytes com padrão variado.
        let mut rom: Vec<u8> = (0..256u32).map(|i| (i * 7 + 3) as u8).collect();
        // 16 tiles = 512 bytes = 256 words autoriais.
        let words1: Vec<u8> = (0..256u16)
            .flat_map(|w| (w ^ (w << 5)).to_be_bytes())
            .collect();
        let mut header1 = vec![0u8; 8];
        header1[0..2].copy_from_slice(&2u16.to_be_bytes());
        header1[2..4].copy_from_slice(&16u16.to_be_bytes());
        // ptr preenchido abaixo (S1 = 256 + 8).
        let s1 = rom.len() + 8;
        header1[4..8].copy_from_slice(&(s1 as u32).to_be_bytes());
        rom.extend_from_slice(&header1);
        let stream1 = lz4w_encode_with_dictionary(&words1, Some(&rom[..s1])).expect("encode R1");
        rom.extend_from_slice(&stream1);
        // R2: 12 tiles = 384 bytes = 192 words; as primeiras 48 words (96
        // bytes) são COPIA do dado de R1 (o encoder vai referenciar os
        // literais do stream de R1 -> dependência real), o resto
        // pseudoaleatório.
        let mut words2: Vec<u8> = words1[192..192 + 96].to_vec();
        let mut x: u32 = 0x9e3779b9;
        for _ in 0..144 {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            words2.extend_from_slice(&((x >> 16) as u16).to_be_bytes());
        }
        let mut header2 = vec![0u8; 8];
        header2[0..2].copy_from_slice(&2u16.to_be_bytes());
        header2[2..4].copy_from_slice(&12u16.to_be_bytes());
        let s2 = rom.len() + 8;
        header2[4..8].copy_from_slice(&(s2 as u32).to_be_bytes());
        rom.extend_from_slice(&header2);
        let stream2 = lz4w_encode_with_dictionary(&words2, Some(&rom[..s2])).expect("encode R2");
        rom.extend_from_slice(&stream2);
        let set = verify_lz4w_resource_set(&rom, &limits).expect("conjunto");
        assert_eq!(set.resources.len(), 2);
        let r1 = set.resources[0].clone();
        let r2 = set.resources[1].clone();
        (rom, r1, r2)
    }

    /// Cabeçalho TileSet SGDK: `compression`, `numTile`, ponteiro MD linear.
    fn cabecalho_tileset(compression: u16, num_tiles: u16, ptr: u32) -> Vec<u8> {
        let mut h = vec![0u8; 8];
        h[0..2].copy_from_slice(&compression.to_be_bytes());
        h[2..4].copy_from_slice(&num_tiles.to_be_bytes());
        h[4..8].copy_from_slice(&ptr.to_be_bytes());
        h
    }

    /// LZ4W de `num_tiles` tiles cujo plain começa com `prefixo` e depois o
    /// intercala com pseudo-aleatório, empacotado com o prefixo da ROM como
    /// dicionário. O prefixo ir no BLOCO 0 é o que torna a dependência real:
    /// para o primeiro bloco não há fonte mais próxima dentro do próprio plain,
    /// então o encoder é obrigado a referenciar o dicionário.
    fn lz4w_recurso(rom: &mut Vec<u8>, num_tiles: u16, prefixo: &[u8]) {
        // O dicionário LZ4W é o prefixo da ROM até o stream e precisa de
        // comprimento par (endereçamento por words), como em ROM real.
        if !rom.len().is_multiple_of(2) {
            rom.push(0);
        }
        let mut dados: Vec<u8> = Vec::with_capacity(num_tiles as usize * 32);
        let mut x: u32 = 0x9e3779b9;
        while dados.len() < num_tiles as usize * 32 {
            if !prefixo.is_empty() && (dados.len() / prefixo.len()).is_multiple_of(2) {
                dados.extend_from_slice(prefixo);
            } else {
                x = x.wrapping_mul(1664525).wrapping_add(1013904223);
                dados.extend_from_slice(&((x >> 16) as u16).to_be_bytes());
            }
        }
        let ptr = (rom.len() + 8) as u32;
        rom.extend_from_slice(&cabecalho_tileset(2, num_tiles, ptr));
        let stream =
            lz4w_encode_with_dictionary(&dados, Some(&rom[..ptr as usize])).expect("encode lz4w");
        rom.extend_from_slice(&stream);
    }

    /// Recurso APLIB das ROMs mistas: o stream **do oráculo apj** sobre o plain
    /// `noisy_runs_16k` (1 366 B sobre 16 384 B = 512 tiles), lido da fixture
    /// pinada por SHA. A escolha é medida, não arbitrária: sobre `tile_like`
    /// (41 B de slot) qualquer edição de 1 pixel custa +3 B, então o encoder do
    /// produto não tem espaço comprovado para reinserir — ver o registro de
    /// capacidade em `docs/rex_profiles/ROUND_STATE.md`. `noisy_runs_16k` deixa
    /// 2 B de folga (o produto comprime o plain em 1 364 B) e tem ao menos uma
    /// edição de 1 pixel de custo zero (tile 64, linha 3, coluna 4: índice
    /// 11 → 15, stream de 1 364 B), que é a edição usada aqui.
    const SHA_STREAM_NOISY: &str =
        "74e388e91d77e898d1d50a1e5423333e792a018e70566de52884b140e40594b8";
    const NOISY: &str = "plain/noisy_runs_16k.apj.ap";
    const APLIB_TILES: u16 = 512;
    /// Edição de 1 pixel comprovadamente neutra em tamanho (stream re-codificado
    /// de 1 364 B dentro do slot de 1 366 B).
    const EDICAO_NEUTRA: (u32, u32, u32, u8) = (64, 3, 4, 15);

    fn aplib_stream() -> Vec<u8> {
        vetor_aplib(NOISY, SHA_STREAM_NOISY)
    }

    fn aplib_plain() -> Vec<u8> {
        let stream = aplib_stream();
        let dec = aplib_decode(&stream, &AplibLimits::default()).expect("decode do pino");
        assert_eq!(dec.data.len(), APLIB_TILES as usize * 32);
        dec.data
    }

    /// ROM mista com DOIS LZ4W e, depois deles, um recurso APLIB. A ordem é o
    /// ponto: o dicionário de um LZ4W é o prefixo da ROM antes do seu stream,
    /// então nenhum dos dois depende dos bytes do stream aPLib. É o caso em que
    /// editar o aPLib tem que acontecer e preservar os LZ4W.
    fn rom_mista_isolada() -> (Vec<u8>, VerifiedAplibResource) {
        rom_mista_isolada_com(&aplib_stream(), APLIB_TILES)
    }

    /// Mesmo corpo, com o stream aPLib e o número de tiles escolhidos pelo
    /// teste: permite montar um slot apertado (`tile_like`, 41 B) sem duplicar a
    /// arquitetura da fixture.
    fn rom_mista_isolada_com(stream: &[u8], num_tiles: u16) -> (Vec<u8>, VerifiedAplibResource) {
        let mut rom: Vec<u8> = (0..256u32).map(|i| (i * 7 + 3) as u8).collect();
        lz4w_recurso(&mut rom, 16, &[]);
        let semente = rom[0..32].to_vec();
        lz4w_recurso(&mut rom, 12, &semente);
        if !rom.len().is_multiple_of(2) {
            rom.push(0);
        }
        let ptr = (rom.len() as u32) + 8;
        rom.extend_from_slice(&cabecalho_tileset(1, num_tiles, ptr));
        rom.extend_from_slice(stream);
        rom.extend_from_slice(&[0xA5u8; 8]);
        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.compression == TilesetCompression::Aplib)
            .expect("header APLIB não apareceu no scan");
        let recurso =
            verify_aplib_resource(&rom, &candidato, &AplibLimits::default()).expect("verificar");
        (rom, recurso)
    }

    /// Mesma ROM, ordem invertida: o stream APLIB aparece ANTES de um LZ4W cujo
    /// plain contém blocos copiados do próprio stream aPLib, de modo que o
    /// dicionário desse LZ4W inclui os bytes que a edição reescreve. Aqui a
    /// transação tem que recusar, não produzir uma ROM onde um tileset
    /// legítimo muda de decode.
    fn rom_mista_dependente() -> (Vec<u8>, VerifiedAplibResource, VerifiedLz4wResource) {
        let mut rom: Vec<u8> = (0..64u32).map(|i| (i * 11 + 5) as u8).collect();
        let stream = aplib_stream();
        let ptr = (rom.len() as u32) + 8;
        rom.extend_from_slice(&cabecalho_tileset(1, APLIB_TILES, ptr));
        rom.extend_from_slice(&stream);
        // O plain do LZ4W referencia os bytes do stream aPLib já escrita na ROM.
        // A semente é a CAUDA do stream, não a cabeça: a edição começa no tile 64
        // (offset 2 048 de 16 384 de plain), então os primeiros ~170 B do stream
        // re-codificado permanecem idênticos e uma semente ali não criaria
        // dependência real. Na cauda, além de divergir, a referência fica perto
        // do stream LZ4W (offset de dicionário pequeno).
        let inicio_aplib = ptr as usize;
        let fim_aplib = inicio_aplib + stream.len();
        let semente = rom[fim_aplib - 128..fim_aplib].to_vec();
        lz4w_recurso(&mut rom, 24, &semente);
        let candidato = scan_tileset_headers(&rom)
            .into_iter()
            .find(|c| c.compression == TilesetCompression::Aplib)
            .expect("header APLIB não apareceu no scan");
        let recurso =
            verify_aplib_resource(&rom, &candidato, &AplibLimits::default()).expect("verificar");
        let set = verify_lz4w_resource_set(&rom, &Lz4wLimits::default()).expect("conjunto lz4w");
        assert_eq!(set.resources.len(), 1, "esperava um LZ4W dependente");
        (rom, recurso, set.resources[0].clone())
    }

    /// O conjunto verificado do produto tem que reconhecer os dois codecs da
    /// mesma ROM sem nenhum deles ser escolhido por suposição: cada recurso
    /// carries o próprio contrato de dicionário.
    #[test]
    fn conjunto_verificado_reconhece_lz4w_e_aplib_na_mesma_rom() {
        let (rom, _aplib) = rom_mista_isolada();
        let set = verify_resource_set(&rom, &TransactionLimits::default()).expect("conjunto");
        let lz4w = set
            .resources
            .iter()
            .filter(|r| matches!(r, RecursoVerificado::Lz4w(_)))
            .count();
        let aplib = set
            .resources
            .iter()
            .filter(|r| matches!(r, RecursoVerificado::Aplib(_)))
            .count();
        assert_eq!((lz4w, aplib), (2, 1), "conjunto: {set:?}");
        for recurso in &set.resources {
            assert_eq!(
                recurso.decoded().len(),
                recurso.candidate().expected_len,
                "{recurso:?}: decode não bate com o tamanho declarado pelo header"
            );
        }
    }

    /// Edição de 1 pixel num TileSet APLIB real, pela transação canônica: sai
    /// Applied, o stream cabe no slot comprovado, os LZ4W da mesma ROM
    /// preservam o decode, e os bytes fora do slot não mudam.
    #[test]
    fn reinsert_aplib_edita_tile_e_preserva_lz4w_na_mesma_rom() {
        let (rom, recurso) = rom_mista_isolada();
        let sha = super::super::rom_library::sha256_hex(&rom);
        let mut editado = recurso.decoded.clone();
        let (tile, row, col, indice) = EDICAO_NEUTRA;
        md_write_pixel_index(
            &mut editado,
            tile as usize,
            row as usize,
            col as usize,
            indice,
        )
        .expect("editar pixel");
        let outcome = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &recurso,
                edited_data: &editado,
            },
            &TransactionLimits::default(),
        )
        .unwrap_or_else(|e| panic!("transação recusada: {e}"));
        let aplicado = match outcome {
            ReinsertOutcome::Applied(a) => a,
            ReinsertOutcome::NoOp => panic!("edição real não pode resultar em no-op"),
        };
        assert_eq!(
            recurso.bytes_consumed, 1366,
            "o slot comprovado é o stream do oráculo apj pino da fixture"
        );
        assert!(
            aplicado.stream_written < aplicado.original_stream_len,
            "stream de {} deveria caber com folga no slot de {}",
            aplicado.stream_written,
            aplicado.original_stream_len
        );
        assert_eq!(aplicado.verified_preserved, 2, "os dois LZ4W preservados");
        assert_eq!(aplicado.modified_rom.len(), rom.len(), "ROM expandiu");
        let fim = recurso.candidate.stream_offset + aplicado.original_stream_len;
        assert_eq!(
            aplicado.modified_rom[fim..],
            rom[fim..],
            "bytes além do slot mudaram"
        );

        // O decoder do produto, relido da ROM modificada e sem dicionário, tem
        // que devolver exatamente a edição — a prova ida-e-volta no contexto real.
        let reconvertido = verify_aplib_resource(
            &aplicado.modified_rom,
            &recurso.candidate,
            &AplibLimits::default(),
        )
        .expect("re-verificação na ROM modificada");
        assert_eq!(reconvertido.decoded, editado);
        assert_eq!(
            reconvertido.bytes_consumed, aplicado.stream_written,
            "o EOD do novo stream não delimita o slot escrito"
        );
        let sentinela = recurso.candidate.stream_offset + aplicado.original_stream_len;
        assert_eq!(
            &aplicado.modified_rom[sentinela..sentinela + 8],
            &[0xA5u8; 8],
            "a folga entre o novo stream e o bloco vizinho foi sobrescrita"
        );

        // O recurso editado é o único que muda: os LZ4W da ROM modificada
        // decodificam como antes.
        let set_antes = verify_lz4w_resource_set(&rom, &Lz4wLimits::default()).unwrap();
        let set_depois =
            verify_lz4w_resource_set(&aplicado.modified_rom, &Lz4wLimits::default()).unwrap();
        assert_eq!(set_antes.resources, set_depois.resources);
    }

    /// Falta de espaço é recusada com os três números na mensagem — a UI e o
    /// operador decidem a próxima edição a partir deles, não de um "falhou".
    ///
    /// O slot apertado é `tile_like` (41 B de stream pino do oráculo sobre 8 192 B
    /// de plain). A recusa aqui é medida, não fabricada: o encoder do produto
    /// produz 41 B sobre o plain original (paridade exata com o oráculo) e a
    /// menor edição de 1 pixel já custa 44 B, então nenhum recurso com slot de
    /// 41 B tem espaço comprovado para reinserir. Ver o registro de capacidade em
    /// `docs/rex_profiles/ROUND_STATE.md`.
    #[test]
    fn reinsert_aplib_recusa_edicao_que_nao_cabe_no_slot() {
        let stream = vetor_aplib(TILE_LIKE, SHA_STREAM_TILE_LIKE);
        let (rom, recurso) = rom_mista_isolada_com(&stream, TILE_LIKE_TILES);
        let sha = super::super::rom_library::sha256_hex(&rom);
        assert_eq!(
            recurso.bytes_consumed, 41,
            "o slot comprovado é o stream pino de tile_like"
        );
        let mut editado = recurso.decoded.clone();
        let (tile, row, col, indice) = EDICAO_NEUTRA;
        md_write_pixel_index(
            &mut editado,
            tile as usize,
            row as usize,
            col as usize,
            indice,
        )
        .expect("editar pixel");
        let erro = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &recurso,
                edited_data: &editado,
            },
            &TransactionLimits::default(),
        )
        .expect_err("edição que não cabe no slot não pode ser aceita");
        assert_eq!(erro.code, "excessive_output", "{erro}");
        for numero in [
            recurso.bytes_consumed.to_string(),
            editado.len().to_string(),
        ] {
            assert!(
                erro.detail.contains(&numero),
                "{erro} sem o número {numero}"
            );
        }
        // O ROM modificado não existe nesta via: a recusa é antes de qualquer
        // escrita, então nenhum byte pode ter mudado.
        assert_eq!(
            super::super::rom_library::sha256_hex(&rom),
            sha,
            "a ROM de entrada foi mutada por uma transação recusada"
        );
    }

    /// O guarda-cross-codec: editar o aPLib mudaria o decode de um LZ4W cujo
    /// dicionário contém os bytes do stream. A transação recusa antes de
    /// materializar qualquer ROM, e diz qual recurso seria afetado.
    #[test]
    fn reinsert_aplib_recusa_edicao_que_mudaria_lz4w_dependente() {
        let (rom, recurso, dependente) = rom_mista_dependente();
        let sha = super::super::rom_library::sha256_hex(&rom);
        let mut editado = recurso.decoded.clone();
        let (tile, row, col, indice) = EDICAO_NEUTRA;
        md_write_pixel_index(
            &mut editado,
            tile as usize,
            row as usize,
            col as usize,
            indice,
        )
        .expect("editar pixel");
        let erro = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &recurso,
                edited_data: &editado,
            },
            &TransactionLimits::default(),
        )
        .expect_err("edição com dependente LZ4W não pode ser aceita");
        assert_eq!(erro.code, "dependent_modified", "{erro}");
        assert!(
            erro.detail
                .contains(&format!("{:#x}", dependente.candidate.stream_offset)),
            "{erro}: mensagem não aponta o recurso dependente em {:#x}",
            dependente.candidate.stream_offset
        );
    }

    /// No-op aPLib é explícito, como no LZ4W: dados editados iguais aos
    /// verificados não escrevem nada, nem padding.
    #[test]
    fn reinsert_aplib_noop_nao_escreve_nada() {
        let (rom, recurso) = rom_mista_isolada();
        let sha = super::super::rom_library::sha256_hex(&rom);
        let outcome = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &recurso,
                edited_data: &recurso.decoded,
            },
            &TransactionLimits::default(),
        )
        .expect("no-op");
        assert!(matches!(outcome, ReinsertOutcome::NoOp), "{outcome:?}");
    }

    /// A interface chega ao aPLib pela MESMA fronteira do LZ4W
    /// (`list_resources` → `preview_resource` → `apply_resource_edit`): o recurso
    /// é achado por conteúdo, o codec listado é o que o header verificou, a
    /// transação é despachada pelo recurso verificado (nunca por suposição) e os
    /// artefatos materializados saem nomeados pelo codec efetivo, com o SHA que
    /// o produto declarou. Este é o tronco que o passo 5 exercita pelo WebDriver.
    #[test]
    fn ui_edite_recurso_aplib_pela_mesma_fronteira_do_lz4w() {
        let (rom, recurso) = rom_mista_isolada();
        let sha = super::super::rom_library::sha256_hex(&rom);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("relogio")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rds-rex-aplib-ui-{stamp}"));
        std::fs::create_dir_all(&dir).expect("diretorio temporario");
        // Os artefatos da transação vão para `decomp_work_dir()`, que é o
        // catálogo canônico do produto; aqui ele é isolado no diretório temporário
        // para o teste não escrever no $HOME.
        std::env::set_var("RDS_DECOMP_WORK", &dir);
        let caminho = dir.join("mista.bin");
        std::fs::write(&caminho, &rom).expect("escrever rom");
        let caminho = caminho.to_str().expect("utf8");

        let (sha_listado, listados) = list_resources(caminho).expect("listar recursos");
        assert_eq!(sha_listado, sha, "identidade da ROM lida divergiu");
        let codecs: Vec<&str> = listados.iter().map(|r| r.codec.as_str()).collect();
        assert_eq!(
            codecs,
            vec!["lz4w", "lz4w", "aplib"],
            "a lista deveria trazer os três recursos verificados com o codec do header"
        );
        let pino = &listados[2];
        assert_eq!(pino.stream_offset, recurso.candidate.stream_offset as u64);
        assert_eq!(pino.num_tiles, APLIB_TILES as u32);
        assert_eq!(pino.data_len, (APLIB_TILES as usize * 32) as u32);
        assert_eq!(pino.stream_len, 1366, "slot comprovado do stream pino");

        let previa = preview_resource(caminho, pino.stream_offset).expect("prévia aPLib");
        assert_eq!(previa.outcome, "preview");
        assert_eq!(previa.codec, "aplib", "prévia rotulada com outro codec");
        assert_eq!(previa.original_stream_len, 1366);
        assert_eq!(previa.stream_written, None, "prévia não pode escrever");
        assert_eq!(previa.modified_rom_path, None);
        assert!(
            previa.preview_pixels_sha256.as_deref().unwrap_or("").len() == 64,
            "prévia sem hash de pixels: {previa:?}"
        );
        assert_eq!(
            (previa.preview_width, previa.preview_height),
            (Some(128), Some((APLIB_TILES as u32 / 16) * 8)),
            "geometria da prévia não corresponde ao decode"
        );

        let (tile, row, col, indice) = EDICAO_NEUTRA;
        let aplicada = apply_resource_edit(
            caminho,
            pino.stream_offset,
            &[PixelEdit {
                tile,
                row,
                col,
                index: indice,
            }],
            &sha,
        )
        .expect("edição aPLib pela fronteira da UI");
        assert_eq!(aplicada.outcome, "applied", "{aplicada:?}");
        assert_eq!(aplicada.codec, "aplib", "despacho por codec errado");
        assert_eq!(aplicada.original_stream_len, 1366);
        assert_eq!(
            aplicada.stream_written,
            Some(1364),
            "o stream re-codificado precisa ser medido na resposta"
        );
        assert_eq!(
            aplicada.verified_preserved,
            Some(2),
            "os dois LZ4W da mesma ROM têm que ser preservados"
        );
        assert!(
            aplicada.analyzed_scope.contains("3/3"),
            "escopo não declara o conjunto verificado: {}",
            aplicada.analyzed_scope
        );

        // Proveniência: os caminhos devolvidos existem, pertencem ao codec
        // efetivo e carregam exatamente os SHA-256 que o produto declarou.
        let copia = aplicada
            .modified_rom_path
            .clone()
            .expect("cópia modificada");
        assert!(copia.contains("rex-aplib-modified-"), "nome: {copia}");
        let bytes_copia = std::fs::read(&copia).expect("ler cópia");
        assert_eq!(bytes_copia.len(), rom.len(), "a cópia expandiu");
        assert_eq!(
            super::super::rom_library::sha256_hex(&bytes_copia),
            aplicada.modified_rom_sha256.expect("sha da cópia")
        );
        let patch = aplicada.patch_bps_path.clone().expect("patch BPS");
        assert!(patch.contains("rex-aplib-patch-"), "nome: {patch}");
        assert_eq!(
            super::super::rom_library::sha256_hex(&std::fs::read(&patch).expect("ler patch")),
            aplicada.patch_bps_sha256.expect("sha do patch")
        );

        // A ROM original no disco não mudou: a edição só existe na cópia
        // endereçada por hash + patch.
        assert_eq!(std::fs::read(caminho).expect("reler rom"), rom);
        // Relendo a cópia pelo MESMO caminho de UI, a prévia do produto é a
        // edição aplicada (ida-e-volta pela fronteira da interface).
        let previa_modificada =
            preview_resource(&copia, pino.stream_offset).expect("prévia editada");
        assert_eq!(
            previa_modificada.preview_pixels_sha256, aplicada.preview_pixels_sha256,
            "a prévia da ROM modificada não bate com a prévia declarada pela edição"
        );
        assert_ne!(
            previa_modificada.preview_pixels_sha256, previa.preview_pixels_sha256,
            "a edição não mudou a prévia: nada foi pintado"
        );
        std::env::remove_var("RDS_DECOMP_WORK");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Identidade e evidência são guardadas antes de qualquer escrita, no caminho
    /// aPLib igual no LZ4W: ROM com SHA divergido e recurso que não pertence à
    ///quela ROM não produzem patch.
    #[test]
    fn reinsert_aplib_exige_identidade_de_rom_e_evidencia_deste_tronco() {
        let (rom, recurso) = rom_mista_isolada();
        let (tile, row, col, indice) = EDICAO_NEUTRA;
        let mut editado = recurso.decoded.clone();
        md_write_pixel_index(
            &mut editado,
            tile as usize,
            row as usize,
            col as usize,
            indice,
        )
        .expect("editar pixel");

        let erro = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256: &"0".repeat(64),
                resource: &recurso,
                edited_data: &editado,
            },
            &TransactionLimits::default(),
        )
        .expect_err("SHA divergido é identidade quebrada");
        assert_eq!(erro.code, "rom_identity_mismatch", "{erro}");

        // Caso real de evidência stale: a primeira transação aplicada produz uma
        // ROM onde o stream daquele recurso já são OUTROS bytes. Reaplicar com a
        // evidência em memória (pré-edição) contra a ROM nova tem que recusar —
        // nunca reescrever o slot com base num decode que não existe mais ali.
        let aplicada = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &rom,
                expected_rom_sha256: &super::super::rom_library::sha256_hex(&rom),
                resource: &recurso,
                edited_data: &editado,
            },
            &TransactionLimits::default(),
        )
        .expect("primeira aplicação");
        let ReinsertOutcome::Applied(modificado) = aplicada else {
            panic!("edição real não pode resultar em no-op");
        };
        let sha_modificado = modificado.modified_rom_sha256.clone();
        let erro = reinsert_transaction_aplib(
            &ReinsertRequestAplib {
                rom: &modificado.modified_rom,
                expected_rom_sha256: &sha_modificado,
                resource: &recurso,
                edited_data: &recurso.decoded,
            },
            &TransactionLimits::default(),
        )
        .expect_err("evidência de outra versão da ROM não pode ser aceita");
        assert_eq!(erro.code, "evidence_mismatch", "{erro}");
    }

    /// A fronteira de intervalo é da transação, não da UI: o painel descarta
    /// edits com tile >= num_tiles no cliente
    /// (`CompressedResourcePanel.tsx`, botão "Adicionar edição"), então só a
    /// API do produto exercita a recusa. Ela acontece antes de qualquer escrita.
    #[test]
    fn apply_rejects_tile_outside_resource_without_writing() {
        let (rom, r1, _r2) = synthetic_rom();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("relogio")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rds-rex-bounds-{stamp}"));
        std::fs::create_dir_all(&dir).expect("diretorio temporario");
        let path = dir.join("rom.bin");
        std::fs::write(&path, &rom).expect("escrever rom");
        let sha = super::super::rom_library::sha256_hex(&rom);
        let out_of_range_tile = r1.candidate.num_tiles as u32;
        let err = apply_resource_edit(
            path.to_str().expect("utf8"),
            r1.candidate.stream_offset as u64,
            &[PixelEdit {
                tile: out_of_range_tile,
                row: 0,
                col: 0,
                index: 15,
            }],
            &sha,
        )
        .expect_err("tile igual a num_tiles esta fora do recurso");
        assert!(err.contains("fora do recurso"), "recusa inesperada: {err}");
        assert_eq!(
            std::fs::read(&path).expect("reler rom"),
            rom,
            "a recusa de intervalo alterou a ROM"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn transaction_rejects_rom_identity_mismatch() {
        let (rom, r1, _r2) = synthetic_rom();
        let limits = Lz4wLimits::default();
        let wrong_sha = "0".repeat(64);
        let err = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &wrong_sha,
                resource: &r1,
                edited_data: &r1.decoded,
            },
            &limits,
        )
        .expect_err("identidade errada");
        assert_eq!(err.code, "rom_identity_mismatch");
    }

    #[test]
    fn transaction_rejects_edited_length_overflow() {
        let (rom, r1, _r2) = synthetic_rom();
        let limits = Lz4wLimits::default();
        let sha = super::super::rom_library::sha256_hex(&rom);
        let err = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &r1,
                edited_data: &r1.decoded[..r1.decoded.len() - 1],
            },
            &limits,
        )
        .expect_err("tamanho errado");
        assert_eq!(err.code, "overflow");
    }

    #[test]
    fn transaction_noop_writes_nothing() {
        let (rom, r1, _r2) = synthetic_rom();
        let limits = Lz4wLimits::default();
        let sha = super::super::rom_library::sha256_hex(&rom);
        let outcome = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &r1,
                edited_data: &r1.decoded,
            },
            &limits,
        )
        .expect("no-op");
        assert!(matches!(outcome, ReinsertOutcome::NoOp));
    }

    #[test]
    fn transaction_rejects_known_dependent_modified() {
        let (rom, r1, _r2) = synthetic_rom();
        let limits = Lz4wLimits::default();
        let sha = super::super::rom_library::sha256_hex(&rom);
        // Editar R1 dentro da janela que R2 referencia (bytes 192..288 do
        // dado de R1 são copiados em R2): deve ser recusado como dependente.
        let mut edited = r1.decoded.clone();
        edited[200] ^= 0xF0;
        let err = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &r1,
                edited_data: &edited,
            },
            &limits,
        )
        .expect_err("dependente");
        assert_eq!(err.code, "dependent_modified");
    }

    #[test]
    fn transaction_applies_patch_with_exact_hash_and_preserves_dependents() {
        let (rom, _r1, r2) = synthetic_rom();
        let limits = Lz4wLimits::default();
        let sha = super::super::rom_library::sha256_hex(&rom);
        // Editar R2 (último recurso, sem dependentes após ele): edição
        // determinística na cauda aleatória (não altera os matches contra
        // R1, então o tamanho do stream se mantém).
        let mut edited = r2.decoded.clone();
        let last = edited.len() - 1;
        edited[last] ^= 0xF0;
        let outcome = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: &r2,
                edited_data: &edited,
            },
            &limits,
        )
        .expect("aplicar em R2");
        let ReinsertOutcome::Applied(applied) = outcome else {
            panic!("esperava Applied");
        };
        // Hash exato e patch re-aplicável pelo pipeline canônico.
        assert_eq!(
            applied.modified_rom_sha256,
            super::super::rom_library::sha256_hex(&applied.modified_rom)
        );
        let reapplied = crate::tools::patch_studio::apply_bps(&rom, &applied.patch_bps)
            .expect("re-aplicar patch");
        assert_eq!(reapplied, applied.modified_rom);
        // Sem alteração de padding: fora da região escrita, byte a byte
        // igual ao original.
        let start = r2.candidate.stream_offset;
        let end = start + applied.stream_written;
        assert!(applied.modified_rom[..start] == rom[..start]);
        assert!(applied.modified_rom[end..] == rom[end..]);
        // Escopo analisado declarado e R1 preservado.
        assert!(applied.analyzed_scope.contains("2/2"));
        assert!(applied.verified_preserved >= 1);
    }

    /// Diagnóstico: preview_resource sobre o artefato modificado real.
    #[test]
    fn byor_preview_of_modified_artifact() {
        let rom_path = "/home/misael/.retrodev/decomp_work/extract/558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9/edits/rex-lz4w-modified-261618d9f19f8176c45dc66f3f398d6998d1d68772c2205b55ef8ce70fb76192.bin";
        if !std::path::Path::new(rom_path).exists() {
            eprintln!("artefato ausente; rode o aceite BYOR antes");
            return;
        }
        let result = preview_resource(rom_path, 0xc8cc8).expect("preview do modificado");
        eprintln!(
            "PREVIEW_MOD: pixels={} png={} rom={}",
            result.preview_pixels_sha256.as_deref().unwrap_or("?"),
            result
                .preview_png_sha256
                .as_deref()
                .unwrap_or("?")
                .get(0..16)
                .unwrap_or("?"),
            result.rom_sha256.get(0..16).unwrap_or("?")
        );
        let rom = std::fs::read(rom_path).unwrap();
        let limits = Lz4wLimits::default();
        let set = verify_lz4w_resource_set(&rom, &limits).unwrap();
        let count_at_target = set
            .resources
            .iter()
            .filter(|r| r.candidate.stream_offset == 0xc8cc8)
            .count();
        let target = set
            .resources
            .iter()
            .find(|r| r.candidate.stream_offset == 0xc8cc8)
            .unwrap();
        eprintln!(
            "PREVIEW_MOD: headers_para_0xc8cc8={count_at_target} byte30={:#04x} numTile={}",
            target.decoded[30], target.candidate.num_tiles
        );
        // Os dois renders devem divergir no pixel (4,7) do tile 0.
        let orig_rom = std::fs::read("/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin").unwrap();
        let orig_set = verify_lz4w_resource_set(&orig_rom, &limits).unwrap();
        let orig_target = orig_set
            .resources
            .iter()
            .find(|r| r.candidate.stream_offset == 0xc8cc8)
            .unwrap();
        let rgba_mod = md_tiles_to_rgba(&target.decoded);
        let rgba_orig = md_tiles_to_rgba(&orig_target.decoded);
        let sha_mod = super::super::rom_library::sha256_hex(&rgba_mod);
        let sha_orig = super::super::rom_library::sha256_hex(&rgba_orig);
        eprintln!(
            "PREVIEW_MOD: rgba_mod={} rgba_orig={} distintos={}",
            sha_mod.get(0..16).unwrap_or("?"),
            sha_orig.get(0..16).unwrap_or("?"),
            rgba_mod != rgba_orig
        );
        let (png, _, _, pixels_sha_direct) = render_resource_png(&target.decoded).unwrap();
        let same_as_result = Some(&pixels_sha_direct) == result.preview_pixels_sha256.as_ref();
        eprintln!(
            "PREVIEW_MOD: pixels_sha_direto={} png_len={} igual_ao_resultado={same_as_result}",
            pixels_sha_direct.get(0..16).unwrap_or("?"),
            png.len()
        );
    }

    /// Aceite BYOR (executar explicitamente: `cargo test --lib -- --ignored
    /// rex_resources`): exige o arquivo com SHA-256 esperado e executa a
    /// cadeia completa até patch BPS com hash exato. Ausência do arquivo
    /// FALHA (não termina como PASS silencioso).
    #[test]
    #[ignore = "aceite BYOR: requer ROM local com SHA esperado; rodar com --ignored"]
    fn byor_hamoopig_chain_original_noop_modified_and_patch() {
        let Some((rom, sha)) = hamoopig_rom() else {
            panic!("aceite BYOR exige a ROM HAMOOPIG local (RDS_HAMOOPIG_ROM ou caminho canônico)");
        };
        assert_eq!(
            sha, "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9",
            "ROM inesperada: o aceite BYOR é válido apenas para o corpus congelado"
        );
        let limits = Lz4wLimits::default();
        let set = verify_lz4w_resource_set(&rom, &limits).expect("conjunto");
        assert!(set.resources.len() >= 100);
        // ORIGINAL: decode baseline de todos.
        // NO-OP: transação com dados não editados.
        let target = set
            .resources
            .iter()
            .find(|r| r.candidate.stream_offset == 0xc8cc8)
            .expect("recurso alvo 0xc8cc8");
        let outcome = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: target,
                edited_data: &target.decoded,
            },
            &limits,
        )
        .expect("no-op BYOR");
        assert!(matches!(outcome, ReinsertOutcome::NoOp));
        // MODIFICADO: edição mínima (pixel (0,7,4) -> índice 15 — única
        // forma que coube com o encoder corrigido), transação completa,
        // patch com hash exato.
        let mut edited = target.decoded.clone();
        md_write_pixel_index(&mut edited, 0, 7, 4, 15).unwrap();
        let outcome = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: target,
                edited_data: &edited,
            },
            &limits,
        )
        .expect("aplicar BYOR");
        let ReinsertOutcome::Applied(applied) = outcome else {
            panic!("esperava Applied");
        };
        assert_eq!(
            super::super::rom_library::sha256_hex(&applied.modified_rom),
            applied.modified_rom_sha256
        );
        let reapplied = crate::tools::patch_studio::apply_bps(&rom, &applied.patch_bps)
            .expect("re-aplicar patch BYOR");
        assert_eq!(reapplied, applied.modified_rom);
        // Evidência de BYTES: intervalo exato alterado no dado decodificado.
        let changed: Vec<usize> = target
            .decoded
            .iter()
            .zip(edited.iter())
            .enumerate()
            .filter(|(_, (a, b))| a != b)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(changed, vec![30usize], "a edição deve alterar exatamente o byte 30 do dado decodificado (pixel (0,7,4), nibble alto)");
        eprintln!(
            "BYOR cadeia OK: original={sha} modificado={} patch={} preservados={} escopo={}",
            applied.modified_rom_sha256,
            applied.patch_bps_sha256,
            applied.verified_preserved,
            applied.analyzed_scope
        );
        eprintln!(
            "BYOR bytes: intervalo_alterado=[{}, {}) antes[0..8]={:02x?} depois[0..8]={:02x?} sha_antes={} sha_depois={}",
            changed.first().unwrap(),
            changed.last().unwrap() + 1,
            &target.decoded[0..8],
            &edited[0..8],
            target.decoded.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            edited.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        );
    }

    /// Golden literal assimétrico: `12 34 56 78` na linha 0 do tile 0
    /// representa os índices 1..8 (nibble alto = coluna par). O esperado é
    /// escrito à mão, NÃO obtido do renderer do produto.
    #[test]
    fn md_chunky_golden_literal_asymmetric() {
        let mut tiles = vec![0u8; 32];
        // Linha 0 do tile 0: 12 34 56 78.
        tiles[0] = 0x12;
        tiles[1] = 0x34;
        tiles[2] = 0x56;
        tiles[3] = 0x78;
        // Índices esperados por pixel, escritos literalmente:
        let expected: [[u8; 8]; 8] = [
            [1, 2, 3, 4, 5, 6, 7, 8],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
        ];
        let rgba = md_tiles_to_rgba(&tiles);
        for y in 0..8 {
            for x in 0..8 {
                let index = rgba[(y * 8 + x) * 4] / 16;
                assert_eq!(index, expected[y][x], "pixel ({x},{y})");
                assert_eq!(rgba[(y * 8 + x) * 4 + 3], 255);
            }
        }
        // Leitura individual bate com o golden.
        for col in 0..8 {
            assert_eq!(
                md_read_pixel_index(&tiles, 0, 0, col).unwrap(),
                (col + 1) as u8
            );
        }
        // Escrita preserva o outro nibble: editar pixel (0,0) para 15 mantém
        // o byte 0x12 -> 0xF2 (nibble baixo 2 intocado) e nada mais muda.
        let mut edited = tiles.clone();
        md_write_pixel_index(&mut edited, 0, 0, 0, 15).unwrap();
        assert_eq!(edited[0], 0xF2);
        for (i, (a, b)) in edited.iter().zip(tiles.iter()).enumerate() {
            if i != 0 {
                assert_eq!(a, b, "byte {i} não deveria mudar");
            }
        }
        // Primeira e última posições do recurso de 2 tiles.
        let mut two = vec![0u8; 64];
        md_write_pixel_index(&mut two, 0, 0, 0, 5).unwrap();
        assert_eq!(two[0] >> 4, 5);
        md_write_pixel_index(&mut two, 1, 7, 7, 9).unwrap();
        assert_eq!(two[63] & 0x0F, 9);
        // Índice inválido recusado sem alterar o buffer.
        let untouched = two.clone();
        assert!(md_write_pixel_index(&mut two, 0, 0, 0, 16).is_err());
        assert_eq!(two, untouched);
    }

    /// O render em GRADE (render_resource_png) deve expor edições em
    /// qualquer tile/linha — pega o bug histórico de leitura linear da
    /// faixa (que escondia edições além do tile 0/linha 0).
    #[test]
    fn render_resource_png_exposes_edits_in_any_tile_row() {
        let original = vec![0u8; 9 * 32];
        let mut edited = original.clone();
        md_write_pixel_index(&mut edited, 0, 7, 4, 15).unwrap();
        let (_, _, _, sha_original) = render_resource_png(&original).unwrap();
        let (_, _, _, sha_edited) = render_resource_png(&edited).unwrap();
        assert_ne!(
            sha_original, sha_edited,
            "prévia em grade não refletiu a edição no tile 0, linha 7"
        );
        // E em um tile do fim do recurso.
        let mut edited_tail = original.clone();
        md_write_pixel_index(&mut edited_tail, 8, 0, 0, 15).unwrap();
        let (_, _, _, sha_tail) = render_resource_png(&edited_tail).unwrap();
        assert_ne!(
            sha_original, sha_tail,
            "prévia não refletiu edição no tile 8"
        );
    }

    /// No-op: escrever o mesmo índice não altera nenhum byte.
    #[test]
    fn md_write_pixel_index_noop_when_same_index() {
        let mut tiles = vec![0x12, 0x34, 0x56, 0x78];
        tiles.resize(32, 0);
        let before = tiles.clone();
        md_write_pixel_index(&mut tiles, 0, 0, 0, 1).unwrap();
        assert_eq!(tiles, before);
        md_write_pixel_index(&mut tiles, 0, 0, 1, 2).unwrap();
        assert_eq!(tiles, before);
    }

    /// Prévia chunky: comparação independente de pixels (segunda
    /// implementação do mapeamento, escrita à mão no teste).
    #[test]
    fn md_tiles_to_rgba_matches_independent_pixel_recompute() {
        // Tile autoral chunky: linha 0 = 0x01 0x23 0x45 0x67 (índices 0..7),
        // linha 1 = 0x89 0xAB 0xCD 0xEF (índices 8..15), resto zero.
        let mut tiles = vec![0u8; 32];
        tiles[0..4].copy_from_slice(&[0x01, 0x23, 0x45, 0x67]);
        tiles[4..8].copy_from_slice(&[0x89, 0xAB, 0xCD, 0xEF]);
        let rgba = md_tiles_to_rgba(&tiles);
        assert_eq!(rgba.len(), 8 * 8 * 4);
        // Recomputação independente pixel a pixel (nibble alto = coluna par).
        for y in 0..8 {
            for x in 0..8 {
                let byte = tiles[y * 4 + x / 2];
                let index = if x % 2 == 0 { byte >> 4 } else { byte & 0x0F };
                let expected = index * 16;
                let got = rgba[(y * 8 + x) * 4];
                assert_eq!(got, expected, "pixel ({x},{y})");
                assert_eq!(rgba[(y * 8 + x) * 4 + 3], 255);
            }
        }
        // Pixels específicos: (0,0)=0, (1,0)=1 e (0,1)=8 (linha 1, nibble alto).
        assert_eq!(rgba[0], 0);
        assert_eq!(rgba[4], 16);
        assert_eq!(rgba[32], 128);
    }

    /// Enumera recursos LZ4W do corpus que aceitam a edição mínima (para
    /// escolha do alvo da cadeia com evidência runtime). Executar com
    /// --ignored.
    #[test]
    #[ignore = "aceite BYOR: requer ROM local; rodar com --ignored"]
    fn byor_enumerate_fitting_resources() {
        let path = std::env::var("RDS_HAMOOPIG_ROM").unwrap_or_else(|_| {
            "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin"
                .to_string()
        });
        let rom = std::fs::read(path).expect("rom");
        let sha = super::super::rom_library::sha256_hex(&rom);
        assert_eq!(
            sha,
            "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9"
        );
        let limits = Lz4wLimits::default();
        let set = verify_lz4w_resource_set(&rom, &limits).expect("conjunto");
        // Enumera edições chunky aplicáveis com ORÇAMENTO (item 7): índice
        // de dicionário reutilizado por recurso, progresso impresso,
        // checkpoint em disco e limite de candidatos por recurso. Índice
        // novo = 15 (máximo contraste). Sem afrouxar needs_space/dependentes.
        let mut targets: Vec<usize> = vec![0xc8cc8];
        targets.extend([
            0x9e23e, 0xa0ab4, 0xa32da, 0xa56ae, 0xbb810, 0xbcf58, 0xbdd1a, 0xbe352, 0xbe964,
            0xbee94, 0xc0094, 0xc07b6, 0xc0c3e, 0xc0f88, 0xc14f2, 0xc281c, 0xc8d58, 0xc8f12,
        ]);
        let checkpoint_path = std::path::Path::new("/tmp/rex-scan-checkpoint.log");
        let mut checkpoint =
            std::io::LineWriter::new(std::fs::File::create(checkpoint_path).expect("checkpoint"));
        use std::io::Write as _;
        let mut found = 0usize;
        for (target_index, &stream_off) in targets.iter().enumerate() {
            let Some(resource) = set
                .resources
                .iter()
                .find(|r| r.candidate.stream_offset == stream_off)
            else {
                continue;
            };
            let index =
                match super::super::rex_codecs::Lz4wDictionaryIndex::build(&rom[..stream_off]) {
                    Ok(index) => index,
                    Err(error) => {
                        eprintln!(
                            "[scan {}/{}] {stream_off:#x}: índice falhou: {error}",
                            target_index + 1,
                            targets.len()
                        );
                        continue;
                    }
                };
            let mut fit_count = 0usize;
            let mut candidates = 0usize;
            const BUDGET: usize = 64;
            let mut applied_here = 0usize;
            'pixels: for tile in 0..resource.candidate.num_tiles {
                for row in 0..8usize {
                    for col in 0..8usize {
                        if candidates >= BUDGET {
                            break 'pixels;
                        }
                        candidates += 1;
                        let current =
                            md_read_pixel_index(&resource.decoded, tile, row, col).unwrap();
                        if current == 15 {
                            continue;
                        }
                        let mut edited = resource.decoded.clone();
                        md_write_pixel_index(&mut edited, tile, row, col, 15).unwrap();
                        let Ok(stream) =
                            super::super::rex_codecs::lz4w_encode_with_dictionary_index(
                                &edited,
                                Some(&index),
                            )
                        else {
                            continue;
                        };
                        if stream.len() > resource.bytes_consumed {
                            continue;
                        }
                        fit_count += 1;
                        let outcome = reinsert_transaction(
                            &ReinsertRequest {
                                rom: &rom,
                                expected_rom_sha256: &sha,
                                resource,
                                edited_data: &edited,
                            },
                            &limits,
                        );
                        if let Ok(ReinsertOutcome::Applied(applied)) = outcome {
                            eprintln!(
                                "APPLIED_SCREEN: stream={stream_off:#x} tiles={} tile={tile} row={row} col={col} indice_atual={current} indice_novo=15 preservados={} patch={}",
                                resource.candidate.num_tiles,
                                applied.verified_preserved,
                                applied.patch_bps_sha256
                            );
                            let _ = writeln!(
                                checkpoint,
                                "APPLIED {stream_off:#x} tile={tile} row={row} col={col} patch={}",
                                applied.patch_bps_sha256
                            );
                            found += 1;
                            applied_here += 1;
                        }
                        let _ = checkpoint.flush();
                    }
                }
            }
            eprintln!(
                "[scan {}/{}] {stream_off:#x}: candidatos={candidates} fit={fit_count} aplicados={applied_here}",
                target_index + 1,
                targets.len()
            );
            let _ = writeln!(
                checkpoint,
                "ALVO {stream_off:#x} fit={fit_count} aplicados={applied_here}"
            );
            let _ = checkpoint.flush();
            if found >= 4 {
                break;
            }
        }
        eprintln!("found={found}");
    }

    /// Parâmetros do fixture autoral (devem bater com gen_fixture.py).
    const FIXTURE_TILE_PX: usize = 8;
    const FIXTURE_TILE_COUNT: usize = 16;
    const FIXTURE_NOISE_ROWS: usize = 4;
    const FIXTURE_LCG_A: u64 = 6_364_136_223_846_793_005;
    const FIXTURE_LCG_C: u64 = 1_442_695_040_888_963_407;
    const FIXTURE_LCG_SEED: u64 = 0x5245_584C_5A34_5731;
    /// Linha de cada tile que o gerador deixa sólida nos 7 primeiros pixels e
    /// `v+1` no último: é a palavra quase-igual que uma edição de um pixel
    /// conserta (o LZ4W casa em words de 2 pixels).
    const FIXTURE_NEAR_MISS_ROW: usize = FIXTURE_NOISE_ROWS + 1;
    /// Layout do plano definido em src/main.c do fixture: tile `t` colocado
    /// uma única vez na célula `(t % 4, t / 4)` de um mapa 4x4 de tiles 8x8.
    const FIXTURE_MAP_TILES_X: usize = 4;

    /// Fonte da expectativa, recomposto AQUI a partir do seed — não lido do
    /// decodificador nem do gerador Python. Se o decode do produto bater com
    /// isto, a cadeia stream -> pixels está provada por construção.
    fn fixture_expected_tiles() -> Vec<u8> {
        let total = FIXTURE_TILE_COUNT * FIXTURE_TILE_PX * FIXTURE_TILE_PX;
        let mut state = FIXTURE_LCG_SEED;
        let mut indices = Vec::with_capacity(total);
        for t in 0..FIXTURE_TILE_COUNT {
            for row in 0..FIXTURE_TILE_PX {
                for col in 0..FIXTURE_TILE_PX {
                    if row < FIXTURE_NOISE_ROWS {
                        state = state
                            .wrapping_mul(FIXTURE_LCG_A)
                            .wrapping_add(FIXTURE_LCG_C);
                        indices.push(((state >> 33) & 0xF) as u8);
                    } else {
                        let v = ((t * 7 + row * 3) & 0xF) as u8;
                        let near_miss = row == FIXTURE_NEAR_MISS_ROW && col == FIXTURE_TILE_PX - 1;
                        indices.push(if near_miss { (v + 1) & 0xF } else { v });
                    }
                }
            }
        }
        // empacota chunky 4bpp: byte = tile*32 + row*4 + col/2, nibble alto na
        // coluna par (mesmo contrato de md_write_pixel_index).
        let mut data = vec![0u8; total / 2];
        let per_tile = FIXTURE_TILE_PX * FIXTURE_TILE_PX;
        for (i, idx) in indices.iter().enumerate() {
            let (t, rem) = (i / per_tile, i % per_tile);
            let (row, col) = (rem / FIXTURE_TILE_PX, rem % FIXTURE_TILE_PX);
            let byte = t * 32 + row * 4 + col / 2;
            if col % 2 == 0 {
                data[byte] = (data[byte] & 0x0F) | (idx << 4);
            } else {
                data[byte] = (data[byte] & 0xF0) | idx;
            }
        }
        data
    }

    /// ACEITE do fixture LZ4W autoral (SGDK 2.11: rescomp empacota o tileset
    /// com LZ4W e `unpackTileSet()` oficial o desempacota em runtime). NÃO é
    /// BYOR: as expectativas vêm do fonte do fixture, não de observação.
    ///
    /// Cobre o que a rodada inteira precisava provar fora de um alvo
    /// comercial: decode == fonte autoral, no-op honesto, e uma edição real
    /// que CABE no espaço original e cujo pixel de tela é PREDITO antes de
    /// qualquer emulação.
    #[test]
    #[ignore = "aceite de fixture: requer ROM local; rodar com --ignored"]
    fn fixture_lz4w_decodes_to_authored_source_and_edit_has_predicted_pixel() {
        let path = std::env::var("RDS_REX_LZ4W_FIXTURE_ROM")
            .expect("RDS_REX_LZ4W_FIXTURE_ROM ausente (aceite exige arquivo)");
        let rom = std::fs::read(&path).expect("fixture ROM ausente");
        // Identidade do fixture: sem este pin, o teste poderia rodar contra
        // qualquer ROM e a expectativa autoral perderia o vínculo.
        const FIXTURE_ROM_SHA256: &str =
            "159298eb1c9a437a6abc83c80becfe38c52d469d6284aeab4dc9dc06e9b2b9b5";
        let sha = super::super::rom_library::sha256_hex(&rom);
        assert_eq!(
            sha, FIXTURE_ROM_SHA256,
            "fixture ROM inesperada: {sha} (rebuild pode ter alterado os bytes — realce a expectativa com origem)"
        );
        let limits = Lz4wLimits::default();
        let set = verify_lz4w_resource_set(&rom, &limits).expect("conjunto LZ4W");
        assert_eq!(
            set.resources.len(),
            1,
            "fixture deve expor exatamente um recurso LZ4W verificável"
        );
        let resource = &set.resources[0];
        assert_eq!(resource.candidate.num_tiles, FIXTURE_TILE_COUNT);
        assert_eq!(resource.candidate.expected_len, FIXTURE_TILE_COUNT * 32);

        // (1) decode do produto == fonte autoral, recomposto do seed.
        assert_eq!(
            resource.decoded,
            fixture_expected_tiles(),
            "decode divergiu do tileset autoral"
        );

        // (2) no-op explícito pela mesma transação.
        let noop = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource,
                edited_data: &resource.decoded,
            },
            &limits,
        )
        .expect("no-op");
        assert!(matches!(noop, ReinsertOutcome::NoOp), "no-op virou escrita");

        // (3) MEDIDA BASE ANTES DE QUALQUER BUSCA: o codificador do produto
        //     reproduz o stream empacotado pelo rescomp dentro do espaço
        //     original? Sem folga, toda edição de um word fica mais longa que
        //     o slot por construção e enumerar candidatos é desperdício.
        let start = resource.candidate.stream_offset;
        let slot = resource.bytes_consumed;
        let dict = super::super::rex_codecs::Lz4wDictionaryIndex::build(&rom[..start])
            .expect("dicionário");
        let baseline = super::super::rex_codecs::lz4w_encode_with_dictionary_index(
            &resource.decoded,
            Some(&dict),
        )
        .expect("encode base");
        let headroom = slot as isize - baseline.len() as isize;
        eprintln!(
            "[rex-fixture] base: empacotado(rescomp)={slot}B re-codificado={}B folga={}B dicionário={} words",
            baseline.len(),
            headroom,
            dict.word_count(),
        );

        // (4) busca EXAUSTIVA e determinística sobre edições de um pixel
        //     (16 tiles x 64 pixels x 15 índices = 15.360 candidatos), com o
        //     índice de dicionário compartilhado e filtro barato: o
        //     comprimento do re-encode. A transação canônica (identidade,
        //     evidência, dependentes, roundtrip, BPS) só roda para candidatos
        //     que CABEM, e a decisão de aceite continua sendo dela.
        let mut chosen: Option<(usize, usize, usize, u8, Vec<u8>)> = None;
        let mut tested = 0usize;
        let mut fits = 0usize;
        let mut shortest = baseline.len();
        let mut histogram: std::collections::BTreeMap<usize, usize> =
            std::collections::BTreeMap::new();
        // Candidatos PLANTADOS primeiro: em cada tile, o último pixel da linha
        // near-miss volta ao valor da linha. São a única forma de um pixel só
        // encurtar o stream (igualem duas words adjacentes); a predictibilidade
        // deles é o que se afirma, não um acaso no fim da varredura.
        let mut candidatos: Vec<(usize, usize, usize, u8)> = Vec::new();
        for tile in 0..FIXTURE_TILE_COUNT {
            let row = FIXTURE_NEAR_MISS_ROW;
            let col = FIXTURE_TILE_PX - 1;
            let v = ((tile * 7 + row * 3) & 0xF) as u8;
            assert_eq!(
                md_read_pixel_index(&resource.decoded, tile, row, col).expect("pixel"),
                (v + 1) & 0xF,
                "fixture perdeu a palavra quase-igual plantada no tile {tile}"
            );
            candidatos.push((tile, row, col, v));
        }
        for tile in 0..FIXTURE_TILE_COUNT {
            for row in 0..FIXTURE_TILE_PX {
                for col in 0..FIXTURE_TILE_PX {
                    let original =
                        md_read_pixel_index(&resource.decoded, tile, row, col).expect("pixel");
                    for offset in 1..16u8 {
                        let index = (original + offset) % 16;
                        if row == FIXTURE_NEAR_MISS_ROW
                            && col == FIXTURE_TILE_PX - 1
                            && index == ((tile * 7 + row * 3) & 0xF) as u8
                        {
                            continue; // já tentado como plantado
                        }
                        candidatos.push((tile, row, col, index));
                    }
                }
            }
        }
        'scan: for (tile, row, col, index) in candidatos {
            let mut edited = resource.decoded.clone();
            md_write_pixel_index(&mut edited, tile, row, col, index).expect("edição chunky");
            let encoded =
                super::super::rex_codecs::lz4w_encode_with_dictionary_index(&edited, Some(&dict))
                    .expect("encode candidato");
            tested += 1;
            *histogram.entry(encoded.len()).or_default() += 1;
            shortest = shortest.min(encoded.len());
            if encoded.len() > slot {
                continue;
            }
            fits += 1;
            eprintln!(
                            "[rex-fixture] CABE tile={tile} row={row} col={col} idx={index} encode={}B slot={slot}B (candidato {tested})",
                            encoded.len(),
                        );
            match reinsert_transaction(
                &ReinsertRequest {
                    rom: &rom,
                    expected_rom_sha256: &sha,
                    resource,
                    edited_data: &edited,
                },
                &limits,
            ) {
                Ok(ReinsertOutcome::Applied(applied)) => {
                    chosen = Some((tile, row, col, index, applied.modified_rom.clone()));
                    break 'scan;
                }
                Ok(ReinsertOutcome::NoOp) => continue,
                Err(err) => {
                    eprintln!("[rex-fixture] transação recusou candidato cabível: {err:?}");
                }
            }
        }
        eprintln!(
            "[rex-fixture] varredura: {tested} candidatos, {fits} cabem, menor encode {shortest}B, slot {slot}B, folga base {headroom}B, distribuição {histogram:?}"
        );
        let (tile, row, col, index, modified_rom) = chosen.unwrap_or_else(|| {
            panic!(
                "nenhuma edição de pixel coube no espaço do fixture: {fits} de {tested} candidatos \
                 cabem, menor encode {shortest}B, slot {slot}B, folga base {headroom}B \
                 (o codificador guloso do produto produz {bl}B para o plain NÃO editado)",
                bl = baseline.len(),
            )
        });

        let applied = {
            let mut edited = resource.decoded.clone();
            md_write_pixel_index(&mut edited, tile, row, col, index).expect("reaplicar edição");
            match reinsert_transaction(
                &ReinsertRequest {
                    rom: &rom,
                    expected_rom_sha256: &sha,
                    resource,
                    edited_data: &edited,
                },
                &limits,
            )
            .expect("transação da edição escolhida")
            {
                ReinsertOutcome::Applied(applied) => applied,
                ReinsertOutcome::NoOp => panic!("edição real reportada como no-op"),
            }
        };
        assert!(applied.stream_written <= applied.original_stream_len);

        // (5) o ROM modificado re-decodifica para o plain previsto (um único
        //     nibble diferente do original autoral).
        let modified_set =
            verify_lz4w_resource_set(&modified_rom, &limits).expect("conjunto no modificado");
        let mut predicted = fixture_expected_tiles();
        md_write_pixel_index(&mut predicted, tile, row, col, index).expect("prever pixel");
        assert_eq!(modified_set.resources[0].decoded, predicted);

        // (6) a PRÉVIA do produto reflete a edição no lugar previsto e em
        //     nenhum outro. Isto é o que pega a regressão histórica de ler a
        //     faixa linearmente (que escondia edições fora do tile 0/linha 0).
        let strip_w = FIXTURE_TILE_COUNT * FIXTURE_TILE_PX;
        let original_rgba = md_tiles_to_rgba(&fixture_expected_tiles());
        let edited_rgba = md_tiles_to_rgba(&predicted);
        let mut differs: Vec<(usize, usize)> = Vec::new();
        for y in 0..FIXTURE_TILE_PX {
            for x in 0..strip_w {
                let p = (y * strip_w + x) * 4;
                if original_rgba[p..p + 4] != edited_rgba[p..p + 4] {
                    differs.push((x, y));
                }
            }
        }
        assert_eq!(
            differs,
            vec![(tile * FIXTURE_TILE_PX + col, row)],
            "prévia mudou fora do pixel editado (ou não mudou onde deveria)"
        );

        // (7) pixel de tela PREDITO antes de qualquer emulação: a célula do
        //     mapa é (t % 4, t / 4) num plano 4x4 de tiles 8x8, então a
        //     origem do tile é ((t%4)*8, (t/4)*8). NÃO é a coordenada da
        //     prévia acima (esta é a faixa de tiles, não a tela).
        let screen_x = (tile % FIXTURE_MAP_TILES_X) * FIXTURE_TILE_PX + col;
        let screen_y = (tile / FIXTURE_MAP_TILES_X) * FIXTURE_TILE_PX + row;
        let (preview_png, pw, ph, pixels_sha) =
            render_resource_png(&modified_set.resources[0].decoded).expect("prévia");
        let (_, _, _, original_pixels_sha) =
            render_resource_png(&fixture_expected_tiles()).expect("prévia original");
        assert_ne!(
            pixels_sha, original_pixels_sha,
            "prévia renderizada não refletiu a edição aplicada na ROM"
        );
        eprintln!(
            "[rex-fixture] rom_sha={sha} stream={:#x} escrito={} slot={} tile={tile} row={row} col={col} idx={index} tela=({screen_x},{screen_y}) previa_pos=({}, {}) previa={pw}x{ph} pixels_sha={pixels_sha} png_sha={}",
            resource.candidate.stream_offset,
            applied.stream_written,
            applied.original_stream_len,
            tile * FIXTURE_TILE_PX + col,
            row,
            super::super::rom_library::sha256_hex(&preview_png),
        );
    }

    /// Caminha um stream LZ4W SEM usar o decodificador do produto, só para
    /// contabilidade estrutural (quantos tokens, quantos literais, se há
    /// referência a dicionário externo). Não valida offsets nem reproduz
    /// bytes: a autoridade continua sendo `lz4w_decode_with_dictionary`.
    fn walk_stream_shape(stream: &[u8]) -> (usize, usize, usize, usize, usize) {
        // (tokens, literais em words, matches curtos, matches longos,
        //  matches longos com flag ROM source)
        let (mut tokens, mut lits, mut short, mut long, mut rom_src) = (0, 0, 0, 0, 0);
        let mut pos = 0usize;
        while pos + 2 <= stream.len() {
            let word = u16::from_be_bytes([stream[pos], stream[pos + 1]]);
            pos += 2;
            if word == 0 {
                break; // terminador; o word final é par/ímpar e não afeta a conta
            }
            tokens += 1;
            let literal_words = ((word >> 12) & 0xF) as usize;
            let match_nibble = ((word >> 8) & 0xF) as usize;
            let match_byte = (word & 0xFF) as usize;
            lits += literal_words;
            pos += literal_words * 2;
            if match_nibble > 0 {
                short += 1;
            } else if match_byte > 0 {
                long += 1;
                if pos + 2 <= stream.len() {
                    let encoded = u16::from_be_bytes([stream[pos], stream[pos + 1]]);
                    if encoded & 0x8000 != 0 {
                        rom_src += 1;
                    }
                }
                pos += 2;
            }
        }
        (tokens, lits, short, long, rom_src)
    }

    /// Re-encode + classificação de cada edição do §3 para um recurso.
    /// Toda stream que "cabe" é re-decodificada aqui: sem isso a medição
    /// poderia contar como sucesso um bytes que nenhum desempacotador lê.
    fn bench_edits(
        resource: &VerifiedLz4wResource,
        dict: &super::super::rex_codecs::Lz4wDictionaryIndex,
        dict_bytes: &[u8],
        limits: &Lz4wLimits,
        slot: usize,
    ) -> Vec<serde_json::Value> {
        let words = resource.decoded.len() / 2;
        let mut edits = Vec::new();
        for (eid, word_pos) in [
            ("E1", 0usize),
            ("E2", words / 3),
            ("E3", (2 * words) / 3),
            ("E4", words.saturating_sub(1)),
        ] {
            let mut edited = resource.decoded.clone();
            edited[word_pos * 2 + 1] |= 0x01;
            if edited == resource.decoded {
                edits.push(serde_json::json!({
                    "edicao": eid,
                    "word": word_pos,
                    "resultado": "noop_preservando_stream",
                    "motivo": "bit já valia 1: plain inalterado (§5)",
                }));
                continue;
            }
            match super::super::rex_codecs::lz4w_encode_with_dictionary_index(&edited, Some(dict)) {
                Ok(stream) => {
                    let back = lz4w_decode_with_dictionary(&stream, Some(dict_bytes), limits);
                    let roundtrip = back.map(|d| d.data == edited).unwrap_or(false);
                    if stream.len() <= slot {
                        assert!(
                            roundtrip,
                            "{eid}: stream coube mas não re-decodifica para o plain editado"
                        );
                        edits.push(serde_json::json!({
                            "edicao": eid, "word": word_pos, "len": stream.len(),
                            "resultado": "cabe", "roundtrip": true,
                        }));
                    } else {
                        edits.push(serde_json::json!({
                            "edicao": eid, "word": word_pos, "len": stream.len(),
                            "resultado": "needs_space",
                            "motivo": format!(
                                "re-encode {}B > slot {}B (+{}B)",
                                stream.len(),
                                slot,
                                stream.len() - slot
                            ),
                        }));
                    }
                }
                Err(error) => edits.push(serde_json::json!({
                    "edicao": eid, "word": word_pos,
                    "resultado": format!("recusa:{}", error.code),
                    "motivo": error.detail,
                })),
            }
        }
        edits
    }

    /// Capacidade REAL de edição, medida por amostragem: inverte bits do plain
    /// em posições uniformemente espaçadas e mede o comprimento do stream
    /// resultante. NÃO é varredura exaustiva (seria O(bits) codificações por
    /// recurso, o que estouraria o orçamento do §6.4) — por isso o tamanho da
    /// amostra sai junto e o agregado é reportado como "amostra".
    fn bench_amostra_edicoes(
        resource: &VerifiedLz4wResource,
        dict: &super::super::rex_codecs::Lz4wDictionaryIndex,
        dict_bytes: &[u8],
        limits: &Lz4wLimits,
        slot: usize,
        sample: usize,
    ) -> serde_json::Value {
        let bits = resource.decoded.len() * 8;
        let n = sample.min(bits).max(1);
        let passo = bits / n;
        let mut comprimentos = Vec::new();
        let mut cabem = 0usize;
        for k in 0..n {
            let bit = (k * passo).min(bits - 1);
            let mut edited = resource.decoded.clone();
            edited[bit / 8] ^= 1 << (bit % 8);
            match super::super::rex_codecs::lz4w_encode_with_dictionary_index(&edited, Some(dict)) {
                Ok(stream) => {
                    if stream.len() <= slot {
                        let back = lz4w_decode_with_dictionary(&stream, Some(dict_bytes), limits);
                        assert!(
                            back.is_ok_and(|d| d.data == edited),
                            "amostra de bit {bit}: stream coube mas não re-decodifica"
                        );
                        cabem += 1;
                    }
                    comprimentos.push(stream.len());
                }
                Err(_) => comprimentos.push(usize::MAX),
            }
        }
        let mut sorted = comprimentos.clone();
        sorted.sort_unstable();
        serde_json::json!({
            "amostra_bits": comprimentos.len(),
            "slot": slot,
            "que_cabem": cabem,
            "menor": sorted.first().copied(),
            "mediana": sorted.get(sorted.len() / 2).copied(),
            "maior": sorted.last().copied(),
        })
    }

    /// Limite superior de dependentes por endereçamento (§4): outros
    /// recursos cujo dicionário (janela de `0x4000` words) alcança o intervalo
    /// ou cujo stream se sobrepõe. A autoridade é a transação.
    fn bench_alcance(
        resources: &[&VerifiedLz4wResource],
        index: usize,
        start: usize,
        slot: usize,
    ) -> usize {
        resources
            .iter()
            .enumerate()
            .filter(|(j, other)| {
                if *j == index {
                    return false;
                }
                let other_start = other.candidate.stream_offset;
                let other_end = other_start + other.bytes_consumed;
                let window_lo = other_start.saturating_sub(0x4000 * 2);
                let dictionary_reaches =
                    other_start > start && other_start <= start + slot && window_lo < start + slot;
                let interval_overlaps = other_start < start + slot && start < other_end;
                dictionary_reaches || interval_overlaps
            })
            .count()
    }

    /// Benchmark de recompressão LZ4W — implementação da especificação
    /// congelada em `scripts/rex_profiles/integrator/lz4w_recompress/BENCH_SPEC.md`.
    ///
    /// Mede a capacidade REAL do codificador: para cada recurso verificado,
    /// quanto cabe o re-encode do plain **não editado** em relação ao slot
    /// (`folga_base`) e se as edições predefinidas do §3 cabem. Nenhum
    /// parâmetro é escolhido aqui; este teste só produz a linha de base que os
    /// incrementos do codificador têm de bater. No-op que preserva o stream
    /// original sai em campo próprio e **não** conta como sucesso (§5).
    #[test]
    #[ignore = "benchmark BYOR: requer ROMs locais e RDS_REX_BENCH_OUT; rodar com --ignored"]
    fn lz4w_recompression_benchmark() {
        use std::time::Instant;

        let out_dir = std::env::var("RDS_REX_BENCH_OUT")
            .expect("RDS_REX_BENCH_OUT ausente: o benchmark escreve a tabela nele");
        // O harness do cargo roda os testes com cwd no diretório do crate: um
        // caminho relativo escreveria a evidência dentro de src-tauri/.
        assert!(
            std::path::Path::new(&out_dir).is_absolute(),
            "RDS_REX_BENCH_OUT tem de ser absoluto (recebido: {out_dir})"
        );
        std::fs::create_dir_all(&out_dir).expect("criar RDS_REX_BENCH_OUT");
        // Dumps de material para o instrumento de piso (`dp_floor.py`), que é
        // Python e precisa do plain/dicionário/stream de cada recurso. São
        // OPCIONAIS e nunca podem cair dentro do repositório: o corpus S-B é
        // ROM comercial, e bytes comerciais não vão para o git (AGENTS.md).
        let dump_dir = std::env::var("RDS_REX_BENCH_DUMP_DIR")
            .ok()
            .filter(|v| !v.is_empty());
        let mut dump_index: Vec<serde_json::Value> = Vec::new();
        if let Some(dir) = &dump_dir {
            let path = std::path::Path::new(dir);
            assert!(
                path.is_absolute(),
                "RDS_REX_BENCH_DUMP_DIR tem de ser absoluto (recebido: {dir})"
            );
            let crate_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
            let repo = crate_dir.parent().unwrap_or(crate_dir);
            assert!(
                !path.starts_with(repo),
                "RDS_REX_BENCH_DUMP_DIR aponta para dentro do repositório ({dir}): o dump contém \
                 plain de ROM comercial e só pode ser escrito fora de {repo:?}"
            );
            std::fs::create_dir_all(path).expect("criar RDS_REX_BENCH_DUMP_DIR");
        }
        let corpus_path = std::env::var("RDS_HAMOOPIG_ROM").unwrap_or_else(|_| {
            "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin".to_string()
        });
        // Ausência FALHA (aceite BYOR não vira skip silencioso).
        let corpus = std::fs::read(&corpus_path)
            .unwrap_or_else(|e| panic!("ROM do corpus ausente em {corpus_path}: {e}"));
        let corpus_sha = super::super::rom_library::sha256_hex(&corpus);
        assert_eq!(
            corpus_sha,
            "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9"
        );
        let fixture_path = std::env::var("RDS_REX_LZ4W_FIXTURE_ROM")
            .expect("RDS_REX_LZ4W_FIXTURE_ROM ausente (S-A é conjunto obrigatório)");
        let fixture = std::fs::read(&fixture_path)
            .unwrap_or_else(|e| panic!("ROM do fixture ausente em {fixture_path}: {e}"));
        let fixture_sha = super::super::rom_library::sha256_hex(&fixture);
        assert_eq!(
            fixture_sha,
            "159298eb1c9a437a6abc83c80becfe38c52d469d6284aeab4dc9dc06e9b2b9b5"
        );

        let limits = Lz4wLimits::default();
        // Orçamento do §6.4: 2 s por recurso, 120 s por rodada.
        const PER_RESOURCE_BUDGET_MS: u128 = 2_000;
        const ROUND_BUDGET_MS: u128 = 120_000;
        // Bits invertidos por recurso na medição de capacidade de edição (§4).
        // Amostragem deliberada: exaustivo seria O(bits) codificações por
        // recurso, o que estoura o orçamento acima.
        const EDIT_SAMPLE_BITS: usize = 24;
        let mut rows: Vec<serde_json::Value> = Vec::new();
        let mut estouro_por_recurso: Vec<String> = Vec::new();
        let round_start = Instant::now();

        // O codificador só alcança `ENCODER_WINDOW_WORDS` (0x4000) words para
        // trás e os offsets LZ4W são medidos a partir do FIM de
        // (dicionário + saída), então um sufixo do prefixo deveria produzir
        // streams idênticos aos do prefixo integral. Isso é ASSEÇÃO, não
        // suposição: o primeiro recurso de cada conjunto é codificado das duas
        // formas e comparado byte a byte (`janela_dicionario` no resumo). Sem
        // essa prova a varredura codificaria 160 recursos contra um HashMap de
        // centenas de milhares de words — custo do harness, não do codificador.
        const DICT_TAIL_BYTES: usize = 0x1_0000;
        let mut janela_dicionario: Vec<serde_json::Value> = Vec::new();

        for (conjunto, rom) in [
            ("S-B-corpus", corpus.as_slice()),
            ("S-A-fixture", fixture.as_slice()),
        ] {
            let set = verify_lz4w_resource_set(rom, &limits).expect("conjunto verificado");
            let mut resources: Vec<&VerifiedLz4wResource> = set.resources.iter().collect();
            resources.sort_by_key(|r| r.candidate.stream_offset);
            for (index, resource) in resources.iter().enumerate() {
                let elapsed = Instant::now();
                let start = resource.candidate.stream_offset;
                let slot = resource.bytes_consumed;
                let prefix = &rom[..start];
                let dict_bytes = &prefix[prefix.len().saturating_sub(DICT_TAIL_BYTES)..];
                let dict = match super::super::rex_codecs::Lz4wDictionaryIndex::build(dict_bytes) {
                    Ok(dict) => dict,
                    Err(error) => {
                        estouro_por_recurso.push(format!("{conjunto} {start:#x}: índice: {error}"));
                        continue;
                    }
                };
                let (tokens, lit_words, short_matches, long_matches, rom_source_refs) =
                    walk_stream_shape(&rom[start..start + slot]);
                let base = super::super::rex_codecs::lz4w_encode_with_dictionary_index_explained(
                    &resource.decoded,
                    Some(&dict),
                );
                // Estratégia registrada por recurso: o antes/depois do incremento
                // só é lido como comparação se cada linha disser por qual caminho
                // passou. Um `reencode_base` sem estratégia não é reproduzível.
                let estrategia_base = base.as_ref().ok().map(|(_, s)| match s {
                    super::super::rex_codecs::Lz4wEncodeStrategy::CostDp => "dp_custo_explicito",
                    super::super::rex_codecs::Lz4wEncodeStrategy::Greedy => "guloso_fallback",
                });
                // Barreira do §6.2: o que o codificador emite tem de voltar ao
                // plain exato consumindo o stream inteiro.
                let reencode_base = match &base {
                    Ok((stream, _)) => {
                        let back = lz4w_decode_with_dictionary(stream, Some(dict_bytes), &limits)
                            .unwrap_or_else(|error| {
                                panic!(
                                    "{conjunto} {start:#x}: re-encode base não decodifica: {error}"
                                )
                            });
                        assert_eq!(
                            back.data, resource.decoded,
                            "{conjunto} {start:#x}: re-encode base não reproduz o plain"
                        );
                        assert_eq!(
                            back.bytes_consumed,
                            stream.len(),
                            "{conjunto} {start:#x}: re-encode base consumido parcialmente"
                        );
                        if janela_dicionario
                            .iter()
                            .all(|j| j["conjunto"] != serde_json::json!(conjunto))
                        {
                            let full = super::super::rex_codecs::Lz4wDictionaryIndex::build(prefix)
                                .expect("índice do prefixo integral");
                            let stream_full =
                                super::super::rex_codecs::lz4w_encode_with_dictionary_index(
                                    &resource.decoded,
                                    Some(&full),
                                )
                                .expect("encode com o prefixo integral");
                            assert_eq!(
                                stream_full, *stream,
                                "{conjunto} {start:#x}: a janela de sufixo NÃO equivale ao \
                                 prefixo integral — usar prefixo integral no benchmark"
                            );
                            janela_dicionario.push(serde_json::json!({
                                "conjunto": conjunto,
                                "recurso": format!("{start:#x}"),
                                "prefixo_bytes": prefix.len(),
                                "cauda_bytes": dict_bytes.len(),
                                "streams_identicas": true,
                            }));
                        }
                        Some(stream.len())
                    }
                    Err(_) => None,
                };
                let mut row = serde_json::json!({
                    "conjunto": conjunto,
                    "grupo": if conjunto == "S-A-fixture" { "referencia" }
                        else if index % 5 == 0 { "validacao" } else { "ajuste" },
                    "recurso": format!("{start:#x}"),
                    "header_offset": resource.candidate.header_offset,
                    "num_tiles": resource.candidate.num_tiles,
                    "plain_len": resource.decoded.len(),
                    "slot": slot,
                    "reencode_base": reencode_base,
                    "estrategia_base": estrategia_base,
                    "folga_base": reencode_base.map(|n| slot as i64 - n as i64),
                    "base_recusou": base.as_ref().err().map(|e| e.code),
                    "tokens": tokens,
                    "lit_words": lit_words,
                    "matches_curtos": short_matches,
                    "matches_longos": long_matches,
                    "dep_usa_rom_source": rom_source_refs > 0,
                    "dep_alcance": bench_alcance(&resources, index, start, slot),
                    "edicoes": bench_edits(resource, &dict, dict_bytes, &limits, slot),
                    "edições_amostra": bench_amostra_edicoes(
                        resource,
                        &dict,
                        dict_bytes,
                        &limits,
                        slot,
                        EDIT_SAMPLE_BITS,
                    ),
                });
                if let (Some(dir), Ok((stream, _))) = (&dump_dir, base.as_ref()) {
                    let stem = format!("{conjunto}-{start:08x}");
                    let writes = [
                        (
                            format!("{dir}/{stem}-plain.bin"),
                            resource.decoded.as_slice(),
                        ),
                        (format!("{dir}/{stem}-dict.bin"), dict_bytes),
                        (format!("{dir}/{stem}-produto.stream"), stream.as_slice()),
                        (
                            format!("{dir}/{stem}-rescomp.stream"),
                            &rom[start..start + slot],
                        ),
                    ];
                    for (path, bytes) in writes {
                        std::fs::write(&path, bytes)
                            .unwrap_or_else(|e| panic!("escrever {path}: {e}"));
                    }
                    dump_index.push(serde_json::json!({
                        "conjunto": conjunto,
                        "grupo": if conjunto == "S-A-fixture" { "referencia" }
                            else if index % 5 == 0 { "validacao" } else { "ajuste" },
                        "recurso": format!("{start:#x}"),
                        "stem": stem,
                        "plain_len": resource.decoded.len(),
                        "slot": slot,
                        "dict_bytes": dict_bytes.len(),
                        "produto_len": stream.len(),
                        "estrategia": estrategia_base,
                    }));
                }
                let ms = elapsed.elapsed().as_millis();
                row["tempo_recurso_ms"] = serde_json::json!(ms);
                rows.push(row);
                if ms > PER_RESOURCE_BUDGET_MS {
                    estouro_por_recurso.push(format!(
                        "{conjunto} {start:#x}: {ms}ms > {PER_RESOURCE_BUDGET_MS}ms"
                    ));
                }
            }
        }
        let estouro_rodada = round_start.elapsed().as_millis() > ROUND_BUDGET_MS;

        // Dumps S-A SOMENTE (autoral, reconstruível pela receita): é o par
        // rescomp/produto que a análise de tokens independente consome.
        let fixture_set = verify_lz4w_resource_set(&fixture, &limits).expect("fixture");
        let resource = &fixture_set.resources[0];
        let start = resource.candidate.stream_offset;
        let slot = resource.bytes_consumed;
        let dict_bytes = &fixture[..start];
        let index = super::super::rex_codecs::Lz4wDictionaryIndex::build(dict_bytes).expect("dict");
        let base_stream = super::super::rex_codecs::lz4w_encode_with_dictionary_index(
            &resource.decoded,
            Some(&index),
        )
        .expect("re-encode base do fixture");
        std::fs::write(format!("{out_dir}/sa-plain.bin"), &resource.decoded).expect("plain");
        std::fs::write(format!("{out_dir}/sa-dict.bin"), dict_bytes).expect("dict");
        std::fs::write(
            format!("{out_dir}/sa-rescomp.stream"),
            &fixture[start..start + slot],
        )
        .expect("rescomp");
        std::fs::write(format!("{out_dir}/sa-product.stream"), &base_stream).expect("produto");

        let mut coube_ajuste = 0usize;
        let mut coube_validacao = 0usize;
        let mut amostra_ajuste = 0usize;
        let mut amostra_validacao = 0usize;
        let mut total_ajuste = 0usize;
        let mut total_validacao = 0usize;
        let mut folga_total: i64 = 0;
        let mut base_recusada = 0usize;
        let mut estrategia_dp = 0usize;
        let mut estrategia_guloso = 0usize;
        let mut tempo_total_ms: u64 = 0;
        let mut motivos: std::collections::BTreeMap<String, usize> = Default::default();
        for row in &rows {
            match row["estrategia_base"].as_str() {
                Some("dp_custo_explicito") => estrategia_dp += 1,
                Some("guloso_fallback") => estrategia_guloso += 1,
                _ => {}
            }
            tempo_total_ms += row["tempo_recurso_ms"].as_u64().unwrap_or(0);
            if conjunto_s_b(row) {
                match row["folga_base"].as_i64() {
                    Some(folga) => folga_total += folga,
                    None => base_recusada += 1,
                }
            }
            let mut coube = false;
            for edit in row["edicoes"].as_array().into_iter().flatten() {
                let resultado = edit["resultado"].as_str().unwrap_or("?").to_string();
                *motivos.entry(resultado.clone()).or_default() += 1;
                coube |= resultado == "cabe";
            }
            match (coube, row["grupo"].as_str()) {
                (true, Some("ajuste")) => coube_ajuste += 1,
                (true, Some("validacao")) => coube_validacao += 1,
                _ => {}
            }
            // Capacidade por amostragem (§4): pelo menos um dos bits invertidos
            // produziu stream que cabe E re-decodifica (a barreira está dentro
            // de `bench_amostra_edicoes`).
            match row["grupo"].as_str() {
                Some("ajuste") => total_ajuste += 1,
                Some("validacao") => total_validacao += 1,
                _ => {}
            }
            let amostra_cabe = row["edições_amostra"]["que_cabem"].as_u64().unwrap_or(0) > 0;
            match (amostra_cabe, row["grupo"].as_str()) {
                (true, Some("ajuste")) => amostra_ajuste += 1,
                (true, Some("validacao")) => amostra_validacao += 1,
                _ => {}
            }
        }
        let round_ms = round_start.elapsed().as_millis();
        let s_b: Vec<&serde_json::Value> = rows.iter().filter(|r| conjunto_s_b(r)).collect();
        let summary = serde_json::json!({
            "especificacao": "scripts/rex_profiles/integrator/lz4w_recompress/BENCH_SPEC.md",
            "roms": { "S-B": corpus_sha, "S-A": fixture_sha },
            "recursos_S_B": s_b.len(),
            "coube_ajuste": coube_ajuste,
            "coube_validacao": coube_validacao,
            "recursos_totais_ajuste": total_ajuste,
            "recursos_totais_validacao": total_validacao,
            "edicao_amostral_bits_por_recurso": EDIT_SAMPLE_BITS,
            "recursos_com_edicao_amostral_cabivel_ajuste": amostra_ajuste,
            "recursos_com_edicao_amostral_cabivel_validacao": amostra_validacao,
            "folga_total_S_B_bytes": folga_total,
            "recursos_com_folga_nao_negativa": s_b.iter().filter(|r| r["folga_base"].as_i64().unwrap_or(i64::MIN) >= 0).count(),
            "codificador_recusou_a_base": base_recusada,
            "estrategia_base": {
                "dp_custo_explicito": estrategia_dp,
                "guloso_fallback": estrategia_guloso,
            },
            "tempo_medio_por_recurso_ms": if rows.is_empty() { 0 } else { tempo_total_ms / rows.len() as u64 },
            "distribuicao_resultados": motivos,
            "orcamento_ms": { "por_recurso": PER_RESOURCE_BUDGET_MS, "rodada": ROUND_BUDGET_MS },
            "estouros_por_recurso": estouro_por_recurso,
            "tempo_rodada_ms": round_ms,
            "rodada_estourou": estouro_rodada,
            "janela_dicionario": janela_dicionario,
            "transacao_canonica": "não executada aqui: o benchmark mede tamanho de re-encode; a transação é exercida pelos aceites BYOR e do fixture",
        });
        std::fs::write(
            format!("{out_dir}/bench.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "resumo": summary,
                "recursos": rows,
            }))
            .expect("serializar"),
        )
        .expect("escrever bench.json");

        if let Some(dir) = &dump_dir {
            std::fs::write(
                format!("{dir}/dumps-index.json"),
                serde_json::to_vec_pretty(&serde_json::json!({
                    "roms": { "S-B": corpus_sha, "S-A": fixture_sha },
                    "dicionario": "cauda de DICT_TAIL_BYTES bytes do prefixo do stream (equivale ao \
                                   prefixo integral: asserção janela_dicionario)",
                    "recursos": dump_index,
                }))
                .expect("serializar índice de dumps"),
            )
            .expect("escrever dumps-index.json");
            eprintln!(
                "[bench] dumps de material: {} recursos em {dir}",
                dump_index.len()
            );
        }

        eprintln!(
            "[bench] S-B={} coube_ajuste={} coube_validacao={} folga_total={}B com_folga>=0={} rodada={}ms/{}ms{}",
            s_b.len(),
            coube_ajuste,
            coube_validacao,
            folga_total,
            summary["recursos_com_folga_nao_negativa"].as_u64().unwrap_or(0),
            round_ms,
            ROUND_BUDGET_MS,
            if round_ms > ROUND_BUDGET_MS { " — ESTOUROU (publicado como perda, não escondido)" } else { "" }
        );
        eprintln!(
            "[bench] estratégia da base: dp_custo_explicito={} guloso_fallback={} | média {} ms/recurso",
            estrategia_dp,
            estrategia_guloso,
            summary["tempo_medio_por_recurso_ms"].as_u64().unwrap_or(0)
        );
        eprintln!("[bench] distribuição: {motivos:?}");
        eprintln!(
            "[bench] capacidade de edição por amostragem ({} bits/recuso): ajuste {amostra_ajuste}/{} validação {amostra_validacao}/{} — battery §4-edita coube_ajuste={coube_ajuste} coube_validacao={coube_validacao}",
            EDIT_SAMPLE_BITS, total_ajuste, total_validacao
        );
        assert!(
            round_ms <= ROUND_BUDGET_MS * 4,
            "benchmark extrapola o orçamento em mais de 4x: {round_ms}ms"
        );
    }

    /// Barreira do instrumento de piso com o decodificador REAL do produto.
    ///
    /// `dp_floor.py` valida o próprio modelo contra busca exaustiva e contra o
    /// tokenizador Python de `tokens.py`; nenhum dos dois é o código do produto.
    /// Este teste fecha essa lacuna: pega cada stream de piso escrito por
    /// `floor_sweep.py --escrever-streams` e o decodifica com
    /// `lz4w_decode_with_dictionary`, o mesmo caminho que a transação usa. Se um
    /// stream de piso não voltar ao plain exato consumindo-se inteiro, o "piso"
    /// medido é bug de modelo, não margem do codificador — e a varredura inteira
    /// é descartada.
    ///
    /// Receita: ver §9 de `scripts/rex_profiles/integrator/lz4w_recompress/BENCH_SPEC.md`.
    #[test]
    #[ignore = "verifica dumps descartáveis de /tmp; exige RDS_REX_BENCH_DUMP_DIR + --escrever-streams"]
    fn piso_streams_do_dp_decodificam_pelo_decoder_do_produto() {
        let dir = std::env::var("RDS_REX_BENCH_DUMP_DIR")
            .expect("RDS_REX_BENCH_DUMP_DIR ausente: o verificador consome os dumps do benchmark");
        let path = std::path::Path::new(&dir);
        assert!(
            path.is_absolute(),
            "RDS_REX_BENCH_DUMP_DIR tem de ser absoluto (recebido: {dir})"
        );
        let crate_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo = crate_dir.parent().unwrap_or(crate_dir);
        assert!(
            !path.starts_with(repo),
            "o diretório de dumps ({dir}) está dentro do repositório: contém plain de ROM comercial"
        );

        let indice: serde_json::Value = serde_json::from_slice(
            &std::fs::read(path.join("dumps-index.json"))
                .expect("dumps-index.json ausente no diretório de dumps"),
        )
        .expect("dumps-index.json ilegível");
        let recursos = indice["recursos"].as_array().expect("recursos[]");
        assert!(
            !recursos.is_empty(),
            "índice de dumps vazio: nada verificado"
        );

        let limits = Lz4wLimits::default();
        let mut verificados = 0usize;
        let mut ganho_total_bytes = 0i64;
        for entry in recursos {
            let stem = entry["stem"].as_str().expect("stem");
            let recurso = entry["recurso"].as_str().expect("recurso");
            let stream = match std::fs::read(path.join(format!("{stem}-piso.stream"))) {
                Ok(b) => b,
                Err(_) => panic!("{recurso}: {stem}-piso.stream ausente — rode floor_sweep.py com --escrever-streams"),
            };
            let dict = std::fs::read(path.join(format!("{stem}-dict.bin"))).expect("dict");
            let plain = std::fs::read(path.join(format!("{stem}-plain.bin"))).expect("plain");
            let decodificado = lz4w_decode_with_dictionary(&stream, Some(&dict), &limits)
                .unwrap_or_else(|e| panic!("{recurso}: stream de piso recusado pelo decoder: {e}"));
            assert_eq!(
                decodificado.data, plain,
                "{recurso}: stream de piso não reproduz o plain — o 'piso' é bug de modelo"
            );
            assert_eq!(
                decodificado.bytes_consumed,
                stream.len(),
                "{recurso}: stream de piso consumido parcialmente"
            );
            verificados += 1;
            ganho_total_bytes += entry["produto_len"].as_i64().unwrap_or(0) - stream.len() as i64;
        }
        assert_eq!(
            verificados,
            recursos.len(),
            "todo recurso do índice tem de ser verificado"
        );
        eprintln!(
            "[piso] {verificados} streams de piso decodificados pelo decoder do produto; \
             ganho total sobre o stream do produto = {ganho_total_bytes} B"
        );
    }

    fn conjunto_s_b(row: &serde_json::Value) -> bool {
        row["conjunto"].as_str() == Some("S-B-corpus")
    }
}
