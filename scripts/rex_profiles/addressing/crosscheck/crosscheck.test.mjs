// Cross-check executável independente dos cinco perfis de endereçamento
// (rodada REX-A, fase de validacion 2026-09-25).
//
// Propósito (directiva do usuario): "Duas calculadoras derivadas da mesma
// fórmula podem repetir o mesmo erro." Este ficheiro executa UMA SEGUNDA
// implementação estruturalmente distinta (matcher de janelas declarativas
// extraídas mecanicamente do boards.bml cru de bsnes@7d5aa1e + primitivas
// formais reduce/mirror reimplementadas a partir da descripción de
// memory.cpp:63-65 / memory-inline.hpp; e simulação de tabela de páginas
// GPGX para SSF2) e compara-a com os perfis em:
//   1. todos os vetores pinados (translate-cases.json, fixados ANTES da
//      implementação dos perfis — que non se modifican aqui);
//   2. fuzz determinístico con semente (marxes de fronteira incluídas);
//   3. enumeración exaustiva do bus (16.7M de enderezos) vs invert analítico;
//   4. segmentación de read byte a byte;
//   5. secuencias aleatorias de escrita de rexistrador SSF2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import * as mdLinear from '../md-linear.mjs';
import * as mdSsf2 from '../md-ssf2.mjs';
import * as snesLorom from '../snes-lorom.mjs';
import * as snesHirom from '../snes-hirom.mjs';
import * as snesExhirom from '../snes-exhirom.mjs';
import {
  BUS_LIMIT,
  reduceAddress,
  mirrorMod,
  bsnesMapOffset,
  parseMapLine,
  engineTranslate,
  ssf2Engine,
  makeRng,
} from './engine.mjs';
import {
  SNES_LOROM_INTERNAL,
  SNES_HIROM_INTERNAL,
  SNES_EXHIROM_INTERNAL,
  MD_INTERNAL,
  MD_CART_WINDOW,
} from './internal-regions.mjs';
import { fillDistinctBlocks } from '../build-fixtures.mjs';

const DATA = new URL('../../../../data/rex_profiles/addressing/', import.meta.url);
const CASES = Object.fromEntries(
  ['md-linear', 'md-ssf2', 'snes-lorom', 'snes-hirom', 'snes-exhirom'].map((p) => [
    p,
    JSON.parse(readFileSync(new URL(`${p}/expected/translate-cases.json`, DATA), 'utf8')),
  ]),
);
const WINDOWS = JSON.parse(
  readFileSync(new URL('crosscheck/windows-generated.json', DATA), 'utf8'),
);

const hx = (v) => (typeof v === 'string' ? parseInt(v, 16) : v);

// Estado con bancos só para md-ssf2 (os perfis SNES rexeitan claves estrañas;
// o motor ignoroas).
const stateFor = (name, size, banks) =>
  name === 'md-ssf2' ? { rom_size: size, banks: banks ?? { 1: 3, 4: 5, 7: 2 } } : { rom_size: size };

// --------------------------------------------------------------- configuración

const PROFILES = {
  'md-linear': {
    mod: mdLinear,
    romSizes: [0x10000, 0x80000, 0x400000],
    engine: (state) => (addr) =>
      engineTranslate(addr, { windows: [MD_CART_WINDOW], internal: MD_INTERNAL, romSize: state.rom_size }),
  },
  'md-ssf2': {
    mod: mdSsf2,
    romSizes: [0x80000, 0x400000, 0x800000],
    engine: (state) => {
      const e = ssf2Engine(state.rom_size, state.banks ?? {});
      return (addr) => e.translate(addr);
    },
  },
  'snes-lorom': {
    mod: snesLorom,
    romSizes: [0x8000, 0x80000, 0x100000, 0x400000],
    engine: (state) => (addr) =>
      engineTranslate(addr, {
        windows: WINDOWS.boards.LOROM.rom_windows,
        internal: SNES_LOROM_INTERNAL,
        romSize: state.rom_size,
      }),
  },
  'snes-hirom': {
    mod: snesHirom,
    romSizes: [0x10000, 0x80000, 0x100000, 0x400000],
    engine: (state) => (addr) =>
      engineTranslate(addr, {
        windows: WINDOWS.boards.HIROM.rom_windows,
        internal: SNES_HIROM_INTERNAL,
        romSize: state.rom_size,
      }),
  },
  'snes-exhirom': {
    mod: snesExhirom,
    romSizes: [0x500000, 0x600000, 0x800000],
    engine: (state) => (addr) =>
      engineTranslate(addr, {
        windows: WINDOWS.boards.EXHIROM.rom_windows,
        internal: SNES_EXHIROM_INTERNAL,
        romSize: state.rom_size,
      }),
  },
};

// Comparación normalizada: as traducións ROM compáranse byte a byte (o
// crítico); as rexións sen backing (wram/io/sram/…) compáranse só como
// clase "unbacked" — os seus offsets son convencións do perfil, non
// traducións ROM; os erros compáranse en código.
function normEngine(r) {
  if (r.error) return `E:${r.error.code}`;
  if (r.region === 'rom') return `R:${r.offset.toString(16)}`;
  return 'E:unbacked';
}
function normProfile(r) {
  if (r.error) return `E:${r.error.code}`;
  if (r.region === 'rom') return `R:${r.offset.toString(16)}`;
  return 'E:unbacked';
}

// ------------------------------------------------- 0. procedencia e integridade

test('procedencia: windows-generated.json declara bsnes@7d5aa1e e SHA fixado', () => {
  assert.equal(WINDOWS.source.commit, '7d5aa1e656b9171524d01b1b22917197d8121cb4');
  assert.equal(
    WINDOWS.source.sha256,
    'b8006d805bef610bb527a486e8b576d48531e6afd94fce7083d3ca9eb553b378',
  );
  assert.equal(WINDOWS.source.input_sha256_verified, WINDOWS.source.sha256);
  // Se o BML cru está na caché local desta sesión, reverificar byte a byte.
  try {
    const raw = readFileSync('/tmp/rex-crosscheck/boards.bml');
    assert.equal(createHash('sha256').update(raw).digest('hex'), WINDOWS.source.sha256);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  assert.equal(WINDOWS.boards.LOROM.rom_windows.length, 1);
  assert.equal(WINDOWS.boards.HIROM.rom_windows.length, 2);
  assert.equal(WINDOWS.boards.EXHIROM.rom_windows.length, 4);
  // as liñas parseadas deben ser exactamente as do BML (mostra):
  assert.deepEqual(
    parseMapLine('    map address=00-7d,80-ff:8000-ffff mask=0x8000'),
    { banks: [[0, 0x7d], [0x80, 0xff]], a: [0x8000, 0xffff], base: 0, mask: 0x8000 },
  );
  assert.equal(parseMapLine('map address=00-1f,80-9f:6000-7fff mask=0xfff').mask, 0xfff);
});

// ------------------------------------------- 1. primitivas vs texto canónico

test('mirrorMod = Bus::mirror no dominio que exercita o motor', () => {
  assert.equal(mirrorMod(0x123456, 0), 0);
  // (a) x < size => identidade (tamén para sizes non-potencia)
  assert.equal(mirrorMod(0x400000, 0x600000), 0x400000);
  assert.equal(mirrorMod(0x400000, 0x500000), 0x400000);
  assert.equal(mirrorMod(0x5fffff, 0x600000), 0x5fffff);
  // (b) potencia de 2 => mod (identico á plegada de máscara do texto)
  assert.equal(mirrorMod(0x700000, 0x200000), 0x100000);
  assert.equal(mirrorMod(0xabcdef, 0x1000000), 0xabcdef);
  for (const size of [0x10000, 0x100000, 0x200000, 0x400000, 0x800000]) {
    for (const x of [0, 1, size - 1, size, size + 1, 0xabcdef, 0xffffff, 2 * size - 1]) {
      assert.equal(mirrorMod(x, size), x % size, `mirror 0x${x.toString(16)} size 0x${size.toString(16)}`);
    }
  }
  // fora de dominio: ruxido, non silencio
  assert.throws(() => mirrorMod(0x700000, 0x600000), /dominio/);
});

test('reduceAddress = Bus::reduce (retira bits do mask e compacta)', () => {
  assert.equal(reduceAddress(0x123456, 0), 0x123456);
  // mask=0x8000 (LOROM): borra o bit 15, compacta o banco un bit á dereita
  for (const bank of [0x00, 0x3f, 0x7d, 0x80, 0xff]) {
    for (const a of [0x8000, 0x8001, 0xabcd, 0xffff]) {
      assert.equal(reduceAddress((bank << 16) | a, 0x8000), (bank << 15) | (a & 0x7fff));
    }
  }
  // mask=0xc00000 (EXHIROM area1): A22/A23 desconectados => A & 0x3fffff
  for (const addr of [0x808000, 0xbf1234, 0xc08000, 0xffffff]) {
    assert.equal(reduceAddress(addr, 0xc00000), addr & 0x3fffff);
  }
  // mask=0xe000 (xanelas Save): borra bits 13-15 e compacta
  assert.equal(reduceAddress(0x206000, 0xe000), 0x20 << 13);
  assert.equal(reduceAddress(0x3f7fff, 0xe000), (0x3f << 13) | 0x1fff);
});

test('bsnesMapOffset reproduce os vetores pinados (mostras de cada perfil)', () => {
  const lorom = WINDOWS.boards.LOROM.rom_windows[0];
  assert.equal(bsnesMapOffset(0x208000, lorom, 0x100000), 0x000000); // caso pinado
  assert.equal(bsnesMapOffset(0x7dffff, lorom, 0x100000), 0x0effff); // caso pinado
  const hiFull = WINDOWS.boards.HIROM.rom_windows[1];
  assert.equal(bsnesMapOffset(0xc00000, hiFull, 0x100000), 0x000000); // HiROM lineal mascarado
  const ex2a = WINDOWS.boards.EXHIROM.rom_windows.find((w) => w.base === 0x400000 && w.banks[0][0] === 0x40);
  assert.equal(bsnesMapOffset(0x600000, ex2a, 0x600000), 0x400000); // caso pinado 6MB
  const ex2b = WINDOWS.boards.EXHIROM.rom_windows.find((w) => w.base === 0x400000 && w.banks[0][0] === 0x00);
  assert.equal(bsnesMapOffset(0x008000, ex2b, 0x500000), 0x408000); // area2 en 5MB
  const ex1 = WINDOWS.boards.EXHIROM.rom_windows.find((w) => w.mask === 0xc00000 && w.banks[0][0] === 0xc0);
  assert.equal(bsnesMapOffset(0xc00000, ex1, 0x800000), 0x000000); // area1 A22/A23
});

// ------------------------------------------------ 2. vetores pinados vs motor

for (const [name, cfg] of Object.entries(PROFILES)) {
  test(`pinados: perfil ≡ expectativa e motor ≡ perfil (${name})`, () => {
    const c = CASES[name];
    for (const cc of [...c.translate_cases, ...c.translate_negatives]) {
      const addr = hx(cc.cpu_address);
      const st = cc.mapper_state;
      const res = cfg.mod.translate(addr, st);
      if (cc.expect) {
        assert.equal(res.region, cc.expect.region, cc.name);
        assert.equal(res.offset, hx(cc.expect.offset), cc.name);
      } else {
        assert.equal(res.error.code, cc.expect_error.code, cc.name);
      }
      // o motor non valida tamaños de estado: só comparar estados lexítimos
      if (cfg.mod.validateState(st) !== null) continue;
      if (addr > BUS_LIMIT) continue;
      assert.equal(
        normEngine(cfg.engine(st)(addr)),
        normProfile(res),
        `${cc.name} | perfil=${JSON.stringify(res)} motor=${JSON.stringify(cfg.engine(st)(addr))}`,
      );
    }
  });
}

test('pinados md-ssf2: escritas de rexistrador ≡ simulación GPGX', () => {
  for (const wc of [...CASES['md-ssf2'].write_register_cases, ...CASES['md-ssf2'].write_register_negatives]) {
    let state = { ...wc.mapper_state, banks: { ...(wc.mapper_state.banks ?? {}) } };
    const eng = ssf2Engine(wc.mapper_state.rom_size, wc.mapper_state.banks ?? {});
    for (const w of wc.writes ?? [{ cpu_address: wc.cpu_address, data: wc.data }]) {
      const r = mdSsf2.writeMapperRegister(hx(w.cpu_address), w.data, state);
      if (r.error) continue; // escritura rexeitada: o motor non a ve (mesma páxina)
      state = r.state;
      eng.writeRegister(hx(w.cpu_address), w.data);
    }
    for (const [k, v] of Object.entries(wc.expect_banks ?? {})) {
      assert.equal(state.banks[k], v, wc.name);
    }
    for (const t of wc.expect_translate ?? []) {
      assert.equal(mdSsf2.translate(hx(t.cpu_address), state).offset, hx(t.offset), wc.name);
      assert.equal(eng.translate(hx(t.cpu_address)).offset, hx(t.offset), `${wc.name} (motor)`);
    }
  }
});

// ------------------------------------------------------- 3. fuzz determinista

const BOUNDARY_BANKS = [0, 0x3d, 0x3e, 0x3f, 0x40, 0x7d, 0x7e, 0x7f, 0x80, 0xbd, 0xbe, 0xbf, 0xc0, 0xa0, 0xa1, 0xdf, 0xe0, 0xff];
const BOUNDARY_A = [0x0000, 0x0001, 0x1fff, 0x2000, 0x3000, 0x30ff, 0x3100, 0x5fff, 0x6000, 0x7fff, 0x8000, 0x8001, 0xbfff, 0xc000, 0xfffe, 0xffff];

for (const [name, cfg] of Object.entries(PROFILES)) {
  test(`fuzz (semente fixa): motor ≡ perfil en ${name}`, () => {
    const rng = makeRng(0x5eed + name.length);
    for (const size of cfg.romSizes) {
      const state = stateFor(name, size);
      const eng = cfg.engine(state);
      for (let i = 0; i < 3000; i += 1) {
        const addr =
          rng(2) === 0
            ? rng(BUS_LIMIT + 1)
            : (BOUNDARY_BANKS[rng(BOUNDARY_BANKS.length)] << 16) | BOUNDARY_A[rng(BOUNDARY_A.length)];
        assert.equal(
          normEngine(eng(addr)),
          normProfile(cfg.mod.translate(addr, state)),
          `${name} size=0x${size.toString(16)} addr=0x${addr.toString(16)}`,
        );
      }
    }
  });
}

// ------------------------------------------- 4. enumeración exaustiva vs invert

// Unha soa pasada polos 16.7M de enderezos do bus co motor; para cada offset
// ROM alcanzado, garda TODOS os enderezos que o ven (lista ascendente).
function aliasesByExhaustiveScan(eng, romSize, wanted) {
  const out = new Map([...wanted].map((o) => [o, []]));
  for (let addr = 0; addr <= BUS_LIMIT; addr += 1) {
    const r = eng(addr);
    if (!r.error && r.region === 'rom') {
      if (r.offset >= romSize) throw new Error(`offset 0x${r.offset.toString(16)} >= rom_size (addr 0x${addr.toString(16)})`);
      const list = out.get(r.offset);
      if (list) list.push(addr);
    }
  }
  return out;
}

for (const [name, cfg] of Object.entries(PROFILES)) {
  test(`exaustivo: invert do perfil = aliases reais do bus (${name})`, () => {
    const size = cfg.romSizes.includes(0x100000) ? 0x100000 : cfg.romSizes[cfg.romSizes.length - 1];
    const state = stateFor(name, size, {}); // identidade para a comparacion
    const eng = cfg.engine(state);
    const rng = makeRng(0xa11ce ^ size);
    const wanted = new Set([0, 1, size - 1, size - 2]);
    const stride = Math.max(1, Math.floor(size / 60));
    for (let o = 0; o < size; o += stride) wanted.add(o);
    while (wanted.size < Math.min(size, 400)) wanted.add(rng(size));
    const lists = aliasesByExhaustiveScan(eng, size, wanted);
    for (const o of wanted) {
      assert.deepEqual(
        cfg.mod.invert(o, state).aliases,
        lists.get(o),
        `${name} invert(0x${o.toString(16)})`,
      );
    }
    // offsets inexistentes: lista baleira
    for (const off of [size, size + 1, 0x1000000]) {
      assert.deepEqual(cfg.mod.invert(off, state).aliases, [], `${name} invert(0x${off.toString(16)})`);
    }
    // e co estado con bancos (ssf2) a enumeración tamén bate
    if (name === 'md-ssf2') {
      const st2 = stateFor(name, size, { 1: 3, 4: 5, 7: 2 });
      const eng2 = cfg.engine(st2);
      const sample = new Set([0, size - 1]);
      const rng2 = makeRng(0xb0a ^ size);
      while (sample.size < 40) sample.add(rng2(size));
      const lists2 = aliasesByExhaustiveScan(eng2, size, sample);
      for (const o of sample) {
        assert.deepEqual(mdSsf2.invert(o, st2).aliases, lists2.get(o), `ssf2(banks) invert(0x${o.toString(16)})`);
      }
    }
  });
}

// ---------------------------------------------- 5. read: segmentación byte a byte

for (const [name, cfg] of Object.entries(PROFILES)) {
  test(`read: segmentos do perfil ≡ offsets do motor (${name})`, () => {
    const size = cfg.romSizes[cfg.romSizes.length - 1];
    const rom = new Uint8Array(size);
    fillDistinctBlocks(rom, size / 0x10000, (0x9e37 + size) >>> 0);
    const state = stateFor(name, size, { 2: 6 });
    const eng = cfg.engine(state);
    const rng = makeRng(0x5ea1 ^ size);
    for (let i = 0; i < 300; i += 1) {
      const addr = rng(BUS_LIMIT + 1);
      const len = 1 + rng(64);
      const res = cfg.mod.read(addr, len, state, rom);
      if (res.error) continue; // rexeitamento global tamén é resposta
      let cursor = addr;
      let covered = 0;
      for (const seg of res.segments) {
        const e = eng(cursor);
        if (seg.error) {
          assert.ok(e.error || e.region !== 'rom', `${name}: segmento con erro pero o motor di ROM en 0x${cursor.toString(16)}`);
          break;
        }
        assert.equal(e.region, 'rom', `${name}: segmento ROM pero o motor di ${e.region} en 0x${cursor.toString(16)}`);
        assert.equal(seg.offset, e.offset, `${name}: offset de segmento en 0x${cursor.toString(16)}`);
        for (let b = 0; b < seg.bytes.length; b += 1) {
          assert.equal(seg.bytes[b], rom[e.offset + b], `${name} byte en 0x${(cursor + b).toString(16)}`);
        }
        cursor += seg.bytes.length;
        covered += seg.bytes.length;
      }
      assert.ok(covered <= len, `${name}: cobertura ${covered} > ${len}`);
    }
  });
}

// -------------------------------- SSF2: escritas aleatorias GPGX ≡ estado banks

test('ssf2: 150 secuencias aleatorias de escrita, motor GPGX ≡ perfil', () => {
  const rng = makeRng(0x5f2f);
  for (let trial = 0; trial < 150; trial += 1) {
    const size = [0x80000, 0x400000, 0x800000][trial % 3];
    let state = { rom_size: size, banks: {} };
    const eng = ssf2Engine(size, {});
    const n = rng(12);
    for (let k = 0; k < n; k += 1) {
      const addr = 0xa13000 + rng(0x100);
      const data = rng(0x100);
      const r = mdSsf2.writeMapperRegister(addr, data, state);
      assert.equal(r.error, undefined, `escrita rexeitada: 0x${addr.toString(16)}`);
      state = r.state;
      eng.writeRegister(addr, data);
    }
    for (let w = 0; w < 8; w += 1) {
      for (const off of [0, 0x1, 0x7fffe, 0x7ffff]) {
        const addr = w * 0x80000 + off;
        assert.equal(
          normEngine(eng.translate(addr)),
          normProfile(mdSsf2.translate(addr, state)),
          `t${trial} s=0x${size.toString(16)} 0x${addr.toString(16)}`,
        );
      }
    }
    for (let s = 0; s < 25; s += 1) {
      const addr = rng(0x400000);
      assert.equal(
        normEngine(eng.translate(addr)),
        normProfile(mdSsf2.translate(addr, state)),
        `t${trial} addr 0x${addr.toString(16)}`,
      );
    }
  }
});

// ------------------------- SNES: exclusións e aliases (afirmacións das specs)

test('SNES: 7E/7F nunca son aliases; reservas 3E/3F batan motor≡perfil', () => {
  for (const [name, cfg] of Object.entries(PROFILES)) {
    if (!name.startsWith('snes')) continue;
    for (const size of cfg.romSizes) {
      const state = { rom_size: size };
      const eng = cfg.engine(state);
      for (const bank of [0x7e, 0x7f]) {
        for (let a = 0; a <= 0xffff; a += 0x401) {
          assert.equal(eng((bank << 16) | a).region, 'wram', `${name} 0x${((bank << 16) | a).toString(16)}`);
        }
      }
      const rng = makeRng(0x7e0 + bank_xor(size));
      for (let i = 0; i < 60; i += 1) {
        for (const addr of cfg.mod.invert(rng(size), state).aliases) {
          const b = (addr >> 16) & 0xff;
          assert.ok(b !== 0x7e && b !== 0x7f, `${name}: alias en banco WRAM`);
        }
      }
      for (const bank of [0x3e, 0x3f, 0xbe, 0xbf]) {
        for (const a of [0x0, 0x1234, 0x4800, 0x5fff, 0x6000, 0x7fff, 0x8000, 0xffff]) {
          const addr = (bank << 16) | a;
          assert.equal(
            normEngine(eng(addr)),
            normProfile(cfg.mod.translate(addr, state)),
            `${name} 0x${addr.toString(16)}`,
          );
        }
      }
    }
  }
});
const bank_xor = (size) => (size >>> 3) ^ 0x7e7e;
