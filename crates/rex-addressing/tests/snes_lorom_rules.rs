//! Comportamentos de `snes-lorom` que os vectores pinados **non** cubren:
//! intervalo de tamaños, rexeitamento de claves alleas (a diferenza de
//! `md-linear`), as cinco clases de rexión non-ROM, a discordancia A15 e os
//! cortes de lectura entre páxinas.
//!
//! Tódalas expectativas están derivadas a man da especificación
//! `docs/rex_profiles/addressing/snes-lorom.md` (ventanas bsnes LOROM/LOROM-RAM
//! `7d5aa1e6…` e `map_lorom`/`Map_LoROMMap` de snes9x `1bcc369e…`), coa
//! aritmética escrita no comentario de cada caso.

mod support;

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region, Segment, Translate};
use support::fixture;

const SIZE_1MB: u64 = 0x10_0000;
const SIZE_4MB: u64 = 0x40_0000;

fn size(n: u64) -> MapperState {
    MapperState::rom_size(n)
}

fn rom(offset: u32) -> Translate {
    Translate::Rom { offset }
}

fn device(region: Region, offset: u32) -> Translate {
    Translate::Device { region, offset }
}

#[test]
fn so_tamanos_binarios_entre_32kb_e_4mb_son_estado_valido() {
    // Spec: "rom_size: obrigatorio, potencia de 2 en [0x8000, 0x400000]".
    for n in [0x8000u64, 0x10000, 0x80000, SIZE_1MB, 0x200000, SIZE_4MB] {
        assert!(
            rex_addressing::snes_lorom::validate_state(&size(n)).is_ok(),
            "{n:#x} debe ser válido"
        );
    }
    for n in [
        0u64,
        0x7FFF,
        0x4000,
        0x18000,
        0x40_0100,
        SIZE_4MB + 1,
        0x800000,
        531577,
    ] {
        let Err(err) = rex_addressing::snes_lorom::validate_state(&size(n)) else {
            panic!("{n:#x} debe rexeitarse");
        };
        assert_eq!(err.code, ErrorCode::Unsupported, "{n:#x}");
        assert!(!err.detail.is_empty(), "{n:#x}: erro sen detalle");
    }
}

/// LoROM **non ten estado de mapper**: unha clave que non coñece rexeítase,
/// mentres que `md-linear` a ignora (paridade coa referencia auditada, pinada
/// en `tests/md_linear_rules.rs`). Píñase a diferenza explícita.
#[test]
fn clave_estraña_en_lorom_e_rexeitada_non_ignorada() {
    let state = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(SIZE_1MB)),
        (
            "banks".to_string(),
            Value::Object(vec![("1".to_string(), Value::Uint(2))]),
        ),
    ]);
    let Err(err) = rex_addressing::snes_lorom::validate_state(&state) else {
        panic!("unha clave allea debe rexeitarse, non ignorarse");
    };
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert!(
        err.detail.contains("banks"),
        "o detalle debe nomear a clave: {}",
        err.detail
    );
    // E `translate` non chega á aritmética nese caso.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x008000, &state),
        Translate::Invalid(err)
    );
    // O contraste con `md-linear` tamén está pinado, para que ninguén "unifique"
    // as duas políticas por accidente.
    assert!(rex_addressing::md_linear::validate_state(&state).is_ok());
}

#[test]
fn estado_amañado_non_devolve_offset_cero() {
    let got = rex_addressing::snes_lorom::translate(0x008000, &MapperState::empty());
    assert_eq!(code_of(got), ErrorCode::Unsupported);

    let text = MapperState::from_entries(vec![(
        "rom_size".to_string(),
        Value::Text("1048576".to_string()),
    )]);
    assert_eq!(
        code_of(rex_addressing::snes_lorom::translate(0x008000, &text)),
        ErrorCode::Unsupported
    );
    // `invert` e `read` usan a mesma validación.
    assert_eq!(
        rex_addressing::snes_lorom::invert(0, &text)
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
    let rom = vec![0u8; 0x10000];
    assert_eq!(
        rex_addressing::snes_lorom::read(0x008000, 4, &text, &rom)
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
}

/// `offset = ((banco & 0x7F) * 0x8000 + (a & 0x7FFF)) & (rom_size - 1)`, só na
/// metade alta (`a >= 0x8000`) dos bancos `00-7D`/`80-FF`.
#[test]
fn rom_e_aritmetica_de_pagina_con_espeello() {
    let state = size(SIZE_1MB);
    // banco 00, $8000 → páxina 0, desprazamento 0.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x008000, &state),
        rom(0)
    );
    // banco 00, $FFFF → 0x7FFF.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x00FFFF, &state),
        rom(0x07FFF)
    );
    // banco 80: A15 desconectado → alias exacto do banco 00.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x808000, &state),
        rom(0)
    );
    // banco 3F, $8000 → 0x3F*0x8000 = 0x1F8000, & 0xFFFFF = 0x0F8000.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x3F8000, &state),
        rom(0x0F8000)
    );
    // banco 20, $FFF8 → 0x100000 + 0x7FF8 = 0x107FF8 & 0xFFFFF = 0x007FF8.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x20FFF8, &state),
        rom(0x007FF8)
    );
    // banco FE (páxina 0x7E): 0x7E*0x8000 = 0x3F0000 & 0xFFFFF = 0x0F0000.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0xFE8000, &state),
        rom(0x0F0000)
    );
    // nunha ROM de 4MB non hai dobre máscara: FF → 0x7F*0x8000+0x7FFF.
    let big = size(SIZE_4MB);
    assert_eq!(
        rex_addressing::snes_lorom::translate(0xFFFFFF, &big),
        rom(0x3FFFFF)
    );
    assert_eq!(
        rex_addressing::snes_lorom::translate(0xC08000, &big),
        rom(0x200000)
    );
    // $00FFD8 (vetores de reset do banco 00) cae dentro da xanela ROM.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x00FFD8, &state),
        rom(0x07FD8)
    );
}

/// As catro clases non-ROM e a reserva, todas derivadas da táboa da spec.
#[test]
fn rexions_non_rom_clasifican_se_sin_inventar_bytes() {
    let state = size(SIZE_1MB);
    // WRAM: bancos 7E/7F completos. **Ambos devolven `a`**: é o que din as tres
    // representacións fixadas (táboa da spec, referencia auditada e o motor
    // declarativo con `OffsetRule::AIdentity`), así que píñase aquí e a
    // observación de que HiROM declara 128KB contiguos queda no informe, non
    // nun cambio silencioso deste perfil.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x7E1234, &state),
        device(Region::Wram, 0x1234)
    );
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x7FFFFF, &state),
        device(Region::Wram, 0xFFFF)
    );
    // Espello WRAM (8KB) na metade baixa dos bancos 00-3D/80-BD: máscara, non
    // enderezo cru.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x001FFF, &state),
        device(Region::WramMirror, 0x1FFF)
    );
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x800123, &state),
        device(Region::WramMirror, 0x0123)
    );
    // I/O: $2000-$7FFF deses mesmos bancos, offset cru.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x002100, &state),
        device(Region::Io, 0x2100)
    );
    assert_eq!(
        rex_addressing::snes_lorom::translate(0xBD7FFF, &state),
        device(Region::Io, 0x7FFF)
    );
    // SRAM: 70-7D/F0-FF na metade baixa, xanela de 8KB con máscara 0x7FFF.
    // Gana ao I/O, así que 0x7D4000 non é I/O.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x701234, &state),
        device(Region::Sram, 0x1234)
    );
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x7D7FFF, &state),
        device(Region::Sram, 0x7FFF)
    );
    assert_eq!(
        rex_addressing::snes_lorom::translate(0xF04000, &state),
        device(Region::Sram, 0x4000)
    );
    // Reserva: 3E/3F/BE/BF na metade baixa non teñen dispositivo nas fontes.
    for addr in [0x3E4800u32, 0x3F4800, 0xBE4800, 0xBF4800] {
        assert_eq!(
            code_of(rex_addressing::snes_lorom::translate(addr, &state)),
            ErrorCode::Unsupported,
            "{addr:#x}"
        );
    }
}

/// Discordancia A15: `snes9x Map_LoROMMap` ve ROM aliás, `bsnes` deixa open
/// bus. Sen base primaria para escoller, o perfil devolve `ambiguous`.
#[test]
fn metade_baixa_con_a15_desconectado_e_ambiguous_nunca_palpito() {
    let state = size(SIZE_1MB);
    // Bancos 40-6F e C0-EF, a < 0x8000 (70-7D e F0-FF teñen clasificación SRAM
    // previa; 7E/7F son WRAM).
    for addr in [0x401234u32, 0x402100, 0x6F1234, 0xC01234, 0xEF1234] {
        let got = rex_addressing::snes_lorom::translate(addr, &state);
        let visto = format!("{got:?}");
        assert_eq!(
            code_of(got),
            ErrorCode::Ambiguous,
            "{addr:#x}: agardábase ambiguous, atopado {visto}"
        );
    }
    // 70-7D e F0-FF si teñen clasificación previa (SRAM), así que **non** son
    // ambigus: a precedente da táboa decide, non a vaguedade.
    assert_eq!(
        rex_addressing::snes_lorom::translate(0x701234, &state),
        device(Region::Sram, 0x1234)
    );
}

#[test]
fn en_enderezos_fora_do_barramento_non_ambiguidade() {
    let state = size(SIZE_1MB);
    assert_eq!(
        code_of(rex_addressing::snes_lorom::translate(0x01000000, &state)),
        ErrorCode::OutOfRange
    );
    // O erro do barramento vai **antes** da validación do estado.
    let broken = size(531577);
    assert_eq!(
        code_of(rex_addressing::snes_lorom::translate(0x01000000, &broken)),
        ErrorCode::OutOfRange
    );
}

/// `invert` devolve **todos** os aliases. Derivación a man (1MB, máscara
/// 0xFFFFF, páxina de 32KB): o offset 0x12345 está na páxina 2 (0x10000) con
/// desprazamento 0x2345; as páxinas equivalentes polo espello son
/// `p ≡ 2 (mod 32)` → 2, 34, 66, 98; cada unha é visible desde o banco `p`
/// (se `p <= 0x7D`) e desde `p | 0x80`.
#[test]
fn invert_devolve_todos_os_aliases_de_pagina_e_espeello() {
    let state = size(SIZE_1MB);
    let want: Vec<u32> = vec![
        0x02A345, 0x22A345, 0x42A345, 0x62A345, 0x82A345, 0xA2A345, 0xC2A345, 0xE2A345,
    ];
    let got = rex_addressing::snes_lorom::invert(0x12345, &state).unwrap();
    assert_eq!(got, want);
    for alias in &got {
        assert_eq!(
            rex_addressing::snes_lorom::translate(*alias, &state),
            rom(0x12345),
            "alias {alias:#x} non retradúce"
        );
    }

    // offset 0: páxinas `p ≡ 0 (mod 32)` → 0, 32, 64, 96; cada unha polos bancos
    // `p` (se `p <= 0x7D`) e `p | 0x80`.
    assert_eq!(
        rex_addressing::snes_lorom::invert(0, &state).unwrap(),
        vec![0x008000, 0x208000, 0x408000, 0x608000, 0x808000, 0xA08000, 0xC08000, 0xE08000]
    );

    // En 4MB a máscara non duplica páxinas: offset 0 só ten os bancos 00 e 80.
    let big = size(SIZE_4MB);
    assert_eq!(
        rex_addressing::snes_lorom::invert(0, &big).unwrap(),
        vec![0x008000, 0x808000]
    );
    // O último offset de 4MB é a páxina 0x7F, invisible desde o banco 7F (WRAM):
    // só o alias 0xFF existe.
    assert_eq!(
        rex_addressing::snes_lorom::invert(0x3FFFFF, &big).unwrap(),
        vec![0x00FF_FFFF]
    );
    for alias in rex_addressing::snes_lorom::invert(0x3FFFFF, &big).unwrap() {
        assert_eq!(
            rex_addressing::snes_lorom::translate(alias, &big),
            rom(0x3FFFFF)
        );
    }

    // Offset máis alá do fim: lista baleira, resposta válida, non erro.
    assert_eq!(
        rex_addressing::snes_lorom::invert(0x100000, &state).unwrap(),
        Vec::<u32>::new()
    );
    // Sempre en orde crecente.
    let aliases = rex_addressing::snes_lorom::invert(0x0D8000, &state).unwrap();
    assert!(aliases.windows(2).all(|w| w[0] < w[1]), "{aliases:#x?}");
}

/// En LoROM ningunha lectura ROM emenda na páxina seguinte: o byte despois de
/// `$xxxxFFFF` é a metade baixa do banco veciño (espello WRAM / I/O / ambiguo).
#[test]
fn lectura_corta_en_cada_pagina_e_classifica_o_resto() {
    let state = size(SIZE_1MB);
    let rom = fixture::build_fixture(fixture::seed_base("snes-lorom"), 0x100000, 0x8000);
    assert_eq!(
        support::sha256::sha256_hex(&rom),
        support::vectors::load()
            .profile("snes-lorom")
            .fixture
            .sha256,
        "a imaxe non é a fixture pinada"
    );

    // 32KB xustos desde $008000: un só corredor, offset 0.
    let segs = rex_addressing::snes_lorom::read(0x008000, 0x8000, &state, &rom).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    match &segs[0] {
        Segment::Bytes {
            region,
            offset,
            bytes,
        } => {
            assert_eq!(*region, Region::Rom);
            assert_eq!(*offset, 0);
            assert_eq!(bytes.len(), 0x8000);
            assert_eq!(&bytes[..], &rom[..0x8000]);
        }
        other => panic!("segmento inesperado {other:?}"),
    }

    // Un byte máis: a páxina 0 remata e o seguinte é espello WRAM do banco 01
    // → corredor + segmento clasificador, sen clamp e sen bytes inventados.
    let segs = rex_addressing::snes_lorom::read(0x008000, 0x8001, &state, &rom).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[1] {
        Segment::DeviceNoBacking {
            region,
            offset,
            error_code,
        } => {
            assert_eq!(*region, Region::WramMirror);
            assert_eq!(*offset, 0);
            assert_eq!(*error_code, ErrorCode::Unsupported);
        }
        other => panic!("esperado DeviceNoBacking, atopado {other:?}"),
    }

    // Comezar na metade alta do banco 00 e cruzar o seu fim a oito bytes.
    let segs = rex_addressing::snes_lorom::read(0x00FFF8, 16, &state, &rom).unwrap();
    assert_eq!(segs.len(), 2);
    let expected_offset = 0x07FF8; // (0*0x8000 + 0x7FF8) & 0xFFFFF
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, expected_offset);
            assert_eq!(bytes.len(), 8);
            assert_eq!(&bytes[..], &rom[expected_offset as usize..][..8]);
        }
        other => panic!("{other:?}"),
    }

    // Desde a metade baixa: I/O antes de tocar ROM, cun só segmento.
    let segs = rex_addressing::snes_lorom::read(0x002100, 8, &state, &rom).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    assert!(matches!(
        segs[0],
        Segment::DeviceNoBacking {
            region: Region::Io,
            offset: 0x2100,
            error_code: ErrorCode::Unsupported
        }
    ));

    // Ambiguo: a lectura non adiviña bytes, devolve o erro no corredor.
    let segs = rex_addressing::snes_lorom::read(0x401234, 8, &state, &rom).unwrap();
    assert!(matches!(
        &segs[0],
        Segment::Invalid(e) if e.code == ErrorCode::Ambiguous
    ));

    // Banco 20 (páxina 32 mascarada ao comezo do arquivo): o seguinte byte é a
    // metade baixa do banco 21, espello WRAM.
    let segs = rex_addressing::snes_lorom::read(0x20FFF8, 16, &state, &rom).unwrap();
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, 0x007FF8);
            assert_eq!(bytes.len(), 8);
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        segs[1],
        Segment::DeviceNoBacking {
            region: Region::WramMirror,
            ..
        }
    ));
}

/// Imaxe máis curta que `rom_size`: devólvese o prefixo real e o faltante queda
/// como erro estruturado, sen clamp nin bytes inventados.
#[test]
fn lectura_imaxe_curta_prefixo_e_erro() {
    let state = size(SIZE_1MB);
    let full = fixture::build_fixture(fixture::seed_base("snes-lorom"), 0x100000, 0x8000);
    let short = &full[..0x0FFFF8]; // 8 bytes menos do declarado
    let segs = rex_addressing::snes_lorom::read(0x3FFFF0, 16, &state, short).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            // (0x3F*0x8000 + 0x7FF0) & 0xFFFFF = 0x0FFF00 + ... = 0x0FFFF0
            assert_eq!(*offset, 0x0FFFF0);
            assert_eq!(bytes.len(), 8, "só existen 8 bytes ata o fim da imaxe");
            assert_eq!(&bytes[..], &full[0x0FFFF0..0x0FFFF8]);
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        &segs[1],
        Segment::Invalid(e) if e.code == ErrorCode::OutOfRange
    ));
}

#[test]
fn lectura_rexeita_antes_de_reservar() {
    let state = size(SIZE_1MB);
    let rom = vec![0u8; 0x100000];
    // `length` cero.
    assert_eq!(
        rex_addressing::snes_lorom::read(0x008000, 0, &state, &rom)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // Enderezo fóra do barramento.
    assert_eq!(
        rex_addressing::snes_lorom::read(0x01000000, 4, &state, &rom)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // Que cruza o fim do barramento: rexeitado **antes** de reservar (case
    // pinado: 0xFFFFF8 + 16 bytes acaba en 0x1000007).
    assert_eq!(
        rex_addressing::snes_lorom::read(0xFFFFF8, 16, &state, &rom)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // Un `length` descomunal nun enderezo legal non alista 4G de segmentos: a
    // lectura corta na fronteira da páxina e classifica o seguinte banco.
    let segs = rex_addressing::snes_lorom::read(0x008000, 0x00FF_0001, &state, &rom)
        .expect("lectura dentro do barramento");
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { bytes, offset, .. } => {
            assert_eq!(*offset, 0);
            assert_eq!(bytes.len(), 0x8000, "unha páxina LoROM, nin unha máis");
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        segs[1],
        Segment::DeviceNoBacking {
            region: Region::WramMirror,
            offset: 0,
            error_code: ErrorCode::Unsupported
        }
    ));
}

fn code_of(got: Translate) -> ErrorCode {
    match got {
        Translate::Invalid(e) => e.code,
        other => panic!("esperado Invalid, atopado {other:?}"),
    }
}
