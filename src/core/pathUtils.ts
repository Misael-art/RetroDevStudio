/**
 * Utilitário para resolução de caminhos de assets do projeto.
 * Usado por ViewportPanel, InspectorPanel e outros componentes que precisam
 * converter caminhos relativos em absolutos para uso com convertFileSrc (Tauri).
 */

/**
 * Resolve o caminho absoluto de um asset a partir do diretório do projeto e do caminho relativo.
 * Normaliza barras e remove trailing/leading slashes para compatibilidade cross-platform.
 * Garante formato consistente para Tauri convertFileSrc (evita CORS/Security Error no WebView).
 */
export function resolveProjectAssetPath(projectDir: string, relativePath: string): string {
  const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const joined = normalizedRelativePath ? `${normalizedProjectDir}/${normalizedRelativePath}` : normalizedProjectDir;
  return joined.replace(/\/+/g, "/");
}
