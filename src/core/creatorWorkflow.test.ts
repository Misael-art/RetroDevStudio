import { describe, expect, it } from "vitest";

import {
  buildCreatorWorkflowContext,
  resolveEntityFocusTreatment,
} from "./creatorWorkflow";
import type { Entity, Scene } from "./ipc/sceneService";

function spriteEntity(entityId: string, x: number, y: number): Entity {
  return {
    entity_id: entityId,
    display_name: entityId === "hero" ? "Hero" : entityId,
    prefab: null,
    transform: { x, y },
    components: {
      sprite: {
        asset: `assets/sprites/${entityId}.png`,
        frame_width: 32,
        frame_height: 32,
        palette_slot: 0,
        animations: {},
      },
      logic:
        entityId === "hero"
          ? {
              graph_ref: "graphs/hero.json",
              external_source_refs: ["src/main.c"],
              imported_semantics: {
                entity_role: "player_avatar",
                confidence: "high",
                role_reason: "primary joystick reads",
                source_paths: ["src/player_control.c"],
                driver_functions: ["main", "player_tick"],
              },
            }
          : undefined,
    },
  };
}

describe("creatorWorkflow", () => {
  it("summarizes the active creator context across world, camera, selection and tile paint", () => {
    const hero = spriteEntity("hero", 64, 88);
    const scene: Scene = {
      scene_id: "stage",
      display_name: "Stage",
      entities: [
        {
          entity_id: "stage_tilemap",
          display_name: "Stage Tilemap",
          prefab: null,
          transform: { x: 0, y: 0 },
          components: {
            tilemap: {
              tileset: "assets/tilesets/stage.png",
              map_width: 80,
              map_height: 28,
              cells: new Array(80 * 28).fill(1),
            },
          },
        },
        hero,
        {
          entity_id: "main_camera",
          display_name: "Main Camera",
          prefab: null,
          transform: { x: 0, y: 0 },
          components: {
            camera: {
              follow_entity: "hero",
            },
          },
        },
      ],
      background_layers: [],
      palettes: [],
    };

    const context = buildCreatorWorkflowContext({
      scene,
      target: "megadrive",
      selectedEntityId: "hero",
      activeTilemapId: "stage_tilemap",
      editorMode: "paint",
      activeBrushTileIndex: 5,
      tilePaintTool: "pencil",
      soloEntityId: "hero",
    });

    expect(context.frameLabel).toBe("Janela Mega Drive 320x224");
    expect(context.worldLabel).toBe("Mundo 720x232 px");
    expect(context.cameraLabel).toContain("Main Camera");
    expect(context.cameraLabel).toContain("segue hero");
    expect(context.selectedLabel).toBe("Hero");
    expect(context.selectedBoundsLabel).toBe("64,88 · 32x32");
    expect(context.selectedRoleLabel).toBe("player_avatar");
    expect(context.sourceCountLabel).toBe("2 fontes");
    expect(context.tilemapTargetLabel).toBe("Stage Tilemap");
    expect(context.tileBrushLabel).toBe("pencil · tile #5");
    expect(context.soloLabel).toBe("Solo: Hero");
    expect(context.primaryAction).toBe("logic");
  });

  it("keeps focus treatment explicit for solo and dense previews", () => {
    expect(resolveEntityFocusTreatment("hero", { soloEntityId: "hero" })).toBe("solo");
    expect(resolveEntityFocusTreatment("enemy", { soloEntityId: "hero" })).toBe("muted");
    expect(
      resolveEntityFocusTreatment("enemy", {
        densePreviewEntityId: "enemy",
        denseSpotlight: true,
      })
    ).toBe("preview");
    expect(resolveEntityFocusTreatment("enemy", {})).toBe("normal");
  });
});
