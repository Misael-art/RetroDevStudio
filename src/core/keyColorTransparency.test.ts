import { describe, expect, it } from "vitest";

import {
  applyKeyColorTransparency,
  hasBorderKeyColor,
} from "./keyColorTransparency";

function makeImageData(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

describe("key color transparency", () => {
  it("turns border magenta pixels transparent without mutating the source image", () => {
    const original = makeImageData(2, 2, [
      255, 0, 255, 255,
      0, 0, 0, 255,
      255, 0, 255, 255,
      255, 255, 255, 255,
    ]);

    expect(hasBorderKeyColor(original)).toBe(true);

    const result = applyKeyColorTransparency(original);

    expect(result.detected).toBe(true);
    expect(result.transparentPixels).toBe(2);
    expect(result.imageData.data[3]).toBe(0);
    expect(result.imageData.data[11]).toBe(0);
    expect(result.imageData.data[7]).toBe(255);
    expect(original.data[3]).toBe(255);
  });

  it("preserves legitimate interior magenta when no border key color is present", () => {
    const original = makeImageData(3, 3, [
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 0, 255, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]);

    const result = applyKeyColorTransparency(original);

    expect(result.detected).toBe(false);
    expect(result.transparentPixels).toBe(0);
    expect(result.imageData.data[4 * 4 + 3]).toBe(255);
  });

  it("preserves isolated interior magenta even when border key color exists", () => {
    const original = makeImageData(3, 3, [
      255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 255,
      0, 0, 0, 255, 255, 0, 255, 255, 0, 0, 0, 255,
      255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 255,
    ]);

    const result = applyKeyColorTransparency(original);

    expect(result.detected).toBe(true);
    expect(result.transparentPixels).toBe(4);
    expect(result.imageData.data[3]).toBe(0);
    expect(result.imageData.data[4 * 4 + 3]).toBe(255);
  });

  it("can keep the key color visible for debugging", () => {
    const original = makeImageData(1, 1, [255, 0, 255, 255]);

    const result = applyKeyColorTransparency(original, { showKeyColor: true });

    expect(result.detected).toBe(true);
    expect(result.transparentPixels).toBe(0);
    expect(result.imageData.data[3]).toBe(255);
  });
});
