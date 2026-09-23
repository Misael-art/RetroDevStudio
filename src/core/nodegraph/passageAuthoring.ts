import { NODE_DEFS, clonePorts } from "./nodeDefinitions";
import type { GraphNode, NodeEdge, NodeGraph, NodeType } from "./nodeTypes";

/**
 * Passage contract (Experimental): a solid blocker entity that gates player movement
 * until a score rule opens it. It is exactly the shape used by the reference platformer,
 * generalized only over its references — blocker entity, player entity, open-state
 * variable, score variable and threshold. Nodes belonging to a passage carry
 * `passage_id` + `passage_role` params so the editor can list, edit and validate them.
 *
 * Runtime semantics come from the compiler: gates are `condition_overlap` with a movement
 * probe (`probe_dx`), i.e. "this move would enter the blocker", so the blocker holds from
 * both sides and an already-overlapping player can walk out.
 */
export type PassageRole =
  | "gate"
  | "open_check"
  | "open_get"
  | "rule"
  | "rule_score_get"
  | "rule_update"
  | "open_set"
  | "close_set"
  | "hide";

export type PassageSummary = {
  passageId: string;
  blocker: string | null;
  player: string | null;
  openVar: string | null;
  scoreVar: string | null;
  threshold: number | null;
  nodeIds: string[];
};

export type PassageSpec = {
  passageId: string;
  blocker: string;
  player: string;
  openVar: string;
  scoreVar: string;
  threshold: number;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function role(node: GraphNode): PassageRole | null {
  const value = node.params.passage_role;
  return typeof value === "string" ? (value as PassageRole) : null;
}

export function listPassages(graph: NodeGraph): PassageSummary[] {
  const byId = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const passageId = node.params.passage_id;
    if (typeof passageId !== "string" || !passageId) continue;
    byId.set(passageId, [...(byId.get(passageId) ?? []), node]);
  }
  return [...byId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([passageId, nodes]) => {
      const gate = nodes.find((node) => role(node) === "gate");
      const rule = nodes.find((node) => role(node) === "rule");
      const openSet = nodes.find((node) => role(node) === "open_set");
      const scoreGet = nodes.find((node) => role(node) === "rule_score_get");
      const threshold = rule ? Number(rule.params.b) : NaN;
      return {
        passageId,
        blocker: gate ? String(gate.params.b) : null,
        player: gate ? String(gate.params.a) : null,
        openVar: openSet ? String(openSet.params.var_name) : null,
        scoreVar: scoreGet ? String(scoreGet.params.var_name) : null,
        threshold: Number.isFinite(threshold) ? threshold : null,
        nodeIds: nodes.map((node) => node.id),
      };
    });
}

export type PassagePatch = Partial<Pick<PassageSpec, "blocker" | "openVar" | "threshold" | "scoreVar">>;

/** Rewrites the references of one passage by role; other passages are untouched. */
export function updatePassage(graph: NodeGraph, passageId: string, patch: PassagePatch): NodeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.params.passage_id !== passageId) return node;
      const params = { ...node.params };
      const nodeRole = role(node);
      if (patch.blocker !== undefined && (nodeRole === "gate" )) params.b = patch.blocker;
      if (patch.blocker !== undefined && nodeRole === "hide") params.target = patch.blocker;
      if (patch.openVar !== undefined && ["open_get", "open_set", "close_set"].includes(nodeRole ?? "")) {
        params.var_name = patch.openVar;
      }
      if (patch.scoreVar !== undefined && nodeRole === "rule_score_get") params.var_name = patch.scoreVar;
      if (patch.threshold !== undefined && nodeRole === "rule") params.b = patch.threshold;
      return { ...node, params };
    }),
  };
}

export type PassageIssue = { passageId: string; nodeId?: string; code: string; message: string };

/** Contract checks the generic graph validator cannot know about. */
export function validatePassages(
  graph: NodeGraph,
  sceneEntityIds?: readonly string[],
): PassageIssue[] {
  const issues: PassageIssue[] = [];
  const passages = listPassages(graph);
  const entities = sceneEntityIds ? new Set(sceneEntityIds) : null;
  for (const passage of passages) {
    const { passageId } = passage;
    if (!passage.blocker) {
      issues.push({ passageId, code: "passage_missing_gate", message: `Passagem '${passageId}' sem gate de colisao.` });
    } else if (entities && !entities.has(passage.blocker)) {
      issues.push({ passageId, code: "passage_broken_blocker", message: `Passagem '${passageId}' referencia o bloqueador '${passage.blocker}', que nao existe na cena.` });
    }
    if (!passage.openVar || !IDENTIFIER.test(passage.openVar)) {
      issues.push({ passageId, code: "passage_invalid_open_var", message: `Passagem '${passageId}' precisa de uma variavel de estado valida (letras, digitos, _).` });
    }
    if (passage.threshold === null || !Number.isInteger(passage.threshold) || passage.threshold < 0 || passage.threshold > 32767) {
      issues.push({ passageId, code: "passage_invalid_threshold", message: `Passagem '${passageId}' precisa de limiar inteiro entre 0 e 32767.` });
    }
    const openVarNodes = graph.nodes.filter(
      (node) => node.params.passage_id === passageId && ["open_get", "open_set", "close_set"].includes(role(node) ?? ""),
    );
    if (openVarNodes.some((node) => node.params.var_name !== passage.openVar)) {
      issues.push({ passageId, code: "passage_open_var_mismatch", message: `Passagem '${passageId}' le e escreve variaveis de estado diferentes.` });
    }
    const hide = graph.nodes.find((node) => node.params.passage_id === passageId && role(node) === "hide");
    const gates = graph.nodes.filter((node) => node.params.passage_id === passageId && role(node) === "gate");
    if ((hide && hide.params.target !== passage.blocker) || gates.some((gate) => gate.params.b !== passage.blocker)) {
      issues.push({ passageId, code: "passage_blocker_mismatch", message: `Passagem '${passageId}' bloqueia uma entidade e oculta outra.` });
    }
  }
  for (let i = 0; i < passages.length; i += 1) {
    for (let j = i + 1; j < passages.length; j += 1) {
      const a = passages[i];
      const b = passages[j];
      if (a.openVar && a.openVar === b.openVar) {
        issues.push({ passageId: b.passageId, code: "passage_shared_open_var", message: `Passagens '${a.passageId}' e '${b.passageId}' compartilham '${a.openVar}': abrir uma abriria a outra.` });
      }
      if (a.blocker && a.blocker === b.blocker) {
        issues.push({ passageId: b.passageId, code: "passage_shared_blocker", message: `Passagens '${a.passageId}' e '${b.passageId}' usam o mesmo bloqueador '${a.blocker}'.` });
      }
    }
  }
  return issues;
}

let passageNodeCounter = 0;

function makePassageNode(
  type: NodeType,
  spec: PassageSpec,
  passageRole: PassageRole,
  label: string,
  x: number,
  y: number,
  params: Record<string, string | number>,
): GraphNode {
  const def = NODE_DEFS[type];
  passageNodeCounter += 1;
  return {
    ...def,
    id: `${spec.passageId}_${passageRole}_${passageNodeCounter}`,
    label,
    x,
    y,
    inputs: clonePorts(def.inputs),
    outputs: clonePorts(def.outputs),
    params: { ...def.params, ...params, passage_id: spec.passageId, passage_role: passageRole },
  };
}

function edge(fromNode: string, fromPort: string, toNode: string, toPort: string): NodeEdge {
  passageNodeCounter += 1;
  return { id: `edge_${fromNode}_${fromPort}_${toNode}_${passageNodeCounter}`, fromNode, fromPort, toNode, toPort };
}

/**
 * Adds a passage: an independent update chain for the score rule, and one probe gate per
 * player movement node (`sprite_move` of the player with dx != 0), inserted in front of the
 * move so every existing gate keeps applying. Throws on an invalid spec.
 */
export function addPassage(graph: NodeGraph, spec: PassageSpec): NodeGraph {
  if (!spec.passageId || listPassages(graph).some((passage) => passage.passageId === spec.passageId)) {
    throw new Error(`Identificador de passagem invalido ou repetido: '${spec.passageId}'.`);
  }
  if (!IDENTIFIER.test(spec.openVar) || !IDENTIFIER.test(spec.scoreVar)) {
    throw new Error("Variaveis da passagem devem ser identificadores (letras, digitos, _).");
  }
  if (!Number.isInteger(spec.threshold) || spec.threshold < 0 || spec.threshold > 32767) {
    throw new Error("Limiar da passagem deve ser inteiro entre 0 e 32767.");
  }
  const moves = graph.nodes.filter(
    (node) => node.type === "sprite_move" && node.params.target === spec.player && Number(node.params.dx) !== 0,
  );
  if (moves.length === 0) {
    throw new Error(`Nenhum no de movimento horizontal do '${spec.player}' para proteger com a passagem.`);
  }
  const baseY = Math.max(0, ...graph.nodes.map((node) => node.y)) + 200;
  const nodes: GraphNode[] = [];
  const edges: NodeEdge[] = [];
  const redirected = new Set<string>();

  moves.forEach((move, index) => {
    const dx = Number(move.params.dx);
    const y = baseY + index * 140;
    const gate = makePassageNode("condition_overlap", spec, "gate", `Would Enter ${spec.blocker} (${dx > 0 ? "Right" : "Left"})`, 360, y, {
      a: spec.player, b: spec.blocker, probe_dx: dx, probe_dy: 0,
    });
    const openGet = makePassageNode("var_get", spec, "open_get", `Read ${spec.openVar}`, 540, y + 70, { var_name: spec.openVar });
    const openCheck = makePassageNode("condition_compare", spec, "open_check", `${spec.blocker} Is Open`, 720, y, { operator: "==", b: 1 });
    nodes.push(gate, openGet, openCheck);
    for (const incoming of graph.edges) {
      if (incoming.toNode === move.id && incoming.toPort === "exec") {
        redirected.add(incoming.id);
        edges.push({ ...incoming, toNode: gate.id });
      }
    }
    edges.push(
      edge(gate.id, "false", move.id, "exec"),
      edge(gate.id, "true", openCheck.id, "exec"),
      edge(openGet.id, "value", openCheck.id, "a"),
      edge(openCheck.id, "true", move.id, "exec"),
    );
  });

  const ruleY = baseY + moves.length * 140;
  const update = makePassageNode("event_update", spec, "rule_update", `Update ${spec.passageId}`, 0, ruleY, {});
  const scoreGet = makePassageNode("var_get", spec, "rule_score_get", `Read ${spec.scoreVar}`, 180, ruleY + 90, { var_name: spec.scoreVar });
  const rule = makePassageNode("condition_compare", spec, "rule", `${spec.scoreVar} Opens ${spec.blocker}`, 360, ruleY, {
    operator: ">=", b: spec.threshold, semantic: `${spec.scoreVar} >= threshold opens ${spec.blocker}`,
  });
  const openSet = makePassageNode("var_set", spec, "open_set", `Open ${spec.blocker}`, 540, ruleY - 50, { var_name: spec.openVar, value: 1 });
  const hide = makePassageNode("destroy_entity", spec, "hide", `Hide ${spec.blocker}`, 720, ruleY - 50, { target: spec.blocker });
  const closeSet = makePassageNode("var_set", spec, "close_set", `Keep ${spec.blocker} Closed`, 540, ruleY + 60, { var_name: spec.openVar, value: 0 });
  nodes.push(update, scoreGet, rule, openSet, hide, closeSet);
  edges.push(
    edge(update.id, "exec", rule.id, "exec"),
    edge(scoreGet.id, "value", rule.id, "a"),
    edge(rule.id, "true", openSet.id, "exec"),
    edge(openSet.id, "exec", hide.id, "exec"),
    edge(rule.id, "false", closeSet.id, "exec"),
  );

  return {
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges.filter((existing) => !redirected.has(existing.id)), ...edges],
  };
}
