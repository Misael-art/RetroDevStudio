use crate::core::diagnostics::{ActionableDiagnostic, DiagnosticArea, DiagnosticSeverity};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CapabilityEvidenceRef {
    pub kind: String,
    pub path: String,
    pub summary: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CapabilityAxisReport {
    pub status: String,
    pub maturity: String,
    pub evidence_refs: Vec<CapabilityEvidenceRef>,
    pub blocking_statuses: Vec<String>,
    pub warnings: Vec<String>,
    pub next_actions: Vec<String>,
    pub experimental: bool,
    pub source: Option<String>,
    pub owner: Option<String>,
    pub diagnostics: Vec<ActionableDiagnostic>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ProjectCapabilityReport {
    pub project_dir: String,
    pub documentation: CapabilityAxisReport,
    pub implementation: CapabilityAxisReport,
    pub build: CapabilityAxisReport,
    pub rom: CapabilityAxisReport,
    pub emulation: CapabilityAxisReport,
    pub runtime_evidence: CapabilityAxisReport,
    pub visual_validation: CapabilityAxisReport,
    pub assets: CapabilityAxisReport,
    pub patterns: CapabilityAxisReport,
    pub runtime_contracts: CapabilityAxisReport,
    pub audio: CapabilityAxisReport,
    pub blockers: Vec<ActionableDiagnostic>,
}

pub fn evidence_ref(
    kind: impl Into<String>,
    path: impl Into<String>,
    summary: impl Into<String>,
) -> CapabilityEvidenceRef {
    CapabilityEvidenceRef {
        kind: kind.into(),
        path: path.into(),
        summary: summary.into(),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn capability_axis(
    status: impl Into<String>,
    evidence_refs: Vec<CapabilityEvidenceRef>,
    blocking_statuses: Vec<String>,
    warnings: Vec<String>,
    next_actions: Vec<String>,
    source: Option<String>,
    owner: Option<String>,
    diagnostics: Vec<ActionableDiagnostic>,
) -> CapabilityAxisReport {
    CapabilityAxisReport {
        status: status.into(),
        maturity: "experimental".to_string(),
        evidence_refs,
        blocking_statuses,
        warnings,
        next_actions,
        experimental: true,
        source,
        owner,
        diagnostics,
    }
}

pub fn capability_diagnostic(
    area: DiagnosticArea,
    severity: DiagnosticSeverity,
    user_message: impl Into<String>,
    technical_detail: impl Into<String>,
    suggested_action: impl Into<String>,
    blocking: bool,
    evidence_path: Option<String>,
) -> ActionableDiagnostic {
    let mut diagnostic = ActionableDiagnostic::new(
        severity,
        area,
        user_message,
        technical_detail,
        suggested_action,
        blocking,
    );
    if let Some(path) = evidence_path {
        diagnostic = diagnostic.with_evidence_path(path);
    }
    diagnostic
}

pub fn inspect_project_capability(project_dir: &Path) -> Result<ProjectCapabilityReport, String> {
    if !project_dir.exists() {
        return Err(format!(
            "O que quebrou: projeto nao encontrado. Por que importa: a camada de capability precisa ler project.rds, cenas e evidencias locais. Onde corrigir: '{}'. Proxima acao: abra um projeto RDS valido antes de inspecionar capability.",
            project_dir.display()
        ));
    }

    let project_file = project_dir.join("project.rds");
    let project_json = fs::read_to_string(&project_file).map_err(|error| {
        format!(
            "O que quebrou: falha ao ler project.rds. Por que importa: sem manifesto nao ha como rastrear Build -> ROM -> Emulacao. Onde corrigir: '{}'. Proxima acao: restaure ou recrie o manifesto canonico. Detalhe: {}",
            project_file.display(),
            error
        )
    })?;
    let parsed_project: serde_json::Value = serde_json::from_str(&project_json).map_err(|error| {
        format!(
            "O que quebrou: project.rds invalido. Por que importa: capability diagnostics depende de JSON estavel. Onde corrigir: '{}'. Proxima acao: salve o projeto novamente pelo editor ou corrija o JSON. Detalhe: {}",
            project_file.display(),
            error
        )
    })?;

    let entry_scene = parsed_project
        .get("entry_scene")
        .and_then(|value| value.as_str())
        .unwrap_or("scenes/main.json");
    let entry_scene_path = project_dir.join(entry_scene);

    let documentation = inspect_documentation_axis(project_dir, &project_file);
    let implementation = inspect_implementation_axis(project_dir, &entry_scene_path);
    let build = inspect_build_axis(project_dir);
    let rom = inspect_rom_axis(project_dir);
    let emulation = inspect_report_axis(
        project_dir,
        "emulation",
        "partial",
        "Registre evidencia de core Libretro, frames rodados e framebuffer util em .rds/reports/.",
    );
    let visual_validation = inspect_report_axis(
        project_dir,
        "visual",
        "not_instrumented",
        "Capture evidencia visual do fluxo afetado em .rds/reports/ quando houver validacao manual.",
    );

    let runtime_report = crate::core::runtime_contracts::inspect_runtime_contracts(project_dir)?;
    let runtime_evidence = runtime_report.runtime_evidence.clone();
    let runtime_contracts = runtime_report.axis.clone();

    let assets = match crate::core::asset_quality::inspect_asset_quality(project_dir, None) {
        Ok(report) => report.axis,
        Err(error) => capability_axis(
            "partial",
            Vec::new(),
            vec!["asset_quality_unavailable".to_string()],
            vec![error],
            vec!["Abra ArtStudio > Qualidade ROM apos selecionar um asset do projeto.".to_string()],
            Some("asset_quality".to_string()),
            Some("ArtStudio".to_string()),
            Vec::new(),
        ),
    };
    let audio = match crate::core::audio_pipeline::inspect_audio_pipeline(project_dir) {
        Ok(report) => report.axis,
        Err(error) => capability_axis(
            "partial",
            Vec::new(),
            vec!["audio_pipeline_unavailable".to_string()],
            vec![error],
            vec![
                "Adicione assets de audio em assets/audio ou revise os arquivos existentes."
                    .to_string(),
            ],
            Some("audio_pipeline".to_string()),
            Some("Debug/Inspector".to_string()),
            Vec::new(),
        ),
    };
    let pattern_count = crate::core::sgdk_pattern_templates::list_sgdk_pattern_templates().len();
    let patterns = capability_axis(
        "partial",
        vec![evidence_ref(
            "registry",
            "backend:sgdk_pattern_templates",
            format!("{pattern_count} templates SGDK experimentais rastreaveis"),
        )],
        Vec::new(),
        vec!["Templates sao experimentais e exigem revisao antes do build real.".to_string()],
        vec!["Inserir template no NodeGraph, revisar contratos e rodar Build & Run.".to_string()],
        Some("sgdk_pattern_templates".to_string()),
        Some("NodeGraph".to_string()),
        Vec::new(),
    );

    let mut blockers = Vec::new();
    for axis in [
        &documentation,
        &implementation,
        &build,
        &rom,
        &emulation,
        &runtime_evidence,
        &visual_validation,
        &assets,
        &patterns,
        &runtime_contracts,
        &audio,
    ] {
        blockers.extend(
            axis.diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.blocking)
                .cloned(),
        );
    }

    Ok(ProjectCapabilityReport {
        project_dir: project_dir.to_string_lossy().to_string(),
        documentation,
        implementation,
        build,
        rom,
        emulation,
        runtime_evidence,
        visual_validation,
        assets,
        patterns,
        runtime_contracts,
        audio,
        blockers,
    })
}

fn inspect_documentation_axis(project_dir: &Path, project_file: &Path) -> CapabilityAxisReport {
    let mut evidence = vec![evidence_ref(
        "manifest",
        project_file.to_string_lossy(),
        "project.rds presente",
    )];
    for candidate in ["README.md", "docs", ".rds/reports"] {
        let path = project_dir.join(candidate);
        if path.exists() {
            evidence.push(evidence_ref(
                "documentation",
                path.to_string_lossy(),
                format!("{candidate} presente no projeto"),
            ));
        }
    }
    let status = "partial";
    capability_axis(
        status,
        evidence,
        Vec::new(),
        vec![
            "Documentacao de capability permanece Experimental ate evidencia institucional."
                .to_string(),
        ],
        vec![
            "Registrar relatorios exportaveis em <project>/.rds/reports quando houver prova real."
                .to_string(),
        ],
        Some("project.rds".to_string()),
        Some("Project/Debug".to_string()),
        Vec::new(),
    )
}

fn inspect_implementation_axis(
    project_dir: &Path,
    entry_scene_path: &Path,
) -> CapabilityAxisReport {
    let mut diagnostics = Vec::new();
    let mut blocking = Vec::new();
    let mut evidence = Vec::new();
    if entry_scene_path.exists() {
        evidence.push(evidence_ref(
            "scene",
            entry_scene_path.to_string_lossy(),
            "Cena de entrada encontrada",
        ));
    } else {
        blocking.push("entry_scene_missing".to_string());
        diagnostics.push(capability_diagnostic(
            DiagnosticArea::ProjectCapability,
            DiagnosticSeverity::Error,
            "Cena de entrada ausente impede inspecao completa da implementacao.",
            format!(
                "entry_scene nao encontrado em '{}'",
                entry_scene_path.display()
            ),
            "Abra o projeto no editor, recrie a cena de entrada ou ajuste project.rds.",
            true,
            Some(entry_scene_path.to_string_lossy().to_string()),
        ));
    }
    let graphs_dir = project_dir.join("graphs");
    if graphs_dir.exists() {
        evidence.push(evidence_ref(
            "graphs",
            graphs_dir.to_string_lossy(),
            "Diretorio de NodeGraph encontrado",
        ));
    }
    capability_axis(
        if blocking.is_empty() {
            "partial"
        } else {
            "blocked"
        },
        evidence,
        blocking,
        Vec::new(),
        vec!["Manter implementacao ligada ao UGDM canonico e evitar fluxo paralelo.".to_string()],
        Some("project.rds/scenes".to_string()),
        Some("Scene/Logic".to_string()),
        diagnostics,
    )
}

fn inspect_build_axis(project_dir: &Path) -> CapabilityAxisReport {
    let build_dir = project_dir.join("build");
    let mut evidence = Vec::new();
    let mut diagnostics = Vec::new();
    let mut blocking = Vec::new();
    if build_dir.exists() {
        evidence.push(evidence_ref(
            "build_dir",
            build_dir.to_string_lossy(),
            "Diretorio build encontrado",
        ));
    } else {
        blocking.push("build_not_run".to_string());
        diagnostics.push(capability_diagnostic(
            DiagnosticArea::ProjectCapability,
            DiagnosticSeverity::Error,
            "Build ainda nao possui evidencia local neste projeto.",
            format!("Diretorio '{}' ausente", build_dir.display()),
            "Rode Build & Run com toolchains oficiais e reinspecione capability.",
            true,
            Some(build_dir.to_string_lossy().to_string()),
        ));
    }
    capability_axis(
        "partial",
        evidence,
        blocking,
        Vec::new(),
        vec![
            "Rode Build & Run e preserve o log em .rds/reports se for usar como evidencia."
                .to_string(),
        ],
        Some("build/".to_string()),
        Some("Build/Game".to_string()),
        diagnostics,
    )
}

fn inspect_rom_axis(project_dir: &Path) -> CapabilityAxisReport {
    let roms = find_rom_candidates(project_dir);
    if roms.is_empty() {
        let build_dir = project_dir.join("build");
        return capability_axis(
            "partial",
            Vec::new(),
            vec!["rom_missing".to_string()],
            Vec::new(),
            vec![
                "Gere uma ROM pelo fluxo canonico Build -> ROM antes de declarar evidencia."
                    .to_string(),
            ],
            Some("build/".to_string()),
            Some("Build/Game".to_string()),
            vec![capability_diagnostic(
                DiagnosticArea::RomMastering,
                DiagnosticSeverity::Error,
                "ROM nao encontrada para mastering diagnostics.",
                format!(
                    "Nenhum .bin/.md/.sfc/.smc encontrado em '{}'",
                    build_dir.display()
                ),
                "Execute Build & Run e depois rode Inspect ROM Mastering no artefato gerado.",
                true,
                Some(build_dir.to_string_lossy().to_string()),
            )],
        );
    }
    capability_axis(
        "partial",
        roms.iter()
            .map(|path| evidence_ref("rom", path.to_string_lossy(), "ROM candidata encontrada"))
            .collect(),
        Vec::new(),
        vec![
            "ROM encontrada ainda precisa de inspect_rom_mastering para checksum/regiao/SRAM."
                .to_string(),
        ],
        vec![
            "Rodar inspect_rom_mastering no artefato e anexar warnings/blockers ao Debug."
                .to_string(),
        ],
        Some("build/".to_string()),
        Some("Build/Game".to_string()),
        Vec::new(),
    )
}

fn inspect_report_axis(
    project_dir: &Path,
    needle: &str,
    missing_status: &str,
    next_action: &str,
) -> CapabilityAxisReport {
    let report_dir = project_dir.join(".rds").join("reports");
    let matches = find_report_candidates(&report_dir, needle);
    if matches.is_empty() {
        return capability_axis(
            missing_status,
            Vec::new(),
            vec![format!("{needle}_evidence_missing")],
            Vec::new(),
            vec![next_action.to_string()],
            Some(".rds/reports".to_string()),
            Some("Debug".to_string()),
            Vec::new(),
        );
    }
    capability_axis(
        "partial",
        matches
            .iter()
            .map(|path| {
                evidence_ref(
                    "report",
                    path.to_string_lossy(),
                    "Relatorio de evidencia encontrado",
                )
            })
            .collect(),
        Vec::new(),
        Vec::new(),
        vec![
            "Verifique se o relatorio corresponde a build/ROM/emulacao reais da rodada."
                .to_string(),
        ],
        Some(".rds/reports".to_string()),
        Some("Debug".to_string()),
        Vec::new(),
    )
}

fn find_rom_candidates(project_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect_matching_files(&project_dir.join("build"), &mut out, &|path| {
        matches!(
            path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()),
            Some(ext) if matches!(ext.as_str(), "bin" | "md" | "sfc" | "smc")
        )
    });
    out
}

fn find_report_candidates(report_dir: &Path, needle: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect_matching_files(report_dir, &mut out, &|path| {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            return false;
        };
        name.to_ascii_lowercase().contains(needle)
    });
    out
}

fn collect_matching_files(dir: &Path, out: &mut Vec<PathBuf>, predicate: &dyn Fn(&Path) -> bool) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_matching_files(&path, out, predicate);
        } else if predicate(&path) {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rds-project-capability-{name}-{stamp}"));
        fs::create_dir_all(dir.join("scenes")).expect("scenes");
        fs::create_dir_all(dir.join("assets").join("audio")).expect("audio");
        fs::write(
            dir.join("project.rds"),
            r#"{
              "rds_version": "1.0.0",
              "name": "Capability",
              "target": "megadrive",
              "resolution": { "width": 320, "height": 224 },
              "fps": 60,
              "palette_mode": "4x16",
              "entry_scene": "scenes/main.json",
              "build": { "output_dir": "build/", "optimization": "size" }
            }"#,
        )
        .expect("project");
        fs::write(
            dir.join("scenes").join("main.json"),
            r#"{
              "scene_id": "main",
              "display_name": "Main",
              "background_layers": [],
              "entities": [],
              "palettes": []
            }"#,
        )
        .expect("scene");
        dir
    }

    #[test]
    fn project_capability_report_keeps_all_axes_experimental_and_actionable() {
        let project = temp_project("all-axes");

        let report = inspect_project_capability(&project).expect("report");

        assert_eq!(report.documentation.maturity, "experimental");
        assert_eq!(report.runtime_evidence.status, "not_instrumented");
        assert!(report.rom.experimental);
        assert!(report.blockers.iter().any(|diagnostic| diagnostic.blocking));
        assert!(report
            .build
            .next_actions
            .iter()
            .any(|action| action.contains("Build")));
    }

    #[test]
    fn project_capability_json_shape_is_stable() {
        let project = temp_project("json");
        let report = inspect_project_capability(&project).expect("report");

        let json = serde_json::to_string(&report).expect("json");

        assert!(json.starts_with("{\"project_dir\""));
        assert!(json.contains("\"documentation\""));
        assert!(json.contains("\"runtime_contracts\""));
        assert!(json.ends_with("]}"));
    }
}
