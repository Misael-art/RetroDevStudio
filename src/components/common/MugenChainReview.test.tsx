import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import MugenChainReview from "./MugenChainReview";
import type { MugenChainReport } from "../../core/mugenReview";

const src = (line: number, text: string) => ({ file: "ken.cmd", section: "[State -1]", line, text });
const chain: MugenChainReport = {
  status: "converted",
  notice: "Cadeia original delimitada (Experimental).",
  program_sha256: "ab".repeat(32),
  summary: { converted: 2, approximate: 1, authored: 1, unconverted: 3 },
  state_status: [{ state: 200, origin: "source", converted: 7, unconverted: 6, verdict: "parcial" }, { state: 0, origin: "stand_in", converted: 0, unconverted: 0, verdict: "autoral" }],
  dependencies: [{ name: "common1.cns", declared_in: "ken8.def:12", status: "missing", sha256: null, consequence: "stand-in autoral" }],
  operations: [
    { id: "special.-1.controller.0", kind: "controller", class: "converted", source: src(963, "[State -1]"), implementation: "ChangeState 200", test: "t", limit: "-" },
    { id: "approx.anim_time", kind: "semantics", class: "approximate", source: null, implementation: "AnimTime", test: "t", limit: "nao certificada" },
    { id: "state.0.stand_in", kind: "statedef", class: "authored", source: null, implementation: "stand-in", test: "t", limit: "nao e o estado 0 original" },
    { id: "state.200.controller.0", kind: "controller", class: "unconverted", source: src(300, "[State 200, 1]"), implementation: "HitDef", test: "-", limit: "sem combate" },
  ],
  unconverted_controllers: [{ id: "special.-1.controller.3", source: src(370, "[State -1]"), reason: "comando 'x' nao convertido" }],
};
afterEach(() => { document.body.innerHTML = ""; });

it("separates the four classes, shows file:line and never hides the missing dependency", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MugenChainReview chain={chain} />));
  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  expect(q("mugen-chain-review")?.getAttribute("data-status")).toBe("converted");
  for (const [c, n] of [["converted", "2"], ["approximate", "1"], ["authored", "1"], ["unconverted", "3"]]) {
    expect(q(`mugen-chain-count-${c}`)?.getAttribute("data-count")).toBe(n);
  }
  expect(q("mugen-chain-state-200")?.getAttribute("data-verdict")).toBe("parcial");
  expect(q("mugen-chain-state-0")?.textContent).toContain("stand-in RetroDev");
  expect(q("mugen-chain-dependency")?.getAttribute("data-status")).toBe("missing");
  expect(q("mugen-chain-dependency")?.textContent).toContain("ausente do pacote");
  expect(q("mugen-chain-op-special.-1.controller.0")?.getAttribute("data-class")).toBe("converted");
  expect(q("mugen-chain-op-special.-1.controller.0")?.textContent).toContain("ken.cmd:963");
  expect(q("mugen-chain-op-state.0.stand_in")?.textContent).toContain("RetroDev (sem fonte)");
  expect(q("mugen-chain-unconverted")?.textContent).toContain("1 controladores fora do subconjunto");
  await act(async () => root.unmount());
});
