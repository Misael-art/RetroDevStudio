// driver.rs — gera streams com o ENCODER RUST DO PRODUTO (cópia verbatim de
// src-tauri/src/tools/reverse/decomp/rex_codecs.rs, pinada por SHA-256 pelo
// gen_rust_streams.sh). Este arquivo é ferramenta externa de medição da
// agente-B; nada aqui entra no produto e o produto não é alterado.
//
// Saídas por caso (em <outdir>/streams):
//   <id>.stream         stream emitida pelo encoder Rust
//   <id>.plain          bytes esperados (entrada do encoder)
//   <id>.dict           contexto (prefixo) quando existir
//   rust_meta.tsv       análise de tokens + medidas por caso
use std::fs;
use std::path::{Path, PathBuf};

#[path = "rex_codecs.rs"]
mod rex_codecs;

use rex_codecs::{
    lz4w_decode_with_dictionary, lz4w_encode, lz4w_encode_with_dictionary, Lz4wLimits,
};

fn limits() -> Lz4wLimits {
    Lz4wLimits {
        max_output: 64 * 1024 * 1024,
        max_work: 4 * 1024 * 1024 * 1024,
    }
}

fn rd(stream: &[u8], pos: usize) -> Result<u16, String> {
    if pos + 2 > stream.len() {
        return Err(format!("truncated word at {pos}"));
    }
    Ok(u16::from_be_bytes([stream[pos], stream[pos + 1]]))
}

#[derive(Default, Debug, Clone)]
struct Analysis {
    segments: usize,
    lit_words: usize,
    short_refs: usize,
    long_nonrom_refs: usize,
    rom_refs: usize,
    value_word_zero: usize,
    need_dst_prefix_words: usize,
    need_src_prefix_words: usize,
    max_nonrom_off: usize,
    final_word: u16,
    output_words: usize,
}

/// Espelho LEITOR da estrutura de tokens (não do código do produto): conta
/// referências e o alcance máximo além do início da saída (dst) e antes do
/// início do stream (ROM-bit), para dimensionar contextos do replay.
fn analyze(stream: &[u8]) -> Result<Analysis, String> {
    let mut a = Analysis::default();
    let mut ind = 0usize;
    let mut produced = 0usize;
    loop {
        let h = rd(stream, ind)?;
        ind += 2;
        a.segments += 1;
        if h == 0 {
            a.final_word = rd(stream, ind)?;
            break;
        }
        let lit = (h >> 12) as usize;
        let m = ((h >> 8) & 0xF) as usize;
        let o = (h & 0xFF) as usize;
        ind += lit * 2;
        produced += lit;
        a.lit_words += lit;
        if m > 0 {
            a.short_refs += 1;
            let dist = o + 1;
            if dist > produced {
                a.need_dst_prefix_words = a.need_dst_prefix_words.max(dist - produced);
            }
            produced += m + 1;
        } else if o > 0 {
            let v = rd(stream, ind)?;
            ind += 2;
            let raw = (((-(v as i32)) as u32 as usize) & 0x7FFF) + 1;
            if v & 0x8000 != 0 {
                a.rom_refs += 1;
                let src_words = ind / 2;
                let need = (raw + 3).saturating_sub(src_words);
                a.need_src_prefix_words = a.need_src_prefix_words.max(need);
            } else {
                a.long_nonrom_refs += 1;
                a.max_nonrom_off = a.max_nonrom_off.max(raw);
                if v == 0 {
                    a.value_word_zero += 1;
                }
                if raw > produced {
                    a.need_dst_prefix_words = a.need_dst_prefix_words.max(raw - produced);
                }
            }
            produced += o + 2;
        }
    }
    a.output_words = produced;
    Ok(a)
}

fn be_words(ws: &[u16]) -> Vec<u8> {
    ws.iter().flat_map(|w| w.to_be_bytes()).collect()
}

fn emit(
    outdir: &Path,
    rows: &mut Vec<String>,
    id: &str,
    plain: &[u8],
    dict: Option<&[u8]>,
) -> Analysis {
    let stream = match dict {
        Some(d) => lz4w_encode_with_dictionary(plain, Some(d)).expect("encode c/ dict"),
        None => lz4w_encode(plain).expect("encode"),
    };
    let back = lz4w_decode_with_dictionary(&stream, dict, &limits())
        .unwrap_or_else(|e| panic!("{id}: rust self-decode falhou: {e}"));
    assert_eq!(back.data, plain, "{id}: rust decode != plain");
    assert_eq!(
        back.bytes_consumed,
        stream.len(),
        "{id}: bytes_consumed != stream.len"
    );
    let an = analyze(&stream).expect("analyze");
    fs::write(outdir.join(format!("{id}.stream")), &stream).unwrap();
    fs::write(outdir.join(format!("{id}.plain")), plain).unwrap();
    if let Some(d) = dict {
        fs::write(outdir.join(format!("{id}.dict")), d).unwrap();
    }
    rows.push(meta_row(id, plain, &stream, dict, &an, "rust-encode", true));
    an
}

fn emit_raw(
    outdir: &Path,
    rows: &mut Vec<String>,
    id: &str,
    plain: &[u8],
    stream: &[u8],
    dict: &[u8],
    origin: &str,
) -> Analysis {
    let an = analyze(stream).expect("analyze");
    fs::write(outdir.join(format!("{id}.stream")), stream).unwrap();
    fs::write(outdir.join(format!("{id}.plain")), plain).unwrap();
    fs::write(outdir.join(format!("{id}.dict")), dict).unwrap();
    rows.push(meta_row(id, plain, stream, Some(dict), &an, origin, true));
    an
}

#[allow(clippy::too_many_arguments)]
fn meta_row(
    id: &str,
    plain: &[u8],
    stream: &[u8],
    dict: Option<&[u8]>,
    an: &Analysis,
    origin: &str,
    selfdecode_ok: bool,
) -> String {
    format!(
        "id={id}\torigin={origin}\tselfdecode_ok={selfdecode_ok}\tplain_len={}\tstream_len={}\tdict_len={}\tsegments={}\tlit_words={}\tshort_refs={}\tlong_nonrom_refs={}\trom_refs={}\tvalue_word_zero={}\tneed_dst_prefix_words={}\tneed_src_prefix_words={}\tmax_nonrom_off={}\tfinal_word=0x{:04X}\toutput_words={}",
        plain.len(),
        stream.len(),
        dict.map_or(0, |d| d.len()),
        an.segments,
        an.lit_words,
        an.short_refs,
        an.long_nonrom_refs,
        an.rom_refs,
        an.value_word_zero,
        an.need_dst_prefix_words,
        an.need_src_prefix_words,
        an.max_nonrom_off,
        an.final_word,
        an.output_words,
    )
}

/// Redução mínima da divergência r10 (unpacker 68k `.long_match` usa
/// aritmética de 16 bits: `add.w d0,d0; lea -2(a1,d0.w),a2`):
///   value ≥ 0x4000 (off ≤ 16385) → d0.w negativa → leitura correta para trás;
///   value < 0x4000 (off ≥ 16386) → d0.w positiva → leitura ADIANTE (wrap).
/// Cada caso = UM match longo não-ROM de 3 words contra o fundo do dicionário.
fn deep_long_case(id: &str, dict_words: usize, beef_idx: usize) -> (Vec<u8>, Vec<u8>) {
    let mut dict = vec![0u16; dict_words];
    dict[beef_idx] = 0xBEEF;
    let data: Vec<u16> = vec![0xBEEF, 0x0000, 0x0000];
    let off = dict_words - beef_idx; // words do fim do resultado até a fonte
    let value = (((off - 1) as u32).wrapping_neg() & 0x7FFF) as u16;
    eprintln!("{id}: off={off} value=0x{value:04X} (68k wrap? {})", value < 0x4000);
    (be_words(&data), be_words(&dict))
}

fn minimals(outdir: &Path, rows: &mut Vec<String>) {
    // r11: off 16590 → value 0x3F33 < 0x4000 → 68k DIVERGE (lê ROM aliada),
    // jar/produto (32 bits) decodificam corretamente.
    let (plain, dict) = deep_long_case("r11_wrap_deep_ref", 16592, 2);
    emit(outdir, rows, "r11_wrap_deep_ref", &plain, Some(&dict));
    verify_one_deep_long(outdir, "r11_wrap_deep_ref", 16590);

    // r12: off 16385 → value 0x4000 exato → fronteira que DEVE PASSAR no 68k.
    let (plain, dict) = deep_long_case("r12_boundary_ok_ref", 16387, 2);
    emit(outdir, rows, "r12_boundary_ok_ref", &plain, Some(&dict));
    verify_one_deep_long(outdir, "r12_boundary_ok_ref", 16385);
}

/// Confirma no stream GERADO PELO ENCODER que o caso é exatamente
/// [token 0x0001][value][EOD 0x0000][final 0x0000] com o offset visado.
fn verify_one_deep_long(outdir: &Path, id: &str, want_off: usize) {
    let s = fs::read(outdir.join(format!("{id}.stream"))).unwrap();
    assert_eq!(
        s.len(),
        8,
        "{id}: stream esperada de 8 bytes, obtida {} ({s:02X?})",
        s.len()
    );
    let tok = u16::from_be_bytes([s[0], s[1]]);
    let v = u16::from_be_bytes([s[2], s[3]]);
    let eod = u16::from_be_bytes([s[4], s[5]]);
    let fin = u16::from_be_bytes([s[6], s[7]]);
    assert_eq!(tok, 0x0001, "{id}: token inesperado {tok:#06X}");
    assert_eq!(eod, 0, "{id}: EOD inesperado");
    assert_eq!(fin, 0, "{id}: final word ímpar?");
    let raw = (((-(v as i32)) as u32 as usize) & 0x7FFF) + 1;
    assert_eq!(raw, want_off, "{id}: off real {raw} != visado {want_off} (value {v:#06X})");
    eprintln!("{id}: confirmado on-disk: long não-ROM len=3 off={raw} value=0x{v:04X}");
}

fn smallcases(outdir: &Path, rows: &mut Vec<String>) {
    // r01: só literais + cauda ímpar (word final 0x80XX em stream Rust).
    let d: Vec<u8> = vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xAB];
    emit(outdir, rows, "r01_lits_odd", &d, None);

    // r02: matches curtos mistos (off=2 e off=1 com O=0) + literais.
    let words: Vec<u16> = vec![0xBEEF, 0xCAFE, 0xBEEF, 0xCAFE, 0xABCD, 0xABCD, 0xABCD, 0x1111];
    emit(outdir, rows, "r02_short_mix", &be_words(&words), None);

    // r03: match LONGO sem ROM-bit com offset > 0x100 dentro da própria
    // saída (path dst do unpacker — nunca reproduzido no desempate anterior).
    let mut words: Vec<u16> = (0..304u32)
        .map(|i| ((i.wrapping_mul(2654435761) >> 13) & 0xFFFF) as u16)
        .collect();
    let tail: Vec<u16> = words[2..8].to_vec();
    words.extend(tail);
    emit(outdir, rows, "r03_long_far_nodict", &be_words(&words), None);

    // r04: repetição longa (off=1, len=21) → forma LONGA com value word
    // 0x0000 (negação de off-1=0). Edge crítico de EOD vs value word.
    let words: Vec<u16> = std::iter::repeat(0x1234u16).take(22).collect();
    emit(outdir, rows, "r04_long_zero_value", &be_words(&words), None);

    // r05: dicionário de 600 words + refs curtas e LONGAS sem ROM-bit ao
    // dicionário + auto-referência dentro da saída.
    let dict_words: Vec<u16> = (0..600u32)
        .map(|i| ((i.wrapping_mul(40503) >> 7) & 0xFFFF) as u16)
        .collect();
    let mut data: Vec<u16> = Vec::new();
    data.extend_from_slice(&dict_words[594..600]);
    data.extend_from_slice(&dict_words[100..108]);
    let head3: Vec<u16> = data[0..3].to_vec();
    data.extend_from_slice(&head3);
    emit(
        outdir,
        rows,
        "r05_dict_mixed",
        &be_words(&data),
        Some(&be_words(&dict_words)),
    );
}

const START: usize = 0xC8CC8;
// Cap do prefixo-dst truncado: 37.184 B. O caso real 0xc8cc8 (Rust re-encode)
// referencia 18475 words antes do fim do resultado -> ~36950 B; Work RAM totai
// da MD é 64 KiB, então 37 KiB de prefixo é o teto honesto p/ replay 68k.
const PREFIX_CAP: usize = 0x9180;

fn round_prefix(need_words: usize) -> usize {
    let bytes = (need_words * 2 + 0xFF) & !0xFF;
    bytes.clamp(0x100, PREFIX_CAP)
}

fn corpus(rom: &[u8], outdir: &Path, rows: &mut Vec<String>) {
    assert_eq!(rom.len(), 917_504, "ROM inesperada pelo tamanho");
    let dec = lz4w_decode_with_dictionary(&rom[START..], Some(&rom[..START]), &limits())
        .expect("decode do recurso original 0xc8cc8");
    let stream9 = &rom[START..START + dec.bytes_consumed];
    let an9 = analyze(stream9).expect("analyze r09");

    // r09: stream ORIGINAL do corpus como baseline de regressão.
    let mut p9 = round_prefix(an9.need_dst_prefix_words.max(an9.need_src_prefix_words));
    loop {
        let d = &rom[START - p9..START];
        let ok = lz4w_decode_with_dictionary(stream9, Some(d), &limits())
            .map(|r| r.data == dec.data && r.bytes_consumed == stream9.len())
            .unwrap_or(false);
        if ok || p9 == PREFIX_CAP {
            assert!(ok, "r09: contexto truncado insuficiente mesmo no cap {PREFIX_CAP}");
            break;
        }
        p9 = ((p9 * 2) & !0xFF).min(PREFIX_CAP);
    }
    let d9 = &rom[START - p9..START];
    fs::write(outdir.join("r09_corpus_orig_c8cc8.stream"), stream9).unwrap();
    fs::write(outdir.join("r09_corpus_orig_c8cc8.plain"), &dec.data).unwrap();
    fs::write(outdir.join("r09_corpus_orig_c8cc8.dict"), d9).unwrap();
    rows.push(meta_row(
        "r09_corpus_orig_c8cc8",
        &dec.data,
        stream9,
        Some(d9),
        &an9,
        "corpus-original",
        true,
    ));

    // r10: stream MODIFICADA pelo encoder Rust — edição da transação
    // canônica BYOR: edited[0] ^= 0xF0, re-dicionário = prefixo da ROM.
    let mut edited = dec.data.clone();
    edited[0] ^= 0xF0;
    let stream10 =
        lz4w_encode_with_dictionary(&edited, Some(&rom[..START])).expect("rust re-encode r10");
    let v = lz4w_decode_with_dictionary(&stream10, Some(&rom[..START]), &limits())
        .expect("r10 rust self-decode (dict pleno)");
    assert_eq!(v.data, edited, "r10: rust decode != edited");
    let an10 = analyze(&stream10).expect("analyze r10");
    eprintln!("r10-analise: {an10:?} stream10_len={} stream9_len={}", stream10.len(), stream9.len());
    let mut p10 = round_prefix(an10.need_dst_prefix_words.max(an10.need_src_prefix_words));
    loop {
        let d = &rom[START - p10..START];
        let ok = lz4w_decode_with_dictionary(&stream10, Some(d), &limits())
            .map(|r| r.data == edited && r.bytes_consumed == stream10.len())
            .unwrap_or(false);
        if ok || p10 == PREFIX_CAP {
            assert!(ok, "r10: contexto truncado insuficiente mesmo no cap {PREFIX_CAP}");
            break;
        }
        p10 = ((p10 * 2) & !0xFF).min(PREFIX_CAP);
    }
    let d10 = &rom[START - p10..START];
    fs::write(outdir.join("r10_corpus_rust_edit_c8cc8.stream"), &stream10).unwrap();
    fs::write(outdir.join("r10_corpus_rust_edit_c8cc8.plain"), &edited).unwrap();
    fs::write(outdir.join("r10_corpus_rust_edit_c8cc8.dict"), d10).unwrap();
    rows.push(meta_row(
        "r10_corpus_rust_edit_c8cc8",
        &edited,
        &stream10,
        Some(d10),
        &an10,
        "rust-encode-on-corpus",
        true,
    ));
    // espaço do produto: stream nova deve caber no slot original (transação §3)
    assert!(
        stream10.len() <= stream9.len(),
        "r10: stream Rust de {} bytes excede slot original de {}",
        stream10.len(),
        stream9.len()
    );
}

/// Replay contra o encoder/decoder WIP do integrador (pinado separadamente):
/// (1) o decoder WIP DEVE recusar a stream r10 legacy (off profundo 18555);
/// (2) registra o que o WIP faz com o teto oficial jar (r12, off 16385);
/// (3) gera r13 = mesma edição canônica `edited[0]^=0xF0` codificada pelo
///     encoder WIP — deve ter janela ≤ 0x4000 e decodificar idêntica no 68k.
fn wip(rom: &[u8], legacy: &Path, outdir: &Path, rows: &mut Vec<String>) {
    let s10 = fs::read(legacy.join("r10_corpus_rust_edit_c8cc8.stream"))
        .expect("stream legacy r10 (gerar antes com o pino 07ee9b2c)");
    match lz4w_decode_with_dictionary(&s10, Some(&rom[..START]), &limits()) {
        Ok(r) => panic!(
            "wip: stream legacy r10 ACEITA (off profundo {:#?}...) — espera era recusa",
            &r.data[..4]
        ),
        Err(e) => eprintln!("wip-recusa-r10-legacy: {e}"),
    }
    let s12 = fs::read(legacy.join("r12_boundary_ok_ref.stream")).unwrap();
    let d12 = fs::read(legacy.join("r12_boundary_ok_ref.dict")).unwrap();
    match lz4w_decode_with_dictionary(&s12, Some(&d12), &limits()) {
        Ok(_) => eprintln!("wip-r12: aceita off 16385"),
        Err(e) => eprintln!("wip-r12: RECUSA off 16385 ({e}) — 68k+jar aceitam (run C)"),
    }
    let dec = lz4w_decode_with_dictionary(&rom[START..], Some(&rom[..START]), &limits())
        .expect("decode do original 0xc8cc8");
    let mut edited = dec.data.clone();
    edited[0] ^= 0xF0;
    let stream13 =
        lz4w_encode_with_dictionary(&edited, Some(&rom[..START])).expect("wip encode r13");
    let v = lz4w_decode_with_dictionary(&stream13, Some(&rom[..START]), &limits())
        .expect("wip self-decode r13");
    assert_eq!(v.data, edited, "r13: wip decode != edited");
    let an = analyze(&stream13).expect("analyze r13");
    assert!(
        an.max_nonrom_off <= 0x4000,
        "r13: encoder WIP emitiu off {} > janela 0x4000",
        an.max_nonrom_off
    );
    eprintln!("r13-analise: {an:?} stream13_len={} slot={}", stream13.len(), dec.bytes_consumed);
    let mut p13 = round_prefix(an.need_dst_prefix_words.max(an.need_src_prefix_words));
    loop {
        let d = &rom[START - p13..START];
        let ok = lz4w_decode_with_dictionary(&stream13, Some(d), &limits())
            .map(|r| r.data == edited && r.bytes_consumed == stream13.len())
            .unwrap_or(false);
        if ok || p13 == PREFIX_CAP {
            assert!(ok, "r13: contexto truncado insuficiente no cap {PREFIX_CAP}");
            break;
        }
        p13 = ((p13 * 2) & !0xFF).min(PREFIX_CAP);
    }
    let d13 = &rom[START - p13..START];
    fs::write(outdir.join("r13_wip_edit_c8cc8.stream"), &stream13).unwrap();
    fs::write(outdir.join("r13_wip_edit_c8cc8.plain"), &edited).unwrap();
    fs::write(outdir.join("r13_wip_edit_c8cc8.dict"), d13).unwrap();
    rows.push(meta_row(
        "r13_wip_edit_c8cc8",
        &edited,
        &stream13,
        Some(d13),
        &an,
        "rust-encode-wip",
        true,
    ));
    // Observação para o produto (NÃO é asserção): com a janela 0x4000, a
    // mesma edição canônica passou a produzir stream maior que o slot
    // original — a regra de tamanho de reinsert_transaction recusaria esta
    // edição específica.
    if stream13.len() > dec.bytes_consumed {
        eprintln!(
            "r13-slot: stream {} > slot original {} — edição não re-inserível pela regra de tamanho",
            stream13.len(),
            dec.bytes_consumed
        );
    } else {
        eprintln!("r13-slot: cabe ({} ≤ {})", stream13.len(), dec.bytes_consumed);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (mode, out, rom) = match args.len() {
        3 => (args[1].as_str(), PathBuf::from(&args[2]), None),
        4 | 5 => (
            args[1].as_str(),
            PathBuf::from(&args[2]),
            Some(PathBuf::from(&args[3])),
        ),
        _ => panic!("uso: driver all <outdir> <rom> | driver smallcases <outdir> | driver wip <outdir> <rom> <legacy-streams-dir>"),
    };
    fs::create_dir_all(&out).unwrap();
    let mut rows = Vec::new();
    if mode == "all" || mode == "smallcases" {
        smallcases(&out, &mut rows);
    }
    if mode == "all" || mode == "minimals" {
        minimals(&out, &mut rows);
    }
    if mode == "all" || mode == "wip" {
        let rom = rom.expect("ROM p/ modo all/wip");
        let rom_bytes = fs::read(&rom).expect("ler ROM");
        if mode == "all" {
            corpus(&rom_bytes, &out, &mut rows);
        } else {
            wip(&rom_bytes, &PathBuf::from(&args[4]), &out, &mut rows);
        }
    }
    fs::write(
        out.join("rust_meta.tsv"),
        rows.join("\n") + "\n",
    )
    .unwrap();
    for r in &rows {
        println!("{r}");
    }
}
