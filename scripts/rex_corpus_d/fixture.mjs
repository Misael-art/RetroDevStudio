// Fixtures autorais: constroem uma ROM sintetica com a MESMA estrutura de enderecos
// do perfil Sonic 1 (sem bytes comerciais). Usado apenas pelos testes.
export const ADDRS = {
  mapTable: 0x211e2,
  dplcTable: 0x217fe,
  art: 0x21afe,
  artSize: 0xa120,
  pal: 0x2388,
};

export function buildSyntheticRom({ mapEntries = 88, dplcEntries = 88 } = {}) {
  const rom = new Uint8Array(0x30000); // cobrir 0x21AFE + arte
  const w = (addr, value) => {
    rom[addr] = (value >> 8) & 0xff;
    rom[addr + 1] = value & 0xff;
  };
  return { rom, w };
}

// tile autoral: linha r tem byte r*4 = 0x10 + r -> p[x] = 16+r*256? manter simples:
// tile T: cada byte = (T & 0xf) | ((T & 0xf) << 4) -> todos os pixels = T & 0xf (0..15)
export function solidTileBytes(tileIndex) {
  const v = tileIndex & 0xf;
  return new Uint8Array(32).fill((v << 4) | v);
}

export function putPiece(bytes, { y, w: width, h: height, tile, xflip = 0, yflip = 0, pal = 0, pri = 0, x }) {
  bytes.push(
    y & 0xff,
    (((width - 1) & 3) << 2) | ((height - 1) & 3),
    ((((pri & 1) << 15) | ((pal & 3) << 13) | ((yflip & 1) << 12) | ((xflip & 1) << 11)) + tile) >> 8,
    tile & 0xff,
    x & 0xff
  );
}
