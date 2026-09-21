import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore, type HwStatus } from "../../core/store/editorStore";
import ViewportPanel from "./ViewportPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("../../core/scenePersistence", () => ({ persistActiveScene: vi.fn() }));
vi.mock("../../core/ipc/projectService", () => ({ openProjectSourcePath: vi.fn() }));
vi.mock("../../core/ipc/projectWatcherService", () => ({
  listenToProjectAssetChanges: vi.fn(async () => vi.fn()),
}));
vi.mock("../../core/ipc/emulatorService", () => ({
  JOYPAD_DEFAULT: {
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    b: false,
    c: false,
    start: false,
  },
  emulatorLoadState: vi.fn(),
  emulatorPlayReplay: vi.fn(),
  emulatorRewindStep: vi.fn(),
  emulatorSaveState: vi.fn(),
  emulatorSendInput: vi.fn(async () => undefined),
  emulatorStartRecording: vi.fn(),
  emulatorStopRecording: vi.fn(),
  keyToJoypad: vi.fn(() => null),
  listenToAudioStream: vi.fn(async () => vi.fn()),
  startFrameLoop: vi.fn(async () => vi.fn()),
}));

const EMPTY_HARDWARE_STATUS: HwStatus = {
  vram_used: 0,
  vram_limit: 64 * 1024,
  sprite_count: 0,
  sprite_limit: 80,
  scanline_sprite_peak: 0,
  scanline_sprite_limit: 20,
  dma_used: 0,
  dma_limit: 7372,
  palette_banks_used: 0,
  palette_banks_limit: 4,
  bg_layers: 0,
  bg_layers_limit: 4,
  errors: [],
  warnings: [],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function renderViewport() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ViewportPanel showWorkspaceTabs={false} />);
    await Promise.resolve();
  });
  return host;
}

describe("ViewportPanel UI hierarchy", () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.setState({
      activeProjectDir: "",
      activeProjectName: "",
      activeScenePath: "",
      activeScene: null,
      activeSceneSource: null,
      activeTarget: "megadrive",
      activeViewportTab: "scene",
      activeWorkspace: "scene",
      editorMode: "select",
      emulatorLoaded: false,
      emulPaused: false,
      hwStatus: EMPTY_HARDWARE_STATUS,
      selectedEntityId: null,
      viewportZoom: 1,
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    host?.remove();
    root = null;
    host = null;
  });

  it("keeps primary Scene tools predictable and build blockers outside the canvas", async () => {
    useEditorStore.setState({
      hwStatus: {
        ...EMPTY_HARDWARE_STATUS,
        errors: ["VRAM excedeu o limite do target."],
      },
    });

    const currentHost = await renderViewport();
    host = currentHost;
    const toolbar = currentHost.querySelector('[data-testid="viewport-scene-toolbar"]');
    const blocker = currentHost.querySelector('[data-testid="viewport-build-blockers"]');
    const stage = currentHost.querySelector('[data-testid="viewport-scene-stage"]');

    expect(toolbar?.getAttribute("role")).toBe("toolbar");
    expect(toolbar?.textContent).toContain("Mais ferramentas");
    expect(currentHost.querySelector('[data-testid="viewport-scene-secondary-tools"]')).toBeNull();
    expect(blocker?.getAttribute("role")).toBe("alert");
    expect(blocker?.textContent).toContain("VRAM excedeu o limite do target.");
    expect(Boolean((blocker as Element).compareDocumentPosition(stage as Node) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const disclosure = toolbar?.querySelector<HTMLButtonElement>(
      '[aria-controls="viewport-scene-secondary-tools"]'
    );
    await act(async () => disclosure?.click());
    expect(currentHost.querySelector('[data-testid="viewport-scene-secondary-tools"]')).not.toBeNull();
  });

  it("uses real SNES dimensions and exposes an adaptive metrics panel in Game", async () => {
    useEditorStore.setState({
      activeTarget: "snes",
      activeViewportTab: "game",
      activeWorkspace: "game",
    });

    const currentHost = await renderViewport();
    host = currentHost;
    const canvas = currentHost.querySelector('[data-testid="viewport-game-canvas"]');
    const metrics = currentHost.querySelector('[data-testid="viewport-performance-overlay"]');

    expect(currentHost.querySelector('[data-testid="viewport-game-primary-toolbar"]')?.textContent).toContain("SNES");
    expect(canvas?.getAttribute("width")).toBe("256");
    expect(canvas?.getAttribute("height")).toBe("224");
    expect(canvas?.getAttribute("aria-label")).toContain("resolução 256x224");
    expect(currentHost.querySelector('[data-testid="viewport-game-advanced-controls"]')).toBeNull();
    expect(metrics?.getAttribute("data-floating")).toBe("true");
    const autoHide = currentHost.querySelector<HTMLButtonElement>(
      '[data-testid="viewport-performance-overlay-auto-hide"]'
    );
    expect(autoHide).not.toBeNull();
    expect(currentHost.querySelector('[data-testid="viewport-performance-overlay-float"]')).not.toBeNull();

    await act(async () => {
      currentHost
        .querySelector<HTMLButtonElement>('[aria-controls="viewport-game-advanced-controls"]')
        ?.click();
      autoHide?.click();
    });
    expect(currentHost.querySelector('[data-testid="viewport-game-advanced-controls"]')).not.toBeNull();
    expect(autoHide?.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the selected Scene context movable, resizable and auto-hide capable", async () => {
    const scene = {
      scene_id: "main",
      display_name: "Cena principal",
      entities: [
        {
          entity_id: "hero",
          prefab: null,
          transform: { x: 16, y: 24 },
          components: {},
        },
      ],
      background_layers: [],
      palettes: [],
    };
    useEditorStore.setState({
      activeScene: scene,
      activeSceneSource: structuredClone(scene),
      selectedEntityId: "hero",
    });

    const currentHost = await renderViewport();
    host = currentHost;
    const contextPanel = currentHost.querySelector('[data-testid="viewport-creator-command-dock"]');

    expect(contextPanel?.getAttribute("data-floating")).toBe("true");
    expect(currentHost.querySelector('[data-testid="viewport-creator-command-dock-move-handle"]')).not.toBeNull();
    expect(currentHost.querySelector('[data-testid="viewport-creator-command-dock-resize-handle"]')).not.toBeNull();
    expect(currentHost.querySelector('[data-testid="viewport-creator-command-dock-auto-hide"]')).not.toBeNull();
  });
});
