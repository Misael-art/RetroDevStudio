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

  it("flags a rule with an else branch as advanced without dropping it", () => {
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
    expect(rules[0].advanced).toContain("senão");
  });
});
