import projectMgrSource from "../../../src-tauri/src/core/project_mgr.rs?raw";
import { describe, expect, it } from "vitest";

import { deserializeNodeGraph } from "./nodeDefinitions";
import {
  countEdgeCrossings,
  estimateNodeCardSize,
  findNodeOverlaps,
  graphSemanticSignature,
  layoutNodeGraph,
  rectsOverlap,
  routeEdgePath,
} from "./nodeLayout";
import { emptyGraphHistory, recordGraphHistory, redoGraphHistory, undoGraphHistory } from "./graphHistory";
import { serializeNodeGraph, type GraphNode, type NodeGraph } from "./nodeTypes";

/** Grafo real do template `reference_platformer`, lido da fonte Rust (fonte unica). */
function referenceGraph(): NodeGraph {
  const source: string = projectMgrSource;
  const start = source.indexOf("serde_json::json!(", source.indexOf("fn reference_platformer_logic_graph()"));
  const end = source.indexOf("\n    });", start);
  const json = source.slice(start + "serde_json::json!(".length, end + "\n    }".length);
  return deserializeNodeGraph(json);
}

/** Grafo maior: `lanes` comportamentos com ramos Sim/Nao, provedores de dados e um ciclo. */
function largeGraph(lanes: number): NodeGraph {
  const text = JSON.stringify({
    version: 1,
    nodes: Array.from({ length: lanes }).flatMap((_, lane) => [
      { id: `ev${lane}`, type: "event_update", label: `Update ${lane}`, x: 0, y: 0, params: {} },
      { id: `in${lane}`, type: "input_held", label: `Hold ${lane}`, x: 0, y: 0, params: { button: "BUTTON_RIGHT" } },
      { id: `get${lane}`, type: "var_get", label: `Get ${lane}`, x: 0, y: 0, params: { var_name: `v${lane}` } },
      { id: `cmp${lane}`, type: "condition_compare", label: `Cmp ${lane}`, x: 0, y: 0, params: { operator: ">=", b: lane } },
      { id: `yes${lane}`, type: "sprite_move", label: `Yes ${lane}`, x: 0, y: 0, params: { target: "player", dx: 1, dy: 0 } },
      { id: `no${lane}`, type: "var_set", label: `No ${lane}`, x: 0, y: 0, params: { var_name: `v${lane}`, value: 0 } },
      { id: `snd${lane}`, type: "action_sound", label: `Snd ${lane}`, x: 0, y: 0, params: { sfx: "jump" } },
    ]),
    edges: Array.from({ length: lanes }).flatMap((_, lane) => [
      { id: `e1_${lane}`, fromNode: `ev${lane}`, fromPort: "exec", toNode: `in${lane}`, toPort: "exec" },
      { id: `e2_${lane}`, fromNode: `in${lane}`, fromPort: "exec", toNode: `cmp${lane}`, toPort: "exec" },
      { id: `e3_${lane}`, fromNode: `get${lane}`, fromPort: "value", toNode: `cmp${lane}`, toPort: "a" },
      { id: `e4_${lane}`, fromNode: `cmp${lane}`, fromPort: "true", toNode: `yes${lane}`, toPort: "exec" },
      { id: `e5_${lane}`, fromNode: `cmp${lane}`, fromPort: "false", toNode: `no${lane}`, toPort: "exec" },
      { id: `e6_${lane}`, fromNode: `yes${lane}`, fromPort: "exec", toNode: `snd${lane}`, toPort: "exec" },
      // ciclo exec (snd -> cmp) para exercitar a quebra de ciclos
      { id: `e7_${lane}`, fromNode: `snd${lane}`, fromPort: "exec", toNode: `cmp${lane}`, toPort: "exec" },
    ]),
  });
  return deserializeNodeGraph(text);
}

const size = (node: GraphNode) => estimateNodeCardSize(node);

describe("layoutNodeGraph", () => {
  it("organizes the real reference graph without touching semantics or creating edges", () => {
    const graph = referenceGraph();
    expect(graph.nodes).toHaveLength(34);
    expect(findNodeOverlaps(graph, size).length).toBeGreaterThan(0); // estado de fabrica sobreposto

    const result = layoutNodeGraph(graph, { sizeOf: size });

    expect(graphSemanticSignature(result.graph)).toBe(graphSemanticSignature(graph));
    expect(result.graph.edges).toEqual(graph.edges);
    expect(result.graph.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    expect(findNodeOverlaps(result.graph, size)).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(countEdgeCrossings(result.graph, size)).toBe(0);
  });

  it("follows connections: every forward edge goes left-to-right and branches split rows", () => {
    const result = layoutNodeGraph(referenceGraph(), { sizeOf: size }).graph;
    const at = (id: string) => result.nodes.find((node) => node.id === id)!;
    // Pulo: evento -> A -> impulso -> som, em colunas crescentes na mesma faixa.
    expect(at("update_jump").x).toBeLessThan(at("jump").x);
    expect(at("jump").x).toBeLessThan(at("jump_velocity").x);
    expect(at("jump_velocity").x).toBeLessThan(at("jump_sound").x);
    // Limiar: Sim (abrir) e Nao (manter fechado) na mesma coluna, linhas diferentes.
    expect(at("open_goal").x).toBe(at("close_goal").x);
    expect(at("open_goal").y).toBeLessThan(at("close_goal").y);
    // Provedor de dados fica na coluna anterior ao consumidor.
    expect(at("score_threshold_get").x).toBeLessThan(at("score_threshold").x);
    // Comportamentos separados em faixas (componentes) que nao se misturam.
    const jumpLane = ["update_jump", "jump", "jump_velocity", "jump_sound"].map(at);
    const goalLane = ["update_goal", "goal_overlap", "goal_not_reached", "goal_sound", "mark_goal"].map(at);
    const bottom = (nodes: GraphNode[]) => Math.max(...nodes.map((node) => node.y + size(node).height));
    const top = (nodes: GraphNode[]) => Math.min(...nodes.map((node) => node.y));
    expect(bottom(jumpLane) <= top(goalLane) || bottom(goalLane) <= top(jumpLane)).toBe(true);
  });

  it("is deterministic and idempotent (organizing twice changes nothing)", () => {
    const once = layoutNodeGraph(referenceGraph(), { sizeOf: size }).graph;
    const twice = layoutNodeGraph(once, { sizeOf: size });
    expect(twice.movedNodeIds).toEqual([]);
    expect(serializeNodeGraph(twice.graph)).toBe(serializeNodeGraph(once));
  });

  it("never moves pinned nodes and routes others around them, reporting the conflict", () => {
    const graph = referenceGraph();
    const organized = layoutNodeGraph(graph, { sizeOf: size }).graph;
    const jump = organized.nodes.find((node) => node.id === "jump")!;
    // Fixa um no de outro comportamento exatamente sobre a posicao organizada do "jump".
    const withPin: NodeGraph = {
      ...organized,
      nodes: organized.nodes.map((node) =>
        node.id === "music" ? { ...node, pinned: true, x: jump.x, y: jump.y } : node
      ),
    };
    const result = layoutNodeGraph(withPin, { sizeOf: size });
    const music = result.graph.nodes.find((node) => node.id === "music")!;
    expect(music).toMatchObject({ x: jump.x, y: jump.y, pinned: true });
    expect(result.movedNodeIds).not.toContain("music");
    expect(findNodeOverlaps(result.graph, size)).toEqual([]);
    expect(result.conflicts.some((conflict) => conflict.kind === "moved_around_fixed" && conflict.nodeIds.includes("music"))).toBe(true);
  });

  it("reports pinned-on-pinned overlaps it cannot resolve", () => {
    const graph = referenceGraph();
    const pinnedPair: NodeGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "start" || node.id === "music" ? { ...node, x: 0, y: 0, pinned: true } : node
      ),
    };
    const result = layoutNodeGraph(pinnedPair, { sizeOf: size });
    expect(result.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "pinned_overlap", nodeIds: ["start", "music"] })])
    );
  });

  it("organizes only the selection and keeps the rest still", () => {
    const graph = layoutNodeGraph(referenceGraph(), { sizeOf: size }).graph;
    const scrambled: NodeGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        ["update_jump", "jump", "jump_velocity", "jump_sound"].includes(node.id) ? { ...node, x: 5000, y: 5000 } : node
      ),
    };
    const result = layoutNodeGraph(scrambled, { sizeOf: size, scope: ["update_jump", "jump", "jump_velocity", "jump_sound"] });
    for (const node of result.graph.nodes) {
      if (!["update_jump", "jump", "jump_velocity", "jump_sound"].includes(node.id)) {
        const before = scrambled.nodes.find((candidate) => candidate.id === node.id)!;
        expect({ id: node.id, x: node.x, y: node.y }).toEqual({ id: before.id, x: before.x, y: before.y });
      }
    }
    expect(result.movedNodeIds.sort()).toEqual(["jump", "jump_sound", "jump_velocity"]);
    expect(findNodeOverlaps(result.graph, size)).toEqual([]);
    expect(graphSemanticSignature(result.graph)).toBe(graphSemanticSignature(scrambled));
  });

  it("handles cycles, branches and disconnected nodes in a larger graph within budget", () => {
    const graph = largeGraph(40); // 280 nos, 280 arestas
    const loose = deserializeNodeGraph(
      JSON.stringify({
        version: 1,
        nodes: [...graph.nodes, { id: "lonely", type: "action_sound", label: "Solto", x: 0, y: 0, params: {} }],
        edges: graph.edges,
      })
    );
    const started = performance.now();
    const result = layoutNodeGraph(loose, { sizeOf: size });
    const elapsed = performance.now() - started;
    expect(result.graph.nodes).toHaveLength(281);
    expect(graphSemanticSignature(result.graph)).toBe(graphSemanticSignature(loose));
    expect(findNodeOverlaps(result.graph, size)).toEqual([]);
    const at = (id: string) => result.graph.nodes.find((node) => node.id === id)!;
    expect(at("yes7").x).toBe(at("no7").x);
    expect(at("cmp7").x).toBeLessThan(at("yes7").x);
    expect(at("lonely").y).toBeGreaterThan(at("snd39").y); // solto vai para a grade final
    expect(elapsed).toBeLessThan(2000);
  });

  it("keeps groups and pinned flags through layout and serialization round-trip", () => {
    const graph: NodeGraph = {
      ...referenceGraph(),
      groups: [{ id: "g_jump", label: "Pulo", nodeIds: ["update_jump", "jump", "jump_velocity", "jump_sound"], collapsed: true }],
    };
    graph.nodes[0] = { ...graph.nodes[0], pinned: true };
    const result = layoutNodeGraph(graph, { sizeOf: size }).graph;
    const restored = deserializeNodeGraph(serializeNodeGraph(result));
    expect(restored.groups).toEqual(graph.groups);
    expect(restored.nodes[0].pinned).toBe(true);
    expect(restored.nodes.map((node) => [node.id, node.x, node.y])).toEqual(result.nodes.map((node) => [node.id, node.x, node.y]));
    expect(graphSemanticSignature(restored)).toBe(graphSemanticSignature(graph));
  });

  it("serializes graphs without groups exactly as before (no new keys)", () => {
    const graph = referenceGraph();
    expect(Object.keys(JSON.parse(serializeNodeGraph(graph)))).toEqual(["version", "nodes", "edges"]);
  });
});

describe("collapsed groups as occupants", () => {
  it("keeps hidden members still and moves an external node out from under the collapsed box", () => {
    const graph = layoutNodeGraph(referenceGraph(), { sizeOf: size }).graph;
    const members = ["update_jump", "jump", "jump_velocity", "jump_sound"];
    const memberNodes = graph.nodes.filter((node) => members.includes(node.id));
    const minX = Math.min(...memberNodes.map((node) => node.x));
    const minY = Math.min(...memberNodes.map((node) => node.y));
    const rect = { x: minX - 28, y: minY - 54, width: 296, height: 120 };
    // Nó externo exatamente sob a caixa recolhida (reproduz a lacuna).
    const covered: NodeGraph = { ...graph, nodes: graph.nodes.map((node) => (node.id === "music" ? { ...node, x: minX, y: minY } : node)) };
    const collapsed = [{ id: "g", label: "Pulo", nodeIds: members, rect }];
    const hidden = new Set(members);
    expect(findNodeOverlaps(covered, size, hidden, collapsed)).toContainEqual(["music", "group:g"]);

    const result = layoutNodeGraph(covered, { sizeOf: size, collapsed });
    for (const id of members) {
      const before = covered.nodes.find((node) => node.id === id)!;
      const after = result.graph.nodes.find((node) => node.id === id)!;
      expect([after.x, after.y]).toEqual([before.x, before.y]);
    }
    expect(findNodeOverlaps(result.graph, size, hidden, collapsed)).toEqual([]);
    expect(graphSemanticSignature(result.graph)).toBe(graphSemanticSignature(covered));
  });

  it("reports a collapsed box over a pinned node instead of moving it", () => {
    const graph = layoutNodeGraph(referenceGraph(), { sizeOf: size }).graph;
    const music = graph.nodes.find((node) => node.id === "music")!;
    const pinned: NodeGraph = { ...graph, nodes: graph.nodes.map((node) => (node.id === "music" ? { ...node, pinned: true } : node)) };
    const collapsed = [{ id: "g", label: "Pulo", nodeIds: ["jump"], rect: { x: music.x, y: music.y, width: 50, height: 50 } }];
    const result = layoutNodeGraph(pinned, { sizeOf: size, collapsed });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: "collapsed_overlap", nodeIds: ["group:g", "music"] }));
    expect(result.graph.nodes.find((node) => node.id === "music")).toMatchObject({ x: music.x, y: music.y });
  });
});

describe("edge routing and helpers", () => {
  it("routes forward edges as curves and backward edges around the cards", () => {
    expect(routeEdgePath({ x: 0, y: 10 }, { x: 200, y: 50 })).toMatch(/^M 0 10 C /);
    const back = routeEdgePath({ x: 300, y: 10 }, { x: 100, y: 20 }, 400);
    expect(back).toContain("L 100 400");
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("graph history", () => {
  it("undoes and redoes snapshots in order and clears redo on new edits", () => {
    const a = referenceGraph();
    const b = layoutNodeGraph(a, { sizeOf: size }).graph;
    let history = recordGraphHistory(emptyGraphHistory(), a, "Organizar");
    const undone = undoGraphHistory(history, b)!;
    expect(undone.graph).toBe(a);
    history = undone.history;
    const redone = redoGraphHistory(history, a)!;
    expect(redone.graph).toBe(b);
    expect(recordGraphHistory(undone.history, a, "Mover").future).toEqual([]);
    expect(undoGraphHistory(emptyGraphHistory(), a)).toBeNull();
  });
});
