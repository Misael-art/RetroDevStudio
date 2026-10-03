//! Probas do inspector de inventario (Fase 1).
//!
//! Todo aquí traballa con imaxes **sintéticas autorais**: nada do corpus
//! comercial entra nun fixture. A parte que require BYOR vai en
//! `tests/inventario_corpus.rs`, separada.

use rex_corpus::inventory::{
    crc32, inspect, inventory_json, parse_provenance, Item, Provenance, SCHEMA_INVENTARIO,
};
use rex_corpus::json::render;
use rex_corpus::layout::{detect, Layout};

/// Imaxe lineal mínima: vectores + cabeco en 0x100 + corpo de `n` bytes pares.
fn imaxe_lineal(corpo_len: usize) -> Vec<u8> {
    let mut v = vec![0u8; 0x200 + corpo_len];
    v[0..4].copy_from_slice(&0x00FF_8000u32.to_be_bytes());
    v[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
    v[0x100..0x110].copy_from_slice(b"SEGA MEGA DRIVE ");
    v[0x110..0x120].copy_from_slice(b"(C)SGDK2026     ");
    let titulo = b"MI FIXTURE DE PROBA";
    v[0x120..0x120 + titulo.len()].copy_from_slice(titulo);
    v[0x150..0x150 + titulo.len()].copy_from_slice(titulo);
    v[0x180..0x18E].copy_from_slice(b"GM 00000000-00");
    let rexion = b"JE UA---------";
    v[0x1F0..0x1F0 + rexion.len()].copy_from_slice(rexion);
    v[0x1A0..0x1A4].copy_from_slice(&0x0000_0200u32.to_be_bytes());
    let rom_end = 0x200 + corpo_len as u32 - 1;
    v[0x1A4..0x1A8].copy_from_slice(&rom_end.to_be_bytes());
    let mut sum: u32 = 0;
    let mut off = 0x200;
    while off < v.len() {
        sum = sum.wrapping_add(u16::from_be_bytes([v[off], v[off + 1]]) as u32);
        off += 2;
    }
    v[0x18E..0x190].copy_from_slice(&(sum as u16).to_be_bytes());
    v
}

fn prov(camiño: &str, sha: &str, len: u64, membro: &str, crc: &str, metodo: &str) -> Provenance {
    Provenance {
        staged_sha256: sha.to_string(),
        staged_len: len,
        staged_path: camiño.to_string(),
        container_rel: "genesis/x.zip".to_string(),
        container_sha256: "aa".repeat(32),
        member: membro.to_string(),
        member_crc32: crc.to_string(),
        method: metodo.to_string(),
        member_uncomp_len: len,
        role: "desenvolvimento".to_string(),
    }
}

// ---------------------------------------------------------------- layout

#[test]
fn un_cabeco_en_0x100_e_layout_lineal() {
    let img = imaxe_lineal(0x100);
    assert_eq!(detect(&img), Layout::Lineal);
}

#[test]
fn un_cabeco_smd_en_0x000_marca_interlazado() {
    // SMD histórico: 512 bytes ASCII dende 0x0 e bancos de 64 KiB alternos.
    let mut img = vec![0u8; 0x200 + 0x100];
    img[0..8].copy_from_slice(b"SEGA 16M");
    assert_eq!(
        detect(&img),
        Layout::InterlazadoSmd { header_len: 0x200 },
        "un cabeco SMD dende 0x0 non e lineal"
    );
}

#[test]
fn sen_cabeco_recoñecible_o_resultado_e_non_identificado() {
    assert_eq!(detect(&[0u8; 0x400]), Layout::NonIdentificado);
    // Demasiado curto para ter cabeco: tamén non identificable, sen pánico.
    assert_eq!(detect(&[0u8; 16]), Layout::NonIdentificado);
}

// ------------------------------------------------------------- proveniencia

#[test]
fn a_liña_cabazo_e_os_comentarios_non_producen_proveniencia() {
    assert_eq!(
        parse_provenance("staged_sha256\tstaged_len\tstaged_path"),
        None
    );
    assert_eq!(parse_provenance("# nota"), None);
    assert_eq!(parse_provenance(""), None);
}

#[test]
fn unha_fila_de_dez_campos_le_o_membro_o_crc_e_o_papel() {
    let liña = "c7da\t531577\t/tmp/Sonic.bin\tgenesis/Sonic.zip\t4384\tSonic.bin\t1de03238\tDefl:N\t531577\tdesenvolvimento";
    let p = parse_provenance(liña).expect("fila válida");
    assert_eq!(p.staged_sha256, "c7da");
    assert_eq!(p.staged_len, 531577);
    assert_eq!(p.member, "Sonic.bin");
    assert_eq!(p.member_crc32, "1de03238");
    assert_eq!(p.method, "Defl:N");
    assert_eq!(p.role, "desenvolvimento");
}

#[test]
fn un_numero_non_parseable_e_unha_fila_incompleta_recusanse() {
    let rota = "c7da\tNUN\t/tmp/Sonic.bin\tg/s.zip\t4384\tSonic.bin\t1de03238\tDefl:N\t531577\tdesenvolvimento";
    assert_eq!(parse_provenance(rota), None);
    assert_eq!(parse_provenance("c7da\t5\t/tmp/a.bin"), None);
}

// --------------------------------------------------------------- inspect

#[test]
fn unha_imaxe_coherente_pasa_todas_as_verificacions() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/fix.bin",
        &sha,
        img.len() as u64,
        "fix.bin",
        &crc,
        "Defl:N",
    );
    let item = inspect(&p, &img);
    assert_eq!(item.checks.len(), 4, "catro comprobacións, nin unha menos");
    for c in &item.checks {
        assert!(c.ok, "{} non pasa: {}", c.nombre, c.detalle);
    }
    assert!(item.refusada.is_none());
    let header = item.header.as_ref().expect("cabeco presente");
    assert_eq!(header.title_int, "MI FIXTURE DE PROBA");
    assert_eq!(header.serial, "GM 00000000-00");
    assert!(item.checksum_matching, "a suma declarada coincide");
    assert_eq!(item.checksum_state, "valor");
    assert_eq!(
        item.checksum_observado,
        Some(u16::from_be_bytes([img[0x18E], img[0x18F]]))
    );
}

#[test]
fn un_crc32_diverxente_rexistrase_como_fallo_non_panic() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let p = prov(
        "/tmp/fix.bin",
        &sha,
        img.len() as u64,
        "fix.bin",
        "deadbeef",
        "Defl:N",
    );
    let item = inspect(&p, &img);
    let c = item
        .checks
        .iter()
        .find(|c| c.nombre == "crc32_membro")
        .expect("comprobación presente");
    assert!(!c.ok, "un CRC declarado falso ha de fallar");
    assert!(
        c.detalle.contains("deadbeef"),
        "o detalle amosa ambos valores"
    );
    assert!(c.detalle.contains(&format!("{:08x}", crc32(&img))));
    assert!(
        item.refusada.is_none(),
        "a diverxencia rexístrase, non aborta"
    );
}

#[test]
fn unha_lonxitude_declarada_distinta_do_ficheiro_rexistrase() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let mut p = prov(
        "/tmp/fix.bin",
        &sha,
        img.len() as u64,
        "fix.bin",
        &crc,
        "Defl:N",
    );
    p.member_uncomp_len = img.len() as u64 + 1;
    let item = inspect(&p, &img);
    let c = item
        .checks
        .iter()
        .find(|c| c.nombre == "lonxitude_membro")
        .expect("comprobación presente");
    assert!(!c.ok);
}

#[test]
fn unha_imaxe_non_lineal_refuzase_explicitamente() {
    let mut img = vec![0u8; 0x200 + 0x100];
    img[0..8].copy_from_slice(b"SEGA 16M");
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/smd.bin",
        &sha,
        img.len() as u64,
        "smd.bin",
        &crc,
        "Defl:N",
    );
    let item = inspect(&p, &img);
    assert_eq!(
        item.refusada.as_deref(),
        Some("layout_non_lineal"),
        "non se pode traducir dirección sen layout coñecido"
    );
    assert_eq!(item.header, None, "sen layout non hai cabeco que ler");
}

#[test]
fn un_hash_diverxente_entre_proveniencia_e_imaxe_refuzase() {
    let img = imaxe_lineal(0x100);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/fix.bin",
        &"0".repeat(64),
        img.len() as u64,
        "fix.bin",
        &crc,
        "Defl:N",
    );
    let item = inspect(&p, &img);
    assert_eq!(item.refusada.as_deref(), Some("hash_diverxente"));
}

#[test]
fn un_cabeco_en_branco_non_e_un_checksum_erroneo() {
    let mut img = imaxe_lineal(0x100);
    img[0x18E] = 0x20;
    img[0x18F] = 0x20;
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/fix.bin",
        &sha,
        img.len() as u64,
        "fix.bin",
        &crc,
        "Defl:N",
    );
    let item = inspect(&p, &img);
    assert!(!item.checksum_matching);
    assert_eq!(item.checksum_state, "branco");
    // A suma observada sí se mide sempre: non é not_measured.
    assert!(item.checksum_observado.is_some());
}

#[test]
fn o_crc32_coincide_co_vector_estandar() {
    // CRC-32/ISO-HDLC (poly 0xEDB88320 refin, init 0xFFFFFFFF, xorout 0xFFFFFFFF).
    assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    assert_eq!(crc32(b""), 0x0000_0000);
}

#[test]
fn unha_extension_smd_con_layout_lineal_deixa_constancia_na_limitacion() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/ab.SMD",
        &sha,
        img.len() as u64,
        "ab.SMD",
        &crc,
        "Defl:N",
    );
    let item = inspect(&p, &img);
    assert_eq!(item.formato_orixinal, "smd");
    assert_eq!(item.formato_normalizado, "lineal");
    assert!(
        item.limitaciones
            .iter()
            .any(|l| l.contains("smd") && l.contains("lineal")),
        "a incoherencia entre extensión e layout medido debe ser visible"
    );
}

#[test]
fn unha_copia_directa_comparase_co_hash_do_contedor_non_cun_crc_inexistente() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let mut p = prov("/tmp/sonic.bin", &sha, img.len() as u64, "-", "-", "store");
    p.container_sha256 = sha.clone();
    p.container_rel = "genesis/Sonic the Hedgehog (USA, Europe).bin".into();
    p.member = "-".into();
    let item = inspect(&p, &img);
    let nomes: Vec<&str> = item.checks.iter().map(|c| c.nombre.as_str()).collect();
    assert!(nomes.contains(&"hash_contedor"), "comprobacións: {nomes:?}");
    assert!(
        !nomes.contains(&"crc32_membro"),
        "un contedor de texto plano non ten CRC de membro: {nomes:?}"
    );
    for c in &item.checks {
        assert!(c.ok, "{} non pasa: {}", c.nombre, c.detalle);
    }
    assert_eq!(item.formato_orixinal, "bin", "a extensión ve do contedor");

    // Control: se o hash do contedor non cuadra, a comprobación falla.
    let mut p_malo = p.clone();
    p_malo.container_sha256 = "e".repeat(64);
    let item_malo = inspect(&p_malo, &img);
    let c = item_malo
        .checks
        .iter()
        .find(|c| c.nombre == "hash_contedor")
        .expect("comprobación presente");
    assert!(!c.ok, "un hash de contedor diverxente ha de fallar");
}

// -------------------------------------------------------------- manifiesto

#[test]
fn un_cabeco_con_campos_en_branco_non_os_inventa_como_valores() {
    let mut img = imaxe_lineal(0x100);
    img[0x1A0..0x1A8].fill(0x20); // rom_inicio + rom_fin en espazos
    img[0x1B2..0x1B4].fill(0x20); // sram_tipo en espazos
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/gaxe.gen",
        &sha,
        img.len() as u64,
        "gaxe.gen",
        &crc,
        "Defl:N",
    );
    let item = inspect(&p, &img);
    let json = render(&inventory_json(&[item], "branco"));
    assert!(
        json.contains("\"declarada_cabeco\":\"not_measured\""),
        "un rango en branco non ten lonxitude declarada"
    );
    assert!(json.contains("\"diferenza\":\"not_measured\""));
    assert!(json.contains("\"sram_tipo\":\"not_measured\""));
    assert!(json.contains("\"rom_inicio\":\"not_measured\""));
    assert!(json.contains("\"campos_branco\":[\"sram_tipo\",\"rom_inicio\",\"rom_fin\"]"));
    // Os campos que si teñen valor seguen saindo como número.
    assert!(json.contains("\"ram_inicio\":"));
    assert!(!json.contains("\"ram_inicio\":\"not_measured\""));
}

#[test]
fn o_manifesto_declara_esquema_conta_e_non_conten_o_corpo_da_imaxe() {
    let mut img = imaxe_lineal(0x100);
    // Marca posta no CORPO (despois do cabeco): nunca debe ser versionada.
    let marca = b"MARCA-DE-CORPO-0123456";
    img[0x200..0x200 + marca.len()].copy_from_slice(marca);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/fix.bin",
        &sha,
        img.len() as u64,
        "fix.bin",
        &crc,
        "Defl:N",
    );
    let items: Vec<Item> = vec![inspect(&p, &img)];
    let json = render(&inventory_json(&items, "proveniencia sintética"));
    assert!(json.contains(&format!("\"schema_version\":\"{SCHEMA_INVENTARIO}\"")));
    assert!(json.contains("\"total\":1"));
    // Ningún byte do corpo pode aparecer no manifesto.
    assert!(
        !json.contains("MARCA-DE-CORPO-0123456"),
        "o manifesto non versiona datos comerciais"
    );
    // E o manifesto ha de ser pequeno: proba de que non se serializan bytes.
    assert!(
        json.len() < 4096,
        "un item de 768 bytes xera {} chars de manifesto",
        json.len()
    );
    // Claves obrigatorias do obxectivo 1.
    for k in [
        "contenedor_sha256",
        "membro_sha256",
        "bytes",
        "cabeco",
        "formato_orixinal",
        "formato_normalizado",
        "transformacions",
        "revision",
        "traducion",
        "limitaciones",
        "verificacions",
    ] {
        assert!(json.contains(&format!("\"{k}\"")), "falta a clave {k}");
    }
}

#[test]
fn dous_items_co_mesmo_hash_marcanse_como_duplicados() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let mut a = prov("/tmp/a.bin", &sha, img.len() as u64, "-", &crc, "store");
    a.container_rel = "genesis/raw.bin".into();
    a.member = "-".into();
    let b = prov(
        "/tmp/b.bin",
        &sha,
        img.len() as u64,
        "b.bin",
        &crc,
        "Defl:N",
    );
    let items = vec![inspect(&a, &img), inspect(&b, &img)];
    let json = render(&inventory_json(&items, "sintético"));
    assert!(json.contains("\"duplicado_de\":[\"genesis/raw.bin\"]"));
    // Só o segundo elemento do par leva a marca: un total de unha aparición.
    assert_eq!(json.matches("\"duplicado_de\":[").count(), 1);
}

#[test]
fn un_grupo_sen_duplicados_non_inventa_evidencia_de_traducion() {
    let img = imaxe_lineal(0x100);
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov("/tmp/a.bin", &sha, img.len() as u64, "-", &crc, "store");
    let items = vec![inspect(&p, &img)];
    let json = render(&inventory_json(&items, "unico"));
    assert!(json.contains("\"traducion\":\"non_determinable\""));
    assert!(!json.contains("\"duplicado_de\""));
}

#[test]
fn un_item_refusado_sae_do_manifesto_como_refusa_non_como_ok() {
    let mut img = vec![0u8; 0x200 + 0x100];
    img[0..8].copy_from_slice(b"SEGA 16M");
    let sha = rex_kosinski::edit::sha256_hex(&img);
    let crc = format!("{:08x}", crc32(&img));
    let p = prov(
        "/tmp/smd.bin",
        &sha,
        img.len() as u64,
        "smd.bin",
        &crc,
        "Defl:N",
    );
    let items = vec![inspect(&p, &img)];
    let json = render(&inventory_json(&items, "refusa"));
    assert!(json.contains("\"refusada\":\"layout_non_lineal\""));
    assert!(json.contains("\"inventario\":\"parcial\""));
}
