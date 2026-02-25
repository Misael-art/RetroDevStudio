/**
 * Gera ícones PNG para o RetroDev Studio sem dependências externas.
 * PNG escrito com deflate store + CRC32 + Adler32 nativos.
 *
 * Design: Pixel art "R" em fundo gradiente roxo (tema Catppuccin Mocha).
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "..");
const ICONS = join(ROOT, "src-tauri", "icons");

// ── PNG encoder sem dependências ─────────────────────────────────────────────

function uint32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function crc32(buf) {
  if (!crc32._table) {
    crc32._table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crc32._table[i] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (const byte of buf) c = crc32._table[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  for (const byte of buf) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}

function deflateStore(data) {
  const chunks = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + 65535, data.length);
    const block = data.slice(offset, end);
    const len = block.length;
    const last = end >= data.length ? 1 : 0;
    chunks.push(Buffer.from([last, len & 0xFF, (len >> 8) & 0xFF, (~len) & 0xFF, ((~len) >> 8) & 0xFF]));
    chunks.push(Buffer.from(block));
    offset = end;
  }
  const header = Buffer.from([0x78, 0x01]);
  const payload = Buffer.concat(chunks);
  const chk = uint32be(adler32(data));
  return Buffer.concat([header, payload, chk]);
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  return Buffer.concat([uint32be(data.length), t, data, uint32be(crc32(Buffer.concat([t, data])))]);
}

function makePng(pixels, size) {
  // pixels: Uint8Array de size*size*3 (RGB)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw.push(pixels[i], pixels[i+1], pixels[i+2]);
    }
  }
  const idat = deflateStore(Buffer.from(raw));

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Renderização ──────────────────────────────────────────────────────────────

function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 3);

  function set(x, y, r, g, b) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 3;
    pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b;
  }

  // Fundo: gradiente #1e1e2e → #11111b (Catppuccin base → crust)
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(0x1e * (1 - t) + 0x11 * t);
    const g = Math.round(0x1e * (1 - t) + 0x11 * t);
    const bv = Math.round(0x2e * (1 - t) + 0x1b * t);
    for (let x = 0; x < size; x++) set(x, y, r, g, bv);
  }

  // Borda arredondada: preenche corners com preto
  const radius = size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      if (cx < radius && cy < radius) {
        if (Math.sqrt((cx - radius) ** 2 + (cy - radius) ** 2) > radius) {
          set(x, y, 0, 0, 0);
        }
      }
    }
  }

  // Letra "R" pixelada — grid 5×7
  const R = [
    [1,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,1,1,1,0],
    [1,0,1,0,0],
    [1,0,0,1,0],
    [1,0,0,0,1],
  ];
  const pad  = size * 0.20;
  const cellW = (size - pad * 2) / 5;
  const cellH = (size - pad * 2) / 7;

  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (!R[row][col]) continue;
      const px = Math.round(pad + col * cellW);
      const py = Math.round(pad + row * cellH);
      const pw = Math.max(1, Math.round(cellW * 0.82));
      const ph = Math.max(1, Math.round(cellH * 0.82));
      for (let dy = 0; dy < ph; dy++)
        for (let dx = 0; dx < pw; dx++)
          set(px + dx, py + dy, 0xcb, 0xa6, 0xf7); // #cba6f7 lavender
    }
  }

  // Ponto verde (acento retro) — canto inferior direito
  const dot = Math.max(2, Math.round(size * 0.09));
  const dx0 = Math.round(size * 0.68);
  const dy0 = Math.round(size * 0.68);
  for (let dy = 0; dy < dot; dy++)
    for (let dx = 0; dx < dot; dx++)
      set(dx0 + dx, dy0 + dy, 0xa6, 0xe3, 0xa1); // #a6e3a1 green

  return pixels;
}

// ── Escrita dos arquivos ──────────────────────────────────────────────────────

const SIZES = [
  { size: 32,  path: join(ICONS, "32x32.png") },
  { size: 64,  path: join(ICONS, "64x64.png") },
  { size: 128, path: join(ICONS, "128x128.png") },
  { size: 128, path: join(ICONS, "128x128@2x.png") },
  { size: 256, path: join(ICONS, "icon.png") },
  { size: 256, path: join(ROOT, "app-icon.png") },
];

for (const { size, path } of SIZES) {
  const pixels = renderIcon(size);
  writeFileSync(path, makePng(pixels, size));
  console.log(`✓ ${size}×${size} → ${path.replace(ROOT + "/", "")}`);
}

console.log("\nÍcones gerados com sucesso!");
