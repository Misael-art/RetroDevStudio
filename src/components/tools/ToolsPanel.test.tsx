import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ToolsPanel from "./ToolsPanel";
import { useEditorStore } from "../../core/store/editorStore";

vi.mock("./ReverseWorkspace", () => ({
  default: () => "Reverse Workspace carregado",
}));

const mocks = vi.hoisted(() => ({
  getThirdPartyStatus: vi.fn(),
  installThirdPartyDependency: vi.fn(),
  detectRomDependency: vi.fn(),
  listProjectAssets: vi.fn(),
  readLegacyProjectFile: vi.fn(),
  reverseExplorerRead: vi.fn(),
  romAnalyze: vi.fn(),
  romAnalyzeWithEmulatorTrace: vi.fn(),
  romDisassemble: vi.fn(),
  romSaveAnnotations: vi.fn(),
  patchCreateIps: vi.fn(),
  patchCreateBps: vi.fn(),
  profilerAnalyzeRom: vi.fn(),
  assetsExtract: vi.fn(),
  emulatorReadMemory: vi.fn(),
  buildMultiTarget: vi.fn(),
  persistActiveScene: vi.fn(),
  listenToProjectAssetChanges: vi.fn(),
  openProjectSourcePath: vi.fn(),
  invoke: vi.fn(() => Promise.reject(new Error("invoke not mocked"))),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: mocks.invoke,
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
  readLegacyProjectFile: mocks.readLegacyProjectFile,
  reverseExplorerRead: mocks.reverseExplorerRead,
  romAnalyze: mocks.romAnalyze,
  romAnalyzeWithEmulatorTrace: mocks.romAnalyzeWithEmulatorTrace,
  romDisassemble: mocks.romDisassemble,
  romSaveAnnotations: mocks.romSaveAnnotations,
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

function changeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    throw new Error("HTMLInputElement value setter unavailable.");
  }
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function createDependencyStatus(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const labels: Record<string, string> = {
    jdk: "JDK (Temurin LTS)",
    sgdk: "SGDK",
    pvsneslib: "PVSnesLib",
    libretro_megadrive: "Libretro Core: Mega Drive",
    libretro_snes: "Libretro Core: SNES",
  };

  return {
    id,
    label: labels[id] ?? id,
    installed: true,
    version: "test-version",
    install_dir: `F:/Toolchains/${id}`,
    status_code: "installed",
    status_label: "INSTALADO",
    severity: "ok",
    cache_available: false,
    manual_configuration_required: false,
    actionable_message: "Dependencia detectada.",
    notes: [],
    issues: [],
    source_url: `https://example.invalid/${id}`,
    auto_install_supported: true,
    ...overrides,
  };
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
      artStudioAssetPath: null,
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
      projectSourceKind: "",
      projectLegacyIndex: null,
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
      {
        relative_path: "assets/tilesets/stage_tiles.ppm",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/tilesets/stage_tiles.ppm",
        kind: "image",
      },
      {
        relative_path: "assets/audio/jump.wav",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/audio/jump.wav",
        kind: "audio",
      },
      {
        relative_path: "assets/palettes/main.pal",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/palettes/main.pal",
        kind: "other",
      },
      {
        relative_path: "assets/source_art/hero.psd",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/source_art/hero.psd",
        kind: "other",
      },
      {
        relative_path: "assets/generated/cache_sprite.ppm",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/generated/cache_sprite.ppm",
        kind: "image",
      },
    ]);
    mocks.readLegacyProjectFile.mockResolvedValue({
      relative_path: "src/main.c",
      absolute_path: "F:/Projects/MegaDrive_DEV/SonicLegacy/src/main.c",
      content: "int main(void) { return 0; }",
      previewable: true,
      readonly: true,
      note: "Somente leitura.",
    });
    mocks.reverseExplorerRead.mockResolvedValue({
      ok: true,
      error: "",
      total_size: 0,
      rows: [],
    });
    const reverseManifestFixture = {
      ok: true,
      error: "",
      target: "megadrive",
      source_path: "F:/roms/test.md",
      detected_format: "md",
      stripped_header_bytes: 0,
      total_size: 4096,
      hashes: { crc32: "deadbeef", sha1: "0123456789abcdef0123456789abcdef01234567" },
      header: {
        console_name: "SEGA GENESIS",
        internal_title: "RETRO TEST",
        region: "U",
        version: "01",
        publisher: null,
        entry_point: 512,
      },
      mapper: "linear_rom",
      special_chips: [],
      segments: [{ start: 0, end: 512, kind: "header", label: "Header", bank_index: null, confidence: 100 }],
      graphics_regions: [{ id: "gfx_000", start: 512, end: 768, kind: "tileset", bpp: 4, tile_width: 8, tile_height: 8, tile_count: 8, palette_slot: 0, confidence: 80, note: "ok" }],
      text_regions: [],
      audio_regions: [],
      code_regions: [{
        start: 512,
        end: 520,
        architecture: "68000",
        entry_points: [512],
        functions: [{ address: 512, end: 520, name: "sub_000200", executed: false, confidence: 80 }],
        xrefs: [{ from: 512, to: 768, kind: "call", label: "call @ 000200" }],
        disassembly: [],
      }],
      pointer_tables: [],
      compression_regions: [],
      call_graph: [{ from: 512, to: 768, kind: "call" }],
      logic_hints: [],
      annotations: [],
      trace: { available: false, executed_regions: [], note: "Trace dinamico indisponivel para esta ROM nesta sessao." },
      projection_status: { supported: false, status: "analysis_only", message: "future" },
    };
    mocks.romAnalyze.mockResolvedValue(reverseManifestFixture);
    mocks.romAnalyzeWithEmulatorTrace.mockResolvedValue(reverseManifestFixture);
    mocks.romDisassemble.mockResolvedValue({
      ok: true,
      error: "",
      total_size: 4096,
      rows: [{ offset: 512, bytes: [0x4e, 0x71], size: 2, text: "nop", kind: "nop", target: null }],
    });
    mocks.romSaveAnnotations.mockResolvedValue(1);
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
    mocks.openProjectSourcePath.mockResolvedValue({
      ok: true,
      message: "opened",
      absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/src/player.c",
    });

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
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    // In tree view, click the asset file to select it and show the detail panel
    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find(
        (el) => el.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
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

  it("shows when the selected asset is not yet referenced by the active scene", async () => {
    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find(
        (el) => el.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
      await flush();
    });

    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Asset orfao");
    expect(
      container.querySelector("[data-testid='asset-browser-instantiation-notice']")?.textContent
    ).toContain("Instanciar como sprite");
    expect(
      container.querySelector("[data-testid='asset-browser-instantiation-notice']")?.textContent
    ).toContain("padrao-sprite-sem-sinais-de-tilemap");
    expect(container.querySelector("[data-testid='asset-browser-budget-summary']")?.textContent).toContain(
      "Orfao"
    );
  });

  it("searches and filters the rendered asset catalog", async () => {
    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    const search = container.querySelector("[data-testid='asset-browser-search']") as HTMLInputElement;
    await act(async () => {
      changeInputValue(search, "audio");
      await flush();
    });

    expect(container.textContent).toContain("jump.wav");
    expect(container.textContent).not.toContain("onboarding_player.ppm");

    await act(async () => {
      changeInputValue(search, "");
      findButton(container, "source art").click();
      await flush();
    });

    expect(container.textContent).toContain("hero.psd");
    expect(container.textContent).not.toContain("stage_tiles.ppm");
  });

  it("keeps selected image previews contained in a 1366x768 workspace", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });

    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find(
        (element) => element.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
      await flush();
    });

    const preview = container.querySelector(
      "[data-testid='asset-browser-selected-preview']"
    ) as HTMLImageElement | null;
    const previewClasses = preview?.className.split(/\s+/) ?? [];
    expect(preview).not.toBeNull();
    expect(previewClasses).toContain("object-contain");
    expect(previewClasses).toContain("max-w-full");
    expect(previewClasses).not.toContain("object-cover");
    expect(previewClasses).not.toContain("h-full");
    expect(previewClasses).not.toContain("w-full");
  });

  it("opens an unused project sprite in ArtStudio without inserting it into the scene", async () => {
    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find(
        (element) => element.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
      await flush();
    });

    await act(async () => {
      (container.querySelector("[data-testid='asset-browser-open-artstudio']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeWorkspace).toBe("artstudio");
    expect(state.activeViewportTab).toBe("artstudio");
    expect(state.artStudioAssetPath).toBe("assets/sprites/onboarding_player.ppm");
    expect(state.activeScene?.entities).toHaveLength(0);
    expect(mocks.persistActiveScene).not.toHaveBeenCalled();
  });

  it("shows the current scene references for the selected asset", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "hero",
              prefab: null,
              transform: { x: 16, y: 24 },
              components: {
                sprite: {
                  asset: "assets/sprites/onboarding_player.ppm",
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
      });
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find(
        (el) => el.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
      await flush();
    });

    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Usado por 1 item(ns) na cena ativa.");
    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Sprite · hero");
    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Jogador");
    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Guia");
  });

  it("opens the referenced tilemap directly in the painting workflow from the asset browser", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "scene",
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "stage_tilemap",
              display_name: "Stage Tilemap",
              prefab: null,
              transform: { x: 0, y: 0 },
              components: {
                tilemap: {
                  tileset: "assets/tilesets/stage_tiles.ppm",
                  map_width: 64,
                  map_height: 32,
                  scroll_x: 0,
                  scroll_y: 0,
                  cells: [],
                },
                logic: {
                  imported_semantics: {
                    source: "sgdk_phase_d",
                    entity_role: "support_actor",
                    confidence: "medium",
                    role_reason: "stage world",
                    driver_functions: ["stage_tick"],
                    source_paths: ["src/stage.c"],
                    audit_flags: ["position:staging_layout"],
                  },
                },
              },
            },
          ],
          background_layers: [],
          palettes: [],
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("stage_tiles.ppm")
      );
      fileBtn?.click();
      await flush();
      await flush();
    });

    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Staging");

    await act(async () => {
      (
        container.querySelector(
          "[data-testid='asset-browser-open-authoring-target']"
        ) as HTMLButtonElement
      ).click();
      await flush();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeViewportTab).toBe("scene");
    expect(state.editorMode).toBe("paint");
    expect(state.activeTilemapId).toBe("stage_tilemap");
    expect(state.activeBrush?.kind).toBe("tile");
    expect(state.activeBrush?.assetPath).toBe("assets/tilesets/stage_tiles.ppm");
  });

  it("opens logic and source directly from the referenced asset card", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "scene",
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "hero",
              prefab: null,
              transform: { x: 16, y: 24 },
              components: {
                sprite: {
                  asset: "assets/sprites/onboarding_player.ppm",
                  frame_width: 16,
                  frame_height: 16,
                  palette_slot: 0,
                  animations: {},
                },
                logic: {
                  graph_ref: "graphs/hero_logic.json",
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
                  external_source_refs: ["src/player_debug.c"],
                },
              },
            },
          ],
          background_layers: [],
          palettes: [],
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='asset-browser-open-source']")).toBeTruthy();
    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Node: graphs/hero_logic.json");

    await act(async () => {
      (
        container.querySelector(
          "[data-testid='asset-browser-open-authoring-target']"
        ) as HTMLButtonElement
      ).click();
      await flush();
      await flush();
    });

    expect(useEditorStore.getState().activeViewportTab).toBe("logic");

    await act(async () => {
      (container.querySelector("[data-testid='asset-browser-open-source']") as HTMLButtonElement).click();
      await flush();
    });

    expect(mocks.openProjectSourcePath).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "src/player.c"
    );
  });

  it("shows the adopted SGDK host summary in runtime setup", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "F:/Projects/MegaDrive_DEV/SonicLegacy/rds",
        activeProjectName: "Sonic Legacy",
        projectSourceKind: "external_sgdk",
        projectLegacyIndex: {
          host_root: "F:/Projects/MegaDrive_DEV/SonicLegacy",
          source_files: ["src/main.c", "src/player.c"],
          header_files: ["inc/game.h"],
          manifest_files: ["res/resources.res"],
          resource_files: ["res/sprites/hero.png", "res/stage/level.png"],
          output_files: ["out/rom.bin"],
        },
      });
      await flush();
      await flush();
    });

    const card = container.querySelector("[data-testid='runtime-legacy-sgdk-card']");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("SGDK legado");
    expect(card?.textContent).toContain("Sonic Legacy");
    expect(card?.textContent).toContain("F:/Projects/MegaDrive_DEV/SonicLegacy");

    await act(async () => {
      findButton(container, "Ver indice").click();
      await flush();
    });

    expect(card?.textContent).toContain("src/main.c");
    expect(card?.textContent).toContain("res/resources.res");
    expect(card?.textContent).toContain("out/rom.bin");
  });

  it("shows compact actionable runtime diagnostics and revalidates safely", async () => {
    mocks.getThirdPartyStatus.mockClear();
    mocks.getThirdPartyStatus.mockResolvedValueOnce({
      generated_at_unix: 123,
      report_path:
        "F:/Projects/RetroDevStudio-agent-j-runtime-setup/src-tauri/target-test/validation/runtime-dependency-diagnostics.json",
      summary: {
        total: 3,
        installed: 1,
        blocking: 2,
        warnings: 0,
        manual_required: 1,
        cache_available: 1,
        download_failed: 0,
      },
      items: [
        createDependencyStatus("jdk", {
          label: "JDK (Temurin LTS)",
          version: "21.0.7",
          actionable_message: "JDK detectada e pronta para SGDK.",
        }),
        createDependencyStatus("sgdk", {
          installed: false,
          version: null,
          status_code: "cache_available",
          status_label: "CACHE DISPONIVEL",
          severity: "warning",
          cache_available: true,
          issues: ["Nao instalado em 'toolchains/sgdk'."],
          actionable_message:
            "Metadata de release oficial em cache; use Instalar / Reinstalar quando a rede voltar para baixar o pacote.",
        }),
        createDependencyStatus("tauri_driver", {
          label: "tauri-driver",
          installed: false,
          version: null,
          status_code: "manual_configuration_required",
          status_label: "CONFIGURACAO MANUAL",
          severity: "blocking",
          manual_configuration_required: true,
          auto_install_supported: false,
          issues: ["tauri-driver nao encontrado no PATH."],
          actionable_message:
            "Instale com cargo install tauri-driver --locked e revalide o Runtime Setup.",
        }),
      ],
    });

    await act(async () => {
      findButton(container, "Revalidar").click();
      await flush();
      await flush();
    });

    const summary = container.querySelector("[data-testid='runtime-diagnostics-summary']");
    expect(summary?.textContent).toContain("3 dependencias");
    expect(summary?.textContent).toContain("2 bloqueio");
    expect(summary?.textContent).toContain("1 manual");

    const sgdkStatus = container.querySelector("[data-testid='runtime-diagnostic-status-sgdk']");
    expect(sgdkStatus?.textContent).toContain("CACHE DISPONIVEL");
    expect(container.querySelector("[data-testid='runtime-diagnostic-action-sgdk']")?.textContent).toContain(
      "Instalar / Reinstalar"
    );
    expect(
      container.querySelector("[data-testid='runtime-diagnostic-status-tauri_driver']")?.textContent
    ).toContain("CONFIGURACAO MANUAL");

    mocks.getThirdPartyStatus.mockResolvedValueOnce({
      generated_at_unix: 124,
      report_path: "runtime-dependency-diagnostics.json",
      summary: {
        total: 1,
        installed: 1,
        blocking: 0,
        warnings: 0,
        manual_required: 0,
        cache_available: 0,
        download_failed: 0,
      },
      items: [createDependencyStatus("jdk")],
    });

    await act(async () => {
      findButton(container, "Revalidar").click();
      await flush();
      await flush();
    });

    expect(mocks.getThirdPartyStatus).toHaveBeenCalledTimes(2);
  });

  it("installs missing toolchains before Build All Targets", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    mocks.getThirdPartyStatus
      .mockResolvedValueOnce({
        items: [
          {
            ...createDependencyStatus("jdk"),
            installed: false,
            version: null,
            issues: ["Java/JDK nao encontrado em JAVA_HOME, `toolchains/jdk` ou PATH."],
          },
          createDependencyStatus("sgdk"),
          createDependencyStatus("pvsneslib"),
        ],
      })
      .mockResolvedValueOnce({
        items: [
          createDependencyStatus("jdk"),
          createDependencyStatus("sgdk"),
          createDependencyStatus("pvsneslib"),
        ],
      });
    mocks.installThirdPartyDependency.mockResolvedValueOnce({
      ok: true,
      dependency_id: "jdk",
      message: "JDK instalada no ambiente local.",
      status: createDependencyStatus("jdk"),
      log: [],
    });

    await act(async () => {
      findButton(container, "Build All Targets").click();
      await flush();
      await flush();
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("Build multi-target requer JDK, SGDK e PVSnesLib")
    );
    expect(mocks.installThirdPartyDependency).toHaveBeenCalledWith(
      "jdk",
      expect.any(Function)
    );
    expect(mocks.buildMultiTarget).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      ["megadrive", "snes"],
      expect.any(Function)
    );
  });

  it("shows read-only legacy SGDK files inside the asset browser", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "F:/Projects/MegaDrive_DEV/SonicLegacy/rds",
        projectSourceKind: "external_sgdk",
        projectLegacyIndex: {
          host_root: "F:/Projects/MegaDrive_DEV/SonicLegacy",
          source_files: ["src/main.c"],
          header_files: ["inc/game.h"],
          manifest_files: ["res/resources.res"],
          resource_files: [],
          output_files: ["out/rom.bin"],
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    const legacyFileButton = Array.from(container.querySelectorAll("button")).find((element) =>
      element.textContent?.includes("src/main.c")
    );

    expect(container.textContent).toContain("Projeto host SGDK");
    expect(legacyFileButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      legacyFileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      await flush();
    });

    expect(mocks.readLegacyProjectFile).toHaveBeenCalledWith(
      "F:/Projects/MegaDrive_DEV/SonicLegacy/rds",
      "src/main.c"
    );
    expect(container.querySelector("[data-testid='legacy-file-preview']")?.textContent).toContain(
      "int main(void) { return 0; }"
    );
    expect(container.textContent).toContain("Read-only");
  });

  it("loads the lazy reverse workspace shell", async () => {
    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Reverse Workspace/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      await flush();
      await flush();
    });

    expect(container.textContent).toMatch(
      /Carregando Reverse Workspace\.\.\.|Reverse Workspace carregado/
    );
  });

  it("shows a consistent fallback when the selected asset preview fails to load", async () => {
    await act(async () => {
      findButton(container, "Avancado OFF").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Experimental/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Asset Browser/).click();
      await flush();
      await flush();
    });

    await act(async () => {
      const fileBtn = Array.from(container.querySelectorAll("button")).find(
        (element) => element.textContent?.includes("onboarding_player.ppm")
      );
      fileBtn?.click();
      await flush();
      await flush();
    });

    const preview = container.querySelector(
      "[data-testid='asset-browser-selected-preview']"
    ) as HTMLImageElement | null;
    expect(preview).toBeInstanceOf(HTMLImageElement);

    await act(async () => {
      preview?.dispatchEvent(new Event("error"));
      await flush();
      await flush();
    });

    expect(
      container.querySelector("[data-testid='asset-browser-selected-preview-fallback']")?.textContent
    ).toContain("Preview indisponivel");
  });
});
