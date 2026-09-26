// Comparador de residuos: píxeles da reconstrución TiledImage que non baten co
// checkpoint, clasificados (oclusion / fade / alinhamento / diverxencia) e
// agrupados en componentes conectados. Non elimina ningún píxel: o conxunto
// clasificado é sempre igual ao conxunto discrepante.
const nearTol = (a, b, t) => a.every((v, k) => Math.abs(v - b[k]) <= t);

/** Entrada CRAM de 4 bits -> canal observable (0,34,…,239). */
export function quantCramNibble(v) {
  return Math.round((v >> 1) * 239 / 7);
}

/** Palette definition (graphics.readPaletteDefinition) -> cores cuantizadas. */
export function paletteColorSet(pal, q = quantCramNibble) {
  return pal.entries.map((e) => [q(e.r), q(e.g), q(e.b)]);
}

/** Píxeles cuxa cor observable difire (>tol) da cor esperada do indice. */
export function residualPixels(idx, ppm, bgColors, { tol = 4, w = 320 } = {}) {
  const out = [];
  for (let p = 0; p < idx.length; p++) {
    const o = [ppm.rgb[p * 3], ppm.rgb[p * 3 + 1], ppm.rgb[p * 3 + 2]];
    if (nearTol(o, bgColors[idx[p]], tol)) continue;
    out.push({ x: p % w, y: (p / w) | 0, obs: o, exp: bgColors[idx[p]] });
  }
  return out;
}

/**
 * Unha soa etiqueta por píxel, nunha xerarquía excluínte:
 *  - alinhamento: a cor observable é a cor esperada dun veciño 8-conectado
 *    (desprazamento de tile/mapa).
 *  - fade: observable ~= k * esperado cun k único en [0.05, 0.9] (escurecido
 *    monocromo por canle, como fan as rutinas de fade).
 *  - oclusión: cor non reproducible pola paleta de fondo sen sinais de fade
 *    nin desprazamento => pintouna outro recurso.
 *  - diverxencia: calquera outro caso (p.ex. cor da propia paleta de fondo
 *    pero non esperada nin veciña: índice diverxente).
 */
export function classifyResidualPixel(r, idx, ppm, bgColors, w = 320, h = 224, tol = 4) {
  const o = r.obs;
  if (bgColors.some((c) => nearTol(c, o, tol))) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = r.x + dx, ny = r.y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (nearTol(bgColors[idx[ny * w + nx]], o, tol)) return "alinhamento";
      }
    return "diverxencia";
  }
  const e = r.exp;
  const ratios = e.map((ev, k) => (ev > 0 ? o[k] / ev : null)).filter((v) => v !== null);
  if (ratios.length) {
    for (const k0 of ratios) {
      if (k0 < 0.05 || k0 > 0.9) continue;
      const ok = e.every((ev, i) => (ev === 0 ? o[i] <= tol : Math.abs(o[i] - k0 * ev) <= 6));
      if (ok) return "fade";
    }
  }
  return "oclusion";
}

/** Componentes 8-conectados sobre a lista de residuos. */
export function clusterPixels(res, w = 320, h = 224) {
  const at = new Map();
  for (const r of res) at.set(r.y * w + r.x, r);
  const seen = new Set();
  const clusters = [];
  for (const r of res) {
    const key = r.y * w + r.x;
    if (seen.has(key)) continue;
    const stack = [r];
    const pixels = [];
    seen.add(key);
    while (stack.length) {
      const q = stack.pop();
      pixels.push(q);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = q.x + dx, ny = q.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (!seen.has(k) && at.has(k)) { seen.add(k); stack.push(at.get(k)); }
        }
    }
    const xs = pixels.map((p) => p.x), ys = pixels.map((p) => p.y);
    clusters.push({
      pixels,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  }
  return clusters;
}
