// create-icon.mjs - Creates a minimal valid 32x32 PNG for Tauri icon generation
import { writeFileSync } from "fs";
import { createHash } from "crypto";
import { deflateSync } from "zlib";

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcData = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function createPNG(size) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width, height, bit depth, color type (RGBA=6), compression, filter, interlace
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  // Raw image data: each row = filter byte (0) + size*4 bytes RGBA
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const offset = 1 + x * 4;
      // Create a simple blue-to-purple gradient
      const r = Math.floor((x / size) * 100) + 50;
      const g = 20;
      const b = Math.floor((y / size) * 200) + 55;
      const a = 255;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = deflateSync(rawData);

  const ihdr = chunk("IHDR", ihdrData);
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// Create 512x512 PNG as the source for icon generation
const png512 = createPNG(512);
writeFileSync("app-icon.png", png512);
console.log("Created app-icon.png (512x512 RGBA)");
