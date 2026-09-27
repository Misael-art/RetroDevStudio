//! Biblioteca de enderezamento de ROMs do REX (MD lineal, MD SSF2, SNES
//! LoROM/HiROM/ExHiROM): tradución, inversión con aliases, lecturas
//! segmentadas e erros estruturados.
//!
//! **Experimental.** Non afirma soporte a xogo ningún: non detecta mapas,
//! non deduce perfil por tamaño nin por banner, non modela chips especiais
//! (DSP/SA1/SuperFX/CX4/SVP), non decodifica codecs e non ten UI. O contrato
//! completo está en `docs/rex_profiles/addressing_runtime/CONTRATO.md`.
//!
//! Unha tradución devolve sempre **unha de tres clases**: offset de arquivo
//! dentro da ROM, rexión non-ROM coñecida (sen bytes), ou entrada inválida.
//! Non existe o "offset 0 como sinal de erro".

pub mod error;
mod md_common;
pub mod md_linear;
pub mod md_ssf2;
pub mod region;
pub mod state;

pub use error::{AddressingError, ErrorCode};
pub use region::Region;
pub use state::{MapperState, Value};

/// Resultado de `translate` (contrato §4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Translate {
    /// ROM mapeada: `offset` é un desprazamento dentro do dispositivo.
    Rom { offset: u32 },
    /// Rexión non-ROM coñecida; `offset` é interno desa rexión.
    Device { region: Region, offset: u32 },
    /// Entrada inválida: sen offset, porque un erro convertido en `0` é a
    /// peor clase de bug que pode ter un enderezador.
    Invalid(AddressingError),
}

impl Translate {
    pub fn invalid(code: ErrorCode, detail: impl Into<String>) -> Translate {
        Translate::Invalid(AddressingError::new(code, detail))
    }
}

/// Segmento dunha lectura (contrato §7): un corredor continuo de offset, non
/// un byte.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Segment {
    /// Bytes da imaxe ROM, dende `offset`.
    Bytes {
        region: Region,
        offset: u32,
        bytes: Vec<u8>,
    },
    /// Rexión coñecida sen backing ROM: clasifícase, non se inventan bytes.
    DeviceNoBacking {
        region: Region,
        offset: u32,
        error_code: ErrorCode,
    },
    /// Truncamento explícito (área sen dispositivo, ROM curta, fin do
    /// barramento). A implementación nunca clampa en silencio.
    Invalid(AddressingError),
}
