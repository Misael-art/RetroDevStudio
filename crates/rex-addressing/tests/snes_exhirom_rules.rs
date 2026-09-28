//! Comportamentos de `snes-exhirom` que os vectores pinados **non** cubren.
//!
//! ExHiROM é o perfil máis difícil do conxunto por dous motivos que este
//! ficheiro píña por separado:
//! - **o tamaño total non é potencia de 2**: 5MB e 6MB son estados válidos
//!   porque o que ten que ser binario é a *segunda área* (`rom_size - 0x400000`);
//! - **hai dúas áreas con espeellos independentes**: a área 1 desconecta A22/A23
//!   (`addr mod 0x400000`) e a área 2 espealla `mod half2` sobre a base
//!   `0x400000`, así que as lecturas teñen dúas fronteiras de descontinuidade.
//!
//! Expectativas derivadas a man da especificación
//! `docs/rex_profiles/addressing/snes-exhirom.md` (bsnes EXHIROM/EXHIROM-RAM
//! `7d5aa1e6…` e `Map_ExtendedHiROMMap` de snes9x `1bcc369e…`), coa aritmética
//! escrita en cada caso. **Só fixture**: non hai caso real provado neste perfil.

mod support;

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region, Segment, Translate};
use support::fixture;

const SIZE_5MB: u64 = 0x50_0000;
const SIZE_6MB: u64 = 0x60_0000;
const SIZE_8MB: u64 = 0x80_0000;
/// Imaxe pinada da fixture: 8MB.
const IMG_SIZE: usize = 0x80_0000;

fn size(n: u64) -> MapperState {
    MapperState::rom_size(n)
}

fn rom(offset: u32) -> Translate {
    Translate::Rom { offset }
}

fn device(region: Region, offset: u32) -> Translate {
    Translate::Device { region, offset }
}

fn image() -> Vec<u8> {
    fixture::build_fixture(fixture::seed_base("snes-exhirom"), IMG_SIZE, 0x10000)
}

/// O intervalo válido son os totais cuxa segunda área é binaria: 5MB, 6MB e 8MB.
#[test]
fn so_a_segunda_area_ten_que_ser_potencia_de_dous() {
    // 5MB: half2 = 0x100000; 6MB: 0x200000; 8MB: 0x400000. Ningún total é
    // potencia de 2 agás 8MB, e aínda así o perfil é válido.
    for n in [SIZE_5MB, SIZE_6MB, SIZE_8MB] {
        assert!(
            rex_addressing::snes_exhirom::validate_state(&size(n)).is_ok(),
            "{n:#x} debe ser válido"
        );
    }
    for n in [
        0u64,
        531577,
        0x40_0000, // 4MB: é perfil snes-hirom
        0x41_0000, // half2 = 0x10000 si é binario, pero o total está por
        // debaixo do mínimo de 5MB: o intervalo manda primeiro
        0x70_0000, // 7MB: half2 = 0x300000, non binario
        SIZE_8MB + 1,
        0xC0_0000, // 12MB: non enderezable no barramento de 24 bits
    ] {
        let Err(err) = rex_addressing::snes_exhirom::validate_state(&size(n)) else {
            panic!("{n:#x} debe rexeitarse");
        };
        assert_eq!(err.code, ErrorCode::Unsupported, "{n:#x}");
        assert!(!err.detail.is_empty(), "{n:#x}: erro sen detalle");
    }
}

#[test]
fn clave_estraña_en_exhirom_e_rexeitada_non_ignorada() {
    let state = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(SIZE_8MB)),
        (
            "banks".to_string(),
            Value::Object(vec![("1".to_string(), Value::Uint(2))]),
        ),
    ]);
    let Err(err) = rex_addressing::snes_exhirom::validate_state(&state) else {
        panic!("unha clave allea debe rexeitarse, non ignorarse");
    };
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert!(
        err.detail.contains("banks"),
        "o detalle debe nomear a clave: {}",
        err.detail
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x400000, &state),
        Translate::Invalid(err)
    );
    // Mesma política que LoROM/HiROM, e contraria a `md-linear`. O contraste
    // usa un tamaño **dentro** do intervalo de md-linear (8MB sería rexeitado
    // polo tamaño, non pola clave), así que o que se compara é só a política de
    // claves.
    let mesmo_estado_para_md = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(0x10_0000)),
        (
            "banks".to_string(),
            Value::Object(vec![("1".to_string(), Value::Uint(2))]),
        ),
    ]);
    assert!(rex_addressing::md_linear::validate_state(&mesmo_estado_para_md).is_ok());
}

#[test]
fn estado_amañado_non_devolve_offset_cero() {
    let got = rex_addressing::snes_exhirom::translate(0x400000, &MapperState::empty());
    assert_eq!(code_of(got), ErrorCode::Unsupported);

    let text = MapperState::from_entries(vec![(
        "rom_size".to_string(),
        Value::Text("8388608".to_string()),
    )]);
    assert_eq!(
        code_of(rex_addressing::snes_exhirom::translate(0x400000, &text)),
        ErrorCode::Unsupported
    );
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0, &text)
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
    let rom_img = vec![0u8; 0x10000];
    assert_eq!(
        rex_addressing::snes_exhirom::read(0x400000, 4, &text, &rom_img)
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
}

/// Área 2 (bancos `00-3F` metade alta, `40-7D` banco enteiro):
/// `offset = 0x400000 + (endereco mod half2)`.
#[test]
fn area_dous_base_catro_megabytes_e_espeello_mod_half2() {
    let eight = size(SIZE_8MB);
    // half2 = 0x400000 → `mod` só depende de `banco mod 64`.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x008000, &eight),
        rom(0x408000)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x00FFFF, &eight),
        rom(0x40FFFF)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x3FFFFF, &eight),
        rom(0x7FFFFF),
        "o último offset de 8MB"
    );
    // Banco 40: a súa base xa é múltiplo de half2, así que volve a 0x400000.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x400000, &eight),
        rom(0x400000)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x401234, &eight),
        rom(0x401234)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x7DFFFF, &eight),
        rom(0x7DFFFF)
    );

    // half2 = 0x100000 (5MB): o banco 0x10 repite o banco 0x00.
    let five = size(SIZE_5MB);
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x008000, &five),
        rom(0x408000)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x108000, &five),
        rom(0x408000),
        "banco 10 é espeello do 00 con half2 = 64KB*16"
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x412345, &five),
        rom(0x412345)
    );
    // O último enderezo da xanela 00-3F cae no derradeiro byte dunha imaxe de 5MB:
    // 0x3FFF00 mod 0x100000 = 0x0FFF00 → 0x4FFF00... e 0x3FFFFF → 0x4FFFFF.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x3FFFFF, &five),
        rom(0x4FFFFF)
    );
}

/// Área 1 (bancos `80-BF` metade alta, `C0-FF` banco enteiro):
/// `offset = endereco mod 0x400000` — A22/A23 desconectados.
#[test]
fn area_una_desconecta_a22_e_a23() {
    let eight = size(SIZE_8MB);
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x808000, &eight),
        rom(0x08000)
    );
    // 0xBFFFF0 = banco BF, a = 0xFFF0 → 0xBFFFF0 mod 0x400000 = 0x3FFFF0.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xBFFFF0, &eight),
        rom(0x3FFFF0)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xC00000, &eight),
        rom(0x000000),
        "offset cero lexítimo: banco C0 con A22/A23 baixos"
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xC12345, &eight),
        rom(0x12345)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xFFFFFF, &eight),
        rom(0x3FFFFF)
    );
    // A área 1 **non** depende de half2: os mesmos offsets en 5MB.
    let five = size(SIZE_5MB);
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xC12345, &five),
        rom(0x12345)
    );
    // E a metade alta do banco BF é área 1, non área 2.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xBF8000, &five),
        rom(0x3F8000)
    );
}

/// Quirk propio do mapa: nos bancos `40-7D` e `C0-FF` a xanela ROM ocupa as
/// **dúas** metades, así que alí non se ve nin o espello WRAM nin os rexistradores.
#[test]
fn bancos_completos_non_deixen_ver_o_espello_wram() {
    let eight = size(SIZE_8MB);
    // 0x000123 (banco 00, metade baixa): espello WRAM.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x000123, &eight),
        device(Region::WramMirror, 0x0123)
    );
    // 0x400123 (banco 40, mesma `a`): ROM, porque a xanela comeza en $0000.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x400123, &eight),
        rom(0x400123)
    );
    // 0xC00123 (banco C0): tamén ROM, na área 1.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xC00123, &eight),
        rom(0x00123)
    );
    // E en 0x800123 (banco 80, metade alta é a única ROM) si que é espello.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x800123, &eight),
        device(Region::WramMirror, 0x0123)
    );
}

#[test]
fn rexions_non_rom_clasifican_se_sin_inventar_bytes() {
    let state = size(SIZE_8MB);
    // WRAM vence sobre a xanela ROM do banco 7F (que sería área 1 con lo=0x8000).
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x7E1234, &state),
        device(Region::Wram, 0x1234)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x7FFFFF, &state),
        device(Region::Wram, 0xFFFF)
    );
    // SRAM 20-3F/A0-BF en $6000-$7FFF, xanela de 2KB.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x206123, &state),
        device(Region::Sram, 0x0123)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x3F7FFF, &state),
        device(Region::Sram, 0x1FFF)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xA06000, &state),
        device(Region::Sram, 0x0000)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0xBD7FFF, &state),
        device(Region::Sram, 0x1FFF)
    );
    // I/O e espello nos bancos baixos 00-3D/80-BD.
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x002100, &state),
        device(Region::Io, 0x2100)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x1D7FFF, &state),
        device(Region::Io, 0x7FFF)
    );
    assert_eq!(
        rex_addressing::snes_exhirom::translate(0x001FFF, &state),
        device(Region::WramMirror, 0x1FFF)
    );
    // Reserva: 3E/3F/BE/BF na metade baixa.
    for addr in [0x3E4800u32, 0x3F4800, 0xBE4800, 0xBF4800] {
        assert_eq!(
            code_of(rex_addressing::snes_exhirom::translate(addr, &state)),
            ErrorCode::Unsupported,
            "{addr:#x}"
        );
    }
}

#[test]
fn exhirom_tampouco_produce_ambiguidade() {
    let state = size(SIZE_8MB);
    let mostras = [
        0x0000u32, 0x1FFF, 0x2000, 0x5FFF, 0x6000, 0x7FFF, 0x8000, 0xFFFF,
    ];
    for bank in 0x00u32..=0xFF {
        for a in mostras {
            let addr = (bank << 16) | a;
            if let Translate::Invalid(err) = rex_addressing::snes_exhirom::translate(addr, &state) {
                assert_ne!(
                    err.code,
                    ErrorCode::Ambiguous,
                    "{addr:#x}: ExHiROM non ten xanelas ambiguas ({})",
                    err.detail
                );
            }
        }
    }
}

#[test]
fn en_enderezos_fora_do_barramento_non_hai_aritmética() {
    let state = size(SIZE_8MB);
    assert_eq!(
        code_of(rex_addressing::snes_exhirom::translate(0x01000000, &state)),
        ErrorCode::OutOfRange
    );
    // O erro do barramento vai **antes** da validación do estado.
    let broken = size(531577);
    assert_eq!(
        code_of(rex_addressing::snes_exhirom::translate(0x01000000, &broken)),
        ErrorCode::OutOfRange
    );
}

/// Aliases da área 1: só os bancos cuxo `banco & 0x3F` coincide co banco
/// relativo do offset, e só se `a` está dentro da xanela dese banco.
#[test]
fn invert_aliases_da_area_una() {
    let eight = size(SIZE_8MB);
    // 0x12345 → banco relativo 1, a = 0x2345. Candidatos `b & 0x3F == 1` na
    // área 1: 0x81 (xanela desde 0x8000 → descarta) e 0xC1 (acepta).
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x12345, &eight).unwrap(),
        vec![0xC12345]
    );
    // 0x0 → 0x80 descarta (a < 0x8000), 0xC0 acepta.
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x000000, &eight).unwrap(),
        vec![0xC00000]
    );
    // 0x3FFFFF → 0xBF (metade alta, acepta) e 0xFF (completo, acepta).
    // 0x7F **non** aparece: é WRAM, e o invert nunca devolve bancos WRAM.
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x3FFFFF, &eight).unwrap(),
        vec![0xBFFFFF, 0xFFFFFF]
    );

    // A área 1 é independente de half2: 5MB dá os mesmos aliases.
    let five = size(SIZE_5MB);
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x12345, &five).unwrap(),
        vec![0xC12345]
    );
    for alias in rex_addressing::snes_exhirom::invert(0x3FFFFF, &five).unwrap() {
        assert_eq!(
            rex_addressing::snes_exhirom::translate(alias, &five),
            rom(0x3FFFFF),
            "alias {alias:#x} non retradúce"
        );
    }
}

/// Aliases da área 2: `a = (offset - 0x400000 - banco*0x10000) mod half2`, único
/// porque `half2 >= 64KB`.
#[test]
fn invert_aliases_da_area_dous_co_espeello() {
    let eight = size(SIZE_8MB);
    // half2 = 0x400000: só bancos con `banco mod 64 == 0` teñen `a < 0x10000`.
    // 0x00 descarta (lo = 0x8000 e a = 0), 0x40 acepta.
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x400000, &eight).unwrap(),
        vec![0x400000]
    );
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x401234, &eight).unwrap(),
        vec![0x401234]
    );

    // half2 = 0x100000 (5MB): repiten os bancos `b ≡ 0 (mod 16)`; dos de metade
    // alta (00-3F) `a = 0x1234 < 0x8000` descártanse, quedan 40/50/60/70.
    let five = size(SIZE_5MB);
    assert_eq!(
        rex_addressing::snes_exhirom::invert(0x401234, &five).unwrap(),
        vec![0x401234, 0x501234, 0x601234, 0x701234]
    );
    for alias in rex_addressing::snes_exhirom::invert(0x401234, &five).unwrap() {
        assert_eq!(
            rex_addressing::snes_exhirom::translate(alias, &five),
            rom(0x401234),
            "alias {alias:#x} non retradúce"
        );
    }

    // O derradeiro offset de 5MB: `b ≡ 15 (mod 16)`, con `a = 0x0FFFF` dentro de
    // ambas as xanelas. 0x7F exclúese (WRAM) → 7 aliases, non 8.
    let last = rex_addressing::snes_exhirom::invert(0x4FFFFF, &five).unwrap();
    assert_eq!(
        last,
        vec![0x0FFFFF, 0x1FFFFF, 0x2FFFFF, 0x3FFFFF, 0x4FFFFF, 0x5FFFFF, 0x6FFFFF,]
    );
    assert!(!last.contains(&0x7FFFFF), "0x7FFFFF é WRAM, non alias");
    for alias in &last {
        assert_eq!(
            rex_addressing::snes_exhirom::translate(*alias, &five),
            rom(0x4FFFFF),
            "alias {alias:#x} non retradúce"
        );
    }

    // Offset máis alá do fim da imaxe: lista baleira, resposta válida, non erro.
    assert_eq!(
        rex_addressing::snes_exhirom::invert(SIZE_5MB as u32, &five).unwrap(),
        Vec::<u32>::new()
    );
}

/// As fronteiras de lectura: corredores contínuos dentro dunha área, corte na
/// fronteira da propia área (0x400000 para a área 1, `rom_size` para a área 2).
#[test]
fn lectura_emende_bancos_e_corta_na_fronteira_da_área() {
    let eight = size(SIZE_8MB);
    let img = image();
    assert_eq!(
        support::sha256::sha256_hex(&img),
        support::vectors::load()
            .profile("snes-exhirom")
            .fixture
            .sha256,
        "a imaxe non é a fixture pinada"
    );

    // Área 2, bancos 40-41: un só corredor.
    let segs = rex_addressing::snes_exhirom::read(0x400000, 0x20000, &eight, &img).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    match &segs[0] {
        Segment::Bytes {
            region,
            offset,
            bytes,
        } => {
            assert_eq!(*region, Region::Rom);
            assert_eq!(*offset, 0x400000);
            assert_eq!(bytes.len(), 0x20000);
            assert_eq!(&bytes[..], &img[0x400000..0x420000]);
        }
        other => panic!("{other:?}"),
    }

    // Área 1, bancos C0-C1: un só corredor, offset 0.
    let segs = rex_addressing::snes_exhirom::read(0xC00000, 0x20000, &eight, &img).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, 0);
            assert_eq!(bytes.len(), 0x20000);
            assert_eq!(&bytes[..], &img[..0x20000]);
        }
        other => panic!("{other:?}"),
    }

    // 3F → 40 salta **cara a atrás** no arquivo: 0x7FFF00 e despois 0x400000.
    let segs = rex_addressing::snes_exhirom::read(0x3FFF00, 0x200, &eight, &img).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    let (a, b) = (&segs[0], &segs[1]);
    match (a, b) {
        (
            Segment::Bytes {
                offset: o1,
                bytes: b1,
                ..
            },
            Segment::Bytes {
                offset: o2,
                bytes: b2,
                ..
            },
        ) => {
            assert_eq!((*o1, b1.len()), (0x7FFF00, 0x100));
            assert_eq!((*o2, b2.len()), (0x400000, 0x100));
            assert_eq!(&b1[..], &img[0x7FFF00..0x800000]);
            assert_eq!(&b2[..], &img[0x400000..0x400100]);
        }
        other => panic!("esperado dous corredores, atopado {other:?}"),
    }

    // Fronteira da área 1: 0xBFFF00-0xBFFFFF e 0xC00000-0xC0000F son corredores
    // separados, o segundo volta ao offset 0 (A22/A23 desconectados).
    let segs = rex_addressing::snes_exhirom::read(0xBFFFF0, 0x20, &eight, &img).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match (&segs[0], &segs[1]) {
        (
            Segment::Bytes {
                offset: o1,
                bytes: b1,
                ..
            },
            Segment::Bytes {
                offset: o2,
                bytes: b2,
                ..
            },
        ) => {
            assert_eq!((*o1, b1.len()), (0x3FFFF0, 0x10));
            assert_eq!((*o2, b2.len()), (0x00000, 0x10));
            assert_eq!(&b2[..], &img[..0x10]);
        }
        other => panic!("{other:?}"),
    }
}

/// Con `half2 = 64KB*16` (5MB), a área 2 wrap-a en `rom_size`, non en 0x800000.
#[test]
fn lectura_wrap_da_area_dous_no_tamanho_declarado() {
    let five = size(SIZE_5MB);
    let img = image();
    let img5 = &img[..0x50_0000]; // prefixo determinista da imaxe pinada
    let segs = rex_addressing::snes_exhirom::read(0x3FFF00, 0x200, &five, img5).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match (&segs[0], &segs[1]) {
        (
            Segment::Bytes {
                offset: o1,
                bytes: b1,
                ..
            },
            Segment::Bytes {
                offset: o2,
                bytes: b2,
                ..
            },
        ) => {
            // 0x3FFF00 mod 0x100000 = 0x0FFF00 → offset 0x4FFF00, últimos 256
            // bytes da imaxe; o byte seguinte reentra en 0x400000.
            assert_eq!((*o1, b1.len()), (0x4FFF00, 0x100));
            assert_eq!((*o2, b2.len()), (0x400000, 0x100));
            assert_eq!(&b1[..], &img5[0x4FFF00..0x500000]);
        }
        other => panic!("{other:?}"),
    }
}

/// Imaxe máis curta que `rom_size`: prefixo real + erro, sen clamp.
#[test]
fn lectura_imaxe_curta_prefixo_e_erro() {
    let eight = size(SIZE_8MB);
    let full = image();
    let short = &full[..0x7F_FFF8]; // 8 bytes menos do declarado
    let segs = rex_addressing::snes_exhirom::read(0x3FFFF0, 16, &eight, short).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            // 0x3FFFFF + 1 → offset 0x7FFFF0, os derradeiros 16 bytes do arquivo.
            assert_eq!(*offset, 0x7FFFF0);
            assert_eq!(bytes.len(), 8, "só existen 8 bytes ata o fim da imaxe");
            assert_eq!(&bytes[..], &full[0x7FFFF0..0x7FFFF8]);
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        &segs[1],
        Segment::Invalid(e) if e.code == ErrorCode::OutOfRange
    ));
}

/// As rexións sen bytes e as entradas inválidas resólvense **antes** de
/// reservar proporcional á lonxitude.
#[test]
fn lectura_rexeita_antes_de_reservar() {
    let eight = size(SIZE_8MB);
    let img = vec![0u8; IMG_SIZE];
    assert_eq!(
        rex_addressing::snes_exhirom::read(0x400000, 0, &eight, &img)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    assert_eq!(
        rex_addressing::snes_exhirom::read(0x01000000, 4, &eight, &img)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // 0xFFFFF8 + 16 remata en 0x1000007: fóra do barramento.
    assert_eq!(
        rex_addressing::snes_exhirom::read(0xFFFFF8, 16, &eight, &img)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // Lonxitude descomunal nun enderezo legal: 8MB desde 0x408000 caben no
    // barramento, pero o corredor pára na porta de WRAM (0x7E0000).
    let segs = rex_addressing::snes_exhirom::read(0x408000, 0x80_0000, &eight, &img)
        .expect("lectura dentro do barramento");
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, 0x408000);
            assert_eq!(bytes.len(), 0x3D_8000, "bancos 40-7D, nin un byte máis");
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        segs[1],
        Segment::DeviceNoBacking {
            region: Region::Wram,
            offset: 0,
            error_code: ErrorCode::Unsupported
        }
    ));

    // Comezar nunha rexión non-ROM: un segmento clasificador, sen bytes.
    let segs = rex_addressing::snes_exhirom::read(0x000123, 8, &eight, &img).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    assert!(matches!(
        segs[0],
        Segment::DeviceNoBacking {
            region: Region::WramMirror,
            offset: 0x0123,
            error_code: ErrorCode::Unsupported
        }
    ));
    // Reserva: erro no corredor, non bytes.
    let segs = rex_addressing::snes_exhirom::read(0x3E4800, 8, &eight, &img).unwrap();
    assert!(matches!(
        &segs[0],
        Segment::Invalid(e) if e.code == ErrorCode::Unsupported
    ));
}

fn code_of(got: Translate) -> ErrorCode {
    match got {
        Translate::Invalid(e) => e.code,
        other => panic!("esperado Invalid, atopado {other:?}"),
    }
}
