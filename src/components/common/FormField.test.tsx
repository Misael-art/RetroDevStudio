import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FormField, { Field } from "./FormField";

describe("FormField", () => {
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

  it("programmatically associates its label and generated safe id", () => {
    act(() => {
      root.render(
        <FormField label="Nome do projeto">
          <input />
        </FormField>
      );
    });

    const label = container.querySelector("label");
    const input = container.querySelector("input");

    expect(input?.id).toMatch(/^rds-field-[a-zA-Z0-9_-]+$/);
    expect(label?.htmlFor).toBe(input?.id);
  });

  it("connects description and error while preserving existing references", () => {
    act(() => {
      root.render(
        <FormField
          id="runtime-path"
          label="Caminho do runtime"
          description="Selecione a instalação oficial."
          error="O diretório não foi encontrado."
          required
        >
          <input aria-describedby="external-help" />
        </FormField>
      );
    });

    const input = container.querySelector("input");
    const describedBy = input?.getAttribute("aria-describedby")?.split(" ");

    expect(describedBy).toEqual([
      "external-help",
      "runtime-path-description",
      "runtime-path-error",
    ]);
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-required")).toBe("true");
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "O diretório não foi encontrado."
    );
  });

  it("preserves an id and aria state already defined by the control", () => {
    act(() => {
      root.render(
        <Field label="Plataforma">
          <select id="platform" aria-invalid="false">
            <option>Mega Drive</option>
          </select>
        </Field>
      );
    });

    const select = container.querySelector("select");
    expect(select?.id).toBe("platform");
    expect(select?.getAttribute("aria-invalid")).toBe("false");
    expect(container.querySelector("label")?.htmlFor).toBe("platform");
  });
});
