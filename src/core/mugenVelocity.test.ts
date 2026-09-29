import { describe, expect, it } from "vitest";
import type { Entity } from "./ipc/sceneService";
import { MUGEN_PROFILE_ID, parseVelocity, q8ToDecimal, readMugenVelocities, withMugenVelocity } from "./mugenVelocity";

function walkerEntity(): Entity {
  const node = (id: string, stateNo: number, vx: string, instance: string) => ({
    id,
    type: "set_velocity",
    params: { target: "w", vx, vy: 0, mode: "set", profile: MUGEN_PROFILE_ID, state_no: stateNo, instance, controller: `c${stateNo}` },
  });
  const graph = {
    version: 1,
    nodes: [
      node("state_20_velset_0", 20, "2.5", "body"),
      node("t_0_0_enter_velset_0", 20, "2.5", "enter"),
      node("state_0_velset_0", 0, "0", "body"),
      { id: "other", type: "set_velocity", params: { target: "w", vx: 3, vy: 0 } },
    ],
    edges: [],
  };
  return {
    entity_id: "w",
    prefab: null,
    transform: { x: 0, y: 0 },
    components: { logic: { graph: JSON.stringify(graph) } },
  } as unknown as Entity;
}

describe("mugenVelocity", () => {
  it("converts literals to Q8.8 with the same rounding as the backend", () => {
    expect(parseVelocity("2.5")).toEqual({ ok: true, q8: 640, exact: true, effective: "2.5" });
    expect(parseVelocity("-1.75")).toMatchObject({ ok: true, q8: -448, exact: true });
    expect(parseVelocity("0")).toMatchObject({ ok: true, q8: 0 });
    // 2.4 * 256 = 614.4 -> 614 (aproximado, com o valor efetivo explicito)
    expect(parseVelocity("2.4")).toEqual({ ok: true, q8: 614, exact: false, effective: "2.3984375" });
    // metade para longe do zero: 1/512 = 0.001953125 -> 0.5/256
    expect(parseVelocity("0.001953125")).toMatchObject({ q8: 1, exact: false });
    expect(parseVelocity("-0.001953125")).toMatchObject({ q8: -1, exact: false });
    expect(parseVelocity("127.99609375")).toMatchObject({ ok: true, q8: 32767, exact: true });
  });

  it("refuses expressions, out-of-range values and empty input with a reason", () => {
    for (const bad of ["", "abc", "1e2", "2,5", "const(velocity.walk.fwd.x)", "128", "-128", "1.", ".5", "1+1"]) {
      const parsed = parseVelocity(bad);
      expect(parsed.ok, bad).toBe(false);
      if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(10);
    }
  });

  it("prints exact decimals", () => {
    expect(q8ToDecimal(640)).toBe("2.5");
    expect(q8ToDecimal(-448)).toBe("-1.75");
    expect(q8ToDecimal(1)).toBe("0.00390625");
  });

  it("lists one velocity per state and rewrites body and enter nodes together", () => {
    const entity = walkerEntity();
    expect(readMugenVelocities(entity).map((s) => [s.stateNo, s.vx])).toEqual([
      [0, "0"],
      [20, "2.5"],
    ]);
    const next = withMugenVelocity(entity, 20, "3.75");
    expect(next).not.toBeNull();
    const nodes = JSON.parse(next as string).nodes as Array<{ id: string; params: Record<string, unknown> }>;
    expect(nodes.filter((n) => n.params.state_no === 20).map((n) => n.params.vx)).toEqual(["3.75", "3.75"]);
    expect(nodes.find((n) => n.params.state_no === 0)?.params.vx).toBe("0");
    expect(nodes.find((n) => n.id === "other")?.params.vx).toBe(3);
    expect(withMugenVelocity(entity, 99, "1")).toBeNull();
  });
});
