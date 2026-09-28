import type { GameplayRecoverResponse } from "../ipc/toolsService";
import type { RecoveredRule } from "../ipc/sceneService";
import {
  REX_GAMEPLAY_PROFILE_ID,
  projectGameplayGraph,
  type GameplayRegra,
} from "./rexGameplayGraph";

/**
 * Persistencia da regra recuperada (REX, Experimental).
 *
 * O grafo que devolve `crates/rex-gameplay` non sobrevive ao round-trip do
 * editor de nodos: `GraphNode.params` só leva `string | number`, polo que os
 * arrays de orixes (con `bytes`) e os booleanos semânticos se perden ao guardar
 * e reabrir no NodeGraph. A escena garda por iso o `graph_json` **verbatim** do
 * crate dentro de `components.logic.recovered_rule`, xunto coa identidade da
 * ROM, a rutina (entrada/saidas/bloques), o limiar e as limitaciones. A
 * proxección léese sempre desde ese grafo, nunca desde unha copia resumida.
 */

export const REGRA_RECUPERADA_VERSION = 1;

/** Mesma forma que `components.logic.recovered_rule` na escena. */
export type RegraRecuperada = RecoveredRule;

export type ResultadoConstruir =
  | { ok: true; regra: RegraRecuperada }
  | { ok: false; motivo: string };

export type ResultadoLeitura =
  | { ok: true; regra: RegraRecuperada; proxeccion: GameplayRegra }
  | { ok: false; motivo: string };

const SHA_RE = /^[0-9a-f]{64}$/;

function recusado(motivo: string): { ok: false; motivo: string } {
  return { ok: false, motivo };
}

function enteiroSeguro(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function offsetValido(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function offsets(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const item of value) {
    if (!offsetValido(item)) return null;
    out.push(item);
  }
  return out;
}

function bloques(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: [number, number][] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    if (!offsetValido(item[0]) || !offsetValido(item[1]) || item[1] <= item[0]) return null;
    out.push([item[0], item[1]]);
  }
  return out;
}

function limitaciones(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) return null;
    out.push(item);
  }
  return out;
}

/**
 * Converte a resposta de `rex_gameplay_recover` no bloque que vaia á escena.
 * Nada se inventa: o limiar actual léese do propio grafo, polo que un grafo xa
 * editado garda o valor editado e conserva o recuperado da ROM intacto.
 */
export function construirRegraRecuperada(
  resposta: GameplayRecoverResponse,
  romPath: string
): ResultadoConstruir {
  const caminho = romPath.trim();
  if (caminho.length === 0) {
    return recusado("non hai ROM-base que gardar: o caminho da ROM esta baleiro");
  }
  const sha = resposta.rom_sha256.toLowerCase();
  if (!SHA_RE.test(sha)) {
    return recusado(
      `identidade da ROM incompleta: esperabase un SHA-256 de 64 hex e o nucleo devolveu '${resposta.rom_sha256}'`
    );
  }
  if (resposta.profile_id !== REX_GAMEPLAY_PROFILE_ID) {
    return recusado(
      `perfil '${resposta.profile_id}' distinto de ${REX_GAMEPLAY_PROFILE_ID}: non se garda o que a interface non sabe reabrir`
    );
  }
  if (!offsetValido(resposta.entry)) return recusado("entry da rutina fóra de rango: non se garda");
  const exits = offsets(resposta.exits);
  if (!exits) return recusado("exits da rutina baleiros ou non enteiros: non se garda");
  const blocks = bloques(resposta.blocks);
  if (!blocks) return recusado("blocks da rutina baleiros ou mal formados: non se garda");

  const proxeccion = projectGameplayGraph(resposta.graph_json, resposta.limitations);
  if (!proxeccion.ok) {
    return recusado(`o grafo do nucleo non proxecta: ${proxeccion.motivo}`);
  }
  if (proxeccion.regra.romSha256.toLowerCase() !== sha) {
    return recusado(
      "identidade diverxente: o grafo apunta a outra ROM que a resposta do nucleo"
    );
  }
  const regra = proxeccion.regra;
  if (
    regra.limiar < regra.limiarMin ||
    regra.limiar > regra.limiarMax
  ) {
    return recusado(
      `limiar ${regra.limiar} fóra da faixa ${regra.limiarMin}..${regra.limiarMax}: non se garda`
    );
  }

  return {
    ok: true,
    regra: {
      version: REGRA_RECUPERADA_VERSION,
      profile_id: resposta.profile_id,
      rom_path: caminho,
      rom_sha256: sha,
      entry: resposta.entry,
      exits,
      blocks,
      operator: resposta.operator,
      threshold_recovered: resposta.threshold,
      threshold_current: regra.limiar,
      threshold_min: regra.limiarMin,
      threshold_max: regra.limiarMax,
      graph_json: resposta.graph_json,
      limitations: resposta.limitations,
    },
  };
}

/**
 * Lee o bloque gardado na escena. Un bloque incompleto, doutro perfil ou cun
 * grafo que xa non proxecta recúsase con motivo: a interface non mostra nunca
 * unha regra "medio reaberta", e nada se converte a cegas.
 */
export function lerRegraRecuperada(bruto: unknown): ResultadoLeitura {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return recusado("non hai regra recuperada gardada nesta entidade");
  }
  const doc = bruto as Record<string, unknown>;
  if (doc.version !== REGRA_RECUPERADA_VERSION) {
    return recusado(
      `version gardada ${String(doc.version)} distinta de ${REGRA_RECUPERADA_VERSION}: reabrir este bloque non se soporte`
    );
  }
  if (typeof doc.profile_id !== "string" || doc.profile_id !== REX_GAMEPLAY_PROFILE_ID) {
    return recusado(
      `perfil gardado '${String(doc.profile_id)}' que non e ${REX_GAMEPLAY_PROFILE_ID}`
    );
  }
  if (typeof doc.rom_path !== "string" || doc.rom_path.trim().length === 0) {
    return recusado("ROM-base sen caminho no bloque gardado");
  }
  if (typeof doc.rom_sha256 !== "string" || !SHA_RE.test(doc.rom_sha256.toLowerCase())) {
    return recusado("identidade da ROM gardada sen SHA-256 valido");
  }
  const entry = doc.entry;
  if (!offsetValido(entry)) return recusado("entry gardada ausente ou non enteira");
  const exits = offsets(doc.exits);
  if (!exits) return recusado("exits gardados ausentes ou non enteiros");
  const blocks = bloques(doc.blocks);
  if (!blocks) return recusado("blocks gardados ausentes ou mal formados");
  if (typeof doc.operator !== "string" || doc.operator.length === 0) {
    return recusado("operator gardado ausente");
  }
  const limiares = [
    doc.threshold_recovered,
    doc.threshold_current,
    doc.threshold_min,
    doc.threshold_max,
  ];
  if (!limiares.every(enteiroSeguro)) {
    return recusado("threshold_recovered/current/min/max gardados non son enteiros");
  }
  const recovered = doc.threshold_recovered as number;
  const current = doc.threshold_current as number;
  const min = doc.threshold_min as number;
  const max = doc.threshold_max as number;
  if (current < min || current > max) {
    return recusado(`limiar gardado ${current} fóra da faixa ${min}..${max}`);
  }
  if (typeof doc.graph_json !== "string" || doc.graph_json.length === 0) {
    return recusado("graph_json gardado ausente: non hai nos, arestas nin orixes");
  }
  const limitations = limitaciones(doc.limitations);
  if (!limitations) return recusado("limitations gardadas ausentes ou non texto");

  const proxeccion = projectGameplayGraph(doc.graph_json, limitations);
  if (!proxeccion.ok) {
    return recusado(`o grafo gardado non proxecta: ${proxeccion.motivo}`);
  }
  const regra: RegraRecuperada = {
    version: REGRA_RECUPERADA_VERSION,
    profile_id: doc.profile_id,
    rom_path: doc.rom_path.trim(),
    rom_sha256: doc.rom_sha256.toLowerCase(),
    entry,
    exits,
    blocks,
    operator: doc.operator,
    threshold_recovered: recovered,
    threshold_current: current,
    threshold_min: min,
    threshold_max: max,
    graph_json: doc.graph_json,
    limitations,
  };
  if (proxeccion.regra.romSha256.toLowerCase() !== regra.rom_sha256) {
    return recusado("identidade diverxente: o grafo gardado apunta a outra ROM");
  }
  if (proxeccion.regra.limiar !== current) {
    return recusado(
      `o limiar gardado (${current}) non bate co do grafo (${proxeccion.regra.limiar}): bloque adulterado`
    );
  }
  return { ok: true, regra, proxeccion: proxeccion.regra };
}

/**
 * Revalidación da identidade antes de tratar a regra reaberta como actual: o
 * SHA-256 observado agora ten que bater co gardado. Unha ROM distinta ou un
 * SHA malformado recusanse; nada se mostra como "a mesma ROM".
 */
export function revalidarIdentidade(
  gardada: RegraRecuperada,
  shaObservado: string
): { ok: true } | { ok: false; motivo: string } {
  const observado = shaObservado.trim().toLowerCase();
  if (!SHA_RE.test(observado)) {
    return recusado(
      `identidade observada malformada ('${shaObservado.trim()}'): non se pode revalidar contra a ROM gardada`
    );
  }
  if (observado === gardada.rom_sha256) return { ok: true };
  return recusado(
    `identidade diverxente: a escena garda a ROM ${gardada.rom_sha256.slice(0, 12)}… e a observada agora e ${observado.slice(0, 12)}…`
  );
}

/**
 * Aplica o `graph_json` que devolve `rex_gameplay_edit_threshold` ao bloque
 * gardado, revalidando todo o camiño de lectura: identidade, faixa e
 * coherencia limiar-grafo. A regra anterior queda intacta cando se recusa.
 */
export function regraEditadaNoGrafo(
  gardada: RegraRecuperada,
  graphJsonNovo: string
): ResultadoLeitura {
  const proxeccion = projectGameplayGraph(graphJsonNovo, gardada.limitations);
  if (!proxeccion.ok) {
    return recusado(`o grafo editado non proxecta: ${proxeccion.motivo}`);
  }
  if (proxeccion.regra.romSha256.toLowerCase() !== gardada.rom_sha256) {
    return recusado(
      "identidade diverxente: o grafo editado apunta a outra ROM que a gardada na escena"
    );
  }
  return lerRegraRecuperada({
    ...gardada,
    graph_json: graphJsonNovo,
    threshold_current: proxeccion.regra.limiar,
  });
}
