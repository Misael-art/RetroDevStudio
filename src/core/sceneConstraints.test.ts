import { describe, expect, it } from "vitest";

import {
  constrainSpritePaletteSlot,
  constrainSpriteFrameSize,
  isOnboardingSpriteAsset,
  ONBOARDING_SPRITE_ASSET,
} from "./sceneConstraints";

describe("sceneConstraints", () => {
  it("locks the onboarding placeholder sprite to its canonical 16x16 frame", () => {
    expect(isOnboardingSpriteAsset(ONBOARDING_SPRITE_ASSET)).toBe(true);
    expect(
      constrainSpriteFrameSize("megadrive", ONBOARDING_SPRITE_ASSET, 64, 56)
    ).toEqual({
      frameWidth: 16,
      frameHeight: 16,
    });
  });

  it("clamps Mega Drive simple sprites to 8px tiles and a 32x32 max", () => {
    expect(constrainSpriteFrameSize("megadrive", "assets/sprites/hero.ppm", 25, 9)).toEqual({
      frameWidth: 32,
      frameHeight: 16,
    });
  });

  it("normalizes SNES simple sprites to supported square sizes", () => {
    expect(constrainSpriteFrameSize("snes", "assets/sprites/hero.ppm", 24, 56)).toEqual({
      frameWidth: 64,
      frameHeight: 64,
    });
  });

  it("clamps palette slots to the supported range of each target", () => {
    expect(constrainSpritePaletteSlot("megadrive", -4)).toBe(0);
    expect(constrainSpritePaletteSlot("megadrive", 9)).toBe(3);
    expect(constrainSpritePaletteSlot("snes", 12)).toBe(7);
  });
});
