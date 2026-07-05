import type { ActionableDiagnostic } from "./diagnostics";

export interface CapabilityEvidenceRef {
  kind: string;
  path: string;
  summary: string;
}

export interface CapabilityAxisReport {
  status: string;
  maturity: string;
  evidence_refs: CapabilityEvidenceRef[];
  blocking_statuses: string[];
  warnings: string[];
  next_actions: string[];
  experimental: boolean;
  source: string | null;
  owner: string | null;
  diagnostics: ActionableDiagnostic[];
}

export interface ParityFrameHash {
  frame_index: number;
  framebuffer_sha256: string;
  non_black_pixels: number;
}

export interface ParityDivergence {
  frame_index: number;
  kind: string;
  expected: string;
  observed: string;
}

export interface ParityReport {
  schema: string;
  rom_path: string;
  rom_sha256: string;
  core_label: string;
  frames_run: number;
  frame_hashes: ParityFrameHash[];
  final_state_sha256: string;
  deterministic: boolean;
  divergences: ParityDivergence[];
  fake_toolchain_used: boolean;
  not_measured_by_this_harness: string[];
}

export interface ParityRunResult {
  ok: boolean;
  message: string;
  golden_path: string;
  golden_source: string;
  frames_run: number;
  deterministic: boolean;
  divergence_count: number;
  report_path: string;
  report: ParityReport | null;
}

export interface CrossCoreDivergence {
  frame_index: number;
  kind: string;
  core_a_hash: string;
  core_b_hash: string;
  core_a_non_black: number;
  core_b_non_black: number;
}

export interface CrossCoreReport {
  schema: string;
  rom_path: string;
  rom_sha256: string;
  golden_path: string;
  golden_source: string;
  core_a_label: string;
  core_b_label: string;
  frames_run: number;
  report_a: ParityReport;
  report_b: ParityReport;
  cross_divergences: CrossCoreDivergence[];
  cores_agree: boolean;
  not_measured_by_this_harness: string[];
  report_path?: string;
}

export interface CrossCoreParityResult {
  ok: boolean;
  message: string;
  golden_path: string;
  golden_source: string;
  core_a_label: string;
  core_b_label: string;
  frames_run: number;
  cores_agree: boolean;
  cross_divergence_count: number;
  core_a_divergence_count: number;
  core_b_divergence_count: number;
  report_path: string;
  report: CrossCoreReport | null;
}

export interface CycleFrameSample {
  frame_index: number;
  host_frame_time_micros?: number | null;
  estimated_frame_budget_cycles?: number | null;
  estimate_label?: string | null;
}

export interface CycleEvidenceSource {
  kind: string;
  label: string;
  path: string;
  observed: boolean;
}

export interface CycleTraceEvidence {
  status: "observed" | "missing" | string;
  source: string;
  detail: string;
}

export interface CycleReportLimitations {
  not_cycle_accurate: boolean;
  missing: string[];
  notes: string[];
}

export interface CycleReport {
  schema: string;
  rom_path: string;
  rom_sha256: string;
  golden_path: string;
  core_label: string;
  frames_run: number;
  frame_samples: CycleFrameSample[];
  evidence_sources: CycleEvidenceSource[];
  m68k_cycle_trace: CycleTraceEvidence;
  z80_cycle_trace: CycleTraceEvidence;
  vdp_scanline_trace: CycleTraceEvidence;
  dma_timing: CycleTraceEvidence;
  limitations: CycleReportLimitations;
  report_path: string;
}

export interface CycleReportResult {
  ok: boolean;
  message: string;
  golden_path: string;
  core_label: string;
  frames_run: number;
  report_path: string;
  report: CycleReport | null;
}

export type ParityEvidenceLevel =
  | "insufficient_evidence"
  | "visual_parity"
  | "observed_state_parity"
  | "scenario_evidence"
  | "functional_evidence";

export interface MemoryRegionObservation {
  label: string;
  region_id: number;
  available: boolean;
  size: number;
  sha256: string | null;
}

export interface ObservedState {
  available: boolean;
  reference_regions: MemoryRegionObservation[];
  candidate_regions: MemoryRegionObservation[];
}

export interface ReferenceCandidateComparison {
  evidence_level: ParityEvidenceLevel;
  visual_parity: boolean;
  observed_state_parity: boolean;
  scenario_passed: boolean;
  frames_compared: number;
  reference_rom_sha256: string;
  candidate_rom_sha256: string;
  divergences: ParityDivergence[];
  limitations: string[];
}

export interface ReferenceCandidateReport {
  schema: string;
  reference_rom_path: string;
  reference_rom_sha256: string;
  candidate_rom_path: string;
  candidate_rom_sha256: string;
  core_label: string;
  core_sha256: string;
  golden_path: string;
  golden_source: string;
  frames_run: number;
  report_reference: ParityReport;
  report_candidate: ParityReport;
  comparison: ReferenceCandidateComparison;
  observed_state: ObservedState;
  functional_evidence: ParityEvidenceLevel;
  not_measured_by_this_harness: string[];
}

export interface ReferenceCandidateParityResult {
  ok: boolean;
  message: string;
  core_label: string;
  golden_path: string;
  golden_source: string;
  frames_run: number;
  // Debug-formatted enum from the backend (e.g. "VisualParity"); the nested
  // comparison carries the serde snake_case union.
  evidence_level: string;
  visual_parity: boolean;
  observed_state_parity: boolean;
  scenario_passed: boolean;
  divergence_count: number;
  reference_rom_sha256: string;
  candidate_rom_sha256: string;
  report_path: string;
  report: ReferenceCandidateReport | null;
}

export interface ProjectCapabilityReport {
  project_dir: string;
  documentation: CapabilityAxisReport;
  implementation: CapabilityAxisReport;
  build: CapabilityAxisReport;
  rom: CapabilityAxisReport;
  emulation: CapabilityAxisReport;
  runtime_evidence: CapabilityAxisReport;
  gameplay_parity: CapabilityAxisReport;
  visual_validation: CapabilityAxisReport;
  assets: CapabilityAxisReport;
  patterns: CapabilityAxisReport;
  runtime_contracts: CapabilityAxisReport;
  audio: CapabilityAxisReport;
  blockers: ActionableDiagnostic[];
}

export interface RomMasteringReport {
  source_path: string;
  extension: string;
  size_bytes: number;
  alignment: string;
  sha256: string;
  platform: string | null;
  header_signature: string | null;
  internal_title: string | null;
  region: { value: string | null; status: string };
  sram: { present: boolean; status: string; range: string | null };
  checksum: { expected: string | null; observed: string | null; status: string };
  emulator_core: string | null;
  warnings: string[];
  blockers: ActionableDiagnostic[];
}

export interface RuntimeContract {
  id: string;
  title: string;
  state: "declared" | "observed" | "missing" | "not_applicable" | string;
  evidence_refs: CapabilityEvidenceRef[];
  warnings: string[];
  next_actions: string[];
  experimental: boolean;
}

export interface RuntimeContractsReport {
  project_dir: string;
  axis: CapabilityAxisReport;
  runtime_evidence: CapabilityAxisReport;
  contracts: Record<string, RuntimeContract>;
}

export interface AssetQualityEntry {
  path: string;
  source_art: string;
  lineage: string[];
  palette: { status: string; detail: string };
  palette_color_count: number;
  index_zero_transparency: { status: string; detail: string };
  tile_efficiency: { status: string; detail: string };
  duplicate_tiles: { total_tiles: number; unique_tiles: number; duplicate_count: number };
  res_compression: { status: string; detail: string };
  source_to_rom_map: string[];
  warnings: string[];
  blockers: string[];
  next_actions: string[];
}

export interface AssetQualityReport {
  project_dir: string;
  axis: CapabilityAxisReport;
  assets: AssetQualityEntry[];
}

export interface AudioPipelineEntry {
  path: string;
  kind: string;
  sample_rate: { status: string; detail: string };
  clipping: { detected: boolean; clipped_samples: number };
  dc_offset: { value: number; normalized_abs: number; status: string };
  padding: { status: string; detail: string };
  sfx_priority: { status: string; detail: string };
  channel_ownership: { status: string; detail: string };
  memory_risks: string[];
  warnings: string[];
  next_actions: string[];
}

export interface AudioPipelineReport {
  project_dir: string;
  axis: CapabilityAxisReport;
  entries: AudioPipelineEntry[];
}

export interface SgdkPatternNodeTemplate {
  node_type: string;
  label: string;
  params: Record<string, string>;
}

export interface SgdkPatternTemplate {
  id: string;
  title: string;
  origin: string;
  technical_description: string;
  requirements: string[];
  risks: string[];
  targets_supported: string[];
  nodes_generated: SgdkPatternNodeTemplate[];
  hardware_warnings: string[];
  maturity: string;
  experimental: boolean;
}

export const CAPABILITY_AXIS_LABELS: Array<[keyof ProjectCapabilityReport, string]> = [
  ["documentation", "Documentacao"],
  ["implementation", "Implementacao"],
  ["build", "Build"],
  ["rom", "ROM"],
  ["emulation", "Emulacao"],
  ["runtime_evidence", "Runtime Evidence"],
  ["gameplay_parity", "Gameplay Parity"],
  ["visual_validation", "Visual"],
  ["assets", "Assets"],
  ["patterns", "Patterns"],
  ["runtime_contracts", "Contratos"],
  ["audio", "Audio"],
];

export function capabilityTone(status: string): "ok" | "warn" | "block" | "muted" {
  if (["success", "observed", "declared", "matching", "valid", "ok"].includes(status)) {
    return "ok";
  }
  if (["blocked", "mismatch", "invalid", "error"].includes(status)) {
    return "block";
  }
  if (["not_instrumented", "missing", "partial"].includes(status)) {
    return "warn";
  }
  return "muted";
}

export function capabilityStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
