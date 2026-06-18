import { invoke } from "@tauri-apps/api/core";
import type { ParityReport, ParityRunResult } from "../projectCapability";

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

export function formatParitySummary(report: ParityReport): string {
  const determinism = report.deterministic ? "sim" : "nao";
  const divergenceText =
    report.divergences.length === 1
      ? "1 divergencia"
      : `${report.divergences.length} divergencias`;
  return `parity: ${report.frames_run} frame(s), deterministico=${determinism}, ${divergenceText}`;
}

export function parityReportFromResult(result: ParityRunResult): ParityReport | null {
  return result.report ?? null;
}
