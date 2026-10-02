import { describe, expect, it } from "vitest";
import { deserializeNodeGraph, NODE_DEFS } from "./nodeDefinitions";
import { serializeNodeGraph } from "./nodeTypes";

// O programa da cadeia original (mugen.original_chain.v1) vive no grafo como UMA string JSON:
// o editor so conhece parametros string/numero e descartaria um objeto ao abrir/salvar.
const program = JSON.stringify({ schema: "retrodev.mugen_chain/v1", digest: "ab".repeat(32), special: [{ id: "-1#0" }] });
const graph = JSON.stringify({
  version: 1,
  nodes: [{ id: "mugen_state_program", type: "mugen_state_program", label: "Programa", x: 40, y: 80, inputs: [], outputs: [],
    params: { target: "kenmasters", profile: "mugen.original_chain.v1", program_sha256: "ab".repeat(32), program_json: program } }],
  edges: [],
});

describe("mugen_state_program no editor de grafos", () => {
  it("e um tipo conhecido e sobrevive a abrir -> serializar sem tocar no programa", () => {
    expect(NODE_DEFS.mugen_state_program).toBeDefined();
    const opened = deserializeNodeGraph(graph);
    expect(opened.nodes.map((n) => n.type)).toEqual(["mugen_state_program"]);
    expect(opened.nodes[0].params.program_json).toBe(program);
    const saved = JSON.parse(serializeNodeGraph(opened));
    expect(saved.nodes[0].params.program_json).toBe(program);
    expect(saved.nodes[0].params.program_sha256).toBe("ab".repeat(32));
  });

  it("descartaria um objeto como parametro (por isso o programa e uma string)", () => {
    const withObject = JSON.parse(graph);
    withObject.nodes[0].params = { target: "kenmasters", program: JSON.parse(program) };
    const opened = deserializeNodeGraph(JSON.stringify(withObject));
    expect(opened.nodes[0].params.program).toBeUndefined();
  });
});
