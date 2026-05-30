import { invoke } from "@tauri-apps/api/core";
import type {
  SgdkHardwareConstraintReport,
  SgdkNodeCoverageReport,
  SgdkNodeGraphExportReport,
  SgdkRoundTripReport,
  SgdkSemanticIrReport,
  SgdkSemanticReportBundle,
} from "../sgdkSemantic";

export function inspectSgdkSemanticIr(
  sgdkPath: string,
  reportDir?: string | null
): Promise<SgdkSemanticIrReport> {
  return invoke<SgdkSemanticIrReport>("inspect_sgdk_semantic_ir", {
    sgdkPath,
    reportDir: reportDir ?? null,
  });
}

export function inspectSgdkNodeCoverage(
  sgdkPath: string,
  reportDir?: string | null
): Promise<SgdkNodeCoverageReport> {
  return invoke<SgdkNodeCoverageReport>("inspect_sgdk_node_coverage", {
    sgdkPath,
    reportDir: reportDir ?? null,
  });
}

export function exportSgdkSemanticNodeGraph(
  sgdkPath: string,
  reportDir?: string | null
): Promise<SgdkNodeGraphExportReport> {
  return invoke<SgdkNodeGraphExportReport>("export_sgdk_semantic_node_graph", {
    sgdkPath,
    reportDir: reportDir ?? null,
  });
}

export function runSgdkSemanticRoundtrip(
  sgdkPath: string,
  reportDir: string
): Promise<SgdkRoundTripReport> {
  return invoke<SgdkRoundTripReport>("run_sgdk_semantic_roundtrip", {
    sgdkPath,
    reportDir,
  });
}

export function inspectSgdkHardwareConstraints(
  sgdkPath: string,
  reportDir?: string | null
): Promise<SgdkHardwareConstraintReport> {
  return invoke<SgdkHardwareConstraintReport>("inspect_sgdk_hardware_constraints", {
    sgdkPath,
    reportDir: reportDir ?? null,
  });
}

export function generateSgdkSemanticReports(
  sgdkPath: string,
  reportDir: string
): Promise<SgdkSemanticReportBundle> {
  return invoke<SgdkSemanticReportBundle>("generate_sgdk_semantic_reports", {
    sgdkPath,
    reportDir,
  });
}
