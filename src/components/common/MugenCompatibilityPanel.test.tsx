import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../core/ipc/toolsService", () => ({
  readProjectAssetBytes: vi.fn(() => Promise.reject(new Error("sem atlas no teste"))),
  listProjectAssets: vi.fn(() => Promise.resolve([])),
}));

import { MugenCompatibilityPanel } from "./MugenCompatibilityPanel";
import {
  lossItems,
  parseMugenReport,
  reportIdFromPath,
  summarizeLosses,
  type LoadedMugenReport,
  type MugenImportReport,
} from "../../core/mugenCompatibility";

// Mesmo formato gravado pelo importador (retrodev.mugen_import_report/v1, bloco summary).
const report: MugenImportReport = {
  schema: "retrodev.mugen_import_report/v1",
  profile: "mugen.character.v1",
  maturity: "Experimental",
  summary: {
    totals: { direct: 5, approximate: 1, manual: 1, unsupported: 2 },
    manual_bridges: 2,
    categories: [
      {
        id: "sprites", label: "Sprites e paleta", status: "approximate", note: "",
        counts: { direct: 3, approximate: 1, manual: 0, unsupported: 0 },
        items: [
          { item: "palette", fidelity: "approximate", reason: "mais de 15 cores VDP", consequence: "2 px trocados de cor", source: "s.sff@0x200" },
        ],
      },
      {
        id: "states", label: "Estados e comportamento", status: "unsupported", note: "",
        counts: { direct: 2, approximate: 0, manual: 0, unsupported: 2 },
        items: [
          { item: "controller:-1#Taunt", fidelity: "unsupported", reason: "gatilho fora do perfil", consequence: "a mudanca de estado nao acontece no jogo convertido", source: "s.cmd" },
        ],
      },
      {
        id: "collisions", label: "Colisoes", status: "manual", note: "",
        counts: { direct: 0, approximate: 0, manual: 1, unsupported: 0 },
        items: [
          { item: "collision", fidelity: "manual", reason: "sem logica", consequence: "golpes nao acertam sozinhos", source: "s.air" },
        ],
      },
      {
        id: "stage", label: "Cenario (stage)", status: "absent", note: "pacote de personagem: cenario nao faz parte desta importacao",
        counts: { direct: 0, approximate: 0, manual: 0, unsupported: 0 }, items: [],
      },
    ],
  },
  diagnostics: [
    { code: "plan.palette.over_budget", severity: "warning", source: "s.sff", message: "16 cores", action: "Reduza a paleta" },
  ],
  metrics: [
    { name: "hardware_sprites_per_frame", unit: "sprites VDP", value: null, origin: "A_static_estimate", window: "por frame", availability: "indisponivel: definido pelo rescomp", budget: 16, over_budget: null },
  ],
};

const loaded: LoadedMugenReport = {
  id: "sentinel",
  reportPath: "assets/mugen/sentinel_import_report.json",
  atlasPath: "assets/sprites/mugen_sentinel_atlas.png",
  report,
  rawJson: JSON.stringify(report),
};

describe("mugenCompatibility", () => {
  it("parses report ids and refuses reports without schema", () => {
    expect(reportIdFromPath("assets/mugen/probe_import_report.json")).toBe("probe");
    expect(reportIdFromPath("assets/mugen/../x_import_report.json")).toBeNull();
    expect(() => parseMugenReport("{}")).toThrow();
  });

  it("summarizes every loss class and orders losses by severity", () => {
    expect(summarizeLosses(report)).toBe(
      "5 funcionam igual, 1 com diferenca, 1 precisam de ajuste seu, 2 nao convertidos (2 pontes manuais no grafo)"
    );
    expect(lossItems(report).map((item) => item.fidelity)).toEqual(["unsupported", "manual", "approximate"]);
  });
});

describe("MugenCompatibilityPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  it("separates the four classes, keeps absent categories honest and exposes the raw report", async () => {
    await act(async () => {
      root.render(<MugenCompatibilityPanel open projectDir="/p" reports={[loaded]} onClose={() => {}} />);
    });
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    expect(q("mugen-compat-panel")).not.toBeNull();
    expect(q("mugen-compat-total-direct")?.getAttribute("data-count")).toBe("5");
    expect(q("mugen-compat-total-unsupported")?.textContent).toContain("Nao foi convertido: 2");
    expect(q("mugen-compat-category-stage")?.getAttribute("data-status")).toBe("absent");
    expect(q("mugen-compat-category-stage")?.textContent).toContain("Nao existe neste pacote");
    expect(q("mugen-compat-category-stage")?.textContent).toContain("cenario nao faz parte");
    expect(q("mugen-compat-category-collisions")?.textContent).toContain("Precisa de ajuste seu");
    const taunt = q("mugen-compat-loss-controller:-1#Taunt");
    expect(taunt?.textContent).toContain("a mudanca de estado nao acontece no jogo convertido");
    expect(taunt?.textContent).toContain("gatilho fora do perfil");
    expect(q("mugen-compat-diagnostics")?.textContent).toContain("Acao: Reduza a paleta");
    const metric = q("mugen-compat-metric-hardware_sprites_per_frame");
    expect(metric?.textContent).toContain("-");
    expect(metric?.textContent).not.toMatch(/\b0 sprites/);
    expect(q("mugen-compat-raw")?.textContent).toBe(JSON.stringify(report));
  });

  it("closes through the visible button", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<MugenCompatibilityPanel open projectDir="/p" reports={[loaded]} onClose={onClose} />);
    });
    await act(async () => {
      (document.querySelector('[data-testid="mugen-compat-close"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
