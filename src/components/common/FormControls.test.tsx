import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Input from "./Input";
import Select from "./Select";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("shared form controls", () => {
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

  it("connects the input label, helper and validation message", () => {
    act(() => {
      root.render(
        <Input
          id="project-name"
          label="Nome do projeto"
          helperText="Use um nome curto."
          errorMessage="Nome já utilizado."
          required
          leadingIcon={<svg data-testid="project-icon" />}
        />
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    const label = container.querySelector("label") as HTMLLabelElement;
    expect(label.htmlFor).toBe("project-name");
    expect(label.textContent).toContain("Nome do projeto");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      "project-name-helper project-name-error"
    );
    expect(container.querySelector("#project-name-error")?.textContent).toBe("Nome já utilizado.");
    expect(container.querySelector("[data-testid='project-icon']")?.parentElement?.getAttribute("aria-hidden"))
      .toBe("true");
  });

  it("supports an externally supplied accessible name without a visible label", () => {
    act(() => {
      root.render(<Input aria-label="Buscar assets" hideLabel />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Buscar assets");
    expect(container.querySelector("label")).toBeNull();
  });

  it("connects select metadata and emits native changes", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <Select
          id="target-platform"
          label="Plataforma"
          helperText="Define a toolchain do projeto."
          onChange={onChange}
          defaultValue="md"
        >
          <option value="md">Mega Drive</option>
          <option value="snes">SNES</option>
        </Select>
      );
    });

    const select = container.querySelector("select") as HTMLSelectElement;
    expect((container.querySelector("label") as HTMLLabelElement).htmlFor).toBe("target-platform");
    expect(select.getAttribute("aria-describedby")).toBe("target-platform-helper");
    expect(select.value).toBe("md");

    act(() => {
      select.value = "snes";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(select.value).toBe("snes");
  });

  it("marks an invalid select and keeps the target keyboard-focusable", () => {
    act(() => {
      root.render(
        <Select label="Core" errorMessage="Selecione um core.">
          <option value="">Selecione</option>
        </Select>
      );
    });

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    act(() => select.focus());
    expect(document.activeElement).toBe(select);
  });
});
