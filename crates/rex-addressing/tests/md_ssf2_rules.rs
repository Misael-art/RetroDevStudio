//! Comportamentos de `md-ssf2` que os vectores pinados **non** cubren: pureza
//! da escrita, decodificación dos bits de espello da páxina TIME, valores de
//! banco que sobordan a ROM, reescritas e o estado identidade.
//!
//! As expectativas están calculadas á man desde `docs/rex_profiles/addressing/md-ssf2.md`
//! (spec de Bart Trzynadlowski + `mapper_512k_w`/`mapper_ssf2_w` de GPGX), non
//! copiadas da saída de ningunha implementación.

mod support;

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region, Segment, Translate};
use support::fixture;

const SIZE_4MB: u64 = 0x400000;
const SIZE_8MB: u64 = 0x800000;

fn state_with_banks(size: u64, entries: Vec<(String, Value)>) -> MapperState {
    MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(size)),
        ("banks".to_string(), Value::Object(entries)),
    ])
}

fn bank(w: impl std::fmt::Display, v: Value) -> (String, Value) {
    (w.to_string(), v)
}

fn code_of(got: Translate) -> ErrorCode {
    match got {
        Translate::Invalid(e) => e.code,
        other => panic!("esperado Invalid, atopado {other:?}"),
    }
}

#[test]
fn tamanos_e_bancos_validos() {
    for size in [0x80000u64, 0x100000, 0x200000, SIZE_4MB, SIZE_8MB] {
        assert!(
            rex_addressing::md_ssf2::validate_state(&MapperState::rom_size(size)).is_ok(),
            "{size:#x} debe ser válido"
        );
    }
    // 5MB cru non: o mapper indexa por máscara.
    for size in [0u64, 0x40000, 0x7FFFF, 0x500000, 0xA00000, 0x1000000] {
        let Err(err) = rex_addressing::md_ssf2::validate_state(&MapperState::rom_size(size)) else {
            panic!("{size:#x} debe rexeitarse");
        };
        assert_eq!(err.code, ErrorCode::Unsupported);
        assert!(!err.detail.is_empty());
    }
    // Bancos ben formados: claves 1..=7, valores byte.
    let ok = state_with_banks(
        SIZE_4MB,
        vec![
            bank(1, Value::Uint(0)),
            bank(7, Value::Uint(255)),
            bank(4, Value::Uint(37)),
        ],
    );
    assert!(rex_addressing::md_ssf2::validate_state(&ok).is_ok());
    // Obxecto baleiro = identidade explícita.
    assert!(rex_addressing::md_ssf2::validate_state(&state_with_banks(SIZE_4MB, vec!())).is_ok());
}

#[test]
fn banco_mal_formado_rexeitase_con_unsupported() {
    let cases = vec![
        ("valor texto", bank(1, Value::Text("5".to_string()))),
        ("valor negativo", bank(1, Value::Int(-1))),
        (
            "valor fraccionario",
            bank(2, Value::NonInteger("1.5".to_string())),
        ),
        ("valor nulo", bank(3, Value::Null)),
        ("janela 0", bank(0, Value::Uint(3))),
        ("xanela 8", bank(8, Value::Uint(1))),
        ("clave non numerica", bank("x".to_string(), Value::Uint(1))),
    ];
    for (label, entry) in cases {
        let state = state_with_banks(SIZE_4MB, vec![entry]);
        let Err(err) = rex_addressing::md_ssf2::validate_state(&state) else {
            panic!("{label}: debe rexeitarse");
        };
        assert_eq!(err.code, ErrorCode::Unsupported, "{label}");
        assert!(err.detail.len() > 10, "{label}: detalle non informativo");
    }
    // `banks` que non é obxecto.
    for value in [
        Value::Text("{}".to_string()),
        Value::Uint(3),
        Value::Null,
        Value::Bool(true),
    ] {
        let state = MapperState::from_entries(vec![
            ("rom_size".to_string(), Value::Uint(SIZE_4MB)),
            ("banks".to_string(), value),
        ]);
        assert_eq!(
            rex_addressing::md_ssf2::validate_state(&state)
                .err()
                .map(|e| e.code),
            Some(ErrorCode::Unsupported)
        );
    }
}

#[test]
fn estado_amañado_non_devolve_offset_cero() {
    assert_eq!(
        code_of(rex_addressing::md_ssf2::translate(
            0x080000,
            &MapperState::empty()
        )),
        ErrorCode::Unsupported
    );
    assert_eq!(
        code_of(rex_addressing::md_ssf2::translate(
            0x080000,
            &MapperState::rom_size(0x500000)
        )),
        ErrorCode::Unsupported
    );
    // O enderezo fóra do barramento erroa antes que o estado.
    assert_eq!(
        code_of(rex_addressing::md_ssf2::translate(
            rex_addressing::md_ssf2::BUS_LIMIT + 1,
            &MapperState::empty()
        )),
        ErrorCode::OutOfRange
    );
    // E `invert` valida o estado antes de mirar o offset.
    assert_eq!(
        rex_addressing::md_ssf2::invert(0x123, &MapperState::empty())
            .err()
            .map(|e| e.code),
        Some(ErrorCode::Unsupported)
    );
}

#[test]
fn rexion_non_rom_clasifican_se_sin_inventar_bytes() {
    let state = MapperState::rom_size(SIZE_4MB);
    assert_eq!(
        rex_addressing::md_ssf2::translate(0xA13042, &state),
        Translate::Device {
            region: Region::CartIo,
            offset: 0x42
        }
    );
    assert_eq!(
        rex_addressing::md_ssf2::translate(0xA11234, &state),
        Translate::Device {
            region: Region::Io,
            offset: 0x1234
        }
    );
    assert_eq!(
        rex_addressing::md_ssf2::translate(0xE0FFFE, &state),
        Translate::Device {
            region: Region::WorkRam,
            offset: 0xFFFE
        }
    );
    assert_eq!(
        rex_addressing::md_ssf2::translate(0xA02ABC, &state),
        Translate::Device {
            region: Region::Z80Ram,
            offset: 0xABC
        }
    );
    for addr in [0x400000u32, 0x7FFFFF, 0xC00000, 0xA04000, 0xA0E000] {
        assert_eq!(
            code_of(rex_addressing::md_ssf2::translate(addr, &state)),
            ErrorCode::Unsupported,
            "{addr:#x}"
        );
    }
}

#[test]
fn estado_inicial_e_identidade_e_bixectivo_en_4mb() {
    let state = MapperState::rom_size(SIZE_4MB);
    for w in 0u32..8 {
        let addr = w * rex_addressing::md_ssf2::WINDOW_SIZE;
        assert_eq!(
            rex_addressing::md_ssf2::translate(addr, &state),
            Translate::Rom { offset: addr },
            "xanela {w} en identidade"
        );
        assert_eq!(
            rex_addressing::md_ssf2::invert(addr, &state).unwrap(),
            vec![addr],
            "xanela {w}: un só alias"
        );
    }
    // Sen escritas, o banco 5 non existe: `banks` pode estar ausente.
    assert_eq!(
        rex_addressing::md_ssf2::translate(0x280000, &state),
        Translate::Rom { offset: 0x280000 }
    );
    assert_eq!(
        rex_addressing::md_ssf2::invert(0x400000, &state).unwrap(),
        Vec::<u32>::new(),
        "offset fóra da ROM: lista baleira, non erro"
    );
}

#[test]
fn decodificacion_da_xanela_use_os_bits_1_a_3_da_paxina() {
    // 0xA13022 e 0xA130F3 espellan a xanela 1; 0xA130FF e 0xA1308E, a 7.
    let mirrors = [
        (0xA13022u32, 1u64),
        (0xA130F3, 1),
        (0xA130FF, 7),
        (0xA1308E, 7),
    ];
    for (addr, window) in mirrors {
        let state = MapperState::rom_size(SIZE_4MB);
        let after = rex_addressing::md_ssf2::write_mapper_register(addr, 9, &state)
            .expect("escrita na páxina TIME");
        assert_eq!(
            after.object("banks").map(|e| e[0].clone()),
            Some((window.to_string(), Value::Uint(9))),
            "{addr:#x} debe remapear a xanela {window}"
        );
    }
}

#[test]
fn a_xanela_0_e_fixa_e_a_escrita_non_ten_efecto() {
    let state = MapperState::rom_size(SIZE_4MB);
    let inert = [
        0xA13000u32,
        0xA13001,
        0xA13010,
        0xA13011,
        0xA130E0,
        0xA130F1,
    ];
    for addr in inert {
        let after = rex_addressing::md_ssf2::write_mapper_register(addr, 77, &state)
            .expect("escrita na páxina TIME sen efecto");
        assert_eq!(
            after.object("banks").map(<[_]>::len).unwrap_or(0),
            0,
            "{addr:#x}: (addr & 0x0E) >> 1 = 0, non hai banco que escribir"
        );
        // E a xanela 0 segue linear: o seu offset non cambia.
        assert_eq!(
            rex_addressing::md_ssf2::translate(0x000010, &after),
            Translate::Rom { offset: 0x000010 }
        );
    }
    // 0xA13002 si que remapea a xanela 1: a inercia é do slot 0, non da páxina.
    let after = rex_addressing::md_ssf2::write_mapper_register(0xA13002, 77, &state).unwrap();
    assert_eq!(
        after.object("banks").map(|e| e[0].clone()),
        Some(("1".to_string(), Value::Uint(77)))
    );
}

#[test]
fn escrita_e_pura_non_muta_o_estado_recibido() {
    let state = MapperState::ssf2(SIZE_4MB, &[(1, 3)]);
    let before = state.clone();
    let after =
        rex_addressing::md_ssf2::write_mapper_register(0xA13006, 5, &state).expect("xanela 3 = 5");
    assert_eq!(state, before, "o estado recibido non debe mutar");
    let mut got = after
        .object("banks")
        .expect("banks")
        .iter()
        .map(|(k, v)| (k.parse::<u64>().unwrap(), v.as_uint().unwrap()))
        .collect::<Vec<(u64, u64)>>();
    got.sort();
    assert_eq!(
        got,
        vec![(1, 3), (3, 5)],
        "a escrita suma, non substitúe o estado"
    );
}

#[test]
fn reescrita_substitue_o_valor_do_banco() {
    let state = MapperState::rom_size(SIZE_4MB);
    let a = rex_addressing::md_ssf2::write_mapper_register(0xA13006, 4, &state).unwrap();
    let b = rex_addressing::md_ssf2::write_mapper_register(0xA13006, 5, &a).unwrap();
    assert_eq!(
        b.object("banks").map(|e| e[0].clone()),
        Some(("3".to_string(), Value::Uint(5)))
    );
    assert_eq!(
        rex_addressing::md_ssf2::translate(0x180000, &b),
        Translate::Rom { offset: 0x280000 },
        "a xanela 3 (0x180000-0x1FFFFF) co banco 5 → base (5 << 19) = 0x280000"
    );
}

#[test]
fn escrita_fora_da_paxina_de_registradores_e_unsupported() {
    let state = MapperState::rom_size(SIZE_4MB);
    for addr in [
        0x000000u32,
        0x080002,
        0xA12000,
        0xA13000 - 1,
        0xA13100,
        0xA1FFFF,
    ] {
        assert_eq!(
            rex_addressing::md_ssf2::write_mapper_register(addr, 1, &state)
                .err()
                .map(|e| e.code),
            Some(ErrorCode::Unsupported),
            "{addr:#x} non está na páxina $A13000-$A130FF"
        );
    }
    // Estado inválido rexeitase antes de mirar o enderezo.
    assert_eq!(
        rex_addressing::md_ssf2::write_mapper_register(0xA13006, 1, &MapperState::empty())
            .err()
            .map(|e| e.code),
        Some(ErrorCode::Unsupported)
    );
}

#[test]
fn banco_fora_do_fin_da_rom_espealla_por_mascara_non_e_erro() {
    // (0xFF << 19) & 0x3FFFFF = 0x380000 nunha ROM de 4MB.
    let s4 = MapperState::rom_size(SIZE_4MB);
    let w = rex_addressing::md_ssf2::write_mapper_register(0xA13002, 0xFF, &s4).unwrap();
    assert_eq!(
        rex_addressing::md_ssf2::translate(0x080000, &w),
        Translate::Rom { offset: 0x380000 }
    );
    // (0xFF << 19) & 0x7FFFFF = 0x780000 nunha ROM de 8MB.
    let s8 = MapperState::rom_size(SIZE_8MB);
    let w8 = rex_addressing::md_ssf2::write_mapper_register(0xA13002, 0xFF, &s8).unwrap();
    assert_eq!(
        rex_addressing::md_ssf2::translate(0x080000, &w8),
        Translate::Rom { offset: 0x780000 }
    );
    // E seguen sendo aliases válidos: `invert` no estado escrito atopaos.
    assert!(rex_addressing::md_ssf2::invert(0x780000, &w8)
        .unwrap()
        .contains(&0x080000));
}

#[test]
fn inversion_con_bancos_devolve_tódolos_aliases_en_orde() {
    let state = MapperState::ssf2(SIZE_4MB, &[(1, 5), (2, 5)]);
    // 0x281234 está en {xanela 1, xanela 2, identidade da xanela 5}.
    assert_eq!(
        rex_addressing::md_ssf2::invert(0x281234, &state).unwrap(),
        vec![0x081234, 0x101234, 0x281234]
    );
    // Banco 1 = 0: as xanelas 0 e 1 ven o mesmo inicio.
    let zero = MapperState::ssf2(SIZE_4MB, &[(1, 0)]);
    assert_eq!(
        rex_addressing::md_ssf2::invert(0x000000, &zero).unwrap(),
        vec![0x000000, 0x080000]
    );
    // Propiedade: todo alias retradúcese ao offset pedido.
    for offset in [0x000000u32, 0x07FFFF, 0x281234, 0x3FFFFF] {
        for alias in rex_addressing::md_ssf2::invert(offset, &state).unwrap() {
            assert_eq!(
                rex_addressing::md_ssf2::translate(alias, &state),
                Translate::Rom { offset },
                "alias {alias:#x} do offset {offset:#x}"
            );
        }
    }
    // 512KB: todas as xanelas mascaraan á base 0 → oito aliases.
    let small = MapperState::rom_size(0x80000);
    assert_eq!(
        rex_addressing::md_ssf2::invert(0x000123, &small).unwrap(),
        vec![0x000123, 0x080123, 0x100123, 0x180123, 0x200123, 0x280123, 0x300123, 0x380123]
    );
}

#[test]
fn lectura_corta_por_xanela_a_nda_que_a_rom_sea_contigua() {
    let state = MapperState::rom_size(SIZE_4MB);
    let rom = fixture::build_fixture(
        fixture::seed_base("md-ssf2"),
        usize::try_from(SIZE_8MB).expect("8MB"),
        fixture::block_size("md-ssf2"),
    );
    // Fronteira 0→1 en identidade: contigua na ROM, pero dous segmentos.
    let segs = rex_addressing::md_ssf2::read(0x07FFF8, 16, &state, &rom).unwrap();
    assert_eq!(segs.len(), 2);
    assert!(matches!(&segs[0], Segment::Bytes { offset: 0x07FFF8, bytes, .. } if bytes.len() == 8));
    assert!(matches!(&segs[1], Segment::Bytes { offset: 0x080000, bytes, .. } if bytes.len() == 8));

    // Con banco 1 = 5 a fronteira 0→1 xa non é contigua.
    let banks = MapperState::ssf2(SIZE_4MB, &[(1, 5)]);
    let segs = rex_addressing::md_ssf2::read(0x07FFF8, 16, &banks, &rom).unwrap();
    match (&segs[0], &segs[1]) {
        (
            Segment::Bytes {
                offset: a,
                bytes: ab,
                ..
            },
            Segment::Bytes {
                offset: b,
                bytes: bb,
                ..
            },
        ) => {
            assert_eq!((*a, ab.len(), *b, bb.len()), (0x07FFF8, 8, 0x280000, 8));
            assert_eq!(&ab[..], &rom[0x07FFF8..0x080000]);
            assert_eq!(&bb[..], &rom[0x280000..0x280008]);
        }
        other => panic!("segmentos inesperados {other:?}"),
    }

    // Fin da xanela do cartucho: o seguinte treito non ten dispositivo.
    let segs = rex_addressing::md_ssf2::read(0x3FFFFF, 2, &state, &rom).unwrap();
    assert_eq!(segs.len(), 2, "un byte de ROM e un segmento de erro");
    assert!(
        matches!(&segs[0], Segment::Bytes { offset: 0x3FFFFF, bytes, .. } if bytes.len() == 1),
        "primeiro segmento {:#?}",
        segs[0]
    );
    match &segs[1] {
        Segment::Invalid(e) => assert_eq!(e.code, ErrorCode::Unsupported),
        other => panic!("segmento de erro esperado, atopado {other:?}"),
    }

    // Rexión sen backing: clasifícase, non se inventan bytes.
    let segs = rex_addressing::md_ssf2::read(0xFFF000, 4, &state, &rom).unwrap();
    assert_eq!(
        segs,
        vec![Segment::DeviceNoBacking {
            region: Region::WorkRam,
            offset: 0xFFF000 & 0xFFFF,
            error_code: ErrorCode::Unsupported
        }]
    );

    // Imaxe máis curta que o rom_size declarado: o prefixo válido devólvese e o
    // faltante é OutOfRange, sen clamp e sen bytes inventados.
    let short = &rom[..0x3FFFF8];
    let segs = rex_addressing::md_ssf2::read(0x3FFFF0, 16, &state, short).unwrap();
    assert_eq!(segs.len(), 2);
    assert_eq!(
        segs.iter().find_map(|s| match s {
            Segment::Invalid(e) => Some(e.code),
            _ => None,
        }),
        Some(ErrorCode::OutOfRange)
    );
    if let Segment::Bytes { bytes, .. } = &segs[0] {
        assert_eq!(bytes.len(), 8, "prefixo ata o fin da imaxe");
    } else {
        panic!("primeiro segmento debe ser Bytes");
    }
}
