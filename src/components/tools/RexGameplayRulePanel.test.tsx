import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RexGameplayRulePanel, type RexGameplayPersistencia } from "./RexGameplayRulePanel";
import { GRAFO_REAL, LIMITACIONES, respostaRecuperar } from "../../test/fixtures/rexGameplay";
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
