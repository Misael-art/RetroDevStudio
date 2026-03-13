import { describe, expect, it } from "vitest";

import {
  decodeTilesToImageData,
  getActivePalette,
  parseHexColor,
} from "./vramViewer";

describe("parseHexColor", () => {
  it("parses full hex colors", () => {
    expect(parseHexColor("#123456")).toEqual({ r: 0x12, g: 0x34, b: 0x56 });
  });

  it("falls back to black for invalid colors", () => {
    expect(parseHexColor("invalid")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("getActivePalette", () => {
  it("prefers the requested palette slot from the scene", () => {
    const palette = getActivePalette(
      {
        scene_id: "main",
        display_name: "Main",
        entities: [],
        background_layers: [],
        palettes: [
          { slot: 1, colors: ["#010203", "#040506"] },
          { slot: 0, colors: ["#AABBCC"] },
        ],
      },
      "megadrive",
      1
    );

    expect(palette[0]).toBe("#010203");
    expect(palette[1]).toBe("#040506");
    expect(palette).toHaveLength(16);
  });

  it("falls back to target palette when the scene has no palettes", () => {
    const palette = getActivePalette(null, "snes", null);

    expect(palette).toHaveLength(16);
    expect(palette[0]).toBe("#000000");
  });
});

describe("decodeTilesToImageData", () => {
  it("decodes 4bpp tile bytes into RGBA pixels", () => {
    const bytes = new Array<number>(32).fill(0x12);
    const imageData = decodeTilesToImageData(
      bytes,
      ["#000000", "#112233", "#445566", "#778899", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000"],
      1
    );

    expect(imageData.width).toBe(8);
    expect(imageData.height).toBe(8);
    expect(Array.from(imageData.data.slice(0, 8))).toEqual([0x11, 0x22, 0x33, 255, 0x44, 0x55, 0x66, 255]);
  });
});
