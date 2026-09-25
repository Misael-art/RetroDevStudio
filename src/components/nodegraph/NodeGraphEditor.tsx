import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react";
import { persistActiveScene, registerPendingEditFlusher } from "../../core/scenePersistence";
import { openProjectSourcePath } from "../../core/ipc/projectService";
import { parseSceneJson, resolveScenePrefabs } from "../../core/ipc/sceneService";
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
import {
  EVENT_NODE_TYPES,
  LOCAL_TRACE_EVIDENCE_LABEL,
  normalizeGraphEntityKey,
  resolveRuntimeEvidenceForGraph,
  runNodeGraphLocally,
  validateNodeGraph,
} from "../../core/nodegraph/nodeEngine";

// Contrato canonico do Node Engine (validador deterministico + simulacao
// local) vive em src/core/nodegraph/nodeEngine.ts; este arquivo re-exporta a
// superficie publica para preservar os consumidores existentes.
export { EVENT_NODE_TYPES, validateNodeGraph } from "../../core/nodegraph/nodeEngine";
import { readProjectAssetBytes } from "../../core/ipc/toolsService";
import { summarizeRules } from "../../core/nodegraph/ruleSummary";
import {
  addPassage,
  listPassages,
  updatePassage,
  validatePassages,
  type PassagePatch,
} from "../../core/nodegraph/passageAuthoring";
export type {
  NodeGraphValidation,
  NodeGraphValidationContext,
  NodeGraphValidationIssue,
} from "../../core/nodegraph/nodeEngine";
import {
  EMPTY_GRAPH,
  cloneGraph,
  serializeNodeGraph,
  type GraphNode,
  type NodeEdge,
  type NodeGraph,
  type NodeType,
} from "../../core/nodegraph/nodeTypes";
import { NODE_DEFS, clonePorts, deserializeNodeGraph } from "../../core/nodegraph/nodeDefinitions";
import {
  INPUT_MODE_HELP,
  MEGADRIVE_INPUT_BUTTONS,
  NODE_CATALOG,
  NODE_CATEGORIES,
  NODE_PALETTE_GROUP_ORDER,
  PORT_VISUAL_COLORS,
  describeInputButton,
  describeNodeAction,
  getNodeCatalogEntry,
  getNodeCategory,
  getNodeEntityRefs,
  getPortDisplayLabel,
  getPortVisualKind,
  checkConnection,
  type NodeIconName,
} from "../../core/nodegraph/nodeCatalog";
import {
  NODE_CARD_LAYOUT_WIDTH,
  estimateNodeCardSize,
  findNodeOverlaps,
  graphSemanticSignature,
  layoutNodeGraph,
  routeEdgePath,
  type CollapsedOccupant,
  type LayoutConflict,
  type NodeSize,
} from "../../core/nodegraph/nodeLayout";
import {
  emptyGraphHistory,
  recordGraphHistory,
  redoGraphHistory,
  registerGraphHistoryHandler,
  undoGraphHistory,
  type GraphHistory,
} from "../../core/nodegraph/graphHistory";
import Icon from "../common/Icon";
import BehaviorPanel from "./BehaviorPanel";
import { buildBehaviorSceneContext } from "../../core/nodegraph/behaviorLibrary";
import AssetPreview from "../common/AssetPreview";

// Modelo de dados canonico e serializacao v1 vivem em src/core/nodegraph/
// (nodeTypes.ts + nodeDefinitions.ts); este componente e apresentacao e
// re-exporta a superficie publica por compatibilidade.
export { EMPTY_GRAPH, serializeNodeGraph } from "../../core/nodegraph/nodeTypes";
export { deserializeNodeGraph } from "../../core/nodegraph/nodeDefinitions";
export type {
  GraphNode,
  NodeEdge,
  NodeGraph,
  NodeGraphGroup,
  NodePort,
  NodeType,
} from "../../core/nodegraph/nodeTypes";


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

const NODE_CARD_WIDTH = NODE_CARD_LAYOUT_WIDTH;
const NODE_CARD_HEIGHT = 56;
const FOCUS_PADDING = 24;
const MINIMAP_WIDTH = 176;
const MINIMAP_HEIGHT = 112;
const MINIMAP_PADDING = 10;
const NODEGRAPH_GRID_SIZE = 24;
const NODEGRAPH_MIN_ZOOM = 0.35;
const NODEGRAPH_MAX_ZOOM = 2.4;

export type NodeVisualCategoryId = import("../../core/nodegraph/nodeCatalog").NodeCategoryId;

export type NodeVisualCategory = {
  id: NodeVisualCategoryId;
  label: string;
  color: string;
};

/** Caixa de fundo de um grupo nomeavel (comportamento) criado pelo autor. */
export type NodeGraphGroupBox = {
  groupId: string;
  label: string;
  nodeIds: string[];
  collapsed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  zIndex: number;
};

export type NodeGraphWheelZoomInput = {
  clientX: number;
  clientY: number;
  deltaY: number;
  rect: Pick<DOMRect, "left" | "top"> | { left: number; top: number };
  view: NodeGraphView;
};

/** Categorias de classificacao/busca; vivem no registro unico `nodeCatalog.ts`. */
export const NODE_VISUAL_CATEGORIES: NodeVisualCategory[] = NODE_CATEGORIES;

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

const GROUP_COLORS = ["#89b4fa", "#a6e3a1", "#f9e2af", "#cba6f7", "#94e2d5", "#fab387", "#f5c2e7"];
const GROUP_PADDING = 28;
const GROUP_HEADER = 26;
export const COLLAPSED_GROUP_SIZE = { width: 240, height: 64 };

/**
 * Caixas dos grupos nomeaveis (comportamentos). Categorias nao geram caixas: elas
 * classificam e alimentam a busca, enquanto o espaco do canvas segue o comportamento.
 */
export function buildNodeGraphGroupBoxes(
  graph: NodeGraph,
  sizeOf: (node: GraphNode) => NodeSize = (node) => estimateNodeCardSize(node)
): NodeGraphGroupBox[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return (graph.groups ?? []).flatMap((group, index) => {
    const nodes = group.nodeIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
    if (nodes.length === 0) return [];
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const collapsed = Boolean(group.collapsed);
    const maxX = collapsed ? minX + COLLAPSED_GROUP_SIZE.width : Math.max(...nodes.map((node) => node.x + sizeOf(node).width));
    const maxY = collapsed ? minY + COLLAPSED_GROUP_SIZE.height : Math.max(...nodes.map((node) => node.y + sizeOf(node).height));
    return [
      {
        groupId: group.id,
        label: group.label,
        nodeIds: nodes.map((node) => node.id),
        collapsed,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - GROUP_HEADER,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER,
        color: GROUP_COLORS[index % GROUP_COLORS.length],
        zIndex: 0,
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

export const NODE_DISPLAY_NAMES: Record<NodeType, string> = Object.fromEntries(
  Object.values(NODE_CATALOG).map((entry) => [entry.type, entry.title])
) as Record<NodeType, string>;

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
  action: "Acao",
  track: "Musica",
  fade_ms: "Fade futuro (ms)",
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
  register: "Registrador",
  immediate: "Imediato",
  width_bits: "Largura (bits)",
  signedness: "Sinal",
  rom_sha256: "SHA-256 da ROM",
  rom_start: "Inicio ROM",
  rom_end: "Fim ROM",
  instruction_offsets: "Offsets",
  flags: "Flags",
  semantic: "Semantica",
  authoring_origin: "Origem",
  memory_effects: "Efeito memoria",
  profile_id: "Perfil",
  input_var: "Variavel de entrada",
  bias: "Soma word",
  threshold: "Limiar",
  result_var: "Variavel de resultado",
  output_address: "Endereco de escrita",
  semantic_stages: "Etapas semanticas",
};

const PALETTE_GROUP_ICONS: Record<string, NodeIconName> = {
  Eventos: "flash",
  Movimento: "arrows",
  Condicoes: "fork",
  Camera: "camera",
  Tilemap: "grid",
  Som: "sound",
  Variaveis: "variable",
  Fluxo: "clock",
  Estados: "chip",
  Efeitos: "layers",
  Hardware: "warning-triangle",
  "ROM recuperada": "chip",
};

/** Paleta lateral derivada do registro unico (`nodeCatalog.ts`). */
const NODE_PALETTE_GROUPS: Array<{ label: string; icon: NodeIconName; types: NodeType[] }> = NODE_PALETTE_GROUP_ORDER.map(
  (label) => ({
    label,
    icon: PALETTE_GROUP_ICONS[label] ?? "chip",
    types: Object.values(NODE_CATALOG)
      .filter((entry) => entry.paletteGroup === label)
      .map((entry) => entry.type),
  })
);

/**
 * "Organizar visualmente": so reposiciona (ver `layoutNodeGraph`). Nao cria nem remove
 * conexoes e nao reordena os nos.
 */
export function autoLayoutNodeGraph(graph: NodeGraph): NodeGraph {
  return layoutNodeGraph(graph).graph;
}

export function getNodeDisplayName(type: NodeType): string {
  return NODE_DISPLAY_NAMES[type] ?? type;
}

export function getNodeParamDisplayName(key: string): string {
  return NODE_PARAM_DISPLAY_NAMES[key] ?? key;
}

// ── Counter for unique IDs ────────────────────────────────────────────────────
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

/** Medidas reais de um cartao (coordenadas do mundo, sem zoom). */
export type NodeCardMetrics = {
  width: number;
  height: number;
  /** Centro de cada porta relativo ao canto do cartao; chave `in:<id>` ou `out:<id>`. */
  ports: Record<string, { x: number; y: number }>;
};

/** Entidade afetada pelo no, com o recurso visual real quando houver. */
export type NodeCardEntity = {
  entityId: string;
  label: string;
  spriteAsset: string | null;
  frameWidth: number;
  frameHeight: number;
};

const CARD_HEADER_HEIGHT = 30;
const CARD_ACTION_HEIGHT = 36;
const CARD_ENTITY_HEIGHT = 24;
const CARD_PORT_ROW = 20;

/** Parametros que o cartao edita diretamente (o compilador le exatamente esses campos). */
function cardEditableParam(node: GraphNode, key: string): "number" | "button" | null {
  if ((node.type === "input_pressed" || node.type === "input_held") && key === "button") return "button";
  if (node.type === "set_velocity" && (key === "vx" || key === "vy")) return "number";
  if (node.type === "sprite_move" && (key === "dx" || key === "dy")) return "number";
  if (node.type === "rom_branch_compare_word" && key === "threshold") return "number";
  if (
    node.type === "condition_compare" &&
    node.params.authoring_origin === "authored_builtin_reference_platformer" &&
    key === "b"
  ) {
    return "number";
  }
  return null;
}

export function isCardEditableParam(node: GraphNode, key: string): boolean {
  return cardEditableParam(node, key) !== null;
}

function estimatedPortAnchor(node: GraphNode, portId: string, output: boolean, width: number): { x: number; y: number } {
  const ports = output ? node.outputs : node.inputs;
  const index = Math.max(0, ports.findIndex((port) => port.id === portId));
  return {
    x: output ? width : 0,
    y: CARD_HEADER_HEIGHT + CARD_ACTION_HEIGHT + CARD_ENTITY_HEIGHT + 4 + index * CARD_PORT_ROW + CARD_PORT_ROW / 2,
  };
}

/** Ancora de uma porta em coordenadas do mundo: medida no DOM ou estimada pela estrutura. */
export function getPortAnchor(
  node: GraphNode,
  portId: string,
  output: boolean,
  metrics?: NodeCardMetrics
): { x: number; y: number } {
  const measured = metrics?.ports[`${output ? "out" : "in"}:${portId}`];
  const local = measured ?? estimatedPortAnchor(node, portId, output, metrics?.width ?? NODE_CARD_WIDTH);
  return { x: node.x + local.x, y: node.y + local.y };
}

interface NodeCardProps {
  node: GraphNode;
  screenX: number;
  screenY: number;
  zoom: number;
  selected: boolean;
  executionReachable?: boolean;
  entity: NodeCardEntity | null;
  projectDir: string | null;
  detailsOpen: boolean;
  /** Porta de entrada destacada pelo ima durante uma conexao (`in:<id>`). */
  snapPortKey: string | null;
  /** Portas de entrada compativeis com a conexao em andamento. */
  compatiblePortIds: Set<string> | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
  onPortMouseUp: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
  onParamChange: (nodeId: string, key: string, value: string | number) => void;
  onToggleDetails: (nodeId: string) => void;
  onMeasure: (nodeId: string, metrics: NodeCardMetrics) => void;
}

function EntityThumbnail({ entity, projectDir }: { entity: NodeCardEntity; projectDir: string | null }) {
  const box = 22;
  if (!entity.spriteAsset || !projectDir) {
    return <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded bg-[#313244] text-[9px] text-[#a6adc8]">{entity.label.slice(0, 1).toUpperCase()}</span>;
  }
  // Mostra so o primeiro quadro (canto superior esquerdo da folha), escalado para caber.
  const scale = box / Math.max(1, entity.frameWidth, entity.frameHeight);
  return (
    <span
      data-testid="node-entity-thumbnail"
      data-asset={entity.spriteAsset}
      className="relative block shrink-0 overflow-hidden rounded bg-[#11111b]"
      style={{ width: Math.round(entity.frameWidth * scale), height: Math.round(entity.frameHeight * scale) }}
      title={`${entity.label} — ${entity.spriteAsset}`}
    >
      <span className="absolute left-0 top-0 block" style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <AssetPreview
          alt={entity.label}
          projectDir={projectDir}
          relativePath={entity.spriteAsset}
          imageClassName="max-w-none"
          fallbackClassName="h-4 w-4"
          fallbackLabel=""
          pixelated
        />
      </span>
    </span>
  );
}

function NodeCard({
  node,
  screenX,
  screenY,
  zoom,
  selected,
  executionReachable = false,
  entity,
  projectDir,
  detailsOpen,
  snapPortKey,
  compatiblePortIds,
  onMouseDown,
  onPortMouseDown,
  onPortMouseUp,
  onParamChange,
  onToggleDetails,
  onMeasure,
}: NodeCardProps) {
  const catalog = getNodeCatalogEntry(node.type);
  const category = getNodeCategory(node.type);
  const importBadges = getGraphNodeImportBadges(node);
  const editable = canEditGraphNode(node);
  const essential = (catalog?.essentialParams ?? []).filter((key) => key in node.params);
  const technical = Object.entries(node.params).filter(([key]) => !essential.includes(key));
  const cardRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef(onMeasure);
  measureRef.current = onMeasure;

  // Mede tamanho e centros das portas sem zoom; so notifica quando algo mudou.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || card.offsetWidth === 0) return;
    // Unidades de layout (offset*): independem do zoom do canvas, da escala da pagina e
    // da rotacao das portas de execucao.
    const ports: NodeCardMetrics["ports"] = {};
    card.querySelectorAll<HTMLElement>("[data-port-key]").forEach((element) => {
      let x = element.offsetWidth / 2 + card.clientLeft;
      let y = element.offsetHeight / 2 + card.clientTop;
      let current: HTMLElement | null = element;
      while (current && current !== card) {
        x += current.offsetLeft;
        y += current.offsetTop;
        current = current.offsetParent as HTMLElement | null;
      }
      if (current === card) ports[element.dataset.portKey!] = { x: Math.round(x), y: Math.round(y) };
    });
    measureRef.current(node.id, { width: card.offsetWidth, height: card.offsetHeight, ports });
  });

  const renderPort = (port: GraphNode["inputs"][number], output: boolean) => {
    const kind = getPortVisualKind(port);
    const key = `${output ? "out" : "in"}:${port.id}`;
    const snapped = snapPortKey === key;
    const compatible = !output && compatiblePortIds?.has(port.id);
    const label = getPortDisplayLabel(port);
    return (
      <div key={key} className={`flex h-5 items-center gap-1.5 ${output ? "justify-end" : ""}`}>
        {output && label ? <span className="text-[10px]" style={{ color: kind === "exec" ? "#a6adc8" : PORT_VISUAL_COLORS[kind] }}>{label}</span> : null}
        <div
          data-testid={`node-port-${node.id}-${key.replace(":", "-")}`}
          data-port-key={key}
          data-port-kind={kind}
          data-snapped={snapped ? "true" : undefined}
          data-compatible={compatible ? "true" : undefined}
          title={`${kind === "exec" ? "Execucao" : kind === "data" ? `Dado${port.dataType ? ` (${port.dataType})` : ""}` : kind === "true" ? "Saida Sim" : "Saida Nao"}: ${port.id}`}
          className={`port-handle shrink-0 cursor-crosshair border-2 ${kind === "data" ? "h-3 w-3 rounded-full" : "h-3 w-3 rotate-45 rounded-[2px]"} ${
            snapped ? "scale-150 ring-2 ring-[#f9e2af]" : compatible ? "ring-2 ring-[#f9e2af]/50" : ""
          }`}
          style={{ borderColor: PORT_VISUAL_COLORS[kind], backgroundColor: `${PORT_VISUAL_COLORS[kind]}${kind === "data" ? "66" : "cc"}` }}
          onMouseDown={(e) => onPortMouseDown(e, port.id, output)}
          onMouseUp={(e) => onPortMouseUp(e, port.id, output)}
        />
        {!output && label ? <span className="text-[10px]" style={{ color: kind === "exec" ? "#a6adc8" : PORT_VISUAL_COLORS[kind] }}>{label}</span> : null}
      </div>
    );
  };

  const renderParamValue = (key: string, value: string | number) => {
    const mode = editable ? cardEditableParam(node, key) : null;
    if (mode === "button") {
      const current = describeInputButton(String(value));
      return (
        <select
          data-testid={`node-param-${node.id}-${key}`}
          aria-label={`Botao de ${catalog?.title ?? node.type}`}
          value={String(value)}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => onParamChange(node.id, key, event.target.value)}
          className="max-w-[120px] rounded border border-[#89b4fa]/50 bg-[#11111b] px-1 py-0.5 text-[10px] text-[#cdd6f4]"
        >
          {!MEGADRIVE_INPUT_BUTTONS.includes(String(value)) && <option value={String(value)}>{current.padLabel}</option>}
          {MEGADRIVE_INPUT_BUTTONS.map((button) => {
            const described = describeInputButton(button);
            return (
              <option key={button} value={button}>
                {described.padLabel}{described.keyLabel ? ` · tecla ${described.keyLabel}` : ""}
              </option>
            );
          })}
        </select>
      );
    }
    if (mode === "number") {
      return (
        <input
          data-testid={`node-param-${node.id}-${key}`}
          type="number"
          min={node.type === "set_velocity" || node.type === "sprite_move" ? -32768 : 0}
          max={32767}
          value={String(value)}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => onParamChange(node.id, key, Number.parseInt(event.target.value, 10) || 0)}
          className="w-16 rounded border border-[#cba6f7]/50 bg-[#11111b] px-1 py-0.5 text-right font-mono text-[#cdd6f4] outline-none focus:border-[#f9e2af]"
        />
      );
    }
    return <span className="truncate font-mono text-[#cdd6f4]">{String(value)}</span>;
  };

  const paramLabel = (key: string) =>
    node.type === "condition_compare" && node.params.authoring_origin === "authored_builtin_reference_platformer" && key === "b"
      ? "Pontos para abrir passagem"
      : getNodeParamDisplayName(key);

  const button = node.type === "input_pressed" || node.type === "input_held" ? describeInputButton(String(node.params.button ?? "")) : null;

  return (
    <div
      ref={cardRef}
      data-testid={`node-card-${node.id}`}
      data-selected={selected ? "true" : undefined}
      data-editable={editable ? "true" : "false"}
      data-pinned={node.pinned ? "true" : undefined}
      data-x={node.x}
      data-y={node.y}
      data-execution-reachable={executionReachable ? "true" : undefined}
      className={`absolute select-none rounded-xl border bg-slate-900/95 shadow-lg ${
        selected ? "z-[3] ring-2 ring-blue-500 shadow-2xl" : "z-[2]"
      } ${executionReachable ? "ring-2 ring-[#a6e3a1] shadow-[0_0_24px_rgba(166,227,161,0.22)]" : ""} ${editable ? "" : "opacity-80"}`}
      style={{
        left: screenX,
        top: screenY,
        width: NODE_CARD_WIDTH,
        borderColor: `${category.color}66`,
        transform: `scale(${zoom})`,
        transformOrigin: "top left",
      }}
      onMouseDown={onMouseDown}
    >
      <div
        className="flex items-center gap-1.5 rounded-t-xl px-2 text-[11px] font-semibold text-white/95 cursor-grab"
        style={{ height: CARD_HEADER_HEIGHT, backgroundColor: `${category.color}33`, borderBottom: `1px solid ${category.color}55` }}
        title={`${category.label} · ${catalog?.description ?? ""}`}
      >
        <span style={{ color: category.color }}><Icon name={catalog?.icon ?? "chip"} size={14} /></span>
        <span className="min-w-0 flex-1 truncate">{catalog?.title ?? node.type}</span>
        {node.pinned ? <span data-testid={`node-pinned-${node.id}`} title="Posicao fixada: Organizar nao move este no"><Icon name="pin" size={12} /></span> : null}
      </div>

      <p
        data-testid={`node-action-${node.id}`}
        className="line-clamp-2 px-2 pt-1 text-[11px] leading-[15px] text-[#cdd6f4]"
        style={{ height: CARD_ACTION_HEIGHT }}
      >
        {describeNodeAction(node)}
      </p>

      <div className="flex items-center gap-1.5 px-2 text-[10px] text-[#a6adc8]" style={{ height: CARD_ENTITY_HEIGHT }}>
        {entity ? (
          <>
            <EntityThumbnail entity={entity} projectDir={projectDir} />
            <span data-testid={`node-entity-${node.id}`} className="min-w-0 truncate">Afeta: <span className="font-semibold text-[#94e2d5]">{entity.label}</span></span>
          </>
        ) : button ? (
          <span data-testid={`node-button-${node.id}`} className="flex min-w-0 items-center gap-1 truncate">
            <span className="rounded bg-[#313244] px-1 font-semibold text-[#cdd6f4]">{button.padLabel}</span>
            <span className="text-[#6c7086]">teclado</span>
            <kbd className="rounded border border-[#45475a] px-1 font-mono text-[#f9e2af]">{button.keyLabel ?? "—"}</kbd>
          </span>
        ) : (
          <span className="text-[#6c7086]">{category.label}</span>
        )}
      </div>

      {node.params.authoring_origin ? (
        <p data-testid={`node-origin-${node.id}`} className="truncate px-2 pb-0.5 font-mono text-[9px] text-[#7f849c]" title="Origem autoral (rastreabilidade)">
          origem: {String(node.params.authoring_origin)}
        </p>
      ) : null}
      {importBadges.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-2 pb-1">
          {importBadges.map((badge) => (
            <span
              key={badge.label}
              className={["rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]", importBadgeClass(badge.tone)].join(" ")}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2 px-2 pb-1 pt-1">
        <div className="flex flex-1 flex-col">{node.inputs.map((port) => renderPort(port, false))}</div>
        <div className="flex flex-col items-end">{node.outputs.map((port) => renderPort(port, true))}</div>
      </div>

      {essential.length > 0 && (
        <div className="flex flex-col border-t border-slate-700/50 px-2 py-1">
          {essential.map((key) => (
            <div key={key} className="flex h-5 items-center justify-between gap-2 text-[10px]">
              <span className="shrink-0 text-[#7f849c]">{paramLabel(key)}</span>
              {renderParamValue(key, node.params[key])}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        data-testid={`node-details-toggle-${node.id}`}
        aria-expanded={detailsOpen}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => onToggleDetails(node.id)}
        className="w-full rounded-b-xl border-t border-slate-700/50 px-2 py-0.5 text-left text-[9px] uppercase tracking-[0.12em] text-[#6c7086] hover:text-[#cdd6f4]"
      >
        {detailsOpen ? "▾" : "▸"} Detalhes tecnicos
      </button>
      {detailsOpen && (
        <div data-testid={`node-details-${node.id}`} className="border-t border-slate-700/50 px-2 pb-2 pt-1 font-mono text-[9px] text-[#a6adc8]">
          <div>id: {node.id}</div>
          <div>tipo: {node.type}</div>
          <div>rotulo: {node.label}</div>
          {technical.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2">
              <span className="text-[#6c7086]">{key}</span>
              {cardEditableParam(node, key) && editable ? renderParamValue(key, value) : <span className="truncate text-right text-[#cdd6f4]" title={String(value)}>{String(value)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Passage contract editor (Experimental): lists passages found in the graph by their
 * `passage_id`, edits their references (blocker, open-state variable, threshold) and adds
 * a new passage wired in front of the player's movement nodes.
 */
function PassagePanel({
  graph,
  entityIds,
  onGraphChange,
}: {
  graph: NodeGraph;
  entityIds: string[];
  onGraphChange: (graph: NodeGraph) => void;
}) {
  const passages = useMemo(() => listPassages(graph), [graph]);
  const issues = useMemo(() => validatePassages(graph, entityIds), [graph, entityIds]);
  const [draftBlocker, setDraftBlocker] = useState("");
  const [draftThreshold, setDraftThreshold] = useState("12");
  const [draftOpenVar, setDraftOpenVar] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  if (passages.length === 0) return null;
  const main = passages[0];
  const player = main.player ?? "player";
  const scoreVar = main.scoreVar ?? "reference_score";
  const usedBlockers = new Set(passages.map((passage) => passage.blocker));
  const candidateBlockers = entityIds.filter((id) => id !== player && !usedBlockers.has(id));
  const patch = (passageId: string, change: PassagePatch) => onGraphChange(updatePassage(graph, passageId, change));
  const inputClass = "w-full rounded border border-[#45475a] bg-[#11111b] px-1 py-0.5 font-mono text-[10px] text-[#cdd6f4]";

  function handleAdd() {
    const blocker = draftBlocker || candidateBlockers[0] || "";
    let index = passages.length + 1;
    while (passages.some((passage) => passage.passageId === `passage_${index}`)) index += 1;
    const passageId = `passage_${index}`;
    try {
      onGraphChange(addPassage(graph, {
        passageId,
        blocker,
        player,
        openVar: draftOpenVar.trim() || `${passageId}_open`,
        scoreVar,
        threshold: Number(draftThreshold),
      }));
      setAddError(null);
      setDraftOpenVar("");
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div data-testid="nodegraph-passages" className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/5 px-2 py-1.5 text-[10px] text-[#cdd6f4]">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Passagens (Experimental)</p>
      {passages.map((passage) => (
        <div key={passage.passageId} data-testid={`passage-${passage.passageId}`} className="mt-1 grid grid-cols-3 gap-1">
          <span className="col-span-3 font-mono text-[#a6adc8]">{passage.passageId}</span>
          <label className="flex flex-col gap-0.5">
            Bloqueador
            <select
              data-testid={`passage-${passage.passageId}-blocker`}
              value={passage.blocker ?? ""}
              onChange={(event) => patch(passage.passageId, { blocker: event.target.value })}
              className={inputClass}
            >
              {[...new Set([passage.blocker ?? "", ...entityIds])].filter(Boolean).map((id) => (
                <option key={id} value={id}>{id}{entityIds.includes(id) ? "" : " (ausente)"}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            Limiar
            <input
              data-testid={`passage-${passage.passageId}-threshold`}
              type="number"
              min={0}
              max={32767}
              value={passage.threshold ?? ""}
              onChange={(event) => patch(passage.passageId, { threshold: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            Estado
            <input
              data-testid={`passage-${passage.passageId}-openvar`}
              value={passage.openVar ?? ""}
              onChange={(event) => patch(passage.passageId, { openVar: event.target.value })}
              className={inputClass}
            />
          </label>
        </div>
      ))}
      <div className="mt-2 grid grid-cols-3 gap-1 border-t border-[#313244] pt-1">
        <select
          data-testid="passage-add-blocker"
          value={draftBlocker || candidateBlockers[0] || ""}
          onChange={(event) => setDraftBlocker(event.target.value)}
          className={inputClass}
        >
          {candidateBlockers.length === 0 && <option value="">(sem entidade livre)</option>}
          {candidateBlockers.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <input
          data-testid="passage-add-threshold"
          type="number"
          value={draftThreshold}
          onChange={(event) => setDraftThreshold(event.target.value)}
          className={inputClass}
        />
        <input
          data-testid="passage-add-openvar"
          placeholder="estado (auto)"
          value={draftOpenVar}
          onChange={(event) => setDraftOpenVar(event.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          data-testid="passage-add"
          onClick={handleAdd}
          className="col-span-3 rounded border border-[#89b4fa]/50 px-2 py-0.5 text-[#89b4fa] hover:bg-[#89b4fa]/10"
        >
          Adicionar passagem
        </button>
      </div>
      {addError && <p data-testid="passage-add-error" className="mt-1 text-[#f38ba8]">{addError}</p>}
      {issues.length > 0 && (
        <ul data-testid="passage-issues" className="mt-1 space-y-0.5 text-[#f38ba8]">
          {issues.map((issue) => <li key={`${issue.passageId}-${issue.code}`}>{issue.message}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * Sound bindings: every action_sound node of the graph, with a picker over the SFX the
 * entity declares (name -> WAV), a real preview of that WAV and validation of missing or
 * incompatible resources. Changing the picker edits the node's `sfx` param only.
 */
function SoundPanel({
  graph,
  sfx,
  projectDir,
  onGraphChange,
}: {
  graph: NodeGraph;
  sfx: Record<string, string>;
  projectDir: string | null;
  onGraphChange: (graph: NodeGraph) => void;
}) {
  const soundNodes = graph.nodes.filter((node) => node.type === "action_sound");
  const [previewState, setPreviewState] = useState<Record<string, string>>({});
  if (soundNodes.length === 0) return null;
  const names = Object.keys(sfx).sort();
  const issueFor = (name: string): string | null => {
    const asset = sfx[name];
    if (!asset) return `Som '${name}' não existe nos efeitos da cena.`;
    if (!/\.wav$/i.test(asset)) return `Som '${name}' usa '${asset}', mas o Mega Drive (XGM) só aceita WAV.`;
    return null;
  };
  async function preview(nodeId: string, name: string) {
    const asset = sfx[name];
    if (!asset || !projectDir) return;
    setPreviewState((current) => ({ ...current, [nodeId]: "Tocando…" }));
    try {
      const bytes = await readProjectAssetBytes(projectDir, asset);
      const AudioContextCtor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Áudio indisponível neste ambiente");
      const context = new AudioContextCtor();
      const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => void context.close();
      source.start();
      setPreviewState((current) => ({ ...current, [nodeId]: `Prévia: ${buffer.duration.toFixed(2)} s` }));
    } catch (error) {
      setPreviewState((current) => ({ ...current, [nodeId]: `Prévia falhou: ${error instanceof Error ? error.message : String(error)}` }));
    }
  }
  return (
    <div data-testid="nodegraph-sounds" className="rounded border border-[#f9e2af]/35 bg-[#f9e2af]/5 px-2 py-1.5 text-[10px] text-[#cdd6f4]">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">Sons</p>
      {soundNodes.map((node) => {
        const current = String(node.params.sfx ?? "");
        const issue = issueFor(current);
        return (
          <div key={node.id} data-testid={`sound-${node.id}`} className="mt-1 flex flex-wrap items-center gap-1">
            <span className="min-w-0 flex-1 truncate" title={node.id}>{node.label}</span>
            <select
              data-testid={`sound-${node.id}-select`}
              aria-label={`Som de ${node.label}`}
              value={current}
              onChange={(event) =>
                onGraphChange({
                  ...graph,
                  nodes: graph.nodes.map((candidate) =>
                    candidate.id === node.id ? { ...candidate, params: { ...candidate.params, sfx: event.target.value } } : candidate
                  ),
                })
              }
              className="rounded border border-[#45475a] bg-[#11111b] px-1 py-0.5 font-mono text-[10px]"
            >
              {!names.includes(current) && <option value={current}>{current || "(nenhum)"} (ausente)</option>}
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button
              type="button"
              data-testid={`sound-${node.id}-preview`}
              disabled={Boolean(issue)}
              onClick={() => void preview(node.id, current)}
              className="rounded border border-[#f9e2af]/50 px-2 py-0.5 text-[#f9e2af] disabled:opacity-40"
            >
              Ouvir
            </button>
            {previewState[node.id] && <span data-testid={`sound-${node.id}-preview-state`} className="w-full text-[#a6adc8]">{previewState[node.id]}</span>}
            {issue && <span data-testid={`sound-${node.id}-issue`} className="w-full text-[#f38ba8]">{issue}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Campos editaveis de um item de regra; edita o proprio no do grafo (mesma fonte da verdade). */
function RuleItemEditor({
  node,
  sfxNames,
  onParamChange,
  onSoundChange,
}: {
  node: GraphNode;
  sfxNames: string[];
  onParamChange: (nodeId: string, key: string, value: string | number) => void;
  onSoundChange: (nodeId: string, sfx: string) => void;
}) {
  if (!canEditGraphNode(node)) return null;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  if (node.type === "action_sound") {
    const current = String(node.params.sfx ?? "");
    return (
      <select
        data-testid={`rule-edit-${node.id}-sfx`}
        aria-label={`Som tocado por ${node.label}`}
        value={current}
        onClick={stop}
        onChange={(event) => onSoundChange(node.id, event.target.value)}
        className="ml-1 rounded border border-[#45475a] bg-[#11111b] px-1 font-mono text-[10px]"
      >
        {!sfxNames.includes(current) && <option value={current}>{current || "(nenhum)"}</option>}
        {sfxNames.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    );
  }
  const keys = Object.keys(node.params).filter((key) => isCardEditableParam(node, key));
  if (keys.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1">
      {keys.map((key) =>
        key === "button" ? (
          <select
            key={key}
            data-testid={`rule-edit-${node.id}-${key}`}
            aria-label={`Botao de ${node.label}`}
            value={String(node.params[key])}
            onClick={stop}
            onChange={(event) => onParamChange(node.id, key, event.target.value)}
            className="rounded border border-[#89b4fa]/50 bg-[#11111b] px-1 text-[10px]"
          >
            {MEGADRIVE_INPUT_BUTTONS.map((button) => {
              const described = describeInputButton(button);
              return (
                <option key={button} value={button}>
                  {described.padLabel}{described.keyLabel ? ` · tecla ${described.keyLabel}` : ""}
                </option>
              );
            })}
          </select>
        ) : (
          <label key={key} className="inline-flex items-center gap-0.5 text-[10px] text-[#a6adc8]">
            {getNodeParamDisplayName(key)}
            <input
              data-testid={`rule-edit-${node.id}-${key}`}
              type="number"
              value={String(node.params[key])}
              onClick={stop}
              onChange={(event) => onParamChange(node.id, key, Number.parseInt(event.target.value, 10) || 0)}
              className="w-14 rounded border border-[#cba6f7]/50 bg-[#11111b] px-1 text-right font-mono text-[10px]"
            />
          </label>
        )
      )}
    </span>
  );
}

/**
 * "Quando → Se → Fazer": le o grafo canonico e edita os parametros dos casos suportados
 * no proprio no. O caminho "senao" aparece; regras com lacos, varios caminhos ou nos sem
 * forma simples ficam marcadas e devem ser editadas no grafo avancado.
 */
function RulesPanel({
  graph,
  sfxNames,
  onFocusNode,
  onParamChange,
  onSoundChange,
}: {
  graph: NodeGraph;
  sfxNames: string[];
  onFocusNode: (nodeId: string) => void;
  onParamChange: (nodeId: string, key: string, value: string | number) => void;
  onSoundChange: (nodeId: string, sfx: string) => void;
}) {
  const rules = useMemo(() => summarizeRules(graph), [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  if (rules.length === 0) return null;
  const item = (entry: { text: string; nodeId: string }) => {
    const node = byId.get(entry.nodeId);
    return (
      <span key={entry.nodeId} data-testid={`rule-item-${entry.nodeId}`} className="inline-flex flex-wrap items-center">
        <button
          type="button"
          onClick={() => onFocusNode(entry.nodeId)}
          className="rounded px-0.5 text-left underline decoration-dotted underline-offset-2 hover:bg-[#313244]"
          title="Mostrar no grafo"
        >
          {entry.text}
        </button>
        {node ? <RuleItemEditor node={node} sfxNames={sfxNames} onParamChange={onParamChange} onSoundChange={onSoundChange} /> : null}
      </span>
    );
  };
  return (
    <div data-testid="nodegraph-rules" className="rounded border border-[#a6e3a1]/35 bg-[#a6e3a1]/5 px-2 py-1.5 text-[11px] text-[#cdd6f4]">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a6e3a1]">Regras (Quando → Se → Fazer)</p>
      <ol className="mt-1 space-y-1.5">
        {rules.map((rule) => (
          <li key={rule.id} data-testid={`rule-${rule.id}`} data-advanced={rule.advanced ? "true" : "false"} className="rounded px-1 py-0.5 hover:bg-[#313244]/40">
            <div>
              <span className="font-semibold text-[#a6e3a1]">Quando</span> {rule.when}
              {rule.conditionItems.length > 0 && (
                <>
                  {" "}· <span className="font-semibold text-[#f9e2af]">Se</span>{" "}
                  {rule.conditionItems.map((entry, index) => (
                    <span key={entry.nodeId}>{index > 0 ? " e " : ""}{item(entry)}</span>
                  ))}
                </>
              )}
              {" "}· <span className="font-semibold text-[#89b4fa]">Fazer</span>{" "}
              {rule.actionItems.length > 0 ? rule.actionItems.map((entry, index) => <span key={entry.nodeId}>{index > 0 ? ", " : ""}{item(entry)}</span>) : "nada"}
            </div>
            {rule.elseBranches.map((branch) => (
              <div key={branch.conditionNodeId} data-testid={`rule-else-${branch.conditionNodeId}`} className="pl-3 text-[10px]">
                <span className="font-semibold text-[#f38ba8]">Senão</span> (não {branch.condition}):{" "}
                {branch.actions.length > 0 ? branch.actions.map((entry, index) => <span key={entry.nodeId}>{index > 0 ? ", " : ""}{item(entry)}</span>) : "nada"}
              </div>
            ))}
            {rule.advanced && (
              <p className="pl-1 text-[10px] text-[#fab387]">Regra avançada: {rule.advanced}. Edite esse trecho no grafo; aqui aparecem os caminhos com forma simples.</p>
            )}
          </li>
        ))}
      </ol>
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
  const activeTarget = useEditorStore((state) => state.activeTarget);
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
  const [graph, setGraphState] = useState<NodeGraph>(() => cloneGraph(EMPTY_GRAPH));
  const currentGraphRef = useRef(graph);
  currentGraphRef.current = graph;
  const [history, setHistory] = useState<GraphHistory>(emptyGraphHistory);
  const historyRef = useRef(history);
  const lastHistoryKeyRef = useRef<{ key: string; at: number } | null>(null);
  /**
   * Toda alteracao do autor passa por aqui e entra no desfazer/refazer. `coalesceKey`
   * agrupa alteracoes seguidas do mesmo campo (digitacao) num unico passo.
   */
  const setGraph = useCallback(
    (updater: NodeGraph | ((current: NodeGraph) => NodeGraph), label = "Editar grafo", coalesceKey?: string) => {
      const previous = currentGraphRef.current;
      const next = typeof updater === "function" ? updater(previous) : updater;
      if (next === previous) return;
      const now = Date.now();
      const last = lastHistoryKeyRef.current;
      if (!(coalesceKey && last?.key === coalesceKey && now - last.at < 1500)) {
        historyRef.current = recordGraphHistory(historyRef.current, previous, label);
        setHistory(historyRef.current);
      }
      lastHistoryKeyRef.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      currentGraphRef.current = next;
      setGraphState(next);
    },
    []
  );
  /** Alteracao transitoria (arrasto em andamento): o passo de historico e gravado no fim. */
  const setGraphTransient = useCallback((updater: (current: NodeGraph) => NodeGraph) => {
    const next = updater(currentGraphRef.current);
    currentGraphRef.current = next;
    setGraphState(next);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dragging, setDragging] = useState<{
    nodeIds: string[];
    anchorX: number;
    anchorY: number;
    origins: Record<string, { x: number; y: number }>;
    before: NodeGraph;
    label: string;
  } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNode: string; fromPort: string; x: number; y: number } | null>(null);
  const [snapTarget, setSnapTarget] = useState<{ nodeId: string; portId: string } | null>(null);
  const [cardMetrics, setCardMetrics] = useState<Record<string, NodeCardMetrics>>({});
  const [openDetails, setOpenDetails] = useState<Set<string>>(() => new Set());
  const [layoutReport, setLayoutReport] = useState<{
    scope: "all" | "selection";
    moved: number;
    ms: number;
    overlaps: number;
    conflicts: LayoutConflict[];
  } | null>(null);
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
  // Pending (debounced) graph edit: flushed by Save and when the editor unmounts.
  const pendingCommitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const unregister = registerPendingEditFlusher(() => pendingCommitRef.current?.());
    return () => {
      unregister();
      pendingCommitRef.current?.();
    };
  }, []);
  const hydratingGraphRef = useRef(true);
  const lastPersistedGraphRef = useRef(serializeNodeGraph(INITIAL_GRAPH));
  const hydratedEntityIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const entityId = selectedEntity?.entity_id ?? null;
    // Trocar de entidade antes do debounce do autosave nao pode descartar a edicao
    // pendente da entidade anterior: grava-a antes de hidratar a nova.
    if (hydratedEntityIdRef.current !== null && hydratedEntityIdRef.current !== entityId) {
      pendingCommitRef.current?.();
    }
    const resetFromGraph = (nextGraph: NodeGraph) => {
      if (cancelled) {
        return;
      }
      // A scene change (e.g. another panel's autosave) re-runs this hydration, possibly
      // asynchronously. It must not overwrite local edits of the same entity that the
      // debounced autosave has not persisted yet.
      const hasUnsavedLocalEdits =
        serializeNodeGraph(currentGraphRef.current) !== lastPersistedGraphRef.current;
      if (hydratedEntityIdRef.current === entityId && hasUnsavedLocalEdits) {
        return;
      }
      if (hydratedEntityIdRef.current === entityId) {
        // Mesma entidade: eco do proprio salvamento (nada a fazer) ou alteracao feita por
        // outro painel. Nao zera historico, vista nem selecao; a mudanca externa vira um
        // passo desfazivel.
        const serialized = serializeNodeGraph(nextGraph);
        // Compara na forma canonica (deserializada): o eco do salvamento passa pelo
        // deserializador e nao deve virar um passo falso de historico.
        const current = serializeNodeGraph(deserializeNodeGraph(serializeNodeGraph(currentGraphRef.current)));
        if (serializeNodeGraph(deserializeNodeGraph(serialized)) !== current) {
          historyRef.current = recordGraphHistory(historyRef.current, currentGraphRef.current, "Atualizado por outro painel");
          setHistory(historyRef.current);
          hydratingGraphRef.current = true;
          currentGraphRef.current = nextGraph;
          setGraphState(nextGraph);
        }
        lastPersistedGraphRef.current = serialized;
        return;
      }
      hydratedEntityIdRef.current = entityId;
      hydratingGraphRef.current = true;
      currentGraphRef.current = nextGraph;
      setGraphState(nextGraph);
      historyRef.current = emptyGraphHistory();
      setHistory(historyRef.current);
      lastHistoryKeyRef.current = null;
      setLayoutReport(null);
      setSelectedId(null);
      setSelectedIds(new Set());
      setDragging(null);
      setPendingEdge(null);
      setSnapTarget(null);
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
      // Voltou ao estado persistido (ex.: refazer apos desfazer): nenhuma gravacao
      // pendente de um estado intermediario pode sobreviver.
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingCommitRef.current = null;
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    const commit = (persist: boolean) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingCommitRef.current = null;
      const latestState = useEditorStore.getState();
      const entity = latestState.activeScene?.entities.find(
        (item) => item.entity_id === selectedEntity.entity_id
      );
      // So grava o grafo que ainda e o atual desta entidade (nunca um estado obsoleto).
      if (!entity || lastPersistedGraphRef.current === serializedGraph || serializeNodeGraph(currentGraphRef.current) !== serializedGraph) {
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
      if (persist) void persistActiveScene(activeProjectDir, "Logic");
    };
    pendingCommitRef.current = () => commit(false);
    saveTimerRef.current = window.setTimeout(() => commit(true), 600);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeProjectDir, graph, selectedEntity, updateEntity]);

  // ── Coordenadas ────────────────────────────────────────────────────────────
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - view.x) / view.zoom,
      y: (clientY - (rect?.top ?? 0) - view.y) / view.zoom,
    };
  }, [view.x, view.y, view.zoom]);

  const nodeSizeOf = useCallback(
    (node: GraphNode): NodeSize => {
      const measured = cardMetrics[node.id];
      return measured ? { width: measured.width, height: measured.height } : estimateNodeCardSize(node);
    },
    [cardMetrics]
  );

  const onCardMeasure = useCallback((nodeId: string, metrics: NodeCardMetrics) => {
    setCardMetrics((current) => {
      const previous = current[nodeId];
      if (previous && JSON.stringify(previous) === JSON.stringify(metrics)) return current;
      return { ...current, [nodeId]: metrics };
    });
  }, []);

  const startDrag = useCallback((e: React.MouseEvent, nodeIds: string[], label: string) => {
    const world = clientToWorld(e.clientX, e.clientY);
    const origins: Record<string, { x: number; y: number }> = {};
    for (const node of currentGraphRef.current.nodes) {
      if (nodeIds.includes(node.id)) origins[node.id] = { x: node.x, y: node.y };
    }
    setDragging({ nodeIds, anchorX: world.x, anchorY: world.y, origins, before: currentGraphRef.current, label });
  }, [clientToWorld]);

  // ── Drag node ──────────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (spacePressed && e.button === 0) {
      return;
    }
    e.stopPropagation();
    if (e.button !== 0) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.classList.contains("cursor-crosshair") || target.closest("input, select, button, textarea")) return;
    let nextSelection: Set<string>;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      nextSelection = new Set(selectedIds);
      if (nextSelection.has(nodeId)) nextSelection.delete(nodeId);
      else nextSelection.add(nodeId);
    } else {
      nextSelection = selectedIds.has(nodeId) ? new Set(selectedIds) : new Set([nodeId]);
    }
    setSelectedIds(nextSelection);
    setSelectedId(nextSelection.has(nodeId) ? nodeId : [...nextSelection][0] ?? null);
    if (!nextSelection.has(nodeId)) return;
    startDrag(e, [...nextSelection], nextSelection.size > 1 ? `Mover ${nextSelection.size} nos` : "Mover no");
  }, [selectedIds, spacePressed, startDrag]);

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
      const world = clientToWorld(e.clientX, e.clientY);
      const delta = snapNodeGraphPoint({ x: world.x - dragging.anchorX, y: world.y - dragging.anchorY });
      setGraphTransient((g) => ({
        ...g,
        nodes: g.nodes.map((n) => {
          const origin = dragging.origins[n.id];
          return origin ? { ...n, x: origin.x + delta.x, y: origin.y + delta.y } : n;
        }),
      }));
    }
    if (pendingEdge) {
      setPendingEdge((p) => p ? { ...p, x: e.clientX, y: e.clientY } : null);
      // Ima: a entrada compativel mais proxima (ate 40 px na tela) fica destacada.
      const world = clientToWorld(e.clientX, e.clientY);
      const current = currentGraphRef.current;
      let best: { nodeId: string; portId: string; distance: number } | null = null;
      for (const node of current.nodes) {
        if (hiddenNodeIdsRef.current.has(node.id)) continue;
        for (const port of node.inputs) {
          if (!checkConnection(current, pendingEdge.fromNode, pendingEdge.fromPort, node.id, port.id).ok) continue;
          const anchor = getPortAnchor(node, port.id, false, cardMetrics[node.id]);
          const distance = Math.hypot(anchor.x - world.x, anchor.y - world.y) * view.zoom;
          if (distance <= 40 && (!best || distance < best.distance)) best = { nodeId: node.id, portId: port.id, distance };
        }
      }
      setSnapTarget((previous) =>
        best
          ? previous?.nodeId === best.nodeId && previous.portId === best.portId ? previous : { nodeId: best.nodeId, portId: best.portId }
          : null
      );
    }
  }, [cardMetrics, clientToWorld, dragging, panning, pendingEdge, setGraphTransient, view.zoom]);

  const connectPorts = useCallback((fromNode: string, fromPort: string, toNode: string, toPort: string) => {
    const check = checkConnection(currentGraphRef.current, fromNode, fromPort, toNode, toPort);
    if (!check.ok) {
      logMessage("warn", `[NodeGraph] Conexao recusada: ${check.reason}.`);
      return false;
    }
    const edge: NodeEdge = { id: newEdgeId(), fromNode, fromPort, toNode, toPort };
    setGraph((g) => ({ ...g, edges: [...g.edges, edge] }), "Conectar");
    logMessage("info", `Conexão criada: ${edge.fromNode}:${edge.fromPort} → ${edge.toNode}:${edge.toPort}`);
    return true;
  }, [logMessage, setGraph]);

  const onMouseUp = useCallback(() => {
    if (dragging) {
      const moved = dragging.nodeIds.some((id) => {
        const node = currentGraphRef.current.nodes.find((candidate) => candidate.id === id);
        const origin = dragging.origins[id];
        return node && origin && (node.x !== origin.x || node.y !== origin.y);
      });
      if (moved) {
        // Um unico passo de desfazer por arrasto; so posicoes mudam.
        historyRef.current = recordGraphHistory(historyRef.current, dragging.before, dragging.label);
        setHistory(historyRef.current);
        lastHistoryKeyRef.current = null;
      }
    }
    if (pendingEdge && snapTarget) {
      // Soltar o botao com uma entrada destacada e a acao explicita que confirma a ligacao.
      connectPorts(pendingEdge.fromNode, pendingEdge.fromPort, snapTarget.nodeId, snapTarget.portId);
    }
    setDragging(null);
    setPendingEdge(null);
    setSnapTarget(null);
    panningRef.current = null;
    setPanning(null);
    setActiveEdgeId(null);
  }, [connectPorts, dragging, pendingEdge, snapTarget]);

  useEffect(() => {
    if (!pendingEdge) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingEdge(null);
        setSnapTarget(null);
        logMessage("info", "[NodeGraph] Conexao cancelada (Esc). Nada foi alterado.");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [logMessage, pendingEdge]);

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
    setSelectedIds(new Set());
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
      setSnapTarget(null);
    }
  }, []);

  const onPortMouseUp = useCallback((e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => {
    e.stopPropagation();
    if (!pendingEdge || isOutput) return;
    connectPorts(pendingEdge.fromNode, pendingEdge.fromPort, nodeId, portId);
    setPendingEdge(null);
    setSnapTarget(null);
  }, [connectPorts, pendingEdge]);

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
    }, "Criar conexoes pela posicao");
  }, [logMessage, setGraph]);

  // ── Delete selected node ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Backspace/Delete dentro de um campo edita o texto; nunca apaga o no.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      const doomed = selectedIds.size > 0 ? selectedIds : selectedId ? new Set([selectedId]) : null;
      if ((e.key === "Delete" || e.key === "Backspace") && doomed) {
        setGraph(
          (g) => ({
            ...g,
            nodes: g.nodes.filter((n) => !doomed.has(n.id)),
            edges: g.edges.filter((edge) => !doomed.has(edge.fromNode) && !doomed.has(edge.toNode)),
            ...(g.groups
              ? { groups: g.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !doomed.has(id)) })).filter((group) => group.nodeIds.length > 0) }
              : {}),
          }),
          doomed.size > 1 ? `Apagar ${doomed.size} nos` : "Apagar no"
        );
        setSelectedId(null);
        setSelectedIds(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedIds, setGraph]);

  // ── Edge SVG path ─────────────────────────────────────────────────────────
  // Ancorado no centro real das portas (medido no DOM, sem zoom) e convertido para a tela.
  const toScreen = (point: { x: number; y: number }) => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });

  const graphSummary = useMemo(() => summarizeNodeGraph(graph), [graph]);
  const graphValidation = useMemo(
    () =>
      validateNodeGraph(graph, {
        selectedEntity,
        sceneEntities: activeScene?.entities ?? [],
        target: activeTarget,
      }),
    [activeScene?.entities, activeTarget, graph, selectedEntity]
  );
  const localRun = useMemo(
    () =>
      runNodeGraphLocally(graph, {
        selectedEntity,
        sceneEntities: activeScene?.entities ?? [],
      }),
    [activeScene?.entities, graph, selectedEntity]
  );
  const localTrace = localRun.status === "success" ? localRun.trace : null;
  const runtimeMapping = useMemo(() => resolveRuntimeEvidenceForGraph(), []);
  const reachableExecutionNodeIds = useMemo(
    () =>
      executionInspectorEnabled && localTrace
        ? new Set(localTrace.reachableNodeIds)
        : new Set<string>(),
    [localTrace, executionInspectorEnabled]
  );
  const graphValidationPreview = [...graphValidation.errors, ...graphValidation.warnings].slice(0, 3);
  const miniMapNodes = useMemo(
    () => buildNodeMiniMap(graph, MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_PADDING),
    [graph]
  );
  const groupBoxes = useMemo(() => buildNodeGraphGroupBoxes(graph, nodeSizeOf), [graph, nodeSizeOf]);
  /** Nos de grupos recolhidos: continuam no grafo (e na ROM), so nao sao desenhados. */
  const hiddenNodeIds = useMemo(
    () => new Set(groupBoxes.filter((box) => box.collapsed).flatMap((box) => box.nodeIds)),
    [groupBoxes]
  );
  const hiddenNodeIdsRef = useRef(hiddenNodeIds);
  hiddenNodeIdsRef.current = hiddenNodeIds;
  /** Caixas recolhidas ocupam espaco no lugar dos membros ocultos. */
  const collapsedOccupants = useMemo<CollapsedOccupant[]>(
    () =>
      groupBoxes
        .filter((box) => box.collapsed)
        .map((box) => ({ id: box.groupId, label: box.label, nodeIds: box.nodeIds, rect: { x: box.x, y: box.y, width: box.width, height: box.height } })),
    [groupBoxes]
  );
  const collapsedOccupantsRef = useRef(collapsedOccupants);
  collapsedOccupantsRef.current = collapsedOccupants;
  /** Cartoes visiveis cobertos por um grupo recolhido (mostrado como aviso; nada e movido sozinho). */
  const collapsedCoverage = useMemo(
    () =>
      findNodeOverlaps(graph, nodeSizeOf, hiddenNodeIds, collapsedOccupants)
        .map(([a, b]) => (a.startsWith("group:") ? [a, b] : [b, a]))
        .filter(([group, other]) => group.startsWith("group:") && !other.startsWith("group:"))
        .map(([group, other]) => ({
          group: collapsedOccupants.find((item) => `group:${item.id}` === group)?.label ?? group,
          node: graph.nodes.find((node) => node.id === other)?.label ?? other,
          nodeId: other,
        })),
    [collapsedOccupants, graph, hiddenNodeIds, nodeSizeOf]
  );

  // ── Desfazer / refazer ──────────────────────────────────────────────────────
  const undoGraph = useCallback(() => {
    const result = undoGraphHistory(historyRef.current, currentGraphRef.current);
    if (!result) {
      logMessage("info", "[NodeGraph] Nada para desfazer.");
      return;
    }
    historyRef.current = result.history;
    setHistory(result.history);
    lastHistoryKeyRef.current = null;
    currentGraphRef.current = result.graph;
    setGraphState(result.graph);
    logMessage("info", `[NodeGraph] Desfeito: ${result.label}.`);
  }, [logMessage]);
  const redoGraph = useCallback(() => {
    const result = redoGraphHistory(historyRef.current, currentGraphRef.current);
    if (!result) {
      logMessage("info", "[NodeGraph] Nada para refazer.");
      return;
    }
    historyRef.current = result.history;
    setHistory(result.history);
    lastHistoryKeyRef.current = null;
    currentGraphRef.current = result.graph;
    setGraphState(result.graph);
    logMessage("info", `[NodeGraph] Refeito: ${result.label}.`);
  }, [logMessage]);
  useEffect(() => registerGraphHistoryHandler({ undo: undoGraph, redo: redoGraph }), [redoGraph, undoGraph]);

  // ── Organizar visualmente (so posicoes) ─────────────────────────────────────
  const fitViewTo = useCallback((nodes: GraphNode[]) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const width = rect?.width || canvasSize.width;
    const height = rect?.height || canvasSize.height;
    if (!nodes.length || !width || !height) return;
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + nodeSizeOf(node).width));
    const maxY = Math.max(...nodes.map((node) => node.y + nodeSizeOf(node).height));
    const zoom = clampNodeGraphZoom(Math.min(1, (width - 2 * FOCUS_PADDING) / (maxX - minX), (height - 2 * FOCUS_PADDING - 48) / (maxY - minY)));
    setView({ zoom, x: FOCUS_PADDING - minX * zoom, y: FOCUS_PADDING + 48 - minY * zoom });
  }, [canvasSize.height, canvasSize.width, nodeSizeOf]);

  const organizeGraph = useCallback((scope: "all" | "selection") => {
    const current = currentGraphRef.current;
    const selection = [...selectedIds];
    if (scope === "selection" && selection.length === 0) {
      logMessage("warn", "[NodeGraph] Selecione nos (Shift+clique ou 'Selecionar comportamento') para organizar a selecao.");
      return;
    }
    const started = performance.now();
    const result = layoutNodeGraph(current, {
      sizeOf: nodeSizeOf,
      scope: scope === "selection" ? selection : undefined,
      collapsed: collapsedOccupantsRef.current,
    });
    const ms = Math.round((performance.now() - started) * 10) / 10;
    if (graphSemanticSignature(result.graph) !== graphSemanticSignature(current)) {
      // Defesa: organizar nunca pode alterar a logica. Se acontecer, nada e aplicado.
      logMessage("error", "[NodeGraph] Organizar abortado: o resultado alteraria a logica do grafo.");
      return;
    }
    const overlaps = findNodeOverlaps(result.graph, nodeSizeOf, hiddenNodeIdsRef.current, collapsedOccupantsRef.current).length;
    setLayoutReport({ scope, moved: result.movedNodeIds.length, ms, overlaps, conflicts: result.conflicts });
    if (result.movedNodeIds.length > 0) {
      setGraph(result.graph, scope === "all" ? "Organizar tudo" : "Organizar selecao");
    }
    if (scope === "all") fitViewTo(result.graph.nodes);
    logMessage(
      result.conflicts.length ? "warn" : "info",
      `[NodeGraph] Organizar ${scope === "all" ? "tudo" : "selecao"}: ${result.movedNodeIds.length} no(s) movido(s) em ${ms} ms, ${overlaps} sobreposicao(oes), ${result.conflicts.length} conflito(s). Conexoes e parametros intactos.`
    );
  }, [fitViewTo, logMessage, nodeSizeOf, selectedIds, setGraph]);

  const selectionIds = useMemo(
    () => (selectedIds.size > 0 ? [...selectedIds] : selectedId ? [selectedId] : []),
    [selectedId, selectedIds]
  );

  const togglePinSelection = useCallback(() => {
    if (selectionIds.length === 0) return;
    const current = currentGraphRef.current;
    const pin = !selectionIds.every((id) => current.nodes.find((node) => node.id === id)?.pinned);
    setGraph(
      (g) => ({
        ...g,
        nodes: g.nodes.map((node) => {
          if (!selectionIds.includes(node.id)) return node;
          if (pin) return { ...node, pinned: true };
          const rest = { ...node };
          delete rest.pinned;
          return rest;
        }),
      }),
      pin ? "Fixar posicao" : "Soltar posicao"
    );
  }, [selectionIds, setGraph]);

  /** Seleciona o comportamento (componente conectado) do no atual. */
  const selectBehavior = useCallback((seedId?: string) => {
    const seed = seedId ?? selectedId;
    if (!seed) return;
    const current = currentGraphRef.current;
    const found = new Set([seed]);
    const queue = [seed];
    while (queue.length) {
      const id = queue.shift()!;
      for (const edge of current.edges) {
        const other = edge.fromNode === id ? edge.toNode : edge.toNode === id ? edge.fromNode : null;
        if (other && !found.has(other)) {
          found.add(other);
          queue.push(other);
        }
      }
    }
    setSelectedIds(found);
    setSelectedId(seed);
  }, [selectedId]);

  const suggestGroupName = useCallback((ids: string[]) => {
    const nodes = currentGraphRef.current.nodes.filter((node) => ids.includes(node.id));
    if (nodes.some((node) => node.type === "set_velocity" && Number(node.params.vy) < 0)) return "Pulo";
    if (nodes.some((node) => node.params.passage_role === "rule")) return "Abrir passagem";
    if (nodes.some((node) => node.params.passage_id)) return "Passagem";
    const held = nodes.find((node) => node.type === "input_held");
    if (held && String(held.params.button) === "BUTTON_RIGHT") return "Andar para a direita";
    if (held && String(held.params.button) === "BUTTON_LEFT") return "Andar para a esquerda";
    if (nodes.some((node) => node.type === "condition_overlap" && String(node.params.b).includes("goal"))) return "Objetivo";
    if (nodes.some((node) => node.type === "action_music")) return "Musica";
    return `Comportamento ${(currentGraphRef.current.groups?.length ?? 0) + 1}`;
  }, []);

  const groupSelection = useCallback(() => {
    if (selectionIds.length === 0) return;
    const label = suggestGroupName(selectionIds);
    const id = `group_${Date.now().toString(36)}`;
    setGraph(
      (g) => ({
        ...g,
        groups: [
          // Um no pertence a um unico grupo: sai do grupo anterior.
          ...(g.groups ?? [])
            .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((nodeId) => !selectionIds.includes(nodeId)) }))
            .filter((group) => group.nodeIds.length > 0),
          { id, label, nodeIds: [...selectionIds] },
        ],
      }),
      `Agrupar "${label}"`
    );
    logMessage("info", `[NodeGraph] Grupo "${label}" criado com ${selectionIds.length} no(s). Renomeie no painel Grupos.`);
  }, [logMessage, selectionIds, setGraph, suggestGroupName]);

  const updateGroup = useCallback((groupId: string, patch: { label?: string; collapsed?: boolean }, label: string, coalesceKey?: string) => {
    setGraph(
      (g) => ({
        ...g,
        groups: (g.groups ?? []).map((group) => {
          if (group.id !== groupId) return group;
          const next = { ...group, ...patch };
          if (patch.collapsed === false) delete next.collapsed;
          return next;
        }),
      }),
      label,
      coalesceKey
    );
  }, [setGraph]);

  const removeGroup = useCallback((groupId: string) => {
    setGraph((g) => {
      const groups = (g.groups ?? []).filter((group) => group.id !== groupId);
      const next: NodeGraph = { ...g, groups };
      if (groups.length === 0) delete next.groups;
      return next;
    }, "Desfazer grupo");
  }, [setGraph]);

  const onGroupHeaderMouseDown = useCallback((e: React.MouseEvent, box: NodeGraphGroupBox) => {
    if (e.button !== 0 || spacePressed) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    e.stopPropagation();
    setSelectedIds(new Set(box.nodeIds));
    setSelectedId(box.nodeIds[0] ?? null);
    startDrag(e, box.nodeIds, `Mover grupo "${box.label}"`);
  }, [spacePressed, startDrag]);

  const sceneSfx = useMemo<Record<string, string>>(
    () => Object.assign({}, ...(activeScene?.entities ?? []).map((entity) => entity.components.audio?.sfx ?? {})),
    [activeScene?.entities]
  );

  // ── Comportamentos: contexto da cena (todas as entidades e seus grafos) ─────
  const [resolvedSceneGraphs, setResolvedSceneGraphs] = useState<Record<string, NodeGraph>>({});
  useEffect(() => {
    let cancelled = false;
    if (!activeProjectDir || !activeSceneSource) {
      setResolvedSceneGraphs({});
      return () => {
        cancelled = true;
      };
    }
    void resolveScenePrefabs(activeProjectDir, activeSceneSource)
      .then((resolved) => {
        if (cancelled || !resolved.ok) return;
        const scene = parseSceneJson(resolved.scene_json);
        const next: Record<string, NodeGraph> = {};
        for (const entity of scene?.entities ?? []) {
          const parsed = deserializeNodeGraph(entity.components.logic?.graph);
          if (parsed.nodes.length) next[entity.entity_id] = parsed;
        }
        setResolvedSceneGraphs(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeProjectDir, activeSceneSource]);
  const behaviorContext = useMemo(() => {
    const entities = activeScene?.entities ?? [];
    const graphs = entities.map((entity) => {
      if (entity.entity_id === selectedEntity?.entity_id) return graph;
      const inline = deserializeNodeGraph(entity.components.logic?.graph);
      return inline.nodes.length ? inline : resolvedSceneGraphs[entity.entity_id] ?? inline;
    });
    return buildBehaviorSceneContext(entities, graphs, activeTarget);
  }, [activeScene?.entities, activeTarget, graph, resolvedSceneGraphs, selectedEntity?.entity_id]);
  const showNodes = useCallback((nodeIds: string[]) => {
    const current = currentGraphRef.current;
    setSelectedIds(new Set(nodeIds));
    setSelectedId(nodeIds[0] ?? null);
    fitViewTo(current.nodes.filter((node) => nodeIds.includes(node.id) && !hiddenNodeIdsRef.current.has(node.id)));
  }, [fitViewTo]);

  // ── Navegacao por entidade ──────────────────────────────────────────────────
  const sceneEntityIds = useMemo(() => (activeScene?.entities ?? []).map((entity) => entity.entity_id), [activeScene?.entities]);
  const entityIndex = useMemo(() => {
    const index = new Map<string, string[]>();
    for (const node of graph.nodes) {
      for (const ref of getNodeEntityRefs(node, sceneEntityIds.length ? sceneEntityIds : undefined)) {
        index.set(ref, [...(index.get(ref) ?? []), node.id]);
      }
    }
    return [...index.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graph.nodes, sceneEntityIds]);

  const nodeCardEntity = useCallback((node: GraphNode): NodeCardEntity | null => {
    const ref = getNodeEntityRefs(node, sceneEntityIds.length ? sceneEntityIds : undefined)[0];
    if (!ref) return null;
    const entity = activeScene?.entities.find((candidate) => candidate.entity_id === ref);
    const sprite = entity?.components.sprite;
    return {
      entityId: ref,
      label: entity ? getEntityDisplayName(entity) : ref,
      spriteAsset: sprite?.asset ?? null,
      frameWidth: sprite?.frame_width ?? 16,
      frameHeight: sprite?.frame_height ?? 16,
    };
  }, [activeScene?.entities, sceneEntityIds]);

  const toggleDetails = useCallback((nodeId: string) => {
    setOpenDetails((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);
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
          `[NodeGraph Diagnostics] Inspecao de execucao: ${graphValidation.errors.length} erro(s), ${graphValidation.warnings.length} aviso(s), ${LOCAL_TRACE_EVIDENCE_LABEL}.`
        );
      }
      return next;
    });
  }, [
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

  const onParamChange = useCallback((nodeId: string, key: string, value: string | number) => {
    setGraph(
      (currentGraph) => {
        const target = currentGraph.nodes.find((node) => node.id === nodeId);
        if (!target || !canEditGraphNode(target) || !isCardEditableParam(target, key) || target.params[key] === value) {
          return currentGraph;
        }
        return {
          ...currentGraph,
          nodes: currentGraph.nodes.map((node) =>
            node.id === nodeId ? { ...node, params: { ...node.params, [key]: value } } : node
          ),
        };
      },
      `Editar ${getNodeParamDisplayName(key)}`,
      `param:${nodeId}:${key}`
    );
  }, [setGraph]);

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
            t.toLowerCase().includes(searchLower) ||
            getNodeCategory(t).label.toLowerCase().includes(searchLower) ||
            getNodeCatalogEntry(t).description.toLowerCase().includes(searchLower)
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
                  <Icon name={group.icon} size={12} />
                  <span>{group.label}</span>
                </button>
                {!isCollapsed &&
                  group.types.map((type) => (
                    <button
                      key={type}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-[#a6adc8] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] disabled:cursor-not-allowed disabled:opacity-40"
                      onMouseDown={() => addNode(type)}
                      disabled={!selectedEntity}
                      title={`${getNodeCategory(type).label}: ${getNodeCatalogEntry(type).description}`}
                    >
                      <span className="opacity-80" style={{ color: getNodeCategory(type).color }}>
                        <Icon name={getNodeCatalogEntry(type).icon} size={13} />
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
        {selectedEntity && (
          <div
            data-testid="nodegraph-toolbar"
            role="toolbar"
            aria-label="Organizacao do grafo"
            className="absolute left-2 top-2 z-30 flex flex-wrap items-center gap-1 rounded-lg border border-[#313244] bg-[#181825]/95 p-1 text-[11px] shadow-lg"
            style={{ maxWidth: `calc(100% - ${selectedEntity ? 304 : 16}px)` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" data-testid="nodegraph-undo" onClick={undoGraph} disabled={history.past.length === 0}
              title={history.past.length ? `Desfazer: ${history.past[history.past.length - 1].label} (Ctrl+Z)` : "Nada para desfazer"}
              className="flex items-center gap-1 rounded px-2 py-1 text-[#cdd6f4] hover:bg-[#313244] disabled:opacity-40">
              <Icon name="undo" size={14} /> Desfazer
            </button>
            <button type="button" data-testid="nodegraph-redo" onClick={redoGraph} disabled={history.future.length === 0}
              title={history.future.length ? `Refazer: ${history.future[0].label} (Ctrl+Y)` : "Nada para refazer"}
              className="flex items-center gap-1 rounded px-2 py-1 text-[#cdd6f4] hover:bg-[#313244] disabled:opacity-40">
              <Icon name="redo" size={14} /> Refazer
            </button>
            <span className="mx-1 h-4 w-px bg-[#313244]" aria-hidden="true" />
            <button type="button" data-testid="nodegraph-organize-all" onClick={() => organizeGraph("all")} disabled={graph.nodes.length === 0}
              title="Organizar visualmente: so muda posicoes, segue as conexoes e nunca cria ou remove ligacoes. Nos fixados ficam parados."
              className="flex items-center gap-1 rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 font-semibold text-[#89b4fa] hover:bg-[#89b4fa]/20 disabled:opacity-40">
              <Icon name="organize" size={14} /> Organizar tudo
            </button>
            <button type="button" data-testid="nodegraph-organize-selection" onClick={() => organizeGraph("selection")} disabled={selectionIds.length === 0}
              title="Organiza so os nos selecionados; o resto nao se move."
              className="rounded border border-[#89b4fa]/40 px-2 py-1 text-[#89b4fa] hover:bg-[#89b4fa]/20 disabled:opacity-40">
              Organizar selecao
            </button>
            <button type="button" data-testid="nodegraph-fit-view" onClick={() => fitViewTo(graph.nodes.filter((node) => !hiddenNodeIds.has(node.id)))} disabled={graph.nodes.length === 0}
              title="Enquadrar: mostra o grafo inteiro (so a vista; nada muda no grafo)."
              className="rounded px-2 py-1 text-[#cdd6f4] hover:bg-[#313244] disabled:opacity-40">
              Enquadrar
            </button>
            <button type="button" data-testid="nodegraph-select-behavior" onClick={() => selectBehavior()} disabled={!selectedId}
              title="Seleciona todos os nos ligados ao no atual (um comportamento)."
              className="rounded px-2 py-1 text-[#cdd6f4] hover:bg-[#313244] disabled:opacity-40">
              Selecionar comportamento
            </button>
            <button type="button" data-testid="nodegraph-pin-selection" onClick={togglePinSelection} disabled={selectionIds.length === 0}
              title="Fixar: Organizar nao move estes nos."
              className="flex items-center gap-1 rounded px-2 py-1 text-[#cdd6f4] hover:bg-[#313244] disabled:opacity-40">
              <Icon name="pin" size={13} />
              {selectionIds.length > 0 && selectionIds.every((id) => graph.nodes.find((node) => node.id === id)?.pinned) ? "Soltar" : "Fixar"}
            </button>
            <button type="button" data-testid="nodegraph-group-selection" onClick={groupSelection} disabled={selectionIds.length === 0}
              title="Cria um grupo nomeavel com a selecao (so visual)."
              className="flex items-center gap-1 rounded px-2 py-1 text-[#cdd6f4] hover:bg-[#313244] disabled:opacity-40">
              <Icon name="group" size={13} /> Agrupar
            </button>
            <span data-testid="nodegraph-selection-count" className="px-1 text-[10px] text-[#6c7086]">
              {selectionIds.length > 0 ? `${selectionIds.length} selecionado(s)` : "Shift+clique seleciona varios"} · {Math.round(view.zoom * 100)}%
            </span>
          </div>
        )}
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
                <label className="block">
                  <span className="sr-only">Editar logica de</span>
                  <select
                    data-testid="nodegraph-entity-switch"
                    aria-label="Editar logica de"
                    value={selectedEntity.entity_id}
                    onChange={(event) => setSelectedEntityId(event.target.value)}
                    className="max-w-full truncate rounded border border-[#313244] bg-[#11111b] px-1 py-0.5 text-[11px] font-semibold text-[#cdd6f4]"
                  >
                    {(activeScene?.entities ?? []).map((candidate) => (
                      <option key={candidate.entity_id} value={candidate.entity_id}>
                        {getEntityDisplayName(candidate)}
                      </option>
                    ))}
                  </select>
                </label>
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
            <BehaviorPanel
              graph={graph}
              context={behaviorContext}
              selectedEntityId={selectedEntity.entity_id}
              projectDir={activeProjectDir}
              onCommit={(next, label, message) => {
                setGraph(next, label);
                logMessage("info", `[Comportamentos] ${message}`);
              }}
              onShowInstance={showNodes}
            />
            {collapsedCoverage.length > 0 && (
              <div data-testid="nodegraph-collapsed-overlap" className="rounded border border-[#fab387]/50 bg-[#fab387]/10 px-2 py-1.5 text-[10px] text-[#fab387]">
                {collapsedCoverage.slice(0, 4).map((item) => (
                  <p key={`${item.group}-${item.nodeId}`}>
                    O grupo recolhido "{item.group}" fica sob "{item.node}". Os controles do no continuam acessiveis; use Organizar tudo para afastar (os nos do grupo nao se movem).
                  </p>
                ))}
              </div>
            )}
            {layoutReport && (
              <div
                data-testid="nodegraph-layout-report"
                data-moved={layoutReport.moved}
                data-overlaps={layoutReport.overlaps}
                data-conflicts={layoutReport.conflicts.length}
                data-ms={layoutReport.ms}
                className={`rounded border px-2 py-1.5 text-[10px] ${layoutReport.conflicts.length || layoutReport.overlaps ? "border-[#fab387]/50 bg-[#fab387]/10" : "border-[#89b4fa]/35 bg-[#89b4fa]/5"}`}
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                  Organizar {layoutReport.scope === "all" ? "tudo" : "selecao"}
                </p>
                <p className="mt-0.5 text-[#cdd6f4]">
                  {layoutReport.moved} no(s) reposicionado(s) em {layoutReport.ms} ms · {layoutReport.overlaps} sobreposicao(oes) · conexoes e parametros intactos
                </p>
                {layoutReport.conflicts.slice(0, 4).map((conflict, index) => (
                  <p key={index} data-testid="nodegraph-layout-conflict" className="mt-0.5 text-[#fab387]">{conflict.message}</p>
                ))}
              </div>
            )}

            <div data-testid="nodegraph-groups" className="rounded border border-[#313244] bg-[#11111b] px-2 py-1.5 text-[10px]">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#cba6f7]">Grupos (comportamentos)</p>
              {(graph.groups ?? []).length === 0 ? (
                <p className="mt-1 text-[#6c7086]">Selecione nos (Shift+clique ou "Selecionar comportamento") e use Agrupar. Grupos so organizam a vista.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {(graph.groups ?? []).map((group) => (
                    <li key={group.id} className="flex items-center gap-1">
                      <input
                        data-testid={`nodegraph-group-name-${group.id}`}
                        aria-label="Nome do grupo"
                        value={group.label}
                        onChange={(event) => updateGroup(group.id, { label: event.target.value }, "Renomear grupo", `group-name:${group.id}`)}
                        className="min-w-0 flex-1 rounded border border-[#45475a] bg-[#181825] px-1 py-0.5 text-[#cdd6f4]"
                      />
                      <button type="button" data-testid={`nodegraph-group-select-${group.id}`}
                        onClick={() => { setSelectedIds(new Set(group.nodeIds)); setSelectedId(group.nodeIds[0] ?? null); focusNode(group.nodeIds[0]); }}
                        className="rounded px-1 text-[#89b4fa] hover:bg-[#313244]" title="Selecionar e mostrar">Ver</button>
                      <button type="button" data-testid={`nodegraph-group-toggle-${group.id}`}
                        onClick={() => updateGroup(group.id, { collapsed: !group.collapsed }, group.collapsed ? "Expandir grupo" : "Recolher grupo")}
                        className="rounded px-1 text-[#a6adc8] hover:bg-[#313244]">{group.collapsed ? "Expandir" : "Recolher"}</button>
                      <button type="button" data-testid={`nodegraph-group-remove-${group.id}`} onClick={() => removeGroup(group.id)}
                        className="rounded px-1 text-[#f38ba8] hover:bg-[#313244]" title="Desfaz o grupo (os nos continuam no grafo)">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {entityIndex.length > 0 && (
              <div data-testid="nodegraph-entity-nav" className="rounded border border-[#313244] bg-[#11111b] px-2 py-1.5 text-[10px]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#94e2d5]">Entidades no grafo</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {entityIndex.map(([entityId, nodeIds]) => (
                    <button
                      key={entityId}
                      type="button"
                      data-testid={`nodegraph-entity-${entityId}`}
                      onClick={() => {
                        setSelectedIds(new Set(nodeIds));
                        focusNode(nodeIds[0]);
                        logMessage("info", `[NodeGraph] ${nodeIds.length} no(s) afetam ${entityId}.`);
                      }}
                      className="rounded border border-[#94e2d5]/40 px-1.5 py-0.5 text-[#94e2d5] hover:bg-[#94e2d5]/15"
                    >
                      {entityId} <span className="text-[#6c7086]">({nodeIds.length})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <details data-testid="nodegraph-input-help" className="rounded border border-[#313244] bg-[#11111b] px-2 py-1.5 text-[10px]">
              <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Botoes do Mega Drive × teclado</summary>
              <table className="mt-1 w-full text-left">
                <thead><tr className="text-[#6c7086]"><th className="font-normal">Controle</th><th className="font-normal">Tecla no app</th></tr></thead>
                <tbody>
                  {MEGADRIVE_INPUT_BUTTONS.map((value) => {
                    const described = describeInputButton(value);
                    return (
                      <tr key={value} data-testid={`nodegraph-input-map-${value}`}>
                        <td className="text-[#cdd6f4]">{described.padLabel}</td>
                        <td className="font-mono text-[#f9e2af]">{described.keyLabel ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="mt-1 space-y-0.5">
                {INPUT_MODE_HELP.map((mode) => (
                  <li key={mode.mode} className={mode.supported ? "text-[#a6adc8]" : "text-[#fab387]"}>
                    <span className="font-semibold">{mode.label}:</span> {mode.text}
                  </li>
                ))}
              </ul>
            </details>

            <RulesPanel
              graph={graph}
              sfxNames={Object.keys(sceneSfx).sort()}
              onFocusNode={(nodeId) => focusNode(nodeId)}
              onParamChange={onParamChange}
              onSoundChange={(nodeId, sfx) =>
                setGraph(
                  (g) => ({ ...g, nodes: g.nodes.map((node) => (node.id === nodeId ? { ...node, params: { ...node.params, sfx } } : node)) }),
                  "Trocar som"
                )
              }
            />
            <PassagePanel
              graph={graph}
              entityIds={(activeScene?.entities ?? []).map((entity) => entity.entity_id)}
              onGraphChange={(next) => setGraph(next, "Editar passagem", "passage-panel")}
            />
            <SoundPanel
              graph={graph}
              sfx={sceneSfx}
              projectDir={activeProjectDir ?? null}
              onGraphChange={(next) => setGraph(next, "Trocar som")}
            />
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
                      Inspecao de execucao — Local trace
                    </p>
                    <p className="mt-1 text-[#94a3b8]">
                      {LOCAL_TRACE_EVIDENCE_LABEL}
                    </p>
                    <p
                      data-testid="nodegraph-runtime-mapping"
                      className="mt-1 text-[#f9e2af]"
                    >
                      Runtime: nao suportado — {runtimeMapping.reason}
                    </p>
                  </div>
                  <span className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] font-semibold text-[#cdd6f4]">
                    {localTrace ? localTrace.reachableNodeIds.length : 0} nos
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

                {localTrace && Object.keys(localTrace.variables).length > 0 ? (
                  <p
                    data-testid="nodegraph-local-variables"
                    className="mt-2 text-[#94a3b8]"
                  >
                    Variaveis (avaliacao local):{" "}
                    {Object.entries(localTrace.variables)
                      .map(([name, value]) => `${name}=${value}`)
                      .join(", ")}
                  </p>
                ) : null}

                {localRun.status === "error" ? (
                  <ol
                    data-testid="nodegraph-execution-blocked"
                    className="mt-2 space-y-1"
                  >
                    <li className="rounded border border-[#f38ba8]/40 bg-[#11111b]/70 px-2 py-1 text-[#f38ba8]">
                      Execucao local bloqueada por {localRun.errors.length} erro(s) de
                      validacao.
                    </li>
                    {localRun.errors.slice(0, 4).map((error, index) => (
                      <li
                        key={`${error.code}-${error.nodeId ?? error.edgeId ?? index}`}
                        className="rounded border border-[#313244] bg-[#11111b]/70 px-2 py-1"
                      >
                        <span className="font-mono text-[9px] text-[#f38ba8]">
                          {error.code}
                        </span>
                        <span className="mt-0.5 block text-[#7f849c]">
                          {error.message}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ol className="mt-2 space-y-1">
                    {localTrace && localTrace.steps.length > 0 ? (
                      localTrace.steps.slice(0, 8).map((step, index) => (
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
                )}
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
              <div className="w-full rounded border border-[#fab387]/40 bg-[#fab387]/5 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#fab387]">Acao que cria conexoes (altera a logica)</p>
                <button
                  type="button"
                  data-testid="nodegraph-chain-exec-layout"
                  onClick={applyExecChainFromLayout}
                  disabled={graph.nodes.length < 2}
                  title="Liga saida exec padrao para entrada exec do proximo no na ordem de layout (y, depois x). Diferente de Organizar: CRIA conexoes. Revise ramos condicionais; Desfazer reverte."
                  className="mt-1 rounded border border-[#fab387]/50 bg-[#fab387]/10 px-2 py-1 font-semibold text-[#fab387] transition-colors hover:bg-[#fab387]/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Criar conexoes pela posicao
                </button>
              </div>
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

        {/* Grupos nomeaveis (comportamentos) */}
        {groupBoxes.map((box) => {
          const left = box.x * view.zoom + view.x;
          const top = box.y * view.zoom + view.y;
          return (
            <div
              key={`group-${box.groupId}`}
              data-testid={`nodegraph-group-box-${box.groupId}`}
              data-collapsed={box.collapsed ? "true" : "false"}
              className="absolute rounded-2xl border"
              style={{
                left,
                top,
                width: box.width * view.zoom,
                height: box.height * view.zoom,
                borderColor: `${box.color}66`,
                backgroundColor: box.collapsed ? "#181825f2" : `${box.color}10`,
                // Recolhido fica abaixo dos cartoes: nunca encobre controles de outros nos.
                zIndex: box.collapsed ? 1 : 0,
                pointerEvents: "none",
              }}
            >
              <div
                data-testid={`nodegraph-group-header-${box.groupId}`}
                className="flex cursor-grab items-center gap-1.5 rounded-t-2xl px-2 text-[11px] font-semibold"
                style={{ height: 26 * view.zoom, color: box.color, pointerEvents: "auto", fontSize: Math.max(9, 11 * view.zoom) }}
                onMouseDown={(event) => onGroupHeaderMouseDown(event, box)}
                title="Arraste para mover o grupo inteiro (so posicoes)"
              >
                <button
                  type="button"
                  data-testid={`nodegraph-group-collapse-${box.groupId}`}
                  onClick={() => updateGroup(box.groupId, { collapsed: !box.collapsed }, box.collapsed ? `Expandir "${box.label}"` : `Recolher "${box.label}"`)}
                  className="rounded px-1 hover:bg-[#313244]"
                  aria-label={box.collapsed ? `Expandir grupo ${box.label}` : `Recolher grupo ${box.label}`}
                >
                  {box.collapsed ? "▸" : "▾"}
                </button>
                <Icon name="group" size={12} />
                <span className="truncate">{box.label}</span>
              </div>
              {box.collapsed ? (
                <p className="px-3 text-[10px] text-[#a6adc8]" style={{ fontSize: Math.max(8, 10 * view.zoom) }}>
                  {box.nodeIds.length} no(s) recolhido(s) · logica intacta
                </p>
              ) : null}
            </div>
          );
        })}

        {/* SVG edges */}
        <svg
          ref={svgRef}
          data-testid="nodegraph-edges"
          className="absolute inset-0 z-[1] h-full w-full pointer-events-none"
        >
          {(() => {
            const byId = new Map(graph.nodes.map((node) => [node.id, node]));
            const collapsedBoxOf = new Map<string, NodeGraphGroupBox>();
            for (const box of groupBoxes) if (box.collapsed) for (const id of box.nodeIds) collapsedBoxOf.set(id, box);
            const anchor = (node: GraphNode, portId: string, output: boolean) => {
              const box = collapsedBoxOf.get(node.id);
              if (box) return { x: output ? box.x + box.width : box.x, y: box.y + 13 };
              return getPortAnchor(node, portId, output, cardMetrics[node.id]);
            };
            return graph.edges.map((edge) => {
              const from = byId.get(edge.fromNode);
              const to = byId.get(edge.toNode);
              if (!from || !to) return null;
              const fromBox = collapsedBoxOf.get(from.id);
              if (fromBox && fromBox === collapsedBoxOf.get(to.id)) return null; // interna a um grupo recolhido
              const fromPort = from.outputs.find((port) => port.id === edge.fromPort);
              const kind = fromPort ? getPortVisualKind(fromPort) : "exec";
              const a = toScreen(anchor(from, edge.fromPort, true));
              const b = toScreen(anchor(to, edge.toPort, false));
              const detour = Math.max(
                (from.y + nodeSizeOf(from).height) * view.zoom + view.y,
                (to.y + nodeSizeOf(to).height) * view.zoom + view.y
              ) + 18 * view.zoom;
              const hovered = hoveredEdgeId === edge.id;
              const active = activeEdgeId === edge.id;
              const color = active ? "#f9e2af" : PORT_VISUAL_COLORS[kind];
              return (
                <g key={edge.id}>
                  <path
                    data-testid={`nodegraph-edge-${edge.id}`}
                    data-edge-kind={kind}
                    data-from-node={edge.fromNode}
                    data-from-port={edge.fromPort}
                    data-to-node={edge.toNode}
                    data-to-port={edge.toPort}
                    data-collapsed-end={fromBox || collapsedBoxOf.get(to.id) ? "true" : undefined}
                    data-hovered={hovered ? "true" : undefined}
                    data-active={active ? "true" : undefined}
                    data-from-x={a.x.toFixed(1)}
                    data-from-y={a.y.toFixed(1)}
                    data-to-x={b.x.toFixed(1)}
                    data-to-y={b.y.toFixed(1)}
                    d={routeEdgePath(a, b, detour)}
                    fill="none"
                    stroke={color}
                    strokeWidth={hovered || active ? 3 : kind === "data" ? 1.5 : 2}
                    strokeDasharray={kind === "data" ? "5 4" : undefined}
                    strokeOpacity={hovered || active ? 0.95 : 0.8}
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
                  {kind === "true" || kind === "false" ? (
                    <text
                      x={a.x + 8 * view.zoom}
                      y={a.y - 5 * view.zoom}
                      fill={color}
                      fontSize={Math.max(8, 10 * view.zoom)}
                      fontWeight={700}
                    >
                      {kind === "true" ? "Sim" : "Nao"}
                    </text>
                  ) : null}
                </g>
              );
            });
          })()}
          {/* Pending edge preview (ima: gruda na entrada compativel mais proxima) */}
          {pendingEdge && (() => {
            const from = graph.nodes.find((n) => n.id === pendingEdge.fromNode);
            if (!from) return null;
            const rect = canvasRef.current?.getBoundingClientRect();
            const a = toScreen(getPortAnchor(from, pendingEdge.fromPort, true, cardMetrics[from.id]));
            const snapNode = snapTarget ? graph.nodes.find((n) => n.id === snapTarget.nodeId) : null;
            const b = snapNode && snapTarget
              ? toScreen(getPortAnchor(snapNode, snapTarget.portId, false, cardMetrics[snapNode.id]))
              : { x: rect ? pendingEdge.x - rect.left : pendingEdge.x, y: rect ? pendingEdge.y - rect.top : pendingEdge.y };
            return (
              <path
                data-testid="nodegraph-pending-edge"
                data-snapped={snapTarget ? "true" : "false"}
                d={routeEdgePath(a, b)}
                fill="none"
                stroke={snapTarget ? "#f9e2af" : "#cba6f7"}
                strokeWidth={snapTarget ? 2.5 : 1.5}
                strokeDasharray={snapTarget ? undefined : "4 3"}
              />
            );
          })()}
        </svg>

        {pendingEdge && (
          <div
            data-testid="nodegraph-connect-hint"
            className="pointer-events-none absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded border border-[#f9e2af]/50 bg-[#11111b]/95 px-3 py-1 text-[11px] text-[#f9e2af]"
          >
            {snapTarget
              ? `Solte para ligar em "${getNodeDisplayName(graph.nodes.find((n) => n.id === snapTarget.nodeId)?.type ?? "event_start")}" · Esc cancela`
              : "Aproxime de uma entrada compativel (destacada) · Esc cancela"}
          </div>
        )}

        {/* Nodes */}
        {graph.nodes.map((node) =>
          hiddenNodeIds.has(node.id) ? null : (
            <NodeCard
              key={node.id}
              node={node}
              screenX={node.x * view.zoom + view.x}
              screenY={node.y * view.zoom + view.y}
              zoom={view.zoom}
              selected={node.id === selectedId || selectedIds.has(node.id)}
              executionReachable={reachableExecutionNodeIds.has(node.id)}
              entity={nodeCardEntity(node)}
              projectDir={activeProjectDir}
              detailsOpen={openDetails.has(node.id)}
              snapPortKey={snapTarget?.nodeId === node.id ? `in:${snapTarget.portId}` : null}
              compatiblePortIds={
                pendingEdge
                  ? new Set(node.inputs.filter((port) => checkConnection(graph, pendingEdge.fromNode, pendingEdge.fromPort, node.id, port.id).ok).map((port) => port.id))
                  : null
              }
              onMouseDown={(e) => onNodeMouseDown(e, node.id)}
              onPortMouseDown={(e, portId, isOutput) => onPortMouseDown(e, node.id, portId, isOutput)}
              onPortMouseUp={(e, portId, isOutput) => onPortMouseUp(e, node.id, portId, isOutput)}
              onParamChange={onParamChange}
              onToggleDetails={toggleDetails}
              onMeasure={onCardMeasure}
            />
          )
        )}

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
