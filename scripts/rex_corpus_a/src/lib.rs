//! Ferramentas da MISSAO A — recursos reais, enderezamento e Kosinski.
//!
//! Unhas cantas superficies, todas puras e sen dependencias externas:
//! - [`mdheader`]: cabeco de cartucho Mega Drive (layout fixado en SGDK).
//! - [`container`]: indice ZIP lido sen descomprimir (normalizacion acoutada).
//! - [`scan`] / [`consumer`]: candidatos Kosinski e evidencia estrutural na ROM.
//! - [`magia`]: contaxe de marcadores de fluxo (unha medida, non un diagnostico).
//! - [`spec`]: o que a referencia *declara* de cada vector negativo (a razón,
//!   non só o rexeito).
//! - [`evidence`]: a gramática das cadeas de evidencia de consumidor
//!   (`rex-corpus-evidence/v1`), o único xeito de fabricar ou ler unha.
//! - [`perfil`]: o perfil reutilizable `rex-corpus-perfil/v1` — os bytes
//!   fixados por SHA-256, a orientación medida e os límites do sondeo.
//! - [`resource`]: o rexistro versionado `rex-corpus-resource/v1` e o seu JSON.
//!
//! Nada disto escribe ROMs nin bytes comerciais: as saidas son hashes, offsets
//! e lonxitudes.

pub mod consumer;
pub mod container;
pub mod evidence;
pub mod inventory;
pub mod json;
pub mod layout;
pub mod magia;
pub mod mdheader;
pub mod perfil;
pub mod resource;
pub mod scan;
pub mod spec;

pub use container::{ContainerError, ZipIndex, ZipMember};
pub use inventory::{Check, Item, Provenance};
pub use layout::Layout;
pub use mdheader::{ChecksumStatus, MdHeader};
pub use perfil::Perfil;
pub use resource::{Confidence, ResourceRecord};
pub use scan::{Candidate, ScanLimits, ScanReport};
