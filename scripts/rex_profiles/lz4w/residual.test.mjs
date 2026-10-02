// Fase 4 (directiva): "Documente quais pixels explican os 4,10% restantes da
// reconstrución: oclusão, fade, alinhamento ou divergência. Non elimine pixels
// do comparador só porque non coinciden."
// Expectativas RED fixadas a partir das medicións no probe (sen tocar o
// comparador base): cp129 vs reconstrución TiledImage @0x21b5c = 2938 px
// discrepantes (4.10% de 71680). As 5 cores observadas
// ([239,0,0]:1082, [140,101,66]:919, [99,69,66]:726, [239,138,140]:125,
// [140,0,0]:86) NON están na paleta do fondo (0x2cbe8) e SI están todas na
// táboa @0x2cbc8, accesible via Palette definition @0x21b32 {numColor=16,
// data=0x2cbc8}, que é a primeira entrada dun array de 3 punteiros @0x21b38
// consumido por código (`movea.l #$21b38,a0` en 0xe4da..0xe4df).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { decodeTilesetImage, composeIndexScreen } from "./tiledimage.mjs";
import { readPpmP6, readPaletteDefinition } from "./graphics.mjs";
import {
  quantCramNibble,
  paletteColorSet,
  residualPixels,
  classifyResidualPixel,
  clusterPixels,
} from "./residual.mjs";

const ROM_PATH =
  process.env.HAMOOPIG_ROM ??
  "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin";
const CP129 = "/home/misael/RetroDevStudio/rex-evidence-2026-09-10/backend-hamoopig/checkpoint-129.ppm";
const ARTIFACT = new URL("../../../data/rex_profiles/lz4w/residual-attribution-cp129.json", import.meta.url);
const have = existsSync(ROM_PATH) && existsSync(CP129);
const rom = have ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const W = 320, H = 224;

function screen() {
  const img = decodeTilesetImage(rom, 0x21b5c);
  const ppm = readPpmP6(readFileSync(CP129));
  const idx = composeIndexScreen(img, W, H);
  const bgColors = paletteColorSet(img.palette, quantCramNibble);
  return { img, ppm, idx, bgColors };
}

test("residuo cp129: exactamente 2938 px (4.10%) — NINGÚN eliminado do comparador", { skip: !have }, () => {
  const { ppm, idx, bgColors } = screen();
  const res = residualPixels(idx, ppm, bgColors);
  assert.equal(res.length, 2938);
  assert.ok(2938 / (W * H) > 0.04 && 2938 / (W * H) < 0.042);
  const hist = new Map();
  for (const r of res) { const k = r.obs.join(","); hist.set(k, (hist.get(k) ?? 0) + 1); }
  assert.deepEqual([...hist.entries()].sort((a, b) => b[1] - a[1]), [
    ["239,0,0", 1082], ["140,101,66", 919], ["99,69,66", 726], ["239,138,140", 125], ["140,0,0", 86],
  ]);
});

test("clasificación: 2938 oclusión; fade=0, alinhamento=0, diverxencia=0", { skip: !have }, () => {
  const { ppm, idx, bgColors } = screen();
  const res = residualPixels(idx, ppm, bgColors);
  const tally = { oclusion: 0, fade: 0, alinhamento: 0, diverxencia: 0 };
  for (const r of res) tally[classifyResidualPixel(r, idx, ppm, bgColors, W, H)]++;
  assert.deepEqual(tally, { oclusion: 2938, fade: 0, alinhamento: 0, diverxencia: 0 });
});

test("agrupamento: 13 componentes 8-conectados; maior = 533 px en bbox [195,188..228,209]", { skip: !have }, () => {
  const { ppm, idx, bgColors } = screen();
  const res = residualPixels(idx, ppm, bgColors);
  const clusters = clusterPixels(res, W, H);
  assert.equal(clusters.length, 13);
  assert.equal(clusters.reduce((s, c) => s + c.pixels.length, 0), 2938);
  const big = [...clusters].sort((a, b) => b.pixels.length - a.pixels.length)[0];
  assert.equal(big.pixels.length, 533);
  assert.deepEqual(big.bbox, [195, 188, 228, 209]);
});

test("atribución verificada: as 5 cores residuais viven na paleta @0x2cbc8 e NINGUNHA está na paleta do fondo", { skip: !have }, () => {
  const { ppm, idx, bgColors } = screen();
  const res = residualPixels(idx, ppm, bgColors);
  const pal = readPaletteDefinition(rom, 0x21b32);
  assert.equal(pal.numColor, 16);
  assert.equal(pal.data, 0x2cbc8, "a definición pinada SGDK ten os datos xusto na táboa medida");
  const oc = paletteColorSet(pal, quantCramNibble);
  for (const r of res) {
    assert.ok(!bgColors.some((c) => c.join(",") === r.obs.join(",")), `cor observable ${r.obs} non debería estar na paleta de fondo`);
    assert.ok(oc.some((c) => Math.abs(c[0] - r.obs[0]) <= 4 && Math.abs(c[1] - r.obs[1]) <= 4 && Math.abs(c[2] - r.obs[2]) <= 4),
      `cor observable ${r.obs.join(",")} sen atribución de paleta`);
  }
});

test("consumidor da paleta atribuída: refs encadeadas 0x2cbc8 <- 0x21b34 (PalDef @0x21b32) <- array @0x21b38 <- código 0xe4dc", { skip: !have }, () => {
  const be32 = (o) => ((rom[o] << 24) | (rom[o + 1] << 16) | (rom[o + 2] << 8) | rom[o + 3]) >>> 0;
  const refs = (t) => { const a = []; for (let o = 0; o + 4 <= rom.length; o++) if (be32(o) === t) a.push(o); return a; };
  assert.deepEqual(refs(0x2cbc8), [0x21b34]);
  assert.deepEqual(refs(0x21b32), [0x21b38]);
  assert.deepEqual(refs(0x21b38), [0xe4dc]);
  // instrución 68k real: 2079 00021b38 = movea.l #$21b38, a0 en 0xe4da
  assert.deepEqual([...rom.slice(0xe4da, 0xe4e0)], [0x20, 0x79, 0x00, 0x02, 0x1b, 0x38]);
  // o array contén 3 punteiros de Palette definition (0x21b32, 0x21b20, 0x21b28)
  assert.deepEqual([0x21b38, 0x21b3c, 0x21b40].map(be32), [0x21b32, 0x21b20, 0x21b28]);
});

test("artefacto data/…/residual-attribution-cp129.json reprodúcese byte a byte e non elimina ningún px", { skip: !have }, () => {
  const art = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const { ppm, idx, bgColors } = screen();
  const res = residualPixels(idx, ppm, bgColors);
  assert.equal(art.totals.pixels, res.length);
  assert.equal(art.totals.screenPixels, W * H);
  assert.deepEqual(art.classes, { oclusion: 2938, fade: 0, alinhamento: 0, diverxencia: 0 });
  assert.equal(art.clusters, 13);
  assert.equal(art.clusterSummaries[0].n, 533);
  assert.deepEqual(art.clusterSummaries[0].bbox, [195, 188, 228, 209]);
  assert.equal(art.pixels.length, 2938, "todos os píxeles presentes: nada eliminado do comparador");
  const sha = createHash("sha256").update(Buffer.from(JSON.stringify(art.pixels))).digest("hex");
  assert.equal(sha, art.pixelsSha256, "hash interno consistente coa lista de píxeles");
  for (let i = 0; i < res.length; i++) {
    assert.deepEqual(art.pixels[i], [res[i].x, res[i].y, ...res[i].obs, idx[res[i].y * W + res[i].x]], `px ${i}`);
  }
});
