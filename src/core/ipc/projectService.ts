import { invoke } from "@tauri-apps/api/core";
import type { SgdkImportSummary } from "../sgdkLogicDiagnostics";

export interface OpenProjectResult {
  selected: boolean;
  path: string;
  name: string;
  base_dir?: string | null;
  notice?: string | null;
  preferred_scene_path?: string | null;
  imported_scene_paths?: string[];
  import_summary?: SgdkImportSummary | null;
}

export interface OpenProjectSourceResult {
  ok: boolean;
  message: string;
  absolute_path?: string | null;
}

export type ProjectDestinationCollisionStatus =
  | "available"
  | "occupied"
  | "existing_project";

export interface ProjectDestinationPreview {
  requested_name: string;
  suggested_name: string;
  requested_dir_name: string;
  suggested_dir_name: string;
  preferred_path: string;
  resolved_path: string;
  collision_status: ProjectDestinationCollisionStatus;
  existing_project_path?: string | null;
  existing_project_name?: string | null;
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

export interface ExternalImportProfileSummary {
  id: string;
  name: string;
  family: string;
  description: string;
  source_engine: string;
  support_status: string;
  supported_levels: string[];
  recommended_target: "megadrive" | "snes";
  experimental: boolean;
  importable: boolean;
  mega_drive_only: boolean;
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

export function previewProjectDestination(
  projectName: string,
  baseDir: string
): Promise<ProjectDestinationPreview> {
  return invoke("preview_project_destination", { projectName, baseDir });
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

export function listExternalImportProfiles(): Promise<ExternalImportProfileSummary[]> {
  return invoke("list_external_import_profiles");
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

export function importMugenProject(
  projectName: string,
  baseDir: string,
  mugenPath: string
): Promise<OpenProjectResult> {
  return invoke("import_mugen_project", {
    projectName,
    baseDir,
    mugenPath,
  });
}

export function importExternalProject(
  projectName: string,
  baseDir: string,
  profileId: string,
  projectPath: string
): Promise<OpenProjectResult> {
  return invoke("import_external_project", {
    projectName,
    baseDir,
    profileId,
    projectPath,
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

export function openProjectSourcePath(
  projectDir: string,
  relativePath: string
): Promise<OpenProjectSourceResult> {
  return invoke("open_project_source_path", { projectDir, relativePath });
}
