//! Testes de contrato v1 do decodificador Kosinski.
//!
//! Fixtures: `fixtures/kosinski/` e `fixtures/runtime/` — cópias
//! byte-idênticas (SHA-pinned em `tests/fixtures.rs`) das esperas
//! INDEPENDENTES do decoder publicadas em `data/rex_profiles/codec/kosinski/`
//! (confirmadas pelo oraculo externo koscmp na rodada do perfil; ver
//! manifest.tsv de lá). A suite normal NAO exige o oraculo instalado nem a
//! arvore data/; a reproducao diferencial vive em
//! `scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh`.
//! Valores de `bytes_consumed` seguem o contrato (para no terminator; padding
//! nao consumido), conferidos contra o espelho strict do perfil.

use rex_kosinski::{decode, KosDecoded, KosError};
use std::path::PathBuf;

fn perfil() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/kosinski")
}

fn runtime() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/runtime")
}

fn read(rel: &str) -> Vec<u8> {
    let p = perfil().join(rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("fixture {rel}: {e}"))
}

fn generous(in_len: usize, out_len: usize) -> (usize, usize) {
    (out_len, 4 * (in_len + out_len) + 4096)
}

fn ok_golden(name: &str, consumed: usize) {
    let st = read(&format!("golden/{name}.kos"));
    let exp = read(&format!("golden/{name}.expected.bin"));
    let (max_out, work) = generous(st.len(), exp.len());
    let KosDecoded {
        output,
        bytes_consumed,
    } = decode(&st, max_out, work).unwrap_or_else(|e| panic!("{name}: erro inesperado {e:?}"));
    assert_eq!(
        output, exp,
        "{name}: saida diverge da espera independente (golden)"
    );
    assert_eq!(
        bytes_consumed, consumed,
        "{name}: bytes_consumed (terminator, sem padding)"
    );
    assert!(
        bytes_consumed <= st.len(),
        "{name}: nunca alem do fim da stream"
    );
}

#[test]
fn golden_m01_literals() {
    ok_golden("m01_literals", 11);
}
#[test]
fn golden_m03_inline_match() {
    ok_golden("m03_inline_match", 11);
}
#[test]
fn golden_m04_separate_short() {
    ok_golden("m04_separate_short", 18);
}
#[test]
fn golden_m05_separate_long_far() {
    ok_golden("m05_separate_long_far", 115);
}
#[test]
fn golden_m06_continue_edge_quirk_aceito() {
    ok_golden("m06_continue_edge", 14);
}
#[test]
fn golden_m07_inline_dist_igual_historico() {
    ok_golden("m07_inline_exact_history", 10);
}
#[test]
fn golden_m08_len10_tres_bytes() {
    ok_golden("m08_len10_three_byte", 17);
}
#[test]
fn golden_m09_early_fetch_fronteira_16o_bit() {
    ok_golden("m09_earlyfetch_boundary_literal", 23);
}
#[test]
fn golden_m10_earlyfetch_straddle_inline() {
    ok_golden("m10_earlyfetch_straddle_inline", 21);
}

#[test]
fn golden_m02_sem_terminador_e_truncated_pelo_contrato() {
    // Excecao registrada no perfil: o oraculo ACEITA por exaustao; sob o
    // contrato do produto (terminator obrigatorio) e truncated. Nome da
    // fixture preserva "with_eod" por razoes historicas.
    let st = read("golden/m02_single_with_eod.kos");
    assert_eq!(decode(&st, 64, 4096), Err(KosError::Truncated));
}

#[test]
fn plains_roundtrip_oraculo_reproduzidos_com_padding_parcial() {
    // (nome, consumed medido no espelho strict do perfil — streams do koscmp
    // terminam 1 byte antes do fim real: padding pos-terminator NAO consumido)
    let casos = [
        ("abcdef", 11usize, 12usize),
        ("ab_repeat", 19, 20),
        ("empty", 5, 6),
        ("far_window_40k", 1085, 1086),
        ("near_window_2k", 76, 76),
        ("noisy_runs_16k", 1526, 1526),
        ("odd3", 10, 10),
        ("pseudo_random_8k", 394, 394),
        ("single", 6, 6),
        ("text_rep", 105, 106),
        ("tile_like", 163, 164),
        ("zeros_64k", 838, 838),
    ];
    for (name, consumed, total) in casos {
        let st = read(&format!("plain/{name}.kos"));
        let exp = read(&format!("plain/{name}.bin"));
        assert_eq!(
            st.len(),
            total,
            "{name}: tamanho de stream fixado na publicacao"
        );
        let (max_out, work) = generous(st.len(), exp.len());
        let got = decode(&st, max_out, work).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_eq!(got.output, exp, "{name}: saida diverge do plain esperado");
        assert_eq!(
            got.bytes_consumed, consumed,
            "{name}: terminator, padding excluido"
        );
    }
}

#[test]
fn negativos_k01_a_k05_erros_estruturados() {
    let st = read("negative/k01_no_terminator_after_literal.kos");
    assert_eq!(decode(&st, 4096, 65536), Err(KosError::Truncated));
    let st = read("negative/k02_separate_missing_high_byte.kos");
    assert_eq!(decode(&st, 4096, 65536), Err(KosError::Truncated));
    let st = read("negative/k03_separate_ref_before_history_start.kos");
    assert_eq!(decode(&st, 4096, 65536), Err(KosError::InvalidReference));
    let st = read("negative/k04_inline_dist_beyond_history.kos");
    assert_eq!(decode(&st, 4096, 65536), Err(KosError::InvalidReference));
    // k05: stream BEM-FORMADA (512 bytes de saida); o limite e obrigacao do
    // produto — prova de que ExcessiveOutput nao e defeito da entrada.
    let st = read("negative/k05_excessive_output.kos");
    assert_eq!(decode(&st, 16, 65536), Err(KosError::ExcessiveOutput));
    // mesma stream passa quando o limite comporta a saida real:
    let ok = decode(&st, 512, 65536).expect("k05 com max_out=512 deve decodificar");
    assert_eq!(ok.output.len(), 512);
    assert_eq!(ok.bytes_consumed, 296);
}

#[test]
fn borda_input_vazio_e_degenerado() {
    assert_eq!(decode(&[], 4096, 65536), Err(KosError::EmptyInput));
}

#[test]
fn borda_um_byte_descritor_incompleto() {
    assert_eq!(decode(&[0xff], 4096, 65536), Err(KosError::Truncated));
    assert_eq!(decode(&[0x00], 4096, 65536), Err(KosError::Truncated));
}

#[test]
fn borda_truncamentos_sistematicos_de_m01_sem_panic() {
    let full = read("golden/m01_literals.kos"); // 11 bytes, Ok no inteiro
    for n in 1..full.len() {
        let r = decode(&full[..n], 4096, 65536);
        assert_eq!(
            r,
            Err(KosError::Truncated),
            "prefixo de {n} bytes deve ser Truncated"
        );
    }
    assert!(decode(&full, 4096, 65536).is_ok());
}

#[test]
fn borda_m05_sem_ultimo_byte_e_truncated_oraculo_aceitava() {
    // Sonda registrada na evidencia do perfil: koscmp rc=0 ACEITAVA e produzia
    // saida maior (8692 > 8451). O produto NAO herda o defeito.
    let mut st = read("golden/m05_separate_long_far.kos");
    st.pop();
    assert_eq!(decode(&st, 65536, 1 << 20), Err(KosError::Truncated));
}

#[test]
fn borda_referencia_antes_do_historico_sonda_0200ffff() {
    // Sonda registrada: oraculo com comportamento nao-deterministico; produto:
    // invalid-reference estruturado.
    assert_eq!(
        decode(&[0x02, 0x00, 0xff, 0xff], 4096, 65536),
        Err(KosError::InvalidReference)
    );
}

#[test]
fn borda_copia_sobreposta_eco_byte_a_byte() {
    // Fixture autoral da missao (espera derivada do contrato, nao do decoder):
    // 15 00 | 58('X') | FF F9 (separado dist=1 len=3 com eco) | 00 00 00 (terminator)
    let st = std::fs::read(runtime().join("overlap_echo.kos")).expect("fixture overlap_echo.kos");
    let exp = std::fs::read(runtime().join("overlap_echo.expected.bin")).expect("espera");
    let got = decode(&st, 64, 4096).expect("stream bem-formada");
    assert_eq!(got.output, exp);
    assert_eq!(got.output, b"XXXX");
    assert_eq!(got.bytes_consumed, st.len());
}

#[test]
fn borda_limite_exato_de_saida() {
    let st = std::fs::read(runtime().join("overlap_echo.kos")).expect("fixture");
    assert_eq!(decode(&st, 3, 65536), Err(KosError::ExcessiveOutput));
    let ok = decode(&st, 4, 65536).expect("sai exatamente no limite");
    assert_eq!(ok.output, b"XXXX");
    assert_eq!(ok.bytes_consumed, 8);
}

#[test]
fn borda_orcamento_de_trabalho_deterministico() {
    // Contrato: 1 unidade por bit de descritor + 1 por byte de input lido +
    // 1 por byte escrito. Stream: 5 bits + 8 bytes lidos + 4 escritos = 17.
    let st = std::fs::read(runtime().join("overlap_echo.kos")).expect("fixture");
    assert_eq!(decode(&st, 4096, 16), Err(KosError::WorkLimit));
    assert!(decode(&st, 4096, 17).is_ok());
}

#[test]
fn limites_cortam_durante_a_copia_larga_nao_so_no_fim() {
    // Item 4 da revisao (2026-09-27): prova de enforcement NO PONTO DE USO.
    // Stream autoral minima: 15 00 | 41('A') | FF F8 FF (separado, len=256,
    // dist=1 — eco) | 00 00 00 (terminador via separado). Descritor 0x0015:
    // bit0=1 literal; bit1=0,bit2=1 separado longo; bit3=0,bit4=1 segundo
    // separado, cujo c==0 e o terminador. Um UNICO token pede 256 bytes; se o
    // decoder truncasse a saida no final ou conferisse o orcamento depois de
    // alocar, estes casos dariam Ok ou erro diferente.
    let st = vec![0x15u8, 0x00, 0x41, 0xFF, 0xF8, 0xFF, 0x00, 0x00, 0x00];
    // max_output=10: a copia comeca (1 byte de historico e valido) e e
    // interrompida no 11o byte escrito — ExcessiveOutput em meio ao token.
    assert_eq!(
        decode(&st, 10, 1 << 20),
        Err(KosError::ExcessiveOutput),
        "corte de saida deve ocorrer byte a byte dentro da copia"
    );
    // work_limit=100: leitura do token consome 10 unidades; a copia escreve
    // 1 byte por unidade — o corte cai no 91o byte copiado, ainda dentro do
    // mesmo token (WorkLimit em meio ao token, nao depois de alocar tudo).
    assert_eq!(
        decode(&st, 4096, 100),
        Err(KosError::WorkLimit),
        "orcamento deve ser cobrado por byte escrito, durante a copia"
    );
    // Controle positivo: sem limites apertados, eco de len=256/dist=1 produz
    // 257 bytes ('A' ecoado) e consome exatamente os 9 bytes (terminador no
    // ultimo byte, sem padding).
    let ok = decode(&st, 300, 1 << 16).expect("stream bem-formada");
    assert_eq!(ok.output, vec![b'A'; 257]);
    assert_eq!(ok.bytes_consumed, 9);
}

#[test]
fn nunca_panic_em_bytes_arbitrarios() {
    // Mutacoes com seed deterministico sobre streams reais: resultado deve
    // ser coerente com o contrato (Ok com limites ou Err estruturado), SEM
    // panico. Nem toda mutacao e invalida — por isso nao se exige Err sempre.
    let bases: Vec<Vec<u8>> = vec![
        read("golden/m03_inline_match.kos"),
        read("golden/m06_continue_edge.kos"),
        read("plain/text_rep.kos"),
        read("plain/far_window_40k.kos"),
    ];
    let mut state = 0x1234_5678u32;
    for base in bases {
        for i in 0..base.len() {
            state = state.wrapping_mul(1103515245).wrapping_add(12345);
            let mut m = base.clone();
            m[i] ^= ((state >> 16) as u8) | 1;
            let r = decode(&m, 1 << 16, 1 << 20);
            match r {
                Ok(d) => {
                    assert!(d.bytes_consumed <= m.len());
                    assert!(d.output.len() <= (1 << 16));
                }
                Err(e) => assert!(
                    matches!(
                        e,
                        KosError::Truncated
                            | KosError::InvalidReference
                            | KosError::ExcessiveOutput
                            | KosError::WorkLimit
                    ),
                    "erro inesperado {e:?}"
                ),
            }
        }
    }
}
