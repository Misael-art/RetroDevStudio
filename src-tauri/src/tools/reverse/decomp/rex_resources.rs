//! Cadeia de recurso comprimido REX v1 (CONTRATOS §5).
//!
//! Identificação estrutural **assistida e rotulada**: um header TileSet do
//! SGDK (`{u16 compression; u16 numTile; u32 *tiles}`) declara o codec e o
//! tamanho exato esperado (`numTile * 32`); o stream decodifica com o
//! dicionário = prefixo da ROM antes do stream. Não é detecção automática
//! geral e não assume mapeamento linear entre bytes decodificados e offsets
//! da ROM.
//!
//! A reinserção canônica é uma **transação** (`reinsert_transaction`): só
//! produz cópia modificada se identidade da ROM, evidência do recurso,
//! limites de espaço e preservação de dependentes passarem. A verificação de
//! dependentes cobre o conjunto analisável declarado (todos os recursos
//! LZ4W estruturalmente verificados desta ROM) — os limites estão no
//! resultado, nunca apresentados como equivalência global do jogo.

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

/// Pedido de reinserção canônica.
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

/// Transação canônica de reinserção (CONTRATOS §5):
/// 1. identidade da ROM (SHA-256 conferido);
/// 2. evidência do recurso re-verificada contra ESTA ROM;
/// 3. tamanhos e intervalos (sem overflow, sem expansão);
/// 4. contexto de dicionário fixado (prefixo da ROM antes do stream);
/// 5. escrita em cópia preservando os bytes originais além do novo stream
///    (padding intocado);
/// 6. dependências verificadas no produto sobre o conjunto analisável
///    (nenhum outro recurso verificado pode mudar de decode);
/// 7. patch BPS exportado pelo pipeline canônico e re-aplicado à base com
///    hash exato da cópia modificada.
pub fn reinsert_transaction(
    request: &ReinsertRequest<'_>,
    limits: &Lz4wLimits,
) -> Result<ReinsertOutcome, CodecError> {
    let rom = request.rom;
    // 1. Identidade da ROM.
    let actual_sha = super::rom_library::sha256_hex(rom);
    if actual_sha != request.expected_rom_sha256 {
        return Err(CodecError::new(
            "rom_identity_mismatch",
            format!(
                "ROM base mudou: esperado {}, atual {actual_sha}",
                request.expected_rom_sha256
            ),
        ));
    }
    // 2. Evidência do recurso contra esta ROM.
    let start = request.resource.candidate.stream_offset;
    let stream = rom
        .get(start..)
        .ok_or_else(|| CodecError::new("invalid_reference", "stream fora da ROM"))?;
    let redecode = lz4w_decode_with_dictionary(stream, Some(&rom[..start]), limits)?;
    if redecode.data != request.resource.decoded
        || redecode.bytes_consumed != request.resource.bytes_consumed
    {
        return Err(CodecError::new(
            "evidence_mismatch",
            "evidência do recurso não corresponde aos bytes desta ROM",
        ));
    }
    // 3. Tamanhos.
    if request.edited_data.len() != request.resource.candidate.expected_len {
        return Err(CodecError::new(
            "overflow",
            format!(
                "dados editados têm {} bytes; esperado {}",
                request.edited_data.len(),
                request.resource.candidate.expected_len
            ),
        ));
    }
    // No-op explícito: nada é escrito, padding preservado.
    if request.edited_data == request.resource.decoded {
        return Ok(ReinsertOutcome::NoOp);
    }
    // Conjunto analisável (para dependências) antes de qualquer escrita.
    let set = verify_lz4w_resource_set(rom, limits)?;
    let edited_index = set
        .resources
        .iter()
        .position(|r| r.candidate == request.resource.candidate)
        .ok_or_else(|| {
            CodecError::new(
                "evidence_mismatch",
                "recurso não pertence ao conjunto verificado desta ROM",
            )
        })?;
    // 4. Re-codificação com o dicionário fixado e limite de espaço.
    let original_stream_len = request.resource.bytes_consumed;
    let new_stream = lz4w_encode_with_dictionary(request.edited_data, Some(&rom[..start]))?;
    if new_stream.len() > original_stream_len {
        return Err(CodecError::new(
            "excessive_output",
            format!(
                "stream re-codificado de {} bytes excede o espaço original de {original_stream_len}; sem expansão no v1",
                new_stream.len()
            ),
        ));
    }
    // 5. Escrita em cópia: só o novo stream; bytes originais além dele
    //    permanecem (padding e possíveis referências de dependentes).
    let mut modified = rom.to_vec();
    modified[start..start + new_stream.len()].copy_from_slice(&new_stream);
    let _end = start + original_stream_len;
    // 6. Dependências verificadas no produto sobre o conjunto analisável.
    let mut verified_preserved = 0usize;
    for (index, other) in set.resources.iter().enumerate() {
        if index == edited_index {
            continue;
        }
        let other_start = other.candidate.stream_offset;
        let decoded = lz4w_decode_with_dictionary(
            &modified[other_start..],
            Some(&modified[..other_start]),
            limits,
        )?;
        if decoded.data != other.decoded {
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
    for tile in 0..num_tiles {
        let row = tile / per_row;
        let col = tile % per_row;
        for y in 0..8 {
            for x in 0..8 {
                let src = (y * 8 + x) * 4;
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

/// Lista os recursos LZ4W verificados de uma ROM (por conteúdo), com o
/// SHA-256 da ROM lida (identidade para a UI).
pub fn list_resources(rom_path: &str) -> Result<(String, Vec<ResourceSummary>), String> {
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    let sha = super::rom_library::sha256_hex(&rom);
    let limits = Lz4wLimits::default();
    let set = verify_lz4w_resource_set(&rom, &limits)
        .map_err(|e| format!("falha ao verificar recursos: {e}"))?;
    let summaries = set
        .resources
        .iter()
        .map(|r| ResourceSummary {
            header_offset: r.candidate.header_offset as u64,
            stream_offset: r.candidate.stream_offset as u64,
            num_tiles: r.candidate.num_tiles as u32,
            data_len: r.candidate.expected_len as u32,
            stream_len: r.bytes_consumed as u32,
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

/// Prévia somente leitura de um recurso verificado (sem transação).
pub fn preview_resource(rom_path: &str, stream_offset: u64) -> Result<ResourceEditResult, String> {
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    let rom_sha = super::rom_library::sha256_hex(&rom);
    let limits = Lz4wLimits::default();
    let set = verify_lz4w_resource_set(&rom, &limits)
        .map_err(|e| format!("falha ao verificar recursos: {e}"))?;
    let resource = set
        .resources
        .iter()
        .find(|r| r.candidate.stream_offset as u64 == stream_offset)
        .ok_or_else(|| format!("recurso {stream_offset:#x} não verificado nesta ROM"))?;
    let (preview_png, pw, ph, pixels_sha) =
        render_resource_png(&resource.decoded).map_err(|e| format!("{}: {}", e.code, e.detail))?;
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
        stream_written: None,
        original_stream_len: resource.bytes_consumed as u32,
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
    let limits = Lz4wLimits::default();
    let set = verify_lz4w_resource_set(&rom, &limits)
        .map_err(|e| format!("falha ao verificar recursos: {e}"))?;
    let resource = set
        .resources
        .iter()
        .find(|r| r.candidate.stream_offset as u64 == stream_offset)
        .ok_or_else(|| format!("recurso {stream_offset:#x} não verificado nesta ROM"))?;
    let mut edited = resource.decoded.clone();
    for edit in edits {
        let tile = edit.tile as usize;
        if tile >= resource.candidate.num_tiles {
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
    let outcome = reinsert_transaction(
        &ReinsertRequest {
            rom: &rom,
            expected_rom_sha256,
            resource,
            edited_data: &edited,
        },
        &limits,
    )
    .map_err(|e| format!("{}: {}", e.code, e.detail))?;
    let (preview_png, pw, ph, pixels_sha) = render_resource_png(if edits.is_empty() {
        &resource.decoded
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
            stream_written: None,
            original_stream_len: resource.bytes_consumed as u32,
            verified_preserved: None,
            analyzed_scope: set.analyzed_scope,
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
            let modified_path = edit_dir.join(format!(
                "rex-lz4w-modified-{}.bin",
                applied.modified_rom_sha256
            ));
            write_file_immutable(
                &modified_path,
                &applied.modified_rom,
                &applied.modified_rom_sha256,
            )?;
            let patch_path =
                edit_dir.join(format!("rex-lz4w-patch-{}.bps", applied.patch_bps_sha256));
            write_file_immutable(&patch_path, &applied.patch_bps, &applied.patch_bps_sha256)?;
            Ok(ResourceEditResult {
                outcome: "applied".into(),
                rom_sha256: rom_sha,
                modified_rom_sha256: Some(applied.modified_rom_sha256),
                modified_rom_path: Some(modified_path.to_string_lossy().into_owned()),
                patch_bps_sha256: Some(applied.patch_bps_sha256),
                patch_bps_path: Some(patch_path.to_string_lossy().into_owned()),
                stream_offset,
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
    use super::*;

    fn hamoopig_rom() -> Option<(Vec<u8>, String)> {
        let path = std::env::var("RDS_HAMOOPIG_ROM").unwrap_or_else(|_| {
            "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin"
                .to_string()
        });
        let rom = std::fs::read(path).ok()?;
        let sha = super::super::rom_library::sha256_hex(&rom);
        Some((rom, sha))
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
        // MODIFICADO: edição mínima, transação completa, patch com hash exato.
        let mut edited = target.decoded.clone();
        edited[0] ^= 0xF0;
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
        eprintln!(
            "BYOR cadeia OK: original={sha} modificado={} patch={} preservados={} escopo={}",
            applied.modified_rom_sha256,
            applied.patch_bps_sha256,
            applied.verified_preserved,
            applied.analyzed_scope
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
        let mut untouched = two.clone();
        assert!(md_write_pixel_index(&mut two, 0, 0, 0, 16).is_err());
        assert_eq!(two, untouched);
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
        assert_eq!(rgba[(0 * 8 + 0) * 4], 0);
        assert_eq!(rgba[(0 * 8 + 1) * 4], 16);
        assert_eq!(rgba[(1 * 8 + 0) * 4], 128);
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
        // Para o alvo 0xc8cc8 (frame 24x24, classe faísca): edição do
        // plano 3 no pixel (0,0) — índice +8, máximo salto de cor — com
        // impressão do índice atual para reprodução pelo formulário.
        let Some(target) = set
            .resources
            .iter()
            .find(|r| r.candidate.stream_offset == 0xc8cc8)
        else {
            panic!("alvo 0xc8cc8 ausente");
        };
        let current_index = (0..4usize)
            .map(|p| {
                let bit = (target.decoded[p] >> (7 - 0)) & 1;
                bit << p
            })
            .sum::<u8>();
        let mut edited = target.decoded.clone();
        edited[3] |= 0x80; // plano 3, pixel 0
        let outcome = reinsert_transaction(
            &ReinsertRequest {
                rom: &rom,
                expected_rom_sha256: &sha,
                resource: target,
                edited_data: &edited,
            },
            &limits,
        );
        match outcome {
            Ok(ReinsertOutcome::Applied(applied)) => eprintln!(
                "APPLIED_HIGH: stream={:#x} indice_atual={current_index} indice_novo={}=indice|8 preservados={} patch={}",
                target.candidate.stream_offset,
                current_index | 8,
                applied.verified_preserved,
                applied.patch_bps_sha256
            ),
            Ok(ReinsertOutcome::NoOp) => eprintln!("NOOP inesperado"),
            Err(error) => eprintln!("RECUSADO: {error}"),
        }
    }
}
