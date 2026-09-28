//! Parser de SFF v1 (Elecbyte): sprites PCX 8 bpp com indices e paleta preservados.
//!
//! Layout: cabecalho de 512 B (`ElecbyteSpr\0`, versao em 12..16, `n_images` em 20,
//! primeiro subarquivo em 24); cada subarquivo tem subcabecalho de 32 B
//! (`next`, `len`, eixo x/y, grupo, imagem, link, `same_palette`) seguido do PCX.
//! `len == 0` = link para um sprite anterior. SFF v2 e recusado.
//!
//! Limites (arquivo e dados, nao instrucoes): tamanho do arquivo, numero de imagens,
//! dimensoes e bytes decodificados. Ciclos de `next`, links para frente/inexistentes e
//! pares (grupo, imagem) duplicados geram diagnostico; nada e aceito em silencio.

use std::collections::{BTreeMap, HashSet};

use crate::diag::{Diagnostic, Severity, SourceLoc};

pub const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_IMAGES: usize = 8192;
pub const MAX_DIM: usize = 1024;
pub const MAX_DECODED_BYTES: usize = 64 * 1024 * 1024;

pub type Rgb = [u8; 3];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sprite {
    pub group: i32,
    pub image: i32,
    pub axis_x: i32,
    pub axis_y: i32,
    pub width: usize,
    pub height: usize,
    /// Indices 8 bits, linha a linha; 0 = transparente.
    pub pixels: Vec<u8>,
    pub palette: Vec<Rgb>,
    /// Indice do subarquivo de origem quando era link.
    pub linked_from: Option<usize>,
    pub index: usize,
    /// Offset do subcabecalho no arquivo.
    pub offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sff {
    pub file: String,
    pub version: [u8; 4],
    pub sprites: BTreeMap<(i32, i32), Sprite>,
    pub diagnostics: Vec<Diagnostic>,
}

fn u16le(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes([*b.get(at)?, *b.get(at + 1)?]))
}

fn u32le(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
        *b.get(at + 2)?,
        *b.get(at + 3)?,
    ]))
}

type Decoded = (usize, usize, Vec<u8>, Option<Vec<Rgb>>);

fn decode_pcx(blob: &[u8], budget: &mut usize) -> Result<Decoded, String> {
    if blob.len() < 128 {
        return Err("PCX truncado (cabecalho < 128 B)".into());
    }
    let (bpp, planes) = (blob[3], blob[65]);
    if bpp != 8 || planes != 1 {
        return Err(format!(
            "PCX {bpp} bpp / {planes} planos nao suportado (so 8 bpp, 1 plano)"
        ));
    }
    let (xmin, ymin) = (
        u16le(blob, 4).unwrap() as usize,
        u16le(blob, 6).unwrap() as usize,
    );
    let (xmax, ymax) = (
        u16le(blob, 8).unwrap() as usize,
        u16le(blob, 10).unwrap() as usize,
    );
    if xmax < xmin || ymax < ymin {
        return Err("PCX com janela invalida".into());
    }
    let (w, h) = (xmax - xmin + 1, ymax - ymin + 1);
    let bpl = u16le(blob, 66).unwrap() as usize;
    if w > MAX_DIM || h > MAX_DIM {
        return Err(format!("PCX {w}x{h} excede o limite {MAX_DIM}x{MAX_DIM}"));
    }
    if bpl < w {
        return Err(format!(
            "PCX com bytes por linha ({bpl}) menor que a largura ({w})"
        ));
    }
    let total = bpl * h;
    if total > *budget {
        return Err("PCX excede o orcamento de bytes decodificados".into());
    }
    *budget -= total;
    let has_palette = blob.len() >= 128 + 769 && blob[blob.len() - 769] == 0x0C;
    let end = if has_palette {
        blob.len() - 769
    } else {
        blob.len()
    };
    let mut out = Vec::with_capacity(total);
    let mut pos = 128;
    while out.len() < total && pos < end {
        let b = blob[pos];
        pos += 1;
        if b >= 0xC0 {
            let run = (b & 0x3F) as usize;
            let Some(&value) = blob.get(pos).filter(|_| pos < end) else {
                return Err("PCX truncado dentro de uma sequencia RLE".into());
            };
            pos += 1;
            out.extend(std::iter::repeat(value).take(run.min(total - out.len())));
        } else {
            out.push(b);
        }
    }
    if out.len() < total {
        return Err(format!("PCX truncado: {} de {total} bytes", out.len()));
    }
    let pixels = (0..h)
        .flat_map(|r| out[r * bpl..r * bpl + w].iter().copied())
        .collect();
    let palette = has_palette.then(|| {
        blob[blob.len() - 768..]
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect()
    });
    Ok((w, h, pixels, palette))
}

pub fn parse(data: &[u8], file: &str) -> Result<Sff, Diagnostic> {
    let fatal = |code, offset: u64, msg: String, action: &str| {
        Diagnostic::new(
            code,
            Severity::Error,
            SourceLoc::offset(file, offset),
            msg,
            action,
        )
    };
    if data.len() > MAX_FILE_BYTES {
        return Err(fatal(
            "sff.limit.file_size",
            0,
            format!(
                "SFF com {} bytes excede o limite de {MAX_FILE_BYTES}",
                data.len()
            ),
            "Reduza o arquivo ou divida o personagem.",
        ));
    }
    if data.len() < 32 || !data.starts_with(b"ElecbyteSpr\0") {
        return Err(fatal(
            "sff.header.signature",
            0,
            "assinatura 'ElecbyteSpr' ausente ou arquivo truncado".into(),
            "Selecione um .sff valido.",
        ));
    }
    let version = [data[15], data[14], data[13], data[12]];
    if version[0] != 1 {
        return Err(fatal(
            "sff.version.unsupported",
            12,
            format!(
                "SFF v{}.{}.{}.{} nao suportado (so v1)",
                version[0], version[1], version[2], version[3]
            ),
            "Converta o SFF para v1 (ex.: com o editor do MUGEN 1.0) ou aguarde suporte a v2.",
        ));
    }
    let n_images = u32le(data, 20).unwrap() as usize;
    let first = u32le(data, 24).unwrap() as usize;
    if n_images > MAX_IMAGES {
        return Err(fatal(
            "sff.limit.image_count",
            20,
            format!("{n_images} imagens excedem o limite de {MAX_IMAGES}"),
            "Remova sprites nao usados.",
        ));
    }
    let mut diagnostics = Vec::new();
    let mut by_index: Vec<Option<Sprite>> = Vec::new();
    let mut sprites: BTreeMap<(i32, i32), Sprite> = BTreeMap::new();
    let mut visited = HashSet::new();
    let mut prev_palette: Vec<Rgb> = vec![[0, 0, 0]; 256];
    let mut budget = MAX_DECODED_BYTES;
    let mut pos = first;
    for index in 0..n_images {
        if !visited.insert(pos) {
            diagnostics.push(fatal(
                "sff.subfile.cycle",
                pos as u64,
                format!(
                    "ciclo no encadeamento de subarquivos no indice {index}; leitura interrompida"
                ),
                "O arquivo esta corrompido; regrave o SFF.",
            ));
            break;
        }
        let Some(header) = data.get(pos..pos + 32) else {
            diagnostics.push(fatal(
                "sff.subfile.truncated",
                pos as u64,
                format!("subcabecalho {index} fora do arquivo; {index} de {n_images} lidos"),
                "O arquivo esta truncado; regrave o SFF.",
            ));
            break;
        };
        let next = u32le(header, 0).unwrap() as usize;
        let len = u32le(header, 4).unwrap() as usize;
        let axis_x = u16le(header, 8).unwrap() as i16 as i32;
        let axis_y = u16le(header, 10).unwrap() as i16 as i32;
        let group = u16le(header, 12).unwrap() as i32;
        let image = u16le(header, 14).unwrap() as i32;
        let link = u16le(header, 16).unwrap() as usize;
        let same = header[18] != 0;
        let here = SourceLoc::offset(file, pos as u64);
        let sprite = if len == 0 {
            match by_index.get(link).and_then(|s| s.as_ref()) {
                Some(src) if link < index => Some(Sprite {
                    group,
                    image,
                    axis_x,
                    axis_y,
                    linked_from: Some(link),
                    index,
                    offset: pos as u64,
                    ..src.clone()
                }),
                _ => {
                    diagnostics.push(Diagnostic::new(
                        "sff.link.invalid",
                        Severity::Error,
                        here.clone(),
                        format!("sprite {group},{image}: link para o indice {link} inexistente, posterior ou invalido"),
                        "Regrave o SFF; o sprite fica ausente.",
                    ));
                    None
                }
            }
        } else {
            match data.get(pos + 32..pos + 32 + len) {
                None => {
                    diagnostics.push(Diagnostic::new(
                        "sff.subfile.truncated",
                        Severity::Error,
                        here.clone(),
                        format!("sprite {group},{image}: dados ({len} B) alem do fim do arquivo"),
                        "O arquivo esta truncado; regrave o SFF.",
                    ));
                    None
                }
                Some(blob) => match decode_pcx(blob, &mut budget) {
                    Ok((width, height, pixels, own)) => {
                        let palette = match (same, own) {
                            (false, Some(p)) => p,
                            _ => prev_palette.clone(),
                        };
                        prev_palette = palette.clone();
                        Some(Sprite {
                            group,
                            image,
                            axis_x,
                            axis_y,
                            width,
                            height,
                            pixels,
                            palette,
                            linked_from: None,
                            index,
                            offset: pos as u64,
                        })
                    }
                    Err(e) => {
                        diagnostics.push(Diagnostic::new(
                            "sff.pcx.invalid",
                            Severity::Error,
                            here.clone(),
                            format!("sprite {group},{image}: {e}"),
                            "Regrave o sprite como PCX 8 bpp; ele fica ausente.",
                        ));
                        None
                    }
                },
            }
        };
        if let Some(s) = &sprite {
            if let Some(first) = sprites.get(&(group, image)) {
                diagnostics.push(Diagnostic::new(
                    "sff.sprite.duplicate",
                    Severity::Warning,
                    here,
                    format!(
                        "sprite {group},{image} duplicado (primeiro no indice {}); mantido o primeiro",
                        first.index
                    ),
                    "Renumere ou remova o duplicado.",
                ));
            } else {
                sprites.insert((group, image), s.clone());
            }
        }
        by_index.push(sprite);
        if next == 0 {
            if index + 1 < n_images {
                diagnostics.push(Diagnostic::new(
                    "sff.subfile.early_end",
                    Severity::Warning,
                    SourceLoc::offset(file, pos as u64),
                    format!(
                        "encadeamento termina com {} de {n_images} imagens",
                        index + 1
                    ),
                    "Confira a contagem do cabecalho.",
                ));
            }
            break;
        }
        pos = next;
    }
    Ok(Sff {
        file: file.to_string(),
        version,
        sprites,
        diagnostics,
    })
}

/// Escritor minimo de SFF v1 (para fixtures autorais reproduziveis e testes).
pub mod write {
    use super::Rgb;

    pub struct Image<'a> {
        pub group: u16,
        pub image: u16,
        pub axis_x: i16,
        pub axis_y: i16,
        pub width: u16,
        pub height: u16,
        pub pixels: &'a [u8],
        /// `None` = usa a paleta anterior (`same_palette = 1`).
        pub palette: Option<&'a [Rgb]>,
        /// `Some(i)` = link para o subarquivo `i` (sem dados).
        pub link: Option<u16>,
    }

    fn pcx(img: &Image) -> Vec<u8> {
        let mut out = vec![0u8; 128];
        out[0] = 0x0A;
        out[1] = 5;
        out[2] = 1;
        out[3] = 8;
        out[8..10].copy_from_slice(&(img.width - 1).to_le_bytes());
        out[10..12].copy_from_slice(&(img.height - 1).to_le_bytes());
        out[65] = 1;
        out[66..68].copy_from_slice(&img.width.to_le_bytes());
        for row in img.pixels.chunks(img.width as usize) {
            let mut i = 0;
            while i < row.len() {
                let v = row[i];
                let mut run = 1;
                while i + run < row.len() && row[i + run] == v && run < 63 {
                    run += 1;
                }
                if run > 1 || v >= 0xC0 {
                    out.push(0xC0 | run as u8);
                }
                out.push(v);
                i += run;
            }
        }
        if let Some(p) = img.palette {
            out.push(0x0C);
            for c in p {
                out.extend_from_slice(c);
            }
        }
        out
    }

    pub fn sff_v1(images: &[Image]) -> Vec<u8> {
        let mut out = vec![0u8; 512];
        out[..12].copy_from_slice(b"ElecbyteSpr\0");
        out[12..16].copy_from_slice(&[0, 1, 0, 1]);
        out[16..20].copy_from_slice(&1u32.to_le_bytes());
        out[20..24].copy_from_slice(&(images.len() as u32).to_le_bytes());
        out[24..28].copy_from_slice(&512u32.to_le_bytes());
        out[28..32].copy_from_slice(&32u32.to_le_bytes());
        for (i, img) in images.iter().enumerate() {
            let body = if img.link.is_some() {
                Vec::new()
            } else {
                pcx(img)
            };
            let start = out.len();
            let next = if i + 1 == images.len() {
                0
            } else {
                (start + 32 + body.len()) as u32
            };
            let mut header = vec![0u8; 32];
            header[0..4].copy_from_slice(&next.to_le_bytes());
            header[4..8].copy_from_slice(&(body.len() as u32).to_le_bytes());
            header[8..10].copy_from_slice(&img.axis_x.to_le_bytes());
            header[10..12].copy_from_slice(&img.axis_y.to_le_bytes());
            header[12..14].copy_from_slice(&img.group.to_le_bytes());
            header[14..16].copy_from_slice(&img.image.to_le_bytes());
            header[16..18].copy_from_slice(&img.link.unwrap_or(0).to_le_bytes());
            header[18] = u8::from(img.palette.is_none());
            out.extend_from_slice(&header);
            out.extend_from_slice(&body);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::write::{sff_v1, Image};
    use super::*;

    fn pal() -> Vec<Rgb> {
        (0..256)
            .map(|i| [i as u8, 255 - i as u8, (i * 7) as u8])
            .collect()
    }

    #[test]
    fn round_trip_keeps_indices_palette_axis_and_links() {
        let p = pal();
        let px: Vec<u8> = (0..12u8)
            .map(|i| if i % 5 == 0 { 0 } else { 200 + i })
            .collect();
        let data = sff_v1(&[
            Image {
                group: 0,
                image: 0,
                axis_x: 3,
                axis_y: -2,
                width: 4,
                height: 3,
                pixels: &px,
                palette: Some(&p),
                link: None,
            },
            Image {
                group: 0,
                image: 1,
                axis_x: 1,
                axis_y: 1,
                width: 4,
                height: 3,
                pixels: &px,
                palette: None,
                link: Some(0),
            },
        ]);
        let sff = parse(&data, "t.sff").unwrap();
        assert!(sff.diagnostics.is_empty(), "{:?}", sff.diagnostics);
        let a = &sff.sprites[&(0, 0)];
        assert_eq!((a.width, a.height, a.axis_x, a.axis_y), (4, 3, 3, -2));
        assert_eq!(a.pixels, px, "indices preservados (inclui >= 0xC0)");
        assert_eq!(a.palette, p);
        let b = &sff.sprites[&(0, 1)];
        assert_eq!(
            (b.linked_from, b.axis_x, b.pixels.clone()),
            (Some(0), 1, px)
        );
    }

    #[test]
    fn hostile_inputs_are_refused_or_diagnosed() {
        assert_eq!(
            parse(b"nope", "x").unwrap_err().code,
            "sff.header.signature"
        );
        let mut v2 = sff_v1(&[]);
        v2[15] = 2;
        assert_eq!(parse(&v2, "x").unwrap_err().code, "sff.version.unsupported");
        let p = pal();
        let px = [1u8; 16];
        let good = sff_v1(&[
            Image {
                group: 1,
                image: 0,
                axis_x: 0,
                axis_y: 0,
                width: 4,
                height: 4,
                pixels: &px,
                palette: Some(&p),
                link: None,
            },
            Image {
                group: 1,
                image: 0,
                axis_x: 0,
                axis_y: 0,
                width: 4,
                height: 4,
                pixels: &px,
                palette: None,
                link: None,
            },
            Image {
                group: 2,
                image: 0,
                axis_x: 0,
                axis_y: 0,
                width: 4,
                height: 4,
                pixels: &px,
                palette: None,
                link: Some(7),
            },
        ]);
        let codes = |s: &Sff| s.diagnostics.iter().map(|d| d.code).collect::<Vec<_>>();
        let sff = parse(&good, "x").unwrap();
        assert_eq!(
            codes(&sff),
            vec!["sff.sprite.duplicate", "sff.link.invalid"]
        );
        // truncado
        let cut = parse(&good[..good.len() - 40], "x").unwrap();
        assert!(
            codes(&cut).contains(&"sff.subfile.truncated")
                || codes(&cut).contains(&"sff.pcx.invalid"),
            "{:?}",
            codes(&cut)
        );
        // ciclo de next
        let mut cyc = good.clone();
        let second = u32le(&cyc, 512).unwrap() as usize;
        cyc[second..second + 4].copy_from_slice(&512u32.to_le_bytes());
        assert!(codes(&parse(&cyc, "x").unwrap()).contains(&"sff.subfile.cycle"));
        // contagem absurda
        let mut many = good.clone();
        many[20..24].copy_from_slice(&(MAX_IMAGES as u32 + 1).to_le_bytes());
        assert_eq!(parse(&many, "x").unwrap_err().code, "sff.limit.image_count");
    }
}
