import { describe, expect, it } from "vitest";
import {
  REGRA_RECUPERADA_VERSION,
  construirRegraRecuperada,
  lerRegraRecuperada,
  prepararXeracion,
  regraEditadaNoGrafo,
  revalidarIdentidade,
  type RegraRecuperada,
} from "./rexGameplayScene";
import { GRAFO_REAL, respostaRecuperar } from "../../test/fixtures/rexGameplay";
import { projectGameplayGraph } from "./rexGameplayGraph";
import type { GameplayRecoverResponse } from "../../core/ipc/toolsService";

/**
 * Probas de ETAPA 4: o que se garda na escena ten que conter a ROM-base, a
 * rutina, o parámetro, as conexións, os mapeamentos (con bytes) e as
 * limitacións, e a reapertura ten que recusar cando a identidade da ROM xa non
 * bate. Nada se descarta en silencio.
 */

function grafoConLimiar(limiar: number): string {
  const doc = JSON.parse(GRAFO_REAL);
  const compare = doc.nodes.find((n: { type: string }) => n.type === "rom_counter_compare");
  compare.params.threshold = limiar;
  return JSON.stringify(doc);
}

function esperarConstruida(romPath = "/roms/goal_original_t6.bin"): RegraRecuperada {
  const r = construirRegraRecuperada(respostaRecuperar(), romPath);
  if (!r.ok) throw new Error(`construir debería acceptar: ${r.motivo}`);
  return r.regra;
}

/** Estende-se sobre a resposta do fixture e devolve o motivo da recusa. */
function motivoConstruir(cambio: Partial<GameplayRecoverResponse>, romPath = "/r.bin"): string {
  const r = construirRegraRecuperada(respostaRecuperar(cambio), romPath);
  if (r.ok) throw new Error(`esperabase recusa, pero aceptouse: ${JSON.stringify(r.regra)}`);
  return r.motivo;
}

function motivoLeir(cambio: Record<string, unknown>): string {
  const gardada = esperarConstruida();
  const r = lerRegraRecuperada({ ...gardada, ...cambio });
  if (r.ok) throw new Error(`esperabase recusa, pero aceptouse: ${JSON.stringify(r.regra)}`);
  return r.motivo;
}

describe("construirRegraRecuperada — o que a escena debe conservar", () => {
  it("produce o bloque exacto que describe a ROM-base, a rutina e o parámetro", () => {
    expect(esperarConstruida()).toEqual({
      version: REGRA_RECUPERADA_VERSION,
      profile_id: "m68k.counter_threshold_state_gate.v1",
      rom_path: "/roms/goal_original_t6.bin",
      rom_sha256: "4149f7b2eb0c5975f97f59be6b44766decc286930d57bba673414205b753589e",
      entry: 0x946,
      exits: [0x970],
      blocks: [
        [0x946, 0x970],
        [0xcae, 0xccc],
      ],
      operator: ">=",
      threshold_recovered: 6,
      threshold_current: 6,
      threshold_min: -127,
      threshold_max: 128,
      graph_json: GRAFO_REAL,
      limitations: [
        "a regiao e delimitada a partir de entrada/saidas declaradas pelo chamador",
        "unica edicao permitida: limiar, dentro da faixa do MOVEQ original",
      ],
    });
  });

  it("garda o limiar editado como valor actual, sen borrar o recuperado", () => {
    const resposta: GameplayRecoverResponse = {
      ...respostaRecuperar(),
      graph_json: grafoConLimiar(4),
    };
    const r = construirRegraRecuperada(resposta, "/roms/autoral.bin");
    if (!r.ok) throw new Error(r.motivo);
    expect(r.regra.threshold_current).toBe(4);
    expect(r.regra.threshold_recovered).toBe(6);
  });

  it("recusa identidade de ROM incompleta, ROM sen caminho e grafo que non proxecta", () => {
    expect(motivoConstruir({ rom_sha256: "abc" })).toMatch(/identidade|SHA-256/);
    expect(motivoConstruir({}, "   ")).toMatch(/ROM/);
    expect(motivoConstruir({ graph_json: '{"version":1,"nodes":[],"edges":[]}' })).toMatch(
      /rex_gameplay/
    );
  });

  it("recusa unha resposta cuxo grafo pertence a outro perfil", () => {
    expect(motivoConstruir({ profile_id: "m68k.outra.v1" })).toMatch(/perfil/);
  });

  it("recusa rutina sen saidas nin bloques, co motivo que nomea o campo", () => {
    expect(motivoConstruir({ exits: [] })).toMatch(/exits/);
    expect(motivoConstruir({ blocks: [] })).toMatch(/blocks/);
  });
});

describe("lerRegraRecuperada — reabrir desde a escena", () => {
  it("acepta o bloque gardado e devolve a proxeccion coas orixes intactas", () => {
    const gardada = esperarConstruida();
    const r = lerRegraRecuperada(JSON.parse(JSON.stringify(gardada)));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.regra).toEqual(gardada);
    expect(r.proxeccion.limiar).toBe(6);
    // Conexións e mapeamentos (con bytes) sobreviven verbatim no graph_json.
    expect(r.proxeccion.grafo.edges.length).toBe(9);
    const compare = r.proxeccion.nos.find((n) => n.id === "compare");
    expect(compare?.mappings.map((m) => m.bytes)).toContain("2039E0FF0054");
  });

  it("proxecta o limiar editado que se gardou, non o recuperado", () => {
    const resposta: GameplayRecoverResponse = {
      ...respostaRecuperar(),
      graph_json: grafoConLimiar(9),
    };
    const construida = construirRegraRecuperada(resposta, "/r.bin");
    if (!construida.ok) throw new Error(construida.motivo);
    const r = lerRegraRecuperada(construida.regra);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.proxeccion.limiar).toBe(9);
    expect(r.regra.threshold_recovered).toBe(6);
  });

  it("recusa version descoñecida, perfil alleo e SHA malformado en vez de hidratar a cegas", () => {
    expect(motivoLeir({ version: 2 })).toMatch(/version/);
    expect(motivoLeir({ version: "1" })).toMatch(/version/);
    expect(motivoLeir({ profile_id: "outro" })).toMatch(/perfil/);
    expect(motivoLeir({ rom_sha256: "f".repeat(63) })).toMatch(/SHA-256|identidade/);
  });

  it("recusa un bloque cuxo grafo foi adulterado e di por que", () => {
    const gardada = esperarConstruida();
    const doc = JSON.parse(gardada.graph_json);
    doc.nodes = doc.nodes.filter((n: { type: string }) => n.type !== "rom_counter_compare");
    const r = lerRegraRecuperada({ ...gardada, graph_json: JSON.stringify(doc) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/rom_counter_compare|limiar/);
  });

  it("recusa campos ausentes ou de tipo equivocado, sen coerción silenciosa", () => {
    const senRegra = lerRegraRecuperada(undefined);
    expect(senRegra.ok).toBe(false);
    if (!senRegra.ok) expect(senRegra.motivo).toMatch(/gardada/);
    expect(motivoLeir({ limitations: "unha string" })).toMatch(/limitations/);
    expect(motivoLeir({ entry: "0x946" })).toMatch(/entry/);
    expect(motivoLeir({ threshold_current: null })).toMatch(/threshold/);
  });

  it("non admite un limiar gardado fóra da faixa declarada", () => {
    const gardada = esperarConstruida();
    const doc = JSON.parse(gardada.graph_json);
    const compare = doc.nodes.find((n: { type: string }) => n.type === "rom_counter_compare");
    compare.params.threshold = 200;
    const r = lerRegraRecuperada({
      ...gardada,
      graph_json: JSON.stringify(doc),
      threshold_current: 200,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/faixa/);
  });

  it("recusa un bloque cuxo limiar gardado non bate co que di o grafo", () => {
    const gardada = esperarConstruida();
    // 4 esta dentro da faixa -127..128: o unico que o descobre e a
    // coherencia bloque-grafo, non a comprobacion de faixa.
    const r = lerRegraRecuperada({ ...gardada, threshold_current: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/non bate|adulterado/);
  });

  it("a proxeccion reaberta coincide coa que devolve o proxector directo", () => {
    const gardada = esperarConstruida();
    const r = lerRegraRecuperada(gardada);
    if (!r.ok) throw new Error(r.motivo);
    const directa = projectGameplayGraph(gardada.graph_json, gardada.limitations);
    if (!directa.ok) throw new Error(directa.motivo);
    expect(r.proxeccion).toEqual(directa.regra);
  });
});

describe("revalidarIdentidade — a reapertura confirma a ROM", () => {  it("aceita o mesmo SHA e recusa calquera outro com motivo explícito", () => {
    const gardada = esperarConstruida();
    expect(revalidarIdentidade(gardada, gardada.rom_sha256)).toEqual({ ok: true });
    const outro = "0".repeat(64);
    const r = revalidarIdentidade(gardada, outro);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain(gardada.rom_sha256.slice(0, 12));
      expect(r.motivo).toContain(outro.slice(0, 12));
    }
  });

  it("recusa unha identidade observada malformada en vez de comparala con tolerancia", () => {
    const gardada = esperarConstruida();
    expect(revalidarIdentidade(gardada, "").ok).toBe(false);
    expect(revalidarIdentidade(gardada, "  ").ok).toBe(false);
    expect(revalidarIdentidade(gardada, `${gardada.rom_sha256}xy`).ok).toBe(false);
  });
});

describe("regraEditadaNoGrafo — o grafo que devolve edit_threshold substitúe ao gardado", () => {
  it("actualiza o limiar actual, deixa o recuperado e revalida o resto", () => {
    const gardada = esperarConstruida();
    const r = regraEditadaNoGrafo(gardada, grafoConLimiar(11));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.regra.threshold_current).toBe(11);
    expect(r.regra.threshold_recovered).toBe(6);
    expect(r.regra.graph_json).toBe(grafoConLimiar(11));
    expect(r.proxeccion.limiar).toBe(11);
    // O bloque anterior queda intacto: a edición non muta nada en memoria.
    expect(gardada.threshold_current).toBe(6);
  });

  it("recusa un grafo que non proxecta, sen tocar a regra gardada", () => {
    const gardada = esperarConstruida();
    const r = regraEditadaNoGrafo(gardada, '{"version":1,"nodes":[],"edges":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/rex_gameplay|proxecta/);
  });

  it("recusa un limiar novo fóra da faixa declarada", () => {
    const gardada = esperarConstruida();
    const r = regraEditadaNoGrafo(gardada, grafoConLimiar(500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/faixa/);
  });

  it("recusa un grafo que apunta a outra ROM", () => {
    const gardada = esperarConstruida();
    const doc = JSON.parse(GRAFO_REAL);
    doc.rex_gameplay.rom_sha256 = "b".repeat(64);
    const r = regraEditadaNoGrafo(gardada, JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/identidade/);
  });
});

describe("prepararXeracion — a petición para rexenerar a copia modificada (ETAPA 5)", () => {
  function preparar(
    cambio: { romPath?: string; method?: "patch" | "regenerate" | string } = {},
    regra?: RegraRecuperada
  ) {
    const base = regra ?? esperarConstruida();
    return prepararXeracion(
      base,
      cambio.romPath ?? "/roms/goal_original_t6.bin",
      (cambio.method ?? "patch") as "patch" | "regenerate",
      "xer-1"
    );
  }

  function request(cambio = {}) {
    const r = preparar(cambio);
    if (!r.ok) throw new Error(`preparar recusou: ${r.motivo}`);
    return r.request;
  }

  it("leva a base da barra, a identidade gardada no bloque e o grafo verbatim", () => {
    const p = request();
    expect(p).toEqual({
      request_id: "xer-1",
      base_path: "/roms/goal_original_t6.bin",
      expected_sha256:
        "4149f7b2eb0c5975f97f59be6b44766decc286930d57bba673414205b753589e",
      graph_json: GRAFO_REAL,
      output_path: "/roms/goal_original_t6.bin.limiar-6.patch.bin",
      method: "patch",
    });
  });

  it("a saida derivada nunca coincide co caminho da base", () => {
    for (const method of ["patch", "regenerate"] as const) {
      const p = request({ method });
      expect(p.output_path).not.toBe(p.base_path);
      expect(p.output_path.startsWith(p.base_path)).toBe(true);
    }
  });

  it("di NoOp cando o limiar gardado e o da ROM, para que a copia se venda como control", () => {
    const r = preparar();
    if (!r.ok) throw new Error(r.motivo);
    expect(r.noop).toBe(true);
    const editada = regraEditadaNoGrafo(esperarConstruida(), grafoConLimiar(4));
    if (!editada.ok) throw new Error(editada.motivo);
    const xa = preparar({}, editada.regra);
    if (!xa.ok) throw new Error(xa.motivo);
    expect(xa.noop).toBe(false);
    expect(xa.request.output_path).toContain("limiar-4");
  });

  it("recusa xerar sen ROM na barra e recusa un metodo descoñecido", () => {
    expect(preparar({ romPath: "   " }).ok).toBe(false);
    if (!preparar({ romPath: "  " }).ok)
      expect(preparar({ romPath: "  " }) && true).toBe(true);
    const senRom = preparar({ romPath: "   " });
    if (!senRom.ok) expect(senRom.motivo).toMatch(/ROM na barra/);
    const metodo = preparar({ method: "recompila-todo" });
    expect(metodo.ok).toBe(false);
    if (!metodo.ok) expect(metodo.motivo).toMatch(/patch|regenerate/);
  });
});
