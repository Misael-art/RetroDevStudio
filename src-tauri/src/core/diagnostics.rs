use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DiagnosticArea {
    #[serde(rename = "import_sgdk")]
    ImportSgdk,
    #[serde(rename = "import_gamemaker")]
    ImportGameMaker,
    #[serde(rename = "import_mugen")]
    ImportMugen,
    #[serde(rename = "import_ikemen")]
    ImportIkemen,
    #[serde(rename = "import_openbor")]
    ImportOpenBor,
    #[serde(rename = "build_sgdk")]
    BuildSgdk,
    #[serde(rename = "build_snes")]
    BuildSnes,
    #[serde(rename = "libretro_emulation")]
    LibretroEmulation,
    #[serde(rename = "runtime_setup")]
    RuntimeSetup,
    #[serde(rename = "hardware")]
    Hardware,
    #[serde(rename = "project")]
    Project,
    #[serde(rename = "codegen")]
    Codegen,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ActionableDiagnostic {
    pub severity: DiagnosticSeverity,
    pub area: DiagnosticArea,
    pub source_path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub user_message: String,
    pub technical_detail: String,
    pub suggested_action: String,
    pub blocking: bool,
    pub evidence_path: Option<String>,
}

impl ActionableDiagnostic {
    pub fn new(
        severity: DiagnosticSeverity,
        area: DiagnosticArea,
        user_message: impl Into<String>,
        technical_detail: impl Into<String>,
        suggested_action: impl Into<String>,
        blocking: bool,
    ) -> Self {
        Self {
            severity,
            area,
            source_path: None,
            line: None,
            column: None,
            user_message: user_message.into(),
            technical_detail: technical_detail.into(),
            suggested_action: suggested_action.into(),
            blocking,
            evidence_path: None,
        }
    }

    pub fn blocking_error(
        area: DiagnosticArea,
        user_message: impl Into<String>,
        technical_detail: impl Into<String>,
        suggested_action: impl Into<String>,
    ) -> Self {
        Self::new(
            DiagnosticSeverity::Error,
            area,
            user_message,
            technical_detail,
            suggested_action,
            true,
        )
    }

    pub fn with_source_path(mut self, source_path: impl Into<String>) -> Self {
        self.source_path = Some(source_path.into());
        self
    }

    pub fn with_line_column(mut self, line: Option<u32>, column: Option<u32>) -> Self {
        self.line = line;
        self.column = column;
        self
    }

    pub fn with_evidence_path(mut self, evidence_path: impl Into<String>) -> Self {
        self.evidence_path = Some(evidence_path.into());
        self
    }
}

pub fn target_build_area(target: &str) -> DiagnosticArea {
    if target.eq_ignore_ascii_case("snes") {
        DiagnosticArea::BuildSnes
    } else {
        DiagnosticArea::BuildSgdk
    }
}

pub fn build_diagnostics_from_log(
    target: &str,
    log: &[crate::compiler::build_orch::BuildLogLine],
    evidence_path: Option<&Path>,
) -> Vec<ActionableDiagnostic> {
    let error_lines = log
        .iter()
        .filter(|line| line.level == "error")
        .map(|line| line.message.trim())
        .filter(|message| !message.is_empty())
        .collect::<Vec<_>>();

    if error_lines.is_empty() {
        return vec![build_failure_diagnostic(
            target,
            "Build falhou sem linhas de erro estruturadas no log.",
            evidence_path,
        )];
    }

    error_lines
        .into_iter()
        .map(|message| build_failure_diagnostic(target, message, evidence_path))
        .collect()
}

pub fn build_failure_diagnostic(
    target: &str,
    technical_detail: &str,
    evidence_path: Option<&Path>,
) -> ActionableDiagnostic {
    let area = target_build_area(target);
    let lower = technical_detail.to_ascii_lowercase();
    let source_path = extract_quoted_path(technical_detail);
    let (line, column) = parse_line_column(technical_detail);

    let (user_message, suggested_action) = if lower.contains("asset referenciado nao encontrado") {
        let asset = source_path
            .as_deref()
            .unwrap_or("asset referenciado pela cena");
        (
            format!("Build falhou porque o asset '{}' nao foi encontrado.", asset),
            "Restaure o arquivo ausente ou atualize a entidade para apontar para um asset existente.".to_string(),
        )
    } else if lower.contains("toolchain sgdk nao encontrada") {
        (
            "Build falhou porque a toolchain SGDK nao esta disponivel.".to_string(),
            "Abra Runtime Setup e instale SGDK oficial, ou configure SGDK_ROOT para a pasta correta.".to_string(),
        )
    } else if lower.contains("toolchain pvsneslib nao encontrada") {
        (
            "Build SNES falhou porque a toolchain PVSnesLib nao esta disponivel.".to_string(),
            "Abra Runtime Setup e instale PVSnesLib oficial, ou configure PVSNESLIB_HOME para a pasta correta.".to_string(),
        )
    } else if lower.contains("build abortado: erros de hardware constraints") {
        (
            "Build foi bloqueado por violacoes de hardware do target.".to_string(),
            "Abra os avisos de hardware, reduza os recursos marcados como fatais e rode a validacao novamente.".to_string(),
        )
    } else if lower.contains("falha ao gerar ast") || lower.contains("falha ao resolver prefabs") {
        (
            "Build falhou durante a preparacao do modelo canonico da cena.".to_string(),
            "Abra a cena, confira prefabs/grafos referenciados e salve novamente antes de recompilar.".to_string(),
        )
    } else {
        (
            "Build falhou durante a emissao, staging ou execucao da toolchain.".to_string(),
            "Veja o detalhe tecnico, corrija o arquivo ou dependencia indicada e rode Build & Run novamente.".to_string(),
        )
    };

    let mut diagnostic = ActionableDiagnostic::blocking_error(
        area,
        user_message,
        technical_detail,
        suggested_action,
    )
    .with_line_column(line, column);

    if let Some(source_path) = source_path {
        diagnostic = diagnostic.with_source_path(source_path);
    }
    if let Some(path) = evidence_path {
        diagnostic = diagnostic.with_evidence_path(path.to_string_lossy().to_string());
    }
    diagnostic
}

fn extract_quoted_path(message: &str) -> Option<String> {
    let start = message.find('\'')?;
    let remainder = &message[start + 1..];
    let end = remainder.find('\'')?;
    let candidate = remainder[..end].trim();
    (!candidate.is_empty()).then(|| candidate.to_string())
}

fn parse_line_column(message: &str) -> (Option<u32>, Option<u32>) {
    for token in message.split_whitespace() {
        let parts = token.split(':').collect::<Vec<_>>();
        if parts.len() < 3 {
            continue;
        }
        let line = parts
            .get(parts.len().saturating_sub(3))
            .and_then(|value| value.parse::<u32>().ok());
        let column = parts
            .get(parts.len().saturating_sub(2))
            .and_then(|value| value.parse::<u32>().ok());
        if line.is_some() {
            return (line, column);
        }
    }
    (None, None)
}
