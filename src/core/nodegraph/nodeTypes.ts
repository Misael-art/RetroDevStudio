/**
 * nodeTypes.ts — Modelo de dados canonico do NodeGraph (Experimental).
 *
 * Contrato de dados do Node Engine fora da UI: tipos de node/porta/aresta,
 * guards de runtime e o contrato de serializacao v1 (serialize). O editor
 * (`NodeGraphEditor.tsx`) e camada de apresentacao e re-exporta esta
 * superficie por compatibilidade; o dono do contrato e este modulo.
 */

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
  | "action_music"
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

export const EMPTY_GRAPH: NodeGraph = {
  nodes: [],
  edges: [],
};

export function cloneGraph(graph: NodeGraph): NodeGraph {
  return structuredClone(graph);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNodePort(value: unknown): value is NodePort {
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

export function isNodeType(value: unknown): value is NodeType {
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
    value === "action_music" ||
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

export function isNodeEdge(value: unknown): value is NodeEdge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.fromNode === "string" &&
    typeof value.fromPort === "string" &&
    typeof value.toNode === "string" &&
    typeof value.toPort === "string"
  );
}


/** Serializacao v1: formato estavel { version: 1, nodes, edges }. */
export function serializeNodeGraph(graph: NodeGraph): string {
  return JSON.stringify({
    version: 1,
    nodes: structuredClone(graph.nodes),
    edges: structuredClone(graph.edges),
  });
}
