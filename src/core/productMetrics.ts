import type { ShellPersona } from "./surfaceRegistry";

/**
 * Metricas locais de produto (fatia 1 v2 do estudo de UI).
 *
 * 100% locais: persistidas em localStorage, sem rede e sem telemetria externa.
 * Servem para (a) medir as metricas-norte do estudo (ex.: tempo ate a primeira
 * ROM) e (b) alimentar os gatilhos objetivos de transicao de persona.
 * `optOut = true` interrompe qualquer registro novo.
 */
export type ProductMetricEvent =
  | { kind: "session_start" }
  | { kind: "build_ok" }
  | { kind: "build_failed" }
  | { kind: "budget_block" }
  | { kind: "rom_loaded" }
  | { kind: "diagnostics_opened" }
  | { kind: "workspace_visit"; workspace: string };

export interface ProductMetricsSnapshot {
  version: 1;
  optOut: boolean;
  firstSessionAt: string | null;
  firstBuildOkAt: string | null;
  buildsOk: number;
  buildsFailed: number;
  budgetBlocks: number;
  romsLoaded: number;
  diagnosticsOpened: number;
  workspaceVisits: Record<string, number>;
}

const STORAGE_KEY = "retrodev-product-metrics::v1";

type MetricsStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): MetricsStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function createEmptyProductMetrics(): ProductMetricsSnapshot {
  return {
    version: 1,
    optOut: false,
    firstSessionAt: null,
    firstBuildOkAt: null,
    buildsOk: 0,
    buildsFailed: 0,
    budgetBlocks: 0,
    romsLoaded: 0,
    diagnosticsOpened: 0,
    workspaceVisits: {},
  };
}

export function getProductMetricsSnapshot(
  storage: MetricsStorage | null = defaultStorage()
): ProductMetricsSnapshot {
  const empty = createEmptyProductMetrics();
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) {
      return empty;
    }
    const parsed = JSON.parse(raw) as Partial<ProductMetricsSnapshot>;
    if (parsed.version !== 1) {
      return empty;
    }
    return {
      ...empty,
      ...parsed,
      workspaceVisits:
        parsed.workspaceVisits && typeof parsed.workspaceVisits === "object"
          ? { ...parsed.workspaceVisits }
          : {},
    };
  } catch {
    return empty;
  }
}

function persistSnapshot(snapshot: ProductMetricsSnapshot, storage: MetricsStorage | null): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage indisponivel: metricas desta sessao sao perdidas silenciosamente
  }
}

export function recordProductMetric(
  event: ProductMetricEvent,
  storage: MetricsStorage | null = defaultStorage(),
  now: Date = new Date()
): ProductMetricsSnapshot {
  const snapshot = getProductMetricsSnapshot(storage);
  if (snapshot.optOut) {
    return snapshot;
  }

  const timestamp = now.toISOString();
  switch (event.kind) {
    case "session_start":
      if (!snapshot.firstSessionAt) {
        snapshot.firstSessionAt = timestamp;
      }
      break;
    case "build_ok":
      snapshot.buildsOk += 1;
      if (!snapshot.firstBuildOkAt) {
        snapshot.firstBuildOkAt = timestamp;
      }
      break;
    case "build_failed":
      snapshot.buildsFailed += 1;
      break;
    case "budget_block":
      snapshot.budgetBlocks += 1;
      break;
    case "rom_loaded":
      snapshot.romsLoaded += 1;
      break;
    case "diagnostics_opened":
      snapshot.diagnosticsOpened += 1;
      break;
    case "workspace_visit":
      snapshot.workspaceVisits[event.workspace] =
        (snapshot.workspaceVisits[event.workspace] ?? 0) + 1;
      break;
  }

  persistSnapshot(snapshot, storage);
  return snapshot;
}

export function setProductMetricsOptOut(
  optOut: boolean,
  storage: MetricsStorage | null = defaultStorage()
): ProductMetricsSnapshot {
  const snapshot = getProductMetricsSnapshot(storage);
  snapshot.optOut = optOut;
  persistSnapshot(snapshot, storage);
  return snapshot;
}

/** Metrica-norte: tempo entre a primeira sessao e a primeira ROM buildada com sucesso. */
export function getTimeToFirstRomMs(snapshot: ProductMetricsSnapshot): number | null {
  if (!snapshot.firstSessionAt || !snapshot.firstBuildOkAt) {
    return null;
  }
  const delta =
    new Date(snapshot.firstBuildOkAt).getTime() - new Date(snapshot.firstSessionAt).getTime();
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}

/**
 * Gatilhos objetivos de transicao de persona (estudo de UI, secao 2.3).
 * Sempre sugestao, nunca troca automatica; o chamador decide como exibir.
 * `pro -> hacker` ainda nao tem gatilho instrumentado (depende de superficies
 * de reversa gated que nao existem no rail) e retorna null por design.
 */
export function getPersonaSuggestion(
  snapshot: ProductMetricsSnapshot,
  persona: ShellPersona
): ShellPersona | null {
  if (snapshot.optOut) {
    return null;
  }
  if (persona === "guiado" && snapshot.buildsOk >= 1) {
    return "criador";
  }
  if (persona === "criador" && (snapshot.budgetBlocks >= 5 || snapshot.diagnosticsOpened >= 3)) {
    return "pro";
  }
  return null;
}
