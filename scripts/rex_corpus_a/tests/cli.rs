//! Probas do CLI sobre fixtures sintéticas autorais (sen corpus comercial).
//!
//! Execitan o binario real: o que se proba é o contrato de saída (JSON
//! versionado, verbos e códigos de erro), non só a librería.

use std::path::{Path, PathBuf};
use std::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_rex-corpus");

fn dir_temporal(nome: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "rex-corpus-cli-{nome}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&p).expect("director temporal");
    p
}

/// Imaxe lineal autoral: 0x200 de cabeco + 0x100 de corpo.
fn imaxe() -> Vec<u8> {
    let mut v = vec![0u8; 0x300];
    v[0..4].copy_from_slice(&0x00FF_8000u32.to_be_bytes());
    v[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
    v[0x100..0x110].copy_from_slice(b"SEGA MEGA DRIVE ");
    v[0x110..0x120].copy_from_slice(b"(C)SGDK2026     ");
    let titulo = b"FIXTURE-A";
    v[0x120..0x120 + titulo.len()].copy_from_slice(titulo);
    v[0x150..0x150 + titulo.len()].copy_from_slice(titulo);
    v[0x180..0x18E].copy_from_slice(b"GM 00000000-00");
    let rexion = b"JE UA---";
    v[0x1F0..0x1F0 + rexion.len()].copy_from_slice(rexion);
    v[0x1A0..0x1A4].copy_from_slice(&0x0000_0200u32.to_be_bytes());
    v[0x1A4..0x1A8].copy_from_slice(&0x0000_02FFu32.to_be_bytes());
    let mut sum: u32 = 0;
    let mut off = 0x200;
    while off < v.len() {
        sum = sum.wrapping_add(u16::from_be_bytes([v[off], v[off + 1]]) as u32);
        off += 2;
    }
    v[0x18E..0x190].copy_from_slice(&(sum as u16).to_be_bytes());
    v
}

fn sha_hex(bytes: &[u8]) -> String {
    rex_kosinski::edit::sha256_hex(bytes)
}

fn crc_hex(bytes: &[u8]) -> String {
    format!("{:08x}", rex_corpus::inventory::crc32(bytes))
}

/// Fila de proveniancia coa ordem fixa que escribe `stage.sh`. Nunha copia
/// directa (`store`) o hash do contedor *e* o hash dos bytes: non hai membro.
fn fila(
    staged: &Path,
    sha: &str,
    len: usize,
    membro: &str,
    crc: &str,
    metodo: &str,
    papel: &str,
) -> String {
    let contedor_sha = if metodo == "store" {
        sha.to_string()
    } else {
        "bb".repeat(32)
    };
    format!(
        "{sha}\t{len}\t{}\tgenesis/fonte.zip\t{contedor_sha}\t{membro}\t{crc}\t{metodo}\t{len}\t{papel}\n",
        staged.display(),
    )
}

fn cabazo() -> &'static str {
    "staged_sha256\tstaged_len\tstaged_path\tcontainer_rel\tcontainer_sha256\tmember\tmember_crc32\tmethod\tmember_uncomp_len\tpapel\n"
}

fn executar(args: &[&str]) -> std::process::Output {
    Command::new(BIN)
        .args(args)
        .output()
        .expect("binario execitable")
}

fn ler(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

#[test]
fn inventario_esecribe_o_manifesto_e_sa_e_exit_cero_cos_dous_formatos() {
    let d = dir_temporal("ok");
    let img = imaxe();
    let staged_a = d.join("a.bin");
    let staged_b = d.join("b.bin");
    std::fs::write(&staged_a, &img).unwrap();
    std::fs::write(&staged_b, &img).unwrap();
    let prov = d.join("proveniencia.tsv");
    let mut corpo = String::from(cabazo());
    corpo.push_str(&fila(
        &staged_a,
        &sha_hex(&img),
        img.len(),
        "-",
        &crc_hex(&img),
        "store",
        "desenvolvimento",
    ));
    corpo.push_str(&fila(
        &staged_b,
        &sha_hex(&img),
        img.len(),
        "b.bin",
        &crc_hex(&img),
        "Defl:N",
        "reservada",
    ));
    std::fs::write(&prov, &corpo).unwrap();

    let saida = d.join("inventario.json");
    let o = executar(&[
        "inventario",
        "--proveniencia",
        prov.to_str().unwrap(),
        "--out",
        saida.to_str().unwrap(),
    ]);
    assert!(
        o.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    let json = ler(&saida);
    assert!(json.contains("\"schema_version\":\"rex-corpus-inventario/v1\""));
    assert!(json.contains("\"total\":2"));
    assert!(json.contains("\"inventariadas\":2"));
    assert!(json.contains("\"refusadas\":0"));
    assert!(json.contains("\"inventario\":\"completo\""));
    // Segunda fonte co mesmo hash queda marcada como duplicado da primeira.
    assert!(json.contains("\"duplicado_de\":[\"genesis/fonte.zip\"]"));
    // stdout leva o mesmo texto: reproducible byte a byte.
    assert_eq!(
        String::from_utf8_lossy(&o.stdout).trim(),
        json.trim(),
        "stdout e o ficheiro difiren"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn un_hash_diverxente_escribe_o_manifesto_pero_sale_con_codigo_non_cero() {
    let d = dir_temporal("diverxente");
    let img = imaxe();
    let staged = d.join("a.bin");
    std::fs::write(&staged, &img).unwrap();
    let prov = d.join("proveniencia.tsv");
    let mut corpo = String::from(cabazo());
    // A proveniancia anuncia un hash que non corresponde aos bytes reais.
    corpo.push_str(&fila(
        &staged,
        &"0".repeat(64),
        img.len(),
        "a.bin",
        &crc_hex(&img),
        "Defl:N",
        "desenvolvimento",
    ));
    std::fs::write(&prov, &corpo).unwrap();

    let saida = d.join("inventario.json");
    let o = executar(&[
        "inventario",
        "--proveniencia",
        prov.to_str().unwrap(),
        "--out",
        saida.to_str().unwrap(),
    ]);
    assert_eq!(o.status.code(), Some(5), "manifesto parcial = codigo 5");
    let json = ler(&saida);
    assert!(json.contains("\"refusada\":\"hash_diverxente\""));
    assert!(json.contains("\"inventario\":\"parcial\""));
    assert!(json.contains("\"refusadas\":1"));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn un_ficheiro_de_staged_ausiente_es_un_erro_explicito_non_un_manifesto_falso() {
    let d = dir_temporal("ausente");
    let prov = d.join("proveniencia.tsv");
    let mut corpo = String::from(cabazo());
    corpo.push_str(&fila(
        &d.join("non-existe.bin"),
        &"aa".repeat(32),
        768,
        "x.bin",
        "deadbeef",
        "Defl:N",
        "desenvolvimento",
    ));
    std::fs::write(&prov, &corpo).unwrap();
    let saida = d.join("inventario.json");
    let o = executar(&[
        "inventario",
        "--proveniencia",
        prov.to_str().unwrap(),
        "--out",
        saida.to_str().unwrap(),
    ]);
    assert_eq!(o.status.code(), Some(4), "arquivo ausente = codigo 4");
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("non-existe.bin"), "stderr: {err}");
    assert!(
        !saida.exists(),
        "non se escribe un manifesto cando a entrada falla"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn unha_fila_malformada_da_proveniancia_es_un_erro_explicito() {
    let d = dir_temporal("fila-rota");
    let prov = d.join("proveniencia.tsv");
    std::fs::write(
        &prov,
        format!("{}{}\n", cabazo(), "c7da\t531577\t/tmp/solo-tres-campos"),
    )
    .unwrap();
    let o = executar(&[
        "inventario",
        "--proveniencia",
        prov.to_str().unwrap(),
        "--out",
        d.join("out.json").to_str().unwrap(),
    ]);
    assert_eq!(o.status.code(), Some(3), "proveniancia ilegible = codigo 3");
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("liña 2"), "ha de indicar a liña: {err}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn verificar_devolge_verbos_por_fonte_e_o_mesmo_estatus_que_inventario() {
    let d = dir_temporal("verificar");
    let img = imaxe();
    let staged = d.join("a.bin");
    std::fs::write(&staged, &img).unwrap();
    let prov = d.join("proveniencia.tsv");
    let mut corpo = String::from(cabazo());
    corpo.push_str(&fila(
        &staged,
        &sha_hex(&img),
        img.len(),
        "a.bin",
        &crc_hex(&img),
        "Defl:N",
        "desenvolvimento",
    ));
    std::fs::write(&prov, &corpo).unwrap();

    let o = executar(&["verificar", "--proveniencia", prov.to_str().unwrap()]);
    assert!(o.status.success());
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(out.contains("VERIFICO"), "saída: {out}");
    assert!(out.contains("ok"), "saída: {out}");
    assert!(out.contains("RESUMO fontes=1 recusadas=0"), "saída: {out}");

    // Control discriminativo: un CRC falso ten que cambiar o veredicto.
    let mut corpo_malo = String::from(cabazo());
    corpo_malo.push_str(&fila(
        &staged,
        &sha_hex(&img),
        img.len(),
        "a.bin",
        "deadbeef",
        "Defl:N",
        "desenvolvimento",
    ));
    std::fs::write(&prov, &corpo_malo).unwrap();
    let o2 = executar(&["verificar", "--proveniencia", prov.to_str().unwrap()]);
    assert_eq!(o2.status.code(), Some(5));
    let out2 = String::from_utf8_lossy(&o2.stdout).to_string();
    assert!(out2.contains("diverxencia"), "saída: {out2}");
    assert!(
        out2.contains("RESUMO fontes=1 recusadas=1"),
        "saída: {out2}"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn un_subcomando_non_implementado_falla_explicitamente_en_lugar_de_simular() {
    let o = executar(&["scan"]);
    assert_eq!(o.status.code(), Some(2), "non implementado = codigo 2");
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("non implementado"), "stderr: {err}");
}

#[test]
fn sen_argumentos_escribe_o_uso_en_stderr_e_sale_con_dous() {
    let o = executar(&[]);
    assert_eq!(o.status.code(), Some(2));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    for sub in ["inventario", "verificar", "scan", "verify"] {
        assert!(err.contains(sub), "falta {sub} no uso: {err}");
    }
}
