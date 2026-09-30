//! Detección do layout dunha imaxe Mega Drive.
//!
//! Non se deduce do nome do arquivo nin da extensión: só do que hai nos bytes.
//! Unha imaxe lineal é a única cuxa dirección de procesador se pode traducir a
//! desprazamento co perfil MD lineal de `rex-addressing`; calquera outra coisa
//! ha de ser rexeitada antes de intentar enderezar.

/// Lonxitude do cabeco ASCII que precede os bancos nunha imaxe SMD clásica.
const SMD_HEADER_LEN: usize = 0x200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    /// Cabeco de cartucho en 0x100 e vectors 68000 en 0x000: dirección CPU ==
    /// desprazamento na imaxe, polo que a tradución do perfil MD lineal é válida.
    Lineal,
    /// Cabeco ASCII SMD en 0x000 seguido de bancos de 64 KiB alternos:Require
    /// desentrelazamento antes de traducir direccións.
    InterlazadoSmd { header_len: usize },
    /// Ningún dos dous patróns aparece: non se pode afirmar nada.
    NonIdentificado,
}

pub fn detect(bytes: &[u8]) -> Layout {
    if bytes.starts_with(b"SEGA ") {
        return Layout::InterlazadoSmd {
            header_len: SMD_HEADER_LEN,
        };
    }
    if bytes.len() >= 0x105 && bytes[0x100..0x105] == *b"SEGA " {
        return Layout::Lineal;
    }
    Layout::NonIdentificado
}
