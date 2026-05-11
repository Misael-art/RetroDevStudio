import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ProjectAssetWatchResult {
  changed: boolean;
  changed_paths: string[];
}

export interface ProjectAssetsChangedPayload {
  project_dir: string;
  changed_paths: string[];
}

export function pollProjectAssetChanges(projectDir: string): Promise<ProjectAssetWatchResult> {
  return invoke<ProjectAssetWatchResult>("poll_project_asset_changes", { projectDir });
}

export async function listenToProjectAssetChanges(
  onChange: (payload: ProjectAssetsChangedPayload) => void
): Promise<UnlistenFn> {
  return listen<ProjectAssetsChangedPayload>("project://assets-changed", (event) => {
    onChange(event.payload);
  });
}
