import { describe, it, expect } from "vitest";
import { decodeTile4bpp, decodeTileRow } from "./tiles.mjs";
import { decodePaletteWord } from "./palette.mjs";

describe("MD 4bpp tile decoder", () => {
  it("golden literal: 12 34 56 78 decodifica para indices 1..8", () => {
    // Expectativa escrita a mao (nao derivada do renderer): nibble alto primeiro.
    expect(decodeTileRow(new Uint8Array([0x12, 0x34, 0x56, 0x78]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("linhas de um tile ocupam 4 bytes cada, linha 0 primeiro", () => {
    const tile = new Uint8Array(32);
    tile.set([0x01, 0x23, 0x45, 0x67], 0); // linha 0
    tile.set([0xff, 0x00, 0x00, 0x00], 28); // linha 7
    const out = decodeTile4bpp(tile);
    expect(out.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out.slice(56, 64)).toEqual([15, 15, 0, 0, 0, 0, 0, 0]);
  });

  it("recusa tile com tamanho != 32 bytes", () => {
    expect(() => decodeTile4bpp(new Uint8Array(31))).toThrow(/32/);
  });
});

describe("MD palette word (RGB333)", () => {
  it("0x0EEE e branco pleno (7,7,7)", () => {
    expect(decodePaletteWord(0x0eee)).toEqual({ r: 7, g: 7, b: 7 });
  });

  it("0x08AE decompoe nibbles B/G/R em canais 3-bit", () => {
    expect(decodePaletteWord(0x08ae)).toEqual({ r: 7, g: 5, b: 4 });
  });

  it("0x0822 decompoe nibbles B/G/R em canais 3-bit", () => {
    expect(decodePaletteWord(0x0822)).toEqual({ r: 1, g: 1, b: 4 });
  });

  it("0x0000 e preto", () => {
    expect(decodePaletteWord(0x0000)).toEqual({ r: 0, g: 0, b: 0 });
  });
});
