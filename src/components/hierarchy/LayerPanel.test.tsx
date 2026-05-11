import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LayerPanel from "./LayerPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { Scene } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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

const BASE_SCENE: Scene = {
  scene_id: "main",
  display_name: "Main",
  entities: [
    {
      entity_id: "hero",
      prefab: null,
      transform: { x: 16, y: 24 },
      components: {},
    },
  ],
  background_layers: [],
  layers: [
    {
      id: "foreground",
      name: "Foreground",
      kind: "sprite",
      visible: true,
      locked: false,
      depth: 0,
      entity_ids: [],
    },
  ],
  palettes: [],
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("LayerPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeScene: structuredClone(BASE_SCENE),
      activeSceneSource: structuredClone(BASE_SCENE),
      activeLayerId: null,
      selectedEntityId: "hero",
      editorMode: "select",
      sceneRevision: 1,
      consoleEntries: [],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<LayerPanel />);
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

  it("shows the current scene layer summary and assignment hint before a layer is selected", () => {
    expect(container.querySelector("[data-testid='layer-panel-summary']")?.textContent).toContain(
      "Camadas: 1"
    );
    expect(container.querySelector("[data-testid='layer-panel-summary']")?.textContent).toContain(
      "Ativa: Nenhuma"
    );
    expect(container.querySelector("[data-testid='layer-panel-summary']")?.textContent).toContain(
      "Entidade: hero"
    );
    expect(container.querySelector("[data-testid='layer-panel-assignment-hint']")?.textContent).toContain(
      "Selecione uma camada para atribuir hero ao grupo correto."
    );
  });

  it("selects a layer, switches sprite layers into paint mode and assigns the selected entity", async () => {
    const row = container.querySelector("[data-testid='layer-row-foreground']");

    if (!(row instanceof HTMLDivElement)) {
      throw new Error("Foreground layer row not found");
    }

    await act(async () => {
      row.click();
      await flush();
    });

    expect(useEditorStore.getState().activeLayerId).toBe("foreground");
    expect(useEditorStore.getState().editorMode).toBe("paint");
    expect(container.querySelector("[data-testid='layer-panel-summary']")?.textContent).toContain(
      "Ativa: Foreground"
    );
    expect(container.querySelector("[data-testid='layer-panel-summary']")?.textContent).toContain(
      "◈ Sprite · visível · editável · 0 entidade(s)."
    );

    await act(async () => {
      findButton(container, "Atribuir à camada ativa").click();
      await flush();
    });

    expect(useEditorStore.getState().activeScene?.layers?.[0].entity_ids).toContain("hero");
    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "LayerPanel"
    );

    await act(async () => {
      findButton(container, "Limpar").click();
      await flush();
    });

    expect(useEditorStore.getState().activeLayerId).toBeNull();
  });
});
