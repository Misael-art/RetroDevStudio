use crate::core::diagnostics::{DiagnosticArea, DiagnosticSeverity};
use crate::core::project_capability::{
    capability_axis, capability_diagnostic, evidence_ref, CapabilityAxisReport,
    CapabilityEvidenceRef,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RuntimeContract {
    pub id: String,
    pub title: String,
    pub state: String,
    pub evidence_refs: Vec<CapabilityEvidenceRef>,
    pub warnings: Vec<String>,
    pub next_actions: Vec<String>,
    pub experimental: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RuntimeContractsReport {
    pub project_dir: String,
    pub axis: CapabilityAxisReport,
    pub runtime_evidence: CapabilityAxisReport,
    pub contracts: BTreeMap<String, RuntimeContract>,
}

pub fn inspect_runtime_contracts(project_dir: &Path) -> Result<RuntimeContractsReport, String> {
    let project_file = project_dir.join("project.rds");
    let project_text = fs::read_to_string(&project_file).map_err(|error| {
        format!(
            "O que quebrou: falha ao ler project.rds para contratos runtime. Por que importa: contratos dependem de target, fps e entry_scene. Onde corrigir: '{}'. Proxima acao: restaure o projeto ou salve novamente. Detalhe: {}",
            project_file.display(),
            error
        )
    })?;
    let project_json: serde_json::Value = serde_json::from_str(&project_text).map_err(|error| {
        format!(
            "O que quebrou: project.rds invalido para contratos runtime. Por que importa: nao da para distinguir declared/observed/missing sem JSON canonico. Onde corrigir: '{}'. Proxima acao: corrija o manifesto. Detalhe: {}",
            project_file.display(),
            error
        )
    })?;
    let entry_scene = project_json
        .get("entry_scene")
        .and_then(|value| value.as_str())
        .unwrap_or("scenes/main.json");
    let scene_path = project_dir.join(entry_scene);
    let scene_text = fs::read_to_string(&scene_path).unwrap_or_default();
    let all_text = format!("{project_text}\n{scene_text}");

    let mut contracts = BTreeMap::new();
    contracts.insert(
        "scenes".to_string(),
        RuntimeContract {
            id: "scenes".to_string(),
            title: "Cenas".to_string(),
            state: if scene_path.exists() {
                "observed"
            } else {
                "missing"
            }
            .to_string(),
            evidence_refs: if scene_path.exists() {
                vec![evidence_ref(
                    "scene",
                    scene_path.to_string_lossy(),
                    "entry_scene materializada",
                )]
            } else {
                Vec::new()
            },
            warnings: Vec::new(),
            next_actions: if scene_path.exists() {
                vec!["Manter scene_id estavel entre Build e runtime evidence.".to_string()]
            } else {
                vec!["Criar a cena de entrada indicada por project.rds.".to_string()]
            },
            experimental: true,
        },
    );
    contracts.insert(
        "input".to_string(),
        RuntimeContract {
            id: "input".to_string(),
            title: "Input".to_string(),
            state: if scene_text.contains("\"input\"") {
                "declared"
            } else {
                "missing"
            }
            .to_string(),
            evidence_refs: Vec::new(),
            warnings: Vec::new(),
            next_actions: vec![
                "Declarar input por entidade ou confirmar que a cena nao requer controle."
                    .to_string(),
            ],
            experimental: true,
        },
    );
    contracts.insert(
        "save_sram".to_string(),
        RuntimeContract {
            id: "save_sram".to_string(),
            title: "Save/SRAM".to_string(),
            state:
                if contains_word_like(&all_text, "sram") || contains_word_like(&all_text, "save") {
                    "declared"
                } else {
                    "missing"
                }
                .to_string(),
            evidence_refs: Vec::new(),
            warnings: Vec::new(),
            next_actions: vec![
                "Se houver save, declarar contrato SRAM e provar header/uso no ROM Mastering."
                    .to_string(),
            ],
            experimental: true,
        },
    );
    let fps = project_json.get("fps").and_then(|value| value.as_i64());
    contracts.insert(
        "pal_ntsc".to_string(),
        RuntimeContract {
            id: "pal_ntsc".to_string(),
            title: "PAL/NTSC".to_string(),
            state: if matches!(fps, Some(50 | 60)) {
                "declared"
            } else {
                "missing"
            }
            .to_string(),
            evidence_refs: fps
                .map(|fps| {
                    vec![evidence_ref(
                        "project",
                        project_file.to_string_lossy(),
                        format!("fps declarado: {fps}"),
                    )]
                })
                .unwrap_or_default(),
            warnings: Vec::new(),
            next_actions: vec!["Confirmar regiao no ROM Mastering e emulacao real.".to_string()],
            experimental: true,
        },
    );
    contracts.insert(
        "scheduler".to_string(),
        RuntimeContract {
            id: "scheduler".to_string(),
            title: "Scheduler".to_string(),
            state: if all_text.contains("event_update")
                || all_text.contains("event_vblank")
                || all_text.contains("timeline_sequence")
            {
                "declared"
            } else {
                "missing"
            }
            .to_string(),
            evidence_refs: Vec::new(),
            warnings: Vec::new(),
            next_actions: vec![
                "Usar NodeGraph/eventos de frame ou documentar cena sem scheduler.".to_string(),
            ],
            experimental: true,
        },
    );
    contracts.insert(
        "debug_overlay".to_string(),
        RuntimeContract {
            id: "debug_overlay".to_string(),
            title: "Debug overlay".to_string(),
            state: if all_text.contains("debug_overlay") {
                "declared"
            } else {
                "missing"
            }
            .to_string(),
            evidence_refs: Vec::new(),
            warnings: Vec::new(),
            next_actions: vec![
                "Declarar overlay apenas se existir runtime real; caso contrario manter missing."
                    .to_string(),
            ],
            experimental: true,
        },
    );

    let missing = contracts
        .values()
        .filter(|contract| contract.state == "missing")
        .map(|contract| contract.id.clone())
        .collect::<Vec<_>>();
    let diagnostics = missing
        .iter()
        .map(|id| {
            capability_diagnostic(
                DiagnosticArea::RuntimeContracts,
                DiagnosticSeverity::Warn,
                format!("Contrato runtime ausente: {id}."),
                format!("Contrato {id} nao foi encontrado no UGDM/projeto."),
                "Revise o Inspector/NodeGraph antes do build se este contrato for necessario.",
                false,
                Some(project_file.to_string_lossy().to_string()),
            )
        })
        .collect::<Vec<_>>();
    let axis = capability_axis(
        "partial",
        vec![evidence_ref(
            "project",
            project_file.to_string_lossy(),
            "Contratos inferidos do manifesto e da cena ativa",
        )],
        missing,
        Vec::new(),
        vec![
            "Resolver contratos missing antes de tratar evidencia como institucional.".to_string(),
        ],
        Some("project.rds/scenes/graphs".to_string()),
        Some("Inspector/Debug".to_string()),
        diagnostics,
    );

    let evidence_path = project_dir
        .join(".rds")
        .join("reports")
        .join("runtime-evidence.json");
    let runtime_evidence = if evidence_path.exists() {
        capability_axis(
            "observed",
            vec![evidence_ref(
                "runtime_evidence",
                evidence_path.to_string_lossy(),
                "Probe runtime exportado pelo projeto",
            )],
            Vec::new(),
            Vec::new(),
            vec!["Conferir se a evidencia corresponde a ROM/build da rodada.".to_string()],
            Some(".rds/reports/runtime-evidence.json".to_string()),
            Some("Debug".to_string()),
            Vec::new(),
        )
    } else {
        capability_axis(
            "not_instrumented",
            Vec::new(),
            vec!["runtime_probe_absent".to_string()],
            Vec::new(),
            vec!["Ativar RDS_RUNTIME_EVIDENCE_PROBE apenas para build diagnostico e capturar evidencia real.".to_string()],
            Some("codegen optional probe".to_string()),
            Some("Debug".to_string()),
            Vec::new(),
        )
    };

    Ok(RuntimeContractsReport {
        project_dir: project_dir.to_string_lossy().to_string(),
        axis,
        runtime_evidence,
        contracts,
    })
}

fn contains_word_like(text: &str, needle: &str) -> bool {
    text.to_ascii_lowercase().contains(needle)
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
        let dir = std::env::temp_dir().join(format!("rds-runtime-contracts-{name}-{stamp}"));
        fs::create_dir_all(dir.join("scenes")).expect("scenes");
        fs::write(
            dir.join("project.rds"),
            r#"{
              "rds_version": "1.0.0",
              "name": "Runtime Contracts",
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
              "entities": [
                {
                  "entity_id": "player",
                  "prefab": null,
                  "transform": { "x": 16, "y": 16 },
                  "components": {
                    "input": { "device": "joypad_1", "mapping": { "jump": "BUTTON_A" } },
                    "logic": { "graph": "{\"nodes\":[{\"type\":\"event_update\"}],\"edges\":[]}" }
                  }
                }
              ],
              "palettes": []
            }"#,
        )
        .expect("scene");
        dir
    }

    #[test]
    fn runtime_contracts_report_declared_observed_and_missing_states() {
        let project = temp_project("states");

        let report = inspect_runtime_contracts(&project).expect("contracts");

        assert_eq!(report.contracts["scenes"].state, "observed");
        assert_eq!(report.contracts["input"].state, "declared");
        assert_eq!(report.contracts["save_sram"].state, "missing");
        assert_eq!(report.contracts["pal_ntsc"].state, "declared");
        assert!(report.contracts["save_sram"]
            .next_actions
            .iter()
            .any(|action| action.contains("SRAM")));
    }

    #[test]
    fn runtime_contracts_marks_runtime_probe_as_not_instrumented_when_evidence_absent() {
        let project = temp_project("probe");

        let report = inspect_runtime_contracts(&project).expect("contracts");

        assert_eq!(report.runtime_evidence.status, "not_instrumented");
        assert!(report.runtime_evidence.experimental);
    }
}
