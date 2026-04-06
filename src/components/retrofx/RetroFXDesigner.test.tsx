import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RetroFXDesigner from "./RetroFXDesigner";
import { useEditorStore } from "../../core/store/editorStore";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

describe("RetroFXDesigner", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(async () => {
    vi.clearAllMocks();

    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(() => 1),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    mocks.persistActiveScene.mockResolvedValue(true);

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/demo",
      activeProjectName: "Demo",
      activeScenePath: "scenes/main.json",
      activeViewportTab: "retrofx",
      activeTarget: "megadrive",
      sceneRevision: 1,
      emulatorLoaded: false,
      emulPaused: false,
      hwStatus: null,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      hwValidationRefreshTick: 0,
      selectedEntityId: null,
      consoleEntries: [],
      consoleVisible: true,
      activeScene: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        background_layers: [],
        entities: [],
        retrofx: {
          parallax_layers: [
            { id: "p0", name: "BG1", speed_x: 1, speed_y: 0, enabled: true },
            { id: "p1", name: "BG2", speed_x: 3, speed_y: 0, enabled: true },
            { id: "p2", name: "BG3", speed_x: 5, speed_y: 0, enabled: true },
          ],
          raster_lines: [{ id: "r0", scanline: 128, offset_x: 4, enabled: true }],
        },
      },
      activeSceneSource: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        background_layers: [],
        entities: [],
        retrofx: {
          parallax_layers: [
            { id: "p0", name: "BG1", speed_x: 1, speed_y: 0, enabled: true },
            { id: "p1", name: "BG2", speed_x: 3, speed_y: 0, enabled: true },
            { id: "p2", name: "BG3", speed_x: 5, speed_y: 0, enabled: true },
          ],
          raster_lines: [{ id: "r0", scanline: 128, offset_x: 4, enabled: true }],
        },
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<RetroFXDesigner />);
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: originalCancelAnimationFrame,
    });
  });

  it("renders the visual-first parallax workspace with pedagogical labels", () => {
    expect(container.textContent).toContain("Editor visual de profundidade e movimento");
    expect(container.textContent).toContain(
      "Camadas mais distantes se movem mais devagar"
    );
    expect(container.textContent).toContain("Far");
    expect(container.textContent).toContain("Mid");
    expect(container.textContent).toContain("Near");
    expect(findButton(container, "Pause")).toBeInstanceOf(HTMLButtonElement);
  });

  it("updates speed controls immediately for the selected layer", async () => {
    const range = container.querySelector(
      "[data-testid='retrofx-speed-x-range']"
    ) as HTMLInputElement | null;
    const number = container.querySelector(
      "[data-testid='retrofx-speed-x-number']"
    ) as HTMLInputElement | null;

    expect(range).toBeInstanceOf(HTMLInputElement);
    expect(number).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      setInputValue(number!, "7");
      await flush();
    });

    expect(number?.value).toBe("7");
    expect(container.textContent).toContain("X 7");
  });

  it("keeps build-readiness honest while retrofx changes are only local", async () => {
    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "scenes/main.json"
    );
    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "Scene JSON sincronizado"
    );

    const number = container.querySelector(
      "[data-testid='retrofx-speed-x-number']"
    ) as HTMLInputElement | null;

    await act(async () => {
      setInputValue(number!, "8");
      await flush();
    });

    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "Alteracoes locais ainda nao salvas"
    );
    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "Salve o RetroFX para levar estas alteracoes ao scene JSON antes do build."
    );
  });

  it("toggles the animated preview state without losing the pedagogical workspace", async () => {
    await act(async () => {
      findButton(container, "Pause").click();
      await flush();
    });

    expect(findButton(container, "Play")).toBeInstanceOf(HTMLButtonElement);
    expect(container.textContent).toContain("LoopPausado");
  });

  it("shows the same emission contract on the raster tab", async () => {
    await act(async () => {
      findButton(container, "Raster").click();
      await flush();
    });

    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "Build local pode consumir a configuracao salva atual do scene JSON."
    );
    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "3 parallax / 1 raster"
    );
  });

  it("persists retrofx changes into both active scene copies", async () => {
    const number = container.querySelector(
      "[data-testid='retrofx-speed-x-number']"
    ) as HTMLInputElement | null;

    await act(async () => {
      setInputValue(number!, "6");
      await flush();
    });

    await act(async () => {
      findButton(container, "Salvar RetroFX").click();
      await flush();
      await flush();
    });

    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/demo",
      "RetroFX",
      "Configuracao salva no scene JSON. Emissao para build continua experimental."
    );
    expect(container.querySelector("[data-testid='retrofx-build-plan']")?.textContent).toContain(
      "Scene JSON sincronizado"
    );
    expect(
      useEditorStore.getState().activeScene?.retrofx?.parallax_layers[0]?.speed_x
    ).toBe(6);
    expect(
      useEditorStore.getState().activeSceneSource?.retrofx?.parallax_layers[0]?.speed_x
    ).toBe(6);
  });
});
