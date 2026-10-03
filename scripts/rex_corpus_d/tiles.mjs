export function decodeTileRow(fourBytes) {
  if (fourBytes.length !== 4) throw new Error("linha MD 4bpp exige 4 bytes");
  const out = [];
  for (const byte of fourBytes) {
    out.push((byte >> 4) & 0xf, byte & 0xf);
  }
  return out;
}

export function decodeTile4bpp(bytes) {
  if (bytes.length !== 32) throw new Error("tile MD 4bpp exige 32 bytes");
  const out = [];
  for (let row = 0; row < 8; row++) {
    out.push(...decodeTileRow(bytes.subarray(row * 4, row * 4 + 4)));
  }
  return out;
}
