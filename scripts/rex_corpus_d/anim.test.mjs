import { describe, it, expect } from "vitest";
import { buildSyntheticRom } from "./fixture.mjs";
import { sbyte } from "./reader.mjs";

// Reader de animacao ainda nao existe: RED esperado ate GREEN.
const mod = "./anim.mjs";
const { readAnimTable, decodeAnimScript, expandAnimFrames } = await import(/* @vite-ignore */ mod).catch(() => ({}));

const profile = {
  anim_table: 0x13b48,
  anim_count: 31,
};

function animFixture(scripts) {
  // scripts: { animId: bytes[] } escritos logo apos a tabela de 31 palavras
  const { rom, w } = buildSyntheticRom();
  const dataStart = profile.anim_table + profile.anim_count * 2;
  for (const [id, bytes] of Object.entries(scripts)) {
    const addr = dataStart + Number(id) * 0x40;
    w(profile.anim_table + Number(id) * 2, addr - profile.anim_table);
    rom.set(bytes, addr);
  }
  return { rom };
}

const afEnd = 0xff;
const afBack = 0xfe;
const afChange = 0xfd;

describe("leitor de animacao", () => {
  it("le a tabela de 31 entradas como offsets RELATIVOS a base da tabela", () => {
    const { rom } = animFixture({ 0: [8, 1, afEnd], 5: [4, 2, 3, afEnd] });
    const table = readAnimTable(rom, profile);
    expect(table).toHaveLength(profile.anim_count);
    const entry = table.find((e) => e.anim === 5);
    const abs = profile.anim_table + entry.offset;
    expect(rom[abs]).toBe(4); // primeiro byte do script de id 5
    expect(entry.addr).toBe(abs);
  });

  it("decodifica script normal: intervalo, frames e loop (afEnd)", () => {
    const { rom } = animFixture({ 2: [8, 0x12, 0x13, 0x14, afEnd] });
    const s = decodeAnimScript(rom, profile, 2);
    expect(s.interval).toBe(8);
    expect(s.frames).toEqual([0x12, 0x13, 0x14]);
    expect(s.terminator).toEqual({ type: "loop" });
  });

  it("afBack volta k frames: script [A,B,afBack,1] alterna A,B,A,B", () => {
    const { rom } = animFixture({ 3: [2, 0x21, 0x22, afBack, 1] });
    const s = decodeAnimScript(rom, profile, 3);
    expect(s.terminator).toEqual({ type: "back", frames: 1 });
    const seq = expandAnimFrames(s, 8).map((f) => f.frame);
    expect(seq).toEqual([0x21, 0x21, 0x22, 0x22, 0x21, 0x21, 0x22, 0x22]);
  });

  it("afChange troca de animacao sem loopar", () => {
    const { rom } = animFixture({ 4: [1, 0x30, afChange, 0x0d] });
    const s = decodeAnimScript(rom, profile, 4);
    expect(s.terminator).toEqual({ type: "change", anim: 0x0d });
    const seq = expandAnimFrames(s, 3);
    expect(seq[0].frame).toBe(0x30);
    expect(seq.at(-1).switchTo).toBe(0x0d);
  });

  it("expansao respeita o intervalo: cada frame dura N ticks", () => {
    const { rom } = animFixture({ 1: [3, 0xaa, 0xbb, afEnd] });
    const s = decodeAnimScript(rom, profile, 1);
    const seq = expandAnimFrames(s, 7);
    expect(seq.map((f) => f.frame)).toEqual([
      0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xaa,
    ]);
  });

  it("scripts especiais (walk/run/roll) comecam com byte de duracao negativo; leitor preserva o bruto", () => {
    // SonAni_Walk real: $FF + 6 frames + afEnd; $FF signed = -1
    const { rom } = animFixture({ 0: [afEnd, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, afEnd] });
    const s = decodeAnimScript(rom, profile, 0, { special: true });
    expect(s.intervalRaw).toBe(0xff);
    expect(sbyte(s.intervalRaw)).toBe(-1);
    expect(s.frames).toEqual([0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12]);
    expect(s.special).toBe(true);
  });

  it("frame 0 de todo script e um ID, nunca o intervalo (nao confunde primeiro byte)", () => {
    const { rom } = animFixture({ 6: [16, 1, afEnd] });
    const s = decodeAnimScript(rom, profile, 6);
    expect(s.frames).toEqual([1]);
    expect(s.interval).toBe(16);
  });
});
