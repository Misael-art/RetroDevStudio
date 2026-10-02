import { describe, it, expect } from "vitest";
import { readMappingFrame, readDplcFrame, readTileArt, sbyte, slotToArt } from "./reader.mjs";
import { buildSyntheticRom, putPiece } from "./fixture.mjs";

const profile = {
  map_table: 0x211e2,
  map_frames: 88,
  dplc_table: 0x217fe,
  dplc_frames: 88,
  art_addr: 0x21afe,
  art_size: 0xa120,
};

describe("leitor de mapping (SonicMappingsVer=1)", () => {
  it("peca decodifica x/y com sinal, dimensoes, tile, flips, paleta e prioridade", () => {
    const { rom, w } = buildSyntheticRom();
    const content = [];
    content.push(2); // cabecalho: 2 pecas
    putPiece(content, { y: -0x14, w: 3, h: 1, tile: 0x102, xflip: 1, pal: 2, x: -0x10 });
    putPiece(content, { y: 0x0c, w: 4, h: 2, tile: 3, yflip: 1, pri: 1, x: -8 });
    const c = profile.map_table + 88 * 2; // conteudo depois da tabela
    for (let i = 0; i < content.length; i++) rom[c + i] = content[i];
    w(profile.map_table, c - profile.map_table); // frame 0: offset relativo ao inicio da tabela
    const pieces = readMappingFrame(rom, profile, 0);
    expect(pieces.length).toBe(2);
    expect(pieces[0]).toMatchObject({ x: -0x10, y: -0x14, w: 3, h: 1, tile: 0x102, xflip: 1, yflip: 0, pal: 2, pri: 0 });
    expect(pieces[1]).toMatchObject({ x: -8, y: 0x0c, w: 4, h: 2, tile: 3, xflip: 0, yflip: 1, pal: 0, pri: 1 });
  });

  it("recusa frame alem do limite da tabela", () => {
    const { rom } = buildSyntheticRom();
    expect(() => readMappingFrame(rom, profile, 88)).toThrow(/frame/);
  });
});

describe("leitor DPLC (SonicDplcVer=1): papel do DPLC antes de interpretar indices", () => {
  it("converte entradas em slots de buffer na ordem de carregamento", () => {
    const { rom, w } = buildSyntheticRom();
    const c = profile.dplc_table + 88 * 2;
    const payload = [1, 0x20, 0x05, 0x10, 0x11]; // 1 entrada: (2-1)<<12|5 => 3 tiles a partir do tile de arte 5
    for (let i = 0; i < payload.length; i++) rom[c + i] = payload[i];
    w(profile.dplc_table, c - profile.dplc_table); // frame 0
    const slots = readDplcFrame(rom, profile, 0);
    // 3 tiles (byte alto 0x20 -> (0x20>>4)+1 = 3) com indices de arte 5,6,7 -> slots 0,1,2
    expect(slots).toEqual([5, 6, 7]);
  });

  it("indice de tile do mapping e um SLOT do buffer, nao um indice de arte", () => {
    const { rom, w } = buildSyntheticRom();
    const c = profile.dplc_table + 88 * 2;
    const payload = [1, 0x20, 0x05, 0x10, 0x11];
    for (let i = 0; i < payload.length; i++) rom[c + i] = payload[i];
    w(profile.dplc_table, c - profile.dplc_table);
    // arte: tile 5 -> 0x55, tiles 6,7 -> 0x66, 0x77
    for (let t = 0; t < 8; t++) rom[profile.art_addr + t * 32] = 0x50 + t;
    const slots = readDplcFrame(rom, profile, 0);
    expect(readTileArt(rom, profile, slots[0])[0]).toBe(0x55); // slot 0 == tile de arte 5
    expect(readTileArt(rom, profile, slots[2])[0]).toBe(0x57); // slot 2 == tile de arte 7
    // slot que o DPLC do frame nao carrega => lacuna explicita
    expect(() => slotToArt(slots, 9)).toThrow(/lacuna/i);
  });

  it("byte de contagem zero produz lacuna estrutural marcada", () => {
    const { rom, w } = buildSyntheticRom();
    const c = profile.dplc_table + 88 * 2;
    rom[c] = 0; // 0 entradas
    w(profile.dplc_table, c - profile.dplc_table);
    expect(readDplcFrame(rom, profile, 0)).toEqual([]);
  });
});

describe("sbyte", () => {
  it("converte byte 0..255 em inteiro com sinal -128..127", () => {
    expect(sbyte(0xf0)).toBe(-16);
    expect(sbyte(0x0c)).toBe(12);
    expect(sbyte(0x80)).toBe(-128);
  });
});
