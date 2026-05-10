import {
  DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
  resolveProjectAssetVisualState,
  type AssetVisualLoadStatus,
} from "./assetVisualState";

export type SceneAssetVisualRef = {
  relativePath: string;
  loadStatus: AssetVisualLoadStatus;
  legacyFallback?: boolean;
  legacyFallbackDetail?: string | null;
};

export type SceneAssetHealthTone = "info" | "warn" | "success";

export type SceneAssetHealth = {
  referenced: number;
  ready: number;
  loading: number;
  missing: number;
  failed: number;
  legacyFallback: number;
  title: string;
  detail: string;
  compactSummary: string;
  tone: SceneAssetHealthTone;
};

export function summarizeSceneAssetHealth(
  refs: SceneAssetVisualRef[]
): SceneAssetHealth {
  let ready = 0;
  let loading = 0;
  let missing = 0;
  let failed = 0;
  let legacyFallback = 0;

  for (const ref of refs) {
    const visualState = resolveProjectAssetVisualState({
      relativePath: ref.relativePath,
      loadStatus: ref.loadStatus,
      legacyFallback: ref.legacyFallback ?? false,
      legacyFallbackDetail:
        ref.legacyFallbackDetail ?? DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
    });

    if (visualState.kind === "loaded") {
      ready += 1;
    } else if (visualState.kind === "loading") {
      loading += 1;
    } else if (visualState.kind === "missing") {
      missing += 1;
    } else if (visualState.kind === "legacy_fallback") {
      ready += 1;
      legacyFallback += 1;
    } else {
      failed += 1;
    }
  }

  const referenced = refs.length;
  const compactSummary = `assets ${ready}/${referenced} visiveis`;

  if (referenced === 0) {
    return {
      referenced,
      ready,
      loading,
      missing,
      failed,
      legacyFallback,
      title: "Sem assets referenciados",
      detail: "A cena ativa ainda nao aponta para sprites, tilesets ou tilemaps carregaveis.",
      compactSummary,
      tone: "info",
    };
  }

  if (missing > 0 || failed > 0) {
    const issues = [
      missing > 0 ? `${missing} ausente(s)` : null,
      failed > 0 ? `${failed} com erro` : null,
      legacyFallback > 0 ? `${legacyFallback} em fallback legado` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      referenced,
      ready,
      loading,
      missing,
      failed,
      legacyFallback,
      title: "Assets com pendencias",
      detail: `${ready}/${referenced} visiveis no viewport. ${issues}.`,
      compactSummary,
      tone: "warn",
    };
  }

  if (loading > 0) {
    return {
      referenced,
      ready,
      loading,
      missing,
      failed,
      legacyFallback,
      title: "Assets a carregar",
      detail: `${ready}/${referenced} ja estao visiveis; ${loading} ainda estao a carregar.`,
      compactSummary,
      tone: "info",
    };
  }

  if (legacyFallback > 0) {
    return {
      referenced,
      ready,
      loading,
      missing,
      failed,
      legacyFallback,
      title: "Fallback legado ativo",
      detail: `${ready}/${referenced} visiveis; ${legacyFallback} tilemap(s) ainda usam fallback sem cells[].`,
      compactSummary,
      tone: "warn",
    };
  }

  return {
    referenced,
    ready,
    loading,
    missing,
    failed,
    legacyFallback,
    title: "Assets prontos",
    detail: `${ready}/${referenced} visiveis no viewport com preview real.`,
    compactSummary,
    tone: "success",
  };
}
