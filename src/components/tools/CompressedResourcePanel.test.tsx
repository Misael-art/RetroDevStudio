import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressedResourcePanel } from "./CompressedResourcePanel";
import * as service from "../../core/ipc/toolsService";

vi.mock("../../core/ipc/toolsService", () => ({
  rexResourceList: vi.fn(),
  rexResourcePreview: vi.fn(),
  rexResourceApplyEdit: vi.fn(),
  rexResourceContext: vi.fn(),
  rexResourceContextHit: vi.fn(),
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
  codec: "lz4w",
};

/// aPLib verificado na mesma ROM: os números são os da fixture autoral
/// `noisy_runs_16k` (stream de 1 366 B do oráculo sobre 512 tiles).
const SUMMARY_APLIB = {
  header_offset: 0x4000,
  stream_offset: 0x4008,
  num_tiles: 512,
  data_len: 16384,
  stream_len: 1366,
  codec: "aplib",
};

const PREVIEW = {
  outcome: "preview" as const,
  rom_sha256: "aa".repeat(32),
  modified_rom_sha256: null,
  modified_rom_path: null,
  patch_bps_sha256: null,
  patch_bps_path: null,
  stream_offset: 0xc8cc8,
  codec: "lz4w",
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

  /** O aviso só existe quando há queixa: sem `rex-resource-notice` montado, a
   *  resposta vazia é a asserção de que nada foi recusado. */
  function aviso(): string {
    return container.querySelector("[data-testid='rex-resource-notice']")?.textContent ?? "";
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

  /** O índice 0 pertence ao domínio 4bpp: é o índice de paleta que o VDP trata
   *  como transparente, não uma cor editável da paleta. O campo reescrevia 0 em
   *  1 (`setPaintIndex(Number(v) || 1)`), então as pernas 1 e 3 do passo 5 —
   *  pinadas em índice 0 — eram inexpressáveis pela barra. Estas regressões
   *  pinam o domínio 0..15 e a ausência de substituição silenciosa. */
  async function enfileira(tile: string, row: string, col: string, indice: string) {
    await campo("rex-resource-edit-tile", tile);
    await campo("rex-resource-edit-row", row);
    await campo("rex-resource-edit-col", col);
    await campo("rex-resource-paint-index", indice);
    await act(async () => {
      findByTestId(container, "rex-resource-add-edit").click();
      await flush();
    });
  }

  async function aplicarESobFila() {
    mocked.rexResourceApplyEdit.mockResolvedValue({ ...PREVIEW, outcome: "applied" });
    await act(async () => {
      findByTestId(container, "rex-resource-apply").click();
      await flush();
      await flush();
    });
    const chamadas = mocked.rexResourceApplyEdit.mock.calls;
    return chamadas[chamadas.length - 1]?.[2];
  }

  it("digitar índice 0 mantém 0 no campo e a transação recebe índice 0", async () => {
    await painelComRecursoSelecionado();
    await enfileira("0", "1", "2", "0");
    expect(
      (findByTestId(container, "rex-resource-paint-index") as HTMLInputElement).value
    ).toBe("0");
    expect(aviso()).toBe("");
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    expect(await aplicarESobFila()).toEqual([{ tile: 0, row: 1, col: 2, index: 0 }]);
  });

  it("entrada de índice inválida diz o motivo e não entra na fila no lugar de outra cor", async () => {
    await painelComRecursoSelecionado();
    await enfileira("0", "1", "2", "0"); // estado válido já em fila
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    for (const [valor, motivo] of [
      ["", "vazio"],
      ["1.5", "não é um inteiro"],
      ["-1", "fora da paleta"],
      ["16", "fora da paleta"],
    ] as const) {
      await campo("rex-resource-paint-index", valor);
      await act(async () => {
        findByTestId(container, "rex-resource-add-edit").click();
        await flush();
      });
      const texto = aviso();
      expect(texto, `entrada "${valor}"`).toContain(motivo);
      expect(texto).toContain("de 0 a 15");
      expect(texto).toContain("A fila atual foi preservada");
      expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(
        /^1 edição/
      );
      // a edição em fila continua sendo o 0 legítimo, não o que foi digitado
      expect(await aplicarESobFila()).toEqual([{ tile: 0, row: 1, col: 2, index: 0 }]);
      await campo("rex-resource-paint-index", "0");
    }
    // texto não-numérico: um `<input type=number>` devolve "" ao navegador, então
    // o painel tem que recusar por uma das duas razões, nunca pintar uma cor.
    await campo("rex-resource-paint-index", "abc");
    await act(async () => {
      findByTestId(container, "rex-resource-add-edit").click();
      await flush();
    });
    expect(aviso()).toContain("de 0 a 15");
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    // fronteira superior do domínio continua expressável
    await enfileira("1", "0", "0", "15");
    expect(aviso()).toBe("");
    expect(await aplicarESobFila()).toEqual([
      { tile: 0, row: 1, col: 2, index: 0 },
      { tile: 1, row: 0, col: 0, index: 15 },
    ]);
  });

  it("pintura por clique usa o índice do campo, inclusive 0, e recusa campo inválido", async () => {
    await painelComRecursoSelecionado();
    const canvas = findByTestId(container, "rex-resource-canvas") as HTMLImageElement;
    // A prévia natural é 128x32; o painel escala para a caixa do elemento.
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 512,
      height: 128,
      right: 512,
      bottom: 128,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await campo("rex-resource-paint-index", "0");
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 4, clientY: 4 }));
      await flush();
    });
    expect(aviso()).toBe("");
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    // (4,4) na caixa 512x128 == pixel natural (1,1) == tile 0, linha 1, coluna 1
    expect(await aplicarESobFila()).toEqual([{ tile: 0, row: 1, col: 1, index: 0 }]);

    await campo("rex-resource-paint-index", "");
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 })
      );
      await flush();
    });
    expect(aviso()).toContain("vazio");
    // nada foi pintado no lugar: a única edição em fila segue sendo o índice 0
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    expect(await aplicarESobFila()).toEqual([{ tile: 0, row: 1, col: 1, index: 0 }]);
  });

  it("índice 0 sobrevive a desfazer (re-editar o pixel), reabrir o recurso e ao no-op", async () => {
    await painelComRecursoSelecionado();
    await enfileira("0", "1", "2", "0");
    expect(await aplicarESobFila()).toEqual([{ tile: 0, row: 1, col: 2, index: 0 }]);

    // desfazer = reenfileirar o mesmo pixel com o índice original: uma entrada,
    // não duas, e o valor novo é o que vai para a transação.
    await enfileira("0", "1", "2", "5");
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    expect(await aplicarESobFila()).toEqual([{ tile: 0, row: 1, col: 2, index: 5 }]);

    // reabrir o recurso limpa a fila (o núcleo re-verifica a cópia) e o campo
    // volta a aceitar 0 depois disso.
    await enfileira("0", "1", "2", "0");
    const select = findByTestId(container, "rex-resource-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "c8cc8";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(
      /^nenhuma edição/
    );
    await enfileira("3", "7", "7", "0");
    expect(await aplicarESobFila()).toEqual([{ tile: 3, row: 7, col: 7, index: 0 }]);

    // no-op honesto: campo em 0 e fila vazia (reabrir o recurso esvazia a fila)
    // não mandam edição nenhuma para o núcleo.
    await act(async () => {
      select.value = "c8cc8";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
    await campo("rex-resource-paint-index", "0");
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(
      /^nenhuma edição/
    );
    expect(await aplicarESobFila()).toEqual([]);
  });


  /** O painel não escolhe codec por suposição: o rótulo da lista, a contagem do
   *  escopo e o desfecho carregam o codec que o header verificado declarou — uma
   *  ROM mista não pode aparecer como se todos os recursos fossem LZ4W. */
  it("rom mista: lista, escopo e desfecho declaram o codec verificado de cada recurso", async () => {
    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY, SUMMARY_APLIB]]);
    mocked.rexResourcePreview.mockResolvedValue({
      ...PREVIEW,
      stream_offset: 0x4008,
      codec: "aplib",
      original_stream_len: 1366,
    });
    mocked.rexResourceApplyEdit.mockResolvedValue({
      ...PREVIEW,
      stream_offset: 0x4008,
      codec: "aplib",
      outcome: "applied",
      original_stream_len: 1366,
      stream_written: 1364,
      verified_preserved: 2,
      modified_rom_sha256: "dd".repeat(32),
      modified_rom_path: "/edits/rex-aplib-modified-dd.bin",
      patch_bps_sha256: "ee".repeat(32),
      patch_bps_path: "/edits/rex-aplib-patch-ee.bps",
    });
    await act(async () => {
      root.render(<CompressedResourcePanel />);
      await flush();
    });
    const input = findByTestId(container, "rex-resource-rom-input") as HTMLInputElement;
    await act(async () => {
      typeValue(input, "/roms/mista.bin");
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-resource-verify").click();
      await flush();
      await flush();
    });
    const labels = [
      ...findByTestId(container, "rex-resource-select").querySelectorAll("option"),
    ].map((o) => o.textContent ?? "");
    expect(labels.find((t) => t.includes("0xc8cc8"))).toContain("lz4w");
    const etiquetaAplib = labels.find((t) => t.includes("0x4008"));
    expect(etiquetaAplib).toContain("aplib");
    // O regex do E2E continua válido para os dois codecs: o slot é lido do rótulo.
    expect(etiquetaAplib).toMatch(/stream (\d+) B/);
    expect(findByTestId(container, "rex-resource-scope").textContent).toContain(
      "(LZ4W 1, aPLib 1)"
    );

    const select = findByTestId(container, "rex-resource-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "4008";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
    expect(mocked.rexResourcePreview).toHaveBeenCalledWith("/roms/mista.bin", 0x4008);
    await act(async () => {
      findByTestId(container, "rex-resource-apply").click();
      await flush();
      await flush();
    });
    const resultText = findByTestId(container, "rex-resource-result").textContent ?? "";
    expect(resultText).toContain("codec aplib");
    expect(resultText).toContain("rex-aplib-patch-ee.bps");
  });

  /** Contexto + transação: a seleção feita na camada composta tem que chegar à
   *  fila canônica pelo PIXEL DE FONTE que o núcleo resolveu, com o SHA que a
   *  lista verificou. É isto que torna a edição contextual utilizável em vez de
   *  um relatório ao lado do editor. */
  const CONTEXTO_PEQUENO = {
    rom_sha256: "aa".repeat(32),
    rom_len: 393216,
    escopo: "escopo do tronco",
    limite_trabalho: { max_pixels_por_camada: 2048 * 2048 },
    imagens: [
      {
        struct_offset: 0x25780,
        proveniencia: "verificada" as const,
        conferido: ["os três ponteiros do struct `Image` foram seguidos"],
        nao_prova: ["uma estrutura válida não prova que o jogo carregue ou exiba o recurso"],
        paleta: {
          header_offset: 0x2cbc8,
          stream_offset: 0x2cbd0,
          codec: "none",
          plain_len: 128,
          stream_len: 128,
          plain_sha256: "33".repeat(32),
        },
        tileset: {
          header_offset: 0x25788,
          stream_offset: 0xc8cc8,
          codec: "aplib",
          plain_len: 288,
          stream_len: 144,
          plain_sha256: "11".repeat(32),
        },
        tilemap: {
          header_offset: 0x25790,
          stream_offset: 0x2579a,
          codec: "aplib",
          plain_len: 8,
          stream_len: 6,
          plain_sha256: "44".repeat(32),
        },
        mapa: {
          cols: 2,
          rows: 2,
          largura_px: 16,
          altura_px: 16,
          celulas: [
            { indice: 0, col: 0, row: 0, tile: 1, hflip: false, vflip: false, banco: 0, prioridade: false },
            { indice: 1, col: 1, row: 0, tile: 0, hflip: false, vflip: false, banco: 0, prioridade: false },
            { indice: 2, col: 0, row: 1, tile: 0, hflip: false, vflip: false, banco: 0, prioridade: false },
            { indice: 3, col: 1, row: 1, tile: 1, hflip: true, vflip: false, banco: 0, prioridade: false },
          ],
          ocorrencias_por_tile: [
            { tile: 0, celulas: [1, 2] },
            { tile: 1, celulas: [0, 3] },
          ],
          tiles_sem_uso: [],
          escopo: "ocorrências contadas só dentro deste mapa verificado (4 células)",
        },
        camada: {
          largura_px: 16,
          altura_px: 16,
          pixels_sha256: "55".repeat(32),
          png_data_url: "data:image/png;base64,BBB",
          recusada: null,
        },
      },
    ],
    sem_vinculo: [],
    recusados: [],
  };

  const CLIQUE_PEQUENO = {
    rom_sha256: "aa".repeat(32),
    struct_offset: 0x25780,
    x: 15,
    y: 15,
    celula: { indice: 3, col: 1, row: 1, tile: 1, hflip: true, vflip: false, banco: 0, prioridade: false },
    fonte: { tile: 1, linha: 5, coluna: 6, indice: 11 },
    ocorrencias: [
      { indice: 0, col: 0, row: 0, tile: 1, hflip: false, vflip: false, banco: 0, prioridade: false },
      { indice: 3, col: 1, row: 1, tile: 1, hflip: true, vflip: false, banco: 0, prioridade: false },
    ],
  };

  async function painelComContextoCarregado(rom = "/roms/mista.bin") {
    mocked.rexResourceList.mockResolvedValue(["aa".repeat(32), [SUMMARY, SUMMARY_APLIB]]);
    mocked.rexResourcePreview.mockResolvedValue(PREVIEW);
    mocked.rexResourceContext.mockResolvedValue(CONTEXTO_PEQUENO);
    await act(async () => {
      root.render(<CompressedResourcePanel />);
      await flush();
    });
    const input = findByTestId(container, "rex-resource-rom-input") as HTMLInputElement;
    await act(async () => {
      typeValue(input, rom);
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
      findByTestId(container, "rex-context-load").click();
      await flush();
      await flush();
    });
  }

  it("seleção na camada composta entra na fila canônica pelo pixel de fonte", async () => {
    await painelComContextoCarregado();
    expect(mocked.rexResourceContext).toHaveBeenCalledWith("/roms/mista.bin");
    const camada = findByTestId(container, "rex-context-layer") as HTMLImageElement;
    camada.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 32,
      height: 32,
      right: 32,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await campo("rex-resource-paint-index", "3");
    mocked.rexResourceContextHit.mockResolvedValue(CLIQUE_PEQUENO);
    await act(async () => {
      camada.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 31, clientY: 31 }));
      await flush();
      await flush();
    });
    // (31,31) num retângulo 32x32 de uma camada 16x16 == pixel natural (15,15).
    expect(mocked.rexResourceContextHit).toHaveBeenCalledWith("/roms/mista.bin", 0x25780, 15, 15);
    expect(findByTestId(container, "rex-context-occurrences").textContent).toContain(
      "2 ocorrências neste mapa verificado"
    );

    await act(async () => {
      findByTestId(container, "rex-context-queue-edit").click();
      await flush();
    });
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(/^1 edição/);
    expect(await aplicarESobFila()).toEqual([{ tile: 1, row: 5, col: 6, index: 3 }]);
  });

  it("recurso selecionado que não é o TileSet da imagem não deixa editar em silêncio", async () => {
    await painelComContextoCarregado("/roms/mista.bin");
    const select = findByTestId(container, "rex-resource-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "4008";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });
    const camada = findByTestId(container, "rex-context-layer") as HTMLImageElement;
    camada.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 16,
      height: 16,
      right: 16,
      bottom: 16,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    mocked.rexResourceContextHit.mockResolvedValue(CLIQUE_PEQUENO);
    await act(async () => {
      camada.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 15, clientY: 15 }));
      await flush();
      await flush();
    });
    await act(async () => {
      findByTestId(container, "rex-context-queue-edit").click();
      await flush();
    });
    expect(findByTestId(container, "rex-resource-edit-count").textContent).toMatch(
      /^nenhuma edição/
    );
    expect(mocked.rexResourceApplyEdit).not.toHaveBeenCalled();
    expect(findByTestId(container, "rex-context-notice").textContent).toContain("0xc8cc8");
  });
});
