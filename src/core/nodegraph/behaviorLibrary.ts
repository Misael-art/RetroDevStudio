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
  /** Recurso visual real (para miniaturas no formulario). */
  spriteAsset?: string | null;
  frameWidth?: number;
  frameHeight?: number;
};

/** Contador existente em qualquer grafo da cena. */
export type BehaviorSceneCounter = {
  instanceId: string;
  label: string;
  varName: string;
  scope: "shared" | "entity";
  ownerEntity: string | null;
  hostEntity: string;
  start: number;
};

/** O que cada instancia da cena referencia (para dependencias entre entidades). */
export type BehaviorSceneReference = {
  instanceId: string;
  behaviorId: string;
  label: string;
  hostEntity: string;
  /** ids de instancia e nomes de variavel referenciados. */
  refs: string[];
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
  /** Plataforma do projeto (ex.: "megadrive", "snes"). */
  platform?: string | null;
  counters?: BehaviorSceneCounter[];
  references?: BehaviorSceneReference[];
  /** Nome amigavel de variaveis conhecidas (ex.: contador "Moedas"). */
  variableLabels?: Record<string, string>;
};

// ── Parametros tipados ────────────────────────────────────────────────────────

export type BehaviorParamSpec =
  | { key: string; label: string; kind: "entity"; require: "sprite" | "collidable"; optional?: boolean; help?: string }
  | { key: string; label: string; kind: "text"; default: string; help?: string }
  | { key: string; label: string; kind: "choice"; options: Array<{ value: string; label: string }>; default: string; help?: string }
  | { key: string; label: string; kind: "counter"; optional?: boolean; help?: string }
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
  build: (params: BehaviorParams, instanceId: string, graph: NodeGraph, context: BehaviorSceneContext) => Built;
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
        if (!entity && spec.optional && !value) break;
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
      case "text": {
        const text = String(value ?? "").trim();
        if (!text || text.length > 24 || !/[A-Za-z0-9]/.test(text)) errors.push(`${spec.label}: use um nome curto (1 a 24 caracteres, com letras ou numeros).`);
        break;
      }
      case "choice": {
        if (!spec.options.some((option) => option.value === String(value))) errors.push(`${spec.label}: escolha uma opcao.`);
        break;
      }
      case "counter": {
        if (!value && spec.optional) break;
        if (!(context.counters ?? []).some((counter) => counter.instanceId === String(value))) {
          errors.push(`${spec.label}: escolha um contador existente${value ? ` ("${value}" nao existe mais)` : " (crie um com 'Contador')"}.`);
        }
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
  description: "Anda para os lados enquanto o botao estiver segurado e salta ao apertar, somente quando esta apoiado no chao (uma pressao no ar ou segurar o botao nao repete o salto). Usa a fisica (gravidade) da entidade. Grafos feitos a mao, como o do jogador do modelo, mantem a propria regra de salto; nada e alterado neles.",
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
    if (p.jump_button && context.platform === "snes") {
      errors.push('Saltar: no SNES o salto "so do chao" nao e suportado (o estado de apoio existe apenas na fisica do Mega Drive); deixe "Saltar" vazio.');
    }
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
  description: "Um bloqueio impede o movimento horizontal (esquerda/direita) do 'Movimento e salto' escolhido ate uma variavel atingir o limiar; entao o bloqueio some e a passagem abre. Nao bloqueia a queda/salto nem movimentos de outras logicas.",
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

// ── Contador, item coletavel e objetivo ───────────────────────────────────────

const slug = (text: string | number | undefined) =>
  String(text ?? "").trim().toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "contador";

/** Variavel do contador: global da cena ("compartilhado") ou da entidade dona. */
export function counterVariable(params: BehaviorParams): string {
  return params.scope === "entity" ? `ctr_${slug(String(params.owner))}_${slug(params.name)}` : `ctr_${slug(params.name)}`;
}

/** Marca privada "ja coletado"/"ja alcancado" da instancia (reiniciada a cada partida). */
export function instanceFlagVariable(instanceId: string, flag: "taken" | "done"): string {
  return `${instanceId}_${flag}`;
}

const counterOf = (context: BehaviorSceneContext, id: string | number | undefined) =>
  (context.counters ?? []).find((counter) => counter.instanceId === String(id ?? ""));

const counter: BehaviorDefinition = {
  id: "counter",
  title: "Contador",
  description:
    "Um numero do jogo (ex.: moedas coletadas). 'Compartilhado' e um so para a fase; 'da entidade' pertence a uma entidade (uma copia dela ganha o seu proprio). Volta ao valor inicial a cada partida. E um contador simples, nao um inventario.",
  params: [
    { key: "name", label: "Nome", kind: "text", default: "Moedas" },
    {
      key: "scope",
      label: "Pertence a",
      kind: "choice",
      default: "shared",
      options: [
        { value: "shared", label: "Fase (compartilhado)" },
        { value: "entity", label: "Uma entidade" },
      ],
    },
    { key: "owner", label: "Entidade dona (se 'Uma entidade')", kind: "entity", require: "sprite", optional: true },
    { key: "start", label: "Valor no inicio da partida", kind: "int", min: 0, max: 9999, default: 0 },
  ],
  summarize: (p, context) =>
    `Contador "${p.name}" (${p.scope === "entity" ? `de ${entityLabel(context, p.owner)}` : "compartilhado na fase"}) comeca em ${p.start} a cada partida.`,
  validate: (p, context, graph, instanceId) => {
    const errors = commonValidation(counter, p, context, graph);
    if (p.scope === "entity" && !p.owner) errors.push("Entidade dona: escolha a entidade a quem o contador pertence.");
    const varName = counterVariable(p);
    const clash = (context.counters ?? []).find((other) => other.varName === varName && other.instanceId !== instanceId && other.instanceId !== p.__self);
    if (clash) errors.push(`Nome: ja existe o contador "${clash.label}" com esse nome ${p.scope === "entity" ? "para essa entidade" : "na fase"}.`);
    return errors;
  },
  build: (p): Built => ({
    nodes: [
      { role: "start_tick", type: "event_start", label: "Inicio da partida", params: {} as BehaviorParams },
      { role: "reset", type: "var_set", label: `Zerar ${p.name}`, params: { var_name: counterVariable(p), value: Number(p.start), counter_label: String(p.name) } },
    ],
    edges: [{ from: "start_tick", fromPort: "exec", to: "reset", toPort: "exec" }],
  }),
  externalRefs: (p) => (p.scope === "entity" && p.owner ? [{ kind: "entity" as const, id: String(p.owner), param: "owner" }] : []),
};

const collectible: BehaviorDefinition = {
  id: "collectible",
  title: "Item coletavel",
  description:
    "Quando o coletor encosta no item, soma ao contador uma unica vez, esconde o item e toca um som opcional. Outras entidades nao coletam. Em cada nova partida o item volta e pode ser coletado de novo.",
  params: [
    { key: "item", label: "Item", kind: "entity", require: "sprite", help: "A entidade que sera coletada." },
    { key: "collector", label: "Quem coleta", kind: "entity", require: "sprite" },
    { key: "counter", label: "Contador", kind: "counter" },
    { key: "amount", label: "Vale", kind: "int", min: 1, max: 99, default: 1, unit: "ponto(s)" },
    { key: "sound", label: "Som ao coletar", kind: "sound" },
  ],
  summarize: (p, context) =>
    `Quando ${entityLabel(context, p.collector)} encosta em ${entityLabel(context, p.item)}: +${p.amount} em "${counterOf(context, p.counter)?.label ?? p.counter}" (uma vez), ${entityLabel(context, p.item)} some${p.sound ? `, toca "${p.sound}"` : ""}.`,
  validate: (p, context, graph) => {
    const errors = commonValidation(collectible, p, context, graph);
    if (p.item && p.item === p.collector) errors.push("Quem coleta: o item nao pode coletar a si mesmo.");
    return errors;
  },
  build: (p, instanceId, _graph, context) => {
    const counterVar = counterOf(context, p.counter)!.varName;
    const taken = instanceFlagVariable(instanceId, "taken");
    const nodes: BuiltNode[] = [
      { role: "start_tick", type: "event_start", label: "Inicio da partida", params: {} },
      { role: "reset", type: "var_set", label: "Item ainda nao coletado", params: { var_name: taken, value: 0 } },
      { role: "tick", type: "event_update", label: "A cada quadro (coleta)", params: {} },
      { role: "touch", type: "condition_overlap", label: "Coletor encosta no item", params: { a: String(p.collector), b: String(p.item) } },
      { role: "taken_value", type: "var_get", label: "Ler ja coletado", params: { var_name: taken } },
      { role: "not_taken", type: "condition_compare", label: "Ainda nao coletado", params: { operator: "==", b: 0 } },
      { role: "mark", type: "var_set", label: "Marcar coletado", params: { var_name: taken, value: 1 } },
      { role: "counter_value", type: "var_get", label: "Ler contador", params: { var_name: counterVar } },
      { role: "sum", type: "logic_math", label: `Somar ${p.amount}`, params: { operator: "+", b: Number(p.amount) } },
      { role: "add", type: "var_set", label: "Somar ao contador", params: { var_name: counterVar, value: 0 } },
      { role: "hide", type: "destroy_entity", label: "Esconder item", params: { target: String(p.item) } },
    ];
    const edges: BuiltEdge[] = [
      { from: "start_tick", fromPort: "exec", to: "reset", toPort: "exec" },
      { from: "tick", fromPort: "exec", to: "touch", toPort: "exec" },
      { from: "touch", fromPort: "true", to: "not_taken", toPort: "exec" },
      { from: "taken_value", fromPort: "value", to: "not_taken", toPort: "a" },
      { from: "not_taken", fromPort: "true", to: "mark", toPort: "exec" },
      { from: "mark", fromPort: "exec", to: "add", toPort: "exec" },
      { from: "counter_value", fromPort: "value", to: "sum", toPort: "a" },
      { from: "sum", fromPort: "value", to: "add", toPort: "value" },
      { from: "add", fromPort: "exec", to: "hide", toPort: "exec" },
    ];
    if (p.sound) {
      nodes.push({ role: "sound", type: "action_sound", label: "Som da coleta", params: { sfx: String(p.sound) } });
      edges.push({ from: "hide", fromPort: "exec", to: "sound", toPort: "exec" });
    }
    return { nodes, edges };
  },
  externalRefs: (p) => [
    { kind: "entity", id: String(p.item), param: "item" },
    { kind: "entity", id: String(p.collector), param: "collector" },
    { kind: "instance", id: String(p.counter), param: "counter" },
  ],
};

const objective: BehaviorDefinition = {
  id: "objective",
  title: "Objetivo",
  description:
    "Quando a entidade chega ao sensor e as condicoes valem (contador opcional), o objetivo e cumprido uma unica vez por partida: esconde uma entidade (opcional) e toca um som (opcional).",
  params: [
    { key: "actor", label: "Quem precisa chegar", kind: "entity", require: "sprite" },
    { key: "sensor", label: "Sensor do objetivo", kind: "entity", require: "collidable" },
    { key: "counter", label: "Exigir contador", kind: "counter", optional: true },
    { key: "required", label: "Valor minimo do contador", kind: "int", min: 0, max: 9999, default: 0 },
    { key: "reveal", label: "Esconder ao cumprir", kind: "entity", require: "collidable", optional: true },
    { key: "sound", label: "Som ao cumprir", kind: "sound" },
  ],
  summarize: (p, context) => {
    const condition = p.counter ? ` com "${counterOf(context, p.counter)?.label ?? p.counter}" >= ${p.required}` : "";
    return `Quando ${entityLabel(context, p.actor)} chega a ${entityLabel(context, p.sensor)}${condition}: objetivo cumprido uma vez${p.reveal ? `, ${entityLabel(context, p.reveal)} some` : ""}${p.sound ? `, toca "${p.sound}"` : ""}.`;
  },
  validate: (p, context, graph) => {
    const errors = commonValidation(objective, p, context, graph);
    if (p.actor && p.actor === p.sensor) errors.push("Sensor: a entidade nao pode ser o seu proprio sensor.");
    return errors;
  },
  build: (p, instanceId, _graph, context) => {
    const done = instanceFlagVariable(instanceId, "done");
    const nodes: BuiltNode[] = [
      { role: "start_tick", type: "event_start", label: "Inicio da partida", params: {} },
      { role: "reset", type: "var_set", label: "Objetivo pendente", params: { var_name: done, value: 0 } },
      { role: "tick", type: "event_update", label: "A cada quadro (objetivo)", params: {} },
      { role: "touch", type: "condition_overlap", label: "Chegou ao sensor", params: { a: String(p.actor), b: String(p.sensor) } },
      { role: "done_value", type: "var_get", label: "Ler ja cumprido", params: { var_name: done } },
      { role: "not_done", type: "condition_compare", label: "Ainda nao cumprido", params: { operator: "==", b: 0 } },
      { role: "mark", type: "var_set", label: "Objetivo cumprido", params: { var_name: done, value: 1 } },
    ];
    const edges: BuiltEdge[] = [
      { from: "start_tick", fromPort: "exec", to: "reset", toPort: "exec" },
      { from: "tick", fromPort: "exec", to: "touch", toPort: "exec" },
      { from: "touch", fromPort: "true", to: "not_done", toPort: "exec" },
      { from: "done_value", fromPort: "value", to: "not_done", toPort: "a" },
    ];
    if (p.counter) {
      nodes.push(
        { role: "counter_value", type: "var_get", label: "Ler contador", params: { var_name: counterOf(context, p.counter)!.varName } },
        { role: "enough", type: "condition_compare", label: "Contador suficiente", params: { operator: ">=", b: Number(p.required) } }
      );
      edges.push(
        { from: "not_done", fromPort: "true", to: "enough", toPort: "exec" },
        { from: "counter_value", fromPort: "value", to: "enough", toPort: "a" },
        { from: "enough", fromPort: "true", to: "mark", toPort: "exec" }
      );
    } else {
      edges.push({ from: "not_done", fromPort: "true", to: "mark", toPort: "exec" });
    }
    let last = "mark";
    if (p.reveal) {
      nodes.push({ role: "reveal", type: "destroy_entity", label: "Esconder ao cumprir", params: { target: String(p.reveal) } });
      edges.push({ from: last, fromPort: "exec", to: "reveal", toPort: "exec" });
      last = "reveal";
    }
    if (p.sound) {
      nodes.push({ role: "sound", type: "action_sound", label: "Som do objetivo", params: { sfx: String(p.sound) } });
      edges.push({ from: last, fromPort: "exec", to: "sound", toPort: "exec" });
    }
    return { nodes, edges };
  },
  externalRefs: (p) => [
    { kind: "entity", id: String(p.actor), param: "actor" },
    { kind: "entity", id: String(p.sensor), param: "sensor" },
    ...(p.reveal ? [{ kind: "entity" as const, id: String(p.reveal), param: "reveal" }] : []),
    ...(p.counter ? [{ kind: "instance" as const, id: String(p.counter), param: "counter" }] : []),
  ],
};

export const BEHAVIOR_LIBRARY: BehaviorDefinition[] = [movement, passage, counter, collectible, objective];

export function getBehaviorDefinition(id: string): BehaviorDefinition | undefined {
  return BEHAVIOR_LIBRARY.find((definition) => definition.id === id);
}

export function defaultBehaviorParams(definition: BehaviorDefinition, context: BehaviorSceneContext, graph: NodeGraph, preferredEntity?: string): BehaviorParams {
  const params: BehaviorParams = {};
  for (const spec of definition.params) {
    if (spec.kind === "int") params[spec.key] = spec.default;
    else if (spec.kind === "button") params[spec.key] = spec.default;
    else if (spec.kind === "text" || spec.kind === "choice") params[spec.key] = spec.default;
    else if (spec.kind === "counter") params[spec.key] = spec.optional ? "" : (context.counters ?? [])[0]?.instanceId ?? "";
    else if (spec.kind === "entity") {
      if (spec.optional) {
        params[spec.key] = "";
        continue;
      }
      const candidates = context.entities.filter((entity) => (spec.require === "sprite" ? entity.hasSprite : entity.hasSprite || entity.hasCollision));
      // A entidade em edicao e o alvo natural de "target" e "item"; os demais campos
      // comecam em outra entidade (ex.: quem coleta, bloqueio).
      params[spec.key] = candidates.find((entity) => entity.id === preferredEntity && (spec.key === "target" || spec.key === "item"))?.id
        ?? candidates.find((entity) => entity.id !== preferredEntity && !Object.values(params).includes(entity.id))?.id
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
    sprite?: { animations?: Record<string, unknown>; asset?: string; frame_width?: number; frame_height?: number } | null;
    physics?: unknown;
    collision?: unknown;
    audio?: { sfx?: Record<string, string> } | null;
  };
};

/**
 * Contexto da cena. `graphs[i]` e o grafo de logica de `entities[i]` (quando alinhados),
 * o que permite saber em qual entidade vive cada instancia.
 */
export function buildBehaviorSceneContext(entities: SceneEntityLike[], graphs: NodeGraph[], platform: string | null = null): BehaviorSceneContext {
  const variables = new Set<string>();
  const counters: BehaviorSceneCounter[] = [];
  const references: BehaviorSceneReference[] = [];
  const variableLabels: Record<string, string> = {};
  graphs.forEach((graph, index) => {
    const hostEntity = entities[index]?.entity_id ?? "";
    for (const node of graph.nodes) {
      if (node.type === "var_set" && typeof node.params.var_name === "string" && IDENTIFIER.test(node.params.var_name)) variables.add(node.params.var_name);
    }
    for (const instance of graph.behaviors ?? []) {
      const definition = getBehaviorDefinition(instance.behaviorId);
      if (instance.behaviorId === "counter") {
        const varName = counterVariable(instance.params);
        counters.push({
          instanceId: instance.id,
          label: String(instance.params.name),
          varName,
          scope: instance.params.scope === "entity" ? "entity" : "shared",
          ownerEntity: instance.params.scope === "entity" ? String(instance.params.owner) : null,
          hostEntity,
          start: Number(instance.params.start ?? 0),
        });
        variableLabels[varName] = `Contador "${instance.params.name}"`;
      }
      references.push({
        instanceId: instance.id,
        behaviorId: instance.behaviorId,
        label: instance.label,
        hostEntity,
        refs: [
          ...(definition?.externalRefs(instance.params).filter((ref) => ref.kind === "instance").map((ref) => ref.id) ?? []),
          ...(instance.behaviorId === "gated_passage" ? [String(instance.params.state_variable)] : []),
        ],
      });
    }
  });
  return {
    entities: entities.map((entity) => ({
      id: entity.entity_id,
      label: entity.display_name || entity.entity_id,
      hasSprite: Boolean(entity.components.sprite),
      hasPhysics: Boolean(entity.components.physics),
      hasCollision: Boolean(entity.components.collision),
      animations: Object.keys(entity.components.sprite?.animations ?? {}),
      spriteAsset: entity.components.sprite?.asset ?? null,
      frameWidth: entity.components.sprite?.frame_width,
      frameHeight: entity.components.sprite?.frame_height,
    })),
    sounds: [...new Set(entities.flatMap((entity) => Object.keys(entity.components.audio?.sfx ?? {})))].sort(),
    variables: [...variables].sort(),
    instanceIds: graphs.flatMap((graph) => (graph.behaviors ?? []).map((instance) => instance.id)),
    platform,
    counters,
    references,
    variableLabels,
  };
}

function removeSharedCounters(graph: NodeGraph, shared: BehaviorInstance[]): NodeGraph {
  let next = graph;
  for (const instance of shared) next = removeInstanceFromGraph(next, instance);
  return next;
}

/** Instancias de QUALQUER entidade que dependem desta (por id ou pela variavel do contador). */
export function sceneDependents(instanceId: string, context: BehaviorSceneContext, graph?: NodeGraph): BehaviorSceneReference[] {
  const counterVar = (context.counters ?? []).find((counter) => counter.instanceId === instanceId)?.varName;
  const fromScene = (context.references ?? []).filter(
    (reference) => reference.instanceId !== instanceId && (reference.refs.includes(instanceId) || (counterVar !== undefined && reference.refs.includes(counterVar)))
  );
  // Instancias do grafo em edicao que ainda nao estao no contexto (ex.: recem-aplicadas).
  const local = (graph?.behaviors ?? [])
    .filter((instance) => instance.id !== instanceId && !fromScene.some((reference) => reference.instanceId === instance.id))
    .filter((instance) => Object.values(instance.params).some((value) => value === instanceId || (counterVar !== undefined && value === counterVar)))
    .map((instance) => ({ instanceId: instance.id, behaviorId: instance.behaviorId, label: instance.label, hostEntity: "", refs: [] }));
  return [...fromScene, ...local];
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
  const prefix: Record<string, string> = { platform_movement: "move", gated_passage: "pass", counter: "ctr", collectible: "item", objective: "goal" };
  const base = `bh_${prefix[behaviorId] ?? "bh"}_${entityHint.replace(/[^A-Za-z0-9_]/g, "_")}`;
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
  previousPositions: Map<string, { x: number; y: number }>,
  context: BehaviorSceneContext
): NodeGraph {
  const built = definition.build(params, instanceId, graph, context);
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
  const who =
    definition.id === "gated_passage"
      ? entityLabel(context, params.blocker)
      : definition.id === "collectible"
        ? entityLabel(context, params.item)
        : definition.id === "objective"
          ? entityLabel(context, params.sensor)
          : definition.id === "counter"
            ? String(params.name)
            : entityLabel(context, params.target);
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
  const hint = String(
    behaviorId === "gated_passage" ? params.blocker : behaviorId === "collectible" ? params.item : behaviorId === "objective" ? params.sensor : behaviorId === "counter" ? params.name : params.target
  );
  const instanceId = nextInstanceId(graph, behaviorId, hint, context.instanceIds);
  const next = insertInstance(graph, definition, params, instanceId, instanceLabel(definition, params, context), new Map(), context);
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
  if (instance.behaviorId === "counter" && counterVariable(params) !== counterVariable(instance.params)) {
    const users = sceneDependents(instanceId, context, graph);
    if (users.length) errors.push(`Mudar nome/dono troca a variavel usada por ${users.map((user) => `"${user.label}"`).join(", ")}; ajuste ou remova esses comportamentos antes.`);
  }
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
  next = insertInstance(next, definition, params, instanceId, instanceLabel(definition, params, context), positions, context);
  for (const dep of deps) {
    const depDefinition = getBehaviorDefinition(dep.behaviorId)!;
    const depErrors = depDefinition.validate({ ...dep.params, __self: dep.id }, context, next, dep.id);
    if (depErrors.length) return { ok: false, errors: depErrors.map((error) => `${dep.label}: ${error}`), conflicts, summary: "", graph: null, instanceId };
    next = insertInstance(next, depDefinition, dep.params, dep.id, dep.label, positions, context);
  }
  // Conexoes manuais cujas pontas continuam existindo sao preservadas.
  const alive = new Set(next.nodes.map((node) => node.id));
  for (const edge of manualEdges) if (alive.has(edge.fromNode) && alive.has(edge.toNode)) next = { ...next, edges: [...next.edges, edge] };
  return { ok: true, errors: [], conflicts, summary: definition.summarize(params, context), graph: next, instanceId };
}

/** Planeja remover uma instancia; recusa se outra instancia depende dela. */
export function planRemoveBehavior(graph: NodeGraph, instanceId: string, context?: BehaviorSceneContext): BehaviorPlan {
  const instance = (graph.behaviors ?? []).find((candidate) => candidate.id === instanceId);
  if (!instance) return { ok: false, errors: ["Comportamento nao encontrado."], conflicts: [], summary: "", graph: null, instanceId: null };
  const deps = [
    ...dependents(graph, instanceId).map((dep) => ({ label: dep.label, hostEntity: "" })),
    ...(context ? sceneDependents(instanceId, context).filter((ref) => !dependents(graph, instanceId).some((dep) => dep.id === ref.instanceId)) : []),
  ];
  if (deps.length) {
    return {
      ok: false,
      errors: [
        `Remova antes ${deps.map((dep) => `"${dep.label}"${dep.hostEntity ? ` (em ${context ? entityLabel(context, dep.hostEntity) : dep.hostEntity})` : ""}`).join(", ")}, que depende(m) deste comportamento.`,
      ],
      conflicts: [],
      summary: "",
      graph: null,
      instanceId,
    };
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
      const inScene = (context.references ?? []).some((other) => other.instanceId === ref.id);
      if (ref.kind === "instance" && !inScene && !(graph.behaviors ?? []).some((other) => other.id === ref.id)) {
        issues.push({ instanceId: instance.id, message: `O comportamento "${ref.id}" nao existe mais.` });
      }
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
  // Contador compartilhado e da fase: a copia continua usando o mesmo (referencia externa).
  const sharedCounters = (graph.behaviors ?? []).filter((instance) => instance.behaviorId === "counter" && instance.params.scope !== "entity");
  graph = {
    ...removeSharedCounters(graph, sharedCounters),
  };
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
  for (const shared of sharedCounters) preserved.add(`contador compartilhado ${shared.params.name}`);
  return {
    graph: next,
    remappedInstances: [...idMap.entries()].map(([from, to]) => ({ from, to })),
    preservedExternal: [...preserved].sort(),
    droppedManualNodes: graph.nodes.length - nodes.length,
  };
}
