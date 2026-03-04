import { useState, useRef, useCallback, useEffect } from "react";
import { useEditorStore } from "../../core/store/editorStore";

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
  | "move_camera";

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
};

const NODE_COLORS: Record<NodeType, string> = {
  event_start:       "border-[#a6e3a1] bg-[#a6e3a1]/10",
  sprite_move:       "border-[#89b4fa] bg-[#89b4fa]/10",
  sprite_anim:       "border-[#89b4fa] bg-[#89b4fa]/10",
  condition_overlap: "border-[#fab387] bg-[#fab387]/10",
  effect_parallax:   "border-[#cba6f7] bg-[#cba6f7]/10",
  effect_raster:     "border-[#cba6f7] bg-[#cba6f7]/10",
  logic_and:         "border-[#f38ba8] bg-[#f38ba8]/10",
  action_sound:      "border-[#f9e2af] bg-[#f9e2af]/10",
  scroll_tilemap:    "border-[#94e2d5] bg-[#94e2d5]/10",
  move_camera:       "border-[#f9e2af] bg-[#f9e2af]/10",
};

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
    inputs: def.inputs.map((p) => ({ ...p })),
    outputs: def.outputs.map((p) => ({ ...p })),
    params: { ...def.params },
  };
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
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
  onPortMouseUp: (e: React.MouseEvent, portId: string, isOutput: boolean) => void;
}

function NodeCard({ node, selected, onMouseDown, onPortMouseDown, onPortMouseUp }: NodeCardProps) {
  const colorClass = NODE_COLORS[node.type];

  return (
    <div
      className={`absolute select-none rounded border ${colorClass} ${selected ? "ring-1 ring-white/40" : ""} min-w-[160px]`}
      style={{ left: node.x, top: node.y }}
      onMouseDown={onMouseDown}
    >
      {/* Header */}
      <div className="px-2 py-1 text-[11px] font-semibold text-[#cdd6f4] border-b border-white/10 cursor-grab">
        {node.label}
      </div>

      {/* Ports */}
      <div className="flex gap-2 px-2 py-1.5">
        {/* Inputs */}
        <div className="flex flex-col gap-1 flex-1">
          {node.inputs.map((port) => (
            <div key={port.id} className="flex items-center gap-1.5">
              <div
                className={`w-2.5 h-2.5 rounded-full border cursor-crosshair shrink-0 ${
                  port.kind === "exec" ? "border-[#a6e3a1] bg-[#a6e3a1]/30" : "border-[#89b4fa] bg-[#89b4fa]/30"
                }`}
                onMouseDown={(e) => onPortMouseDown(e, port.id, false)}
                onMouseUp={(e) => onPortMouseUp(e, port.id, false)}
              />
              <span className="text-[10px] text-[#7f849c]">{port.label}</span>
            </div>
          ))}
        </div>

        {/* Outputs */}
        <div className="flex flex-col gap-1 items-end">
          {node.outputs.map((port) => (
            <div key={port.id} className="flex items-center gap-1.5">
              <span className="text-[10px] text-[#7f849c]">{port.label}</span>
              <div
                className={`w-2.5 h-2.5 rounded-full border cursor-crosshair shrink-0 ${
                  port.kind === "exec" ? "border-[#a6e3a1] bg-[#a6e3a1]/30" : "border-[#89b4fa] bg-[#89b4fa]/30"
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
        <div className="px-2 pb-1.5 flex flex-col gap-0.5 border-t border-white/5">
          {Object.entries(node.params).map(([k, v]) => (
            <div key={k} className="flex justify-between text-[10px]">
              <span className="text-[#45475a]">{k}</span>
              <span className="text-[#cdd6f4] font-mono">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main NodeGraph Editor ─────────────────────────────────────────────────────

const PALETTE_TYPES: NodeType[] = [
  "event_start", "sprite_move", "sprite_anim",
  "condition_overlap", "effect_parallax", "effect_raster",
  "logic_and", "action_sound",
];

export default function NodeGraphEditor() {
  const { logMessage } = useEditorStore();
  const [graph, setGraph] = useState<NodeGraph>(INITIAL_GRAPH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNode: string; fromPort: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Drag node ──────────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).classList.contains("cursor-crosshair")) return;
    setSelectedId(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId)!;
    setDragging({ nodeId, offsetX: e.clientX - node.x, offsetY: e.clientY - node.y });
  }, [graph.nodes]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === dragging.nodeId
            ? { ...n, x: e.clientX - dragging.offsetX, y: e.clientY - dragging.offsetY }
            : n
        ),
      }));
    }
    if (pendingEdge) {
      setPendingEdge((p) => p ? { ...p, x: e.clientX, y: e.clientY } : null);
    }
  }, [dragging, pendingEdge]);

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

  // ── Add node from palette ──────────────────────────────────────────────────
  const addNode = useCallback((type: NodeType) => {
    const node = makeNode(type, 200, 200);
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    logMessage("info", `Nó adicionado: ${NODE_DEFS[type].label}`);
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
    const x1 = fromNode.x + 160; // right edge
    const y1 = fromNode.y + 24;
    const x2 = toNode.x;         // left edge
    const y2 = toNode.y + 24;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  return (
    <div className="flex h-full w-full bg-[#11111b] overflow-hidden">

      {/* ── Palette sidebar ── */}
      <div className="w-36 shrink-0 bg-[#181825] border-r border-[#313244] flex flex-col gap-1 p-2 overflow-y-auto">
        <p className="text-[10px] text-[#45475a] px-1 mb-1 select-none">NÓDOS</p>
        {PALETTE_TYPES.map((type) => (
          <button
            key={type}
            className="text-left text-[11px] px-2 py-1 rounded text-[#a6adc8] hover:bg-[#313244] hover:text-[#cdd6f4] transition-colors"
            onMouseDown={() => addNode(type)}
          >
            {NODE_DEFS[type].label}
          </button>
        ))}
        <div className="mt-auto border-t border-[#313244] pt-2">
          <p className="text-[10px] text-[#45475a] px-1 select-none">Del = remover nó</p>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
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
            const x1 = from.x + 160;
            const y1 = from.y + 24;
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
            selected={node.id === selectedId}
            onMouseDown={(e) => onNodeMouseDown(e, node.id)}
            onPortMouseDown={(e, portId, isOutput) => onPortMouseDown(e, node.id, portId, isOutput)}
            onPortMouseUp={(e, portId, isOutput) => onPortMouseUp(e, node.id, portId, isOutput)}
          />
        ))}

        {/* Empty state */}
        {graph.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[#313244] text-xs select-none">
              Adicione nós pela paleta à esquerda
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
