import { describe, expect, it } from "vitest";

import {
  classifyImageAssetInstantiation,
  normalizeAssetRelativePath,
  shouldInstantiateImageAsTilemapEntity,
} from "./assetInstantiation";
import type { Entity } from "./ipc/sceneService";

function entityWithSprite(asset: string): Pick<Entity, "entity_id" | "components"> {
  return {
    entity_id: "s1",
    components: { sprite: { asset, frame_width: 8, frame_height: 8, palette_slot: 0, priority: "foreground", animations: {} } },
  };
}

function entityWithTilemap(tileset: string): Pick<Entity, "entity_id" | "components"> {
  return {
    entity_id: "t1",
    components: {
      tilemap: {
        tileset,
        map_width: 4,
        map_height: 4,
        scroll_x: 0,
        scroll_y: 0,
        cells: [],
      },
    },
  };
}

describe("assetInstantiation", () => {
  it("normalizes slashes for comparison", () => {
    expect(normalizeAssetRelativePath("a\\b\\c.png")).toBe("a/b/c.png");
  });

  it("prefers tilemap when the same path is already used as tileset in the scene", () => {
    const asset = { kind: "image" as const, relative_path: "assets/tilesets/bg.png" };
    const entities = [entityWithSprite("assets/sprites/hero.png"), entityWithTilemap("assets/tilesets/bg.png")];
    expect(
      shouldInstantiateImageAsTilemapEntity({
        asset,
        projectSourceKind: "blank",
        sceneEntities: entities,
      })
    ).toBe(true);
  });

  it("prefers sprite when the same path is already used as sprite in the scene", () => {
    const asset = { kind: "image" as const, relative_path: "assets/sprites/hero.png" };
    const entities = [entityWithSprite("assets/sprites/hero.png")];
    expect(
      shouldInstantiateImageAsTilemapEntity({
        asset,
        projectSourceKind: "imported_sgdk",
        sceneEntities: entities,
      })
    ).toBe(false);
  });

  it("for imported_sgdk, tilesets folder implies tilemap even without scene refs", () => {
    expect(
      shouldInstantiateImageAsTilemapEntity({
        asset: { kind: "image", relative_path: "assets/tilesets/window.png" },
        projectSourceKind: "imported_sgdk",
        sceneEntities: [],
      })
    ).toBe(true);
  });

  it("for imported_sgdk, plain sprites folder stays sprite when not referenced", () => {
    expect(
      shouldInstantiateImageAsTilemapEntity({
        asset: { kind: "image", relative_path: "assets/sprites/player.png" },
        projectSourceKind: "imported_sgdk",
        sceneEntities: [],
      })
    ).toBe(false);
  });

  it("non-sgdk still honors canonical tilesets path", () => {
    expect(
      shouldInstantiateImageAsTilemapEntity({
        asset: { kind: "image", relative_path: "content/tilesets/a.png" },
        projectSourceKind: "imported_godot",
        sceneEntities: [],
      })
    ).toBe(true);
  });

  it("classifies maps/ folder as tilemap layout", () => {
    const c = classifyImageAssetInstantiation({
      asset: { kind: "image", relative_path: "res/maps/stage.png" },
      projectSourceKind: "imported_sgdk",
      sceneEntities: [],
    });
    expect(c.kind).toBe("tilemap");
    expect(c.reason).toBe("sgdk-layout-canónico-pastas");
    expect(c.title).toBe("Instanciar como tilemap");
    expect(c.entityLabel).toBe("Tilemap");
    expect(c.detail).toContain("SGDK");
    expect(c.nextStep).toContain("cells[]");
  });

  it("exposes a product-facing explanation for sprite defaults without hiding the audit trail", () => {
    const c = classifyImageAssetInstantiation({
      asset: { kind: "image", relative_path: "assets/sprites/player.png" },
      projectSourceKind: "builtin",
      sceneEntities: [],
    });

    expect(c.kind).toBe("sprite");
    expect(c.reason).toBe("padrao-sprite-sem-sinais-de-tilemap");
    expect(c.title).toBe("Instanciar como sprite");
    expect(c.entityLabel).toBe("Sprite");
    expect(c.detail).toContain("sprite");
  });
});
