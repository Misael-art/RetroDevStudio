import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InspectorPanel from "./InspectorPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { Entity, Scene } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
  invoke: vi.fn(() => Promise.reject(new Error("invoke not mocked"))),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: mocks.invoke,
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("./HardwareLimitsPanel", () => ({
  default: () => <div data-testid="hardware-limits" />,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function spriteFixtureEntity(): Entity {
  return {
    entity_id: "hero_sprite",
    prefab: null,
    transform: { x: 16, y: 24 },
    components: {
      sprite: {
        asset: "assets/sprites/hero.ppm",
        frame_width: 16,
        frame_height: 16,
        palette_slot: 0,
        animations: {},
      },
    },
  };
}

function tilemapFixtureEntity(withCells: boolean): Entity {
  return {
    entity_id: "stage_tilemap",
    prefab: null,
    transform: { x: 0, y: 0 },
    components: {
      tilemap: {
        tileset: "assets/tilesets/stage.png",
        map_width: 4,
        map_height: 4,
        scroll_x: 0,
        scroll_y: 0,
        cells: withCells ? [1, 1, 0, 0, 0, 2, 0, 0, 3, 0, 0, 0, 0, 0, 4, 0] : [],
      },
    },
  };
}

const EMPTY_SCENE: Scene = {
  scene_id: "scene_test",
  entities: [],
  background_layers: [],
  palettes: [],
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("InspectorPanel asset visual state", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function renderWithEntity(entity: Entity) {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/megadrive_dummy",
        activeScene: {
          ...EMPTY_SCENE,
          entities: [entity],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [entity],
        },
        selectedEntityId: entity.entity_id,
        sceneRevision: 1,
        hwStatus: null,
        hwValidationState: "idle",
        hwValidatedRevision: 0,
        hwValidationError: null,
        undoStack: [],
        redoStack: [],
        pendingHistorySnapshot: null,
      });
      root.render(<InspectorPanel />);
      await flush();
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("shows loaded visual state for a sprite after the preview loads", async () => {
    await renderWithEntity(spriteFixtureEntity());

    const image = container.querySelector("[data-testid='inspector-asset-preview']");
    expect(image).toBeInstanceOf(HTMLImageElement);

    await act(async () => {
      image?.dispatchEvent(new Event("load"));
      await flush();
    });

    expect(container.textContent).toContain("Estado visual:");
    expect(container.textContent).toContain("Carregado (preview real)");
    expect(container.textContent).toContain("(loaded)");
    expect(container.textContent).toContain("Preview real carregado com sucesso.");
  });

  it("shows failed visual state when the sprite preview errors", async () => {
    await renderWithEntity(spriteFixtureEntity());

    const image = container.querySelector("[data-testid='inspector-asset-preview']");
    expect(image).toBeInstanceOf(HTMLImageElement);

    await act(async () => {
      image?.dispatchEvent(new Event("error"));
      await flush();
    });

    expect(container.querySelector("[data-testid='inspector-asset-preview-fallback']")).toBeTruthy();
    expect(container.textContent).toContain("Erro ao carregar");
    expect(container.textContent).toContain("(failed)");
  });

  it("shows explicit legacy fallback for tilemaps without canonical cells[]", async () => {
    await renderWithEntity(tilemapFixtureEntity(false));

    const image = container.querySelector("[data-testid='inspector-tilemap-preview']");
    expect(image).toBeInstanceOf(HTMLImageElement);

    await act(async () => {
      image?.dispatchEvent(new Event("load"));
      await flush();
    });

    expect(container.querySelector("[data-testid='inspector-tilemap-legacy-fallback']")).toBeTruthy();
    expect(container.textContent).toContain("Fallback explicito");
    expect(container.textContent).toContain("(legacy_fallback)");
    expect(container.textContent).toContain("cells[]");
  });
});
