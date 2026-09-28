import { describe, expect, it } from "vitest";
import {
  REX_GAMEPLAY_PROFILE_ID,
  parseHexOffsets,
  projectGameplayGraph,
  validateGameplayRecoverForm,
  validateGameplayThreshold,
} from "./rexGameplayGraph";

/**
 * Fixture: o grafo que devolve `rex_gameplay_recover` sobre a ROM autoral do
 * paquete (crates/rex-gameplay/fixtures/goal_original_t6.hex, entrada 0x946,
 * saida 0x970). Copiado tal cal da saida do crate, non resumido a man: se o
 * crate muda a forma, estas esperas rompen e vese.
 */
const GRAFO_REAL = `{
  "version": 1,
  "rex_gameplay": {
    "profile_id": "m68k.counter_threshold_state_gate.v1",
    "rom_sha256": "4149f7b2eb0c5975f97f59be6b44766decc286930d57bba673414205b753589e",
    "entry": "0x000946",
    "exits": [
      "0x000970"
    ],
    "blocks": [
      {
        "rom_start": "0x000946",
        "rom_end": "0x000970"
      },
      {
        "rom_start": "0x000CAE",
        "rom_end": "0x000CCC"
      }
    ],
    "localization": "declared-by-caller",
    "label_hints_origin": ""
  },
  "nodes": [
    {
      "id": "entry",
      "type": "rom_region_entry",
      "label": "Recovered region entry",
      "label_origin": "profile_default",
      "x": 40,
      "y": 120,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "address": "0x000946",
        "source_mappings": []
      }
    },
    {
      "id": "guard",
      "type": "rom_input_bit_guard",
      "label": "Input bit guard",
      "label_origin": "profile_default",
      "x": 40,
      "y": 230,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "register": "D0",
        "bit": 3,
        "skip_exit": "0x000970",
        "source_mappings": [
          {
            "rom_start": "0x000946",
            "rom_end": "0x00094A",
            "bytes": "08000003",
            "mnemonic": "BTST #3,D0",
            "insn": {
              "op": "btst #n,dn",
              "bit": 3,
              "d": 0
            }
          },
          {
            "rom_start": "0x00094A",
            "rom_end": "0x00094C",
            "bytes": "6724",
            "mnemonic": "BEQ.S $000970",
            "insn": {
              "op": "bcc",
              "cond": "eq",
              "target": "0x000970",
              "size": "s"
            }
          }
        ]
      }
    },
    {
      "id": "counter_add",
      "type": "rom_counter_add",
      "label": "Counter += step",
      "label_origin": "profile_default",
      "x": 40,
      "y": 340,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "address": "0xE0FF0054",
        "address_label": null,
        "step": 1,
        "width_bits": 32,
        "signedness": "two-complement wrapping",
        "source_mappings": [
          {
            "rom_start": "0x00094C",
            "rom_end": "0x000952",
            "bytes": "2039E0FF0054",
            "mnemonic": "MOVE.L $E0FF0054.L,D0",
            "insn": {
              "op": "move.l abs,dn",
              "abs": "0xE0FF0054",
              "d": 0
            }
          },
          {
            "rom_start": "0x000952",
            "rom_end": "0x000954",
            "bytes": "5280",
            "mnemonic": "ADDQ.L #1,D0",
            "insn": {
              "op": "addq.l #q,dn",
              "q": 1,
              "d": 0
            }
          },
          {
            "rom_start": "0x000954",
            "rom_end": "0x00095A",
            "bytes": "23C0E0FF0054",
            "mnemonic": "MOVE.L D0,$E0FF0054.L",
            "insn": {
              "op": "move.l dn,abs",
              "d": 0,
              "abs": "0xE0FF0054"
            }
          }
        ]
      }
    },
    {
      "id": "compare",
      "type": "rom_counter_compare",
      "label": "Counter threshold",
      "label_origin": "profile_default",
      "x": 40,
      "y": 450,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "address": "0xE0FF0054",
        "address_label": null,
        "operator": ">=",
        "threshold": 6,
        "recovered_threshold": 6,
        "threshold_min": -127,
        "threshold_max": 128,
        "width_bits": 32,
        "signed": true,
        "editable": "threshold",
        "lowering": "MOVEQ #(threshold-1) ; CMP.L ; BLT (taken = set branch)",
        "source_mappings": [
          {
            "rom_start": "0x00095A",
            "rom_end": "0x000960",
            "bytes": "2039E0FF0054",
            "mnemonic": "MOVE.L $E0FF0054.L,D0",
            "insn": {
              "op": "move.l abs,dn",
              "abs": "0xE0FF0054",
              "d": 0
            }
          },
          {
            "rom_start": "0x000960",
            "rom_end": "0x000962",
            "bytes": "7405",
            "mnemonic": "MOVEQ #5,D2",
            "insn": {
              "op": "moveq",
              "imm": 5,
              "d": 2
            }
          },
          {
            "rom_start": "0x000962",
            "rom_end": "0x000964",
            "bytes": "B480",
            "mnemonic": "CMP.L D0,D2",
            "insn": {
              "op": "cmp.l dn,dn",
              "src": 0,
              "dst": 2
            }
          },
          {
            "rom_start": "0x000964",
            "rom_end": "0x000968",
            "bytes": "6D000348",
            "mnemonic": "BLT.W $000CAE",
            "insn": {
              "op": "bcc",
              "cond": "lt",
              "target": "0x000CAE",
              "size": "w"
            }
          }
        ]
      }
    },
    {
      "id": "set_write",
      "type": "rom_state_write",
      "label": "Write state when rule holds",
      "label_origin": "profile_default",
      "x": 300,
      "y": 120,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "address": "0xE0FF0062",
        "address_label": null,
        "value": 1,
        "width_bits": 32,
        "source_mappings": [
          {
            "rom_start": "0x000CAE",
            "rom_end": "0x000CB0",
            "bytes": "7601",
            "mnemonic": "MOVEQ #1,D3",
            "insn": {
              "op": "moveq",
              "imm": 1,
              "d": 3
            }
          },
          {
            "rom_start": "0x000CB0",
            "rom_end": "0x000CB6",
            "bytes": "23C3E0FF0062",
            "mnemonic": "MOVE.L D3,$E0FF0062.L",
            "insn": {
              "op": "move.l dn,abs",
              "d": 3,
              "abs": "0xE0FF0062"
            }
          },
          {
            "rom_start": "0x000CC8",
            "rom_end": "0x000CCC",
            "bytes": "6000FCA6",
            "mnemonic": "BRA.W $000970",
            "insn": {
              "op": "bra",
              "target": "0x000970",
              "size": "w"
            }
          }
        ]
      }
    },
    {
      "id": "set_call",
      "type": "rom_external_call",
      "label": "External call (not recovered)",
      "label_origin": "profile_default",
      "x": 300,
      "y": 230,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "target": "0x00B10C",
        "args": [
          {
            "kind": "long_from_memory",
            "address": "0xE0FF007A",
            "address_label": null
          },
          {
            "kind": "immediate_long",
            "value": 1
          }
        ],
        "understood": false,
        "clobbers": "D0,D1,A0,A1,CCR (ABI m68k-elf-gcc)",
        "source_mappings": [
          {
            "rom_start": "0x000CB6",
            "rom_end": "0x000CBA",
            "bytes": "48780001",
            "mnemonic": "PEA $0001.W",
            "insn": {
              "op": "pea abs.w",
              "abs": 1
            }
          },
          {
            "rom_start": "0x000CBA",
            "rom_end": "0x000CC0",
            "bytes": "2F39E0FF007A",
            "mnemonic": "MOVE.L $E0FF007A.L,-(SP)",
            "insn": {
              "op": "move.l abs,-(sp)",
              "abs": "0xE0FF007A"
            }
          },
          {
            "rom_start": "0x000CC0",
            "rom_end": "0x000CC6",
            "bytes": "4EB90000B10C",
            "mnemonic": "JSR $00B10C.L",
            "insn": {
              "op": "jsr abs.l",
              "target": "0x00B10C"
            }
          },
          {
            "rom_start": "0x000CC6",
            "rom_end": "0x000CC8",
            "bytes": "508F",
            "mnemonic": "ADDQ.L #8,SP",
            "insn": {
              "op": "addq.l #q,sp",
              "q": 8
            }
          }
        ]
      }
    },
    {
      "id": "other_write",
      "type": "rom_state_write",
      "label": "Write state when rule fails",
      "label_origin": "profile_default",
      "x": 300,
      "y": 340,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "address": "0xE0FF0062",
        "address_label": null,
        "value": 0,
        "width_bits": 32,
        "source_mappings": [
          {
            "rom_start": "0x000968",
            "rom_end": "0x00096A",
            "bytes": "7000",
            "mnemonic": "MOVEQ #0,D0",
            "insn": {
              "op": "moveq",
              "imm": 0,
              "d": 0
            }
          },
          {
            "rom_start": "0x00096A",
            "rom_end": "0x000970",
            "bytes": "23C0E0FF0062",
            "mnemonic": "MOVE.L D0,$E0FF0062.L",
            "insn": {
              "op": "move.l dn,abs",
              "d": 0,
              "abs": "0xE0FF0062"
            }
          }
        ]
      }
    },
    {
      "id": "exit_000970",
      "type": "rom_region_exit",
      "label": "Region exit",
      "label_origin": "profile_default",
      "x": 300,
      "y": 450,
      "params": {
        "semantic_origin": "recovered_from_rom",
        "address": "0x000970",
        "source_mappings": []
      }
    }
  ],
  "edges": [
    {
      "id": "entry_exec_guard",
      "fromNode": "entry",
      "fromPort": "exec",
      "toNode": "guard",
      "toPort": "exec"
    },
    {
      "id": "guard_false_exit_000970",
      "fromNode": "guard",
      "fromPort": "false",
      "toNode": "exit_000970",
      "toPort": "exec"
    },
    {
      "id": "guard_true_counter_add",
      "fromNode": "guard",
      "fromPort": "true",
      "toNode": "counter_add",
      "toPort": "exec"
    },
    {
      "id": "counter_add_exec_compare",
      "fromNode": "counter_add",
      "fromPort": "exec",
      "toNode": "compare",
      "toPort": "exec"
    },
    {
      "id": "compare_true_set_write",
      "fromNode": "compare",
      "fromPort": "true",
      "toNode": "set_write",
      "toPort": "exec"
    },
    {
      "id": "compare_false_other_write",
      "fromNode": "compare",
      "fromPort": "false",
      "toNode": "other_write",
      "toPort": "exec"
    },
    {
      "id": "set_write_exec_set_call",
      "fromNode": "set_write",
      "fromPort": "exec",
      "toNode": "set_call",
      "toPort": "exec"
    },
    {
      "id": "set_call_exec_exit_000970",
      "fromNode": "set_call",
      "fromPort": "exec",
      "toNode": "exit_000970",
      "toPort": "exec"
    },
    {
      "id": "other_write_exec_exit_000970",
      "fromNode": "other_write",
      "fromPort": "exec",
      "toNode": "exit_000970",
      "toPort": "exec"
    }
  ]
}`;

const LIMITACIONES = [
  "a regiao e delimitada a partir de entrada/saidas declaradas pelo chamador",
  "unica edicao permitida: limiar, dentro da faixa do MOVEQ original",
];

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
