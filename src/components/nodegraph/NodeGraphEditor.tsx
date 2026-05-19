import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { persistActiveScene } from "../../core/scenePersistence";
import { openProjectSourcePath } from "../../core/ipc/projectService";
import { parseSceneJson, resolveScenePrefabs } from "../../core/ipc/sceneService";
import { useEditorStore } from "../../core/store/editorStore";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { resolveEntitySourceRefs } from "../../core/entityAuthoring";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | "event_start"
  | "event_update"
  | "input_pressed"
  | "input_held"
  | "input_command"
  | "sprite_move"
  | "set_velocity"
  | "set_position"
  | "spawn_entity"
  | "destroy_entity"
  | "sprite_anim"
  | "set_animation_state"
  | "condition_overlap"
  | "camera_follow"
  | "camera_bounds"
  | "timer"
  | "set_tile"
  | "effect_parallax"
  | "effect_raster"
  | "logic_and"
  | "action_sound"
  | "scroll_tilemap"
  | "load_scene"
  | "move_camera"
  | "var_set"
  | "var_get"
  | "logic_math"
  | "condition_compare"
  | "fsm_state"
  | "fsm_transition"
  | "flow_if"
  | "flow_while"
  | "flow_for"
  | "timeline_sequence"
  | "hardware_budget_check"
  | "bridge_unconverted_source"
  | "event_vblank"
  | "event_hblank"
  | "event_dma_done";

export interface NodePort {
  id: string;
  label: string;
  kind: "exec" | "data";
  dataType?: "int" | "bool" | "string";
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  inputs: NodePort[];
  outputs: NodePort[];
  params: Record<string, string | number>;
}

export interface NodeEdge {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface NodeGraph {
  nodes: GraphNode[];
  edges: NodeEdge[];
}

type ViewOffset = {
  x: number;
  y: number;
};

type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type NodeGraphSummary = {
  totalNodes: number;
  totalEdges: number;
  entryNodeIds: string[];
  disconnectedNodeIds: string[];
};

export type NodeGraphValidationIssue = {
  severity: "error" | "warning";
  code:
    | "broken_node_ref"
    | "broken_port_ref"
    | "port_kind_mismatch"
    | "data_type_mismatch"
    | "exec_cycle"
    | "missing_entry"
    | "disconnected_node";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type NodeGraphValidation = {
  errors: NodeGraphValidationIssue[];
  warnings: NodeGraphValidationIssue[];
};

type MiniMapNode = {
  id: string;
  type: NodeType;
  x: number;
  y: number;
};

type GuidedFlowCommentary = {
  title: string;
  summary: string;
  comments: string[];
  hardwareNote: string;
  limitation?: string;
};

type QuickActionContext = {
  selectedEntityId: string | null;
  selectedEntityLabel: string | null;
  otherEntityId: string | null;
};

type QuickActionTemplate = GuidedFlowCommentary & {
  id:
    | "player_controller"
    | "enemy_logic"
    | "timer_event"
    | "projectile_motion"
    | "camera_rig"
    | "fighter_combat"
    | "fighter_command"
    | "support_state_tick"
    | "hud_vblank_tick";
  actionLabel: string;
  buildGraph: (context: QuickActionContext) => NodeGraph;
};

export const EMPTY_GRAPH: NodeGraph = {
  nodes: [],
  edges: [],
};

const NODE_CARD_WIDTH = 160;
const NODE_CARD_HEIGHT = 56;
const FOCUS_PADDING = 24;
const MINIMAP_WIDTH = 176;
const MINIMAP_HEIGHT = 112;
const MINIMAP_PADDING = 10;

const EVENT_NODE_TYPES: NodeType[] = [
  "event_start",
  "event_update",
  "input_pressed",
  "input_held",
  "input_command",
  "condition_overlap",
  "event_vblank",
  "event_hblank",
  "event_dma_done",
];

export const REQUIRED_NOCODE_NODE_TYPES: NodeType[] = [
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
];

function normalizeGraphEntityKey(value: string | number | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cloneGraph(graph: NodeGraph): NodeGraph {
  return structuredClone(graph);
}

export function getNodeGraphBounds(graph: NodeGraph): GraphBounds | null {
  if (graph.nodes.length === 0) {
    return null;
  }

  const xs = graph.nodes.map((node) => node.x);
  const ys = graph.nodes.map((node) => node.y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs) + NODE_CARD_WIDTH,
    maxY: Math.max(...ys) + NODE_CARD_HEIGHT,
  };
}

export function summarizeNodeGraph(graph: NodeGraph): NodeGraphSummary {
  const connectedNodeIds = new Set<string>();
  graph.edges.forEach((edge) => {
    connectedNodeIds.add(edge.fromNode);
    connectedNodeIds.add(edge.toNode);
  });

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    entryNodeIds: graph.nodes
      .filter((node) => EVENT_NODE_TYPES.includes(node.type))
      .map((node) => node.id),
    disconnectedNodeIds: graph.nodes
      .filter((node) => !connectedNodeIds.has(node.id))
      .map((node) => node.id),
  };
}

function findPort(node: GraphNode, portId: string, direction: "input" | "output"): NodePort | undefined {
  const ports = direction === "input" ? node.inputs : node.outputs;
  return ports.find((port) => port.id === portId);
}

function collectExecCycles(graph: NodeGraph, nodeById: Map<string, GraphNode>): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    if (!fromNode || !toNode) {
      continue;
    }
    const fromPort = findPort(fromNode, edge.fromPort, "output");
    const toPort = findPort(toNode, edge.toPort, "input");
    if (fromPort?.kind !== "exec" || toPort?.kind !== "exec") {
      continue;
    }
    adjacency.set(edge.fromNode, [...(adjacency.get(edge.fromNode) ?? []), edge.toNode]);
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      const cycleStart = stack.indexOf(nodeId);
      cycles.push(cycleStart >= 0 ? stack.slice(cycleStart).concat(nodeId) : [nodeId]);
      return;
    }
    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of graph.nodes) {
    visit(node.id);
  }

  return cycles;
}

export function validateNodeGraph(graph: NodeGraph): NodeGraphValidation {
  const issues: NodeGraphValidationIssue[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const connectedNodeIds = new Set<string>();

  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    if (!fromNode || !toNode) {
      issues.push({
        severity: "error",
        code: "broken_node_ref",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' aponta para no inexistente.`,
      });
      continue;
    }

    const fromPort = findPort(fromNode, edge.fromPort, "output");
    const toPort = findPort(toNode, edge.toPort, "input");
    if (!fromPort || !toPort) {
      issues.push({
        severity: "error",
        code: "broken_port_ref",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' aponta para porta inexistente.`,
      });
      continue;
    }

    connectedNodeIds.add(edge.fromNode);
    connectedNodeIds.add(edge.toNode);

    if (fromPort.kind !== toPort.kind) {
      issues.push({
        severity: "error",
        code: "port_kind_mismatch",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' liga porta ${fromPort.kind} em porta ${toPort.kind}.`,
      });
    }

    if (
      fromPort.kind === "data" &&
      toPort.kind === "data" &&
      fromPort.dataType &&
      toPort.dataType &&
      fromPort.dataType !== toPort.dataType
    ) {
      issues.push({
        severity: "error",
        code: "data_type_mismatch",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' liga dado ${fromPort.dataType} em dado ${toPort.dataType}.`,
      });
    }
  }

  if (graph.nodes.length > 0 && graph.nodes.every((node) => !EVENT_NODE_TYPES.includes(node.type))) {
    issues.push({
      severity: "warning",
      code: "missing_entry",
      message: "Grafo sem evento de entrada.",
    });
  }

  for (const node of graph.nodes) {
    if (!connectedNodeIds.has(node.id)) {
      issues.push({
        severity: "warning",
        code: "disconnected_node",
        nodeId: node.id,
        message: `No '${node.label}' ainda esta solto no fluxo.`,
      });
    }
  }

  for (const cycle of collectExecCycles(graph, nodeById)) {
    issues.push({
      severity: "error",
      code: "exec_cycle",
      nodeId: cycle[0],
      message: `Ciclo exec detectado: ${cycle.join(" -> ")}.`,
    });
  }

  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
  };
}

export function buildNodeMiniMap(
  graph: NodeGraph,
  width = MINIMAP_WIDTH,
  height = MINIMAP_HEIGHT,
  padding = MINIMAP_PADDING
): MiniMapNode[] {
  const bounds = getNodeGraphBounds(graph);
  if (!bounds) {
    return [];
  }

  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(innerWidth / graphWidth, innerHeight / graphHeight);

  return graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    x: padding + (node.x - bounds.minX) * scale,
    y: padding + (node.y - bounds.minY) * scale,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodePort(value: unknown): value is NodePort {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.kind === "exec" || value.kind === "data") &&
    (value.dataType === undefined ||
      value.dataType === "int" ||
      value.dataType === "bool" ||
      value.dataType === "string")
  );
}

function isNodeType(value: unknown): value is NodeType {
  return (
    value === "event_start" ||
    value === "event_update" ||
    value === "input_pressed" ||
    value === "input_held" ||
    value === "sprite_move" ||
    value === "set_velocity" ||
    value === "set_position" ||
    value === "spawn_entity" ||
    value === "destroy_entity" ||
    value === "sprite_anim" ||
    value === "set_animation_state" ||
    value === "condition_overlap" ||
    value === "camera_follow" ||
    value === "camera_bounds" ||
    value === "timer" ||
    value === "set_tile" ||
    value === "effect_parallax" ||
    value === "effect_raster" ||
    value === "logic_and" ||
    value === "action_sound" ||
    value === "scroll_tilemap" ||
    value === "load_scene" ||
    value === "move_camera" ||
    value === "var_set" ||
    value === "var_get" ||
    value === "logic_math" ||
    value === "condition_compare" ||
    value === "fsm_state" ||
    value === "fsm_transition" ||
    value === "flow_if" ||
    value === "flow_while" ||
    value === "flow_for" ||
    value === "timeline_sequence" ||
    value === "hardware_budget_check" ||
    value === "bridge_unconverted_source" ||
    value === "event_vblank" ||
    value === "event_hblank" ||
    value === "event_dma_done"
  );
}

function isNodeEdge(value: unknown): value is NodeEdge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.fromNode === "string" &&
    typeof value.fromPort === "string" &&
    typeof value.toNode === "string" &&
    typeof value.toPort === "string"
  );
}

export function serializeNodeGraph(graph: NodeGraph): string {
  return JSON.stringify({
    version: 1,
    nodes: structuredClone(graph.nodes),
    edges: structuredClone(graph.edges),
  });
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

// ── Node definitions (palette) ────────────────────────────────────────────────

const NODE_DEFS: Record<NodeType, Omit<GraphNode, "id" | "x" | "y">> = {
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
    type: "input_pressed", label: "On Input Pressed",
    inputs: [],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { pad: "JOY_1", button: "BUTTON_A" },
  },
  input_held: {
    type: "input_held", label: "On Input Held",
    inputs: [],
    outputs: [{ id: "exec", label: ">", kind: "exec" }],
    params: { pad: "JOY_1", button: "BUTTON_RIGHT" },
  },
  input_command: {
    type: "input_command", label: "Input Command",
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
    type: "condition_overlap", label: "On Overlap",
    inputs: [],
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

export const NODE_DISPLAY_NAMES: Record<NodeType, string> = {
  event_start: "Ao Iniciar",
  event_update: "A Cada Frame",
  input_pressed: "Input Pressionado",
  input_held: "Input Segurado",
  input_command: "Comando de Input",
  sprite_move: "Mover Sprite",
  set_velocity: "Definir Velocidade",
  set_position: "Definir Posicao",
  spawn_entity: "Criar Entidade",
  destroy_entity: "Destruir Entidade",
  sprite_anim: "Animar Sprite",
  set_animation_state: "Estado de Animacao",
  condition_overlap: "Colisao (Overlap)",
  camera_follow: "Camera Segue",
  camera_bounds: "Limites da Camera",
  timer: "Timer",
  set_tile: "Definir Tile",
  effect_parallax: "Parallax",
  effect_raster: "Efeito Raster",
  logic_and: "E (And)",
  action_sound: "Tocar Som",
  scroll_tilemap: "Rolar Cenario",
  load_scene: "Carregar Cena",
  move_camera: "Mover Camera",
  var_set: "Definir Variavel",
  var_get: "Ler Variavel",
  logic_math: "Conta Matematica",
  condition_compare: "Comparar",
  fsm_state: "Estado (FSM)",
  fsm_transition: "Transicao (FSM)",
  flow_if: "Se (If)",
  flow_while: "Enquanto (While)",
  flow_for: "Repetir (For)",
  timeline_sequence: "Sequencia (Timeline)",
  hardware_budget_check: "Checar Budget",
  bridge_unconverted_source: "Bridge de Fonte",
  event_vblank: "Evento VBlank",
  event_hblank: "Evento HBlank",
  event_dma_done: "Evento DMA",
};

const NODE_PARAM_DISPLAY_NAMES: Record<string, string> = {
  a: "A",
  anim: "Animacao",
  b: "B",
  condition: "Condicao",
  count: "Contagem",
  button: "Botao",
  button_profile: "Perfil",
  command_id: "Comando",
  display_name: "Nome",
  dx: "Delta X",
  dy: "Delta Y",
  frames: "Frames",
  gap: "Gap",
  max_frames: "Janela",
  max_x: "Max X",
  max_y: "Max Y",
  min_x: "Min X",
  min_y: "Min Y",
  layer: "Camada",
  offset_x: "Offset X",
  operator: "Operador",
  notation: "Notacao",
  pad: "Controle",
  prefab: "Prefab",
  rate: "Ritmo",
  repeat: "Repetir",
  scanline: "Scanline",
  scanline_sprites: "Sprites/linha",
  scene: "Cena",
  sfx: "Som",
  source: "Fonte",
  speed_x: "Velocidade X",
  speed_y: "Velocidade Y",
  sprites: "Sprites",
  state: "Estado",
  state_name: "Estado",
  target: "Alvo",
  target_state: "Proximo Estado",
  tile: "Tile",
  timeline_name: "Timeline",
  value: "Valor",
  var_name: "Variavel",
  vram_kb: "VRAM KB",
  vx: "Velocidade X",
  vy: "Velocidade Y",
  x: "X",
  y: "Y",
};

const NODE_PALETTE_GROUPS: Array<{ label: string; icon: string; types: NodeType[] }> = [
  { label: "Eventos", icon: "\u26a1", types: ["event_start", "event_update", "input_pressed", "input_held", "input_command", "event_vblank", "event_hblank", "event_dma_done"] },
  { label: "Movimento", icon: "\ud83c\udfc3", types: ["sprite_move", "set_velocity", "set_position", "spawn_entity", "destroy_entity", "sprite_anim", "set_animation_state", "scroll_tilemap", "move_camera"] },
  { label: "Condicoes", icon: "?", types: ["condition_overlap", "condition_compare", "logic_and"] },
  { label: "Camera", icon: "\u25a3", types: ["camera_follow", "camera_bounds"] },
  { label: "Tilemap", icon: "#", types: ["set_tile", "load_scene"] },
  { label: "Som", icon: "\ud83d\udd0a", types: ["action_sound"] },
  { label: "Variaveis", icon: "\ud83d\udcca", types: ["var_set", "var_get", "logic_math"] },
  { label: "Fluxo", icon: "\u2937", types: ["flow_if", "flow_while", "flow_for", "timer"] },
  { label: "Estados", icon: "\u2690\ufe0f", types: ["fsm_state", "fsm_transition", "timeline_sequence"] },
  { label: "Efeitos", icon: "\u2728", types: ["effect_parallax", "effect_raster"] },
  { label: "Hardware", icon: "!", types: ["hardware_budget_check", "bridge_unconverted_source"] },
];

/** Header background por categoria (Blueprints-style) */
const GROUP_HEADER_BG: Record<string, string> = {
  Eventos: "bg-[#722f37]",
  Movimento: "bg-[#1e3a5f]",
  Condicoes: "bg-[#4a4a3a]",
  Camera: "bg-[#1e4f4f]",
  Tilemap: "bg-[#284f35]",
  Som: "bg-[#6b5b2a]",
  Variaveis: "bg-[#4a4a3a]",
  Fluxo: "bg-[#6b5b2a]",
  Estados: "bg-[#5c4a7a]",
  Efeitos: "bg-[#5c4a7a]",
  Hardware: "bg-[#5f2f2f]",
};

function getGroupForType(type: NodeType): string {
  const group = NODE_PALETTE_GROUPS.find((g) => g.types.includes(type));
  return group?.label ?? "Outros";
}

const AUTO_LAYOUT_GROUP_ORDER = [
  "Eventos",
  "Movimento",
  "Condicoes",
  "Camera",
  "Tilemap",
  "Som",
  "Variaveis",
  "Fluxo",
  "Estados",
  "Efeitos",
  "Hardware",
  "Outros",
];

const AUTO_LAYOUT_TYPE_SEQUENCE: NodeType[] = [
  ...REQUIRED_NOCODE_NODE_TYPES,
  "sprite_anim",
  "move_camera",
  "logic_math",
  "logic_and",
  "flow_while",
  "flow_for",
  "timeline_sequence",
  "effect_parallax",
  "effect_raster",
  "bridge_unconverted_source",
  "event_vblank",
  "event_hblank",
  "event_dma_done",
];

const AUTO_LAYOUT_TYPE_ORDER = new Map<NodeType, number>(
  AUTO_LAYOUT_TYPE_SEQUENCE.map((type, index) => [type, index])
);

export function autoLayoutNodeGraph(graph: NodeGraph): NodeGraph {
  const groupCounts = new Map<string, number>();
  const orderedNodes = [...graph.nodes].sort((a, b) => {
    const groupA = AUTO_LAYOUT_GROUP_ORDER.indexOf(getGroupForType(a.type));
    const groupB = AUTO_LAYOUT_GROUP_ORDER.indexOf(getGroupForType(b.type));
    const typeA = AUTO_LAYOUT_TYPE_ORDER.get(a.type) ?? Number.MAX_SAFE_INTEGER;
    const typeB = AUTO_LAYOUT_TYPE_ORDER.get(b.type) ?? Number.MAX_SAFE_INTEGER;
    return (
      groupA - groupB ||
      typeA - typeB ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
    );
  });

  return {
    ...graph,
    nodes: orderedNodes.map((node, index) => {
      const group = getGroupForType(node.type);
      const groupIndex = Math.max(0, AUTO_LAYOUT_GROUP_ORDER.indexOf(group));
      const countInGroup = groupCounts.get(group) ?? 0;
      groupCounts.set(group, countInGroup + 1);

      return {
        ...node,
        x: 80 + Math.min(index, 4) * 220,
        y: 80 + groupIndex * 140 + countInGroup * 86,
      };
    }),
  };
}

export function getNodeDisplayName(type: NodeType): string {
  return NODE_DISPLAY_NAMES[type] ?? type;
}

function getNodeParamDisplayName(key: string): string {
  return NODE_PARAM_DISPLAY_NAMES[key] ?? key;
}

// ── Counter for unique IDs ────────────────────────────────────────────────────
function clonePorts(ports: NodePort[]): NodePort[] {
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

let _nodeCounter = 0;
let _edgeCounter = 0;

function newNodeId() { return `node_${++_nodeCounter}`; }
function newEdgeId() { return `edge_${++_edgeCounter}`; }

function makeNode(type: NodeType, x: number, y: number): GraphNode {
  const def = NODE_DEFS[type];
  return {
    ...def,
    id: newNodeId(),
    x,
    y,
    inputs: clonePorts(def.inputs),
    outputs: clonePorts(def.outputs),
    params: { ...def.params },
  };
}

function makeEdge(
  fromNode: GraphNode,
  fromPort: string,
  toNode: GraphNode,
  toPort: string
): NodeEdge {
  return {
    id: newEdgeId(),
    fromNode: fromNode.id,
    fromPort,
    toNode: toNode.id,
    toPort,
  };
}

function nodeHasPrimaryExecOut(node: GraphNode): boolean {
  return node.outputs.some((port) => port.id === "exec" && port.kind === "exec");
}

function nodeHasPrimaryExecIn(node: GraphNode): boolean {
  return node.inputs.some((port) => port.id === "exec" && port.kind === "exec");
}

function execEdgeExists(graph: NodeGraph, fromNode: string, toNode: string): boolean {
  return graph.edges.some(
    (edge) =>
      edge.fromNode === fromNode &&
      edge.toNode === toNode &&
      edge.fromPort === "exec" &&
      edge.toPort === "exec"
  );
}

/**
 * Cria arestas exec→exec entre nos consecutivos na ordem de layout (y, depois x).
 * Atalho de autoracao: revisar ramos condicionais e nos sem porta `exec` padrao.
 */
export function appendExecChainEdgesFromLayout(graph: NodeGraph): NodeGraph {
  if (graph.nodes.length < 2) {
    return graph;
  }

  const sorted = [...graph.nodes].sort((a, b) => {
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    if (a.x !== b.x) {
      return a.x - b.x;
    }
    return a.id.localeCompare(b.id);
  });

  const newEdges: NodeEdge[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const fromNode = sorted[i];
    const toNode = sorted[i + 1];
    if (!nodeHasPrimaryExecOut(fromNode) || !nodeHasPrimaryExecIn(toNode)) {
      continue;
    }
    if (execEdgeExists(graph, fromNode.id, toNode.id)) {
      continue;
    }
    if (newEdges.some((e) => e.fromNode === fromNode.id && e.toNode === toNode.id)) {
      continue;
    }
    newEdges.push(makeEdge(fromNode, "exec", toNode, "exec"));
  }

  if (newEdges.length === 0) {
    return graph;
  }

  return { ...graph, edges: [...graph.edges, ...newEdges] };
}

export function appendQuickActionGraph(
  baseGraph: NodeGraph,
  quickGraph: NodeGraph,
  spacing = 220
): { graph: NodeGraph; appendedNodeIds: string[] } {
  if (quickGraph.nodes.length === 0) {
    return { graph: cloneGraph(baseGraph), appendedNodeIds: [] };
  }
  if (baseGraph.nodes.length === 0) {
    return {
      graph: cloneGraph(quickGraph),
      appendedNodeIds: quickGraph.nodes.map((node) => node.id),
    };
  }

  const baseBounds = getNodeGraphBounds(baseGraph);
  const quickBounds = getNodeGraphBounds(quickGraph);
  if (!baseBounds || !quickBounds) {
    return { graph: cloneGraph(baseGraph), appendedNodeIds: [] };
  }

  const offsetX = baseBounds.maxX - quickBounds.minX + spacing;
  const offsetY = Math.max(0, baseBounds.minY - quickBounds.minY);
  const nodeIdMap = new Map<string, string>();
  const appendedNodes = quickGraph.nodes.map((node) => {
    const nextId = newNodeId();
    nodeIdMap.set(node.id, nextId);
    return {
      ...structuredClone(node),
      id: nextId,
      x: node.x + offsetX,
      y: node.y + offsetY,
    };
  });
  const appendedEdges = quickGraph.edges.flatMap((edge) => {
    const fromNode = nodeIdMap.get(edge.fromNode);
    const toNode = nodeIdMap.get(edge.toNode);
    if (!fromNode || !toNode) {
      return [];
    }
    return [
      {
        ...structuredClone(edge),
        id: newEdgeId(),
        fromNode,
        toNode,
      },
    ];
  });

  return {
    graph: {
      nodes: [...baseGraph.nodes, ...appendedNodes],
      edges: [...baseGraph.edges, ...appendedEdges],
    },
    appendedNodeIds: appendedNodes.map((node) => node.id),
  };
}

function resolveQuickActionPrimaryTarget(
  context: QuickActionContext,
  fallbackTarget: string
): string {
  return context.selectedEntityId?.trim() ? context.selectedEntityId : fallbackTarget;
}

function resolveQuickActionSecondaryTarget(
  context: QuickActionContext,
  primaryTarget: string,
  fallbackTarget: string
): string {
  if (context.otherEntityId && context.otherEntityId !== primaryTarget) {
    return context.otherEntityId;
  }

  if (fallbackTarget !== primaryTarget) {
    return fallbackTarget;
  }

  return primaryTarget === "player" ? "enemy" : "player";
}

function buildPlayerControllerQuickActionGraph(context: QuickActionContext): NodeGraph {
  const start = makeNode("event_start", 140, 160);
  const move = makeNode("sprite_move", 380, 156);
  const anim = makeNode("sprite_anim", 620, 156);
  const target = resolveQuickActionPrimaryTarget(context, "player");

  move.params = { ...move.params, target, dx: 2, dy: 0 };
  anim.params = { ...anim.params, target, anim: "run" };

  return {
    nodes: [start, move, anim],
    edges: [
      makeEdge(start, "exec", move, "exec"),
      makeEdge(move, "exec", anim, "exec"),
    ],
  };
}

function buildEnemyLogicQuickActionGraph(context: QuickActionContext): NodeGraph {
  const patrolStart = makeNode("event_start", 140, 120);
  const patrolAnim = makeNode("sprite_anim", 380, 116);
  const overlap = makeNode("condition_overlap", 140, 296);
  const hitSound = makeNode("action_sound", 380, 296);
  const enemyTarget = resolveQuickActionPrimaryTarget(context, "enemy");
  const playerTarget = resolveQuickActionSecondaryTarget(context, enemyTarget, "player");

  patrolAnim.params = { ...patrolAnim.params, target: enemyTarget, anim: "patrol" };
  overlap.params = { ...overlap.params, a: playerTarget, b: enemyTarget };
  hitSound.params = { ...hitSound.params, sfx: "hit" };

  return {
    nodes: [patrolStart, patrolAnim, overlap, hitSound],
    edges: [
      makeEdge(patrolStart, "exec", patrolAnim, "exec"),
      makeEdge(overlap, "true", hitSound, "exec"),
    ],
  };
}

function buildTimerQuickActionGraph(context: QuickActionContext): NodeGraph {
  void context;
  const start = makeNode("event_start", 140, 192);
  const timeline = makeNode("timeline_sequence", 400, 176);
  const sound = makeNode("action_sound", 680, 192);

  timeline.params = {
    ...timeline.params,
    timeline_name: "wait_60_frames",
    slot_0_delay: 30,
    slot_1_delay: 60,
    slot_2_delay: 120,
  };
  sound.params = { ...sound.params, sfx: "timer" };

  return {
    nodes: [start, timeline, sound],
    edges: [
      makeEdge(start, "exec", timeline, "exec"),
      makeEdge(timeline, "slot_1", sound, "exec"),
    ],
  };
}

function buildProjectileMotionQuickActionGraph(context: QuickActionContext): NodeGraph {
  const start = makeNode("event_start", 140, 168);
  const move = makeNode("sprite_move", 400, 164);
  const target = resolveQuickActionPrimaryTarget(context, "player");
  move.params = { ...move.params, target, dx: 6, dy: -1 };

  return {
    nodes: [start, move],
    edges: [makeEdge(start, "exec", move, "exec")],
  };
}

function buildCameraRigQuickActionGraph(context: QuickActionContext): NodeGraph {
  void context;
  const start = makeNode("event_start", 120, 150);
  const cam = makeNode("move_camera", 360, 146);
  const parallax = makeNode("effect_parallax", 620, 146);
  cam.params = { ...cam.params, target: "cam", x: 0, y: 0 };
  parallax.params = { ...parallax.params, layer: "BG1", speed_x: 1, speed_y: 0 };

  return {
    nodes: [start, cam, parallax],
    edges: [makeEdge(start, "exec", cam, "exec"), makeEdge(cam, "exec", parallax, "exec")],
  };
}

function buildFighterCombatQuickActionGraph(context: QuickActionContext): NodeGraph {
  const start = makeNode("event_start", 140, 120);
  const stance = makeNode("sprite_anim", 380, 116);
  const overlap = makeNode("condition_overlap", 140, 296);
  const hitSound = makeNode("action_sound", 380, 296);
  const fighter = resolveQuickActionPrimaryTarget(context, "player");
  const other = resolveQuickActionSecondaryTarget(context, fighter, "enemy");

  stance.params = { ...stance.params, target: fighter, anim: "fight_idle" };
  overlap.params = { ...overlap.params, a: fighter, b: other };
  hitSound.params = { ...hitSound.params, sfx: "hit" };

  return {
    nodes: [start, stance, overlap, hitSound],
    edges: [
      makeEdge(start, "exec", stance, "exec"),
      makeEdge(overlap, "true", hitSound, "exec"),
    ],
  };
}

function buildFighterCommandQuickActionGraph(context: QuickActionContext): NodeGraph {
  const update = makeNode("event_update", 140, 160);
  const command = makeNode("input_command", 380, 150);
  const anim = makeNode("set_animation_state", 680, 156);
  const fighter = resolveQuickActionPrimaryTarget(context, "player");

  command.params = {
    ...command.params,
    command_id: "hadouken",
    display_name: "Hadouken",
    notation: "_2,_3,_6,_P",
    max_frames: 15,
    pad: "JOY_1",
    button_profile: "megadrive",
    target: fighter,
  };
  anim.params = { ...anim.params, target: fighter, state: "fireball" };

  return {
    nodes: [update, command, anim],
    edges: [
      makeEdge(update, "exec", command, "exec"),
      makeEdge(command, "exec", anim, "exec"),
    ],
  };
}

function buildSupportStateTickQuickActionGraph(context: QuickActionContext): NodeGraph {
  const start = makeNode("event_start", 140, 160);
  const lane = makeNode("var_set", 380, 156);
  const anim = makeNode("sprite_anim", 640, 156);
  const target = resolveQuickActionPrimaryTarget(context, "player");

  lane.params = { ...lane.params, var_name: "support_lane", value: 1 };
  anim.params = { ...anim.params, target, anim: "buff_idle" };

  return {
    nodes: [start, lane, anim],
    edges: [makeEdge(start, "exec", lane, "exec"), makeEdge(lane, "exec", anim, "exec")],
  };
}

function buildHudVblankTickQuickActionGraph(context: QuickActionContext): NodeGraph {
  void context;
  const vb = makeNode("event_vblank", 140, 176);
  const tick = makeNode("var_set", 400, 172);
  tick.params = { ...tick.params, var_name: "hud_frame", value: 1 };

  return {
    nodes: [vb, tick],
    edges: [makeEdge(vb, "exec", tick, "exec")],
  };
}

const QUICK_ACTION_TEMPLATES: QuickActionTemplate[] = [
  {
    id: "player_controller",
    actionLabel: "Criar Player Controller Basico",
    title: "Player Controller Basico",
    summary: "Monta um fluxo inicial de movimento do player com animacao ligada ao mesmo encadeamento.",
    comments: [
      "Ao Iniciar prepara o fluxo principal sem depender de wiring manual no primeiro minuto.",
      "Mover Sprite usa deltas pequenos, compativeis com logica de 16-bits e tuning posterior no Inspector.",
      "Animar Sprite fecha o esqueleto visual para o personagem entrar no loop canônico logo no bootstrap.",
    ],
    hardwareNote:
      "Fluxo conservador: so usa nos ja suportados no pipeline atual de SGDK e SNES.",
    buildGraph: buildPlayerControllerQuickActionGraph,
  },
  {
    id: "enemy_logic",
    actionLabel: "Logica de Inimigo Simples",
    title: "Logica de Inimigo Simples",
    summary: "Combina um estado inicial de patrulha com um gatilho de overlap para feedback imediato.",
    comments: [
      "Ao Iniciar coloca o inimigo em uma animacao base de patrulha para o grafo nao nascer parado.",
      "Colisao (Overlap) separa o ramo de contato entre player e enemy sem inventar eventos fora do schema atual.",
      "Tocar Som funciona como feedback imediato enquanto a acao destrutiva ainda nao esta institucionalizada no NodeGraph.",
    ],
    hardwareNote:
      "O overlap ja conversa com o build atual; destroy/remove ainda nao entra nesta wave de onboarding.",
    limitation:
      "A remocao de entidade continua fora deste atalho para nao prometer um no que o pipeline canonico ainda nao expoe.",
    buildGraph: buildEnemyLogicQuickActionGraph,
  },
  {
    id: "timer_event",
    actionLabel: "Timer Event",
    title: "Timer Event",
    summary: "Cria uma sequencia de tempo fixa e hardware-friendly para disparos por frame.",
    comments: [
      "Ao Iniciar aciona a timeline sem exigir no auxiliar extra para o primeiro teste.",
      "Sequencia (Timeline) usa 60 frames como marco canônico, facil de mapear para um segundo em 60 Hz.",
      "Tocar Som no slot de 60 frames deixa claro onde encaixar uma acao real quando o usuario evoluir o fluxo.",
    ],
    hardwareNote:
      "A timeline usa delays discretos por frame, o que combina melhor com o runtime retro do que tempos soltos em milissegundos.",
    buildGraph: buildTimerQuickActionGraph,
  },
  {
    id: "projectile_motion",
    actionLabel: "Movimento de projetil (linear)",
    title: "Projetil em linha",
    summary: "Arranque simples com movimento por frame para alvo inferido ou escolhido.",
    comments: [
      "Ao Iniciar liga diretamente ao Move Sprite para nao exigir wiring manual no primeiro teste.",
      "Velocidade inicial conservadora; ajuste dx/dy no cartao do no quando o playtest pedir.",
      "Use ramos de colisao depois, a partir da paleta, sem misturar overlap automatico neste atalho.",
    ],
    hardwareNote:
      "Mantem somente nos suportados pelo compilador atual; nao promete destruicao ou spawn fora do schema.",
    limitation:
      "Colisao e dano nao entram neste esqueleto para evitar prometer fluxos que o pipeline ainda nao fecha.",
    buildGraph: buildProjectileMotionQuickActionGraph,
  },
  {
    id: "camera_rig",
    actionLabel: "Camera + parallax basico",
    title: "Camera e parallax",
    summary: "Encadeia Move Camera com Parallax para um rig inicial de cena larga.",
    comments: [
      "Ao Iniciar aciona Move Camera com offsets neutros, prontos para amarrar a um alvo depois.",
      "Parallax Scroll vem logo apos para reforcar leitura de profundidade sem exigir eventos extra.",
      "Parametros de layer e velocidade sao conservadores para Mega Drive / SNES.",
    ],
    hardwareNote:
      "Scroll e camera respeitam o modelo atual de comentarios e chamadas no compilador de nos.",
    buildGraph: buildCameraRigQuickActionGraph,
  },
  {
    id: "fighter_combat",
    actionLabel: "Lutador: stance + contato",
    title: "Lutador (stance / hit)",
    summary: "Animacao de combate inicial com ramo de overlap para feedback sonoro.",
    comments: [
      "Ao Iniciar define uma animacao de stance para o lutador principal inferido.",
      "Overlap separa o momento de contato entre o lutador e o oponente mais proximo na cena.",
      "Som de hit fecha o loop de feedback enquanto acoes destrutivas continuam fora do atalho.",
    ],
    hardwareNote:
      "Overlap usa o mesmo schema de entidades ja suportado; nao inventa eventos de round.",
    limitation:
      "Nao inclui FSM completa de rounds: apenas bootstrap de leitura e feedback.",
    buildGraph: buildFighterCombatQuickActionGraph,
  },
  {
    id: "fighter_command",
    actionLabel: "Criar comando de luta",
    title: "Comando de luta",
    summary: "Adiciona input_command com quarto de lua e liga a animacao de ataque no alvo selecionado.",
    comments: [
      "On Update alimenta o matcher por frame, alinhado ao runtime retro.",
      "Comando de Input guarda a notacao fonte, janela em frames e perfil de botoes.",
      "Estado de Animacao mostra onde conectar o golpe detectado sem escrever codigo manual.",
    ],
    hardwareNote:
      "Runtime experimental: tokens fora do subset suportado bloqueiam codegen em vez de virar warning cosmetico.",
    limitation:
      "Use command.dat local para substituir Hadouken por comandos reais da sua biblioteca.",
    buildGraph: buildFighterCommandQuickActionGraph,
  },
  {
    id: "support_state_tick",
    actionLabel: "Apoio: estado + anim",
    title: "Apoio (estado)",
    summary: "Escreve um slot de estado simples e liga animacao de apoio ao mesmo encadeamento.",
    comments: [
      "Set Variable reserva um nome explicito para o autor trocar quando integrar HUD ou lanes.",
      "Animar Sprite usa alvo principal da selecao para manter coerencia com o resto dos atalhos.",
      "Encadeamento linear deixa claro a ordem mental: estado antes da apresentacao visual.",
    ],
    hardwareNote:
      "Variaveis sao placeholders de inteiros; o autor deve alinhar nomes com o codigo gerado.",
    buildGraph: buildSupportStateTickQuickActionGraph,
  },
  {
    id: "hud_vblank_tick",
    actionLabel: "HUD: tick por VBlank",
    title: "HUD (VBlank)",
    summary: "Gancho de frame com escrita de variavel para contadores de HUD discretos.",
    comments: [
      "On VBlank e o ponto natural para atualizar contadores sem bloquear o fluxo principal.",
      "Set Variable mantem um contador simples que o autor pode renomear para score, timer, etc.",
      "Mantenha o corpo enxuto: ramificacoes de UI entram depois via paleta.",
    ],
    hardwareNote:
      "VBlank e variaveis inteiras alinham-se ao modelo de frame fixo do alvo retro.",
    limitation:
      "Nao inclui desenho de tiles ou sprites de HUD: apenas o gancho logico inicial.",
    buildGraph: buildHudVblankTickQuickActionGraph,
  },
];

/** Prioriza quick actions alinhadas ao `entity_role` importado (heuristica). */
const QUICK_ACTION_PREF_BY_ENTITY_ROLE: Partial<Record<string, QuickActionTemplate["id"]>> = {
  player_avatar: "player_controller",
  enemy_actor: "enemy_logic",
  fighter_actor: "fighter_combat",
  projectile_actor: "projectile_motion",
  support_actor: "support_state_tick",
  hud_actor: "hud_vblank_tick",
};

// ── Initial graph (demo) ──────────────────────────────────────────────────────

const INITIAL_GRAPH: NodeGraph = {
  nodes: [
    { ...NODE_DEFS.event_start,    id: "n0", x: 40,  y: 80,  inputs: [], outputs: [{ id: "exec", label: "▶", kind: "exec" }], params: {} },
    { ...NODE_DEFS.sprite_move,    id: "n1", x: 240, y: 80,  inputs: [...NODE_DEFS.sprite_move.inputs.map(p=>({...p}))], outputs: [...NODE_DEFS.sprite_move.outputs.map(p=>({...p}))], params: { target: "player", dx: 2, dy: 0 } },
    { ...NODE_DEFS.effect_parallax,id: "n2", x: 440, y: 80,  inputs: [...NODE_DEFS.effect_parallax.inputs.map(p=>({...p}))], outputs: [...NODE_DEFS.effect_parallax.outputs.map(p=>({...p}))], params: { layer: "BG1", speed_x: 1, speed_y: 0 } },
  ],
  edges: [
    { id: "e0", fromNode: "n0", fromPort: "exec", toNode: "n1", toPort: "exec" },
    { id: "e1", fromNode: "n1", fromPort: "exec", toNode: "n2", toPort: "exec" },
  ],
};

// ── Node component ────────────────────────────────────────────────────────────

interface NodeCardProps {
  node: GraphNode;
  screenX: number;
  screenY: number;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
  onPortMouseUp: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
}

function NodeCard({
  node,
  screenX,
  screenY,
  selected,
  onMouseDown,
  onPortMouseDown,
  onPortMouseUp,
}: NodeCardProps) {
  const group = getGroupForType(node.type);
  const headerBg = GROUP_HEADER_BG[group] ?? "bg-[#4a4a3a]";

  return (
    <div
      data-testid={`node-card-${node.id}`}
      className={`absolute select-none min-w-[160px] rounded-xl border border-slate-700 bg-slate-900/90 shadow-lg backdrop-blur-sm ${
        selected ? "ring-2 ring-blue-500 shadow-2xl" : ""
      }`}
      style={{ left: screenX, top: screenY }}
      onMouseDown={onMouseDown}
    >
      {/* Header colorido por categoria */}
      <div
        className={`rounded-t-xl px-3 py-1.5 text-[11px] font-semibold text-white/95 cursor-grab ${headerBg}`}
      >
        {getNodeDisplayName(node.type)}
      </div>

      {/* Ports */}
      <div className="flex gap-2 px-3 py-2">
        {/* Inputs */}
        <div className="flex flex-1 flex-col gap-1.5">
          {node.inputs.map((port) => (
            <div key={port.id} className="flex items-center gap-2">
              <div
                className={`h-3 w-3 shrink-0 cursor-crosshair rounded-full border-2 ${
                  port.kind === "exec"
                    ? "border-white bg-white/90"
                    : "border-[#89b4fa] bg-[#89b4fa]/60"
                }`}
                onMouseDown={(e) => onPortMouseDown(e, port.id, false)}
                onMouseUp={(e) => onPortMouseUp(e, port.id, false)}
              />
              <span className="text-[10px] text-[#a6adc8]">{port.label}</span>
            </div>
          ))}
        </div>

        {/* Outputs */}
        <div className="flex flex-col items-end gap-1.5">
          {node.outputs.map((port) => (
            <div key={port.id} className="flex items-center gap-2">
              <span className="text-[10px] text-[#a6adc8]">{port.label}</span>
              <div
                className={`h-3 w-3 shrink-0 cursor-crosshair rounded-full border-2 ${
                  port.kind === "exec"
                    ? "border-white bg-white/90"
                    : "border-[#89b4fa] bg-[#89b4fa]/60"
                }`}
                onMouseDown={(e) => onPortMouseDown(e, port.id, true)}
                onMouseUp={(e) => onPortMouseUp(e, port.id, true)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Params */}
      {Object.keys(node.params).length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-slate-700/50 px-3 pb-2 pt-1.5">
          {Object.entries(node.params).map(([k, v]) => (
            <div key={k} className="flex justify-between text-[10px]">
              <span className="text-[#6c7086]">{getNodeParamDisplayName(k)}</span>
              <span className="font-mono text-[#cdd6f4]">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EmptyStateOverlayProps {
  onApplyTemplate: (template: QuickActionTemplate) => void;
  selectedEntityLabel?: string | null;
  templates: QuickActionTemplate[];
  roleHint?: string | null;
}

function EmptyStateOverlay({
  onApplyTemplate,
  selectedEntityLabel,
  templates,
  roleHint,
}: EmptyStateOverlayProps) {
  return (
    <div
      data-testid="nodegraph-empty-overlay"
      className="absolute inset-0 z-10 flex items-center justify-center bg-[#11111b]/60 px-6 py-8"
    >
      <div className="w-full max-w-6xl rounded-2xl border border-dashed border-[#45475a] bg-[#181825]/95 p-6 shadow-2xl backdrop-blur-sm">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#89b4fa]">
            Guided Empty State
          </p>
          <h2 className="text-xl font-semibold text-[#cdd6f4]">
            Comece o primeiro fluxo sem precisar descobrir a paleta inteira
          </h2>
          <p className="max-w-3xl text-sm text-[#a6adc8]">
            Escolha um atalho para gerar um grafo base com nos ja conectados. Depois voce pode ajustar os parametros,
            trocar nos e expandir o fluxo pela paleta lateral.
          </p>
          {selectedEntityLabel && (
            <p className="max-w-3xl text-xs text-[#89b4fa]" data-testid="nodegraph-empty-target-hint">
              Os atalhos vao usar <span className="font-semibold text-[#cdd6f4]">{selectedEntityLabel}</span> como
              alvo principal quando fizer sentido para o fluxo.
            </p>
          )}
          {roleHint ? (
            <p className="max-w-3xl text-[10px] text-[#94e2d5]" data-testid="nodegraph-empty-role-order-hint">
              Ordenacao por papel importado: <span className="font-mono font-semibold">{roleHint}</span> (heuristica
              — revise o primeiro cartao sugerido antes de aplicar).
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              data-testid={`nodegraph-template-${template.id}`}
              onClick={() => onApplyTemplate(template)}
              className="flex h-full flex-col rounded-xl border border-[#313244] bg-[#11111b]/90 p-4 text-left transition-colors hover:border-[#89b4fa]/60 hover:bg-[#1e1e2e]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                Quick Action
              </span>
              <span className="mt-2 text-sm font-semibold text-[#cdd6f4]">{template.actionLabel}</span>
              <span className="mt-2 text-xs leading-5 text-[#a6adc8]">{template.summary}</span>
              <span className="mt-3 text-[10px] leading-4 text-[#6c7086]">{template.hardwareNote}</span>
            </button>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-[#6c7086]">
          Esses atalhos usam somente nos ja suportados no pipeline atual. O objetivo aqui e acelerar descoberta, nao
          criar um fluxo paralelo.
        </p>
      </div>
    </div>
  );
}

// ── Main NodeGraph Editor ─────────────────────────────────────────────────────

export default function NodeGraphEditor() {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
  const activeScene = useEditorStore((state) => state.activeScene);
  const activeSceneSource = useEditorStore((state) => state.activeSceneSource);
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
  const setSelectedEntityId = useEditorStore((state) => state.setSelectedEntityId);
  const setActiveWorkspace = useEditorStore((state) => state.setActiveWorkspace);
  const setActiveViewportTab = useEditorStore((state) => state.setActiveViewportTab);
  const updateEntity = useEditorStore((state) => state.updateEntity);
  const logMessage = useEditorStore((state) => state.logMessage);
  const selectedEntity =
    selectedEntityId && !selectedEntityId.startsWith("layer::")
      ? activeScene?.entities.find((entity) => entity.entity_id === selectedEntityId) ?? null
      : null;
  const [graph, setGraph] = useState<NodeGraph>(() => cloneGraph(EMPTY_GRAPH));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNode: string; fromPort: string; x: number; y: number } | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [viewOffset, setViewOffset] = useState<ViewOffset>({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [guidedCommentary, setGuidedCommentary] = useState<GuidedFlowCommentary | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const hydratingGraphRef = useRef(true);
  const lastPersistedGraphRef = useRef(serializeNodeGraph(INITIAL_GRAPH));

  useEffect(() => {
    let cancelled = false;
    const resetFromGraph = (nextGraph: NodeGraph) => {
      if (cancelled) {
        return;
      }
      hydratingGraphRef.current = true;
      setGraph(nextGraph);
      setSelectedId(null);
      setDragging(null);
      setPendingEdge(null);
      setViewOffset({ x: 0, y: 0 });
      setGuidedCommentary(null);
      lastPersistedGraphRef.current = serializeNodeGraph(nextGraph);
    };
    const entityGraph = selectedEntity?.components.logic?.graph;
    const parsedGraph = deserializeNodeGraph(entityGraph);
    if (parsedGraph.nodes.length > 0 || !selectedEntity?.components.logic?.graph_ref) {
      resetFromGraph(parsedGraph);
      return () => {
        cancelled = true;
      };
    }
    if (!activeProjectDir || !activeSceneSource) {
      resetFromGraph(parsedGraph);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const resolved = await resolveScenePrefabs(activeProjectDir, activeSceneSource);
        if (!resolved.ok) {
          resetFromGraph(parsedGraph);
          return;
        }
        const resolvedScene = parseSceneJson(resolved.scene_json);
        const resolvedEntity = resolvedScene?.entities.find(
          (entity) => entity.entity_id === selectedEntity.entity_id
        );
        const hydrated = deserializeNodeGraph(resolvedEntity?.components.logic?.graph);
        resetFromGraph(hydrated);
      } catch {
        resetFromGraph(parsedGraph);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectDir, activeSceneSource, selectedEntity]);

  useEffect(() => {
    function measureCanvas() {
      const rect = canvasRef.current?.getBoundingClientRect();
      setCanvasSize({
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      });
    }

    measureCanvas();
    window.addEventListener("resize", measureCanvas);
    return () => window.removeEventListener("resize", measureCanvas);
  }, []);

  useEffect(() => {
    if (!selectedEntity || !activeProjectDir) {
      return;
    }

    if (hydratingGraphRef.current) {
      hydratingGraphRef.current = false;
      return;
    }

    const serializedGraph = serializeNodeGraph(graph);
    if (serializedGraph === lastPersistedGraphRef.current) {
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const latestState = useEditorStore.getState();
      const entity = latestState.activeScene?.entities.find(
        (item) => item.entity_id === selectedEntity.entity_id
      );
      if (!entity) {
        return;
      }

      updateEntity(selectedEntity.entity_id, {
        components: {
          ...entity.components,
          logic: {
            ...(entity.components.logic ?? {}),
            graph: serializedGraph,
            graph_origin: entity.components.logic?.graph_ref ? "user_edited_ref" : entity.components.logic?.graph_origin,
          },
        },
      });
      lastPersistedGraphRef.current = serializedGraph;
      void persistActiveScene(activeProjectDir, "Logic");
    }, 600);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeProjectDir, graph, selectedEntity, updateEntity]);

  // ── Drag node ──────────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).classList.contains("cursor-crosshair")) return;
    setSelectedId(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId)!;
    setDragging({
      nodeId,
      offsetX: e.clientX - (node.x + viewOffset.x),
      offsetY: e.clientY - (node.y + viewOffset.y),
    });
  }, [graph.nodes, viewOffset.x, viewOffset.y]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === dragging.nodeId
            ? {
                ...n,
                x: e.clientX - viewOffset.x - dragging.offsetX,
                y: e.clientY - viewOffset.y - dragging.offsetY,
              }
            : n
        ),
      }));
    }
    if (pendingEdge) {
      setPendingEdge((p) => p ? { ...p, x: e.clientX, y: e.clientY } : null);
    }
  }, [dragging, pendingEdge, viewOffset.x, viewOffset.y]);

  const onMouseUp = useCallback(() => {
    setDragging(null);
    setPendingEdge(null);
  }, []);

  // ── Connect ports ──────────────────────────────────────────────────────────
  const onPortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => {
    e.stopPropagation();
    if (isOutput) {
      setPendingEdge({ fromNode: nodeId, fromPort: portId, x: e.clientX, y: e.clientY });
    }
  }, []);

  const onPortMouseUp = useCallback((e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => {
    e.stopPropagation();
    if (!pendingEdge || isOutput) return;
    if (pendingEdge.fromNode === nodeId) return; // no self-loop
    const edge: NodeEdge = {
      id: newEdgeId(),
      fromNode: pendingEdge.fromNode,
      fromPort: pendingEdge.fromPort,
      toNode: nodeId,
      toPort: portId,
    };
    setGraph((g) => ({ ...g, edges: [...g.edges, edge] }));
    setPendingEdge(null);
    logMessage("info", `Conexão criada: ${edge.fromNode}:${edge.fromPort} → ${edge.toNode}:${edge.toPort}`);
  }, [pendingEdge, logMessage]);

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedEntitySourceRefs = useMemo(
    () => resolveEntitySourceRefs(selectedEntity),
    [selectedEntity]
  );
  const selectedNodeTargetEntity = useMemo(() => {
    if (!selectedNode || !activeScene?.entities.length) {
      return null;
    }

    const candidateKeys = Array.from(
      new Set(
        Object.values(selectedNode.params)
          .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
          .map((value) => normalizeGraphEntityKey(value))
          .filter((value) => value.length > 0)
      )
    );
    if (candidateKeys.length === 0) {
      return null;
    }

    return (
      activeScene.entities.find((entity) => {
        const keys = [
          normalizeGraphEntityKey(entity.entity_id),
          normalizeGraphEntityKey(getEntityDisplayName(entity)),
          normalizeGraphEntityKey(entity.display_name ?? ""),
        ];
        return candidateKeys.some((candidate) => keys.includes(candidate));
      }) ?? null
    );
  }, [activeScene?.entities, selectedNode]);

  const quickActionContext = useMemo<QuickActionContext>(() => {
    const selectedEntityIdValue = selectedEntity?.entity_id ?? null;
    return {
      selectedEntityId: selectedEntityIdValue,
      selectedEntityLabel: selectedEntity ? getEntityDisplayName(selectedEntity) : null,
      otherEntityId:
        activeScene?.entities.find((entity) => entity.entity_id !== selectedEntityIdValue)?.entity_id ?? null,
    };
  }, [activeScene, selectedEntity]);
  const graphOriginLabel = selectedEntity?.components.logic?.graph_origin;
  const importedSemantics = selectedEntity?.components.logic?.imported_semantics;

  const orderedQuickActionTemplates = useMemo(() => {
    const role = importedSemantics?.entity_role?.trim();
    const pref = role ? QUICK_ACTION_PREF_BY_ENTITY_ROLE[role] : undefined;
    const list = [...QUICK_ACTION_TEMPLATES];
    if (pref) {
      list.sort((a, b) => {
        if (a.id === pref) {
          return -1;
        }
        if (b.id === pref) {
          return 1;
        }
        return 0;
      });
    }
    return list;
  }, [importedSemantics?.entity_role]);

  const handleOpenSourcePath = useCallback(async (relativePath: string | null | undefined) => {
    if (!activeProjectDir) {
      logMessage("warn", "[NodeGraph] Abra um projeto antes de abrir a fonte.");
      return;
    }
    const normalizedPath = relativePath?.trim() ?? "";
    if (!normalizedPath) {
      logMessage("warn", "[NodeGraph] Nenhum source_paths / external_source_refs disponivel para esta entidade.");
      return;
    }
    try {
      const result = await openProjectSourcePath(activeProjectDir, normalizedPath);
      if (!result?.ok) {
        throw new Error(
          result?.message ??
            "Falha ao abrir no editor externo. Configure um editor de texto nas preferencias do host ou abra o ficheiro manualmente."
        );
      }
      logMessage("info", `[NodeGraph] Fonte aberta: ${normalizedPath}`);
    } catch (error) {
      logMessage(
        "error",
        `[NodeGraph] Nao foi possivel abrir '${normalizedPath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [activeProjectDir, logMessage]);
  const handleFocusSelectedEntityInScene = useCallback(() => {
    if (!selectedEntity) {
      return;
    }
    setSelectedEntityId(selectedEntity.entity_id);
    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    logMessage("info", `[NodeGraph] Foco retornado para a cena: ${getEntityDisplayName(selectedEntity)}.`);
  }, [
    logMessage,
    selectedEntity,
    setActiveViewportTab,
    setActiveWorkspace,
    setSelectedEntityId,
  ]);
  const handleFocusSelectedNodeTarget = useCallback(() => {
    if (!selectedNodeTargetEntity) {
      logMessage("warn", "[NodeGraph] O no atual nao aponta para uma entidade rastreavel na cena.");
      return;
    }
    setSelectedEntityId(selectedNodeTargetEntity.entity_id);
    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    logMessage(
      "info",
      `[NodeGraph] No atual focado na cena: ${getEntityDisplayName(selectedNodeTargetEntity)}.`
    );
  }, [
    logMessage,
    selectedNodeTargetEntity,
    setActiveViewportTab,
    setActiveWorkspace,
    setSelectedEntityId,
  ]);

  // ── Add node from palette ──────────────────────────────────────────────────
  const addNode = useCallback((type: NodeType) => {
    const node = makeNode(type, 200, 200);
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    logMessage("info", `No adicionado: ${getNodeDisplayName(type)}`);
  }, [logMessage]);

  const applyQuickActionTemplate = useCallback((template: QuickActionTemplate) => {
    const nextGraph = template.buildGraph(quickActionContext);
    setGraph(nextGraph);
    setSelectedId(nextGraph.nodes[0]?.id ?? null);
    setDragging(null);
    setPendingEdge(null);
    setViewOffset({ x: 0, y: 0 });
    setGuidedCommentary({
      title: template.title,
      summary: template.summary,
      comments: template.comments,
      hardwareNote: template.hardwareNote,
      limitation: template.limitation,
    });
    const contextSuffix = quickActionContext.selectedEntityLabel
      ? ` para ${quickActionContext.selectedEntityLabel}`
      : "";
    logMessage("info", `Fluxo guiado aplicado: ${template.title}${contextSuffix}`);
  }, [logMessage, quickActionContext]);
  const appendQuickActionTemplate = useCallback((template: QuickActionTemplate) => {
    const quickGraph = template.buildGraph(quickActionContext);
    const result = appendQuickActionGraph(graph, quickGraph);
    const firstNewNodeId = result.appendedNodeIds[0] ?? quickGraph.nodes[0]?.id ?? null;
    const firstNewNode =
      (firstNewNodeId
        ? result.graph.nodes.find((node) => node.id === firstNewNodeId)
        : null) ?? null;

    setGraph(result.graph);
    setSelectedId(firstNewNodeId);
    setDragging(null);
    setPendingEdge(null);
    if (firstNewNode) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const width = rect?.width ?? canvasSize.width;
      const height = rect?.height ?? canvasSize.height;
      const desiredX = Math.max(FOCUS_PADDING, width / 2 - NODE_CARD_WIDTH / 2);
      const desiredY = Math.max(FOCUS_PADDING, height / 2 - NODE_CARD_HEIGHT / 2);
      setViewOffset({
        x: desiredX - firstNewNode.x,
        y: desiredY - firstNewNode.y,
      });
    }
    setGuidedCommentary({
      title: `${template.title} (anexado)`,
      summary: template.summary,
      comments: [
        "O bloco foi anexado ao grafo atual sem substituir o fluxo existente.",
        ...template.comments,
      ],
      hardwareNote: template.hardwareNote,
      limitation: template.limitation,
    });
    const contextSuffix = quickActionContext.selectedEntityLabel
      ? ` para ${quickActionContext.selectedEntityLabel}`
      : "";
    logMessage(
      "info",
      `[NodeGraph] Bloco guiado anexado: ${template.title}${contextSuffix}. Use 'Encadear exec (layout)' ou conecte manualmente se quiser ligar o fluxo novo ao existente.`
    );
  }, [canvasSize.height, canvasSize.width, graph, logMessage, quickActionContext]);

  const applyExecChainFromLayout = useCallback(() => {
    setGraph((current) => {
      const before = current.edges.length;
      const next = appendExecChainEdgesFromLayout(current);
      const added = next.edges.length - before;
      if (added === 0) {
        logMessage(
          "warn",
          "[NodeGraph] Encadeamento layout: nenhuma aresta nova (portas exec padrao ausentes, grafo pequeno ou ligacoes ja existentes)."
        );
        return current;
      }
      logMessage(
        "info",
        `[NodeGraph] Encadeamento layout: ${added} aresta(s) exec na ordem y→x. Revise fluxos condicionais e nos sem entrada exec.`
      );
      return next;
    });
  }, [logMessage]);

  // ── Delete selected node ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setGraph((g) => ({
          nodes: g.nodes.filter((n) => n.id !== selectedId),
          edges: g.edges.filter((e) => e.fromNode !== selectedId && e.toNode !== selectedId),
        }));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // ── Edge SVG path ─────────────────────────────────────────────────────────
  // Simplified: bezier between node positions (port positions approximated)
  function edgePath(fromNode: GraphNode, toNode: GraphNode): string {
    const x1 = fromNode.x + viewOffset.x + NODE_CARD_WIDTH; // right edge
    const y1 = fromNode.y + viewOffset.y + 24;
    const x2 = toNode.x + viewOffset.x;                     // left edge
    const y2 = toNode.y + viewOffset.y + 24;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  const graphSummary = useMemo(() => summarizeNodeGraph(graph), [graph]);
  const graphValidation = useMemo(() => validateNodeGraph(graph), [graph]);
  const graphValidationPreview = [...graphValidation.errors, ...graphValidation.warnings].slice(0, 3);
  const miniMapNodes = useMemo(
    () => buildNodeMiniMap(graph, MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_PADDING),
    [graph]
  );

  const graphBounds = useMemo(() => getNodeGraphBounds(graph), [graph]);

  const miniMapViewport = useMemo(() => {
    if (!graphBounds) {
      return null;
    }

    const innerWidth = Math.max(1, MINIMAP_WIDTH - MINIMAP_PADDING * 2);
    const innerHeight = Math.max(1, MINIMAP_HEIGHT - MINIMAP_PADDING * 2);
    const graphWidth = Math.max(1, graphBounds.maxX - graphBounds.minX);
    const graphHeight = Math.max(1, graphBounds.maxY - graphBounds.minY);
    const scale = Math.min(innerWidth / graphWidth, innerHeight / graphHeight);

    const viewportLeft = MINIMAP_PADDING + Math.max(0, -viewOffset.x - graphBounds.minX) * scale;
    const viewportTop = MINIMAP_PADDING + Math.max(0, -viewOffset.y - graphBounds.minY) * scale;
    const viewportWidth = Math.min(innerWidth, Math.max(28, canvasSize.width * scale));
    const viewportHeight = Math.min(innerHeight, Math.max(20, canvasSize.height * scale));

    return {
      left: viewportLeft,
      top: viewportTop,
      width: viewportWidth,
      height: viewportHeight,
    };
  }, [canvasSize.height, canvasSize.width, graphBounds, viewOffset.x, viewOffset.y]);

  const focusNode = useCallback((nodeId: string) => {
    const targetNode = graph.nodes.find((node) => node.id === nodeId);
    if (!targetNode) {
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    const width = rect?.width ?? canvasSize.width;
    const height = rect?.height ?? canvasSize.height;

    const desiredX = Math.max(FOCUS_PADDING, width / 2 - NODE_CARD_WIDTH / 2);
    const desiredY = Math.max(FOCUS_PADDING, height / 2 - NODE_CARD_HEIGHT / 2);

    setViewOffset({
      x: desiredX - targetNode.x,
      y: desiredY - targetNode.y,
    });
    setSelectedId(nodeId);
  }, [canvasSize.height, canvasSize.width, graph.nodes]);

  const focusEntryNode = useCallback(() => {
    const firstEntryNode = graphSummary.entryNodeIds[0];
    if (!firstEntryNode) {
      return;
    }
    focusNode(firstEntryNode);
  }, [focusNode, graphSummary.entryNodeIds]);

  const focusFirstDisconnectedNode = useCallback(() => {
    const firstDisconnectedNode = graphSummary.disconnectedNodeIds[0];
    if (!firstDisconnectedNode) {
      return;
    }
    focusNode(firstDisconnectedNode);
  }, [focusNode, graphSummary.disconnectedNodeIds]);

  const addEntryNode = useCallback(() => {
    if (graphSummary.entryNodeIds.length > 0) {
      return;
    }

    const anchorNode = selectedNode ?? graph.nodes[0] ?? null;
    const startNode = makeNode(
      "event_start",
      anchorNode ? Math.max(40, anchorNode.x - 220) : 140,
      anchorNode ? anchorNode.y : 160
    );

    setGraph((currentGraph) => ({
      ...currentGraph,
      nodes: [...currentGraph.nodes, startNode],
    }));
    setSelectedId(startNode.id);
    logMessage("info", "No de entrada adicionado para orientar o fluxo atual.");
  }, [graph.nodes, graphSummary.entryNodeIds.length, logMessage, selectedNode]);

  const searchLower = paletteSearch.trim().toLowerCase();
  const filteredGroups = searchLower
    ? NODE_PALETTE_GROUPS.map((g) => ({
        ...g,
        types: g.types.filter(
          (t) =>
            getNodeDisplayName(t).toLowerCase().includes(searchLower) ||
            t.toLowerCase().includes(searchLower)
        ),
      })).filter((g) => g.types.length > 0)
    : NODE_PALETTE_GROUPS;

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#11111b]">

      {/* ── Palette sidebar ── */}
      <div className="flex w-40 shrink-0 flex-col overflow-x-hidden border-r border-[#313244] bg-[#181825]">
        <div className="shrink-0 border-b border-[#313244] p-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#6c7086]">
              &#x1f50d;
            </span>
            <input
              type="search"
              placeholder="Buscar nó..."
              value={paletteSearch}
              onChange={(e) => setPaletteSearch(e.target.value)}
              className="w-full rounded border border-[#313244] bg-[#11111b] py-1 pl-7 pr-2 text-[10px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none"
            />
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
          <p className="mb-1 select-none px-1 text-[10px] text-[#45475a]">NÓS</p>
          {filteredGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.label);
            return (
              <div key={group.label} className="mb-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-[#6c7086] transition-colors hover:text-[#a6adc8]"
                >
                  <span className="text-[9px]">{isCollapsed ? "\u25b8" : "\u25be"}</span>
                  <span>{group.icon}</span>
                  <span>{group.label}</span>
                </button>
                {!isCollapsed &&
                  group.types.map((type) => (
                    <button
                      key={type}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-[#a6adc8] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] disabled:cursor-not-allowed disabled:opacity-40"
                      onMouseDown={() => addNode(type)}
                      disabled={!selectedEntity}
                    >
                      <span className="text-[12px] opacity-80">
                        {NODE_PALETTE_GROUPS.find((g) => g.types.includes(type))?.icon ?? "\u2699\ufe0f"}
                      </span>
                      <span className="min-w-0 truncate">{getNodeDisplayName(type)}</span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
        <div className="mt-auto shrink-0 border-t border-[#313244] p-2">
          <p className="select-none px-1 text-[10px] text-[#45475a]">
            {selectedEntity ? "Autosave 600ms no LogicComponent.graph" : "Selecione uma entidade para editar"}
          </p>
          {selectedEntity?.components.logic?.graph_ref ? (
            <p className="mt-1 select-none px-1 text-[10px] text-[#45475a]">
              Origem do grafo: {graphOriginLabel === "user_edited_ref" ? "editado no editor" : "importado do graph_ref"}
            </p>
          ) : null}
          <p className="mt-1 select-none px-1 text-[10px] text-[#45475a]">
            Dica: arraste da saída para a entrada para conectar.
          </p>
          <p className="select-none px-1 text-[10px] text-[#45475a]">Del = remover nó</p>
          {selectedEntity?.components.logic?.graph_ref && graph.nodes.length === 0 ? (
            <p className="mt-1 px-1 text-[9px] leading-snug text-[#f9e2af]">
              graph_ref {selectedEntity.components.logic.graph_ref}: grafo indisponivel para hidratacao.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        data-testid="nodegraph-canvas"
        className="relative flex-1 overflow-hidden cursor-default"
        style={{
          backgroundImage:
            "radial-gradient(circle, #313244 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onMouseDown={() => setSelectedId(null)}
      >
        {!selectedEntity && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#11111b]/80">
            <p className="max-w-xs text-center text-xs text-[#6c7086]">
              Selecione uma entidade na hierarquia para carregar ou criar o `LogicComponent.graph`.
            </p>
          </div>
        )}

        {selectedEntity && (
          <div
            data-testid="nodegraph-overview"
            className="absolute left-3 top-3 z-10 flex max-w-[19rem] flex-col gap-2 rounded-xl border border-[#313244] bg-[#181825]/95 px-3 py-2 text-[10px] shadow-lg backdrop-blur-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#89b4fa]">
                  Logic Context
                </p>
                <p className="truncate text-[11px] font-semibold text-[#cdd6f4]">
                  {getEntityDisplayName(selectedEntity)}
                </p>
                <p className="truncate text-[#6c7086]">entity_id: {selectedEntity.entity_id}</p>
              </div>
              <span className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a6adc8]">
                {graphSummary.totalNodes} nos
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="rounded bg-[#11111b] px-2 py-1 text-[#a6adc8]">
                Conexoes: <span className="font-semibold text-[#cdd6f4]">{graphSummary.totalEdges}</span>
              </span>
              <span className="rounded bg-[#11111b] px-2 py-1 text-[#a6adc8]">
                Eventos: <span className="font-semibold text-[#cdd6f4]">{graphSummary.entryNodeIds.length}</span>
              </span>
              <span className="rounded bg-[#11111b] px-2 py-1 text-[#a6adc8]">
                Soltos: <span className="font-semibold text-[#cdd6f4]">{graphSummary.disconnectedNodeIds.length}</span>
              </span>
              <span className="rounded bg-[#11111b] px-2 py-1 text-[#a6adc8]">
                Validacao:{" "}
                <span className={graphValidation.errors.length ? "font-semibold text-[#f38ba8]" : "font-semibold text-[#a6e3a1]"}>
                  {graphValidation.errors.length}
                </span>
                <span className="text-[#6c7086]">/</span>
                <span className="font-semibold text-[#f9e2af]">{graphValidation.warnings.length}</span>
              </span>
            </div>

            <div
              data-testid="nodegraph-scene-bridge"
              className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1.5 text-[10px] leading-snug text-[#cdd6f4]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                    Logic -&gt; Scene
                  </p>
                  <p className="mt-1 truncate">
                    {getEntityDisplayName(selectedEntity)} ·{" "}
                    <span className="font-mono text-[#6c7086]">{selectedEntity.entity_id}</span>
                  </p>
                  <p className="mt-1 text-[#7f849c]">
                    {selectedEntitySourceRefs.length > 0
                      ? `${selectedEntitySourceRefs.length} fonte(s) rastreavel(eis)`
                      : "Sem fonte rastreavel: navegue pelo Inspector se houver contexto externo."}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="nodegraph-bridge-back-scene"
                  onClick={handleFocusSelectedEntityInScene}
                  className="shrink-0 rounded border border-[#94e2d5]/40 bg-[#94e2d5]/10 px-2 py-1 text-[9px] font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20"
                >
                  Focar objeto
                </button>
              </div>
            </div>

            {graphSummary.totalNodes > 0 && graphSummary.entryNodeIds.length === 0 && (
              <p className="text-[#fab387]">
                Grafo sem evento de entrada: adicione um no de evento para iniciar o fluxo.
              </p>
            )}
            {graphSummary.disconnectedNodeIds.length > 0 && graphSummary.totalNodes > 1 && (
              <p className="text-[#f9e2af]">
                {graphSummary.disconnectedNodeIds.length} no(s) ainda sem conexao no fluxo atual.
              </p>
            )}
            {graphValidationPreview.length > 0 && (
              <div
                data-testid="nodegraph-validation-preview"
                className="rounded border border-[#45475a] bg-[#11111b] px-2 py-1.5 text-[10px] leading-snug"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">
                  Validador do grafo
                </p>
                <ul className="mt-1 space-y-1">
                  {graphValidationPreview.map((issue) => (
                    <li
                      key={`${issue.code}-${issue.edgeId ?? issue.nodeId ?? issue.message}`}
                      className={issue.severity === "error" ? "text-[#f38ba8]" : "text-[#f9e2af]"}
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {importedSemantics ? (
              <div className="rounded border border-[#45475a] bg-[#11111b] px-2 py-1.5 text-[10px] leading-snug text-[#bac2de]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#94e2d5]">
                  Inferencia importada (heuristica)
                </p>
                <p className="mt-1">
                  Papel: <span className="font-mono text-[#f9e2af]">{importedSemantics.entity_role ?? "—"}</span>
                  {" · "}
                  Confianca:{" "}
                  <span className="font-mono text-[#cba6f7]">{importedSemantics.confidence ?? "—"}</span>
                </p>
                {importedSemantics.role_reason ? (
                  <p className="mt-1 line-clamp-2 text-[#6c7086]" title={importedSemantics.role_reason}>
                    Motivo: {importedSemantics.role_reason}
                  </p>
                ) : null}
                {importedSemantics.driver_functions?.length ? (
                  <p className="mt-1 text-[9px] text-[#7f849c]">
                    Drivers:{" "}
                    <span className="font-mono text-[#cdd6f4]">
                      {importedSemantics.driver_functions.join(", ")}
                    </span>
                  </p>
                ) : null}
                {selectedEntitySourceRefs.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {selectedEntitySourceRefs.map((relativePath, index) => (
                      <button
                        key={`${relativePath}-${index}`}
                        type="button"
                        data-testid={
                          index === 0
                            ? "nodegraph-open-primary-source"
                            : `nodegraph-open-source-${index}`
                        }
                        onClick={() => void handleOpenSourcePath(relativePath)}
                        className="w-full rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-left font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20"
                      >
                        Abrir fonte{selectedEntitySourceRefs.length > 1 ? ` (${index + 1})` : ""}
                        <span className="mt-0.5 block truncate font-mono text-[9px] font-normal text-[#6c7086]">
                          {relativePath}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[9px] text-[#6c7086]">
                    Sem caminho de fonte rastreavel: use o Inspector ou o doador para localizar o TU manualmente.
                  </p>
                )}
              </div>
            ) : null}
            {graph.nodes.length > 0 ? (
              <div className="rounded border border-[#313244] bg-[#11111b] px-2 py-1.5 text-[10px] leading-snug text-[#bac2de]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a6e3a1]">
                  Atalhos construtivos
                </p>
                <p className="mt-1 text-[#94a3b8]">
                  Anexe um bloco coerente com o papel atual sem substituir o grafo que ja esta em edicao.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {orderedQuickActionTemplates.slice(0, 3).map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      data-testid={`nodegraph-append-template-${template.id}`}
                      onClick={() => appendQuickActionTemplate(template)}
                      className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20"
                      title={template.summary}
                    >
                      + {template.actionLabel}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="nodegraph-focus-entry"
                onClick={focusEntryNode}
                disabled={graphSummary.entryNodeIds.length === 0}
                className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Ir para Inicio
              </button>
              {graphSummary.entryNodeIds.length === 0 && graphSummary.totalNodes > 0 && (
                <button
                  type="button"
                  data-testid="nodegraph-add-entry"
                  onClick={addEntryNode}
                  className="rounded border border-[#fab387]/40 bg-[#fab387]/10 px-2 py-1 font-semibold text-[#fab387] transition-colors hover:bg-[#fab387]/20"
                >
                  Adicionar Inicio
                </button>
              )}
              <button
                type="button"
                data-testid="nodegraph-focus-selected"
                onClick={() => selectedNode && focusNode(selectedNode.id)}
                disabled={!selectedNode}
                className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 font-semibold text-[#cdd6f4] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Centralizar Selecao
              </button>
              <button
                type="button"
                data-testid="nodegraph-reset-view"
                onClick={() => setViewOffset({ x: 0, y: 0 })}
                className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 font-semibold text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
              >
                Resetar Vista
              </button>
              <button
                type="button"
                data-testid="nodegraph-chain-exec-layout"
                onClick={applyExecChainFromLayout}
                disabled={graph.nodes.length < 2}
                title="Liga saida exec padrao para entrada exec do proximo no na ordem de layout (y, depois x). Atalho de autoracao — revise ramos condicionais."
                className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Encadear exec (layout)
              </button>
              <button
                type="button"
                onClick={handleFocusSelectedEntityInScene}
                className="rounded border border-[#94e2d5]/40 bg-[#94e2d5]/10 px-2 py-1 font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20"
              >
                Logica -&gt; Objeto
              </button>
              <button
                type="button"
                data-testid="nodegraph-focus-node-target"
                onClick={handleFocusSelectedNodeTarget}
                disabled={!selectedNodeTargetEntity}
                className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2 py-1 font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                No -&gt; Objeto alvo
              </button>
              {graphSummary.disconnectedNodeIds.length > 0 && graphSummary.totalNodes > 1 && (
                <button
                  type="button"
                  data-testid="nodegraph-focus-disconnected"
                  onClick={focusFirstDisconnectedNode}
                  className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2 py-1 font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20"
                >
                  Ir para No Solto
                </button>
              )}
            </div>
          </div>
        )}

        {/* SVG edges */}
        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {graph.edges.map((edge) => {
            const from = graph.nodes.find((n) => n.id === edge.fromNode);
            const to   = graph.nodes.find((n) => n.id === edge.toNode);
            if (!from || !to) return null;
            return (
              <path
                key={edge.id}
                d={edgePath(from, to)}
                fill="none"
                stroke="#a6e3a1"
                strokeWidth={1.5}
                strokeOpacity={0.7}
              />
            );
          })}
          {/* Pending edge preview */}
          {pendingEdge && (() => {
            const from = graph.nodes.find((n) => n.id === pendingEdge.fromNode);
            if (!from) return null;
            const rect = canvasRef.current?.getBoundingClientRect();
            const ox = rect ? pendingEdge.x - rect.left : pendingEdge.x;
            const oy = rect ? pendingEdge.y - rect.top  : pendingEdge.y;
            const x1 = from.x + viewOffset.x + NODE_CARD_WIDTH;
            const y1 = from.y + viewOffset.y + 24;
            return (
              <path
                d={`M ${x1} ${y1} C ${(x1+ox)/2} ${y1}, ${(x1+ox)/2} ${oy}, ${ox} ${oy}`}
                fill="none"
                stroke="#cba6f7"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            );
          })()}
        </svg>

        {/* Nodes */}
        {graph.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            screenX={node.x + viewOffset.x}
            screenY={node.y + viewOffset.y}
            selected={node.id === selectedId}
            onMouseDown={(e) => onNodeMouseDown(e, node.id)}
            onPortMouseDown={(e, portId, isOutput) => onPortMouseDown(e, node.id, portId, isOutput)}
            onPortMouseUp={(e, portId, isOutput) => onPortMouseUp(e, node.id, portId, isOutput)}
          />
        ))}

        {selectedEntity && graph.nodes.length > 0 && (
          <div
            data-testid="nodegraph-minimap"
            className="absolute bottom-3 right-3 z-10 rounded-xl border border-[#313244] bg-[#181825]/95 p-2 shadow-lg backdrop-blur-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-3 text-[9px] uppercase tracking-[0.16em] text-[#6c7086]">
              <span>MiniMapa</span>
              <span>{graph.nodes.length} nos</span>
            </div>
            <div
              className="relative overflow-hidden rounded border border-[#313244] bg-[#0b1020]"
              style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
            >
              {miniMapViewport && (
                <div
                  className="absolute rounded border border-[#89b4fa]/70 bg-[#89b4fa]/10"
                  style={{
                    left: miniMapViewport.left,
                    top: miniMapViewport.top,
                    width: miniMapViewport.width,
                    height: miniMapViewport.height,
                  }}
                />
              )}
              {miniMapNodes.map((node) => (
                <button
                  key={`minimap-${node.id}`}
                  type="button"
                  data-testid={`nodegraph-minimap-node-${node.id}`}
                  title={getNodeDisplayName(node.type)}
                  onClick={() => focusNode(node.id)}
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-transform hover:scale-125 ${
                    node.id === selectedId
                      ? "border-[#f9e2af] bg-[#f9e2af]"
                      : EVENT_NODE_TYPES.includes(node.type)
                        ? "border-[#a6e3a1] bg-[#a6e3a1]/90"
                        : "border-[#cba6f7] bg-[#cba6f7]/90"
                  }`}
                  style={{ left: node.x, top: node.y }}
                />
              ))}
            </div>
            <p className="mt-2 text-[9px] text-[#6c7086]">
              Clique em um ponto para navegar sem mover o layout salvo.
            </p>
          </div>
        )}

        {selectedEntity && guidedCommentary && graph.nodes.length > 0 && (
          <div
            data-testid="nodegraph-guided-commentary"
            className="absolute bottom-3 left-3 z-10 max-w-[24rem] rounded-xl border border-[#313244] bg-[#181825]/95 px-4 py-3 text-[11px] shadow-lg backdrop-blur-sm"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#89b4fa]">
              Guided Commentary
            </p>
            <p className="mt-1 text-sm font-semibold text-[#cdd6f4]">{guidedCommentary.title}</p>
            <p className="mt-1 text-[#a6adc8]">{guidedCommentary.summary}</p>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-[#bac2de]">
              {guidedCommentary.comments.map((comment) => (
                <li key={comment}>{comment}</li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] text-[#6c7086]">{guidedCommentary.hardwareNote}</p>
            {guidedCommentary.limitation && (
              <p className="mt-2 text-[10px] text-[#fab387]">{guidedCommentary.limitation}</p>
            )}
          </div>
        )}

        {/* Empty state */}
        {selectedEntity && graph.nodes.length === 0 && (
          <EmptyStateOverlay
            onApplyTemplate={applyQuickActionTemplate}
            selectedEntityLabel={quickActionContext.selectedEntityLabel}
            templates={orderedQuickActionTemplates}
            roleHint={importedSemantics?.entity_role?.trim() || null}
          />
        )}
        {!selectedEntity && graph.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[#313244] text-xs select-none">
              Adicione nós pela paleta a esquerda
            </p>
          </div>
        )}
        {selectedEntity && graph.nodes.length > 1 && graph.edges.length === 0 && (
          <div className="absolute bottom-3 right-3 rounded border border-[#fab387]/40 bg-[#181825]/95 px-3 py-2 text-[10px] text-[#fab387] shadow-lg">
            Grafo sem conexoes: arraste de uma saida para uma entrada para ligar o fluxo.
          </div>
        )}
      </div>
    </div>
  );
}
