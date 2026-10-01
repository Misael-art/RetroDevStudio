//! Os artefactos versionados de `data/rex_corpus_a/` tamén teñen que pasar o
//! contrato que describe `docs/rex_corpus_a/FASE5-PERFIS.md`.
//!
//! Este ficheiro **non** necesita ningunha ROM: comprueba a forma e a
//! coherencia interna do que está no depósito (perfis fixados por SHA-256 e
//! rexistros `rex-corpus-resource/v2`). A lectura da imaxe segue sendo BYOR e,
//! se falta, declárase `non executado` noutro sitio — aquí non hai nada que
//! executar.

use std::path::PathBuf;

use rex_corpus::evidence::Evidencia;
use rex_corpus::perfil::{Perfil, ORIENTACIONS, SCHEMA_PERFIL};
use rex_corpus::spec::campo_declarado;

fn raiz_repos() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn cartafol(sub: &str) -> PathBuf {
    raiz_repos().join("data/rex_corpus_a").join(sub)
}

/// `*.json` do cartafol, en orde lexicográfica e sen sorpresas.
fn ficheiros(dir: &PathBuf, extension: &str) -> Vec<PathBuf> {
    let lectura = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e} :: artefacto versionado ausente", dir.display()));
    let mut camiños: Vec<PathBuf> = lectura
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == extension).unwrap_or(false))
        .collect();
    camiños.sort();
    assert!(
        !camiños.is_empty(),
        "ningún *.{extension} en {}",
        dir.display()
    );
    camiños
}

/// Contidos de `"clave":["a","b"]` nun JSON compacto dunha soa liña.
///
/// Non é un parser xeral: `render` escribe os arrays sen espazos, así que as
/// comas separadoras van sempre entre `"`. Unha liña que non teña a clave ou
/// teña o tramo mal formado devolve `None` en vez de adiviñar.
fn cadeas_de_array(texto: &str, clave: &str) -> Option<Vec<String>> {
    let busca = format!("\"{clave}\":[");
    let inicio = texto.find(&busca)? + busca.len();
    let fin = texto[inicio..].find(']')?;
    let tramo = &texto[inicio..inicio + fin];
    if tramo.is_empty() {
        return Some(Vec::new());
    }
    let mut out = Vec::new();
    for anaco in tramo.split("\",\"") {
        // O primeiro anaco conserva o `"` de apertura e o último o de peche:
        // as comas separadoras xa foron consumidas polo `split`.
        let cadea = anaco.strip_prefix('"').unwrap_or(anaco);
        let cadea = cadea.strip_suffix('"').unwrap_or(cadea);
        out.push(cadea.to_string());
    }
    Some(out)
}

#[test]
fn perfis_versionados_lean_o_esquema_e_pinan_unha_imaxe_do_corpus() {
    let inventario =
        std::fs::read_to_string(raiz_repos().join("data/rex_corpus_a/inventario.json"))
            .expect("manifesto do inventario");
    // A mostra reservada non entra no inventario (Fase 1): o seu hash de membro
    // está na folla de proveniancia local, con contedor
    // fbb1f3694132fb85cfd1ccc2d39642da0b0306c523d834fadda792ea3ab68efc e CRC
    // 88e4ef3c. Versionamos o hash, non os bytes.
    const MEMBRO_RESERVADA: &str =
        "304f56ba2560a7cd6b93dd092cb0d17e4cd783b9086cf4bf069d6fdd2cb3961d";

    let mut vistos = 0usize;
    for camiño in ficheiros(&cartafol("perfis"), "json") {
        let texto = std::fs::read_to_string(&camiño).expect("perfil lexible");
        let nome = camiño.file_name().unwrap().to_string_lossy().to_string();
        assert!(
            texto.contains(&format!("\"schema_version\":\"{SCHEMA_PERFIL}\"")),
            "{nome} sen a etiqueta do esquema"
        );
        let perfil = Perfil::parse(&texto).unwrap_or_else(|m| panic!("{nome}: {m}"));
        assert_eq!(
            perfil.perfil_id,
            rex_addressing::md_linear::PROFILE_ID,
            "{nome}: outro perfil non ten perfil de enderezamento Rust"
        );
        assert!(
            ORIENTACIONS.contains(&perfil.orientacion.as_str()),
            "{nome}: orientación {} fóra da lista medida",
            perfil.orientacion
        );
        assert!(
            inventario.contains(&perfil.imaxe_normalizada_sha256)
                || perfil.imaxe_normalizada_sha256 == MEMBRO_RESERVADA,
            "{nome}: pin {sha} non corresponde a ningunha imaxe inventariada",
            sha = perfil.imaxe_normalizada_sha256
        );
        // Un perfil que apuntase a un ficheiro local faría o artefacto
        // non reproducible; aquí só hai hashes.
        assert!(
            !texto.contains("/home/"),
            "{nome}: camiño local no artefacto"
        );
        assert_eq!(perfil.estado_revision, "descoecida", "{nome}");
        vistos += 1;
    }
    assert!(vistos >= 2, "perfis insuficientes: {vistos}");
}

#[test]
fn rexistros_versionados_len_a_gramatica_de_evidencia_e_non_inventan_confianza() {
    let pins: Vec<String> = ficheiros(&cartafol("perfis"), "json")
        .iter()
        .map(|p| {
            campo_declarado(
                &std::fs::read_to_string(p).expect("perfil lexible"),
                "imaxe_normalizada_sha256",
            )
            .expect("perfil sen pin")
        })
        .collect();

    let ficheros = ficheiros(&cartafol("evidencia"), "jsonl");
    assert!(
        ficheros.len() >= 2,
        "ficheiros de rexistros insuficientes: {}",
        ficheros.len()
    );
    let mut liñas = 0usize;
    for camiño in &ficheros {
        let nome = nome_da_rota(camiño);
        let texto = std::fs::read_to_string(camiño).expect("jsonl lexible");
        let contido = texto.lines().filter(|l| !l.trim().is_empty()).count();
        assert_ne!(contido, 0, "{nome}: artefacto baleiro");
        liñas += contido;
        for liña in texto.lines().filter(|l| !l.trim().is_empty()) {
            rexistro_da_liña(liña, &nome, &pins);
        }
    }
    assert!(liñas >= 3, "rexistros versionados: {liñas}");
}

fn nome_da_rota(c: &std::path::Path) -> String {
    c.file_name().unwrap().to_string_lossy().to_string()
}

/// Repón a regra de `ResourceRecord::validar` sobre o texto versionado: o
/// contrato é o mesmo, aquí non hai un parser de rexistros.
fn rexistro_da_liña(liña: &str, nome: &str, pins: &[String]) -> (usize, usize) {
    assert!(
        liña.contains("\"schema_version\":\"rex-corpus-resource/v2\""),
        "{nome}: liña sen a etiqueta do esquema"
    );
    assert!(!liña.contains("/home/"), "{nome}: camiño local no rexistro");
    let escuro = |k: &str| -> String {
        campo_declarado(liña, k).unwrap_or_else(|| panic!("{nome}: sen {k} na liña"))
    };
    let numero = |k: &str| -> usize {
        escuro(k)
            .parse()
            .unwrap_or_else(|_| panic!("{nome}: {k} sen número"))
    };
    let confianza = escuro("confianza");
    let evidencias =
        cadeas_de_array(liña, "evidencia_consumidor").unwrap_or_else(|| panic!("{nome}"));
    let mut vinculantes = 0usize;
    let mut cargas_con_chamada = 0usize;
    for cadea in &evidencias {
        let e = Evidencia::parse(cadea)
            .unwrap_or_else(|| panic!("{nome}: evidencia fóra da gramática: {cadea}"));
        if e.vincula() {
            vinculantes += 1;
        }
        if e.e_carga_con_chamada() {
            cargas_con_chamada += 1;
        }
        // O sitio da evidencia ten que caer dentro da imaxe: un `0x` de oito
        // díxitos só aparece se alguén escribe un enderezo inventado.
        assert!(
            e.sitio() < 0x80_0000,
            "{nome}: evidencia fóra do mapa: {cadea}"
        );
    }
    // O vocabulario v2 nomea a medida; `confirmado-estaticamente` (v1) quedou
    // retirado porque cubría dous niveis de proba distintos.
    match confianza.as_str() {
        "vinculo-estrutural" => assert!(
            cargas_con_chamada > 0,
            "{nome}: vinculo-estrutural sen carga con chamada: {liña}"
        ),
        "referencia-estatica" => {
            assert!(
                vinculantes > 0 && cargas_con_chamada == 0,
                "{nome}: referencia-estatica precisa instrución sen chamada conectada: {liña}"
            );
        }
        "candidato" => assert_eq!(
            vinculantes, 0,
            "{nome}: candidato con evidencia vinculante: {liña}"
        ),
        outro => panic!("{nome}: confianza {outro} non é desta misión"),
    }
    // Coherencia aritmética do que se midiu: o tramo de entrada non pode ser
    // menor que o consumo, e a saída ten que ser positiva.
    let offset = numero("offset");
    let tramo = numero("tramo_entrada");
    let consumo = numero("bytes_consumidos");
    let saida = numero("saida_bytes");
    assert!(
        tramo >= consumo,
        "{nome}: tramo {tramo} < consumo {consumo}"
    );
    assert!((16..=2_097_152).contains(&saida), "{nome}: saída {saida}");
    assert!(
        offset < 0x40_0000,
        "{nome}: offset {offset:#x} fóra da xanela do cartucho"
    );
    let pin = escuro("imaxe_normalizada_sha256");
    assert!(
        pins.contains(&pin),
        "{nome}: rexistro que non apunta a ningún perfil versionado"
    );
    (vinculantes, cargas_con_chamada)
}

#[test]
fn rexistros_versionados_dan_polos_menos_dous_vinculos_estruturais_e_una_referencia() {
    // A misión pide vínculos medidos sobre bytes reais. O rótulo forte v1
    // (`confirmado-estaticamente`) retirouse: o que queda — e o que se
    // esixe — é polo menos dous vínculos estruturais (lea→chamada, na
    // reservada) e polo menos unha referencia estática de instrución (Sonic
    // 1, carga sen chamada modelada). Ningún deles alega runtime.
    let mut estruturais = 0usize;
    let mut referencias = 0usize;
    for c in ficheiros(&cartafol("evidencia"), "jsonl") {
        let texto = std::fs::read_to_string(&c).expect("jsonl lexible");
        for l in texto.lines().filter(|l| !l.trim().is_empty()) {
            if l.contains("\"confianza\":\"vinculo-estrutural\"") {
                estruturais += 1;
            }
            if l.contains("\"confianza\":\"referencia-estatica\"") {
                referencias += 1;
            }
        }
    }
    assert!(
        estruturais >= 2,
        "vínculos estruturais no corpus: {estruturais}"
    );
    assert!(
        referencias >= 1,
        "referencias estáticas no corpus: {referencias}"
    );
}
