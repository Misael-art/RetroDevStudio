import { describe, expect, it } from "vitest";

import {
  deserializeNodeGraph,
  serializeNodeGraph,
  type GraphNode,
  type NodeGraph,
} from "../../components/nodegraph/NodeGraphEditor";
import {
  LOCAL_TRACE_EVIDENCE_LABEL,
  isRuntimeEvidence,
  resolveRuntimeEvidenceForGraph,
  runNodeGraphLocally,
  validateNodeGraphForExecution,
  type NodeExecutionEvidence,
} from "./nodeEngine";

function eventStartNode(id: string): GraphNode {
  return {
    id,
    type: "event_start",
    label: "On Start",
    x: 40,
    y: 40,
    inputs: [],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: {},
  };
}

function varSetNode(id: string, varName: string, value: number): GraphNode {
  return {
    id,
    type: "var_set",
    label: `Set ${varName}`,
    x: 240,
    y: 40,
    inputs: [
      { id: "exec", label: "▶", kind: "exec" },
      { id: "value", label: "Value", kind: "data", dataType: "int" },
    ],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { var_name: varName, value },
  };
}

function varGetNode(id: string, varName: string): GraphNode {
  return {
    id,
    type: "var_get",
    label: `Get ${varName}`,
    x: 40,
    y: 160,
    inputs: [],
    outputs: [{ id: "value", label: "Value", kind: "data", dataType: "int" }],
    params: { var_name: varName },
  };
}

function actionSoundNode(id: string): GraphNode {
  return {
    id,
    type: "action_sound",
    label: "Play SFX",
    x: 440,
    y: 40,
    inputs: [{ id: "exec", label: "▶", kind: "exec" }],
    outputs: [{ id: "exec", label: "▶", kind: "exec" }],
    params: { sfx: "jump" },
  };
}

function minimalValidGraph(): NodeGraph {
  return {
    nodes: [eventStartNode("entry"), varSetNode("set_score", "score", 42)],
    edges: [
      {
        id: "e1",
        fromNode: "entry",
        fromPort: "exec",
        toNode: "set_score",
        toPort: "exec",
      },
    ],
  };
}

describe("nodeEngine: contrato de validacao para execucao", () => {
  it("aceita grafo valido minimo e produz trace local deterministico", () => {
    const run = runNodeGraphLocally(minimalValidGraph());
    expect(run.status).toBe("success");
    if (run.status !== "success") {
      return;
    }
    expect(run.trace.kind).toBe("local_node_trace");
    expect(run.trace.evidence).toBe("simulated");
    expect(run.trace.evidenceLabel).toBe(LOCAL_TRACE_EVIDENCE_LABEL);
    expect(run.trace.reachableNodeIds).toEqual(["entry", "set_score"]);
    expect(run.trace.steps.map((step) => step.kind)).toEqual([
      "input event",
      "action",
      "output",
    ]);
    expect(run.trace.variables).toEqual({ score: 42 });
  });

  it("rejeita grafo vazio com erro estruturado graph_empty", () => {
    const run = runNodeGraphLocally({ nodes: [], edges: [] });
    expect(run.status).toBe("error");
    if (run.status !== "error") {
      return;
    }
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "graph_empty" }),
    ]);
  });

  it("rejeita aresta apontando para node inexistente", () => {
    const graph = minimalValidGraph();
    graph.edges.push({
      id: "e_ghost",
      fromNode: "entry",
      fromPort: "exec",
      toNode: "nao_existe",
      toPort: "exec",
    });
    const run = runNodeGraphLocally(graph);
    expect(run.status).toBe("error");
    if (run.status !== "error") {
      return;
    }
    expect(run.errors).toContainEqual(
      expect.objectContaining({ code: "broken_node_ref", edgeId: "e_ghost" }),
    );
  });

  it("rejeita aresta apontando para porta inexistente", () => {
    const graph = minimalValidGraph();
    graph.edges[0] = { ...graph.edges[0], toPort: "porta_fantasma" };
    const run = runNodeGraphLocally(graph);
    expect(run.status).toBe("error");
    if (run.status !== "error") {
      return;
    }
    expect(run.errors).toContainEqual(
      expect.objectContaining({ code: "broken_port_ref", edgeId: "e1" }),
    );
  });

  it("rejeita tipo de dado incompativel entre portas", () => {
    const boolTarget: GraphNode = {
      id: "logic",
      type: "logic_and",
      label: "AND",
      x: 240,
      y: 160,
      inputs: [{ id: "cond", label: "Cond", kind: "data", dataType: "bool" }],
      outputs: [],
      params: {},
    };
    const graph: NodeGraph = {
      nodes: [eventStartNode("entry"), varGetNode("get_score", "score"), boolTarget],
      edges: [
        {
          id: "e_type",
          fromNode: "get_score",
          fromPort: "value",
          toNode: "logic",
          toPort: "cond",
        },
      ],
    };
    const { errors } = validateNodeGraphForExecution(graph);
    expect(errors).toContainEqual(
      expect.objectContaining({ code: "data_type_mismatch", edgeId: "e_type" }),
    );
  });

  it("rejeita ciclo exec como erro estruturado", () => {
    const a = actionSoundNode("a");
    const b = actionSoundNode("b");
    const graph: NodeGraph = {
      nodes: [eventStartNode("entry"), a, b],
      edges: [
        { id: "e1", fromNode: "entry", fromPort: "exec", toNode: "a", toPort: "exec" },
        { id: "e2", fromNode: "a", fromPort: "exec", toNode: "b", toPort: "exec" },
        { id: "e3", fromNode: "b", fromPort: "exec", toNode: "a", toPort: "exec" },
      ],
    };
    const run = runNodeGraphLocally(graph);
    expect(run.status).toBe("error");
    if (run.status !== "error") {
      return;
    }
    expect(run.errors).toContainEqual(
      expect.objectContaining({ code: "exec_cycle" }),
    );
  });

  it("entrada ausente e warning: nao bloqueia, mas resulta em trace vazio", () => {
    const graph: NodeGraph = {
      nodes: [varSetNode("set_solto", "score", 1)],
      edges: [],
    };
    const run = runNodeGraphLocally(graph);
    expect(run.status).toBe("success");
    if (run.status !== "success") {
      return;
    }
    expect(run.validation.warnings).toContainEqual(
      expect.objectContaining({ code: "missing_entry" }),
    );
    expect(run.trace.reachableNodeIds).toEqual([]);
    expect(run.trace.steps).toEqual([]);
    expect(run.trace.variables).toEqual({});
  });
});

describe("nodeEngine: executor local puro", () => {
  it("avalia subset de dados var_get/logic_math de forma deterministica", () => {
    const math: GraphNode = {
      id: "math",
      type: "logic_math",
      label: "Math",
      x: 240,
      y: 160,
      inputs: [
        { id: "a", label: "A", kind: "data", dataType: "int" },
        { id: "b", label: "B", kind: "data", dataType: "int" },
      ],
      outputs: [{ id: "value", label: "Value", kind: "data", dataType: "int" }],
      params: { operator: "+", b: 7 },
    };
    const setB = varSetNode("set_b", "b", 0);
    const graph: NodeGraph = {
      nodes: [
        eventStartNode("entry"),
        varSetNode("set_a", "a", 5),
        setB,
        varGetNode("get_a", "a"),
        math,
      ],
      edges: [
        { id: "e1", fromNode: "entry", fromPort: "exec", toNode: "set_a", toPort: "exec" },
        { id: "e2", fromNode: "set_a", fromPort: "exec", toNode: "set_b", toPort: "exec" },
        { id: "e3", fromNode: "get_a", fromPort: "value", toNode: "math", toPort: "a" },
        { id: "e4", fromNode: "math", fromPort: "value", toNode: "set_b", toPort: "value" },
      ],
    };
    const run = runNodeGraphLocally(graph);
    expect(run.status).toBe("success");
    if (run.status !== "success") {
      return;
    }
    expect(run.trace.variables).toEqual({ a: 5, b: 12 });
  });

  it("produz trace identico em execucoes repetidas (determinismo)", () => {
    const first = runNodeGraphLocally(minimalValidGraph());
    const second = runNodeGraphLocally(minimalValidGraph());
    const third = runNodeGraphLocally(structuredClone(minimalValidGraph()));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("nodeEngine: separacao de evidencia", () => {
  it("trace local nunca e evidencia de runtime", () => {
    const run = runNodeGraphLocally(minimalValidGraph());
    expect(run.status).toBe("success");
    if (run.status !== "success") {
      return;
    }
    const evidence: NodeExecutionEvidence = run.trace;
    expect(evidence.kind).toBe("local_node_trace");
    expect(isRuntimeEvidence(evidence)).toBe(false);
    expect(run.trace.evidenceLabel).toContain("simulado");
    expect(run.trace.evidenceLabel).toContain("Experimental");
  });

  it("pedido de evidencia de runtime retorna unsupported_runtime_mapping", () => {
    const mapping = resolveRuntimeEvidenceForGraph();
    expect(mapping.kind).toBe("unsupported_runtime_mapping");
    expect(mapping.reason).toContain("source mapping");
    expect(isRuntimeEvidence(mapping)).toBe(false);
  });
});

describe("nodeEngine: serializacao estavel", () => {
  it("round-trip serialize/deserialize e estavel apos normalizacao", () => {
    const original = serializeNodeGraph(minimalValidGraph());
    const normalizedOnce = serializeNodeGraph(deserializeNodeGraph(original));
    const normalizedTwice = serializeNodeGraph(
      deserializeNodeGraph(normalizedOnce),
    );
    expect(normalizedTwice).toBe(normalizedOnce);

    const roundTripped = deserializeNodeGraph(normalizedOnce);
    expect(roundTripped.nodes.map((node) => node.id)).toEqual([
      "entry",
      "set_score",
    ]);
    expect(roundTripped.edges).toHaveLength(1);
  });
});
