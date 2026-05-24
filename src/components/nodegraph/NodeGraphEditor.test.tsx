import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NodeGraphEditor, {
  EMPTY_GRAPH,
  REQUIRED_NOCODE_NODE_TYPES,
  appendExecChainEdgesFromLayout,
  appendQuickActionGraph,
  autoLayoutNodeGraph,
  buildNodeMiniMap,
  deserializeNodeGraph,
  serializeNodeGraph,
  summarizeNodeGraph,
  validateNodeGraph,
  type NodeGraph,
} from "./NodeGraphEditor";
import { useEditorStore } from "../../core/store/editorStore";
import type { AnimationDef, Entity, SpriteCommandBinding } from "../../core/ipc/sceneService";

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

function buildLogicSpriteEntity(
  entityId: string,
  displayName: string,
  graph: NodeGraph,
  options: {
    animations?: Record<string, AnimationDef>;
    commands?: SpriteCommandBinding[];
  } = {}
): Entity {
  return {
    ...buildLogicEntity(entityId, displayName, graph),
    components: {
      logic: {
        graph: serializeNodeGraph(graph),
      },
      sprite: {
        asset: `assets/sprites/${entityId}.png`,
        frame_width: 16,
        frame_height: 16,
        animations: options.animations ?? {},
        commands: options.commands,
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

const VALID_EXEC_GRAPH: NodeGraph = {
  nodes: [
    {
      id: "entry",
      type: "input_command",
      label: "Hadouken",
      x: 120,
      y: 96,
      inputs: [],
      outputs: [
        { id: "exec", label: ">", kind: "exec" },
        { id: "false", label: "False >", kind: "exec" },
      ],
      params: {
        command_id: "hadouken",
        display_name: "Hadouken",
        notation: "_2,_3,_6,_P",
        max_frames: 15,
        target: "hero",
      },
    },
    {
      id: "attack_anim",
      type: "set_animation_state",
      label: "Set Attack",
      x: 620,
      y: 96,
      inputs: [{ id: "exec", label: ">", kind: "exec" }],
      outputs: [{ id: "exec", label: ">", kind: "exec" }],
      params: { target: "hero", state: "fireball" },
    },
    {
      id: "miss_sound",
      type: "action_sound",
      label: "Miss Sound",
      x: 620,
      y: 220,
      inputs: [{ id: "exec", label: ">", kind: "exec" }],
      outputs: [{ id: "exec", label: ">", kind: "exec" }],
      params: { sfx: "miss" },
    },
  ],
  edges: [
    { id: "e_command_true", fromNode: "entry", fromPort: "exec", toNode: "attack_anim", toPort: "exec" },
    { id: "e_command_false", fromNode: "entry", fromPort: "false", toNode: "miss_sound", toPort: "exec" },
  ],
};

const VALID_EXEC_ENTITY = buildLogicSpriteEntity("hero", "Hero", VALID_EXEC_GRAPH, {
  animations: {
    fireball: { frames: [0, 1], fps: 12, loop: false },
  },
  commands: [
    {
      id: "hadouken",
      display_name: "Hadouken",
      notation: "_2,_3,_6,_P",
      source: "command.dat",
      target_animation: "fireball",
      max_frames: 15,
      button_profile: "megadrive",
    },
  ],
});

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

  it("auto-layout groups imported graphs into readable system lanes", () => {
    const chaotic: NodeGraph = {
      nodes: [
        { ...GRAPH_FIXTURE.nodes[2], id: "sound", type: "action_sound", x: 8, y: 8 },
        { ...GRAPH_FIXTURE.nodes[1], id: "move", type: "sprite_move", x: 7, y: 9 },
        {
          id: "hadouken",
          type: "input_command",
          label: "Input Command",
          x: 4,
          y: 5,
          inputs: [],
          outputs: [{ id: "exec", label: "exec", kind: "exec" }],
          params: {
            command_id: "hadouken",
            display_name: "Hadouken",
            notation: "_2,_3,_6,_P",
            max_frames: 15,
            pad: "JOY_1",
            button_profile: "megadrive",
            target: "player",
          },
        },
        { ...GRAPH_FIXTURE.nodes[0], id: "entry", type: "event_start", x: 6, y: 7 },
        {
          id: "budget",
          type: "hardware_budget_check",
          label: "Hardware Budget",
          x: 5,
          y: 6,
          inputs: [{ id: "exec", label: "exec", kind: "exec" }],
          outputs: [{ id: "exec", label: "exec", kind: "exec" }],
          params: { budget: "sprite_scanline" },
        },
      ],
      edges: [],
    };

    const arranged = autoLayoutNodeGraph(chaotic);
    const entry = arranged.nodes.find((node) => node.id === "entry")!;
    const hadouken = arranged.nodes.find((node) => node.id === "hadouken")!;
    const move = arranged.nodes.find((node) => node.id === "move")!;
    const sound = arranged.nodes.find((node) => node.id === "sound")!;
    const budget = arranged.nodes.find((node) => node.id === "budget")!;

    expect(entry.x).toBeLessThan(move.x);
    expect(entry.x).toBeLessThan(hadouken.x);
    expect(hadouken.x).toBeLessThan(move.x);
    expect(move.y).toBeLessThan(sound.y);
    expect(budget.y).toBeGreaterThan(sound.y);
    expect(arranged.nodes.map((node) => node.id)).toEqual(["entry", "hadouken", "move", "sound", "budget"]);
  });

  it("declares the no-code production node vocabulary in the editor", () => {
    expect(REQUIRED_NOCODE_NODE_TYPES).toEqual(
      expect.arrayContaining([
        "event_start",
        "event_update",
        "input_pressed",
        "input_held",
        "input_command",
        "condition_overlap",
        "sprite_move",
        "set_velocity",
        "set_position",
        "spawn_entity",
        "destroy_entity",
        "sprite_anim",
        "set_animation_state",
        "camera_follow",
        "camera_bounds",
        "timer",
        "var_get",
        "var_set",
        "flow_if",
        "condition_compare",
        "fsm_state",
        "fsm_transition",
        "action_sound",
        "set_tile",
        "scroll_tilemap",
        "load_scene",
        "hardware_budget_check",
      ])
    );
  });

  it("validates broken refs, incompatible ports and exec cycles", () => {
    const invalidGraph: NodeGraph = {
      nodes: [
        GRAPH_FIXTURE.nodes[0],
        GRAPH_FIXTURE.nodes[1],
        {
          id: "condition",
          type: "condition_compare",
          label: "Compare",
          x: 1720,
          y: 760,
          inputs: [
            { id: "exec", label: "exec", kind: "exec" },
            { id: "a", label: "A", kind: "data", dataType: "int" },
          ],
          outputs: [{ id: "true", label: "True", kind: "exec" }],
          params: {},
        },
        {
          id: "logic_and",
          type: "logic_and",
          label: "AND",
          x: 1960,
          y: 760,
          inputs: [
            { id: "a", label: "A", kind: "data", dataType: "bool" },
            { id: "b", label: "B", kind: "data", dataType: "bool" },
          ],
          outputs: [{ id: "out", label: "Out", kind: "data", dataType: "bool" }],
          params: {},
        },
      ],
      edges: [
        { id: "missing_node", fromNode: "entry_node", fromPort: "exec", toNode: "ghost", toPort: "exec" },
        { id: "kind_mismatch", fromNode: "entry_node", fromPort: "exec", toNode: "condition", toPort: "a" },
        { id: "type_mismatch", fromNode: "logic_and", fromPort: "out", toNode: "move_node", toPort: "dx" },
        { id: "cycle_a", fromNode: "entry_node", fromPort: "exec", toNode: "move_node", toPort: "exec" },
        { id: "cycle_b", fromNode: "move_node", fromPort: "exec", toNode: "condition", toPort: "exec" },
        { id: "cycle_c", fromNode: "condition", fromPort: "true", toNode: "move_node", toPort: "exec" },
      ],
    };

    const validation = validateNodeGraph(invalidGraph);

    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["broken_node_ref", "port_kind_mismatch", "data_type_mismatch", "exec_cycle"])
    );
    expect(validation.warnings).toHaveLength(0);
  });

  it("keeps a locally valid executable graph free of execution diagnostics", () => {
    const validation = validateNodeGraph(VALID_EXEC_GRAPH, {
      selectedEntity: VALID_EXEC_ENTITY,
      sceneEntities: [VALID_EXEC_ENTITY],
    });

    expect(validation.errors).toHaveLength(0);
    expect(validation.warnings).toHaveLength(0);
  });

  it("reports execution diagnostics for missing inputs, branches, blocking bridges, commands and animations", () => {
    const heroWithGaps = buildLogicSpriteEntity("hero", "Hero", VALID_EXEC_GRAPH, {
      animations: {
        idle: { frames: [0], fps: 8, loop: true },
      },
      commands: VALID_EXEC_ENTITY.components.sprite?.commands,
    });
    const graph: NodeGraph = {
      nodes: [
        {
          ...VALID_EXEC_GRAPH.nodes[0],
          id: "dragon_punch",
          params: { ...VALID_EXEC_GRAPH.nodes[0].params, command_id: "dragon_punch" },
        },
        {
          ...VALID_EXEC_GRAPH.nodes[1],
          id: "missing_anim",
          params: { target: "hero", state: "uppercut" },
        },
        {
          id: "blocking_bridge",
          type: "bridge_unconverted_source",
          label: "Source Bridge",
          x: 880,
          y: 96,
          inputs: [{ id: "exec", label: ">", kind: "exec" }],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: { gap: "function_like_macro", source: "legacy.c", blocks_build: "true" },
        },
        {
          ...GRAPH_WITHOUT_ENTRY.nodes[0],
          id: "orphan_move",
        },
      ],
      edges: [
        { id: "e_command_true", fromNode: "dragon_punch", fromPort: "exec", toNode: "missing_anim", toPort: "exec" },
        { id: "e_anim_bridge", fromNode: "missing_anim", fromPort: "exec", toNode: "blocking_bridge", toPort: "exec" },
      ],
    };

    const validation = validateNodeGraph(graph, {
      selectedEntity: heroWithGaps,
      sceneEntities: [heroWithGaps],
    });

    const errorCodes = validation.errors.map((issue) => String(issue.code));
    const warningCodes = validation.warnings.map((issue) => String(issue.code));

    expect(errorCodes).toEqual(
      expect.arrayContaining(["blocking_bridge", "input_command_unbound", "missing_animation"])
    );
    expect(warningCodes).toEqual(
      expect.arrayContaining(["branch_without_output", "node_without_exec_input"])
    );
  });

  it("preserves runtime-authored exec gates into input and overlap nodes", () => {
    const serialized = JSON.stringify({
      version: 1,
      nodes: [
        { id: "update", type: "event_update", label: "Update", x: 0, y: 0, params: {} },
        {
          id: "right",
          type: "input_held",
          label: "Right",
          x: 180,
          y: 0,
          params: { pad: "JOY_1", button: "BUTTON_RIGHT" },
        },
        {
          id: "velocity",
          type: "set_velocity",
          label: "Velocity",
          x: 360,
          y: 0,
          params: { target: "player", vx: 2, vy: 0 },
        },
        {
          id: "collision_tick",
          type: "event_update",
          label: "Collision Tick",
          x: 0,
          y: 180,
          params: {},
        },
        {
          id: "overlap",
          type: "condition_overlap",
          label: "Overlap",
          x: 180,
          y: 180,
          params: { a: "player", b: "player" },
        },
        {
          id: "idle",
          type: "set_animation_state",
          label: "Idle",
          x: 360,
          y: 180,
          params: { target: "player", state: "idle" },
        },
      ],
      edges: [
        { id: "move_gate", fromNode: "update", fromPort: "exec", toNode: "right", toPort: "exec" },
        { id: "move_true", fromNode: "right", fromPort: "exec", toNode: "velocity", toPort: "exec" },
        { id: "collision_gate", fromNode: "collision_tick", fromPort: "exec", toNode: "overlap", toPort: "exec" },
        { id: "collision_true", fromNode: "overlap", fromPort: "true", toNode: "idle", toPort: "exec" },
      ],
    });

    const graph = deserializeNodeGraph(serialized);

    expect(graph.edges.map((edge) => edge.id)).toEqual([
      "move_gate",
      "move_true",
      "collision_gate",
      "collision_true",
    ]);
    expect(validateNodeGraph(graph).errors).toHaveLength(0);
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

  it("toggles execution inspection with simulated trace, diagnostics and reachable node highlights", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(VALID_EXEC_GRAPH, [VALID_EXEC_ENTITY]),
        activeSceneSource: buildSceneWithGraph(VALID_EXEC_GRAPH, [VALID_EXEC_ENTITY]),
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });
    for (let attempt = 0; attempt < 5 && !container.querySelector("[data-testid='node-card-entry']"); attempt += 1) {
      await act(async () => {
        await flush();
      });
    }
    expect(container.querySelector("[data-testid='node-card-entry']")).toBeInstanceOf(HTMLDivElement);

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-inspect-execution-toggle']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    const inspector = container.querySelector("[data-testid='nodegraph-execution-inspector']");
    expect(inspector).toBeInstanceOf(HTMLDivElement);
    expect(inspector?.textContent).toContain("simulado / nao instrumentado");
    expect(inspector?.textContent).toContain("input event");
    expect(inspector?.textContent).toContain("condition");
    expect(inspector?.textContent).toContain("action");
    expect(inspector?.textContent).toContain("output");
    expect(inspector?.textContent).toContain("Diagnostics");
    expect(container.querySelector("[data-testid='node-card-entry']")?.getAttribute("data-execution-reachable")).toBe(
      "true"
    );
    expect(
      container.querySelector("[data-testid='node-card-attack_anim']")?.getAttribute("data-execution-reachable")
    ).toBe("true");
    expect(container.querySelector("[data-testid='nodegraph-overview'] [data-testid='nodegraph-execution-inspector']")).toBe(
      inspector
    );
    expect(useEditorStore.getState().consoleEntries.some((entry) => entry.message.includes("[NodeGraph Diagnostics]"))).toBe(
      true
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

  it("creates a no-code mini platformer graph for the selected player", async () => {
    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "player",
        activeScene: buildSceneWithGraph(EMPTY_GRAPH, [
          buildLogicEntity("player", "Player", EMPTY_GRAPH),
        ]),
        activeSceneSource: buildSceneWithGraph(EMPTY_GRAPH, [
          buildLogicEntity("player", "Player", EMPTY_GRAPH),
        ]),
      });
      await flush();
      await flush();
    });

    await act(async () => {
      (container.querySelector("[data-testid='nodegraph-template-mini_platformer']") as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    const text = container.textContent ?? "";
    expect(container.querySelectorAll("[data-testid^='node-card-']").length).toBeGreaterThanOrEqual(20);
    expect(text).toContain("Mini Platformer No-Code");
    expect(text).toContain("BUTTON_RIGHT");
    expect(text).toContain("BUTTON_A");
    expect(text).toContain("jump");
    expect(text).toContain("Camera Segue");
    expect(text).toContain("Colisao (Overlap)");
    expect(text).toContain("player");
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

  it("shows SGDK import badges, source mapping and filterable gap details for imported graphs", async () => {
    const importedGraph: NodeGraph = {
      nodes: [
        {
          id: "idle",
          type: "fsm_state",
          label: "Idle",
          x: 120,
          y: 80,
          inputs: [],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: {
            state_name: "idle",
            import_status: "converted",
            source_file: "src/player.c",
            source_line: 42,
          },
        },
        {
          id: "idle_to_run",
          type: "fsm_transition",
          label: "Idle -> Run",
          x: 360,
          y: 80,
          inputs: [{ id: "exec", label: ">", kind: "exec" }],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: {
            target_state: "run",
            import_status: "converted",
            source_file: "src/player.c",
            source_line: 58,
          },
        },
        {
          id: "raw_ai",
          type: "bridge_unconverted_source",
          label: "AI bridge",
          x: 600,
          y: 80,
          inputs: [{ id: "exec", label: ">", kind: "exec" }],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: {
            gap: "AI helper remains bridge",
            source_path: "src/enemy.c",
            line: 88,
          },
        },
      ],
      edges: [
        {
          id: "edge_idle_transition",
          fromNode: "idle",
          fromPort: "exec",
          toNode: "idle_to_run",
          toPort: "exec",
        },
      ],
    };
    const importedEntity: Entity = {
      entity_id: "hero",
      display_name: "Hero",
      prefab: null,
      transform: { x: 16, y: 24 },
      components: {
        logic: {
          graph: serializeNodeGraph(importedGraph),
          graph_ref: "graphs/sgdk_import_hero.json",
          graph_origin: "imported_ref",
          imported_semantics: {
            source: "sgdk_semantic_extractor",
            confidence: "high",
            source_paths: ["src/player.c"],
            extraction_kind: "fsm",
            converted_nodes_count: 2,
            bridge_count: 1,
            gap_count: 1,
            status: "partial",
            states_detected: 1,
            transitions_detected: 1,
            blocking_gaps: ["inline assembly branch blocks equivalence"],
          } as unknown as NonNullable<Entity["components"]["logic"]>["imported_semantics"],
        },
      },
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(importedGraph, [importedEntity]),
        activeSceneSource: buildSceneWithGraph(importedGraph, [importedEntity]),
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });

    const idleCard = container.querySelector("[data-testid='node-card-idle']");
    const bridgeCard = container.querySelector("[data-testid='node-card-raw_ai']");

    expect(idleCard?.textContent).toContain("Converted");
    expect(idleCard?.textContent).toContain("Source mapped");
    expect(bridgeCard?.textContent).toContain("Bridge");
    expect(bridgeCard?.textContent).toContain("Gap");
    expect(container.querySelector("[data-testid='nodegraph-import-provenance']")?.textContent).toContain(
      "FSM extraida"
    );
    expect(container.querySelector("[data-testid='nodegraph-source-mapping']")?.textContent).toContain(
      "src/player.c:42"
    );
    expect(container.querySelector("[data-testid='nodegraph-import-gaps']")?.textContent).toContain(
      "AI helper remains bridge"
    );
    expect(container.querySelector("[data-testid='nodegraph-import-gaps']")?.textContent).toContain(
      "inline assembly branch blocks equivalence"
    );

    const filter = container.querySelector("[data-testid='nodegraph-gap-filter']") as HTMLInputElement | null;
    expect(filter).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(filter, "assembly");
      filter!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });

    expect(container.querySelector("[data-testid='nodegraph-import-gaps']")?.textContent).toContain(
      "inline assembly branch blocks equivalence"
    );
    expect(container.querySelector("[data-testid='nodegraph-import-gaps']")?.textContent).not.toContain(
      "AI helper remains bridge"
    );
  });

  it("falls back to entity source mapping and a heuristic gap when imported nodes are not source-mapped", async () => {
    const heuristicGraph: NodeGraph = {
      nodes: [
        {
          id: "phase_d_move",
          type: "sprite_move",
          label: "Move",
          x: 120,
          y: 80,
          inputs: [],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: { target: "hero", dx: 1, dy: 0 },
        },
      ],
      edges: [],
    };
    const importedEntity: Entity = {
      entity_id: "hero",
      display_name: "Hero",
      prefab: null,
      transform: { x: 16, y: 24 },
      components: {
        logic: {
          graph: serializeNodeGraph(heuristicGraph),
          graph_ref: "graphs/sgdk_phase_d_hero.json",
          graph_origin: "imported_ref",
          external_source_refs: ["src/main.c"],
          imported_semantics: {
            source: "sgdk_phase_d",
            confidence: "low",
            source_paths: ["src/player.c"],
          } as unknown as NonNullable<Entity["components"]["logic"]>["imported_semantics"],
        },
      },
    };

    await act(async () => {
      useEditorStore.setState({
        activeScene: buildSceneWithGraph(heuristicGraph, [importedEntity]),
        activeSceneSource: buildSceneWithGraph(heuristicGraph, [importedEntity]),
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='nodegraph-import-provenance']")?.textContent).toContain(
      "Heuristica"
    );
    expect(container.querySelector("[data-testid='nodegraph-source-mapping']")?.textContent).toContain(
      "src/player.c"
    );
    expect(container.querySelector("[data-testid='nodegraph-import-gaps']")?.textContent).toContain(
      "AST/FSM real nao extraido"
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
