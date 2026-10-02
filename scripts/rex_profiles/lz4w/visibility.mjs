// Composición frame->canvas e busca pixel-set (agnóstica de paleta) nun
// framebuffer PPM. Diferencia "reachable" (cadea validada, ver sgdk-sprite.mjs)
// de "visible": un frame só é visible se tódolos seus píxeles opacos (índice>0)
// casan EXACTAMENTE coa imaxe real, coa súa posición na canvas e coas
// variantes de flip (o motor espella offsets e tiles: offsetXFlip =
// canvasW-offX-w*8, VDPSprite.java:32-33, polo que flip completo == canvas
// espellada).
import { decodeTilePlanar4, decodeTileChunky4 } from "./graphics.mjs";
import { lz4wDecode } from "./lz4w.mjs";
import { COMPRESSION } from "./sgdk-sprite.mjs";

const BYTES_PER_TILE = 32;

/**
 * Canvas defW x defH co frame composto. data[i] = índice de paleta (1..15)
 * ou -1 (transparente: índice 0 de sprite ou oco). Os VDPSprite consomen
 * tiles secuenciais do tileset en orde fila-major (sprite_eng.c:1561
 * `attr += frameSprite->numTile`).
 */
export function composeFrameCanvas(frame, tiles, defW, defH) {
  const data = new Int16Array(defW * defH).fill(-1);
  let cursor = 0;
  for (const s of frame.sprites) {
    for (let ty = 0; ty < s.cellsTall; ty++)
      for (let tx = 0; tx < s.cellsWide; tx++) {
        const t = tiles[cursor++];
        if (t === undefined) throw new Error("tileset sen tiles para o frame");
        for (let py = 0; py < 8; py++)
          for (let px = 0; px < 8; px++) {
            const x = s.offsetX + tx * 8 + px;
            const y = s.offsetY + ty * 8 + py;
            if (x >= defW || y >= defH) continue;
            const v = t[py * 8 + px];
            data[y * defW + x] = v === 0 ? -1 : v;
          }
      }
  }
  let opaqueCount = 0;
  for (const v of data) if (v > 0) opaqueCount++;
  return {
    width: defW,
    height: defH,
    data,
    opaqueCount,
    pixelAt: (x, y) => data[y * defW + x],
  };
}

export function flipCanvas(canvas, flipH, flipV) {
  const { width: w, height: h, data } = canvas;
  const out = new Int16Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = flipH ? w - 1 - x : x;
      const sy = flipV ? h - 1 - y : y;
      out[y * w + x] = data[sy * w + sx];
    }
  return { width: w, height: h, data: out, opaqueCount: canvas.opaqueCount, pixelAt: (x, y) => out[y * w + x] };
}

const quantPpm = (ppm) => {
  const q = new Uint16Array(ppm.width * ppm.height);
  for (let i = 0; i < q.length; i++) {
    const r = Math.round((ppm.rgb[i * 3] * 15) / 255);
    const g = Math.round((ppm.rgb[i * 3 + 1] * 15) / 255);
    const b = Math.round((ppm.rgb[i * 3 + 2] * 15) / 255);
    q[i] = r | (g << 4) | (b << 8);
  }
  return q;
};

/**
 * Busca o canvas no PPM: para cada posición, o conxunto opaco debe admitir un
 * mapa índice->cor CONSISTENTE (índices distintos poden compartir cor; nunca
 * un índice con dúas cores). requírense minOpaque píxeles e minDistinct
 * índices distintos para descartar falsos positivos por azar.
 */
export function searchCanvasInPpm(canvas, ppm, { minOpaque = 120, minDistinct = 4, minColors = minDistinct } = {}) {
  const { width: w, height: h, data } = canvas;
  const pxs = [];
  const idxSeen = new Set();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      if (v > 0) {
        pxs.push(x, y, v);
        idxSeen.add(v);
      }
    }
  if (pxs.length / 3 < minOpaque || idxSeen.size < minDistinct) return [];
  const q = quantPpm(ppm);
  const hits = [];
  const map = new Int16Array(16).fill(-1);
  const colorSeen = new Set();
  for (let fy = 0; fy + h <= ppm.height; fy++)
    for (let fx = 0; fx + w <= ppm.width; fx++) {
      map.fill(-1);
      colorSeen.clear();
      let ok = true;
      let distinct = 0;
      let injective = true;
      for (let i = 0; i < pxs.length && ok; i += 3) {
        const idx = pxs[i + 2];
        const c = q[(fy + pxs[i + 1]) * ppm.width + fx + pxs[i]];
        if (map[idx] === -1) {
          map[idx] = c;
          if (colorSeen.has(c)) injective = false;
          colorSeen.add(c);
          distinct++;
        } else if (map[idx] !== c) ok = false;
      }
      // minColors exige cores distintas: un canvas contra un fondo uniforme
      // non pode producir un hit significativo (anti-falso-positivo).
      if (ok && colorSeen.size >= minColors)
        hits.push({
          x: fx,
          y: fy,
          opaqueChecked: pxs.length / 3,
          distinctIndices: distinct,
          injective,
          mapping: [...map],
        });
    }
  return hits;
}

/** Un rect 8x8 por célula de bloque, na orde de consumo de tiles do motor. */
export function frameTileRects(frame) {
  const rects = [];
  let ti = 0;
  for (const s of frame.sprites)
    for (let ty = 0; ty < s.cellsTall; ty++)
      for (let tx = 0; tx < s.cellsWide; tx++)
        rects.push({ tileIdx: ti++, x: s.offsetX + tx * 8, y: s.offsetY + ty * 8 });
  return rects;
}

/**
 * Busca tolerante a oclusión: cada célula 8x8 do canvas búscase no PPM cun
 * mapa índice->cor consistente; as orixes implicadas (fx-rectX, fy-rectY)
 * votesan; tras a intersección de 2 anchors complexos, verifícanse tódalas
 * células na orixe candidata. Unha persoeiro parcialmente tapado (por outro
 * sprite, HUD ou borde da pantalla) aínda produce evidencia xeométrica.
 */
export function voteCanvasPlacement(
  canvas,
  rects,
  ppm,
  { minTiles = 3, minCoverage = 0, tileMinOpaque = 12, tileMinColors = 3, minPlacementColors = 4, minRichCells = 0, anchorCount = 2 } = {},
) {
  const { width: cw, data } = canvas;
  const rectPxs = rects.map((r) => {
    const l = [];
    const idxs = new Set();
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const v = data[(r.y + y) * cw + r.x + x];
        if (v > 0) {
          l.push(x, y, v);
          idxs.add(v);
        }
      }
    return { l, opaque: l.length / 3, colors: idxs.size };
  });
  const good = rects
    .map((_, i) => i)
    .filter((i) => rectPxs[i].opaque >= tileMinOpaque && rectPxs[i].colors >= tileMinColors);
  if (good.length < minTiles) return [];
  const q = quantPpm(ppm);
  const map = new Int16Array(16);
  const colorSeen = new Set();
  const searchRect = (i) => {
    const { l } = rectPxs[i];
    const r = rects[i];
    const found = [];
    for (let fy = 0; fy + 8 <= ppm.height; fy++)
      for (let fx = 0; fx + 8 <= ppm.width; fx++) {
        map.fill(-1);
        let ok = true;
        for (let p = 0; p < l.length && ok; p += 3) {
          const idx = l[p + 2];
          const c = q[(fy + l[p + 1]) * ppm.width + fx + l[p]];
          if (map[idx] === -1) map[idx] = c;
          else if (map[idx] !== c) ok = false;
        }
        if (ok) found.push(fx - r.x, fy - r.y);
      }
    return found;
  };
  const byComplexity = [...good].sort((a, b) => rectPxs[b].opaque * rectPxs[b].colors - rectPxs[a].opaque * rectPxs[a].colors);
  const anchors = byComplexity.slice(0, Math.min(anchorCount, byComplexity.length));
  const votes = new Map(); // "ox,oy" -> Set<tileIdx>
  const first = searchRect(anchors[0]);
  for (let k = 0; k < first.length; k += 2) votes.set(`${first[k]},${first[k + 1]}`, new Set([rects[anchors[0]].tileIdx]));
  for (const ai of anchors.slice(1)) {
    const found = searchRect(ai);
    for (let k = 0; k < found.length; k += 2) {
      const prev = votes.get(`${found[k]},${found[k + 1]}`);
      if (prev !== undefined) prev.add(rects[ai].tileIdx);
    }
  }
  const minVotes = anchors.length > 1 ? 2 : 1;
  const placements = [];
  for (const [key, set] of votes) {
    if (set.size < minVotes) continue;
    const [ox, oy] = key.split(",").map(Number);
    let matched = 0;
    let richCells = 0;
    const placementColors = new Set();
    for (const i of good) {
      const { l } = rectPxs[i];
      const r = rects[i];
      const fx = ox + r.x;
      const fy = oy + r.y;
      if (fx < 0 || fy < 0 || fx + 8 > ppm.width || fy + 8 > ppm.height) continue;
      map.fill(-1);
      colorSeen.clear();
      let ok = true;
      for (let p = 0; p < l.length && ok; p += 3) {
        const idx = l[p + 2];
        const c = q[(fy + l[p + 1]) * ppm.width + fx + l[p]];
        if (map[idx] === -1) {
          map[idx] = c;
          colorSeen.add(c);
        } else if (map[idx] !== c) ok = false;
      }
      if (ok) {
        matched++;
        if (colorSeen.size >= 2) richCells++;
        for (const cc of colorSeen) placementColors.add(cc);
      }
    }
    // a riqueza de cores exíxese a nivel de colocación (non por célula):
    // tiles reais de 1 cor non poden descartarse, pero un fondo plano xamais
    // acumula minPlacementColors cores distintas. minRichCells esixe ademais
    // células cuxo mapa contén ≥2 cores: un fondo plano só satisfai células
    // monocromas, nunca ricas.
    if (
      matched >= minTiles &&
      matched / good.length >= minCoverage &&
      placementColors.size >= minPlacementColors &&
      richCells >= minRichCells
    )
      placements.push({
        originX: ox,
        originY: oy,
        matchedTiles: matched,
        consideredTiles: good.length,
        placementColors: placementColors.size,
        richCells,
      });
  }
  placements.sort((a, b) => b.matchedTiles - a.matchedTiles);
  return placements;
}

/** Decodifica os tiles (índices 8x8) dun TileSet da ROM (NONE ou LZ4W prev-block). */
export function decodeTileSetTiles(rom, tileSet, { tileFormat = "planar" } = {}) {
  let bytes;
  if (tileSet.compression === COMPRESSION.NONE) {
    bytes = rom.subarray(tileSet.tiles, tileSet.tiles + tileSet.numTile * BYTES_PER_TILE);
  } else if (tileSet.compression === COMPRESSION.LZ4W) {
    const out = lz4wDecode(rom.slice(tileSet.tiles), rom.slice(0, tileSet.tiles));
    bytes = out.data;
  } else {
    return null; // APLIB fóra do alcance desta fase
  }
  if (bytes.length < tileSet.numTile * BYTES_PER_TILE) return null;
  const decodeTile = tileFormat === "chunky" ? decodeTileChunky4 : decodeTilePlanar4;
  const tiles = [];
  for (let i = 0; i < tileSet.numTile; i++)
    tiles.push(decodeTile(bytes.subarray(i * BYTES_PER_TILE, (i + 1) * BYTES_PER_TILE)));
  return tiles;
}

/**
 * Barre tódolos frames de tódalas definicións validadas buscando colocacións
 * exactas (tolerantes a oclusión) no framebuffer. `variants`: ["","h","v","hv"].
 */
export function scanDefsForVisibility(
  rom,
  definitions,
  ppm,
  { minTiles = 8, minRichCells = 0, variants = ["", "h", "v", "hv"], tileFormat = "planar" } = {},
) {
  const tileCache = new Map();
  const results = [];
  for (const def of definitions) {
    const doneStreams = new Set();
    for (const frame of def.frames) {
      const ts = frame.tileSet;
      if (doneStreams.has(ts.tiles)) continue;
      doneStreams.add(ts.tiles);
      let tiles = tileCache.get(ts.tiles);
      if (tiles === undefined) {
        tiles = decodeTileSetTiles(rom, ts, { tileFormat });
        tileCache.set(ts.tiles, tiles);
      }
      if (tiles === null) continue;
      let base;
      try {
        base = composeFrameCanvas(frame, tiles, def.w, def.h);
      } catch {
        continue; // tileset non cubre as células declaradas
      }
      const baseRects = frameTileRects(frame);
      let foundVariant = false;
      for (const v of variants) {
        const canvas = v === "" ? base : flipCanvas(base, v.includes("h"), v.includes("v"));
        let rects = baseRects;
        if (v !== "")
          rects = baseRects.map((r) => ({
            tileIdx: r.tileIdx,
            x: v.includes("h") ? def.w - 8 - r.x : r.x,
            y: v.includes("v") ? def.h - 8 - r.y : r.y,
          }));
        for (const p of voteCanvasPlacement(canvas, rects, ppm, { minTiles, minCoverage: 0.7, minRichCells })) {
          foundVariant = true;
          results.push({
            defOffset: def.offset,
            animationIndex: frame.animationIndex,
            frameIndex: frame.frameIndex,
            frameOffset: frame.offset,
            tileSetOffset: ts.offset,
            streamOffset: ts.tiles,
            compression: ts.compression,
            numTile: ts.numTile,
            paletteDef: def.palette,
            defW: def.w,
            defH: def.h,
            flip: v,
            originX: p.originX,
            originY: p.originY,
            matchedTiles: p.matchedTiles,
            consideredTiles: p.consideredTiles,
            placementColors: p.placementColors,
            richCells: p.richCells,
          });
        }
        if (foundVariant) break; // variante normal ten prioridade
      }
    }
  }
  return results;
}
