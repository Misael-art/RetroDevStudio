// Lectura de recursos TiledImage de SGDK 2.11 (layout de TileMap.java/
// Image.java na fonte do SDK) coa variante APLib raw do axente B.
//   TiledImage: { u32 palette* | u32 tileset* | u32 tilemap* } (12 bytes)
//   TileSet:    { u16 compression | u16 numTile | u32 tiles }
//   TileMap:    { u16 compression | u16 w | u16 h | u32 data }
// Tiles: 8x8 4bpp CHUNKY packed-nibble (byte r*4 + c/2; nibble alto =
// columna par), convención verificada contra o framebuffer real (tests).
// Entry do tilemap (u16 BE): index bits 0-10 | hflip 11 | vflip 12 |
// palette bank 13-14 | priority 15 (vdp_tile.h TILE_ATTR_*_SFT).
import { aplibDecode } from "./aplib.mjs";
import { readPaletteDefinition, decodeTileChunky4 } from "./graphics.mjs";

const BYTES_PER_TILE = 32;
const COMPRESSION_APLIB = 1;

const be16 = (rom, a) => (rom[a] << 8) | rom[a + 1];
const be32 = (rom, a) =>
  (((rom[a] << 24) | (rom[a + 1] << 16) | (rom[a + 2] << 8) | rom[a + 3]) >>> 0);

export function readTiledImage(rom, ptr) {
  return {
    palettePtr: be32(rom, ptr),
    tilesetPtr: be32(rom, ptr + 4),
    tilemapPtr: be32(rom, ptr + 8),
  };
}

export { decodeTileChunky4 };

export function decodeTilesetImage(rom, ptr) {
  const { palettePtr, tilesetPtr, tilemapPtr } = readTiledImage(rom, ptr);
  const compression = be16(rom, tilesetPtr);
  if (compression !== COMPRESSION_APLIB)
    throw new Error(`TiledImage: compresión ${compression} non soportada (agarda APLIB)`);
  const numTile = be16(rom, tilesetPtr + 2);
  const tilesData = be32(rom, tilesetPtr + 4);
  const mapW = be16(rom, tilemapPtr + 2);
  const mapH = be16(rom, tilemapPtr + 4);
  const mapData = be32(rom, tilemapPtr + 6);
  if (be16(rom, tilemapPtr) !== COMPRESSION_APLIB)
    throw new Error("TiledImage: tilemap non APLIB");
  const t = aplibDecode(rom, { offset: tilesData, maxSize: numTile * BYTES_PER_TILE + 64 });
  const m = aplibDecode(rom, { offset: mapData, maxSize: mapW * mapH * 2 + 64 });
  if (t.output.length !== numTile * BYTES_PER_TILE)
    throw new Error(`TiledImage: tileset ${t.output.length} != ${numTile * BYTES_PER_TILE}`);
  if (m.output.length !== mapW * mapH * 2)
    throw new Error(`TiledImage: tilemap ${m.output.length} != ${mapW * mapH * 2}`);
  const entries = new Uint16Array(mapW * mapH);
  for (let i = 0; i < entries.length; i++) entries[i] = (m.output[i * 2] << 8) | m.output[i * 2 + 1];
  return {
    numTile,
    tileBytes: t.output,
    tilesConsumed: t.bytesConsumed,
    mapW,
    mapH,
    entries,
    mapConsumed: m.bytesConsumed,
    palette: readPaletteDefinition(rom, palettePtr),
    palettePtr,
    tilesetPtr,
    tilemapPtr,
    compression,
  };
}

/** Pantalla de índices de paleta (w x h) co banco de paleta de cada entry. */
export function composeIndexScreen(img, w, h) {
  const idx = new Uint8Array(w * h);
  for (let y = 0; y < img.mapH; y++)
    for (let x = 0; x < img.mapW; x++) {
      const e = img.entries[y * img.mapW + x];
      const tile = e & 0x7ff;
      const fh = (e >> 11) & 1;
      const fv = (e >> 12) & 1;
      const bank = (e >> 13) & 3;
      const px = decodeTileChunky4(img.tileBytes.subarray(tile * 32, tile * 32 + 32));
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const sx = fh ? 7 - i : i;
          const sy = fv ? 7 - j : j;
          const py = y * 8 + j;
          const px2 = x * 8 + i;
          if (py < h && px2 < w) idx[py * w + px2] = px[sy * 8 + sx] + (bank << 4);
        }
    }
  return idx;
}
