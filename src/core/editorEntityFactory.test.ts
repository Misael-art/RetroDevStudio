import { describe, expect, it } from "vitest";

import {
  createSpriteEntityFromAsset,
  createStarterLogicGraph,
  pickDefaultSpriteAsset,
} from "./editorEntityFactory";

describe("editorEntityFactory", () => {
  it("prefers the onboarding sprite when picking a default asset", () => {
    expect(
      pickDefaultSpriteAsset([
        { kind: "image", relative_path: "assets/sprites/hero.ppm" },
        { kind: "image", relative_path: "assets/sprites/onboarding_player.ppm" },
      ])
    ).toBe("assets/sprites/onboarding_player.ppm");
  });

  it("creates unique sprite entities with a target-safe default size", () => {
    const entity = createSpriteEntityFromAsset({
      assetPath: "assets/sprites/hero.ppm",
      target: "megadrive",
      existingEntityIds: ["hero"],
      suggestedName: "Hero",
    });

    expect(entity.entity_id).toBe("hero_2");
    expect(entity.display_name).toBe("Hero");
    expect(entity.prefab).toBeNull();
    expect(entity.components.sprite).toMatchObject({
      asset: "assets/sprites/hero.ppm",
      frame_width: 16,
      frame_height: 16,
      palette_slot: 0,
      priority: "foreground",
    });
    expect(entity.components.logic).toBeUndefined();
  });

  it("can seed the starter logic graph for a new scene sprite", () => {
    const entity = createSpriteEntityFromAsset({
      assetPath: "assets/sprites/onboarding_player.ppm",
      target: "megadrive",
      existingEntityIds: [],
      includeStarterLogic: true,
    });

    expect(entity.entity_id).toBe("onboarding_player");
    expect(entity.components.sprite?.frame_width).toBe(16);
    expect(entity.components.sprite?.frame_height).toBe(16);
    expect(entity.components.logic?.graph).toContain("\"target\":\"onboarding_player\"");
    expect(createStarterLogicGraph("player")).toContain("\"fromNode\":\"start\"");
  });

  it("preserves sprite animations and constrains frame size for the target", () => {
    const entity = createSpriteEntityFromAsset({
      assetPath: "assets/sprites/hero.ppm",
      target: "snes",
      existingEntityIds: [],
      frameWidth: 20,
      frameHeight: 12,
      animations: {
        run: {
          frames: [0, 1, 2],
          fps: 12,
          loop: true,
        },
      },
    });

    expect(entity.components.sprite).toMatchObject({
      asset: "assets/sprites/hero.ppm",
      frame_width: 32,
      frame_height: 32,
      animations: {
        run: {
          frames: [0, 1, 2],
          fps: 12,
          loop: true,
        },
      },
    });
  });
});
