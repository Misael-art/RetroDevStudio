//! Comportamentos de `md-linear` que os vectores pinados **non** cubren:
//! límites de estado, claves alleas, lecturas enormes e a forma dos aliases.
//! Sen estes tests, a paridade coa referencia auditada da rodada 1-2 sería
//! accidental.

mod support;

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region, Segment, Translate};
use support::fixture;

fn size(n: u64) -> MapperState {
    MapperState::rom_size(n)
}

#[test]
fn so_tamanos_binarios_entre_64kb_e_4mb_son_estado_valido() {
    for n in [0x10000u64, 0x80000, 0x100000, 0x200000, 0x400000] {
        assert!(
            rex_addressing::md_linear::validate_state(&size(n)).is_ok(),
            "{n:#x} debe ser válido"
        );
    }
    for n in [0u64, 0xFFFF, 0x8000, 0x50000, 0x400001, 0x800000, 531577] {
        let Err(err) = rex_addressing::md_linear::validate_state(&size(n)) else {
            panic!("{n:#x} debe rexeitarse");
        };
        assert_eq!(err.code, ErrorCode::Unsupported);
    }
}

/// A referencia auditada da rodada 1-2 **ignora** as claves que non coñece en
/// `md-linear` (a diferenza dos perfis SNES e de SSF2, que as rexeitan).
/// Píñase aquí para que a paridade sexa decidida, non casual: calquera
/// endurecemento futuro é un cambio de contrato visible neste test.
#[test]
fn clave_estraña_en_md_linear_comportase_como_na_referencia() {
    let state = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(0x80000)),
        (
            "banks".to_string(),
            Value::Object(vec![("1".to_string(), Value::Uint(5))]),
        ),
    ]);
    assert!(rex_addressing::md_linear::validate_state(&state).is_ok());
    assert_eq!(
        rex_addressing::md_linear::translate(0x1234, &state),
        Translate::Rom { offset: 0x1234 }
    );
}

#[test]
fn estado_ou_tamanho_amañados_non_devolven_offset_cero() {
    let empty = MapperState::empty();
    let got = rex_addressing::md_linear::translate(0x0, &empty);
    let Translate::Invalid(err) = got else {
        panic!("estado sen rom_size debe ser Invalid, non {got:?}")
    };
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert!(!err.detail.is_empty());

    let text = MapperState::from_entries(vec![(
        "rom_size".to_string(),
        Value::Text("524288".to_string()),
    )]);
    let got = rex_addressing::md_linear::translate(0x0, &text);
    assert_eq!(code_of(got), ErrorCode::Unsupported);
}

#[test]
fn rexion_non_rom_clasifican_se_sin_inventar_bytes() {
    let state = size(0x80000);
    for addr in [0x400000u32, 0x7FFFFF, 0xC00000, 0xA04000, 0xA0E000] {
        assert_eq!(
            code_of(rex_addressing::md_linear::translate(addr, &state)),
            ErrorCode::Unsupported,
            "{addr:#x}"
        );
    }
    for addr in [
        0xA00000u32,
        0xA0BFFF,
        0xA13042,
        0xA11234,
        0xE0FFFF,
        0xFFFFFF,
    ] {
        let got = rex_addressing::md_linear::translate(addr, &state);
        match got {
            Translate::Device { region, offset: _ } => {
                assert_ne!(region, Region::Rom, "{addr:#x} non debe ser ROM")
            }
            other => panic!("{addr:#x}: esperado Device, atopado {other:?}"),
        }
    }
    assert_eq!(
        rex_addressing::md_linear::translate(0xA13042, &state),
        Translate::Device {
            region: Region::CartIo,
            offset: 0x42
        }
    );
    assert_eq!(
        rex_addressing::md_linear::translate(0xA11234, &state),
        Translate::Device {
            region: Region::Io,
            offset: 0x1234
        }
    );
    assert_eq!(
        rex_addressing::md_linear::translate(0xE0FFFE, &state),
        Translate::Device {
            region: Region::WorkRam,
            offset: 0xFFFE
        }
    );
    // A RAM do chip de son son 8KB: o enderezo do bus máscaraa, non se devolve
    // cru (mesma política que o work-ram de abaixo).
    assert_eq!(
        rex_addressing::md_linear::translate(0xA02ABC, &state),
        Translate::Device {
            region: Region::Z80Ram,
            offset: 0xABC
        }
    );
}

#[test]
fn invert_fora_da_rom_e_lista_baleira_e_los_aliases_crecentes() {
    let state = size(0x80000);
    assert_eq!(
        rex_addressing::md_linear::invert(0x80000, &state).unwrap(),
        Vec::<u32>::new()
    );
    let aliases = rex_addressing::md_linear::invert(0x07FFFF, &state).unwrap();
    assert_eq!(aliases.len(), 8);
    assert!(aliases.windows(2).all(|w| w[0] < w[1]));
    assert_eq!(aliases[0], 0x07FFFF);
    assert_eq!(aliases[7], 0x3FFFFF);
    // Propiedade: todo alias retradúcese ao offset pedido.
    for alias in &aliases {
        assert_eq!(
            rex_addressing::md_linear::translate(*alias, &state),
            Translate::Rom { offset: 0x07FFFF }
        );
    }
}

/// `length` descomunal non pode reservar proporcional ao enderezo: a lectura
/// avanza por corredores continus (espellos da xanela incluídos) e remata cun
/// segmento de erro na fronteira da área non suportada.
#[test]
fn lectura_enorme_non_reserva_nin_clampa() {
    let state = size(0x80000);
    let rom = fixture::build_fixture(fixture::seed_base("md-linear"), 0x80000, 0x10000);
    let segments = rex_addressing::md_linear::read(0x0, u32::MAX, &state, &rom)
        .expect("lectura dentro do barramento non é erro de entrada");
    let total: usize = segments
        .iter()
        .map(|s| match s {
            Segment::Bytes { bytes, .. } => bytes.len(),
            _ => 0,
        })
        .sum();
    // A xanela do cartucho son 4 MB: oito espellos de 512 KB e nada máis.
    assert_eq!(total, 0x400000, "debe cubrir a xanela completa e parar");
    assert_eq!(segments.len(), 9, "8 corredores + segmento de erro");
    assert!(matches!(
        segments.last(),
        Some(Segment::Invalid(e)) if e.code == ErrorCode::Unsupported
    ));
    for (i, segment) in segments[..8].iter().enumerate() {
        match segment {
            Segment::Bytes {
                region,
                offset,
                bytes,
            } => {
                assert_eq!(*region, Region::Rom);
                assert_eq!(*offset, 0, "todos os espellos de 512KB comezan en 0");
                assert_eq!(bytes.len(), 0x80000, "corredor {i}");
                assert_eq!(&bytes[..4], &rom[..4]);
            }
            other => panic!("segmento {i}: {other:?}"),
        }
    }
}

fn code_of(got: Translate) -> ErrorCode {
    match got {
        Translate::Invalid(e) => e.code,
        other => panic!("esperado Invalid, atopado {other:?}"),
    }
}
