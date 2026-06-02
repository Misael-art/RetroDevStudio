import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ViewportPanel from "./ViewportPanel";
import type { Entity, Scene } from "../../core/ipc/sceneService";
import { useEditorStore } from "../../core/store/editorStore";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
  listenToProjectAssetChanges: vi.fn(),
  readProjectAssetPreview: vi.fn(),
  openProjectSourcePath: vi.fn(),
  emulatorSaveState: vi.fn(),
  emulatorLoadState: vi.fn(),
  emulatorRewindStep: vi.fn(),
  emulatorStartRecording: vi.fn(),
  emulatorStopRecording: vi.fn(),
  emulatorPlayReplay: vi.fn(),
  emulatorSendInput: vi.fn(),
  startFrameLoop: vi.fn(),
  listenToAudioStream: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("../../core/ipc/projectWatcherService", () => ({
  listenToProjectAssetChanges: mocks.listenToProjectAssetChanges,
}));

vi.mock("../../core/ipc/projectService", () => ({
  openProjectSourcePath: mocks.openProjectSourcePath,
}));

vi.mock("../../core/ipc/assetPreviewService", async () => {
  const actual = await vi.importActual<typeof import("../../core/ipc/assetPreviewService")>(
    "../../core/ipc/assetPreviewService"
  );
  return {
    ...actual,
    readProjectAssetPreview: mocks.readProjectAssetPreview,
  };
});

vi.mock("../../core/ipc/emulatorService", async () => {
  const actual = await vi.importActual<typeof import("../../core/ipc/emulatorService")>(
    "../../core/ipc/emulatorService"
  );
  return {
    ...actual,
    emulatorSaveState: mocks.emulatorSaveState,
    emulatorLoadState: mocks.emulatorLoadState,
    emulatorRewindStep: mocks.emulatorRewindStep,
    emulatorStartRecording: mocks.emulatorStartRecording,
    emulatorStopRecording: mocks.emulatorStopRecording,
    emulatorPlayReplay: mocks.emulatorPlayReplay,
    emulatorSendInput: mocks.emulatorSendInput,
    startFrameLoop: mocks.startFrameLoop,
    listenToAudioStream: mocks.listenToAudioStream,
    keyToJoypad: vi.fn(() => null),
  };
});

vi.mock("../nodegraph/NodeGraphEditor", () => ({
  default: () => null,
}));

vi.mock("../artstudio/ArtStudioPanel", () => ({
  default: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const EMPTY_SCENE: Scene = {
  scene_id: "scene_test",
  display_name: "Imported SGDK Scene",
  entities: [],
  background_layers: [],
  palettes: [],
};

function stagedSprite(id: string, x: number, y: number): Entity {
  return {
    entity_id: id,
    display_name: id,
    transform: { x, y },
    components: {
      sprite: {
        asset: `assets/sprites/${id}.png`,
        frame_width: 16,
        frame_height: 16,
        palette_slot: 0,
        animations: {},
      },
      logic: {
        imported_semantics: {
          source: "sgdk_phase_d",
          entity_role: "enemy_actor",
          gameplay_class: "run_and_gun_horizontal_signals",
          confidence: "medium",
          source_paths: ["src/main.c"],
          audit_flags: ["position:staging_layout"],
        },
      },
    },
  };
}

describe("ViewportPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.listenToProjectAssetChanges.mockResolvedValue(vi.fn());
    mocks.readProjectAssetPreview.mockResolvedValue({
      ok: false,
      mime_type: null,
      base64: null,
      error: "not loaded in unit test",
    });
    mocks.openProjectSourcePath.mockResolvedValue({ ok: true, error: null });
    mocks.startFrameLoop.mockResolvedValue(vi.fn());
    mocks.listenToAudioStream.mockResolvedValue(vi.fn());

    const importedScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        stagedSprite("spr_000", 48, 88),
        stagedSprite("spr_001", 112, 116),
        stagedSprite("spr_002", 368, 88),
      ],
    };

    useEditorStore.setState({
      activeProjectDir: "",
      activeProjectName: "Imported Test",
      activeTarget: "megadrive",
      activeViewportTab: "scene",
      activeWorkspace: "scene",
      activeScenePath: "scenes/main.json",
      activeScene: importedScene,
      activeSceneSource: importedScene,
      selectedEntityId: "spr_000",
      activeLayerId: null,
      projectSourceKind: "imported_sgdk",
      projectLegacyIndex: null,
      editorMode: "select",
      activeBrush: null,
      activeTilemapId: null,
      tilePaintTool: "pencil",
      tilePaintRectPreview: null,
      tileStampPattern: null,
      emulatorLoaded: false,
      emulPaused: false,
      viewportZoom: 1.75,
      hwStatus: null,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      sceneRevision: 1,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("auto-enables and labels the imported staging overlay control", async () => {
    await act(async () => {
      root.render(<ViewportPanel showWorkspaceTabs={false} />);
      await flush();
      await flush();
    });

    const stagingToggle = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-toggle-stg']"
    );

    expect(stagingToggle).not.toBeNull();
    expect(stagingToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(stagingToggle?.getAttribute("aria-label")).toContain("3 sprites em staging");
    expect(stagingToggle?.getAttribute("aria-label")).toContain("2 paginas");
    expect(stagingToggle?.title).toContain("3 sprites em staging");
  });

  it("navigates imported staging pages and focuses the first sprite in the selected page", async () => {
    await act(async () => {
      root.render(<ViewportPanel showWorkspaceTabs={false} />);
      await flush();
      await flush();
    });

    const pager = container.querySelector<HTMLElement>("[data-testid='viewport-staging-pager']");
    const focusButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-focus-staging-page']"
    );
    const nextButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-staging-next']"
    );

    expect(pager).not.toBeNull();
    expect(focusButton?.textContent).toContain("1/2");
    expect(nextButton?.disabled).toBe(false);

    await act(async () => {
      nextButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().selectedEntityId).toBe("spr_002");
    const updatedFocusButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-focus-staging-page']"
    );
    expect(updatedFocusButton?.textContent).toContain("2/2");
  });

  it("keeps Scene to ArtStudio and Logic actions reachable after paging staging sprites", async () => {
    await act(async () => {
      root.render(<ViewportPanel showWorkspaceTabs={false} />);
      await flush();
      await flush();
    });

    const nextButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-staging-next']"
    );

    await act(async () => {
      nextButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().selectedEntityId).toBe("spr_002");

    const artButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-dock-open-art']"
    );
    expect(artButton).not.toBeNull();

    let artNavigationState: {
      activeWorkspace: string;
      activeViewportTab: string;
      selectedEntityId: string | null;
    } | null = null;
    await act(async () => {
      artButton?.click();
      const state = useEditorStore.getState();
      artNavigationState = {
        activeWorkspace: state.activeWorkspace,
        activeViewportTab: state.activeViewportTab,
        selectedEntityId: state.selectedEntityId,
      };
      useEditorStore.setState({ activeWorkspace: "scene", activeViewportTab: "scene" });
      await flush();
    });

    expect(artNavigationState).toEqual({
      activeWorkspace: "artstudio",
      activeViewportTab: "artstudio",
      selectedEntityId: "spr_002",
    });

    const logicButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='viewport-dock-open-logic']"
    );
    expect(logicButton).not.toBeNull();

    let logicNavigationState: {
      activeWorkspace: string;
      activeViewportTab: string;
      selectedEntityId: string | null;
    } | null = null;
    await act(async () => {
      logicButton?.click();
      const state = useEditorStore.getState();
      logicNavigationState = {
        activeWorkspace: state.activeWorkspace,
        activeViewportTab: state.activeViewportTab,
        selectedEntityId: state.selectedEntityId,
      };
      useEditorStore.setState({ activeWorkspace: "scene", activeViewportTab: "scene" });
      await flush();
    });

    expect(logicNavigationState).toEqual({
      activeWorkspace: "logic",
      activeViewportTab: "logic",
      selectedEntityId: "spr_002",
    });
  });
});
