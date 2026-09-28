//! Perfil `snes-exhirom`: ROM con **dúas áreas** de 4MB sobre o mesmo
//! barramento de 24 bits.
//!
//! Especución en `docs/rex_profiles/addressing/snes-exhirom.md`, derivada das
//! xanelas `EXHIROM`/`EXHIROM-RAM` de bsnes `7d5aa1e6…` (`loadMap`, `Bus::map`,
//! `mirror`/`reduce`) e de `Map_ExtendedHiROMMap` / `map_hirom_offset` /
//! `map_mirror` de snes9x `1bcc369e…`. Ningunha liña transplantada.
//!
//! Tres estruturas distintas fronte a HiROM, todas visibles nestas firmas:
//! - o tamaño **total** non ten que ser potencia de 2: o que é binario é a
//!   segunda área (`rom_size - 0x400000`), así que 5MB e 6MB son estados válidos;
//! - `offset` non é unha máscara lineal: a área 2 usa `0x400000 + (endereco mod
//!   half2)` e a área 1 desconecta A22/A23 (`endereco mod 0x400000`);
//! - `invert` ten **dúas** fórmulas, unha por área, e a de área 2 é modular.

use crate::error::AddressingError;
use crate::region::Region;
use crate::snes_common::{self as common, HIGH_HALF};
use crate::{ErrorCode, MapperState, Segment, Translate};
use common::BUS_LIMIT;

pub const PROFILE_ID: &str = "snes-exhirom";
/// Base da segunda área: o offset 4MB do arquivo.
pub const AREA2_BASE: u32 = 0x40_0000;
/// 5MB: o menor total cuxa segunda área vale polo menos un banco de 64KB.
pub const MIN_ROM_SIZE: u32 = 0x50_0000;
/// 8MB: duas áreas de 4MB caben xustas no barramento de 24 bits.
pub const MAX_ROM_SIZE: u32 = 0x80_0000;
/// `half2` mínimo: un banco de 64KB.
pub const MIN_AREA2_SIZE: u32 = 0x1_0000;
/// Metade baixa con batería nos bancos `20-3F`/`A0-BF`.
const SRAM_START: u32 = 0x6000;
const SRAM_END: u32 = 0x7fff;
/// Tamaño da xanela de SRAM (máscara `0x1FFF`).
const SRAM_WINDOW: u32 = 0x2000;

/// Área do banco: `true` = segunda área (base 4MB), `false` = primeira.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Window {
    area2: bool,
    lo: u32,
}

fn rom(offset: u32) -> Translate {
    Translate::Rom { offset }
}

fn device(region: Region, offset: u32) -> Translate {
    Translate::Device { region, offset }
}

/// Clases de xanela por banco (bsnes EXHIROM: `00-3f:8000-ffff`,
/// `40-7d:0000-ffff`, `80-bf:8000-ffff`, `c0-ff:0000-ffff`).
fn window_for(bank: u32) -> Window {
    if bank <= 0x3f {
        Window {
            area2: true,
            lo: HIGH_HALF,
        }
    } else if bank <= 0x7d {
        Window { area2: true, lo: 0 }
    } else if bank <= 0xbf {
        Window {
            area2: false,
            lo: HIGH_HALF,
        }
    } else {
        Window {
            area2: false,
            lo: 0,
        }
    }
}

/// `mapper_state = { rom_size }`, total en (4MB, 8MB] coa segunda área binaria;
/// **claves alleas rexeítanse** (ExHiROM non ten rexistradores de mapper).
pub fn validate_state(state: &MapperState) -> Result<(), AddressingError> {
    rom_size(state).map(|_| ())
}

fn rom_size(state: &MapperState) -> Result<u32, AddressingError> {
    let size = common::only_rom_size(state, PROFILE_ID)?;
    if !(MIN_ROM_SIZE..=MAX_ROM_SIZE).contains(&size) {
        return Err(common::err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {size:#x} fóra do intervalo ({:#x}, {:#x}] de {PROFILE_ID}; <=4MB é perfil snes-hirom, >8MB non é enderezable no barramento de 24 bits",
                AREA2_BASE, MAX_ROM_SIZE
            ),
        ));
    }
    let half2 = size - AREA2_BASE;
    if !half2.is_power_of_two() {
        return Err(common::err(
            ErrorCode::Unsupported,
            format!(
                "segunda área de ExHiROM (rom_size - {:#x} = {half2:#x}) non é potencia de 2: normalize o arquivo (pad 0xFF ata 5/6/8MB) e rexistre a normalización na evidencia",
                AREA2_BASE,
            ),
        ));
    }
    Ok(size)
}

/// `translate(cpu_address, mapper_state)`.
///
/// Orde da táboa da especificación: WRAM (que vence na porta `7E`/`7F`), ROM da
/// área correspondente, SRAM (que gaña ao I/O na mesma faixa), espello WRAM,
/// I/O, reserva.
pub fn translate(cpu_address: u32, state: &MapperState) -> Translate {
    if cpu_address > BUS_LIMIT {
        return Translate::Invalid(common::bus_error(cpu_address, PROFILE_ID));
    }
    let size = match rom_size(state) {
        Ok(size) => size,
        Err(e) => return Translate::Invalid(e),
    };
    let half2 = size - AREA2_BASE;
    let bank = common::bank_of(cpu_address);
    let a = common::low_of(cpu_address);

    if common::is_wram_bank(bank) {
        return device(Region::Wram, a);
    }
    let window = window_for(bank);
    if a >= window.lo {
        // Área 2: base 4MB + espeello `mod half2` (bsnes `base + mirror(A,
        // size - base)`; snes9x `map_mirror(calculated_size - 0x400000, …)`).
        // Área 1: A22/A23 desconectados (bsnes máscara `0xC00000`; snes9x
        // `map_mirror(0x400000, …)`), que en 24 bits equivale a `& 0x3FFFFF`.
        if window.area2 {
            return rom(AREA2_BASE + cpu_address % half2);
        }
        return rom(cpu_address % AREA2_BASE);
    }
    if ((0x20..=0x3f).contains(&bank) || (0xa0..=0xbf).contains(&bank))
        && (SRAM_START..=SRAM_END).contains(&a)
    {
        return device(Region::Sram, a & (SRAM_WINDOW - 1));
    }
    if let Some((region, offset)) = common::system_region(bank, a) {
        return device(region, offset);
    }
    Translate::Invalid(common::reserved_error(bank, a))
}

/// `invert(rom_offset, mapper_state)`.
///
/// Área 1: o banco relativo do offset é `offset >> 16` e só os bancos con
/// `banco & 0x3F` igual a ese poden velo, co `a` dentro da súa xanela. Área 2:
/// `a = (offset - 0x400000 - banco*0x10000) mod half2`, único porque
/// `half2 >= 64KB`. Os bancos `7E`/`7F` nunca son aliases: neles manda a WRAM.
pub fn invert(rom_offset: u32, state: &MapperState) -> Result<Vec<u32>, AddressingError> {
    let size = rom_size(state)?;
    if rom_offset >= size {
        return Ok(Vec::new());
    }
    let half2 = i64::from(size - AREA2_BASE);
    let mut aliases = Vec::new();
    for bank in 0..=0xffu32 {
        if common::is_wram_bank(bank) {
            continue;
        }
        let window = window_for(bank);
        // Un banco só pode ser alias da súa propia área.
        let candidato = match (window.area2, rom_offset >= AREA2_BASE) {
            (true, true) => Some(
                (i64::from(rom_offset) - i64::from(AREA2_BASE) - i64::from(bank) * 0x1_0000)
                    .rem_euclid(half2),
            ),
            (false, false) if (bank & 0x3f) == (rom_offset >> 16) => {
                Some(i64::from(rom_offset & 0xffff))
            }
            _ => None,
        };
        if let Some(a) = candidato {
            // A xustificación real non é que `a` vala menos de 16 bits (na área 2
            // vale ata `half2 - 1`, até 4MB): é que `half2 ≤ 4MB < 2^32`. O corte
            // de 16 bits fai a comprobación de abaixo, `a < window.lo..0x1_0000`.
            let a =
                u32::try_from(a).expect("candidato = rem_euclid(half2), e half2 ≤ 4MB cabe en u32");
            if (a >= window.lo) && (a < 0x1_0000) {
                aliases.push((bank << 16) + a);
            }
        }
    }
    aliases.sort_unstable();
    Ok(aliases)
}

/// Bytes que seguen na **mesma** xanela ROM contigua desde `cursor`: as xanelas
/// de metade alta paramos no fim do banco, o grupo `40-7D` na porta de WRAM e o
/// grupo `C0-FF` no fim do barramento.
fn rom_window_left(cursor: u32) -> u64 {
    let bank = common::bank_of(cursor);
    let window = window_for(bank);
    if window.lo == HIGH_HALF {
        return 0x1_0000 - u64::from(common::low_of(cursor));
    }
    if bank <= 0x7d {
        return 0x7e_0000 - u64::from(cursor);
    }
    0x100_0000 - u64::from(cursor)
}

/// `read(cpu_address, length, mapper_state, rom)`.
pub fn read(
    cpu_address: u32,
    length: u32,
    state: &MapperState,
    rom: &[u8],
) -> Result<Vec<Segment>, AddressingError> {
    if cpu_address > BUS_LIMIT {
        return Err(common::bus_error(cpu_address, PROFILE_ID));
    }
    if length < 1 {
        return Err(common::err(
            ErrorCode::OutOfRange,
            "length debe ser un enteiro >= 1",
        ));
    }
    let size = rom_size(state)?;
    // Rexeitado **antes** de calquera reserva proporcional á lonxitude.
    if u64::from(cpu_address) + length as u64 - 1 > u64::from(BUS_LIMIT) {
        return Err(common::err(
            ErrorCode::OutOfRange,
            format!(
                "lectura de {length} bytes en {cpu_address:#x} ultrapasa o barramento de 24 bits",
            ),
        ));
    }

    let mut segments: Vec<Segment> = Vec::new();
    let mut cursor = u64::from(cpu_address);
    let end = u64::from(cpu_address) + length as u64; // exclusivo
    while cursor < end {
        let addr = u32::try_from(cursor).expect("a lectura non pode saír do barramento");
        match translate(addr, state) {
            Translate::Invalid(e) => {
                segments.push(Segment::Invalid(e));
                break;
            }
            Translate::Device { region, offset } => {
                segments.push(Segment::DeviceNoBacking {
                    region,
                    offset,
                    error_code: crate::ErrorCode::Unsupported,
                });
                break;
            }
            Translate::Rom { offset } => {
                let remaining = end - cursor;
                // Descontinuidade propia de cada área: o espeello da área 1
                // remata en 0x400000 e o da área 2 en `rom_size`.
                let area2 = window_for(common::bank_of(addr)).area2;
                let left_in_mirror = u64::from(if area2 {
                    size - offset
                } else {
                    AREA2_BASE - offset
                });
                let run = usize::try_from(remaining.min(rom_window_left(addr)).min(left_in_mirror))
                    .expect("un corredor ExHiROM vale como máximo o barramento");
                debug_assert!(
                    run >= 1,
                    "corredor baleiro: a fórmula de offset e a anchura do espeillo non son consistentes"
                );
                let start = offset as usize;
                if start + run > rom.len() {
                    if start < rom.len() {
                        segments.push(Segment::Bytes {
                            region: Region::Rom,
                            offset,
                            bytes: rom[start..].to_vec(),
                        });
                    }
                    segments.push(Segment::Invalid(common::err(
                        ErrorCode::OutOfRange,
                        format!(
                            "imaxe ({} bytes) máis curta que rom_size declarado ({size}); trecho faltante a partir do offset {offset:#x}",
                            rom.len(),
                        ),
                    )));
                    break;
                }
                segments.push(Segment::Bytes {
                    region: Region::Rom,
                    offset,
                    bytes: rom[start..start + run].to_vec(),
                });
                cursor += run as u64;
            }
        }
    }
    Ok(segments)
}
