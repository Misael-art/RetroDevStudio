import { describe, expect, it } from "vitest";

import type { HwStatus } from "../../core/store/editorStore";
import type { ProjectAssetEntry } from "../../core/ipc/toolsService";
import {
  buildAssetBudgetSummary,
  classifyAssetBrowserAsset,
  filterAssetBrowserAssets,
  type AssetBrowserFilterId,
  type AssetReference,
} from "./assetBrowserModel";

function asset(relativePath: string, kind: ProjectAssetEntry["kind"]): ProjectAssetEntry {
  return {
    relative_path: relativePath,
    absolute_path: `F:/project/${relativePath}`,
    kind,
  };
}

function ref(label = "Sprite · hero"): AssetReference {
  return {
    entityId: "hero",
    label,
    roleLabel: "Jogador",
    confidenceLabel: "Media",
    reason: "sprite principal",
    isSceneFocus: true,
    authoringSurface: "artstudio",
    sourcePaths: ["src/player.c"],
    positionLabel: null,
    scenePath: "scenes/main.json",
    sceneLabel: "Main",
    graphRef: "graphs/hero_logic.json",
  };
}

const hwStatus: HwStatus = {
  vram_used: 72 * 1024,
  vram_limit: 64 * 1024,
  project_asset_bytes: 140 * 1024,
  resident_vram_bytes: 72 * 1024,
  streamable_vram_bytes: 68 * 1024,
  dma_frame_bytes: 9000,
  sprite_count: 12,
  sprite_limit: 80,
  scanline_sprite_peak: 8,
  scanline_sprite_limit: 20,
  dma_used: 9000,
  dma_limit: 7372,
  palette_banks_used: 3,
  palette_banks_limit: 4,
  bg_layers: 2,
  bg_layers_limit: 2,
  errors: ["VRAM residente excedida por assets/sprites/hero.png."],
  warnings: ["DMA/frame acima do orcamento."],
};

describe("assetBrowserModel production filters", () => {
  const assets = [
    asset("assets/sprites/hero.png", "image"),
    asset("assets/tilesets/stage_tiles.png", "image"),
    asset("assets/palettes/main.pal", "other"),
    asset("assets/audio/jump.wav", "audio"),
    asset("assets/source_art/hero.psd", "other"),
    asset("assets/generated/cache_sprite.png", "image"),
  ];
  const references = new Map<string, AssetReference[]>([
    ["assets/sprites/hero.png", [ref()]],
    ["assets/tilesets/stage_tiles.png", [ref("Tilemap · stage")]],
  ]);

  it("classifies canonical asset roles from path, kind and generation hints", () => {
    expect(classifyAssetBrowserAsset(assets[0]).typeId).toBe("sprite");
    expect(classifyAssetBrowserAsset(assets[1]).typeId).toBe("tilemap");
    expect(classifyAssetBrowserAsset(assets[2]).typeId).toBe("palette");
    expect(classifyAssetBrowserAsset(assets[3]).typeId).toBe("audio");
    expect(classifyAssetBrowserAsset(assets[4]).typeId).toBe("source_art");
    expect(classifyAssetBrowserAsset(assets[5]).generated).toBe(true);
  });

  it("searches by basename, path and computed type label", () => {
    expect(
      filterAssetBrowserAssets({
        assets,
        references,
        query: "jump",
        filters: new Set(),
        hwStatus: null,
      }).map((entry) => entry.relative_path)
    ).toEqual(["assets/audio/jump.wav"]);

    expect(
      filterAssetBrowserAssets({
        assets,
        references,
        query: "source art",
        filters: new Set(),
        hwStatus: null,
      }).map((entry) => entry.relative_path)
    ).toEqual(["assets/source_art/hero.psd"]);
  });

  it("combines role, unused, generated and over-budget filters", () => {
    const onlyUnusedGenerated = new Set<AssetBrowserFilterId>(["unused", "generated"]);
    expect(
      filterAssetBrowserAssets({
        assets,
        references,
        query: "",
        filters: onlyUnusedGenerated,
        hwStatus,
      }).map((entry) => entry.relative_path)
    ).toEqual(["assets/generated/cache_sprite.png"]);

    expect(
      filterAssetBrowserAssets({
        assets,
        references,
        query: "",
        filters: new Set<AssetBrowserFilterId>(["over_budget"]),
        hwStatus,
      }).map((entry) => entry.relative_path)
    ).toEqual(["assets/sprites/hero.png"]);
  });

  it("summarizes quick budget and marks referenced assets with matching budget diagnostics", () => {
    const summary = buildAssetBudgetSummary(assets[0], references.get(assets[0].relative_path) ?? [], hwStatus);

    expect(summary.status).toBe("over");
    expect(summary.vramLabel).toContain("72KB / 64KB");
    expect(summary.dmaLabel).toContain("9000B / 7372B");
    expect(summary.reason).toContain("assets/sprites/hero.png");
  });
});
