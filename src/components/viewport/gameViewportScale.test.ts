import { describe, expect, it } from "vitest";

import { getGameViewportDimensions, getGameViewportScale } from "./gameViewportScale";

describe("gameViewportScale", () => {
  it("reports the configured target dimensions", () => {
    expect(getGameViewportDimensions("megadrive")).toEqual({ width: 320, height: 224 });
    expect(getGameViewportDimensions("snes")).toEqual({ width: 256, height: 224 });
  });

  it("uses the target frame when selecting an automatic integer scale", () => {
    expect(getGameViewportScale(768, 448, 256, 224)).toBe(2);
    expect(getGameViewportScale(960, 672, 320, 224)).toBe(3);
  });
});
