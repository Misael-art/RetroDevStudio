import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Utilitário para resolução de caminhos de assets do projeto.
 * Usado por ViewportPanel, InspectorPanel e outros componentes que precisam
 * converter caminhos relativos em absolutos para uso com convertFileSrc (Tauri).
 */

function normalizeProjectPath(path: string): string {
  return String(path).replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

/**
 * Resolve o caminho absoluto de um asset a partir do diretório do projeto e do caminho relativo.
 * Normaliza barras e remove trailing/leading slashes para compatibilidade cross-platform.
 * Garante formato consistente para Tauri convertFileSrc (evita CORS/Security Error no WebView).
 */
export function resolveProjectAssetPath(projectDir: string, relativePath: string): string {
  const normalizedProjectDir = normalizeProjectPath(projectDir).replace(/\/+$/, "");
  const normalizedRelativePath = normalizeProjectPath(relativePath)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const joined = normalizedRelativePath ? `${normalizedProjectDir}/${normalizedRelativePath}` : normalizedProjectDir;
  return joined.replace(/\/+/g, "/");
}

export function resolveAbsoluteAssetPreviewSrc(absolutePath: string): string {
  return convertFileSrc(normalizeProjectPath(absolutePath));
}

export function resolveProjectAssetPreviewSrc(projectDir: string, relativePath: string): string {
  return resolveAbsoluteAssetPreviewSrc(resolveProjectAssetPath(projectDir, relativePath));
}
