// Tests da capa de visibilidade: decodificación planar 4bpp, recurso
// Palette, PPM, composición frame->canvas e busca pixel-set no framebuffer.
// Estratexia: mapa de índice->color CONSISTENTE (agnostico de paleta) sobre
// o conxunto OPACO do frame; os píxeles de índice 0 son transparentes e non
// se comparan (mostran o fondo).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { decodeTilePlanar4, readPaletteDefinition, readPpmP6 } from "./graphics.mjs";
import {
  composeFrameCanvas,
  searchCanvasInPpm,
  frameTileRects,
  voteCanvasPlacement,
  scanDefsForVisibility,
  decodeTileSetTiles,
} from "./visibility.mjs";
import { validateRom } from "./sgdk-sprite.mjs";


const ROM_PATH =
  process.env.HAMOOPIG_ROM ??
  "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin";
const EVID = "/home/misael/RetroDevStudio/rex-evidence-2026-09-10/backend-hamoopig";

test("decodeTilePlanar4: fila 0, planes p0|p1|p3 activos -> indice 1+2+8=11 na col 0", () => {
  const t = new Uint8Array(32);
  t[0] = 0x80; // plan 0, fila 0, col máis significativa
  t[1] = 0x80; // plan 1
  t[3] = 0x80; // plan 3
  const px = decodeTilePlanar4(t);
  assert.equal(px.length, 64);
  assert.equal(px[0], 11);
  assert.equal(px[1], 0); // columna 2 sen planes
  assert.equal(px[8], 0); // fila 1 sen planes
});

test("decodeTilePlanar4: taboleiro 8x8 recheo do plan 2 -> todos 4", () => {
  const t = new Uint8Array(32);
  for (let r = 0; r < 8; r++) t[r * 4 + 2] = 0xff;
  const px = decodeTilePlanar4(t);
  assert.ok(px.every((v) => v === 4));
});

// --- formato chunky (packed nibble) para TileSets de sprite ---
// A pantalla de titulo reconstruíuse pixel-exacta con tiles CHUNKY
// (tiledimage.test.mjs); si os TileSet de sprite comparten codificador
// rescomp, o scan de visibilidade tamén debe poder lelos nese formato.
const encodePlanar = (px) => {
  const t = new Uint8Array(32);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      for (let p = 0; p < 4; p++)
        if ((px[r * 8 + c] >> p) & 1) t[r * 4 + p] |= 1 << (7 - c);
  return t;
};
const encodeChunky = (px) => {
  const t = new Uint8Array(32);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const b = px[r * 8 + c];
      if (c % 2 === 0) t[r * 4 + (c >> 1)] |= b << 4;
      else t[r * 4 + (c >> 1)] |= b;
    }
  return t;
};
const patternPx = () => Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + (i >> 3)) % 16);

test("decodeTileSetTiles: tileFormat 'chunky' le packed-nibble; planar segue predeterminado", () => {
  const px = patternPx();
  const rom = new Uint8Array(64);
  rom.set(encodeChunky(px), 32);
  const ts = { compression: 0, numTile: 1, tiles: 32 };
  const chunkyTiles = decodeTileSetTiles(rom, ts, { tileFormat: "chunky" });
  assert.deepEqual([...chunkyTiles[0]], [...px]);
  // sen opción, o mesmo bytes lése como planar (comportamento histórico)
  const planarTiles = decodeTileSetTiles(rom, ts);
  assert.notDeepEqual([...planarTiles[0]], [...px]);
  // round-trip planar intacto
  const romP = new Uint8Array(64);
  romP.set(encodePlanar(px), 32);
  const back = decodeTileSetTiles(romP, { compression: 0, numTile: 1, tiles: 32 });
  assert.deepEqual([...back[0]], [...px]);
});

test("readPaletteDefinition: dc.w numColor + dc.l data* + words BE 0xABGR", () => {
  const rom = new Uint8Array(0x20);
  rom[0] = 0x00; rom[1] = 0x02; // numColor = 2
  rom[2] = 0x00; rom[3] = 0x00; rom[4] = 0x00; rom[5] = 0x10; // data -> 0x10
  rom[0x10] = 0x00; rom[0x11] = 0x0c; // cor 0: R=12
  rom[0x12] = 0x0e; rom[0x13] = 0x00; // cor 1: B=14
  const p = readPaletteDefinition(rom, 0);
  assert.equal(p.numColor, 2);
  assert.deepEqual(p.entries[0], { r: 12, g: 0, b: 0 });
  assert.deepEqual(p.entries[1], { r: 0, g: 0, b: 14 });
});

test("readPpmP6: cabeceira P6 + datos RGB", () => {
  const bytes = Uint8Array.from(Buffer.from("P6\n2 1\n255\n\x11\x22\x33\x44\x55\x66", "binary"));
  const ppm = readPpmP6(bytes);
  assert.equal(ppm.width, 2);
  assert.equal(ppm.height, 1);
  assert.deepEqual([...ppm.rgb], [0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
});

// --- composición sintética: dous VDPSprite 1x1 nun canvas 16x8 ---
const tileSolid = (v) => new Uint8Array(64).fill(v);

test("composeFrameCanvas: bloques colocados en offsetX/offsetY, fila-major, tiles secuenciais", () => {
  const frame = {
    tileSet: { numTile: 2 },
    sprites: [
      { offsetX: 0, offsetY: 0, cellsWide: 1, cellsTall: 1, numTile: 1 },
      { offsetX: 8, offsetY: 0, cellsWide: 1, cellsTall: 1, numTile: 1 },
    ],
  };
  const tiles = [tileSolid(1), tileSolid(2)];
  const c = composeFrameCanvas(frame, tiles, 16, 8);
  assert.equal(c.width, 16);
  assert.equal(c.pixelAt(0, 0), 1);
  assert.equal(c.pixelAt(15, 7), 2);
  assert.equal(c.opaqueCount, 128);
});

test("composeFrameCanvas: bloque 2x2 consome 4 tiles en orde fila-major", () => {
  const frame = {
    tileSet: { numTile: 4 },
    sprites: [{ offsetX: 0, offsetY: 0, cellsWide: 2, cellsTall: 2, numTile: 4 }],
  };
  const tiles = [tileSolid(1), tileSolid(2), tileSolid(3), tileSolid(4)];
  const c = composeFrameCanvas(frame, tiles, 16, 16);
  assert.equal(c.pixelAt(0, 0), 1);
  assert.equal(c.pixelAt(8, 0), 2); // fila 0: tile0, tile1
  assert.equal(c.pixelAt(0, 8), 3); // fila 1: tile2, tile3
  assert.equal(c.pixelAt(8, 8), 4);
});

// --- busca agnóstica de paleta no PPM ---
const buildPpm = (w, h, fill) => {
  const rgb = new Uint8Array(w * h * 3).fill(fill);
  return { width: w, height: h, rgb };
};

test("searchCanvasInPpm: atopa o canvas (1,2->corA, 3->corB) embedido en (7,5) pese a fondo e cor distinta da paleta", () => {
  const frame = {
    tileSet: { numTile: 1 },
    sprites: [{ offsetX: 0, offsetY: 0, cellsWide: 2, cellsTall: 2, numTile: 4 }],
  };
  // tile con 4 índices distintos (0 transparente): 4 cels 8x8 solidas 1,2,3,4
  const tiles = [tileSolid(1), tileSolid(2), tileSolid(3), tileSolid(4)];
  const c = composeFrameCanvas(frame, tiles, 16, 16);
  const ppm = buildPpm(64, 48, 0x80);
  const colorOf = { 1: [0xee, 0x11, 0x22], 2: [0x11, 0xee, 0x22], 3: [0x11, 0x22, 0xee], 4: [0xee, 0xee, 0x11] };
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const idx = x < 8 ? (y < 8 ? 1 : 3) : y < 8 ? 2 : 4;
      const [r, g, b] = colorOf[idx];
      const o = ((5 + y) * 64 + (7 + x)) * 3;
      ppm.rgb[o] = r; ppm.rgb[o + 1] = g; ppm.rgb[o + 2] = b;
    }
  const hits = searchCanvasInPpm(c, ppm, { minOpaque: 40, minDistinct: 3 });
  // poden existir sub-cadros consistentes contra o fondo uniforme (mapeos non
  // inxectivos); o hit real é o único inxectivo (cada índice, unha cor única).
  const inj = hits.filter((h) => h.injective);
  assert.equal(inj.length, 1);
  assert.equal(inj[0].x, 7);
  assert.equal(inj[0].y, 5);
  assert.equal(inj[0].opaqueChecked, 256); // 4 cels opacas x 64
  assert.equal(inj[0].distinctIndices, 4);
});

test("searchCanvasInPpm: canvas con píxeles discordantes non produce hit", () => {
  const frame = {
    tileSet: { numTile: 1 },
    sprites: [{ offsetX: 0, offsetY: 0, cellsWide: 2, cellsTall: 1, numTile: 2 }],
  };
  const c = composeFrameCanvas(frame, [tileSolid(1), tileSolid(2)], 16, 8);
  // fondo NON uniforme (gradiente) para que o rexeite calquera desprazamento
  const ppm = buildPpm(40, 24, 0x00);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 40; x++) {
      const o = (y * 40 + x) * 3;
      ppm.rgb[o] = (x * 6) & 0xff; ppm.rgb[o + 1] = (y * 9) & 0xff; ppm.rgb[o + 2] = ((x + y) * 3) & 0xff;
    }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 16; x++) {
      const o = ((3 + y) * 40 + (4 + x)) * 3;
      const v = x < 8 ? 0xee : 0x11;
      ppm.rgb[o] = v; ppm.rgb[o + 1] = 0x00; ppm.rgb[o + 2] = 0x77;
    }
  ppm.rgb[((3 + 7) * 40 + (4 + 15)) * 3] = 0x55; // un píxel sabotexado no bordo
  const hits = searchCanvasInPpm(c, ppm, { minOpaque: 40, minDistinct: 1, minColors: 1 });
  assert.deepEqual(hits, []);
});

// --- vote de orixe tolerante a oclusión ---
const solidVar = () => {
  // tiles con 3 índices e patrón non trivial (2 diagonais + columna dereita)
  const mk = (a, b) => {
    const c = ((a + b) % 14) + 1; // terceiro índice dentro da paleta do test
    const t = new Uint8Array(64);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        t[y * 8 + x] = x === 7 ? c : x === y ? a : x + y === 7 ? b : 0;
    return t;
  };
  return [mk(1, 2), mk(3, 4), mk(5, 6), mk(7, 8), mk(9, 10), mk(11, 12), mk(13, 14), mk(2, 9), mk(4, 11)];
};

test("frameTileRects: un rect por célula de bloque, orde fila-major e secuencia de tiles", () => {
  const frame = {
    sprites: [
      { offsetX: 4, offsetY: 8, cellsWide: 2, cellsTall: 1, numTile: 2 },
      { offsetX: 0, offsetY: 0, cellsWide: 1, cellsTall: 2, numTile: 2 },
    ],
  };
  const rects = frameTileRects(frame);
  assert.equal(rects.length, 4);
  assert.deepEqual(rects[0], { tileIdx: 0, x: 4, y: 8 });
  assert.deepEqual(rects[1], { tileIdx: 1, x: 12, y: 8 });
  assert.deepEqual(rects[2], { tileIdx: 2, x: 0, y: 0 });
  assert.deepEqual(rects[3], { tileIdx: 3, x: 0, y: 8 });
});

test("voteCanvasPlacement: frame embedido cun bloque tapado por ruído -> orixe exacta con oclusión parcial", () => {
  const frame = {
    sprites: [
      { offsetX: 0, offsetY: 0, cellsWide: 3, cellsTall: 1, numTile: 3 },
      { offsetX: 0, offsetY: 8, cellsWide: 3, cellsTall: 1, numTile: 3 },
      { offsetX: 0, offsetY: 16, cellsWide: 3, cellsTall: 1, numTile: 3 },
    ],
  };
  const tiles = solidVar();
  const c = composeFrameCanvas(frame, tiles, 24, 24);
  const rects = frameTileRects(frame);
  const ppm = buildPpm(64, 64, 0x40);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) ppm.rgb[(y * 64 + x) * 3 + 1] = (x * 7) & 0xff;
  const colors = { 1: [0x11, 0x22, 0x33], 2: [0x22, 0x33, 0x11], 3: [0x33, 0x11, 0x22], 4: [0xee, 0x11, 0x11], 5: [0x11, 0xee, 0x11], 6: [0x11, 0x11, 0xee], 7: [0xee, 0xee, 0x11], 8: [0x11, 0xee, 0xee], 9: [0xee, 0x11, 0xee], 10: [0x77, 0x22, 0xcc], 11: [0x22, 0xcc, 0x77], 12: [0xcc, 0x77, 0x22], 13: [0x40, 0x80, 0xc0], 14: [0x80, 0xc0, 0x40], 15: [0xc0, 0x40, 0x80] };
  const ox = 20;
  const oy = 30;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const idx = c.pixelAt(x, y);
      if (idx < 0) continue;
      const [r, g, b] = colors[idx];
      const o = ((oy + y) * 64 + ox + x) * 3;
      ppm.rgb[o] = r; ppm.rgb[o + 1] = g; ppm.rgb[o + 2] = b;
    }
  // oclusión: a terceira fila de bloques (tiles 6,7,8) píntase por riba con ruído
  for (let y = 16; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const o = ((oy + y) * 64 + ox + x) * 3;
      ppm.rgb[o] = 0x01; ppm.rgb[o + 1] = (x * 7) & 0xff; ppm.rgb[o + 2] = (y * 5) & 0xff;
    }
  const placements = voteCanvasPlacement(c, rects, ppm, { minTiles: 3 });
  // a orden é por matchedTiles: a orixe real preside; sub-cadros desprazados
  // que resultan consistentes teñen estritamente menos células coincidentes
  assert.ok(placements.length >= 1);
  assert.equal(placements[0].originX, ox);
  assert.equal(placements[0].originY, oy);
  assert.equal(placements[0].matchedTiles, 6); // só dous bloques superviventes
  assert.equal(placements[0].consideredTiles, 8); // tile 6 (2 cores) non conta
  assert.ok(placements.slice(1).every((p) => p.matchedTiles < 6));
  assert.ok(placements[0].placementColors >= 6);
});

test("voteCanvasPlacement: sen instancia real do frame -> ningunha colocación", () => {
  const frame = { sprites: [{ offsetX: 0, offsetY: 0, cellsWide: 3, cellsTall: 1, numTile: 3 }] };
  const c = composeFrameCanvas(frame, solidVar().slice(0, 3), 24, 8);
  const ppm = buildPpm(48, 48, 0x40);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const o = (y * 48 + x) * 3;
    ppm.rgb[o] = (x * 5) & 0xff; ppm.rgb[o + 1] = (y * 3) & 0xff; ppm.rgb[o + 2] = ((x ^ y) * 7) & 0xff;
  }
  const placements = voteCanvasPlacement(c, frameTileRects(frame), ppm, { minTiles: 3 });
  assert.deepEqual(placements, []);
});

test("voteCanvasPlacement: fondo plano + sprite monocromo -> ningunha colocación (células ricas insuficientes)", () => {
  // 3x3 bloques sólidos (1 índice por célula): contra un fondo plano cada
  // célula é trivialmente consistente. minRichCells debe rexeitalo.
  const frame = { sprites: [{ offsetX: 0, offsetY: 0, cellsWide: 3, cellsTall: 3, numTile: 9 }] };
  const tiles = Array.from({ length: 9 }, (_, k) => tileSolid(k + 1));
  const c = composeFrameCanvas(frame, tiles, 24, 24);
  const ppm = buildPpm(48, 48, 0x40); // fondo uniforme
  const placements = voteCanvasPlacement(c, frameTileRects(frame), ppm, { minTiles: 3, minRichCells: 6 });
  assert.deepEqual(placements, []);
});

test("voteCanvasPlacement: o orixe real preside tamén con minRichCells=6; desprazamentos con <6 células ricas caen", () => {
  const frame = {
    sprites: [
      { offsetX: 0, offsetY: 0, cellsWide: 3, cellsTall: 1, numTile: 3 },
      { offsetX: 0, offsetY: 8, cellsWide: 3, cellsTall: 1, numTile: 3 },
      { offsetX: 0, offsetY: 16, cellsWide: 3, cellsTall: 1, numTile: 3 },
    ],
  };
  const tiles = solidVar();
  const c = composeFrameCanvas(frame, tiles, 24, 24);
  const rects = frameTileRects(frame);
  const ppm = buildPpm(64, 64, 0x40);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) ppm.rgb[(y * 64 + x) * 3 + 1] = (x * 7) & 0xff;
  const colors = { 1: [0x11, 0x22, 0x33], 2: [0x22, 0x33, 0x11], 3: [0x33, 0x11, 0x22], 4: [0xee, 0x11, 0x11], 5: [0x11, 0xee, 0x11], 6: [0x11, 0x11, 0xee], 7: [0xee, 0xee, 0x11], 8: [0x11, 0xee, 0xee], 9: [0xee, 0x11, 0xee], 10: [0x77, 0x22, 0xcc], 11: [0x22, 0xcc, 0x77], 12: [0xcc, 0x77, 0x22], 13: [0x40, 0x80, 0xc0], 14: [0x80, 0xc0, 0x40], 15: [0xc0, 0x40, 0x80] };
  const ox = 20;
  const oy = 30;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const idx = c.pixelAt(x, y);
      if (idx < 0) continue;
      const [r, g, b] = colors[idx];
      const o = ((oy + y) * 64 + ox + x) * 3;
      ppm.rgb[o] = r; ppm.rgb[o + 1] = g; ppm.rgb[o + 2] = b;
    }
  const placements = voteCanvasPlacement(c, rects, ppm, { minTiles: 3, minRichCells: 6 });
  assert.ok(placements.length >= 1);
  assert.equal(placements[0].originX, ox);
  assert.equal(placements[0].originY, oy);
  assert.ok(placements[0].richCells >= 6);
});

// --- evidencia real (negativa, honesta): ningun frame de sprite LZ4W da
// cadea validada aparece visible nos checkpoints autorizados. Os catro
// checkpoints (059/069/129/179) son a pantalla de titulo en fases de fade
// de paleta — a secuencia REX-00 nunca chegou ao gameplay. O recurso
// realmente visible é un TiledImage APLIB (ver tiledimage.test.mjs), e a
// retracción das afirmacións previas 0x22a2a/0x24948 está no informe.
const have = existsSync(ROM_PATH) && existsSync(`${EVID}/checkpoint-129.ppm`);
test(
  "evidencia (negativa): cero colocacions de frames LZ4W en checkpoint-129, con formato planar E chunky",
  { skip: have ? false : "ROM ou evidencia ausente", timeout: 30 * 60 * 1000 },
  () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const { definitions } = validateRom(rom);
    const ppm = readPpmP6(readFileSync(`${EVID}/checkpoint-129.ppm`));
    for (const tileFormat of ["planar", "chunky"]) {
      const hits = scanDefsForVisibility(rom, definitions, ppm, {
        minTiles: 8,
        minRichCells: 8,
        tileFormat,
      });
      assert.deepEqual(hits, [], `${tileFormat}: esperadas 0 colocacións, haber ${hits.length}`);
    }
  }
);
