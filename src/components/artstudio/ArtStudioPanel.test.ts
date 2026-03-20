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
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
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
    expect(container.textContent).toContain("WebP");
    expect(container.textContent).toContain("Imagem externa carregada com sucesso");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
  });

  it("loads a project asset and unlocks apply to scene", async () => {
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
    expect(findButton(container, /Aplicar/).disabled).toBe(false);
  });
});
