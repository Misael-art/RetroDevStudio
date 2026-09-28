import { describe, expect, it } from "vitest";
import {
  REX_GAMEPLAY_PROFILE_ID,
  parseHexOffsets,
  projectGameplayGraph,
  validateGameplayRecoverForm,
  validateGameplayThreshold,
} from "./rexGameplayGraph";
import { GRAFO_REAL, LIMITACIONES } from "../../test/fixtures/rexGameplay";

function projetar(jsonGrafo: string = GRAFO_REAL) {
  return projectGameplayGraph(jsonGrafo, LIMITACIONES);
}

describe("projectGameplayGraph — o grafo recuperado na lingua da interface", () => {
  it("recusa un documento que non e do perfil, co motivo", () => {
    const senBloque = projetar('{"version":1,"nodes":[],"edges":[]}');
    expect(senBloque.ok).toBe(false);
    if (!senBloque.ok) expect(senBloque.motivo).toMatch(/perfil/);

    const perfilEquivocado = projetar(
      JSON.stringify({
        version: 1,
        rex_gameplay: { ...JSON.parse(GRAFO_REAL).rex_gameplay, profile_id: "m68k.outra.v1" },
        nodes: [],
        edges: [],
      })
    );
    expect(perfilEquivocado.ok).toBe(false);
    if (!perfilEquivocado.ok) {
      expect(perfilEquivocado.motivo).toContain("m68k.outra.v1");
    }

    const versionTamperada = projetar(
      JSON.stringify({ ...JSON.parse(GRAFO_REAL), version: 2 })
    );
    expect(versionTamperada.ok).toBe(false);
  });

  it("di a regra en frase comprensible: entrada, incremento, comparacion, estado e orixe", () => {
    const r = projetar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.regra.profileId).toBe(REX_GAMEPLAY_PROFILE_ID);
    expect(r.regra.romSha256).toBe(
      "4149f7b2eb0c5975f97f59be6b44766decc286930d57bba673414205b753589e"
    );
    expect(r.regra.entrada).toMatch(/bit 3/);
    expect(r.regra.entrada).toMatch(/D0/);
    expect(r.regra.incremento).toContain("0xE0FF0054");
    expect(r.regra.incremento).toMatch(/\b1\b/);
    expect(r.regra.comparacion).toContain(">= 6");
    expect(r.regra.estadoPasaxe).toContain("0xE0FF0062");
    expect(r.regra.orixeRom).toContain("0x000946");
    expect(r.regra.orixeRom).toContain("0x000970");
    expect(r.regra.resumoFrases.join(" ")).toMatch(/cumprir a guarda/);
    expect(r.regra.limitaciones).toEqual(LIMITACIONES);
  });

  it("a chamada non recuperada aparece como opaca e sen edicion", () => {
    const r = projetar();
    if (!r.ok) throw new Error(r.motivo);
    const chamada = r.regra.nos.find((n) => n.id === "set_call");
    expect(chamada?.tipo).toBe("rom_external_call");
    expect(chamada?.editable).toBe(false);
    expect(chamada?.motivo).toMatch(/non recuperada/i);
    expect(r.regra.chamadaExterna).toContain("0x00B10C");
    expect(r.regra.chamadaExterna).toMatch(/opaca|non recuperada/i);
    const no = r.regra.grafo.nodes.find((n) => n.id === "set_call");
    expect(no?.params.readonly).toBe("true");
    expect(no?.params.target).toBe("0x00B10C");
    // Ocrate envia `understood: false` como booleano; o formato escalable e
    // "false", que e o que `canEditGraphNode` e as tarxetas len. Un "0"
    // silencioso faria que a opacidade se perda ao re-guardar o grafo.
    expect(no?.params.understood).toBe("false");
    // Os argumentos da chamada non se perden: proxectanse como texto.
    expect(String(no?.params.args)).toContain("0xE0FF007A");
  });

  it("só o limiar e editable, coa faixa permitida e o motivo das recusas", () => {
    const r = projetar();
    if (!r.ok) throw new Error(r.motivo);
    expect(r.regra.limiar).toBe(6);
    expect(r.regra.limiarMin).toBe(-127);
    expect(r.regra.limiarMax).toBe(128);
    expect(r.regra.nos.filter((n) => n.editable).map((n) => n.id)).toEqual(["compare"]);
    const compare = r.regra.nos.find((n) => n.id === "compare");
    expect(compare?.parametro).toBe("threshold");
    for (const no of r.regra.nos.filter((n) => !n.editable)) {
      expect(no.motivo && no.motivo.length).toBeGreaterThan(8);
    }
  });

  it("preserva as orixes na ROM de cada no (enderezo, bytes, mnemonico)", () => {
    const r = projetar();
    if (!r.ok) throw new Error(r.motivo);
    const guarda = r.regra.nos.find((n) => n.id === "guard");
    expect(guarda?.mappings).toEqual([
      { rom_start: "0x000946", rom_end: "0x00094A", mnemonic: "BTST #3,D0", bytes: "08000003" },
      { rom_start: "0x00094A", rom_end: "0x00094C", mnemonic: "BEQ.S $000970", bytes: "6724" },
    ]);
    const no = r.regra.grafo.nodes.find((n) => n.id === "guard");
    expect(no?.params.source_mappings).toContain("0x000946..0x00094A 08000003 BTST #3,D0");
  });

  it("hidrata un grafo do editor coles nos e conexions do perfil", () => {
    const r = projetar();
    if (!r.ok) throw new Error(r.motivo);
    expect(r.regra.grafo.nodes.map((n) => n.id)).toEqual([
      "entry",
      "guard",
      "counter_add",
      "compare",
      "set_write",
      "set_call",
      "other_write",
      "exit_000970",
    ]);
    expect(r.regra.grafo.edges.length).toBe(9);
    expect(r.regra.grafo.nodes.every((n) => n.inputs.length + n.outputs.length > 0)).toBe(true);
    const compare = r.regra.grafo.nodes.find((n) => n.id === "compare");
    expect(compare?.type).toBe("rom_counter_compare");
    expect(compare?.params.threshold).toBe(6);
    expect(compare?.params.recovered_threshold).toBe(6);
  });

  it("o grafo proxectado sobrevive ao round-trip do editor sen perder a opacidade", async () => {
    const { serializeNodeGraph } = await import("./nodeTypes");
    const { deserializeNodeGraph } = await import("./nodeDefinitions");
    const { canEditGraphNode } = await import("../../components/nodegraph/NodeGraphEditor");
    const r = projetar();
    if (!r.ok) throw new Error(r.motivo);
    const recargado = deserializeNodeGraph(serializeNodeGraph(r.regra.grafo));
    expect(recargado.nodes.map((n) => n.id)).toEqual(r.regra.grafo.nodes.map((n) => n.id));
    expect(recargado.edges.length).toBe(9);
    const editables = recargado.nodes.filter((n) => canEditGraphNode(n)).map((n) => n.id);
    expect(editables).toEqual(["compare"]);
    const chamada = recargado.nodes.find((n) => n.id === "set_call");
    if (!chamada) throw new Error("falta o no set_call tras recargar");
    expect(canEditGraphNode(chamada)).toBe(false);
    expect(recargado.nodes.find((n) => n.id === "compare")?.params.threshold).toBe(6);
    // O limiar editado no editor conserva a faixa: e o que a UI valida antes de chamar ao IPC.
    expect(recargado.nodes.find((n) => n.id === "compare")?.params.threshold_min).toBe(-127);
    expect(recargado.nodes.find((n) => n.id === "compare")?.params.threshold_max).toBe(128);
  });

  it("recusa un grafo cuxo limiar non esta no no de comparacion", () => {
    const roto = JSON.parse(GRAFO_REAL);
    roto.nodes = roto.nodes.filter((n: { type: string }) => n.type !== "rom_counter_compare");
    const r = projetar(JSON.stringify(roto));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/rom_counter_compare/);
  });
});

describe("parseHexOffsets — entrada de enderezos da interface", () => {
  it("aceita hex decimais separados por coma ou espazo", () => {
    expect(parseHexOffsets("0x946")).toEqual([0x946]);
    expect(parseHexOffsets("0x000970, 0xCCC")).toEqual([0x970, 0xccc]);
    expect(parseHexOffsets("12 0xFF")).toEqual([12, 255]);
    expect(parseHexOffsets("")).toEqual([]);
  });

  it("recusa tokens non numéricos con motivo, sen coerción silenciosa", () => {
    const r = parseHexOffsets("0x946,xyz");
    expect(r).toBeNull();
  });
});

describe("validateGameplayRecoverForm — o formulario non envía pedidos imposibles", () => {
  const base = { romPath: "/roms/autoral.bin", entry: "0x946", exits: "0x970" };

  it("produce o pedido exacto que espera o backend", () => {
    const r = validateGameplayRecoverForm(base, "req-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request).toEqual({
        request_id: "req-1",
        rom_path: "/roms/autoral.bin",
        entry: 0x946,
        exits: [0x970],
        address_labels: [],
      });
    }
  });

  it("recusa ROM vazia, enderezos impares, saidas fora e saida <= entrada", () => {
    const motivo = (form: { romPath: string; entry: string; exits: string }) => {
      const r = validateGameplayRecoverForm(form, "r");
      if (r.ok) throw new Error("esperabase recusa");
      return r.motivo;
    };
    expect(motivo({ ...base, romPath: " " })).toMatch(/ROM/);
    expect(motivo({ ...base, entry: "0x947" })).toMatch(/2 bytes|aliñad/);
    expect(motivo({ ...base, exits: "" })).toMatch(/saida/);
    expect(motivo({ ...base, exits: "0x946" })).toMatch(/despois da entrada/);
    expect(motivo({ ...base, exits: "0x970,0x970" })).toMatch(/repetid/);
    expect(validateGameplayRecoverForm({ ...base, entry: "non-hex" }, "r").ok).toBe(false);
  });

  it("limita o número de saidas declaradas", () => {
    const moitas = Array.from({ length: 65 }, (_, i) => `0x${(0x1000 + i * 2).toString(16)}`).join(",");
    const r = validateGameplayRecoverForm({ ...base, exits: moitas }, "r");
    if (r.ok) throw new Error("esperabase recusa");
    expect(r.motivo).toMatch(/máximo/);
  });
});

describe("validateGameplayThreshold — só o limiar, dentro da faixa declarada", () => {
  it("aceita enteiros dentro de [-127, 128] e rexeita o resto con motivo", () => {
    expect(validateGameplayThreshold("6", -127, 128)).toEqual({ ok: true, value: 6 });
    expect(validateGameplayThreshold("-127", -127, 128).ok).toBe(true);
    expect(validateGameplayThreshold("128", -127, 128).ok).toBe(true);
    expect(validateGameplayThreshold("129", -127, 128)).toEqual({
      ok: false,
      motivo: expect.stringContaining("128"),
    });
    expect(validateGameplayThreshold("-128", -127, 128).ok).toBe(false);
    expect(validateGameplayThreshold("6.5", -127, 128).ok).toBe(false);
    expect(validateGameplayThreshold("", -127, 128).ok).toBe(false);
    expect(validateGameplayThreshold("abc", -127, 128).ok).toBe(false);
  });
});
