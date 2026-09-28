//! Perfil `snes-hirom`: ROM **lineal** — `offset = ((banco << 16) + a) & máscara`.
//!
//! Especución en `docs/rex_profiles/addressing/snes-hirom.md`, derivada das
//! xanelas `HIROM`/`HIROM-RAM` de bsnes `7d5aa1e6…` e de `map_hirom` /
//! `Map_HiROMMap` de snes9x `1bcc369e…`. Ningunha liña transplantada.
//!
//! Dúas diferenzas estruturais fronte a LoROM, ambas visibles nestas firmas:
//! - os bancos `40-7D`/`C0-FF` son ROM en **todo** o banco, así que unha
//!   lectura pódem emendar máis alá de `$FFFF`;
//! - non hai xanela ambigua: as dúas fontes fixadas coinciden en todo o
//!   barramento, así que `Ambiguous` nunca aparece neste perfil.

use crate::error::AddressingError;
use crate::region::Region;
use crate::snes_common::{self as common, HIGH_HALF};
use crate::{MapperState, Segment, Translate};
use common::BUS_LIMIT;

pub const PROFILE_ID: &str = "snes-hirom";
/// Un banco completo de 64KB: o tamaño mínimo é un banco enteiro.
pub const MIN_ROM_SIZE: u32 = 0x1_0000;
/// 4MB = alcance dunha área HiROM; 8MB require ExHiROM.
pub const MAX_ROM_SIZE: u32 = 0x40_0000;
/// Metade baixa con batería nos bancos `20-3F`/`A0-BF`.
const SRAM_START: u32 = 0x6000;
const SRAM_END: u32 = 0x7fff;
/// Tamaño da xanela de SRAM (máscara `0x1FFF`).
const SRAM_WINDOW: u32 = 0x2000;

fn rom(offset: u32) -> Translate {
    Translate::Rom { offset }
}

fn device(region: Region, offset: u32) -> Translate {
    Translate::Device { region, offset }
}

/// Só a metade alta destes bancos é ROM.
fn is_half_bank(bank: u32) -> bool {
    bank <= 0x3f || (0x80..=0xbf).contains(&bank)
}

/// Banco enteiro ROM (os bancos `7E`/`7F` están ocupados pola WRAM).
fn is_full_bank(bank: u32) -> bool {
    (0x40..=0x7d).contains(&bank) || bank >= 0xc0
}

/// `mapper_state = { rom_size }`, potencia de 2 en [64KB, 4MB]; **claves alleas
/// rexeítanse** (HiROM non ten rexistradores de mapper).
pub fn validate_state(state: &MapperState) -> Result<(), AddressingError> {
    rom_size(state).map(|_| ())
}

fn rom_size(state: &MapperState) -> Result<u32, AddressingError> {
    let size = common::only_rom_size(state, PROFILE_ID)?;
    common::require_pow2_in(size, MIN_ROM_SIZE, MAX_ROM_SIZE, PROFILE_ID)?;
    Ok(size)
}

/// `translate(cpu_address, mapper_state)`.
///
/// Orde da táboa da especificación: WRAM, ROM, SRAM (que gaña ao I/O na mesma
/// faixa), espello WRAM, I/O, reserva.
pub fn translate(cpu_address: u32, state: &MapperState) -> Translate {
    if cpu_address > BUS_LIMIT {
        return Translate::Invalid(common::bus_error(cpu_address, PROFILE_ID));
    }
    let size = match rom_size(state) {
        Ok(size) => size,
        Err(e) => return Translate::Invalid(e),
    };
    let mask = size - 1;
    let bank = common::bank_of(cpu_address);
    let a = common::low_of(cpu_address);

    if common::is_wram_bank(bank) {
        return device(Region::Wram, a);
    }
    if (is_half_bank(bank) && a >= HIGH_HALF) || is_full_bank(bank) {
        return rom(((bank << 16) + a) & mask);
    }
    if ((0x20..=0x3f).contains(&bank) || (0xa0..=0xbf).contains(&bank))
        && (SRAM_START..=SRAM_END).contains(&a)
    {
        return device(Region::Sram, a & (SRAM_WINDOW - 1));
    }
    if let Some((region, offset)) = common::system_region(bank, a) {
        return device(region, offset);
    }
    Translate::Invalid(common::err(
        crate::ErrorCode::Unsupported,
        format!(
            "banco {bank:#04x} ${a:#06x} en xanela reservada (3E/3F/BE/BF baixos: sen dispositivo na fonte bsnes)",
        ),
    ))
}

/// `invert(rom_offset, mapper_state)`: todos os enderezos cuxo `start + a`
/// mascarado dá o offset. Un banco de metade só captura a metade alta
/// (`rel ∈ [0x8000, 0x10000)`); un banco completo captura `rel < 0x10000`.
///
/// Fórmula **corrixida** (rev. 2026-09-25): a anterior tomaba `rel < 0x8000` e
/// sumaba `0x8000` ao alias, o que inventaba offsets `start + 0x8000 + rel`.
pub fn invert(rom_offset: u32, state: &MapperState) -> Result<Vec<u32>, AddressingError> {
    let size = rom_size(state)?;
    if rom_offset >= size {
        return Ok(Vec::new());
    }
    let mask = size - 1;
    let mut aliases = Vec::new();
    for bank in 0..=0xffu32 {
        let start = (bank << 16) & mask;
        // `rel` en aritmética modular da máscara: cubre tamén os bancos cuxo
        // `start` queda por riba do offset pedido.
        let rel = rom_offset.wrapping_sub(start) & mask;
        if is_half_bank(bank) && (HIGH_HALF..0x1_0000).contains(&rel) {
            aliases.push((bank << 16) + rel);
        }
        if is_full_bank(bank) && rel < 0x1_0000 {
            aliases.push((bank << 16) + rel);
        }
    }
    aliases.sort_unstable();
    Ok(aliases)
}

/// Bytes que seguen na **mesma** xanela ROM contigua desde `cursor`: os bancos
/// completos emendan no seguinte, a metade alta para no fim do banco, o grupo
/// `40-7D` na porta de WRAM e o grupo `C0-FF` no fim do barramento.
fn rom_window_left(cursor: u32) -> u64 {
    let bank = common::bank_of(cursor);
    if is_half_bank(bank) {
        return 0x1_0000 - u64::from(common::low_of(cursor));
    }
    if (0x40..=0x7d).contains(&bank) {
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
            crate::ErrorCode::OutOfRange,
            "length debe ser un enteiro >= 1",
        ));
    }
    let size = rom_size(state)?;
    // Rexeitado **antes** de calquera reserva proporcional á lonxitude.
    if u64::from(cpu_address) + length as u64 - 1 > u64::from(BUS_LIMIT) {
        return Err(common::err(
            crate::ErrorCode::OutOfRange,
            format!(
                "lectura de {length} bytes en {cpu_address:#x} ultrapasa o barramento de 24 bits",
            ),
        ));
    }

    let width = u64::from(size);
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
                // `offset` xa está mascarado por `translate`.
                let left_in_mirror = width - u64::from(offset);
                let run = usize::try_from(remaining.min(rom_window_left(addr)).min(left_in_mirror))
                    .expect("un corredor HiROM vale como máximo o barramento");
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
                        crate::ErrorCode::OutOfRange,
                        format!(
                            "ROM ({} bytes) máis curta que rom_size declarado ({size}); trecho faltante a partir do offset {offset:#x}",
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
