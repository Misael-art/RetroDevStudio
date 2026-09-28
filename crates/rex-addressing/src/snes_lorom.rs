//! Perfil `snes-lorom`: páxinas de 32KB na metade alta de cada banco.
//!
//! Especución en `docs/rex_profiles/addressing/snes-lorom.md`, derivada das
//! xanelas `LOROM`/`LOROM-RAM` de bsnes `7d5aa1e6…` e de `map_lorom` /
//! `Map_LoROMMap` de snes9x `1bcc369e…`. Ningunha liña transplantada: as dúas
//! licenzas (GPL-3.0 e Snes9x non comercial) prohíbeno; isto é reimplementación
//! da especificación.
//!
//! Fórmula ROM: `offset = ((banco & 0x7F) * 0x8000 + (a & 0x7FFF)) & (rom_size - 1)`.
//! Un mesmo offset ten **varios** aliases (A15 desconectado + espello por
//! tamaño), así que `invert` devolve a lista completa.

use crate::error::AddressingError;
use crate::region::Region;
use crate::snes_common::{self as common, HIGH_HALF};
use crate::{MapperState, Segment, Translate};
use common::BUS_LIMIT;

pub const PROFILE_ID: &str = "snes-lorom";
/// Página de ROM: metade alta de cada banco.
pub const PAGE_SIZE: u32 = 0x8000; // 32KB
pub const MIN_ROM_SIZE: u32 = 0x8000; // unha páxina
pub const MAX_ROM_SIZE: u32 = 0x40_0000; // 4MB = 128 páxinas; por riba é ExLoROM/outro perfil

fn rom(offset: u32) -> Translate {
    Translate::Rom { offset }
}

fn device(region: Region, offset: u32) -> Translate {
    Translate::Device { region, offset }
}

/// `mapper_state = { rom_size }`, potencia de 2 en [32KB, 4MB]; **claves alleas
/// rexeítanse** (LoROM non ten rexistradores de mapper).
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
/// A **orde** das clases é a da táboa da especificación: WRAM, ROM, SRAM,
/// espello WRAM, I/O, ambiguo A15, reserva. SRAM e espello gañan á reserva, e o
/// ambiguo só alcanza o que ningunha fonte pinada clasifica.
pub fn translate(cpu_address: u32, state: &MapperState) -> Translate {
    if cpu_address > BUS_LIMIT {
        return Translate::Invalid(common::bus_error(cpu_address, PROFILE_ID));
    }
    let size = match rom_size(state) {
        Ok(size) => size,
        Err(e) => return Translate::Invalid(e),
    };
    decode(cpu_address, size)
}

fn decode(cpu_address: u32, size: u32) -> Translate {
    let mask = size - 1;
    let bank = common::bank_of(cpu_address);
    let a = common::low_of(cpu_address);

    if common::is_wram_bank(bank) {
        return device(Region::Wram, a);
    }
    // ROM: `00-7d,80-ff:8000-ffff` (bsnes) / `(c & 0x7F) * 0x8000` (snes9x).
    if a >= HIGH_HALF && (bank <= 0x7d || bank >= 0x80) {
        return rom(((bank & 0x7f) * PAGE_SIZE + (a & 0x7fff)) & mask);
    }
    // SRAM: `70-7d,f0-ff:0000-7fff` (bsnes LOROM-RAM).
    if ((0x70..=0x7d).contains(&bank) || (0xf0..=0xff).contains(&bank)) && a < HIGH_HALF {
        return device(Region::Sram, a & 0x7fff);
    }
    if let Some((region, offset)) = common::system_region(bank, a) {
        return device(region, offset);
    }
    // SRAM e espello WRAM xa se resolven arriba; o resto da metade baixa dos
    // bancos `40-7D`/`C0-FF` é a discordancia A15: snes9x `Map_LoROMMap` ve ROM
    // aliás, bsnes deixa open bus. Sen base primaria para escoller.
    if (0x40..=0x7d).contains(&bank) || bank >= 0xc0 {
        return Translate::Invalid(common::err(
            crate::ErrorCode::Ambiguous,
            format!(
                "banco {bank:#04x} ${a:#06x} con A15 desconectado: as fontes diverxen (snes9x ROM aliás vs bsnes open bus); \
                 o cartucho real decide, o perfil non palpita",
            ),
        ));
    }
    Translate::Invalid(common::reserved_error(bank, a))
}

/// `invert(rom_offset, mapper_state)`: **todos** os enderezos da xanela ROM cuyo
/// offset mascarado coincide — a páxina `p` e o seu aliás `p | 0x80`, máis as
/// páxinas equivalentes polo espello. Os bancos `7E`/`7F` nunca son alias.
pub fn invert(rom_offset: u32, state: &MapperState) -> Result<Vec<u32>, AddressingError> {
    let size = rom_size(state)?;
    if rom_offset >= size {
        return Ok(Vec::new());
    }
    let mask = size - 1;
    let mut aliases = Vec::new();
    for page in 0..0x80u32 {
        // Desprazamento dentro da páxina: `rom_offset - page*32KB` en aritmética
        // modular da máscara (a `wrapping_sub` non desborda porque
        // `mask + 1` divide 2^32).
        let intra = rom_offset.wrapping_sub(page * PAGE_SIZE) & mask;
        if intra >= PAGE_SIZE {
            continue;
        }
        let offset_in_bank = HIGH_HALF + intra;
        // O banco `page` só é ROM se non é WRAM (`7E`/`7F` están ocupados).
        if page <= 0x7d {
            aliases.push((page << 16) | offset_in_bank);
        }
        aliases.push(((page | 0x80) << 16) | offset_in_bank);
    }
    aliases.sort_unstable();
    Ok(aliases)
}

/// `read(cpu_address, length, mapper_state, rom)`.
///
/// En LoROM **ningunha** lectura ROM emenda na páxina seguinte: o byte despois
/// de `$xxxxFFFF` é a metade baixa do banco veciño (espello WRAM, I/O, SRAM ou
/// ambiguo). Todo corredor vale como máximo 32KB.
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
    let width = u64::from(size);
    // Rexeitado **antes** de calquera reserva proporcional á lonxitude.
    if u64::from(cpu_address) + length as u64 - 1 > u64::from(BUS_LIMIT) {
        return Err(common::err(
            crate::ErrorCode::OutOfRange,
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
                let left_in_bank = 0x1_0000 - (cursor & 0xffff);
                let left_in_mirror = width - u64::from(offset % size);
                let run = usize::try_from(remaining.min(left_in_bank).min(left_in_mirror))
                    .expect("un corredor LoROM vale como máximo 32KB");
                debug_assert!(
                    run >= 1,
                    "corredor baleiro: a fórmula de offset e a anchura do espeillo non son consistentes"
                );
                let start = offset as usize;
                if start + run > rom.len() {
                    // Imaxe máis curta que `rom_size`: prefixo real + erro, sen
                    // clamp e sen bytes inventados.
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
