import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetQualityReport, CapabilityAxisReport } from "../../core/projectCapability";
import AssetQualityPanel from "./AssetQualityPanel";

let container: HTMLDivElement;
let root: Root;

function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(element);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function axis(): CapabilityAxisReport {
  return {
    status: "blocked",
    maturity: "experimental",
    evidence_refs: [],
    blocking_statuses: ["palette_overflow"],
    warnings: ["duplicate tiles"],
    next_actions: ["Reduzir paleta."],
    experimental: true,
    source: "assets",
    owner: "ArtStudio",
    diagnostics: [],
  };
}

describe("AssetQualityPanel", () => {
  it("renders compact Qualidade ROM summary and expands technical details", () => {
    const report: AssetQualityReport = {
      project_dir: "F:/Project",
      axis: axis(),
      assets: [
        {
          path: "assets/sprites/hero.png",
          source_art: "F:/Project/assets/sprites/hero.png",
          lineage: ["source_art", "project_asset"],
          palette: { status: "overflow", detail: "24 cores unicas" },
          palette_color_count: 24,
          index_zero_transparency: { status: "incorrect", detail: "Transparencia detectada" },
          tile_efficiency: { status: "warning", detail: "3 / 6" },
          duplicate_tiles: { total_tiles: 6, unique_tiles: 3, duplicate_count: 3 },
          res_compression: { status: "mapped", detail: "resources.res" },
          source_to_rom_map: ["res/resources.res"],
          warnings: ["duplicate tiles"],
          blockers: ["palette_overflow"],
          next_actions: ["Reduzir paleta."],
        },
      ],
    };

    render(<AssetQualityPanel assetPath="assets/sprites/hero.png" report={report} />);

    expect(container.querySelector('[data-testid="asset-quality-panel"]')?.textContent).toContain("Qualidade ROM");
    expect(container.textContent).toContain("overflow");
    act(() => {
      (Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Ver detalhes")
      ) as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="asset-quality-details"]')?.textContent).toContain("resources.res");
  });
});
