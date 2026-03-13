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
  emulatorSaveState: vi.fn(),
  emulatorLoadState: vi.fn(),
  emulatorRewindStep: vi.fn(),
  emulatorStop: vi.fn(),
  emulatorSendInput: vi.fn(),
  startFrameLoop: vi.fn(),
  listenToAudioStream: vi.fn(),
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
  pollProjectAssetChanges: vi.fn(),
  listenToProjectAssetChanges: vi.fn(),
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
  emulatorSaveState: mocks.emulatorSaveState,
  emulatorLoadState: mocks.emulatorLoadState,
  emulatorRewindStep: mocks.emulatorRewindStep,
  emulatorStop: mocks.emulatorStop,
  emulatorSendInput: mocks.emulatorSendInput,
  startFrameLoop: mocks.startFrameLoop,
  listenToAudioStream: mocks.listenToAudioStream,
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

vi.mock("./core/ipc/projectWatcherService", () => ({
  pollProjectAssetChanges: mocks.pollProjectAssetChanges,
  listenToProjectAssetChanges: mocks.listenToProjectAssetChanges,
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
      hwValidationRefreshTick: 0,
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
      scanline_sprite_peak: 0,
      scanline_sprite_limit: 20,
      dma_used: 0,
      dma_limit: 7372,
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
        scanline_sprite_peak: 0,
        scanline_sprite_limit: 20,
        dma_used: 0,
        dma_limit: 7372,
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
    mocks.emulatorSaveState.mockResolvedValue({
      ok: true,
      message: "Save state salvo (8 bytes).",
    });
    mocks.emulatorLoadState.mockResolvedValue({
      ok: true,
      message: "Save state restaurado.",
    });
    mocks.emulatorRewindStep.mockResolvedValue({
      ok: true,
      message: "Rewind restaurado para o frame 0 (0 snapshot(s) restantes, intervalo 1 frame(s)).",
    });
    mocks.emulatorSendInput.mockResolvedValue({
      ok: true,
      message: "",
    });
    mocks.listenToAudioStream.mockResolvedValue(vi.fn());
    mocks.pollProjectAssetChanges.mockResolvedValue({
      changed: false,
      changed_paths: [],
    });
    mocks.listenToProjectAssetChanges.mockResolvedValue(vi.fn());
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

  it("disables Build & Run and explains why when live validation reports a fresh fatal error", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 70000,
          vram_limit: 65536,
          sprite_count: 12,
          sprite_limit: 80,
          scanline_sprite_peak: 6,
          scanline_sprite_limit: 20,
          dma_used: 70000,
          dma_limit: 7372,
          bg_layers: 2,
          bg_layers_limit: 4,
          errors: ["Estouro de VRAM"],
          warnings: [],
        },
        hwValidationState: "fresh",
        hwValidatedRevision: 1,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const reason = container.querySelector("[data-testid='build-disabled-reason']");
    const liveState = container.querySelector("[data-testid='build-live-state']");

    expect(buildButton.disabled).toBe(true);
    expect(buildButton.getAttribute("aria-describedby")).toBe("build-disabled-reason");
    expect(reason?.textContent).toContain("Build bloqueado: Estouro de VRAM");
    expect(liveState?.textContent).toContain("BLOQUEADO");

    await act(async () => {
      buildButton.click();
      await flush();
    });

    expect(mocks.buildProject).not.toHaveBeenCalled();
  });

  it("keeps Build & Run enabled when the live validation snapshot is stale", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 70000,
          vram_limit: 65536,
          sprite_count: 12,
          sprite_limit: 80,
          scanline_sprite_peak: 6,
          scanline_sprite_limit: 20,
          dma_used: 70000,
          dma_limit: 7372,
          bg_layers: 2,
          bg_layers_limit: 4,
          errors: ["Estouro de VRAM"],
          warnings: [],
        },
        hwValidationState: "stale",
        hwValidatedRevision: 0,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const revalidateButton = container.querySelector(
      "[data-testid='build-stale-revalidate']"
    ) as HTMLButtonElement | null;
    const refreshTickBefore = useEditorStore.getState().hwValidationRefreshTick;

    expect(buildButton.disabled).toBe(false);
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-state']")?.textContent).toContain(
      "DESATUAL."
    );
    expect(container.querySelector("[data-testid='build-stale-hint']")?.textContent).toContain(
      "Edite a cena para revalidar"
    );
    expect(revalidateButton?.textContent).toContain("Revalidar agora");
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();

    await act(async () => {
      revalidateButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().hwValidationRefreshTick).toBe(refreshTickBefore + 1);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "[Live] Revalidacao manual solicitada.")
    ).toBe(true);

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("keeps Build & Run enabled when the live validation snapshot only has warnings", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 57344,
          vram_limit: 65536,
          sprite_count: 1,
          sprite_limit: 80,
          scanline_sprite_peak: 1,
          scanline_sprite_limit: 20,
          dma_used: 57344,
          dma_limit: 7372,
          bg_layers: 0,
          bg_layers_limit: 4,
          errors: [],
          warnings: ["VRAM Warning: uso alto de VRAM."],
        },
        hwValidationState: "fresh",
        hwValidatedRevision: 1,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const warning = container.querySelector("[data-testid='build-warning-summary']");
    const liveState = container.querySelector("[data-testid='build-live-state']");

    expect(buildButton.disabled).toBe(false);
    expect(buildButton.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();
    expect(liveState?.textContent).toContain("WARN");
    expect(warning?.textContent).toContain("Build com alerta: VRAM Warning: uso alto de VRAM.");

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("shows LIVE state with no extra summaries when diagnostics are fresh and clean", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 8192,
          vram_limit: 65536,
          sprite_count: 4,
          sprite_limit: 80,
          scanline_sprite_peak: 2,
          scanline_sprite_limit: 20,
          dma_used: 4096,
          dma_limit: 7372,
          bg_layers: 1,
          bg_layers_limit: 4,
          errors: [],
          warnings: [],
        },
        hwValidationState: "fresh",
        hwValidatedRevision: 1,
        hwValidationError: null,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const liveState = container.querySelector("[data-testid='build-live-state']");

    expect(buildButton.disabled).toBe(false);
    expect(liveState?.textContent).toContain("LIVE");
    expect(liveState?.getAttribute("title")).toContain("Preview live sincronizado.");
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-error-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-pending-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-stale-hint']")).toBeNull();
    expect(container.querySelector("[data-testid='build-stale-revalidate']")).toBeNull();

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("shows explicit live error detail without blocking Build & Run", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwValidationState: "error",
        hwValidationError: "Falha de comunicacao com validate_scene_draft",
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const liveState = container.querySelector("[data-testid='build-live-state']");
    const errorSummary = container.querySelector("[data-testid='build-live-error-summary']");

    expect(buildButton.disabled).toBe(false);
    expect(liveState?.textContent).toContain("ERRO LIVE");
    expect(errorSummary?.textContent).toContain(
      "Live com falha: Falha de comunicacao com validate_scene_draft"
    );
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("requests live revalidation when project assets change on disk", async () => {
    mocks.pollProjectAssetChanges.mockResolvedValueOnce({
      changed: true,
      changed_paths: ["assets/sprites/hero.ppm"],
    });

    const refreshTickBefore = useEditorStore.getState().hwValidationRefreshTick;

    await act(async () => {
      root.unmount();
      await flush();
      root = createRoot(container);
      root.render(<App />);
      await flush();
      await flush();
    });

    expect(mocks.pollProjectAssetChanges).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy"
    );
    expect(useEditorStore.getState().hwValidationRefreshTick).toBe(refreshTickBefore + 1);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) =>
          entry.message.includes("[Hot Reload] 1 asset(s) alterado(s) no disco: assets/sprites/hero.ppm")
        )
    ).toBe(true);
  });

  it("shows an explicit pending live analysis summary while keeping Build & Run enabled", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwValidationState: "pending",
        hwValidationError: null,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const liveState = container.querySelector("[data-testid='build-live-state']");
    const pendingSummary = container.querySelector("[data-testid='build-live-pending-summary']");

    expect(buildButton.disabled).toBe(false);
    expect(liveState?.textContent).toContain("ANALISANDO");
    expect(pendingSummary?.textContent).toContain("Live em analise...");
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-error-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("triggers emulator save and load state actions from the game viewport", async () => {
    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Salvar state").click();
      await flush();
    });

    await act(async () => {
      findButton(container, "Carregar state").click();
      await flush();
    });

    expect(mocks.emulatorSaveState).toHaveBeenCalledTimes(1);
    expect(mocks.emulatorLoadState).toHaveBeenCalledTimes(1);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "[Emulador] Save state salvo (8 bytes).")
    ).toBe(true);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "[Emulador] Save state restaurado.")
    ).toBe(true);
  });

  it("supports pause, single-frame step, and resume from the game viewport", async () => {
    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    const pauseButton = container.querySelector("[data-testid='viewport-pause']");
    const resumeButton = container.querySelector("[data-testid='viewport-resume']");
    const stepButton = container.querySelector("[data-testid='viewport-step-frame']");

    expect(pauseButton).toBeInstanceOf(HTMLButtonElement);
    expect(resumeButton).toBeInstanceOf(HTMLButtonElement);
    expect(stepButton).toBeInstanceOf(HTMLButtonElement);
    expect((stepButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      (pauseButton as HTMLButtonElement).click();
      await flush();
    });

    expect(useEditorStore.getState().emulPaused).toBe(true);
    expect((stepButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      (stepButton as HTMLButtonElement).click();
      await flush();
    });

    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "Frame unico executado.")
    ).toBe(true);

    await act(async () => {
      (resumeButton as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    expect(useEditorStore.getState().emulPaused).toBe(false);
    expect(mocks.startFrameLoop).toHaveBeenCalledTimes(3);
  });

  it("triggers rewind from the game viewport controls and keyboard shortcut while paused", async () => {
    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    const pauseButton = container.querySelector("[data-testid='viewport-pause']");
    const rewindButton = container.querySelector("[data-testid='viewport-rewind']");

    expect(pauseButton).toBeInstanceOf(HTMLButtonElement);
    expect(rewindButton).toBeInstanceOf(HTMLButtonElement);
    expect((rewindButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      (pauseButton as HTMLButtonElement).click();
      await flush();
    });

    expect((rewindButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      (rewindButton as HTMLButtonElement).click();
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }));
      await flush();
    });

    expect(mocks.emulatorRewindStep).toHaveBeenCalledTimes(2);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message.includes("[Rewind] Rewind restaurado para o frame 0"))
    ).toBe(true);
  });

  it("shows a hot reload notice in the game viewport when backend asset change events arrive", async () => {
    let onAssetChange: ((payload: { project_dir: string; changed_paths: string[] }) => void) | null = null;
    mocks.listenToProjectAssetChanges.mockImplementation(async (callback) => {
      onAssetChange = callback;
      return vi.fn();
    });

    await act(async () => {
      root.unmount();
      await flush();
      root = createRoot(container);
      root.render(<App />);
      await flush();
      await flush();
    });

    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    await act(async () => {
      onAssetChange?.({
        project_dir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        changed_paths: ["assets/sprites/hero.ppm"],
      });
      await flush();
    });

    const banner = container.querySelector("[data-testid='viewport-asset-hot-reload']");
    expect(banner?.textContent).toContain("Assets alterados no disco.");
    expect(banner?.textContent).toContain("assets/sprites/hero.ppm");
  });

  it("resizes the selected sprite from scene gizmos with 8px snapping and persists the change", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "scene",
        selectedEntityId: "hero",
        activeScene: {
          scene_id: "main_scene",
          display_name: "Main Scene",
          background_layers: [],
          entities: [
            {
              entity_id: "hero",
              prefab: "Hero",
              transform: { x: 16, y: 16 },
              components: {
                sprite: {
                  asset: "assets/sprites/hero.ppm",
                  frame_width: 32,
                  frame_height: 32,
                },
              },
            },
          ],
        },
      });
      await flush();
      await flush();
    });

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    Object.defineProperty(canvas as HTMLCanvasElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 320,
        height: 224,
        right: 320,
        bottom: 224,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      (canvas as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 48,
          clientY: 48,
          button: 0,
        })
      );
      (canvas as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 65,
          clientY: 65,
          buttons: 1,
        })
      );
      (canvas as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 65,
          clientY: 65,
        })
      );
      await flush();
      await flush();
    });

    const hero = useEditorStore.getState().activeScene?.entities[0];
    expect(hero?.transform).toEqual({ x: 16, y: 16 });
    expect(hero?.components.sprite?.frame_width).toBe(48);
    expect(hero?.components.sprite?.frame_height).toBe(48);
    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Viewport"
    );
  });

  it("shows and toggles the game performance overlay", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "game",
        hwStatus: {
          vram_used: 4096,
          vram_limit: 65536,
          sprite_count: 6,
          sprite_limit: 80,
          scanline_sprite_peak: 4,
          scanline_sprite_limit: 20,
          dma_used: 4096,
          dma_limit: 7372,
          bg_layers: 1,
          bg_layers_limit: 4,
          errors: [],
          warnings: [],
        },
      });
      await flush();
      await flush();
    });

    const overlayToggle = findButton(container, "Overlay ON");
    const overlay = container.querySelector("[data-testid='viewport-performance-overlay']");

    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Sprites 6");
    expect(overlay?.textContent).toContain("DMA est.");

    await act(async () => {
      overlayToggle.click();
      await flush();
    });

    expect(container.querySelector("[data-testid='viewport-performance-overlay']")).toBeNull();
    expect(findButton(container, "Overlay OFF")).toBeInstanceOf(HTMLButtonElement);
  });

  it("shows the live VRAM budget bar in the toolbar", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 49152,
          vram_limit: 65536,
          sprite_count: 12,
          sprite_limit: 80,
          scanline_sprite_peak: 18,
          scanline_sprite_limit: 20,
          dma_used: 49152,
          dma_limit: 7372,
          bg_layers: 2,
          bg_layers_limit: 4,
          errors: [],
          warnings: ["VRAM Warning"],
        },
      });
      await flush();
    });

    const budget = container.querySelector("[data-testid='toolbar-vram-budget']");
    const label = container.querySelector("[data-testid='toolbar-vram-budget-label']");
    const bar = container.querySelector("[data-testid='toolbar-vram-budget-bar']") as HTMLElement | null;
    const scanlineLabel = container.querySelector("[data-testid='toolbar-scanline-budget-label']");

    expect(budget).not.toBeNull();
    expect(label?.textContent).toContain("48 / 64 KB");
    expect(bar?.style.width).toBe("75%");
    expect(scanlineLabel?.textContent).toContain("18 / 20");
  });

  it("creates and disposes the game audio context with the audio stream lifecycle", async () => {
    const audioContextCtor = vi.fn();
    const gainConnect = vi.fn();
    const gainDisconnect = vi.fn();
    const processorConnect = vi.fn();
    const processorDisconnect = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const suspend = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const createGain = vi.fn(() => ({
      gain: { value: 1 },
      connect: gainConnect,
      disconnect: gainDisconnect,
    }));
    const createScriptProcessor = vi.fn(() => ({
      onaudioprocess: null,
      connect: processorConnect,
      disconnect: processorDisconnect,
    }));
    class FakeAudioContext {
      public state = "running";
      public destination = {};

      constructor() {
        audioContextCtor();
      }

      createGain() {
        return createGain();
      }

      createScriptProcessor() {
        return createScriptProcessor();
      }

      close() {
        return close();
      }

      suspend() {
        return suspend();
      }

      resume() {
        return resume();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    mocks.listenToAudioStream.mockImplementation(async (onAudio: (payload: { sample_rate: number; samples: number[] }) => void) => {
      onAudio({ sample_rate: 44100, samples: [0, 0, 1, -1] });
      return vi.fn();
    });

    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    expect(mocks.listenToAudioStream).toHaveBeenCalledTimes(1);
    expect(audioContextCtor).toHaveBeenCalledTimes(1);
    expect(createGain).toHaveBeenCalledTimes(1);
    expect(createScriptProcessor).toHaveBeenCalledTimes(1);

    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "scene" });
      await flush();
      await flush();
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(processorDisconnect).toHaveBeenCalledTimes(1);
    expect(gainDisconnect).toHaveBeenCalledTimes(1);
  });
});
