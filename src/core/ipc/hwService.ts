import { invoke } from "@tauri-apps/api/core";
import type { HwStatus } from "../store/editorStore";

export interface DraftValidationResult {
  ok: boolean;
  error: string;
  hw_status: HwStatus;
}

/**
 * Solicita ao backend o status de hardware atual para um projeto.
 * Passa string vazia para obter um status zerado (projeto novo / sem dados).
 */
export function getHwStatus(projectDir: string): Promise<HwStatus> {
  return invoke<HwStatus>("get_hw_status", { projectDir });
}

export function validateSceneDraft(
  projectDir: string,
  sceneJson: string
): Promise<DraftValidationResult> {
  return invoke<DraftValidationResult>("validate_scene_draft", { projectDir, sceneJson });
}
