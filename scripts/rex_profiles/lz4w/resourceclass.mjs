// Helpers de clase de recurso: referencias absolutas BE u32, lecturas
// palette-like e estatisticas estruturais de payload. Puros, sen I/O.
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((u16(b, o) << 16) | u16(b, o + 2)) >>> 0;

/** Todas as posicións (aliñadas a byte) onde un u32 BE == target. */
export function findU32Refs(rom, target) {
  const refs = [];
  for (let o = 0; o + 4 <= rom.length; o++) if (u32(rom, o) === target) refs.push(o);
  return refs;
}

/**
 * Posicións aliñadas que se LEN como Palette definition SGDK
 * ({u16 numColor, u32 data}) con data == addr. Só lectura estrutural:
 * non proba consumidora — hai que validar que o poseedor non é un campo
 * doutro layout (v. g. numTile dun TileSet).
 */
export function findPaletteLikeRefs(rom, addr, { minColors = 2, maxColors = 64 } = {}) {
  const refs = [];
  for (let o = 0; o + 6 <= rom.length; o += 2) {
    const n = u16(rom, o);
    if (n >= minColors && n <= maxColors && u32(rom, o + 2) === addr) refs.push(o);
  }
  return refs;
}

/** Nibbles (0..15) presentes nun payload 4bpp, ordenados. */
export function nibbleAlphabet(bytes) {
  const set = new Set();
  for (const b of bytes) {
    set.add(b >> 4);
    set.add(b & 15);
  }
  return [...set].sort((a, b) => a - b);
}

/** Palabras BE cuxo bit0 é 1 — imposibles en saída de paleta SGDK (<<1). */
export function countOddBit0Words(bytes) {
  let n = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) if ((bytes[i] << 8 | bytes[i + 1]) & 1) n++;
  return n;
}
