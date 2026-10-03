import type { GraphNode, NodeGraph } from "./nodeTypes";

/**
 * "Quando → Se → Fazer" view of the canonical graph. The summary itself never rewrites
 * logic: each rule starts at an event node and follows exec edges. Items carry their
 * `nodeId` so the UI can edit the node's own params in place. A "senão" side that is a
 * simple chain of actions is listed in `elseBranches` (never hidden). Loops, fan-out,
 * conditions nested inside a "senão" and node types without a simple form mark the rule
 * as advanced; the graph keeps the full logic and stays the place to edit those cases.
 */
export type RuleItem = { text: string; nodeId: string };

export type RuleElseBranch = {
  /** Condition whose "Nao" side this is. */
  condition: string;
  conditionNodeId: string;
  actions: RuleItem[];
};

export type RuleSummary = {
  id: string;
  when: string;
  conditions: string[];
  actions: string[];
  conditionItems: RuleItem[];
  actionItems: RuleItem[];
  elseBranches: RuleElseBranch[];
  advanced: string | null;
  nodeIds: string[];
};

const EVENT_LABELS: Record<string, string> = {
  event_start: "Ao iniciar",
  event_update: "A cada frame",
  event_vblank: "No VBlank",
};

const BUTTON_LABELS: Record<string, string> = {
  BUTTON_RIGHT: "→",
  BUTTON_LEFT: "←",
  BUTTON_UP: "↑",
  BUTTON_DOWN: "↓",
  BUTTON_A: "A (Z)",
  BUTTON_B: "B (X)",
  BUTTON_C: "C (C)",
  BUTTON_START: "Start (Enter)",
};

function button(node: GraphNode): string {
  const value = String(node.params.button ?? "");
  return BUTTON_LABELS[value] ?? value;
}

function dataSource(graph: NodeGraph, nodeId: string, port: string): string | null {
  const edge = graph.edges.find((candidate) => candidate.toNode === nodeId && candidate.toPort === port);
  const source = edge ? graph.nodes.find((node) => node.id === edge.fromNode) : null;
  if (!source) return null;
  if (source.type === "var_get") return String(source.params.var_name);
  if (source.type === "logic_math") {
    const left = dataSource(graph, source.id, "a") ?? String(source.params.a ?? "?");
    return `${left} ${String(source.params.operator ?? "+")} ${String(source.params.b ?? "?")}`;
  }
  return source.label;
}

function describeCondition(graph: NodeGraph, node: GraphNode): string | null {
  switch (node.type) {
    case "input_held":
      return `tecla ${button(node)} segurada`;
    case "input_pressed":
      return `tecla ${button(node)} pressionada`;
    case "condition_overlap": {
      const probe = Number(node.params.probe_dx ?? 0) || Number(node.params.probe_dy ?? 0);
      return probe
        ? `${node.params.a} iria entrar em ${node.params.b}`
        : `${node.params.a} encosta em ${node.params.b}`;
    }
    case "condition_on_ground":
      return `${node.params.target} no chão`;
    case "condition_compare": {
      const left = dataSource(graph, node.id, "a") ?? String(node.params.a ?? "?");
      const right = dataSource(graph, node.id, "b") ?? String(node.params.b ?? "?");
      return `${left} ${String(node.params.operator ?? "==")} ${right}`;
    }
    default:
      return null;
  }
}

function describeAction(graph: NodeGraph, node: GraphNode): string | null {
  switch (node.type) {
    case "sprite_move":
      return `mover ${node.params.target} (${node.params.dx}, ${node.params.dy})`;
    case "set_velocity":
      return `impulso em ${node.params.target} (${node.params.vx}, ${node.params.vy})`;
    case "action_sound":
      return `tocar som ${node.params.sfx}`;
    case "action_music":
      return `${node.params.action === "stop" ? "parar" : "tocar"} música ${node.params.track ?? ""}`.trim();
    case "destroy_entity":
      return `esconder ${node.params.target}`;
    case "set_position":
      return `colocar ${node.params.target} em (${node.params.x}, ${node.params.y})`;
    case "spawn_entity":
      return `criar ${node.params.prefab} em (${node.params.x}, ${node.params.y})`;
    case "set_animation_state":
      return `animação de ${node.params.target}: ${node.params.state}`;
    case "sprite_anim":
      return `animação de ${node.params.target}: ${node.params.anim}`;
    case "camera_follow":
      return `câmera segue ${node.params.target}`;
    case "var_set": {
      const value = dataSource(graph, node.id, "value") ?? String(node.params.value ?? "0");
      return `${node.params.var_name} = ${value}`;
    }
    default:
      return null;
  }
}

export function summarizeRules(graph: NodeGraph): RuleSummary[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const execFrom = (nodeId: string, port: string) =>
    graph.edges.filter((edge) => edge.fromNode === nodeId && edge.fromPort === port);
  const rules: RuleSummary[] = [];
  for (const event of graph.nodes.filter((node) => node.type in EVENT_LABELS)) {
    const rule: RuleSummary = {
      id: event.id,
      when: EVENT_LABELS[event.type],
      conditions: [],
      actions: [],
      conditionItems: [],
      actionItems: [],
      elseBranches: [],
      advanced: null,
      nodeIds: [event.id],
    };
    const visited = new Set<string>([event.id]);
    const pushAction = (node: GraphNode, into: RuleItem[]) => {
      const action = describeAction(graph, node);
      if (action === null) {
        rule.advanced ??= `nó "${node.label}" não tem forma simples`;
      }
      into.push({ text: action ?? node.label, nodeId: node.id });
    };
    /** Follows a "senão" side; only a straight chain of actions has a simple form. */
    const followElse = (start: string, condition: string, conditionNodeId: string) => {
      const branch: RuleElseBranch = { condition, conditionNodeId, actions: [] };
      let next = execFrom(start, "false");
      while (next.length > 0) {
        if (next.length > 1) rule.advanced ??= "vários caminhos a partir do mesmo ponto";
        const node = byId.get(next[0].toNode);
        if (!node) break;
        if (visited.has(node.id)) {
          // Joining the main path again (e.g. both sides move the player) is not a loop.
          if (!rule.nodeIds.includes(node.id)) rule.advanced ??= "laço de execução";
          if (rule.nodeIds.includes(node.id)) branch.actions.push({ text: `continua em "${describeAction(graph, node) ?? node.label}"`, nodeId: node.id });
          break;
        }
        visited.add(node.id);
        rule.nodeIds.push(node.id);
        if (describeCondition(graph, node) !== null) {
          rule.advanced ??= `o caminho "senão" de "${condition}" tem outra condição`;
          branch.actions.push({ text: node.label, nodeId: node.id });
          break;
        }
        pushAction(node, branch.actions);
        next = execFrom(node.id, "exec");
      }
      rule.elseBranches.push(branch);
    };
    let next = execFrom(event.id, "exec");
    const pendingElse: Array<{ nodeId: string; condition: string }> = [];
    while (next.length > 0) {
      if (next.length > 1) rule.advanced ??= "vários caminhos a partir do mesmo ponto";
      const node = byId.get(next[0].toNode);
      if (!node) break;
      if (visited.has(node.id)) {
        rule.advanced ??= "laço de execução";
        break;
      }
      visited.add(node.id);
      rule.nodeIds.push(node.id);
      const condition = describeCondition(graph, node);
      if (condition !== null) {
        const onTrue = execFrom(node.id, "true").concat(execFrom(node.id, "exec"));
        const onFalse = execFrom(node.id, "false");
        if (onTrue.length === 0 && onFalse.length > 0) {
          rule.conditions.push(`não (${condition})`);
          rule.conditionItems.push({ text: `não (${condition})`, nodeId: node.id });
          next = onFalse;
        } else {
          rule.conditions.push(condition);
          rule.conditionItems.push({ text: condition, nodeId: node.id });
          if (onFalse.length > 0) pendingElse.push({ nodeId: node.id, condition });
          next = onTrue;
        }
        continue;
      }
      pushAction(node, rule.actionItems);
      next = execFrom(node.id, "exec");
    }
    // "Senão" sides are read after the main path so a side that rejoins it is recognized.
    for (const branch of pendingElse) followElse(branch.nodeId, branch.condition, branch.nodeId);
    rule.actions = rule.actionItems.map((item) => item.text);
    rules.push(rule);
  }
  return rules;
}
