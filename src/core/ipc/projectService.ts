import { invoke } from "@tauri-apps/api/core";

export interface OpenProjectResult {
  selected: boolean;
  path: string;
  name: string;
  base_dir?: string | null;
  notice?: string | null;
}

export interface ProjectTemplateSummary {
  id: string;
  name: string;
  description: string;
  genre: string;
  difficulty: string;
  features: string[];
  source_kind: string;
  recommended_target: "megadrive" | "snes";
  experimental: boolean;
  available: boolean;
  availability_reason?: string | null;
  default_donor_path?: string | null;
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

export function suggestProjectBaseDir(): Promise<string> {
  return invoke("suggest_project_base_dir");
}

export function createOnboardingProject(
  projectName: string,
  target: "megadrive" | "snes",
  baseDir: string
): Promise<OpenProjectResult> {
  return invoke("create_onboarding_project", { projectName, target, baseDir });
}

export function listProjectTemplates(): Promise<ProjectTemplateSummary[]> {
  return invoke("list_project_templates");
}

export function createProjectFromTemplate(
  projectName: string,
  target: "megadrive" | "snes",
  baseDir: string,
  templateId: string,
  donorPath?: string
): Promise<OpenProjectResult> {
  return invoke("create_project_from_template", {
    projectName,
    target,
    baseDir,
    templateId,
    donorPath,
  });
}

export function importSgdkProject(
  projectName: string,
  baseDir: string,
  sgdkPath: string
): Promise<OpenProjectResult> {
  return invoke("import_sgdk_project", {
    projectName,
    baseDir,
    sgdkPath,
  });
}

export function importLegacySgdkProject(
  projectName: string,
  sgdkPath: string
): Promise<OpenProjectResult> {
  return invoke("import_legacy_sgdk_project", {
    projectName,
    sgdkPath,
  });
}

export function setProjectTarget(
  projectDir: string,
  target: "megadrive" | "snes"
): Promise<{ ok: boolean; message: string }> {
  return invoke("set_project_target", { projectDir, target });
}
