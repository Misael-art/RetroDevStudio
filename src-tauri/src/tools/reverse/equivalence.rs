//! Oráculos de equivalência do Programa REX (REX-00/03) sobre o
//! [`crate::core::parity_harness`]: comportamento por frame, recursos em
//! memória, áudio e discriminação de input. "Imagem não preta" e heartbeat
//! são registrados como evidência de superfície e **nunca** bastam para
//! aprovar; ausência de dado é `missing`, nunca igualdade.
//!
//! Consumo atual: provas reais `#[ignore]` (corpus BYOR) e testes; os comandos
//! IPC/superfícies chegam com REX-02+ — por isso `dead_code` é permitido aqui
//! sem afrouxar o gate global.

// Segue a convenção de `manifest.rs` (ProjectionReport): superfícies em
// construção antes da fiação de IPC.
#![allow(dead_code)]

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::core::parity_harness::{AudioObservation, ParityReport};
use crate::tools::reverse::decomp::rom_library::{
    ArtifactRef, CapabilityRecord, CAP_STATUS_EXPERIMENTAL, CAP_STATUS_UNSUPPORTED,
};

pub const REX_EQUIVALENCE_SCHEMA: &str = "rex-equivalence/v1";

pub const ORACLE_STATUS_PASS: &str = "pass";
pub const ORACLE_STATUS_FAIL: &str = "fail";
pub const ORACLE_STATUS_MISSING: &str = "missing";

pub const VERDICT_PASSED: &str = "passed";
pub const VERDICT_REJECTED: &str = "rejected";
pub const VERDICT_INDETERMINATE: &str = "indeterminate";

/// Capacidades do eixo REX 3 do plano (12_DECOMPILACAO_PAREADA_PLANO.md).
pub const CAPABILITY_AXES: [&str; 8] = [
    "identify",
    "inspect_code",
    "extract",
    "edit_asset",
    "edit_logic",
    "rebuild",
    "emulate",
    "export_patch",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OracleResult {
    pub name: String,
    pub status: String,
    pub detail: String,
}

impl OracleResult {
    fn new(name: &str, status: &str, detail: impl Into<String>) -> Self {
        Self {
            name: name.to_string(),
            status: status.to_string(),
            detail: detail.into(),
        }
    }
}

/// Evidência de superfície do candidato: registrada para demonstrar que
/// "framebuffer não preto" e "frames evoluindo" (heartbeat) não aprovam
/// equivalência — estes números nunca entram no critério de aprovação.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfaceEvidence {
    pub candidate_max_non_black_pixels: usize,
    pub candidate_distinct_framebuffers: usize,
    pub reference_max_non_black_pixels: usize,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EquivalenceReport {
    pub schema: String,
    pub expectation: String,
    pub reference_sha256: String,
    pub candidate_sha256: String,
    pub core_label: String,
    pub frames: u32,
    pub verdict: String,
    pub oracles: Vec<OracleResult>,
    pub surface_evidence: SurfaceEvidence,
    pub gaps: Vec<String>,
    pub note: String,
}

fn audio_stream(audio: &Option<AudioObservation>) -> Option<&str> {
    // String vazia não é stream observado (REX-REV-04).
    audio
        .as_ref()
        .filter(|observation| observation.available)
        .and_then(|observation| observation.stream_sha256.as_deref())
        .filter(|stream| !stream.is_empty())
}

fn distinct_framebuffer_count(report: &ParityReport) -> usize {
    let mut values: Vec<&str> = report
        .frame_hashes
        .iter()
        .map(|frame| frame.framebuffer_sha256.as_str())
        .collect();
    values.sort_unstable();
    values.dedup();
    values.len()
}

fn max_non_black(report: &ParityReport) -> usize {
    report
        .frame_hashes
        .iter()
        .map(|frame| frame.non_black_pixels)
        .max()
        .unwrap_or(0)
}

/// Compara duas capturas **da mesma expectativa byte-a-byte** (mesma ROM
/// declarada vs candidato reconstruído). Comportamento = hashes por frame +
/// estado final; recursos = regiões de memória comparadas simetricamente;
/// áudio = stream observado. Região ausente é `missing` com lacuna registrada,
/// nunca tratada como igualdade.
pub fn evaluate_identical_equivalence(
    reference: &ParityReport,
    candidate: &ParityReport,
) -> EquivalenceReport {
    let mut oracles = Vec::new();
    let mut gaps = Vec::new();

    // Oráculo de cenário: contagens declaradas não são observação. Exige
    // frames presentes correspondentes à contagem, identidade de ROM/core e
    // capturas com o mesmo comprimento (REX-REV-04).
    let observations_complete = |report: &ParityReport| {
        report.frames_run > 0
            && !report.frame_hashes.is_empty()
            && report.frame_hashes.len() as u32 == report.frames_run
            && !report.rom_sha256.is_empty()
            && !report.core_label.is_empty()
    };
    let scenario_ok = observations_complete(reference)
        && observations_complete(candidate)
        && reference.frames_run == candidate.frames_run
        && reference.frame_hashes.len() == candidate.frame_hashes.len()
        && reference.core_label == candidate.core_label;
    oracles.push(OracleResult::new(
        "scenario",
        if scenario_ok {
            ORACLE_STATUS_PASS
        } else {
            ORACLE_STATUS_FAIL
        },
        format!(
            "referência {} frames declarados / {} hashes observados; candidato {} declarados / {} observados; core '{}' vs '{}'",
            reference.frames_run,
            reference.frame_hashes.len(),
            candidate.frames_run,
            candidate.frame_hashes.len(),
            reference.core_label,
            candidate.core_label
        ),
    ));

    // Oráculo de comportamento: igualdade por frame.
    let limit = reference
        .frame_hashes
        .len()
        .min(candidate.frame_hashes.len());
    let mut behavior_mismatches = 0usize;
    let mut first_mismatch: Option<u32> = None;
    for index in 0..limit {
        let expected = &reference.frame_hashes[index];
        let observed = &candidate.frame_hashes[index];
        if expected.framebuffer_sha256 != observed.framebuffer_sha256 {
            behavior_mismatches += 1;
            if first_mismatch.is_none() {
                first_mismatch = Some(expected.frame_index);
            }
        }
    }
    oracles.push(OracleResult::new(
        "behavior_frames",
        if scenario_ok && behavior_mismatches == 0 && limit == reference.frame_hashes.len() {
            ORACLE_STATUS_PASS
        } else {
            ORACLE_STATUS_FAIL
        },
        format!(
            "{behavior_mismatches} divergências de framebuffer em {limit} frames (primeira no frame {:?})",
            first_mismatch
        ),
    ));

    // Estado final serializado pelo core; string vazia não é observação.
    oracles.push(OracleResult::new(
        "final_state",
        if reference.final_state_sha256.is_empty() || candidate.final_state_sha256.is_empty() {
            gaps.push("estado final ausente em pelo menos um lado; não verificado".to_string());
            ORACLE_STATUS_MISSING
        } else if reference.final_state_sha256 == candidate.final_state_sha256 {
            ORACLE_STATUS_PASS
        } else {
            ORACLE_STATUS_FAIL
        },
        format!(
            "referência {} vs candidato {}",
            reference.final_state_sha256, candidate.final_state_sha256
        ),
    ));

    // Recursos em memória: união de regiões, comparação simétrica. O contrato
    // da região (region_id e tamanho) faz parte da identidade — divergência
    // rejeita mesmo com hash igual (REX-REV-04).
    let mut resource_failures = 0usize;
    let mut resource_missing = 0usize;
    let mut resource_details = Vec::new();
    let mut labels: Vec<&str> = reference
        .observed_regions
        .iter()
        .chain(candidate.observed_regions.iter())
        .map(|region| region.label.as_str())
        .collect();
    labels.sort_unstable();
    labels.dedup();
    for label in labels {
        let expected = reference
            .observed_regions
            .iter()
            .find(|region| region.label == label);
        let observed = candidate
            .observed_regions
            .iter()
            .find(|region| region.label == label);
        match (expected, observed) {
            (Some(expected), Some(observed)) if expected.available && observed.available => {
                if expected.region_id != observed.region_id || expected.size != observed.size {
                    resource_failures += 1;
                    gaps.push(format!(
                        "região '{label}' com contrato divergente: region_id {}/{} tamanho {}/{}",
                        expected.region_id, observed.region_id, expected.size, observed.size
                    ));
                    resource_details.push(format!("{label}: contrato divergente"));
                    continue;
                }
                match (&expected.sha256, &observed.sha256) {
                    (Some(expected_hash), Some(observed_hash))
                        if !expected_hash.is_empty() && !observed_hash.is_empty() =>
                    {
                        if expected_hash == observed_hash {
                            resource_details.push(format!("{label}: identica"));
                        } else {
                            resource_failures += 1;
                            resource_details.push(format!("{label}: divergente"));
                        }
                    }
                    _ => {
                        resource_missing += 1;
                        resource_details.push(format!("{label}: hash indisponível"));
                    }
                }
            }
            (Some(expected), _) if expected.available => {
                resource_failures += 1;
                gaps.push(format!(
                    "região '{label}' disponível na referência e ausente no candidato"
                ));
                resource_details.push(format!("{label}: ausente no candidato"));
            }
            (_, Some(observed)) if observed.available => {
                resource_failures += 1;
                gaps.push(format!(
                    "região '{label}' disponível no candidato e ausente na referência"
                ));
                resource_details.push(format!("{label}: ausente na referência"));
            }
            _ => {
                resource_missing += 1;
                gaps.push(format!(
                    "região '{label}' não exposta pelo core nos dois lados; não verificada"
                ));
                resource_details.push(format!("{label}: missing nos dois lados"));
            }
        }
    }
    oracles.push(OracleResult::new(
        "resources",
        if resource_failures > 0 {
            ORACLE_STATUS_FAIL
        } else if resource_missing > 0 {
            ORACLE_STATUS_MISSING
        } else {
            ORACLE_STATUS_PASS
        },
        resource_details.join("; "),
    ));

    // Áudio observado: indisponível é missing, não igualdade.
    let audio_status = match (
        audio_stream(&reference.audio),
        audio_stream(&candidate.audio),
    ) {
        (Some(expected), Some(observed)) => {
            if expected == observed {
                ORACLE_STATUS_PASS
            } else {
                ORACLE_STATUS_FAIL
            }
        }
        (None, None) => {
            gaps.push("stream de áudio não entregue pelo core nos dois lados".to_string());
            ORACLE_STATUS_MISSING
        }
        _ => {
            gaps.push(
                "stream de áudio disponível em apenas um lado; comparação assimétrica".to_string(),
            );
            ORACLE_STATUS_FAIL
        }
    };
    oracles.push(OracleResult::new("audio", audio_status, String::new()));

    let verdict = if oracles
        .iter()
        .any(|oracle| oracle.status == ORACLE_STATUS_FAIL)
    {
        VERDICT_REJECTED
    } else if oracles
        .iter()
        .any(|oracle| oracle.status == ORACLE_STATUS_MISSING)
    {
        VERDICT_INDETERMINATE
    } else {
        VERDICT_PASSED
    };

    EquivalenceReport {
        schema: REX_EQUIVALENCE_SCHEMA.to_string(),
        expectation: "identical".to_string(),
        reference_sha256: reference.rom_sha256.clone(),
        candidate_sha256: candidate.rom_sha256.clone(),
        core_label: candidate.core_label.clone(),
        frames: candidate.frames_run,
        verdict: verdict.to_string(),
        oracles,
        surface_evidence: SurfaceEvidence {
            candidate_max_non_black_pixels: max_non_black(candidate),
            candidate_distinct_framebuffers: distinct_framebuffer_count(candidate),
            reference_max_non_black_pixels: max_non_black(reference),
            note: "Evidência de superfície registrada apenas para mostrar que é \
                   insuficiente: não-preto e heartbeat nunca aprovam equivalência."
                .to_string(),
        },
        gaps,
        note: String::new(),
    }
}

/// Qualidade do cenário: os inputs definidos produziram evolução observável
/// distinta da execução ociosa (zero-input)? `absent` NÃO invalida a identidade
/// da mesma ROM, mas registra que a cobertura de resposta a input não foi
/// demonstrada nesta janela — vira lacuna, nunca sucesso presumido.
pub fn scenario_input_discrimination(
    with_inputs: &ParityReport,
    idle: &ParityReport,
) -> OracleResult {
    if with_inputs.frames_run != idle.frames_run || with_inputs.frames_run == 0 {
        return OracleResult::new(
            "input_discrimination",
            ORACLE_STATUS_MISSING,
            format!(
                "janelas incomparáveis: {} frames com input vs {} ociosos",
                with_inputs.frames_run, idle.frames_run
            ),
        );
    }
    let frame_divergences = with_inputs
        .frame_hashes
        .iter()
        .zip(idle.frame_hashes.iter())
        .filter(|(input_frame, idle_frame)| {
            input_frame.framebuffer_sha256 != idle_frame.framebuffer_sha256
        })
        .count();
    let state_diverges = with_inputs.final_state_sha256 != idle.final_state_sha256
        || with_inputs.observed_regions.iter().any(|region| {
            region.available
                && idle
                    .observed_regions
                    .iter()
                    .find(|idle_region| idle_region.label == region.label)
                    .map(|idle_region| idle_region.available && idle_region.sha256 != region.sha256)
                    .unwrap_or(true)
        });
    if frame_divergences > 0 || state_diverges {
        OracleResult::new(
            "input_discrimination",
            ORACLE_STATUS_PASS,
            format!(
                "inputs alteraram a observação: {frame_divergences} frames divergentes, estado final divergiu={state_diverges}"
            ),
        )
    } else {
        OracleResult::new(
            "input_discrimination",
            "absent",
            "nenhuma diferença observável entre input definido e ocioso nesta janela; \
             resposta a input não demonstrada (lacuna, não sucesso)",
        )
    }
}

/// Referência de artefato com hash para o ledger; falha de leitura é erro
/// explícito, nunca referência sem hash.
pub fn artifact_ref(label: &str, path: &Path) -> Result<ArtifactRef, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("falha ao ler artefato '{}': {error}", path.display()))?;
    Ok(ArtifactRef {
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        sha256: crate::tools::reverse::decomp::rom_library::sha256_hex(&bytes),
    })
}

/// Matriz inicial honesta do perfil Mega Drive/cartucho (REX-00): nada é
/// `verified_for_profile` neste momento. Reconstrução por nós, extração
/// organizada, edição e patch continuam `unsupported`; emulação e análise
/// estática são `experimental` com lacunas explícitas.
pub fn default_md_capability_records(now_unix: u64) -> Vec<CapabilityRecord> {
    let profile = "megadrive/cart";
    let mut records = Vec::new();
    let mut push = |capability: &str, status: &str, gaps: Vec<&str>, note: &str| {
        records.push(CapabilityRecord {
            profile: profile.to_string(),
            capability: capability.to_string(),
            status: status.to_string(),
            gaps: gaps.into_iter().map(str::to_string).collect(),
            evidence_run_ids: Vec::new(),
            updated_at_unix: now_unix,
            note: note.to_string(),
        });
    };

    push(
        "identify",
        CAP_STATUS_EXPERIMENTAL,
        vec![
            "contêineres .smd/zip e dumps intercalados não normalizados",
            "mapper/EEPROM não inventariados",
        ],
        "loader/triage MD existem por conteúdo; normalização reversível é REX-02",
    );
    push(
        "inspect_code",
        CAP_STATUS_EXPERIMENTAL,
        vec![
            "sem IR precisa; Ghidra bridge e fingerprints são análise estática",
            "sem símbolos, fronteiras de função são heurísticas",
        ],
        "núcleo estático decomp em tools/reverse/decomp (Fase 0 Sprint 1)",
    );
    push(
        "extract",
        CAP_STATUS_UNSUPPORTED,
        vec!["nenhum extrator organizado por recurso com origem (REX-04)"],
        " candidatos de gráficos/texto no manifesto são heurística, não extração verificada",
    );
    push(
        "edit_asset",
        CAP_STATUS_UNSUPPORTED,
        vec!["nenhum editor de recurso com reexport reversível (REX-05/07)"],
        "",
    );
    push(
        "edit_logic",
        CAP_STATUS_UNSUPPORTED,
        vec!["nenhuma recuperação de comportamento editável (REX-09/10)"],
        "prévia importada Taiketsu tem lógica parcial e não equivale à referência",
    );
    push(
        "rebuild",
        CAP_STATUS_UNSUPPORTED,
        vec![
            "ROM→projeto reconstruído ausente; build de fonte SGDK é outra superfície",
            "prévia regenerada não preservou a engine (GUARD-SGDK-EQUIVALENCE-01)",
        ],
        "",
    );
    push(
        "emulate",
        CAP_STATUS_EXPERIMENTAL,
        vec![
            "sem tracing de PC/VDP/DMA por ciclo (core Libretro não expõe)",
            "hardware real não medido",
        ],
        "parity harness + emulador desktop com core real; capacidade por core",
    );
    push(
        "export_patch",
        CAP_STATUS_UNSUPPORTED,
        vec!["nenhum exportador de patch com hash de base e limites de escrita (REX-07)"],
        "",
    );
    records
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::parity_harness::{
        FrameHash, InputScript, PARITY_CONTRACT_REVISION, PARITY_REPORT_SCHEMA,
    };
    use crate::emulator::libretro_ffi::{JoypadState, MemoryRegionObservation};

    fn frame(index: u32, hash: &str, non_black: usize) -> FrameHash {
        FrameHash {
            frame_index: index,
            framebuffer_sha256: hash.to_string(),
            non_black_pixels: non_black,
        }
    }

    fn region(label: &str, region_id: u32, available: bool, sha: &str) -> MemoryRegionObservation {
        MemoryRegionObservation {
            label: label.to_string(),
            region_id,
            available,
            size: if available { 64 } else { 0 },
            sha256: if available {
                Some(sha.to_string())
            } else {
                None
            },
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn synthetic_report(
        rom_sha: &str,
        frame_hashes: Vec<FrameHash>,
        regions: Vec<MemoryRegionObservation>,
        final_state: &str,
        audio_sha: Option<&str>,
    ) -> ParityReport {
        ParityReport {
            schema: PARITY_REPORT_SCHEMA.to_string(),
            contract_revision: PARITY_CONTRACT_REVISION,
            rom_path: "synthetic".to_string(),
            rom_sha256: rom_sha.to_string(),
            core_label: "Genesis Plus GX test".to_string(),
            core_sha256: None,
            golden_path: None,
            golden_sha256: None,
            initial_state_sha256: None,
            frames_run: frame_hashes.len() as u32,
            frame_hashes,
            final_state_sha256: final_state.to_string(),
            audio: Some(AudioObservation {
                available: audio_sha.is_some(),
                sample_rate: 48000,
                samples_total: 100,
                stream_sha256: audio_sha.map(str::to_string),
                note: String::new(),
            }),
            observed_regions: regions,
            deterministic: true,
            divergences: Vec::new(),
            fake_toolchain_used: false,
            not_measured_by_this_harness: Vec::new(),
        }
    }

    #[test]
    fn identical_captures_pass_all_oracles() {
        let reference = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10), frame(1, "f1", 20)],
            vec![region("WRAM", 1, true, "w1"), region("VRAM", 2, true, "v1")],
            "state",
            Some("audio"),
        );
        let candidate = synthetic_report(
            "bbb",
            vec![frame(0, "f0", 10), frame(1, "f1", 20)],
            vec![region("WRAM", 1, true, "w1"), region("VRAM", 2, true, "v1")],
            "state",
            Some("audio"),
        );
        let report = evaluate_identical_equivalence(&reference, &candidate);
        assert_eq!(report.verdict, VERDICT_PASSED, "{:?}", report.oracles);
        assert!(report.gaps.is_empty());
    }

    /// O caso da prévia Taiketsu: candidato com imagem não preta e heartbeat
    /// (frames evoluindo) precisa ser REJEITADO pelos oráculos.
    #[test]
    fn non_black_and_heartbeat_alone_never_pass() {
        let reference = synthetic_report(
            "aaa",
            vec![frame(0, "ref0", 500), frame(1, "ref1", 500)],
            vec![
                region("WRAM", 1, true, "w-ref"),
                region("VRAM", 2, true, "v-ref"),
            ],
            "state-ref",
            Some("audio-ref"),
        );
        // Candidato "vivo": não preto, todos os frames distintos (heartbeat),
        // porém diferentes da referência em behavior e recursos.
        let candidate = synthetic_report(
            "bbb",
            vec![frame(0, "cand0", 16038), frame(1, "cand1", 16040)],
            vec![
                region("WRAM", 1, true, "w-cand"),
                region("VRAM", 2, true, "v-cand"),
            ],
            "state-cand",
            Some("audio-cand"),
        );
        let report = evaluate_identical_equivalence(&reference, &candidate);
        assert_eq!(report.verdict, VERDICT_REJECTED);
        let behavior = report
            .oracles
            .iter()
            .find(|oracle| oracle.name == "behavior_frames")
            .expect("behavior oracle");
        assert_eq!(behavior.status, ORACLE_STATUS_FAIL);
        let resources = report
            .oracles
            .iter()
            .find(|oracle| oracle.name == "resources")
            .expect("resources oracle");
        assert_eq!(resources.status, ORACLE_STATUS_FAIL);
        // A evidência de superfície está registrada — e não salvou o candidato.
        assert_eq!(
            report.surface_evidence.candidate_max_non_black_pixels,
            16040
        );
        assert_eq!(report.surface_evidence.candidate_distinct_framebuffers, 2);
    }

    #[test]
    fn region_missing_on_both_sides_is_gap_and_one_sided_is_rejection() {
        // SRAM não exposta pelos dois lados: lacuna registrada, não igualdade —
        // veredito indeterminado, nunca passed.
        let reference = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 1)],
            vec![region("WRAM", 1, true, "w1"), region("SRAM", 3, false, "")],
            "state",
            None,
        );
        let both_missing = synthetic_report(
            "bbb",
            vec![frame(0, "f0", 1)],
            vec![region("WRAM", 1, true, "w1"), region("SRAM", 3, false, "")],
            "state",
            None,
        );
        let report = evaluate_identical_equivalence(&reference, &both_missing);
        assert_eq!(report.verdict, VERDICT_INDETERMINATE, "missing não é igual");
        assert!(report
            .gaps
            .iter()
            .any(|gap| gap.contains("SRAM") && gap.contains("não verificada")));
        assert!(
            report
                .oracles
                .iter()
                .all(|oracle| oracle.status != ORACLE_STATUS_FAIL),
            "ausência simétrica não é falha, é lacuna"
        );

        // Disponível em apenas um lado é divergência real de recursos: rejeita.
        let only_reference = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 1)],
            vec![region("WRAM", 1, true, "w1"), region("SRAM", 3, true, "s1")],
            "state",
            None,
        );
        let rejected = evaluate_identical_equivalence(&only_reference, &both_missing);
        assert_eq!(rejected.verdict, VERDICT_REJECTED);
        assert!(rejected
            .gaps
            .iter()
            .any(|gap| gap.contains("SRAM") && gap.contains("ausente no candidato")));
    }

    #[test]
    fn empty_or_mismatched_scenario_never_passes() {
        let reference = synthetic_report("aaa", Vec::new(), Vec::new(), "state", None);
        let candidate = synthetic_report("bbb", Vec::new(), Vec::new(), "state", None);
        let report = evaluate_identical_equivalence(&reference, &candidate);
        assert_eq!(report.verdict, VERDICT_REJECTED, "zero frames não passa");

        let short = synthetic_report("bbb", vec![frame(0, "f0", 1)], Vec::new(), "state", None);
        let long = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 1), frame(1, "f1", 1)],
            Vec::new(),
            "state",
            None,
        );
        let mismatched = evaluate_identical_equivalence(&long, &short);
        assert_eq!(mismatched.verdict, VERDICT_REJECTED);
    }

    #[test]
    fn input_discrimination_reports_absent_instead_of_fake_success() {
        let with_inputs = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10), frame(1, "f1", 10)],
            Vec::new(),
            "state",
            None,
        );
        let idle = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10), frame(1, "f1", 10)],
            Vec::new(),
            "state",
            None,
        );
        let absent = scenario_input_discrimination(&with_inputs, &idle);
        assert_eq!(absent.status, "absent");
        assert!(absent.detail.contains("não demonstrada"));

        let reactive_idle = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10), frame(1, "idle1", 10)],
            Vec::new(),
            "state-idle",
            None,
        );
        let discriminating = scenario_input_discrimination(&with_inputs, &reactive_idle);
        assert_eq!(discriminating.status, ORACLE_STATUS_PASS);
    }

    #[test]
    fn default_capability_matrix_has_no_verified_profile_and_covers_all_axes() {
        let records = default_md_capability_records(0);
        let capabilities: Vec<&str> = records
            .iter()
            .map(|record| record.capability.as_str())
            .collect();
        for axis in CAPABILITY_AXES {
            assert!(
                capabilities.contains(&axis),
                "eixo {axis} ausente da matriz default"
            );
        }
        assert!(
            records.iter().all(|record| record.status
                != crate::tools::reverse::decomp::rom_library::CAP_STATUS_VERIFIED),
            "nenhuma capacidade pode nascer verified_for_profile"
        );
        assert!(records
            .iter()
            .all(|record| record.profile == "megadrive/cart"));
    }

    /// InputScript serializável e estável: o mesmo script define o cenário e é
    /// registrado por hash no ledger.
    #[test]
    fn input_script_round_trip_keeps_frames() {
        let script = InputScript::from_frames(vec![
            JoypadState::default(),
            JoypadState {
                start: true,
                ..JoypadState::default()
            },
        ]);
        let json = serde_json::to_string(&script).expect("serialize");
        let parsed: InputScript = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.frames.len(), 2);
        assert!(parsed.frames[1].start);
    }

    // ----- Regressões da revisão independente (REX-REV-04, 2026-09-11) -----
    // Testes adotados do relatório /home/misael/RetroDevStudio/review-rex-
    // 2026-09-11/REVIEW.md, com asserções preservadas.

    #[test]
    fn review_missing_observations_must_not_pass() {
        let mut r = synthetic_report("aaa", vec![], vec![], "", Some("audio"));
        r.frames_run = 180;
        assert_ne!(
            evaluate_identical_equivalence(&r, &r).verdict,
            VERDICT_PASSED,
            "empty framebuffer/regions/state accepted as observed equivalence"
        );
    }

    #[test]
    fn review_different_region_contract_must_not_pass() {
        let r = synthetic_report(
            "aaa",
            vec![frame(0, "f", 10)],
            vec![region("WRAM", 2, true, "h")],
            "s",
            Some("a"),
        );
        let mut c = r.clone();
        c.observed_regions[0].region_id = 99;
        c.observed_regions[0].size = 999;
        assert_ne!(
            evaluate_identical_equivalence(&r, &c).verdict,
            VERDICT_PASSED
        );
    }

    /// Frames declarados sem hashes correspondentes não são observação.
    #[test]
    fn declared_frame_count_without_hashes_is_not_evidence() {
        let mut reference = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10), frame(1, "f1", 20)],
            vec![region("WRAM", 1, true, "w")],
            "state",
            Some("audio"),
        );
        let mut candidate = reference.clone();
        candidate.frame_hashes.clear();
        candidate.frames_run = 2;
        let report = evaluate_identical_equivalence(&reference, &candidate);
        assert_eq!(report.verdict, VERDICT_REJECTED);

        // E no próprio lado da referência: contagem inflada rejeita.
        reference.frames_run = 5;
        let report = evaluate_identical_equivalence(&reference, &reference);
        assert_eq!(report.verdict, VERDICT_REJECTED);
    }

    /// Core diferente ou ausente é divergência de cenário, não igualdade.
    #[test]
    fn core_identity_mismatch_is_not_equivalence() {
        let base = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10)],
            vec![region("WRAM", 1, true, "w")],
            "state",
            Some("audio"),
        );
        let mut other_core = base.clone();
        other_core.core_label = "PicoDrive 2.05".to_string();
        assert_eq!(
            evaluate_identical_equivalence(&base, &other_core).verdict,
            VERDICT_REJECTED
        );

        let mut anonymous = base.clone();
        anonymous.core_label = String::new();
        assert_eq!(
            evaluate_identical_equivalence(&base, &anonymous).verdict,
            VERDICT_REJECTED
        );
    }

    /// Estado final vazio é ausência de evidência (missing), nunca igualdade.
    #[test]
    fn empty_final_state_is_missing_not_equal() {
        let reference = synthetic_report(
            "aaa",
            vec![frame(0, "f0", 10)],
            vec![region("WRAM", 1, true, "w")],
            "",
            Some("audio"),
        );
        let candidate = synthetic_report(
            "bbb",
            vec![frame(0, "f0", 10)],
            vec![region("WRAM", 1, true, "w")],
            "",
            Some("audio"),
        );
        let report = evaluate_identical_equivalence(&reference, &candidate);
        assert_ne!(report.verdict, VERDICT_PASSED);
        assert!(report
            .gaps
            .iter()
            .any(|gap| gap.contains("estado final ausente")));
    }
}
