// Verificación independente do construtor de fixture autoral do adaptador
// rex_addressing.rs: mesmo SplitMix64, mesma colocación do header SEGA, outro
// runtime (node:crypto en vez de sha2 crate). Serve para que o digesto pinado
// do test non estea gardado só pola implementación que o calcula.
import { createHash } from 'node:crypto';

const MASK64 = (1n << 64n) - 1n;
const mul = (a, b) => (a * b) & MASK64;

function splitmix64(seed) {
  let z = BigInt(seed) & MASK64;
  z = mul(z ^ (z >> 30n), 0x9e3779b97f4a7c15n);
  z = mul(z ^ (z >> 27n), 0x94d049bb133111ebn);
  return (z ^ (z >> 31n)) & MASK64;
}

function rom(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = Number(splitmix64(i) & 0xffn);
  bytes.set([0x53, 0x45, 0x47, 0x41], 0x100); // "SEGA" no desprazamento canónico
  return Buffer.from(bytes);
}

for (const [nome, size] of [
  ['md-ssf2 / 1 MiB', 0x10_0000],
  ['md-linear / 512 KiB', 0x8_0000],
]) {
  const image = rom(size);
  console.log(
    `${nome}\tsha256=${createHash('sha256').update(image).digest('hex')}\tbytes=${image.length}`,
  );
}
