import { describe, it, expect } from "vitest";
import { inflateRawSync } from "node:zlib";
import { encodePng } from "./png.mjs";

function chunks(png) {
  expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = [];
  let pos = 8;
  while (pos < png.length) {
    const len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    const type = String.fromCharCode(...png.slice(pos + 4, pos + 8));
    const data = png.slice(pos + 8, pos + 8 + len);
    const crc = (png[pos + 8 + len] << 24) | (png[pos + 8 + len + 1] << 16) | (png[pos + 8 + len + 2] << 8) | png[pos + 8 + len + 3];
    out.push({ type, data, crc });
    pos += 12 + len;
  }
  return out;
}

describe("encoder PNG", () => {
  it("produz IHDR 8-bit RGBA com dimensoes corretas", () => {
    const png = encodePng({ width: 2, height: 1, data: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]) });
    const [ihdr] = chunks(png);
    expect(ihdr.type).toBe("IHDR");
    const w = (ihdr.data[0] << 24) | (ihdr.data[1] << 16) | (ihdr.data[2] << 8) | ihdr.data[3];
    const h = (ihdr.data[4] << 24) | (ihdr.data[5] << 16) | (ihdr.data[6] << 8) | ihdr.data[7];
    expect([w, h, ihdr.data[8], ihdr.data[9]]).toEqual([2, 1, 8, 6]);
  });

  it("IDAT descomprime para linhas com filtro 0 e pixels round-trip", () => {
    const data = new Uint8Array([
      0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00,
      0x00, 0xff, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
    ]);
    const png = encodePng({ width: 2, height: 2, data });
    const cs = chunks(png);
    const idat = cs.find((c) => c.type === "IDAT");
    const raw = inflateRawSync(Buffer.from(idat.data));
    const expected = [0];
    for (let y = 0; y < 2; y++) {
      if (y > 0) expected.push(0);
      for (let x = 0; x < 2; x++) expected.push(...data.subarray((y * 2 + x) * 4, (y * 2 + x) * 4 + 4));
    }
    expect([...raw]).toEqual(expected);
  });

  it("CRCs batem com o contear (auto-validacao estrutural)", () => {
    const png = encodePng({ width: 1, height: 1, data: new Uint8Array([9, 8, 7, 255]) });
    const cs = chunks(png);
    expect(cs.at(-1).type).toBe("IEND");
    for (const c of cs) {
      const crc32 = crc32Of(Buffer.concat([Buffer.from(c.type, "latin1"), Buffer.from(c.data)]));
      expect(c.crc >>> 0).toBe(crc32 >>> 0);
    }
  });
});

function crc32Of(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
