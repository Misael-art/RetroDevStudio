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
    ).toContain("Ainda nao referenciado pela cena ativa.");
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
    ).toContain("Referenciado por 1 item(ns) na cena ativa.");
    expect(
      container.querySelector("[data-testid='asset-browser-reference-summary']")?.textContent
    ).toContain("Sprite · hero");
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

    expect(container.textContent).toContain("Carregando Reverse Workspace...");
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
