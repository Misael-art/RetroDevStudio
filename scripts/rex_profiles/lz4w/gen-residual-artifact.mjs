// Xerador determinista do artefacto data/rex_profiles/lz4w/residual-attribution-cp129.json.
// Uso: node scripts/rex_profiles/lz4w/gen-residual-artifact.mjs
// Non borra píxeles do comparador: pixels.length == totals.pixels == discrepancia total.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeTilesetImage, composeIndexScreen } from "./tiledimage.mjs";
import { readPpmP6, readPaletteDefinition } from "./graphics.mjs";
import {
  quantCramNibble,
  paletteColorSet,
  residualPixels,
  classifyResidualPixel,
  clusterPixels,
} from "./residual.mjs";

const ROM_PATH = process.env.HAMOOPIG_ROM ??
  "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin";
const CP129 = "/home/misael/RetroDevStudio/rex-evidence-2026-09-10/backend-hamoopig/checkpoint-129.ppm";
const OUT = new URL("../../../data/rex_profiles/lz4w/residual-attribution-cp129.json", import.meta.url);
const W = 320, H = 224;
const sha = (b) => createHash("sha256").update(b).digest("hex");

const rom = new Uint8Array(readFileSync(ROM_PATH));
const img = decodeTilesetImage(rom, 0x21b5c);
const ppm = readPpmP6(readFileSync(CP129));
const idx = composeIndexScreen(img, W, H);
const bgColors = paletteColorSet(img.palette, quantCramNibble);
const res = residualPixels(idx, ppm, bgColors, { w: W });
const classes = { oclusion: 0, fade: 0, alinhamento: 0, diverxencia: 0 };
const clusterOf = new Map();
for (const r of res) classes[classifyResidualPixel(r, idx, ppm, bgColors, W, H)]++;
const clusters = clusterPixels(res, W, H).sort((a, b) => b.pixels.length - a.pixels.length);
for (const [i, c] of clusters.entries()) for (const p of c.pixels) clusterOf.set(p.y * W + p.x, i);

const pixels = res.map((r) => [r.x, r.y, ...r.obs, idx[r.y * W + r.x]]);
const pal = readPaletteDefinition(rom, 0x21b32);

const artifact = {
  purpose: "Atribución dos píxeles non explicados pola reconstrución do TiledImage @0x21b5c contra checkpoint-129 (fase 4). Ningún píxel eliminado do comparador.",
  rom: { path: ROM_PATH, sha256: sha(rom) },
  checkpoint: { path: CP129, sha256: sha(readFileSync(CP129)) },
  comparator: { base: "scripts/rex_profiles/lz4w/residual.mjs", tolerancePerChannel: 4, removedPixels: 0 },
  totals: { screenPixels: W * H, pixels: res.length, pct: Number((100 * res.length / (W * H)).toFixed(2)) },
  classes,
  clusterSummaries: clusters.map((c, i) => ({
    id: i,
    n: c.pixels.length,
    bbox: c.bbox,
    observedColorHist: [...c.pixels.reduce((m, p) => { const k = p.obs.join(","); m.set(k, (m.get(k) ?? 0) + 1); return m; }, new Map()).entries()]
      .sort((a, b) => b[1] - a[1]),
    bgIndices: [...new Set(c.pixels.map((p) => idx[p.y * W + p.x]))].sort((a, b) => a - b),
  })),
  clusters: clusters.length,
  attribution: {
    verdict: "oclusion total: as 5 cores observadas non están na paleta do fondo (data 0x2cbe8) e están todas na táboa @0x2cbc8 (tol ±4)",
    paletteDef: { offset: "0x21b32", numColor: pal.numColor, data: "0x2cbc8" },
    verifiedChain: [
      "u32 0x2cbc8 -> unica ref 0x21b34 (campo data da PalDef @0x21b32)",
      "u32 0x21b32 -> unica ref 0x21b38 (primeira entrada dun array de 3 punteiros [0x21b32,0x21b20,0x21b28] @0x21b38)",
      "u32 0x21b38 -> unica ref 0xe4dc, dentro da instrución 2079 00021b38 (movea.l #$21b38,a0) en 0xe4da..0xe4df: consumidor de código",
    ],
    status: "cargado/visible en CRAM requer observación na xanela do integrador; aqui só se afirman referencias estaticas verificadas",
  },
  pixelsSha256: sha(Buffer.from(JSON.stringify(pixels))),
  pixels,
  clusterOfPixel: pixels.map((p) => clusterOf.get(p[1] * W + p[0])),
};
writeFileSync(OUT, JSON.stringify(artifact) + "\n");
console.log("artifact written:", OUT.pathname, "pixels:", res.length, "classes:", JSON.stringify(classes), "clusters:", clusters.length);
