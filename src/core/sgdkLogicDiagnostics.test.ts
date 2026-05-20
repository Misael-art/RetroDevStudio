import { describe, expect, it } from "vitest";

import {
  buildSgdkCapabilityMatrix,
  collectGraphImportGaps,
  filterGraphImportGaps,
  formatImportedSemanticsKind,
  formatSgdkImportSummaryKind,
  getEntityLogicImportSignal,
  getGraphNodeImportBadges,
  getGraphNodeSourceMapping,
} from "./sgdkLogicDiagnostics";

describe("sgdkLogicDiagnostics", () => {
  it("replaces the single SGDK support label with an explicit capability matrix", () => {
    const matrix = buildSgdkCapabilityMatrix({
      id: "sgdk",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      importable: true,
    });

    expect(matrix.map((item) => [item.label, item.statusLabel])).toEqual([
      ["Assets", "Suportado / Parcial"],
      ["Build/ROM", "Suportado / Parcial"],
      ["Emulacao", "Suportado / Parcial"],
      ["Cena/entidades", "Parcial"],
      ["Logica por nodes", "Parcial / Experimental"],
      ["FSM/Estados", "Suportado no subset / Experimental"],
      ["Round-trip", "Bridge / Parcial"],
      ["Equivalencia gameplay", "Nao certificada"],
    ]);
    expect(matrix.find((item) => item.id === "gameplay_equivalence")?.detail).toContain(
      "harness especifico"
    );
  });

  it("derives compact entity logic truth from imported semantics", () => {
    const fsmEntity = {
      components: {
        logic: {
          graph_ref: "graphs/sgdk_import_player.json",
          external_source_refs: ["src/main.c"],
          imported_semantics: {
            source: "sgdk_semantic_extractor",
            extraction_kind: "fsm",
            confidence: "high",
            converted_nodes_count: 6,
            bridge_count: 1,
            states_detected: 3,
            transitions_detected: 4,
            source_paths: ["src/player.c"],
          },
        },
      },
    };
    const bridgeEntity = {
      components: {
        logic: {
          graph_ref: "graphs/sgdk_import_enemy.json",
          imported_semantics: {
            source: "sgdk_phase_d",
            confidence: "low",
            converted_nodes_count: 0,
            bridge_count: 2,
            status: "bridge_only",
          },
        },
      },
    };

    expect(getEntityLogicImportSignal(fsmEntity)).toMatchObject({
      label: "Logic: FSM parcial",
      status: "partial",
      graphRef: "graphs/sgdk_import_player.json",
      confidence: "high",
      convertedNodesCount: 6,
      bridgeCount: 1,
      statesDetected: 3,
      transitionsDetected: 4,
      sourcePaths: ["src/player.c", "src/main.c"],
    });
    expect(getEntityLogicImportSignal(bridgeEntity)).toMatchObject({
      label: "Logic: Bridge",
      status: "bridge_only",
      convertedNodesCount: 0,
      bridgeCount: 2,
    });
  });

  it("classifies graph node badges, source mapping and filterable gaps", () => {
    const convertedNode = {
      id: "idle",
      type: "fsm_state",
      params: {
        import_status: "converted",
        source_file: "src/player.c",
        source_line: 42,
      },
    };
    const bridgeNode = {
      id: "raw_ai",
      type: "bridge_unconverted_source",
      params: {
        gap: "AI loop with function pointer remains bridge",
        source_path: "src/enemy.c",
        line: 88,
      },
    };
    const graph = {
      nodes: [convertedNode, bridgeNode],
      edges: [],
    };
    const semantics = {
      blocking_gaps: ["inline assembly branch blocks equivalence"],
    };

    expect(getGraphNodeImportBadges(convertedNode).map((badge) => badge.label)).toEqual([
      "Converted",
      "Source mapped",
    ]);
    expect(getGraphNodeImportBadges(bridgeNode).map((badge) => badge.label)).toEqual([
      "Bridge",
      "Gap",
      "Source mapped",
    ]);
    expect(getGraphNodeSourceMapping(convertedNode)).toEqual({
      file: "src/player.c",
      line: 42,
    });

    const gaps = collectGraphImportGaps(graph, semantics);
    expect(gaps.map((gap) => gap.label)).toEqual([
      "AI loop with function pointer remains bridge",
      "inline assembly branch blocks equivalence",
    ]);
    expect(filterGraphImportGaps(gaps, "assembly")).toHaveLength(1);

    expect(collectGraphImportGaps({ nodes: [], edges: [] }, { source: "sgdk_phase_d" })[0]).toMatchObject({
      severity: "blocking",
      label: expect.stringContaining("AST/FSM real nao extraido"),
    });
  });

  it("labels real FSM extractor output differently from heuristic imports", () => {
    expect(formatImportedSemanticsKind({ extraction_kind: "fsm", states_detected: 2 })).toBe(
      "FSM extraida"
    );
    expect(formatImportedSemanticsKind({ source: "sgdk_phase_d" })).toBe("Heuristica");
    expect(formatSgdkImportSummaryKind({ semantic_model_kind: "fsm" })).toBe("FSM extraida");
    expect(formatSgdkImportSummaryKind({ semantic_model_kind: "heuristic" })).toBe("Heuristica");
  });
});
