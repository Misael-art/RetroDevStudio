import { describe, expect, it } from "vitest";

import { evaluateRecoveredAddQWord } from "./nodeEngine";

describe("recovered M68K ADDQ.W profile", () => {
  it("preserves the upper half and derives word flags", () => {
    expect(evaluateRecoveredAddQWord(0x1234ffff)).toEqual({
      d0: 0x12340000,
      n: false,
      z: true,
      v: false,
      c: true,
      x: true,
    });
    expect(evaluateRecoveredAddQWord(0x00007fff)).toEqual({
      d0: 0x00008000,
      n: true,
      z: false,
      v: true,
      c: false,
      x: false,
    });
  });

  it("rejects an immediate outside the exact ADDQ range", () => {
    expect(() => evaluateRecoveredAddQWord(0, 9)).toThrow(
      "ADDQ immediate must be an integer between 1 and 8",
    );
  });
});
