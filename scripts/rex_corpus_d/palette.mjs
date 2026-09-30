export function decodePaletteWord(word) {
  return {
    r: (word & 0xf) >> 1,
    g: ((word >> 4) & 0xf) >> 1,
    b: ((word >> 8) & 0xf) >> 1,
  };
}

// Uma linha de paleta MD: 16 palavras 0x0RGB (3 bits por canal) em big-endian.
export function decodePaletteLine(rom, addr, line = 0) {
  const base = addr + line * 0x20;
  const out = [];
  for (let i = 0; i < 16; i++) {
    const word = (rom[base + i * 2] << 8) | rom[base + i * 2 + 1];
    const { r, g, b } = decodePaletteWord(word);
    out.push([r, g, b]);
  }
  return out;
}
