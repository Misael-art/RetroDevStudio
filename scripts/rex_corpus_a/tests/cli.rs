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
    // `verify` é o verbo que aínda non existe: a proba quere o verbo *pendente*,
    // non un que xa implementamos (antes usábase `scan` e `roundtrip`).
    let o = executar(&["verify"]);
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

// ---------- scan (Fase 2) ----------

/// Descritor Kosinski cuxos primeiros bits (LSB->MSB) son `bits`.
fn descritor(bits: &[u8]) -> [u8; 2] {
    let mut v = 0u16;
    for (i, b) in bits.iter().enumerate() {
        v |= (*b as u16) << i;
    }
    [v as u8, (v >> 8) as u8]
}

/// Fluxo Kosinski autoral de nove literais ("PINEAPPLE") + terminator:
/// 9 bits a 1, despois 0,1 + low + high + 0 => descritor 0x05FF en LE.
fn fluxo_pineapple() -> Vec<u8> {
    let d = descritor(&[1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
    let mut v = vec![d[0], d[1]];
    v.extend_from_slice(b"PINEAPPLE");
    v.extend_from_slice(&[0x00, 0x00, 0x00]);
    v
}

/// Oito literais idénticos + terminator. Plantado a man é un fluxo de 13 bytes;
/// reescrito polo encoder ten que ser máis curto, porque oito repeticións son
/// un match. Por iso serve de control contra un `roundtrip` que fingise o
/// encode volvendo decodificar os bytes que el mesmo plantou.
fn fluxo_oito_iguais() -> Vec<u8> {
    let d = descritor(&[1, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
    let mut v = vec![d[0], d[1]];
    v.extend_from_slice(&[b'A'; 8]);
    v.extend_from_slice(&[0x00, 0x00, 0x00]);
    v
}

/// Valor enteiro dun campo `clave=valor` da saída do CLI.
fn campo(saída: &str, clave: &str) -> usize {
    let prefixo = format!("{clave}=");
    for liña in saída.lines() {
        for anaco in liña.split_whitespace() {
            if let Some(v) = anaco.strip_prefix(prefixo.as_str()) {
                if let Ok(n) = v.parse::<usize>() {
                    return n;
                }
            }
        }
    }
    panic!("campo '{clave}' non aparece na saída: {saída}")
}

#[test]
fn scan_reporta_o_fluxo_plantado_co_desprazamento_o_consumo_e_a_saida_medidos() {
    let d = dir_temporal("scan-plantado");
    let mut img = imaxe();
    let fluxo = fluxo_pineapple();
    let plantado = 0x200usize;
    img[plantado..plantado + fluxo.len()].copy_from_slice(&fluxo);
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");

    let o = executar(&[
        "scan",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--min-saida",
        "4",
    ]);
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert_eq!(o.status.code(), Some(0), "stderr: {err}");
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(
        out.contains("SCAN esquema=rex-corpus-scan/v1"),
        "cabeculler: {out}"
    );
    assert!(
        out.contains(&format!(
            "CAND offset=0x{plantado:05X} consumo={} saida=9 sha256={}",
            fluxo.len(),
            sha_hex(b"PINEAPPLE")
        )),
        "liña CAND: {out}"
    );
    assert!(out.contains("RESUMO candidatos=1"), "resumo: {out}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn scan_nunha_imaxe_sin_fluxos_devolve_candidatos_cero_e_negativas_por_motivo() {
    let d = dir_temporal("scan-baleiro");
    let img = imaxe();
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");

    let o = executar(&["scan", "--imaxe", caminho.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(0));
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(out.contains("RESUMO candidatos=0"), "resumo: {out}");
    // Unha imaxe de ceros dá referencias imposibles: o desglose debe dicilo.
    assert!(out.contains("negativas "), "desglose: {out}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn scan_se_a_imaxe_byor_non_existe_declara_non_executado_e_sale_con_catro() {
    let d = dir_temporal("scan-ausente");
    let caminho = d.join("non-existe.bin");
    let o = executar(&["scan", "--imaxe", caminho.to_str().unwrap()]);
    assert_eq!(
        o.status.code(),
        Some(4),
        "BYOR ausente non pode ser un pase"
    );
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("non executado"), "stderr: {err}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn scan_sin_imaxe_pide_o_argumento_obrigatorio_e_sale_con_dous() {
    let o = executar(&["scan"]);
    assert_eq!(o.status.code(), Some(2));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("--imaxe"), "stderr: {err}");
}

// ---------- roundtrip (Fase 3) ----------

#[test]
fn roundtrip_pecha_o_ciclo_decode_encode_decode_na_mesma_saida() {
    let d = dir_temporal("rt-ok");
    let mut img = imaxe();
    let fluxo = fluxo_pineapple();
    let plantado = 0x200usize;
    img[plantado..plantado + fluxo.len()].copy_from_slice(&fluxo);
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");

    let o = executar(&[
        "roundtrip",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--offset",
        "512",
    ]);
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert_eq!(o.status.code(), Some(0), "stderr: {err}");
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(
        out.contains(&format!("RT offset=0x{plantado:05X} saida=9")),
        "liña RT: {out}"
    );
    assert!(out.contains("ciclo=ok"), "ciclo: {out}");
    assert!(
        out.contains(&format!("saida_sha256={}", sha_hex(b"PINEAPPLE"))),
        "{out}"
    );
    assert!(out.contains("RESUMO ciclos=1 diverxentes=0"), "{out}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn roundtrip_con_offset_non_decodificable_declara_a_negativa_en_vez_de_inventar_un_ciclo() {
    let d = dir_temporal("rt-negativo");
    let img = imaxe(); // corpo de ceros: non hai fluxo aí
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");

    let o = executar(&[
        "roundtrip",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--offset",
        "512",
    ]);
    assert_eq!(
        o.status.code(),
        Some(5),
        "un ciclo que non pecha é unha diverxencia"
    );
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(out.contains("ciclo=non-decodifica"), "saída: {out}");
    assert!(
        out.contains("RESUMO ciclos=0 diverxentes=1"),
        "resumo: {out}"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn roundtrip_se_a_imaxe_byor_non_existe_declara_non_executado_e_sale_con_catro() {
    let d = dir_temporal("rt-ausente");
    let caminho = d.join("non-existe.bin");
    let o = executar(&[
        "roundtrip",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--offset",
        "512",
    ]);
    assert_eq!(o.status.code(), Some(4));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("non executado"), "stderr: {err}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn roundtrip_sin_offsets_erro_de_uso_e_dous() {
    let d = dir_temporal("rt-uso");
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, imaxe()).expect("escribir imaxe");
    let o = executar(&["roundtrip", "--imaxe", caminho.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(2));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("--offset"), "stderr: {err}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn roundtrip_reescribe_con_o_encoder_en_vez_de_volver_decodificar_o_plantado() {
    let d = dir_temporal("rt-encoder");
    let mut img = imaxe();
    let fluxo = fluxo_oito_iguais();
    let plantado = 0x200usize;
    img[plantado..plantado + fluxo.len()].copy_from_slice(&fluxo);
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");

    let o = executar(&[
        "roundtrip",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--offset",
        "512",
    ]);
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert_eq!(o.status.code(), Some(0), "stderr: {err}");
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert_eq!(campo(&out, "saida"), 8, "saida: {out}");
    assert_eq!(campo(&out, "recuperado"), 8, "recuperado: {out}");
    assert!(
        out.contains(&format!("saida_sha256={}", sha_hex(&[b'A'; 8]))),
        "{out}"
    );
    assert!(out.contains("ciclo=ok"), "ciclo: {out}");
    assert!(
        campo(&out, "reescrito") < campo(&out, "consumo"),
        "o encoder debe producir un stream propio, non ecoar os {} bytes plantados: {out}",
        fluxo.len()
    );
    let _ = std::fs::remove_dir_all(&d);
}

// ---------- magia (Fase 3: confirmation por maxia de fluxo) ----------

#[test]
fn magia_nunha_imaxe_sin_maxias_devolve_contas_cero_e_un_veredito_explicito() {
    let d = dir_temporal("magia-cero");
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, imaxe()).expect("escribir imaxe");
    let o = executar(&["magia", "--imaxe", caminho.to_str().unwrap()]);
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert_eq!(
        o.status.code(),
        Some(0),
        "un cero medido non é un fallo: {err}"
    );
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(out.contains("MAXIA esquema=rex-corpus-magia/v1"), "{out}");
    assert!(
        out.contains("RESUMO maxias=0 veredito=sen-maxia-familiar"),
        "resumo: {out}"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn magia_counta_a_secuencia_plantada_co_desprazamento_medido() {
    let d = dir_temporal("magia-plantada");
    let mut img = imaxe();
    img[0x210..0x214].copy_from_slice(b"KosM");
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");
    let o = executar(&["magia", "--imaxe", caminho.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(0));
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(out.contains("SEQ KosM ocorrencias=1"), "liña SEQ: {out}");
    assert!(out.contains("0x00210"), "desprazamento: {out}");
    assert!(out.contains("RESUMO maxias=1"), "resumo: {out}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn magia_se_a_imaxe_byor_non_existe_declara_non_executado_e_sale_con_catro() {
    let d = dir_temporal("magia-ausente");
    let caminho = d.join("non-existe.bin");
    let o = executar(&["magia", "--imaxe", caminho.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(4));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("non executado"), "stderr: {err}");
    let _ = std::fs::remove_dir_all(&d);
}

// ---------- consumidor (Fase 2: evidencia estrutural na ROM local) ----------

/// Imaxe con dous consumidores reais dun enderezo: unha chamada `jsr` e unha
/// táboa de punteiros longos, máis a referencia bruta do operando.
fn imaxe_con_consumidores(dir: &std::path::Path) -> std::path::PathBuf {
    let mut img = imaxe();
    // 0x210: 4E B9 0000_0280  (jsr absoluto longo ao 0x280)
    img[0x210] = 0x4E;
    img[0x211] = 0xB9;
    img[0x212..0x218].copy_from_slice(&[0x00, 0x00, 0x02, 0x80, 0x00, 0x00]);
    // 0x260: táboa de catro longwords crecentes, todos dentro da imaxe
    for (i, v) in [0x280u32, 0x290, 0x2A0, 0x2B0].iter().enumerate() {
        img[0x260 + i * 4..0x264 + i * 4].copy_from_slice(&v.to_be_bytes());
    }
    let caminho = dir.join("con-consumidores.bin");
    std::fs::write(&caminho, &img).expect("escribir imaxe");
    caminho
}

#[test]
fn consumidor_atopa_a_chamada_a_referencia_e_a_táboa_que_vinculan_un_enderezo() {
    let d = dir_temporal("consumidor-vinculo");
    let caminho = imaxe_con_consumidores(&d);
    let o = executar(&[
        "consumidor",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--endereco",
        "640",
    ]);
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert_eq!(o.status.code(), Some(0), "stderr: {err}");
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(
        out.contains("CONSUMIDOR esquema=rex-corpus-consumer/v1"),
        "{out}"
    );
    assert!(
        out.contains("ENDERESO 0x00280 referencias=2 chamadas=1 taboas=1 vinculo=si"),
        "liña ENDERESO: {out}"
    );
    assert!(out.contains("CHAMADA offset=0x00210"), "chamada: {out}");
    assert!(
        out.contains("TABOA base=0x00260 entradas=4"),
        "táboa: {out}"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn consumidor_declara_sen_vinculo_cando_ningun_byte_aponta_ao_enderezo() {
    let d = dir_temporal("consumidor-sen");
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, imaxe()).expect("escribir imaxe");
    let o = executar(&[
        "consumidor",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--endereco",
        "640",
    ]);
    assert_eq!(o.status.code(), Some(0), "a negativa é un resultado");
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(out.contains("vinculo=non"), "saída: {out}");
    assert!(
        out.contains("RESUMO enderezos=1 vinculados=0 sen_vinculo=1"),
        "resumo: {out}"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn consumidor_se_a_imaxe_byor_non_existe_declara_non_executado_e_sale_con_catro() {
    let d = dir_temporal("consumidor-ausente");
    let caminho = d.join("non-existe.bin");
    let o = executar(&[
        "consumidor",
        "--imaxe",
        caminho.to_str().unwrap(),
        "--endereco",
        "640",
    ]);
    assert_eq!(o.status.code(), Some(4));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("non executado"), "stderr: {err}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn consumidor_sin_enderezo_erro_de_uso_e_dous() {
    let d = dir_temporal("consumidor-uso");
    let caminho = d.join("imaxe.bin");
    std::fs::write(&caminho, imaxe()).expect("escribir imaxe");
    let o = executar(&["consumidor", "--imaxe", caminho.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(2));
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(err.contains("--endereco"), "stderr: {err}");
    let _ = std::fs::remove_dir_all(&d);
}
