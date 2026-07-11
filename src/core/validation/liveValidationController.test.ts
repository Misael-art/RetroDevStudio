import { describe, expect, it } from "vitest";

import {
  getLiveBuildBlockReason,
  getLiveBuildWarningSummary,
  getLiveToolbarIndicator,
  isLiveValidationStateMatchingRevision,
  isValidSceneDraftReceipt,
  serializeSceneDraft,
} from "./liveValidationController";
import type { Scene } from "../ipc/sceneService";

describe("liveValidationController", () => {
  it("serializes the scene draft without changing the UGDM shape", () => {
    const scene: Scene = {
      scene_id: "main",
      display_name: "Main Scene",
      background_layers: [
        {
          layer_id: "bg0",
          depth: 0,
          tileset: "assets/tilesets/sky.png",
          scroll_speed: { x: 1, y: 0 },
          tilemap: "assets/maps/sky.json",
        },
      ],
      entities: [
        {
          entity_id: "hero",
          prefab: "player",
          transform: { x: 16, y: 32 },
          components: {
            sprite: {
              asset: "assets/sprites/hero.png",
              frame_width: 16,
              frame_height: 16,
              palette_slot: 0,
              priority: "foreground",
              animations: {
                idle: {
                  frames: [0, 1],
                  fps: 8,
                  loop: true,
                },
              },
            },
          },
        },
      ],
      palettes: [{ slot: 0, colors: ["#000000", "#ffffff"] }],
    };

    expect(JSON.parse(serializeSceneDraft(scene))).toEqual(scene);
  });

  it("returns the live hardware reason when the build is blocked", () => {
    expect(
      getLiveBuildBlockReason({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        building: false,
        hwValidationState: "fresh",
        hwStatus: {
          vram_used: 70000,
          vram_limit: 65536,
          sprite_count: 0,
          sprite_limit: 80,
          scanline_sprite_peak: 0,
          scanline_sprite_limit: 20,
          dma_used: 70000,
          dma_limit: 7372,
          palette_banks_used: 0,
          palette_banks_limit: 4,
          bg_layers: 0,
          bg_layers_limit: 3,
          errors: ["Estouro de VRAM"],
          warnings: [],
        },
      })
    ).toBe("Build bloqueado: Estouro de VRAM");
  });

  it("does not block the build when the live snapshot only has warnings", () => {
    expect(
      getLiveBuildBlockReason({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        building: false,
        hwValidationState: "fresh",
        hwStatus: {
          vram_used: 57344,
          vram_limit: 65536,
          sprite_count: 1,
          sprite_limit: 80,
          scanline_sprite_peak: 1,
          scanline_sprite_limit: 20,
          dma_used: 57344,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 0,
          bg_layers_limit: 3,
          errors: [],
          warnings: ["VRAM Warning"],
        },
      })
    ).toBeNull();
  });

  it("returns the first live warning summary without blocking the build", () => {
    expect(
      getLiveBuildWarningSummary({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        building: false,
        hwValidationState: "fresh",
        hwStatus: {
          vram_used: 57344,
          vram_limit: 65536,
          sprite_count: 1,
          sprite_limit: 80,
          scanline_sprite_peak: 1,
          scanline_sprite_limit: 20,
          dma_used: 57344,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 0,
          bg_layers_limit: 3,
          errors: [],
          warnings: ["VRAM Warning"],
        },
      })
    ).toBe("Build com alerta: VRAM Warning");
  });

  it("does not expose a warning summary for stale snapshots", () => {
    expect(
      getLiveBuildWarningSummary({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        building: false,
        hwValidationState: "stale",
        hwStatus: {
          vram_used: 57344,
          vram_limit: 65536,
          sprite_count: 1,
          sprite_limit: 80,
          scanline_sprite_peak: 1,
          scanline_sprite_limit: 20,
          dma_used: 57344,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 0,
          bg_layers_limit: 3,
          errors: [],
          warnings: ["VRAM Warning"],
        },
      })
    ).toBeNull();
  });

  it("returns a stale toolbar indicator when the draft changed after the last analysis", () => {
    expect(
      getLiveToolbarIndicator({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        hwStatus: null,
        hwValidationError: null,
        hwValidationState: "stale",
      })
    ).toEqual({
      label: "DESATUAL.",
      tone: "warn",
      detail:
        "O draft mudou depois da ultima analise live. Edite a cena para acionar a revalidacao automatica ou use Revalidar agora.",
    });
  });

  it("returns a pending toolbar indicator while live validation is running", () => {
    expect(
      getLiveToolbarIndicator({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        hwStatus: null,
        hwValidationError: null,
        hwValidationState: "pending",
      })
    ).toEqual({
      label: "ANALISANDO",
      tone: "info",
      detail: "Preview live em analise.",
    });
  });

  it("returns a warn toolbar indicator for fresh non-fatal diagnostics", () => {
    expect(
      getLiveToolbarIndicator({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        hwStatus: {
          vram_used: 57344,
          vram_limit: 65536,
          sprite_count: 1,
          sprite_limit: 80,
          scanline_sprite_peak: 1,
          scanline_sprite_limit: 20,
          dma_used: 57344,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 0,
          bg_layers_limit: 3,
          errors: [],
          warnings: ["VRAM Warning"],
        },
        hwValidationError: null,
        hwValidationState: "fresh",
      })
    ).toEqual({
      label: "WARN",
      tone: "warn",
      detail: "VRAM Warning",
    });
  });

  it("returns a live toolbar indicator when diagnostics are fresh and clean", () => {
    expect(
      getLiveToolbarIndicator({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        hwStatus: {
          vram_used: 8192,
          vram_limit: 65536,
          sprite_count: 2,
          sprite_limit: 80,
          scanline_sprite_peak: 2,
          scanline_sprite_limit: 20,
          dma_used: 8192,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 1,
          bg_layers_limit: 3,
          errors: [],
          warnings: [],
        },
        hwValidationError: null,
        hwValidationState: "fresh",
      })
    ).toEqual({
      label: "LIVE",
      tone: "ok",
      detail: "Preview live sincronizado.",
    });
  });

  it("returns an error toolbar indicator with explicit live validation failure", () => {
    expect(
      getLiveToolbarIndicator({
        activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        hwStatus: null,
        hwValidationError: "Falha de comunicacao com validate_scene_draft",
        hwValidationState: "error",
      })
    ).toEqual({
      label: "ERRO LIVE",
      tone: "error",
      detail: "Falha de comunicacao com validate_scene_draft",
    });
  });

  describe("isLiveValidationStateMatchingRevision", () => {
    it("falha quando estado e null", () => {
      const result = isLiveValidationStateMatchingRevision(null, "fresh", 4);
      expect(result).toEqual({ matches: false, reason: "no-state" });
    });

    it("retorna not-fresh quando hwValidationState nao e fresh", () => {
      const result = isLiveValidationStateMatchingRevision(
        { hwValidationState: "pending", hwValidatedRevision: 0 },
        "fresh",
        4
      );
      expect(result).toEqual({ matches: false, reason: "wrong-state", expected: "fresh", actual: "pending" });
    });

    it("retorna wrong-revision quando fresh/rev=3 e esperado rev=4", () => {
      const result = isLiveValidationStateMatchingRevision(
        { hwValidationState: "fresh", hwValidatedRevision: 3 },
        "fresh",
        4
      );
      expect(result).toEqual({
        matches: false,
        reason: "wrong-revision",
        expected: 4,
        actual: 3,
      });
    });

    it("retorna revision-skip quando fresh/rev=5 e esperado rev=4", () => {
      const result = isLiveValidationStateMatchingRevision(
        { hwValidationState: "fresh", hwValidatedRevision: 5 },
        "fresh",
        4
      );
      expect(result).toEqual({
        matches: false,
        reason: "wrong-revision",
        expected: 4,
        actual: 5,
      });
    });

    it("retorna matches:true quando fresh/rev=4 e esperado rev=4", () => {
      const result = isLiveValidationStateMatchingRevision(
        { hwValidationState: "fresh", hwValidatedRevision: 4 },
        "fresh",
        4
      );
      expect(result).toEqual({ matches: true });
    });

    it("aceita error com revisao igual", () => {
      const result = isLiveValidationStateMatchingRevision(
        { hwValidationState: "error", hwValidatedRevision: 4 },
        "error",
        4
      );
      expect(result).toEqual({ matches: true });
    });

    it("retorna not-fresh quando estado e 'stale' mesmo com revisao correta", () => {
      const result = isLiveValidationStateMatchingRevision(
        { hwValidationState: "stale", hwValidatedRevision: 4 },
        "fresh",
        4
      );
      expect(result).toEqual({ matches: false, reason: "wrong-state", expected: "fresh", actual: "stale" });
    });
  });

  it.each([null, { ok: false, sceneRevision: 4 }, { ok: true, sceneRevision: Number.NaN }, { ok: true, sceneRevision: 0 }, { ok: true, sceneRevision: -1 }, { ok: true, sceneRevision: 1.5 }, { ok: true, sceneRevision: "4" }])("rejeita receipt invalido", (receipt) => expect(isValidSceneDraftReceipt(receipt)).toBe(false));
  it("aceita receipt positivo seguro", () => expect(isValidSceneDraftReceipt({ ok: true, sceneRevision: 4 })).toBe(true));
});
