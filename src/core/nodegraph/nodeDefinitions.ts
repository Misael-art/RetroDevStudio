/**
 * nodeDefinitions.ts — Definicoes canonicas de nodes e hidratacao (Experimental).
 *
 * Dono das definicoes de portas/params default por tipo de node (NODE_DEFS)
 * e da deserializacao v1 (hidratacao dirigida por definicao). Faz par com
 * `nodeTypes.ts`; a UI consome, nao define.
 */

import {
  EMPTY_GRAPH,
  cloneGraph,
  isNodeEdge,
  isNodePort,
  isNodeType,
  isRecord,
  type GraphNode,
  type NodeEdge,
  type NodeGraph,
  type NodePort,
  type NodeType,
} from "./nodeTypes";

export const NODE_DEFS: Record<NodeType, Omit<GraphNode, "id" | "x" | "y">> = {
  event_start: {
    type: "event_start", label: "On Start",
    inputs: [],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: {},
  },
  event_update: {
    type: "event_update", label: "On Update",
    inputs: [],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { rate: "frame" },
  },
  input_pressed: {
    type: "input_pressed",
    label: "On Input Pressed",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { pad: "JOY_1", button: "BUTTON_A" },
  },
  input_held: {
    type: "input_held",
    label: "On Input Held",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { pad: "JOY_1", button: "BUTTON_RIGHT" },
  },
  input_command: {
    type: "input_command",
    label: "Input Command",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [
      { id: "exec", label: ">", kind: "exec" },
      { id: "false", label: "False >", kind: "exec" },
    ],
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
  sprite_move: {
    type: "sprite_move", label: "Move Sprite",
    inputs: [
      { id: "exec",   label: "▶", kind: "exec" },
      { id: "dx",     label: "dx", kind: "data", dataType: "int" },
      { id: "dy",     label: "dy", kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { target: "player", dx: 0, dy: 0 },
  },
  set_velocity: {
    type: "set_velocity", label: "Set Velocity",
    inputs: [
      { id: "exec", label: ">", kind: "exec" },
      { id: "vx", label: "vx", kind: "data", dataType: "int" },
      { id: "vy", label: "vy", kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { target: "player", vx: 0, vy: 0 },
  },
  set_position: {
    type: "set_position", label: "Set Position",
    inputs: [
      { id: "exec", label: ">", kind: "exec" },
      { id: "x", label: "x", kind: "data", dataType: "int" },
      { id: "y", label: "y", kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { target: "player", x: 0, y: 0 },
  },
  spawn_entity: {
    type: "spawn_entity", label: "Spawn",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { prefab: "enemy", x: 0, y: 0 },
  },
  destroy_entity: {
    type: "destroy_entity", label: "Destroy",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { target: "self" },
  },
  sprite_anim: {
    type: "sprite_anim", label: "Set Animation",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { target: "player", anim: "idle" },
  },
  set_animation_state: {
    type: "set_animation_state", label: "Set Anim State",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { target: "player", state: "idle" },
  },
  condition_overlap: {
    type: "condition_overlap",
    label: "On Overlap",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [
      { id: "true",  label: "True ▶",  kind: "exec" },
      { id: "false", label: "False ▶", kind: "exec" },
    ],
    params: { a: "player", b: "enemy" },
  },
  camera_follow: {
    type: "camera_follow", label: "Camera Follow",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { target: "player", damping: 0 },
  },
  camera_bounds: {
    type: "camera_bounds", label: "Camera Bounds",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { min_x: 0, min_y: 0, max_x: 320, max_y: 224 },
  },
  timer: {
    type: "timer", label: "Timer",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [
      { id: "tick", label: "Tick >", kind: "exec" },
      { id: "done", label: "Done >", kind: "exec" },
    ],
    params: { frames: 60, repeat: 0 },
  },
  set_tile: {
    type: "set_tile", label: "Set Tile",
    inputs: [
      { id: "exec", label: ">", kind: "exec" },
      { id: "x", label: "x", kind: "data", dataType: "int" },
      { id: "y", label: "y", kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { layer: "BG_A", tile: 1, x: 0, y: 0 },
  },
  effect_parallax: {
    type: "effect_parallax", label: "Parallax Scroll",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { layer: "BG1", speed_x: 1, speed_y: 0 },
  },
  effect_raster: {
    type: "effect_raster", label: "Raster Effect",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { scanline: 128, offset_x: 4 },
  },
  logic_and: {
    type: "logic_and", label: "AND",
    inputs: [
      { id: "a", label: "A", kind: "data", dataType: "bool" },
      { id: "b", label: "B", kind: "data", dataType: "bool" },
    ],
    outputs: [{ id: "out", label: "Out", kind: "data", dataType: "bool" }],
    params: {},
  },
  action_sound: {
    type: "action_sound", label: "Play Sound",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { sfx: "jump" },
  },
  action_music: {
    type: "action_music", label: "Play Music",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { action: "play", track: "stage_theme", fade_ms: 500 },
  },
  scroll_tilemap: {
    type: "scroll_tilemap", label: "Scroll Tilemap",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "dx",   label: "dx", kind: "data", dataType: "int" },
      { id: "dy",   label: "dy", kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { layer: "BG_A", dx: 1, dy: 0 },
  },
  load_scene: {
    type: "load_scene", label: "Load Scene",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { scene: "main" },
  },
  move_camera: {
    type: "move_camera", label: "Move Camera",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "x",    label: "x",  kind: "data", dataType: "int" },
      { id: "y",    label: "y",  kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { target: "cam", x: 0, y: 0 },
  },
  var_set: {
    type: "var_set", label: "Set Variable",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "value", label: "Value", kind: "data", dataType: "int" }
    ],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { var_name: "temp_var", value: 0 },
  },
  var_get: {
    type: "var_get", label: "Get Variable",
    inputs: [],
    outputs: [{ id: "value", label: "Value", kind: "data", dataType: "int" }],
    params: { var_name: "temp_var" },
  },
  logic_math: {
    type: "logic_math", label: "Math Exp",
    inputs: [
      { id: "a", label: "A", kind: "data", dataType: "int" },
      { id: "b", label: "B", kind: "data", dataType: "int" }
    ],
    outputs: [{ id: "value", label: "Value", kind: "data", dataType: "int" }],
    params: { operator: "+" },
  },
  condition_compare: {
    type: "condition_compare", label: "Compare",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "a", label: "A", kind: "data", dataType: "int" },
      { id: "b", label: "B", kind: "data", dataType: "int" }
    ],
    outputs: [
      { id: "true", label: "True ▶", kind: "exec" },
      { id: "false", label: "False ▶", kind: "exec" }
    ],
    params: { operator: "==" },
  },
  fsm_state: {
    type: "fsm_state", label: "FSM State",
    inputs: [{ id: "exec", label: "Enter", kind: "exec" }],
    outputs: [
      { id: "exec", label: "Body ▶", kind: "exec" },
      { id: "transitions", label: "Transitions ▶", kind: "exec" },
    ],
    params: { state_name: "idle", initial: 0 },
  },
  fsm_transition: {
    type: "fsm_transition", label: "FSM Transition",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "condition", label: "Condition", kind: "data", dataType: "bool" },
    ],
    outputs: [
      { id: "matched", label: "Matched ▶", kind: "exec" },
      { id: "next", label: "Next ▶", kind: "exec" },
    ],
    params: { target_state: "idle" },
  },
  flow_if: {
    type: "flow_if", label: "If",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "condition", label: "Condition", kind: "data", dataType: "bool" },
    ],
    outputs: [
      { id: "true", label: "True ▶", kind: "exec" },
      { id: "false", label: "False ▶", kind: "exec" },
    ],
    params: {},
  },
  flow_while: {
    type: "flow_while", label: "While",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "condition", label: "Condition", kind: "data", dataType: "bool" },
    ],
    outputs: [
      { id: "body", label: "Body ▶", kind: "exec" },
      { id: "done", label: "Done ▶", kind: "exec" },
    ],
    params: {},
  },
  flow_for: {
    type: "flow_for", label: "For",
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "count", label: "Count", kind: "data", dataType: "int" },
    ],
    outputs: [
      { id: "body", label: "Body ▶", kind: "exec" },
      { id: "done", label: "Done ▶", kind: "exec" },
    ],
    params: { var_name: "i", count: 4 },
  },
  timeline_sequence: {
    type: "timeline_sequence", label: "Timeline",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [
      { id: "slot_0", label: "Slot 1 ▶", kind: "exec" },
      { id: "slot_1", label: "Slot 2 ▶", kind: "exec" },
      { id: "slot_2", label: "Slot 3 ▶", kind: "exec" },
    ],
    params: {
      timeline_name: "cutscene",
      slot_0_delay: 30,
      slot_1_delay: 60,
      slot_2_delay: 90,
    },
  },
  hardware_budget_check: {
    type: "hardware_budget_check", label: "Budget Check",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [
      { id: "ok", label: "OK >", kind: "exec" },
      { id: "warn", label: "Warn >", kind: "exec" },
    ],
    params: { vram_kb: 64, sprites: 80, scanline_sprites: 20 },
  },
  bridge_unconverted_source: {
    type: "bridge_unconverted_source", label: "Source Bridge",
    inputs: [{ id: "exec", label: ">", kind: "exec" }],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { gap: "semantic_gap", source: "" },
  },
  event_vblank: {
    type: "event_vblank", label: "On VBlank",
    inputs: [],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: {},
  },
  event_hblank: {
    type: "event_hblank", label: "On HBlank",
    inputs: [],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: {},
  },
  event_dma_done: {
    type: "event_dma_done", label: "On DMA Done",
    inputs: [],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: {},
  },
};


export function clonePorts(ports: NodePort[]): NodePort[] {
  return ports.map((port) => ({ ...port }));
}

/** Junta portos do JSON importado com os portos canónicos do editor (mesmo id conserva label/kind do ficheiro). */
function mergePortsWithDefinition(
  defaults: NodePort[],
  incoming: unknown
): NodePort[] {
  if (!Array.isArray(incoming)) {
    return clonePorts(defaults);
  }
  const parsed = incoming.filter(isNodePort);
  const byId = new Map(parsed.map((port) => [port.id, port]));
  return defaults.map((defPort) => {
    const hit = byId.get(defPort.id);
    return hit ? { ...defPort, ...hit } : { ...defPort };
  });
}

function isGraphParamValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function coerceNodeParams(type: NodeType, params: unknown): Record<string, string | number> {
  const defaults = { ...NODE_DEFS[type].params };
  if (!isRecord(params)) {
    return defaults;
  }

  for (const [key, value] of Object.entries(params)) {
    if (isGraphParamValue(value)) {
      defaults[key] = value;
    }
  }

  return defaults;
}

function hydrateGraphNode(value: unknown, index: number): GraphNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isNodeType(value.type)) {
    return null;
  }

  const def = NODE_DEFS[value.type];
  const inputs = mergePortsWithDefinition(def.inputs, value.inputs);
  const outputs = mergePortsWithDefinition(def.outputs, value.outputs);

  return {
    id: value.id,
    type: value.type,
    label: typeof value.label === "string" ? value.label : def.label,
    x: typeof value.x === "number" ? value.x : 40 + index * 200,
    y: typeof value.y === "number" ? value.y : 80,
    inputs,
    outputs,
    params: coerceNodeParams(value.type, value.params),
  };
}

function edgeConnectsValidPorts(
  edge: NodeEdge,
  nodeById: Map<string, GraphNode>
): boolean {
  const fromNode = nodeById.get(edge.fromNode);
  const toNode = nodeById.get(edge.toNode);
  if (!fromNode || !toNode) {
    return false;
  }
  const fromOk = fromNode.outputs.some((port) => port.id === edge.fromPort);
  const toOk = toNode.inputs.some((port) => port.id === edge.toPort);
  return fromOk && toOk;
}

/** Deserializacao v1: hidrata nodes com defaults canonicos e descarta arestas invalidas. */
export function deserializeNodeGraph(serialized?: string | null): NodeGraph {
  if (!serialized) {
    return cloneGraph(EMPTY_GRAPH);
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!isRecord(parsed)) {
      return cloneGraph(EMPTY_GRAPH);
    }

    const { nodes, edges } = parsed;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return cloneGraph(EMPTY_GRAPH);
    }

    const rawEdges = edges.filter(isNodeEdge);

    const hydratedNodes = nodes
      .map((node, index) => hydrateGraphNode(node, index))
      .filter((node): node is GraphNode => node !== null);

    if (hydratedNodes.length === 0) {
      return cloneGraph(EMPTY_GRAPH);
    }

    const nodeById = new Map(hydratedNodes.map((node) => [node.id, node]));
    const validEdges = rawEdges.filter((edge) => edgeConnectsValidPorts(edge, nodeById));

    return cloneGraph({ nodes: hydratedNodes, edges: validEdges });
  } catch {
    return cloneGraph(EMPTY_GRAPH);
  }
}
