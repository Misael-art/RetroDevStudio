//! Compartido polos tres perfis SNES (barramento de 24 bits do 65816).
//!
//! Non hai aquí **ningunha** fórmula de mapeo ROM: esas viven en cada perfil
//! porque son distintas (LoROM é por páxina de 32KB, HiROM é lineal, ExHiROM ten
//! dúas áreas). O que si comparten é o barramento e a política de estado: os tres
//! son perfis **sen rexistradores de mapper**, así que `rom_size` é a única clave
//! lexítima e calquera outra rexeítase.

use crate::error::{AddressingError, ErrorCode};
use crate::state::MapperState;
use crate::Region;

/// Barramento de 24 bits do 65816.
pub(crate) const BUS_LIMIT: u32 = 0xffffff;
/// Metade alta de calquera banco: `$8000-$FFFF`.
pub(crate) const HIGH_HALF: u32 = 0x8000;
/// Primeira WRAM: bancos `7E`/`7F`.
pub(crate) const WRAM_BANK_START: u32 = 0x7e;
pub(crate) const WRAM_BANK_END: u32 = 0x7f;
/// Bancos baixos que levan o espello de WRAM e os rexistradores.
pub(crate) const SYSTEM_BANK_LOW_END: u32 = 0x3d;
pub(crate) const SYSTEM_BANK_HIGH_START: u32 = 0x80;
pub(crate) const SYSTEM_BANK_HIGH_END: u32 = 0xbd;
/// Fin do espello de 8KB da WRAM.
pub(crate) const WRAM_MIRROR_END: u32 = 0x1fff;
/// Fin da xanela de I/O classificada.
pub(crate) const IO_END: u32 = 0x7fff;

pub(crate) fn err(code: ErrorCode, detail: impl Into<String>) -> AddressingError {
    AddressingError::new(code, detail)
}

pub(crate) fn bank_of(cpu_address: u32) -> u32 {
    (cpu_address >> 16) & 0xff
}

pub(crate) fn low_of(cpu_address: u32) -> u32 {
    cpu_address & 0xffff
}

/// O banco 7E/7F é WRAM nos tres perfis, con `offset = a` (as tres
/// representacións fixadas din o mesmo: táboa da spec, referencia auditada e o
/// motor declarativo `OffsetRule::AIdentity`).
pub(crate) fn is_wram_bank(bank: u32) -> bool {
    (WRAM_BANK_START..=WRAM_BANK_END).contains(&bank)
}

/// Bancos que amosan o espello de WRAM (`a < 0x2000`) e I/O (`0x2000..=0x7FFF`).
pub(crate) fn is_system_bank(bank: u32) -> bool {
    bank <= SYSTEM_BANK_LOW_END || (SYSTEM_BANK_HIGH_START..=SYSTEM_BANK_HIGH_END).contains(&bank)
}

/// `rom_size` dos perfis SNES: a única clave que poden traer.
///
/// A diferenza de `md-linear` (que ignora o que non coñece), aquí unha clave
/// allea **é** un erro: aceptala sería fingir un estado de mapper que estes
/// cartuchos non teñen. Pinado por perfil nos seus tests de regras.
pub(crate) fn only_rom_size(state: &MapperState, profile: &str) -> Result<u32, AddressingError> {
    let extra: Vec<&str> = state
        .keys()
        .map(String::as_str)
        .filter(|k| *k != "rom_size")
        .collect();
    if !extra.is_empty() {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state con claves alleas a {profile}: {} (perfil sen estado de mapper)",
                extra.join(", ")
            ),
        ));
    }
    state.checked_rom_size(profile)
}

/// Potencia de 2 dentro do intervalo do perfil.
pub(crate) fn require_pow2_in(
    size: u32,
    min: u32,
    max: u32,
    profile: &str,
) -> Result<(), AddressingError> {
    if !(min..=max).contains(&size) {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {size:#x} fóra do intervalo [{:#x}, {:#x}] de {profile} (potencias de 2)",
                min, max
            ),
        ));
    }
    if !size.is_power_of_two() {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {size:#x} non é potencia de 2: normalize o arquivo (pad 0xFF ata a seguinte potencia) e rexistre a normalización na evidencia",
            ),
        ));
    }
    Ok(())
}

/// Enderezo fóra do barramento de 24 bits, antes de calquera outra comprobación.
pub(crate) fn bus_error(cpu_address: u32, profile: &str) -> AddressingError {
    err(
        ErrorCode::OutOfRange,
        format!(
            "enderezo {cpu_address:#x} excede o barramento de 24 bits do 65816 (máx {:#x}) no perfil {profile}",
            BUS_LIMIT
        ),
    )
}

/// Erro da xanela reservada: sen dispositivo nas fontes pinadas.
pub(crate) fn reserved_error(bank: u32, a: u32) -> AddressingError {
    err(
        ErrorCode::Unsupported,
        format!(
            "banco {bank:#04x} ${a:#06x} en xanela reservada (sen dispositivo nas fontes pinadas)",
        ),
    )
}

/// Rexións non-ROM dos bancos `00-3D`/`80-BD` (espello WRAM e I/O), e a reserva
/// para o resto. `Some` é sempre `Device`; `None` é xanela reservada.
pub(crate) fn system_region(bank: u32, a: u32) -> Option<(Region, u32)> {
    if !is_system_bank(bank) {
        return None;
    }
    if a <= WRAM_MIRROR_END {
        return Some((Region::WramMirror, a & 0x1fff));
    }
    if a <= IO_END {
        return Some((Region::Io, a));
    }
    None
}
