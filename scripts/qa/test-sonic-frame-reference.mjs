import assert from "node:assert/strict";
import { renderSonicFrameReference } from "./sonic-frame-reference.mjs";

// Authored 2x2 piece with a deliberately non-identity slot -> art mapping.
const rom = Buffer.alloc(0x21afe + 0xa120);
rom.writeUInt16BE(176, 0x211e2 + 2);
rom.set([1, 0xf8, 5, 0, 0, 0xf8], 0x211e2 + 176);
rom.writeUInt16BE(176, 0x217fe + 2);
rom.set([4, 0, 40, 0, 10, 0, 30, 0, 20], 0x217fe + 176);
for (const [tile, index] of [[40, 1], [10, 2], [30, 3], [20, 0]])
  rom.fill(index * 17, 0x21afe + tile * 32, 0x21afe + (tile + 1) * 32);
for (const [index, color] of [[1, 0x000e], [2, 0x00e0], [3, 0x0e00]]) rom.writeUInt16BE(color, 0x2388 + index * 2);
const result = renderSonicFrameReference(rom, 1);
assert.equal(result.width, 16); assert.equal(result.height, 16);
for (const [x, y, rgba, tile] of [[0, 0, [252, 0, 0, 255], 40], [0, 8, [0, 252, 0, 255], 10],
  [8, 0, [0, 0, 252, 255], 30], [8, 8, [0, 0, 0, 0], 20]]) {
  const at = (y * 16 + x) * 4;
  assert.deepEqual([...result.pixels.subarray(at, at + 4)], rgba);
  assert.equal(result.locations[y * 16 + x].tile, tile);
}
console.log("Independent reference: literal column order + DPLC + RGBA + locations PASS");
