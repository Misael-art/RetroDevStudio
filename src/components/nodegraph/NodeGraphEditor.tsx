import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { persistActiveScene } from "../../core/scenePersistence";
import { useEditorStore } from "../../core/store/editorStore";
import { getEntityDisplayName } from "../../core/entityDisplay";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | "event_start"
  | "sprite_move"
  | "sprite_anim"
  | "condition_overlap"
  | "effect_parallax"
  | "effect_raster"
  | "logic_and"
  | "action_sound"
  | "scroll_tilemap"
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
  id: "player_controller" | "enemy_logic" | "timer_event";
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
  "event_vblank",
  "event_hblank",
  "event_dma_done",
];

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
    value === "sprite_move" ||
    value === "sprite_anim" ||
    value === "condition_overlap" ||
    value === "effect_parallax" ||
    value === "effect_raster" ||
    value === "logic_and" ||
    value === "action_sound" ||
    value === "scroll_tilemap" ||
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
    value === "event_vblank" ||
    value === "event_hblank" ||
    value === "event_dma_done"
  );
}

function isGraphNode(value: unknown): value is GraphNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNodeType(value.type) &&
    typeof value.label === "string" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Array.isArray(value.inputs) &&
    value.inputs.every(isNodePort) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isNodePort) &&
    isRecord(value.params)
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
    if (
      !Array.isArray(nodes) ||
      !Array.isArray(edges) ||
      !edges.every(isNodeEdge)
    ) {
      return cloneGraph(EMPTY_GRAPH);
    }

    const hydratedNodes = nodes
      .map((node, index) => hydrateGraphNode(node, index))
      .filter((node): node is GraphNode => node !== null);

    if (hydratedNodes.length !== nodes.length) {
      return cloneGraph(EMPTY_GRAPH);
    }

    return cloneGraph({ nodes: hydratedNodes, edges });
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
  sprite_anim: {
    type: "sprite_anim", label: "Set Animation",
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { target: "player", anim: "idle" },
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
  sprite_move: "Mover Sprite",
  sprite_anim: "Animar Sprite",
  condition_overlap: "Colisao (Overlap)",
  effect_parallax: "Parallax",
  effect_raster: "Efeito Raster",
  logic_and: "E (And)",
  action_sound: "Tocar Som",
  scroll_tilemap: "Rolar Cenario",
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
  dx: "Delta X",
  dy: "Delta Y",
  layer: "Camada",
  offset_x: "Offset X",
  operator: "Operador",
  scanline: "Scanline",
  sfx: "Som",
  speed_x: "Velocidade X",
  speed_y: "Velocidade Y",
  state_name: "Estado",
  target: "Alvo",
  target_state: "Proximo Estado",
  timeline_name: "Timeline",
  value: "Valor",
  var_name: "Variavel",
  x: "X",
  y: "Y",
};

const NODE_PALETTE_GROUPS: Array<{ label: string; icon: string; types: NodeType[] }> = [
  { label: "Eventos", icon: "\u26a1", types: ["event_start", "event_vblank", "event_hblank", "event_dma_done"] },
  { label: "Movimento", icon: "\ud83c\udfc3", types: ["sprite_move", "sprite_anim", "scroll_tilemap", "move_camera"] },
  { label: "Condicoes", icon: "?", types: ["condition_overlap", "condition_compare", "logic_and"] },
  { label: "Som", icon: "\ud83d\udd0a", types: ["action_sound"] },
  { label: "Variaveis", icon: "\ud83d\udcca", types: ["var_set", "var_get", "logic_math"] },
  { label: "Fluxo", icon: "\u2937", types: ["flow_if", "flow_while", "flow_for"] },
  { label: "Estados", icon: "\u2690\ufe0f", types: ["fsm_state", "fsm_transition", "timeline_sequence"] },
  { label: "Efeitos", icon: "\u2728", types: ["effect_parallax", "effect_raster"] },
];

/** Header background por categoria (Blueprints-style) */
const GROUP_HEADER_BG: Record<string, string> = {
  Eventos: "bg-[#722f37]",
  Movimento: "bg-[#1e3a5f]",
  Condicoes: "bg-[#4a4a3a]",
  Som: "bg-[#6b5b2a]",
  Variaveis: "bg-[#4a4a3a]",
  Fluxo: "bg-[#6b5b2a]",
  Estados: "bg-[#5c4a7a]",
  Efeitos: "bg-[#5c4a7a]",
};

function getGroupForType(type: NodeType): string {
  const group = NODE_PALETTE_GROUPS.find((g) => g.types.includes(type));
  return group?.label ?? "Outros";
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
  if (isGraphNode(value)) {
    return {
      ...value,
      inputs: clonePorts(value.inputs),
      outputs: clonePorts(value.outputs),
      params: { ...value.params },
    };
  }

  if (!isRecord(value) || typeof value.id !== "string" || !isNodeType(value.type)) {
    return null;
  }

  const def = NODE_DEFS[value.type];

  return {
    id: value.id,
    type: value.type,
    label: typeof value.label === "string" ? value.label : def.label,
    x: typeof value.x === "number" ? value.x : 40 + index * 200,
    y: typeof value.y === "number" ? value.y : 80,
    inputs:
      Array.isArray(value.inputs) && value.inputs.every(isNodePort)
        ? clonePorts(value.inputs)
        : clonePorts(def.inputs),
    outputs:
      Array.isArray(value.outputs) && value.outputs.every(isNodePort)
        ? clonePorts(value.outputs)
        : clonePorts(def.outputs),
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
];

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
}

function EmptyStateOverlay({
  onApplyTemplate,
  selectedEntityLabel,
}: EmptyStateOverlayProps) {
  return (
    <div
      data-testid="nodegraph-empty-overlay"
      className="absolute inset-0 z-10 flex items-center justify-center bg-[#11111b]/60 px-6 py-8"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-dashed border-[#45475a] bg-[#181825]/95 p-6 shadow-2xl backdrop-blur-sm">
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
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {QUICK_ACTION_TEMPLATES.map((template) => (
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
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
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
    const nextGraph = deserializeNodeGraph(selectedEntity?.components.logic?.graph);
    hydratingGraphRef.current = true;
    setGraph(nextGraph);
    setSelectedId(null);
    setDragging(null);
    setPendingEdge(null);
    setViewOffset({ x: 0, y: 0 });
    setGuidedCommentary(null);
    lastPersistedGraphRef.current = serializeNodeGraph(nextGraph);
  }, [selectedEntity]);

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

  const quickActionContext = useMemo<QuickActionContext>(() => {
    const selectedEntityIdValue = selectedEntity?.entity_id ?? null;
    return {
      selectedEntityId: selectedEntityIdValue,
      selectedEntityLabel: selectedEntity ? getEntityDisplayName(selectedEntity) : null,
      otherEntityId:
        activeScene?.entities.find((entity) => entity.entity_id !== selectedEntityIdValue)?.entity_id ?? null,
    };
  }, [activeScene, selectedEntity]);

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

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null;

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
          <p className="mt-1 select-none px-1 text-[10px] text-[#45475a]">
            Dica: arraste da saída para a entrada para conectar.
          </p>
          <p className="select-none px-1 text-[10px] text-[#45475a]">Del = remover nó</p>
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
