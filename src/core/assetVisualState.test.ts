import { describe, expect, it } from "vitest";

import {
  DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
  hasCanonicalTilemapCells,
  resolveProjectAssetVisualState,
} from "./assetVisualState";

describe("assetVisualState", () => {
  it("returns idle when no asset path is resolved yet", () => {
    expect(resolveProjectAssetVisualState({})).toMatchObject({
      kind: "idle",
      title: "Aguardando",
      previewAvailable: false,
    });
  });

  it("returns loaded when preview was resolved successfully", () => {
    expect(
      resolveProjectAssetVisualState({
        relativePath: "assets/sprites/hero.png",
        loadStatus: "loaded",
      })
    ).toMatchObject({
      kind: "loaded",
      title: "Carregado (preview real)",
      previewAvailable: true,
      isFallback: false,
    });
  });

  it("returns legacy_fallback when tileset exists but tilemap still depends on stretched fallback", () => {
    expect(
      resolveProjectAssetVisualState({
        relativePath: "assets/tilesets/stage.png",
        loadStatus: "loaded",
        legacyFallback: true,
      })
    ).toMatchObject({
      kind: "legacy_fallback",
      title: "Fallback explicito",
      detail: DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
      previewAvailable: true,
      isFallback: true,
    });
  });

  it("returns failed when preview decoding or loading breaks", () => {
    expect(
      resolveProjectAssetVisualState({
        relativePath: "assets/sprites/hero.png",
        loadStatus: "failed",
      })
    ).toMatchObject({
      kind: "failed",
      title: "Erro ao carregar",
      previewAvailable: false,
    });
  });

  it("detects canonical tilemap cells only when the full grid exists with painted values", () => {
    expect(
      hasCanonicalTilemapCells({
        map_width: 2,
        map_height: 2,
        cells: [1, 0, 0, 0],
      })
    ).toBe(true);
    expect(
      hasCanonicalTilemapCells({
        map_width: 2,
        map_height: 2,
        cells: [],
      })
    ).toBe(false);
    expect(
      hasCanonicalTilemapCells({
        map_width: 2,
        map_height: 2,
        cells: [0, 0, 0],
      })
    ).toBe(false);
  });
});
