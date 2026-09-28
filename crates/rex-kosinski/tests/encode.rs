//! Testes de contrato v1 do CODIFICADOR Kosinski (ENCODE-CONTRACT.md).
//!
//! Propriedades centrais: round-trip interno contra o decoder do pacote com
//! `bytes_consumed == stream.len()` (P1), layout exato do early-fetch no lado
//! do emisor (fronteira do 16o bit, forma m10), determinismo byte a byte,
//! limites cortados no ponto de uso e referencia real em dado repetitivo.
//! A paridade EXTERNA (koscmp -x nos streams do produto) e o complemento do
//! script diferencial; esta suite roda sem oraculo.

use rex_kosinski::{decode, encode, EncError, KosError};

fn perfil() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data/rex_profiles/codec/kosinski")
}

fn enc_big(plain: &[u8]) -> Vec<u8> {
    encode(plain, 1 << 24, 1 << 26)
        .expect("encode com limites folgados")
        .stream
}

/// P1: decode(encode(p)) == p e o consumo fecha exatamente no terminator
/// (sem padding por contrato do emissor — ENCODE-CONTRACT §3/§7).
fn roundtrip(nome: &str, plain: &[u8]) -> Vec<u8> {
    let st = enc_big(plain);
    let d = decode(&st, plain.len() + 16, 1 << 26)
        .unwrap_or_else(|e| panic!("{nome}: decode do proprio stream falhou {e:?}"));
    assert_eq!(d.output, plain, "{nome}: round-trip divergiu do plain");
    assert_eq!(
        d.bytes_consumed,
        st.len(),
        "{nome}: bytes_consumed deve fechar no fim da stream emitida (P1)"
    );
    st
}

#[test]
fn corpus_plains_roundtrip_interno() {
    for name in [
        "abcdef",
        "ab_repeat",
        "empty",
        "far_window_40k",
        "near_window_2k",
        "noisy_runs_16k",
        "odd3",
        "pseudo_random_8k",
        "single",
        "text_rep",
        "tile_like",
        "zeros_64k",
    ] {
        let plain = std::fs::read(perfil().join(format!("plain/{name}.bin"))).expect("plain");
        roundtrip(name, &plain);
    }
}

#[test]
fn plain_vazio_produz_stream_minima_de_5_bytes() {
    // ENCODE-CONTRACT §3/§4: [02 00][00 F0 00] — descritor 0x0002
    // (bits 0,1 = separado) + terminator; o decoder do pacote aceita e consome tudo.
    let st = enc_big(&[]);
    assert_eq!(st, vec![0x02, 0x00, 0x00, 0xF0, 0x00]);
    let d = decode(&st, 16, 1 << 20).expect("stream minima");
    assert!(d.output.is_empty());
    assert_eq!(d.bytes_consumed, 5);
}

#[test]
fn dados_repetitivos_emitem_referencias_reais() {
    // A estrategia NAO pode ser literal-only. Run 4096x 0x5A exige split em
    // refs de 256 com MESMA dist=1 (ENCODE-CONTRACT §5): token [FF F8 FF]
    // (Low=FF, High=F8|count3=0, c=FF -> len 256). Piso aritmetico so-literal:
    // n + 2*ceil((n+2)/16) + 3.
    let plain = vec![0x5Au8; 4096];
    let st = roundtrip("run_4k", &plain);
    let literal_only_min = plain.len() + 2 * plain.len().div_ceil(16) + 3;
    assert!(
        st.len() * 4 < literal_only_min,
        "stream {} nao ficou muito abaixo do piso literal {} (encoder sem referencias?)",
        st.len(),
        literal_only_min
    );
    let splits = st.windows(3).filter(|w| *w == [0xFF, 0xF8, 0xFF]).count();
    assert!(
        splits >= 8,
        "esperava >= 8 refs len=256 dist=1, achei {splits}"
    );
}

#[test]
fn fronteira_16o_bit_terminador_estruturado_escreve_placeholder_antes_dos_bytes() {
    // 15 literais (bits 0..14) + terminator comecando no 16o bit: o segundo
    // bit mora no NOVO descritor, entao a palavra nova (bit0=1 -> 0x0001) e
    // escrita ANTES dos bytes de dados do terminator (regra §3).
    let plain: Vec<u8> = (b'A'..=b'O').collect(); // 15 literais distintos
    let st = roundtrip("15_lit_term_straddle", &plain);
    let mut want = vec![0xFFu8, 0x7F]; // desc0: bits 0..14 = 1, bit15 = 0
    want.extend_from_slice(&plain);
    want.extend_from_slice(&[0x01, 0x00]); // desc1: bit0 = 1 (2o bit do 0,1)
    want.extend_from_slice(&[0x00, 0xF0, 0x00]);
    assert_eq!(st, want, "layout do terminator em estraddle nao bate");
}

#[test]
fn fronteira_16o_bit_segundo_bit_do_terminador_exige_placeholder() {
    // Forma refutada por medição na sessão de encoding (retificação §3): 14
    // literais (bits 0..13) + terminator nos bits 14,15 — o SEGUNDO bit do
    // terminator e o 16.o. O decoder faz early-fetch incondicional no pop do
    // 16.o, entao a palavra-placeholder `00 00` precede `00 F0 00` e a stream
    // tem 21 bytes exatos. Sem o placeholder o decoder do pacote da Truncated.
    let plain: Vec<u8> = (b'A'..=b'N').collect(); // 14 literais distintos
    let st = roundtrip("14_lit_term_second_bit_16", &plain);
    let mut want = vec![0xFFu8, 0xBF]; // desc0: bits 0..13 = 1, b14 = 0, b15 = 1
    want.extend_from_slice(&plain);
    want.extend_from_slice(&[0x00, 0x00]); // placeholder (early-fetch)
    want.extend_from_slice(&[0x00, 0xF0, 0x00]);
    assert_eq!(st, want, "layout do terminator na forma 14-mod-16 nao bate");
    assert_eq!(st.len(), 21);
}

#[test]
fn fronteira_16o_bit_inline_h_antes_do_placeholder_l_depois_m10_like() {
    // Forma do golden m10 no lado do EMISOR: 13 literais + inline len=5
    // dist=13 comecando no bit 13 -> `h` e o 16o bit; a nova palavra cai
    // ENTRE `h` e `l`. Depois, um SEGUNDO inline (len=5 dist=5) e o
    // terminator vivem no mesmo descritor novo:
    //   desc1 bits: b0=l=1, b1..2=0,0, b3=h=1, b4=l=1, b5=0, b6=1 -> 0x59.
    let mut plain: Vec<u8> = (b'A'..=b'M').collect();
    plain.extend_from_slice(b"ABCDEABCDE");
    let st = roundtrip("inline_straddle_m10_like", &plain);
    let mut want = vec![0xFFu8, 0x9F]; // desc0: bits0..12=1; b13=0,b14=0,b15=h=1
    want.extend_from_slice(&plain[..13]); // bytes dos literais
    want.extend_from_slice(&[0x59, 0x00]); // desc1
    want.push(0xF3); // d1 = 0x100 - 13
    want.push(0xFB); // d2 = 0x100 - 5
    want.extend_from_slice(&[0x00, 0xF0, 0x00]);
    assert_eq!(st, want, "layout m10-like do emissor nao bate");
}

#[test]
fn inline_len5_dist5_exato() {
    // "ABCDEABCDE": 5 literais (bits 0..4=1) + inline b5,b6=0,0 b7=h=1 b8=l=1
    // + terminator b9=0 b10=1 -> desc = 0x1F|0x80|0x100|0x400 = 0x59F.
    let st = roundtrip("inline_len5", b"ABCDEABCDE");
    assert_eq!(
        st,
        vec![0x9F, 0x05, b'A', b'B', b'C', b'D', b'E', 0xFB, 0x00, 0xF0, 0x00]
    );
}

#[test]
fn separado_count3_para_len8_exato() {
    // "ABCDEFGHABCDEFGH": len=8 dist=8 -> count3=6, X=0x1FF8 -> Low=F8,
    // High=(X>>8)<<3|6 = 0xFE. Bits: 8 literais, sep 0,1 (b8=0,b9=1),
    // term 0,1 (b10=0,b11=1) -> desc = 0xFF|0x200|0x800 = 0xAFF.
    let st = roundtrip("sep3_len8", b"ABCDEFGHABCDEFGH");
    assert_eq!(
        st,
        vec![
            0xFF, 0x0A, b'A', b'B', b'C', b'D', b'E', b'F', b'G', b'H', 0xF8, 0xFE, 0x00, 0xF0,
            0x00
        ]
    );
}

#[test]
fn separados_c_e_split_de_256_exato() {
    // 1 byte 0x00 + 310 bytes 0x42: literais pos0/pos1, ref len256 (c=0xFF),
    // continuacao MESMA dist=1 len53 (c=0x34). Bits: b0,b1=1 literais;
    // b2=0,b3=1; b4=0,b5=1; term b6=0,b7=1 -> desc = 0xAB.
    let mut plain = vec![0x00u8];
    plain.extend(std::iter::repeat(0x42u8).take(310));
    let st = roundtrip("c_len_e_split", &plain);
    assert_eq!(
        st,
        vec![0xAB, 0x00, 0x00, 0x42, 0xFF, 0xF8, 0xFF, 0xFF, 0xF8, 0x34, 0x00, 0xF0, 0x00]
    );
}

#[test]
fn dist_maxima_do_formato_8192() {
    // Historico de 3-gramas UNICOS (com o cabecalho "ABCDEFGH" plantado no
    // conjunto visto) + repeticao do cabecalho em pos=8192: a unica
    // candidata possivel e j=0, dist = 0x2000 exata -> X = 0 -> Low=00,
    // High=00|count3(6)=06, sem byte c (len=8). O round-trip pelo decoder e
    // o que prova que o limite do formato e alcancavel e valido.
    let mut seen: std::collections::HashSet<[u8; 3]> = std::collections::HashSet::new();
    let mut p: Vec<u8> = b"ABCDEFGH".to_vec();
    for w in p.windows(3) {
        seen.insert(w.try_into().unwrap());
    }
    while p.len() < 8192 {
        let mut chose = None;
        for b in 0u8..=255 {
            let g = [p[p.len() - 2], p[p.len() - 1], b];
            if !seen.contains(&g) {
                chose = Some(b);
                break;
            }
        }
        let b = chose.expect("3-grama livre deve existir");
        seen.insert([p[p.len() - 2], p[p.len() - 1], b]);
        p.push(b);
    }
    let head = p[..8].to_vec();
    p.extend_from_slice(&head);
    let st = roundtrip("dist_8192", &p);
    assert!(
        st.windows(2).any(|w| *w == [0x00, 0x06]),
        "token da dist maxima (Low=00, High=06) ausente"
    );
}

#[test]
fn quase_limites_len_tres_quatro_cinco_e_eco_curto() {
    for (nome, plain) in [
        ("len3", b"ABCABC".to_vec()),
        ("len4", b"ABCDABCD".to_vec()),
        ("len5", b"ABCDEABCDE".to_vec()),
        ("sem_ref", b"AABB".to_vec()),
        ("eco_dist2", b"ABABABAB".to_vec()),
    ] {
        roundtrip(nome, &plain);
    }
    // "ABABABAB": match len=6 dist=2 -> separado count3=4, X=0x1FFE ->
    // Low=FE, High=FC; stream exata de 9 bytes < piso literal 8+4=12.
    let st = enc_big(b"ABABABAB");
    assert_eq!(
        st,
        vec![0x2B, 0x00, b'A', b'B', 0xFE, 0xFC, 0x00, 0xF0, 0x00]
    );
}

#[test]
fn determinismo_duplo_e_independencia_de_limite_folgado() {
    let mut plain = Vec::new();
    let mut s = 0xACE1u16;
    for _ in 0..5000 {
        s = s.wrapping_mul(25).wrapping_add(1);
        plain.push((s >> 8) as u8);
        if plain.len() % 97 == 0 {
            let k = plain.len() / 2;
            let n = 20usize.min(k);
            let chunk: Vec<u8> = plain[k..k + n].to_vec();
            plain.extend_from_slice(&chunk);
        }
    }
    let a = encode(&plain, 1 << 24, 1 << 26).unwrap().stream;
    let b = encode(&plain, 1 << 24, 1 << 26).unwrap().stream;
    assert_eq!(a, b, "encode nao he deterministico");
    let c = encode(&plain, 1 << 25, 1 << 27).unwrap().stream;
    assert_eq!(a, c, "limites folgados diferentes mudaram a saida");
}

#[test]
fn limites_cortam_no_ponto_de_uso_sem_parcela_em_erro() {
    let plain = b"KOSINSKI-KOSINSKI-KOSINSKI";
    let ok = encode(plain, 1 << 20, 1 << 24).unwrap();
    let n = ok.stream.len();
    assert_eq!(encode(plain, n, 1 << 24).unwrap().stream, ok.stream);
    assert_eq!(encode(plain, n - 1, 1 << 24), Err(EncError::StreamLimit));
    assert_eq!(encode(plain, 0, 1 << 24), Err(EncError::StreamLimit));
}

#[test]
fn formula_de_trabalho_exata_e_corte_deterministico() {
    // ENCODE-CONTRACT §4: 1/byte de plain coberto + 1/byte de stream +
    // 1/bit emitido + 1/candidato examinado. "ABCDEF": 3-gramas todos
    // unicos -> 0 candidatos; 6 + 11 + 8 = 25. Vazia: 0 + 5 + 2 = 7.
    let plain = b"ABCDEF";
    let st = encode(plain, 1 << 20, 1 << 24).unwrap().stream;
    assert_eq!(st.len(), 11, "6 literais + descritor + terminator");
    assert_eq!(encode(plain, 1 << 20, 24), Err(EncError::WorkLimit));
    assert!(encode(plain, 1 << 20, 25).is_ok());
    assert_eq!(encode(&[], 1 << 20, 6), Err(EncError::WorkLimit));
    assert_eq!(encode(&[], 1 << 20, 7).unwrap().stream.len(), 5);
}

#[test]
fn decoder_do_pacote_recusa_stream_corrompida_estruturalmente() {
    // Controle de corrupcao (b) do ENCODE-CONTRACT §7: o produto nao herda a
    // tolerancia do oraculo. Mutar o Low do separado F8/FE (dist=8) para
    // 00/FE (dist=0x100 > historico) deve dar InvalidReference no decoder.
    let plain = b"ABCDEFGHABCDEFGH"; // tem separado real (count3=6)
    let mut st = enc_big(plain);
    let idx = st
        .windows(2)
        .position(|w| *w == [0xF8, 0xFE])
        .expect("ref F8 FE");
    st[idx] = 0x00;
    assert_eq!(
        decode(&st, 1 << 16, 1 << 20).err(),
        Some(KosError::InvalidReference)
    );
}

#[test]
fn nunca_panic_em_plains_arbitrarios_com_seed() {
    let mut state = 0xDEAD_BEEFu32;
    for n in [1usize, 2, 3, 17, 64, 300, 4096] {
        let mut p = Vec::with_capacity(n);
        for _ in 0..n {
            state = state.wrapping_mul(1103515245).wrapping_add(12345);
            p.push((state >> 16) as u8);
        }
        let st = encode(&p, 2 * n + 128, 1 << 24)
            .expect("teto atingivel pela estrategia deve Ok")
            .stream;
        let d = decode(&st, n + 16, 1 << 24).expect("roundtrip seed");
        assert_eq!(d.output, p);
        assert_eq!(d.bytes_consumed, st.len());
    }
}
