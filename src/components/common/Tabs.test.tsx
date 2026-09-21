import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tabs from "./Tabs";

describe("Tabs", () => {
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
  });

  it("expõe seleção semântica e move foco com as setas", () => {
    const onTabChange = vi.fn();

    act(() => {
      root.render(
        <Tabs
          ariaLabel="Painel direito"
          tabs={[
            { id: "inspector", label: "Insp", ariaLabel: "Inspector" },
            { id: "tools", label: "Tools", ariaLabel: "Ferramentas" },
          ]}
          activeTab="inspector"
          onTabChange={onTabChange}
        />
      );
    });

    const tablist = container.querySelector("[role='tablist']");
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']"));

    expect(tablist?.getAttribute("aria-label")).toBe("Painel direito");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.tabIndex).toBe(0);
    expect(tabs[1]?.getAttribute("aria-label")).toBe("Ferramentas");

    tabs[0]?.focus();
    act(() => {
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(onTabChange).toHaveBeenCalledWith("tools");
    expect(document.activeElement).toBe(tabs[1]);
  });
});
