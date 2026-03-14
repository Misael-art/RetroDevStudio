import { invoke } from "@tauri-apps/api/core";

export interface OpenProjectResult {
  selected: boolean;
  path: string;
  name: string;
}

export function openProjectDialog(): Promise<OpenProjectResult> {
  return invoke("open_project_dialog");
}

export function openProjectPath(projectDir: string): Promise<OpenProjectResult> {
  return invoke("open_project_path", { projectDir });
}

export function newProjectDialog(projectName: string): Promise<OpenProjectResult> {
  return invoke("new_project_dialog", { projectName });
}

export function createOnboardingProject(
  projectName: string,
  target: "megadrive" | "snes",
  baseDir: string
): Promise<OpenProjectResult> {
  return invoke("create_onboarding_project", { projectName, target, baseDir });
}

export function setProjectTarget(
  projectDir: string,
  target: "megadrive" | "snes"
): Promise<{ ok: boolean; message: string }> {
  return invoke("set_project_target", { projectDir, target });
}
