export type CapabilityTone = "supported" | "partial" | "experimental" | "bridge" | "blocked";

export type SgdkCapabilityItem = {
  id:
    | "assets"
    | "build_rom"
    | "emulation"
    | "scene_entities"
    | "logic_nodes"
    | "fsm_states"
    | "round_trip"
    | "gameplay_equivalence";
  label: string;
  statusLabel: string;
  detail: string;
  tone: CapabilityTone;
};

export type SgdkCapabilityProfileLike = {
  id?: string;
  support_status?: string;
  supported_levels?: string[];
  importable?: boolean;
};

export type SgdkImportSummary = {
  states_detected?: number;
  transitions_detected?: number;
  nodes_generated?: number;
  bridges_created?: number;
  blocking_gaps?: string[];
  mapped_source_files?: string[];
  semantic_model_kind?: "fsm" | "heuristic" | string;
};

export type ImportedLogicSemanticsLike = {
  source?: string;
  confidence?: string;
  source_paths?: string[];
  converted_nodes_count?: number;
  bridge_count?: number;
  gap_count?: number;
  status?: string;
  states_detected?: number;
  transitions_detected?: number;
  extraction_kind?: string;
  blocking_gaps?: string[];
};

type EntityLogicLike = {
  components?: {
    logic?: {
      graph?: string;
      graph_ref?: string | null;
      external_source_refs?: string[];
      imported_semantics?: ImportedLogicSemanticsLike | null;
    };
  };
};

export type EntityLogicImportStatus = "functional" | "partial" | "bridge_only" | "none";

export type EntityLogicImportSignal = {
  label: string;
  status: EntityLogicImportStatus;
  graphRef: string | null;
  confidence: string | null;
  convertedNodesCount: number;
  bridgeCount: number;
  gapCount: number;
  statesDetected: number;
  transitionsDetected: number;
  sourcePaths: string[];
  title: string;
};

export type GraphNodeImportBadge = {
  label: "Converted" | "Bridge" | "Gap" | "Source mapped";
  tone: CapabilityTone;
};

export type GraphSourceMapping = {
  file: string;
  line?: number;
};

export type GraphImportGap = {
  id: string;
  label: string;
  severity: "blocking" | "warning";
  nodeId?: string;
  source?: string;
};

type GraphNodeLike = {
  id: string;
  type: string;
  params?: Record<string, unknown>;
};

type GraphLike = {
  nodes: GraphNodeLike[];
  edges?: unknown[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeList(values: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0)
    )
  );
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readBoolish(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "converted"].includes(value.trim().toLowerCase());
  }
  return false;
}

function sourceModelIsFsm(semantics: ImportedLogicSemanticsLike | null | undefined): boolean {
  const extractionKind = normalizeText(semantics?.extraction_kind).toLowerCase();
  const source = normalizeText(semantics?.source).toLowerCase();
  return (
    extractionKind === "fsm" ||
    source.includes("semantic_extractor") ||
    readNumber(semantics?.states_detected) > 0 ||
    readNumber(semantics?.transitions_detected) > 0
  );
}

export function buildSgdkCapabilityMatrix(profile?: SgdkCapabilityProfileLike | null): SgdkCapabilityItem[] {
  void profile;
  return [
    {
      id: "assets",
      label: "Assets",
      statusLabel: "Suportado / Parcial",
      detail: "RES/SPRITE/IMAGE/TILESET/MAP/audio seguem o subset validado; recursos fora do parser viram gap/bridge.",
      tone: "supported",
    },
    {
      id: "build_rom",
      label: "Build/ROM",
      statusLabel: "Suportado / Parcial",
      detail: "Fluxo Build -> ROM continua certificado para o subset SGDK coberto por toolchain oficial.",
      tone: "supported",
    },
    {
      id: "emulation",
      label: "Emulacao",
      statusLabel: "Suportado / Parcial",
      detail: "ROMs geradas no subset rodam por core Libretro oficial quando dependencias estao instaladas.",
      tone: "supported",
    },
    {
      id: "scene_entities",
      label: "Cena/entidades",
      statusLabel: "Parcial",
      detail: "Cena, tilemaps, sprites e entidades sao materializados sem prometer equivalencia total do jogo donor.",
      tone: "partial",
    },
    {
      id: "logic_nodes",
      label: "Logica por nodes",
      statusLabel: "Parcial / Experimental",
      detail: "Nodes funcionais representam apenas o subset convertido; bridges preservam o que ainda nao virou node funcional.",
      tone: "experimental",
    },
    {
      id: "fsm_states",
      label: "FSM/Estados",
      statusLabel: "Suportado no subset / Experimental",
      detail: "FSM extraida conta como subset funcional; heuristica continua marcada como experimental.",
      tone: "experimental",
    },
    {
      id: "round_trip",
      label: "Round-trip",
      statusLabel: "Bridge / Parcial",
      detail: "Round-trip textual do C donor nao e prometido; o caminho canonico e UGDM/graphs com bridge rastreavel.",
      tone: "bridge",
    },
    {
      id: "gameplay_equivalence",
      label: "Equivalencia gameplay",
      statusLabel: "Nao certificada",
      detail: "Equivalencia 1:1 so pode ser alegada quando houver harness especifico para o projeto/classe.",
      tone: "blocked",
    },
  ];
}

export function formatSgdkImportSummaryKind(summary: SgdkImportSummary | null | undefined): string {
  return normalizeText(summary?.semantic_model_kind).toLowerCase() === "fsm"
    ? "FSM extraida"
    : "Heuristica";
}

export function formatImportedSemanticsKind(
  semantics: ImportedLogicSemanticsLike | null | undefined
): string {
  return sourceModelIsFsm(semantics) ? "FSM extraida" : "Heuristica";
}

export function getEntityLogicImportSignal(entity: EntityLogicLike | null | undefined): EntityLogicImportSignal {
  const logic = entity?.components?.logic;
  const semantics = logic?.imported_semantics ?? null;
  const convertedNodesCount = readNumber(semantics?.converted_nodes_count);
  const bridgeCount = readNumber(semantics?.bridge_count);
  const gapCount = readNumber(semantics?.gap_count) + normalizeList(semantics?.blocking_gaps).length;
  const statesDetected = readNumber(semantics?.states_detected);
  const transitionsDetected = readNumber(semantics?.transitions_detected);
  const graphRef = logic?.graph_ref ?? null;
  const sourcePaths = normalizeList([
    ...(semantics?.source_paths ?? []),
    ...(logic?.external_source_refs ?? []),
  ]);

  let status: EntityLogicImportStatus = "none";
  let label = "Logic: sem import";

  if (convertedNodesCount > 0 && bridgeCount === 0 && gapCount === 0) {
    status = "functional";
    label = sourceModelIsFsm(semantics) ? "Logic: FSM funcional" : "Logic: funcional";
  } else if (convertedNodesCount > 0 || statesDetected > 0 || transitionsDetected > 0) {
    status = "partial";
    label = sourceModelIsFsm(semantics) ? "Logic: FSM parcial" : "Logic: parcial";
  } else if (bridgeCount > 0 || normalizeText(semantics?.status).toLowerCase() === "bridge_only") {
    status = "bridge_only";
    label = "Logic: Bridge";
  } else if (graphRef || logic?.graph) {
    status = "partial";
    label = "Logic: parcial";
  }

  const title = [
    graphRef ? `graph_ref: ${graphRef}` : null,
    semantics?.confidence ? `confidence: ${semantics.confidence}` : null,
    `converted_nodes_count: ${convertedNodesCount}`,
    `bridge_count: ${bridgeCount}`,
    gapCount > 0 ? `gap_count: ${gapCount}` : null,
    statesDetected > 0 ? `states_detected: ${statesDetected}` : null,
    transitionsDetected > 0 ? `transitions_detected: ${transitionsDetected}` : null,
    sourcePaths.length > 0 ? `source mapping: ${sourcePaths.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    label,
    status,
    graphRef,
    confidence: normalizeText(semantics?.confidence) || null,
    convertedNodesCount,
    bridgeCount,
    gapCount,
    statesDetected,
    transitionsDetected,
    sourcePaths,
    title,
  };
}

export function getGraphNodeSourceMapping(node: GraphNodeLike | null | undefined): GraphSourceMapping | null {
  const params = node?.params ?? {};
  const file =
    normalizeText(params.source_file) ||
    normalizeText(params.source_path) ||
    normalizeText(params.source);
  if (!file) {
    return null;
  }
  const line = readNumber(params.source_line) || readNumber(params.line);
  return line > 0 ? { file, line } : { file };
}

export function getGraphNodeImportBadges(node: GraphNodeLike): GraphNodeImportBadge[] {
  const params = node.params ?? {};
  const status = normalizeText(params.import_status).toLowerCase();
  const badges: GraphNodeImportBadge[] = [];
  const isBridge = node.type === "bridge_unconverted_source" || status === "bridge" || readBoolish(params.bridge);
  const hasGap = isBridge || status === "gap" || Boolean(normalizeText(params.gap) || normalizeText(params.gap_id));
  const isConverted =
    !isBridge &&
    (status === "converted" ||
      readBoolish(params.converted) ||
      (node.type.startsWith("fsm_") && Boolean(getGraphNodeSourceMapping(node))));

  if (isConverted) {
    badges.push({ label: "Converted", tone: "supported" });
  }
  if (isBridge) {
    badges.push({ label: "Bridge", tone: "bridge" });
  }
  if (hasGap) {
    badges.push({ label: "Gap", tone: "blocked" });
  }
  if (getGraphNodeSourceMapping(node)) {
    badges.push({ label: "Source mapped", tone: "partial" });
  }

  return badges;
}

export function collectGraphImportGaps(
  graph: GraphLike,
  semantics?: ImportedLogicSemanticsLike | null
): GraphImportGap[] {
  const gaps: GraphImportGap[] = [];
  for (const node of graph.nodes) {
    const params = node.params ?? {};
    const label = normalizeText(params.gap) || normalizeText(params.gap_id);
    const isBridge = node.type === "bridge_unconverted_source";
    if (!label && !isBridge) {
      continue;
    }
    const mapping = getGraphNodeSourceMapping(node);
    gaps.push({
      id: `node:${node.id}`,
      nodeId: node.id,
      label: label || "Bridge sem conversao funcional",
      severity: "warning",
      source: mapping ? `${mapping.file}${mapping.line ? `:${mapping.line}` : ""}` : undefined,
    });
  }

  for (const [index, label] of normalizeList(semantics?.blocking_gaps).entries()) {
    gaps.push({
      id: `blocking:${index}:${label}`,
      label,
      severity: "blocking",
    });
  }

  if (
    gaps.length === 0 &&
    semantics &&
    formatImportedSemanticsKind(semantics) !== "FSM extraida"
  ) {
    gaps.push({
      id: "blocking:heuristic-no-fsm",
      label: "AST/FSM real nao extraido; tratar equivalencia gameplay como nao certificada ate passar pelo Semantic Extractor.",
      severity: "blocking",
    });
  }

  return gaps;
}

export function filterGraphImportGaps(gaps: GraphImportGap[], filterText: string): GraphImportGap[] {
  const needle = filterText.trim().toLowerCase();
  if (!needle) {
    return gaps;
  }
  return gaps.filter((gap) =>
    [gap.label, gap.source, gap.nodeId, gap.severity].some((value) =>
      String(value ?? "").toLowerCase().includes(needle)
    )
  );
}
