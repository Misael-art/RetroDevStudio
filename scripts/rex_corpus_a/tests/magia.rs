//! Probas do detector de maxias de fluxo (Fase 3).
//!
//! Unha maxia de catro bytes é unha *secuencia medida*, non un diagnóstico: as
//! etiquetaxes `KosM`/`KosP`/`EniM`/`GSS `/`Unic` asígnanse a códecs distintos
//! segundo a revisión e o xogo, e esa asignación non se afirma aquí. O que se
//! proba é que a conta é exacta, que solapes e fins de buffer non se perden, e
//! que un cero se declara como cero en vez de como ausencia de ferramenta.

use rex_corpus::magia::{contar, MAXIAS};

fn limits(max: usize) -> rex_corpus::magia::MagiaLimits {
    rex_corpus::magia::MagiaLimits {
        max_por_secuencia: max,
    }
}

#[test]
fn nun_buffer_baleiro_non_hai_maxias_e_iso_e_unha_medida_non_un_fallo() {
    let r = contar(&[], limits(16));
    assert_eq!(r.total, 0);
    assert_eq!(
        r.por_secuencia.len(),
        MAXIAS.len(),
        "tódalas secuencias declaradas saen no informe, aínda con conto cero"
    );
    for m in &r.por_secuencia {
        assert_eq!(m.ocorrencias, 0, "{}: {m:?}", m.secuencia);
    }
}

#[test]
fn conta_unha_maxia_plantada_e_indica_o_desprazamento_exacto() {
    let mut v = vec![0u8; 0x40];
    v[0x10..0x14].copy_from_slice(b"KosM");
    let r = contar(&v, limits(16));
    let kosm = r
        .por_secuencia
        .iter()
        .find(|m| m.secuencia == "KosM")
        .unwrap();
    assert_eq!(kosm.ocorrencias, 1);
    assert_eq!(kosm.desprazamentos, vec![0x10]);
    assert_eq!(r.total, 1);
}

#[test]
fn conta_todas_as_ocorrencias_dunha_secuencia_repetida() {
    let mut v = Vec::new();
    for i in 0..3 {
        v.extend_from_slice(b"KosP");
        v.extend_from_slice(&[0, 0, 0]);
        let _ = i;
    }
    let r = contar(&v, limits(16));
    let k = r
        .por_secuencia
        .iter()
        .find(|m| m.secuencia == "KosP")
        .unwrap();
    assert_eq!(k.ocorrencias, 3, "contaxe: {k:?}");
    assert_eq!(k.desprazamentos, vec![0, 7, 14]);
}

#[test]
fn unha_secuencia_partida_pol_fin_do_buffer_non_conta() {
    // `Kos` nos tres últimos bytes: non é `KosM`, e contalo sería inventar.
    let v = vec![0u8; 0x21];
    let mut v = v;
    v[0x1e..].copy_from_slice(b"Kos");
    let r = contar(&v, limits(16));
    assert_eq!(r.total, 0, "prefixo incompleto non e unha maxia: {r:?}");
}

#[test]
fn o_tope_por_secuencia_deixa_constar_as_ocorrencias_non_visitadas() {
    let mut v = Vec::new();
    for _ in 0..5 {
        v.extend_from_slice(b"Unic");
    }
    let r = contar(&v, limits(2));
    let u = r
        .por_secuencia
        .iter()
        .find(|m| m.secuencia == "Unic")
        .unwrap();
    assert_eq!(u.desprazamentos.len(), 2, "moi poucos gardados: {u:?}");
    assert_eq!(u.ocorrencias, 5, "a conta total non depende do tope");
    assert!(u.tope_acadado, "hai que dicir que se recortou: {u:?}");
}

#[test]
fn as_catro_maxias_distintas_plantadas_accountanse_por_separado() {
    let mut v = vec![0u8; 0x100];
    v[0x00..0x04].copy_from_slice(b"KosM");
    v[0x10..0x14].copy_from_slice(b"EniM");
    v[0x20..0x24].copy_from_slice(b"GSS ");
    v[0x30..0x34].copy_from_slice(b"Unic");
    let r = contar(&v, limits(16));
    assert_eq!(r.total, 4, "desglose: {:?}", r.por_secuencia);
    for agulla in ["KosM", "EniM", "GSS ", "Unic"] {
        let m = r
            .por_secuencia
            .iter()
            .find(|m| m.secuencia == agulla)
            .unwrap();
        assert_eq!(m.ocorrencias, 1, "{agulla}: {m:?}");
    }
    let kosp = r
        .por_secuencia
        .iter()
        .find(|m| m.secuencia == "KosP")
        .unwrap();
    assert_eq!(kosp.ocorrencias, 0, "KosP non se plantou: {kosp:?}");
}

#[test]
fn a_etiqueta_escrita_non_confunde_a_secuencia_cos_bytes_do_cabeco() {
    // O cabeco MD real leva texto ASCII; ningunha desas cadeas debe sair como
    // maxia. É o falso positivo que faría «confirmar» un códec polo nome.
    let mut v = vec![0u8; 0x300];
    v[0x100..0x110].copy_from_slice(b"SEGA MEGA DRIVE ");
    v[0x120..0x128].copy_from_slice(b"SONIC   ");
    let r = contar(&v, limits(16));
    assert_eq!(r.total, 0, "texto do cabeco non é un fluxo: {r:?}");
}
