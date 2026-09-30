// Prova no corpus real (BYOR): so roda com a ROM exata do perfil; sem ROM ou hash
// diferente, o suite e skipado explicitamente (nunca finge prova).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { SONIC1_US_EU } from "./profile.mjs";
import { readMappingFrame, readDplcFrame, slotToArt } from "./reader.mjs";
import { composeFrame } from "./compose.mjs";
import { decodePaletteLine } from "./palette.mjs";
import { readAnimTable, decodeAnimScript } from "./anim.mjs";

const romPath =
  process.env.REX_SONIC1_ROM ??
  SONIC1_US_EU.search_paths
    .map((d) => `${d}/${SONIC1_US_EU.rom.filename}`)
    .find((p) => existsSync(p));

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const rom = romPath ? readFileSync(romPath) : null;
const ready = Boolean(rom && rom.length === SONIC1_US_EU.rom.size && sha(rom) === SONIC1_US_EU.rom.sha256);

const P = SONIC1_US_EU;
const region = (addr, len) => sha(rom.subarray(addr, addr + len));

describe.skipIf(!ready)("corpus real Sonic 1 (BYOR)", () => {
  it("identidade da ROM bate com o perfil pinado", () => {
    expect(sha(rom)).toBe(P.rom.sha256);
  });

  it("Art_Sonic tem o hash de regiao pinado", () => {
    expect(region(P.art_addr, P.art_size)).toBe("934e48178cfddd8af1627493114a25d09671bbb4a5626f4d95a93001c8b78589");
  });

  it("MS_Stand (frame 1) tem 4 pecas iguais ao spritePiece do disassembly", () => {
    const pieces = readMappingFrame(rom, P, 1);
    expect(pieces).toHaveLength(4);
    // _maps/Sonic.asm: (-16,-20,3x1,t0) (-16,-12,4x2,t3) (-16,4,3x1,t$B) (-8,12,3x1,t$E)
    expect(pieces.map((p) => [p.x, p.y, p.w, p.h, p.tile])).toEqual([
      [-16, -20, 3, 1, 0x00],
      [-16, -12, 4, 2, 0x03],
      [-16, 4, 3, 1, 0x0b],
      [-8, 12, 3, 1, 0x0e],
    ]);
    expect(pieces.every((p) => p.pal === 0 && !p.xflip && !p.yflip)).toBe(true);
  });

  it("DPLC do frame 1 carrega os slots 0..16 em ordem (p.tile e slot, nao indice de arte)", () => {
    const slots = readDplcFrame(rom, P, 1);
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(slotToArt(slots, 0)).toBe(0);
    expect(() => slotToArt(slots, 17)).toThrow(/lacuna/);
  });

  it("frames 60 e 83 compartilham o mesmo payload DPLC (otimizacao real da SEGA)", () => {
    const t = (f) => readDplcFrame(rom, P, f).join(",");
    expect(t(60)).toBe(t(83));
  });

  it("composicao do frame 1 (stand) e deterministica e casa com a ancora do disassembly", () => {
    const palettes = [decodePaletteLine(rom, P.pal_addr, 0)];
    const img = composeFrame({ rom, profile: P, palettes, frame: 1 });
    // peca mais a esquerda x=-16 -> ancora (16,-minY); bounds: x[-16..16), y[-20..20)
    expect(img.anchor.x).toBe(16);
    expect(img.width).toBe(32);
    expect(img.height).toBe(40);
    expect(img.gaps).toEqual([]);
    expect(sha(Buffer.from(img.data))).toBe(computeOracleForStand());
  });

  it("Ani_Sonic: entrada 0 (walk) e o script especial de 6 frames do disassembly", () => {
    const table = readAnimTable(rom, P);
    expect(table).toHaveLength(31);
    const s = decodeAnimScript(rom, P, 0, { special: true });
    expect(s.intervalRaw).toBe(0xff);
    // SonAni_Walk: fr_Walk13..16, fr_Walk11..12 = [8,9,$A,$B,6,7]
    expect(s.frames).toEqual([8, 9, 0x0a, 0x0b, 6, 7]);
    expect(s.terminator).toEqual({ type: "loop" });
  });

  it("negativos: cada categoria de defeito muda a composicao do frame 1", () => {
    const palettes = [decodePaletteLine(rom, P.pal_addr, 0)];
    const baseHash = sha(Buffer.from(composeFrame({ rom, profile: P, palettes, frame: 1 }).data));
    const entry1 = (rom[P.map_table + 2] << 8) | rom[P.map_table + 3];
    const addr1 = P.map_table + entry1; // MS_Stand
    expect(rom[addr1]).toBe(4); // header: 4 pecas
    expect(rom[addr1 + 1]).toBe(0xec); // y da peca 0 = -20

    const mut = (fn) => {
      const copy = Buffer.from(rom);
      fn(copy);
      return copy;
    };
    const composeHash = (copy) => sha(Buffer.from(composeFrame({ rom: copy, profile: P, palettes, frame: 1 }).data));

    // peca deslocada (x da peca 0 += 16): muda pixels e ancora
    const shifted = mut((c) => { c[addr1 + 5] = (c[addr1 + 5] + 16) & 0xff; });
    expect(composeHash(shifted)).not.toBe(baseHash);

    // tile errado (bit baixo do tileLo da peca 0)
    const wrongTile = mut((c) => { c[addr1 + 4] ^= 0x01; });
    expect(composeHash(wrongTile)).not.toBe(baseHash);

    // flip invertido (bit xflip do flagsHi da peca 0)
    const flipped = mut((c) => { c[addr1 + 3] ^= 0x08; });
    expect(composeHash(flipped)).not.toBe(baseHash);

    // paleta errada (ordem de cores invertida na linha)
    const reversed = decodePaletteLine(rom, P.pal_addr, 0).slice().reverse();
    const wrongPal = composeFrame({ rom, profile: P, palettes: [reversed], frame: 1 });
    expect(sha(Buffer.from(wrongPal.data))).not.toBe(baseHash);

    // sequencia truncada: apagar o afEnd do script de walk faz frames demais serem lidos
    const walkScript = mut((c) => {
      const t = (c[P.anim_table] << 8) | c[P.anim_table + 1];
      const addr = P.anim_table + t;
      let pos = addr + 1;
      while (c[pos] !== 0xff) pos++;
      c[pos] = 0x20;
    });
    const s1 = decodeAnimScript(walkScript, P, 0, { special: true });
    expect(s1.frames.length).toBeGreaterThan(6);

    // identidade de ROM diferente: 1 byte corrompido invalida o gate de hash do perfil
    const different = mut((c) => { c[0x100] ^= 0x01; });
    expect(sha(different)).not.toBe(P.rom.sha256);
  });
});

// Oracle independente: reimplementacao direta do macro spritePiece v1 sobre os bytes
// do disassembly fixado, sem passar por reader.mjs. Se reader/compose divergirem da
// fonte independente, os hashes different e o teste falha.
function computeOracleForStand() {
  // pieces de _maps/Sonic.asm MS_Stand, arte de Art_Sonic, paleta de Pal_Sonic
  const specs = [
    { x: -16, y: -20, w: 3, h: 1, tile: 0x00 },
    { x: -16, y: -12, w: 4, h: 2, tile: 0x03 },
    { x: -16, y: 4, w: 3, h: 1, tile: 0x0b },
    { x: -8, y: 12, w: 3, h: 1, tile: 0x0e },
  ];
  const minX = -16, minY = -20, maxX = 16, maxY = 20;
  const width = maxX - minX, height = maxY - minY;
  const data = new Uint8Array(width * height * 4);
  const pal = decodePaletteLine(rom, P.pal_addr, 0);
  for (const s of specs) {
    for (let ty = 0; ty < s.h; ty++) {
      for (let tx = 0; tx < s.w; tx++) {
        const art = s.tile + ty * s.w + tx; // slot == arte (frame stand carrega 0..16 em ordem)
        const tAddr = P.art_addr + art * 32;
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const byte = rom[tAddr + row * 4 + (col >> 1)];
            const idx = (col & 1) === 0 ? (byte >> 4) & 0xf : byte & 0xf;
            if (idx === 0) continue;
            const px = s.x + tx * 8 + col - minX;
            const py = s.y + ty * 8 + row - minY;
            const i = (py * width + px) * 4;
            const [r, g, b] = pal[idx];
            data[i] = Math.round((r * 255) / 7);
            data[i + 1] = Math.round((g * 255) / 7);
            data[i + 2] = Math.round((b * 255) / 7);
            data[i + 3] = 255;
          }
        }
      }
    }
  }
  return sha(Buffer.from(data));
}
