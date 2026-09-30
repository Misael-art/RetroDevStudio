//! Ferramentas da MISSAO A — recursos reais, enderezamento e Kosinski.
//!
//! Catro superficies, todas puras e sen dependencias externas:
//! - [`mdheader`]: cabeco de cartucho Mega Drive (layout fixado en SGDK).
//! - [`container`]: indice ZIP lido sen descomprimir (normalizacion acoutada).
//! - [`scan`] / [`consumer`]: candidatos Kosinski e evidencia estrutural na ROM.
//! - [`magia`]: contaxe de marcadores de fluxo (unha medida, non un diagnostico).
//! - [`resource`]: o rexistro versionado `rex-corpus-resource/v1` e o seu JSON.
//!
//! Nada disto escribe ROMs nin bytes comerciais: as saidas son hashes, offsets
//! e lonxitudes.

pub mod consumer;
pub mod container;
pub mod inventory;
pub mod json;
pub mod layout;
pub mod magia;
pub mod mdheader;
pub mod resource;
pub mod scan;

pub use container::{ContainerError, ZipIndex, ZipMember};
pub use inventory::{Check, Item, Provenance};
pub use layout::Layout;
pub use mdheader::{ChecksumStatus, MdHeader};
pub use resource::{Confidence, ResourceRecord};
pub use scan::{Candidate, ScanLimits, ScanReport};
