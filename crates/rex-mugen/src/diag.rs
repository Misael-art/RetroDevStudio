//! Esquema de diagnostico, metrica e proveniencia (`rex-mugen/diag/v1`).
//!
//! Regras do esquema:
//! * dado indisponivel e `value: None` com `availability` explicando o motivo — nunca zero;
//! * toda metrica declara unidade, origem (A estatica, B instrumentacao na ROM, C core,
//!   D aplicativo hospedeiro) e janela de medicao;
//! * estimativa estatica nunca e apresentada como medida de hardware.

pub const SCHEMA: &str = "rex-mugen/diag/v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warning => "warning",
            Severity::Error => "error",
        }
    }
}

/// Classificacao de fidelidade de um recurso ou comportamento convertido.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fidelity {
    /// Mesmo significado no alvo.
    Direct,
    /// Significado preservado com diferenca conhecida e declarada.
    Approximate,
    /// Precisa de acao humana para funcionar.
    Manual,
    /// Nao convertido; o efeito original se perde.
    Unsupported,
}

impl Fidelity {
    pub fn as_str(self) -> &'static str {
        match self {
            Fidelity::Direct => "direct",
            Fidelity::Approximate => "approximate",
            Fidelity::Manual => "manual",
            Fidelity::Unsupported => "unsupported",
        }
    }
}

/// Localizacao na origem: arquivo relativo ao pacote e linha (texto) ou offset (binario).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SourceLoc {
    pub file: String,
    pub line: Option<u32>,
    pub offset: Option<u64>,
}

impl SourceLoc {
    pub fn line(file: &str, line: u32) -> SourceLoc {
        SourceLoc {
            file: file.to_string(),
            line: Some(line),
            offset: None,
        }
    }

    pub fn offset(file: &str, offset: u64) -> SourceLoc {
        SourceLoc {
            file: file.to_string(),
            line: None,
            offset: Some(offset),
        }
    }

    pub fn file(file: &str) -> SourceLoc {
        SourceLoc {
            file: file.to_string(),
            line: None,
            offset: None,
        }
    }

    pub fn render(&self) -> String {
        match (self.line, self.offset) {
            (Some(l), _) => format!("{}:{l}", self.file),
            (None, Some(o)) => format!("{}@0x{o:X}", self.file),
            _ => self.file.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// Codigo estavel, ex.: `air.duration.infinite_not_last`.
    pub code: &'static str,
    pub severity: Severity,
    pub source: SourceLoc,
    pub message: String,
    /// Acao compreensivel para o usuario.
    pub action: String,
}

impl Diagnostic {
    pub fn new(
        code: &'static str,
        severity: Severity,
        source: SourceLoc,
        message: impl Into<String>,
        action: impl Into<String>,
    ) -> Diagnostic {
        Diagnostic {
            code,
            severity,
            source,
            message: message.into(),
            action: action.into(),
        }
    }
}

/// Origem de uma metrica (separacao A/B/C/D).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricOrigin {
    /// A: analise estatica de recursos e orcamento (estimativa, nao hardware).
    Static,
    /// B: instrumentacao inserida na ROM autoral (custo declarado).
    RomInstrumentation,
    /// C: observacao pelo core/emulador.
    Core,
    /// D: metricas do aplicativo hospedeiro.
    Host,
}

impl MetricOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            MetricOrigin::Static => "A_static_estimate",
            MetricOrigin::RomInstrumentation => "B_rom_instrumentation",
            MetricOrigin::Core => "C_core_observation",
            MetricOrigin::Host => "D_host_app",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Metric {
    pub name: &'static str,
    pub unit: &'static str,
    /// `None` = indisponivel (nunca zero por omissao).
    pub value: Option<f64>,
    pub origin: MetricOrigin,
    /// Janela de medicao, ex.: "recurso inteiro", "quadros 1..30".
    pub window: String,
    /// `"available"` ou o motivo da indisponibilidade.
    pub availability: String,
    pub subject: SourceLoc,
    /// Limite declarado de orcamento, quando existe.
    pub budget: Option<f64>,
}

impl Metric {
    pub fn is_available(&self) -> bool {
        self.value.is_some()
    }

    pub fn over_budget(&self) -> Option<bool> {
        Some(self.value? > self.budget?)
    }
}

/// Registro de proveniencia de um recurso ou comportamento convertido.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provenance {
    /// Identificador do item convertido, ex.: `anim:200`, `sprite:0,1`.
    pub item: String,
    pub source: SourceLoc,
    /// SHA-256 do arquivo de origem, quando aplicavel.
    pub source_sha256: Option<String>,
    pub transform: String,
    /// Referencia no projeto resultante (preenchida pelo adaptador do produto).
    pub target: Option<String>,
    pub fidelity: Fidelity,
    pub reason: String,
    /// Consequencia pratica para quem joga/edita.
    pub consequence: String,
}
