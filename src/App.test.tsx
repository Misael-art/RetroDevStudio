import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useEditorStore } from "./core/store/editorStore";

const mocks = vi.hoisted(() => ({
  buildProject: vi.fn(),
  validateProject: vi.fn(),
  generateCCode: vi.fn(),
  emulatorLoadRom: vi.fn(),
  emulatorStop: vi.fn(),
  emulatorSendInput: vi.fn(),
  startFrameLoop: vi.fn(),
  getHwStatus: vi.fn(),
  validateSceneDraft: vi.fn(),
  openProjectDialog: vi.fn(),
  newProjectDialog: vi.fn(),
  setProjectTarget: vi.fn(),
  persistActiveScene: vi.fn(),
  reloadSceneFromDisk: vi.fn(),
  getThirdPartyStatus: vi.fn(),
  installThirdPartyDependency: vi.fn(),
  detectRomDependency: vi.fn(),
}));

vi.mock("./components/common/Console", () => ({
  default: () => <div data-testid="console" />,
}));

vi.mock("./components/hierarchy/HierarchyPanel", () => ({
  default: () => <div data-testid="hierarchy" />,
}));

vi.mock("./components/inspector/InspectorPanel", () => ({
  default: () => <div data-testid="inspector" />,
}));

vi.mock("./components/tools/ToolsPanel", () => ({
  default: () => <div data-testid="tools" />,
}));

vi.mock("./components/nodegraph/NodeGraphEditor", () => ({
  default: () => <div data-testid="nodegraph" />,
}));

vi.mock("./components/retrofx/RetroFXDesigner", () => ({
  default: () => <div data-testid="retrofx" />,
}));

vi.mock("./core/ipc/buildService", () => ({
  buildProject: mocks.buildProject,
  validateProject: mocks.validateProject,
  generateCCode: mocks.generateCCode,
}));

vi.mock("./core/ipc/emulatorService", () => ({
  JOYPAD_DEFAULT: {
    b: false,
    y: false,
    select: false,
    start: false,
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    x: false,
    l: false,
    r: false,
  },
  emulatorLoadRom: mocks.emulatorLoadRom,
  emulatorStop: mocks.emulatorStop,
  emulatorSendInput: mocks.emulatorSendInput,
  startFrameLoop: mocks.startFrameLoop,
  keyToJoypad: vi.fn(() => null),
}));

vi.mock("./core/ipc/hwService", () => ({
  getHwStatus: mocks.getHwStatus,
  validateSceneDraft: mocks.validateSceneDraft,
}));

vi.mock("./core/ipc/projectService", () => ({
  openProjectDialog: mocks.openProjectDialog,
  newProjectDialog: mocks.newProjectDialog,
  setProjectTarget: mocks.setProjectTarget,
}));

vi.mock("./core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
  reloadSceneFromDisk: mocks.reloadSceneFromDisk,
}));

vi.mock("./core/ipc/toolsService", () => ({
  getThirdPartyStatus: mocks.getThirdPartyStatus,
  installThirdPartyDependency: mocks.installThirdPartyDependency,
  detectRomDependency: mocks.detectRomDependency,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function createDependencyStatus(id: string) {
  return {
    id,
    label: id,
    installed: true,
    version: "test",
    install_dir: "F:/deps",
    source_url: "https://example.invalid",
    auto_install_supported: true,
    notes: [],
    issues: [],
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

describe("App build flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let putImageDataSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Mega Dummy",
      activeTarget: "megadrive",
      selectedEntityId: null,
      activeViewportTab: "scene",
      hwStatus: null,
      sceneRevision: 1,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      activeScene: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        entities: [],
        background_layers: [],
      },
      emulPaused: false,
      consoleEntries: [],
      consoleVisible: true,
    });

    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.reloadSceneFromDisk.mockResolvedValue(true);
    mocks.getHwStatus.mockResolvedValue({
      vram_used: 0,
      vram_limit: 65536,
      sprite_count: 0,
      sprite_limit: 80,
      bg_layers: 0,
      bg_layers_limit: 4,
      errors: [],
      warnings: [],
    });
    mocks.validateSceneDraft.mockResolvedValue({
      ok: true,
      error: "",
      hw_status: {
        vram_used: 0,
        vram_limit: 65536,
        sprite_count: 0,
        sprite_limit: 80,
        bg_layers: 0,
        bg_layers_limit: 4,
        errors: [],
        warnings: [],
      },
    });
    mocks.getThirdPartyStatus.mockResolvedValue({
      items: [
        createDependencyStatus("sgdk"),
        createDependencyStatus("libretro_megadrive"),
        createDependencyStatus("pvsneslib"),
        createDependencyStatus("libretro_snes"),
      ],
    });
    mocks.buildProject.mockImplementation(async (_projectDir: string, onLog: (line: { level: string; message: string }) => void) => {
      onLog({ level: "info", message: "build log" });
      return {
        ok: true,
        rom_path: "F:/Temp/game.md",
        log: [],
      };
    });
    mocks.emulatorLoadRom.mockResolvedValue({
      ok: true,
      message: "ROM carregada",
    });
    mocks.emulatorStop.mockResolvedValue({
      ok: true,
      message: "Emulador parado",
    });
    mocks.emulatorSendInput.mockResolvedValue({
      ok: true,
      message: "",
    });
    mocks.startFrameLoop.mockImplementation(async (onFrame: (payload: { width: number; height: number; rgba: number[] }) => void) => {
      onFrame({ width: 1, height: 1, rgba: [255, 0, 0, 255] });
      return vi.fn();
    });

    putImageDataSpy = vi.fn();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        putImageData: putImageDataSpy,
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        strokeRect: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        save: vi.fn(),
        setLineDash: vi.fn(),
        restore: vi.fn(),
      })),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
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

  it("builds, loads the ROM, and starts the emulator frame loop", async () => {
    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Build"
    );
    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
    expect(mocks.emulatorLoadRom).toHaveBeenCalledWith("F:/Temp/game.md");
    expect(mocks.startFrameLoop).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().activeViewportTab).toBe("game");
    expect(container.textContent).toContain("Emulador ativo");
    expect(putImageDataSpy).toHaveBeenCalled();
  });
});
