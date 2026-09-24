/**
 * nodeCatalog.ts — Registro unico da linguagem visual do NodeGraph (Experimental).
 *
 * Uma entrada por `NodeType` com categoria, nome, icone e descricao para iniciantes.
 * Paleta, cartoes, busca e agrupamento visual leem daqui; nada neste modulo altera
 * a logica do grafo (somente descreve nos existentes).
 */
import {
  megadriveKeyboardKeysForButton,
  type MegadriveButton,
} from "../ipc/emulatorService";
import type { GraphNode, NodeGraph, NodePort, NodeType } from "./nodeTypes";

export type NodeCategoryId =
  | "trigger_input"
  | "state"
  | "transition"
  | "action"
  | "animation"
  | "sprite"
  | "tilemap"
  | "camera"
  | "audio"
  | "timer"
  | "collision"
  | "hardware_budget"
  | "vdp_dma_palette"
  | "bridge_source_mapping"
  | "error_unsupported";

/** Nomes de icone resolvidos por `components/common/Icon.tsx`. */
export type NodeIconName =
  | "flash"
  | "keyboard"
  | "fork"
  | "arrows"
  | "jump"
  | "sound"
  | "music"
  | "variable"
  | "calculator"
  | "eye-off"
  | "spawn"
  | "film"
  | "camera"
  | "grid"
  | "clock"
  | "layers"
  | "chip"
  | "warning-triangle";

export type NodeCategory = {
  id: NodeCategoryId;
  label: string;
  color: string;
};

export const NODE_CATEGORIES: NodeCategory[] = [
  { id: "trigger_input", label: "Eventos e controle", color: "#89b4fa" },
  { id: "state", label: "Estado", color: "#cba6f7" },
  { id: "transition", label: "Transicao", color: "#f9e2af" },
  { id: "action", label: "Variaveis e fluxo", color: "#a6e3a1" },
  { id: "animation", label: "Animacao", color: "#f5c2e7" },
  { id: "sprite", label: "Personagens", color: "#94e2d5" },
  { id: "tilemap", label: "Cenario", color: "#74c7ec" },
  { id: "camera", label: "Camera", color: "#89dceb" },
  { id: "audio", label: "Som", color: "#fab387" },
  { id: "timer", label: "Tempo", color: "#f38ba8" },
  { id: "collision", label: "Condicoes", color: "#eba0ac" },
  { id: "hardware_budget", label: "Limites do hardware", color: "#f9e2af" },
  { id: "vdp_dma_palette", label: "Video (VDP)", color: "#b4befe" },
  { id: "bridge_source_mapping", label: "Codigo recuperado", color: "#f38ba8" },
  { id: "error_unsupported", label: "Nao suportado", color: "#f38ba8" },
];

export type NodeCatalogEntry = {
  type: NodeType;
  category: NodeCategoryId;
  /** Grupo da paleta lateral (classificacao/busca). */
  paletteGroup: string;
  title: string;
  icon: NodeIconName;
  description: string;
  /** Parametros mostrados no cartao; os demais ficam em "Detalhes tecnicos". */
  essentialParams: string[];
};

function entry(
  type: NodeType,
  category: NodeCategoryId,
  paletteGroup: string,
  title: string,
  icon: NodeIconName,
  description: string,
  essentialParams: string[] = []
): NodeCatalogEntry {
  return { type, category, paletteGroup, title, icon, description, essentialParams };
}

export const NODE_CATALOG: Record<NodeType, NodeCatalogEntry> = {
  event_start: entry("event_start", "trigger_input", "Eventos", "Ao Iniciar", "flash", "Roda uma vez quando a fase comeca."),
  event_update: entry("event_update", "trigger_input", "Eventos", "A Cada Frame", "flash", "Roda 60 vezes por segundo, a cada quadro do jogo."),
  input_pressed: entry("input_pressed", "trigger_input", "Eventos", "Input Pressionado", "keyboard", "Continua somente no quadro em que o botao foi apertado (uma vez por toque).", ["button"]),
  input_held: entry("input_held", "trigger_input", "Eventos", "Input Segurado", "keyboard", "Continua em todo quadro enquanto o botao estiver mantido pressionado.", ["button"]),
  input_command: entry("input_command", "trigger_input", "Eventos", "Comando de Input", "keyboard", "Reconhece uma sequencia de botoes (ex.: golpe especial) dentro de uma janela de quadros.", ["notation", "max_frames", "target"]),
  sprite_move: entry("sprite_move", "sprite", "Movimento", "Mover Sprite", "arrows", "Desloca a entidade alguns pixels neste quadro.", ["target", "dx", "dy"]),
  set_velocity: entry("set_velocity", "sprite", "Movimento", "Definir Velocidade", "jump", "Da um impulso na entidade; vy negativo empurra para cima (pulo).", ["target", "vx", "vy"]),
  set_position: entry("set_position", "sprite", "Movimento", "Definir Posicao", "arrows", "Coloca a entidade numa posicao exata da tela.", ["target", "x", "y"]),
  spawn_entity: entry("spawn_entity", "sprite", "Movimento", "Criar Entidade", "spawn", "Cria uma copia de um prefab na posicao indicada.", ["prefab", "x", "y"]),
  destroy_entity: entry("destroy_entity", "sprite", "Movimento", "Destruir Entidade", "eye-off", "Esconde/remove a entidade da fase.", ["target"]),
  sprite_anim: entry("sprite_anim", "animation", "Movimento", "Animar Sprite", "film", "Troca a animacao exibida pela entidade.", ["target", "anim"]),
  set_animation_state: entry("set_animation_state", "animation", "Movimento", "Estado de Animacao", "film", "Muda o estado de animacao da entidade.", ["target", "state"]),
  condition_on_ground: entry("condition_on_ground", "collision", "Condicoes", "Esta no chao?", "fork", "Pergunta se a entidade (com fisica) esta apoiada no chao neste quadro e segue por Sim ou Nao.", ["target"]),
  condition_overlap: entry("condition_overlap", "collision", "Condicoes", "Colisao (Overlap)", "fork", "Pergunta se duas entidades se encostam (ou encostariam ao se mover) e segue por Sim ou Nao.", ["a", "b", "probe_dx"]),
  camera_follow: entry("camera_follow", "camera", "Camera", "Camera Segue", "camera", "Faz a camera acompanhar a entidade.", ["target"]),
  camera_bounds: entry("camera_bounds", "camera", "Camera", "Limites da Camera", "camera", "Impede a camera de sair da area indicada.", ["min_x", "max_x"]),
  timer: entry("timer", "timer", "Fluxo", "Timer", "clock", "Conta quadros e avisa a cada passo e ao terminar.", ["frames", "repeat"]),
  set_tile: entry("set_tile", "tilemap", "Tilemap", "Definir Tile", "grid", "Troca um bloco do cenario.", ["layer", "tile", "x", "y"]),
  effect_parallax: entry("effect_parallax", "action", "Efeitos", "Parallax", "layers", "Rola uma camada de fundo em velocidade propria.", ["layer", "speed_x"]),
  effect_raster: entry("effect_raster", "vdp_dma_palette", "Efeitos", "Efeito Raster", "layers", "Desloca linhas da tela a partir de uma scanline.", ["scanline", "offset_x"]),
  logic_and: entry("logic_and", "collision", "Condicoes", "E (And)", "fork", "Verdadeiro somente se as duas entradas forem verdadeiras."),
  action_sound: entry("action_sound", "audio", "Som", "Tocar Som", "sound", "Toca um efeito sonoro da cena.", ["sfx"]),
  action_music: entry("action_music", "audio", "Som", "Tocar Musica", "music", "Toca ou para uma musica.", ["action", "track"]),
  scroll_tilemap: entry("scroll_tilemap", "tilemap", "Movimento", "Rolar Cenario", "grid", "Rola uma camada do cenario.", ["layer", "dx", "dy"]),
  load_scene: entry("load_scene", "tilemap", "Tilemap", "Carregar Cena", "grid", "Troca para outra cena.", ["scene"]),
  move_camera: entry("move_camera", "camera", "Movimento", "Mover Camera", "camera", "Move a camera para uma posicao.", ["x", "y"]),
  var_set: entry("var_set", "action", "Variaveis", "Definir Variavel", "variable", "Guarda um valor numa variavel do jogo.", ["var_name", "value"]),
  var_get: entry("var_get", "action", "Variaveis", "Ler Variavel", "variable", "Le o valor atual de uma variavel e o entrega por fio de dados.", ["var_name"]),
  logic_math: entry("logic_math", "action", "Variaveis", "Conta Matematica", "calculator", "Calcula A (operador) B e entrega o resultado.", ["operator", "b"]),
  condition_compare: entry("condition_compare", "collision", "Condicoes", "Comparar", "fork", "Compara dois numeros e segue por Sim ou Nao.", ["operator", "b"]),
  fsm_state: entry("fsm_state", "state", "Estados", "Estado (FSM)", "chip", "Um estado da maquina de estados.", ["state_name"]),
  fsm_transition: entry("fsm_transition", "transition", "Estados", "Transicao (FSM)", "fork", "Passa para outro estado quando a condicao vale.", ["target_state"]),
  flow_if: entry("flow_if", "action", "Fluxo", "Se (If)", "fork", "Segue por Sim ou Nao conforme a condicao."),
  flow_while: entry("flow_while", "action", "Fluxo", "Enquanto (While)", "fork", "Repete enquanto a condicao valer."),
  flow_for: entry("flow_for", "action", "Fluxo", "Repetir (For)", "fork", "Repete um numero fixo de vezes.", ["count"]),
  timeline_sequence: entry("timeline_sequence", "animation", "Estados", "Sequencia (Timeline)", "clock", "Dispara passos em quadros definidos.", ["timeline_name"]),
  hardware_budget_check: entry("hardware_budget_check", "hardware_budget", "Hardware", "Checar Budget", "warning-triangle", "Confere limites do console (sprites por linha, VRAM).", ["budget"]),
  rom_addq_word: entry("rom_addq_word", "bridge_source_mapping", "ROM recuperada", "ADDQ.W recuperado", "chip", "Rotina de soma recuperada de uma ROM (perfil exato)."),
  rom_branch_compare_word: entry("rom_branch_compare_word", "bridge_source_mapping", "ROM recuperada", "Branch word recuperado", "chip", "Comparacao/desvio recuperado de uma ROM (perfil exato).", ["threshold"]),
  bridge_unconverted_source: entry("bridge_unconverted_source", "bridge_source_mapping", "Hardware", "Bridge de Fonte", "chip", "Trecho de codigo importado que ainda nao virou no editavel (somente leitura)."),
  event_vblank: entry("event_vblank", "vdp_dma_palette", "Eventos", "Evento VBlank", "flash", "Roda no intervalo vertical do video."),
  event_hblank: entry("event_hblank", "vdp_dma_palette", "Eventos", "Evento HBlank", "flash", "Roda a cada linha horizontal do video."),
  event_dma_done: entry("event_dma_done", "vdp_dma_palette", "Eventos", "Evento DMA", "flash", "Roda quando uma transferencia DMA termina."),
};

export const NODE_PALETTE_GROUP_ORDER = [
  "Eventos",
  "Movimento",
  "Condicoes",
  "Camera",
  "Tilemap",
  "Som",
  "Variaveis",
  "Fluxo",
  "Estados",
  "Efeitos",
  "Hardware",
  "ROM recuperada",
];

export function getNodeCatalogEntry(type: NodeType): NodeCatalogEntry {
  return NODE_CATALOG[type];
}

export function getNodeCategory(type: NodeType): NodeCategory {
  const id = NODE_CATALOG[type]?.category ?? "error_unsupported";
  return NODE_CATEGORIES.find((category) => category.id === id) ?? NODE_CATEGORIES[NODE_CATEGORIES.length - 1];
}

// ── Botoes do Mega Drive x teclado ────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "Seta ↑",
  ArrowDown: "Seta ↓",
  ArrowLeft: "Seta ←",
  ArrowRight: "Seta →",
  Enter: "Enter",
  ShiftRight: "Shift direito",
};

const BUTTON_LABELS: Record<MegadriveButton, string> = {
  A: "Botao A",
  B: "Botao B",
  C: "Botao C",
  START: "Start",
  UP: "Direcional ↑",
  DOWN: "Direcional ↓",
  LEFT: "Direcional ←",
  RIGHT: "Direcional →",
};

/** Botoes aceitos pelo gerador SGDK nos nos de input, na ordem da UI. */
export const MEGADRIVE_INPUT_BUTTONS: string[] = [
  "BUTTON_A",
  "BUTTON_B",
  "BUTTON_C",
  "BUTTON_START",
  "BUTTON_UP",
  "BUTTON_DOWN",
  "BUTTON_LEFT",
  "BUTTON_RIGHT",
];

export type InputButtonDescription = {
  /** Valor persistido no grafo (ex.: `BUTTON_A`). */
  value: string;
  /** Botao do controle Mega Drive (ex.: "Botao A"). */
  padLabel: string;
  /** Tecla que o app envia ao core para esse botao (ex.: "Z"); null se nao houver. */
  keyLabel: string | null;
};

export function describeInputButton(value: string): InputButtonDescription {
  const raw = value.replace(/^BUTTON_/, "") as MegadriveButton;
  const padLabel = BUTTON_LABELS[raw];
  if (!padLabel) {
    return { value, padLabel: value || "(sem botao)", keyLabel: null };
  }
  const keys = megadriveKeyboardKeysForButton(raw);
  const keyLabel = keys.length
    ? keys.map((key) => KEY_LABELS[key] ?? key.replace(/^Key/, "")).join(" / ")
    : null;
  return { value, padLabel, keyLabel };
}

/** Explica, para iniciantes, a diferenca entre pressionar, manter e soltar. */
export const INPUT_MODE_HELP: Array<{ mode: "pressed" | "held" | "released"; label: string; text: string; supported: boolean }> = [
  { mode: "pressed", label: "Pressionar", text: "Dispara uma vez, no quadro em que o botao desce (ex.: pulo).", supported: true },
  { mode: "held", label: "Manter pressionado", text: "Dispara em todo quadro enquanto o botao estiver apertado (ex.: andar).", supported: true },
  { mode: "released", label: "Soltar", text: "Ainda nao existe no de 'ao soltar'. Para reagir quando o botao nao esta apertado, use o caminho Nao de uma condicao.", supported: false },
];

// ── Descricao do cartao ───────────────────────────────────────────────────────

const ENTITY_PARAM_KEYS = ["target", "a", "b"] as const;

/** Entidades da cena citadas pelo no (alvo, colisao A/B). */
export function getNodeEntityRefs(node: GraphNode, sceneEntityIds?: Iterable<string>): string[] {
  const known = sceneEntityIds ? new Set(sceneEntityIds) : null;
  const refs: string[] = [];
  for (const key of ENTITY_PARAM_KEYS) {
    if (node.type === "condition_compare" || node.type === "logic_math") continue;
    const value = node.params[key];
    if (typeof value !== "string" || !value || value === "self") continue;
    if (known && !known.has(value)) continue;
    if (!refs.includes(value)) refs.push(value);
  }
  return refs;
}

function num(value: string | number | undefined): string {
  return value === undefined ? "?" : String(value);
}

/** Frase curta em portugues claro do que o no faz, com os valores atuais. */
export function describeNodeAction(node: GraphNode): string {
  const p = node.params;
  switch (node.type) {
    case "event_start":
      return "Quando a fase comeca";
    case "event_update":
      return "A cada quadro (60x por segundo)";
    case "input_pressed": {
      const button = describeInputButton(String(p.button ?? ""));
      return `Ao apertar ${button.padLabel}${button.keyLabel ? ` (tecla ${button.keyLabel})` : ""}`;
    }
    case "input_held": {
      const button = describeInputButton(String(p.button ?? ""));
      return `Enquanto segurar ${button.padLabel}${button.keyLabel ? ` (tecla ${button.keyLabel})` : ""}`;
    }
    case "input_command":
      return `Comando ${num(p.display_name)} (${num(p.notation)})`;
    case "sprite_move":
      return `Mover ${num(p.target)} ${num(p.dx)} px em X e ${num(p.dy)} px em Y`;
    case "set_velocity":
      return Number(p.vy) < 0
        ? `Impulsionar ${num(p.target)} para cima (vy ${num(p.vy)})`
        : `Dar velocidade a ${num(p.target)} (vx ${num(p.vx)}, vy ${num(p.vy)})`;
    case "set_position":
      return `Colocar ${num(p.target)} em (${num(p.x)}, ${num(p.y)})`;
    case "spawn_entity":
      return `Criar ${num(p.prefab)} em (${num(p.x)}, ${num(p.y)})`;
    case "destroy_entity":
      return `Esconder ${num(p.target)}`;
    case "sprite_anim":
      return `Animar ${num(p.target)} com "${num(p.anim)}"`;
    case "set_animation_state":
      return `Estado de animacao de ${num(p.target)}: ${num(p.state)}`;
    case "condition_overlap": {
      const probe = Number(p.probe_dx ?? 0) || Number(p.probe_dy ?? 0);
      return probe
        ? `Se ${num(p.a)} vai encostar em ${num(p.b)} ao se mover`
        : `Se ${num(p.a)} encosta em ${num(p.b)}`;
    }
    case "condition_compare":
      return `Se A ${num(p.operator)} ${p.b ?? "B"}`;
    case "condition_on_ground":
      return `Se ${num(p.target)} esta apoiado no chao`;
    case "action_sound":
      return `Tocar som "${num(p.sfx)}"`;
    case "action_music":
      return p.action === "stop" ? "Parar a musica" : `Tocar musica "${num(p.track)}"`;
    case "var_set":
      return `Guardar em ${num(p.var_name)}`;
    case "var_get":
      return `Ler ${num(p.var_name)}`;
    case "logic_math":
      return `Calcular A ${num(p.operator)} ${p.b ?? "B"}`;
    case "camera_follow":
      return `Camera segue ${num(p.target)}`;
    case "timer":
      return `Esperar ${num(p.frames)} quadros`;
    default:
      return NODE_CATALOG[node.type]?.description ?? node.type;
  }
}

/** Rotulo em portugues para uma porta (as portas `exec` sem nome ficam vazias). */
export function getPortDisplayLabel(port: NodePort): string {
  switch (port.id) {
    case "exec":
      return port.kind === "exec" ? "" : port.label;
    case "true":
      return "Sim";
    case "false":
      return "Nao";
    case "value":
      return "valor";
    case "tick":
      return "a cada passo";
    case "done":
      return "ao terminar";
    case "matched":
      return "combinou";
    case "next":
      return "seguinte";
    case "body":
      return "corpo";
    case "transitions":
      return "transicoes";
    case "condition":
      return "condicao";
    case "out":
      return "resultado";
    default:
      return port.label;
  }
}

export type PortVisualKind = "exec" | "data" | "true" | "false";

/** Tipo visual de uma porta/fio: execucao, dados, ou saida verdadeiro/falso. */
export function getPortVisualKind(port: Pick<NodePort, "id" | "kind">): PortVisualKind {
  if (port.kind === "data") return "data";
  if (port.id === "true") return "true";
  if (port.id === "false") return "false";
  return "exec";
}

export const PORT_VISUAL_COLORS: Record<PortVisualKind, string> = {
  exec: "#e2e8f0",
  data: "#89b4fa",
  true: "#a6e3a1",
  false: "#f38ba8",
};

// ── Compatibilidade de conexao ────────────────────────────────────────────────

export type ConnectionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Uma saida so pode ligar numa entrada do mesmo tipo (execucao com execucao, dado com
 * dado do mesmo tipo). Entradas de dado aceitam uma unica fonte; ligacoes repetidas e
 * de um no para si mesmo sao recusadas.
 */
export function checkConnection(
  graph: NodeGraph,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string
): ConnectionCheck {
  if (fromNodeId === toNodeId) return { ok: false, reason: "um no nao pode ligar em si mesmo" };
  const from = graph.nodes.find((node) => node.id === fromNodeId);
  const to = graph.nodes.find((node) => node.id === toNodeId);
  const out = from?.outputs.find((port) => port.id === fromPortId);
  const input = to?.inputs.find((port) => port.id === toPortId);
  if (!from || !to || !out || !input) return { ok: false, reason: "porta inexistente" };
  if (out.kind !== input.kind) {
    return { ok: false, reason: out.kind === "exec" ? "saida de execucao so liga em entrada de execucao" : "saida de dado so liga em entrada de dado" };
  }
  if (out.kind === "data" && out.dataType && input.dataType && out.dataType !== input.dataType) {
    return { ok: false, reason: `tipos diferentes (${out.dataType} → ${input.dataType})` };
  }
  if (graph.edges.some((edge) => edge.fromNode === fromNodeId && edge.fromPort === fromPortId && edge.toNode === toNodeId && edge.toPort === toPortId)) {
    return { ok: false, reason: "essa conexao ja existe" };
  }
  if (input.kind === "data" && graph.edges.some((edge) => edge.toNode === toNodeId && edge.toPort === toPortId)) {
    return { ok: false, reason: "essa entrada de dado ja tem uma fonte; remova a ligacao atual antes" };
  }
  return { ok: true };
}
