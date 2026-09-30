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

fn medido(v: Option<u64>) -> Value {
    match v {
        Some(n) => Value::Int(n as i64),
        None => Value::not_measured(),
    }
}

fn texto(v: Option<&str>) -> Value {
    match v {
        Some(s) => Value::Str(s.to_string()),
        None => Value::not_measured(),
    }
}

fn lista(v: &[String]) -> Value {
    Value::List(v.iter().map(|s| Value::Str(s.clone())).collect())
}

impl ResourceRecord {
    pub fn to_json(&self) -> Value {
        Value::Object(vec![
            ("schema_version".into(), Value::Str(SCHEMA_VERSION.into())),
            ("rom_sha256".into(), Value::Str(self.rom_sha256.clone())),
            (
                "imaxe_normalizada_sha256".into(),
                Value::Str(self.normalized_sha256.clone()),
            ),
            ("perfil".into(), Value::Str(self.profile_id.clone())),
            ("offset".into(), medido(self.offset)),
            ("tramo_entrada".into(), medido(self.input_span)),
            ("codec".into(), Value::Str(self.codec.clone())),
            ("variante".into(), Value::Str(self.variant.clone())),
            ("bytes_consumidos".into(), medido(self.bytes_consumed)),
            ("saida_bytes".into(), medido(self.output_size)),
            (
                "saida_sha256".into(),
                match &self.output_sha256 {
                    Some(s) => Value::Str(s.clone()),
                    None => Value::not_measured(),
                },
            ),
            (
                "evidencia_consumidor".into(),
                lista(&self.consumer_evidence),
            ),
            (
                "confianza".into(),
                Value::Str(self.confidence.as_str().to_string()),
            ),
            ("limitacions".into(), lista(&self.limitations)),
            (
                "perfil_mapper".into(),
                texto(self.mapper_profile.as_deref()),
            ),
            ("estado_mapper".into(), texto(self.mapper_state.as_deref())),
        ])
    }
}
