// Encoder PNG 8-bit RGBA proprio (sem dependencia nova): IHDR + IDAT (deflate raw) + IEND.
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data, out) {
  const len = data.length;
  const head = new Uint8Array(4);
  head[0] = (len >>> 24) & 0xff;
  head[1] = (len >>> 16) & 0xff;
  head[2] = (len >>> 8) & 0xff;
  head[3] = len & 0xff;
  out.push(head);
  const body = new Uint8Array(4 + len);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  out.push(body);
  const c = new Uint8Array(4);
  const crc = crc32(body);
  c[0] = (crc >>> 24) & 0xff;
  c[1] = (crc >>> 16) & 0xff;
  c[2] = (crc >>> 8) & 0xff;
  c[3] = crc & 0xff;
  out.push(c);
}

export function encodePng({ width, height, data }) {
  if (data.length !== width * height * 4) throw new Error("data RGBA nao bate com dimensoes");
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filtro None por linha
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff;
  ihdr[1] = (width >>> 16) & 0xff;
  ihdr[2] = (width >>> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff;
  ihdr[5] = (height >>> 16) & 0xff;
  ihdr[6] = (height >>> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const parts = [];
  chunk("IHDR", ihdr, parts);
  chunk("IDAT", new Uint8Array(deflateRawSync(raw)), parts);
  chunk("IEND", new Uint8Array(0), parts);
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const total = sig.length + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  out.set(sig);
  let pos = sig.length;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
