/**
 * nodeLayout.ts — "Organizar visualmente" o NodeGraph (Experimental).
 *
 * Layout em camadas guiado pelas conexoes existentes: cada componente conectado vira
 * uma faixa (um comportamento), na ordem em que seus nos aparecem no grafo; ciclos sao
 * quebrados apenas para calcular colunas; ramos Sim/Nao ficam em linhas distintas.
 *
 * Garantias (cobertas por testes):
 * - so `x`/`y` mudam; ids, tipos, rotulos, parametros, portas, arestas, grupos e a ordem
 *   dos arrays sao preservados — nenhuma conexao e criada ou removida;
 * - nos fixados (`pinned`) e nos fora do escopo nunca se movem e viram obstaculos;
 * - nos movidos nao se sobrepoem entre si nem aos obstaculos; sobreposicoes que o
 *   layout nao pode resolver (entre nos fixados) sao informadas em `conflicts`.
 *
 * Nao ha garantia de zero cruzamentos: a ordenacao por baricentro apenas os reduz.
 */
import type { GraphNode, NodeEdge, NodeGraph } from "./nodeTypes";

export type NodeSize = { width: number; height: number };
export type NodeRect = { x: number; y: number; width: number; height: number };
export type NodeSizeLookup = (node: GraphNode) => NodeSize;

export const NODE_CARD_LAYOUT_WIDTH = 232;
export const LAYOUT_COLUMN_GAP = 88;
export const LAYOUT_ROW_GAP = 28;
export const LAYOUT_COMPONENT_GAP = 64;

/**
 * Estimativa das dimensoes do cartao a partir do conteudo (usada quando o DOM ainda
 * nao mediu o cartao, p.ex. em testes ou antes do primeiro render). Espelha a estrutura
 * de `NodeCard`: cabecalho, frase, entidade, linhas de porta, parametros essenciais e
 * a linha "Detalhes tecnicos".
 */
export function estimateNodeCardSize(node: GraphNode, essentialParamCount = 2, hasEntity = true): NodeSize {
  const portRows = Math.max(node.inputs.length, node.outputs.length, 1);
  const height = 30 + 36 + (hasEntity ? 24 : 0) + portRows * 20 + 8 + essentialParamCount * 20 + 22;
  return { width: NODE_CARD_LAYOUT_WIDTH, height };
}

export type LayoutConflict = {
  kind: "pinned_overlap" | "moved_around_fixed";
  nodeIds: string[];
  message: string;
};

export type LayoutOptions = {
  /** Dimensoes reais (medidas) por no; cai em `estimateNodeCardSize` quando ausente. */
  sizeOf?: NodeSizeLookup;
  /** Nos a organizar; os demais ficam parados como obstaculos. Padrao: todos. */
  scope?: Iterable<string>;
};

export type LayoutResult = {
  graph: NodeGraph;
  movedNodeIds: string[];
  conflicts: LayoutConflict[];
};

function defaultSize(node: GraphNode): NodeSize {
  return estimateNodeCardSize(node);
}

export function rectsOverlap(a: NodeRect, b: NodeRect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

function portOrder(port: string): number {
  if (port === "exec" || port === "true" || port === "tick" || port === "matched" || port === "body") return 0;
  if (port === "false" || port === "done" || port === "next" || port === "transitions") return 1;
  return 2;
}

type Component = { nodeIds: string[]; firstIndex: number };

function connectedComponents(nodeIds: string[], edges: NodeEdge[], indexOf: Map<string, number>): Component[] {
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const edge of edges) {
    if (!parent.has(edge.fromNode) || !parent.has(edge.toNode)) continue;
    const a = find(edge.fromNode);
    const b = find(edge.toNode);
    if (a !== b) parent.set(b, a);
  }
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }
  return [...groups.values()]
    .map((ids) => {
      ids.sort((a, b) => indexOf.get(a)! - indexOf.get(b)!);
      return { nodeIds: ids, firstIndex: indexOf.get(ids[0])! };
    })
    .sort((a, b) => a.firstIndex - b.firstIndex);
}

/** Colunas por caminho mais longo, ignorando arestas de retorno (ciclos). */
function assignLayers(ids: string[], edges: NodeEdge[], indexOf: Map<string, number>): Map<string, number> {
  const out = new Map<string, NodeEdge[]>(ids.map((id) => [id, []]));
  for (const edge of edges) out.get(edge.fromNode)?.push(edge);
  for (const list of out.values()) {
    list.sort((a, b) => portOrder(a.fromPort) - portOrder(b.fromPort) || indexOf.get(a.toNode)! - indexOf.get(b.toNode)!);
  }
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) incoming.set(edge.toNode, (incoming.get(edge.toNode) ?? 0) + 1);

  // DFS a partir das raizes (sem entrada), na ordem do grafo; marca arestas de retorno.
  const state = new Map<string, 0 | 1 | 2>();
  const backEdges = new Set<NodeEdge>();
  const visit = (start: string) => {
    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    state.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const list = out.get(frame.id)!;
      if (frame.next >= list.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = list[frame.next++];
      const s = state.get(edge.toNode) ?? 0;
      if (s === 1) backEdges.add(edge);
      else if (s === 0) {
        state.set(edge.toNode, 1);
        stack.push({ id: edge.toNode, next: 0 });
      }
    }
  };
  const roots = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  for (const id of [...roots, ...ids]) if (!state.get(id)) visit(id);

  const dagEdges = edges.filter((edge) => !backEdges.has(edge));
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  // Relaxamento de Bellman-Ford no DAG (n pequeno; limite de iteracoes por seguranca).
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const edge of dagEdges) {
      const next = layer.get(edge.fromNode)! + 1;
      if (next > layer.get(edge.toNode)!) {
        layer.set(edge.toNode, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Provedores de dados puros (ex.: "Ler variavel") ficam na coluna anterior ao consumidor.
  for (const id of ids) {
    const hasIncoming = dagEdges.some((edge) => edge.toNode === id);
    const outs = dagEdges.filter((edge) => edge.fromNode === id);
    if (hasIncoming || outs.length === 0) continue;
    const consumerLayer = Math.min(...outs.map((edge) => layer.get(edge.toNode)!));
    layer.set(id, Math.max(0, consumerLayer - 1));
  }
  return layer;
}

function orderLayers(
  ids: string[],
  layerOf: Map<string, number>,
  edges: NodeEdge[],
  indexOf: Map<string, number>
): string[][] {
  const maxLayer = Math.max(0, ...ids.map((id) => layerOf.get(id)!));
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);

  // Ordem inicial: DFS pelas portas (Sim antes de Nao), mantendo a ordem do grafo.
  const seen = new Set<string>();
  const sequence: string[] = [];
  const outs = (id: string) =>
    edges
      .filter((edge) => edge.fromNode === id)
      .sort((a, b) => portOrder(a.fromPort) - portOrder(b.fromPort) || indexOf.get(a.toNode)! - indexOf.get(b.toNode)!);
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    // Provedores de dados entram logo antes do consumidor.
    for (const edge of edges.filter((e) => e.toNode === id && layerOf.get(e.fromNode)! < layerOf.get(id)!)) {
      if (!edges.some((e) => e.toNode === edge.fromNode)) walk(edge.fromNode);
    }
    sequence.push(id);
    for (const edge of outs(id)) walk(edge.toNode);
  };
  for (const id of ids) if (!edges.some((edge) => edge.toNode === id)) walk(id);
  for (const id of ids) walk(id);
  for (const id of sequence) layers[layerOf.get(id)!].push(id);

  const position = new Map<string, number>();
  const refresh = () => layers.forEach((layer) => layer.forEach((id, index) => position.set(id, index)));
  refresh();
  const neighbours = (id: string, direction: "up" | "down") =>
    edges
      .filter((edge) => (direction === "down" ? edge.toNode === id : edge.fromNode === id))
      .map((edge) => (direction === "down" ? edge.fromNode : edge.toNode))
      .filter((other) =>
        direction === "down" ? layerOf.get(other)! < layerOf.get(id)! : layerOf.get(other)! > layerOf.get(id)!
      );
  for (let sweep = 0; sweep < 4; sweep += 1) {
    const direction = sweep % 2 === 0 ? "down" : "up";
    const range = direction === "down" ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
    for (const layerIndex of range) {
      const layer = layers[layerIndex];
      const key = new Map(
        layer.map((id) => {
          const adj = neighbours(id, direction);
          const bary = adj.length ? adj.reduce((sum, other) => sum + position.get(other)!, 0) / adj.length : position.get(id)!;
          return [id, bary] as const;
        })
      );
      layer.sort((a, b) => key.get(a)! - key.get(b)! || position.get(a)! - position.get(b)!);
      refresh();
    }
  }
  return layers;
}

/**
 * Organiza o grafo (ou so `scope`) sem tocar em sua semantica. Ver o cabecalho do modulo.
 */
export function layoutNodeGraph(graph: NodeGraph, options: LayoutOptions = {}): LayoutResult {
  const sizeOf = options.sizeOf ?? defaultSize;
  const scope = options.scope ? new Set(options.scope) : null;
  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const size = new Map(graph.nodes.map((node) => [node.id, sizeOf(node)]));
  const movable = graph.nodes.filter((node) => !node.pinned && (!scope || scope.has(node.id))).map((node) => node.id);
  const movableSet = new Set(movable);
  const conflicts: LayoutConflict[] = [];

  const fixedRects = graph.nodes
    .filter((node) => !movableSet.has(node.id))
    .map((node) => ({ id: node.id, rect: { x: node.x, y: node.y, ...size.get(node.id)! } }));

  const pinned = graph.nodes.filter((node) => node.pinned);
  for (let i = 0; i < pinned.length; i += 1) {
    for (let j = i + 1; j < pinned.length; j += 1) {
      const a = pinned[i];
      const b = pinned[j];
      if (rectsOverlap({ x: a.x, y: a.y, ...size.get(a.id)! }, { x: b.x, y: b.y, ...size.get(b.id)! })) {
        conflicts.push({
          kind: "pinned_overlap",
          nodeIds: [a.id, b.id],
          message: `"${a.label}" e "${b.label}" estao fixados um sobre o outro; desafixe um deles para organiza-los.`,
        });
      }
    }
  }

  if (movable.length === 0) {
    return { graph, movedNodeIds: [], conflicts };
  }

  const internalEdges = graph.edges.filter((edge) => movableSet.has(edge.fromNode) && movableSet.has(edge.toNode) && edge.fromNode !== edge.toNode);
  const originX = Math.min(...movable.map((id) => byId.get(id)!.x));
  const originY = Math.min(...movable.map((id) => byId.get(id)!.y));

  const placed = new Map<string, { x: number; y: number }>();
  let cursorY = originY;
  const singletons: string[] = [];
  for (const component of connectedComponents(movable, internalEdges, indexOf)) {
    if (component.nodeIds.length === 1) {
      singletons.push(component.nodeIds[0]);
      continue;
    }
    const ids = component.nodeIds;
    const idSet = new Set(ids);
    const edges = internalEdges.filter((edge) => idSet.has(edge.fromNode));
    const layerOf = assignLayers(ids, edges, indexOf);
    const layers = orderLayers(ids, layerOf, edges, indexOf);

    let columnX = originX;
    let bottom = cursorY;
    const centerY = new Map<string, number>();
    for (const layer of layers) {
      const width = Math.max(...layer.map((id) => size.get(id)!.width), 0);
      let nextFree = cursorY;
      for (const id of layer) {
        const preds = edges.filter((edge) => edge.toNode === id && centerY.has(edge.fromNode)).map((edge) => centerY.get(edge.fromNode)!);
        const height = size.get(id)!.height;
        const desired = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length - height / 2 : nextFree;
        const y = Math.max(nextFree, Math.round(desired));
        placed.set(id, { x: Math.round(columnX), y });
        centerY.set(id, y + height / 2);
        nextFree = y + height + LAYOUT_ROW_GAP;
        bottom = Math.max(bottom, y + height);
      }
      columnX += width + LAYOUT_COLUMN_GAP;
    }
    cursorY = bottom + LAYOUT_COMPONENT_GAP;
  }

  // Nos soltos (sem conexao): grade compacta abaixo dos comportamentos, na ordem do grafo.
  if (singletons.length > 0) {
    const perRow = 4;
    let rowHeight = 0;
    singletons.forEach((id, index) => {
      const column = index % perRow;
      if (column === 0 && index > 0) {
        cursorY += rowHeight + LAYOUT_ROW_GAP;
        rowHeight = 0;
      }
      placed.set(id, { x: originX + column * (NODE_CARD_LAYOUT_WIDTH + LAYOUT_COLUMN_GAP / 2), y: cursorY });
      rowHeight = Math.max(rowHeight, size.get(id)!.height);
    });
  }

  // Resolucao final de colisoes: contra obstaculos fixos e nos ja posicionados.
  const occupied: Array<{ id: string; rect: NodeRect; fixed: boolean }> = fixedRects.map((item) => ({ ...item, fixed: true }));
  const order = [...placed.keys()].sort((a, b) => placed.get(a)!.y - placed.get(b)!.y || placed.get(a)!.x - placed.get(b)!.x);
  for (const id of order) {
    const point = placed.get(id)!;
    const rect: NodeRect = { x: point.x, y: point.y, ...size.get(id)! };
    for (let guard = 0; guard < occupied.length + 1; guard += 1) {
      const hit = occupied.find((other) => rectsOverlap(rect, other.rect, LAYOUT_ROW_GAP / 2));
      if (!hit) break;
      if (hit.fixed) {
        conflicts.push({
          kind: "moved_around_fixed",
          nodeIds: [id, hit.id],
          message: `"${byId.get(id)!.label}" foi deslocado para nao cobrir "${byId.get(hit.id)!.label}" (${byId.get(hit.id)!.pinned ? "fixado" : "fora da selecao"}).`,
        });
      }
      rect.y = hit.rect.y + hit.rect.height + LAYOUT_ROW_GAP;
    }
    placed.set(id, { x: rect.x, y: rect.y });
    occupied.push({ id, rect, fixed: false });
  }

  const movedNodeIds: string[] = [];
  const nodes = graph.nodes.map((node) => {
    const point = placed.get(node.id);
    if (!point || (point.x === node.x && point.y === node.y)) return node;
    movedNodeIds.push(node.id);
    return { ...node, x: point.x, y: point.y };
  });
  return { graph: { ...graph, nodes }, movedNodeIds, conflicts };
}

/**
 * Assinatura semantica: tudo que o compilador e o autor consideram logica (ordem dos
 * nos, ids, tipos, rotulos, parametros, portas e arestas) — exclui somente posicao,
 * fixacao e grupos visuais. Organizar/arrastar/recolher nunca pode muda-la.
 */
export function graphSemanticSignature(graph: NodeGraph): string {
  return JSON.stringify({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      params: Object.keys(node.params)
        .sort()
        .map((key) => [key, node.params[key]]),
      inputs: node.inputs,
      outputs: node.outputs,
    })),
    edges: graph.edges,
  });
}

/** Pares de nos (nao ocultos) cujos cartoes se sobrepoem. */
export function findNodeOverlaps(graph: NodeGraph, sizeOf: NodeSizeLookup = defaultSize, ignore?: Set<string>): Array<[string, string]> {
  const nodes = graph.nodes.filter((node) => !ignore?.has(node.id));
  const rects = nodes.map((node) => ({ id: node.id, rect: { x: node.x, y: node.y, ...sizeOf(node) } }));
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i].rect, rects[j].rect)) pairs.push([rects[i].id, rects[j].id]);
    }
  }
  return pairs;
}

/** Metrica aproximada: cruzamentos entre segmentos retos de saida (direita) a entrada (esquerda). */
export function countEdgeCrossings(graph: NodeGraph, sizeOf: NodeSizeLookup = defaultSize): number {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const segments = graph.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (!from || !to) return [];
    const a = sizeOf(from);
    const b = sizeOf(to);
    return [{ edge, x1: from.x + a.width, y1: from.y + a.height / 2, x2: to.x, y2: to.y + b.height / 2 }];
  });
  const cross = (s: (typeof segments)[number], t: (typeof segments)[number]) => {
    const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d1 = d(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1);
    const d2 = d(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2);
    const d3 = d(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1);
    const d4 = d(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  let count = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const s = segments[i];
      const t = segments[j];
      if (s.edge.fromNode === t.edge.fromNode || s.edge.toNode === t.edge.toNode) continue;
      if (cross(s, t)) count += 1;
    }
  }
  return count;
}

export type Point = { x: number; y: number };

/**
 * Caminho SVG de uma aresta entre duas ancoras de porta (coordenadas de tela). Arestas
 * para tras (ciclos) contornam por baixo dos cartoes (`detourY`) em vez de cruza-los.
 */
export function routeEdgePath(from: Point, to: Point, detourY?: number): string {
  if (to.x >= from.x + 24) {
    const bend = Math.max(32, (to.x - from.x) / 2);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  }
  const lane = detourY ?? Math.max(from.y, to.y) + 48;
  const out = 36;
  return [
    `M ${from.x} ${from.y}`,
    `C ${from.x + out} ${from.y}, ${from.x + out} ${lane}, ${from.x} ${lane}`,
    `L ${to.x} ${lane}`,
    `C ${to.x - out} ${lane}, ${to.x - out} ${to.y}, ${to.x} ${to.y}`,
  ].join(" ");
}
