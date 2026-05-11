import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NodeGraphEditor, {
  EMPTY_GRAPH,
  appendExecChainEdgesFromLayout,
  appendQuickActionGraph,
  buildNodeMiniMap,
  serializeNodeGraph,
  summarizeNodeGraph,
  type NodeGraph,
} from "./NodeGraphEditor";
import { useEditorStore } from "../../core/store/editorStore";
import type { Entity } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
  resolveScenePrefabs: vi.fn(),
  openProjectSourcePath: vi.fn(),
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("../../core/ipc/projectService", () => ({
  openProjectSourcePath: mocks.openProjectSourcePath,
}));

vi.mock("../../core/ipc/sceneService", () => ({
  resolveScenePrefabs: mocks.resolveScenePrefabs,
  parseSceneJson: (sceneJson?: string | null) => {
    if (!sceneJson) {
      return null;
    }
    return JSON.parse(sceneJson);
  },
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function buildLogicEntity(entityId: string, displayName: string, graph: NodeGraph): Entity {
  return {
    entity_id: entityId,
    display_name: displayName,
    prefab: null,
    transform: { x: 16, y: 24 },
    components: {
      logic: {
        graph: serializeNodeGraph(graph),
      },
    },
  };
}

const GRAPH_FIXTURE: NodeGraph = {
  nodes: [
    {
      id: "entry_node",
      type: "event_start",
      label: "On Start",
      x: 1200,
      y: 720,
      inputs: [],
      outputs: [{ id: "exec", label: "▶", kind: "exec" }],
      params: {},
    },
    {
      id: "move_node",
      type: "sprite_move",
      label: "Move Sprite",
      x: 1520,
      y: 760,
      inputs: [
        { id: "exec", label: "▶", kind: "exec" },
        { id: "dx", label: "dx", kind: "data", dataType: "int" },
        { id: "dy", label: "dy", kind: "data", dataType: "int" },
      ],
      outputs: [{ id: "exec", label: "▶", kind: "exec" }],
      params: { target: "player", dx: 2, dy: 0 },
    },
    {
      id: "free_node",
      type: "action_sound",
      label: "Play Sound",
      x: 1840,
      y: 1040,
      inputs: [{ id: "exec", label: "▶", kind: "exec" }],
      outputs: [{ id: "exec", label: "▶", kind: "exec" }],
      params: { sfx: "jump" },
    },
  ],
  edges: [
    {
      id: "edge_1",
      fromNode: "entry_node",
      fromPort: "exec",
      toNode: "move_node",
      toPort: "exec",
    },
  ],
};

const GRAPH_WITHOUT_ENTRY: NodeGraph = {
  nodes: [
    {
      id: "move_only",
      type: "sprite_move",
      label: "Move Sprite",
      x: 1180,
      y: 640,
      inputs: [
        { id: "exec", label: "▶", kind: "exec" },
        { id: "dx", label: "dx", kind: "data", dataType: "int" },
        { id: "dy", label: "dy", kind: "data", dataType: "int" },
      ],
      outputs: [{ id: "exec", label: "▶", kind: "exec" }],
      params: { target: "hero", dx: 1, dy: 0 },
    },
    {
      id: "sound_only",
      type: "action_sound",
      label: "Play Sound",
      x: 1540,
      y: 760,
      inputs: [{ id: "exec", label: "▶", kind: "exec" }],
      outputs: [{ id: "exec", label: "▶", kind: "exec" }],
      params: { sfx: "hit" },
    },
  ],
  edges: [],
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function buildSceneWithGraph(
  graph: NodeGraph,
  entities: Entity[] = [buildLogicEntity("hero", "Hero", graph)]
) {
  return {
    scene_id: "main_scene",
    display_name: "Main Scene",
    entities,
    background_layers: [],
    palettes: [],
  };
}

describe("NodeGraphEditor helpers", () => {
  it("summarizes entry and disconnected nodes for the overview", () => {
    const summary = summarizeNodeGraph(GRAPH_FIXTURE);

    expect(summary.totalNodes).toBe(3);
    expect(summary.totalEdges).toBe(1);
    expect(summary.entryNodeIds).toEqual(["entry_node"]);
    expect(summary.disconnectedNodeIds).toEqual(["free_node"]);
  });

  it("projects nodes into the minimap bounds", () => {
    const nodes = buildNodeMiniMap(GRAPH_FIXTURE, 176, 112, 10);

    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => node.x >= 10 && node.x <= 166)).toBe(true);
    expect(nodes.every((node) => node.y >= 10 && node.y <= 102)).toBe(true);
  });

  it("appendExecChainEdgesFromLayout adds a single exec edge ordered by layout when missing", () => {
    const next = appendExecChainEdgesFromLayout(GRAPH_WITHOUT_ENTRY);
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]?.fromNode).toBe("move_only");
    expect(next.edges[0]?.toNode).toBe("sound_only");
    expect(next.edges[0]?.fromPort).toBe("exec");
    expect(next.edges[0]?.toPort).toBe("exec");
    const again = appendExecChainEdgesFromLayout(next);
    expect(again.edges).toHaveLength(1);
  });

  it("appendQuickActionGraph keeps the existing graph and offsets the new block for continued authoring", () => {
    const quickAction: NodeGraph = {
      nodes: [
        {
          id: "qa_start",
          type: "event_start",
          label: "On Start",
          x: 120,
          y: 80,
          inputs: [],
          outputs: [{ id: "exec", label: "▶", kind: "exec" }],
          params: {},
        },
        {
          id: "qa_move",
          type: "sprite_move",
          label: "Move Sprite",
          x: 360,
          y: 96,
          inputs: [
            { id: "exec", label: "▶", kind: "exec" },
            { id: "dx", label: "dx", kind: "data", dataType: "int" },
            { id: "dy", label: "dy", kind: "data", dataType: "int" },
          ],
          outputs: [{ id: "exec", label: "▶", kind: "exec" }],
          params: { target: "player", dx: 2, dy: 0 },
        },
      ],
      edges: [
        {
          id: "qa_edge",
          fromNode: "qa_start",
          fromPort: "exec",
          toNode: "qa_move",
          toPort: "exec",
        },
      ],
    };

    const appended = appendQuickActionGraph(GRAPH_FIXTURE, quickAction, 160);

    expect(appended.graph.nodes).toHaveLength(5);
    expect(appended.graph.edges).toHaveLength(2);
    expect(appended.appendedNodeIds).toHaveLength(2);
    expect(appended.appendedNodeIds.every((id) => !["qa_start", "qa_move"].includes(id))).toBe(true);

    const appendedNodes = appended.graph.nodes.filter((node) => appended.appendedNodeIds.includes(node.id));
    expect(appendedNodes.every((node) => node.x > 1840)).toBe(true);
  });
});

describe("NodeGraphEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.resolveScenePrefabs.mockResolvedValue({
      ok: false,
      error: "not-needed",
      scene_json: "",
    });
    mocks.openProjectSourcePath.mockResolvedValue({
      ok: true,
      message: "opened",
      absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/src/hero.c",
    });

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Mega Dummy",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      selectedEntityId: "hero",
      activeViewportTab: "logic",
      consoleEntries: [],
      consoleVisible: true,
      hwStatus: null,
      sceneRevision: 1,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      hwValidationRefreshTick: 0,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      emulatorLoaded: false,
      emulPaused: false,
      activeScene: buildSceneWithGraph(GRAPH_FIXTURE),
      activeSceneSource: buildSceneWithGraph(GRAPH_FIXTURE),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<NodeGraphEditor />);
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

  it("renders overview/minimap context and focuses the entry node without mutating saved positions", async () => {
    const canvas = container.querySelector("[data-testid='nodegraph-canvas']") as HTMLDivElement | null;
    if (!canvas) {
      throw new Error("NodeGraph canvas not found");
    }

    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }),
    });

    const entryCard = container.querySelector("[data-testid='node-card-entry_node']") as HTMLDivElement | null;
    expect(entryCard?.style.left).toBe("1200px");
    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).toContain("Hero");
    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).toContain("Soltos");
    expect(container.querySelector("[data-testid='nodegraph-minimap']")).toBeInstanceOf(HTMLDivElement);

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-focus-entry']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    expect(entryCard?.style.left).not.toBe("1200px");
    expect(useEditorStore.getState().activeScene?.entities[0].components.logic?.graph).toBe(
      serializeNodeGraph(GRAPH_FIXTURE)
    );
  });

  it("keeps a visible Scene bridge for the selected logic entity", async () => {
    const bridge = container.querySelector("[data-testid='nodegraph-scene-bridge']");
    expect(bridge?.textContent).toContain("Hero");
    expect(bridge?.textContent).toContain("Logic -> Scene");

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-bridge-back-scene']") as HTMLButtonElement).click();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeWorkspace).toBe("scene");
    expect(state.activeViewportTab).toBe("scene");
    expect(state.selectedEntityId).toBe("hero");
  });

  it("shows a guided empty state and hydrates a quick action without changing the graph schema", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(EMPTY_GRAPH),
        activeSceneSource: buildSceneWithGraph(EMPTY_GRAPH),
      });
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='nodegraph-empty-overlay']")).toBeInstanceOf(HTMLDivElement);
    expect(container.querySelector("[data-testid='nodegraph-empty-target-hint']")?.textContent).toContain("Hero");
    expect(container.textContent).toContain("Criar Player Controller Basico");

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-template-player_controller']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    const nodeCards = container.querySelectorAll("[data-testid^='node-card-']");
    expect(nodeCards.length).toBe(3);
    expect(container.querySelector("[data-testid='nodegraph-guided-commentary']")?.textContent).toContain(
      "Player Controller Basico"
    );
    expect(container.querySelector("[data-testid='nodegraph-guided-commentary']")?.textContent).toContain(
      "Fluxo conservador"
    );
    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).toContain("3 nos");
    expect(useEditorStore.getState().activeScene?.entities[0].components.logic?.graph).toBe(
      serializeNodeGraph(EMPTY_GRAPH)
    );
  });

  it("hydrates graph from graph_ref via resolve_scene_prefabs and exposes imported origin", async () => {
    const sourceScene = buildSceneWithGraph(EMPTY_GRAPH, [
      {
        entity_id: "hero",
        display_name: "Hero",
        prefab: null,
        transform: { x: 16, y: 24 },
        components: {
          logic: {
            graph_ref: "graphs/sgdk_import_hero.json",
            graph_origin: "imported_ref",
          },
        },
      },
    ]);
    const resolvedScene = buildSceneWithGraph(GRAPH_FIXTURE, [
      {
        entity_id: "hero",
        display_name: "Hero",
        prefab: null,
        transform: { x: 16, y: 24 },
        components: {
          logic: {
            graph: serializeNodeGraph(GRAPH_FIXTURE),
            graph_ref: "graphs/sgdk_import_hero.json",
            graph_origin: "imported_ref",
          },
        },
      },
    ]);
    mocks.resolveScenePrefabs.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify(resolvedScene),
    });

    await act(async () => {
      useEditorStore.setState({
        activeScene: sourceScene,
        activeSceneSource: sourceScene,
      });
      await flush();
      await flush();
    });

    expect(mocks.resolveScenePrefabs).toHaveBeenCalled();
    expect(container.querySelector("[data-testid='node-card-entry_node']")).toBeInstanceOf(HTMLDivElement);
    expect(container.textContent).toContain("Origem do grafo: importado do graph_ref");
  });

  it("adds an entry node from the overview when the graph has no event node yet", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(GRAPH_WITHOUT_ENTRY),
        activeSceneSource: buildSceneWithGraph(GRAPH_WITHOUT_ENTRY),
      });
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).toContain(
      "Grafo sem evento de entrada"
    );

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-add-entry']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    expect(container.querySelectorAll("[data-testid^='node-card-']")).toHaveLength(3);
    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).toContain("Eventos:");
    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).not.toContain(
      "Grafo sem evento de entrada"
    );
  });

  it("focuses the first disconnected node from the overview helper", async () => {
    const canvas = container.querySelector("[data-testid='nodegraph-canvas']") as HTMLDivElement | null;
    if (!canvas) {
      throw new Error("NodeGraph canvas not found");
    }

    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }),
    });

    const freeNodeCard = container.querySelector("[data-testid='node-card-free_node']") as HTMLDivElement | null;
    expect(freeNodeCard?.style.left).toBe("1840px");

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-focus-disconnected']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    expect(freeNodeCard?.style.left).not.toBe("1840px");
  });

  it("applies the player controller quick action using the selected entity as target", async () => {
    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "runner_main",
        activeScene: buildSceneWithGraph(EMPTY_GRAPH, [
          buildLogicEntity("runner_main", "Runner Main", EMPTY_GRAPH),
        ]),
        activeSceneSource: buildSceneWithGraph(EMPTY_GRAPH, [
          buildLogicEntity("runner_main", "Runner Main", EMPTY_GRAPH),
        ]),
      });
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='nodegraph-empty-target-hint']")?.textContent).toContain(
      "Runner Main"
    );

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-template-player_controller']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    const nodeCardTexts = Array.from(container.querySelectorAll("[data-testid^='node-card-']")).map(
      (element) => element.textContent ?? ""
    );

    expect(nodeCardTexts.some((text) => text.includes("runner_main"))).toBe(true);
  });

  it("uses another scene entity as overlap counterpart for the enemy quick action", async () => {
    const entities = [
      buildLogicEntity("hero_player", "Hero Player", EMPTY_GRAPH),
      buildLogicEntity("sentinel_enemy", "Sentinel Enemy", EMPTY_GRAPH),
    ];

    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "sentinel_enemy",
        activeScene: buildSceneWithGraph(EMPTY_GRAPH, entities),
        activeSceneSource: buildSceneWithGraph(EMPTY_GRAPH, entities),
      });
      await flush();
      await flush();
    });

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-template-enemy_logic']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    const nodeCardTexts = Array.from(container.querySelectorAll("[data-testid^='node-card-']")).map(
      (element) => element.textContent ?? ""
    );

    expect(nodeCardTexts.some((text) => text.includes("hero_player"))).toBe(true);
    expect(nodeCardTexts.some((text) => text.includes("sentinel_enemy"))).toBe(true);
  });

  it("navigates from a selected node target back to the matching scene entity", async () => {
    const playerEntity: Entity = {
      entity_id: "player",
      display_name: "Player",
      prefab: null,
      transform: { x: 80, y: 48 },
      components: {
        sprite: {
          asset: "assets/sprites/player.png",
          frame_width: 16,
          frame_height: 16,
          palette_slot: 0,
          animations: {},
        },
      },
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(GRAPH_FIXTURE, [
          buildLogicEntity("hero", "Hero", GRAPH_FIXTURE),
          playerEntity,
        ]),
        activeSceneSource: buildSceneWithGraph(GRAPH_FIXTURE, [
          buildLogicEntity("hero", "Hero", GRAPH_FIXTURE),
          playerEntity,
        ]),
        selectedEntityId: "hero",
        activeViewportTab: "logic",
      });
      await flush();
      await flush();
    });

    const moveNodeCard = container.querySelector("[data-testid='node-card-move_node']");
    if (!(moveNodeCard instanceof HTMLDivElement)) {
      throw new Error("Move node card not found");
    }

    await act(async () => {
      moveNodeCard.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 12, clientY: 12 })
      );
      await flush();
    });

    const targetButton = container.querySelector(
      "[data-testid='nodegraph-focus-node-target']"
    ) as HTMLButtonElement | null;

    expect(targetButton?.disabled).toBe(false);

    await act(async () => {
      targetButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().selectedEntityId).toBe("player");
    expect(useEditorStore.getState().activeViewportTab).toBe("scene");
  });

  it("surfaces multiple source paths and opens the requested real source", async () => {
    const sourceRichEntity: Entity = {
      entity_id: "hero",
      display_name: "Hero",
      prefab: null,
      transform: { x: 16, y: 24 },
      components: {
        logic: {
          graph: serializeNodeGraph(GRAPH_FIXTURE),
          imported_semantics: {
            source: "sgdk_phase_d",
            entity_role: "player_avatar",
            confidence: "medium",
            role_reason: "driver principal",
            driver_functions: ["hero_tick", "hero_anim"],
            source_paths: ["src/hero.c", "src/player_shared.c"],
            audit_flags: ["primary_sprite"],
          },
          external_source_refs: ["src/player_shared.c", "src/hero_debug.c"],
        },
      },
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(GRAPH_FIXTURE, [sourceRichEntity]),
        activeSceneSource: buildSceneWithGraph(GRAPH_FIXTURE, [sourceRichEntity]),
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Drivers:");
    expect(container.querySelector("[data-testid='nodegraph-open-primary-source']")).toBeTruthy();
    expect(container.querySelector("[data-testid='nodegraph-open-source-1']")).toBeTruthy();
    expect(container.querySelector("[data-testid='nodegraph-open-source-2']")).toBeTruthy();

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-open-source-2']") as HTMLButtonElement).click();
      await flush();
    });

    expect(mocks.openProjectSourcePath).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "src/hero_debug.c"
    );
  });

  it("appends a guided block to the current graph without replacing the existing nodes", async () => {
    const beforeCount = container.querySelectorAll("[data-testid^='node-card-']").length;

    await act(async () => {
      (container.querySelector(
        "[data-testid='nodegraph-append-template-player_controller']"
      ) as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    expect(container.querySelectorAll("[data-testid^='node-card-']").length).toBeGreaterThan(beforeCount);
    expect(container.querySelector("[data-testid='nodegraph-guided-commentary']")?.textContent).toContain(
      "(anexado)"
    );
    expect(container.querySelector("[data-testid='nodegraph-overview']")?.textContent).toContain(
      "Atalhos construtivos"
    );
  });
});
