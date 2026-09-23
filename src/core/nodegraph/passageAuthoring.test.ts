import { describe, expect, it } from "vitest";
import { NODE_DEFS, clonePorts } from "./nodeDefinitions";
import type { GraphNode, NodeGraph, NodeType } from "./nodeTypes";
import { addPassage, listPassages, updatePassage, validatePassages } from "./passageAuthoring";

function node(id: string, type: NodeType, params: Record<string, string | number>): GraphNode {
  const def = NODE_DEFS[type];
  return { ...def, id, label: id, x: 0, y: 0, inputs: clonePorts(def.inputs), outputs: clonePorts(def.outputs), params: { ...def.params, ...params } };
}

/** Minimal shape of the reference graph: two moves already gated by passage_main. */
function referenceGraph(): NodeGraph {
  const main = (role: string) => ({ passage_id: "passage_main", passage_role: role });
  return {
    nodes: [
      node("update_right", "event_update", {}),
      node("right", "input_held", { button: "BUTTON_RIGHT" }),
      node("gate_r", "condition_overlap", { a: "player", b: "passage_blocker", probe_dx: 2, ...main("gate") }),
      node("open_get", "var_get", { var_name: "goal_open", ...main("open_get") }),
      node("open_check", "condition_compare", { operator: "==", b: 1, ...main("open_check") }),
      node("move_right", "sprite_move", { target: "player", dx: 2, dy: 0 }),
      node("update_left", "event_update", {}),
      node("left", "input_held", { button: "BUTTON_LEFT" }),
      node("move_left", "sprite_move", { target: "player", dx: -2, dy: 0 }),
      node("score_get", "var_get", { var_name: "reference_score", ...main("rule_score_get") }),
      node("rule", "condition_compare", { operator: ">=", b: 6, ...main("rule") }),
      node("open_set", "var_set", { var_name: "goal_open", value: 1, ...main("open_set") }),
      node("close_set", "var_set", { var_name: "goal_open", value: 0, ...main("close_set") }),
      node("hide", "destroy_entity", { target: "passage_blocker", ...main("hide") }),
    ],
    edges: [
      { id: "e1", fromNode: "update_right", fromPort: "exec", toNode: "right", toPort: "exec" },
      { id: "e2", fromNode: "right", fromPort: "exec", toNode: "gate_r", toPort: "exec" },
      { id: "e3", fromNode: "gate_r", fromPort: "false", toNode: "move_right", toPort: "exec" },
      { id: "e4", fromNode: "gate_r", fromPort: "true", toNode: "open_check", toPort: "exec" },
      { id: "e5", fromNode: "open_check", fromPort: "true", toNode: "move_right", toPort: "exec" },
      { id: "e6", fromNode: "update_left", fromPort: "exec", toNode: "left", toPort: "exec" },
      { id: "e7", fromNode: "left", fromPort: "exec", toNode: "move_left", toPort: "exec" },
    ],
  };
}

const spec = {
  passageId: "passage_2",
  blocker: "passage_blocker_2",
  player: "player",
  openVar: "passage_2_open",
  scoreVar: "reference_score",
  threshold: 12,
};

describe("passage authoring", () => {
  it("lists the builtin passage by its references", () => {
    expect(listPassages(referenceGraph())).toEqual([
      expect.objectContaining({ passageId: "passage_main", blocker: "passage_blocker", player: "player", openVar: "goal_open", scoreVar: "reference_score", threshold: 6 }),
    ]);
  });

  it("adds a second passage that gates every player move without dropping existing gates", () => {
    const graph = addPassage(referenceGraph(), spec);
    const passages = listPassages(graph);
    expect(passages.map((p) => [p.passageId, p.blocker, p.openVar, p.threshold])).toEqual([
      ["passage_2", "passage_blocker_2", "passage_2_open", 12],
      ["passage_main", "passage_blocker", "goal_open", 6],
    ]);
    const gates = graph.nodes.filter((n) => n.params.passage_id === "passage_2" && n.params.passage_role === "gate");
    expect(gates.map((g) => g.params.probe_dx).sort()).toEqual([-2, 2]);
    // Every edge that used to reach a move now reaches a passage_2 gate first...
    const intoMoveRight = graph.edges.filter((e) => e.toNode === "move_right");
    const rightGate = gates.find((g) => g.params.probe_dx === 2)!;
    expect(intoMoveRight.every((e) => e.fromNode === rightGate.id || e.fromNode.startsWith("passage_2_open_check"))).toBe(true);
    // ...and the builtin gate is still upstream of it.
    expect(graph.edges.some((e) => e.fromNode === "gate_r" && e.toNode === rightGate.id && e.fromPort === "false")).toBe(true);
    expect(graph.edges.some((e) => e.fromNode === "open_check" && e.toNode === rightGate.id && e.fromPort === "true")).toBe(true);
    expect(validatePassages(graph, ["player", "passage_blocker", "passage_blocker_2"])).toEqual([]);
  });

  it("edits one passage without touching the other", () => {
    const graph = updatePassage(addPassage(referenceGraph(), spec), "passage_2", { threshold: 20, blocker: "wall", openVar: "wall_open" });
    const [second, main] = listPassages(graph);
    expect([second.blocker, second.openVar, second.threshold]).toEqual(["wall", "wall_open", 20]);
    expect([main.blocker, main.openVar, main.threshold]).toEqual(["passage_blocker", "goal_open", 6]);
    const hide = graph.nodes.find((n) => n.params.passage_id === "passage_2" && n.params.passage_role === "hide");
    expect(hide?.params.target).toBe("wall");
  });

  it("reports broken references, invalid params and cross-activation risks", () => {
    const shared = updatePassage(addPassage(referenceGraph(), spec), "passage_2", { openVar: "goal_open", threshold: -3 });
    const codes = validatePassages(shared, ["player", "passage_blocker"]).map((issue) => issue.code).sort();
    expect(codes).toEqual(["passage_broken_blocker", "passage_invalid_threshold", "passage_shared_open_var"]);
    const messages = validatePassages(shared, ["player", "passage_blocker"]).map((issue) => issue.message).join(" ");
    expect(messages).toContain("passage_blocker_2");
    expect(messages).toContain("abrir uma abriria a outra");
  });

  it("rejects invalid specs with actionable errors", () => {
    expect(() => addPassage(referenceGraph(), { ...spec, openVar: "2bad" })).toThrow(/identificadores/);
    expect(() => addPassage(referenceGraph(), { ...spec, threshold: 1.5 })).toThrow(/inteiro/);
    expect(() => addPassage(referenceGraph(), { ...spec, passageId: "passage_main" })).toThrow(/repetido/);
    expect(() => addPassage(referenceGraph(), { ...spec, player: "ghost" })).toThrow(/movimento/);
  });
});
