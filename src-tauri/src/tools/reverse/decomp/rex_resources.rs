//! Cadeia de recurso comprimido REX v1 (CONTRATOS §5).
//!
//! Identificação estrutural **assistida e rotulada**: um header TileSet do
//! SGDK (`{u16 compression; u16 numTile; u32 *tiles}`) declara o codec e o
//! tamanho exato esperado (`numTile * 32`); o stream decodifica com o
//! dicionário = prefixo da ROM antes do stream. Não é detecção automática
//! geral e não assume mapeamento linear entre bytes decodificados e offsets
//! da ROM.

use super::rex_codecs::{
    lz4w_decode_with_dictionary, lz4w_encode_with_dictionary, CodecError, Lz4wLimits,
};

/// Codec declarado por um header TileSet do SGDK.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TilesetCompression {
    None,
    Aplib,
    Lz4w,
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

/// Resultado da reinserção em cópia.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReinsertedRom {
    pub rom: Vec<u8>,
    /// Bytes de stream escritos (novos).
    pub stream_written: usize,
    /// Espaço do stream original (limite comprovadamente disponível).
    pub original_stream_len: usize,
}

/// Reinserção em cópia: re-codifica os dados editados com o dicionário =
/// prefixo da ROM antes do stream (variante prev-block do ResComp) e escreve
/// o novo stream sobre a região do original (completando com 0x00 — nunca
/// lidos após o terminador). Recusa crescimento; não altera header,
/// ponteiros nem vizinhos. A verificação de dependências de outros recursos
/// fica a cargo do chamador (equivalência global de decode).
pub fn reinsert(
    rom: &[u8],
    resource: &VerifiedLz4wResource,
    edited_data: &[u8],
) -> Result<ReinsertedRom, CodecError> {
    if edited_data.len() != resource.candidate.expected_len {
        return Err(CodecError::new(
            "overflow",
            format!(
                "dados editados têm {} bytes; esperado {}",
                edited_data.len(),
                resource.candidate.expected_len
            ),
        ));
    }
    let original_stream_len = resource.bytes_consumed;
    let start = resource.candidate.stream_offset;
    let new_stream = lz4w_encode_with_dictionary(edited_data, Some(&rom[..start]))?;
    if new_stream.len() > original_stream_len {
        return Err(CodecError::new(
            "excessive_output",
            format!(
                "stream re-codificado de {} bytes excede o espaço original de {original_stream_len}; sem expansão no v1",
                new_stream.len()
            ),
        ));
    }
    let mut out = rom.to_vec();
    out[start..start + new_stream.len()].copy_from_slice(&new_stream);
    for byte in &mut out[start + new_stream.len()..start + original_stream_len] {
        *byte = 0x00;
    }
    Ok(ReinsertedRom {
        rom: out,
        stream_written: new_stream.len(),
        original_stream_len,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hamoopig_rom() -> Option<Vec<u8>> {
        let path = std::env::var("RDS_HAMOOPIG_ROM").unwrap_or_else(|_| {
            "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin"
                .to_string()
        });
        std::fs::read(path).ok()
    }

    /// Cadeia real: scan -> verificação -> decode -> edição determinística ->
    /// encode com dicionário -> reinserção em cópia -> verificação de patch
    /// -> equivalência global de decode (nenhum outro recurso muda).
    /// Sem a ROM BYOR local, o teste é ignorado.
    #[test]
    fn chain_scan_decode_edit_reinsert_on_frozen_corpus() {
        let Some(rom) = hamoopig_rom() else {
            eprintln!("ignorado: ROM HAMOOPIG ausente");
            return;
        };
        let limits = Lz4wLimits::default();
        let candidates = scan_tileset_headers(&rom);
        let lz4w: Vec<_> = candidates
            .iter()
            .filter(|c| c.compression == TilesetCompression::Lz4w)
            .collect();
        assert!(
            lz4w.len() >= 100,
            "esperava >=100 headers LZ4W, obtive {}",
            lz4w.len()
        );
        let verified: Vec<_> = lz4w
            .iter()
            .filter_map(|c| verify_lz4w_resource(&rom, c, &limits).ok())
            .collect();
        assert!(verified.len() >= 100, "esperava >=100 recursos verificados");
        // Baseline: decode de todos os recursos verificados na ROM original.
        let baseline: Vec<Vec<u8>> = verified
            .iter()
            .map(|r| {
                lz4w_decode_with_dictionary(
                    &rom[r.candidate.stream_offset..],
                    Some(&rom[..r.candidate.stream_offset]),
                    &limits,
                )
                .expect("baseline decode")
                .data
            })
            .collect();

        // Escolha determinística: primeiro recurso (em ordem de header) em
        // que (a) a re-codificação cabe no espaço original e (b) nenhum
        // outro recurso muda de decode na ROM modificada (sem dependentes
        // que referenciem os bytes do stream editado).
        let mut chain_done = false;
        let mut needs_space_count = 0u32;
        let mut dependent_count = 0u32;
        for resource in &verified {
            let candidate = &resource.candidate;
            // Edição determinística mínima: inverte o nibble alto do primeiro
            // byte (um pixel do primeiro tile) para minimizar o impacto na
            // compressão; o efeito visual é observável no jogo.
            let mut edited = resource.decoded.clone();
            edited[0] ^= 0xF0;
            let Ok(reinserted) = reinsert(&rom, resource, &edited) else {
                needs_space_count += 1;
                continue;
            };
            let start = candidate.stream_offset;
            let end = start + reinserted.original_stream_len;
            // Estrutura preservada: tamanho, header/ponteiros e vizinhança.
            assert_eq!(reinserted.rom.len(), rom.len());
            assert_eq!(
                reinserted.rom[candidate.header_offset..candidate.header_offset + 8],
                rom[candidate.header_offset..candidate.header_offset + 8]
            );
            assert!(reinserted.rom[..start] == rom[..start]);
            assert!(reinserted.rom[end..] == rom[end..]);
            // O stream reinserido decodifica para a edição.
            let recheck = lz4w_decode_with_dictionary(
                &reinserted.rom[start..start + reinserted.stream_written],
                Some(&rom[..start]),
                &limits,
            )
            .expect("decode do stream reinserido");
            assert_eq!(
                recheck.data, edited,
                "reinserido não decodifica para a edição"
            );
            // Equivalência global: todos os outros recursos decodificam
            // byte a byte igual ao baseline (nenhum dependente quebrado).
            let mut divergent = 0usize;
            for (index, other) in verified.iter().enumerate() {
                let modified_decode = lz4w_decode_with_dictionary(
                    &reinserted.rom[other.candidate.stream_offset..],
                    Some(&reinserted.rom[..other.candidate.stream_offset]),
                    &limits,
                );
                let same = match modified_decode {
                    Ok(decoded) => decoded.data == baseline[index],
                    Err(_) => false,
                };
                if !same {
                    divergent += 1;
                }
            }
            if divergent != 1 {
                // Só o próprio recurso editado pode divergir.
                dependent_count += 1;
                continue;
            }
            // Patch: o diff mínimo aplica exatamente sobre o original.
            let diffs: Vec<usize> = reinserted
                .rom
                .iter()
                .zip(rom.iter())
                .enumerate()
                .filter(|(_, (a, b))| a != b)
                .map(|(i, _)| i)
                .collect();
            assert!(!diffs.is_empty(), "edição sem efeito no stream");
            assert!(
                diffs.iter().all(|i| *i >= start && *i < end),
                "diff fora da região do stream"
            );
            for offset in &diffs {
                assert_ne!(reinserted.rom[*offset], rom[*offset]);
            }
            // Hashes de evidência (original vs cópia modificada).
            let sha256_hex = crate::tools::reverse::decomp::rom_library::sha256_hex;
            eprintln!(
                "cadeia OK: header={:#x} stream={:#x} tiles={} original={} modificado={} diff_bytes={}",
                candidate.header_offset,
                start,
                candidate.num_tiles,
                sha256_hex(&rom),
                sha256_hex(&reinserted.rom),
                diffs.len()
            );
            chain_done = true;
            break;
        }
        assert!(
            chain_done,
            "nenhum recurso aceitou a edição; needs_space={needs_space_count} dependentes={dependent_count}"
        );
    }
}
