import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RexImageContextPanel } from "./RexImageContextPanel";
import * as service from "../../core/ipc/toolsService";

vi.mock("../../core/ipc/toolsService", () => ({
  rexResourceContext: vi.fn(),
  rexResourceContextHit: vi.fn(),
}));

const mocked = vi.mocked(service);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/// SHA-256 da fixture autoral `rex-context-fixture` (rom.bin, 393 216 B).
const SHA = "705b72eb848fadf11cdefd4302ef8c6751d005bd1c762918aea3b0860b20da86";
const SHA_OUTRA = "aa".repeat(32);

const COLS = 15;
const ROWS = 9;

/** As quatro ocorrências do tile 2, com os quatro pares de flip — as mesmas
 *  posições da perna (7) do aceite do núcleo na fixture. */
const OCORRENCIAS = [
  { indice: 5, hflip: true, vflip: false },
  { indice: 35, hflip: true, vflip: true },
  { indice: 80, hflip: false, vflip: true },
  { indice: 134, hflip: false, vflip: false },
];

function celula(indice: number, tile: number, hflip = false, vflip = false) {
  return {
    indice,
    col: indice % COLS,
    row: Math.floor(indice / COLS),
    tile,
    hflip,
    vflip,
    banco: 1,
    prioridade: false,
  };
}

function identidade(header: number, stream: number, codec: string, plain: number) {
  return {
    header_offset: header,
    stream_offset: stream,
    codec,
    plain_len: plain,
    stream_len: 1366,
    plain_sha256: "11".repeat(32),
  };
}

function contextoCom(camada: Record<string, unknown>) {
  return {
    rom_sha256: SHA,
    rom_len: 393216,
    escopo: "escopo verificado pelo tronco de recursos",
    limite_trabalho: { max_pixels_por_camada: 2048 * 2048 },
    imagens: [
      {
        struct_offset: 0x25780,
        proveniencia: "verificada",
        conferido: [
          "os três ponteiros do struct `Image` foram seguidos",
          "TileSet 0xc8cc8 decodifica para 512 B como o header declara",
        ],
        nao_prova: [
          "uma estrutura válida não prova que o jogo carregue ou exiba o recurso",
          "a prévia é a camada reconstruída, não o framebuffer completo",
        ],
        paleta: identidade(0x2cbc8, 0x2cbd0, "none", 128),
        tileset: identidade(0x25788, 0xc8cc8, "aplib", 512),
        tilemap: identidade(0x25790, 0x2579a, "aplib", 270),
        mapa: {
          cols: COLS,
          rows: ROWS,
          largura_px: COLS * 8,
          altura_px: ROWS * 8,
          celulas: Array.from({ length: COLS * ROWS }, (_, i) => {
            const oc = OCORRENCIAS.find((o) => o.indice === i);
            return celula(i, oc ? 2 : 7, oc?.hflip ?? false, oc?.vflip ?? false);
          }),
          ocorrencias_por_tile: [
            { tile: 2, celulas: OCORRENCIAS.map((o) => o.indice) },
            { tile: 7, celulas: [] },
          ],
          tiles_sem_uso: [0, 1],
          escopo:
            "ocorrências contadas só dentro deste mapa verificado (TileMap em 0x2579a, 135 " +
            "células); outros mapas da ROM não entram nesta contagem",
        },
        camada: {
          largura_px: COLS * 8,
          altura_px: ROWS * 8,
          ...camada,
        },
      },
    ],
    sem_vinculo: [
      {
        tipo: "tileset",
        proveniencia: "desconhecida",
        motivo: "verificado por decode, mas nenhum ponteiro `Image` o alcança nesta ROM",
        identidade: identidade(0x30000, 0x30008, "aplib", 512),
      },
    ],
    recusados: [
      {
        struct_offset: 0x40000,
        proveniencia: "desconhecida",
        codigo: "invalid_reference",
        motivo: "o ponteiro do TileMap não decodifica para o tamanho declarado",
      },
    ],
  };
}

const CAMADA_OK = {
  pixels_sha256: "22".repeat(32),
  png_data_url: "data:image/png;base64,AAA",
  recusada: null,
};
const CONTEXTO = contextoCom(CAMADA_OK);

/** O pixel clicado de uma ocorrência: canto inferior direito da célula, para
 *  que a coordenada local não coincida com um borda ambígua. */
function pixelDaCelula(indice: number) {
  return { x: (indice % COLS) * 8 + 7, y: Math.floor(indice / COLS) * 8 + 7 };
}

function clique(indice: number, overrides: Record<string, unknown> = {}) {
  const oc = OCORRENCIAS.find((o) => o.indice === indice) ?? { indice, hflip: false, vflip: false };
  const { x, y } = pixelDaCelula(oc.indice);
  return {
    rom_sha256: SHA,
    struct_offset: 0x25780,
    x,
    y,
    celula: celula(oc.indice, 2, oc.hflip, oc.vflip),
    fonte: { tile: 2, linha: 4, coluna: 7, indice: 11 },
    ocorrencias: OCORRENCIAS.map((o) => celula(o.indice, 2, o.hflip, o.vflip)),
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let container: HTMLDivElement;
let root: Root;
let onQueuePaint: ReturnType<typeof vi.fn<(pixel: { tile: number; row: number; col: number }) => void>>;
const log = vi.fn();

function q(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid='${testId}']`);
}

function qa(testId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(`[data-testid='${testId}']`));
}

function exigir(testId: string): HTMLElement {
  const element = q(testId);
  if (!element) throw new Error(`elemento ausente: ${testId}`);
  return element;
}

function click(el: HTMLElement, clientX = 0, clientY = 0): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
}

/** jsdom não faz layout: o retângulo é o que o navegador devolveria depois de
 *  zoom inteiro, `max-width` e escala de página. */
function escala(el: HTMLElement, width: number, height: number, left = 0, top = 0): void {
  el.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
}

async function montar(props: Partial<React.ComponentProps<typeof RexImageContextPanel>> = {}) {
  await act(async () => {
    root.render(
      <RexImageContextPanel
        romPath="/roms/fixture.bin"
        romSha={SHA}
        tilesetSelecionado={0xc8cc8}
        sheetPreview={{
          data_url: "data:image/png;base64,SSS",
          largura_px: 128,
          altura_px: 32,
        }}
        onQueuePaint={onQueuePaint}
        logMessage={log}
        {...props}
      />
    );
    await flush();
  });
}

async function carregarContexto(resposta: unknown = CONTEXTO) {
  mocked.rexResourceContext.mockResolvedValueOnce(resposta as never);
  await act(async () => {
    click(exigir("rex-context-load"));
    await flush();
    await flush();
  });
}

async function clicarCamada(indice: number, resposta: unknown) {
  const camada = exigir("rex-context-layer");
  escala(camada, 120, 72);
  mocked.rexResourceContextHit.mockResolvedValueOnce(resposta as never);
  const { x, y } = pixelDaCelula(indice);
  await act(async () => {
    click(camada, x, y);
    await flush();
    await flush();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onQueuePaint = vi.fn<(pixel: { tile: number; row: number; col: number }) => void>();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
});

describe("RexImageContextPanel", () => {
  it("carrega o contexto e compõe a camada com zoom inteiro e pixels nítidos", async () => {
    await montar();
    await carregarContexto();

    expect(mocked.rexResourceContext).toHaveBeenCalledWith("/roms/fixture.bin");
    const camada = exigir("rex-context-layer") as HTMLImageElement;
    // 120x72 naturais a 1x: o elemento tem o tamanho exato da camada.
    expect(camada.style.width).toBe("120px");
    expect(camada.style.height).toBe("72px");
    expect(camada.style.imageRendering).toBe("pixelated");
    expect(camada.getAttribute("src")).toBe("data:image/png;base64,AAA");

    const zoom = exigir("rex-context-zoom") as HTMLSelectElement;
    expect([...zoom.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "1x",
      "2x",
      "3x",
      "4x",
      "6x",
      "8x",
    ]);
    await act(async () => {
      zoom.value = "3";
      zoom.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });
    expect(camada.style.width).toBe("360px");
    expect(camada.style.height).toBe("216px");
    // Geometria lida do núcleo, não pressuposta pela UI.
    expect(exigir("rex-context-geometry").textContent).toContain("120x72 px");
    expect(exigir("rex-context-geometry").textContent).toContain("15x9 células");
  });

  it("preserva o zoom pedido quando o painel é mais estreito que a camada", async () => {
    await montar();
    await carregarContexto();
    const camada = exigir("rex-context-layer") as HTMLImageElement;
    const envolucro = camada.parentElement as HTMLElement;
    const trilho = envolucro.parentElement as HTMLElement;
    // O preflight do Tailwind impõe `img { max-width: 100% }` e item de flex
    // encolhe por padrão: sem as travas abaixo o <img> achata só a largura, o
    // pixel deixa de ser quadrado e o zoom declarado não é o desenhado. No
    // WebView real o E2E mede o getBoundingClientRect; aqui se pinha o contrato
    // de CSS que produz aquele resultado.
    expect(camada.style.maxWidth).toBe("none");
    expect(envolucro.className).toContain("shrink-0");
    expect(trilho.className).toContain("overflow-x-auto");
  });

  it("diz o que foi conferido e o que a verificação não prova", async () => {
    await montar();
    await carregarContexto();
    const texto = exigir("rex-context-provenance").textContent ?? "";
    expect(texto).toContain("verificada");
    expect(texto).toContain("os três ponteiros do struct `Image` foram seguidos");
    expect(texto).toContain("não prova que o jogo carregue ou exiba o recurso");
    expect(texto).toContain("camada reconstruída, não o framebuffer completo");
  });

  it("clique: a UI só converte ponteiro em pixel e o núcleo resolve célula, flips e fonte", async () => {
    await montar();
    await carregarContexto();
    const camada = exigir("rex-context-layer");
    escala(camada, 240, 144); // zoom 2x
    mocked.rexResourceContextHit.mockResolvedValueOnce(clique(35) as never);
    await act(async () => {
      // (94,46) em 2x == pixel natural (47,23) == célula (5,2), local (7,7).
      click(camada, 94, 46);
      await flush();
      await flush();
    });
    expect(mocked.rexResourceContextHit).toHaveBeenCalledWith("/roms/fixture.bin", 0x25780, 47, 23);

    const texto = exigir("rex-context-hit").textContent ?? "";
    expect(texto).toContain("célula (5, 2)");
    expect(texto).toContain("tile 2");
    expect(texto).toContain("flips H e V");
    expect(texto).toContain("banco 1");
    expect(texto).toContain("local na célula (7, 7)");
    expect(texto).toContain("tile de origem 2, linha 4, coluna 7");
    expect(texto).toContain("índice atual 11");

    // A célula selecionada e as quatro ocorrências ficam destacadas na camada.
    const destaque = exigir("rex-context-cell-highlight");
    expect(destaque.style.left).toBe("40px");
    expect(destaque.style.top).toBe("16px");
    expect(destaque.style.width).toBe("8px");
    expect(destaque.style.height).toBe("8px");
    expect(qa("rex-context-occurrence").map((e) => e.style.left)).toEqual([
      "40px",
      "40px",
      "40px",
      "112px",
    ]);
    expect(qa("rex-context-occurrence").map((e) => e.style.top)).toEqual([
      "0px",
      "16px",
      "40px",
      "64px",
    ]);
    expect(exigir("rex-context-occurrences").textContent).toContain(
      "4 ocorrências neste mapa verificado"
    );
    expect(exigir("rex-context-occurrences").textContent).toContain(
      "outros mapas da ROM não entram nesta contagem"
    );

    // O tile de origem fica destacado no sheet do TileSet, na grade de 16 tiles.
    const tile = exigir("rex-context-tile-highlight");
    expect(tile.style.left).toBe("16px");
    expect(tile.style.top).toBe("0px");
  });

  it("borda, zoom e escala da página: o pixel enviado é sempre o natural da camada", async () => {
    await montar();
    await carregarContexto();
    const camada = exigir("rex-context-layer");

    // Página escalada: 120 naturais renderizados em 300 px.
    escala(camada, 300, 180);
    mocked.rexResourceContextHit.mockResolvedValue(clique(5) as never);
    await act(async () => {
      click(camada, 299.9, 179.9);
      await flush();
      await flush();
    });
    expect(mocked.rexResourceContextHit).toHaveBeenLastCalledWith(
      "/roms/fixture.bin",
      0x25780,
      119,
      71
    );

    // Camada deslocada na página (painel rolado / margem): só a distância importa.
    escala(camada, 120, 72, 40, 25);
    await act(async () => {
      click(camada, 40, 25);
      await flush();
      await flush();
    });
    expect(mocked.rexResourceContextHit).toHaveBeenLastCalledWith("/roms/fixture.bin", 0x25780, 0, 0);

    // Fora da imagem: nada vai ao núcleo e o motivo é dito.
    await act(async () => {
      click(camada, 39, 25);
      await flush();
    });
    expect(mocked.rexResourceContextHit).toHaveBeenCalledTimes(2);
    expect(exigir("rex-context-notice").textContent).toContain("fora da camada");
  });

  it("clique com recusa do núcleo mostra o erro estruturado e não cria seleção", async () => {
    await montar();
    await carregarContexto();
    const camada = exigir("rex-context-layer");
    escala(camada, 120, 72);
    mocked.rexResourceContextHit.mockRejectedValueOnce(
      "invalid_reference: 0x25780 não é um vínculo verificado nesta ROM" as never
    );
    await act(async () => {
      click(camada, 4, 4);
      await flush();
      await flush();
    });
    expect(exigir("rex-context-error").textContent).toContain("invalid_reference");
    expect(q("rex-context-hit")).toBeNull();
  });

  it("identidade trocada: resposta com outro SHA não vira seleção", async () => {
    await montar();
    await carregarContexto();
    await clicarCamada(35, clique(35, { rom_sha256: SHA_OUTRA }));
    expect(exigir("rex-context-error").textContent).toContain("identidade");
    expect(q("rex-context-hit")).toBeNull();
    expect(qa("rex-context-occurrence")).toHaveLength(0);
  });

  it("contexto obsoleto: uma resposta antiga não substitui o contexto novo", async () => {
    await montar();
    const antigo = contextoCom({ ...CAMADA_OK, largura_px: 16, altura_px: 16 });
    let liberarAntigo: (v: unknown) => void = () => {};
    mocked.rexResourceContext
      .mockImplementationOnce(() => new Promise((resolve) => (liberarAntigo = resolve)) as never)
      .mockImplementationOnce(() => Promise.resolve(CONTEXTO) as never);

    await act(async () => {
      click(exigir("rex-context-load"));
      await flush();
    });
    await act(async () => {
      click(exigir("rex-context-load"));
      await flush();
      await flush();
    });
    expect((exigir("rex-context-layer") as HTMLImageElement).style.width).toBe("120px");
    // O pedido antigo responde por último: não pode voltar a ser a tela.
    await act(async () => {
      liberarAntigo(antigo);
      await flush();
      await flush();
    });
    expect((exigir("rex-context-layer") as HTMLImageElement).style.width).toBe("120px");
  });

  it("clique obsoleto: uma resolução antiga não substitui a seleção nova", async () => {
    await montar();
    await carregarContexto();
    const camada = exigir("rex-context-layer");
    escala(camada, 120, 72);

    let liberarAntigo: (v: unknown) => void = () => {};
    mocked.rexResourceContextHit
      .mockImplementationOnce(() => new Promise((resolve) => (liberarAntigo = resolve)) as never)
      .mockImplementationOnce(() => Promise.resolve(clique(134)) as never);

    await act(async () => {
      // célula (5,2) — resposta lenta
      click(camada, 47, 23);
      await flush();
    });
    await act(async () => {
      // célula (14,8) — responde primeiro
      click(camada, 119, 71);
      await flush();
      await flush();
    });
    expect(exigir("rex-context-hit").textContent).toContain("célula (14, 8)");
    await act(async () => {
      liberarAntigo(clique(35));
      await flush();
      await flush();
    });
    expect(exigir("rex-context-hit").textContent).toContain("célula (14, 8)");
  });

  it("camada acima do orçamento: a recusa aparece e as células continuam publicadas", async () => {
    await montar();
    await carregarContexto(
      contextoCom({
        pixels_sha256: "22".repeat(32),
        png_data_url: null,
        recusada:
          "camada de 4096x4096 = 16777216 pixels acima do orçamento de 4194304 pixels por camada",
      })
    );
    expect(exigir("rex-context-layer-refused").textContent).toContain("acima do orçamento");
    expect(q("rex-context-layer")).toBeNull();
    // Identidade e mapa seguem publicados: a recusa é só da prévia.
    expect(exigir("rex-context-provenance").textContent).toContain("TileSet 0xc8cc8");
    expect(exigir("rex-context-image-select").textContent).toContain("0x25780");
  });

  it("recursos sem vínculo e vínculos recusados são listados, não sumidos", async () => {
    await montar();
    await carregarContexto();
    const semVinculo = exigir("rex-context-unlinked").textContent ?? "";
    expect(semVinculo).toContain("tileset 0x30008");
    expect(semVinculo).toContain("nenhum ponteiro `Image` o alcança");
    const recusados = exigir("rex-context-refused-links").textContent ?? "";
    expect(recusados).toContain("0x40000");
    expect(recusados).toContain("invalid_reference");
  });

  it("nenhuma imagem verificada: o painel diz isso em vez de mostrar camada vazia", async () => {
    await montar();
    await carregarContexto({ ...CONTEXTO, imagens: [] });
    expect(exigir("rex-context-empty").textContent).toContain("nenhuma imagem");
    expect(q("rex-context-layer")).toBeNull();
  });

  it("editar pelo pipeline canônico: a edição entra pelo pixel de origem e declara o impacto", async () => {
    await montar();
    await carregarContexto();
    await clicarCamada(35, clique(35));
    expect(exigir("rex-context-impact").textContent).toContain("muda as 4 ocorrências deste mapa");
    expect(exigir("rex-context-impact").textContent).toContain(
      "nenhuma ocorrência isolada é editável"
    );
    await act(async () => {
      click(exigir("rex-context-queue-edit"));
      await flush();
    });
    expect(onQueuePaint).toHaveBeenCalledWith({ tile: 2, row: 4, col: 7 });
  });

  it("sem o TileSet da imagem selecionado, a edição é recusada e nada entra na fila", async () => {
    await montar({ tilesetSelecionado: 0x99999 });
    await carregarContexto();
    await clicarCamada(35, clique(35));
    await act(async () => {
      click(exigir("rex-context-queue-edit"));
      await flush();
    });
    expect(onQueuePaint).not.toHaveBeenCalled();
    expect(exigir("rex-context-notice").textContent).toContain("0xc8cc8");
    expect(exigir("rex-context-notice").textContent).toContain("selecione");
  });

  it("identidade revalidada no uso: contexto de outra ROM não entra na fila", async () => {
    await montar();
    await carregarContexto();
    await clicarCamada(35, clique(35));
    // A lista de recursos verificou outra ROM depois que o contexto foi montado.
    await montar({ romSha: SHA_OUTRA });
    await act(async () => {
      click(exigir("rex-context-queue-edit"));
      await flush();
    });
    expect(onQueuePaint).not.toHaveBeenCalled();
    expect(exigir("rex-context-error").textContent).toContain("identidade");
  });

  it("trocar de ROM descarta contexto, seleção e pedidos exibidos", async () => {
    await montar();
    await carregarContexto();
    await clicarCamada(35, clique(35));
    expect(q("rex-context-hit")).toBeTruthy();

    await montar({ romPath: "/roms/outra.bin", romSha: SHA_OUTRA });
    // A camada da ROM anterior não pode continuar na tela sob o novo caminho:
    // ela descreve bytes que já não são os da ROM em edição.
    expect(q("rex-context-layer")).toBeNull();
    expect(q("rex-context-hit")).toBeNull();
    expect(q("rex-context-image-select")).toBeNull();
    expect(q("rex-context-cell-highlight")).toBeNull();
  });

  it("selecionar outra imagem revalida: a seleção anterior desaparece", async () => {
    await montar();
    await carregarContexto({
      ...CONTEXTO,
      imagens: [...CONTEXTO.imagens, { ...CONTEXTO.imagens[0], struct_offset: 0x26000 }],
    });
    await clicarCamada(35, clique(35));
    expect(q("rex-context-hit")).toBeTruthy();

    const select = exigir("rex-context-image-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "0x26000";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });
    expect(q("rex-context-hit")).toBeNull();
    expect(qa("rex-context-occurrence")).toHaveLength(0);
  });

  it("ROM trocada durante um pedido em voo: o contexto da ROM antiga é descartado", async () => {
    await montar();
    let liberar: (v: unknown) => void = () => {};
    mocked.rexResourceContext.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = resolve)) as never
    );
    await act(async () => {
      click(exigir("rex-context-load"));
      await flush();
    });
    await montar({ romPath: "/roms/outra.bin", romSha: SHA_OUTRA });
    await act(async () => {
      liberar(CONTEXTO);
      await flush();
      await flush();
    });
    expect(q("rex-context-layer")).toBeNull();
  });

  it("sha ainda não verificado não bloqueia o contexto, mas divergência sim", async () => {
    await montar({ romSha: "", tilesetSelecionado: null });
    await carregarContexto();
    expect(q("rex-context-layer")).toBeTruthy();

    await montar({ romSha: SHA_OUTRA, tilesetSelecionado: null });
    await carregarContexto();
    expect(exigir("rex-context-error").textContent).toContain("identidade");
    expect(q("rex-context-layer")).toBeNull();
  });
});
