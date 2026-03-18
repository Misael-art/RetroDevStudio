/**
 * Utilitário para resolução de caminhos de assets do projeto.
 * Usado por ViewportPanel, InspectorPanel e outros componentes que precisam
 * converter caminhos relativos em absolutos para uso com convertFileSrc (Tauri).
 */

/**
 * Resolve o caminho absoluto de um asset a partir do diretório do projeto e do caminho relativo.
 * Normaliza barras e remove trailing/leading slashes para compatibilidade cross-platform.
 */
export function resolveProjectAssetPath(projectDir: string, relativePath: string): string {
  const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalizedProjectDir}/${normalizedRelativePath}`;
}
