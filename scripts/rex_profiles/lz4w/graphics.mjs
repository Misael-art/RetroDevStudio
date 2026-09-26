// Primitivas gráficas SGDK 2.11 (layout FIXADO desde o xerador/fontes en
//   /home/misael/.local/share/sgdk_forge/sdk_9e22ce585b578c4c3246):
//  - Tiles 8x8 4bpp planar (estándar Mega Drive; vdp.c/tile Eng)
//  - Recurso Palette: u16 numColor | u32 data* ; data = words BE 0xABGR
//    (Palette.java out():124-136 + ImageUtil.convertRGBA8888toRGBA4444 con
//    mask 0x0EEE: word = (a<<12)|(b<<8)|(g<<4)|r)
//  - PPM P6 binario (framebuffers de evidencia)
const u16 = (rom, o) => ((rom[o] << 8) | rom[o + 1]) >>> 0;
const u32 = (rom, o) => (((((rom[o] << 8 | rom[o + 1]) << 8 | rom[o + 2]) << 8 | rom[o + 3]) >>> 0));

/** 32 bytes planares (4 bytes/fila: plan0..plan3, bit 7 = col esquerda) -> 64 indices. */
export function decodeTilePlanar4(planeBytes) {
  if (planeBytes.length < 32) throw new Error("tile planar requere 32 bytes");
  const px = new Uint8Array(64);
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const bit = 7 - col;
      const i = row * 8 + col;
      px[i] =
        ((planeBytes[row * 4] >> bit) & 1) |
        (((planeBytes[row * 4 + 1] >> bit) & 1) << 1) |
        (((planeBytes[row * 4 + 2] >> bit) & 1) << 2) |
        (((planeBytes[row * 4 + 3] >> bit) & 1) << 3);
    }
  return px;
}

/** 32 bytes chunky packed-nibble (byte row*4 + col/2; nibble alto = col par) -> 64 indices. */
export function decodeTileChunky4(bytes) {
  if (bytes.length < 32) throw new Error("tile chunky requere 32 bytes");
  const px = new Uint8Array(64);
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const b = bytes[row * 4 + (col >> 1)];
      px[row * 8 + col] = col % 2 === 0 ? b >> 4 : b & 0x0f;
    }
  return px;
}

/** Header Palette SGDK en `ptr`: u16 numColor | u32 data* (words BE 0xABGR). */
export function readPaletteDefinition(rom, ptr) {
  if (ptr == null || ptr % 2 !== 0 || ptr + 6 > rom.length) return null;
  const numColor = u16(rom, ptr);
  const data = u32(rom, ptr + 2);
  if (!(numColor >= 1 && numColor <= 512)) return null;
  if (data % 2 !== 0 || data + numColor * 2 > rom.length) return null;
  const entries = [];
  for (let i = 0; i < numColor; i++) {
    const w = u16(rom, data + i * 2);
    entries.push({ r: w & 0xf, g: (w >> 4) & 0xf, b: (w >> 8) & 0xf });
  }
  return { offset: ptr, numColor, data, entries };
}

/** PPM P6 binario -> {width, height, rgb:Uint8Array(r,g,b...)} */
export function readPpmP6(bytes) {
  let pos = 0;
  const tokens = [];
  const isSpace = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
  while (tokens.length < 4 && pos < bytes.length) {
    while (pos < bytes.length && isSpace(bytes[pos])) pos++;
    if (pos < bytes.length && bytes[pos] === 0x23) {
      while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
      continue;
    }
    const start = pos;
    while (pos < bytes.length && !isSpace(bytes[pos])) pos++;
    tokens.push(Buffer.from(bytes.subarray(start, pos)).toString("latin1"));
    if (tokens.length === 1 && tokens[0] !== "P6") throw new Error("só PPM binario P6 soportado");
  }
  const [, w, h, maxv] = tokens;
  const width = Number(w);
  const height = Number(h);
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("cabeceira PPM inválida");
  pos++; // un só byte de separador tras o maxval
  const rgb = bytes.subarray(pos, pos + width * height * 3);
  if (rgb.length < width * height * 3) throw new Error("datos PPM truncados");
  void maxv;
  return { width, height, rgb };
}
