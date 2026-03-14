import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HierarchyPanel from "./HierarchyPanel";
import { useEditorStore } from "../../core/store/editorStore";

const mocks = vi.hoisted(() => ({
  listScenes: vi.fn(),
  getSceneData: vi.fn(),
  parseScene: vi.fn(),
  switchScene: vi.fn(),
  createScene: vi.fn(),
  persistActiveScene: vi.fn(),
  listProjectAssets: vi.fn(),
}));

vi.mock("../../core/ipc/sceneService", () => ({
  listScenes: mocks.listScenes,
  getSceneData: mocks.getSceneData,
  parseScene: mocks.parseScene,
  switchScene: mocks.switchScene,
  createScene: mocks.createScene,
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("../../core/ipc/toolsService", () => ({
  listProjectAssets: mocks.listProjectAssets,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

describe("HierarchyPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();

    const emptyScene = {
      scene_id: "main",
      display_name: "Main",
      entities: [],
      background_layers: [],
      palettes: [],
    };

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Mega Dummy",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      selectedEntityId: null,
      activeScene: emptyScene,
      activeViewportTab: "scene",
      emulatorLoaded: false,
      hwStatus: null,
      sceneRevision: 1,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      hwValidationRefreshTick: 0,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      emulPaused: false,
      consoleEntries: [],
      consoleVisible: true,
    });

    mocks.listScenes.mockResolvedValue([
      {
        path: "scenes/main.json",
        scene_id: "main",
        display_name: "Main",
      },
    ]);
    mocks.getSceneData.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify(emptyScene),
      project_name: "Mega Dummy",
      target: "megadrive",
      scene_path: "scenes/main.json",
    });
    mocks.parseScene.mockImplementation((result: { scene_json: string }) => JSON.parse(result.scene_json));
    mocks.switchScene.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify(emptyScene),
      project_name: "Mega Dummy",
      target: "megadrive",
      scene_path: "scenes/main.json",
    });
    mocks.createScene.mockResolvedValue({
      path: "scenes/main.json",
      scene_id: "main",
      display_name: "Main",
    });
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.listProjectAssets.mockResolvedValue([
      {
        relative_path: "assets/sprites/onboarding_player.ppm",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/sprites/onboarding_player.ppm",
        kind: "image",
      },
    ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<HierarchyPanel />);
      await flush();
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("creates a starter sprite from the empty-scene CTA", async () => {
    await act(async () => {
      findButton(container, "Sprite Inicial").click();
      await flush();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeScene?.entities).toHaveLength(1);
    expect(state.selectedEntityId).toBe("onboarding_player");
    expect(state.activeScene?.entities[0].components.sprite).toMatchObject({
      asset: "assets/sprites/onboarding_player.ppm",
      frame_width: 16,
      frame_height: 16,
    });
    expect(state.activeScene?.entities[0].components.logic?.graph).toContain("\"type\":\"event_start\"");
    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Hierarchy",
      "Sprite 'onboarding_player' criado a partir de 'assets/sprites/onboarding_player.ppm'."
    );
  });
});
