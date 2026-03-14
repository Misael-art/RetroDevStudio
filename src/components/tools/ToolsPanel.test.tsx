import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ToolsPanel from "./ToolsPanel";
import { useEditorStore } from "../../core/store/editorStore";

const mocks = vi.hoisted(() => ({
  getThirdPartyStatus: vi.fn(),
  installThirdPartyDependency: vi.fn(),
  detectRomDependency: vi.fn(),
  listProjectAssets: vi.fn(),
  reverseExplorerRead: vi.fn(),
  patchCreateIps: vi.fn(),
  patchCreateBps: vi.fn(),
  profilerAnalyzeRom: vi.fn(),
  assetsExtract: vi.fn(),
  emulatorReadMemory: vi.fn(),
  buildMultiTarget: vi.fn(),
  persistActiveScene: vi.fn(),
  listenToProjectAssetChanges: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
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

vi.mock("../../core/ipc/buildService", () => ({
  buildMultiTarget: mocks.buildMultiTarget,
}));

vi.mock("../../core/ipc/emulatorService", () => ({
  emulatorReadMemory: mocks.emulatorReadMemory,
}));

vi.mock("../../core/ipc/toolsService", () => ({
  getThirdPartyStatus: mocks.getThirdPartyStatus,
  installThirdPartyDependency: mocks.installThirdPartyDependency,
  detectRomDependency: mocks.detectRomDependency,
  listProjectAssets: mocks.listProjectAssets,
  reverseExplorerRead: mocks.reverseExplorerRead,
  patchCreateIps: mocks.patchCreateIps,
  patchCreateBps: mocks.patchCreateBps,
  profilerAnalyzeRom: mocks.profilerAnalyzeRom,
  assetsExtract: mocks.assetsExtract,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function findButton(container: HTMLElement, matcher: string | RegExp): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((element) => {
    const text = element.textContent?.trim() ?? "";
    return typeof matcher === "string" ? text === matcher : matcher.test(text);
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${String(matcher)}`);
  }

  return button;
}

describe("ToolsPanel Asset Browser", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Mega Dummy",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      selectedEntityId: null,
      activeViewportTab: "logic",
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
      activeScene: {
        scene_id: "main",
        display_name: "Main",
        entities: [],
        background_layers: [],
        palettes: [],
      },
    });

    mocks.getThirdPartyStatus.mockResolvedValue({ items: [] });
    mocks.detectRomDependency.mockResolvedValue({ dependency_id: "" });
    mocks.listProjectAssets.mockResolvedValue([
      {
        relative_path: "assets/sprites/onboarding_player.ppm",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/sprites/onboarding_player.ppm",
        kind: "image",
      },
    ]);
    mocks.reverseExplorerRead.mockResolvedValue({
      ok: true,
      error: "",
      total_size: 0,
      rows: [],
    });
    mocks.patchCreateIps.mockResolvedValue({
      ok: true,
      message: "ok",
      bytes_changed: 0,
    });
    mocks.patchCreateBps.mockResolvedValue({
      ok: true,
      message: "ok",
      bytes_changed: 0,
    });
    mocks.profilerAnalyzeRom.mockResolvedValue({
      ok: true,
      error: "",
      dma_heatmap: [],
      sprite_heatmap: [],
      dma_total_bytes: 0,
      sprite_peak: 0,
      sprite_count: 0,
      issues: [],
    });
    mocks.assetsExtract.mockResolvedValue({
      ok: true,
      error: "",
      tiles_extracted: 0,
      palettes_extracted: 0,
      files: [],
    });
    mocks.emulatorReadMemory.mockResolvedValue({
      data: [],
      total_size: 0,
    });
    mocks.buildMultiTarget.mockResolvedValue({
      ok: true,
      results: [],
      requested_targets: [],
    });
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.listenToProjectAssetChanges.mockResolvedValue(vi.fn());

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<ToolsPanel />);
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

  it("instantiates an image asset into the active scene", async () => {
    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Instanciar").click();
      await flush();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeScene?.entities).toHaveLength(1);
    expect(state.selectedEntityId).toBe("onboarding_player");
    expect(state.activeViewportTab).toBe("scene");
    expect(state.activeScene?.entities[0].components.sprite?.asset).toBe(
      "assets/sprites/onboarding_player.ppm"
    );
    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Assets",
      "Sprite 'onboarding_player' instanciado a partir de 'assets/sprites/onboarding_player.ppm'."
    );
  });
});
