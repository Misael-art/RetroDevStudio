/**
 * graphHistory.ts — Desfazer/refazer do NodeGraph (Experimental).
 *
 * Guarda instantaneos imutaveis do grafo antes de cada alteracao do autor (organizar,
 * conectar, apagar, editar parametro, arrastar, agrupar). O editor persiste o grafo
 * resultante pelo mesmo caminho de salvamento das demais edicoes.
 */
import type { NodeGraph } from "./nodeTypes";

export type GraphHistory = {
  past: Array<{ graph: NodeGraph; label: string }>;
  future: Array<{ graph: NodeGraph; label: string }>;
};

export const GRAPH_HISTORY_LIMIT = 100;

export function emptyGraphHistory(): GraphHistory {
  return { past: [], future: [] };
}

/** Registra `before` (o grafo anterior a uma alteracao) e limpa o refazer. */
export function recordGraphHistory(history: GraphHistory, before: NodeGraph, label: string): GraphHistory {
  const past = [...history.past, { graph: before, label }];
  return { past: past.slice(Math.max(0, past.length - GRAPH_HISTORY_LIMIT)), future: [] };
}

export function undoGraphHistory(
  history: GraphHistory,
  current: NodeGraph
): { history: GraphHistory; graph: NodeGraph; label: string } | null {
  const last = history.past[history.past.length - 1];
  if (!last) return null;
  return {
    graph: last.graph,
    label: last.label,
    history: { past: history.past.slice(0, -1), future: [{ graph: current, label: last.label }, ...history.future] },
  };
}

export function redoGraphHistory(
  history: GraphHistory,
  current: NodeGraph
): { history: GraphHistory; graph: NodeGraph; label: string } | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    graph: next.graph,
    label: next.label,
    history: { past: [...history.past, { graph: current, label: next.label }], future: history.future.slice(1) },
  };
}

// ── Ponte com os atalhos globais (Ctrl+Z / Ctrl+Y) ────────────────────────────

type GraphHistoryHandler = { undo: () => void; redo: () => void };
let activeHandler: GraphHistoryHandler | null = null;

/**
 * O NodeGraph montado registra seu historico; enquanto estiver ativo, os comandos
 * globais de desfazer/refazer agem no grafo em vez de desfazer a cena por tras dele.
 */
export function registerGraphHistoryHandler(handler: GraphHistoryHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

/** Retorna true quando o NodeGraph consumiu o comando. */
export function dispatchGraphHistory(kind: "undo" | "redo"): boolean {
  if (!activeHandler) return false;
  activeHandler[kind]();
  return true;
}
