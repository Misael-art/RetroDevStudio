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
//!
//! # Uso
//!
//! O estado do mapper é un [`MapperState`] (mapa ordenado de claves escalares),
//! nunca un campo dun enderezo. Nin o tamaño nin o banner deciden o perfil:
//! quen elixe `md_linear` ou `snes_hirom` é o chamador.
//!
//! ```
//! use rex_addressing::{md_linear, ErrorCode, MapperState, Translate};
//!
//! let state = MapperState::rom_size(0x80_000);
//! assert_eq!(
//!     md_linear::translate(0x00_0100, &state),
//!     Translate::Rom { offset: 0x00_0100 }
//! );
//!
//! // Fóra do barramento de 24 bits non hai offset, hai erro.
//! match md_linear::translate(0x0100_0000, &state) {
//!     Translate::Invalid(e) => assert_eq!(e.code, ErrorCode::OutOfRange),
//!     other => panic!("esperábase Invalid, atopado {other:?}"),
//! }
//!
//! // Un estado imposible tamén é erro estruturado, non Rom { offset: 0 }.
//! assert!(matches!(
//!     md_linear::translate(0x00_0100, &MapperState::empty()),
//!     Translate::Invalid(_)
//! ));
//! ```
//!
//! ## Inversión: lista de aliases, non un enderezo canónico
//!
//! ```
//! use rex_addressing::{snes_lorom, MapperState, Translate};
//!
//! let state = MapperState::rom_size(0x10_0000);
//! let aliases = snes_lorom::invert(0x01_2340, &state).expect("offset dentro da imaxe");
//! assert!(!aliases.is_empty(), "un offset real ten cando menos un alias");
//! for addr in &aliases {
//!     assert_eq!(
//!         snes_lorom::translate(*addr, &state),
//!         Translate::Rom { offset: 0x01_2340 },
//!         "todo alias debe retraducirse ao offset pedido"
//!     );
//! }
//! ```
//!
//! ## Lecturas: un segmento por corrida continua de offset
//!
//! ```
//! use rex_addressing::{snes_hirom, MapperState, Segment};
//!
//! let state = MapperState::rom_size(0x10_0000);
//! let rom = vec![0xABu8; 0x10_0000];
//! // `$00FFF0` si é ROM (metade alta do banco 00); 16 bytes máis aló o
//! // banco 01 comeza na metade baixa, que en HiROM non é ROM.
//! let segs = snes_hirom::read(0x00_fff0, 0x20, &state, &rom).expect("lectura");
//! assert_eq!(segs.len(), 2, "a lectura córtase onde cambia o mapa: {segs:?}");
//! let Segment::Bytes { offset, bytes, .. } = &segs[0] else {
//!     panic!("esperábase Bytes, atopado {:?}", segs[0]);
//! };
//! assert_eq!((*offset, bytes.len()), (0x00_fff0, 16));
//! assert!(
//!     matches!(&segs[1], Segment::DeviceNoBacking { .. }),
//!     "sen backing non se inventan bytes: {:?}",
//!     segs[1]
//! );
//! ```
//!
//! SSF2 engade o estado de bancos e as escritas puras do rexistrador, que
//! **devolvern un estado novo** no canto de mutar o recibido — é o que permite
//! comparar antes/despois na evidencia:
//!
//! ```
//! use rex_addressing::{md_ssf2, MapperState, Translate};
//!
//! let antes = MapperState::ssf2(0x40_0000, &[]);
//! let copia = antes.clone();
//! let despois = md_ssf2::write_mapper_register(0x00_a130_03, 5, &antes).expect("escrita");
//! assert_eq!(
//!     antes, copia,
//!     "a escrita devolve un estado novo, non muta o recibido"
//! );
//! assert_eq!(
//!     md_ssf2::translate(0x00_08_0000, &antes),
//!     Translate::Rom { offset: 0x00_08_0000 },
//!     "o estado anterior segue na identidade"
//! );
//! // `$A13003` remapea a xanela 1: `0x080000` xa non é o banco 1.
//! assert_eq!(
//!     md_ssf2::translate(0x00_08_0000, &despois),
//!     Translate::Rom { offset: 0x28_0000 }
//! );
//! ```
//!
//! Os comandos de validación (vectores pinados, referencia independente,
//! barrido exaustivo e BYOR) están en `README.md`; os límites formais, en
//! `docs/rex_profiles/addressing_runtime/CONTRATO.md`.

pub mod error;
mod md_common;
pub mod md_linear;
pub mod md_ssf2;
pub mod region;
mod snes_common;
pub mod snes_exhirom;
pub mod snes_hirom;
pub mod snes_lorom;
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
