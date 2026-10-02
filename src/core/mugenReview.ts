import { invoke } from "@tauri-apps/api/core";
import type { MugenImportReport, MugenReportDiagnostic } from "./mugenCompatibility";

export interface MugenReviewOptions {
  def_file: string;
  actions: number[];
  palette_file: string | null;
  authored_demo: boolean;
  original_chain?: boolean;
  chain_state?: number | null;
  source_sha256: string | null;
}
export interface MugenChainSource { file: string; section: string; line: number; text: string }
export interface MugenChainOperation {
  id: string; kind: string; class: "converted" | "approximate" | "authored" | "unconverted";
  source: MugenChainSource | null; implementation: string; test: string; limit: string;
}
export interface MugenChainReport {
  status: string; notice?: string; program_sha256?: string; command_bits?: string[];
  summary?: { converted: number; approximate: number; authored: number; unconverted: number };
  dependencies?: Array<{ name: string | null; declared_in?: string; status: string; sha256: string | null; consequence: string }>;
  state_status?: Array<{ state: number; origin: string; converted: number; unconverted: number; verdict: "completo" | "parcial" | "autoral" }>;
  operations?: MugenChainOperation[];
  unconverted_controllers?: Array<{ id: string; source: MugenChainSource; reason: string }>;
  errors?: string[];
}
export interface MugenChainCandidates {
  available: Array<{ state: number; commands: string[]; entries: Array<{ source: MugenChainSource }> }>;
  refused: Array<{ state: number; reason: string }>;
}
export interface MugenVisualFrame {
  action: number; element: number; group: number; image: number;
  sprite_size: [number, number]; sprite_axis: [number, number]; offset: [number, number];
  hflip: boolean; vflip: boolean; duration: number;
  indices_sha256: string; palette_sha256: string;
  original_sha256: string; converted_sha256: string;
  original_png: string; converted_png: string;
}
export interface MugenVisualReview {
  width: number; height: number; anchor: [number, number];
  frames: MugenVisualFrame[]; loop_start: Record<string, number>; note: string;
}
export interface MugenSourceAnalysis {
  legacy_kind?: "stage" | "screenpack";
  format?: {file: string; format: string; version: number[]};
  sprites?: Array<{group: number; image: number; size: [number,number]; axis: [number,number]; offset: number}>;
  source_sha256: string; selected_def: string | null;
  defs: Array<{ file: string; name: string }>;
  references: Array<{ key: string; requested: string; resolved: string | null; status: string; sha256: string | null }>;
  actions: Array<{ number: number; frames: number; line: number }>;
  palettes: string[]; diagnostics: MugenReportDiagnostic[];
  options?: MugenReviewOptions;
  original_chain?: MugenChainReport;
  original_chain_candidates?: MugenChainCandidates;
  report: (MugenImportReport & { visual_review?: MugenVisualReview }) | null;
}
export function analyzeMugenSource(projectPath: string, options?: MugenReviewOptions) {
  return invoke<MugenSourceAnalysis>("analyze_mugen_source", { projectPath, options: options ?? null });
}

export function visualReviewOf(report: MugenImportReport): MugenVisualReview | null {
  const v = report.visual_review as MugenVisualReview | undefined;
  return v && Array.isArray(v.frames) && v.frames.length > 0 ? v : null;
}
