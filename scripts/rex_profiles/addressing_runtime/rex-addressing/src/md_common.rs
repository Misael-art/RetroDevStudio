//! Mapa de E/S do Mega Drive, compartido polos dous perfis de Genesis/Mega
//! Drive.
//!
//! Non é un "mapper xenerico": é o mesmo chip de E/S do 68K, descrito unha soa
//! vez. O que si difire entre `md_linear` e `md_ssf2` é a xanela do cartucho
//! (`$000000-$3FFFFF`), e esa aritmética vive en cada perfil.
//!
//! Preconditions: `addr <= crate::BUS_LIMIT` e `addr > CART_WINDOW_END` (a
//! xanela do cartucho decódaa o perfil).

use crate::error::ErrorCode;
use crate::{Region, Translate};

/// Barramento de 24 bits do 68000.
pub(crate) const BUS_LIMIT: u32 = 0xFFFFFF;
/// Último enderezo da xanela do cartucho (4MB de espazo, mapper ou non).
pub(crate) const CART_WINDOW_END: u32 = 0x3FFFFF;

pub(crate) const Z80_START: u32 = 0xA00000;
pub(crate) const Z80_END: u32 = 0xA0FFFF;
pub(crate) const IO_START: u32 = 0xA10000;
pub(crate) const IO_END: u32 = 0xA1FFFF;
/// Páxina TIME rotada ao cartucho: aí viven os rexistradores do mapper SSF2.
pub(crate) const REG_PAGE_START: u32 = 0xA13000;
pub(crate) const REG_PAGE_END: u32 = 0xA130FF;
pub(crate) const VDP_START: u32 = 0xC00000;
pub(crate) const WORK_RAM_START: u32 = 0xE00000;

pub(crate) fn device_or_invalid(addr: u32, profile: &str) -> Translate {
    if (Z80_START..=Z80_END).contains(&addr) {
        // Bits 13-14 do enderezo: 0/1 = RAM do Z80, 2/3 = bus de son.
        let sub = (addr >> 13) & 3;
        if sub == 0 || sub == 1 {
            return Translate::Device {
                region: Region::Z80Ram,
                offset: addr & 0x1FFF,
            };
        }
        return Translate::invalid(
            ErrorCode::Unsupported,
            format!(
                "bus de son do Z80 ({}) fóra do contrato",
                if sub == 2 { "YM2612" } else { "misc/VDP" }
            ),
        );
    }
    if (IO_START..=IO_END).contains(&addr) {
        if (REG_PAGE_START..=REG_PAGE_END).contains(&addr) {
            return Translate::Device {
                region: Region::CartIo,
                offset: addr - REG_PAGE_START,
            };
        }
        return Translate::Device {
            region: Region::Io,
            offset: addr - IO_START,
        };
    }
    if addr >= WORK_RAM_START {
        return Translate::Device {
            region: Region::WorkRam,
            offset: addr & 0xFFFF,
        };
    }
    if addr >= VDP_START {
        return Translate::invalid(
            ErrorCode::Unsupported,
            "portas do VDP ($C00000-$DFFFFF) fóra do contrato",
        );
    }
    Translate::invalid(
        ErrorCode::Unsupported,
        format!(
            "xanela sen dispositivo mapeado no perfil {profile} (open bus / reservado / lockup)"
        ),
    )
}
