import { describe, expect, it } from "vitest";

import { summarizeSceneAssetHealth } from "./sceneAssetHealth";

describe("sceneAssetHealth", () => {
  it("reports a healthy viewport when every referenced asset is loaded", () => {
    const health = summarizeSceneAssetHealth([
      { relativePath: "assets/sprites/hero.png", loadStatus: "loaded" },
      { relativePath: "assets/tilesets/stage.png", loadStatus: "loaded" },
    ]);

    expect(health.tone).toBe("success");
    expect(health.title).toBe("Assets prontos");
    expect(health.compactSummary).toBe("assets 2/2 visiveis");
  });

  it("keeps loading states explicit instead of looking broken", () => {
    const health = summarizeSceneAssetHealth([
      { relativePath: "assets/sprites/hero.png", loadStatus: "loaded" },
      { relativePath: "assets/tilesets/stage.png", loadStatus: "loading" },
    ]);

    expect(health.tone).toBe("info");
    expect(health.title).toBe("Assets a carregar");
    expect(health.detail).toContain("1 ainda");
  });

  it("surfaces missing and failed assets as real issues", () => {
    const health = summarizeSceneAssetHealth([
      { relativePath: "assets/sprites/hero.png", loadStatus: "loaded" },
      { relativePath: "assets/tilesets/missing.png", loadStatus: "missing" },
      { relativePath: "assets/sprites/bad.png", loadStatus: "failed" },
    ]);

    expect(health.tone).toBe("warn");
    expect(health.title).toBe("Assets com pendencias");
    expect(health.detail).toContain("1 ausente(s)");
    expect(health.detail).toContain("1 com erro");
  });

  it("treats legacy fallback as visible but still deserving a warning", () => {
    const health = summarizeSceneAssetHealth([
      {
        relativePath: "assets/tilesets/stage.png",
        loadStatus: "loaded",
        legacyFallback: true,
      },
    ]);

    expect(health.ready).toBe(1);
    expect(health.legacyFallback).toBe(1);
    expect(health.title).toBe("Fallback legado ativo");
    expect(health.detail).toContain("cells[]");
  });
});
