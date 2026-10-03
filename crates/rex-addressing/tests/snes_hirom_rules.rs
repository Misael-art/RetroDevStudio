//! Comportamentos de `snes-hirom` que os vectores pinados **non** cubren:
//! xanela de tamaños distinta da de LoROM, as cinco clases de rexión, a
//! **ausencia** de ambiguidade neste perfil, os aliases de banco de metade e
//! completo, e a diferenza estrutural fronte a LoROM: os bancos completos
//! **emenda** na lectura.
//!
//! Tódalas expectativas están derivadas a man da especificación
//! `docs/rex_profiles/addressing/snes-hirom.md` (ventanas bsnes HIROM/HIROM-RAM
//! `7d5aa1e6…` e `map_hirom`/`Map_HiROMMap` de snes9x `1bcc369e…`), coa
//! aritmética escrita no comentario de cada caso.
//!
//! A fórmula de `invert` é a **corrixida** (rev. 2026-09-25): a anterior usaba
//! `rel < 0x8000` e sumaba `0x8000` ao alias, inventando offsets. Ningún caso
//! deste ficheiro admite a fórmula vella.

mod support;

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region, Segment, Translate};
use support::fixture;

const SIZE_64KB: u64 = 0x1_0000;
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

/// HiROM comeza nun banco completo de 64KB (non en 32KB como LoROM) e remata en
/// 4MB: 8MB xa é ExHiROM.
#[test]
fn so_tamanos_binarios_entre_64kb_e_4mb_son_estado_valido() {
    // Spec: "rom_size: obrigatorio, potencia de 2 en [0x10000, 0x400000]".
    for n in [SIZE_64KB, 0x2_0000, 0x8_0000, SIZE_1MB, 0x20_0000, SIZE_4MB] {
        assert!(
            rex_addressing::snes_hirom::validate_state(&size(n)).is_ok(),
            "{n:#x} debe ser válido"
        );
    }
    for n in [
        0u64,
        0xFFFF,   // por debaixo do banco mínimo
        0x1_8000, // en rango pero non potencia de 2
        0x40_0100,
        SIZE_4MB + 1,
        0x80_0000, // 8MB: perfil ExHiROM
        531577,
    ] {
        let Err(err) = rex_addressing::snes_hirom::validate_state(&size(n)) else {
            panic!("{n:#x} debe rexeitarse");
        };
        assert_eq!(err.code, ErrorCode::Unsupported, "{n:#x}");
        assert!(!err.detail.is_empty(), "{n:#x}: erro sen detalle");
    }
    // LoROM si acepta 32KB; HiROM non. Píñase a fronteira de tamaño para que
    // ninguén comparta o intervalo por accidente.
    assert!(rex_addressing::snes_lorom::validate_state(&size(0x8000)).is_ok());
    assert_eq!(
        rex_addressing::snes_hirom::validate_state(&size(0x8000))
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
}

#[test]
fn clave_estraña_en_hirom_e_rexeitada_non_ignorada() {
    let state = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(SIZE_1MB)),
        (
            "banks".to_string(),
            Value::Object(vec![("1".to_string(), Value::Uint(2))]),
        ),
    ]);
    let Err(err) = rex_addressing::snes_hirom::validate_state(&state) else {
        panic!("unha clave allea debe rexeitarse, non ignorarse");
    };
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert!(
        err.detail.contains("banks"),
        "o detalle debe nomear a clave: {}",
        err.detail
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x008000, &state),
        Translate::Invalid(err)
    );
    // `md-linear` ignora a mesma clave (paridade con `md_linear_rules.rs`).
    assert!(rex_addressing::md_linear::validate_state(&state).is_ok());
}

#[test]
fn estado_amañado_non_devolve_offset_cero() {
    let got = rex_addressing::snes_hirom::translate(0x008000, &MapperState::empty());
    assert_eq!(code_of(got), ErrorCode::Unsupported);

    let text = MapperState::from_entries(vec![(
        "rom_size".to_string(),
        Value::Text("1048576".to_string()),
    )]);
    assert_eq!(
        code_of(rex_addressing::snes_hirom::translate(0x008000, &text)),
        ErrorCode::Unsupported
    );
    assert_eq!(
        rex_addressing::snes_hirom::invert(0, &text)
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
    let rom_img = vec![0u8; 0x10000];
    assert_eq!(
        rex_addressing::snes_hirom::read(0x008000, 4, &text, &rom_img)
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
}

/// `offset = ((banco << 16) + a) & (rom_size - 1)`: lineal, sen páxinas.
/// ROM nos bancos completos `40-7D`/`C0-FF` (todo o banco) e na metade alta dos
/// bancos `00-3F`/`80-BF`.
#[test]
fn rom_e_lineal_con_mascara_de_tamaño() {
    let state = size(SIZE_1MB);
    // banco 00, metade alta: 0x08000.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x008000, &state),
        rom(0x08000)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x00FFFF, &state),
        rom(0x0FFFF)
    );
    // banco 80 (metade alta): 0x808000 & 0xFFFFF = 0x08000, alias exacto do 00.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x808000, &state),
        rom(0x08000)
    );
    // Banco completo 40 na súa dirección 0: offset **0 lexítimo** (non un erro).
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x400000, &state),
        rom(0x000000)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x401234, &state),
        rom(0x001234)
    );
    // 0x7DFFFF → 0x0DFFFF; 0xC00000 → 0 outra vez.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x7DFFFF, &state),
        rom(0x0DFFFF)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0xC00000, &state),
        rom(0x000000)
    );
    // Espeilo: 512KB (máscara 0x7FFFF) → 0x088000 vai a 0x08000.
    let small = size(0x8_0000);
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x088000, &small),
        rom(0x08000)
    );
    // 4MB: o último enderezo do barramento é o último byte do arquivo.
    let big = size(SIZE_4MB);
    assert_eq!(
        rex_addressing::snes_hirom::translate(0xFFFFFF, &big),
        rom(0x3FFFFF)
    );
    // A metade baixa dun banco de metade **non** é ROM (`a >= 0x8000` é o
    // corte): 0x004000 cae na xanela de I/O do banco 00.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x004000, &state),
        device(Region::Io, 0x4000)
    );
}

/// WRAM, SRAM, espello WRAM, I/O e reserva: as cinco clases non-ROM.
#[test]
fn rexions_non_rom_clasifican_se_sin_inventar_bytes() {
    let state = size(SIZE_1MB);
    // WRAM 7E/7F, `offset = a`. Ambíguo só na notación: o spec de HiROM fala de
    // 128KB contiguos (7F = RAM+0x10000) pero as tres representacións fixadas
    // din `a`, así que píñase `a` e a observación vai no informe.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x7E1234, &state),
        device(Region::Wram, 0x1234)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x7FFFFF, &state),
        device(Region::Wram, 0xFFFF)
    );
    // SRAM: 20-3F/A0-BF en $6000-$7FFF, xanela de 2KB (máscara 0x1FFF).
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x206123, &state),
        device(Region::Sram, 0x0123)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x3F7FFF, &state),
        device(Region::Sram, 0x1FFF)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0xA06000, &state),
        device(Region::Sram, 0x0000)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0xBF7FFF, &state),
        device(Region::Sram, 0x1FFF)
    );
    // SRAM gaña ao I/O na mesma faixa: 0x206000 é SRAM mascarada, non I/O cru.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x206000, &state),
        device(Region::Sram, 0x0000)
    );
    // Espello WRAM (8KB) e I/O nos bancos baixos 00-3D/80-BD.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x001FFF, &state),
        device(Region::WramMirror, 0x1FFF)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x800123, &state),
        device(Region::WramMirror, 0x0123)
    );
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x002100, &state),
        device(Region::Io, 0x2100)
    );
    // Banco fóra das faixas de SRAM: `0x1D7FFF` si é I/O cru.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x1D7FFF, &state),
        device(Region::Io, 0x7FFF)
    );
    // E `0xBD7FFF` **non** o é: `A0-BF` reclámao como SRAM antes do I/O.
    assert_eq!(
        rex_addressing::snes_hirom::translate(0xBD7FFF, &state),
        device(Region::Sram, 0x1FFF)
    );
    // Reserva: 3E/3F/BE/BF na metade baixa, sen dispositivo na fonte bsnes.
    for addr in [0x3E4800u32, 0x3F4800, 0xBE4800, 0xBF4800] {
        assert_eq!(
            code_of(rex_addressing::snes_hirom::translate(addr, &state)),
            ErrorCode::Unsupported,
            "{addr:#x}"
        );
    }
    // Eses mesmos bancos con `a >= 0x8000` si son ROM (son bancos de metade).
    assert_eq!(
        rex_addressing::snes_hirom::translate(0x3E8000, &state),
        rom(0x0E8000)
    );
}

/// HiROM é o perfil **sen discordancia de fontes**: as xanelas bsnes e snes9x
/// coinciden en todo o barramento (a diverxencia documentada só afecta aos
/// bancos 3E/3F/BE/BF, que as dúas fontes deixan sen dispositivo). Píñase por
/// mostraxe de todos os bancos, para que un `ambiguous` inventado non pase
/// desapercibido.
#[test]
fn hirom_non_produce_ambiguidade_en_ningun_banco() {
    let state = size(SIZE_1MB);
    let mostras = [
        0x0000u32, 0x1FFF, 0x2000, 0x5FFF, 0x6000, 0x7FFF, 0x8000, 0xFFFF,
    ];
    for bank in 0x00u32..=0xFF {
        for a in mostras {
            let addr = (bank << 16) | a;
            let got = rex_addressing::snes_hirom::translate(addr, &state);
            if let Translate::Invalid(err) = &got {
                assert_ne!(
                    err.code,
                    ErrorCode::Ambiguous,
                    "{addr:#x}: HiROM non ten xanelas ambiguas ({})",
                    err.detail
                );
            }
        }
    }
}

#[test]
fn en_enderezos_fora_do_barramento_non_hai_aritmética() {
    let state = size(SIZE_1MB);
    assert_eq!(
        code_of(rex_addressing::snes_hirom::translate(0x01000000, &state)),
        ErrorCode::OutOfRange
    );
    // O erro do barramento vai **antes** da validación do estado.
    let broken = size(531577);
    assert_eq!(
        code_of(rex_addressing::snes_hirom::translate(0x01000000, &broken)),
        ErrorCode::OutOfRange
    );
}

/// `invert`: banco de metade só captura cando `rel ∈ [0x8000, 0x10000)`; banco
/// completo captura en `rel < 0x10000`. Con `rom_size = 64KB` a máscara anula o
/// banco, así que a lista de aliases é exactamente a clase do banco.
#[test]
fn invert_aliases_de_banco_metade_e_completo() {
    let state = size(SIZE_64KB);
    // offset < 0x8000: só os 126 bancos completos (40-7D = 62, C0-FF = 64).
    let low = rex_addressing::snes_hirom::invert(0x1234, &state).unwrap();
    assert_eq!(low.len(), 126);
    assert_eq!(low.first(), Some(&0x401234));
    assert_eq!(low.last(), Some(&0xFF1234));
    assert!(low.windows(2).all(|w| w[0] < w[1]), "{low:#x?}");

    // offset >= 0x8000: os mesmos 126 máis os 128 bancos de metade
    // (00-3F = 64, 80-BF = 64) → 254.
    let high = rex_addressing::snes_hirom::invert(0xABCD, &state).unwrap();
    assert_eq!(high.len(), 254);
    assert_eq!(high.first(), Some(&0x00ABCD));
    assert_eq!(high.last(), Some(&0xFFABCD));
    for alias in &high {
        assert_eq!(
            rex_addressing::snes_hirom::translate(*alias, &state),
            rom(0xABCD),
            "alias {alias:#x} non retradúce"
        );
        let bank = (alias >> 16) & 0xff;
        assert!(
            !matches!(bank, 0x7e | 0x7f),
            "{bank:#04x} é WRAM, non alias"
        );
    }
}

/// Con 1MB a máscara deixa pasar só os bancos cuxo `start` contén o offset.
#[test]
fn invert_co_espeello_de_tamaño_un_só_grupo_de_bancos() {
    let state = size(SIZE_1MB);
    // 0x12345 está no banco relativo 1 (0x10000..0x1FFFF) → b ≡ 1 (mod 16),
    // rel = 0x2345 < 0x8000 → só bancos completos: 41,51,61,71,C1,D1,E1,F1.
    assert_eq!(
        rex_addressing::snes_hirom::invert(0x12345, &state).unwrap(),
        vec![0x412345, 0x512345, 0x612345, 0x712345, 0xC12345, 0xD12345, 0xE12345, 0xF12345,]
    );

    // 0x0FFFF é a última dirección do banco relativo 0 → rel = 0xFFFF cae na
    // metade alta, así que os 16 bancos `b ≡ 0 (mod 16)` son aliases.
    assert_eq!(
        rex_addressing::snes_hirom::invert(0x0FFFF, &state).unwrap(),
        vec![
            0x00FFFF, 0x10FFFF, 0x20FFFF, 0x30FFFF, 0x40FFFF, 0x50FFFF, 0x60FFFF, 0x70FFFF,
            0x80FFFF, 0x90FFFF, 0xA0FFFF, 0xB0FFFF, 0xC0FFFF, 0xD0FFFF, 0xE0FFFF, 0xF0FFFF,
        ]
    );

    // O último offset de 1MB: b ≡ 15 (mod 16). Entre eles, 0x7F **non** é
    // banco completo (7E/7F son WRAM), así que son 15 aliases, non 16.
    let last = rex_addressing::snes_hirom::invert(0xFFFFF, &state).unwrap();
    assert_eq!(last.len(), 15, "{last:#x?}");
    assert!(!last.contains(&0x7FFFFF), "0x7FFFFF é WRAM");
    assert_eq!(last.first(), Some(&0x0FFFFF));
    assert_eq!(last.last(), Some(&0xFFFFFF));
    for alias in &last {
        assert_eq!(
            rex_addressing::snes_hirom::translate(*alias, &state),
            rom(0xFFFFF)
        );
    }

    // 4MB (máscara 0x3FFFFF): o offset 0x3FFFFF vive na xanela relativa
    // 0x3F0000, e **tres** bancos compártena porque `(b << 16) & 0x3FFFFF` só
    // depende de `b mod 64`: 0x3F (metade), 0xBF (metade) e 0xFF (completo).
    // 0x7F queda fóra: é WRAM, nin metade nin completo.
    let big = size(SIZE_4MB);
    assert_eq!(
        rex_addressing::snes_hirom::invert(0x3FFFFF, &big).unwrap(),
        vec![0x3F_FFFF, 0xBF_FFFF, 0xFF_FFFF]
    );
    for alias in rex_addressing::snes_hirom::invert(0x3FFFFF, &big).unwrap() {
        assert_eq!(
            rex_addressing::snes_hirom::translate(alias, &big),
            rom(0x3FFFFF),
            "alias {alias:#x} non retradúce"
        );
    }

    // Offset máis alá do fim: lista baleira, resposta válida, non erro.
    assert_eq!(
        rex_addressing::snes_hirom::invert(SIZE_1MB as u32, &state).unwrap(),
        Vec::<u32>::new()
    );
}

/// Diferenza estrutural fronte a LoROM: os bancos completos `40-7D`/`C0-FF`
/// son un corredor continuo, mentres que a metade alta dun banco de metade
/// remata no fim do banco.
#[test]
fn lectura_emenda_bancos_completos_mas_corta_na_metade_alta() {
    let state = size(SIZE_1MB);
    let rom_img = fixture::build_fixture(fixture::seed_base("snes-hirom"), 0x100000, 0x10000);
    assert_eq!(
        support::sha256::sha256_hex(&rom_img),
        support::vectors::load()
            .profile("snes-hirom")
            .fixture
            .sha256,
        "a imaxe non é a fixture pinada"
    );

    // 128KB desde 0x400000: bancos 40 e 41 emendados **nun** segmento.
    let segs = rex_addressing::snes_hirom::read(0x400000, 0x20000, &state, &rom_img).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    match &segs[0] {
        Segment::Bytes {
            region,
            offset,
            bytes,
        } => {
            assert_eq!(*region, Region::Rom);
            assert_eq!(*offset, 0);
            assert_eq!(bytes.len(), 0x20000);
            assert_eq!(&bytes[..], &rom_img[..0x20000]);
        }
        other => panic!("{other:?}"),
    }

    // Na metade alta o corredor para en `$FFFF`: o seguinte byte é o banco 01
    // `$0000`, espello WRAM → corredor + segmento clasificador.
    let segs = rex_addressing::snes_hirom::read(0x008000, 0x8001, &state, &rom_img).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, 0x08000);
            assert_eq!(bytes.len(), 0x8000);
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

    // O grupo 40-7D pára en 7E (WRAM), non no fim do banco.
    let segs = rex_addressing::snes_hirom::read(0x7D0000, 0x20000, &state, &rom_img).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, 0x0D0000);
            assert_eq!(bytes.len(), 0x10000, "o corredor pára na porta de WRAM");
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

    // Rexións sen bytes: un segmento, sen inventar nada.
    let segs = rex_addressing::snes_hirom::read(0x206123, 8, &state, &rom_img).unwrap();
    assert_eq!(segs.len(), 1, "{segs:?}");
    assert!(matches!(
        segs[0],
        Segment::DeviceNoBacking {
            region: Region::Sram,
            offset: 0x0123,
            error_code: ErrorCode::Unsupported
        }
    ));
    let segs = rex_addressing::snes_hirom::read(0x3E4800, 8, &state, &rom_img).unwrap();
    assert!(matches!(
        &segs[0],
        Segment::Invalid(e) if e.code == ErrorCode::Unsupported
    ));
}

/// Con `rom_size` menor que a xanela ROM, cada banco repetido **reproduce** o
/// mesmo corredor: o corte é a máscara de espeilo, non o fim do banco.
#[test]
fn lectura_reproduce_o_espeillo_en_cada_banco() {
    let state = size(SIZE_64KB);
    let rom_img = fixture::build_fixture(fixture::seed_base("snes-hirom"), 0x10000, 0x10000);
    let segs = rex_addressing::snes_hirom::read(0x400000, 0x20000, &state, &rom_img).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    for (i, seg) in segs.iter().enumerate() {
        match seg {
            Segment::Bytes {
                region,
                offset,
                bytes,
            } => {
                assert_eq!(*region, Region::Rom);
                assert_eq!(*offset, 0, "banco {i} comeza no offset 0");
                assert_eq!(bytes.len(), 0x10000, "corredor {i}");
                assert_eq!(&bytes[..], &rom_img[..]);
            }
            other => panic!("segmento {i}: {other:?}"),
        }
    }
}

/// Imaxe máis curta que `rom_size`: prefixo real e erro estruturado, sen clamp.
#[test]
fn lectura_imaxe_curta_prefixo_e_erro() {
    let state = size(SIZE_1MB);
    let full = fixture::build_fixture(fixture::seed_base("snes-hirom"), 0x100000, 0x10000);
    let short = &full[..0x0FFFF8]; // 8 bytes menos do declarado
    let segs = rex_addressing::snes_hirom::read(0x3FFFF0, 16, &state, short).unwrap();
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            // (0x3F<<16 + 0xFFF0) & 0xFFFFF = 0x3FFFF0 & 0xFFFFF = 0x0FFFF0.
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
    let rom_img = vec![0u8; 0x100000];
    assert_eq!(
        rex_addressing::snes_hirom::read(0x008000, 0, &state, &rom_img)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    assert_eq!(
        rex_addressing::snes_hirom::read(0x01000000, 4, &state, &rom_img)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // 0xFFFFF8 + 16 remata en 0x1000007: fóra do barramento, rexeitado antes
    // de reservar proporcional á lonxitude.
    assert_eq!(
        rex_addressing::snes_hirom::read(0xFFFFF8, 16, &state, &rom_img)
            .unwrap_err()
            .code,
        ErrorCode::OutOfRange
    );
    // Lonxitude descomunal nun enderezo legal: cortan a páxina e clasifícase o
    // seguinte banco (0x008000 + 0x8000 = 0x010000 → espello WRAM).
    let segs = rex_addressing::snes_hirom::read(0x008000, 0x00FF_0001, &state, &rom_img)
        .expect("lectura dentro do barramento");
    assert_eq!(segs.len(), 2, "{segs:?}");
    match &segs[0] {
        Segment::Bytes { bytes, offset, .. } => {
            assert_eq!(*offset, 0x08000);
            assert_eq!(bytes.len(), 0x8000, "metade alta dun banco, nin unha máis");
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
