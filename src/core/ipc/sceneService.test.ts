import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import {
  listScenes,
  parseSceneJson,
  resolveScenePrefabs,
  switchScene,
  type Scene,
} from "./sceneService";

describe("sceneService", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("lists project scenes through the canonical IPC command", async () => {
    const payload = [
      { path: "scenes/main.json", scene_id: "main", display_name: "Main Scene" },
      { path: "scenes/bonus.json", scene_id: "bonus", display_name: "Bonus Scene" },
    ];
    mocks.invoke.mockResolvedValue(payload);

    await expect(listScenes("F:/Projects/RetroDevStudio/demo")).resolves.toEqual(payload);

    expect(mocks.invoke).toHaveBeenCalledWith("list_scenes", {
      projectDir: "F:/Projects/RetroDevStudio/demo",
    });
  });

  it("switches the active scene through the canonical IPC command", async () => {
    const payload = {
      ok: true,
      error: "",
      scene_json: "{\"scene_id\":\"bonus\"}",
      project_name: "Demo",
      target: "megadrive",
      scene_path: "scenes/bonus.json",
    };
    mocks.invoke.mockResolvedValue(payload);

    await expect(
      switchScene("F:/Projects/RetroDevStudio/demo", "scenes/bonus.json")
    ).resolves.toEqual(payload);

    expect(mocks.invoke).toHaveBeenCalledWith("switch_scene", {
      projectDir: "F:/Projects/RetroDevStudio/demo",
      scenePath: "scenes/bonus.json",
    });
  });

  it("resolves prefabs for a raw scene through the canonical IPC command", async () => {
    const scene: Scene = {
      scene_id: "main",
      entities: [{ entity_id: "hero", prefab: "hero.json", transform: { x: 0, y: 0 }, components: {} }],
      background_layers: [],
    };
    const payload = {
      ok: true,
      error: "",
      scene_json: "{\"scene_id\":\"main\",\"entities\":[{\"entity_id\":\"hero\"}],\"background_layers\":[]}",
    };
    mocks.invoke.mockResolvedValue(payload);

    await expect(resolveScenePrefabs("F:/Projects/RetroDevStudio/demo", scene)).resolves.toEqual(
      payload
    );

    expect(mocks.invoke).toHaveBeenCalledWith("resolve_scene_prefabs", {
      projectDir: "F:/Projects/RetroDevStudio/demo",
      sceneJson: JSON.stringify(scene),
    });
  });

  it("parses sprite animations and frame dimensions from the canonical scene schema", () => {
    const scene = parseSceneJson(`{
      "scene_id": "main",
      "entities": [
        {
          "entity_id": "hero",
          "transform": { "x": 12, "y": 24 },
          "components": {
            "sprite": {
              "asset": "assets/sprites/hero.png",
              "frame_width": 16,
              "frame_height": 16,
              "animations": {
                "run": {
                  "frames": [0, 1, 2],
                  "fps": 12,
                  "loop": true
                }
              }
            }
          }
        }
      ],
      "background_layers": []
    }`);

    expect(scene?.entities[0].components.sprite).toMatchObject({
      asset: "assets/sprites/hero.png",
      frame_width: 16,
      frame_height: 16,
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
