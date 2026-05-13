import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InspectorPanel from "./InspectorPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { Entity, Scene } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("./HardwareLimitsPanel", () => ({
  default: () => <div data-testid="hardware-limits" />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function findRow(container: HTMLElement, label: string): HTMLTableRowElement {
  const cell = Array.from(container.querySelectorAll("td")).find(
    (element) => element.textContent?.includes(label)
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
        logic_hints: ["Hint importado do adapter externo."],
      },
    },
  };
}

function spriteFixtureEntity(
  overrides?: Partial<NonNullable<Entity["components"]["sprite"]>>
): Entity {
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
        ...overrides,
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
      activeSceneSource: {
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
    expect(container.textContent).toContain("Imported Hints");
    expect(container.textContent).toContain("Hint importado do adapter externo.");
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
    const valueTrigger = row.querySelector("td:last-child span");

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

  it("shows inherited and override badges for prefab-backed fields", async () => {
    const resolvedEntity = physicsFixtureEntity();
    const sourceEntity: Entity = {
      entity_id: "hero",
      prefab: "hero_prefab",
      transform: { x: 12, y: 24 },
      components: {
        physics: {
          gravity: true,
        },
      },
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          ...EMPTY_SCENE,
          entities: [resolvedEntity],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [sourceEntity],
        },
      });
      await flush();
    });

    expect(container.textContent).toContain("Override");
    expect(container.textContent).toContain("Herdado");
  });

  it("explicits tilemap fallback when cells[] are missing", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          ...EMPTY_SCENE,
          entities: [tilemapFixtureEntity(false)],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [tilemapFixtureEntity(false)],
        },
        selectedEntityId: "stage_tilemap",
        sceneRevision: 2,
      });
      await flush();
    });

    await act(async () => {
      root.render(<InspectorPanel />);
      await flush();
    });

    const preview = container.querySelector(
      "[data-testid='inspector-tilemap-preview']"
    ) as HTMLImageElement | null;

    await act(async () => {
      preview?.dispatchEvent(new Event("load"));
      await flush();
    });

    expect(
      container.querySelector("[data-testid='inspector-tilemap-legacy-fallback']")?.textContent ?? ""
    ).toContain("fallback explícito");
  });

  it("shows target and layer context for the selected entity", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeTarget: "megadrive",
        activeScene: {
          ...EMPTY_SCENE,
          entities: [physicsFixtureEntity()],
          layers: [
            {
              id: "gameplay",
              name: "Gameplay",
              kind: "sprite",
              visible: true,
              locked: false,
              depth: 0,
              entity_ids: ["hero"],
            },
          ],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [physicsFixtureEntity()],
          layers: [
            {
              id: "gameplay",
              name: "Gameplay",
              kind: "sprite",
              visible: true,
              locked: false,
              depth: 0,
              entity_ids: ["hero"],
            },
          ],
        },
      });
      await flush();
    });

    expect(container.querySelector("[data-testid='inspector-entity-context']")?.textContent).toContain(
      "Target: Mega Drive"
    );
    expect(container.querySelector("[data-testid='inspector-entity-context']")?.textContent).toContain(
      "Camadas: Gameplay"
    );
  });

  it("resolves the canonical sprite preview path and falls back cleanly on load failure", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          ...EMPTY_SCENE,
          entities: [spriteFixtureEntity()],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [spriteFixtureEntity()],
        },
        selectedEntityId: "hero_sprite",
      });
      await flush();
      await flush();
    });

    const preview = container.querySelector(
      "[data-testid='inspector-asset-preview']"
    ) as HTMLImageElement | null;

    expect(preview).toBeInstanceOf(HTMLImageElement);
    expect(preview?.getAttribute("src")).toBe(
      "asset://F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/megadrive_dummy/assets/sprites/hero.ppm"
    );

    await act(async () => {
      preview?.dispatchEvent(new Event("error"));
      await flush();
    });

    expect(
      container.querySelector("[data-testid='inspector-asset-preview-fallback']")?.textContent
    ).toContain("Preview indisponivel");
  });

  it("normalizes sprite build settings for the active target from the Inspector action", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeTarget: "megadrive",
        activeScene: {
          ...EMPTY_SCENE,
          entities: [spriteFixtureEntity({ frame_width: 25, frame_height: 9, palette_slot: 5 })],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [spriteFixtureEntity({ frame_width: 25, frame_height: 9, palette_slot: 5 })],
        },
        selectedEntityId: "hero_sprite",
      });
      await flush();
    });

    const normalizeButton = container.querySelector(
      "[data-testid='inspector-normalize-sprite-target']"
    );

    if (!(normalizeButton instanceof HTMLButtonElement)) {
      throw new Error("Normalize sprite button not found");
    }

    await act(async () => {
      normalizeButton.click();
      await flush();
    });

    const updatedEntity = useEditorStore.getState().activeScene?.entities.find(
      (entity) => entity.entity_id === "hero_sprite"
    );

    expect(updatedEntity?.components.sprite?.frame_width).toBe(32);
    expect(updatedEntity?.components.sprite?.frame_height).toBe(16);
    expect(updatedEntity?.components.sprite?.palette_slot).toBe(3);
  });

  it("shows imported role, confidence and source context for Phase D entities", async () => {
    const importedEntity = spriteFixtureEntity();
    importedEntity.entity_id = "hero";
    importedEntity.display_name = "Hero";
    importedEntity.components.logic = {
      graph_ref: "graphs/sgdk_import_hero.json",
      graph_origin: "imported_ref",
      external_source_refs: ["src/main.c", "src/player.c"],
      logic_hints: ["Fase D: papel importado desta entidade: 'player_avatar'."],
      imported_semantics: {
        source: "sgdk_phase_d",
        entity_role: "player_avatar",
        gameplay_class: "platformer_horizontal_scroller_signals",
        confidence: "medium",
        role_reason: "sprite primario com leitura JOY_* no agregado",
        driver_functions: ["player_tick", "main"],
        source_paths: ["src/player.c", "src/main.c"],
        audit_flags: ["primary_sprite"],
      },
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          ...EMPTY_SCENE,
          entities: [importedEntity],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [importedEntity],
        },
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='inspector-imported-context']")?.textContent).toContain(
      "Jogador"
    );
    expect(container.querySelector("[data-testid='inspector-imported-context']")?.textContent).toContain(
      "Platformer"
    );
    expect(container.querySelector("[data-testid='inspector-imported-context']")?.textContent).toContain(
      "Confianca moderada"
    );
    expect(container.querySelector("[data-testid='inspector-imported-audit-flags']")?.textContent).toContain(
      "primary_sprite"
    );
    expect(container.textContent).toContain("Imported");
    expect(container.textContent).toContain("sprite primario com leitura JOY_* no agregado");
  });

  it("keeps editable fields before imported diagnostics and collapses the imported report", async () => {
    const importedEntity = spriteFixtureEntity();
    importedEntity.entity_id = "hero";
    importedEntity.display_name = "Hero";
    importedEntity.components.logic = {
      graph_ref: "graphs/sgdk_import_hero.json",
      graph_origin: "imported_ref",
      external_source_refs: ["src/main.c"],
      logic_hints: ["Fase D: papel importado desta entidade: 'player_avatar'."],
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
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          ...EMPTY_SCENE,
          entities: [importedEntity],
        },
        activeSceneSource: {
          ...EMPTY_SCENE,
          entities: [importedEntity],
        },
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });

    const transform = container.querySelector("[data-testid='inspector-section-transform']");
    const imported = container.querySelector("[data-testid='inspector-imported-context']");

    expect(transform).toBeInstanceOf(HTMLElement);
    expect(imported).toBeInstanceOf(HTMLDetailsElement);
    expect((imported as HTMLDetailsElement).open).toBe(false);
    expect(transform!.compareDocumentPosition(imported!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
