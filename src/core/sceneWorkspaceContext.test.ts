import { describe, expect, it } from "vitest";

import {
  getPreferredSceneEntity,
  getWorkspaceEntityRole,
  getWorkspaceEntityRoleLabel,
  isImportedProjectSource,
  isLegacyOverlayProjectSource,
  resolveSceneWorkspaceContext,
} from "./sceneWorkspaceContext";

describe("sceneWorkspaceContext", () => {
  it("finds the first visual entity as the preferred scene focus", () => {
    const preferred = getPreferredSceneEntity({
      scene_id: "phase_b",
      display_name: "Phase B",
      entities: [
        {
          entity_id: "camera_main",
          transform: { x: 0, y: 0 },
          components: { camera: { offset_x: 0, offset_y: 0 } },
        },
        {
          entity_id: "stage_tilemap",
          display_name: "Stage Tilemap",
          transform: { x: 0, y: 0 },
          components: {
            tilemap: {
              tileset: "assets/tilesets/stage.png",
              map_width: 4,
              map_height: 4,
              scroll_x: 0,
              scroll_y: 0,
              cells: [],
            },
          },
        },
      ],
      background_layers: [],
      palettes: [],
    });

    expect(preferred?.entity_id).toBe("stage_tilemap");
  });

  it("describes imported scenes with a shared product-facing context", () => {
    const context = resolveSceneWorkspaceContext({
      scene: {
        scene_id: "phase_b",
        display_name: "Phase B",
        entities: [
          {
            entity_id: "stage_tilemap",
            display_name: "Stage Tilemap",
            transform: { x: 0, y: 0 },
            components: {
              tilemap: {
                tileset: "assets/tilesets/stage.png",
                map_width: 4,
                map_height: 4,
                scroll_x: 0,
                scroll_y: 0,
                cells: [],
              },
            },
          },
          {
            entity_id: "hero",
            display_name: "Hero",
            transform: { x: 24, y: 32 },
            components: {
              sprite: {
                asset: "assets/sprites/hero.png",
                frame_width: 16,
                frame_height: 16,
                palette_slot: 0,
                animations: {},
              },
              logic: {
                imported_semantics: {
                  source: "sgdk_phase_d",
                  entity_role: "player_avatar",
                  gameplay_class: "platformer_horizontal_scroller_signals",
                  confidence: "medium",
                  role_reason: "sprite primario com leitura JOY_* no agregado",
                  driver_functions: ["player_tick"],
                  source_paths: ["src/player.c"],
                  audit_flags: ["primary_sprite"],
                },
              },
            },
          },
        ],
        background_layers: [],
        palettes: [],
      },
      scenePath: "scenes/phase_b.json",
      projectSourceKind: "imported_sgdk",
    });

    expect(context.sourceBadgeLabel).toBe("Cena importada");
    expect(context.title).toContain("Cena importada");
    expect(context.tone).toBe("success");
    expect(context.focusEntityId).toBe("hero");
    expect(context.checkpoints).toContain("Cena importada ativa");
    expect(context.checkpoints.some((entry) => entry.includes("Jogador foco: Hero"))).toBe(true);
  });

  it("flags legacy overlay projects without pretending they are native", () => {
    const context = resolveSceneWorkspaceContext({
      scene: {
        scene_id: "main",
        display_name: "Main",
        entities: [],
        background_layers: [],
        palettes: [],
      },
      scenePath: "scenes/main.json",
      projectSourceKind: "external_sgdk",
      projectLegacyIndex: {
        host_root: "F:/Projects/MegaDrive_DEV/Host",
        source_files: ["src/main.c"],
        header_files: [],
        manifest_files: [],
        resource_files: [],
        output_files: [],
      },
    });

    expect(context.sourceBadgeLabel).toBe("Overlay SGDK");
    expect(context.isLegacyOverlayProject).toBe(true);
    expect(context.tone).toBe("info");
    expect(context.summary).toContain("overlay");
  });

  it("keeps the native empty-scene guidance action oriented", () => {
    const context = resolveSceneWorkspaceContext({
      scene: {
        scene_id: "main",
        display_name: "Main",
        entities: [],
        background_layers: [],
        palettes: [],
      },
      scenePath: "scenes/main.json",
      projectSourceKind: "builtin",
    });

    expect(context.title).toBe("Cena pronta para comecar");
    expect(context.focusEntityId).toBeNull();
    expect(context.detail).toContain("Sprite Inicial");
  });

  it("shares entity roles across hierarchy, inspector and post-import focus", () => {
    expect(
      getWorkspaceEntityRole({
        components: {
          sprite: {
            asset: "assets/sprites/hero.png",
            frame_width: 16,
            frame_height: 16,
            palette_slot: 0,
            animations: {},
          },
        },
      })
    ).toBe("sprite");
    expect(getWorkspaceEntityRoleLabel("tilemap")).toBe("Tilemap");
    expect(isImportedProjectSource("imported_sgdk")).toBe(true);
    expect(isLegacyOverlayProjectSource("external_sgdk", { host_root: "F:/Host", source_files: [], header_files: [], manifest_files: [], resource_files: [], output_files: [] })).toBe(true);
  });
});
