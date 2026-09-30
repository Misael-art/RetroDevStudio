//! Probas do cabeco Mega Drive. O layout fixase en SGDK `inc/sys.h`
//! (commit 2eac605a7744a6eb4f61824bb24ccab39b8bd8b8, MIT); as lonxitudes de
//! campo non se deducen de ROMs comerciais: constrúense aqui.

use rex_corpus::mdheader::{self, ChecksumField, ChecksumStatus, MdHeader};

/// Imaxe sintetica de `len` bytes cuxo cabeco se escribe campo a campo.
fn imaxe(len: usize) -> Vec<u8> {
    vec![0u8; len]
}

fn escribir(bytes: &mut [u8], off: usize, texto: &str) {
    let campo = texto.as_bytes();
    bytes[off..off + campo.len()].copy_from_slice(campo);
}

fn be16(bytes: &mut [u8], off: usize, valor: u16) {
    bytes[off..off + 2].copy_from_slice(&valor.to_be_bytes());
}

fn be32(bytes: &mut [u8], off: usize, valor: u32) {
    bytes[off..off + 4].copy_from_slice(&valor.to_be_bytes());
}

/// Cabeco completo coas offsets canonicas.
fn cabeco(bytes: &mut [u8]) {
    escribir(bytes, 0x100, "SEGA MEGA DRIVE ");
    escribir(bytes, 0x110, "(C)SEGA 1991.APR");
    escribir(bytes, 0x120, "SONIC THE HEDGEHOG");
    escribir(bytes, 0x150, "SONIC THE HEDGEHOG");
    escribir(bytes, 0x180, "GM 00001009-00");
    escribir(bytes, 0x190, "J               ");
    be32(bytes, 0x1A0, 0x0000_0000);
    be32(bytes, 0x1A4, 0x0007_FFFF);
    be32(bytes, 0x1A8, 0x00FF_0000);
    be32(bytes, 0x1AC, 0x00FF_FFFF);
    escribir(bytes, 0x1F0, "JUE             ");
}

#[test]
fn cada_campo_le_se_na_sua_offset_pinned() {
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    let h = MdHeader::parse(&b).expect("cabeco parseable");
    assert_eq!(h.console, "SEGA MEGA DRIVE");
    assert_eq!(h.copyright, "(C)SEGA 1991.APR");
    assert_eq!(h.title_local, "SONIC THE HEDGEHOG");
    assert_eq!(h.title_int, "SONIC THE HEDGEHOG");
    assert_eq!(h.serial, "GM 00001009-00");
    assert_eq!(h.io_support, "J");
    assert_eq!(h.rom_start, 0);
    assert_eq!(h.rom_end, 0x0007_FFFF);
    assert_eq!(h.ram_start, 0x00FF_0000);
    assert_eq!(h.ram_end, 0x00FF_FFFF);
    assert_eq!(h.region, "JUE");
}

#[test]
fn unha_imaxe_menor_cá_0x200_non_ten_cabeco() {
    let b = imaxe(0x1FF);
    assert!(MdHeader::parse(&b).is_none());
}

#[test]
fn checksum_coincide_cando_a_suma_de_palabras_desde_0x200_da_o_valor_do_campo() {
    // 64 palabras 0x0001 entre 0x200 e 0x280 (0x80 bytes), cero en todo o demais.
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    for i in (0x200..0x280).step_by(2) {
        be16(&mut b, i, 0x0001);
    }
    be16(&mut b, 0x18E, 0x0040); // suma feita á man: 64 palabras x 1 = 0x40
    let h = MdHeader::parse(&b).expect("cabeco");
    assert_eq!(
        h.checksum_status(&b),
        ChecksumStatus {
            field: ChecksumField::Value(0x0040),
            observed: 0x0040,
            matching: true,
        }
    );
}

#[test]
fn checksum_diverxe_cando_unha_sola_palabra_cambia() {
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    for i in (0x200..0x280).step_by(2) {
        be16(&mut b, i, 0x0001);
    }
    be16(&mut b, 0x200, 0x0002); // 63 palabras de 1 + unha de 2 = 0x41
    be16(&mut b, 0x18E, 0x0040);
    let h = MdHeader::parse(&b).expect("cabeco");
    let s = h.checksum_status(&b);
    assert!(!s.matching);
    assert_eq!(s.observed, 0x0041);
    assert_eq!(s.field, ChecksumField::Value(0x0040));
}

#[test]
fn campo_de_checksum_baleiro_marase_como_espazos_non_como_valor() {
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    escribir(&mut b, 0x18E, "  ");
    let h = MdHeader::parse(&b).expect("cabeco");
    let s = h.checksum_status(&b);
    assert_eq!(s.field, ChecksumField::Blank);
    assert!(!s.matching);
}

#[test]
fn lonxitude_declarada_no_cabeco_non_ten_por_que_coincidir_co_arquivo() {
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    be32(&mut b, 0x1A4, 0x0000_01A5); // declarado: 0x1A6 bytes
    let h = MdHeader::parse(&b).expect("cabeco");
    assert_eq!(h.declared_len(), Some(0x01A6));
    assert_eq!(
        mdheader::declared_vs_real(&h, b.len()),
        Some(0x400 - 0x01A6)
    );
}

#[test]
fn campo_de_texto_non_ascii_devolve_se_perdendo_informacion_de_expreso() {
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    b[0x120] = 0xE9; // byte non ASCII dentro do título
    let h = MdHeader::parse(&b).expect("cabeco");
    assert!(h.title_local.starts_with('?') || h.title_local.starts_with('\u{fffd}'));
    assert!(h.text_lossy);
    // O flag xeral non vale: ha de dicir QUE campo perdeu información,
    // porque iso e o que converte o dato nunha evidencia localizable.
    assert_eq!(h.campos_perdidos, vec!["titulo_local".to_string()]);
}

#[test]
fn dous_titulos_non_ascii_recolense_os_dous_nommes() {
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    b[0x150] = 0xE7;
    b[0x1F0] = 0xB5; // rexion tamén e texto
    let h = MdHeader::parse(&b).expect("cabeco");
    assert_eq!(
        h.campos_perdidos,
        vec!["titulo_internacional".to_string(), "rexion".to_string()]
    );
}

#[test]
fn un_campo_numeric_en_espazos_non_e_valor_sino_branco() {
    // Cabeco sen inicializar: SGDK e moitas ferramentas deixan 0x20 nos campos
    // que non usan. Serializalo como número sería inventarse un dato.
    let mut b = imaxe(0x400);
    cabeco(&mut b);
    b[0x1B2] = 0x20;
    b[0x1B3] = 0x20;
    b[0x1A0..0x1A8].fill(0x20); // rom_inicio e rom_fin en branco
    let h = MdHeader::parse(&b).expect("cabeco");
    assert!(h.campos_branco.contains(&"sram_tipo".to_string()));
    assert!(h.campos_branco.contains(&"rom_inicio".to_string()));
    assert!(h.campos_branco.contains(&"rom_fin".to_string()));
    assert!(
        !h.campos_branco.contains(&"ram_inicio".to_string()),
        "ram_inicio si ten valor: {:08x}",
        h.ram_start
    );
    // E a lonxitude declarada deixa de ser afirmable.
    assert_eq!(h.declared_len(), None);
}
