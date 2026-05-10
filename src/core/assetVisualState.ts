export type AssetVisualLoadStatus = "idle" | "loading" | "loaded" | "missing" | "failed";

export type ProjectAssetVisualStateKind = AssetVisualLoadStatus | "legacy_fallback";

export type ProjectAssetVisualState = {
  kind: ProjectAssetVisualStateKind;
  title: string;
  detail: string;
  relativePath: string | null;
  previewStatus: AssetVisualLoadStatus;
  previewAvailable: boolean;
  isFallback: boolean;
};

type ResolveProjectAssetVisualStateOptions = {
  relativePath?: string | null;
  loadStatus?: AssetVisualLoadStatus;
  legacyFallback?: boolean;
  legacyFallbackDetail?: string | null;
};

export const DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL =
  "Tileset existe, mas cells[] ainda nao foram materializados; viewport usa fallback explicito e auditavel.";

export function hasCanonicalTilemapCells(
  tilemap:
    | {
        map_width: number;
        map_height: number;
        cells?: number[] | null;
      }
    | null
    | undefined
): boolean {
  if (!tilemap) {
    return false;
  }

  const total = tilemap.map_width * tilemap.map_height;
  const cells = tilemap.cells ?? [];
  return Array.isArray(cells) && cells.length === total && cells.some((value) => (value | 0) > 0);
}

export function resolveProjectAssetVisualState(
  options: ResolveProjectAssetVisualStateOptions
): ProjectAssetVisualState {
  const relativePath = String(options.relativePath ?? "").trim() || null;
  const previewStatus =
    options.loadStatus ?? (relativePath ? "loading" : "idle");

  switch (previewStatus) {
    case "loading":
      return {
        kind: "loading",
        title: "A carregar…",
        detail: "A carregar preview real do asset.",
        relativePath,
        previewStatus,
        previewAvailable: false,
        isFallback: false,
      };
    case "loaded":
      if (options.legacyFallback) {
        return {
          kind: "legacy_fallback",
          title: "Fallback explicito",
          detail:
            String(options.legacyFallbackDetail ?? "").trim()
            || DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
          relativePath,
          previewStatus,
          previewAvailable: true,
          isFallback: true,
        };
      }
      return {
        kind: "loaded",
        title: "Carregado (preview real)",
        detail: "Preview real carregado com sucesso.",
        relativePath,
        previewStatus,
        previewAvailable: true,
        isFallback: false,
      };
    case "missing":
      return {
        kind: "missing",
        title: "Asset ausente",
        detail: "Asset ausente ou caminho nao resolvido.",
        relativePath,
        previewStatus,
        previewAvailable: false,
        isFallback: false,
      };
    case "failed":
      return {
        kind: "failed",
        title: "Erro ao carregar",
        detail: "Erro ao carregar preview real (decode / ficheiro).",
        relativePath,
        previewStatus,
        previewAvailable: false,
        isFallback: false,
      };
    default:
      return {
        kind: "idle",
        title: "Aguardando",
        detail: "Nenhum asset resolvido para este slot.",
        relativePath,
        previewStatus: "idle",
        previewAvailable: false,
        isFallback: false,
      };
  }
}
