import { describe, expect, it } from "vitest";

import {
  getLiveBuildBlockReason,
  getLiveBuildWarningSummary,
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
          bg_layers: 0,
          bg_layers_limit: 3,
          errors: [],
          warnings: ["VRAM Warning"],
        },
      })
    ).toBeNull();
  });
});
