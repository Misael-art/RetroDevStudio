import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { listScenes, switchScene } from "./sceneService";

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
});
