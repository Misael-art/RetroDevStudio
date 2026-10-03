import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveSceneData: vi.fn(),
  getSceneData: vi.fn(),
  resolveScenePrefabs: vi.fn(),
}));

vi.mock("./ipc/sceneService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ipc/sceneService")>()),
  saveSceneData: mocks.saveSceneData,
  getSceneData: mocks.getSceneData,
  resolveScenePrefabs: mocks.resolveScenePrefabs,
}));

import { persistActiveScene, registerPendingEditFlusher, sceneDraftStorageKey } from "./scenePersistence";
import { useEditorStore } from "./store/editorStore";
import type { Scene } from "./ipc/sceneService";

const scene = (x: number): Scene =>
  ({
    scene_id: "main",
    entities: [{ entity_id: "player", prefab: null, transform: { x, y: 0 }, components: {} }],
    background_layers: [],
    palettes: [],
  }) as unknown as Scene;

describe("persistActiveScene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useEditorStore.setState({
      activeScene: scene(77),
      activeSceneSource: scene(77),
      activeScenePath: "scenes/main.json",
      sceneRevision: 5,
      sceneSaveState: { status: "idle", message: null, at: null, revision: null },
    });
  });

  it("reports a failed save, keeps the edited scene in memory and never reloads from disk", async () => {
    mocks.saveSceneData.mockResolvedValue({ ok: false, message: "disco cheio" });
    const ok = await persistActiveScene("/tmp/project", "Teste");
    const state = useEditorStore.getState();
    expect(ok).toBe(false);
    expect(state.sceneSaveState.status).toBe("failed");
    expect(state.sceneSaveState.message).toBe("disco cheio");
    expect(state.activeScene?.entities[0].transform.x).toBe(77);
    expect(state.activeSceneSource?.entities[0].transform.x).toBe(77);
    expect(mocks.getSceneData).not.toHaveBeenCalled();
    expect(localStorage.getItem(sceneDraftStorageKey("/tmp/project"))).toMatch(/\\"x\\":77/);
  });

  it("keeps the work when the IPC throws, too", async () => {
    mocks.saveSceneData.mockRejectedValue(new Error("IPC caiu"));
    expect(await persistActiveScene("/tmp/project", "Teste")).toBe(false);
    expect(useEditorStore.getState().sceneSaveState).toMatchObject({ status: "failed", message: "IPC caiu" });
    expect(useEditorStore.getState().activeScene?.entities[0].transform.x).toBe(77);
    expect(mocks.getSceneData).not.toHaveBeenCalled();
  });

  it("marks the saved revision on success", async () => {
    mocks.saveSceneData.mockResolvedValue({ ok: true, message: "" });
    expect(await persistActiveScene("/tmp/project", "Teste")).toBe(true);
    expect(useEditorStore.getState().sceneSaveState).toMatchObject({ status: "saved", revision: 5 });
  });

  it("flushes debounced editor edits before writing, so Save never misses the last edit", async () => {
    mocks.saveSceneData.mockResolvedValue({ ok: true, message: "" });
    const unregister = registerPendingEditFlusher(() => {
      useEditorStore.setState({ activeSceneSource: scene(99), activeScene: scene(99), sceneRevision: 6 });
    });
    await persistActiveScene("/tmp/project", "Teste");
    unregister();
    expect(mocks.saveSceneData.mock.calls[0][1]).toContain('"x": 99');
    expect(useEditorStore.getState().sceneSaveState).toMatchObject({ status: "saved", revision: 6 });
  });
});
