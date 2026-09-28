//! clases de rexión do contrato.
//!
//! `Rom` é a única con *offset de arquivo* válido. As demais clasifícanse co
//! seu offset interno e **non** teñen backing nesta biblioteca: inventar bytes
//! de WRAM/SRAM/IO sería peor que dicir que non os hai.

use crate::error::{AddressingError, ErrorCode};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Region {
    Rom,
    /// Bus do Z80 (68K `$A00000-$A01FFF`): RAM do chip de son.
    Z80Ram,
    /// Chip de E/S do 68K (`$A10000-$A1FFFF`).
    Io,
    /// Páxina TIME rotada ao cartucho (`$A13000-$A130FF`): rexistradores do
    /// mapper SSF2.
    CartIo,
    /// Work RAM do 68K (`$E00000+`).
    WorkRam,
    /// WRAM do SNES (bancos `7E/7F`).
    Wram,
    /// Espello de 8KB da WRAM nos bancos baixos.
    WramMirror,
    /// SRAM/batería. O tamaño real e a batería están fóra do contrato.
    Sram,
}

impl Region {
    pub fn as_str(self) -> &'static str {
        match self {
            Region::Rom => "rom",
            Region::Z80Ram => "z80-ram",
            Region::Io => "io",
            Region::CartIo => "cart-io",
            Region::WorkRam => "work-ram",
            Region::Wram => "wram",
            Region::WramMirror => "wram-mirror",
            Region::Sram => "sram",
        }
    }

    /// rexión non-ROM: o perfil clasifícaa pero non lle dá bytes.
    pub fn no_backing(self) -> AddressingError {
        AddressingError::new(
            ErrorCode::Unsupported,
            format!("rexión {} sen backing ROM no contrato", self.as_str()),
        )
    }
}

impl std::fmt::Display for Region {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
