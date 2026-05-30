import { useState, useRef, useCallback, useEffect, useMemo, type CSSProperties } from "react";
import { persistActiveScene } from "../../core/scenePersistence";
import { openProjectSourcePath } from "../../core/ipc/projectService";
import { parseSceneJson, resolveScenePrefabs } from "../../core/ipc/sceneService";
import type { Entity } from "../../core/ipc/sceneService";
import { useEditorStore, type HwStatus } from "../../core/store/editorStore";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { resolveEntitySourceRefs } from "../../core/entityAuthoring";
import type { SgdkPatternTemplate } from "../../core/projectCapability";
import SgdkPatternTemplateGallery from "./SgdkPatternTemplateGallery";
import {
  collectGraphImportGaps,
  filterGraphImportGaps,
  formatImportedSemanticsKind,
  getGraphNodeImportBadges,
  getGraphNodeSourceMapping,
  type CapabilityTone,
} from "../../core/sgdkLogicDiagnostics";
import type { SpriteCommandBinding } from "../../core/ipc/sceneService";

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

type NodeGraphView = ViewOffset & {
  zoom: number;
};

type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const IMPORT_PARAM_KEYS = new Set([
  "import_status",
  "converted",
  "bridge",
  "gap",
  "gap_id",
  "source",
  "source_file",
  "source_path",
  "source_line",
  "line",
]);

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
    | "disconnected_node"
    | "node_without_exec_input"
    | "branch_without_output"
    | "blocking_bridge"
    | "input_command_unbound"
    | "missing_animation";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type NodeGraphValidation = {
  errors: NodeGraphValidationIssue[];
  warnings: NodeGraphValidationIssue[];
};

export type NodeGraphValidationContext = {
  selectedEntity?: Entity | null;
  sceneEntities?: Entity[];
};

type NodeGraphTraceKind = "input event" | "condition" | "action" | "output";

type NodeGraphTraceStep = {
  kind: NodeGraphTraceKind;
  nodeId?: string;
  label: string;
  detail: string;
};

type NodeGraphExecutionInspection = {
  evidence: "observed" | "simulated";
  evidenceLabel: string;
  reachableNodeIds: string[];
  trace: NodeGraphTraceStep[];
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
    | "mini_platformer"
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
const NODEGRAPH_GRID_SIZE = 24;
const NODEGRAPH_MIN_ZOOM = 0.35;
const NODEGRAPH_MAX_ZOOM = 2.4;

export type NodeVisualCategoryId =
  | "trigger_input"
  | "state"
  | "transition"
  | "action"
  | "animation"
  | "sprite"
  | "tilemap"
  | "camera"
  | "audio"
  | "timer"
  | "collision"
  | "hardware_budget"
  | "vdp_dma_palette"
  | "bridge_source_mapping"
  | "error_unsupported";

export type NodeVisualCategory = {
  id: NodeVisualCategoryId;
  label: string;
  color: string;
  icon: string;
};

export type NodeGraphGroupBox = {
  categoryId: NodeVisualCategoryId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  zIndex: number;
  pointerEvents: "none";
};

export type NodeGraphWheelZoomInput = {
  clientX: number;
  clientY: number;
  deltaY: number;
  rect: Pick<DOMRect, "left" | "top"> | { left: number; top: number };
  view: NodeGraphView;
};

export const NODE_VISUAL_CATEGORIES: NodeVisualCategory[] = [
  { id: "trigger_input", label: "Trigger/Input", color: "#89b4fa", icon: ">" },
  { id: "state", label: "State", color: "#cba6f7", icon: "S" },
  { id: "transition", label: "Transition", color: "#f9e2af", icon: "T" },
  { id: "action", label: "Action", color: "#a6e3a1", icon: "A" },
  { id: "animation", label: "Animation", color: "#f5c2e7", icon: "F" },
  { id: "sprite", label: "Sprite", color: "#94e2d5", icon: "P" },
  { id: "tilemap", label: "Tilemap", color: "#74c7ec", icon: "#" },
  { id: "camera", label: "Camera", color: "#89dceb", icon: "C" },
  { id: "audio", label: "Audio", color: "#fab387", icon: "M" },
  { id: "timer", label: "Timer", color: "#f38ba8", icon: "t" },
  { id: "collision", label: "Collision", color: "#eba0ac", icon: "X" },
  { id: "hardware_budget", label: "Hardware Budget", color: "#f9e2af", icon: "!" },
  { id: "vdp_dma_palette", label: "VDP/DMA/Palette", color: "#b4befe", icon: "V" },
  { id: "bridge_source_mapping", label: "Bridge/Source Mapping", color: "#f38ba8", icon: "B" },
  { id: "error_unsupported", label: "Error/Unsupported", color: "#f38ba8", icon: "E" },
];

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

function clampNodeGraphZoom(zoom: number): number {
  return Math.min(NODEGRAPH_MAX_ZOOM, Math.max(NODEGRAPH_MIN_ZOOM, zoom));
}

export function snapNodeGraphPoint(
  point: { x: number; y: number },
  gridSize = NODEGRAPH_GRID_SIZE
): { x: number; y: number } {
  const size = Math.max(1, gridSize);
  return {
    x: Math.round(point.x / size) * size,
    y: Math.round(point.y / size) * size,
  };
}

export function getNodeGraphWheelZoomState(input: NodeGraphWheelZoomInput): NodeGraphView {
  const localX = input.clientX - input.rect.left;
  const localY = input.clientY - input.rect.top;
  const currentZoom = clampNodeGraphZoom(input.view.zoom || 1);
  const worldX = (localX - input.view.x) / currentZoom;
  const worldY = (localY - input.view.y) / currentZoom;
  const nextZoom = clampNodeGraphZoom(currentZoom * Math.exp(-input.deltaY * 0.0015));

  return {
    zoom: nextZoom,
    x: localX - worldX * nextZoom,
    y: localY - worldY * nextZoom,
  };
}

export function getNodeGraphDotGridStyle(
  view: NodeGraphView,
  gridSize = NODEGRAPH_GRID_SIZE
): Pick<CSSProperties, "backgroundImage" | "backgroundSize" | "backgroundPosition"> {
  const scaledSize = Math.max(1, gridSize * clampNodeGraphZoom(view.zoom || 1));
  return {
    backgroundImage: "radial-gradient(circle, #313244 1px, transparent 1px)",
    backgroundSize: `${scaledSize}px ${scaledSize}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
}

function getNodeVisualCategory(nodeOrType: GraphNode | NodeType): NodeVisualCategory {
  const type = typeof nodeOrType === "string" ? nodeOrType : nodeOrType.type;
  const id: NodeVisualCategoryId = (() => {
    switch (type) {
      case "event_start":
      case "event_update":
      case "input_pressed":
      case "input_held":
      case "input_command":
        return "trigger_input";
      case "fsm_state":
        return "state";
      case "fsm_transition":
        return "transition";
      case "sprite_anim":
      case "set_animation_state":
      case "timeline_sequence":
        return "animation";
      case "sprite_move":
      case "set_velocity":
      case "set_position":
      case "spawn_entity":
      case "destroy_entity":
        return "sprite";
      case "set_tile":
      case "scroll_tilemap":
      case "load_scene":
        return "tilemap";
      case "camera_follow":
      case "camera_bounds":
      case "move_camera":
        return "camera";
      case "action_sound":
        return "audio";
      case "timer":
        return "timer";
      case "condition_overlap":
      case "condition_compare":
      case "logic_and":
        return "collision";
      case "hardware_budget_check":
        return "hardware_budget";
      case "event_vblank":
      case "event_hblank":
      case "event_dma_done":
      case "effect_raster":
        return "vdp_dma_palette";
      case "bridge_unconverted_source":
        return "bridge_source_mapping";
      case "effect_parallax":
      case "var_set":
      case "var_get":
      case "logic_math":
      case "flow_if":
      case "flow_while":
      case "flow_for":
        return "action";
      default:
        return "error_unsupported";
    }
  })();

  return NODE_VISUAL_CATEGORIES.find((category) => category.id === id) ?? NODE_VISUAL_CATEGORIES[0];
}

export function buildNodeGraphGroupBoxes(graph: NodeGraph): NodeGraphGroupBox[] {
  const nodesByCategory = new Map<NodeVisualCategoryId, GraphNode[]>();
  for (const node of graph.nodes) {
    const category = getNodeVisualCategory(node);
    const nodes = nodesByCategory.get(category.id) ?? [];
    nodes.push(node);
    nodesByCategory.set(category.id, nodes);
  }

  return NODE_VISUAL_CATEGORIES.flatMap((category) => {
    const nodes = nodesByCategory.get(category.id) ?? [];
    if (nodes.length === 0) {
      return [];
    }

    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...nodes.map((node) => node.x + NODE_CARD_WIDTH));
    const maxY = Math.max(...nodes.map((node) => node.y + NODE_CARD_HEIGHT));
    const padding = 42;

    return [
      {
        categoryId: category.id,
        label: category.label,
        x: minX - padding,
        y: minY - padding,
        width: Math.max(NODE_CARD_WIDTH + padding * 2, maxX - minX + padding * 2),
        height: Math.max(NODE_CARD_HEIGHT + padding * 2, maxY - minY + padding * 2),
        color: category.color,
        zIndex: -1,
        pointerEvents: "none" as const,
      },
    ];
  });
}

export function canEditGraphNode(node: GraphNode): boolean {
  if (node.type === "bridge_unconverted_source") {
    return false;
  }
  const readonly = node.params.readonly ?? node.params.read_only;
  if (typeof readonly === "string" && readonly.toLowerCase() === "true") {
    return false;
  }
  if (readonly === 1) {
    return false;
  }
  const importStatus = node.params.import_status;
  return importStatus !== "bridge" && importStatus !== "blocked";
}

export type NodeGraphHardwareFeedback = {
  topic: "tiles" | "palettes" | "sprites_frame" | "sprites_scanline" | "vram" | "dma" | "strategy";
  label: string;
  detail: string;
  tone: "ok" | "warn" | "error";
};

export function buildNodeGraphHardwareFeedback(
  graph: NodeGraph,
  hwStatus?: HwStatus | null
): NodeGraphHardwareFeedback[] {
  const hasHardwareNode = graph.nodes.some((node) => node.type === "hardware_budget_check");
  const feedback: NodeGraphHardwareFeedback[] = [];

  if (hwStatus) {
    feedback.push(
      {
        topic: "sprites_frame",
        label: `Sprites/frame ${hwStatus.sprite_count}/${hwStatus.sprite_limit}`,
        detail: "Sprite count explains object pressure visible in the current graph.",
        tone: hwStatus.sprite_count > hwStatus.sprite_limit ? "error" : "ok",
      },
      {
        topic: "sprites_scanline",
        label: `Sprites/scanline ${hwStatus.scanline_sprite_peak}/${hwStatus.scanline_sprite_limit}`,
        detail: "Scanline peaks are a common flicker source; multiplexing is a strategy, not a magic fix.",
        tone: hwStatus.scanline_sprite_peak > hwStatus.scanline_sprite_limit ? "error" : "ok",
      },
      {
        topic: "vram",
        label: `VRAM ${hwStatus.vram_used}/${hwStatus.vram_limit}`,
        detail: "Resident VRAM should stay explicit; streaming and banks must be intentional.",
        tone: hwStatus.vram_used > hwStatus.vram_limit ? "error" : "ok",
      },
      {
        topic: "dma",
        label: `DMA ${hwStatus.dma_used}/${hwStatus.dma_limit}`,
        detail: "DMA budget points to upload pressure per frame and should be reviewed near VBlank nodes.",
        tone: hwStatus.dma_used > hwStatus.dma_limit ? "error" : "ok",
      },
      {
        topic: "palettes",
        label: `Palettes ${hwStatus.palette_banks_used}/${hwStatus.palette_banks_limit}`,
        detail: "Palette swaps, mid-screen changes and shadow/highlight remain explicit experimental strategies.",
        tone: hwStatus.palette_banks_used > hwStatus.palette_banks_limit ? "error" : "ok",
      }
    );
  }

  if (hasHardwareNode || !hwStatus) {
    feedback.push(
      {
        topic: "tiles",
        label: "Tiles and maps",
        detail: "Use banks, streaming and metatile reuse to explain tile pressure before treating it as solved.",
        tone: "warn",
      },
      {
        topic: "strategy",
        label: "Modern mitigation strategies",
        detail: "Streaming, banks, palette swaps and sprite multiplexing are surfaced as tradeoffs for review.",
        tone: "warn",
      }
    );
  }

  return feedback;
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

function isExecEntryNode(node: GraphNode): boolean {
  return EVENT_NODE_TYPES.includes(node.type);
}

function isBranchingExecNode(node: GraphNode): boolean {
  return node.outputs.filter((port) => port.kind === "exec").length > 1;
}

function hasTruthyParam(
  params: Record<string, string | number>,
  keys: string[],
): boolean {
  return keys.some((key) => {
    const value = params[key];
    if (typeof value === "number") {
      return value !== 0;
    }
    return ["1", "true", "yes", "blocking", "block"].includes(
      String(value ?? "").trim().toLowerCase(),
    );
  });
}

function normalizeGraphToken(value: string | number | null | undefined): string {
  return normalizeGraphEntityKey(value);
}

function resolveGraphTargetEntity(
  node: GraphNode,
  context?: NodeGraphValidationContext,
): Entity | null {
  const entities = context?.sceneEntities ?? [];
  const candidateKeys = Array.from(
    new Set(
      ["target", "entity", "a", "b"]
        .map((key) => normalizeGraphToken(node.params[key]))
        .filter((value) => value.length > 0),
    ),
  );

  const matched =
    candidateKeys.length > 0
      ? entities.find((entity) => {
          const entityKeys = [
            normalizeGraphToken(entity.entity_id),
            normalizeGraphToken(getEntityDisplayName(entity)),
            normalizeGraphToken(entity.display_name ?? ""),
          ];
          return candidateKeys.some((candidate) =>
            entityKeys.includes(candidate),
          );
        })
      : null;

  return matched ?? context?.selectedEntity ?? null;
}

function commandNodeHasBinding(
  node: GraphNode,
  context?: NodeGraphValidationContext,
): boolean {
  const targetEntity = resolveGraphTargetEntity(node, context);
  const bindings = targetEntity?.components.sprite?.commands ?? [];
  if (bindings.length === 0) {
    return false;
  }

  const commandId = normalizeGraphToken(node.params.command_id);
  const displayName = normalizeGraphToken(node.params.display_name);
  const notation = String(node.params.notation ?? "").trim();

  if (commandId.length > 0) {
    return bindings.some(
      (binding) => normalizeGraphToken(binding.id) === commandId,
    );
  }

  return bindings.some((binding) => {
    const bindingKeys = [
      normalizeGraphToken(binding.id),
      normalizeGraphToken(binding.display_name),
    ];
    return (
      (displayName.length > 0 && bindingKeys.includes(displayName)) ||
      (notation.length > 0 && (binding.notation ?? "").trim() === notation)
    );
  });
}

function nodeReferencesMissingAnimation(
  node: GraphNode,
  context?: NodeGraphValidationContext,
): boolean {
  if (node.type !== "set_animation_state" && node.type !== "sprite_anim") {
    return false;
  }
  const animationKey = normalizeGraphToken(
    node.type === "sprite_anim" ? node.params.anim : node.params.state,
  );
  if (!animationKey) {
    return false;
  }

  const targetEntity = resolveGraphTargetEntity(node, context);
  const animations = targetEntity?.components.sprite?.animations;
  if (!animations || Object.keys(animations).length === 0) {
    return true;
  }

  return !Object.keys(animations).some(
    (key) => normalizeGraphToken(key) === animationKey,
  );
}

function isBlockingBridgeNode(node: GraphNode): boolean {
  return (
    node.type === "bridge_unconverted_source" &&
    hasTruthyParam(node.params, [
      "blocking",
      "blocks_build",
      "blocks_runtime",
      "build_blocking",
    ])
  );
}

export function validateNodeGraph(
  graph: NodeGraph,
  context?: NodeGraphValidationContext,
): NodeGraphValidation {
  const issues: NodeGraphValidationIssue[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const connectedNodeIds = new Set<string>();
  const validIncomingExecNodeIds = new Set<string>();
  const outgoingExecByNodePort = new Map<string, Set<string>>();

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

    if (fromPort.kind === "exec" && toPort.kind === "exec") {
      validIncomingExecNodeIds.add(edge.toNode);
      const outgoingPorts =
        outgoingExecByNodePort.get(edge.fromNode) ?? new Set<string>();
      outgoingPorts.add(edge.fromPort);
      outgoingExecByNodePort.set(edge.fromNode, outgoingPorts);
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

    const hasExecInput = node.inputs.some((port) => port.kind === "exec");
    if (
      hasExecInput &&
      !isExecEntryNode(node) &&
      !validIncomingExecNodeIds.has(node.id)
    ) {
      issues.push({
        severity: "warning",
        code: "node_without_exec_input",
        nodeId: node.id,
        message: `No '${node.label}' tem entrada exec sem ligacao de entrada.`,
      });
    }

    if (isBranchingExecNode(node)) {
      const connectedOutputs = outgoingExecByNodePort.get(node.id) ?? new Set();
      const missingOutputs = node.outputs
        .filter((port) => port.kind === "exec")
        .filter((port) => !connectedOutputs.has(port.id));
      if (missingOutputs.length > 0) {
        issues.push({
          severity: "warning",
          code: "branch_without_output",
          nodeId: node.id,
          message: `Branch '${node.label}' tem saida sem destino: ${missingOutputs
            .map((port) => port.label || port.id)
            .join(", ")}.`,
        });
      }
    }

    if (isBlockingBridgeNode(node)) {
      issues.push({
        severity: "error",
        code: "blocking_bridge",
        nodeId: node.id,
        message: `Bridge bloqueante '${node.label}' preserva fonte sem conversao executavel.`,
      });
    }

    if (node.type === "input_command" && !commandNodeHasBinding(node, context)) {
      issues.push({
        severity: "error",
        code: "input_command_unbound",
        nodeId: node.id,
        message: `Comando de input '${String(
          node.params.command_id ?? node.label,
        )}' nao tem binding em SpriteComponent.commands.`,
      });
    }

    if (nodeReferencesMissingAnimation(node, context)) {
      issues.push({
        severity: "error",
        code: "missing_animation",
        nodeId: node.id,
        message: `Animacao '${String(
          node.type === "sprite_anim" ? node.params.anim : node.params.state,
        )}' referenciada por '${node.label}' nao existe no sprite alvo.`,
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

function collectReachableExecNodeIds(graph: NodeGraph): string[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
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
    adjacency.set(edge.fromNode, [
      ...(adjacency.get(edge.fromNode) ?? []),
      edge.toNode,
    ]);
  }

  const queue = graph.nodes
    .filter((node) => isExecEntryNode(node))
    .map((node) => node.id);
  const reachable: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    reachable.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (!seen.has(nextId)) {
        queue.push(nextId);
      }
    }
  }

  return reachable;
}

function traceKindsForNode(node: GraphNode): NodeGraphTraceKind[] {
  if (
    node.type === "input_pressed" ||
    node.type === "input_held" ||
    node.type === "input_command"
  ) {
    return ["input event", "condition"];
  }
  if (node.type.startsWith("event_")) {
    return ["input event"];
  }
  if (
    node.type.startsWith("condition_") ||
    node.type === "flow_if" ||
    node.type === "flow_while" ||
    node.type === "hardware_budget_check"
  ) {
    return ["condition"];
  }
  return ["action"];
}

function buildNodeTraceDetail(node: GraphNode, kind: NodeGraphTraceKind): string {
  if (kind === "output") {
    return "Saida exec alcancavel nesta simulacao local.";
  }
  if (node.type === "input_command") {
    return `command_id=${String(node.params.command_id ?? node.id)}`;
  }
  if (node.type === "set_animation_state") {
    return `state=${String(node.params.state ?? "")}`;
  }
  if (node.type === "sprite_anim") {
    return `anim=${String(node.params.anim ?? "")}`;
  }
  if (node.type === "bridge_unconverted_source") {
    return `bridge=${String(node.params.gap ?? "source")}`;
  }
  return getNodeDisplayName(node.type);
}

function buildSimulatedTrace(
  graph: NodeGraph,
  reachableNodeIds: string[],
): NodeGraphTraceStep[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const trace: NodeGraphTraceStep[] = [];

  for (const nodeId of reachableNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    for (const kind of traceKindsForNode(node)) {
      trace.push({
        kind,
        nodeId: node.id,
        label: node.label || getNodeDisplayName(node.type),
        detail: buildNodeTraceDetail(node, kind),
      });
    }
  }

  const reachableSet = new Set(reachableNodeIds);
  for (const edge of graph.edges) {
    if (!reachableSet.has(edge.fromNode) || !reachableSet.has(edge.toNode)) {
      continue;
    }
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    const fromPort = fromNode
      ? findPort(fromNode, edge.fromPort, "output")
      : undefined;
    const toPort = toNode ? findPort(toNode, edge.toPort, "input") : undefined;
    if (fromPort?.kind !== "exec" || toPort?.kind !== "exec") {
      continue;
    }
    trace.push({
      kind: "output",
      nodeId: edge.fromNode,
      label: `${edge.fromPort} -> ${edge.toNode}`,
      detail: "Transicao exec simulada por aresta local.",
    });
  }

  return trace;
}

function inspectNodeGraphExecution(graph: NodeGraph): NodeGraphExecutionInspection {
  const reachableNodeIds = collectReachableExecNodeIds(graph);
  return {
    evidence: "simulated",
    evidenceLabel: "simulado / nao instrumentado",
    reachableNodeIds,
    trace: buildSimulatedTrace(graph, reachableNodeIds),
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
    value === "input_command" ||
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

export function buildCommandTransitionGraph(
  command: SpriteCommandBinding,
  targetEntityId: string,
  buttonProfile: string
): NodeGraph {
  const commandKey = normalizeGraphEntityKey(command.id || command.display_name || "command") || "command";
  const target = targetEntityId.trim() || "self";
  const targetState = normalizeGraphEntityKey(command.target_animation || command.display_name || command.id || "attack");

  const commandNode = makeNode("input_command", 120, 120);
  commandNode.id = `input_command_${commandKey}`;
  commandNode.label = command.display_name || "Input Command";
  commandNode.params = {
    ...commandNode.params,
    command_id: command.id,
    display_name: command.display_name,
    notation: command.notation,
    max_frames: command.max_frames,
    target,
    button_profile: command.button_profile || buttonProfile,
    source: command.source,
  };
  if (command.unsupported_tokens?.length) {
    commandNode.params.unsupported_tokens = command.unsupported_tokens.join(",");
  }

  const transitionNode = makeNode("fsm_transition", 400, 120);
  transitionNode.id = `fsm_transition_${commandKey}`;
  transitionNode.label = `${command.display_name || command.id} -> ${targetState}`;
  transitionNode.params = {
    ...transitionNode.params,
    command_id: command.id,
    target_state: targetState,
  };

  const animationNode = makeNode("set_animation_state", 680, 120);
  animationNode.id = `set_animation_state_${commandKey}`;
  animationNode.label = `Set ${targetState}`;
  animationNode.params = {
    ...animationNode.params,
    target,
    state: targetState,
  };

  return {
    nodes: [commandNode, transitionNode, animationNode],
    edges: [
      makeEdge(commandNode, "exec", transitionNode, "exec"),
      makeEdge(transitionNode, "matched", animationNode, "exec"),
    ],
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

function buildMiniPlatformerQuickActionGraph(
  context: QuickActionContext,
): NodeGraph {
  const target = resolveQuickActionPrimaryTarget(context, "player");

  const start = makeNode("event_start", 120, 96);
  const spawn = makeNode("spawn_entity", 380, 92);
  const idleStart = makeNode("set_animation_state", 640, 92);

  const moveTick = makeNode("event_update", 120, 260);
  const right = makeNode("input_held", 380, 252);
  const runVelocity = makeNode("set_velocity", 640, 252);
  const runMove = makeNode("sprite_move", 900, 252);
  const runAnim = makeNode("set_animation_state", 1160, 252);

  const gravityTick = makeNode("event_update", 120, 420);
  const gravity = makeNode("sprite_move", 380, 416);
  const fallAnim = makeNode("set_animation_state", 640, 416);

  const jumpTick = makeNode("event_update", 120, 580);
  const jumpInput = makeNode("input_pressed", 380, 572);
  const jumpVelocity = makeNode("set_velocity", 640, 572);
  const jumpMove = makeNode("sprite_move", 900, 572);
  const jumpAnim = makeNode("set_animation_state", 1160, 572);

  const collisionTick = makeNode("event_update", 120, 740);
  const overlap = makeNode("condition_overlap", 380, 732);
  const stopVelocity = makeNode("set_velocity", 640, 732);
  const idleCollision = makeNode("set_animation_state", 900, 732);

  const cameraTick = makeNode("event_update", 120, 900);
  const camera = makeNode("camera_follow", 380, 896);
  const budget = makeNode("hardware_budget_check", 640, 896);

  spawn.params = { ...spawn.params, prefab: target, x: 48, y: 128 };
  idleStart.params = { ...idleStart.params, target, state: "idle" };

  right.params = { ...right.params, pad: "JOY_1", button: "BUTTON_RIGHT" };
  runVelocity.params = { ...runVelocity.params, target, vx: 2, vy: 0 };
  runMove.params = { ...runMove.params, target, dx: 2, dy: 0 };
  runAnim.params = { ...runAnim.params, target, state: "run" };

  gravity.params = { ...gravity.params, target, dx: 0, dy: 1 };
  fallAnim.params = { ...fallAnim.params, target, state: "jump" };

  jumpInput.params = { ...jumpInput.params, pad: "JOY_1", button: "BUTTON_A" };
  jumpVelocity.params = { ...jumpVelocity.params, target, vx: 0, vy: -6 };
  jumpMove.params = { ...jumpMove.params, target, dx: 0, dy: -6 };
  jumpAnim.params = { ...jumpAnim.params, target, state: "jump" };

  overlap.params = { ...overlap.params, a: target, b: target };
  stopVelocity.params = { ...stopVelocity.params, target, vx: 0, vy: 0 };
  idleCollision.params = { ...idleCollision.params, target, state: "idle" };

  camera.params = { ...camera.params, target, damping: 0 };

  return {
    nodes: [
      start,
      spawn,
      idleStart,
      moveTick,
      right,
      runVelocity,
      runMove,
      runAnim,
      gravityTick,
      gravity,
      fallAnim,
      jumpTick,
      jumpInput,
      jumpVelocity,
      jumpMove,
      jumpAnim,
      collisionTick,
      overlap,
      stopVelocity,
      idleCollision,
      cameraTick,
      camera,
      budget,
    ],
    edges: [
      makeEdge(start, "exec", spawn, "exec"),
      makeEdge(spawn, "exec", idleStart, "exec"),
      makeEdge(moveTick, "exec", right, "exec"),
      makeEdge(right, "exec", runVelocity, "exec"),
      makeEdge(runVelocity, "exec", runMove, "exec"),
      makeEdge(runMove, "exec", runAnim, "exec"),
      makeEdge(gravityTick, "exec", gravity, "exec"),
      makeEdge(gravity, "exec", fallAnim, "exec"),
      makeEdge(jumpTick, "exec", jumpInput, "exec"),
      makeEdge(jumpInput, "exec", jumpVelocity, "exec"),
      makeEdge(jumpVelocity, "exec", jumpMove, "exec"),
      makeEdge(jumpMove, "exec", jumpAnim, "exec"),
      makeEdge(collisionTick, "exec", overlap, "exec"),
      makeEdge(overlap, "true", stopVelocity, "exec"),
      makeEdge(stopVelocity, "exec", idleCollision, "exec"),
      makeEdge(cameraTick, "exec", camera, "exec"),
      makeEdge(camera, "exec", budget, "exec"),
    ],
  };
}

function buildPlayerControllerQuickActionGraph(
  context: QuickActionContext,
): NodeGraph {
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
    id: "mini_platformer",
    actionLabel: "Criar Mini Platformer No-Code",
    title: "Mini Platformer No-Code",
    summary:
      "Cria um loop jogavel pequeno com input, movimento, gravidade, colisao simples e camera.",
    comments: [
      "On Start posiciona o player e entra em idle sem exigir codigo manual.",
      "Input segurado move para a direita; input pressionado aplica salto e animacao jump.",
      "Gravidade, overlap simples e camera follow ficam em lanes separadas para leitura e ajuste posterior.",
    ],
    hardwareNote:
      "Usa apenas nos do subset atual de build SGDK/SNES e evita dependencias externas.",
    limitation:
      "A colisao inicial usa o proprio player como marcador simples; refine com entidades de chao quando o editor expor esse bootstrap por UI.",
    buildGraph: buildMiniPlatformerQuickActionGraph,
  },
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

function coercePatternNodeType(nodeType: string): NodeType {
  if (nodeType in NODE_DEFS) {
    return nodeType as NodeType;
  }
  switch (nodeType) {
    case "hardware_budget":
      return "hardware_budget_check";
    case "condition_input":
      return "input_pressed";
    case "condition_tile":
      return "condition_compare";
    case "apply_physics":
      return "set_velocity";
    case "scene_reset":
      return "load_scene";
    case "draw_text":
      return "bridge_unconverted_source";
    default:
      return "bridge_unconverted_source";
  }
}

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
  zoom: number;
  selected: boolean;
  executionReachable?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
  onPortMouseUp: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
}

function NodeCard({
  node,
  screenX,
  screenY,
  zoom,
  selected,
  executionReachable = false,
  onMouseDown,
  onPortMouseDown,
  onPortMouseUp,
}: NodeCardProps) {
  const group = getGroupForType(node.type);
  const headerBg = GROUP_HEADER_BG[group] ?? "bg-[#4a4a3a]";
  const importBadges = getGraphNodeImportBadges(node);
  const visibleParams = Object.entries(node.params).filter(([key]) => !IMPORT_PARAM_KEYS.has(key));
  const editable = canEditGraphNode(node);

  return (
    <div
      data-testid={`node-card-${node.id}`}
      data-selected={selected ? "true" : undefined}
      data-editable={editable ? "true" : "false"}
      data-execution-reachable={executionReachable ? "true" : undefined}
      className={`absolute select-none min-w-[160px] rounded-xl border border-slate-700 bg-slate-900/90 shadow-lg backdrop-blur-sm ${
        selected ? "ring-2 ring-blue-500 shadow-2xl" : ""
      } ${
        executionReachable
          ? "ring-2 ring-[#a6e3a1] shadow-[0_0_24px_rgba(166,227,161,0.22)]"
          : ""
      } ${
        editable ? "" : "opacity-80"
      }`}
      style={{
        left: screenX,
        top: screenY,
        transform: `scale(${zoom})`,
        transformOrigin: "top left",
      }}
      onMouseDown={onMouseDown}
    >
      {/* Header colorido por categoria */}
      <div
        className={`rounded-t-xl px-3 py-1.5 text-[11px] font-semibold text-white/95 cursor-grab ${headerBg}`}
      >
        {getNodeDisplayName(node.type)}
      </div>

      {importBadges.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-slate-700/50 px-3 py-1.5">
          {importBadges.map((badge) => (
            <span
              key={badge.label}
              className={[
                "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]",
                importBadgeClass(badge.tone),
              ].join(" ")}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

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
      {visibleParams.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-slate-700/50 px-3 pb-2 pt-1.5">
          {visibleParams.map(([k, v]) => (
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

function importBadgeClass(tone: CapabilityTone): string {
  switch (tone) {
    case "supported":
      return "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]";
    case "bridge":
      return "border-[#f9e2af]/35 bg-[#f9e2af]/10 text-[#f9e2af]";
    case "blocked":
      return "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]";
    case "experimental":
      return "border-[#cba6f7]/35 bg-[#cba6f7]/10 text-[#cba6f7]";
    case "partial":
    default:
      return "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]";
  }
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
  const hwStatus = useEditorStore((state) => state.hwStatus);
  const selectedEntity =
    selectedEntityId && !selectedEntityId.startsWith("layer::")
      ? activeScene?.entities.find((entity) => entity.entity_id === selectedEntityId) ?? null
      : null;
  const [graph, setGraph] = useState<NodeGraph>(() => cloneGraph(EMPTY_GRAPH));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNode: string; fromPort: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState<{
    startX: number;
    startY: number;
    startViewX: number;
    startViewY: number;
  } | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [view, setView] = useState<NodeGraphView>({ x: 0, y: 0, zoom: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [guidedCommentary, setGuidedCommentary] = useState<GuidedFlowCommentary | null>(null);
  const [gapFilter, setGapFilter] = useState("");
  const [executionInspectorEnabled, setExecutionInspectorEnabled] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panningRef = useRef<{
    startX: number;
    startY: number;
    startViewX: number;
    startViewY: number;
  } | null>(null);
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
      panningRef.current = null;
      setPanning(null);
      setHoveredEdgeId(null);
      setActiveEdgeId(null);
      setView({ x: 0, y: 0, zoom: 1 });
      setGuidedCommentary(null);
      setGapFilter("");
      setExecutionInspectorEnabled(false);
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
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(
        element &&
          (element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.tagName === "SELECT" ||
            element.isContentEditable)
      );
    };
    const isSpace = (event: KeyboardEvent) => event.code === "Space" || event.key === " ";
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSpace(event) && !isEditableTarget(event.target)) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isSpace(event)) {
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
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
    if (spacePressed && e.button === 0) {
      return;
    }
    e.stopPropagation();
    if (e.button !== 0) {
      return;
    }
    if ((e.target as HTMLElement).classList.contains("cursor-crosshair")) return;
    setSelectedId(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId)!;
    const rect = canvasRef.current?.getBoundingClientRect();
    const localX = e.clientX - (rect?.left ?? 0);
    const localY = e.clientY - (rect?.top ?? 0);
    setDragging({
      nodeId,
      offsetX: (localX - view.x) / view.zoom - node.x,
      offsetY: (localY - view.y) / view.zoom - node.y,
    });
  }, [graph.nodes, spacePressed, view.x, view.y, view.zoom]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const activePanning = panningRef.current ?? panning;
    if (activePanning) {
      setView((current) => ({
        ...current,
        x: activePanning.startViewX + (e.clientX - activePanning.startX),
        y: activePanning.startViewY + (e.clientY - activePanning.startY),
      }));
      return;
    }
    if (dragging) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const localX = e.clientX - (rect?.left ?? 0);
      const localY = e.clientY - (rect?.top ?? 0);
      const nextPoint = snapNodeGraphPoint({
        x: (localX - view.x) / view.zoom - dragging.offsetX,
        y: (localY - view.y) / view.zoom - dragging.offsetY,
      });
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === dragging.nodeId
            ? {
                ...n,
                x: nextPoint.x,
                y: nextPoint.y,
              }
            : n
        ),
      }));
    }
    if (pendingEdge) {
      setPendingEdge((p) => p ? { ...p, x: e.clientX, y: e.clientY } : null);
    }
  }, [dragging, panning, pendingEdge, view.x, view.y, view.zoom]);

  const onMouseUp = useCallback(() => {
    setDragging(null);
    setPendingEdge(null);
    panningRef.current = null;
    setPanning(null);
    setActiveEdgeId(null);
  }, []);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (spacePressed && e.button === 0)) {
      e.preventDefault();
      setDragging(null);
      const nextPanning = {
        startX: e.clientX,
        startY: e.clientY,
        startViewX: view.x,
        startViewY: view.y,
      };
      panningRef.current = nextPanning;
      setPanning(nextPanning);
      return;
    }
    if (spacePressed) {
      return;
    }
    setSelectedId(null);
  }, [spacePressed, view.x, view.y]);

  const onCanvasWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setView((current) =>
      getNodeGraphWheelZoomState({
        clientX: e.clientX,
        clientY: e.clientY,
        deltaY: e.deltaY,
        rect,
        view: current,
      })
    );
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
  const importedSemanticsKind = formatImportedSemanticsKind(importedSemantics);
  const sourceMappedNode = useMemo(
    () =>
      selectedNode && getGraphNodeSourceMapping(selectedNode)
        ? selectedNode
        : graph.nodes.find((node) => getGraphNodeSourceMapping(node)) ?? null,
    [graph.nodes, selectedNode]
  );
  const selectedSourceMapping =
    (sourceMappedNode ? getGraphNodeSourceMapping(sourceMappedNode) : null) ??
    (selectedEntitySourceRefs[0] ? { file: selectedEntitySourceRefs[0] } : null);
  const importGaps = useMemo(
    () => collectGraphImportGaps(graph, importedSemantics),
    [graph, importedSemantics]
  );
  const visibleImportGaps = useMemo(
    () => filterGraphImportGaps(importGaps, gapFilter),
    [gapFilter, importGaps]
  );

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
    panningRef.current = null;
    setPanning(null);
    setView({ x: 0, y: 0, zoom: 1 });
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
    panningRef.current = null;
    setPanning(null);
    if (firstNewNode) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const width = rect?.width ?? canvasSize.width;
      const height = rect?.height ?? canvasSize.height;
      const desiredX = Math.max(FOCUS_PADDING, width / 2 - NODE_CARD_WIDTH / 2);
      const desiredY = Math.max(FOCUS_PADDING, height / 2 - NODE_CARD_HEIGHT / 2);
      setView((current) => ({
        ...current,
        x: desiredX - firstNewNode.x * current.zoom,
        y: desiredY - firstNewNode.y * current.zoom,
      }));
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

  const appendCommandTransition = useCallback((command: SpriteCommandBinding) => {
    if (!selectedEntity) {
      return;
    }
    const commandGraph = buildCommandTransitionGraph(
      command,
      selectedEntity.entity_id,
      command.button_profile || "megadrive"
    );
    const result = appendQuickActionGraph(graph, commandGraph);
    const firstNewNodeId = result.appendedNodeIds[0] ?? commandGraph.nodes[0]?.id ?? null;
    setGraph(result.graph);
    setSelectedId(firstNewNodeId);
    setDragging(null);
    setPendingEdge(null);
    panningRef.current = null;
    setPanning(null);
    setGuidedCommentary({
      title: `${command.display_name || command.id} (command.dat)`,
      summary: "Comando importado convertido em input_command, transicao FSM e animacao alvo.",
      comments: [
        `Notation: ${command.notation}`,
        `Target animation: ${command.target_animation}`,
      ],
      hardwareNote: "Bridge visual: confirme input real, janela de frames e animacao antes de tratar como validacao final.",
      limitation: command.unsupported_tokens?.length
        ? `Tokens nao suportados preservados: ${command.unsupported_tokens.join(", ")}`
        : undefined,
    });
    logMessage(
      "info",
      `[NodeGraph] command.dat anexado como transicao visual: ${command.display_name || command.id}.`
    );
  }, [graph, logMessage, selectedEntity]);

  const appendSgdkPatternTemplate = useCallback((template: SgdkPatternTemplate) => {
    const baseBounds = getNodeGraphBounds(graph);
    const startX = baseBounds ? baseBounds.maxX + 260 : 180;
    const startY = baseBounds ? baseBounds.minY : 160;
    const nodes = template.nodes_generated.map((nodeTemplate, index) => {
      const type = coercePatternNodeType(nodeTemplate.node_type);
      const node = makeNode(type, startX + index * 240, startY + (index % 2) * 72);
      node.label = nodeTemplate.label || node.label;
      node.params = {
        ...node.params,
        ...nodeTemplate.params,
        import_status: "experimental",
        source: template.id,
      };
      return node;
    });
    const edges = nodes.slice(1).flatMap((node, index) => {
      const prev = nodes[index];
      if (!prev.outputs.some((port) => port.id === "exec") || !node.inputs.some((port) => port.id === "exec")) {
        return [];
      }
      return [makeEdge(prev, "exec", node, "exec")];
    });
    setGraph((current) => ({
      ...current,
      nodes: [...current.nodes, ...nodes],
      edges: [...current.edges, ...edges],
    }));
    setSelectedId(nodes[0]?.id ?? null);
    setGuidedCommentary({
      title: `${template.title} (Experimental)`,
      summary: template.technical_description,
      comments: [
        `Origem: ${template.origin}`,
        ...template.requirements.map((requirement) => `Requisito: ${requirement}`),
        ...template.risks.map((risk) => `Risco: ${risk}`),
      ],
      hardwareNote: template.hardware_warnings.join(" "),
      limitation: "Template rastreavel; revise contratos e build real antes de tratar como evidencia.",
    });
    logMessage("warn", `[NodeGraph] Template SGDK experimental inserido: ${template.title}. Revise contratos runtime antes do build.`);
  }, [graph, logMessage]);

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
    const x1 = fromNode.x * view.zoom + view.x + NODE_CARD_WIDTH * view.zoom;
    const y1 = fromNode.y * view.zoom + view.y + 24 * view.zoom;
    const x2 = toNode.x * view.zoom + view.x;
    const y2 = toNode.y * view.zoom + view.y + 24 * view.zoom;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  const graphSummary = useMemo(() => summarizeNodeGraph(graph), [graph]);
  const graphValidation = useMemo(
    () =>
      validateNodeGraph(graph, {
        selectedEntity,
        sceneEntities: activeScene?.entities ?? [],
      }),
    [activeScene?.entities, graph, selectedEntity]
  );
  const executionInspection = useMemo(
    () => inspectNodeGraphExecution(graph),
    [graph]
  );
  const reachableExecutionNodeIds = useMemo(
    () =>
      executionInspectorEnabled
        ? new Set(executionInspection.reachableNodeIds)
        : new Set<string>(),
    [executionInspection.reachableNodeIds, executionInspectorEnabled]
  );
  const graphValidationPreview = [...graphValidation.errors, ...graphValidation.warnings].slice(0, 3);
  const miniMapNodes = useMemo(
    () => buildNodeMiniMap(graph, MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_PADDING),
    [graph]
  );
  const groupBoxes = useMemo(() => buildNodeGraphGroupBoxes(graph), [graph]);
  const dotGridStyle = useMemo(() => getNodeGraphDotGridStyle(view), [view]);
  const hardwareFeedback = useMemo(
    () => buildNodeGraphHardwareFeedback(graph, hwStatus),
    [graph, hwStatus]
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

    const worldLeft = -view.x / view.zoom;
    const worldTop = -view.y / view.zoom;
    const worldWidth = canvasSize.width / view.zoom;
    const worldHeight = canvasSize.height / view.zoom;
    const viewportLeft = MINIMAP_PADDING + Math.max(0, worldLeft - graphBounds.minX) * scale;
    const viewportTop = MINIMAP_PADDING + Math.max(0, worldTop - graphBounds.minY) * scale;
    const viewportWidth = Math.min(innerWidth, Math.max(28, worldWidth * scale));
    const viewportHeight = Math.min(innerHeight, Math.max(20, worldHeight * scale));

    return {
      left: viewportLeft,
      top: viewportTop,
      width: viewportWidth,
      height: viewportHeight,
    };
  }, [canvasSize.height, canvasSize.width, graphBounds, view.x, view.y, view.zoom]);

  const toggleExecutionInspector = useCallback(() => {
    setExecutionInspectorEnabled((enabled) => {
      const next = !enabled;
      if (next) {
        logMessage(
          "info",
          `[NodeGraph Diagnostics] Inspecao de execucao: ${graphValidation.errors.length} erro(s), ${graphValidation.warnings.length} aviso(s), ${executionInspection.evidenceLabel}.`
        );
      }
      return next;
    });
  }, [
    executionInspection.evidenceLabel,
    graphValidation.errors.length,
    graphValidation.warnings.length,
    logMessage,
  ]);

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

    setView((current) => ({
      ...current,
      x: desiredX - targetNode.x * current.zoom,
      y: desiredY - targetNode.y * current.zoom,
    }));
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
      <div
        data-testid="nodegraph-side-rail"
        className="flex w-40 shrink-0 flex-col overflow-x-hidden border-r border-[#313244] bg-[#181825]"
      >
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
          <SgdkPatternTemplateGallery onInsertTemplate={appendSgdkPatternTemplate} />
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
          <p className="select-none px-1 text-[10px] text-[#45475a]">
            Space + drag ou botao do meio = pan.
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
        data-testid="nodegraph-canvas-shell"
        data-zoom={view.zoom.toFixed(3)}
        className={`relative flex-1 overflow-hidden ${panning ? "cursor-grabbing" : spacePressed ? "cursor-grab" : "cursor-default"}`}
        style={{
          ...dotGridStyle,
        }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onMouseDown={onCanvasMouseDown}
        onWheel={onCanvasWheel}
      >
        <div
          ref={canvasRef}
          data-testid="nodegraph-canvas"
          data-zoom={view.zoom.toFixed(3)}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-0"
          style={{ right: selectedEntity ? 288 : 0 }}
        />
        {!selectedEntity && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#11111b]/80">
            <p className="max-w-xs text-center text-xs text-[#6c7086]">
              Selecione uma entidade na hierarquia para carregar ou criar o `LogicComponent.graph`.
            </p>
          </div>
        )}

        {selectedEntity && (
          <aside
            data-testid="nodegraph-context-rail"
            className="absolute inset-y-0 right-0 z-20 flex w-72 flex-col overflow-hidden border-l border-[#313244] bg-[#181825]/95 shadow-[-18px_0_40px_rgba(0,0,0,0.24)] backdrop-blur-sm"
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
          <div
            data-testid="nodegraph-overview"
            className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-2 text-[10px]"
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

            {importedSemantics ? (
              <div
                data-testid="nodegraph-import-provenance"
                className={[
                  "rounded border px-2 py-1.5 text-[10px] leading-snug",
                  importedSemanticsKind === "FSM extraida"
                    ? "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#d9f99d]"
                    : "border-[#f9e2af]/35 bg-[#f9e2af]/10 text-[#f9e2af]",
                ].join(" ")}
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em]">
                  {importedSemanticsKind}
                </p>
                <p className="mt-1">
                  {importedSemanticsKind === "FSM extraida"
                    ? "FSM extraida do modelo semantico; bridges e gaps continuam visiveis abaixo."
                    : "Aviso: grafo heuristico. Ele ajuda autoria, mas nao representa AST/FSM real do jogo donor."}
                </p>
              </div>
            ) : null}

            {selectedSourceMapping ? (
              <div
                data-testid="nodegraph-source-mapping"
                className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1.5 text-[10px] leading-snug text-[#cdd6f4]"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                  Source Mapping
                </p>
                <p className="mt-1 font-mono text-[#cdd6f4]">
                  {selectedSourceMapping.file}
                  {selectedSourceMapping.line ? `:${selectedSourceMapping.line}` : ""}
                </p>
                {sourceMappedNode ? (
                  <p className="mt-1 text-[#7f849c]">
                    node: <span className="font-mono">{sourceMappedNode.id}</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {importGaps.length > 0 ? (
              <div
                data-testid="nodegraph-import-gaps"
                className="rounded border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-2 py-1.5 text-[10px] leading-snug text-[#f9e2af]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f38ba8]">
                    Import Gaps
                  </p>
                  <span className="font-mono text-[9px] text-[#f9e2af]">
                    {visibleImportGaps.length}/{importGaps.length}
                  </span>
                </div>
                <input
                  data-testid="nodegraph-gap-filter"
                  value={gapFilter}
                  onChange={(event) => setGapFilter(event.target.value)}
                  className="mt-1 w-full rounded border border-[#45475a] bg-[#11111b] px-2 py-1 text-[10px] text-[#cdd6f4] outline-none focus:border-[#f38ba8]"
                  placeholder="Filtrar gaps..."
                />
                <ul className="mt-1 max-h-24 space-y-1 overflow-auto">
                  {visibleImportGaps.map((gap) => (
                    <li
                      key={gap.id}
                      className="rounded border border-[#313244] bg-[#181825] px-1.5 py-1"
                    >
                      <div className="flex items-start gap-1.5">
                        <span
                          className={[
                            "shrink-0 rounded border px-1 py-0.5 text-[8px] font-semibold leading-none",
                            gap.severity === "blocking"
                              ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8]"
                              : "border-[#f9e2af]/40 bg-[#f9e2af]/10 text-[#f9e2af]",
                          ].join(" ")}
                        >
                          {gap.severity === "blocking" ? "Bloqueante" : "Bridge"}
                        </span>
                        <span className={gap.severity === "blocking" ? "min-w-0 text-[#f38ba8]" : "min-w-0 text-[#f9e2af]"}>
                          {gap.nodeId ? (
                            <span className="block truncate font-mono text-[9px]" title={gap.nodeId}>
                              {gap.nodeId}
                            </span>
                          ) : null}
                          <span className="block break-words">{gap.label}</span>
                          {gap.source ? (
                            <span className="block truncate font-mono text-[9px] text-[#7f849c]" title={gap.source}>
                              {gap.source}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

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
            {hardwareFeedback.length > 0 ? (
              <div
                data-testid="nodegraph-hardware-feedback"
                className="rounded border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-2 py-1.5 text-[10px] leading-snug text-[#fef3c7]"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">
                  Hardware Feedback
                </p>
                <ul className="mt-1 space-y-1">
                  {hardwareFeedback.slice(0, 6).map((item) => (
                    <li key={`${item.topic}-${item.label}`} className="rounded border border-[#313244] bg-[#11111b]/70 px-2 py-1">
                      <span
                        className={
                          item.tone === "error"
                            ? "font-semibold text-[#f38ba8]"
                            : item.tone === "ok"
                              ? "font-semibold text-[#a6e3a1]"
                              : "font-semibold text-[#f9e2af]"
                        }
                      >
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[#94a3b8]">{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {executionInspectorEnabled ? (
              <div
                data-testid="nodegraph-execution-inspector"
                className="rounded border border-[#a6e3a1]/35 bg-[#0f1a17] px-2 py-1.5 text-[10px] leading-snug text-[#bac2de]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a6e3a1]">
                      Inspecao de execucao
                    </p>
                    <p className="mt-1 text-[#94a3b8]">
                      {executionInspection.evidenceLabel}
                    </p>
                  </div>
                  <span className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] font-semibold text-[#cdd6f4]">
                    {executionInspection.reachableNodeIds.length} nos
                  </span>
                </div>

                <div className="mt-2 rounded border border-[#313244] bg-[#11111b]/80 px-2 py-1">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">
                    Diagnostics
                  </p>
                  <p className="mt-1 text-[#a6adc8]">
                    {graphValidation.errors.length} erro(s) /{" "}
                    {graphValidation.warnings.length} aviso(s)
                  </p>
                </div>

                <ol className="mt-2 space-y-1">
                  {executionInspection.trace.length > 0 ? (
                    executionInspection.trace.slice(0, 8).map((step, index) => (
                      <li
                        key={`${step.kind}-${step.nodeId ?? "edge"}-${index}`}
                        className="rounded border border-[#313244] bg-[#11111b]/70 px-2 py-1"
                      >
                        <span className="font-mono text-[9px] text-[#89b4fa]">
                          {step.kind}
                        </span>
                        <span className="ml-1 font-semibold text-[#cdd6f4]">
                          {step.label}
                        </span>
                        <span className="mt-0.5 block text-[#7f849c]">
                          {step.detail}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="rounded border border-[#313244] bg-[#11111b]/70 px-2 py-1 text-[#f9e2af]">
                      Nenhum no executavel alcancavel por simulacao local.
                    </li>
                  )}
                </ol>
              </div>
            ) : null}

            {importedSemantics ? (
              <div className="rounded border border-[#45475a] bg-[#11111b] px-2 py-1.5 text-[10px] leading-snug text-[#bac2de]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#94e2d5]">
                  Inferencia importada ({importedSemanticsKind})
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

            {selectedEntity.components.sprite?.commands?.length ? (
              <div className="rounded border border-[#89b4fa]/35 bg-[#11111b] px-2 py-1.5 text-[10px] leading-snug text-[#bac2de]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                  command.dat -&gt; Transition
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedEntity.components.sprite.commands.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      data-testid={`nodegraph-command-transition-${normalizeGraphEntityKey(command.id)}`}
                      onClick={() => appendCommandTransition(command)}
                      className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20"
                      title={command.notation}
                    >
                      + {command.display_name || command.id}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="nodegraph-inspect-execution-toggle"
                onClick={toggleExecutionInspector}
                disabled={graph.nodes.length === 0}
                className={`rounded border px-2 py-1 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  executionInspectorEnabled
                    ? "border-[#a6e3a1]/60 bg-[#a6e3a1]/20 text-[#a6e3a1]"
                    : "border-[#313244] bg-[#11111b] text-[#cdd6f4] hover:border-[#a6e3a1]/50 hover:text-[#a6e3a1]"
                }`}
              >
                Inspecionar execucao
              </button>
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
                onClick={() => setView({ x: 0, y: 0, zoom: 1 })}
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
          </aside>
        )}

        {/* Background group boxes */}
        {groupBoxes.map((group) => (
          <div
            key={`group-${group.categoryId}`}
            data-testid={`nodegraph-group-box-${group.categoryId}`}
            className="absolute rounded-2xl border text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{
              left: group.x * view.zoom + view.x,
              top: group.y * view.zoom + view.y,
              width: group.width * view.zoom,
              height: group.height * view.zoom,
              borderColor: `${group.color}55`,
              backgroundColor: `${group.color}12`,
              color: group.color,
              zIndex: 0,
              pointerEvents: group.pointerEvents,
            }}
          >
            <span className="absolute left-3 top-2 rounded bg-[#11111b]/80 px-2 py-0.5">
              {group.label}
            </span>
          </div>
        ))}

        {/* SVG edges */}
        <svg
          ref={svgRef}
          className="absolute inset-0 z-[1] h-full w-full pointer-events-none"
        >
          {graph.edges.map((edge) => {
            const from = graph.nodes.find((n) => n.id === edge.fromNode);
            const to   = graph.nodes.find((n) => n.id === edge.toNode);
            if (!from || !to) return null;
            const hovered = hoveredEdgeId === edge.id;
            const active = activeEdgeId === edge.id;
            return (
              <path
                key={edge.id}
                data-testid={`nodegraph-edge-${edge.id}`}
                data-hovered={hovered ? "true" : undefined}
                data-active={active ? "true" : undefined}
                d={edgePath(from, to)}
                fill="none"
                stroke={active ? "#f9e2af" : hovered ? "#89b4fa" : "#a6e3a1"}
                strokeWidth={hovered || active ? 3 : 1.5}
                strokeOpacity={hovered || active ? 0.95 : 0.7}
                style={{ pointerEvents: "stroke" }}
                ref={(element) => {
                  if (!element) {
                    return;
                  }
                  element.onpointerenter = () => setHoveredEdgeId(edge.id);
                  element.onmouseenter = () => setHoveredEdgeId(edge.id);
                }}
                onPointerEnter={() => setHoveredEdgeId(edge.id)}
                onPointerOver={() => setHoveredEdgeId(edge.id)}
                onPointerLeave={() => setHoveredEdgeId((current) => (current === edge.id ? null : current))}
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseOver={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId((current) => (current === edge.id ? null : current))}
                onPointerDown={() => setActiveEdgeId(edge.id)}
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
            const x1 = from.x * view.zoom + view.x + NODE_CARD_WIDTH * view.zoom;
            const y1 = from.y * view.zoom + view.y + 24 * view.zoom;
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
            screenX={node.x * view.zoom + view.x}
            screenY={node.y * view.zoom + view.y}
            zoom={view.zoom}
            selected={node.id === selectedId}
            executionReachable={reachableExecutionNodeIds.has(node.id)}
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
            className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[24rem] rounded-xl border border-[#313244] bg-[#181825]/95 px-4 py-3 text-[11px] shadow-lg backdrop-blur-sm"
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
          <div className="pointer-events-none absolute bottom-3 right-3 rounded border border-[#fab387]/40 bg-[#181825]/95 px-3 py-2 text-[10px] text-[#fab387] shadow-lg">
            Grafo sem conexoes: arraste de uma saida para uma entrada para ligar o fluxo.
          </div>
        )}
      </div>
    </div>
  );
}
