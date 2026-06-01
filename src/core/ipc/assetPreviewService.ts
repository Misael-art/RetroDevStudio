import { invoke } from "@tauri-apps/api/core";

export interface ProjectAssetPreviewPayload {
  ok: boolean;
  relative_path: string;
  absolute_path: string;
  mime_type: string | null;
  base64: string | null;
  error: string | null;
}

export function readProjectAssetPreview(
  projectDir: string,
  relativePath: string
): Promise<ProjectAssetPreviewPayload> {
  if (typeof invoke !== "function") {
    return Promise.reject(new Error("Tauri invoke indisponivel para preview de asset."));
  }
  return invoke<ProjectAssetPreviewPayload>("read_project_asset_preview", {
    projectDir,
    relativePath,
  });
}

export function dataUrlFromPreviewPayload(payload: ProjectAssetPreviewPayload): string | null {
  if (!payload.ok || !payload.base64 || !payload.mime_type) {
    return null;
  }
  return `data:${payload.mime_type};base64,${payload.base64}`;
}

export function blobFromPreviewPayload(payload: ProjectAssetPreviewPayload): Blob | null {
  if (!payload.ok || !payload.base64 || !payload.mime_type) {
    return null;
  }

  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: payload.mime_type });
}

export function textFromPreviewPayload(payload: ProjectAssetPreviewPayload): string | null {
  if (!payload.ok || !payload.base64) {
    return null;
  }

  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8").decode(bytes);
}
