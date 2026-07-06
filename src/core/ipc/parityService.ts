import { invoke } from "@tauri-apps/api/core";
import type {
  CrossCoreParityResult,
  CrossCoreReport,
  CycleReport,
  CycleReportResult,
  ParityReport,
  ParityRunResult,
  ReferenceCandidateParityResult,
  ReferenceCandidateReport,
} from "../projectCapability";

export async function runParityCapture(
  projectDir: string,
  goldenPath: string,
  frames?: number | null
): Promise<ParityRunResult> {
  return invoke<ParityRunResult>("parity_run_capture", {
    projectDir,
    goldenPath,
    frames: frames ?? null,
  });
}

export async function runCrossCoreParity(
  projectDir: string,
  goldenPath: string,
  coreAPath: string,
  coreBPath: string,
  frames?: number | null
): Promise<CrossCoreParityResult> {
  return invoke<CrossCoreParityResult>("parity_run_cross_core", {
    projectDir,
    goldenPath,
    coreAPath,
    coreBPath,
    frames: frames ?? null,
  });
}

export async function runCycleReport(
  projectDir: string,
  goldenPath: string,
  corePath: string,
  frames?: number | null
): Promise<CycleReportResult> {
  return invoke<CycleReportResult>("parity_run_cycle_report", {
    projectDir,
    goldenPath,
    corePath,
    frames: frames ?? null,
  });
}

export async function runReferenceCandidateParity(
  referenceProjectDir: string,
  candidateProjectDir: string,
  goldenPath: string,
  corePath: string,
  frames?: number | null
): Promise<ReferenceCandidateParityResult> {
  return invoke<ReferenceCandidateParityResult>("parity_run_reference_candidate", {
    referenceProjectDir,
    candidateProjectDir,
    goldenPath,
    corePath,
    frames: frames ?? null,
  });
}

export function formatReferenceCandidateSummary(
  report: ReferenceCandidateReport
): string {
  const comparison = report.comparison;
  const divergenceText =
    comparison.divergences.length === 1
      ? "1 divergencia"
      : `${comparison.divergences.length} divergencias`;
  return `reference/candidate: ${report.frames_run} frame(s), evidence=${comparison.evidence_level}, suite=${report.functional_evidence}, ${divergenceText} (core=${report.core_label})`;
}

export function referenceCandidateReportFromResult(
  result: ReferenceCandidateParityResult
): ReferenceCandidateReport | null {
  return result.report ?? null;
}

/**
 * Resume a evidencia real observada (revisao 2 do contrato): audio via
 * callbacks Libretro e regioes de memoria expostas pelo core. Reports antigos
 * (revisao 1) retornam "nao_medido"/"nao_medidas" em vez de dados fabricados.
 */
export function formatParityEvidenceDetails(report: ParityReport): string {
  const audio = report.audio
    ? report.audio.available
      ? "observado"
      : "indisponivel"
    : "nao_medido";
  const regions = report.observed_regions ?? [];
  let regionText = "nao_medidas";
  if (regions.length > 0) {
    const observed = regions.filter((region) => region.available).map((region) => region.label);
    const missing = regions.filter((region) => !region.available).map((region) => region.label);
    regionText = observed.length > 0 ? observed.join("/") : "nenhuma";
    if (missing.length > 0) {
      regionText += ` (indisponiveis: ${missing.join("/")})`;
    }
  }
  return `audio=${audio}, regioes=${regionText}`;
}

export function formatParitySummary(report: ParityReport): string {
  const determinism = report.deterministic ? "sim" : "nao";
  const divergenceText =
    report.divergences.length === 1
      ? "1 divergencia"
      : `${report.divergences.length} divergencias`;
  return `parity: ${report.frames_run} frame(s), deterministico=${determinism}, ${divergenceText}`;
}

export function formatCrossCoreSummary(report: CrossCoreReport): string {
  const agreeText = report.cores_agree ? "sim" : "nao";
  const divergenceText =
    report.cross_divergences.length === 1
      ? "1 divergencia"
      : `${report.cross_divergences.length} divergencias`;
  return `cross-core: ${report.frames_run} frame(s), cores_agree=${agreeText}, ${divergenceText} (A=${report.core_a_label}, B=${report.core_b_label})`;
}

export function formatCycleReportSummary(report: CycleReport): string {
  return `cycle report: ${report.frames_run} frame(s), m68k=${report.m68k_cycle_trace.status}, z80=${report.z80_cycle_trace.status}, vdp=${report.vdp_scanline_trace.status}, dma=${report.dma_timing.status}, not_cycle_accurate=${report.limitations.not_cycle_accurate}`;
}

export function parityReportFromResult(result: ParityRunResult): ParityReport | null {
  return result.report ?? null;
}

export function crossCoreReportFromResult(
  result: CrossCoreParityResult
): CrossCoreReport | null {
  return result.report ?? null;
}

export function cycleReportFromResult(result: CycleReportResult): CycleReport | null {
  return result.report ?? null;
}
