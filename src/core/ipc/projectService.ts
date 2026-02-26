import { invoke } from "@tauri-apps/api/core";

export interface OpenProjectResult {
  selected: boolean;
  path: string;
  name: string;
}

export function openProjectDialog(): Promise<OpenProjectResult> {
  return invoke("open_project_dialog");
}

export function newProjectDialog(projectName: string): Promise<OpenProjectResult> {
  return invoke("new_project_dialog", { projectName });
}

export function setProjectTarget(
  projectDir: string,
  target: "megadrive" | "snes"
): Promise<{ ok: boolean; message: string }> {
  return invoke("set_project_target", { projectDir, target });
}
