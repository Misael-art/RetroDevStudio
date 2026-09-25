// Build de fixtures autorais de ROM sintetica para perfis de enderecamento REX.
// Node puro, deterministico (PRNG xorshift32 com seed por bloco de 64KB).
// Nenhum byte de ROM comercial; nenhum import do produto.
//
// Uso:
//   node scripts/rex_profiles/addressing/build-fixtures.mjs --profile md-linear
//   node scripts/rex_profiles/addressing/build-fixtures.mjs --profile md-ssf2
//   node scripts/rex_profiles/addressing/build-fixtures.mjs --profile md-linear --out /tmp/rom.bin
//
// Saidas default vao para stdout como JSON { profile, rom_size, sha256, path }
// (quando --out nao e passado, a ROM e gerada em memoria e descartada).

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// PRNG xorshift32 (auditavel): retorna inteiro de 32 bits sem sinal.
export function xorshift32(seed) {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= (s << 13) >>> 0;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    return s;
  };
}

export const BLOCK_SIZE = 0x10000; // bloco de assinatura = 64KB

// Preenche `rom` com um stream pseudo-aleatorio independente por bloco de 64KB:
// blocos distintos nunca compartilham o stream, logo um byte errado de banco
// ou um offset errado produz valores diferentes com probabilidade esmagadora.
export function fillDistinctBlocks(rom, blockCount, seedBase = 0x4d444d44, blockSize = BLOCK_SIZE) {
  for (let b = 0; b < blockCount; b += 1) {
    const next = xorshift32((seedBase ^ Math.imul(b + 1, 0x9e3779b9)) >>> 0);
    const start = b * blockSize;
    for (let i = 0; i < blockSize; i += 1) {
      rom[start + i] = next() >>> 24;
    }
  }
}

export function buildMdLinearFixture() {
  const romSize = 0x80000; // 512KB: 8 blocos de 64KB, espelhado 8x na janela
  const rom = new Uint8Array(romSize);
  fillDistinctBlocks(rom, romSize / BLOCK_SIZE, 0x4d444d44);
  return rom;
}

export function buildMdSsf2Fixture() {
  const romSize = 0x400000; // 4MB: 8 janelas de 512KB no estado inicial identidade
  const rom = new Uint8Array(romSize);
  fillDistinctBlocks(rom, romSize / BLOCK_SIZE, 0x5546322d); // seed base distinta do perfil linear
  return rom;
}

export function buildSnesLoromFixture() {
  const romSize = 0x100000; // 1MB: 32 paginas de 32KB (pagina = bloco de assinatura)
  const rom = new Uint8Array(romSize);
  fillDistinctBlocks(rom, romSize / 0x8000, 0x4c4f524d, 0x8000);
  return rom;
}

export function buildSnesHiromFixture() {
  const romSize = 0x100000; // 1MB: mapa linear por banco de 64KB
  const rom = new Uint8Array(romSize);
  fillDistinctBlocks(rom, romSize / BLOCK_SIZE, 0x4849524d);
  return rom;
}

export function buildSnesExhiromFixture() {
  const romSize = 0x800000; // 8MB: duas areas de 4MB (base 0x400000 na segunda)
  const rom = new Uint8Array(romSize);
  fillDistinctBlocks(rom, romSize / BLOCK_SIZE, 0x45584849);
  return rom;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function main() {
  const args = process.argv.slice(2);
  const profileIdx = args.indexOf('--profile');
  const outIdx = args.indexOf('--out');
  const profile = profileIdx >= 0 ? args[profileIdx + 1] : null;
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  if (!profile) {
    console.error('uso: build-fixtures.mjs --profile <md-linear|md-ssf2> [--out caminho]');
    process.exit(2);
  }
  const builders = {
    'md-linear': buildMdLinearFixture,
    'md-ssf2': buildMdSsf2Fixture,
    'snes-lorom': buildSnesLoromFixture,
    'snes-hirom': buildSnesHiromFixture,
    'snes-exhirom': buildSnesExhiromFixture,
  };
  const builder = builders[profile];
  if (!builder) {
    console.error(`perfil desconhecido: ${profile}`);
    process.exit(2);
  }
  const rom = builder();
  const digest = sha256(rom);
  if (out) {
    writeFileSync(out, rom);
  }
  console.log(JSON.stringify({ profile, rom_size: rom.length, sha256: digest, path: out ?? null }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
