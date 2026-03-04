import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

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

export type ThirdPartyDependencyId =
  | "sgdk"
  | "pvsneslib"
  | "libretro_megadrive"
  | "libretro_snes";

export interface DependencyLogLine {
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface DependencyStatus {
  id: ThirdPartyDependencyId | string;
  label: string;
  installed: boolean;
  version: string | null;
  install_dir: string;
  source_url: string;
  auto_install_supported: boolean;
  notes: string[];
  issues: string[];
}

export interface DependencyStatusReport {
  items: DependencyStatus[];
}

export interface DependencyInstallResult {
  ok: boolean;
  dependency_id: string;
  message: string;
  status: DependencyStatus;
  log: DependencyLogLine[];
}

export interface RomDependencyResult {
  dependency_id: string;
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

export function getThirdPartyStatus(): Promise<DependencyStatusReport> {
  return invoke<DependencyStatusReport>("third_party_get_status");
}

export function detectRomDependency(romPath: string): Promise<RomDependencyResult> {
  return invoke<RomDependencyResult>("third_party_detect_rom_dependency", { romPath });
}

export async function installThirdPartyDependency(
  dependencyId: ThirdPartyDependencyId | string,
  onLog: (line: DependencyLogLine) => void
): Promise<DependencyInstallResult> {
  const unlisten: UnlistenFn = await listen<DependencyLogLine>("deps://log", (event) => {
    onLog(event.payload);
  });

  try {
    return await invoke<DependencyInstallResult>("third_party_install", { dependencyId });
  } finally {
    unlisten();
  }
}
