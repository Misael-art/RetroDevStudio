/**
 * behaviorLibrary.ts — Comportamentos parametrizados (Experimental).
 *
 * Um comportamento gera nos/arestas comuns do NodeGraph (mesmo pipeline de persistencia e
 * compilacao SGDK) e registra uma instancia em `graph.behaviors`. Regras:
 * - cada instancia tem id proprio; nos/arestas usam `<instancia>__<papel>`;
 * - estado criado pelo comportamento (variaveis) e exclusivo da instancia;
 * - referencias externas (outra entidade, variavel existente, outra instancia) sao
 *   parametros explicitos e listadas em `externalRefs`;
 * - aplicar, editar e remover primeiro planejam a mudanca (`plan*`) e devolvem conflitos
 *   (duplicacao, edicao manual, dependencias, referencias invalidas) antes de alterar.
 */
import { NODE_DEFS, clonePorts } from "./nodeDefinitions";
import { layoutNodeGraph } from "./nodeLayout";
import type { BehaviorInstance, GraphNode, NodeEdge, NodeGraph, NodeType } from "./nodeTypes";

// ── Contexto da cena (o que o formulario oferece e o que a validacao confere) ──

export type BehaviorSceneEntity = {
  id: string;
  label: string;
  hasSprite: boolean;
  hasPhysics: boolean;
  hasCollision: boolean;
  animations: string[];
};

export type BehaviorSceneContext = {
  entities: BehaviorSceneEntity[];
  sounds: string[];
  /** Variaveis inteiras escritas em algum grafo da cena (candidatas a "estado"). */
  variables: string[];
  /**
   * Ids de instancia ja usados em QUALQUER grafo da cena. As variaveis privadas derivam
   * do id e sao globais na ROM, entao o id precisa ser unico na cena inteira.
   */
  instanceIds: string[];
};

// ── Parametros tipados ────────────────────────────────────────────────────────

export type BehaviorParamSpec =
  | { key: string; label: string; kind: "entity"; require: "sprite" | "collidable"; help?: string }
  | { key: string; label: string; kind: "int"; min: number; max: number; default: number; unit?: string; help?: string }
  | { key: string; label: string; kind: "button"; optional: boolean; default: string; help?: string }
  | { key: string; label: string; kind: "animation"; ofEntityParam: string; help?: string }
  | { key: string; label: string; kind: "sound"; help?: string }
  | { key: string; label: string; kind: "variable"; help?: string }
  | { key: string; label: string; kind: "instance"; behaviorId: string; help?: string };

export type BehaviorParams = Record<string, string | number>;

type BuiltNode = { role: string; type: NodeType; label: string; params: BehaviorParams };
type BuiltEdge = { from: string; fromPort: string; to: string; toPort: string };
type Built = { nodes: BuiltNode[]; edges: BuiltEdge[]; replaceEdges?: NodeEdge[]; replaceGateRoles?: string[]; hookEdges?: Array<{ fromNode: string; fromPort: string; toRole: string; toPort: string } | { fromRole: string; fromPort: string; toNode: string; toPort: string }> };

export type BehaviorDefinition = {
  id: string;
  title: string;
  description: string;
  params: BehaviorParamSpec[];
  /** Frase do resultado esperado, com os valores escolhidos. */
  summarize: (params: BehaviorParams, context: BehaviorSceneContext) => string;
  /** Mensagens de referencia/parametro invalido (vazio = pode aplicar). */
  validate: (params: BehaviorParams, context: BehaviorSceneContext, graph: NodeGraph, instanceId: string | null) => string[];
  build: (params: BehaviorParams, instanceId: string, graph: NodeGraph) => Built;
  /** Referencias externas explicitas desta instancia. */
  externalRefs: (params: BehaviorParams) => Array<{ kind: "entity" | "variable" | "instance"; id: string; param: string }>;
};

const BUTTON_TEXT: Record<string, string> = {
  BUTTON_A: "A (Z)",
  BUTTON_B: "B (X)",
  BUTTON_C: "C (C)",
  BUTTON_START: "Start (Enter)",
  BUTTON_UP: "↑",
  BUTTON_DOWN: "↓",
  BUTTON_LEFT: "←",
  BUTTON_RIGHT: "→",
};
const buttonText = (value: string | number | undefined) => BUTTON_TEXT[String(value)] ?? String(value);
const entityLabel = (context: BehaviorSceneContext, id: string | number | undefined) =>
  context.entities.find((entity) => entity.id === String(id))?.label ?? String(id ?? "?");
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

function intError(spec: BehaviorParamSpec, value: string | number | undefined): string | null {
  if (spec.kind !== "int") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < spec.min || n > spec.max) return `${spec.label}: use um inteiro entre ${spec.min} e ${spec.max}.`;
  return null;
}

function commonValidation(def: BehaviorDefinition, params: BehaviorParams, context: BehaviorSceneContext, graph: NodeGraph): string[] {
  const errors: string[] = [];
  const pressed = new Map<string, string>();
  for (const spec of def.params) {
    const value = params[spec.key];
    switch (spec.kind) {
      case "entity": {
        const entity = context.entities.find((candidate) => candidate.id === String(value ?? ""));
        if (!entity) errors.push(`${spec.label}: escolha uma entidade existente${value ? ` ("${value}" nao existe na cena)` : ""}.`);
        else if (spec.require === "sprite" && !entity.hasSprite) errors.push(`${spec.label}: "${entity.label}" nao tem sprite; nao ha o que mover.`);
        else if (spec.require === "collidable" && !entity.hasSprite && !entity.hasCollision) errors.push(`${spec.label}: "${entity.label}" nao tem sprite nem colisao para bloquear a passagem.`);
        break;
      }
      case "int": {
        const error = intError(spec, value);
        if (error) errors.push(error);
        break;
      }
      case "button": {
        const text = String(value ?? "");
        if (!text) {
          if (!spec.optional) errors.push(`${spec.label}: escolha um botao.`);
          break;
        }
        if (!(text in BUTTON_TEXT)) errors.push(`${spec.label}: botao "${text}" nao existe no Mega Drive.`);
        else if (pressed.has(text)) errors.push(`${spec.label} e ${pressed.get(text)} usam o mesmo botao ${buttonText(text)}.`);
        else pressed.set(text, spec.label);
        break;
      }
      case "animation": {
        const text = String(value ?? "");
        if (!text) break;
        const owner = context.entities.find((entity) => entity.id === String(params[spec.ofEntityParam] ?? ""));
        if (owner && !owner.animations.includes(text)) errors.push(`${spec.label}: "${owner.label}" nao tem a animacao "${text}".`);
        break;
      }
      case "sound": {
        const text = String(value ?? "");
        if (text && !context.sounds.includes(text)) errors.push(`${spec.label}: o som "${text}" nao existe na cena.`);
        break;
      }
      case "variable": {
        const text = String(value ?? "");
        if (!IDENTIFIER.test(text)) errors.push(`${spec.label}: escolha uma variavel valida.`);
        else if (!context.variables.includes(text)) errors.push(`${spec.label}: nenhuma logica da cena escreve "${text}"; o limiar nunca seria alcancado.`);
        break;
      }
      case "instance": {
        const target = (graph.behaviors ?? []).find((instance) => instance.id === String(value ?? ""));
        if (!target || target.behaviorId !== spec.behaviorId) errors.push(`${spec.label}: escolha um comportamento "${getBehaviorDefinition(spec.behaviorId)?.title}" desta entidade.`);
        break;
      }
    }
  }
  return errors;
}

// ── Movimento e salto ─────────────────────────────────────────────────────────

const movement: BehaviorDefinition = {
  id: "platform_movement",
  title: "Movimento e salto",
  description: "Anda para os lados enquanto o botao estiver segurado e salta ao apertar, somente quando esta apoiado no chao. Usa a fisica (gravidade) da entidade.",
  params: [
    { key: "target", label: "Entidade", kind: "entity", require: "sprite", help: "Quem se move." },
    { key: "speed", label: "Velocidade", kind: "int", min: 1, max: 8, default: 2, unit: "px por quadro" },
    { key: "right_button", label: "Andar para a direita", kind: "button", optional: false, default: "BUTTON_RIGHT" },
    { key: "left_button", label: "Andar para a esquerda", kind: "button", optional: true, default: "BUTTON_LEFT" },
    { key: "jump_button", label: "Saltar", kind: "button", optional: true, default: "BUTTON_A" },
    { key: "jump_strength", label: "Forca do salto", kind: "int", min: 8, max: 128, default: 64, help: "Impulso para cima (quanto maior, mais alto)." },
    { key: "jump_animation", label: "Animacao ao saltar", kind: "animation", ofEntityParam: "target" },
    { key: "jump_sound", label: "Som do salto", kind: "sound" },
  ],
  summarize: (p, context) => {
    const who = entityLabel(context, p.target);
    const parts = [`${who} anda ${p.speed} px por quadro para a direita segurando ${buttonText(p.right_button)}`];
    if (p.left_button) parts.push(`para a esquerda com ${buttonText(p.left_button)}`);
    if (p.jump_button) {
      parts.push(`salta (so do chao) com forca ${p.jump_strength} ao apertar ${buttonText(p.jump_button)}${p.jump_animation ? ` (animacao "${p.jump_animation}")` : ""}${p.jump_sound ? ` tocando "${p.jump_sound}"` : ""}`);
    }
    return `${parts.join(", ")}.`;
  },
  validate: (p, context, graph) => {
    const errors = commonValidation(movement, p, context, graph);
    const target = context.entities.find((entity) => entity.id === String(p.target ?? ""));
    if (target && p.jump_button && !target.hasPhysics) {
      errors.push(`Saltar: "${target.label}" nao tem fisica (gravidade); o salto nao teria efeito. Ative Fisica no Inspector ou deixe "Saltar" vazio.`);
    }
    return errors;
  },
  build: (p) => {
    const target = String(p.target);
    const speed = Number(p.speed);
    const nodes: BuiltNode[] = [
      { role: "right_tick", type: "event_update", label: "A cada quadro (direita)", params: {} },
      { role: "right_input", type: "input_held", label: "Segurar direita", params: { pad: "JOY_1", button: String(p.right_button) } },
      { role: "right_move", type: "sprite_move", label: "Andar para a direita", params: { target, dx: speed, dy: 0 } },
    ];
    const edges: BuiltEdge[] = [
      { from: "right_tick", fromPort: "exec", to: "right_input", toPort: "exec" },
      { from: "right_input", fromPort: "exec", to: "right_move", toPort: "exec" },
    ];
    if (p.left_button) {
      nodes.push(
        { role: "left_tick", type: "event_update", label: "A cada quadro (esquerda)", params: {} },
        { role: "left_input", type: "input_held", label: "Segurar esquerda", params: { pad: "JOY_1", button: String(p.left_button) } },
        { role: "left_move", type: "sprite_move", label: "Andar para a esquerda", params: { target, dx: -speed, dy: 0 } }
      );
      edges.push(
        { from: "left_tick", fromPort: "exec", to: "left_input", toPort: "exec" },
        { from: "left_input", fromPort: "exec", to: "left_move", toPort: "exec" }
      );
    }
    if (p.jump_button) {
      nodes.push(
        { role: "jump_tick", type: "event_update", label: "A cada quadro (salto)", params: {} },
        { role: "jump_input", type: "input_pressed", label: "Apertar salto", params: { pad: "JOY_1", button: String(p.jump_button) } },
        { role: "jump_ground", type: "condition_on_ground", label: "Esta no chao?", params: { target } },
        { role: "jump_velocity", type: "set_velocity", label: "Impulso do salto", params: { target, vx: 0, vy: -Number(p.jump_strength) } }
      );
      // Salto so a partir do chao: pressao no ar nao reinicia o impulso; segurar nao voa
      // (input_pressed dispara so na borda de descida do botao).
      edges.push(
        { from: "jump_tick", fromPort: "exec", to: "jump_input", toPort: "exec" },
        { from: "jump_input", fromPort: "exec", to: "jump_ground", toPort: "exec" },
        { from: "jump_ground", fromPort: "true", to: "jump_velocity", toPort: "exec" }
      );
      let last = "jump_velocity";
      if (p.jump_animation) {
        nodes.push({ role: "jump_animation", type: "set_animation_state", label: "Animacao do salto", params: { target, state: String(p.jump_animation) } });
        edges.push({ from: last, fromPort: "exec", to: "jump_animation", toPort: "exec" });
        last = "jump_animation";
      }
      if (p.jump_sound) {
        nodes.push({ role: "jump_sound", type: "action_sound", label: "Som do salto", params: { sfx: String(p.jump_sound) } });
        edges.push({ from: last, fromPort: "exec", to: "jump_sound", toPort: "exec" });
      }
    }
    return { nodes, edges };
  },
  externalRefs: (p) => [{ kind: "entity", id: String(p.target), param: "target" }],
};

// ── Passagem condicionada ─────────────────────────────────────────────────────

/** Variavel de estado exclusiva da instancia (nunca compartilhada entre instancias). */
export function passageOpenVariable(instanceId: string): string {
  return `${instanceId}_open`;
}

const passage: BehaviorDefinition = {
  id: "gated_passage",
  title: "Passagem condicionada",
  description: "Um bloqueio impede o movimento ate uma variavel atingir o limiar; entao o bloqueio some e a passagem abre.",
  params: [
    { key: "movement", label: "Movimento bloqueado", kind: "instance", behaviorId: "platform_movement", help: "Qual 'Movimento e salto' desta entidade o bloqueio segura." },
    { key: "blocker", label: "Bloqueio", kind: "entity", require: "collidable", help: "Entidade que fecha a passagem e some ao abrir." },
    { key: "state_variable", label: "Estado que abre", kind: "variable", help: "Variavel do jogo comparada com o limiar." },
    { key: "threshold", label: "Limiar", kind: "int", min: 0, max: 32767, default: 10, help: "Abre quando o estado for maior ou igual a este valor." },
  ],
  summarize: (p, context) =>
    `"${entityLabel(context, p.blocker)}" bloqueia o movimento ate ${p.state_variable} >= ${p.threshold}; entao o bloqueio some e a passagem abre.`,
  validate: (p, context, graph) => {
    const errors = commonValidation(passage, p, context, graph);
    const mover = (graph.behaviors ?? []).find((instance) => instance.id === String(p.movement ?? ""));
    if (mover && String(mover.params.target) === String(p.blocker)) errors.push("Bloqueio: a entidade nao pode bloquear a si mesma.");
    if (mover) {
      const other = (graph.behaviors ?? []).find(
        (instance) => instance.behaviorId === "gated_passage" && instance.params.movement === mover.id && instance.params.blocker === p.blocker && instance.id !== p.__self
      );
      if (other) errors.push(`Bloqueio: "${entityLabel(context, p.blocker)}" ja bloqueia este movimento (${other.label}).`);
    }
    return errors;
  },
  build: (p, instanceId, graph) => {
    const mover = (graph.behaviors ?? []).find((instance) => instance.id === String(p.movement))!;
    const target = String(mover.params.target);
    const blocker = String(p.blocker);
    const openVar = passageOpenVariable(instanceId);
    const speed = Number(mover.params.speed);
    const nodes: BuiltNode[] = [
      { role: "rule_tick", type: "event_update", label: "A cada quadro (limiar)", params: {} },
      { role: "rule_value", type: "var_get", label: `Ler ${p.state_variable}`, params: { var_name: String(p.state_variable) } },
      { role: "rule", type: "condition_compare", label: "Estado atingiu o limiar", params: { operator: ">=", b: Number(p.threshold) } },
      { role: "open", type: "var_set", label: "Marcar passagem aberta", params: { var_name: openVar, value: 1 } },
      { role: "hide", type: "destroy_entity", label: "Esconder bloqueio", params: { target: blocker } },
    ];
    const edges: BuiltEdge[] = [
      { from: "rule_tick", fromPort: "exec", to: "rule", toPort: "exec" },
      { from: "rule_value", fromPort: "value", to: "rule", toPort: "a" },
      { from: "rule", fromPort: "true", to: "open", toPort: "exec" },
      { from: "open", fromPort: "exec", to: "hide", toPort: "exec" },
    ];
    // Porta logo apos a entrada de cada direcao: envolve o estagio atual (o movimento ou a
    // porta de outra passagem), entao varias passagens no mesmo movimento se encadeiam.
    const replaceEdges: NodeEdge[] = [];
    const replaceGateRoles: string[] = [];
    const hookEdges: NonNullable<Built["hookEdges"]> = [];
    for (const [side, dx] of [["right", speed], ["left", -speed]] as const) {
      const inputId = `${mover.id}__${side}_input`;
      const direct = graph.edges.find((edge) => edge.fromNode === inputId && edge.fromPort === "exec" && edge.toPort === "exec");
      if (!direct) continue;
      const moveId = direct.toNode;
      replaceEdges.push(direct);
      replaceGateRoles.push(`${side}_gate`);
      nodes.push(
        { role: `${side}_gate`, type: "condition_overlap", label: `Iria entrar no bloqueio (${side === "right" ? "direita" : "esquerda"})`, params: { a: target, b: blocker, probe_dx: dx, probe_dy: 0 } },
        { role: `${side}_open_value`, type: "var_get", label: "Ler passagem aberta", params: { var_name: openVar } },
        { role: `${side}_open_check`, type: "condition_compare", label: "Passagem aberta", params: { operator: "==", b: 1 } }
      );
      edges.push(
        { from: `${side}_gate`, fromPort: "true", to: `${side}_open_check`, toPort: "exec" },
        { from: `${side}_open_value`, fromPort: "value", to: `${side}_open_check`, toPort: "a" }
      );
      hookEdges.push(
        { fromNode: direct.fromNode, fromPort: direct.fromPort, toRole: `${side}_gate`, toPort: "exec" },
        { fromRole: `${side}_gate`, fromPort: "false", toNode: moveId, toPort: "exec" },
        { fromRole: `${side}_open_check`, fromPort: "true", toNode: moveId, toPort: "exec" }
      );
    }
    return { nodes, edges, replaceEdges, replaceGateRoles, hookEdges };
  },
  externalRefs: (p) => [
    { kind: "instance", id: String(p.movement), param: "movement" },
    { kind: "entity", id: String(p.blocker), param: "blocker" },
    { kind: "variable", id: String(p.state_variable), param: "state_variable" },
  ],
};

export const BEHAVIOR_LIBRARY: BehaviorDefinition[] = [movement, passage];

export function getBehaviorDefinition(id: string): BehaviorDefinition | undefined {
  return BEHAVIOR_LIBRARY.find((definition) => definition.id === id);
}

export function defaultBehaviorParams(definition: BehaviorDefinition, context: BehaviorSceneContext, graph: NodeGraph, preferredEntity?: string): BehaviorParams {
  const params: BehaviorParams = {};
  for (const spec of definition.params) {
    if (spec.kind === "int") params[spec.key] = spec.default;
    else if (spec.kind === "button") params[spec.key] = spec.default;
    else if (spec.kind === "entity") {
      const candidates = context.entities.filter((entity) => (spec.require === "sprite" ? entity.hasSprite : entity.hasSprite || entity.hasCollision));
      params[spec.key] = candidates.find((entity) => entity.id === preferredEntity && spec.key === "target")?.id
        ?? candidates.find((entity) => entity.id !== preferredEntity)?.id
        ?? "";
    } else if (spec.kind === "instance") {
      params[spec.key] = (graph.behaviors ?? []).find((instance) => instance.behaviorId === spec.behaviorId)?.id ?? "";
    } else if (spec.kind === "variable") params[spec.key] = context.variables[0] ?? "";
    else params[spec.key] = "";
  }
  return params;
}

// ── Contexto a partir da cena ─────────────────────────────────────────────────

type SceneEntityLike = {
  entity_id: string;
  display_name?: string | null;
  components: {
    sprite?: { animations?: Record<string, unknown> } | null;
    physics?: unknown;
    collision?: unknown;
    audio?: { sfx?: Record<string, string> } | null;
  };
};

export function buildBehaviorSceneContext(entities: SceneEntityLike[], graphs: NodeGraph[]): BehaviorSceneContext {
  const variables = new Set<string>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (node.type === "var_set" && typeof node.params.var_name === "string" && IDENTIFIER.test(node.params.var_name)) variables.add(node.params.var_name);
    }
  }
  return {
    entities: entities.map((entity) => ({
      id: entity.entity_id,
      label: entity.display_name || entity.entity_id,
      hasSprite: Boolean(entity.components.sprite),
      hasPhysics: Boolean(entity.components.physics),
      hasCollision: Boolean(entity.components.collision),
      animations: Object.keys(entity.components.sprite?.animations ?? {}),
    })),
    sounds: [...new Set(entities.flatMap((entity) => Object.keys(entity.components.audio?.sfx ?? {})))].sort(),
    variables: [...variables].sort(),
    instanceIds: graphs.flatMap((graph) => (graph.behaviors ?? []).map((instance) => instance.id)),
  };
}

// ── Planejar e aplicar ────────────────────────────────────────────────────────

export type BehaviorConflict = { kind: "duplicate" | "manual_edit" | "manual_logic" | "dependency" | "orphan"; message: string };

export type BehaviorPlan = {
  ok: boolean;
  /** Referencias/parametros invalidos: a acao e recusada. */
  errors: string[];
  /** Situacoes que exigem confirmacao explicita antes de aplicar. */
  conflicts: BehaviorConflict[];
  summary: string;
  graph: NodeGraph | null;
  instanceId: string | null;
};

function nodeSignature(node: Pick<GraphNode, "type" | "params">): string {
  return JSON.stringify({ type: node.type, params: Object.keys(node.params).sort().map((key) => [key, node.params[key]]) });
}

function makeNode(built: BuiltNode, instanceId: string, behaviorId: string, x: number, y: number): GraphNode {
  const def = NODE_DEFS[built.type];
  return {
    id: `${instanceId}__${built.role}`,
    type: built.type,
    label: built.label,
    x,
    y,
    inputs: clonePorts(def.inputs),
    outputs: clonePorts(def.outputs),
    params: { ...def.params, ...built.params, behavior_instance: instanceId, behavior_id: behaviorId, behavior_role: built.role },
  };
}

function nextInstanceId(graph: NodeGraph, behaviorId: string, entityHint: string, sceneTaken: Iterable<string> = []): string {
  const base = `bh_${behaviorId === "platform_movement" ? "move" : "pass"}_${entityHint.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const taken = new Set([...sceneTaken, ...(graph.behaviors ?? []).map((instance) => instance.id), ...graph.nodes.map((node) => node.id.split("__")[0])]);
  let n = 1;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Nos da instancia que o autor alterou depois da geracao. */
export function manuallyEditedNodes(graph: NodeGraph, instance: BehaviorInstance): GraphNode[] {
  return instance.nodeIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is GraphNode => Boolean(node) && instance.generated[node!.id] !== undefined && instance.generated[node!.id] !== nodeSignature(node!));
}

/** Arestas criadas a mao que tocam os nos da instancia. */
function manualEdgesTouching(graph: NodeGraph, instance: BehaviorInstance): NodeEdge[] {
  const nodeIds = new Set(instance.nodeIds);
  const own = new Set(instance.edgeIds);
  const owned = new Set((graph.behaviors ?? []).flatMap((other) => other.edgeIds));
  return graph.edges.filter((edge) => !own.has(edge.id) && !owned.has(edge.id) && (nodeIds.has(edge.fromNode) || nodeIds.has(edge.toNode)));
}

function removeInstanceFromGraph(graph: NodeGraph, instance: BehaviorInstance): NodeGraph {
  const nodeIds = new Set(instance.nodeIds);
  const edgeIds = new Set(instance.edgeIds);
  let working = graph.edges;
  let others = (graph.behaviors ?? []).filter((candidate) => candidate.id !== instance.id);
  const restores: Array<{ edge: NodeEdge; at: number }> = [];
  (instance.replacedEdges ?? []).forEach((replaced, index) => {
    const gate = instance.replacedEdgeGates?.[index];
    // O estagio que esta porta envolve agora (lido do grafo atual).
    const next = gate ? working.find((edge) => edge.fromNode === gate && edge.fromPort === "false")?.toNode ?? replaced.toNode : replaced.toNode;
    const restored = { ...replaced, toNode: next };
    const ownIncoming = gate ? working.some((edge) => edge.toNode === gate && edgeIds.has(edge.id)) : true;
    if (ownIncoming) {
      // Esta porta e a mais externa: a ligacao original volta, apontando para o estagio seguinte.
      restores.push({ edge: restored, at: instance.replacedEdgeIndexes?.[index] ?? working.length });
    } else if (gate) {
      // Outra passagem envolve esta: ela passa a apontar direto para o estagio seguinte e
      // herda a ligacao original no seu registro (para restaura-la exatamente depois).
      const hook = working.find((edge) => edge.toNode === gate && !edgeIds.has(edge.id));
      void hook;
      const originalIndex = instance.replacedEdgeIndexes?.[index];
      others = others.map((other) => {
        if (!other.replacedEdges) return other;
        const slot = other.replacedEdges.findIndex((edge) => edgeIds.has(edge.id) && edge.toNode === gate);
        if (slot < 0) return other;
        return {
          ...other,
          replacedEdges: other.replacedEdges.map((edge, i) => (i === slot ? restored : edge)),
          ...(other.replacedEdgeIndexes && originalIndex !== undefined
            ? { replacedEdgeIndexes: other.replacedEdgeIndexes.map((at, i) => (i === slot ? originalIndex : at)) }
            : {}),
        };
      });
    }
    if (gate) working = working.map((edge) => (edge.toNode === gate && !edgeIds.has(edge.id) ? { ...edge, toNode: next } : edge));
  });
  const edges = working.filter((edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.fromNode) && !nodeIds.has(edge.toNode));
  const alive = new Set(graph.nodes.filter((node) => !nodeIds.has(node.id)).map((node) => node.id));
  for (const { edge, at } of restores.sort((a, b) => a.at - b.at)) {
    if (alive.has(edge.fromNode) && alive.has(edge.toNode) && !edges.some((candidate) => candidate.id === edge.id)) {
      edges.splice(Math.min(Math.max(0, at), edges.length), 0, edge);
    }
  }
  const groups = (graph.groups ?? []).filter((group) => group.id !== instance.id);
  const next: NodeGraph = { ...graph, nodes: graph.nodes.filter((node) => !nodeIds.has(node.id)), edges };
  if (groups.length) next.groups = groups;
  else delete next.groups;
  if (others.length) next.behaviors = others;
  else delete next.behaviors;
  return next;
}

function insertInstance(
  graph: NodeGraph,
  definition: BehaviorDefinition,
  params: BehaviorParams,
  instanceId: string,
  label: string,
  previousPositions: Map<string, { x: number; y: number }>
): NodeGraph {
  const built = definition.build(params, instanceId, graph);
  const bottom = graph.nodes.length ? Math.max(...graph.nodes.map((node) => node.y)) + 260 : 40;
  const left = graph.nodes.length ? Math.min(...graph.nodes.map((node) => node.x)) : 40;
  const nodes = built.nodes.map((node, index) => {
    const id = `${instanceId}__${node.role}`;
    const kept = previousPositions.get(id);
    return makeNode(node, instanceId, definition.id, kept?.x ?? left + index * 40, kept?.y ?? bottom);
  });
  const id = (role: string) => `${instanceId}__${role}`;
  const edges: NodeEdge[] = built.edges.map((edge) => ({
    id: `${instanceId}__e_${edge.from}_${edge.fromPort}_${edge.to}_${edge.toPort}`,
    fromNode: id(edge.from),
    fromPort: edge.fromPort,
    toNode: id(edge.to),
    toPort: edge.toPort,
  }));
  for (const hook of built.hookEdges ?? []) {
    const fromNode = "fromRole" in hook ? id(hook.fromRole) : hook.fromNode;
    const toNode = "toRole" in hook ? id(hook.toRole) : hook.toNode;
    edges.push({ id: `${instanceId}__h_${fromNode}_${hook.fromPort}_${toNode}`, fromNode, fromPort: hook.fromPort, toNode, toPort: hook.toPort });
  }
  const replaced = new Set((built.replaceEdges ?? []).map((edge) => edge.id));
  const replacedIndexes = (built.replaceEdges ?? []).map((edge) => graph.edges.findIndex((candidate) => candidate.id === edge.id));
  const instance: BehaviorInstance = {
    id: instanceId,
    behaviorId: definition.id,
    label,
    params: { ...params },
    nodeIds: nodes.map((node) => node.id),
    edgeIds: edges.map((edge) => edge.id),
    generated: Object.fromEntries(nodes.map((node) => [node.id, nodeSignature(node)])),
    ...(built.replaceEdges?.length
      ? {
          replacedEdges: built.replaceEdges,
          replacedEdgeIndexes: replacedIndexes,
          replacedEdgeGates: (built.replaceGateRoles ?? []).map((role) => `${instanceId}__${role}`),
        }
      : {}),
  };
  let next: NodeGraph = {
    ...graph,
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges.filter((edge) => !replaced.has(edge.id)), ...edges],
    behaviors: [...(graph.behaviors ?? []), instance],
    groups: [...(graph.groups ?? []).filter((group) => group.id !== instanceId), { id: instanceId, label, nodeIds: instance.nodeIds }],
  };
  // Posiciona so os nos novos (as posicoes do resto do grafo nao mudam).
  const fresh = nodes.filter((node) => !previousPositions.has(node.id)).map((node) => node.id);
  if (fresh.length) next = layoutNodeGraph(next, { scope: fresh }).graph;
  return next;
}

function instanceLabel(definition: BehaviorDefinition, params: BehaviorParams, context: BehaviorSceneContext): string {
  const who = definition.id === "gated_passage" ? entityLabel(context, params.blocker) : entityLabel(context, params.target);
  return `${definition.title} — ${who}`;
}

/** Planeja aplicar um comportamento novo. Nada muda ate o chamador usar `plan.graph`. */
export function planApplyBehavior(graph: NodeGraph, behaviorId: string, params: BehaviorParams, context: BehaviorSceneContext): BehaviorPlan {
  const definition = getBehaviorDefinition(behaviorId);
  if (!definition) return { ok: false, errors: [`Comportamento desconhecido: ${behaviorId}`], conflicts: [], summary: "", graph: null, instanceId: null };
  const errors = definition.validate(params, context, graph, null);
  const summary = errors.length ? "" : definition.summarize(params, context);
  if (errors.length) return { ok: false, errors, conflicts: [], summary, graph: null, instanceId: null };
  const conflicts: BehaviorConflict[] = [];
  if (behaviorId === "platform_movement") {
    const same = (graph.behaviors ?? []).filter((instance) => instance.behaviorId === behaviorId && instance.params.target === params.target);
    for (const instance of same) conflicts.push({ kind: "duplicate", message: `"${instance.label}" ja move esta entidade; aplicar outro soma os dois movimentos.` });
    const manual = graph.nodes.filter(
      (node) => !node.params.behavior_instance && (node.type === "sprite_move" || node.type === "set_velocity") && node.params.target === params.target
    );
    if (manual.length) conflicts.push({ kind: "manual_logic", message: `A logica manual ja move "${entityLabel(context, params.target)}" (${manual.length} no(s)); os efeitos se somariam.` });
  }
  const hint = String(behaviorId === "gated_passage" ? params.blocker : params.target);
  const instanceId = nextInstanceId(graph, behaviorId, hint, context.instanceIds);
  const next = insertInstance(graph, definition, params, instanceId, instanceLabel(definition, params, context), new Map());
  return { ok: true, errors: [], conflicts, summary, graph: next, instanceId };
}

function dependents(graph: NodeGraph, instanceId: string): BehaviorInstance[] {
  return (graph.behaviors ?? []).filter((instance) => Object.values(instance.params).includes(instanceId) && instance.id !== instanceId);
}

/** Planeja editar os parametros de uma instancia existente (mesmos ids e posicoes). */
export function planEditBehavior(graph: NodeGraph, instanceId: string, params: BehaviorParams, context: BehaviorSceneContext): BehaviorPlan {
  const instance = (graph.behaviors ?? []).find((candidate) => candidate.id === instanceId);
  const definition = instance ? getBehaviorDefinition(instance.behaviorId) : undefined;
  if (!instance || !definition) return { ok: false, errors: ["Comportamento nao encontrado."], conflicts: [], summary: "", graph: null, instanceId: null };
  const errors = definition.validate({ ...params, __self: instanceId }, context, graph, instanceId);
  if (errors.length) return { ok: false, errors, conflicts: [], summary: "", graph: null, instanceId };
  const conflicts: BehaviorConflict[] = [];
  for (const node of manuallyEditedNodes(graph, instance)) {
    conflicts.push({ kind: "manual_edit", message: `"${node.label}" foi editado manualmente; aplicar substitui essa edicao pelos parametros do formulario.` });
  }
  const manualEdges = manualEdgesTouching(graph, instance);
  if (manualEdges.length) conflicts.push({ kind: "manual_edit", message: `${manualEdges.length} conexao(oes) feita(s) a mao em nos deste comportamento seriam refeitas se os nos mudarem de papel.` });
  // Regenera: remove dependentes, a propria instancia, reinsere com os mesmos ids e reaplica dependentes.
  const deps = dependents(graph, instanceId);
  const positions = new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  let next = graph;
  for (const dep of deps) next = removeInstanceFromGraph(next, dep);
  next = removeInstanceFromGraph(next, instance);
  next = insertInstance(next, definition, params, instanceId, instanceLabel(definition, params, context), positions);
  for (const dep of deps) {
    const depDefinition = getBehaviorDefinition(dep.behaviorId)!;
    const depErrors = depDefinition.validate({ ...dep.params, __self: dep.id }, context, next, dep.id);
    if (depErrors.length) return { ok: false, errors: depErrors.map((error) => `${dep.label}: ${error}`), conflicts, summary: "", graph: null, instanceId };
    next = insertInstance(next, depDefinition, dep.params, dep.id, dep.label, positions);
  }
  // Conexoes manuais cujas pontas continuam existindo sao preservadas.
  const alive = new Set(next.nodes.map((node) => node.id));
  for (const edge of manualEdges) if (alive.has(edge.fromNode) && alive.has(edge.toNode)) next = { ...next, edges: [...next.edges, edge] };
  return { ok: true, errors: [], conflicts, summary: definition.summarize(params, context), graph: next, instanceId };
}

/** Planeja remover uma instancia; recusa se outra instancia depende dela. */
export function planRemoveBehavior(graph: NodeGraph, instanceId: string): BehaviorPlan {
  const instance = (graph.behaviors ?? []).find((candidate) => candidate.id === instanceId);
  if (!instance) return { ok: false, errors: ["Comportamento nao encontrado."], conflicts: [], summary: "", graph: null, instanceId: null };
  const deps = dependents(graph, instanceId);
  if (deps.length) {
    return { ok: false, errors: [`Remova antes ${deps.map((dep) => `"${dep.label}"`).join(", ")}, que depende(m) deste comportamento.`], conflicts: [], summary: "", graph: null, instanceId };
  }
  const conflicts: BehaviorConflict[] = manuallyEditedNodes(graph, instance).map((node) => ({
    kind: "manual_edit" as const,
    message: `"${node.label}" tem edicao manual e sera removido junto.`,
  }));
  const manualEdges = manualEdgesTouching(graph, instance);
  if (manualEdges.length) conflicts.push({ kind: "manual_edit", message: `${manualEdges.length} conexao(oes) feita(s) a mao com nos deste comportamento serao removidas.` });
  return { ok: true, errors: [], conflicts, summary: `Remove "${instance.label}" e seus ${instance.nodeIds.length} nos.`, graph: removeInstanceFromGraph(graph, instance), instanceId };
}

/** Referencias quebradas (entidade apagada, instancia ausente, nos faltando) apos reabrir. */
export function validateBehaviorInstances(graph: NodeGraph, context: BehaviorSceneContext): Array<{ instanceId: string; message: string }> {
  const issues: Array<{ instanceId: string; message: string }> = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const instance of graph.behaviors ?? []) {
    const definition = getBehaviorDefinition(instance.behaviorId);
    if (!definition) {
      issues.push({ instanceId: instance.id, message: `Comportamento desconhecido "${instance.behaviorId}".` });
      continue;
    }
    const missing = instance.nodeIds.filter((id) => !nodeIds.has(id));
    if (missing.length) issues.push({ instanceId: instance.id, message: `${missing.length} no(s) deste comportamento foram apagados; edite para regenerar ou remova.` });
    for (const ref of definition.externalRefs(instance.params)) {
      if (ref.kind === "entity" && !context.entities.some((entity) => entity.id === ref.id)) issues.push({ instanceId: instance.id, message: `A entidade "${ref.id}" nao existe mais.` });
      if (ref.kind === "instance" && !(graph.behaviors ?? []).some((other) => other.id === ref.id)) issues.push({ instanceId: instance.id, message: `O comportamento "${ref.id}" nao existe mais.` });
    }
  }
  return issues;
}

// ── Duplicar entidade ─────────────────────────────────────────────────────────

export type DuplicateLogicReport = {
  graph: NodeGraph;
  remappedInstances: Array<{ from: string; to: string }>;
  /** Referencias a outras entidades/variaveis preservadas de proposito. */
  preservedExternal: string[];
  /** Nos de logica manual (fora de comportamentos) que nao foram copiados. */
  droppedManualNodes: number;
};

/**
 * Copia a logica de `sourceId` para a entidade nova `newId`: so os comportamentos, com ids
 * novos; referencias a propria entidade passam a apontar para `newId`, variaveis criadas
 * pela instancia ganham nomes novos, e referencias externas sao mantidas e listadas.
 * Logica manual nao e copiada (ela controlaria a entidade original).
 */
export function duplicateBehaviorLogic(graph: NodeGraph, sourceId: string, newId: string, sceneInstanceIds: Iterable<string>): DuplicateLogicReport {
  const idMap = new Map<string, string>();
  const taken = new Set([...sceneInstanceIds, ...(graph.behaviors ?? []).map((instance) => instance.id)]);
  for (const instance of graph.behaviors ?? []) {
    const hint = String(instance.behaviorId === "gated_passage" ? instance.params.blocker : instance.params.target === sourceId ? newId : instance.params.target);
    const fresh = nextInstanceId({ nodes: [], edges: [] }, instance.behaviorId, hint, taken);
    taken.add(fresh);
    idMap.set(instance.id, fresh);
  }
  const preserved = new Set<string>();
  const remapValue = (value: string | number) => {
    if (typeof value !== "string") return value;
    if (value === sourceId) return newId;
    if (idMap.has(value)) return idMap.get(value)!;
    for (const [from, to] of idMap) {
      if (value.startsWith(`${from}_`) || value.startsWith(`${from}__`)) return to + value.slice(from.length);
    }
    return value;
  };
  const ownedNodes = new Set((graph.behaviors ?? []).flatMap((instance) => instance.nodeIds));
  const ownedEdges = new Set((graph.behaviors ?? []).flatMap((instance) => [...instance.edgeIds, ...(instance.replacedEdges ?? []).map((edge) => edge.id)]));
  const nodes = graph.nodes
    .filter((node) => ownedNodes.has(node.id))
    .map((node) => {
      const params = Object.fromEntries(Object.entries(node.params).map(([key, value]) => [key, remapValue(value)]));
      for (const key of ["target", "a", "b", "var_name"] as const) {
        const value = node.params[key];
        if (typeof value === "string" && value !== sourceId && remapValue(value) === value && key !== "var_name") preserved.add(`entidade ${value}`);
        if (key === "var_name" && typeof value === "string" && remapValue(value) === value) preserved.add(`variavel ${value}`);
      }
      return { ...node, id: String(remapValue(node.id)), params, x: node.x, y: node.y };
    });
  const edges = graph.edges
    .filter((edge) => ownedEdges.has(edge.id) || (ownedNodes.has(edge.fromNode) && ownedNodes.has(edge.toNode)))
    .map((edge) => ({ ...edge, id: String(remapValue(edge.id)), fromNode: String(remapValue(edge.fromNode)), toNode: String(remapValue(edge.toNode)) }));
  const behaviors = (graph.behaviors ?? []).map((instance) => ({
    ...instance,
    id: idMap.get(instance.id)!,
    label: instance.label.replace(sourceId, newId),
    params: Object.fromEntries(Object.entries(instance.params).map(([key, value]) => [key, remapValue(value)])),
    nodeIds: instance.nodeIds.map((id) => String(remapValue(id))),
    edgeIds: instance.edgeIds.map((id) => String(remapValue(id))),
    generated: Object.fromEntries(
      Object.entries(instance.generated).map(([id]) => {
        const node = nodes.find((candidate) => candidate.id === remapValue(id));
        return [String(remapValue(id)), node ? nodeSignature(node) : ""];
      })
    ),
    ...(instance.replacedEdges
      ? { replacedEdges: instance.replacedEdges.map((edge) => ({ ...edge, id: String(remapValue(edge.id)), fromNode: String(remapValue(edge.fromNode)), toNode: String(remapValue(edge.toNode)) })) }
      : {}),
    ...(instance.replacedEdgeGates ? { replacedEdgeGates: instance.replacedEdgeGates.map((id) => String(remapValue(id))) } : {}),
  }));
  const groups = behaviors.map((instance) => ({ id: instance.id, label: instance.label, nodeIds: instance.nodeIds }));
  const next: NodeGraph = { nodes, edges, ...(behaviors.length ? { behaviors, groups } : {}) };
  return {
    graph: next,
    remappedInstances: [...idMap.entries()].map(([from, to]) => ({ from, to })),
    preservedExternal: [...preserved].sort(),
    droppedManualNodes: graph.nodes.length - nodes.length,
  };
}
