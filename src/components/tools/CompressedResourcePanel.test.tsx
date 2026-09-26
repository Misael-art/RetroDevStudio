import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressedResourcePanel } from "./CompressedResourcePanel";
import * as service from "../../core/ipc/toolsService";

vi.mock("../../core/ipc/toolsService", () => ({
  rexResourceList: vi.fn(),
  rexResourcePreview: vi.fn(),
  rexResourceApplyEdit: vi.fn(),
}));

const mocked = vi.mocked(service);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SUMMARY = {
  header_offset: 0x25788,
  stream_offset: 0xc8cc8,
  num_tiles: 9,
  data_len: 288,
  stream_len: 144,
};

const PREVIEW = {
  outcome: "preview" as const,
  rom_sha256: "aa".repeat(32),
  modified_rom_sha256: null,
  modified_rom_path: null,
  patch_bps_sha256: null,
  patch_bps_path: null,
  stream_offset: 0xc8cc8,
  stream_written: null,
  original_stream_len: 144,
  verified_preserved: null,
  analyzed_scope: "escopo sintético",
  preview_png_sha256: "bb".repeat(32),
  preview_pixels_sha256: "cc".repeat(32),
  preview_width: 128,
  preview_height: 32,
  preview_data_url: "data:image/png;base64,AAA",
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function typeValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function findByTestId(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid='${testId}']`);
  if (!element) throw new Error(`elemento ausente: ${testId}`);
  return element as HTMLElement;
}

describe("CompressedResourcePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("verifica recursos e mostra escopo e sha", async () => {
    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY]]);
    await act(async () => {
      root.render(<CompressedResourcePanel />);
      await flush();
    });
    const input = findByTestId(container, "rex-resource-rom-input") as HTMLInputElement;
    await act(async () => {
      typeValue(input, "/roms/hamoopig.bin");
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-resource-verify").click();
      await flush();
      await flush();
    });
    expect(mocked.rexResourceList).toHaveBeenCalledWith("/roms/hamoopig.bin");
    expect(findByTestId(container, "rex-resource-rom-sha").textContent).toContain(
      "aaaaaaaaaaaaaaaa"
    );
  });

  it("prévia e aplicação expõem proveniência e desfecho", async () => {
    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY]]);
    mocked.rexResourcePreview.mockResolvedValue(PREVIEW);
    mocked.rexResourceApplyEdit.mockResolvedValue({
      ...PREVIEW,
      outcome: "applied",
      modified_rom_sha256: "dd".repeat(32),
      modified_rom_path: "/tmp/modified.bin",
      patch_bps_sha256: "ee".repeat(32),
      patch_bps_path: "/tmp/patch.bps",
      verified_preserved: 159,
      stream_written: 140,
    });
    await act(async () => {
      root.render(<CompressedResourcePanel />);
      await flush();
    });
    const input = findByTestId(container, "rex-resource-rom-input") as HTMLInputElement;
    await act(async () => {
      typeValue(input, "/roms/hamoopig.bin");
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-resource-verify").click();
      await flush();
      await flush();
    });
    const select = findByTestId(container, "rex-resource-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "c8cc8";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
    expect(mocked.rexResourcePreview).toHaveBeenCalledWith("/roms/hamoopig.bin", 0xc8cc8);
    expect(findByTestId(container, "rex-resource-canvas")).toBeTruthy();
    await act(async () => {
      findByTestId(container, "rex-resource-apply").click();
      await flush();
      await flush();
    });
    expect(mocked.rexResourceApplyEdit).toHaveBeenCalledWith(
      "/roms/hamoopig.bin",
      0xc8cc8,
      [],
      "aa".repeat(32)
    );
    const resultText = findByTestId(container, "rex-resource-result").textContent ?? "";
    expect(resultText).toContain("applied");
    expect(resultText).toContain("/tmp/patch.bps");
    expect(resultText).toContain("preservados 159");
  });

  it("erros da transação aparecem no painel", async () => {    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY]]);
    mocked.rexResourcePreview.mockResolvedValue(PREVIEW);
    mocked.rexResourceApplyEdit.mockRejectedValue("dependent_modified: transação recusada");
    await act(async () => {
      root.render(<CompressedResourcePanel />);
      await flush();
    });
    const input = findByTestId(container, "rex-resource-rom-input") as HTMLInputElement;
    await act(async () => {
      typeValue(input, "/roms/hamoopig.bin");
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-resource-verify").click();
      await flush();
      await flush();
    });
    const select = findByTestId(container, "rex-resource-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "c8cc8";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-resource-apply").click();
      await flush();
      await flush();
    });
    expect(findByTestId(container, "rex-resource-error").textContent).toContain(
      "dependent_modified"
    );
  });

  /** Deixou de existir um caminho silencioso: a pré-condição de uma edição
   *  inválida é dita em voz alta, a fila já válida permanece intacta, e a
   *  transação continua sendo a guarda final (o painel só filtra o que já sabe
   *  que o núcleo recusa). */
  async function painelComRecursoSelecionado(
    log?: (level: "info" | "warn" | "error" | "success", message: string) => void
  ) {
    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY]]);
    mocked.rexResourcePreview.mockResolvedValue(PREVIEW);
    await act(async () => {
      root.render(<CompressedResourcePanel logMessage={log} />);
      await flush();
    });
    const input = findByTestId(container, "rex-resource-rom-input") as HTMLInputElement;
    await act(async () => {
      typeValue(input, "/roms/hamoopig.bin");
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-resource-verify").click();
      await flush();
      await flush();
    });
    const select = findByTestId(container, "rex-resource-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "c8cc8";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
  }

  async function campo(testId: string, value: string) {
    const element = findByTestId(container, testId) as HTMLInputElement;
    await act(async () => {
      typeValue(element, value);
      await flush();
    });
  }

  it("tile fora do recurso: avisa, preserva a fila válida e não envia o inválido", async () => {
    const log = vi.fn();
    await painelComRecursoSelecionado(log);
    await campo("rex-resource-edit-tile", "0");
    await campo("rex-resource-edit-row", "1");
    await campo("rex-resource-edit-col", "2");
    await act(async () => {
      findByTestId(container, "rex-resource-add-edit").click();
      await flush();
    });
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);

    await campo("rex-resource-edit-tile", "9"); // o recurso tem 9 tiles: 0..8
    await act(async () => {
      findByTestId(container, "rex-resource-add-edit").click();
      await flush();
    });
    const aviso = findByTestId(container, "rex-resource-notice").textContent ?? "";
    expect(aviso).toContain("tile 9");
    expect(aviso).toContain("são 9 tile(s), numerados de 0 a 8");
    expect(aviso).toContain("A fila atual foi preservada");
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("tile 9 fora do recurso")
    );
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);

    mocked.rexResourceApplyEdit.mockResolvedValue({ ...PREVIEW, outcome: "applied" });
    await act(async () => {
      findByTestId(container, "rex-resource-apply").click();
      await flush();
      await flush();
    });
    expect(mocked.rexResourceApplyEdit.mock.calls[0][2]).toEqual([
      { tile: 0, row: 1, col: 2, index: 1 },
    ]);
  });

  it("linha, coluna e índice inválidos: cada um tem mensagem própria", async () => {
    await painelComRecursoSelecionado();
    for (const [testId, valor, trecho] of [
      ["rex-resource-edit-row", "8", "linha 8"],
      ["rex-resource-edit-col", "8", "coluna 8"],
      ["rex-resource-paint-index", "16", "índice 16"],
    ] as const) {
      // Estado base válido; só o campo sob teste é inválido (senão a primeira
      // queixa encontrada encobre a que se quer medir).
      await campo("rex-resource-edit-tile", "0");
      await campo("rex-resource-edit-row", "1");
      await campo("rex-resource-edit-col", "2");
      await campo("rex-resource-paint-index", "1");
      await campo(testId, valor);
      await act(async () => {
        findByTestId(container, "rex-resource-add-edit").click();
        await flush();
      });
      const aviso = findByTestId(container, "rex-resource-notice").textContent ?? "";
      expect(aviso).toContain(trecho);
      expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(
        /^nenhuma edição/
      );
    }
    expect(mocked.rexResourceApplyEdit).not.toHaveBeenCalled();
  });
});
