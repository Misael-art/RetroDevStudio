import { describe, it, expect } from "vitest";
import { composeFrame } from "./compose.mjs";
import { buildSyntheticRom, putPiece } from "./fixture.mjs";

const profile = {
  map_table: 0x211e2,
  map_frames: 88,
  dplc_table: 0x217fe,
  dplc_frames: 88,
  art_addr: 0x21afe,
  art_size: 0xa120,
};
// linha 0: cor 1 = vermelho puro; linha 1: cor 1 = azul puro
const palettes = [
  [
    [0, 0, 0], [7, 0, 0], [7, 7, 7], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ],
  [
    [0, 0, 0], [0, 0, 7], [7, 7, 7], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ],
];

function fixture({ xflip = 0, yflip = 0, pal = 0, tile = 0, artFill } = {}) {
  const { rom, w } = buildSyntheticRom();
  const mc = profile.map_table + 88 * 2;
  const pieces = [1];
  putPiece(pieces, { y: -8, w: 1, h: 1, tile, xflip, yflip, pal, x: -8 });
  rom.set(pieces, mc);
  w(profile.map_table, mc - profile.map_table);
  const dc = profile.dplc_table + 88 * 2;
  const payload = [1, 0x00, 0x00]; // 1 entrada, 1 tile a partir da arte 0
  rom.set(payload, dc);
  w(profile.dplc_table, dc - profile.dplc_table);
  rom.set(artFill ?? new Uint8Array(32).fill(0x11), profile.art_addr);
  return { rom, w, mc, dc };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

describe("compositor de frames", () => {
  it("peca 1x1 em (-8,-8) ancora em (0,0) e usa paleta por linha pal", () => {
    const { rom } = fixture();
    const img = composeFrame({ rom, profile, palettes, frame: 0 });
    expect(img).toMatchObject({ width: 8, height: 8, anchor: { x: 8, y: 8 } });
    expect(px(img, 0, 0)).toEqual([0xfc, 0, 0, 0xff]);
  });

  it("indice 0 e transparencia (alpha 0), nao preto opaco", () => {
    const { rom } = fixture({ artFill: new Uint8Array(32).fill(0x01) });
    // arte 0x11 -> todos os pixels indice 1; troque para 0x00 -> indice 0
    rom.fill(0x00, profile.art_addr, profile.art_addr + 32);
    const img = composeFrame({ rom, profile, palettes, frame: 0 });
    expect(px(img, 3, 4)[3]).toBe(0);
  });

  it("pal=1 seleciona a outra linha de paleta", () => {
    const { rom } = fixture({ pal: 1 });
    const img = composeFrame({ rom, profile, palettes, frame: 0 });
    expect(px(img, 0, 0)).toEqual([0, 0, 0xfc, 0xff]);
  });

  it("xflip espelha o padroao dentro da peca sem mover seu retangulo", () => {
    const left = new Uint8Array(32);
    for (let r = 0; r < 8; r++) left[r * 4] = 0x10; // coluna 0 = indice 1, resto 0
    const a = composeFrame({ rom: fixture({ artFill: left }).rom, profile, palettes, frame: 0 });
    const b = composeFrame({ rom: fixture({ artFill: left, xflip: 1 }).rom, profile, palettes, frame: 0 });
    expect(px(a, 0, 0)).toEqual([0xfc, 0, 0, 0xff]);
    expect(px(a, 7, 0)[3]).toBe(0);
    expect(px(b, 0, 0)[3]).toBe(0);
    expect(px(b, 7, 0)).toEqual([0xfc, 0, 0, 0xff]);
  });

  it("yflip espelha verticalmente", () => {
    const top = new Uint8Array(32);
    top[0] = 0x10; // linha 0 col 0 -> indice 1
    const b = composeFrame({ rom: fixture({ artFill: top, yflip: 1 }).rom, profile, palettes, frame: 0 });
    expect(px(b, 0, 7)).toEqual([0xfc, 0, 0, 0xff]);
    expect(px(b, 0, 0)[3]).toBe(0);
  });

  it("tiles em ordem row-major dentro da peca (2x1 usa 2 slots consecutivos)", () => {
    const { rom, w } = buildSyntheticRom();
    const mc = profile.map_table + 88 * 2;
    const pieces = [1];
    putPiece(pieces, { y: -8, w: 2, h: 1, tile: 0, x: -8 });
    rom.set(pieces, mc);
    w(profile.map_table, mc - profile.map_table);
    const dc = profile.dplc_table + 88 * 2;
    rom.set([1, 0x10, 0x00], dc); // 1 entrada: 2 tiles a partir da arte 0
    w(profile.dplc_table, dc - profile.dplc_table);
    rom.fill(0x11, profile.art_addr, profile.art_addr + 32); // tile arte 0: tudo indice 1
    rom.fill(0x22, profile.art_addr + 32, profile.art_addr + 64); // tile arte 1: tudo indice 2
    const img = composeFrame({ rom, profile, palettes, frame: 0 });
    expect(px(img, 3, 3)).toEqual([0xfc, 0, 0, 0xff]); // primeira metade: cor 1
    expect(px(img, 11, 3)).toEqual([0xfc, 0xfc, 0xfc, 0xff]); // segunda metade: indice 2 = branco
  });

  it("xflip em peca 2x1 inverte a ORDEM dos tiles e os pixels (bloco inteiro, como o VDP)", () => {
    const { rom, w } = buildSyntheticRom();
    const mc = profile.map_table + 88 * 2;
    const pieces = [1];
    putPiece(pieces, { y: -8, w: 2, h: 1, tile: 0, xflip: 1, x: -8 });
    rom.set(pieces, mc);
    w(profile.map_table, mc - profile.map_table);
    const dc = profile.dplc_table + 88 * 2;
    rom.set([1, 0x10, 0x00], dc);
    w(profile.dplc_table, dc - profile.dplc_table);
    const t0 = new Uint8Array(32).fill(0x11); // arte 0: indice 1 (vermelho)
    const t1 = new Uint8Array(32).fill(0x22); // arte 1: indice 2 (branco)
    rom.set(t0, profile.art_addr);
    rom.set(t1, profile.art_addr + 32);
    const img = composeFrame({ rom, profile, palettes, frame: 0 });
    // sem flip: [vermelho|branco]; com flip de bloco: [branco|vermelho]
    expect(px(img, 3, 3)).toEqual([0xfc, 0xfc, 0xfc, 0xff]);
    expect(px(img, 11, 3)).toEqual([0xfc, 0, 0, 0xff]);
  });

  it("globalFlipX espelha o quadro inteiro em torno da ancora (equivalente a BuildSpr_FlipX)", () => {
    const left = new Uint8Array(32).fill(0x00);
    for (let r = 0; r < 8; r++) left[r * 4] = 0x10; // borda esquerda colorida
    const f = fixture({ artFill: left });
    const normal = composeFrame({ rom: f.rom, profile, palettes, frame: 0 });
    const flipped = composeFrame({ rom: f.rom, profile, palettes, frame: 0, globalFlip: { x: true, y: false } });
    expect(px(normal, 0, 0)).toEqual([0xfc, 0, 0, 0xff]);
    expect(px(flipped, 7, 0)).toEqual([0xfc, 0, 0, 0xff]);
    expect(px(flipped, 0, 0)[3]).toBe(0);
  });

  it("slot nao carregado pelo DPLC aparece como lacuna explicita, sem pintura", () => {
    const { rom, w } = buildSyntheticRom();
    const mc = profile.map_table + 88 * 2;
    const pieces = [1];
    putPiece(pieces, { y: -8, w: 1, h: 1, tile: 5, x: -8 }); // slot 5 inexistente
    rom.set(pieces, mc);
    w(profile.map_table, mc - profile.map_table);
    const dc = profile.dplc_table + 88 * 2;
    rom.set([1, 0x00, 0x00], dc);
    w(profile.dplc_table, dc - profile.dplc_table);
    const img = composeFrame({ rom, profile, palettes, frame: 0 });
    expect(img.gaps).toHaveLength(1);
    expect(img.gaps[0]).toMatchObject({ tile: 5, x: 0, y: 0, width: 8, height: 8 });
    expect(img.gaps[0].reason).toMatch(/lacuna/);
    expect(px(img, 0, 0)[3]).toBe(0);
  });
});
