/**
 * nodeEngine.ts — Contrato minimo executavel do Node Engine (Experimental).
 *
 * Modulo puro e deterministico. Ele concentra a validacao canonica do
 * NodeGraph e a execucao local simulada (trace local). Este modulo NAO observa
 * emulador, ROM ou runtime real; nao existe source mapping confiavel
 * ROM/PC -> node (decisao registrada na rodada 79).
 *
 * Separacao explicita de evidencia:
 * - `LocalNodeTrace`: unica evidencia produzida aqui; sempre `simulated`.
 * - `RuntimeEvidence`: contrato reservado para um backend real futuro;
 *   este modulo NUNCA fabrica esse tipo.
 * - `UnsupportedRuntimeMapping`: estado honesto atual de qualquer tentativa
 *   de mapear execucao real para nodes.
 */

import type {
  GraphNode,
  NodeEdge,
  NodeGraph,
  NodePort,
  NodeType,
} from "../../components/nodegraph/NodeGraphEditor";
import type { Entity } from "../ipc/sceneService";
import { getEntityDisplayName } from "../entityDisplay";

// ── Contrato de validacao ─────────────────────────────────────────────────────

export type NodeGraphValidationIssue = {
  severity: "error" | "warning";
  code:
    | "broken_node_ref"
    | "broken_port_ref"
    | "port_kind_mismatch"
    | "data_type_mismatch"
    | "exec_cycle"
    | "missing_entry"
    | "disconnected_node"
    | "node_without_exec_input"
    | "branch_without_output"
    | "blocking_bridge"
    | "input_command_unbound"
    | "missing_animation";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type NodeGraphValidation = {
  errors: NodeGraphValidationIssue[];
  warnings: NodeGraphValidationIssue[];
};

export type NodeGraphValidationContext = {
  selectedEntity?: Entity | null;
  sceneEntities?: Entity[];
};

export type NodeEngineErrorCode = "graph_empty" | NodeGraphValidationIssue["code"];

export type NodeEngineError = {
  code: NodeEngineErrorCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

// ── Contrato de evidencia ─────────────────────────────────────────────────────

export type LocalTraceStepKind = "input event" | "condition" | "action" | "output";

export type LocalTraceStep = {
  kind: LocalTraceStepKind;
  nodeId?: string;
  label: string;
  detail: string;
};

/**
 * Evidencia local/simulada. E a UNICA evidencia que este modulo produz.
 * Qualquer superficie que exibir este trace deve rotula-lo como
 * local/simulado/Experimental.
 */
export type LocalNodeTrace = {
  kind: "local_node_trace";
  evidence: "simulated";
  evidenceLabel: string;
  deterministic: true;
  reachableNodeIds: string[];
  steps: LocalTraceStep[];
  /** Snapshot da avaliacao pura de var_set/var_get/logic_math (subset local). */
  variables: Record<string, number>;
};

/**
 * Contrato reservado para evidencia de runtime real (ex.: parity harness
 * Libretro). Este modulo nao tem backend real e portanto nunca constroi
 * valores deste tipo.
 */
export type RuntimeEvidence = {
  kind: "runtime_evidence";
  source: "libretro_parity_harness";
  reportPath: string;
};

export type UnsupportedRuntimeMapping = {
  kind: "unsupported_runtime_mapping";
  reason: string;
};

export type NodeExecutionEvidence =
  | LocalNodeTrace
  | RuntimeEvidence
  | UnsupportedRuntimeMapping;

export const LOCAL_TRACE_EVIDENCE_LABEL =
  "simulado / nao instrumentado (Experimental)";

export function isRuntimeEvidence(
  evidence: NodeExecutionEvidence,
): evidence is RuntimeEvidence {
  return evidence.kind === "runtime_evidence";
}

/**
 * Estado honesto atual: nao existe source mapping confiavel ROM/PC -> node,
 * entao qualquer pedido de evidencia de runtime para o NodeGraph retorna
 * `unsupported_runtime_mapping` em vez de fabricar observacao.
 */
export function resolveRuntimeEvidenceForGraph(): UnsupportedRuntimeMapping {
  return {
    kind: "unsupported_runtime_mapping",
    reason:
      "Sem source mapping confiavel ROM/PC -> node; evidencia de runtime real nao e suportada pelo Node Engine local (rodada 79).",
  };
}

// ── Nodes de entrada exec ─────────────────────────────────────────────────────

export const EVENT_NODE_TYPES: NodeType[] = [
  "event_start",
  "event_update",
  "input_pressed",
  "input_held",
  "input_command",
  "condition_overlap",
  "event_vblank",
  "event_hblank",
  "event_dma_done",
];

export function normalizeGraphEntityKey(
  value: string | number | null | undefined,
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ── Validador deterministico (canonico) ───────────────────────────────────────

function findPort(
  node: GraphNode,
  portId: string,
  direction: "input" | "output",
): NodePort | undefined {
  const ports = direction === "input" ? node.inputs : node.outputs;
  return ports.find((port) => port.id === portId);
}

function collectExecCycles(
  graph: NodeGraph,
  nodeById: Map<string, GraphNode>,
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    if (!fromNode || !toNode) {
      continue;
    }
    const fromPort = findPort(fromNode, edge.fromPort, "output");
    const toPort = findPort(toNode, edge.toPort, "input");
    if (fromPort?.kind !== "exec" || toPort?.kind !== "exec") {
      continue;
    }
    adjacency.set(edge.fromNode, [...(adjacency.get(edge.fromNode) ?? []), edge.toNode]);
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      const cycleStart = stack.indexOf(nodeId);
      cycles.push(cycleStart >= 0 ? stack.slice(cycleStart).concat(nodeId) : [nodeId]);
      return;
    }
    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of graph.nodes) {
    visit(node.id);
  }

  return cycles;
}

function isExecEntryNode(node: GraphNode): boolean {
  return EVENT_NODE_TYPES.includes(node.type);
}

function isBranchingExecNode(node: GraphNode): boolean {
  return node.outputs.filter((port) => port.kind === "exec").length > 1;
}

function hasTruthyParam(
  params: Record<string, string | number>,
  keys: string[],
): boolean {
  return keys.some((key) => {
    const value = params[key];
    if (typeof value === "number") {
      return value !== 0;
    }
    return ["1", "true", "yes", "blocking", "block"].includes(
      String(value ?? "").trim().toLowerCase(),
    );
  });
}

function normalizeGraphToken(value: string | number | null | undefined): string {
  return normalizeGraphEntityKey(value);
}

function resolveGraphTargetEntity(
  node: GraphNode,
  context?: NodeGraphValidationContext,
): Entity | null {
  const entities = context?.sceneEntities ?? [];
  const candidateKeys = Array.from(
    new Set(
      ["target", "entity", "a", "b"]
        .map((key) => normalizeGraphToken(node.params[key]))
        .filter((value) => value.length > 0),
    ),
  );

  const matched =
    candidateKeys.length > 0
      ? entities.find((entity) => {
          const entityKeys = [
            normalizeGraphToken(entity.entity_id),
            normalizeGraphToken(getEntityDisplayName(entity)),
            normalizeGraphToken(entity.display_name ?? ""),
          ];
          return candidateKeys.some((candidate) =>
            entityKeys.includes(candidate),
          );
        })
      : null;

  return matched ?? context?.selectedEntity ?? null;
}

function commandNodeHasBinding(
  node: GraphNode,
  context?: NodeGraphValidationContext,
): boolean {
  const targetEntity = resolveGraphTargetEntity(node, context);
  const bindings = targetEntity?.components.sprite?.commands ?? [];
  if (bindings.length === 0) {
    return false;
  }

  const commandId = normalizeGraphToken(node.params.command_id);
  const displayName = normalizeGraphToken(node.params.display_name);
  const notation = String(node.params.notation ?? "").trim();

  if (commandId.length > 0) {
    return bindings.some(
      (binding) => normalizeGraphToken(binding.id) === commandId,
    );
  }

  return bindings.some((binding) => {
    const bindingKeys = [
      normalizeGraphToken(binding.id),
      normalizeGraphToken(binding.display_name),
    ];
    return (
      (displayName.length > 0 && bindingKeys.includes(displayName)) ||
      (notation.length > 0 && (binding.notation ?? "").trim() === notation)
    );
  });
}

function nodeReferencesMissingAnimation(
  node: GraphNode,
  context?: NodeGraphValidationContext,
): boolean {
  if (node.type !== "set_animation_state" && node.type !== "sprite_anim") {
    return false;
  }
  const animationKey = normalizeGraphToken(
    node.type === "sprite_anim" ? node.params.anim : node.params.state,
  );
  if (!animationKey) {
    return false;
  }

  const targetEntity = resolveGraphTargetEntity(node, context);
  const animations = targetEntity?.components.sprite?.animations;
  if (!animations || Object.keys(animations).length === 0) {
    return true;
  }

  return !Object.keys(animations).some(
    (key) => normalizeGraphToken(key) === animationKey,
  );
}

function isBlockingBridgeNode(node: GraphNode): boolean {
  return (
    node.type === "bridge_unconverted_source" &&
    hasTruthyParam(node.params, [
      "blocking",
      "blocks_build",
      "blocks_runtime",
      "build_blocking",
    ])
  );
}

export function validateNodeGraph(
  graph: NodeGraph,
  context?: NodeGraphValidationContext,
): NodeGraphValidation {
  const issues: NodeGraphValidationIssue[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const connectedNodeIds = new Set<string>();
  const validIncomingExecNodeIds = new Set<string>();
  const outgoingExecByNodePort = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    if (!fromNode || !toNode) {
      issues.push({
        severity: "error",
        code: "broken_node_ref",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' aponta para no inexistente.`,
      });
      continue;
    }

    const fromPort = findPort(fromNode, edge.fromPort, "output");
    const toPort = findPort(toNode, edge.toPort, "input");
    if (!fromPort || !toPort) {
      issues.push({
        severity: "error",
        code: "broken_port_ref",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' aponta para porta inexistente.`,
      });
      continue;
    }

    connectedNodeIds.add(edge.fromNode);
    connectedNodeIds.add(edge.toNode);

    if (fromPort.kind !== toPort.kind) {
      issues.push({
        severity: "error",
        code: "port_kind_mismatch",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' liga porta ${fromPort.kind} em porta ${toPort.kind}.`,
      });
    }

    if (fromPort.kind === "exec" && toPort.kind === "exec") {
      validIncomingExecNodeIds.add(edge.toNode);
      const outgoingPorts =
        outgoingExecByNodePort.get(edge.fromNode) ?? new Set<string>();
      outgoingPorts.add(edge.fromPort);
      outgoingExecByNodePort.set(edge.fromNode, outgoingPorts);
    }

    if (
      fromPort.kind === "data" &&
      toPort.kind === "data" &&
      fromPort.dataType &&
      toPort.dataType &&
      fromPort.dataType !== toPort.dataType
    ) {
      issues.push({
        severity: "error",
        code: "data_type_mismatch",
        edgeId: edge.id,
        message: `Aresta '${edge.id}' liga dado ${fromPort.dataType} em dado ${toPort.dataType}.`,
      });
    }
  }

  if (graph.nodes.length > 0 && graph.nodes.every((node) => !EVENT_NODE_TYPES.includes(node.type))) {
    issues.push({
      severity: "warning",
      code: "missing_entry",
      message: "Grafo sem evento de entrada.",
    });
  }

  for (const node of graph.nodes) {
    if (!connectedNodeIds.has(node.id)) {
      issues.push({
        severity: "warning",
        code: "disconnected_node",
        nodeId: node.id,
        message: `No '${node.label}' ainda esta solto no fluxo.`,
      });
    }

    const hasExecInput = node.inputs.some((port) => port.kind === "exec");
    if (
      hasExecInput &&
      !isExecEntryNode(node) &&
      !validIncomingExecNodeIds.has(node.id)
    ) {
      issues.push({
        severity: "warning",
        code: "node_without_exec_input",
        nodeId: node.id,
        message: `No '${node.label}' tem entrada exec sem ligacao de entrada.`,
      });
    }

    if (isBranchingExecNode(node)) {
      const connectedOutputs = outgoingExecByNodePort.get(node.id) ?? new Set();
      const missingOutputs = node.outputs
        .filter((port) => port.kind === "exec")
        .filter((port) => !connectedOutputs.has(port.id));
      if (missingOutputs.length > 0) {
        issues.push({
          severity: "warning",
          code: "branch_without_output",
          nodeId: node.id,
          message: `Branch '${node.label}' tem saida sem destino: ${missingOutputs
            .map((port) => port.label || port.id)
            .join(", ")}.`,
        });
      }
    }

    if (isBlockingBridgeNode(node)) {
      issues.push({
        severity: "error",
        code: "blocking_bridge",
        nodeId: node.id,
        message: `Bridge bloqueante '${node.label}' preserva fonte sem conversao executavel.`,
      });
    }

    if (node.type === "input_command" && !commandNodeHasBinding(node, context)) {
      issues.push({
        severity: "error",
        code: "input_command_unbound",
        nodeId: node.id,
        message: `Comando de input '${String(
          node.params.command_id ?? node.label,
        )}' nao tem binding em SpriteComponent.commands.`,
      });
    }

    if (nodeReferencesMissingAnimation(node, context)) {
      issues.push({
        severity: "error",
        code: "missing_animation",
        nodeId: node.id,
        message: `Animacao '${String(
          node.type === "sprite_anim" ? node.params.anim : node.params.state,
        )}' referenciada por '${node.label}' nao existe no sprite alvo.`,
      });
    }
  }

  for (const cycle of collectExecCycles(graph, nodeById)) {
    issues.push({
      severity: "error",
      code: "exec_cycle",
      nodeId: cycle[0],
      message: `Ciclo exec detectado: ${cycle.join(" -> ")}.`,
    });
  }

  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
  };
}

/**
 * Validacao para execucao local: agrega o validador canonico e o caso
 * explicito de grafo vazio no contrato de erro estruturado do engine.
 */
export function validateNodeGraphForExecution(
  graph: NodeGraph,
  context?: NodeGraphValidationContext,
): { errors: NodeEngineError[]; validation: NodeGraphValidation } {
  if (graph.nodes.length === 0) {
    return {
      errors: [
        {
          code: "graph_empty",
          message: "Grafo vazio: nenhum node para executar localmente.",
        },
      ],
      validation: { errors: [], warnings: [] },
    };
  }

  const validation = validateNodeGraph(graph, context);
  return {
    errors: validation.errors.map((issue) => ({
      code: issue.code,
      message: issue.message,
      nodeId: issue.nodeId,
      edgeId: issue.edgeId,
    })),
    validation,
  };
}

// ── Simulacao local deterministica ────────────────────────────────────────────

/** Teto de passos do trace local; protege consumidores contra grafos gigantes. */
export const MAX_LOCAL_TRACE_STEPS = 512;

export function collectReachableExecNodeIds(graph: NodeGraph): string[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    if (!fromNode || !toNode) {
      continue;
    }
    const fromPort = findPort(fromNode, edge.fromPort, "output");
    const toPort = findPort(toNode, edge.toPort, "input");
    if (fromPort?.kind !== "exec" || toPort?.kind !== "exec") {
      continue;
    }
    adjacency.set(edge.fromNode, [
      ...(adjacency.get(edge.fromNode) ?? []),
      edge.toNode,
    ]);
  }

  const queue = graph.nodes
    .filter((node) => isExecEntryNode(node))
    .map((node) => node.id);
  const reachable: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    reachable.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (!seen.has(nextId)) {
        queue.push(nextId);
      }
    }
  }

  return reachable;
}

function traceKindsForNode(node: GraphNode): LocalTraceStepKind[] {
  if (
    node.type === "input_pressed" ||
    node.type === "input_held" ||
    node.type === "input_command"
  ) {
    return ["input event", "condition"];
  }
  if (node.type.startsWith("event_")) {
    return ["input event"];
  }
  if (
    node.type.startsWith("condition_") ||
    node.type === "flow_if" ||
    node.type === "flow_while" ||
    node.type === "hardware_budget_check"
  ) {
    return ["condition"];
  }
  return ["action"];
}

function buildNodeTraceDetail(
  node: GraphNode,
  kind: LocalTraceStepKind,
  variables: Record<string, number>,
): string {
  if (kind === "output") {
    return "Saida exec alcancavel nesta simulacao local.";
  }
  if (node.type === "input_command") {
    return `command_id=${String(node.params.command_id ?? node.id)}`;
  }
  if (node.type === "set_animation_state") {
    return `state=${String(node.params.state ?? "")}`;
  }
  if (node.type === "sprite_anim") {
    return `anim=${String(node.params.anim ?? "")}`;
  }
  if (node.type === "bridge_unconverted_source") {
    return `bridge=${String(node.params.gap ?? "source")}`;
  }
  if (node.type === "var_set") {
    const varName = String(node.params.var_name ?? "temp_var");
    return `var=${varName} valor_local=${variables[varName] ?? 0}`;
  }
  return node.type;
}

/**
 * Avaliacao pura do subset de dados local: var_set/var_get/logic_math.
 * Os var_set alcancaveis sao avaliados na ordem deterministica de
 * alcancabilidade; entrada de dado nao conectada vale o param `value` do
 * proprio node ou 0. Divisao/resto por zero valem 0 (sem excecao).
 */
function evaluateLocalVariables(
  graph: NodeGraph,
  reachableNodeIds: string[],
): Record<string, number> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const variables: Record<string, number> = {};

  const findIncomingDataEdge = (toNodeId: string, toPort: string): NodeEdge | undefined =>
    graph.edges.find((edge) => edge.toNode === toNodeId && edge.toPort === toPort);

  const evaluateNodeValue = (node: GraphNode, visited: Set<string>): number => {
    if (visited.has(node.id)) {
      return 0;
    }
    visited.add(node.id);

    switch (node.type) {
      case "var_get":
        return variables[String(node.params.var_name ?? "temp_var")] ?? 0;
      case "logic_math": {
        const left = evaluateDataInput(node, "a", visited);
        const right = evaluateDataInput(node, "b", visited);
        const operator = String(node.params.operator ?? "+");
        switch (operator) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return right === 0 ? 0 : Math.trunc(left / right);
          case "%":
            return right === 0 ? 0 : left % right;
          default:
            return 0;
        }
      }
      default: {
        const literal = Number(node.params.value ?? 0);
        return Number.isFinite(literal) ? literal : 0;
      }
    }
  };

  const evaluateDataInput = (
    node: GraphNode,
    portId: string,
    visited: Set<string>,
  ): number => {
    const edge = findIncomingDataEdge(node.id, portId);
    const source = edge ? nodeById.get(edge.fromNode) : undefined;
    if (!source) {
      const literal = Number(node.params[portId] ?? node.params.value ?? 0);
      return Number.isFinite(literal) ? literal : 0;
    }
    return evaluateNodeValue(source, visited);
  };

  for (const nodeId of reachableNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node || node.type !== "var_set") {
      continue;
    }
    const varName = String(node.params.var_name ?? "temp_var");
    variables[varName] = evaluateDataInput(node, "value", new Set([node.id]));
  }

  return variables;
}

/**
 * Trace local simulado: lista os nodes exec alcancaveis a partir dos eventos
 * de entrada e as transicoes exec entre eles. NAO decide branches por input
 * real (inputs nao sao conheciveis localmente); todos os ramos alcancaveis
 * sao percorridos e rotulados como simulacao.
 */
export function buildLocalSimulationTrace(
  graph: NodeGraph,
  reachableNodeIds: string[],
  variables: Record<string, number>,
): LocalTraceStep[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const trace: LocalTraceStep[] = [];

  for (const nodeId of reachableNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    for (const kind of traceKindsForNode(node)) {
      trace.push({
        kind,
        nodeId: node.id,
        label: node.label || node.type,
        detail: buildNodeTraceDetail(node, kind, variables),
      });
    }
  }

  const reachableSet = new Set(reachableNodeIds);
  for (const edge of graph.edges) {
    if (!reachableSet.has(edge.fromNode) || !reachableSet.has(edge.toNode)) {
      continue;
    }
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    const fromPort = fromNode
      ? findPort(fromNode, edge.fromPort, "output")
      : undefined;
    const toPort = toNode ? findPort(toNode, edge.toPort, "input") : undefined;
    if (fromPort?.kind !== "exec" || toPort?.kind !== "exec") {
      continue;
    }
    trace.push({
      kind: "output",
      nodeId: edge.fromNode,
      label: `${edge.fromPort} -> ${edge.toNode}`,
      detail: "Transicao exec simulada por aresta local.",
    });
  }

  return trace.slice(0, MAX_LOCAL_TRACE_STEPS);
}

// ── Execucao local (contrato do engine) ───────────────────────────────────────

export type LocalNodeGraphRun =
  | {
      status: "success";
      validation: NodeGraphValidation;
      trace: LocalNodeTrace;
    }
  | {
      status: "error";
      errors: NodeEngineError[];
      validation: NodeGraphValidation;
    };

function buildLocalTrace(graph: NodeGraph): LocalNodeTrace {
  const reachableNodeIds = collectReachableExecNodeIds(graph);
  const variables = evaluateLocalVariables(graph, reachableNodeIds);
  return {
    kind: "local_node_trace",
    evidence: "simulated",
    evidenceLabel: LOCAL_TRACE_EVIDENCE_LABEL,
    deterministic: true,
    reachableNodeIds,
    steps: buildLocalSimulationTrace(graph, reachableNodeIds, variables),
    variables,
  };
}

/**
 * Executa o grafo localmente de forma pura e deterministica.
 * Sucesso NUNCA significa evidencia de runtime real: o resultado e sempre um
 * `LocalNodeTrace` (`evidence: "simulated"`). Erros de validacao bloqueiam a
 * execucao e retornam o contrato estruturado de erro.
 */
export function runNodeGraphLocally(
  graph: NodeGraph,
  context?: NodeGraphValidationContext,
): LocalNodeGraphRun {
  const { errors, validation } = validateNodeGraphForExecution(graph, context);
  if (errors.length > 0) {
    return { status: "error", errors, validation };
  }
  return { status: "success", validation, trace: buildLocalTrace(graph) };
}

// ── Inspecao para UI (rotulada como simulada) ─────────────────────────────────

export type LocalExecutionInspection = {
  evidence: "simulated";
  evidenceLabel: string;
  reachableNodeIds: string[];
  trace: LocalTraceStep[];
};

/**
 * Inspecao usada pela UI do NodeGraph. Diferente de `runNodeGraphLocally`,
 * ela nao bloqueia por erros de validacao (a UI mostra diagnostics ao lado),
 * mas a evidencia continua sempre `simulated`.
 */
export function inspectNodeGraphExecution(
  graph: NodeGraph,
): LocalExecutionInspection {
  const trace = buildLocalTrace(graph);
  return {
    evidence: "simulated",
    evidenceLabel: trace.evidenceLabel,
    reachableNodeIds: trace.reachableNodeIds,
    trace: trace.steps,
  };
}
