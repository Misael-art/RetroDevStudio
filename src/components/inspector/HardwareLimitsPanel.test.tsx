import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import HardwareLimitsPanel from "./HardwareLimitsPanel";
import { useEditorStore } from "../../core/store/editorStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("HardwareLimitsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useEditorStore.setState({
      activeTarget: "snes",
      hwStatus: null,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      sceneRevision: 0,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("uses SNES hardware budgets while live validation is idle", async () => {
    await act(async () => {
      root.render(<HardwareLimitsPanel />);
      await flush();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Sprites / tela0 / 128");
    expect(text).toContain("Sprites / scanline0 / 32");
    expect(text).toContain("DMA / frame0.0 KB / 8 KB");
    expect(text).toContain("Palette Banks0 / 8");
    expect(text).toContain("BG Layers0 / 4");
  });
});
