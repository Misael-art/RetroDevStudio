import type { GraphNode, NodeGraph, NodePort, NodeType } from "./nodeTypes";
import { NODE_DEFS, clonePorts } from "./nodeDefinitions";
import type { GameplayRecoverRequest } from "../ipc/toolsService";

/** Perfil que produce o grafo: `crates/rex-gameplay`, CONTRACT.md. */
export const REX_GAMEPLAY_PROFILE_ID = "m68k.counter_threshold_state_gate.v1";

/** Mesmo teito que o backend (`MAX_EXITS` en rex_gameplay.rs). */
export const MAX_EXITS_DECLARADAS = 64;

/**
 * Le uma lista de enderezos escrita a man (`0x946, 0x970`). Con prefixo `0x`
 * e hex; sen prefixo, so dexitos se leen como decimal e con letras como hex
 * (a lectura ambiguia non existe). Devolve `null` ante calquer token invalido:
 * a interface non coerce en silencio nin ignora lixo — recusa e explica.
 */
export function parseHexOffsets(entrada: string): number[] | null {
  const texto = entrada.trim();
  if (texto.length === 0) return [];
  const out: number[] = [];
  for (const tokenRaw of texto.split(/[\s,;]+/)) {
    const token = tokenRaw.trim();
    if (token.length === 0) continue;
    let valor: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(token)) {
      valor = Number.parseInt(token.slice(2), 16);
    } else if (/^\d+$/.test(token)) {
      valor = Number.parseInt(token, 10);
    } else if (/^[0-9a-fA-F]+$/.test(token)) {
      valor = Number.parseInt(token, 16);
    } else {
      return null;
    }
    if (!Number.isInteger(valor) || valor < 0 || valor > 0xffffff) return null;
    out.push(valor);
  }
  return out;
}

export type RecoverFormResult =
  | { ok: true; request: GameplayRecoverRequest }
  | { ok: false; motivo: string };

/**
 * Traduce o formulario (ROM + entrada + saidas declaradas) ao pedido exacto
 * que admite o backend, refusingo antes de enviar cando o backend o
 * recusaría con seguridade: ROM baleira, enderezos impares (o 68k so executa
 * en 2 bytes), saidas baleiras/repetidas/iguais ou anteriores a entrada, ou
 * mais de 64 saidas.
 */
export function validateGameplayRecoverForm(
  form: { romPath: string; entry: string; exits: string },
  requestId: string
): RecoverFormResult {
  if (form.romPath.trim().length === 0) {
    return { ok: false, motivo: "ningunha ROM seleccionada: abra primeiro unha ROM autoral (BYOR)" };
  }
  if (requestId.trim().length === 0) {
    return { ok: false, motivo: "falta identificador de pedido (request_id)" };
  }
  const entrada = parseHexOffsets(form.entry);
  if (entrada === null || entrada.length !== 1) {
    return { ok: false, motivo: "a entrada debe ser un unico enderezo hex (ex.: 0x946)" };
  }
  if (entrada[0] % 2 !== 0) {
    return { ok: false, motivo: "a entrada debe estar aliñada a 2 bytes: o 68k non executa enderezos impares" };
  }
  const saidas = parseHexOffsets(form.exits);
  if (saidas === null) {
    return { ok: false, motivo: "as saidas deben ser enderezos hex separados por comas (ex.: 0x970)" };
  }
  if (saidas.length === 0) {
    return { ok: false, motivo: "declare polo menos unha saida da rexion: nada se autodetecta" };
  }
  if (saidas.length > MAX_EXITS_DECLARADAS) {
    return { ok: false, motivo: `demasiadas saidas: o máximo é ${MAX_EXITS_DECLARADAS}` };
  }
  if (new Set(saidas).size !== saidas.length) {
    return { ok: false, motivo: "hai saidas repetidas" };
  }
  for (const s of saidas) {
    if (s % 2 !== 0) {
      return { ok: false, motivo: `saida 0x${s.toString(16)} impar: debe estar aliñada a 2 bytes` };
    }
    if (s <= entrada[0]) {
      return { ok: false, motivo: "toda saida debe quedar despois da entrada da rexion" };
    }
  }
  return {
    ok: true,
    request: {
      request_id: requestId,
      rom_path: form.romPath,
      entry: entrada[0],
      exits: saidas,
      address_labels: [],
    },
  };
}

export type ThresholdCheck = { ok: true; value: number } | { ok: false; motivo: string };

/** Unico parametro editable: enteiro dentro da faixa que devolve o crate. */
export function validateGameplayThreshold(texto: string, min: number, max: number): ThresholdCheck {
  const limpo = texto.trim();
  if (!/^-?\d+$/.test(limpo)) {
    return { ok: false, motivo: "o limiar debe ser un numero enteiro (sen decimais nin texto)" };
  }
  const valor = Number.parseInt(limpo, 10);
  if (!Number.isSafeInteger(valor)) {
    return { ok: false, motivo: "o limiar excede o rango numerico seguro" };
  }
  if (valor < min || valor > max) {
    return {
      ok: false,
      motivo: `o limiar debe estar entre ${min} e ${max}: e a faixa do MOVEQ inmediato recuperado da ROM`,
    };
  }
  return { ok: true, value: valor };
}

export type GameplayMapping = {
  rom_start: string;
  rom_end: string;
  mnemonic: string;
  bytes: string;
};

export type GameplayNo = {
  id: string;
  tipo: NodeType;
  titulo: string;
  /** Parametro realmente soporteado (só o limiar). */
  parametro: string | null;
  editable: boolean;
  /** Por que non se edita (presentase na interface; nunca se omite). */
  motivo: string | null;
  mappings: GameplayMapping[];
};

export type GameplayRegra = {
  profileId: string;
  romSha256: string;
  entrada: string;
  incremento: string;
  comparacion: string;
  estadoPasaxe: string;
  orixeRom: string;
  chamadaExterna: string;
  resumoFrases: string[];
  limitaciones: string[];
  limiar: number;
  limiarMin: number;
  limiarMax: number;
  operador: string;
  nos: GameplayNo[];
  /** Proxeccion para o NodeGraph do produto (parametros escalares). */
  grafo: NodeGraph;
};

export type GameplayProjection = { ok: true; regra: GameplayRegra } | { ok: false; motivo: string };

type NodoProxeitado = {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  inputs: NodePort[];
  outputs: NodePort[];
  params: Record<string, string | number>;
  mappings: GameplayMapping[];
};

function recusado(motivo: string): { ok: false; motivo: string } {
  return { ok: false, motivo };
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mappingsDe(params: Record<string, unknown>): GameplayMapping[] {
  const raw = Array.isArray(params.source_mappings) ? params.source_mappings : [];
  const out: GameplayMapping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const start = texto(record.rom_start);
    const end = texto(record.rom_end);
    if (!start || !end) continue;
    out.push({
      rom_start: start,
      rom_end: end,
      mnemonic: texto(record.mnemonic) ?? "",
      bytes: texto(record.bytes) ?? "",
    });
  }
  return out;
}

function liñaMapping(m: GameplayMapping): string {
  return `${m.rom_start}..${m.rom_end} ${m.bytes} ${m.mnemonic}`.replace(/\s+/g, " ").trim();
}

/** Formato compacto e re-analisavel para calquera array/obxecto de params. */
function liñaValor(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(liñaValor).join("; ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${liñaValor(v)}`)
      .join(" ");
  }
  return "";
}

/**
 * Parametros do no en formato escalable: o NodeGraph do produto leva
 * `params: Record<string, string | number>`, asi que os arrays de orixes
 * convértense en liñas compactas (`0x000946..0x00094A 08000003 BTST #3,D0`)
 * e os booleanos en `"true"`/`"false"`, que e como `canEditGraphNode` le
 * `readonly` hoxe. As orixes completas (con `bytes`) seguen intactas na
 * proxeccion `GameplayRegra.nos`, que e o que se persiste.
 */
function paramsEscalares(
  params: Record<string, unknown>,
  mappings: GameplayMapping[]
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "source_mappings") {
      if (mappings.length > 0) {
        out[key] = mappings.map(liñaMapping).join("; ");
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value ? "true" : "false";
    } else if (value === null || value === undefined) {
      continue;
    } else {
      const liña = liñaValor(value);
      if (liña.length > 0) out[key] = liña;
    }
  }
  return out;
}

function portsDe(tipo: NodeType): { inputs: NodePort[]; outputs: NodePort[] } {
  const def = NODE_DEFS[tipo];
  return { inputs: clonePorts(def.inputs), outputs: clonePorts(def.outputs) };
}

/**
 * Proxeccion do grafo recuperado polo perfil `m68k.counter_threshold_state_gate.v1`
 * para a interface: frases en linguaxe comprensible (entrada, incremento,
 * comparacion, estado da pasada, orixe na ROM), o unico parametro soporteado
 * (o limiar, coa súa faixa) e o motivo explícito de cada no non editable.
 *
 * Non reinterpreta nin inventa: todo sale dos nos e parametros que devolve o
 * crate. Un grafo doutro perfil, sen o bloque `rex_gameplay` ou sen no de
 * comparacion recúsase con motivo; nada se mostra "medio recuperado".
 */
export function projectGameplayGraph(graphJson: string, limitations: string[] = []): GameplayProjection {
  let doc: unknown;
  try {
    doc = JSON.parse(graphJson);
  } catch {
    return recusado("o grafo non e JSON valido; nada se interpreta");
  }
  if (!doc || typeof doc !== "object") {
    return recusado("o grafo non e un obxecto; nada se interpreta");
  }
  const record = doc as Record<string, unknown>;
  const meta = record.rex_gameplay;
  if (!meta || typeof meta !== "object") {
    return recusado(
      `o documento non ten bloque rex_gameplay: non e un grafo do perfil ${REX_GAMEPLAY_PROFILE_ID}`
    );
  }
  const metadata = meta as Record<string, unknown>;
  const profileId = texto(metadata.profile_id);
  if (profileId !== REX_GAMEPLAY_PROFILE_ID) {
    return recusado(
      `perfil do grafo '${profileId ?? "descoñecido"}' distinto de ${REX_GAMEPLAY_PROFILE_ID}; a interface non o abre`
    );
  }
  if (num(record.version) !== 1) {
    return recusado("version de grafo non 1; nada se hidrata");
  }
  const romSha256 = texto(metadata.rom_sha256) ?? "";
  if (romSha256.length !== 64) {
    return recusado("o grafo non leva SHA-256 de ROM; non hai identidade que revalidar");
  }
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    return recusado("o grafo non trae nos e arestas como listas");
  }

  const nos: NodoProxeitado[] = [];
  for (const raw of record.nodes as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    const id = texto(node.id);
    const type = node.type;
    if (!id || typeof type !== "string" || !(type in NODE_DEFS)) continue;
    const params =
      node.params && typeof node.params === "object" ? (node.params as Record<string, unknown>) : {};
    const mappings = mappingsDe(params);
    const escalares = paramsEscalares(params, mappings);
    // Todo no que non e o limiar marca-se como non editable: a unica
    // edicion que admite o perfil e `threshold`, e `canEditGraphNode` le
    // `readonly` para pechar tamben a reescrita de params no editor.
    if (type !== "rom_counter_compare") {
      escalares.readonly = "true";
    }
    if (type === "rom_external_call") {
      escalares.opaco = "true";
    }
    const ports = portsDe(type as NodeType);
    nos.push({
      id,
      type: type as NodeType,
      label: texto(node.label) ?? id,
      x: num(node.x) ?? 40,
      y: num(node.y) ?? 120,
      ...ports,
      params: escalares,
      mappings,
    });
  }
  if (nos.length === 0) {
    return recusado("ningun no do grafo pertence ao perfil coñecido");
  }

  const byId = new Map(nos.map((n) => [n.id, n]));
  const edges: NodeGraph["edges"] = [];
  for (const raw of record.edges as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const edge = raw as Record<string, unknown>;
    const id = texto(edge.id);
    const fromNode = texto(edge.fromNode);
    const fromPort = texto(edge.fromPort);
    const toNode = texto(edge.toNode);
    const toPort = texto(edge.toPort);
    if (!id || !fromNode || !fromPort || !toNode || !toPort) continue;
    const origem = byId.get(fromNode);
    const destino = byId.get(toNode);
    if (!origem || !destino) continue;
    if (!origem.outputs.some((p) => p.id === fromPort)) continue;
    if (!destino.inputs.some((p) => p.id === toPort)) continue;
    edges.push({ id, fromNode, fromPort, toNode, toPort });
  }

  const entry = nos.find((n) => n.type === "rom_region_entry");
  if (!entry) {
    return recusado("falta o no rom_region_entry: o grafo esta incompleto");
  }
  const exits = nos.filter((n) => n.type === "rom_region_exit");
  if (exits.length === 0) {
    return recusado("falta o no rom_region_exit: o grafo esta incompleto");
  }
  const guard = nos.find((n) => n.type === "rom_input_bit_guard");
  const counterAdd = nos.find((n) => n.type === "rom_counter_add");
  const externalCall = nos.find((n) => n.type === "rom_external_call");
  const compare = nos.find((n) => n.type === "rom_counter_compare");
  if (!compare) {
    return recusado("falta o no rom_counter_compare: non hai limiar que editar");
  }

  const limiar = num(compare.params.threshold);
  const limiarMin = num(compare.params.threshold_min);
  const limiarMax = num(compare.params.threshold_max);
  const operador = texto(compare.params.operator) ?? "?";
  if (limiar == null || limiarMin == null || limiarMax == null) {
    return recusado("o no rom_counter_compare non trae limiar e faixa; non se edita a cegas");
  }

  const ROM_EXITS = Array.isArray(metadata.exits)
    ? (metadata.exits as unknown[]).map((e) => texto(e) ?? "").filter((e) => e.length > 0)
    : [];
  const blocks = Array.isArray(metadata.blocks)
    ? (metadata.blocks as unknown[])
        .map((b) => {
          const block = b as Record<string, unknown>;
          const start = texto(block.rom_start);
          const end = texto(block.rom_end);
          return start && end ? `${start}..${end}` : null;
        })
        .filter((s): s is string => s !== null)
    : [];

  const escritaSet = nos.find((n) => n.type === "rom_state_write" && num(n.params.value) === 1);
  const escritaOther = nos.find((n) => n.type === "rom_state_write" && num(n.params.value) === 0);

  const entrada = guard
    ? `garda do input: bit ${num(guard.params.bit) ?? "?"} de ${texto(guard.params.register) ?? "?"}` +
      ` (orixe: ${liñaMapping(guard.mappings[0]) || "?"})`
    : "sen garda de input: a interface non mostra unha regra incompleta";
  const incremento = counterAdd
    ? `contador en ${texto(counterAdd.params.address) ?? "?"} soma ${num(counterAdd.params.step) ?? "?"}` +
      ` (${num(counterAdd.params.width_bits) ?? "?"} bits, ${texto(counterAdd.params.signedness) ?? "?"})`
    : "sen incremento de contador";
  const comparacion = `compara o contador ${operador} ${limiar} (limiar recuperado: ${
    num(compare.params.recovered_threshold) ?? "?"
  })`;
  const estadoPasaxe = escritaSet
    ? `cando cumpre escribe ${num(escritaSet.params.value)} en ${texto(escritaSet.params.address) ?? "?"}` +
      (escritaOther
        ? `; cando non escribe ${num(escritaOther.params.value)} en ${texto(escritaOther.params.address) ?? "?"}`
        : "")
    : "escrita de estado non identificada";
  const orixeRom =
    `rexion recuperada da ROM ${texto(metadata.entry) ?? "?"} -> ${ROM_EXITS.join(", ") || "?"}` +
    ` (faixas ${blocks.join(", ") || "sen rexistrar"}); SHA-256 ${romSha256.slice(0, 16)}…`;
  const chamadaExterna = externalCall
    ? `chamada externa a ${texto(externalCall.params.target) ?? "?"} — NON recuperada (opaca):` +
      ` coñécense alvo e argumentos, non o corpo; altera ${texto(externalCall.params.clobbers) ?? "?"}`
    : "sen chamada externa na regra";

  const resumoFrases = [
    `A rutina entra en ${texto(metadata.entry) ?? "?"} e sai en ${ROM_EXITS.join(", ") || "?"}.`,
    entrada.startsWith("garda")
      ? `Se a garda do input (bit ${num(guard?.params.bit) ?? "?"} de ${texto(guard?.params.register) ?? "?"}) non está activa, a pasada non conta: salta á saída.`
      : entrada,
    `Se non, ${incremento}.`,
    `Depois, ${comparacion}.`,
    `Ao cumprir a guarda, ${estadoPasaxe}.`,
    chamadaExterna,
    `Orixe: ${orixeRom}.`,
  ];

  const nosResumo: GameplayNo[] = nos.map((node) => {
    const editable = node.type === "rom_counter_compare";
    return {
      id: node.id,
      tipo: node.type,
      titulo: node.label,
      parametro: editable ? "threshold" : null,
      editable,
      motivo: editable
        ? null
        : node.type === "rom_external_call"
          ? "chamada non recuperada: opaca, sen edicion"
          : "no de estrutura da regra: o perfil so permite editar o limiar",
      mappings: node.mappings,
    };
  });

  const grafo: NodeGraph = {
    nodes: nos.map(
      (node): GraphNode => ({
        id: node.id,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        inputs: node.inputs,
        outputs: node.outputs,
        params: node.params,
      })
    ),
    edges,
  };

  return {
    ok: true,
    regra: {
      profileId: REX_GAMEPLAY_PROFILE_ID,
      romSha256,
      entrada,
      incremento,
      comparacion,
      estadoPasaxe,
      orixeRom,
      chamadaExterna,
      resumoFrases,
      limitaciones: limitations,
      limiar,
      limiarMin,
      limiarMax,
      operador,
      nos: nosResumo,
      grafo,
    },
  };
}
