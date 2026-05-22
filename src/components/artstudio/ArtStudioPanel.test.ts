import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtStudioPanel, {
  buildArtStudioCommandBindings,
  buildArtStudioAnimations,
  buildArtStudioSequencesFromSpriteMetadata,
  describeArtStudioLoadFailure,
  getArtStudioImageFormatLabel,
  getArtStudioPanOffsets,
  summarizeArtStudioHardwareBudget,
  getArtStudioWheelZoomState,
  getSuggestedFrameIndex,
  resolveArtStudioSpriteAssetPath,
  type SpriteSequence,
} from "./ArtStudioPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { ParsedInputCommand } from "../../core/inputCommands";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  artProcessPalette: vi.fn(),
  importArtAsset: vi.fn(),
  parseInputCommandFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
}));

vi.mock("../../core/ipc/artStudioService", () => ({
  artProcessPalette: mocks.artProcessPalette,
  importArtAsset: mocks.importArtAsset,
}));

vi.mock("../../core/ipc/inputCommandService", () => ({
  parseInputCommandFile: mocks.parseInputCommandFile,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

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

describe("ArtStudioPanel helpers", () => {
  it("accepts only sprite sheets that already live under the project sprite assets tree", () => {
    expect(
      resolveArtStudioSpriteAssetPath(
        "F:/Projects/RetroDevStudio/demo",
        "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png"
      )
    ).toBe("assets/sprites/hero/run.png");

    expect(
      resolveArtStudioSpriteAssetPath(
        "F:/Projects/RetroDevStudio/demo",
        "F:/Projects/RetroDevStudio/demo/assets/tilesets/stage.png"
      )
    ).toBeNull();

    expect(
      resolveArtStudioSpriteAssetPath(
        "F:/Projects/RetroDevStudio/demo",
        "D:/Downloads/hero.png"
      )
    ).toBeNull();
  });

  it("detects supported formats from extension", () => {
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.webp")).toBe("WebP");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.gif")).toBe("GIF");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.jpg")).toBe("JPG");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.ppm")).toBe("PPM");
    expect(getArtStudioImageFormatLabel("D:/Downloads/hero.txt")).toBeNull();
  });

  it("classifies common image load failures with actionable messages", () => {
    expect(describeArtStudioLoadFailure("hero.txt", new Error("unsupported format"))).toContain(
      "Formato nao suportado"
    );
    expect(
      describeArtStudioLoadFailure("hero.png", new Error("failed to fetch asset://hero.png"))
    ).toContain("protocolo de asset");
    expect(describeArtStudioLoadFailure("hero.png", new Error("enoent"))).toContain(
      "Arquivo nao encontrado"
    );
  });

  it("rejects duplicate or unnamed animation keys after normalization", () => {
    const duplicateSequences: SpriteSequence[] = [
      { id: "idle", name: "Idle", frames: [0], fps: 12, loop: true },
      { id: "idle_2", name: "idle", frames: [1], fps: 12, loop: true },
    ];
    const unnamedSequence: SpriteSequence[] = [
      { id: "idle", name: "   ", frames: [0], fps: 12, loop: true },
    ];

    expect(buildArtStudioAnimations(duplicateSequences).error).toContain("mesma chave");
    expect(buildArtStudioAnimations(unnamedSequence).error).toContain("nome valido");
  });

  it("normalizes frames and fps for persisted animations", () => {
    const result = buildArtStudioAnimations([
      { id: "run", name: "Run Cycle", frames: [3, 1, 3, 2], fps: 0, loop: true },
      { id: "empty", name: "Unused", frames: [], fps: 12, loop: false },
    ]);

    expect(result.error).toBeNull();
    expect(result.animations).toEqual({
      run_cycle: {
        frames: [1, 2, 3],
        fps: 12,
        loop: true,
      },
    });
  });

  it("builds sprite command bindings against animation keys without dropping unsupported tokens", () => {
    const hadouken: ParsedInputCommand = {
      id: "hadouken",
      display_name: "Hadouken",
      notation: "_2, _3, _6, _P",
      source: "local-command.dat",
      max_frames: 15,
      steps: [
        { tokens: ["_2"], display: ["↓"] },
        { tokens: ["_3"], display: ["↘"] },
        { tokens: ["_6"], display: ["→"] },
        { tokens: ["_P"], display: ["P"] },
      ],
      unsupported_tokens: [],
    };
    const weird: ParsedInputCommand = {
      ...hadouken,
      id: "weird",
      display_name: "Weird",
      notation: "~30,_P",
      unsupported_tokens: ["~30"],
    };

    expect(
      buildArtStudioCommandBindings(
        [
          { id: "seq_fireball", name: "Fireball", frames: [0, 1], fps: 12, loop: false, command: hadouken },
          { id: "seq_weird", name: "Weird Move", frames: [2], fps: 12, loop: false, command: weird },
        ],
        "megadrive"
      )
    ).toEqual([
      {
        id: "hadouken",
        display_name: "Hadouken",
        notation: "_2, _3, _6, _P",
        source: "local-command.dat",
        target_animation: "fireball",
        max_frames: 15,
        button_profile: "megadrive",
        unsupported_tokens: [],
        steps: hadouken.steps,
      },
      {
        id: "weird",
        display_name: "Weird",
        notation: "~30,_P",
        source: "local-command.dat",
        target_animation: "weird_move",
        max_frames: 15,
        button_profile: "megadrive",
        unsupported_tokens: ["~30"],
        steps: weird.steps,
      },
    ]);
  });

  it("hydrates editable sequences and command chips from an existing SpriteComponent", () => {
    const sequences = buildArtStudioSequencesFromSpriteMetadata({
      animations: {
        idle: { frames: [0], fps: 6, loop: true },
        attack: { frames: [3, 4, 5], fps: 14, loop: false },
      },
      commands: [
        {
          id: "slash",
          display_name: "Slash",
          notation: "_6, _P",
          source: "entity.sprite.commands",
          target_animation: "attack",
          max_frames: 10,
          button_profile: "megadrive",
          unsupported_tokens: [],
          steps: [
            { tokens: ["_6"], display: ["→"] },
            { tokens: ["_P"], display: ["P"] },
          ],
        },
      ],
    });

    expect(sequences).toEqual([
      { id: "seq_idle", name: "Idle", frames: [0], fps: 6, loop: true },
      {
        id: "seq_attack",
        name: "Attack",
        frames: [3, 4, 5],
        fps: 14,
        loop: false,
        command: expect.objectContaining({
          id: "slash",
          display_name: "Slash",
          notation: "_6, _P",
        }),
      },
    ]);
  });

  it("summarizes hardware budget warnings compactly for the ArtStudio apply panel", () => {
    const summary = summarizeArtStudioHardwareBudget({
      vram_used: 62000,
      vram_limit: 65536,
      sprite_count: 68,
      sprite_limit: 80,
      scanline_sprite_peak: 18,
      scanline_sprite_limit: 20,
      dma_used: 12000,
      dma_limit: 16000,
      palette_banks_used: 4,
      palette_banks_limit: 4,
      bg_layers: 2,
      bg_layers_limit: 2,
      errors: [],
      warnings: [
        "VRAM Warning: sprite residency near limit",
        "Sprite Warning: scanline peak near limit",
        "DMA Warning: transfer budget near limit",
      ],
    });

    expect(summary.tone).toBe("warn");
    expect(summary.label).toBe("3 alertas de hardware");
    expect(summary.items).toEqual([
      "VRAM Warning: sprite residency near limit",
      "Sprite Warning: scanline peak near limit",
    ]);
    expect(summary.overflowCount).toBe(1);
  });

  it("maps canvas client coordinates back to the correct suggested frame", () => {
    expect(
      getSuggestedFrameIndex(
        new DOMRect(10, 20, 128, 64),
        128,
        64,
        64,
        32,
        [
          { index: 0, x: 0, y: 0, width: 32, height: 32 },
          { index: 1, x: 32, y: 0, width: 32, height: 32 },
        ],
        95,
        40
      )
    ).toBe(1);

    expect(
      getSuggestedFrameIndex(
        new DOMRect(10, 20, 128, 64),
        128,
        64,
        64,
        32,
        [{ index: 0, x: 0, y: 0, width: 32, height: 32 }],
        5,
        10
      )
    ).toBeNull();
  });

  it("computes stage zoom and pan offsets from pointer helpers", () => {
    const nextZoomState = getArtStudioWheelZoomState({
      clientX: 50,
      clientY: 40,
      deltaY: -100,
      rect: { left: 0, top: 0 },
      scrollLeft: 20,
      scrollTop: 10,
      sourceZoom: 1,
    });

    expect(nextZoomState.nextZoom).toBeCloseTo(1.16, 2);
    expect(nextZoomState.scrollLeft).toBeCloseTo(31.33, 2);
    expect(nextZoomState.scrollTop).toBeCloseTo(18.09, 2);

    expect(
      getArtStudioPanOffsets({
        startX: 100,
        startY: 80,
        currentX: 124,
        currentY: 92,
        scrollLeft: 40,
        scrollTop: 30,
      })
    ).toEqual({
      scrollLeft: 16,
      scrollTop: 18,
    });
  });
});

describe("ArtStudioPanel import flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalImage: typeof Image;
  let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.artProcessPalette.mockResolvedValue({
      ok: true,
      processed_base64: "ZmFrZS1wbmctcHJldmlldw==",
      error: null,
      format: "PNG",
      source_width: 256,
      source_height: 128,
      processed_width: 256,
      processed_height: 128,
      frame_count: 1,
      background_mode: "corner",
      transparent_pixels: 128,
      palette: [
        "transparent",
        "#000000",
        "#242424",
        "#494949",
        "#6d6d6d",
        "#929292",
        "#b6b6b6",
        "#dbdbdb",
      ],
      palette_size: 8,
      content_bounds: {
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        aligned_x: 0,
        aligned_y: 0,
        aligned_width: 64,
        aligned_height: 32,
        tile_cols: 8,
        tile_rows: 4,
      },
      suggested_frame_width: 32,
      suggested_frame_height: 32,
      recommended_output_width: 32,
      recommended_output_height: 32,
      recommended_scale_percent: 100,
      meta_sprite_candidate: false,
      slicing_mode: "grid",
      suggested_frames: [
        { index: 0, x: 0, y: 0, width: 32, height: 32 },
        { index: 1, x: 32, y: 0, width: 32, height: 32 },
      ],
      warnings: [],
    });
    mocks.importArtAsset.mockResolvedValue({
      ok: true,
      error: null,
      relative_path: "assets/sprites/hero_sheet.png",
      absolute_path: "F:/Projects/RetroDevStudio/demo/assets/sprites/hero_sheet.png",
      sprite_name: "hero_sheet",
      frame_width: 32,
      frame_height: 32,
      frame_count: 2,
      generated_width: 64,
      generated_height: 32,
    });
    mocks.parseInputCommandFile.mockResolvedValue([
      {
        id: "hadouken",
        display_name: "Hadouken",
        notation: "_2, _3, _6, _P",
        source: "D:/Commands/command.dat",
        max_frames: 15,
        steps: [
          { tokens: ["_2"], display: ["↓"] },
          { tokens: ["_3"], display: ["↘"] },
          { tokens: ["_6"], display: ["→"] },
          { tokens: ["_P"], display: ["P"] },
        ],
        unsupported_tokens: [],
      },
    ]);

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/demo",
      activeProjectName: "Demo",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      selectedEntityId: null,
      activeViewportTab: "artstudio",
      emulatorLoaded: false,
      hwStatus: null,
      sceneRevision: 1,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      hwValidationRefreshTick: 0,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      emulPaused: false,
      consoleEntries: [],
      consoleVisible: true,
      activeScene: {
        scene_id: "main",
        display_name: "Main",
        entities: [],
        background_layers: [],
        palettes: [],
      },
    });

    originalImage = globalThis.Image;
    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;

    class MockImage {
      public naturalWidth = 256;
      public naturalHeight = 128;
      public decoding = "async";
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      private _src = "";

      decode() {
        return Promise.resolve();
      }

      set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
          if (value.includes("broken")) {
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      }

      get src() {
        return this._src;
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:artstudio-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(ArtStudioPanel));
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();

    globalThis.Image = originalImage;
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectUrl,
      });
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it("loads an external image for preparation and keeps apply blocked", async () => {
    mocks.open.mockResolvedValue("D:/Downloads/hero.webp");

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("hero.webp");
    expect(container.textContent).toContain("PNG");
    expect(container.textContent).toContain("ainda nao virou um asset canonico do projeto");
    expect(container.textContent).toContain("corner (128 px)");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
    expect(mocks.artProcessPalette).toHaveBeenCalledWith("D:/Downloads/hero.webp");
  });

  it("renders the docked layout and keeps the inspector contextual until a sequence is selected", async () => {
    mocks.open.mockResolvedValue("D:/Downloads/hero.webp");

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='artstudio-main-stage']")).not.toBeNull();
    expect(container.querySelector("[data-testid='artstudio-timeline']")).not.toBeNull();
    expect(container.querySelector("[data-testid='artstudio-inspector']")).not.toBeNull();
    expect(
      (
        container.querySelector(
          "[data-testid='artstudio-sequence-card-seq_idle'] input"
        ) as HTMLInputElement | null
      )?.value
    ).toBe("IDLE");
    expect(
      (
        container.querySelector(
          "[data-testid='artstudio-sequence-card-seq_run'] input"
        ) as HTMLInputElement | null
      )?.value
    ).toBe("RUN");
    expect(
      (
        container.querySelector(
          "[data-testid='artstudio-sequence-card-seq_jump'] input"
        ) as HTMLInputElement | null
      )?.value
    ).toBe("JUMP");
    expect(
      (
        container.querySelector(
          "[data-testid='artstudio-sequence-card-seq_attack'] input"
        ) as HTMLInputElement | null
      )?.value
    ).toBe("ATTACK");
    expect(container.querySelector("[data-testid='artstudio-command-panel']")?.tagName).toBe(
      "DETAILS"
    );
    expect(container.textContent).toContain("Key color: transparente");
    expect(container.textContent).toContain("Metadados");
    expect(container.textContent).not.toContain("Sequencia ativa");

    await act(async () => {
      (
        container.querySelector("[data-testid='artstudio-sequence-card-seq_idle']") as HTMLElement
      )?.click();
      await flush();
    });

    expect(container.textContent).toContain("Sequencia ativa");
    expect(container.textContent).toContain("Loop automatico");
  });

  it("imports the canonical sprite sheet before unlocking apply", async () => {
    mocks.open.mockResolvedValue(
      "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png"
    );

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("hero/run.png");
    expect(container.textContent).toContain("Imagem pronta");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
    expect(container.textContent).toContain("Sprite simples");

    await act(async () => {
      findButton(container, /Trazer para assets\/sprites|Regerar asset canonico/).click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("assets/sprites/hero_sheet.png");
    expect(findButton(container, /Aplicar/).disabled).toBe(false);
    expect(container.querySelector("[data-testid='artstudio-apply-plan']")?.textContent).toContain(
      "Criar entidade hero_sheet"
    );
    expect(container.querySelector("[data-testid='artstudio-apply-plan']")?.textContent).toContain(
      "Pronto para criar hero_sheet na cena atual."
    );
    expect(mocks.importArtAsset).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png",
      "F:/Projects/RetroDevStudio/demo",
      {
        spriteName: "run",
        gridWidth: 32,
        gridHeight: 32,
        slicingMode: "grid",
      }
    );

    await act(async () => {
      findButton(container, /Aplicar/).click();
      await flush();
    });

    const appliedEntity = useEditorStore
      .getState()
      .activeScene?.entities.find((entity) => entity.entity_id === "hero_sheet");
    expect(appliedEntity?.components.sprite).toEqual({
      asset: "assets/sprites/hero_sheet.png",
      frame_width: 32,
      frame_height: 32,
      palette_slot: 0,
      priority: "foreground",
      animations: {
        idle: {
          frames: [0],
          fps: 1,
          loop: true,
        },
      },
    });
  });

  it("imports local command.dat, binds a visual command to the active sequence and persists it on the sprite", async () => {
    mocks.open
      .mockResolvedValueOnce("D:/Commands/command.dat")
      .mockResolvedValueOnce("F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png");

    await act(async () => {
      findButton(container, "Importar command.dat").click();
      await flush();
      await flush();
    });

    expect(mocks.parseInputCommandFile).toHaveBeenCalledWith("D:/Commands/command.dat");
    expect(container.textContent).toContain("Hadouken");
    expect(container.textContent).toContain("↓ ↘ → A");

    await act(async () => {
      (
        container.querySelector("[data-testid='artstudio-sequence-card-seq_idle']") as HTMLElement
      )?.click();
      await flush();
    });

    await act(async () => {
      findButton(container, /Associar Hadouken/).click();
      await flush();
    });

    expect(container.textContent).toContain("Comando: Hadouken");

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });
    await act(async () => {
      findButton(container, /Trazer para assets\/sprites|Regerar asset canonico/).click();
      await flush();
      await flush();
    });
    await act(async () => {
      findButton(container, /Aplicar/).click();
      await flush();
    });

    const appliedEntity = useEditorStore
      .getState()
      .activeScene?.entities.find((entity) => entity.entity_id === "hero_sheet");
    expect(appliedEntity?.components.sprite?.commands).toEqual([
      expect.objectContaining({
        id: "hadouken",
        display_name: "Hadouken",
        notation: "_2, _3, _6, _P",
        target_animation: "idle",
        button_profile: "megadrive",
        unsupported_tokens: [],
      }),
    ]);
  });

  it("explains when apply will update the selected sprite entity instead of creating a new one", async () => {
    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "hero_existing",
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "hero_existing",
              display_name: "Hero Existing",
              prefab: null,
              transform: { x: 32, y: 48 },
              components: {
                sprite: {
                  asset: "assets/sprites/hero_old.png",
                  frame_width: 32,
                  frame_height: 32,
                  palette_slot: 0,
                  priority: "foreground",
                  animations: {},
                },
              },
            },
          ],
          background_layers: [],
          palettes: [],
        },
      });
      await flush();
    });
    mocks.open.mockResolvedValue(
      "F:/Projects/RetroDevStudio/demo/assets/sprites/hero/run.png"
    );

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, /Trazer para assets\/sprites|Regerar asset canonico/).click();
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='artstudio-apply-plan']")?.textContent).toContain(
      "Atualizar entidade hero_existing"
    );
    expect(container.querySelector("[data-testid='artstudio-apply-plan']")?.textContent).toContain(
      "Pronto para atualizar hero_existing na cena atual."
    );
    expect(findButton(container, "Aplicar nesta entidade").disabled).toBe(false);
  });

  it("shows persisted SpriteComponent.commands as visual bindings while editing an entity", async () => {
    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "hero_existing",
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "hero_existing",
              display_name: "Hero Existing",
              prefab: null,
              transform: { x: 32, y: 48 },
              components: {
                sprite: {
                  asset: "assets/sprites/hero_old.png",
                  frame_width: 32,
                  frame_height: 32,
                  palette_slot: 0,
                  priority: "foreground",
                  animations: {
                    attack: { frames: [1, 2], fps: 10, loop: false },
                  },
                  commands: [
                    {
                      id: "slash",
                      display_name: "Slash",
                      notation: "_6, _P",
                      source: "entity.sprite.commands",
                      target_animation: "attack",
                      max_frames: 10,
                      button_profile: "megadrive",
                      unsupported_tokens: [],
                      steps: [
                        { tokens: ["_6"], display: ["→"] },
                        { tokens: ["_P"], display: ["P"] },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          background_layers: [],
          palettes: [],
        },
      });
      await flush();
    });

    const attackInput = container.querySelector(
      "[data-testid='artstudio-sequence-card-seq_attack'] input"
    ) as HTMLInputElement | null;
    expect(attackInput?.value).toBe("Attack");
    expect(container.textContent).toContain("Comando: Slash");
  });

  it("exposes an automation hook for the desktop ArtStudio vertical without file dialogs", async () => {
    expect(window.__RDS_ARTSTUDIO_E2E__).toBeDefined();

    await act(async () => {
      window.__RDS_ARTSTUDIO_E2E__?.renameSequence("seq_attack", "Slash");
      window.__RDS_ARTSTUDIO_E2E__?.setSequenceFrames("seq_attack", [1]);
      await flush();
    });

    const attackInput = container.querySelector(
      "[data-testid='artstudio-sequence-card-seq_attack'] input"
    ) as HTMLInputElement | null;
    expect(attackInput?.value).toBe("Slash");
    expect(container.textContent).toContain("Frames selecionados: 1");
  });

  it("keeps a visible Scene bridge when editing a selected sprite entity", async () => {
    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "hero_existing",
        activeWorkspace: "artstudio",
        activeViewportTab: "artstudio",
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "hero_existing",
              display_name: "Hero Existing",
              prefab: null,
              transform: { x: 32, y: 48 },
              components: {
                sprite: {
                  asset: "assets/sprites/hero_old.png",
                  frame_width: 32,
                  frame_height: 32,
                  palette_slot: 0,
                  priority: "foreground",
                  animations: {},
                },
              },
            },
          ],
          background_layers: [],
          palettes: [],
        },
      });
      await flush();
    });

    const bridge = container.querySelector("[data-testid='artstudio-scene-context-bridge']");
    expect(bridge?.textContent).toContain("Hero Existing");
    expect(bridge?.textContent).toContain("assets/sprites/hero_old.png");

    await act(async () => {
      findButton(container, "Voltar para Cena").click();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeWorkspace).toBe("scene");
    expect(state.activeViewportTab).toBe("scene");
    expect(state.selectedEntityId).toBe("hero_existing");
    expect(state.editorMode).toBe("select");
  });

  it("surfaces backend processing errors with actionable feedback", async () => {
    mocks.open.mockResolvedValue("D:/Downloads/broken.gif");
    mocks.artProcessPalette.mockResolvedValueOnce({
      ok: false,
      processed_base64: null,
      error: "Falha ao decodificar imagem: formato corrompido.",
      format: null,
      source_width: null,
      source_height: null,
      processed_width: null,
      processed_height: null,
      frame_count: null,
      background_mode: null,
      transparent_pixels: null,
      palette: [],
      palette_size: 0,
      content_bounds: null,
      suggested_frame_width: null,
      suggested_frame_height: null,
      recommended_output_width: null,
      recommended_output_height: null,
      recommended_scale_percent: null,
      meta_sprite_candidate: false,
      warnings: [],
    });

    await act(async () => {
      findButton(container, "Importar imagem").click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Falha ao decodificar imagem");
    expect(findButton(container, /Aplicar/).disabled).toBe(true);
  });

  it("returns from no-sprite context to Scene preserving tilemap authoring focus", async () => {
    await act(async () => {
      useEditorStore.setState({
        selectedEntityId: "tilemap_focus",
        activeScene: {
          scene_id: "main",
          display_name: "Main",
          entities: [
            {
              entity_id: "tilemap_focus",
              display_name: "Tilemap Focus",
              prefab: null,
              transform: { x: 0, y: 0 },
              components: {
                tilemap: {
                  tileset: "assets/tilesets/stage.png",
                  map_width: 40,
                  map_height: 28,
                  scroll_x: 0,
                  scroll_y: 0,
                  cells: new Array(40 * 28).fill(1),
                },
              },
            },
          ],
          background_layers: [],
          palettes: [],
        },
      });
      await flush();
    });

    const notice = container.querySelector("[data-testid='artstudio-no-sprite-context']");
    expect(notice).not.toBeNull();

    await act(async () => {
      findButton(container, "Ir para Cena").click();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeWorkspace).toBe("scene");
    expect(state.activeViewportTab).toBe("scene");
    expect(state.selectedEntityId).toBe("tilemap_focus");
    expect(state.editorMode).toBe("paint");
    expect(state.activeTilemapId).toBe("tilemap_focus");
    expect(state.activeBrush?.kind).toBe("tile");
    expect(state.activeBrush?.assetPath).toBe("assets/tilesets/stage.png");
  });
});
