import { invoke } from "@tauri-apps/api/core";
import { HwStatus } from "../store/editorStore";

/**
 * Solicita ao backend o status de hardware atual para um projeto.
 * Passa string vazia para obter um status zerado (projeto novo / sem dados).
 */
export function getHwStatus(projectDir: string): Promise<HwStatus> {
  return invoke<HwStatus>("get_hw_status", { projectDir });
}
