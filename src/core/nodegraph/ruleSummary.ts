import type { GraphNode, NodeGraph } from "./nodeTypes";

/**
 * Read-only "Quando → Se → Fazer" view of the canonical graph. It never edits or rewrites
 * logic: each rule starts at an event node and follows exec edges. Branches whose "senão"
 * side also has actions, loops or unknown node types mark the rule as advanced; the text
 * then shows only the main path and says so, while the graph keeps the full logic.
 */
export type RuleSummary = {
  id: string;
  when: string;
  conditions: string[];
  actions: string[];
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
    const rule: RuleSummary = { id: event.id, when: EVENT_LABELS[event.type], conditions: [], actions: [], advanced: null, nodeIds: [event.id] };
    const visited = new Set<string>([event.id]);
    let next = execFrom(event.id, "exec");
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
        if (onTrue.length > 0 && onFalse.length > 0) {
          rule.advanced ??= `a condição "${condition}" também tem um caminho "senão"`;
        }
        if (onTrue.length === 0 && onFalse.length > 0) {
          rule.conditions.push(`não (${condition})`);
          next = onFalse;
        } else {
          rule.conditions.push(condition);
          next = onTrue;
        }
        continue;
      }
      const action = describeAction(graph, node);
      if (action === null) {
        rule.advanced ??= `nó "${node.label}" não tem forma simples`;
        rule.actions.push(node.label);
      } else {
        rule.actions.push(action);
      }
      next = execFrom(node.id, "exec");
    }
    rules.push(rule);
  }
  return rules;
}
