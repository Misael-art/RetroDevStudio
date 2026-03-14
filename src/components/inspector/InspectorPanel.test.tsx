import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InspectorPanel from "./InspectorPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { Entity, Scene } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
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

function findRow(container: HTMLElement, label: string): HTMLTableRowElement {
  const cell = Array.from(container.querySelectorAll("td")).find(
    (element) => element.textContent?.trim() === label
  );
  if (!(cell instanceof HTMLTableCellElement) || !(cell.parentElement instanceof HTMLTableRowElement)) {
    throw new Error(`Row not found: ${label}`);
  }

  return cell.parentElement;
}

function physicsFixtureEntity(): Entity {
  return {
    entity_id: "hero",
    prefab: "hero_prefab",
    transform: { x: 12, y: 24 },
    components: {
      physics: {
        gravity: true,
        gravity_strength: 6,
        max_velocity: { x: 32, y: 48 },
        friction: 1,
        bounce: 2,
      },
      audio: {
        bgm: "stage_theme.xgm",
        sfx: {
          jump: "jump.wav",
        },
      },
      input: {
        device: "joypad1",
        mapping: {
          jump: "A",
        },
      },
      logic: {
        graph: JSON.stringify({
          version: 1,
          nodes: [
            { id: "n1", type: "event_start" },
            { id: "n2", type: "sprite_move" },
          ],
          edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
        }),
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

describe("InspectorPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/megadrive_dummy",
      activeScene: {
        ...EMPTY_SCENE,
        entities: [physicsFixtureEntity()],
      },
      selectedEntityId: "hero",
      sceneRevision: 1,
      hwStatus: null,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<InspectorPanel />);
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

  it("renders editors for physics, audio, input and a logic graph summary", () => {
    expect(container.textContent).toContain("Gravity");
    expect(container.textContent).toContain("Grav. Strength");
    expect(container.textContent).toContain("Audio SFX");
    expect(container.textContent).toContain("Input Mapping");
    expect(container.textContent).toContain("Graph: 2 nodes, 1 edges");
  });

  it("shows contextual knowledge tooltip for inspector sections", async () => {
    const knowledgeButton = container.querySelector(
      '[data-testid="inspector-knowledge-physics"]'
    );

    if (!(knowledgeButton instanceof HTMLButtonElement)) {
      throw new Error("Physics knowledge button not found");
    }

    await act(async () => {
      knowledgeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(container.textContent).toContain(
      "Controla gravidade, atrito, bounce e limites de velocidade da entidade."
    );
    expect(container.textContent).toContain(
      "Gravity e Grav. Strength definem a aceleracao vertical aplicada por frame."
    );
  });

  it("persists physics.gravity edits through the canonical entity update path", async () => {
    const row = findRow(container, "Gravity");
    const valueTrigger = row.querySelector("span");

    await act(async () => {
      valueTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const select = row.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("Gravity editor did not open");
    }

    await act(async () => {
      select.value = "false";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await flush();
    });

    const updatedEntity = useEditorStore.getState().activeScene?.entities.find(
      (entity) => entity.entity_id === "hero"
    );

    expect(updatedEntity?.components.physics?.gravity).toBe(false);
  });
});
