import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Group, Panel } from "react-resizable-panels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LayoutSplitter from "./LayoutSplitter";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function key(element: Element, value: string, shiftKey = false) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value, shiftKey }));
  });
}

describe("LayoutSplitter", () => {
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

  it("emits exact keyboard resize intents for a horizontal layout", () => {
    const onResizeIntent = vi.fn();
    act(() => {
      root.render(
        <Group orientation="horizontal">
          <Panel id="left" />
          <LayoutSplitter id="main-splitter" onResizeIntent={onResizeIntent} />
          <Panel id="right" />
        </Group>
      );
    });

    const splitter = container.querySelector('[role="separator"]');
    expect(splitter).not.toBeNull();
    expect(splitter?.getAttribute("aria-label")).toBe(
      "Redimensionar painéis à esquerda e à direita"
    );
    expect((splitter as HTMLElement).style.flexBasis).toBe("8px");

    key(splitter!, "ArrowLeft");
    key(splitter!, "ArrowRight", true);
    key(splitter!, "Home");
    key(splitter!, "End");
    key(splitter!, "Enter");

    expect(onResizeIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "step", delta: -8 },
      { type: "step", delta: 32 },
      { type: "minimum" },
      { type: "maximum" },
      { type: "auto" },
    ]);
  });

  it("uses vertical arrows and double click for a stacked layout", () => {
    const onResizeIntent = vi.fn();
    act(() => {
      root.render(
        <Group orientation="vertical">
          <Panel id="top" />
          <LayoutSplitter
            id="stacked-splitter"
            orientation="vertical"
            onResizeIntent={onResizeIntent}
          />
          <Panel id="bottom" />
        </Group>
      );
    });

    const splitter = container.querySelector('[role="separator"]')!;
    key(splitter, "ArrowLeft");
    key(splitter, "ArrowUp");
    key(splitter, "ArrowDown", true);
    act(() => {
      splitter.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(onResizeIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "step", delta: -8 },
      { type: "step", delta: 32 },
      { type: "auto" },
    ]);
  });
});
