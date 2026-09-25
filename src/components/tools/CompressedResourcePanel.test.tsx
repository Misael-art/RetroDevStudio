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

  it("erros da transação aparecem no painel", async () => {
    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY]]);
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
});
