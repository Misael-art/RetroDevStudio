//! Auditoría da **semántica de `read`** dos cinco perfis: o que afirma
//! `CONTRATO.md` §7 fronte ao que fai o código, pinned como tests para que a
//! auditoría non volta a ser prosa.
//!
//! Os tres conceptos que o contrato separa e que aquí se comproban por
//! separado: **enderezo do barramento** (o que pide o chamador), **secuencia
//! lóxica** (a orde de bytes do recurso) e **offset físico** (o desprazamento
//! dentro da imaxe). Unha lectura que non os distingue non pode dar
//! procedencia.

mod support;

use rex_addressing::error::AddressingError;
use rex_addressing::state::MapperState;
use rex_addressing::{md_linear, md_ssf2, snes_exhirom, snes_hirom, snes_lorom};
use rex_addressing::{ErrorCode, Region, Segment};
use support::fixture;

type Read = fn(u32, u32, &MapperState, &[u8]) -> Result<Vec<Segment>, AddressingError>;

struct Perfil<'a> {
    id: &'a str,
    read: Read,
    state: MapperState,
    rom: Vec<u8>,
}

fn perfil(id: &'static str, read: Read, rom_size: u64) -> Perfil<'static> {
    Perfil {
        id,
        read,
        state: MapperState::rom_size(rom_size),
        rom: fixture::build_fixture(
            fixture::seed_base(id),
            rom_size as usize,
            fixture::block_size(id),
        ),
    }
}

fn perfis() -> Vec<Perfil<'static>> {
    vec![
        perfil("md-linear", md_linear::read, 0x8_0000),
        perfil("md-ssf2", md_ssf2::read, 0x40_0000),
        perfil("snes-lorom", snes_lorom::read, 0x8_0000),
        perfil("snes-hirom", snes_hirom::read, 0x10_0000),
        perfil("snes-exhirom", snes_exhirom::read, 0x50_0000),
    ]
}

fn bytes_de(segments: &[Segment]) -> usize {
    segments
        .iter()
        .map(|s| match s {
            Segment::Bytes { bytes, .. } => bytes.len(),
            _ => 0,
        })
        .sum()
}

/// §7 di que a rexión non-ROM **se clasifica**, non se salta. Se un percorrido
/// non consume toda a lonxitude pedida, o último segmento ten que dicir por
/// que; e ningún segmento pode vir baleiro (eso si sería un salto silencioso).
#[test]
fn ningunha_rexion_non_rom_se_omite_en_silencio() {
    let enderezos: [u32; 17] = [
        0x00_0000, 0x00_7ff8, 0x00_8000, 0x07_fff8, 0x00_ff80, 0x20_6000, 0x3f_ff00, 0x40_0000,
        0x5f_ff80, 0x70_1000, 0x7d_fff8, 0xa0_0000, 0xa1_3042, 0xc0_fff8, 0xe0_0000, 0xff_fff0,
        0xff_ffff,
    ];
    let lonxitudes: [u32; 5] = [1, 2, 16, 0x100, 0x2000];
    let mut verificadas = 0usize;
    for p in perfis() {
        for &addr in &enderezos {
            for &len in &lonxitudes {
                let got = (p.read)(addr, len, &p.state, &p.rom);
                let segments = match got {
                    Ok(segments) => segments,
                    Err(e) => {
                        // Un erro de entrada tamén é unha resposta: estrutura
                        // e nada de bytes parciais.
                        assert!(
                            matches!(e.code, ErrorCode::OutOfRange | ErrorCode::Unsupported),
                            "{} / {addr:#x}+{len}: código de erro inesperado {:?}",
                            p.id,
                            e.code
                        );
                        verificadas += 1;
                        continue;
                    }
                };
                assert!(
                    !segments.is_empty(),
                    "{} / {addr:#x}+{len}: lista baleira",
                    p.id
                );
                let total = bytes_de(&segments);
                assert!(
                    total <= len as usize,
                    "{} / {addr:#x}+{len}: devolven {} bytes, máis do pedido",
                    p.id,
                    total
                );
                for (i, segment) in segments.iter().enumerate() {
                    match segment {
                        Segment::Bytes {
                            region,
                            offset,
                            bytes,
                        } => {
                            assert_eq!(
                                *region,
                                Region::Rom,
                                "{} / {addr:#x}+{len} segmento {i}: bytes fóra da ROM",
                                p.id
                            );
                            assert!(
                                !bytes.is_empty(),
                                "{} / {addr:#x}+{len} segmento {i}: corredor baleiro",
                                p.id
                            );
                            assert!(
                                (*offset as usize) + bytes.len() <= p.rom.len(),
                                "{} / {addr:#x}+{len} segmento {i}: {offset:#x}+{} sae da imaxe ({} bytes)",
                                p.id,
                                bytes.len(),
                                p.rom.len()
                            );
                        }
                        Segment::DeviceNoBacking {
                            region, error_code, ..
                        } => {
                            assert_ne!(
                                *region,
                                Region::Rom,
                                "{} / {addr:#x}+{len} segmento {i}: ROM sen bytes",
                                p.id
                            );
                            assert_eq!(
                                *error_code,
                                ErrorCode::Unsupported,
                                "{} / {addr:#x}+{len} segmento {i}",
                                p.id
                            );
                            assert_eq!(
                                i,
                                segments.len() - 1,
                                "{} / {addr:#x}+{len}: o segmento clasificador vai no medio",
                                p.id
                            );
                        }
                        Segment::Invalid(e) => {
                            assert_eq!(
                                i,
                                segments.len() - 1,
                                "{} / {addr:#x}+{len}: o erro vai no medio ({i})",
                                p.id
                            );
                            assert!(
                                matches!(
                                    e.code,
                                    ErrorCode::OutOfRange
                                        | ErrorCode::Unsupported
                                        | ErrorCode::Ambiguous
                                ),
                                "{} / {addr:#x}+{len} segmento {i}: {:?}",
                                p.id,
                                e.code
                            );
                        }
                    }
                }
                if total < len as usize {
                    assert!(
                        !matches!(segments.last(), Some(Segment::Bytes { .. })),
                        "{} / {addr:#x}+{len}: lectura incompleta que remata en bytes ({} devoltos): salto silencioso",
                        p.id,
                        total
                    );
                }
                verificadas += 1;
            }
        }
    }
    assert_eq!(
        verificadas,
        5 * enderezos.len() * lonxitudes.len(),
        "cada combinación perfil/enderezo/lonxitude debe quedar graduada"
    );
}

/// A fronteira do barramento repórtase **por canal distinto** en cada familia:
/// os tres perfis SNES devolven `Err` antes de percorrer; os dous de Mega Drive
/// percorren a xanela do cartucho e pechan cun `Segment::Invalid`. O
/// `CONTRATO.md` §7 afirmaba «antes de calquera reserva» sen dicir a que perfís
/// chegaba; píñase aquí a forma real para que a capa de recursos trate as dúas.
#[test]
fn a_fronteira_do_barramento_usa_dous_canais_distintos() {
    // A ROM de 512KB énchese oito veces ata `$3FFFFF`: o esesgo da xanela do
    // cartucho prodúcese xusto despois do último enderezo.
    let p = perfil("md-linear", md_linear::read, 0x8_0000);
    let segments = (p.read)(0x3f_fff0, 0x20, &p.state, &p.rom)
        .expect("md-linear non converte en erro de entrada un percorrido que sae da xanela");
    assert_eq!(
        bytes_de(&segments),
        0x10,
        "só os 16 bytes que faltan da xanela"
    );
    assert!(
        matches!(segments.last(),
            Some(Segment::Invalid(e)) if e.code == ErrorCode::Unsupported),
        "o faltante vai como segmento, non como Err: {:?}",
        segments.last()
    );

    let h = perfil("snes-hirom", snes_hirom::read, 0x10_0000);
    let err = (h.read)(0xff_fff0, 0x20, &h.state, &h.rom)
        .expect_err("HiROM si rexeita antes de percorrer");
    assert_eq!(err.code, ErrorCode::OutOfRange);

    // E en MD o `Err` de entrada queda reservado ao que realmente está fóra:
    let e = (p.read)(0x100_0000, 1, &p.state, &p.rom).expect_err("enderezo fóra do bus");
    assert_eq!(e.code, ErrorCode::OutOfRange);
}

/// O mesmo **offset físico** accesible desde **enderezos do bus** distintos:
/// `md-linear` espéllase por máscara, así que dúas lecturas con enderezos
/// diferentes entregan os mesmos bytes. Unha procedencia que só gardase o
/// enderezo perdería que son o mesmo byte do arquivo.
#[test]
fn enderezo_do_bus_e_offset_fisico_non_son_o_mesmo_concepto() {
    let p = perfil("md-linear", md_linear::read, 0x8_0000);
    let lineal = (p.read)(0x07_9234, 16, &p.state, &p.rom).unwrap();
    let alto = (p.read)(0x3f_9234, 16, &p.state, &p.rom).unwrap();
    let un = match &lineal[..] {
        [Segment::Bytes {
            region,
            offset,
            bytes,
        }] => (*region, *offset, bytes.clone()),
        other => panic!("esperábase un só segmento, atopado {other:?}"),
    };
    let outro = match &alto[..] {
        [Segment::Bytes {
            region,
            offset,
            bytes,
        }] => (*region, *offset, bytes.clone()),
        other => panic!("esperábase un só segmento, atopado {other:?}"),
    };
    assert_eq!(un.0, Region::Rom);
    assert_eq!(un.1, 0x07_9234, "neste enderezo o bus e o offset coinciden");
    assert_eq!(
        outro.1, 0x07_9234,
        "0x3F9234 & (512KB-1): o enderezo do bus non é o offset"
    );
    assert_eq!(
        un.2, outro.2,
        "dous enderezos do bus, mesmo byte do arquivo: iso é un alias"
    );
    // Independencia do oráculo: os bytes son os da imaxe, comprobado por
    // índice, sen chamar a `translate`.
    assert_eq!(
        un.2,
        p.rom[0x07_9234..0x07_9244].to_vec(),
        "a lectura non coincide coa imaxe no offset esperado"
    );
}

/// **Secuencia lóxica** fronte a **offset físico**: con bancos en identidade, a
/// xanela 0 e a xanela 1 son contiguas na ROM e aínda así `read` corta; cun
/// banco reasignado, o corte ven de que os offsets xa non son contiguos. O
/// percorrido lóxico é contínuo nos dous casos — o que cambia é a física.
#[test]
fn a_secuencia_loxica_e_a_fisica_cortan_por_motivos_distintos() {
    let state = MapperState::ssf2(0x40_0000, &[]);
    let rom = fixture::build_fixture(fixture::seed_base("md-ssf2"), 0x40_0000, 0x1_0000);
    let identidade = md_ssf2::read(0x07_fff8, 16, &state, &rom).unwrap();
    let offsets: Vec<u32> = identidade
        .iter()
        .map(|s| match s {
            Segment::Bytes { offset, .. } => *offset,
            other => panic!("esperábase Bytes, atopado {other:?}"),
        })
        .collect();
    assert_eq!(
        offsets,
        vec![0x07_fff8, 0x08_0000],
        "dous corredores contiguos"
    );
    assert_eq!(identidade.len(), 2, "a identidade da xanela non se emenda");

    let remapeado = MapperState::ssf2(0x40_0000, &[(1, 5)]);
    let segments = md_ssf2::read(0x07_fff8, 16, &remapeado, &rom).unwrap();
    let offsets: Vec<u32> = segments
        .iter()
        .map(|s| match s {
            Segment::Bytes { offset, .. } => *offset,
            other => panic!("esperábase Bytes, atopado {other:?}"),
        })
        .collect();
    assert_eq!(
        offsets,
        vec![0x07_fff8, 0x28_0000],
        "banco 5 → base 5·512KB: a física descontinua, a lóxica non"
    );
    for (segmento, esperado) in segments.iter().zip(offsets) {
        match segmento {
            Segment::Bytes { bytes, offset, .. } => {
                assert_eq!(*offset, esperado);
                assert_eq!(
                    *bytes,
                    rom[esperado as usize..(esperado as usize + bytes.len())].to_vec()
                );
            }
            other => panic!("{other:?}"),
        }
    }
}

/// Rama defensiva do §7: nos dous perfis MD hai un `u32::try_from(cursor)` que
/// só se alcanzaría se a xanela do cartucho chegase ao fin do bus. Non chega
/// (`$400000` xa é área sen dispositivo), así que o percorrido MD **nunca**
/// devolve `OutOfRange` por esesgo — o que si pode pasar é `Unsupported`.
/// Píñase para que ninguén tome esa rama como comportamento observable.
#[test]
fn a_rama_de_esesgo_do_barramento_en_md_non_e_alcanzable() {
    let p = perfil("md-linear", md_linear::read, 0x40_0000);
    for &addr in [0x3f_ff80u32, 0x3f_fff0, 0x3f_ffff].iter() {
        let segments = (p.read)(addr, u32::MAX, &p.state, &p.rom).unwrap();
        let out_of_range = segments.iter().any(|s| match s {
            Segment::Invalid(e) => e.code == ErrorCode::OutOfRange,
            _ => false,
        });
        assert!(
            !out_of_range,
            "{addr:#x}: o esesgo do bus non é alcanzable dende a xanela do cartucho"
        );
        assert_eq!(
            bytes_de(&segments),
            0x40_0000 - usize::try_from(addr).unwrap(),
            "{addr:#x}: o percorrido cubre ata o fin da xanela e para"
        );
    }
}
