// Compositor independente da UI: mapping + DPLC + arte + paleta -> RGBA.
// Semantica extraida de _inc/BuildSprites.asm (s1disasm 064e3c6):
//  - cada peca = um bloco de celulas VDP w*h; flags de flip/pal/pri da propria peca
//    vao direto ao VDP (o flip espelha o BLOCO inteiro: ordem de tiles e pixels);
//  - o flip global (obRender) espelha posicoes das pecas em torno da ancora e
//    inverte os bits de flip por peca -> equivale a espelhar o quadro composto;
//  - tiles dentro da peca em row-major a partir do slot p.tile no buffer DPLC.
import { readMappingFrame, readDplcFrame, readTileArt, slotToArt } from "./reader.mjs";
import { decodeTile4bpp } from "./tiles.mjs";

export function composeFrame({ rom, profile, palettes, frame, globalFlip = { x: false, y: false } }) {
  const pieces = readMappingFrame(rom, profile, frame);
  const slots = readDplcFrame(rom, profile, frame);

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const p of pieces) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w * 8);
    maxY = Math.max(maxY, p.y + p.h * 8);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const data = new Uint8ClampedArray(width * height * 4);
  const gaps = [];

  for (const p of pieces) {
    const palette = palettes[p.pal] ?? palettes[0];
    const blockW = p.w * 8;
    const blockH = p.h * 8;
    let missing = false;
    for (let i = 0; i < p.w * p.h; i++) {
      try {
        slotToArt(slots, p.tile + i);
      } catch {
        missing = true;
      }
    }
    if (missing) {
      gaps.push({ tile: p.tile, x: p.x - minX, y: p.y - minY, width: blockW, height: blockH, reason: "lacuna: DPLC do frame nao carrega os slots da peca" });
      continue;
    }
    const decoded = [];
    for (let i = 0; i < p.w * p.h; i++) {
      decoded.push(decodeTile4bpp(readTileArt(rom, profile, slotToArt(slots, p.tile + i))));
    }
    const sample = (col, row) => {
      const sx = p.xflip ? blockW - 1 - col : col;
      const sy = p.yflip ? blockH - 1 - row : row;
      const tile = decoded[Math.floor(sy / 8) * p.w + Math.floor(sx / 8)];
      return tile[(sy % 8) * 8 + (sx % 8)];
    };
    for (let row = 0; row < blockH; row++) {
      for (let col = 0; col < blockW; col++) {
        const index = sample(col, row);
        const dstX = p.x - minX + col;
        const dstY = p.y - minY + row;
        const i = (dstY * width + dstX) * 4;
        if (index === 0) {
          data[i + 3] = 0;
          continue;
        }
        const [r, g, b] = palette[index];
        // expansao RGB333 -> 8 bits: round(v*255/7), ponta 7 = 0xff
        data[i] = Math.round((r * 255) / 7);
        data[i + 1] = Math.round((g * 255) / 7);
        data[i + 2] = Math.round((b * 255) / 7);
        data[i + 3] = 255;
      }
    }
  }

  if (globalFlip.x || globalFlip.y) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = globalFlip.x ? width - 1 - x : x;
        const sy = globalFlip.y ? height - 1 - y : y;
        const src = (sy * width + sx) * 4;
        const dst = (y * width + x) * 4;
        out[dst] = data[src];
        out[dst + 1] = data[src + 1];
        out[dst + 2] = data[src + 2];
        out[dst + 3] = data[src + 3];
      }
    }
    return { data: out, width, height, anchor: { x: width - 1 + minX, y: height - 1 + minY }, gaps, pieces };
  }

  return { data, width, height, anchor: { x: -minX, y: -minY }, gaps, pieces };
}
