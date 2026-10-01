//! O perfil reutilizable (`rex-corpus-perfil/v1`) e a súa validación.
//!
//! Un perfil non adiviña nada: pinna a imaxe polo seu SHA-256, declara o perfil
//! de enderezamento que se mediu nel e os límites coos que se sondeou. Se a
//! imaxe entregada non é a imaxe que o perfil describe, o perfil non se aplica —
//! é a forma mecánica de cumprir «non transplantes offsets doutra revisión».

use rex_corpus::perfil::{MotivoPerfil, Perfil};

/// JSON plano dun perfil autoral, coa forma que escribe o CLI.
fn perfil_json(sha: &str) -> String {
    format!(
        "{{\"schema_version\":\"rex-corpus-perfil/v1\",\"perfil_id\":\"md-linear\",\"imaxe_normalizada_sha256\":\"{sha}\",\"orientacion\":\"lineal\",\"codec\":\"kosinski\",\"variante\":\"base\",\"estado_revision\":\"descoecida\",\"desde\":0,\"ata\":524288,\"stride\":2,\"min_saida\":16,\"max_saida\":2097152,\"orzamento\":4000000,\"ventanxa_chamada\":16,\"min_entradas\":3,\"limite_bytes\":16777216}}"
    )
}

#[test]
fn perfil_lee_todos_os_campos_declarados() {
    let sha = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
    let p = Perfil::parse(&perfil_json(sha)).unwrap_or_else(|m| panic!("{m}"));
    assert_eq!(p.perfil_id, "md-linear");
    assert_eq!(p.imaxe_normalizada_sha256, sha);
    assert_eq!(p.orientacion, "lineal");
    assert_eq!(p.codec, "kosinski");
    assert_eq!(p.variante, "base");
    assert_eq!(p.desde, 0);
    assert_eq!(p.ata, Some(524288));
    assert_eq!(p.stride, 2);
    assert_eq!(p.min_saida, 16);
    assert_eq!(p.max_saida, 2097152);
    assert_eq!(p.orzamento, 4000000);
    assert_eq!(p.ventanxa_chamada, 16);
    assert_eq!(p.min_entradas, 3);
    assert_eq!(p.limite_bytes, 16777216);
    assert_eq!(p.estado_revision, "descoecida");
}

#[test]
fn perfil_esixe_o_esquema_exacto() {
    let malo = perfil_json("a".repeat(64).as_str())
        .replace("rex-corpus-perfil/v1", "rex-corpus-perfil/v2");
    assert_eq!(
        Perfil::parse(&malo).err(),
        Some(MotivoPerfil::EsquemaIncorrecto)
    );
    let sen = "{\"perfil_id\":\"md-linear\"}";
    assert_eq!(
        Perfil::parse(sen).err(),
        Some(MotivoPerfil::SenEsquema),
        "un JSON sen `schema_version` non e un perfil"
    );
}

#[test]
fn perfil_rexeita_un_hash_que_non_e_seisenta_e_catro_hex_minusclos() {
    for sha in [
        "",
        "null",
        "c7da53a1",
        &"C".repeat(64),
        &"g".repeat(64),
        &"a".repeat(63),
        &"a".repeat(65),
    ] {
        let r = Perfil::parse(&perfil_json(sha));
        assert_eq!(
            r.err(),
            Some(MotivoPerfil::HashCoFormaInvalida),
            "aceitou {sha:?} como pin de imaxe"
        );
    }
}

#[test]
fn perfil_rexeita_campos_obrigatorios_ausentes_o_cun_valor_non_medible() {
    let base = perfil_json(&"a".repeat(64));
    for (clave, motivo) in [
        (
            "\"perfil_id\":\"md-linear\",",
            MotivoPerfil::CampoObrigatorioAusente,
        ),
        (
            "\"codec\":\"kosinski\",",
            MotivoPerfil::CampoObrigatorioAusente,
        ),
        (
            "\"orientacion\":\"lineal\",",
            MotivoPerfil::CampoObrigatorioAusente,
        ),
    ] {
        let malo = base.replace(clave, "");
        assert_eq!(Perfil::parse(&malo).err(), Some(motivo), "falta {clave}");
    }
    // Un límite en `null` non é un cero: e un valor que non se pode executar.
    let malo = base.replace("\"stride\":2", "\"stride\":null");
    assert_eq!(
        Perfil::parse(&malo).err(),
        Some(MotivoPerfil::NumeroInvalido),
        "aceitou null como límite de stride"
    );
    let malo = base.replace("\"max_saida\":2097152", "\"max_saida\":-4");
    assert_eq!(
        Perfil::parse(&malo).err(),
        Some(MotivoPerfil::NumeroInvalido)
    );
}

#[test]
fn perfil_rexeita_unha_orientacion_non_medida() {
    let malo = perfil_json(&"a".repeat(64)).replace("\"lineal\"", "\"adivinada\"");
    assert_eq!(
        Perfil::parse(&malo).err(),
        Some(MotivoPerfil::OrientacionDescoecida),
        "un perfil pode declarar calquera orientacion"
    );
    for boa in ["lineal", "interlazado-smd", "non-identificada"] {
        let texto = perfil_json(&"a".repeat(64)).replace("\"lineal\"", &format!("\"{boa}\""));
        assert!(Perfil::parse(&texto).is_ok(), "rexeitou {boa}");
    }
}

#[test]
fn perfil_decla_o_tope_de_lectura_da_imaxe() {
    // O límite de bytes vive no perfil: sen el, un `--imaxe` de 400 MiB abriríase.
    let texto = perfil_json(&"a".repeat(64));
    let p = Perfil::parse(&texto).unwrap();
    assert_eq!(p.limite_bytes, 16 * 1024 * 1024);
}
