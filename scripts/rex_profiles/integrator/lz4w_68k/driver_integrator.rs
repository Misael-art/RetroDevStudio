// driver_integrator.rs — gera as streams do ENCODER/DECODER DO PRODUTO (HEAD)
// para o replay no desempacotador 68000 oficial. Ferramenta externa de medição:
// nada aqui entra no produto; `rex_codecs.rs` é uma cópia verbatim pinada por
// SHA-256 por `reproduce.sh` (o produto não é alterado por este arquivo).
//
// Casos (todos com o codec ATUAL; os equivalentes históricos r01..r13 da
// agente-B usavam o encoder legado de janela 0x8000 e não são reproduzíveis
// com o encoder atual, que nunca emite offset não-ROM > 0x4000):
//
//   i20..i24  families sintéticas pequenas emitidas pelo encoder atual:
//             literais+cauda ímpar, matches curtos (off 2 e off 1 com value 0),
//             longo auto-referente dentro da saída, longo de value 0x0000 e
//             dicionário misto (curto + longo não-ROM + auto-referência).
//   i14       fronteira profunda EMITIDA PELO ENCODER: off = 16384 words
//             (value 0x4001) — prova "Rust encode -> 68k decode" dentro do teto.
//   i15       fronteira do formato: off = 16385 words (value 0x4000), stream
//             construído à mão. O decoder do produto DEVE aceitar; o 68k deve
//             reproduzir byte a byte.
//   i16       um word além do teto: off = 16386 words (value 0x3FFF). O decoder
//             do produto DEVE recusar (`invalid_reference`); a expectativa
//             medida é o 68k divergir (lê para frente, aliassa a ROM) enquanto
//             o oráculo Java de 32 bits produz os bytes pretendidos.
//   i09       stream ORIGINAL do corpus (recurso 0xc8cc8) com o menor prefixo
//             de dicionário que o produto aceita — linha de base de regressão.
//   i18       edição canônica do corpus (byte 0 do plano ^ 0xF0) re-codificada
//             pelo encoder atual; o slot original é registrado como medida
//             (needs_space), nunca forçado.
//
// Saída por caso em <outdir>/streams: <id>.stream, <id>.plain, <id>.dict e
// rust_meta.tsv (compatível com gen_rust_cases.py).

use std::fs;
use std::path::{Path, PathBuf};

#[path = "rex_codecs.rs"]
mod rex_codecs;

use rex_codecs::{lz4w_decode_with_dictionary, lz4w_encode_with_dictionary, Lz4wLimits};

const START: usize = 0xC8CC8;
/// Cap do prefixo truncado: Work RAM total da Mega Drive é 64 KiB, e o harness
/// copia o prefixo para o destino. Acima disto o replay 68k não é executável.
const PREFIX_CAP: usize = 0x9180;

fn limits() -> Lz4wLimits {
    Lz4wLimits {
        max_output: 64 * 1024 * 1024,
        max_work: 4 * 1024 * 1024 * 1024,
    }
}

fn be_words(words: &[u16]) -> Vec<u8> {
    let mut v = Vec::with_capacity(words.len() * 2);
    for w in words {
        v.extend_from_slice(&w.to_be_bytes());
    }
    v
}

struct Case {
    id: &'static str,
    plain: Vec<u8>,
    stream: Vec<u8>,
    dict: Vec<u8>,
    note: String,
}

fn write_case(outdir: &Path, c: &Case) {
    assert!(c.stream.len() % 2 == 0, "{}: stream ímpar", c.id);
    assert!(c.dict.len() % 2 == 0, "{}: dict ímpar", c.id);
    fs::write(outdir.join(format!("{}.stream", c.id)), &c.stream).unwrap();
    fs::write(outdir.join(format!("{}.plain", c.id)), &c.plain).unwrap();
    if !c.dict.is_empty() {
        fs::write(outdir.join(format!("{}.dict", c.id)), &c.dict).unwrap();
    }
    eprintln!(
        "{}: plain={} stream={} dict={} {}",
        c.id,
        c.plain.len(),
        c.stream.len(),
        c.dict.len(),
        c.note
    );
}

/// Codifica com o encoder do produto e exige que o decoder do produto reponha
/// o plano exato consumindo o stream inteiro ANTES de submeter o caso ao 68k
/// (mesma verificação intra-transação que o produto aplica).
fn encoded_case(id: &'static str, plain: &[u8], dict: &[u8], note: String) -> Case {
    let d = if dict.is_empty() { None } else { Some(dict) };
    let stream = lz4w_encode_with_dictionary(plain, d).unwrap_or_else(|e| panic!("{id}: encode: {e}"));
    let back = lz4w_decode_with_dictionary(&stream, d, &limits())
        .unwrap_or_else(|e| panic!("{id}: self-decode: {e}"));
    assert_eq!(back.data, plain, "{id}: self-decode divergiu do plano");
    assert_eq!(
        back.bytes_consumed,
        stream.len(),
        "{id}: self-decode não consumiu o stream inteiro"
    );
    Case {
        id,
        plain: plain.to_vec(),
        stream,
        dict: dict.to_vec(),
        note,
    }
}

/// Confirma no stream gravado em disco que o caso é exatamente um único match
/// longo não-ROM de 3 words: [token 0x0001][value][EOD 0x0000][final 0x0000].
fn assert_single_deep_long(stream: &[u8], id: &str, want_off: usize) {
    assert_eq!(stream.len(), 8, "{id}: stream esperada de 8 bytes");
    let tok = u16::from_be_bytes([stream[0], stream[1]]);
    let value = u16::from_be_bytes([stream[2], stream[3]]);
    assert_eq!(tok, 0x0001, "{id}: token inesperado {tok:#06X}");
    assert_eq!(stream[4..], [0, 0, 0, 0], "{id}: cauda inesperada");
    let off = ((((value as i32).wrapping_neg()) as u32 as usize) & 0x7FFF) + 1;
    assert_eq!(off, want_off, "{id}: off real {off} != visado {want_off}");
    eprintln!("{id}: on-disk long não-ROM len=3 off={off} value=0x{value:04X}");
}

fn synth_cases(outdir: &Path) -> Vec<Case> {
    let mut v = Vec::new();

    // i20: só literais + cauda ímpar (word final 0x80XX).
    let d: Vec<u8> = vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xAB];
    v.push(encoded_case("i20_lits_odd", &d, b"", "só literais".into()));

    // i21: matches curtos mistos (off 2 e off 1 -> value 0 nas formas curtas).
    let words: Vec<u16> = vec![0xBEEF, 0xCAFE, 0xBEEF, 0xCAFE, 0xABCD, 0xABCD, 0xABCD, 0x1111];
    let p = be_words(&words);
    v.push(encoded_case("i21_short_mix", &p, b"", "curtos off 2/off 1".into()));

    // i22: longo auto-referente dentro da própria saída (caminho dst).
    let words: Vec<u16> = (0..304u32)
        .map(|i| ((i.wrapping_mul(2654435761) >> 13) & 0xFFFF) as u16)
        .collect();
    let mut p: Vec<u16> = words.clone();
    p.extend_from_slice(&words[2..8]);
    let p = be_words(&p);
    v.push(encoded_case(
        "i22_long_far_nodict",
        &p,
        b"",
        "longo auto-referente".into(),
    ));

    // i23: repetição longa (off 1 -> value word 0x0000, forma LONGA).
    let words: Vec<u16> = std::iter::repeat(0x1234u16).take(22).collect();
    let p = be_words(&words);
    v.push(encoded_case(
        "i23_long_zero_value",
        &p,
        b"",
        "longo value=0x0000 (off 1)".into(),
    ));

    // i24: dicionário de 600 words + refs curtas e longas ao dicionário +
    // auto-referência na saída.
    let dict_words: Vec<u16> = (0..600u32)
        .map(|i| ((i.wrapping_mul(40503) >> 7) & 0xFFFF) as u16)
        .collect();
    let mut data: Vec<u16> = Vec::new();
    data.extend_from_slice(&dict_words[594..600]);
    data.extend_from_slice(&dict_words[100..108]);
    let head3: Vec<u16> = data[0..3].to_vec();
    data.extend_from_slice(&head3);
    let dict = be_words(&dict_words);
    let p = be_words(&data);
    v.push(encoded_case("i24_dict_mixed", &p, &dict, "dict 600w misto".into()));

    for c in &v {
        write_case(outdir, c);
    }
    v
}

/// off = 16384 words: o máximo que o ENCODER atual ainda alcança (janela de
/// estratégia 0x4000). Dicionário de 16386 words com 0xBEEF no word 2 e plano
/// de 3 words cuja única fonte é esse word.
fn encoder_deep_case(outdir: &Path) -> Case {
    let dict_words = 16386usize;
    let mut dict = vec![0u16; dict_words];
    dict[2] = 0xBEEF;
    let dict = be_words(&dict);
    let plain: Vec<u8> = vec![0xBE, 0xEF, 0x00, 0x00, 0x00, 0x00];
    let c = encoded_case(
        "i14_encoder_deep_16384",
        &plain,
        &dict,
        "emitido pelo encoder; off 16384".into(),
    );
    assert_single_deep_long(&c.stream, c.id, 16384);
    write_case(outdir, &c);
    c
}

/// Casos de fronteira construídos À MÃO (o encoder não pode emiti-los):
/// off 16385 (value 0x4000) deve ser aceito; off 16386 (value 0x3FFF) deve ser
/// recusado pelo produto — a leitura pretendida é documentada como expectativa
/// para o 68k/oráculo Java.
fn hand_built_boundary_cases(outdir: &Path) -> Vec<Case> {
    let plain: Vec<u8> = vec![0xBE, 0xEF, 0x00, 0x00, 0x00, 0x00];
    let mut v = Vec::new();

    for (id, dict_words, value, accept) in [
        ("i15_hardware_ceiling_16385", 16387usize, 0x4000u16, true),
        ("i16_beyond_ceiling_16386", 16388, 0x3FFF, false),
    ] {
        let mut dict = vec![0u16; dict_words];
        dict[2] = 0xBEEF;
        let dict = be_words(&dict);
        let mut stream = vec![0x00u8, 0x01];
        stream.extend_from_slice(&value.to_be_bytes());
        stream.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        assert_single_deep_long(&stream, id, dict_words - 2);
        let got = lz4w_decode_with_dictionary(&stream, Some(&dict), &limits());
        if accept {
            let got = got.unwrap_or_else(|e| panic!("{id}: produto deveria aceitar: {e}"));
            assert_eq!(got.data, plain, "{id}: produto divergiu da leitura");
            assert_eq!(got.bytes_consumed, stream.len(), "{id}: saída incompleta");
        } else {
            let err = got.err().expect(&format!("{id}: produto aceitou stream fora do teto"));
            assert_eq!(err.code, "invalid_reference", "{id}: código {err}");
        }
        v.push(Case {
            id,
            plain: plain.clone(),
            stream,
            dict,
            note: if accept {
                "aceito pelo produto".to_string()
            } else {
                "recusado pelo produto (invalid_reference)".to_string()
            },
        });
    }
    for c in &v {
        write_case(outdir, c);
    }
    v
}

/// Menor prefixo (em bytes, múltiplo de 256) com o qual o produto reproduz o
/// plano e o consumo exato, buscado por duplicação a partir de 0x100.
fn minimal_prefix(stream: &[u8], rom: &[u8], want: &[u8]) -> usize {
    let mut p = 0x100usize;
    loop {
        let ok = lz4w_decode_with_dictionary(stream, Some(&rom[START - p..START]), &limits())
            .map(|r| r.data == want && r.bytes_consumed == stream.len())
            .unwrap_or(false);
        if ok {
            return p;
        }
        assert!(p < PREFIX_CAP, "prefixo insuficiente mesmo no cap {PREFIX_CAP}");
        p = ((p * 2) & !0xFF).min(PREFIX_CAP);
    }
}

fn corpus_cases(rom: &[u8], outdir: &Path) -> Vec<Case> {
    assert_eq!(rom.len(), 917_504, "ROM BYOR fora do pino");
    let full = &rom[..START];
    let mut v = Vec::new();

    // i09: stream ORIGINAL do recurso 0xc8cc8 (linha de base).
    let dec = lz4w_decode_with_dictionary(&rom[START..], Some(full), &limits())
        .expect("decode do original 0xc8cc8");
    let stream9 = rom[START..START + dec.bytes_consumed].to_vec();
    let p9 = minimal_prefix(&stream9, rom, &dec.data);
    v.push(Case {
        id: "i09_corpus_orig_c8cc8",
        plain: dec.data.clone(),
        dict: rom[START - p9..START].to_vec(),
        stream: stream9.clone(),
        note: format!("original do corpus; prefixo mínimo aceito {p9} bytes"),
    });

    // i18: edição canônica re-codificada pelo encoder ATUAL.
    let mut edited = dec.data.clone();
    edited[0] ^= 0xF0;
    let stream18 = lz4w_encode_with_dictionary(&edited, Some(full)).expect("encode i18");
    let back = lz4w_decode_with_dictionary(&stream18, Some(full), &limits()).expect("self-decode i18");
    assert_eq!(back.data, edited, "i18: self-decode divergiu");
    assert_eq!(back.bytes_consumed, stream18.len(), "i18: consumo parcial");
    let p18 = minimal_prefix(&stream18, rom, &edited);
    eprintln!(
        "i18-slot: stream {} bytes vs slot original {} bytes — {}",
        stream18.len(),
        dec.bytes_consumed,
        if stream18.len() <= dec.bytes_consumed {
            "cabe".to_string()
        } else {
            "NÃO cabe: needs_space honesto, nunca sobrescrever vizinhos".to_string()
        }
    );
    v.push(Case {
        id: "i18_corpus_edit_c8cc8",
        plain: edited,
        dict: rom[START - p18..START].to_vec(),
        stream: stream18,
        note: format!(
            "edição canônica pelo encoder atual; prefixo {p18} bytes; slot original {} bytes",
            dec.bytes_consumed
        ),
    });

    for c in &v {
        write_case(outdir, c);
    }
    v
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(
        args.len() == 3,
        "uso: driver_integrator <outdir> <rom-byor>"
    );
    let outdir = PathBuf::from(&args[1]);
    let rom = fs::read(&args[2]).expect("ler ROM BYOR");
    fs::create_dir_all(&outdir).unwrap();

    let mut cases = synth_cases(&outdir);
    cases.push(encoder_deep_case(&outdir));
    cases.append(&mut hand_built_boundary_cases(&outdir));
    cases.append(&mut corpus_cases(&rom, &outdir));

    let mut rows = String::new();
    for c in &cases {
        rows.push_str(&format!(
            "id={}\torigin=integrator-current-codec\tplain_len={}\tstream_len={}\tdict_len={}\tnote={}\n",
            c.id,
            c.plain.len(),
            c.stream.len(),
            c.dict.len(),
            c.note
        ));
    }
    fs::write(outdir.join("rust_meta.tsv"), rows).unwrap();
    println!("casos gerados: {}", cases.len());
}
