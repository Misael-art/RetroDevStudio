//! Item 6/7 da validação (missão frente B, 2026-09-27): truncamentos
//! sistemáticos e mutações com seed sobre TODAS as streams publicadas + um
//! negativo discriminativo por alteração detectada via comparação
//! independente (saida do decoder != espera do oraculo).
//!
//! Nem toda mutacao e invalida: o contrato exige ausencia de panico, limites
//! respeitados e resultado coerente (Ok estruturado ou Err estruturado).

use rex_kosinski::{decode, KosError};
use std::path::PathBuf;

fn perfil() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/kosinski")
}

fn todas_streams() -> Vec<(String, Vec<u8>)> {
    let mut v = Vec::new();
    for sub in ["plain", "golden", "negative"] {
        let dir = perfil().join(sub);
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .expect("dir de fixtures")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map(|x| x == "kos").unwrap_or(false))
            .collect();
        files.sort();
        for p in files {
            v.push((
                p.file_name().unwrap().to_string_lossy().into_owned(),
                std::fs::read(&p).expect("leitura"),
            ));
        }
    }
    assert_eq!(v.len(), 27, "12 plains + 10 goldens + 5 negativos");
    v
}

#[test]
fn truncamentos_sistematicos_todas_as_streams_sem_panic() {
    let mut n_ok = 0usize;
    let mut n_err = 0usize;
    for (name, st) in todas_streams() {
        for n in 0..st.len() {
            let r = decode(&st[..n], 1 << 20, 1 << 22);
            match r {
                Ok(d) => {
                    // prefixo que ainda assim termina em terminator legitimo
                    assert!(
                        d.bytes_consumed <= n,
                        "{name} prefixo {n}: consumiu alem do corte"
                    );
                    n_ok += 1;
                }
                Err(e) => {
                    assert!(
                        matches!(
                            e,
                            KosError::EmptyInput
                                | KosError::Truncated
                                | KosError::InvalidReference
                                | KosError::ExcessiveOutput
                                | KosError::WorkLimit
                        ),
                        "{name} prefixo {n}: erro nao-contratual {e:?}"
                    );
                    n_err += 1;
                }
            }
        }
    }
    // Prefixos que terminam exatamente no terminator (streams com padding)
    // continuam Ok — nem todo corte e invalido.
    assert!(
        n_err > 100,
        "esperado muitos prefixes invalidos, n_err={n_err}"
    );
    assert!(
        n_ok > 0,
        "esperado pelo menos um prefixo completo legitimo, n_ok={n_ok}"
    );
}

#[test]
fn mutacoes_com_seed_todas_as_streams_sem_panic_e_limites() {
    let mut state = 0xDEAD_BEEFu64;
    for (name, st) in todas_streams() {
        for i in 0..st.len() {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let mut m = st.clone();
            m[i] ^= ((state >> 33) as u8) | 1; // garante bit 1 -> byte alterado
            let r = decode(&m, 1 << 16, 1 << 20);
            match r {
                Ok(d) => {
                    assert!(
                        d.bytes_consumed <= m.len(),
                        "{name}@{i}: consumiu alem da stream"
                    );
                    assert!(d.output.len() <= (1 << 16), "{name}@{i}: violou max_output");
                }
                Err(e) => assert!(
                    matches!(
                        e,
                        KosError::Truncated
                            | KosError::InvalidReference
                            | KosError::ExcessiveOutput
                            | KosError::WorkLimit
                    ),
                    "{name}@{i}: erro nao-contratual {e:?}"
                ),
            }
        }
    }
}

#[test]
fn negativo_discriminativo_alteracao_detectada_por_comparacao_independente() {
    // Item 7: uma alteracao que o decoder ACEITA (mutacao em byte de literal
    // continua bem-formada) mas produz saida INCORRETA — detectada somente
    // porque a espera e independente (bytes publicados do oraculo).
    let st = std::fs::read(perfil().join("golden/m01_literals.kos")).expect("fixture");
    let exp = std::fs::read(perfil().join("golden/m01_literals.expected.bin")).expect("espera");
    let mut m = st.clone();
    m[2] ^= 0x20; // 'A' -> 'a' no primeiro literal
    let d = decode(&m, 64, 4096).expect("mutacao permanece bem-formada");
    assert_eq!(
        d.output.len(),
        exp.len(),
        "mesmo comprimento — so o conteudo diverge"
    );
    assert_ne!(
        d.output, exp,
        "comparacao independente deve detectar a alteracao"
    );
    // e o original bate exatamente (controle):
    let ok = decode(&st, 64, 4096).expect("original valida");
    assert_eq!(ok.output, exp);
}
