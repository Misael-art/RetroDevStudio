// Contract de cadeia: cada frame extraido carrega proveniencia ROM->tabela->entrada->
// pecas->tiles->paleta->composicao com enderecos explicitos.
import { describe, it, expect } from "vitest";
import { buildFrameRecord, buildAnimRecord } from "./chain.mjs";
import { buildSyntheticRom, putPiece } from "./fixture.mjs";
import { composeFrame } from "./compose.mjs";

const profile = {
  map_table: 0x211e2,
  map_frames: 88,
  dplc_table: 0x217fe,
  dplc_frames: 88,
  art_addr: 0x21afe,
  art_size: 0xa120,
  pal_addr: 0x2388,
  anim_table: 0x13b48,
  anim_count: 31,
};

function tinyRom() {
  const { rom, w } = buildSyntheticRom();
  const mc = profile.map_table + 88 * 2;
  const pieces = [1];
  putPiece(pieces, { y: -8, w: 1, h: 1, tile: 0, x: -8 });
  rom.set(pieces, mc);
  w(profile.map_table + 5 * 2, mc - profile.map_table);
  const dc = profile.dplc_table + 88 * 2;
  rom.set([1, 0x00, 0x00], dc); // 1 entrada: 1 tile a partir da arte 0
  w(profile.dplc_table + 5 * 2, dc - profile.dplc_table);
  rom.fill(0x11, profile.art_addr, profile.art_addr + 32);
  return rom;
}

describe("contrato de cadeia por frame", () => {
  it("record do frame aponta tabela, entrada, peca e arte com enderecos explicitos", () => {
    const rom = tinyRom();
    const rec = buildFrameRecord({ rom, profile, frame: 5, frameName: "exemplo" });
    expect(rec.profiles).toBeUndefined();
    expect(rec.map.table_addr).toBe(0x211e2);
    expect(rec.map.entry_index).toBe(5);
    expect(rec.map.entry_offset).toBe(88 * 2);
    expect(rec.map.addr).toBe(0x211e2 + 88 * 2);
    expect(rec.dplc.table_addr).toBe(0x217fe);
    expect(rec.dplc.addr).toBe(0x217fe + 88 * 2);
    expect(rec.dplc.slots).toEqual([0]);
    expect(rec.pieces).toHaveLength(1);
    const p = rec.pieces[0];
    expect(p.byte_addr).toBe(rec.map.addr + 1);
    expect(p.tile_slot).toBe(0);
    expect(p.art_index).toBe(0);
    expect(p.art_addr).toBe(profile.art_addr);
    expect(p.palette_addr).toBe(profile.pal_addr);
  });

  it("slot sem carga vira lacuna nomeada no record, nunca tile inventado", () => {
    const rom = tinyRom();
    const mc = profile.map_table + 88 * 2;
    const pieces = [1];
    putPiece(pieces, { y: -8, w: 1, h: 1, tile: 7, x: -8 });
    rom.set(pieces, mc);
    const rec = buildFrameRecord({ rom, profile, frame: 5 });
    expect(rec.pieces[0].gap).toMatch(/lacuna/);
    expect(rec.pieces[0].art_addr).toBeNull();
    expect(rec.gaps).toHaveLength(1);
  });

  it("record de animacao lista frames por tick com mapping de cada frame", () => {
    const { rom, w } = buildSyntheticRom();
    // anim 0: script [2, frame 5, afEnd]; frame 5 existe no mapping acima
    const addr = profile.anim_table + profile.anim_count * 2;
    w(profile.anim_table, addr - profile.anim_table);
    rom.set([2, 5, 0xff], addr);
    const mc = profile.map_table + 88 * 2;
    const pieces = [1];
    putPiece(pieces, { y: -8, w: 1, h: 1, tile: 0, x: -8 });
    rom.set(pieces, mc);
    w(profile.map_table + 5 * 2, mc - profile.map_table);
    const dc = profile.dplc_table + 88 * 2;
    rom.set([1, 0x00, 0x00], dc);
    w(profile.dplc_table + 5 * 2, dc - profile.dplc_table);
    rom.fill(0x11, profile.art_addr, profile.art_addr + 32);

    const rec = buildAnimRecord({ rom, profile, anim: 0, ticks: 5 });
    expect(rec.anim).toBe(0);
    expect(rec.script_addr).toBe(addr);
    expect(rec.interval).toBe(2);
    expect(rec.sequence.map((s) => s.frame)).toEqual([5, 5, 5, 5, 5]);
    expect(rec.sequence[0].pieces).toHaveLength(1);
  });

  it("record casa com a composicao real (mesma fonte de pixels)", () => {
    const rom = tinyRom();
    const palettes = [
      [
        [0, 0, 0], [7, 0, 0], [7, 7, 7], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
        [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
      ],
    ];
    const img = composeFrame({ rom, profile, palettes, frame: 5 });
    const rec = buildFrameRecord({ rom, profile, frame: 5, palettes });
    expect(rec.composition).toEqual({ width: img.width, height: img.height, anchor: img.anchor });
  });
});
