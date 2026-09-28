import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RexGameplayRulePanel, type RexGameplayPersistencia } from "./RexGameplayRulePanel";
import { GRAFO_REAL, LIMITACIONES, respostaRecuperar, respostaRebuild } from "../../test/fixtures/rexGameplay";
import { construirRegraRecuperada, type RegraRecuperada } from "../../core/nodegraph/rexGameplayScene";

const mocks = vi.hoisted(() => ({
  rexGameplayScan: vi.fn(),
  rexGameplayRecover: vi.fn(),
  rexGameplayEditThreshold: vi.fn(),
  rexGameplayRebuild: vi.fn(),
}));

vi.mock("../../core/ipc/toolsService", () => ({
  rexGameplayScan: mocks.rexGameplayScan,
  rexGameplayRecover: mocks.rexGameplayRecover,
  rexGameplayEditThreshold: mocks.rexGameplayEditThreshold,
  rexGameplayRebuild: mocks.rexGameplayRebuild,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROM = "/roms/goal_original_t6.bin";
const SHA = "4149f7b2eb0c5975f97f59be6b44766decc286930d57bba673414205b753589e";

function regraGardada(): RegraRecuperada {
  const r = construirRegraRecuperada(respostaRecuperar(), ROM);
  if (!r.ok) throw new Error(`fixture invalida: ${r.motivo}`);
  return r.regra;
}

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
  vi.clearAllMocks();
});

async function render(panel: React.ReactElement) {
  await act(async () => root.render(panel));
}

function byTestId(testid: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testid}"]`);
}

async function click(testid: string) {
  const element = byTestId(testid);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`sen boton: ${testid}`);
  await act(async () => element.click());
}

/** Escritura nun control controlado de React: valor nativo + evento `input`. */
async function setText(testid: string, value: string) {
  const element = byTestId(testid);
  if (!(element instanceof HTMLInputElement)) throw new Error(`sen input: ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function selectOption(testid: string, value: string) {
  const element = byTestId(testid);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`sen select: ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function persisticia(overrides: Partial<RexGameplayPersistencia> = {}): RexGameplayPersistencia {
  return {
    entityId: "player",
    gardada: null,
    gardar: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("RexGameplayRulePanel — gardar a regra na escena", () => {
  it("garda o bloque exacto (ROM-base, rutina, limiar, grafo e limitacións)", async () => {
    mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
    const gardar = vi.fn().mockResolvedValue(true);
    await render(
      <RexGameplayRulePanel romPath={ROM} persistencia={persisticia({ gardar })} />
    );

    await click("rex-gameplay-recover");
    await click("rex-gameplay-save-scene");

    expect(gardar).toHaveBeenCalledTimes(1);
    expect(gardar.mock.calls[0][0]).toEqual({
      version: 1,
      profile_id: "m68k.counter_threshold_state_gate.v1",
      rom_path: ROM,
      rom_sha256: SHA,
      entry: 0x946,
      exits: [0x970],
      blocks: [
        [0x946, 0x970],
        [0xcae, 0xccc],
      ],
      operator: ">=",
      threshold_recovered: 6,
      threshold_current: 6,
      threshold_min: -127,
      threshold_max: 128,
      graph_json: GRAFO_REAL,
      limitations: LIMITACIONES,
    });
    expect(byTestId("rex-gameplay-saved-state")?.textContent).toContain("player");
  });

  it("recusa gardar sen entidade seleccionada, dicendoo en vez de silenciar", async () => {
    mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
    const gardar = vi.fn();
    await render(
      <RexGameplayRulePanel romPath={ROM} persistencia={persisticia({ entityId: null, gardar })} />
    );
    await click("rex-gameplay-recover");
    await click("rex-gameplay-save-scene");
    expect(gardar).not.toHaveBeenCalled();
    expect(byTestId("rex-gameplay-error")?.textContent).toMatch(/entidade/);
  });

  it("avisa cando a entidade xa ten lógica e hai que escoller outra", async () => {
    mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
    const gardar = vi.fn();
    await render(
      <RexGameplayRulePanel
        romPath={ROM}
        persistencia={persisticia({ gardar, entidadeConLogica: true })}
      />
    );
    await click("rex-gameplay-recover");
    await click("rex-gameplay-save-scene");
    expect(gardar).not.toHaveBeenCalled();
    expect(byTestId("rex-gameplay-error")?.textContent).toMatch(/lóxica|logic/);
  });

  it("di claramente cando só queda en memoria, sen venderlo por persistido", async () => {
    mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
    const gardar = vi.fn().mockResolvedValue(false);
    await render(
      <RexGameplayRulePanel romPath={ROM} persistencia={persisticia({ gardar })} />
    );
    await click("rex-gameplay-recover");
    await click("rex-gameplay-save-scene");
    expect(byTestId("rex-gameplay-saved-state")?.textContent).toMatch(/memoria/);
  });
});

describe("RexGameplayRulePanel — reabrir desde a escena", () => {
  it("mostra a regra gardada sen tocar a ROM, e di que aínda non revalidou", async () => {
    await render(
      <RexGameplayRulePanel romPath="" persistencia={persisticia({ gardada: regraGardada() })} />
    );
    expect(mocks.rexGameplayRecover).not.toHaveBeenCalled();
    expect(mocks.rexGameplayScan).not.toHaveBeenCalled();
    expect(byTestId("rex-gameplay-rule-text")?.textContent).toContain("compar");
    expect(byTestId("rex-gameplay-source")?.textContent).toMatch(/escena/);
    expect(byTestId("rex-gameplay-identity")?.textContent).toMatch(/non revalidada/);
  });

  it("revalida contra a ROM e confirma cando o SHA bate", async () => {
    mocks.rexGameplayScan.mockResolvedValue({
      request_id: "revalidate",
      rom_sha256: SHA,
      candidates: [],
      ambiguous: true,
    });
    await render(
      <RexGameplayRulePanel romPath={ROM} persistencia={persisticia({ gardada: regraGardada() })} />
    );
    await click("rex-gameplay-revalidate");
    expect(byTestId("rex-gameplay-identity")?.textContent).toMatch(/confirmada/);
    expect(byTestId("rex-gameplay-rule-text")).not.toBeNull();
  });

  it("cun SHA distinto retira a regra e di os dous identificadores", async () => {
    const outro = "0".repeat(64);
    mocks.rexGameplayScan.mockResolvedValue({
      request_id: "revalidate",
      rom_sha256: outro,
      candidates: [],
      ambiguous: true,
    });
    await render(
      <RexGameplayRulePanel romPath={ROM} persistencia={persisticia({ gardada: regraGardada() })} />
    );
    await click("rex-gameplay-revalidate");
    const motivo = byTestId("rex-gameplay-saved-refused")?.textContent ?? "";
    expect(motivo).toContain(SHA.slice(0, 12));
    expect(motivo).toContain(outro.slice(0, 12));
    expect(byTestId("rex-gameplay-rule-text")).toBeNull();
  });

  it("recusa un bloque gardado adulterado, co motivo, sen mostrar nada", async () => {
    const roto = { ...regraGardada(), profile_id: "m68k.de-outro-sitio.v1" };
    await render(<RexGameplayRulePanel romPath="" persistencia={persisticia({ gardada: roto })} />);
    expect(byTestId("rex-gameplay-rule-text")).toBeNull();
    expect(byTestId("rex-gameplay-saved-refused")?.textContent).toMatch(/perfil/);
  });

  it("unha ROM nova na barra descarta a regra viva e volve á da escena", async () => {
    mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
    const gardada = regraGardada();
    const persistencia = persisticia({ gardada });
    await render(<RexGameplayRulePanel romPath={ROM} persistencia={persistencia} />);
    await click("rex-gameplay-recover");
    expect(byTestId("rex-gameplay-source")?.textContent).toMatch(/ROM/);

    await render(<RexGameplayRulePanel romPath="/roms/outra.bin" persistencia={persistencia} />);
    expect(byTestId("rex-gameplay-source")?.textContent).toMatch(/escena/);
    expect(byTestId("rex-gameplay-identity")?.textContent).toMatch(/non revalidada/);
  });
});

function grafoConLimiar(limiar: number): string {
  const doc = JSON.parse(GRAFO_REAL);
  const compare = doc.nodes.find((n: { type: string }) => n.type === "rom_counter_compare");
  compare.params.threshold = limiar;
  return JSON.stringify(doc);
}

describe("RexGameplayRulePanel — xerar a copia modificada (ETAPA 5)", () => {
  /** Recupera a regra da ROM da barra e deixa o painel en estado editable. */
  async function recuperarEEditar(limiar?: number) {
    mocks.rexGameplayRecover.mockResolvedValue(respostaRecuperar());
    await render(<RexGameplayRulePanel romPath={ROM} persistencia={persisticia()} />);
    await click("rex-gameplay-recover");
    if (limiar !== undefined) {
      mocks.rexGameplayEditThreshold.mockResolvedValue({
        request_id: "edit",
        graph_json: grafoConLimiar(limiar),
      });
      await setText("rex-gameplay-threshold", String(limiar));
      await click("rex-gameplay-apply-threshold");
    }
  }

  it("pide confirmacion antes de escribir e chama ao nucleo só despois", async () => {
    await recuperarEEditar(4);
    mocks.rexGameplayRebuild.mockResolvedValue(respostaRebuild());

    await click("rex-gameplay-generate");
    expect(mocks.rexGameplayRebuild).not.toHaveBeenCalled();
    expect(byTestId("rex-gameplay-generate-confirm")).not.toBeNull();

    await click("rex-gameplay-generate-confirm");
    expect(mocks.rexGameplayRebuild).toHaveBeenCalledTimes(1);
    const pedido = mocks.rexGameplayRebuild.mock.calls[0][0];
    expect(pedido).toEqual({
      request_id: expect.stringMatching(/^rex-gameplay-xer-/),
      base_path: ROM,
      expected_sha256: SHA,
      graph_json: grafoConLimiar(4),
      output_path: "/roms/goal_original_t6.bin.limiar-4.patch.bin",
      method: "patch",
    });
  });

  it("cancelar pecha a confirmacion sen chamar ao nucleo", async () => {
    await recuperarEEditar(4);
    await click("rex-gameplay-generate");
    await click("rex-gameplay-generate-cancel");
    expect(mocks.rexGameplayRebuild).not.toHaveBeenCalled();
    expect(byTestId("rex-gameplay-generate-confirm")).toBeNull();
  });

  it("mostra a evidencia da copia: hashes, offsets, rangos, checksum e a orixinal intacta", async () => {
    await recuperarEEditar(4);
    mocks.rexGameplayRebuild.mockResolvedValue(respostaRebuild());
    await click("rex-gameplay-generate");
    await click("rex-gameplay-generate-confirm");

    const resultado = byTestId("rex-gameplay-rebuild-result")?.textContent ?? "";
    expect(resultado).toContain(SHA.slice(0, 12));
    expect(resultado).toContain(
      "8d4c1e07f6b9a3d5c2e14f70a6b3d9c8e5f201b7a4d63c98e0b5f27a1d34c690".slice(0, 12)
    );
    expect(resultado).toMatch(/0x000961/);
    expect(resultado).toMatch(/0x000946\.\.0x000970/);
    expect(resultado).toMatch(/checksum/i);
    expect(resultado).toContain("patch_moveq_immediate");
    expect(byTestId("rex-gameplay-original-intact")?.textContent).toContain(ROM);
  });

  it("distingue aplicar o inmediato, remontar a rexión e compilar o proxecto", async () => {
    await recuperarEEditar(4);
    mocks.rexGameplayRebuild.mockResolvedValue(
      respostaRebuild({
        method: "regenerate_region_from_graph",
        output_path: "/roms/goal_original_t6.bin.limiar-4.regenerate.bin",
      })
    );

    await selectOption("rex-gameplay-method", "regenerate");
    await click("rex-gameplay-generate");
    expect(byTestId("rex-gameplay-generate-preview")?.textContent).toMatch(
      /goal_original_t6\.bin\.limiar-4\.regenerate\.bin/
    );
    await click("rex-gameplay-generate-confirm");
    expect(mocks.rexGameplayRebuild.mock.calls[0][0].method).toBe("regenerate");

    const explicacion = byTestId("rex-gameplay-method-note")?.textContent ?? "";
    expect(explicacion).toMatch(/compila|compilaci/i);
    expect(explicacion).toMatch(/ningún|fluxo canónico/);
  });

  it("cando o limiar gardado e o da ROM presenta a copia como control, non como edicion", async () => {
    await recuperarEEditar();
    mocks.rexGameplayRebuild.mockResolvedValue(respostaRebuild({ output_path: `${ROM}.limiar-6.patch.bin` }));
    await click("rex-gameplay-generate");
    expect(byTestId("rex-gameplay-generate-preview")?.textContent).toMatch(/control|NoOp/);
  });

  it("sen identidade confirmada coa ROM da barra non se xera", async () => {
    await render(
      <RexGameplayRulePanel romPath={ROM} persistencia={persisticia({ gardada: regraGardada() })} />
    );
    const boton = byTestId("rex-gameplay-generate");
    expect(boton).not.toBeNull();
    expect(boton?.hasAttribute("disabled")).toBe(true);
    expect(byTestId("rex-gameplay-generate-blocked")?.textContent).toMatch(/identidade/);
    await click("rex-gameplay-generate");
    expect(mocks.rexGameplayRebuild).not.toHaveBeenCalled();
  });

  it("unha ROM nova na barra antes de confirmar invalida a confirmacion pendente", async () => {
    mocks.rexGameplayScan.mockResolvedValue({
      request_id: "revalidate",
      rom_sha256: SHA,
      candidates: [],
      ambiguous: true,
    });
    const persistencia = persisticia({ gardada: regraGardada() });
    await render(<RexGameplayRulePanel romPath={ROM} persistencia={persistencia} />);
    await click("rex-gameplay-revalidate");
    await click("rex-gameplay-generate");
    expect(byTestId("rex-gameplay-generate-confirm")).not.toBeNull();

    // Troca a ROM da barra co bloque da escena intacto: a regra segue visible,
    // pero a confirmación pendente apuntaba a outra base e ten que desaparecer.
    await render(<RexGameplayRulePanel romPath="/roms/outra.bin" persistencia={persistencia} />);
    expect(byTestId("rex-gameplay-source")?.textContent).toMatch(/escena/);
    expect(byTestId("rex-gameplay-generate-confirm")).toBeNull();
    expect(byTestId("rex-gameplay-generate-preview")).toBeNull();
    expect(mocks.rexGameplayRebuild).not.toHaveBeenCalled();
  });

  it("o nucleo falla: a pantalla di o motivo e non inventa unha copia", async () => {
    await recuperarEEditar(4);
    mocks.rexGameplayRebuild.mockRejectedValue({
      code: "output_exists",
      message: "saida xa existe; escolha outro caminho",
      retryable: false,
    });
    await click("rex-gameplay-generate");
    await click("rex-gameplay-generate-confirm");
    expect(byTestId("rex-gameplay-error")?.textContent).toMatch(/output_exists/);
    expect(byTestId("rex-gameplay-rebuild-result")).toBeNull();
  });

  it("se o nucleo informa unha base cuxo SHA non bate co gardado, non se vende como xeracion", async () => {
    await recuperarEEditar(4);
    mocks.rexGameplayRebuild.mockResolvedValue(respostaRebuild({ input_sha256: "0".repeat(64) }));
    await click("rex-gameplay-generate");
    await click("rex-gameplay-generate-confirm");
    expect(byTestId("rex-gameplay-error")?.textContent).toMatch(/identidade|SHA/);
    expect(byTestId("rex-gameplay-rebuild-result")).toBeNull();
  });

  it("se o nucleo escribe noutro caminho do pedido, a pantalla dino en vez de mostrar o seu", async () => {
    await recuperarEEditar(4);
    mocks.rexGameplayRebuild.mockResolvedValue(
      respostaRebuild({ output_path: "/roms/por-acidente.bin" })
    );
    await click("rex-gameplay-generate");
    await click("rex-gameplay-generate-confirm");
    expect(byTestId("rex-gameplay-error")?.textContent).toMatch(/caminho|output_path/);
    expect(byTestId("rex-gameplay-rebuild-result")).toBeNull();
  });
});
