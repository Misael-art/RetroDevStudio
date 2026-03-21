import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtStudioPanel, {
  buildArtStudioAnimations,
  describeArtStudioLoadFailure,
  getArtStudioImageFormatLabel,
  resolveArtStudioSpriteAssetPath,
  type SpriteSequence,
} from "./ArtStudioPanel";
import { useEditorStore } from "../../core/store/editorStore";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  artProcessPalette: vi.fn(),
  importArtAsset: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
}));

vi.mock("../../core/ipc/artStudioService", () => ({
  artProcessPalette: mocks.artProcessPalette,
  importArtAsset: mocks.importArtAsset,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

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

describe("ArtStudioPanel helpers", () => {
  it("accepts only sprite sheets that already live under the project sprite assets tree", () => {
    expect(
      resolveArtStudioSpriteAssetPath(
        "F:/Projects/RetroDevStudio/demo",
        "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png"
      )
    ).toBe("assets/sprites/hero/run.png");

    expect(
      resolveArtStudioSpriteAssetPath(
        "F:/Projects/RetroDevStudio/demo",
        "F:/Projects/RetroDevStudio/demo/assets/tilesets/stage.png"
      )
    ).toBeNull();

    expect(
      resolveArtStudioSpriteAssetPath(
        "F:/Projects/RetroDevStudio/demo",
        "D:/Downloads/hero.png"
      )
    ).toBeNull();
  });

  it("detects supported formats from extension", () => {
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.webp")).toBe("WebP");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.gif")).toBe("GIF");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.jpg")).toBe("JPG");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.ppm")).toBe("PPM");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.txt")).toBeNull();
  });

  it("classifies common image load failures with actionable messages", () => {
    expect(describeArtStudioLoadFailure("hero.txt", new Error("unsupported format"))).toContain(
      "Formato nao suportado"
    );
    expect(
      describeArtStudioLoadFailure("hero.png", new Error("failed to fetch asset://hero.png"))
    ).toContain("protocolo de asset");
    expect(describeArtStudioLoadFailure("hero.png", new Error("enoent"))).toContain(
      "Arquivo nao encontrado"
    );
  });

  it("rejects duplicate or unnamed animation keys after normalization", () => {
    const duplicateSequences: SpriteSequence[] = [
      { id: "idle", name: "Idle", frames: [0], fps: 12, loop: true },
      { id: "idle_2", name: "idle", frames: [1], fps: 12, loop: true },
    ];
    const unnamedSequence: SpriteSequence[] = [
      { id: "idle", name: "   ", frames: [0], fps: 12, loop: true },
    ];

    expect(buildArtStudioAnimations(duplicateSequences).error).toContain("mesma chave");
    expect(buildArtStudioAnimations(unnamedSequence).error).toContain("nome valido");
  });

  it("normalizes frames and fps for persisted animations", () => {
    const result = buildArtStudioAnimations([
      { id: "run", name: "Run Cycle", frames: [3, 1, 3, 2], fps: 0, loop: true },
      { id: "empty", name: "Unused", frames: [], fps: 12, loop: false },
    ]);

    expect(result.error).toBeNull();
    expect(result.animations).toEqual({
      run_cycle: {
        frames: [1, 2, 3],
        fps: 12,
        loop: true,
      },
    });
  });
});

describe("ArtStudioPanel import flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalImage: typeof Image;
  let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.artProcessPalette.mockResolvedValue({
      ok: true,
      processed_base64: "ZmFrZS1wbmctcHJldmlldw==",
      error: null,
      format: "PNG",
      source_width: 256,
      source_height: 128,
      processed_width: 256,
      processed_height: 128,
      frame_count: 1,
      background_mode: "corner",
      transparent_pixels: 128,
      palette: [
        "transparent",
        "#000000",
        "#242424",
        "#494949",
        "#6d6d6d",
        "#929292",
        "#b6b6b6",
        "#dbdbdb",
      ],
      palette_size: 8,
      content_bounds: {
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        aligned_x: 0,
        aligned_y: 0,
        aligned_width: 64,
        aligned_height: 32,
        tile_cols: 8,
        tile_rows: 4,
      },
      suggested_frame_width: 32,
      suggested_frame_height: 32,
      recommended_output_width: 32,
      recommended_output_height: 32,
      recommended_scale_percent: 100,
      meta_sprite_candidate: false,
      slicing_mode: "grid",
      suggested_frames: [
        { index: 0, x: 0, y: 0, width: 32, height: 32 },
        { index: 1, x: 32, y: 0, width: 32, height: 32 },
      ],
      warnings: [],
    });
    mocks.importArtAsset.mockResolvedValue({
      ok: true,
      error: null,
      relative_path: "assets/sprites/hero_sheet.png",
      absolute_path: "F:/Projects/RetroDevStudio/demo/assets/sprites/hero_sheet.png",
      sprite_name: "hero_sheet",
      frame_width: 32,
      frame_height: 32,
      frame_count: 2,
      generated_width: 64,
      generated_height: 32,
    });

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/demo",
      activeProjectName: "Demo",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      selectedEntityId: null,
      activeViewportTab: "artstudio",
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

    originalImage = globalThis.Image;
    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;

    class MockImage {
      public naturalWidth = 256;
      public naturalHeight = 128;
      public decoding = "async";
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      private _src = "";

      decode() {
        return Promise.resolve();
      }

      set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
          if (value.includes("broken")) {
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      }

      get src() {
        return this._src;
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:artstudio-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(ArtStudioPanel));
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();

    globalThis.Image = originalImage;
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectUrl,
      });
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it("loads an external image for preparation and keeps apply blocked", async () => {
    mocks.open.mockResolvedValue("D:/Downloads/hero.webp");

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("hero.webp");
    expect(container.textContent).toContain("PNG");
    expect(container.textContent).toContain("ainda nao virou um asset canonico do projeto");
    expect(container.textContent).toContain("corner (128 px)");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
    expect(mocks.artProcessPalette).toHaveBeenCalledWith("D:/Downloads/hero.webp");
  });

  it("imports the canonical sprite sheet before unlocking apply", async () => {
    mocks.open.mockResolvedValue(
      "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png"
    );

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("hero/run.png");
    expect(container.textContent).toContain("Imagem pronta");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
    expect(container.textContent).toContain("Sprite simples");

    await act(async () => {
      findButton(container, "Trazer para assets/sprites").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("assets/sprites/hero_sheet.png");
    expect(findButton(container, /Aplicar/).disabled).toBe(false);
    expect(mocks.importArtAsset).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png",
      "F:/Projects/RetroDevStudio/demo",
      {
        spriteName: "run",
        gridWidth: 32,
        gridHeight: 32,
        slicingMode: "grid",
      }
    );

    await act(async () => {
      findButton(container, /Aplicar/).click();
      await flush();
    });

    const appliedEntity = useEditorStore
      .getState()
      .activeScene?.entities.find((entity) => entity.entity_id === "hero_sheet");
    expect(appliedEntity?.components.sprite).toEqual({
      asset: "assets/sprites/hero_sheet.png",
      frame_width: 32,
      frame_height: 32,
      palette_slot: 0,
      priority: "foreground",
      animations: {
        idle: {
          frames: [0],
          fps: 1,
          loop: true,
        },
      },
    });
  });

  it("surfaces backend processing errors with actionable feedback", async () => {
    mocks.open.mockResolvedValue("D:/Downloads/broken.gif");
    mocks.artProcessPalette.mockResolvedValueOnce({
      ok: false,
      processed_base64: null,
      error: "Falha ao decodificar imagem: formato corrompido.",
      format: null,
      source_width: null,
      source_height: null,
      processed_width: null,
      processed_height: null,
      frame_count: null,
      background_mode: null,
      transparent_pixels: null,
      palette: [],
      palette_size: 0,
      content_bounds: null,
      suggested_frame_width: null,
      suggested_frame_height: null,
      recommended_output_width: null,
      recommended_output_height: null,
      recommended_scale_percent: null,
      meta_sprite_candidate: false,
      warnings: [],
    });

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Falha ao decodificar imagem");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
  });
});
