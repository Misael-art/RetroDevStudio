import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ReverseWorkspace from "./ReverseWorkspace";
import { useEditorStore } from "../../core/store/editorStore";
import { GRAFO_REAL, LIMITACIONES, respostaRecuperar } from "../../test/fixtures/rexGameplay";
import { construirRegraRecuperada, type RegraRecuperada } from "../../core/nodegraph/rexGameplayScene";
import type { Entity, Scene } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  reverseExplorerRead: vi.fn(),
  romAnalyzeWithEmulatorTrace: vi.fn(),
  romDisassemble: vi.fn(),
  romSaveAnnotations: vi.fn(),
  rexGameplayRecover: vi.fn(),
  rexGameplayScan: vi.fn(),
  persistActiveScene: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("../../core/ipc/toolsService", () => ({
  reverseExplorerRead: mocks.reverseExplorerRead,
  romAnalyzeWithEmulatorTrace: mocks.romAnalyzeWithEmulatorTrace,
  romDisassemble: mocks.romDisassemble,
  romSaveAnnotations: mocks.romSaveAnnotations,
  rexGameplayRecover: mocks.rexGameplayRecover,
  rexGameplayScan: mocks.rexGameplayScan,
  rexGameplayEditThreshold: vi.fn(),
  rexGameplayRebuild: vi.fn(),
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function findButton(container: HTMLElement, matcher: string | RegExp): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((element) => {
    const text = element.textContent?.trim() ?? "";
    return typeof matcher === "string" ? text === matcher : matcher.test(text);
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${String(matcher)}`);
  }

  return button;
}

function createReverseManifest(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    error: "",
    target: "megadrive",
    source_path: "F:/roms/test.md",
    detected_format: "md",
    stripped_header_bytes: 0,
    total_size: 4096,
    hashes: { crc32: "deadbeef", sha1: "0123456789abcdef0123456789abcdef01234567" },
    header: {
      console_name: "SEGA GENESIS",
      internal_title: "RETRO TEST",
      region: "U",
      version: "01",
      publisher: null,
      entry_point: 512,
    },
    mapper: "linear_rom",
    special_chips: [],
    segments: [
      {
        start: 0,
        end: 512,
        kind: "header",
        label: "Header",
        bank_index: null,
        confidence: 100,
      },
    ],
    graphics_regions: [
      {
        id: "gfx_000",
        start: 512,
        end: 768,
        kind: "tileset",
        bpp: 4,
        tile_width: 8,
        tile_height: 8,
        tile_count: 8,
        palette_slot: 0,
        confidence: 80,
        note: "ok",
      },
    ],
    text_regions: [],
    audio_regions: [],
    code_regions: [
      {
        start: 512,
        end: 520,
        architecture: "68000",
        entry_points: [512],
        functions: [
          { address: 512, end: 520, name: "sub_000200", executed: false, confidence: 80 },
        ],
        xrefs: [{ from: 512, to: 768, kind: "call", label: "call @ 000200" }],
        disassembly: [],
      },
    ],
    pointer_tables: [],
    compression_regions: [],
    call_graph: [{ from: 512, to: 768, kind: "call" }],
    logic_hints: [],
    annotations: [],
    trace: {
      available: false,
      executed_regions: [],
      note: "Trace dinamico indisponivel para esta ROM nesta sessao.",
    },
    projection_status: {
      supported: false,
      status: "analysis_only",
      message: "future",
    },
    ...overrides,
  };
}

describe("ReverseWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();

    useEditorStore.setState({
      activeTarget: "megadrive",
      consoleEntries: [],
      consoleVisible: true,
    });

    mocks.reverseExplorerRead.mockResolvedValue({
      ok: true,
      error: "",
      total_size: 0,
      rows: [],
    });
    mocks.romAnalyzeWithEmulatorTrace.mockResolvedValue(createReverseManifest());
    mocks.romDisassemble.mockResolvedValue({
      ok: true,
      error: "",
      total_size: 4096,
      rows: [{ offset: 512, bytes: [0x4e, 0x71], size: 2, text: "nop", kind: "nop", target: null }],
    });
    mocks.romSaveAnnotations.mockResolvedValue(1);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<ReverseWorkspace />);
      await flush();
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("analyzes a ROM and persists annotations", async () => {
    const romInput = Array.from(container.querySelectorAll("input")).find((element) =>
      element.getAttribute("placeholder")?.includes("/roms/game.md")
    );
    expect(romInput).toBeTruthy();

    await act(async () => {
      if (romInput instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(romInput, "F:/roms/test.md");
        romInput.dispatchEvent(new Event("input", { bubbles: true }));
        romInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Analisar ROM").click();
      await flush();
      await flush();
    });

    expect(mocks.romAnalyzeWithEmulatorTrace).toHaveBeenCalledWith("F:/roms/test.md");
    expect(container.textContent).toContain("linear_rom");
    expect(container.textContent).toContain("RETRO TEST");
    expect(
      container.querySelector("[data-testid='reverse-trace-status-card']")?.textContent
    ).toContain("Trace dinamico indisponivel para esta ROM nesta sessao.");
    expect(
      container.querySelector("[data-testid='reverse-operational-plan']")?.textContent
    ).toContain("ROM Map, Hex, Code e heuristicas de Graphics/Text/Audio.");

    await act(async () => {
      findButton(container, "Code").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("call @ 000200");
    expect(container.textContent).toContain("000200 → 000300");

    const labelInput = Array.from(container.querySelectorAll("input")).find((element) =>
      element.getAttribute("placeholder")?.includes("spawn_player")
    );
    const commentInput = container.querySelector("textarea");

    await act(async () => {
      if (labelInput instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(labelInput, "entrypoint_label");
        labelInput.dispatchEvent(new Event("input", { bubbles: true }));
        labelInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (commentInput instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        setter?.call(commentInput, "Primeira anotacao");
        commentInput.dispatchEvent(new Event("input", { bubbles: true }));
        commentInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Salvar anotacao").click();
      await flush();
      await flush();
    });

    expect(mocks.romSaveAnnotations).toHaveBeenCalledWith("F:/roms/test.md", [
      {
        kind: "label",
        start: 512,
        end: null,
        label: "entrypoint_label",
        comment: "Primeira anotacao",
      },
    ]);
    expect(container.textContent).toContain("entrypoint_label");
    expect(
      container.querySelector("[data-testid='reverse-operational-plan']")?.textContent
    ).toContain("1 anotacao(oes) salva(s) para esta ROM.");
  });

  it("prioritizes trace-touched code navigation when trace is available", async () => {
    mocks.romAnalyzeWithEmulatorTrace.mockResolvedValueOnce(
      createReverseManifest({
        source_path: "F:/roms/trace.md",
        hashes: {
          crc32: "feedbeef",
          sha1: "89abcdef0123456789abcdef0123456789abcdef",
        },
        header: {
          console_name: "SEGA GENESIS",
          internal_title: "TRACE TEST",
          region: "U",
          version: "01",
          publisher: null,
          entry_point: 512,
        },
        code_regions: [
          {
            start: 512,
            end: 1536,
            architecture: "68000",
            entry_points: [512],
            functions: [
              { address: 512, end: 520, name: "sub_000200", executed: false, confidence: 80 },
              { address: 768, end: 784, name: "sub_000300", executed: true, confidence: 92 },
            ],
            xrefs: [
              { from: 512, to: 1536, kind: "jump", label: "jump @ 000200" },
              { from: 768, to: 1024, kind: "call", label: "call @ 000300" },
            ],
            disassembly: [],
          },
        ],
        call_graph: [
          { from: 512, to: 1536, kind: "jump" },
          { from: 768, to: 1024, kind: "call" },
        ],
        trace: {
          available: true,
          executed_regions: [
            {
              start: 768,
              end: 1024,
              kind: "code",
              label: "Executed",
              bank_index: null,
              confidence: 100,
            },
          ],
          note: "Overlay dinamico aplicado a partir da sessao atual do emulador.",
        },
      })
    );

    const romInput = Array.from(container.querySelectorAll("input")).find((element) =>
      element.getAttribute("placeholder")?.includes("/roms/game.md")
    );

    await act(async () => {
      if (romInput instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(romInput, "F:/roms/trace.md");
        romInput.dispatchEvent(new Event("input", { bubbles: true }));
        romInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Analisar ROM").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Code").click();
      await flush();
      await flush();
    });

    const summary = container.querySelector("[data-testid='reverse-code-trace-summary']");
    expect(summary?.textContent).toContain("Sessao com trace aplicada");
    expect(summary?.textContent).toContain("Funcoes executadas: 1");
    expect(summary?.textContent).toContain("Xrefs tocadas: 1");
    expect(summary?.textContent).toContain("Arestas tocadas: 1");

    const functionCards = Array.from(
      container.querySelectorAll("[data-testid='reverse-code-function']")
    );
    expect(functionCards[0]?.textContent).toContain("sub_000300");
    expect(functionCards[0]?.textContent).toContain("Executada");

    const xrefCards = Array.from(container.querySelectorAll("[data-testid='reverse-code-xref']"));
    expect(xrefCards[0]?.textContent).toContain("call @ 000300");
    expect(xrefCards[0]?.textContent).toContain("Trace");
    expect(xrefCards[1]?.textContent).toContain("jump @ 000200");

    const edgeCards = Array.from(container.querySelectorAll("[data-testid='reverse-code-edge']"));
    expect(edgeCards[0]?.textContent).toContain("000300 → 000400");
    expect(edgeCards[0]?.textContent).toContain("Trace");
    expect(edgeCards[1]?.textContent).toContain("000200 → 000600");
  });

  describe("regra de gameplay na escena", () => {
    const ROM = "F:/roms/goal.md";

    function regraDaROM(): RegraRecuperada {
      const r = construirRegraRecuperada(respostaRecuperar(), ROM);
      if (!r.ok) throw new Error(`fixture invalida: ${r.motivo}`);
      return r.regra;
    }

    function escenaCon(bloque: RegraRecuperada | null): Scene {
      const entidade: Entity = {
        entity_id: "player",
        transform: { x: 0, y: 0 },
        components: { logic: bloque ? { recovered_rule: bloque } : {} },
      };
      return {
        scene_id: "scene_goal",
        entities: [entidade],
        background_layers: [],
        palettes: [],
      };
    }

    async function abrirBarraECode() {
      const romInput = Array.from(container.querySelectorAll("input")).find((element) =>
        element.getAttribute("placeholder")?.includes("/roms/game.md")
      );
      if (!(romInput instanceof HTMLInputElement)) throw new Error("sen barra de ROM");
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(romInput, ROM);
        romInput.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();
      });
      await act(async () => {
        findButton(container, "Analisar ROM").click();
        await flush();
        await flush();
      });
      await act(async () => {
        findButton(container, "Code").click();
        await flush();
        await flush();
      });
    }

    function porTestId(testid: string): HTMLElement {
      const element = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
      if (!element) throw new Error(`sen elemento: ${testid}`);
      return element;
    }

    it("garda o bloque recuperado na entidade e escribe a escena", async () => {
      await act(async () => {
        useEditorStore.setState({
          activeProjectDir: "F:/Projects/proxecto",
          activeScene: escenaCon(null),
          activeSceneSource: escenaCon(null),
          selectedEntityId: "player",
        });
        await flush();
      });
      mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
      mocks.persistActiveScene.mockResolvedValue(true);

      await abrirBarraECode();
      await act(async () => {
        (porTestId("rex-gameplay-recover") as HTMLButtonElement).click();
        await flush();
        await flush();
      });
      expect(porTestId("rex-gameplay-source").textContent).toMatch(/ROM/);

      await act(async () => {
        (porTestId("rex-gameplay-save-scene") as HTMLButtonElement).click();
        await flush();
        await flush();
      });

      expect(mocks.persistActiveScene).toHaveBeenCalledWith("F:/Projects/proxecto", expect.any(String));
      expect(porTestId("rex-gameplay-saved-state").textContent).toContain("player");
      const gardado = useEditorStore.getState().activeScene?.entities[0]?.components.logic
        ?.recovered_rule;
      expect(gardado).toEqual(regraDaROM());
      expect(gardado?.graph_json).toBe(GRAFO_REAL);
      expect(gardado?.limitations).toEqual(LIMITACIONES);
    });

    it("reabre desde a escena sen chamar ao backend, co limiar e as orixes gardadas", async () => {
      const bloque = regraDaROM();
      await act(async () => {
        useEditorStore.setState({
          activeProjectDir: "F:/Projects/proxecto",
          activeScene: escenaCon(bloque),
          activeSceneSource: escenaCon(bloque),
          selectedEntityId: "player",
        });
        await flush();
      });

      await abrirBarraECode();

      expect(mocks.rexGameplayRecover).not.toHaveBeenCalled();
      expect(porTestId("rex-gameplay-source").textContent).toMatch(/escena/);
      expect(porTestId("rex-gameplay-identity").textContent).toMatch(/non revalidada/);
      expect(porTestId("rex-gameplay-rule-text").textContent).toContain("compar");
      expect((porTestId("rex-gameplay-threshold") as HTMLInputElement).value).toBe(
        String(bloque.threshold_current)
      );
      // As orixes na ROM sobreviven ao round-trip da escena: cada no mostra o
      // seu rango, bytes e mnemónico tal como os devolveu o crate.
      const nos = Array.from(
        container.querySelectorAll("[data-testid^='rex-gameplay-node-']")
      ).map((element) => element.textContent ?? "");
      expect(nos.length).toBeGreaterThan(0);
      expect(nos.join(" ")).toContain("0x000946..0x00094A");
      expect(nos.join(" ")).toContain("0x000CAE");
    });
  });
});
