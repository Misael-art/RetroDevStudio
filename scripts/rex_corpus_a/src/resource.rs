//! O rexistro versionado `rex-corpus-resource/v1`.
//!
//! Cada recurso declarado leva os campos que pide a mision. Un campo que non se
//! puido medir renderizase como `not_measured`, nunca como unha estimacion.

use crate::json::Value;

pub const SCHEMA_VERSION: &str = "rex-corpus-resource/v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Confidence {
    /// Decodifica limpo pero non ten evidencia de consumidor.
    Candidato,
    /// Ligazon estrutural medida nesta ROM (tabela + referencia + paridade).
    ConfirmadoEstaticamente,
    /// Require execucion: non se alega nesta mision.
    ObservadoEnRuntime,
}

impl Confidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Confidence::Candidato => "candidato",
            Confidence::ConfirmadoEstaticamente => "confirmado-estaticamente",
            Confidence::ObservadoEnRuntime => "observado-en-runtime",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceRecord {
    pub rom_sha256: String,
    pub normalized_sha256: String,
    pub profile_id: String,
    pub offset: Option<u64>,
    pub input_span: Option<u64>,
    pub codec: String,
    pub variant: String,
    pub bytes_consumed: Option<u64>,
    pub output_size: Option<u64>,
    pub output_sha256: Option<String>,
    pub consumer_evidence: Vec<String>,
    pub confidence: Confidence,
    pub limitations: Vec<String>,
    pub mapper_profile: Option<String>,
    pub mapper_state: Option<String>,
}

impl ResourceRecord {
    pub fn to_json(&self) -> Value {
        todo!()
    }
}
