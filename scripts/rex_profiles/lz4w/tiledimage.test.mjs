// Evidencia ROM real: TiledImage da pantalla de titulo de HAMOOPIG
// (recurso APLIB realmente usado en tela — "personagem parado" / elemento
// persistente). Reconstrución index->color dende tileset+tilemap+palette da
// ROM comparada con checkpoint-129.ppm (PPM byte-identico a checkpoint-179).
// Proba tamén a relacion tiles/posicion/flips/paleta con discriminadores
// (chunky-vs-planar, con-vs-sen flips).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { readPpmP6, readPaletteDefinition } from "./graphics.mjs";
import { readTiledImage, decodeTilesetImage, composeIndexScreen } from "./tiledimage.mjs";

const ROM_PATH =
  process.env.HAMOOPIG_ROM ??
  "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin";
const CP129 = "/home/misael/RetroDevStudio/rex-evidence-2026-09-10/backend-hamoopig/checkpoint-129.ppm";
const have = existsSync(ROM_PATH) && existsSync(CP129);

// TiledImage localizado na fase de inventario dirigido (lecturas puntuais,
// non grafo de punteiros: verificados campo a campo contra SGDK 2.11).
const TI_OFF = 0x21b5c;
const SCREEN_W = 320;
const SCREEN_H = 224;

const loadRom = () => new Uint8Array(readFileSync(ROM_PATH));

// utilidades locais de teste: puntuación pixel a pixel contra a cor
// cuantizada da paleta ROM (non se expondo na produción só para tests)
const QUANT = (v) => Math.round((v >> 1) * 239 / 7);
const pixelScore = (img, ppm, decodeTile, useFlips) => {
  let hits = 0;
  for (let y = 0; y < img.mapH; y++)
    for (let x = 0; x < img.mapW; x++) {
      const e = img.entries[y * img.mapW + x];
      const tile = e & 0x7ff;
      const fh = useFlips ? (e >> 11) & 1 : 0;
      const fv = useFlips ? (e >> 12) & 1 : 0;
      const px = decodeTile(img.tileBytes.subarray(tile * 32, tile * 32 + 32));
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const sx = fh ? 7 - i : i;
          const sy = fv ? 7 - j : j;
          const p = (y * 8 + j) * SCREEN_W + x * 8 + i;
          const k = px[sy * 8 + sx];
          const en = img.palette.entries[k];
          if (
            Math.abs(ppm.rgb[p * 3] - QUANT(en.r)) <= 4 &&
            Math.abs(ppm.rgb[p * 3 + 1] - QUANT(en.g)) <= 4 &&
            Math.abs(ppm.rgb[p * 3 + 2] - QUANT(en.b)) <= 4
          )
            hits++;
        }
    }
  return hits / (SCREEN_W * SCREEN_H);
};
const planarTile = (t) => {
  const px = new Array(64);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      let v = 0;
      for (let pl = 0; pl < 4; pl++) v |= ((t[r * 4 + pl] >> (7 - c)) & 1) << pl;
      px[r * 8 + c] = v;
    }
  return px;
};
const chunkyTile = (t) => {
  const px = new Array(64);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const b = t[r * 4 + (c >> 1)];
      px[r * 8 + c] = c % 2 === 0 ? b >> 4 : b & 15;
    }
  return px;
};



test("readTiledImage: estrutura {palette*, tileset*, tilemap*} en 0x21b5c", () => {
  const rom = loadRom();
  const ti = readTiledImage(rom, TI_OFF);
  assert.deepEqual(ti, { palettePtr: 0x21b56, tilesetPtr: 0x21b44, tilemapPtr: 0x21b4c });
});

test("decodeTilesetImage: streams APLIB cos tamaños exactos declarados", () => {
  const rom = loadRom();
  const img = decodeTilesetImage(rom, TI_OFF);
  assert.equal(img.compression, 1); // APLIB
  assert.equal(img.numTile, 500);
  assert.equal(img.tileBytes.length, 500 * 32);
  assert.equal(img.mapW, 40);
  assert.equal(img.mapH, 28);
  assert.equal(img.entries.length, 40 * 28);
  assert.equal(img.tilesConsumed, 4485); // fingerprint do fluxo @0x2e4d4
  assert.equal(img.mapConsumed, 1196); // fingerprint do fluxo @0x2d534
  assert.equal(img.palette.numColor, 16);
});

const SKIP_MSG = have ? false : "ROM ou evidencia ausente";

test(
  "evidencia: pantalla reconstruida (chunky+flips) — indices non ocluidos con cor unica e asociada á paleta ROM",
  { skip: SKIP_MSG },
  () => {
    const rom = loadRom();
    const img = decodeTilesetImage(rom, TI_OFF);
    const ppm = readPpmP6(readFileSync(CP129));
    const idx = composeIndexScreen(img, SCREEN_W, SCREEN_H);
    // todos os entries do mapa usan banco de paleta 0
    for (const e of img.entries) assert.equal((e >> 13) & 3, 0);
    // cor por indice de paleta
    const byIdx = new Map();
    for (let p = 0; p < SCREEN_W * SCREEN_H; p++) {
      const k = idx[p];
      const rgb = [ppm.rgb[p * 3], ppm.rgb[p * 3 + 1], ppm.rgb[p * 3 + 2]];
      if (!byIdx.has(k)) byIdx.set(k, new Map());
      const m = byIdx.get(k);
      const key = rgb.join(",");
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    // (a) cuantización observable: 4bits CRAM -> (v>>1) escalado a 0..239
    const quant = (v) => Math.round((v >> 1) * 239 / 7);
    const colorOf = (i) => {
      const e = img.palette.entries[i];
      return [quant(e.r), quant(e.g), quant(e.b)];
    };
    let majorityHits = 0;
    let cleanIndices = 0;
    for (const [k, m] of byIdx) {
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
      const [majColor, majN] = sorted[0];
      majorityHits += majN;
      const exp = colorOf(k).join(",");
      // (b) a cor dominante de CADA indice debe ser a cor cuantizada da
      // entrada k da paleta ROM: asociación indice<->paleta probada.
      const [r, g, b] = majColor.split(",").map(Number);
      const [er, eg, eb] = colorOf(k);
      assert.ok(Math.abs(r - er) <= 4 && Math.abs(g - eg) <= 4 && Math.abs(b - eb) <= 4,
        `indice ${k}: cor ${majColor} non corresponde á entrada ROM ${exp}`);
      // (c) >=12 indices totalmente libres de oclusión (unha soa cor)
      if (m.size === 1) cleanIndices++;
    }
    assert.ok(cleanIndices >= 12, `só ${cleanIndices} indices sen oclusión`);
    // (d) >=95% de pixels explicados (o resto son sprites por riba do plano A)
    assert.ok(majorityHits / (SCREEN_W * SCREEN_H) >= 0.95,
      `match ${((100 * majorityHits) / (SCREEN_W * SCREEN_H)).toFixed(2)}%`);
  },
);

test(
  "discriminador: tiles planares (formato incorrecto) non reconstrúen a pantalla",
  { skip: SKIP_MSG },
  () => {
    const rom = loadRom();
    const img = decodeTilesetImage(rom, TI_OFF);
    const ppm = readPpmP6(readFileSync(CP129));
    const real = pixelScore(img, ppm, chunkyTile, true);
    const planar = pixelScore(img, ppm, planarTile, true);
    assert.ok(real >= 0.9, `match real ${real.toFixed(2)}`);
    assert.ok(planar < real - 0.2, `planar ${planar.toFixed(2)} non queda lonxe de ${real.toFixed(2)}`);
  },
);

test(
  "discriminador: ignorar flips (h/v) degrada a reconstruccion respecto do real",
  { skip: SKIP_MSG },
  () => {
    const rom = loadRom();
    const img = decodeTilesetImage(rom, TI_OFF);
    const ppm = readPpmP6(readFileSync(CP129));
    // hai entradas con flip (15 h / 27 v na ROM) — se non, o test non ten sentido
    const flipped = img.entries.filter((e) => (e >> 11) & 3).length;
    assert.ok(flipped > 0, "tilemap sen flips: discriminador non aplicable");
    const real = pixelScore(img, ppm, chunkyTile, true);
    const noflip = pixelScore(img, ppm, chunkyTile, false);
    assert.ok(noflip < real, `sen flips ${noflip.toFixed(4)} >= real ${real.toFixed(4)}`);
  },
);

test("readPaletteDefinition segue sendo a fonte das 16 cores do TiledImage", () => {
  const rom = loadRom();
  const ti = readTiledImage(rom, TI_OFF);
  const p = readPaletteDefinition(rom, ti.palettePtr);
  assert.equal(p.numColor, 16);
  assert.deepEqual(p.entries[0], { r: 0, g: 0, b: 0 });
  assert.deepEqual(p.entries[1], { r: 0, g: 0, b: 10 });
  assert.deepEqual(p.entries[13], { r: 14, g: 14, b: 14 });
});
