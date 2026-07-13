import { describe, expect, it } from "vitest";

import {
  resolveBuildProvenanceForGraph,
  sha256Text,
  type BuildSourceMap,
} from "./buildProvenance";

const GRAPH = JSON.stringify({ version: 1, nodes: [], edges: [] });

async function sourceMapFor(graph = GRAPH): Promise<BuildSourceMap> {
  return {
    schema_version: 1,
    kind: "node_build_source_map",
    evidence_label: "Proveniência de build observada",
    target: "megadrive",
    generated_file: "src/main.c",
    generated_source_sha256: "a".repeat(64),
    artifact: { path: "/project/build/megadrive/out/game.bin", sha256: "b".repeat(64) },
    limitations: ["Não é evidência de runtime."],
    graphs: [
      {
        graph_version: 1,
        graph_sha256: await sha256Text(graph),
        entries: [],
      },
    ],
  };
}

describe("build provenance contract", () => {
  it("accepts only the exact NodeGraph revision used by the build", async () => {
    const result = await resolveBuildProvenanceForGraph(await sourceMapFor(), GRAPH);
    expect(result.status).toBe("observed");
  });

  it("rejects an incompatible graph hash instead of reusing stale mappings", async () => {
    const changedGraph = JSON.stringify({ version: 1, nodes: [{ id: "new" }], edges: [] });
    const result = await resolveBuildProvenanceForGraph(
      await sourceMapFor(),
      changedGraph,
    );
    expect(result).toEqual({
      status: "incompatible",
      reason: "A revisão/hash do NodeGraph mudou desde o último build.",
    });
  });

  it("rejects an incompatible source-map schema", async () => {
    const sourceMap = await sourceMapFor();
    sourceMap.schema_version = 2;
    const result = await resolveBuildProvenanceForGraph(sourceMap, GRAPH);
    expect(result.status).toBe("incompatible");
  });
});
