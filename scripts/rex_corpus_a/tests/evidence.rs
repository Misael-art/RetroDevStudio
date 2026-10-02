//! Contrato das cadeas de evidencia de consumidor (`rex-corpus-evidence/v1`).
//!
//! O rexistro `rex-corpus-resource/v2` garda `consumer_evidence` como
//! `Vec<String>`. Se calquera cadea vale, un rexistro pode afirmar unha
//! confianza máis forte que a súa proba. Estas probas fixan a gramática: só
//! se fabrican desde as estruturas medidas, só se len se cumpren a forma, e
//! a confianza corresponde exactamente á evidencia — nin máis forte nin máis
//! feble.

use rex_corpus::consumer::{CargaAbsoluta, JsrSite, PointerTable, RefSite};
use rex_corpus::evidence::{Evidencia, SCHEMA_EVIDENCIA};

fn carga(offset: usize, registro: u8, operando: u32) -> CargaAbsoluta {
    CargaAbsoluta {
        offset,
        registro,
        operando,
    }
}

#[test]
fn esquema_de_evidencia_versionado() {
    assert_eq!(SCHEMA_EVIDENCIA, "rex-corpus-evidence/v1");
}

#[test]
fn carga_con_chamada_formatea_cos_enderezos_de_cinco_dixitos() {
    let e = Evidencia::desde_carga(
        &carga(0x40, 0, 0x795A2),
        Some(&JsrSite {
            offset: 0x4C,
            target: 0x85A2,
        }),
    );
    assert_eq!(e.format(), "lea@0x00040/A0/chamada@0x0004C/0x085A2");
    assert!(e.vincula(), "un `lea` cuxo operando é o fluxo é un vínculo");
}

#[test]
fn carga_sen_chamada_non_inventa_un_destino() {
    let e = Evidencia::desde_carga(&carga(0x1364, 0, 0x3F09A), None);
    assert_eq!(e.format(), "lea@0x01364/A0");
    assert!(
        e.vincula(),
        "Sonic 1 entrega o fluxo con `bsr`: o vínculo é a carga"
    );
}

#[test]
fn chamada_e_taboa_formatean_as_súas_formas_medibles() {
    let c = Evidencia::desde_chamada(&JsrSite {
        offset: 0x1085E,
        target: 0x1CAEC,
    });
    assert_eq!(c.format(), "chamada@0x1085E/0x1CAEC");
    assert!(c.vincula());

    let t = Evidencia::desde_taboa(&PointerTable {
        base_offset: 0x71A9C,
        entries: 19,
        values: vec![0x745DC],
        ascending: true,
    });
    assert_eq!(t.format(), "taboa@0x71A9C/19/crecente");
    assert!(
        !t.vincula(),
        "a Fase 4 refutou R1: unha táboa crecente non distingue recurso de azar \
         (desaparece entre min=3 e min=4 na reservada; Altered Beast produce-as dende 0x12)"
    );
}

#[test]
fn referencia_crua_non_e_un_vinculo() {
    let r = Evidencia::desde_referencia(&RefSite {
        offset: 0x71998,
        operand: 0x71A9C,
    });
    assert_eq!(r.format(), "ref@0x71998");
    assert!(
        !r.vincula(),
        "Fase 2 retractou `vinculo=si` en 0x745DC: unha referencia de bytes non proba consumidor"
    );
}

#[test]
fn enderezos_de_seis_dixitos_conservanse() {
    // Unha imaxe de 4 MiB chega a 0x400000; `0x{:05X}` anchoa, non truncaba.
    let e = Evidencia::desde_chamada(&JsrSite {
        offset: 0x3F_FF00,
        target: 0x40_0000,
    });
    assert_eq!(e.format(), "chamada@0x3FFF00/0x400000");
    assert_eq!(Evidencia::parse(&e.format()).as_ref(), Some(&e));
}

#[test]
fn parse_rexeita_formas_que_non_saen_da_gramatica() {
    for malo in [
        "",
        "lea@0x40/A0",                      // menos de cinco dixitos
        "lea@0x00040/a0",                   // rexistro en minúsculas
        "lea@0x00040/A8",                   // rexistro inexistente
        "lea@0x00040",                      // sen rexistro
        "chamada@0x1085E",                  // sen destino
        "chamada@0x1085E/0x085A2/extra",    // campo de sobra
        "taboa@0x71A9C/dez/crecente",       // entradas non decimal
        "taboa@0x71A9C/19/aleatorio",       // orden non medida
        "ref@0X71998",                      // prefio `0X` maiúsculo
        "CARGA offset=0x00040 rexistro=A0", // o verbo do CLI non e a cadea
        "lea@0x00040/A0/chamada",           // chamada truncada
    ] {
        assert_eq!(
            Evidencia::parse(malo),
            None,
            "aceitou {malo:?} como evidencia"
        );
    }
}

#[test]
fn roundtrip_format_parse_format_para_cada_forma() {
    let casos = [
        Evidencia::desde_carga(&carga(0x40, 0, 0x795A2), None),
        Evidencia::desde_carga(
            &carga(0x1CAEC_usize - 6, 3, 0x1CAEC),
            Some(&JsrSite {
                offset: 0x1CAE6,
                target: 0x85A2,
            }),
        ),
        Evidencia::desde_chamada(&JsrSite {
            offset: 0x1,
            target: 0x0,
        }),
        Evidencia::desde_taboa(&PointerTable {
            base_offset: 0x8000,
            entries: 1,
            values: vec![],
            ascending: false,
        }),
        Evidencia::desde_referencia(&RefSite {
            offset: 0x200,
            operand: 0x300,
        }),
    ];
    for e in &casos {
        let s = e.format();
        let v = Evidencia::parse(&s).unwrap_or_else(|| panic!("non parsea {s:?}"));
        assert_eq!(&v, e, "{s} non volta ao original");
        assert_eq!(v.format(), s, "dobre formateo non e determinista");
    }
}

#[test]
// A evidencia non pode afirmar un vínculo que a súa propia forma desmente:
// `parse` é o único xeito de pasar dunha cadea externa a un rexistro.
fn parse_non_aceita_unha_cadea_que_promete_un_destino_inexistente() {
    assert_eq!(
        Evidencia::parse("lea@0x00040/A0/chamada@0x0004C/0xZZZZZ"),
        None
    );
}

// ---------------------------------------------------------------------------
// O gardafío do rexistro: a evidencia non é texto libre.
// ---------------------------------------------------------------------------

use rex_corpus::resource::{Confidence, ResourceRecord};

fn rexistro(confidence: Confidence, evidencia: &[&str]) -> ResourceRecord {
    ResourceRecord {
        rom_sha256: "aa".repeat(32),
        normalized_sha256: "bb".repeat(32),
        profile_id: "md-linear".into(),
        offset: Some(0x795A2),
        input_span: Some(7581),
        codec: "kosinski".into(),
        variant: "base".into(),
        bytes_consumed: Some(7581),
        output_size: Some(7936),
        output_sha256: Some("cc".repeat(32)),
        consumer_evidence: evidencia.iter().map(|s| s.to_string()).collect(),
        confidence,
        limitations: vec!["sen execución da ROM".into()],
        mapper_profile: Some("md-linear".into()),
        mapper_state: None,
    }
}

#[test]
fn rexistro_estrutural_cunha_carga_con_chamada_valida() {
    let r = rexistro(
        Confidence::VinculoEstrutural,
        &["lea@0x10642/A0/chamada@0x10648/0x085A2"],
    );
    r.validar().expect("rexistro coherente");
}

#[test]
fn rexistro_estrutural_sen_carga_con_chamada_rexeitase() {
    // `vinculo-estrutural` precisa a forma completa lea→chamada: unha `lea`
    // solitaria é menos do que o rótulo afirma.
    let so_lea = rexistro(Confidence::VinculoEstrutural, &["lea@0x00040/A0"]);
    let erro = so_lea.validar().unwrap_err();
    assert!(erro.contains("máis forte que a proba"), "{erro}");

    let baleiro = rexistro(Confidence::VinculoEstrutural, &[]);
    assert!(baleiro.validar().is_err(), "estrutural sen proba ningunha");
}

#[test]
fn rexistro_referencia_estatica_cunha_instrucion_sen_chamada_valida() {
    // Sonic 1: `lea fluxo,A0` medida; a chamada é `bsr`, que non se modela.
    let r = rexistro(Confidence::ReferenciaEstatica, &["lea@0x03082/A0"]);
    r.validar().expect("referencia estática coherente");

    // Unha chamada ao enderezo tamén é forma de instrución.
    let c = rexistro(Confidence::ReferenciaEstatica, &["chamada@0x1085E/0x1CAEC"]);
    c.validar().expect("chamada ao enderezo é instrución");
}

#[test]
fn rexistro_referencia_estatica_rexeitase_se_a_medida_e_mais_forte_ou_mais_feble() {
    // Se hai carga con chamada medida, a confianza non pode ser a feble: o
    // rexistro mentiría por defecto.
    let baixa = rexistro(
        Confidence::ReferenciaEstatica,
        &["lea@0x10642/A0/chamada@0x10648/0x085A2"],
    );
    let erro = baixa.validar().unwrap_err();
    assert!(erro.contains("máis feble que a medida"), "{erro}");

    // E sen ningunha forma de instrución tampoco é referencia estática.
    let so_ref = rexistro(Confidence::ReferenciaEstatica, &["ref@0x71998"]);
    assert!(
        so_ref.validar().is_err(),
        "unha referencia crúa non sustenta referencia-estatica"
    );
    let so_taboa = rexistro(
        Confidence::ReferenciaEstatica,
        &["taboa@0x71A9C/19/crecente"],
    );
    assert!(
        so_taboa.validar().is_err(),
        "unha táboa non sustenta referencia-estatica: R1 refutada"
    );
}

#[test]
fn rexistro_candidato_permite_evidencia_que_non_vincula() {
    // `ref` e `taboa` son medidas sen forza de vínculo: pódense rexistrar
    // xunto a `candidato` sen contradicior a medida.
    let r = rexistro(
        Confidence::Candidato,
        &["ref@0x71998", "taboa@0x71A9C/19/crecente"],
    );
    r.validar().expect("evidencia non vinculante con candidato");
}

#[test]
fn rexistro_rexeita_evidencia_fora_da_gramatica_que_afirma_un_vinculo() {
    for mala in [
        "vinculo=si",
        "lea@0x10642",
        "TABOA base=0x71A9C entradas=19",
        "taboa@0x71A9C/19/crecente/extracampo",
    ] {
        let r = rexistro(Confidence::VinculoEstrutural, &[mala]);
        assert!(r.validar().is_err(), "aceitou {mala:?} como evidencia");
    }
}

#[test]
fn rexistro_candidato_con_vinculo_medido_e_incoherente() {
    let r = rexistro(Confidence::Candidato, &["chamada@0x1085E/0x1CAEC"]);
    assert!(
        r.validar().is_err(),
        "un vínculo medido non pode convivir con confianza=candidato"
    );
}

#[test]
fn rexistro_de_confianza_runtime_non_se_afirma_nesta_mision() {
    let r = rexistro(Confidence::ObservadoEnRuntime, &["lea@0x00040/A0"]);
    assert!(
        r.validar().is_err(),
        "a misión non executa a ROM: non pode afirmar confianza runtime"
    );
}
