import { invoke } from "@tauri-apps/api/core";

// ── Types (mirror do Rust) ────────────────────────────────────────────────────

export interface PatchResult {
  ok: boolean;
  message: string;
  bytes_changed: number;
}

export interface ProfileIssue {
  severity: "Info" | "Warning" | "Error";
  message: string;
}

export interface ProfileReport {
  ok: boolean;
  error: string;
  dma_heatmap: number[];      // 224 entries — bytes/scanline
  sprite_heatmap: number[];   // 224 entries — sprites/scanline
  dma_total_bytes: number;
  sprite_peak: number;
  sprite_count: number;
  issues: ProfileIssue[];
}

export interface ExtractionResult {
  ok: boolean;
  error: string;
  tiles_extracted: number;
  palettes_extracted: number;
  files: string[];
}

// ── Patch Studio ──────────────────────────────────────────────────────────────

export function patchCreateIps(originalPath: string, modifiedPath: string, patchPath: string): Promise<PatchResult> {
  return invoke("patch_create_ips", { originalPath, modifiedPath, patchPath });
}

export function patchApplyIps(romPath: string, patchPath: string, outputPath: string): Promise<PatchResult> {
  return invoke("patch_apply_ips", { romPath, patchPath, outputPath });
}

export function patchCreateBps(originalPath: string, modifiedPath: string, patchPath: string): Promise<PatchResult> {
  return invoke("patch_create_bps", { originalPath, modifiedPath, patchPath });
}

export function patchApplyBps(romPath: string, patchPath: string, outputPath: string): Promise<PatchResult> {
  return invoke("patch_apply_bps", { romPath, patchPath, outputPath });
}

// ── Deep Profiler ─────────────────────────────────────────────────────────────

export function profilerAnalyzeRom(romPath: string): Promise<ProfileReport> {
  return invoke("profiler_analyze_rom", { romPath });
}

// ── Asset Extractor ───────────────────────────────────────────────────────────

export function assetsExtract(
  romPath: string,
  outputDir: string,
  maxTiles: number,
  paletteSlot: number
): Promise<ExtractionResult> {
  return invoke("assets_extract", { romPath, outputDir, maxTiles, paletteSlot });
}
