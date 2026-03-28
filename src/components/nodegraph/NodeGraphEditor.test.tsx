import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NodeGraphEditor, {
  EMPTY_GRAPH,
  buildNodeMiniMap,
  serializeNodeGraph,
  summarizeNodeGraph,
  type NodeGraph,
} from "./NodeGraphEditor";
import { useEditorStore } from "../../core/store/editorStore";

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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function buildSceneWithGraph(graph: NodeGraph) {
  return {
    scene_id: "main_scene",
    display_name: "Main Scene",
    entities: [
      {
        entity_id: "hero",
        display_name: "Hero",
        prefab: null,
        transform: { x: 16, y: 24 },
        components: {
          logic: {
            graph: serializeNodeGraph(graph),
          },
        },
      },
    ],
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
});

describe("NodeGraphEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);

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
});
