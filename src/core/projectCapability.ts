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

export interface ProjectCapabilityReport {
  project_dir: string;
  documentation: CapabilityAxisReport;
  implementation: CapabilityAxisReport;
  build: CapabilityAxisReport;
  rom: CapabilityAxisReport;
  emulation: CapabilityAxisReport;
  runtime_evidence: CapabilityAxisReport;
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
