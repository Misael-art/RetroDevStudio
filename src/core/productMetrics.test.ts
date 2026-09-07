import { describe, expect, it } from "vitest";
import {
  createEmptyProductMetrics,
  getPersonaSuggestion,
  getProductMetricsSnapshot,
  getTimeToFirstRomMs,
  recordProductMetric,
  setProductMetricsOptOut,
} from "./productMetrics";

function createMemoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("productMetrics", () => {
  it("starts empty and tolerates corrupted storage", () => {
    const storage = createMemoryStorage();
    expect(getProductMetricsSnapshot(storage)).toEqual(createEmptyProductMetrics());

    storage.setItem("retrodev-product-metrics::v1", "{corrompido");
    expect(getProductMetricsSnapshot(storage)).toEqual(createEmptyProductMetrics());
  });

  it("records counters and first timestamps", () => {
    const storage = createMemoryStorage();
    recordProductMetric({ kind: "session_start" }, storage, new Date("2026-07-06T10:00:00Z"));
    recordProductMetric({ kind: "session_start" }, storage, new Date("2026-07-06T11:00:00Z"));
    recordProductMetric({ kind: "build_failed" }, storage);
    recordProductMetric({ kind: "build_ok" }, storage, new Date("2026-07-06T10:12:00Z"));
    recordProductMetric({ kind: "build_ok" }, storage, new Date("2026-07-06T10:30:00Z"));
    recordProductMetric({ kind: "budget_block" }, storage);
    recordProductMetric({ kind: "rom_loaded" }, storage);
    recordProductMetric({ kind: "diagnostics_opened" }, storage);
    recordProductMetric({ kind: "workspace_visit", workspace: "scene" }, storage);
    recordProductMetric({ kind: "workspace_visit", workspace: "scene" }, storage);
    recordProductMetric({ kind: "workspace_visit", workspace: "logic" }, storage);

    const snapshot = getProductMetricsSnapshot(storage);
    expect(snapshot.firstSessionAt).toBe("2026-07-06T10:00:00.000Z");
    expect(snapshot.firstBuildOkAt).toBe("2026-07-06T10:12:00.000Z");
    expect(snapshot.buildsOk).toBe(2);
    expect(snapshot.buildsFailed).toBe(1);
    expect(snapshot.budgetBlocks).toBe(1);
    expect(snapshot.romsLoaded).toBe(1);
    expect(snapshot.diagnosticsOpened).toBe(1);
    expect(snapshot.workspaceVisits).toEqual({ scene: 2, logic: 1 });
  });

  it("computes time to first ROM from first session", () => {
    const storage = createMemoryStorage();
    recordProductMetric({ kind: "session_start" }, storage, new Date("2026-07-06T10:00:00Z"));
    recordProductMetric({ kind: "build_ok" }, storage, new Date("2026-07-06T10:12:00Z"));
    expect(getTimeToFirstRomMs(getProductMetricsSnapshot(storage))).toBe(12 * 60 * 1000);
    expect(getTimeToFirstRomMs(createEmptyProductMetrics())).toBeNull();
  });

  it("stops recording after opt-out", () => {
    const storage = createMemoryStorage();
    recordProductMetric({ kind: "build_ok" }, storage);
    setProductMetricsOptOut(true, storage);
    recordProductMetric({ kind: "build_ok" }, storage);

    const snapshot = getProductMetricsSnapshot(storage);
    expect(snapshot.optOut).toBe(true);
    expect(snapshot.buildsOk).toBe(1);
    expect(getPersonaSuggestion(snapshot, "guiado")).toBeNull();
  });

  it("suggests persona transitions per objective triggers, never automatic", () => {
    const empty = createEmptyProductMetrics();
    expect(getPersonaSuggestion(empty, "guiado")).toBeNull();

    const firstBuild = { ...empty, buildsOk: 1 };
    expect(getPersonaSuggestion(firstBuild, "guiado")).toBe("criador");
    expect(getPersonaSuggestion(firstBuild, "criador")).toBeNull();
    expect(getPersonaSuggestion(firstBuild, "pro")).toBeNull();

    const budgetHeavy = { ...empty, budgetBlocks: 5 };
    expect(getPersonaSuggestion(budgetHeavy, "criador")).toBe("pro");

    const diagnosticsHeavy = { ...empty, diagnosticsOpened: 3 };
    expect(getPersonaSuggestion(diagnosticsHeavy, "criador")).toBe("pro");

    // pro -> hacker: sem gatilho instrumentado ate existir superficie de reversa gated
    const everything = { ...empty, buildsOk: 10, budgetBlocks: 10, diagnosticsOpened: 10 };
    expect(getPersonaSuggestion(everything, "pro")).toBeNull();
    expect(getPersonaSuggestion(everything, "hacker")).toBeNull();
  });
});
