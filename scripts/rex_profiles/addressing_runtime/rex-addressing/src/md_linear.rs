//! Perfil `md-linear`: cartucho de Mega Drive sen mapper.
//!
//! Especución documentada en `docs/rex_profiles/addressing/md-linear.md`
//! (derivada de Genesis-Plus-GX `939ce4f0…`, sin transplante de código).
//!
//! A xanela do cartucho (`$000000-$3FFFFF`) espéllase por máscara:
//! `offset = addr & (rom_size - 1)`. Por iso un offset ten **varios** aliases e
//! `invert` devolve a lista completa, non un "enderezo canónico" inventado.

use crate::error::{AddressingError, ErrorCode};
use crate::{MapperState, Region, Segment, Translate};

pub const PROFILE_ID: &str = "md-linear";
/// Barramento de 24 bits do 68000.
pub const BUS_LIMIT: u32 = 0xFFFFFF;
/// Último enderezo da xanela do cartucho.
pub const CART_WINDOW_END: u32 = 0x3FFFFF;
pub const MIN_ROM_SIZE: u32 = 0x10000; // 64KB
pub const MAX_ROM_SIZE: u32 = 0x400000; // 4MB: por riba precisa mapper

/// Bus do Z80 a través do chip de E/S (RAM do chip de son + bus de son).
const Z80_START: u32 = 0xA00000;
const Z80_END: u32 = 0xA0FFFF;
/// Chip de E/S do 68K.
const IO_START: u32 = 0xA10000;
const IO_END: u32 = 0xA1FFFF;
/// Páxina TIME roteada ao cartucho: rexistradores do mapper nos perfis con bancos.
const REG_PAGE_START: u32 = 0xA13000;
const REG_PAGE_END: u32 = 0xA130FF;
const VDP_START: u32 = 0xC00000;
const WORK_RAM_START: u32 = 0xE00000;

fn err(code: ErrorCode, detail: impl Into<String>) -> AddressingError {
    AddressingError::new(code, detail)
}

/// Valida `mapper_state = { rom_size }`.
///
/// Claves alleas **ignóranse**, igual que na referencia auditada da rodada 1-2:
/// `md-linear` non ten estado de mapper, así que non hai nada que interpretar.
/// Os perfis con bancos (`md-ssf2`) e os SNES si as rexeitan — alí a clave si
/// ten semántica. Pinado en `tests/md_linear_rules.rs`.
pub fn validate_state(state: &MapperState) -> Result<(), AddressingError> {
    let size = state.checked_rom_size(PROFILE_ID)?;
    if !((MIN_ROM_SIZE..=MAX_ROM_SIZE).contains(&size)) {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {:#x} fóra do intervalo [{:#x}, {:#x}] (potencias de 2; por riba de 4MB exige mapper como SSF2)",
                size, MIN_ROM_SIZE, MAX_ROM_SIZE
            ),
        ));
    }
    if !size.is_power_of_two() {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {:#x} non é potencia de 2: normalize o arquivo (pad 0xFF ata a seguinte potencia) e rexistre a normalización na evidencia",
                size
            ),
        ));
    }
    Ok(())
}

/// `translate(cpu_address, mapper_state)` — as tres clases do contrato §4.
pub fn translate(cpu_address: u32, state: &MapperState) -> Translate {
    // A orde importa: un enderezo fóra do barramento erroa antes do estado,
    // como na referencia auditada (os vectores pinan eses códigos).
    if cpu_address > BUS_LIMIT {
        return Translate::Invalid(err(
            ErrorCode::OutOfRange,
            format!(
                "enderezo {:#x} excede o barramento de 24 bits do 68000 (máx {:#x})",
                cpu_address, BUS_LIMIT
            ),
        ));
    }
    let Err(e) = validate_state(state) else {
        let size = state
            .checked_rom_size(PROFILE_ID)
            .expect("validate_state xa aceptou o tamaño");
        return decode(cpu_address, size);
    };
    Translate::Invalid(e)
}

fn decode(cpu_address: u32, size: u32) -> Translate {
    let mask = size - 1;
    if cpu_address <= CART_WINDOW_END {
        return Translate::Rom {
            offset: cpu_address & mask,
        };
    }
    if (Z80_START..=Z80_END).contains(&cpu_address) {
        // Bits 13-14 do enderezo: 0/1 = RAM do Z80, 2/3 = bus de son.
        let sub = (cpu_address >> 13) & 3;
        if sub == 0 || sub == 1 {
            return Translate::Device {
                region: Region::Z80Ram,
                offset: cpu_address & 0x1FFF,
            };
        }
        return Translate::Invalid(err(
            ErrorCode::Unsupported,
            format!(
                "bus de son do Z80 ({}) fóra do contrato",
                if sub == 2 { "YM2612" } else { "misc/VDP" }
            ),
        ));
    }
    if (IO_START..=IO_END).contains(&cpu_address) {
        if (REG_PAGE_START..=REG_PAGE_END).contains(&cpu_address) {
            // Páxina TIME: neste perfil as escritas non teñen efecto.
            return Translate::Device {
                region: Region::CartIo,
                offset: cpu_address - REG_PAGE_START,
            };
        }
        return Translate::Device {
            region: Region::Io,
            offset: cpu_address - IO_START,
        };
    }
    if cpu_address >= WORK_RAM_START {
        return Translate::Device {
            region: Region::WorkRam,
            offset: cpu_address & 0xFFFF,
        };
    }
    if cpu_address >= VDP_START {
        return Translate::Invalid(err(
            ErrorCode::Unsupported,
            "portas do VDP ($C00000-$DFFFFF) fóra do contrato",
        ));
    }
    Translate::Invalid(err(
        ErrorCode::Unsupported,
        "xanela sen dispositivo mapeado no perfil md-linear (open bus / reservado / lockup)",
    ))
}

/// `invert(rom_offset, mapper_state)` — **todos** os aliases do barramento, en
/// orde crecente. Un offset inexistente é unha lista baleira, non un erro.
pub fn invert(rom_offset: u32, state: &MapperState) -> Result<Vec<u32>, AddressingError> {
    validate_state(state)?;
    let size = state
        .checked_rom_size(PROFILE_ID)
        .expect("validate_state xa aceptou o tamaño");
    if rom_offset >= size {
        return Ok(Vec::new());
    }
    let mut aliases = Vec::new();
    let mut addr = rom_offset;
    while addr <= CART_WINDOW_END {
        aliases.push(addr);
        addr = match addr.checked_add(size) {
            Some(next) => next,
            None => break,
        };
    }
    Ok(aliases)
}

/// `read(cpu_address, length, mapper_state, rom)` — corredores continuos de
/// offset, cortados no borde do espello e no fin da xanela do cartucho.
///
/// Valídase **antes** de calquera reserva: `length` non dimensiona o bucle, si
/// non a distancia real ata a fronteira da rexión.
pub fn read(
    cpu_address: u32,
    length: u32,
    state: &MapperState,
    rom: &[u8],
) -> Result<Vec<Segment>, AddressingError> {
    if cpu_address > BUS_LIMIT {
        return Err(err(
            ErrorCode::OutOfRange,
            format!(
                "enderezo {:#x} excede o barramento de 24 bits do 68000",
                cpu_address
            ),
        ));
    }
    if length < 1 {
        return Err(err(
            ErrorCode::OutOfRange,
            "length debe ser un enteiro >= 1",
        ));
    }
    validate_state(state)?;
    let size = state
        .checked_rom_size(PROFILE_ID)
        .expect("validate_state xa aceptou o tamaño");
    let width = u64::from(size);

    let mut segments: Vec<Segment> = Vec::new();
    let mut cursor = u64::from(cpu_address);
    let end = u64::from(cpu_address) + length as u64; // exclusivo
    while cursor < end {
        let Ok(addr) = u32::try_from(cursor) else {
            segments.push(Segment::Invalid(err(
                ErrorCode::OutOfRange,
                "a lectura xa superou o barramento de 24 bits",
            )));
            break;
        };
        match translate(addr, state) {
            Translate::Invalid(e) => {
                segments.push(Segment::Invalid(e));
                break;
            }
            Translate::Device { region, offset } => {
                // Rexión coñecida sen backing ROM: un segmento clasificatorio.
                segments.push(Segment::DeviceNoBacking {
                    region,
                    offset,
                    error_code: ErrorCode::Unsupported,
                });
                break;
            }
            Translate::Rom { offset } => {
                let left_in_mirror = width - u64::from(offset % size);
                let left_in_window = u64::from(CART_WINDOW_END - addr) + 1;
                let run = usize::try_from((end - cursor).min(left_in_mirror).min(left_in_window))
                    .expect("un corredor non pode superar a xanela de 4MB");
                let start = offset as usize;
                if start + run > rom.len() {
                    // Imaxe máis curta que `rom_size`: o faltante é erro, sen
                    // clamp e sen bytes inventados.
                    let available = rom.len() - start;
                    if available > 0 {
                        segments.push(Segment::Bytes {
                            region: Region::Rom,
                            offset,
                            bytes: rom[start..].to_vec(),
                        });
                    }
                    segments.push(Segment::Invalid(err(
                        ErrorCode::OutOfRange,
                        format!(
                            "ROM ({} bytes) máis curta que rom_size declarado ({size}); trecho faltante a partir do offset {:#x}",                            rom.len(),
                            offset
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
