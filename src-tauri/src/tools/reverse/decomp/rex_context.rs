//! Modelo de contexto de recurso gráfico (TileSet + TileMap + paleta) —
//! **somente leitura**.
//!
//! O tronco [`super::rex_resources`] prova um recurso TileSet comprimido e a
//! transação que o edita. Falta o que dá *contexto* a um pixel: o mapa que o
//! referencia, quantas células o referenciam, onde cada uma cai na tela e com
//! que transformações. Sem isso, "editar este pixel" não pode prever impacto.
//!
//! Este módulo não escreve nada. A escrita continua sendo a transação canônica
//! de `rex_resources` (identidade, evidência, espaço, dependentes, roundtrip),
//! e os decodificadores são os mesmos já comprovados contra oráculo externo.
//!
//! Classes de associação, exigidas pelo briefing e registradas no resultado:
//! - `Verificada`: o vínculo existe no artefato como ponteiro que foi seguido e
//!   conferido (struct `Image`/`TiledImage` do SGDK = `{palette, tileset,
//!   tilemap}`);
//! - `Assistida`: vem de fora do artefato (caminho explícito do operador);
//! - `Desconhecida`: nada no ROM sustenta o vínculo — aqui isso **recusa** a
//!   associação, em vez de adivinhar por proximidade de arquivo ou por tamanho.

use super::rex_aplib::{aplib_decode, AplibLimits};
use super::rex_codecs::CodecError;
use super::rex_resources::{
    md_color_word_to_rgb, md_read_pixel_index, scan_tileset_headers, verify_resource_set,
    HeaderCompression, RecursoVerificado, TransactionLimits,
};
use super::rom_library::sha256_hex;

/// Cabeçalho TileMap do SGDK: `{u16 compression; u16 w; u16 h; u32 *data}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilemapCandidate {
    pub header_offset: usize,
    pub compression: HeaderCompression,
    pub w: usize,
    pub h: usize,
    pub stream_offset: usize,
    /// `(w * h) * 2` — cada célula é uma word.
    pub expected_len: usize,
}

/// Varre a ROM por headers TileMap estruturalmente plausíveis.
///
/// Candidatos são HIPÓTESES, como no scan de TileSet: só viram contexto
/// verificável depois que o decode bate com `(w*h)*2` exatamente.
pub fn scan_tilemap_headers(rom: &[u8]) -> Vec<TilemapCandidate> {
    let mut out = Vec::new();
    if rom.len() < 10 {
        return out;
    }
    for header_offset in (0..rom.len() - 10).step_by(2) {
        let Some(compression) = HeaderCompression::from_field(u16_be(rom, header_offset)) else {
            continue;
        };
        let (w, h) = (
            u16_be(rom, header_offset + 2),
            u16_be(rom, header_offset + 4),
        );
        let stream_offset = u32_be(rom, header_offset + 6) as usize;
        let Some(expected_len) = usize::from(w)
            .checked_mul(usize::from(h))
            .and_then(|celulas| celulas.checked_mul(2))
        else {
            continue;
        };
        if w == 0
            || h == 0
            || stream_offset == 0
            || stream_offset >= rom.len()
            || !stream_offset.is_multiple_of(2)
        {
            continue;
        }
        out.push(TilemapCandidate {
            header_offset,
            compression,
            w: usize::from(w),
            h: usize::from(h),
            stream_offset,
            expected_len,
        });
    }
    out
}

fn u16_be(d: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([d[at], d[at + 1]])
}

fn u32_be(d: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([d[at], d[at + 1], d[at + 2], d[at + 3]])
}

/// Mapa verificado: o stream decodifica exatamente para `(w*h)*2` bytes e as
/// células são as words que o VDP consumiria.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedTilemap {
    pub candidate: TilemapCandidate,
    pub cells: Vec<u16>,
    pub bytes_consumed: usize,
}

/// Verifica um candidato de TileMap.
///
/// O gate é o mesmo do tronco de recursos: o decodificador **declarado pelo
/// header** (nunca escolhido por suposição) e o tamanho exato que o próprio
/// header promete. Um mapa que decodifica para outro tamanho não vira contexto,
/// porque as células perderiam o alinhamento com `(coluna, linha)`.
pub fn verificar_tilemap(
    rom: &[u8],
    candidate: &TilemapCandidate,
    limits: &AplibLimits,
) -> Result<VerifiedTilemap, CodecError> {
    if candidate.compression != HeaderCompression::Aplib {
        return Err(CodecError::new(
            "unsupported_codec",
            format!(
                "TileMap em {:#x} declara codec {}; esta frente só decodifica aPLib",
                candidate.header_offset,
                candidate.compression.as_str()
            ),
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
                "o TileMap em {:#x} decodificou para {} bytes, header declara {} (mapa {}x{})",
                candidate.header_offset,
                decoded.data.len(),
                candidate.expected_len,
                candidate.w,
                candidate.h
            ),
        ));
    }
    Ok(VerifiedTilemap {
        candidate: candidate.clone(),
        cells: decoded
            .data
            .chunks_exact(2)
            .map(|par| u16::from_be_bytes([par[0], par[1]]))
            .collect(),
        bytes_consumed: decoded.bytes_consumed,
    })
}

/// Cabeçalho `Palette` do SGDK: `{ u16 length; u16 *data }`.
///
/// Conferido no SDK pinado: `inc/pal.h` declara os dois campos, e
/// `tools/rescomp/src/sgdk/rescomp/resource/Palette.out` emite exatamente
/// `dc.w <número de cores>` + `dc.l <ponteiro>` — 6 bytes, **sem** campo de
/// compressão (o construtor do `Palette` diz "we never compress palette", ou
/// seja, paleta no ROM é sempre literal).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaletteCandidate {
    pub header_offset: usize,
    pub num_colors: usize,
    pub stream_offset: usize,
    /// `num_colors * 2`.
    pub expected_len: usize,
}

/// Varre a ROM por headers `Palette` plausíveis.
///
/// Como a paleta não é comprimida, a única evidência estrutural disponível é o
/// header dizer quantas cores existem e a ROM ter room para elas no ponteiro
/// declarado — é isso que se exige aqui. Nada é decidido por proximidade nem
/// por tamanho: um candidato só entra numa composição quando um ponteiro
/// verificado o alcança (ver [`localizar_cadeias_imagem`]).
pub fn scan_palette_headers(rom: &[u8]) -> Vec<PaletteCandidate> {
    let mut out = Vec::new();
    if rom.len() < 6 {
        return out;
    }
    for header_offset in (0..rom.len() - 6).step_by(2) {
        let num_colors = usize::from(u16_be(rom, header_offset));
        let stream_offset = u32_be(rom, header_offset + 2) as usize;
        let Some(expected_len) = num_colors.checked_mul(2) else {
            continue;
        };
        if num_colors == 0
            || stream_offset == 0
            || !stream_offset.is_multiple_of(2)
            || stream_offset
                .checked_add(expected_len)
                .is_none_or(|fim| fim > rom.len())
        {
            continue;
        }
        out.push(PaletteCandidate {
            header_offset,
            num_colors,
            stream_offset,
            expected_len,
        });
    }
    out
}

/// Paleta lida da ROM: as `num_colors` palavras 68k, na ordem.
///
/// "Lida" aqui é **estrutural**, não codecs: não há decode a conferir, então a
/// confiança vem do ponteiro que a alcançou e, no fim, da prévia composta
/// bater com um esperado independente.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedPalette {
    pub candidate: PaletteCandidate,
    pub words: Vec<u16>,
    pub bytes_consumed: usize,
}

pub fn verificar_palette(
    rom: &[u8],
    candidate: &PaletteCandidate,
) -> Result<VerifiedPalette, CodecError> {
    let dados = rom
        .get(candidate.stream_offset..candidate.stream_offset + candidate.expected_len)
        .ok_or_else(|| {
            CodecError::new(
                "invalid_reference",
                format!(
                    "a paleta em {:#x} declara {} cores mas o stream em {:#x} não cabe na ROM",
                    candidate.header_offset, candidate.num_colors, candidate.stream_offset
                ),
            )
        })?;
    Ok(VerifiedPalette {
        candidate: candidate.clone(),
        words: dados
            .chunks_exact(2)
            .map(|par| u16::from_be_bytes([par[0], par[1]]))
            .collect(),
        bytes_consumed: dados.len(),
    })
}

/// Vínculo entre recursos que **existe no artefato** como ponteiro seguido e
/// conferido: o struct `Image` do SGDK (`inc/vdp_bg.h`) é
/// `{ Palette *palette; TileSet *tileset; TileMap *tilemap }`, ou seja três
/// ponteiros u32 consecutivos nesta ordem.
///
/// Não há `TiledImage` no SDK pinado (0 ocorrências em `inc/`), então esta é a
/// única forma de associação composta verificável aqui.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CadeiaImagem {
    /// Offset da palavra que abre o struct (o ponteiro da paleta).
    pub struct_offset: usize,
    pub palette_header: usize,
    pub tileset_header: usize,
    pub tilemap_header: usize,
}

/// Varre a ROM por structs `Image` cujos três ponteiros batem com headers
/// candidatos já escaneados (endereçamento linear de cartucho: endereço 68k ==
/// offset de arquivo, premissa conferida no fixture contra `symbol.txt`).
///
/// Esta é a **única** fonte de associação aceita neste módulo: o briefing
/// proíbe associar por proximidade no arquivo ou por tamanho, e o próprio
/// fixture mede o contraexemplo — `ctx_ghost_image` foi descartado pelo linker,
/// então não há ponteiro a seguir e a associação do ghost permanece na classe
/// `Desconhecida` (registrada como tal, não adivinhada).
///
/// Aqui só se prova o **vínculo**. Que os recursos vinculados decodifiquem é
/// outra perna: [`verificar_tilemap`] e o tronco `rex_resources` é que dão
/// conteúdo verificado a um header candidato.
pub fn localizar_cadeias_imagem(
    rom: &[u8],
    paletas: &[usize],
    tilesets: &[usize],
    tilemaps: &[usize],
) -> Vec<CadeiaImagem> {
    let mut out = Vec::new();
    if rom.len() < 12 {
        return out;
    }
    // Conjunto, não lista linear: uma ROM de 384 KB tem ~196 mil janelas e
    // milhares de candidatos de paleta. Com `Vec::contains` dentro do laço a
    // varredura custou 40 s na fixture (medido); com hash custa milissegundos,
    // pela mesma definição.
    let paletas = std::collections::HashSet::<usize>::from_iter(paletas.iter().copied());
    let tilesets = std::collections::HashSet::<usize>::from_iter(tilesets.iter().copied());
    let tilemaps = std::collections::HashSet::<usize>::from_iter(tilemaps.iter().copied());
    for struct_offset in (0..=rom.len() - 12).step_by(2) {
        let palette_header = u32_be(rom, struct_offset) as usize;
        let tileset_header = u32_be(rom, struct_offset + 4) as usize;
        let tilemap_header = u32_be(rom, struct_offset + 8) as usize;
        if paletas.contains(&palette_header)
            && tilesets.contains(&tileset_header)
            && tilemaps.contains(&tilemap_header)
        {
            out.push(CadeiaImagem {
                struct_offset,
                palette_header,
                tileset_header,
                tilemap_header,
            });
        }
    }
    out
}

/// Uma célula do mapa: o que o VDP efetivamente desenha naquela posição.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Celula {
    pub col: usize,
    pub row: usize,
    /// Índice de tile (bits 0..=10 do word).
    pub tile: usize,
    pub hflip: bool,
    pub vflip: bool,
    /// Banco de paleta (bits 13..=14): 0..=3.
    pub bank: u8,
    /// Bit 15: prioridade sobre a camada de sprites.
    pub priority: bool,
    /// Palavra crua, para o teste poder conferir a origem.
    pub word: u16,
}

/// Lado de um tile do VDP em pixels.
pub const TILE_PX: usize = 8;

/// Ponto em pixels da camada composta (origem no canto superior-esquerdo do
/// plano, como o VDP conta).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PontoDaCamada {
    pub x: usize,
    pub y: usize,
}

/// Ponto na FONTE: o pixel de um tile do tileset, antes de qualquer
/// transformação da célula que o desenha. É o que a transação canônica edita.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelDaFonte {
    pub tile: usize,
    pub row: usize,
    pub col: usize,
}

/// Todas as células de um mapa verificado, já posicionadas.
pub fn celulas_do_mapa(mapa: &VerifiedTilemap) -> Result<Vec<Celula>, CodecError> {
    let largura = mapa.candidate.w;
    mapa.cells
        .iter()
        .enumerate()
        .map(|(indice, word)| decodificar_celula(*word, indice, largura))
        .collect()
}

/// Toda célula que referencia `tile` neste mapa **verificado**.
///
/// É a resposta a "esta edição afeta N ocorrências": N sai daqui, do mapa que
/// foi decodificado e conferido byte a byte — nunca de uma contagem sobre a ROM
/// inteira, nem de proximidade, nem de tamanho. Tiles que nenhuma célula usa
/// dão lista vazia (não é erro).
pub fn ocorrencias_do_tile(mapa: &VerifiedTilemap, tile: usize) -> Result<Vec<Celula>, CodecError> {
    Ok(celulas_do_mapa(mapa)?
        .into_iter()
        .filter(|c| c.tile == tile)
        .collect())
}

/// A célula que um clique em `(x, y)` da camada composta atinge.
///
/// Ordem de linhas primeiro, como o `VDP_setTileMapData`/`unpackTileMap` do
/// SGDK: célula linear `(y/8)*w + x/8`.
pub fn celula_em(mapa: &VerifiedTilemap, x: usize, y: usize) -> Result<Celula, CodecError> {
    let (w, h) = (mapa.candidate.w, mapa.candidate.h);
    let (largura_px, altura_px) = (w * TILE_PX, h * TILE_PX);
    if x >= largura_px || y >= altura_px {
        return Err(CodecError::new(
            "invalid_reference",
            format!(
                "clique ({x},{y}) está fora do TileMap em {:#x}: {}x{} pixels ({}x{} células)",
                mapa.candidate.header_offset, largura_px, altura_px, w, h
            ),
        ));
    }
    let indice = (y / TILE_PX) * w + x / TILE_PX;
    // `verificar_tilemap` só produz um mapa com w*h palavras: o bounds acima
    // garante índice válido.
    let word = mapa.cells[indice];
    decodificar_celula(word, indice, w)
}

/// Interpreta uma palavra de célula do mapa na posição linear `indice`, com o
/// mapa tendo `largura` células por linha.
///
/// Os bits são os do `TILE_ATTR_FULL` do SGDK, conferidos no SDK pinado
/// (`inc/vdp_drv.h` e `tools/rescomp/.../type/Tile.java`): índice em 0..=10,
/// hflip no 11, vflip no 12, banco de paleta em 13..=14, prioridade no 15.
pub fn decodificar_celula(word: u16, indice: usize, largura: usize) -> Result<Celula, CodecError> {
    if largura == 0 {
        return Err(CodecError::new(
            "invalid_reference",
            "mapa de largura 0 não posiciona célula nenhuma",
        ));
    }
    Ok(Celula {
        col: indice % largura,
        row: indice / largura,
        tile: usize::from(word & 0x07FF),
        hflip: word & (1 << 11) != 0,
        vflip: word & (1 << 12) != 0,
        bank: ((word >> 13) & 0x3) as u8,
        priority: word & (1 << 15) != 0,
        word,
    })
}

impl Celula {
    /// Onde o pixel `(linha, coluna)` da FONTE aparece na camada composta.
    ///
    /// O flip é da célula, não do tile: com hflip a coluna inverte, com vflip a
    /// linha inverte. É a direção da **previsão de impacto** — a edição é feita
    /// na fonte, o efeito se vê aqui.
    pub fn projetar_pixel_da_fonte(
        &self,
        linha: usize,
        coluna: usize,
    ) -> Result<PontoDaCamada, CodecError> {
        if linha >= TILE_PX || coluna >= TILE_PX {
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "pixel (linha {linha}, coluna {coluna}) fora do tile de {TILE_PX}x{TILE_PX}"
                ),
            ));
        }
        Ok(PontoDaCamada {
            x: self.col * TILE_PX
                + if self.hflip {
                    TILE_PX - 1 - coluna
                } else {
                    coluna
                },
            y: self.row * TILE_PX
                + if self.vflip {
                    TILE_PX - 1 - linha
                } else {
                    linha
                },
        })
    }

    /// Qual pixel da FONTE um ponto da camada composta atinge nesta célula.
    ///
    /// Direção do **clique**: é o inverso exato de
    /// [`Celula::projetar_pixel_da_fonte`], inclusive para célula flipada — o
    /// que permite editar o tile de origem a partir de um toque na imagem.
    pub fn fonte_do_ponto(&self, ponto: PontoDaCamada) -> Result<PixelDaFonte, CodecError> {
        let (x0, y0) = (self.col * TILE_PX, self.row * TILE_PX);
        if ponto.x < x0 || ponto.x >= x0 + TILE_PX || ponto.y < y0 || ponto.y >= y0 + TILE_PX {
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "ponto ({},{}) não cai na célula (col {}, linha {}) — bloco {}..{}, {}..{}",
                    ponto.x,
                    ponto.y,
                    self.col,
                    self.row,
                    x0,
                    x0 + TILE_PX,
                    y0,
                    y0 + TILE_PX
                ),
            ));
        }
        let dx = ponto.x - x0;
        let dy = ponto.y - y0;
        Ok(PixelDaFonte {
            tile: self.tile,
            row: if self.vflip { TILE_PX - 1 - dy } else { dy },
            col: if self.hflip { TILE_PX - 1 - dx } else { dx },
        })
    }
}

/// Resultado da composição de **uma** camada de background.
///
/// Não é um screenshot do jogo: é a reconstrução do que aquele TileMap desenha
/// com aquele TileSet e aquela Paleta. Não há segunda camada, sprites, scroll,
/// janela nem oclusão por prioridade aqui (o bit 15 só decide BG vs sprites),
/// e uma célula cujo índice cai na faixa de tiles de sistema do VDP (0..31 em
/// NAME_BASE, quando o mapa não usa `TILE_USER_INDEX`) é numericamente válida
/// mas não vem do TileSet — ver as limitações declaradas no README do fixture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CamadaComposta {
    pub width: usize,
    pub height: usize,
    /// RGBA linha a linha. Índice de paleta 0 entra **transparente** (alfa 0),
    /// porque é o índice de transparência do plano — não a cor `pal[banco][0]`.
    pub rgba: Vec<u8>,
}

/// Compõe a camada a partir de recursos **verificados**.
///
/// Nada aqui escolhe recurso por proximidade ou tamanho: quem chama é o tronco
/// que seguiu os ponteiros da `Image` (ver [`localizar_cadeias_imagem`]) e já
/// decodificou cada peça. A ordem de composição é a do VDP: célula por célula,
/// aplicando o flip da célula sobre a fonte e o banco da célula sobre a paleta.
///
/// Recusa **antes** de desenhar qualquer pixel: referência de tile fora do
/// TileSet ou banco fora da paleta devolvem `invalid_reference` com a célula
/// ofensora, em vez de produzir uma imagem silenciosamente errada.
pub fn compor_camada(
    tiles: &[u8],
    mapa: &VerifiedTilemap,
    paleta: &VerifiedPalette,
) -> Result<CamadaComposta, CodecError> {
    if tiles.is_empty() || !tiles.len().is_multiple_of(32) {
        return Err(CodecError::new(
            "invalid_reference",
            format!(
                "o TileSet tem {} bytes, que não é múltiplo de 32 (tiles MD 4bpp)",
                tiles.len()
            ),
        ));
    }
    let num_tiles = tiles.len() / 32;
    let celulas = celulas_do_mapa(mapa)?;

    for c in &celulas {
        if c.tile >= num_tiles {
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "a célula em (col {}, linha {}) referencia o tile {} mas o TileSet verificado tem {} tiles",
                    c.col, c.row, c.tile, num_tiles
                ),
            ));
        }
        if (usize::from(c.bank) + 1) * 16 > paleta.words.len() {
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "a célula em (col {}, linha {}) usa o banco {} mas a paleta verificada tem {} cores ({} banco(s))",
                    c.col,
                    c.row,
                    c.bank,
                    paleta.words.len(),
                    paleta.words.len() / 16
                ),
            ));
        }
    }

    let (width, height) = (mapa.candidate.w * TILE_PX, mapa.candidate.h * TILE_PX);
    let mut rgba = vec![0u8; width * height * 4];
    for c in &celulas {
        for linha in 0..TILE_PX {
            for coluna in 0..TILE_PX {
                // Os limites já foram conferidos nas duas pontas: `c.tile`
                // dentro do TileSet e a posição dentro do tile 8x8.
                let indice = usize::from(md_read_pixel_index(tiles, c.tile, linha, coluna)?);
                let p = c.projetar_pixel_da_fonte(linha, coluna)?;
                let alvo = (p.y * width + p.x) * 4;
                let pixel = if indice == 0 {
                    [0, 0, 0, 0]
                } else {
                    let [r, g, b] =
                        md_color_word_to_rgb(paleta.words[usize::from(c.bank) * 16 + indice]);
                    [r, g, b, 255]
                };
                rgba[alvo..alvo + 4].copy_from_slice(&pixel);
            }
        }
    }
    Ok(CamadaComposta {
        width,
        height,
        rgba,
    })
}

// ======================= publicação para o IPC (somente leitura) =============
//
// Tipos daqui são o contrato do comando `rex_resource_context`. Eles não sabem
// nada de interface: só publicam o que as funções acima já conferiram, com a
// identidade de cada recurso (offset + codec lido do header + SHA-256 do
// conteúdo decodificado) para que nenhuma etapa posterior precise pressupor o
// que viu.

/// De onde veio um vínculo — as três classes que o briefing exige que sejam
/// rotuladas no contexto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Proveniencia {
    /// O ponteiro existe no artefato, foi seguido, e o recurso alcançado
    /// decodifica para o tamanho que o próprio header declara.
    Verificada,
    /// Vínculo declarado de fora do artefato (caminho do operador). O núcleo
    /// **nunca autodeclara** esta classe: ela existe para a UI poder rotular uma
    /// hipótese do usuário sem confundí-la com evidência — e uma edição assim
    /// continua passando pela transação, que revalida a identidade da ROM.
    Assistida,
    /// Nada no ROM sustenta o vínculo. Aqui isso **recusa** a associação em vez
    /// de adivinhar por proximidade de arquivo ou por tamanho.
    Desconhecida,
}

/// Orçamento de trabalho de uma montagem de contexto: o teto do que o núcleo
/// aceita calcular por pedido, em vez de estourar memória ou travar a UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct LimiteTrabalho {
    /// Camadas maiores que isto continuam com células, ocorrências e identidade
    /// publicados; só a prévia é recusada, com o motivo no lugar.
    pub max_pixels_por_camada: usize,
}

impl Default for LimiteTrabalho {
    fn default() -> Self {
        // 2048x2048 pixels = 16 MiB de RGBA por camada. Um TileMap 4096x1024
        // células do VDP não cabe aqui, e o contexto dele ainda é útil.
        Self {
            max_pixels_por_camada: 2048 * 2048,
        }
    }
}

/// Identidade verificada de um recurso: onde está, como foi lido e qual é o
/// conteúdo. `stream_len` é o consumo **medido** no decode, não o que o header
/// declara; `plain_sha256` é o que a transação de escrita vai reencontrar.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct IdentidadeRecurso {
    pub header_offset: u64,
    pub stream_offset: u64,
    pub codec: String,
    pub plain_len: u64,
    pub stream_len: u64,
    pub plain_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CelulaPublicada {
    /// Índice linear na ordem do VDP (linha primeiro).
    pub indice: u32,
    pub col: u32,
    pub row: u32,
    pub tile: u32,
    pub hflip: bool,
    pub vflip: bool,
    pub banco: u8,
    pub prioridade: bool,
}

/// Todas as células deste mapa que usam um mesmo tile.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct OcorrenciasTile {
    pub tile: u32,
    /// Índices lineares, na ordem do mapa.
    pub celulas: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MapaPublicado {
    pub cols: u32,
    pub rows: u32,
    pub largura_px: u32,
    pub altura_px: u32,
    pub celulas: Vec<CelulaPublicada>,
    pub ocorrencias_por_tile: Vec<OcorrenciasTile>,
    /// Tiles do TileSet que nenhuma célula deste mapa usa.
    pub tiles_sem_uso: Vec<u32>,
    /// Até onde a contagem vale: sempre um mapa específico, nunca a ROM.
    pub escopo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CamadaPublicada {
    pub largura_px: u32,
    pub altura_px: u32,
    pub pixels_sha256: Option<String>,
    pub png_data_url: Option<String>,
    /// Por que a prévia não está aqui, quando não está.
    pub recusada: Option<String>,
}

/// Uma imagem composta por vínculo verificado.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ContextoImagem {
    pub struct_offset: u64,
    pub proveniencia: Proveniencia,
    /// O que foi conferido, em frases legíveis. Uma classe `Verificada` sem
    /// esta lista seria um rótulo vazio.
    pub conferido: Vec<String>,
    /// O que a verificação acima **não** prova.
    pub nao_prova: Vec<String>,
    pub paleta: IdentidadeRecurso,
    pub tileset: IdentidadeRecurso,
    pub tilemap: IdentidadeRecurso,
    pub mapa: MapaPublicado,
    pub camada: CamadaPublicada,
}

/// Recurso verificado que nenhum ponteiro alcança: identidade conferida,
/// associação não.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RecursoSemVinculo {
    pub tipo: &'static str,
    pub proveniencia: Proveniencia,
    pub motivo: String,
    pub identidade: IdentidadeRecurso,
}

/// Trinca que parece um struct `Image`, mas whose algum alvo não verifica.
/// Registrada em vez de sumir: prévia vazia sem explicação é o pior estado
/// possível para quem edita.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct VinculoRecusado {
    pub struct_offset: u64,
    pub proveniencia: Proveniencia,
    pub codigo: String,
    pub motivo: String,
}

/// Resposta do comando de contexto.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ContextoRom {
    pub rom_sha256: String,
    pub rom_len: u64,
    /// Escopo da varredura de recursos, como o tronco o mede.
    pub escopo: String,
    pub limite_trabalho: LimiteTrabalho,
    pub imagens: Vec<ContextoImagem>,
    pub sem_vinculo: Vec<RecursoSemVinculo>,
    pub recusados: Vec<VinculoRecusado>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PixelDaFontePublicado {
    pub tile: u32,
    pub linha: u32,
    pub coluna: u32,
    /// Índice de paleta 0..=15 lido do tile decodificado.
    pub indice: u8,
}

/// Clique resolvido pelo núcleo: a UI converte o ponteiro em coordenada da
/// imagem e não decide geometria nenhuma.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ResolucaoClique {
    pub rom_sha256: String,
    pub struct_offset: u64,
    pub x: u32,
    pub y: u32,
    pub celula: CelulaPublicada,
    pub fonte: PixelDaFontePublicado,
    /// Irmãs da mesma célula no **deste** mapa verificado.
    pub ocorrencias: Vec<CelulaPublicada>,
}

fn plain_das_words(words: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(words.len() * 2);
    for w in words {
        out.extend_from_slice(&w.to_be_bytes());
    }
    out
}

fn identidade_tileset(recurso: &RecursoVerificado) -> IdentidadeRecurso {
    let candidata = recurso.candidate();
    IdentidadeRecurso {
        header_offset: candidata.header_offset as u64,
        stream_offset: candidata.stream_offset as u64,
        codec: candidata.compression.as_str().to_string(),
        plain_len: recurso.decoded().len() as u64,
        stream_len: recurso.bytes_consumed() as u64,
        plain_sha256: sha256_hex(recurso.decoded()),
    }
}

fn identidade_tilemap(mapa: &VerifiedTilemap) -> IdentidadeRecurso {
    let plain = plain_das_words(&mapa.cells);
    IdentidadeRecurso {
        header_offset: mapa.candidate.header_offset as u64,
        stream_offset: mapa.candidate.stream_offset as u64,
        codec: mapa.candidate.compression.as_str().to_string(),
        plain_len: plain.len() as u64,
        stream_len: mapa.bytes_consumed as u64,
        plain_sha256: sha256_hex(&plain),
    }
}

fn identidade_palette(paleta: &VerifiedPalette) -> IdentidadeRecurso {
    IdentidadeRecurso {
        header_offset: paleta.candidate.header_offset as u64,
        stream_offset: paleta.candidate.stream_offset as u64,
        // O header `Palette` do rescomp não tem campo de compressão: os bytes do
        // ROM são os literais das palavras 68k.
        codec: HeaderCompression::None.as_str().to_string(),
        plain_len: paleta.bytes_consumed as u64,
        stream_len: paleta.bytes_consumed as u64,
        plain_sha256: sha256_hex(&plain_das_words(&paleta.words)),
    }
}

fn celula_publicada(indice: usize, celula: &Celula) -> CelulaPublicada {
    CelulaPublicada {
        indice: indice as u32,
        col: celula.col as u32,
        row: celula.row as u32,
        tile: celula.tile as u32,
        hflip: celula.hflip,
        vflip: celula.vflip,
        banco: celula.bank,
        prioridade: celula.priority,
    }
}

/// O que um vínculo `Verificado` não prova — sempre publicado junto, para a
/// afirmação viajar com a sua fronteira.
fn nao_prova_do_vinculo() -> Vec<String> {
    vec![
        "Verificado prova que os bytes existem e se associam assim no ROM. Não \
         prova que o jogo carregue ou exiba este recurso, nem em que tela."
            .to_string(),
        "Nada aqui foi observado no VDP: símbolo do linker, carregamento em \
         runtime e uso real do ponteiro continuam fora desta prova."
            .to_string(),
        "A prévia é a camada reconstruída, não o framebuffer completo: oclusão \
         por sprites, janela e o bit de prioridade (BG contra sprites) não são \
         modelados, e um índice de tile na faixa de sistema do VDP pode ser \
         numericamente válido sem vir deste TileSet."
            .to_string(),
    ]
}

fn png_da_camada(camada: &CamadaComposta) -> Result<Vec<u8>, CodecError> {
    let image = image::RgbaImage::from_raw(
        camada.width as u32,
        camada.height as u32,
        camada.rgba.clone(),
    )
    .ok_or_else(|| {
        CodecError::new(
            "overflow",
            format!(
                "camada {}x{} não coube no codificador PNG",
                camada.width, camada.height
            ),
        )
    })?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| {
            CodecError::new(
                "invalid_reference",
                format!("falha ao codificar a prévia PNG: {e}"),
            )
        })?;
    Ok(png)
}

/// Tudo que o produto descobre sozinho numa ROM, numa passada.
struct Descoberta {
    recursos: Vec<RecursoVerificado>,
    /// Escopo medido pelo tronco de recursos.
    escopo: String,
    paletas: Vec<PaletteCandidate>,
    mapas: Vec<VerifiedTilemap>,
    cadeias: Vec<CadeiaImagem>,
}

fn descobrir(rom: &[u8], transacao: &TransactionLimits) -> Result<Descoberta, CodecError> {
    let set = verify_resource_set(rom, transacao)?;
    let mapas = scan_tilemap_headers(rom)
        .iter()
        .filter_map(|c| verificar_tilemap(rom, c, &transacao.aplib_decode).ok())
        .collect::<Vec<_>>();
    let paletas = scan_palette_headers(rom);
    let cadeias = localizar_cadeias_imagem(
        rom,
        &paletas.iter().map(|c| c.header_offset).collect::<Vec<_>>(),
        &scan_tileset_headers(rom)
            .iter()
            .map(|c| c.header_offset)
            .collect::<Vec<_>>(),
        &mapas
            .iter()
            .map(|m| m.candidate.header_offset)
            .collect::<Vec<_>>(),
    );
    Ok(Descoberta {
        recursos: set.resources,
        escopo: set.analyzed_scope,
        paletas,
        mapas,
        cadeias,
    })
}

impl Descoberta {
    /// A cadeia verificada num offset de struct, ou a recusa estruturada.
    fn cadeia(&self, struct_offset: usize) -> Result<&CadeiaImagem, CodecError> {
        self.cadeias
            .iter()
            .find(|c| c.struct_offset == struct_offset)
            .ok_or_else(|| {
                CodecError::new(
                    "invalid_reference",
                    format!(
                        "{:#x} não é um vínculo verificado nesta ROM: os três ponteiros não \
                         alcançam, na ordem do struct `Image`, uma paleta, um TileSet e um \
                         TileMap que decodifiquem",
                        struct_offset
                    ),
                )
            })
    }
}

/// Contexto de uma única cadeia `Image`, resolvido a partir dos bytes.
fn contexto_da_cadeia(
    rom: &[u8],
    cadeia: &CadeiaImagem,
    descoberta: &Descoberta,
    trabalho: &LimiteTrabalho,
) -> Result<ContextoImagem, CodecError> {
    let recurso = descoberta
        .recursos
        .iter()
        .find(|r| r.candidate().header_offset == cadeia.tileset_header)
        .ok_or_else(|| {
            CodecError::new(
                "invalid_reference",
                format!(
                    "o TileSet em {:#x} apontado por {:#x} não verifica nesta ROM: codec sem \
                     decoder nesta frente, tamanho declarado divergente ou stream sobreposto",
                    cadeia.tileset_header, cadeia.struct_offset
                ),
            )
        })?;
    let mapa = descoberta
        .mapas
        .iter()
        .find(|m| m.candidate.header_offset == cadeia.tilemap_header)
        .ok_or_else(|| {
            CodecError::new(
                "invalid_reference",
                format!(
                    "o TileMap em {:#x} apontado por {:#x} não decodifica para o tamanho que o \
                     próprio header declara",
                    cadeia.tilemap_header, cadeia.struct_offset
                ),
            )
        })?;
    let candidata = descoberta
        .paletas
        .iter()
        .find(|c| c.header_offset == cadeia.palette_header)
        .ok_or_else(|| {
            CodecError::new(
                "invalid_reference",
                format!(
                    "a paleta em {:#x} apontada por {:#x} declara um stream que não cabe na ROM",
                    cadeia.palette_header, cadeia.struct_offset
                ),
            )
        })?;
    let paleta = verificar_palette(rom, candidata)?;

    let celulas = celulas_do_mapa(mapa)?;
    let publicados: Vec<CelulaPublicada> = celulas
        .iter()
        .enumerate()
        .map(|(i, c)| celula_publicada(i, c))
        .collect();

    let mut por_tile: std::collections::BTreeMap<usize, Vec<u32>> =
        std::collections::BTreeMap::new();
    for (i, c) in celulas.iter().enumerate() {
        por_tile.entry(c.tile).or_default().push(i as u32);
    }
    let ocorrencias_por_tile = por_tile
        .iter()
        .map(|(tile, idx)| OcorrenciasTile {
            tile: *tile as u32,
            celulas: idx.clone(),
        })
        .collect();
    let num_tiles = recurso.decoded().len() / 32;
    let tiles_sem_uso = (0..num_tiles)
        .filter(|t| !por_tile.contains_key(t))
        .map(|t| t as u32)
        .collect();

    let (largura_px, altura_px) = (mapa.candidate.w * TILE_PX, mapa.candidate.h * TILE_PX);
    let pixels = largura_px.checked_mul(altura_px).ok_or_else(|| {
        CodecError::new(
            "overflow",
            format!(
                "o TileMap em {:#x} tem dimensões que não cabem em usize",
                mapa.candidate.header_offset
            ),
        )
    })?;
    let camada = if pixels > trabalho.max_pixels_por_camada {
        CamadaPublicada {
            largura_px: largura_px as u32,
            altura_px: altura_px as u32,
            pixels_sha256: None,
            png_data_url: None,
            recusada: Some(format!(
                "prévia da camada recusada: {largura_px}x{altura_px} = {pixels} pixels passam o \
                 orçamento de trabalho de {} pixels por camada. Células, ocorrências e \
                 identidade continuam publicados.",
                trabalho.max_pixels_por_camada
            )),
        }
    } else {
        let composta = compor_camada(recurso.decoded(), mapa, &paleta)?;
        let png = png_da_camada(&composta)?;
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        CamadaPublicada {
            largura_px: composta.width as u32,
            altura_px: composta.height as u32,
            pixels_sha256: Some(sha256_hex(&composta.rgba)),
            png_data_url: Some(format!("data:image/png;base64,{}", BASE64.encode(&png))),
            recusada: None,
        }
    };

    let conferido = vec![
        format!(
            "Struct `Image` em {:#x}: os três ponteiros — paleta {:#x}, tileset {:#x}, tilemap \
             {:#x}, nesta ordem — foram seguidos até headers candidatos. Nada foi associado por \
             proximidade de arquivo nem por tamanho.",
            cadeia.struct_offset,
            cadeia.palette_header,
            cadeia.tileset_header,
            cadeia.tilemap_header
        ),
        format!(
            "TileSet em {:#x} decodifica com o codec lido do header ({}) para exatamente {} \
             bytes = {} tiles de 32 bytes.",
            cadeia.tileset_header,
            recurso.candidate().compression.as_str(),
            recurso.decoded().len(),
            num_tiles
        ),
        format!(
            "TileMap em {:#x} decodifica ({}) para exatamente {} bytes = {}x{} células \
             ({}x{} pixels), na ordem do VDP.",
            cadeia.tilemap_header,
            mapa.candidate.compression.as_str(),
            mapa.cells.len() * 2,
            mapa.candidate.w,
            mapa.candidate.h,
            largura_px,
            altura_px
        ),
        format!(
            "Palette em {:#x} tem {} bytes literais na ROM = {} cores ({} banco(s)); o rescomp \
             não comprime paleta.",
            cadeia.palette_header,
            paleta.bytes_consumed,
            paleta.words.len(),
            paleta.words.len() / 16
        ),
    ];

    Ok(ContextoImagem {
        struct_offset: cadeia.struct_offset as u64,
        proveniencia: Proveniencia::Verificada,
        conferido,
        nao_prova: nao_prova_do_vinculo(),
        paleta: identidade_palette(&paleta),
        tileset: identidade_tileset(recurso),
        tilemap: identidade_tilemap(mapa),
        mapa: MapaPublicado {
            cols: mapa.candidate.w as u32,
            rows: mapa.candidate.h as u32,
            largura_px: largura_px as u32,
            altura_px: altura_px as u32,
            celulas: publicados,
            ocorrencias_por_tile,
            tiles_sem_uso,
            escopo: format!(
                "ocorrências contadas só dentro deste mapa verificado (TileMap em {:#x}, {} \
                 células); outros mapas da ROM não entram nesta contagem",
                cadeia.tilemap_header,
                celulas.len()
            ),
        },
        camada,
    })
}

/// Monta o contexto de uma ROM a partir dos bytes dela.
///
/// Autoridade é só o ROM: nada aqui recebe offset, dimensão ou coordenada de
/// quem chama como pressuposto — o que vem de fora é orçamento de trabalho e o
/// conjunto de limites da transação.
pub fn contexto_da_rom(
    rom: &[u8],
    transacao: &TransactionLimits,
    trabalho: &LimiteTrabalho,
) -> Result<ContextoRom, CodecError> {
    let descoberta = descobrir(rom, transacao)?;
    let mut imagens = Vec::new();
    let mut recusados = Vec::new();
    for cadeia in &descoberta.cadeias {
        match contexto_da_cadeia(rom, cadeia, &descoberta, trabalho) {
            Ok(contexto) => imagens.push(contexto),
            Err(erro) => recusados.push(VinculoRecusado {
                struct_offset: cadeia.struct_offset as u64,
                proveniencia: Proveniencia::Desconhecida,
                codigo: erro.code.to_string(),
                motivo: format!(
                    "vínculo em {:#x} recusado: {}",
                    cadeia.struct_offset, erro.detail
                ),
            }),
        }
    }

    let vinculados = imagens
        .iter()
        .flat_map(|i| {
            [
                i.paleta.header_offset as usize,
                i.tileset.header_offset as usize,
                i.tilemap.header_offset as usize,
            ]
        })
        .collect::<Vec<_>>();
    let motivo = "verificado por decode, mas nenhum ponteiro de struct `Image` alcança este \
                  header nesta ROM"
        .to_string();
    let mut sem_vinculo = Vec::new();
    for recurso in &descoberta.recursos {
        if !vinculados.contains(&recurso.candidate().header_offset) {
            sem_vinculo.push(RecursoSemVinculo {
                tipo: "tileset",
                proveniencia: Proveniencia::Desconhecida,
                motivo: motivo.clone(),
                identidade: identidade_tileset(recurso),
            });
        }
    }
    for mapa in &descoberta.mapas {
        if !vinculados.contains(&mapa.candidate.header_offset) {
            sem_vinculo.push(RecursoSemVinculo {
                tipo: "tilemap",
                proveniencia: Proveniencia::Desconhecida,
                motivo: motivo.clone(),
                identidade: identidade_tilemap(mapa),
            });
        }
    }
    // Paletas candidatas ficam de fora de `sem_vinculo` de propósito: sem campo
    // de compressão, a única verificação possível nelas é "cabe na ROM", que é
    // já o critério do próprio scan — publicá-las diria "verificado" sem nada
    // além disso.

    Ok(ContextoRom {
        rom_sha256: sha256_hex(rom),
        rom_len: rom.len() as u64,
        escopo: descoberta.escopo.clone(),
        limite_trabalho: *trabalho,
        imagens,
        sem_vinculo,
        recusados,
    })
}

/// Resolve um clique na camada composta. Núcleo decide célula, flips e pixel da
/// fonte; quem chama só entrega a coordenada da imagem.
pub fn contexto_clique(
    rom: &[u8],
    struct_offset: u64,
    x: usize,
    y: usize,
    transacao: &TransactionLimits,
) -> Result<ResolucaoClique, CodecError> {
    let descoberta = descobrir(rom, transacao)?;
    let struct_offset_usize = usize::try_from(struct_offset).map_err(|_| {
        CodecError::new(
            "invalid_reference",
            format!("offset de struct {struct_offset} não cabe nesta ROM"),
        )
    })?;
    let cadeia = descoberta.cadeia(struct_offset_usize)?;
    let recurso = descoberta
        .recursos
        .iter()
        .find(|r| r.candidate().header_offset == cadeia.tileset_header)
        .ok_or_else(|| {
            CodecError::new(
                "invalid_reference",
                format!(
                    "vínculo em {:#x} não tem TileSet verificado: nada a resolver",
                    cadeia.struct_offset
                ),
            )
        })?;
    let mapa = descoberta
        .mapas
        .iter()
        .find(|m| m.candidate.header_offset == cadeia.tilemap_header)
        .expect("`cadeia` só devolve mapa verificado");
    let celula = celula_em(mapa, x, y)?;
    let fonte = celula.fonte_do_ponto(PontoDaCamada { x, y })?;
    let indice = md_read_pixel_index(recurso.decoded(), fonte.tile, fonte.row, fonte.col)?;
    let ocorrencias = ocorrencias_do_tile(mapa, celula.tile)?
        .iter()
        // O índice linear vem do próprio mapa: `ocorrencias_do_tile` preserva
        // a ordem das células.
        .map(|c| {
            let indice_linear = c.row * mapa.candidate.w + c.col;
            celula_publicada(indice_linear, c)
        })
        .collect();
    let indice_linear = celula.row * mapa.candidate.w + celula.col;
    Ok(ResolucaoClique {
        rom_sha256: sha256_hex(rom),
        struct_offset,
        x: x as u32,
        y: y as u32,
        celula: celula_publicada(indice_linear, &celula),
        fonte: PixelDaFontePublicado {
            tile: fonte.tile as u32,
            linha: fonte.row as u32,
            coluna: fonte.col as u32,
            indice,
        },
        ocorrencias,
    })
}

/// Contexto pelo caminho do arquivo. A identidade vem sempre da releitura dos
/// bytes, nunca de uma prévia em cache.
pub fn contexto_da_rom_path(rom_path: &str) -> Result<ContextoRom, String> {
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    contexto_da_rom(
        &rom,
        &TransactionLimits::default(),
        &LimiteTrabalho::default(),
    )
    .map_err(|e| format!("{}: {}", e.code, e.detail))
}

/// Clique resolvido pelo caminho do arquivo — a fronteira onde um `u64` vindo
/// do wire vira coordenada, e onde ele é validado em vez de truncado.
pub fn contexto_clique_path(
    rom_path: &str,
    struct_offset: u64,
    x: u64,
    y: u64,
) -> Result<ResolucaoClique, String> {
    let (Ok(x), Ok(y)) = (usize::try_from(x), usize::try_from(y)) else {
        return Err(format!(
            "invalid_reference: clique ({x},{y}) não é coordenada de camada"
        ));
    };
    let rom = std::fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    contexto_clique(&rom, struct_offset, x, y, &TransactionLimits::default())
        .map_err(|e| format!("{}: {}", e.code, e.detail))
}

#[cfg(test)]
mod tests {
    use super::super::rex_aplib::{aplib_encode, AplibEncodeLimits};
    use super::super::rex_resources::{
        apply_resource_edit, scan_tileset_headers, verify_resource_set, PixelEdit,
        RecursoVerificado, TransactionLimits,
    };
    use super::*;

    const HEADER: usize = 0x40;
    const STREAM: usize = 0x200;
    /// Tiles do tileset nas ROMs sintéticas deste módulo de teste.
    const NUM_TILES: usize = 16;

    // Geometria da ROM com cadeia `Image` (sem sobreposição): tileset 16 tiles
    // ocupa 0x800..=0xA00 e o stream do mapa começa logo depois.
    const TS_HDR: usize = 0x100;
    const TM_HDR: usize = 0x140;
    const PAL_HDR: usize = 0x180;
    const IMG: usize = 0x1C0;
    const TS_STREAM: usize = 0x800;
    const TM_STREAM: usize = 0xA00;
    const PAL_STREAM: usize = 0xC00;

    /// Seis células de um mapa 3x2, em ordem linear (linha primeiro). Cobre
    /// todos os atributos que a composição tem que respeitar, inclusive em
    /// combinação: tile 2 aparece duas vezes sob transformações diferentes, o
    /// índice 0 aparece com flip e prioridade (transparente, mas não ausente),
    /// e os quatro bancos de paleta estão representados.
    const CELULAS: [u16; 6] = [0x0002, 0x1002, 0x2007, 0x8800, 0x180A, 0x6003];

    /// ROM sintética com um header TileMap SGDK em `HEADER` e o stream em
    /// `STREAM`. O stream é produzido pelo **encoder do produto**, cuja
    /// paridade com `apj.jar` e `apultra` já está comprovada — a ROM é
    /// sintética, o codec não.
    fn rom_com_tilemap(celulas: &[u16], w: u16, h: u16, compression: u16) -> Vec<u8> {
        let mut plain = Vec::with_capacity(celulas.len() * 2);
        for c in celulas {
            plain.extend_from_slice(&c.to_be_bytes());
        }
        let stream = if compression == 1 {
            aplib_encode(&plain, &AplibEncodeLimits::default()).expect("encode aPLib")
        } else {
            plain
        };
        let mut rom = vec![0u8; STREAM + stream.len() + 64];
        rom[HEADER..HEADER + 2].copy_from_slice(&compression.to_be_bytes());
        rom[HEADER + 2..HEADER + 4].copy_from_slice(&w.to_be_bytes());
        rom[HEADER + 4..HEADER + 6].copy_from_slice(&h.to_be_bytes());
        rom[HEADER + 6..HEADER + 10].copy_from_slice(&(STREAM as u32).to_be_bytes());
        rom[STREAM..STREAM + stream.len()].copy_from_slice(&stream);
        rom
    }

    fn celulas_3x2() -> Vec<u16> {
        CELULAS.to_vec()
    }

    fn candidato_unico(rom: &[u8]) -> TilemapCandidate {
        let achados = scan_tilemap_headers(rom);
        assert_eq!(achados.len(), 1, "candidatos: {achados:?}");
        achados[0].clone()
    }

    #[test]
    fn scan_de_tilemap_declara_dims_e_o_tamanho_celado() {
        let rom = rom_com_tilemap(&celulas_3x2(), 3, 2, 1);
        let c = candidato_unico(&rom);
        assert_eq!(c.header_offset, HEADER);
        assert_eq!(c.compression, HeaderCompression::Aplib);
        assert_eq!((c.w, c.h), (3, 2));
        assert_eq!(c.stream_offset, STREAM);
        assert_eq!(c.expected_len, 12, "6 células de 2 bytes");
    }

    #[test]
    fn scan_de_tilemap_recusa_codec_que_o_rescomp_nao_emite() {
        // Basics.Compression tem ordinais 0..=2; 3 não existe em artefato SGDK.
        let rom = rom_com_tilemap(&celulas_3x2(), 3, 2, 3);
        assert!(
            scan_tilemap_headers(&rom).is_empty(),
            "compression=3 não é um codec do rescomp"
        );
    }

    #[test]
    fn verificacao_devolve_as_celulas_exatas_do_mapa() {
        let rom = rom_com_tilemap(&celulas_3x2(), 3, 2, 1);
        let verificado = verificar_tilemap(&rom, &candidato_unico(&rom), &AplibLimits::default())
            .expect("mapa aPLib verificável");
        assert_eq!(verificado.candidate.compression, HeaderCompression::Aplib);
        assert_eq!(
            verificado.cells, CELULAS,
            "as células decodificadas têm que ser as escritas"
        );
        assert!(
            verificado.bytes_consumed > 0 && HEADER + 10 <= STREAM + verificado.bytes_consumed,
            "consumo do stream: {}",
            verificado.bytes_consumed
        );
    }

    #[test]
    fn verificacao_recusa_stream_que_nao_bate_com_o_celado() {
        // Header declara 3x3 (9 células = 18 B); o stream só tem 6 (12 B).
        let rom = rom_com_tilemap(&celulas_3x2(), 3, 3, 1);
        let erro = verificar_tilemap(&rom, &candidato_unico(&rom), &AplibLimits::default())
            .expect_err("tamanho declarado divergente não pode virar contexto");
        assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
        assert!(
            erro.detail.contains("18") && erro.detail.contains("12"),
            "a recusa tem que dizer os dois tamanhos: {}",
            erro.detail
        );
    }

    #[test]
    fn verificacao_recusa_codec_para_o_qual_nao_ha_decodificador_nesta_frente() {
        // NONE e LZ4W continuam sendo rótulos honestos: nada aqui decodifica
        // "por suposição", e a recusa é explícita em vez de silêncio.
        for codec in [0u16, 2] {
            let rom = rom_com_tilemap(&celulas_3x2(), 3, 2, codec);
            let erro = verificar_tilemap(&rom, &candidato_unico(&rom), &AplibLimits::default())
                .expect_err("sem contrato de decode nesta frente");
            assert_eq!(erro.code, "unsupported_codec", "desfecho: {erro:?}");
        }
    }

    #[test]
    fn celula_decompoe_indice_flip_banco_prioridade_e_posicao_na_ordem_do_mapa() {
        // O word é o TILE_ATTR_FULL do SGDK (vdp_drv.h / Tile.java): índice em
        // 0..=10, hflip 11, vflip 12, banco 13..14, prioridade 15. A ordem do
        // mapa é ROW: célula linear i cai em (coluna i % w, linha i / w).
        let esperado = [
            (0, 0, 2, false, false, 0, false),
            (1, 0, 2, false, true, 0, false),
            (2, 0, 7, false, false, 1, false),
            (0, 1, 0, true, false, 0, true),
            (1, 1, 10, true, true, 0, false),
            (2, 1, 3, false, false, 3, false),
        ];
        for (i, (word, exp)) in CELULAS.iter().zip(esperado.iter()).enumerate() {
            let (col, linha, tile, hf, vf, banco, prio) = *exp;
            let c = decodificar_celula(*word, i, 3).unwrap_or_else(|e| {
                panic!(
                    "célula {:#06x} na posição {i} recusada: {}: {}",
                    word, e.code, e.detail
                )
            });
            assert_eq!((c.col, c.row), (col, linha), "posição da célula {i}");
            assert_eq!(c.tile, tile, "índice de tile em {word:#06x}");
            assert_eq!((c.hflip, c.vflip), (hf, vf), "flips em {word:#06x}");
            assert_eq!(c.bank, banco, "banco em {word:#06x}");
            assert_eq!(c.priority, prio, "prioridade em {word:#06x}");
            assert_eq!(c.word, *word, "a palavra crua tem que continuar acessível");
        }
    }

    fn mapa_3x2() -> VerifiedTilemap {
        let rom = rom_com_tilemap(&celulas_3x2(), 3, 2, 1);
        verificar_tilemap(&rom, &candidato_unico(&rom), &AplibLimits::default())
            .expect("mapa aPLib verificável")
    }

    #[test]
    fn mapa_grande_posiciona_cada_celula_pelo_indice_linear_real() {
        // O teto do decode aPLib é 4 MiB de saída, então um TileMap verificado
        // pode ter muito mais que 65535 células. A posição é o índice linear
        // real, não um contador de 16 bits que dá volta.
        let (w, h) = (15u64, 4383u64);
        let total = w * h; // 65.745 células
        let mut cells = vec![0x0002u16; total as usize];
        *cells.last_mut().expect("mapa não-vazio") = 0x0003;
        let mapa = VerifiedTilemap {
            candidate: TilemapCandidate {
                header_offset: HEADER,
                compression: HeaderCompression::Aplib,
                w: w as usize,
                h: h as usize,
                stream_offset: STREAM,
                expected_len: (total * 2) as usize,
            },
            cells,
            bytes_consumed: 0,
        };
        let decodificadas = celulas_do_mapa(&mapa).expect("células de mapa verificado");
        assert_eq!(decodificadas.len(), total as usize);
        assert_eq!(
            (
                decodificadas.last().expect("última célula").col,
                decodificadas.last().expect("última célula").row,
                decodificadas.last().expect("última célula").tile
            ),
            (14, 4382, 3),
            "a última célula de um mapa 15x4383 está em (col 14, linha 4382)"
        );
    }

    #[test]
    fn ocorrencias_do_tile_listam_todas_as_celulas_que_o_usam() {
        // No CELULAS o tile 2 aparece duas vezes, sob transformações
        // diferentes; o tile 7 uma vez; e o tile 4 não aparece.
        let mapa = mapa_3x2();
        let do_two = ocorrencias_do_tile(&mapa, 2).expect("mapa verificado");
        assert_eq!(
            do_two
                .iter()
                .map(|c| (c.col, c.row, c.hflip, c.vflip))
                .collect::<Vec<_>>(),
            vec![(0, 0, false, false), (1, 0, false, true)],
            "as duas ocorrências de tile 2, com seus flips"
        );
        assert_eq!(ocorrencias_do_tile(&mapa, 7).expect("7").len(), 1);
        assert_eq!(
            ocorrencias_do_tile(&mapa, 4).expect("4").len(),
            0,
            "tile não referenciado tem que dar zero, não erro"
        );
    }

    #[test]
    fn pixel_da_fonte_projeta_na_camada_invertendo_eixo_conforme_o_flip() {
        // (tile 2, linha 4, coluna 7) é a edição canônica do fixture. Nas duas
        // ocorrências acima: sem flip cai em (7,4); a segunda (col 1, vflip)
        // inverte só a linha -> (1*8+7, 7-4) = (15,3).
        let mapa = mapa_3x2();
        let projetadas = ocorrencias_do_tile(&mapa, 2)
            .expect("ocorrências")
            .iter()
            .map(|c| c.projetar_pixel_da_fonte(4, 7))
            .collect::<Result<Vec<_>, _>>()
            .expect("projeção das duas ocorrências");
        assert_eq!(
            projetadas,
            vec![PontoDaCamada { x: 7, y: 4 }, PontoDaCamada { x: 15, y: 3 }]
        );
    }

    #[test]
    fn clique_na_camada_devolve_o_pixel_da_fonte_atingido_respeitando_o_flip() {
        let mapa = mapa_3x2();
        // A célula (1,1) = word 0x180A tem os DOIS flips e referencia tile 10.
        // Clicar no canto superior-esquerdo do bloco dela ((1*8, 1*8) = (8,8))
        // atinge o canto inferior-direito da FONTE: (linha 7, coluna 7). É
        // exatamente o elo que o briefing exige: editar o pixel certo do tile
        // de origem a partir de um clique em célula flipada.
        let clicada = celula_em(&mapa, 8, 8).expect("clique na célula (1,1)");
        assert_eq!((clicada.tile, clicada.col, clicada.row), (10, 1, 1));
        assert_eq!((clicada.hflip, clicada.vflip), (true, true));
        assert_eq!(
            clicada.fonte_do_ponto(PontoDaCamada { x: 8, y: 8 }),
            Ok(PixelDaFonte {
                tile: 10,
                row: 7,
                col: 7
            })
        );

        // Idem para o tile 0, que no CELULAS aparece com hflip + prioridade:
        // clicar no canto inferior-direito do bloco (0,1) — (7,15) — espelha só
        // a coluna, então atinge (linha 7, coluna 0) da fonte.
        let zero = celula_em(&mapa, 7, 15).expect("clique na célula (0,1)");
        assert_eq!((zero.tile, zero.hflip, zero.vflip), (0, true, false));
        assert_eq!(
            zero.fonte_do_ponto(PontoDaCamada { x: 7, y: 15 }),
            Ok(PixelDaFonte {
                tile: 0,
                row: 7,
                col: 0
            }),
            "índice 0 de tile é uma célula como outra qualquer quanto ao mapeamento"
        );

        // Inversão exata para toda célula, em todos os 64 pixels: as duas
        // direções não podem divergir em nenhum ponto.
        for c in celulas_do_mapa(&mapa).expect("células") {
            for linha in 0..TILE_PX {
                for coluna in 0..TILE_PX {
                    let ponto = c.projetar_pixel_da_fonte(linha, coluna).expect("projeção");
                    assert_eq!(
                        c.fonte_do_ponto(ponto).expect("fonte"),
                        PixelDaFonte {
                            tile: c.tile,
                            row: linha,
                            col: coluna
                        },
                        "célula {c:?} em ({},{}): ida e volta",
                        ponto.x,
                        ponto.y
                    );
                }
            }
        }
    }

    #[test]
    fn scan_de_palette_localiza_o_header_e_a_contagem_de_cores() {
        // Layout conferido no SDK pinado: inc/pal.h declara
        // `{ u16 length; u16* data }` e o rescomp (resource/Palette.out) emite
        // `dc.w bin.data.length/2` + `dc.l <bin_id>`. Paleta não tem campo de
        // compressão — o construtor diz "we never compress palette".
        let palavras: Vec<u16> = (0..48u16).map(|i| i * 0x0201).collect();
        let rom = rom_com_palette(&palavras);
        let achados = scan_palette_headers(&rom);
        assert_eq!(
            achados.len(),
            1,
            "candidatos além do header escrito: {achados:?}"
        );
        let c = &achados[0];
        assert_eq!(c.header_offset, HEADER);
        assert_eq!(c.num_colors, 48);
        assert_eq!(c.stream_offset, STREAM);
        assert_eq!(c.expected_len, 96, "48 palavras de 2 bytes");
    }

    #[test]
    fn scan_de_palette_recusa_header_cuja_declaracao_nao_cabe_na_rom() {
        let palavras: Vec<u16> = (0..48u16).collect();
        let mut rom = rom_com_palette(&palavras);
        // Header no lugar, mas declara 4096 cores: não há room. Um candidato
        // assim é ruído, não estrutura.
        rom[HEADER..HEADER + 2].copy_from_slice(&4096u16.to_be_bytes());
        assert!(
            scan_palette_headers(&rom).is_empty(),
            "numColor sem room na ROM não pode virar candidato"
        );

        // length 0 não é paleta.
        let mut rom2 = rom_com_palette(&palavras);
        rom2[HEADER..HEADER + 2].copy_from_slice(&0u16.to_be_bytes());
        assert!(scan_palette_headers(&rom2)
            .iter()
            .all(|c| c.header_offset != HEADER));
    }

    #[test]
    fn leitura_da_palette_devolve_as_palavras_na_ordem_exata() {
        let palavras: Vec<u16> = (0..48u16).map(|i| 0x0EEE ^ i).collect();
        let rom = rom_com_palette(&palavras);
        let lida = verificar_palette(&rom, &candidato_de_palette_unico(&rom))
            .expect("paleta estruturalmente legível");
        assert_eq!(lida.words, palavras, "as palavras têm que ser as gravadas");
        assert_eq!(lida.bytes_consumed, 96);
    }

    /// ROM sintética com os três recursos de uma `Image` + o próprio struct.
    /// Os ponteiros usam endereços 68k, que para cartucho sem bank switching
    /// são iguais ao offset de arquivo (premissa já conferida no fixture pelo
    /// cross-check com `symbol.txt` do linker).
    fn rom_com_cadeia(palavras_palette: &[u16], celulas: &[u16], w: u16, h: u16) -> Vec<u8> {
        let stream_mapa =
            aplib_encode(&plain_de_words(celulas), &AplibEncodeLimits::default()).expect("encode");
        let mut rom = vec![0u8; PAL_STREAM + palavras_palette.len() * 2 + 64];
        escreve_header_tileset(&mut rom, TS_HDR, TS_STREAM, 16);
        escreve_header_tilemap(&mut rom, TM_HDR, TM_STREAM, w, h, &stream_mapa);
        escreve_header_palette(&mut rom, PAL_HDR, PAL_STREAM, palavras_palette);
        // o struct Image do SGDK: { Palette*, TileSet*, TileMap* }
        for (k, ptr) in [PAL_HDR, TS_HDR, TM_HDR].iter().enumerate() {
            let at = IMG + k * 4;
            rom[at..at + 4].copy_from_slice(&(*ptr as u32).to_be_bytes());
        }
        // Struct vizinho que aponta para um TileMap NÃO verificado (aponta para
        // o header do TileSet): é o caso do `ctx_ghost_image` descartado pelo
        // linker — sem vínculo conferível, tem que continuar desconhecido.
        let at = IMG + 0x20;
        for (k, ptr) in [PAL_HDR, TS_HDR, TS_HDR].iter().enumerate() {
            rom[at + k * 4..at + k * 4 + 4].copy_from_slice(&(*ptr as u32).to_be_bytes());
        }
        rom
    }

    fn plain_de_words(words: &[u16]) -> Vec<u8> {
        let mut out = Vec::with_capacity(words.len() * 2);
        for w in words {
            out.extend_from_slice(&w.to_be_bytes());
        }
        out
    }

    fn escreve_header_tileset(rom: &mut [u8], header: usize, stream: usize, num_tiles: u16) {
        rom[header..header + 2].copy_from_slice(&1u16.to_be_bytes());
        rom[header + 2..header + 4].copy_from_slice(&num_tiles.to_be_bytes());
        rom[header + 4..header + 8].copy_from_slice(&(stream as u32).to_be_bytes());
        let fim = stream + usize::from(num_tiles) * 32;
        assert!(fim <= rom.len(), "fixture do teste: tileset cabe na ROM");
    }

    fn escreve_header_tilemap(
        rom: &mut [u8],
        header: usize,
        stream: usize,
        w: u16,
        h: u16,
        stream_bytes: &[u8],
    ) {
        rom[header..header + 2].copy_from_slice(&1u16.to_be_bytes());
        rom[header + 2..header + 4].copy_from_slice(&w.to_be_bytes());
        rom[header + 4..header + 6].copy_from_slice(&h.to_be_bytes());
        rom[header + 6..header + 10].copy_from_slice(&(stream as u32).to_be_bytes());
        rom[stream..stream + stream_bytes.len()].copy_from_slice(stream_bytes);
    }

    fn escreve_header_palette(rom: &mut [u8], header: usize, stream: usize, palavras: &[u16]) {
        rom[header..header + 2].copy_from_slice(&(palavras.len() as u16).to_be_bytes());
        rom[header + 2..header + 6].copy_from_slice(&(stream as u32).to_be_bytes());
        for (i, w) in palavras.iter().enumerate() {
            rom[stream + i * 2..stream + i * 2 + 2].copy_from_slice(&w.to_be_bytes());
        }
    }

    fn offsets_de<T, F: FnOnce(&[u8]) -> Vec<T>>(
        rom: &[u8],
        scan: F,
        header: fn(&T) -> usize,
    ) -> Vec<usize> {
        scan(rom).iter().map(header).collect()
    }

    /// Headers candidatos das três famílias, como o produto os descobriu.
    fn cabecalos_descobertos(rom: &[u8]) -> (Vec<usize>, Vec<usize>, Vec<usize>) {
        (
            scan_palette_headers(rom)
                .iter()
                .map(|c| c.header_offset)
                .collect(),
            scan_tileset_headers(rom)
                .iter()
                .map(|c| c.header_offset)
                .collect(),
            scan_tilemap_headers(rom)
                .iter()
                .map(|c| c.header_offset)
                .collect(),
        )
    }

    // --- composição da camada -----------------------------------------------
    //
    // As três funções abaixo são o esperado **escrito no teste**, derivado da
    // autoria (fórmulas próprias), não do renderer do produto. A comparação com
    // um esperado externo de verdade é o teste de aceite do fixture.

    /// Índice de paleta do pixel (r,c) do tile t, como o teste autoria.
    fn indice_autoral(t: usize, r: usize, c: usize) -> u8 {
        ((t + 2 * r + 3 * c) % 16) as u8
    }

    /// Palavra 68k da cor (banco b, índice i), no formato `xxxBBBxGGGxRRRx`.
    ///
    /// `+ 1` de propósito: até o índice 0 tem cor visível em todo banco, então
    /// um renderer que pintasse `pal[banco][0]` em vez de transparentar diverge
    /// do esperado de forma mensurável (é o que o fixture faz com os bancos 1
    /// e 2, e aqui vale para o banco 0 também).
    fn palavra_autoral(b: usize, i: usize) -> u16 {
        let r3 = (i + b + 1) % 8;
        let g3 = (i + 1) % 8;
        let b3 = (i * b + 1) % 8;
        ((r3 << 1) | (g3 << 5) | (b3 << 9)) as u16
    }

    /// RGB8 esperado de uma palavra de paleta, na escala cheia.
    fn rgb_autoral(w: u16) -> [u8; 3] {
        [
            canal8(((w >> 1) & 7) as usize),
            canal8(((w >> 5) & 7) as usize),
            canal8(((w >> 9) & 7) as usize),
        ]
    }

    /// Canal 3 bits -> 8 bits com escala cheia: `round(v * 255 / 7)`, a mesma
    /// conta `(v << 5) | (v << 2) | (v >> 1)` usada pelo core Libretro.
    fn canal8(v: usize) -> u8 {
        ((v * 255 + 3) / 7) as u8
    }

    /// TileSet de teste: `num_tiles` tiles 4bpp chunky com o padrão autoral.
    fn tiles_autorais(num_tiles: usize) -> Vec<u8> {
        let mut data = vec![0u8; num_tiles * 32];
        for t in 0..num_tiles {
            for r in 0..8 {
                for c in 0..8 {
                    let i = indice_autoral(t, r, c);
                    let byte = &mut data[t * 32 + r * 4 + c / 2];
                    if c % 2 == 0 {
                        *byte = (*byte & 0x0F) | (i << 4);
                    } else {
                        *byte = (*byte & 0xF0) | i;
                    }
                }
            }
        }
        data
    }

    fn paleta_autoral(bancos: usize) -> Vec<u16> {
        (0..bancos)
            .flat_map(|b| (0..16).map(move |i| palavra_autoral(b, i)))
            .collect()
    }

    #[test]
    fn composicao_respeita_flip_banco_de_paleta_e_transparencia_do_indice_0() {
        let tiles = tiles_autorais(NUM_TILES);
        let palavras = paleta_autoral(4);
        let mapa = mapa_de_celulas(&CELULAS, 3, 2);
        let camada = compor_camada(&tiles, &mapa, &paleta_de_palavras(&palavras)).expect("compõe");

        assert_eq!(
            (camada.width, camada.height),
            (24, 16),
            "3x2 células de 8px"
        );
        let px = |x: usize, y: usize| &camada.rgba[(y * camada.width + x) * 4..][..4];
        let cor = |b: usize, i: usize| rgb_autoral(palavra_autoral(b, i));

        // Caso 1 — célula (0,0), word 0x0002: tile 2, sem flip, banco 0.
        // O pixel (4,3) da fonte tem que aparecer em (3,4) da camada.
        let i = indice_autoral(2, 4, 3) as usize;
        let esperado = [cor(0, i)[0], cor(0, i)[1], cor(0, i)[2], 255];
        assert_eq!(px(3, 4), &esperado, "célula sem flip usa o banco 0");

        // Caso 2 — célula (1,0), word 0x1002: MESMO tile 2, com vflip. O mesmo
        // pixel da fonte aparece espelhado na linha: y = 7-4 = 3, x = 8+3 = 11.
        assert_eq!(px(11, 3), &esperado, "vflip inverte a linha, não a coluna");
        assert_ne!(
            px(11, 11),
            &esperado,
            "senão seria translado, não espelhamento"
        );

        // Caso 3 — célula (2,0), word 0x2007: tile 7, banco 1. A cor vem do
        // banco 1 da paleta, não do 0.
        let i7 = indice_autoral(7, 1, 6) as usize;
        assert_ne!(
            cor(0, i7),
            cor(1, i7),
            "o teste precisa que os bancos difiram aqui"
        );
        assert_eq!(
            px(16 + 6, 1),
            &[cor(1, i7)[0], cor(1, i7)[1], cor(1, i7)[2], 255][..],
            "banco é atributo da célula"
        );

        // Caso 4 — índice 0 é transparente NA CAMADA (não é a cor pal[banco][0],
        // que nos bancos 1.. é visível de propósito).
        let (t0, r0, c0) = (0usize, 0usize, 0usize);
        assert_eq!(
            indice_autoral(t0, r0, c0),
            0,
            "o padrão autoral tem índice 0"
        );
        let zero = celulas_do_mapa(&mapa)
            .expect("células")
            .into_iter()
            .find(|c| c.tile == 0)
            .expect("alguma célula usa o tile 0");
        let ponto = zero
            .projetar_pixel_da_fonte(r0, c0)
            .expect("projeção do (0,0)");
        let banco_do_zero = zero.bank as usize;
        assert_ne!(
            canal8(((palavra_autoral(banco_do_zero, 0) >> 5) & 7) as usize),
            0,
            "se pal[banco][0] fosse preto, este caso não discriminaria nada"
        );
        assert_eq!(
            px(ponto.x, ponto.y)[3],
            0,
            "índice 0 tem que ser alfa 0 na camada, não pal[banco][0]"
        );

        // Varredura completa: cada um dos pixels das 6 células cai exatamente no
        // lugar que a célula manda, com o banco e o alfa certos.
        for c in celulas_do_mapa(&mapa).expect("células") {
            for r in 0..8 {
                for k in 0..8 {
                    let p = c.projetar_pixel_da_fonte(r, k).expect("projeção");
                    let idx = indice_autoral(c.tile, r, k) as usize;
                    let (rgb, a) = if idx == 0 {
                        ([0u8; 3], 0u8)
                    } else {
                        (cor(c.bank as usize, idx), 255u8)
                    };
                    assert_eq!(
                        px(p.x, p.y),
                        &[rgb[0], rgb[1], rgb[2], a][..],
                        "célula ({},{}) tile {} flip h={} v={} banco {}, fonte ({},{})",
                        c.col,
                        c.row,
                        c.tile,
                        c.hflip,
                        c.vflip,
                        c.bank,
                        r,
                        k
                    );
                }
            }
        }
    }

    #[test]
    fn composicao_recusa_referencia_fora_do_tileset_em_vez_de_pintar_ruido() {
        // O caso do `ctx_ghost` do fixture: célula com índice 107 num tileset de
        // 16 tiles. Não dá para compor; a recusa tem que dizer qual célula.
        let tiles = tiles_autorais(NUM_TILES);
        let palavras = paleta_autoral(4);
        let mapa = mapa_de_celulas(&[0x0002, 0x006B, 0x0003], 3, 1);
        let erro = compor_camada(&tiles, &mapa, &paleta_de_palavras(&palavras))
            .expect_err("índice 107 fora do tileset não é composicionável");
        assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
        assert!(
            erro.detail.contains("107") && erro.detail.contains("16"),
            "a recusa tem que dar o índice e o limite: {}",
            erro.detail
        );
        assert!(
            erro.detail.contains("col 1") || erro.detail.contains("(1,"),
            "e a posição da célula ofensora: {}",
            erro.detail
        );
    }

    #[test]
    fn composicao_recusa_banco_que_a_paleta_nao_tem_cores() {
        // Paleta de 1 banco (16 palavras) e célula no banco 3: o VDP leria fora
        // do que o recurso declara.
        let tiles = tiles_autorais(NUM_TILES);
        let palavras = paleta_autoral(1);
        let mapa = mapa_de_celulas(&[0x6003, 0x0002, 0x0003], 3, 1);
        let erro = compor_camada(&tiles, &mapa, &paleta_de_palavras(&palavras))
            .expect_err("banco sem cores declaradas na paleta");
        assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
        assert!(
            erro.detail.contains("3")
                && (erro.detail.contains("16") || erro.detail.contains("1 banco")),
            "a recusa tem que dizer banco e tamanho da paleta: {}",
            erro.detail
        );
    }

    /// Mapa verificado a partir de palavras de célula, via ROM sintética aPLib.
    fn mapa_de_celulas(celulas: &[u16], w: u16, h: u16) -> VerifiedTilemap {
        let rom = rom_com_tilemap(celulas, w, h, 1);
        verificar_tilemap(&rom, &candidato_unico(&rom), &AplibLimits::default())
            .expect("mapa verificável")
    }

    fn paleta_de_palavras(palavras: &[u16]) -> VerifiedPalette {
        let rom = rom_com_palette(palavras);
        verificar_palette(&rom, &candidato_de_palette_unico(&rom)).expect("paleta legível")
    }

    /// O candidato que aponta para o header que o teste escreveu. Outros
    /// candidatos podem aparecer sobre dados autorais — varredura é isso,
    /// hipóteses — e é por isso que a composição só usa o header que um
    /// ponteiro verificado nomeou.
    fn candidato_de_palette_unico(rom: &[u8]) -> PaletteCandidate {
        scan_palette_headers(rom)
            .into_iter()
            .find(|c| c.header_offset == HEADER)
            .expect("header de paleta escrito pelo teste")
    }

    #[test]
    fn cadeia_imagem_e_descoberta_seguindo_os_tres_ponteiros_do_struct() {
        let palavras: Vec<u16> = (0..48u16).collect();
        let rom = rom_com_cadeia(&palavras, &celulas_3x2(), 3, 2);
        let (paletas, tilesets, tilemaps) = cabecalos_descobertos(&rom);

        let cadeias = localizar_cadeias_imagem(&rom, &paletas, &tilesets, &tilemaps);
        assert_eq!(
            cadeias,
            vec![CadeiaImagem {
                struct_offset: IMG,
                palette_header: PAL_HDR,
                tileset_header: TS_HDR,
                tilemap_header: TM_HDR,
            }],
            "só a trinca cujos três ponteiros batem com headers verificados"
        );
    }

    #[test]
    fn trinca_fora_da_ordem_ou_com_ponteiro_nao_verificado_nao_e_vinculo() {
        let palavras: Vec<u16> = (0..48u16).collect();
        let mut rom = rom_com_cadeia(&palavras, &celulas_3x2(), 3, 2);
        // Inverte a ordem para {tileset, palette, tilemap}: não é o layout do
        // struct `Image`, então nada pode ser afirmado sobre esses recursos.
        rom[IMG..IMG + 4].copy_from_slice(&(TS_HDR as u32).to_be_bytes());
        rom[IMG + 4..IMG + 8].copy_from_slice(&(PAL_HDR as u32).to_be_bytes());
        let (paletas, tilesets, tilemaps) = cabecalos_descobertos(&rom);
        assert!(
            localizar_cadeias_imagem(&rom, &paletas, &tilesets, &tilemaps).is_empty(),
            "ordem errada não é evidência de associação"
        );
    }

    #[test]
    fn localizacao_de_cadeia_nao_depende_da_ordem_nem_de_duplicatas_dos_candidatos() {
        // A varredura interna usa conjunto de candidatos. O contrato que isso
        // tem que preservar: a lista de entrada é um conjunto de headers, com
        // qualquer ordem e com repetições.
        let palavras: Vec<u16> = (0..48u16).collect();
        let rom = rom_com_cadeia(&palavras, &celulas_3x2(), 3, 2);
        let (paletas, tilesets, tilemaps) = cabecalos_descobertos(&rom);
        let esperado = localizar_cadeias_imagem(&rom, &paletas, &tilesets, &tilemaps);
        assert!(!esperado.is_empty(), "a fixture do teste perdeu a cadeia");
        let embaralhado = |lista: &[usize]| {
            let mut v = lista.to_vec();
            v.reverse();
            v.extend(lista.iter().copied());
            v
        };
        assert_eq!(
            localizar_cadeias_imagem(
                &rom,
                &embaralhado(&paletas),
                &embaralhado(&tilesets),
                &embaralhado(&tilemaps)
            ),
            esperado,
            "ordem ou duplicata de candidato não pode mudar o vínculo encontrado"
        );
    }

    /// ROM sintética com um header `Palette` em `HEADER` e as cores em
    /// `STREAM`.
    fn rom_com_palette(palavras: &[u16]) -> Vec<u8> {
        let mut rom = vec![0u8; STREAM + palavras.len() * 2 + 64];
        rom[HEADER..HEADER + 2].copy_from_slice(&(palavras.len() as u16).to_be_bytes());
        rom[HEADER + 2..HEADER + 6].copy_from_slice(&(STREAM as u32).to_be_bytes());
        for (i, w) in palavras.iter().enumerate() {
            rom[STREAM + i * 2..STREAM + i * 2 + 2].copy_from_slice(&w.to_be_bytes());
        }
        rom
    }

    #[test]
    fn referencia_fora_da_geometria_e_recusada_com_a_faixa_na_mensagem() {
        let mapa = mapa_3x2();
        let celula = celula_em(&mapa, 0, 0).expect("célula (0,0)");

        // Pixel da fonte fora do tile 8x8.
        let erro = celula
            .projetar_pixel_da_fonte(TILE_PX, 0)
            .expect_err("linha 8 não existe em tile 8x8");
        assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
        assert!(
            erro.detail.contains('8'),
            "a recusa tem que dizer a faixa: {}",
            erro.detail
        );

        // Clique fora do mapa (3x2 células = 24x16 pixels).
        for (x, y) in [(24usize, 0usize), (0, 16), (999, 999)] {
            let erro =
                celula_em(&mapa, x, y).expect_err("clique ({x},{y}) está fora do mapa verificado");
            assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
            assert!(
                erro.detail.contains("24") && erro.detail.contains("16"),
                "a recusa tem que dizer o tamanho do mapa: {}",
                erro.detail
            );
        }

        // Clique em outra célula não pode ser atribuído a esta.
        let erro = celula
            .fonte_do_ponto(PontoDaCamada { x: 8, y: 8 })
            .expect_err("ponto (8,8) não cai na célula (0,0)");
        assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
    }

    // ==================== montagem do contexto (superfície do IPC) ==========
    //
    // O que o produto publica e como rotula. As ROMs aqui são sintéticas, mas
    // **verificáveis de ponta a ponta**: os streams saem do encoder do produto e
    // entram pelo mesmo `verify_resource_set`/`verificar_tilemap` que o IPC usa,
    // então nenhum teste deste bloco precisa passar offset ou dimensão por fora.

    /// Layout devolvido junto com a ROM para os testes poderem citar offsets.
    struct RomCadeia {
        rom: Vec<u8>,
        /// Stream aPLib do TileSet: `[tileset_stream, +tileset_stream_len)`.
        tileset_stream: usize,
        tileset_stream_len: usize,
    }

    fn alinhado(mut at: usize) -> usize {
        if at % 2 != 0 {
            at += 1;
        }
        at
    }

    /// ROM com uma cadeia `Image` cujos **três** recursos verificam: TileSet e
    /// TileMap comprimidos aPLib, paleta literal (como o rescomp emite).
    fn rom_de_cadeia(tiles: &[u8], palavras: &[u16], celulas: &[u16], w: u16, h: u16) -> RomCadeia {
        let stream_ts = aplib_encode(tiles, &AplibEncodeLimits::default()).expect("encode tiles");
        let stream_tm = aplib_encode(&plain_de_words(celulas), &AplibEncodeLimits::default())
            .expect("encode mapa");
        let ts_stream = TS_STREAM;
        let tm_stream = alinhado(ts_stream + stream_ts.len());
        let pal_stream = alinhado(tm_stream + stream_tm.len());
        let mut rom = vec![0u8; pal_stream + palavras.len() * 2 + 64];
        // O header do TileSet é escrito à mão (não por `escreve_header_tileset`):
        // aqui o stream é comprimido, então a área que cabe na ROM é a do
        // codificado, não a dos 512 bytes planos.
        rom[TS_HDR..TS_HDR + 2].copy_from_slice(&1u16.to_be_bytes());
        rom[TS_HDR + 2..TS_HDR + 4].copy_from_slice(&((tiles.len() / 32) as u16).to_be_bytes());
        rom[TS_HDR + 4..TS_HDR + 8].copy_from_slice(&(ts_stream as u32).to_be_bytes());
        rom[ts_stream..ts_stream + stream_ts.len()].copy_from_slice(&stream_ts);
        escreve_header_tilemap(&mut rom, TM_HDR, tm_stream, w, h, &stream_tm);
        escreve_header_palette(&mut rom, PAL_HDR, pal_stream, palavras);
        for (k, ptr) in [PAL_HDR, TS_HDR, TM_HDR].iter().enumerate() {
            let at = IMG + k * 4;
            rom[at..at + 4].copy_from_slice(&(*ptr as u32).to_be_bytes());
        }
        // Trinca-fantasma do fixture: um struct na ordem certa cujo "TileMap" é
        // o header do TileSet. Não passa em `localizar_cadeias_imagem` e tem que
        // continuar fora do contexto.
        let at = IMG + 0x20;
        for (k, ptr) in [PAL_HDR, TS_HDR, TS_HDR].iter().enumerate() {
            rom[at + k * 4..at + k * 4 + 4].copy_from_slice(&(*ptr as u32).to_be_bytes());
        }
        RomCadeia {
            rom,
            tileset_stream: ts_stream,
            tileset_stream_len: stream_ts.len(),
        }
    }

    /// Acrescenta um TileSet verificado que **nenhum** ponteiro alcança.
    fn acrescenta_tileset_sem_vinculo(rom: &mut Vec<u8>, tiles: &[u8]) -> usize {
        let dados = aplib_encode(tiles, &AplibEncodeLimits::default()).expect("encode extra");
        let header = alinhado(rom.len());
        let stream = header + 8;
        rom.resize(stream + dados.len() + 64, 0);
        rom[header..header + 2].copy_from_slice(&1u16.to_be_bytes());
        rom[header + 2..header + 4].copy_from_slice(&((tiles.len() / 32) as u16).to_be_bytes());
        rom[header + 4..header + 8].copy_from_slice(&(stream as u32).to_be_bytes());
        rom[stream..stream + dados.len()].copy_from_slice(&dados);
        header
    }

    fn contexto_de(rom: &[u8]) -> ContextoRom {
        contexto_da_rom(
            rom,
            &TransactionLimits::default(),
            &LimiteTrabalho::default(),
        )
        .expect("contexto montado a partir só da ROM")
    }

    #[test]
    fn contexto_rotula_o_vinculo_como_verificado_e_diz_o_que_foi_conferido() {
        let fixture = rom_de_cadeia(
            &tiles_autorais(NUM_TILES),
            &paleta_autoral(4),
            &CELULAS,
            3,
            2,
        );
        let ctx = contexto_de(&fixture.rom);

        assert_eq!(ctx.rom_sha256, sha256_hex(&fixture.rom));
        assert_eq!(ctx.rom_len, fixture.rom.len() as u64);
        assert_eq!(
            ctx.imagens.len(),
            1,
            "só a trinca cujo ponteiro segue: {:?}",
            ctx.imagens
                .iter()
                .map(|i| i.struct_offset)
                .collect::<Vec<_>>()
        );
        let imagem = &ctx.imagens[0];
        assert_eq!(imagem.struct_offset, IMG as u64);
        assert_eq!(imagem.proveniencia, Proveniencia::Verificada);

        // "Verificada" sem dizer o quê é rótulo vazio: a lista tem que nomear os
        // três ponteiros e o decode conferido de cada recurso.
        let conferido = imagem.conferido.join("\n");
        for alvo in [IMG, PAL_HDR, TS_HDR, TM_HDR] {
            assert!(
                conferido.contains(&format!("{alvo:#x}")),
                "conferido não nomeia {alvo:#x}:\n{conferido}"
            );
        }
        assert!(conferido.contains("ponteiro"), "\n{conferido}");
        assert!(conferido.contains("decod"), "\n{conferido}");
        for fato in ["512", "128", "24x16", "3x2"] {
            assert!(
                conferido.contains(fato),
                "conferido tem que citar o tamanho/geometria {fato}:\n{conferido}"
            );
        }

        // E o que a estrutura NÃO prova, dito em vez de inferido pelo leitor.
        let nao_prova = imagem.nao_prova.join("\n");
        assert!(nao_prova.contains("carreg"), "\n{nao_prova}");
        assert!(nao_prova.contains("exib"), "\n{nao_prova}");
    }

    #[test]
    fn contexto_da_identidade_de_cada_recurso_lida_da_rom_e_nao_de_parametro() {
        let tiles = tiles_autorais(NUM_TILES);
        let palavras = paleta_autoral(4);
        let fixture = rom_de_cadeia(&tiles, &palavras, &CELULAS, 3, 2);
        let imagem = &contexto_de(&fixture.rom).imagens[0];

        assert_eq!(imagem.tileset.header_offset, TS_HDR as u64);
        assert_eq!(imagem.tileset.stream_offset, fixture.tileset_stream as u64);
        assert_eq!(imagem.tileset.codec, "aplib", "codec lido do header");
        assert_eq!(imagem.tileset.plain_len, (NUM_TILES * 32) as u64);
        assert_eq!(imagem.tileset.plain_sha256, sha256_hex(&tiles));
        assert_eq!(
            imagem.tileset.stream_len, fixture.tileset_stream_len as u64,
            "consumo medido no decode, não declarado pelo header"
        );

        assert_eq!(imagem.tilemap.header_offset, TM_HDR as u64);
        assert_eq!(imagem.tilemap.plain_len, 12);
        assert_eq!(
            imagem.tilemap.plain_sha256,
            sha256_hex(&plain_de_words(&CELULAS))
        );

        // A paleta não tem campo de compressão no rescomp: os bytes do ROM são
        // os literais, então stream e plain coincidem.
        assert_eq!(imagem.paleta.header_offset, PAL_HDR as u64);
        assert_eq!(imagem.paleta.codec, "none");
        assert_eq!(imagem.paleta.plain_len, 128, "64 cores em 4 bancos");
        assert_eq!(
            imagem.paleta.stream_len, imagem.paleta.plain_len,
            "paleta é literal no ROM"
        );
        assert_eq!(
            imagem.paleta.plain_sha256,
            sha256_hex(&plain_de_words(&palavras))
        );
    }

    #[test]
    fn contexto_publica_ocorrencias_conhecidas_so_do_mapa_verificado() {
        let fixture = rom_de_cadeia(
            &tiles_autorais(NUM_TILES),
            &paleta_autoral(4),
            &CELULAS,
            3,
            2,
        );
        let mapa = &contexto_de(&fixture.rom).imagens[0].mapa;

        assert_eq!((mapa.cols, mapa.rows), (3, 2));
        assert_eq!((mapa.largura_px, mapa.altura_px), (24, 16));
        assert_eq!(mapa.celulas.len(), 6);
        assert_eq!(mapa.celulas[1].tile, 2);
        assert!(mapa.celulas[1].vflip && !mapa.celulas[1].hflip);
        assert_eq!(mapa.celulas[3].tile, 0);
        assert!(mapa.celulas[3].hflip && mapa.celulas[3].prioridade);
        assert_eq!(mapa.celulas[5].banco, 3);

        let compartilhado = mapa
            .ocorrencias_por_tile
            .iter()
            .find(|o| o.tile == 2)
            .expect("tile 2 tem ocorrências");
        assert_eq!(
            compartilhado.celulas,
            vec![0, 1],
            "índices lineares na ordem do mapa"
        );

        // Contagem conferida: nenhuma célula se perde nem se duplica.
        let total: usize = mapa
            .ocorrencias_por_tile
            .iter()
            .map(|o| o.celulas.len())
            .sum();
        assert_eq!(total, mapa.celulas.len());
        assert_eq!(
            mapa.ocorrencias_por_tile.len() + mapa.tiles_sem_uso.len(),
            NUM_TILES,
            "cada tile do TileSet ou tem ocorrências ou está listado como sem uso"
        );
        assert!(mapa.tiles_sem_uso.contains(&15));
        assert!(!mapa.tiles_sem_uso.contains(&2));

        // O escopo publicado limita a afirmação ao mapa conferido.
        assert!(mapa.escopo.contains("deste mapa"), "{}", mapa.escopo);
        assert!(mapa.escopo.contains(&format!("{TM_HDR:#x}")));
    }

    #[test]
    fn nucleo_resolve_o_clique_da_camada_em_celula_flip_e_pixel_da_fonte() {
        let fixture = rom_de_cadeia(
            &tiles_autorais(NUM_TILES),
            &paleta_autoral(4),
            &CELULAS,
            3,
            2,
        );
        let limites = TransactionLimits::default();

        // (11,3): célula (1,0), word 0x1002 = tile 2 com vflip. O pixel da fonte
        // (linha 4, coluna 3) aparece espelhado na linha: y = 7-4 = 3.
        let resposta =
            contexto_clique(&fixture.rom, IMG as u64, 11, 3, &limites).expect("clique na célula 1");
        assert_eq!(resposta.rom_sha256, sha256_hex(&fixture.rom));
        assert_eq!(resposta.struct_offset, IMG as u64);
        assert_eq!((resposta.celula.col, resposta.celula.row), (1, 0));
        assert_eq!(resposta.celula.tile, 2);
        assert!(resposta.celula.vflip && !resposta.celula.hflip);
        assert_eq!(
            (
                resposta.fonte.tile,
                resposta.fonte.linha,
                resposta.fonte.coluna
            ),
            (2, 4, 3),
            "a projeção inversa é do núcleo, não da UI"
        );
        assert_eq!(resposta.fonte.indice, indice_autoral(2, 4, 3));
        assert_eq!(
            resposta.ocorrencias.len(),
            2,
            "o tile 2 tem duas células aqui"
        );
        assert_eq!(
            resposta
                .ocorrencias
                .iter()
                .map(|c| (c.col, c.row))
                .collect::<Vec<_>>(),
            vec![(0, 0), (1, 0)]
        );

        // Sem flip: o mesmo pixel da fonte cai na posição direta.
        let direto = contexto_clique(&fixture.rom, IMG as u64, 3, 4, &limites).expect("célula 0");
        assert_eq!(
            (direto.fonte.tile, direto.fonte.linha, direto.fonte.coluna),
            (2, 4, 3)
        );
        assert_eq!(direto.ocorrencias, resposta.ocorrencias);
    }

    #[test]
    fn clique_fora_da_geometria_ou_fora_de_um_vinculo_e_recusado() {
        let fixture = rom_de_cadeia(
            &tiles_autorais(NUM_TILES),
            &paleta_autoral(4),
            &CELULAS,
            3,
            2,
        );
        let limites = TransactionLimits::default();

        for (x, y) in [(24usize, 0usize), (0, 16), (9999, 9999)] {
            let erro = contexto_clique(&fixture.rom, IMG as u64, x, y, &limites)
                .expect_err("fora do mapa");
            assert_eq!(erro.code, "invalid_reference", "{erro:?}");
            assert!(
                erro.detail.contains("24") && erro.detail.contains("16"),
                "a recusa tem que dar a geometria real: {}",
                erro.detail
            );
        }

        // A trinca-fantasma existe em bytes mas não é vínculo: recusar em vez de
        // atender o clique como se fosse.
        let erro = contexto_clique(&fixture.rom, (IMG + 0x20) as u64, 0, 0, &limites)
            .expect_err("struct sem ponteiro verificado");
        assert_eq!(erro.code, "invalid_reference", "{erro:?}");
        assert!(
            erro.detail.contains(&format!("{:#x}", IMG + 0x20)),
            "{}",
            erro.detail
        );
    }

    #[test]
    fn camada_acima_do_orcamento_recusa_a_previsao_sem_perder_o_contexto() {
        let celulas: Vec<u16> = (0..64).map(|i| (i % NUM_TILES) as u16).collect();
        let fixture = rom_de_cadeia(
            &tiles_autorais(NUM_TILES),
            &paleta_autoral(4),
            &celulas,
            8,
            8,
        );

        let apertado = contexto_da_rom(
            &fixture.rom,
            &TransactionLimits::default(),
            &LimiteTrabalho {
                max_pixels_por_camada: 1_000,
            },
        )
        .expect("orçamento estourado não é erro do contexto");
        let camada = &apertado.imagens[0].camada;
        assert_eq!(
            (camada.largura_px, camada.altura_px),
            (64, 64),
            "a geometria é publicada de qualquer forma"
        );
        assert!(camada.png_data_url.is_none() && camada.pixels_sha256.is_none());
        let motivo = camada
            .recusada
            .as_deref()
            .expect("dizer por que não preview");
        assert!(
            motivo.contains("4096") && motivo.contains("1000"),
            "motivo: {motivo}"
        );
        assert_eq!(apertado.imagens[0].mapa.celulas.len(), 64);
        assert_eq!(apertado.limite_trabalho.max_pixels_por_camada, 1_000);

        let com_previsa = contexto_de(&fixture.rom);
        let ok = &com_previsa.imagens[0].camada;
        assert_eq!(ok.recusada, None);
        let data_url = ok.png_data_url.as_deref().expect("png");
        assert!(data_url.starts_with("data:image/png;base64,"));
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        let png = BASE64
            .decode(data_url.rsplit(',').next().expect("payload"))
            .expect("base64");
        assert_eq!(&png[..8], [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        assert_eq!(ok.pixels_sha256.as_deref().map(str::len), Some(64));
    }

    #[test]
    fn recurso_verificado_sem_ponteiro_e_publicado_como_vinculo_desconhecido() {
        let tiles = tiles_autorais(NUM_TILES);
        let mut fixture = rom_de_cadeia(&tiles, &paleta_autoral(4), &CELULAS, 3, 2);
        let extra = acrescenta_tileset_sem_vinculo(&mut fixture.rom, &tiles);
        let ctx = contexto_de(&fixture.rom);

        assert_eq!(ctx.imagens.len(), 1, "tileset extra não vira imagem");
        let sem_vinculo = ctx
            .sem_vinculo
            .iter()
            .find(|r| r.identidade.header_offset == extra as u64)
            .expect("publicado como não vinculado");
        assert_eq!(sem_vinculo.proveniencia, Proveniencia::Desconhecida);
        assert_eq!(sem_vinculo.tipo, "tileset");
        assert_eq!(sem_vinculo.identidade.plain_sha256, sha256_hex(&tiles));
        assert!(
            sem_vinculo.motivo.contains("ponteiro"),
            "{}",
            sem_vinculo.motivo
        );
        for hdr in [TS_HDR, TM_HDR, PAL_HDR] {
            assert!(
                !ctx.sem_vinculo
                    .iter()
                    .any(|r| r.identidade.header_offset == hdr as u64),
                "{hdr:#x} está vinculado a uma imagem"
            );
        }
    }

    #[test]
    fn contexto_relido_do_arquivo_revalida_a_identidade_e_vinculo_que_nao_verifica_e_registrado() {
        let dir = std::env::temp_dir().join(format!("rds-rex-contexto-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir temporário");
        let caminho = dir.join("rom.bin");

        let tiles = tiles_autorais(NUM_TILES);
        let fixture = rom_de_cadeia(&tiles, &paleta_autoral(4), &CELULAS, 3, 2);
        std::fs::write(&caminho, &fixture.rom).expect("escrever ROM");
        let primeiro =
            contexto_da_rom_path(caminho.to_str().expect("utf-8")).expect("contexto pelo caminho");
        assert_eq!(primeiro.rom_sha256, sha256_hex(&fixture.rom));
        assert_eq!(primeiro.imagens.len(), 1);

        // O header passa a declarar um codec para o qual esta frente não tem
        // decoder: o vínculo deixa de verificar. Tem que aparecer como recusa,
        // não sumir em silêncio, e a identidade da ROM tem que mudar.
        let mut adulterado = fixture.rom.clone();
        adulterado[TS_HDR + 1] = 0;
        std::fs::write(&caminho, &adulterado).expect("regravar ROM");
        let depois =
            contexto_da_rom_path(caminho.to_str().expect("utf-8")).expect("contexto pelo caminho");
        assert_ne!(
            depois.rom_sha256, primeiro.rom_sha256,
            "identidade trocada teria que ser visível"
        );
        assert!(depois.imagens.is_empty(), "vínculo não pode sobreviver");
        let recusado = depois
            .recusados
            .iter()
            .find(|r| r.struct_offset == IMG as u64)
            .expect("recusa registrada, não silenciada");
        assert!(
            recusado.motivo.contains(&format!("{IMG:#x}")),
            "{}",
            recusado.motivo
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    // ============================================ ACEITE na fixture autoral ==
    //
    // A fixture é uma ROM compilada pelo SGDK/rescomp 2.11 pinado a partir de
    // `scripts/rex_profiles/integrator/context_fixture/`. O esperado nasce do
    // fonte do fixture, ANTES da compilação, e é validado por decoder externo
    // (`apj.jar`) — nada aqui ecoa o renderer do produto.
    //
    // O manifesto de ground truth é lido **só por este teste**. Nenhum offset
    // do produto vem dele: a localização é varredura + decode + ponteiro do
    // struct `Image` seguido.

    const FIXTURE_ROM_SHA256: &str =
        "705b72eb848fadf11cdefd4302ef8c6751d005bd1c762918aea3b0860b20da86";
    const FIXTURE_SCHEMA: &str = "rex-context-aplib-fixture-ground-truth/v1";

    /// Tudo que o produto localiza sozinho numa ROM compilada.
    struct DescobertaDoAceite {
        recursos: Vec<RecursoVerificado>,
        mapas: Vec<VerifiedTilemap>,
        candidatos_de_paleta: Vec<PaletteCandidate>,
        cadeias: Vec<CadeiaImagem>,
    }

    fn descobrir_do_aceite(rom: &[u8]) -> DescobertaDoAceite {
        let limites = AplibLimits::default();
        let conjunto = verify_resource_set(rom, &TransactionLimits::default())
            .expect("conjunto de recursos verificados");
        let mapas: Vec<VerifiedTilemap> = scan_tilemap_headers(rom)
            .iter()
            .filter_map(|c| verificar_tilemap(rom, c, &limites).ok())
            .collect();
        let candidatos_de_paleta = scan_palette_headers(rom);
        let cadeias = localizar_cadeias_imagem(
            rom,
            &candidatos_de_paleta
                .iter()
                .map(|c| c.header_offset)
                .collect::<Vec<_>>(),
            &conjunto
                .resources
                .iter()
                .map(|r| r.candidate().header_offset)
                .collect::<Vec<_>>(),
            &mapas
                .iter()
                .map(|m| m.candidate.header_offset)
                .collect::<Vec<_>>(),
        );
        DescobertaDoAceite {
            recursos: conjunto.resources,
            mapas,
            candidatos_de_paleta,
            cadeias,
        }
    }

    impl DescobertaDoAceite {
        fn recurso(&self, header: usize) -> &RecursoVerificado {
            self.recursos
                .iter()
                .find(|r| r.candidate().header_offset == header)
                .expect("recurso verificado no header da cadeia")
        }

        fn mapa(&self, header: usize) -> &VerifiedTilemap {
            self.mapas
                .iter()
                .find(|m| m.candidate.header_offset == header)
                .expect("mapa verificado no header da cadeia")
        }

        fn mapa_de(&self, cols: usize, rows: usize) -> &VerifiedTilemap {
            let achados: Vec<&VerifiedTilemap> = self
                .mapas
                .iter()
                .filter(|m| m.candidate.w == cols && m.candidate.h == rows)
                .collect();
            assert_eq!(
                achados.len(),
                1,
                "esperava um mapa verificado {cols}x{rows}, achei {} de {} verificados",
                achados.len(),
                self.mapas.len()
            );
            achados[0]
        }
    }

    /// A cadeia que aponta para o mapa autoral: única, por ponteiro conferido.
    fn cadeia_do_mapa<'a>(d: &'a DescobertaDoAceite, mapa: &VerifiedTilemap) -> &'a CadeiaImagem {
        let achadas: Vec<&CadeiaImagem> = d
            .cadeias
            .iter()
            .filter(|c| c.tilemap_header == mapa.candidate.header_offset)
            .collect();
        assert_eq!(
            achadas.len(),
            1,
            "a associação tem que vir de um único ponteiro seguido, não de \
             proximidade: {} cadeias para o mapa em {:#x}",
            achadas.len(),
            mapa.candidate.header_offset
        );
        achadas[0]
    }

    fn paleta_da_cadeia(
        rom: &[u8],
        d: &DescobertaDoAceite,
        cadeia: &CadeiaImagem,
    ) -> VerifiedPalette {
        let candidato = d
            .candidatos_de_paleta
            .iter()
            .find(|c| c.header_offset == cadeia.palette_header)
            .expect("a cadeia aponta para um header varrido");
        verificar_palette(rom, candidato).expect("paleta estruturalmente legível")
    }

    fn fixture() -> (std::path::PathBuf, Vec<u8>, String, serde_json::Value) {
        let recebido = std::env::var("RDS_REX_CTX_FIXTURE_ROM")
            .expect("RDS_REX_CTX_FIXTURE_ROM ausente (aceite exige arquivo)");
        let caminho = std::path::PathBuf::from(&recebido);
        assert!(
            caminho.is_absolute(),
            "RDS_REX_CTX_FIXTURE_ROM tem de ser absoluto (recebido: {recebido})"
        );
        let rom = std::fs::read(&caminho).expect("fixture ROM ausente");
        // Identidade da fixture: sem este pin o teste poderia rodar contra
        // qualquer ROM e a expectativa autoral perderia o vínculo.
        let sha = super::super::rom_library::sha256_hex(&rom);
        assert_eq!(
            sha, FIXTURE_ROM_SHA256,
            "fixture ROM inesperada: {sha} (rebuild alterou os bytes — reconfira a origem antes de atualizar o pin)"
        );
        let manifesto_path = caminho
            .parent()
            .and_then(|out| out.parent())
            .unwrap_or_else(|| {
                panic!(
                    "esperava <project>/out/rom.bin para derivar o manifesto, recebido {recebido}"
                )
            })
            .join("ground_truth.json");
        let bruto = std::fs::read(&manifesto_path)
            .unwrap_or_else(|e| panic!("sem manifesto em {}: {e}", manifesto_path.display()));
        let manifesto: serde_json::Value =
            serde_json::from_slice(&bruto).expect("manifesto ilegível");
        assert_eq!(texto_do(&manifesto, "schema"), FIXTURE_SCHEMA);
        assert!(bool_do(&manifesto, "authored_fixture"));
        assert!(
            !bool_do(&manifesto, "derived_from_compiled_rom"),
            "o esperado tem que anteceder a compilação"
        );
        (caminho, rom, sha, manifesto)
    }

    fn texto_do(v: &serde_json::Value, chave: &str) -> String {
        v.get(chave)
            .and_then(|x| x.as_str())
            .unwrap_or_else(|| panic!("manifesto sem o campo textual {chave}"))
            .to_string()
    }

    fn bool_do(v: &serde_json::Value, chave: &str) -> bool {
        v.get(chave)
            .and_then(|x| x.as_bool())
            .unwrap_or_else(|| panic!("manifesto sem o campo booleano {chave}"))
    }

    fn numero_do(v: &serde_json::Value, chave: &str) -> u64 {
        v.get(chave)
            .and_then(|x| x.as_u64())
            .unwrap_or_else(|| panic!("manifesto sem o campo numérico {chave}"))
    }

    fn campo_do<'a>(v: &'a serde_json::Value, secao: &str) -> &'a serde_json::Value {
        v.get(secao)
            .unwrap_or_else(|| panic!("manifesto sem a seção {secao}"))
    }

    fn bytes_hex_do(v: &serde_json::Value, secao: &str, chave: &str) -> Vec<u8> {
        let hex = texto_do(campo_do(v, secao), chave);
        (0..hex.len() / 2)
            .map(|k| u8::from_str_radix(&hex[k * 2..k * 2 + 2], 16).expect("plain_hex ímpar"))
            .collect()
    }

    fn words_de(bytes: &[u8]) -> Vec<u16> {
        bytes
            .chunks_exact(2)
            .map(|par| u16::from_be_bytes([par[0], par[1]]))
            .collect()
    }

    /// Índice de paleta de um pixel no tileset chunky 4bpp, lido **aqui** (não
    /// via `md_read_pixel_index`) para que um bug no contrato do produto
    /// apareça como divergência em vez de eco.
    fn indice_do_pixel(plain: &[u8], tile: usize, row: usize, col: usize) -> u8 {
        let byte = plain[tile * 32 + row * 4 + col / 2];
        if col % 2 == 0 {
            byte >> 4
        } else {
            byte & 0x0F
        }
    }

    /// Camada esperada recomposta do manifesto: célula por célula, com o flip e
    /// o banco que o autor registrou, e índice 0 como transparente.
    fn camada_esperada(manifesto: &serde_json::Value) -> Vec<[u8; 4]> {
        let plain = bytes_hex_do(manifesto, "tileset", "plain_hex");
        let mapa = campo_do(manifesto, "map");
        let largura = numero_do(mapa, "cols") as usize * 8;
        let altura = numero_do(mapa, "rows") as usize * 8;
        let rgb8: Vec<Vec<[u8; 3]>> = campo_do(manifesto, "palette")
            .get("rgb8")
            .and_then(|x| x.as_array())
            .expect("palette.rgb8")
            .iter()
            .map(|banco| {
                banco
                    .as_array()
                    .expect("banco de cores")
                    .iter()
                    .map(|cor| {
                        let c = cor.as_array().expect("tripla RGB");
                        [
                            numero_do_json(&c[0]) as u8,
                            numero_do_json(&c[1]) as u8,
                            numero_do_json(&c[2]) as u8,
                        ]
                    })
                    .collect()
            })
            .collect();
        let celulas = mapa
            .get("cells_table")
            .and_then(|x| x.as_array())
            .expect("map.cells_table");
        let mut saida = vec![[0u8; 4]; largura * altura];
        for celula in celulas {
            let (col, row) = (
                numero_do(celula, "col") as usize,
                numero_do(celula, "row") as usize,
            );
            let tile = numero_do(celula, "tile") as usize;
            let banco = numero_do(celula, "bank") as usize;
            let flip = texto_do(celula, "flip");
            // "B" é os dois flips; "" não é substring de nada (a armadilha que
            // o gerador do fixture documenta).
            let (v, h) = (flip == "V" || flip == "B", flip == "H" || flip == "B");
            for r in 0..8 {
                for k in 0..8 {
                    let (rs, ks) = (if v { 7 - r } else { r }, if h { 7 - k } else { k });
                    let idx = indice_do_pixel(&plain, tile, rs, ks);
                    saida[(row * 8 + r) * largura + col * 8 + k] = if idx == 0 {
                        [0, 0, 0, 0]
                    } else {
                        let [r, g, b] = rgb8[banco][idx as usize];
                        [r, g, b, 255]
                    };
                }
            }
        }
        saida
    }

    fn numero_do_json(v: &serde_json::Value) -> u64 {
        v.as_u64().expect("número no manifesto")
    }

    /// (coluna, linha, flip) de cada ocorrência listada pelo manifesto para um
    /// tile, na chave `map.occurrences_por_tile`.
    fn ocorrencias_do_manifesto(
        manifesto: &serde_json::Value,
        tile: usize,
    ) -> Vec<(usize, usize, String)> {
        campo_do(manifesto, "map")
            .get("occurrences_por_tile")
            .and_then(|x| x.get(&tile.to_string()))
            .and_then(|x| x.as_array())
            .unwrap_or_else(|| panic!("manifesto sem ocorrências do tile {tile}"))
            .iter()
            .map(|c| {
                (
                    numero_do(c, "col") as usize,
                    numero_do(c, "row") as usize,
                    texto_do(c, "flip"),
                )
            })
            .collect()
    }

    fn flip_da_celula(c: &Celula) -> String {
        match (c.hflip, c.vflip) {
            (false, false) => String::new(),
            (true, false) => "H".into(),
            (false, true) => "V".into(),
            (true, true) => "B".into(),
        }
    }

    fn posicoes_previstas(manifesto: &serde_json::Value) -> Vec<(usize, usize)> {
        campo_do(manifesto, "edicao_canonica")
            .get("posicoes_de_tela_previstas")
            .and_then(|x| x.as_array())
            .expect("edicao_canonica.posicoes_de_tela_previstas")
            .iter()
            .map(|p| (numero_do(p, "x") as usize, numero_do(p, "y") as usize))
            .collect()
    }

    #[test]
    #[ignore = "aceite de fixture autoral: requer ROM compilada; rodar com --ignored"]
    fn fixture_aplib_descobre_a_cadeia_compoe_a_camada_e_preve_o_impacto() {
        let (_caminho, rom, sha, manifesto) = fixture();
        let inicio = std::time::Instant::now();
        let mut etapas: Vec<(&str, std::time::Duration)> = Vec::new();
        let marcar = |etapa: &'static str,
                      inicio: &std::time::Instant,
                      saida: &mut Vec<(&str, std::time::Duration)>| {
            saida.push((etapa, inicio.elapsed()));
        };

        // (1) Descoberta pelo caminho canônico: varredura + decode + ponteiro.
        let d = descobrir_do_aceite(&rom);
        let mut agora = std::time::Instant::now();
        marcar("descobrir", &agora, &mut etapas);
        agora = std::time::Instant::now();

        // O TileMap da imagem composta e o ghost: dois mapas aPLib verificados,
        // cada um decodificando exatamente para (w*h)*2 — a compressão esperada
        // está conferida NO ARTEFATO, não pressuposta pelo `.res`.
        assert!(
            d.mapas.len() >= 2,
            "a fixture declara dois TileMaps; verificados: {}",
            d.mapas.len()
        );
        let mapa = d.mapa_de(
            numero_do(campo_do(&manifesto, "map"), "cols") as usize,
            numero_do(campo_do(&manifesto, "map"), "rows") as usize,
        );
        let ghost = d.mapa_de(
            numero_do(campo_do(&manifesto, "ghost"), "cols") as usize,
            numero_do(campo_do(&manifesto, "ghost"), "rows") as usize,
        );
        for (rotulo, m, secao) in [("mapa", &mapa, "map"), ("ghost", &ghost, "ghost")] {
            assert_eq!(
                m.candidate.compression,
                HeaderCompression::Aplib,
                "{rotulo}: o rescomp pinado não emitiu aPLib no artefato"
            );
            assert_eq!(
                words_de(&bytes_hex_do(&manifesto, secao, "plain_hex")),
                m.cells,
                "{rotulo}: células decodificadas divergem do esperado autoral"
            );
            assert_eq!(
                super::super::rom_library::sha256_hex(&bytes_hex_do(
                    &manifesto,
                    secao,
                    "plain_hex"
                )),
                texto_do(campo_do(&manifesto, secao), "plain_sha256"),
                "{rotulo}: manifesto internamente inconsistente"
            );
        }

        // A cadeia `Image` é o único vínculo aceito, e o ghost não tem vínculo:
        // `ctx_ghost_image` foi descartado pelo linker, então não há ponteiro.
        let cadeia = cadeia_do_mapa(&d, &mapa);
        assert!(
            d.cadeias
                .iter()
                .all(|c| c.tilemap_header != ghost.candidate.header_offset),
            "o ghost foi descartado pelo linker: associá-lo seria adivinhação"
        );
        let tileset = d.recurso(cadeia.tileset_header);
        assert_eq!(
            tileset.candidate().compression,
            HeaderCompression::Aplib,
            "tileset da cadeia tem que estar comprimido no artefato"
        );
        let plain_tileset = bytes_hex_do(&manifesto, "tileset", "plain_hex");
        assert_eq!(
            super::super::rom_library::sha256_hex(&plain_tileset),
            texto_do(campo_do(&manifesto, "tileset"), "plain_sha256")
        );
        assert_eq!(
            tileset.decoded(),
            plain_tileset.as_slice(),
            "o decode do produto divergiu do tileset autoral"
        );
        assert_eq!(
            tileset.candidate().num_tiles,
            numero_do(campo_do(&manifesto, "tileset"), "num_tile") as usize
        );
        let paleta = paleta_da_cadeia(&rom, &d, cadeia);
        assert_eq!(
            paleta.words,
            words_de(&bytes_hex_do(&manifesto, "palette", "plain_hex")),
            "as palavras lidas da ROM divergem da paleta autoral"
        );
        marcar("conferir estruturas", &agora, &mut etapas);

        // (2) Convenção de cor conferida contra o oráculo independente: a
        //     palavra 68k da ROM vira o RGB que o autor escreveu.
        let agora = std::time::Instant::now();
        let rgb8 = campo_do(&manifesto, "palette").get("rgb8").unwrap();
        for (banco, cores) in rgb8.as_array().unwrap().iter().enumerate() {
            for (i, cor) in cores.as_array().unwrap().iter().enumerate() {
                let esperada: Vec<u8> = cor
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(numero_do_json)
                    .map(|v| v as u8)
                    .collect();
                let lida = md_color_word_to_rgb(paleta.words[banco * 16 + i]);
                assert_eq!(
                    lida.to_vec(),
                    esperada,
                    "cor do banco {banco} índice {i}: a escala do produto divergiu do fixture"
                );
            }
        }
        marcar("conferir cores", &agora, &mut etapas);

        // (3) Reconstrução da camada, pixel a pixel contra o esperado autoral.
        let agora = std::time::Instant::now();
        let camada = compor_camada(tileset.decoded(), &mapa, &paleta).expect("camada composta");
        assert_eq!(camada.width as usize * camada.height as usize, {
            numero_do(campo_do(&manifesto, "composed_layer"), "largura") as usize
                * numero_do(campo_do(&manifesto, "composed_layer"), "altura") as usize
        });
        let esperada = camada_esperada(&manifesto);
        // O esperado recomposto tem que ser O esperado do oráculo, senão a
        // comparação abaixo seria entre dois erros meus.
        let rgb_packed: Vec<u8> = esperada.iter().flat_map(|p| [p[0], p[1], p[2]]).collect();
        assert_eq!(
            super::super::rom_library::sha256_hex(&rgb_packed),
            texto_do(campo_do(&manifesto, "composed_layer"), "pixels_sha256"),
            "a recomposição do teste não reproduz o PNG esperado do fixture"
        );
        let plana: Vec<u8> = esperada.iter().flat_map(|p| p.iter().copied()).collect();
        assert_eq!(
            camada.rgba, plana,
            "a prévia composta divergiu do esperado autoral (flip, banco ou transparência)"
        );
        // Índice 0 é transparente na camada, e o banco 0 da fixture tem índice
        // 0 colorido justamente para isso ser conferível.
        let transparentes = esperada.iter().filter(|p| p[3] == 0).count();
        assert!(
            transparentes > 0,
            "sem pixels de índice 0 o caso de transparência não discriminaria nada"
        );
        marcar("compor camada", &agora, &mut etapas);

        // (4) Clique em célula com flip → pixel da fonte atingido, nas quatro
        //     posições que o fixture previu ANTES de compilar.
        let agora = std::time::Instant::now();
        let edicao = campo_do(&manifesto, "edicao_canonica");
        let fonte = campo_do(edicao, "pixel_fonte");
        let (t_fonte, r_fonte, c_fonte) = (
            numero_do(fonte, "tile") as usize,
            numero_do(fonte, "row") as usize,
            numero_do(fonte, "col") as usize,
        );
        let previstas = posicoes_previstas(&manifesto);
        assert_eq!(
            previstas.len(),
            numero_do(edicao, "ocorrencias_no_mapa_verificado") as usize
        );
        for (x, y) in &previstas {
            let celula = celula_em(&mapa, *x, *y).unwrap_or_else(|e| {
                panic!("clique ({x},{y}) fora do mapa verificado: {}", e.detail)
            });
            assert_eq!(
                celula.fonte_do_ponto(PontoDaCamada { x: *x, y: *y }),
                Ok(PixelDaFonte {
                    tile: t_fonte,
                    row: r_fonte,
                    col: c_fonte
                }),
                "clique em ({x},{y}) não atingiu o pixel da fonte previsto"
            );
        }
        // E no sentido contrário: cada célula que referencia o tile projeta o
        // pixel da fonte exatamente na posição prevista.
        for celula in ocorrencias_do_tile(&mapa, t_fonte).expect("ocorrências") {
            let ponto = celula
                .projetar_pixel_da_fonte(r_fonte, c_fonte)
                .expect("projeção");
            assert!(
                previstas.contains(&(ponto.x, ponto.y)),
                "célula ({},{}) flip {} projetou ({},{}) fora das posições previstas",
                celula.col,
                celula.row,
                flip_da_celula(&celula),
                ponto.x,
                ponto.y
            );
        }
        marcar("clique e projeção", &agora, &mut etapas);

        // (5) Compartilhamento: tile único vs tile compartilhado, e a contagem
        //     que a UI poderá afirmar — do mapa verificado, não do jogo inteiro.
        let agora = std::time::Instant::now();
        let compartilhado = ocorrencias_do_tile(&mapa, t_fonte).expect("ocorrências do tile 2");
        assert_eq!(
            compartilhado.len(),
            numero_do(edicao, "ocorrencias_no_mapa_verificado") as usize,
            "a previsão de impacto tem que vir do mapa verificado"
        );
        let mut obtidas: Vec<(usize, usize, String)> = compartilhado
            .iter()
            .map(|c| (c.col, c.row, flip_da_celula(c)))
            .collect();
        let mut esperadas = ocorrencias_do_manifesto(&manifesto, t_fonte);
        obtidas.sort();
        esperadas.sort();
        assert_eq!(
            obtidas, esperadas,
            "as ocorrências afetadas divergem do autor"
        );
        // Os demais casos discriminantes da fixture: um tile usado uma vez e
        // outro usado duas vezes, cada um no seu banco.
        for (tile, qtd) in [(1usize, 1usize), (3, 2), (5, 1), (7, 2)] {
            assert_eq!(
                ocorrencias_do_tile(&mapa, tile).expect("ocorrências").len(),
                qtd,
                "tile {tile} deveria ocorrer {qtd} vez(es) no mapa verificado"
            );
        }
        assert!(
            ocorrencias_do_tile(&mapa, 15)
                .expect("tile sem referência")
                .is_empty(),
            "tile não referenciado não pode ganhar ocorrência"
        );
        // Prioridade aparece no mapa (caso plantado), mas não compõe oclusão
        // aqui: é limite declarado, não propriedade escondida.
        assert!(
            celulas_do_mapa(&mapa)
                .expect("células")
                .iter()
                .any(|c| c.priority),
            "a fixture perdeu a célula com prioridade alta"
        );
        marcar("compartilhamento", &agora, &mut etapas);

        // (6) A referência inválida do fixture (ghost → tile 107 fora do
        //     tileset) tem que ser RECUSADA, não pintada como ruído.
        let erro = compor_camada(tileset.decoded(), &ghost, &paleta)
            .expect_err("o ghost referencia tile fora do tileset verificado");
        assert_eq!(erro.code, "invalid_reference", "desfecho: {erro:?}");
        assert!(
            erro.detail.contains("107") && erro.detail.contains("16"),
            "a recusa tem que citar o tile referenciado e o tamanho do tileset: {}",
            erro.detail
        );

        // (7) A superfície publicada para o IPC, sobre a ROM real: mesma
        //     descoberta, agora como contexto — identidade, vínculo, prévia e
        //     clique resolvidos pelo núcleo.
        let agora = std::time::Instant::now();
        let contexto = contexto_da_rom(
            &rom,
            &TransactionLimits::default(),
            &LimiteTrabalho::default(),
        )
        .expect("contexto montado só a partir dos bytes da fixture");
        assert_eq!(contexto.rom_sha256, sha, "identidade da ROM publicada");
        assert_eq!(contexto.rom_len, rom.len() as u64);
        assert_eq!(
            contexto.imagens.len(),
            1,
            "uma cadeia `Image` na fixture; publicada: {:?}",
            contexto
                .imagens
                .iter()
                .map(|i| (i.struct_offset, i.tilemap.header_offset))
                .collect::<Vec<_>>()
        );
        assert!(
            contexto.recusados.is_empty(),
            "nada deveria recusar na fixture: {:?}",
            contexto.recusados
        );
        let publicada = &contexto.imagens[0];
        assert_eq!(publicada.proveniencia, Proveniencia::Verificada);
        assert_eq!(publicada.struct_offset, cadeia.struct_offset as u64);
        assert_eq!(
            (
                publicada.paleta.header_offset,
                publicada.tileset.header_offset,
                publicada.tilemap.header_offset
            ),
            (
                cadeia.palette_header as u64,
                cadeia.tileset_header as u64,
                cadeia.tilemap_header as u64
            ),
            "os três vínculos publicados têm que ser os descobertos"
        );
        assert_eq!(
            publicada.tileset.plain_sha256,
            super::super::rom_library::sha256_hex(tileset.decoded())
        );
        assert_eq!(
            (publicada.mapa.cols, publicada.mapa.rows),
            (mapa.candidate.w as u32, mapa.candidate.h as u32)
        );
        // O ghost é mapa verificado sem ponteiro: aparece como sem vínculo em
        // vez de sumir da resposta.
        assert!(
            contexto.sem_vinculo.iter().any(|r| {
                r.tipo == "tilemap"
                    && r.identidade.header_offset == ghost.candidate.header_offset as u64
                    && r.proveniencia == Proveniencia::Desconhecida
            }),
            "ghost sem vínculo não foi publicado: {:?}",
            contexto
                .sem_vinculo
                .iter()
                .map(|r| (r.tipo, r.identidade.header_offset))
                .collect::<Vec<_>>()
        );
        // A prévia publicada cobre exatamente os bytes conferidos contra o
        // oráculo externo na etapa (3).
        assert_eq!(publicada.camada.recusada, None);
        assert_eq!(
            publicada.camada.pixels_sha256.as_deref(),
            Some(super::super::rom_library::sha256_hex(&camada.rgba).as_str()),
            "o hash publicado não é o da camada conferida pixel a pixel"
        );
        let compartilhado_publicado = publicada
            .mapa
            .ocorrencias_por_tile
            .iter()
            .find(|o| o.tile == t_fonte as u32)
            .expect("tile compartilhado no contexto");
        assert_eq!(
            compartilhado_publicado.celulas.len(),
            numero_do(edicao, "ocorrencias_no_mapa_verificado") as usize
        );
        // Cada uma das quatro posições previstas, resolvida pelo núcleo a partir
        // só do offset do struct: cai no mesmo pixel da fonte e no mesmo índice.
        for (x, y) in &previstas {
            let resposta = contexto_clique(
                &rom,
                publicada.struct_offset,
                *x,
                *y,
                &TransactionLimits::default(),
            )
            .unwrap_or_else(|e| panic!("clique ({x},{y}) pela superfície: {}", e.detail));
            assert_eq!(
                (
                    resposta.fonte.tile,
                    resposta.fonte.linha,
                    resposta.fonte.coluna
                ),
                (t_fonte as u32, r_fonte as u32, c_fonte as u32),
                "clique ({x},{y})"
            );
            assert_eq!(
                resposta.fonte.indice,
                numero_do(fonte, "de") as u8,
                "índice de paleta sob o cursor diverge do autoral em ({x},{y})"
            );
            assert_eq!(resposta.rom_sha256, sha);
            assert_eq!(
                resposta.ocorrencias.len(),
                compartilhado_publicado.celulas.len(),
                "a resposta do clique tem que levar as irmãs do tile"
            );
        }
        marcar("superfície do contexto", &agora, &mut etapas);

        for (etapa, duracao) in &etapas {
            eprintln!("[rex-ctx-aceite] etapa {etapa}: {duracao:?}");
        }
        eprintln!(
            "[rex-ctx-aceite] total {} | recursos verificados {} | mapas {} | cadeias {}",
            inicio.elapsed().as_millis(),
            d.recursos.len(),
            d.mapas.len(),
            d.cadeias.len()
        );
    }

    #[test]
    #[ignore = "sonda de custo: requer ROM compilada; rodar com --ignored"]
    fn sonda_de_custo_da_descoberta_na_fixture() {
        let (_caminho, rom, _sha, _manifesto) = fixture();
        let t = std::time::Instant::now;
        let inicio = t();
        let candidatos_tilemap = scan_tilemap_headers(&rom);
        eprintln!(
            "[rex-ctx-custo] scan_tilemap_headers: {:?} ({} candidatos)",
            inicio.elapsed(),
            candidatos_tilemap.len()
        );
        let inicio = t();
        let candidatos_tileset = scan_tileset_headers(&rom);
        eprintln!(
            "[rex-ctx-custo] scan_tileset_headers: {:?} ({} candidatos)",
            inicio.elapsed(),
            candidatos_tileset.len()
        );
        let inicio = t();
        let paletas = scan_palette_headers(&rom);
        eprintln!(
            "[rex-ctx-custo] scan_palette_headers: {:?} ({} candidatos)",
            inicio.elapsed(),
            paletas.len()
        );
        let inicio = t();
        let set = verify_resource_set(&rom, &TransactionLimits::default()).expect("set");
        eprintln!(
            "[rex-ctx-custo] verify_resource_set: {:?} ({} verificados de {})",
            inicio.elapsed(),
            set.resources.len(),
            set.candidates
        );
        let limites = AplibLimits::default();
        let inicio = t();
        let mut decodificados = 0usize;
        let mapas: Vec<VerifiedTilemap> = candidatos_tilemap
            .iter()
            .filter(|c| c.compression == HeaderCompression::Aplib)
            .filter_map(|c| {
                let r = verificar_tilemap(&rom, c, &limites);
                if r.is_ok() {
                    decodificados += 1;
                }
                r.ok()
            })
            .collect();
        eprintln!(
            "[rex-ctx-custo] verificar tilemaps: {:?} ({} verificados, {} decodes tentados)",
            inicio.elapsed(),
            mapas.len(),
            decodificados
        );
        let inicio = t();
        let cadeias = localizar_cadeias_imagem(
            &rom,
            &paletas.iter().map(|c| c.header_offset).collect::<Vec<_>>(),
            &candidatos_tileset
                .iter()
                .map(|c| c.header_offset)
                .collect::<Vec<_>>(),
            &mapas
                .iter()
                .map(|m| m.candidate.header_offset)
                .collect::<Vec<_>>(),
        );
        eprintln!(
            "[rex-ctx-custo] localizar_cadeias_imagem: {:?} ({} cadeias)",
            inicio.elapsed(),
            cadeias.len()
        );
        let trabalho = LimiteTrabalho::default();
        for cadeia in &cadeias {
            let descoberta = descobrir(&rom, &TransactionLimits::default()).expect("descoberta");
            let inicio = t();
            contexto_da_cadeia(&rom, cadeia, &descoberta, &trabalho).expect("contexto");
            eprintln!(
                "[rex-ctx-custo] contexto_da_cadeia em {:#x}: {:?}",
                cadeia.struct_offset,
                inicio.elapsed()
            );
        }
        let inicio = t();
        contexto_da_rom(&rom, &TransactionLimits::default(), &trabalho).expect("contexto");
        eprintln!(
            "[rex-ctx-custo] contexto_da_rom (passada completa): {:?}",
            inicio.elapsed()
        );
    }

    #[test]
    #[ignore = "aceite de fixture autoral: requer ROM compilada; rodar com --ignored"]
    fn fixture_aplib_edita_pela_transacao_canonica_e_o_diff_e_exatamente_o_previsto() {
        let (caminho, rom, sha, manifesto) = fixture();
        let d = descobrir_do_aceite(&rom);
        let mapa = d.mapa_de(
            numero_do(campo_do(&manifesto, "map"), "cols") as usize,
            numero_do(campo_do(&manifesto, "map"), "rows") as usize,
        );
        let cadeia = cadeia_do_mapa(&d, &mapa);
        let tileset = d.recurso(cadeia.tileset_header);
        let paleta = paleta_da_cadeia(&rom, &d, cadeia);
        let camada_antes = compor_camada(tileset.decoded(), mapa, &paleta).expect("camada antes");

        let edicao = campo_do(&manifesto, "edicao_canonica");
        let fonte = campo_do(edicao, "pixel_fonte");
        let (tile, row, col) = (
            numero_do(fonte, "tile") as usize,
            numero_do(fonte, "row") as usize,
            numero_do(fonte, "col") as usize,
        );
        let (de, para) = (numero_do(fonte, "de") as u8, numero_do(fonte, "para") as u8);
        assert_eq!(
            indice_do_pixel(tileset.decoded(), tile, row, col),
            de,
            "o pixel plantado na fixture mudou: a edição deixaria de ser a prevista"
        );

        let resultado = apply_resource_edit(
            &caminho.to_string_lossy(),
            tileset.candidate().stream_offset as u64,
            &[PixelEdit {
                tile: tile as u32,
                row: row as u32,
                col: col as u32,
                index: para,
            }],
            &sha,
        )
        .expect("transação canônica");
        assert_eq!(resultado.outcome, "applied", "desfecho: {resultado:?}");
        assert_eq!(resultado.codec, "aplib");
        assert_eq!(resultado.rom_sha256, sha);
        let caminho_novo = std::path::PathBuf::from(
            resultado
                .modified_rom_path
                .clone()
                .expect("edição aplicada sem ROM modificada"),
        );
        let rom_novo = std::fs::read(&caminho_novo).expect("ROM modificada ausente");
        assert_eq!(
            resultado.modified_rom_sha256.as_deref(),
            Some(super::super::rom_library::sha256_hex(&rom_novo).as_str()),
            "o hash registrado não é o do arquivo materializado"
        );
        assert_ne!(
            resultado.modified_rom_sha256.as_deref().unwrap(),
            sha.as_str(),
            "edição aplicada sem alterar a ROM"
        );
        let bps = std::path::PathBuf::from(
            resultado
                .patch_bps_path
                .clone()
                .expect("edição aplicada sem patch BPS"),
        );
        assert!(bps.is_file(), "patch BPS não materializado");
        assert_eq!(
            resultado.patch_bps_sha256.as_deref(),
            Some(
                super::super::rom_library::sha256_hex(&std::fs::read(&bps).expect("BPS ilegível"))
                    .as_str()
            )
        );
        assert!(
            resultado.verified_preserved.unwrap_or(0) >= 1,
            "a transação não registrou dependentes preservados: {resultado:?}"
        );

        // Reabertura pelo caminho canônico: a ROM editada continua parseável e
        // só o byte do pixel de origem mudou.
        let d_novo = descobrir_do_aceite(&rom_novo);
        let mapa_novo = d_novo.mapa_de(
            numero_do(campo_do(&manifesto, "map"), "cols") as usize,
            numero_do(campo_do(&manifesto, "map"), "rows") as usize,
        );
        let cadeia_nova = cadeia_do_mapa(&d_novo, &mapa_novo);
        assert_eq!(
            cadeia_nova, cadeia,
            "a cadeia mudou de endereço com a edição"
        );
        let tileset_novo = d_novo.recurso(cadeia_nova.tileset_header);
        let (antigo, novo) = (tileset.decoded(), tileset_novo.decoded());
        assert_eq!(antigo.len(), novo.len(), "o tileset mudou de tamanho");
        let diferentes: Vec<usize> = (0..antigo.len())
            .filter(|i| antigo[*i] != novo[*i])
            .collect();
        assert_eq!(
            diferentes,
            vec![tile * 32 + row * 4 + col / 2],
            "a edição tocou bytes fora do pixel previsto"
        );
        assert_eq!(indice_do_pixel(novo, tile, row, col), para);
        assert_eq!(mapa_novo.cells, mapa.cells, "o mapa verificado mudou");
        let paleta_nova = paleta_da_cadeia(&rom_novo, &d_novo, cadeia_nova);
        assert_eq!(paleta_nova.words, paleta.words, "a paleta verificada mudou");

        // O diff da camada compostas são EXATAMENTE as posições previstas — nem
        // uma a mais (vazamento) nem uma a menos (predição falsa).
        let camada_depois = compor_camada(novo, &mapa_novo, &paleta_nova).expect("camada depois");
        assert_eq!(camada_depois.rgba.len(), camada_antes.rgba.len());
        let largura = camada_antes.width as usize;
        let mudaram: Vec<(usize, usize)> = (0..camada_antes.rgba.len() / 4)
            .filter(|i| {
                camada_antes.rgba[*i * 4..*i * 4 + 4] != camada_depois.rgba[*i * 4..*i * 4 + 4]
            })
            .map(|i| (i % largura, i / largura))
            .collect();
        let previstas = posicoes_previstas(&manifesto);
        assert_eq!(
            mudaram, previstas,
            "as posições alteradas na camada têm que ser as previstas antes da compilação"
        );
        let banco0 = campo_do(&manifesto, "palette").get("rgb8").unwrap()[0]
            .as_array()
            .unwrap()[para as usize]
            .as_array()
            .unwrap()
            .iter()
            .map(numero_do_json)
            .map(|v| v as u8)
            .collect::<Vec<u8>>();
        for (x, y) in &previstas {
            let i = (y * largura + x) * 4;
            assert_eq!(
                &camada_depois.rgba[i..i + 3],
                banco0.as_slice(),
                "pixel ({x},{y}) não recebeu a cor prevista do banco 0"
            );
        }
        eprintln!(
            "[rex-ctx-aceite] edição canônica: {} ocorrências previstas, BPS {}, artefato {}",
            previstas.len(),
            bps.display(),
            caminho_novo.display()
        );
    }
}
