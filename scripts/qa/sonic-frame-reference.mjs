// External test reference. Rebuilds tiles by their ordinal, separately from
// the product's inverse per-pixel resolver. No product module is imported.
export function renderSonicFrameReference(rom, frameIndex) {
  const word = (p) => rom.readUInt16BE(p);
  const map = 0x211e2 + word(0x211e2 + frameIndex * 2);
  const dplc = 0x217fe + word(0x217fe + frameIndex * 2);
  const slots = [];
  for (let n = 0; n < rom[dplc]; n += 1) {
    const chunk = word(dplc + 1 + n * 2);
    for (let t = 0; t <= chunk >>> 12; t += 1) slots.push((chunk & 4095) + t);
  }
  const pieces = Array.from({ length: rom[map] }, (_, n) => {
    const p = map + 1 + n * 5;
    return { x: rom.readInt8(p + 4), y: rom.readInt8(p), cols: (rom[p + 1] >> 2 & 3) + 1,
      rows: (rom[p + 1] & 3) + 1, attr: word(p + 2) };
  });
  const left = Math.min(0, ...pieces.map((p) => p.x));
  const top = Math.min(0, ...pieces.map((p) => p.y));
  const width = Math.max(0, ...pieces.map((p) => p.x + p.cols * 8)) - left;
  const height = Math.max(0, ...pieces.map((p) => p.y + p.rows * 8)) - top;
  const pixels = Buffer.alloc(width * height * 4);
  const locations = Array(width * height).fill(null);
  for (const p of pieces) {
    if (p.attr & 0x6000) throw new Error("reference palette bank unsupported");
    for (let ordinal = 0; ordinal < p.cols * p.rows; ordinal += 1) {
      const tile = slots[(p.attr & 2047) + ordinal];
      if (!Number.isInteger(tile)) throw new Error("reference DPLC gap");
      const cellX = Math.floor(ordinal / p.rows), cellY = ordinal % p.rows;
      for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
        let dx = cellX * 8 + x, dy = cellY * 8 + y;
        if (p.attr & 0x800) dx = p.cols * 8 - 1 - dx;
        if (p.attr & 0x1000) dy = p.rows * 8 - 1 - dy;
        const position = (p.y - top + dy) * width + p.x - left + dx;
        const offset = 0x21afe + tile * 32 + y * 4 + Math.floor(x / 2);
        const index = x % 2 === 0 ? rom[offset] >> 4 : rom[offset] & 15;
        const color = word(0x2388 + index * 2);
        pixels.set([(color >> 1 & 7) * 36, (color >> 5 & 7) * 36, (color >> 9 & 7) * 36, index ? 255 : 0], position * 4);
        locations[position] = { offset, high: x % 2 === 0, tile };
      }
    }
  }
  return { width, height, pixels, locations, anchorX: -left, anchorY: -top };
}
