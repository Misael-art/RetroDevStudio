import { describe, expect, it } from "vitest";
import { NODE_DEFS, clonePorts } from "./nodeDefinitions";
import type { GraphNode, NodeType } from "./nodeTypes";
import { summarizeRules } from "./ruleSummary";

const node = (id: string, type: NodeType, params: Record<string, string | number> = {}): GraphNode => ({
  ...NODE_DEFS[type], id, label: id, x: 0, y: 0,
  inputs: clonePorts(NODE_DEFS[type].inputs), outputs: clonePorts(NODE_DEFS[type].outputs),
  params: { ...NODE_DEFS[type].params, ...params },
});
const edge = (fromNode: string, fromPort: string, toNode: string, toPort = "exec") => ({ id: `${fromNode}-${toNode}-${fromPort}`, fromNode, fromPort, toNode, toPort });

describe("summarizeRules", () => {
  it("renders a linear rule as Quando → Se → Fazer", () => {
    const rules = summarizeRules({
      nodes: [
        node("tick", "event_update"),
        node("press", "input_pressed", { button: "BUTTON_A" }),
        node("jump", "set_velocity", { target: "player", vx: 0, vy: -64 }),
        node("sfx", "action_sound", { sfx: "jump" }),
      ],
      edges: [edge("tick", "exec", "press"), edge("press", "exec", "jump"), edge("jump", "exec", "sfx")],
    });
    expect(rules).toEqual([
      expect.objectContaining({
        when: "A cada frame",
        conditions: ["tecla A (Z) pressionada"],
        actions: ["impulso em player (0, -64)", "tocar som jump"],
        advanced: null,
      }),
    ]);
  });

  it("shows a simple else branch instead of hiding it", () => {
    const rules = summarizeRules({
      nodes: [
        node("tick", "event_update"),
        node("score", "var_get", { var_name: "reference_score" }),
        node("rule", "condition_compare", { operator: ">=", b: 12 }),
        node("open", "var_set", { var_name: "goal_open", value: 1 }),
        node("close", "var_set", { var_name: "goal_open", value: 0 }),
      ],
      edges: [edge("tick", "exec", "rule"), edge("score", "value", "rule", "a"), edge("rule", "true", "open"), edge("rule", "false", "close")],
    });
    expect(rules[0].conditions).toEqual(["reference_score >= 12"]);
    expect(rules[0].actions).toEqual(["goal_open = 1"]);
    expect(rules[0].actionItems).toEqual([{ text: "goal_open = 1", nodeId: "open" }]);
    expect(rules[0].elseBranches).toEqual([
      { condition: "reference_score >= 12", conditionNodeId: "rule", actions: [{ text: "goal_open = 0", nodeId: "close" }] },
    ]);
    expect(rules[0].advanced).toBeNull();
  });

  it("keeps rules advanced when the else side has another condition or a loop", () => {
    const nested = summarizeRules({
      nodes: [
        node("tick", "event_update"),
        node("rule", "condition_compare", { operator: ">=", b: 12 }),
        node("open", "var_set", { var_name: "goal_open", value: 1 }),
        node("inner", "condition_overlap", { a: "player", b: "goal" }),
      ],
      edges: [edge("tick", "exec", "rule"), edge("rule", "true", "open"), edge("rule", "false", "inner")],
    });
    expect(nested[0].advanced).toContain("outra condição");
    expect(nested[0].elseBranches[0].actions.map((item) => item.nodeId)).toEqual(["inner"]);

    const loop = summarizeRules({
      nodes: [node("tick", "event_update"), node("a", "var_set", { var_name: "x", value: 1 }), node("b", "var_set", { var_name: "y", value: 2 })],
      edges: [edge("tick", "exec", "a"), edge("a", "exec", "b"), edge("b", "exec", "a")],
    });
    expect(loop[0].advanced).toContain("laço");
  });

  it("recognizes an else side that rejoins the main path (passage gate)", () => {
    const rules = summarizeRules({
      nodes: [
        node("tick", "event_update"),
        node("right", "input_held", { button: "BUTTON_RIGHT" }),
        node("gate", "condition_overlap", { a: "player", b: "passage_blocker", probe_dx: 2 }),
        node("open", "condition_compare", { operator: "==", b: 1 }),
        node("move", "sprite_move", { target: "player", dx: 2, dy: 0 }),
      ],
      edges: [
        edge("tick", "exec", "right"),
        edge("right", "exec", "gate"),
        edge("gate", "true", "open"),
        edge("gate", "false", "move"),
        edge("open", "true", "move"),
      ],
    });
    expect(rules[0].advanced).toBeNull();
    expect(rules[0].actions).toEqual(["mover player (2, 0)"]);
    expect(rules[0].elseBranches).toEqual([
      expect.objectContaining({ conditionNodeId: "gate", actions: [{ text: 'continua em "mover player (2, 0)"', nodeId: "move" }] }),
    ]);
  });

  it("gives common actions a simple form instead of marking the rule advanced", () => {
    const rules = summarizeRules({
      nodes: [
        node("start", "event_start"),
        node("spawn", "spawn_entity", { prefab: "player", x: 48, y: 128 }),
        node("anim", "set_animation_state", { target: "player", state: "idle" }),
        node("cam", "camera_follow", { target: "player" }),
      ],
      edges: [edge("start", "exec", "spawn"), edge("spawn", "exec", "anim"), edge("anim", "exec", "cam")],
    });
    expect(rules[0].actions).toEqual(["criar player em (48, 128)", "animação de player: idle", "câmera segue player"]);
    expect(rules[0].advanced).toBeNull();
  });
});
