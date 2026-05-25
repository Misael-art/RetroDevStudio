import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SgdkPatternTemplate } from "../../core/projectCapability";
import SgdkPatternTemplateGallery from "./SgdkPatternTemplateGallery";

let container: HTMLDivElement;
let root: Root;

function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const TEMPLATE: SgdkPatternTemplate = {
  id: "line_scroll",
  title: "Line Scroll",
  origin: "SGDK sample",
  technical_description: "Atualiza scroll por linha.",
  requirements: ["HSCROLL_LINE"],
  risks: ["CPU"],
  targets_supported: ["megadrive"],
  nodes_generated: [{ node_type: "effect_parallax", label: "Line scroll", params: { mode: "line_scroll" } }],
  hardware_warnings: ["H-Int compete com raster."],
  maturity: "experimental",
  experimental: true,
};

describe("SgdkPatternTemplateGallery", () => {
  it("renders experimental SGDK template gallery and inserts selected template", () => {
    const onInsertTemplate = vi.fn();
    render(<SgdkPatternTemplateGallery templates={[TEMPLATE]} onInsertTemplate={onInsertTemplate} />);

    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-testid="sgdk-pattern-template-gallery"]')?.textContent).toContain("SGDK Patterns");
    expect(container.textContent).toContain("Experimental");
    act(() => {
      (container.querySelector('[data-testid="sgdk-pattern-line_scroll"]') as HTMLButtonElement).click();
    });
    expect(onInsertTemplate).toHaveBeenCalledWith(TEMPLATE);
  });
});
