//! Lectura das declaracións `negative/*.expected.json` da referencia fixada.
//!
//! A referencia autoriza dicir «este fluxo debe ser rexeitado» e tamén
//! «debe ser rexeitado *por esta razón*». Unha ferramenta que só comproba o
//! rexeito aceptaría un decoder que falla polo motivo equivocado.

use rex_corpus::spec::{campo_declarado, negativo_de, token_declarado};

/// Unha liña real do árbol `data/rex_profiles/codec/kosinski/negative/`.
const K01: &str = r#"{"vector": "k01_no_terminator_after_literal", "kind": "negative-spec", "expected_error": "truncated", "mirror_condition": "ERR-trunc", "max_out": null, "stream_len": 3, "note": "Derivado do contrato/formato; o oráculo koscmp NÃO valida histórico nem exige terminator (defeito registrado em build-vectors.sh) e NÃO foi executado sobre este stream."}"#;

const K05: &str = r#"{"vector": "k05_excessive_output", "kind": "negative-spec", "expected_error": "excessive-output", "mirror_condition": "ERR-eod", "max_out": 16, "stream_len": 296, "note": "Derivado do contrato."}"#;

#[test]
fn unha_espera_declarada_lese_por_completo_incluidos_os_nulos() {
    let n = negativo_de(K01);
    assert_eq!(n.expected_error.as_deref(), Some("truncated"));
    assert_eq!(n.mirror_condition.as_deref(), Some("ERR-trunc"));
    assert_eq!(n.max_out, None, "`max_out: null` non é un límite");
    assert_eq!(n.stream_len, Some(3));
}

#[test]
fn un_max_out_declarado_non_se_confunde_con_o_por_defecto() {
    let n = negativo_de(K05);
    assert_eq!(n.max_out, Some(16), "k05 si declara límite de saída");
    assert_eq!(n.stream_len, Some(296));
    assert_eq!(n.expected_error.as_deref(), Some("excessive-output"));
}

#[test]
fn a_nota_de_procedencia_non_corrompe_as_claves_previas_aínda_que_teña_comas_e_citas() {
    // `note` é o último campo e está cheo de texto libre: un lector ingenuo
    // podería cortar alí ou ler coma que non son.
    let n = negativo_de(K01);
    assert_eq!(
        n.expected_error.as_deref(),
        Some("truncated"),
        "a nota non pode desprazar a clave"
    );
    assert_eq!(
        campo_declarado(K01, "vector").as_deref(),
        Some("k01_no_terminator_after_literal")
    );
}

#[test]
fn clave_inexistente_devolve_ningures_en_lugar_de_adivinar() {
    assert_eq!(campo_declarado(K01, "non_existe"), None);
    assert_eq!(negativo_de("{}").expected_error, None);
    // texto que menciona a clave dentro dun valor non é unha clave.
    let decoio = r#"{"nota": "fala de expected_error pero non o declara"}"#;
    assert_eq!(campo_declarado(decoio, "expected_error"), None);
}

#[test]
fn as_etiquetas_do_contrato_teñen_traducion_e_as_descoecidas_non_inventan_nada() {
    assert_eq!(token_declarado("truncated"), Some("fluxo-truncado"));
    assert_eq!(
        token_declarado("invalid-reference"),
        Some("referencia-invalida")
    );
    assert_eq!(token_declarado("excessive-output"), Some("saida-excesiva"));
    // Unha etiqueta nova na referencia non debe mapearse a un motivo calquera.
    assert_eq!(token_declarado("bit-flipped"), None);
}
