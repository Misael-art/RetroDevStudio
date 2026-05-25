import { invoke } from "@tauri-apps/api/core";
import type {
  AssetQualityReport,
  AudioPipelineReport,
  ProjectCapabilityReport,
  RomMasteringReport,
  RuntimeContractsReport,
  SgdkPatternTemplate,
} from "../projectCapability";

export function inspectProjectCapability(projectDir: string): Promise<ProjectCapabilityReport> {
  return invoke<ProjectCapabilityReport>("inspect_project_capability", { projectDir });
}

export function inspectRomMastering(romPath: string): Promise<RomMasteringReport> {
  return invoke<RomMasteringReport>("inspect_rom_mastering", { romPath });
}

export function inspectRuntimeContracts(projectDir: string): Promise<RuntimeContractsReport> {
  return invoke<RuntimeContractsReport>("inspect_runtime_contracts", { projectDir });
}

export function inspectAudioPipeline(projectDir: string): Promise<AudioPipelineReport> {
  return invoke<AudioPipelineReport>("inspect_audio_pipeline", { projectDir });
}

export function listSgdkPatternTemplates(): Promise<SgdkPatternTemplate[]> {
  return invoke<SgdkPatternTemplate[]>("list_sgdk_pattern_templates");
}

export function inspectAssetQuality(
  projectDir: string,
  assetIdOrPath?: string | null
): Promise<AssetQualityReport> {
  return invoke<AssetQualityReport>("inspect_asset_quality", {
    projectDir,
    assetIdOrPath: assetIdOrPath ?? null,
  });
}
