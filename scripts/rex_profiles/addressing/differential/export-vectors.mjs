// Vectores diferenciales para la futura implementación Rust del integrador
// (REX fase de validación 2026-09-25, directiva item 5).
//
// Produce data/rex_profiles/addressing/differential/rust-vectors-v1.json:
// un único ficheiro consumible con, por perfil:
//   - translate: todos os vetores pinados (+negativos) co resultado do
//     perfil e a concordancia co motor-independente;
//   - invert: casos pinados + mostras adicionais verificadas por
//     enumeración exaustiva do barramento;
//   - read: casos pinados con excerpt hex (bytes do FIXTURE autoral
//     xorshift32 — non ROM comercial) + lecturas de fronteira;
//   - md-ssf2: secuencias de escritura de rexistro con estado inicial e
//     probes de tradución (trocando bancos);
//   - metadatos do fixture (sha256 + spec do PRNG para reprodución Rust).
//
// Uso: node scripts/rex_profiles/addressing/differential/export-vectors.mjs
// Determinista: mesma entrada => mesmo sha256 do JSON saída.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

import * as mdLinear from '../md-linear.mjs';
import * as mdSsf2 from '../md-ssf2.mjs';
import * as snesLorom from '../snes-lorom.mjs';
import * as snesHirom from '../snes-hirom.mjs';
import * as snesExhirom from '../snes-exhirom.mjs';
import { buildMdLinearFixture, buildMdSsf2Fixture, buildSnesLoromFixture, buildSnesHiromFixture, buildSnesExhiromFixture, sha256 } from '../build-fixtures.mjs';
import { engineTranslate, ssf2Engine, makeRng, BUS_LIMIT } from '../crosscheck/engine.mjs';
import { SNES_LOROM_INTERNAL, SNES_HIROM_INTERNAL, SNES_EXHIROM_INTERNAL, MD_INTERNAL, MD_CART_WINDOW } from '../crosscheck/internal-regions.mjs';

const DATA = new URL('../../../../data/rex_profiles/addressing/', import.meta.url);
const hx = (v) => (typeof v === 'string' ? parseInt(v, 16) : v);
const hexs = (v) => `0x${v.toString(16).padStart(6, '0')}`;

const CASES = Object.fromEntries(
  ['md-linear', 'md-ssf2', 'snes-lorom', 'snes-hirom', 'snes-exhirom'].map((p) => [
    p,
    JSON.parse(readFileSync(new URL(`${p}/expected/translate-cases.json`, DATA), 'utf8')),
  ]),
);
const WINDOWS = JSON.parse(readFileSync(new URL('crosscheck/windows-generated.json', DATA), 'utf8'));

const FIXTURES = {
  'md-linear': { build: buildMdLinearFixture, rom_size: 0x80000 },
  'md-ssf2': { build: buildMdSsf2Fixture, rom_size: 0x400000 },
  'snes-lorom': { build: buildSnesLoromFixture, rom_size: 0x100000 },
  'snes-hirom': { build: buildSnesHiromFixture, rom_size: 0x100000 },
  'snes-exhirom': { build: buildSnesExhiromFixture, rom_size: 0x800000 },
};

const MODULES = { 'md-linear': mdLinear, 'md-ssf2': mdSsf2, 'snes-lorom': snesLorom, 'snes-hirom': snesHirom, 'snes-exhirom': snesExhirom };

const ENGINES = {
  'md-linear': (st) => (a) => engineTranslate(a, { windows: [MD_CART_WINDOW], internal: MD_INTERNAL, romSize: st.rom_size }),
  'md-ssf2': (st) => { const e = ssf2Engine(st.rom_size, st.banks ?? {}); return (a) => e.translate(a); },
  'snes-lorom': (st) => (a) => engineTranslate(a, { windows: WINDOWS.boards.LOROM.rom_windows, internal: SNES_LOROM_INTERNAL, romSize: st.rom_size }),
  'snes-hirom': (st) => (a) => engineTranslate(a, { windows: WINDOWS.boards.HIROM.rom_windows, internal: SNES_HIROM_INTERNAL, romSize: st.rom_size }),
  'snes-exhirom': (st) => (a) => engineTranslate(a, { windows: WINDOWS.boards.EXHIROM.rom_windows, internal: SNES_EXHIROM_INTERNAL, romSize: st.rom_size }),
};

const PRNG_SPEC = {
  algorithm: 'xorshift32',
  seed_per_block: 'seed = (seedBase ^ imul(blockIndex+1, 0x9e3779b9)) >>> 0; 0 => 0x9e3779b9',
  step: 's ^= s<<13 (u32); s ^= s>>17; s ^= s<<5; byte = s>>>24',
  block_size_bytes: 65536,
  seed_bases: { 'md-linear': '0x4d444d44', 'md-ssf2': '0x5546322d', 'snes-lorom': '0x4c4f524d (blocks of 32KB)', 'snes-hirom': '0x4849524d', 'snes-exhirom': '0x45584849' },
  note: 'fixtures autorais: o Rust debe recrexar o MESMO stream para comparar bytes; fonte en scripts/rex_profiles/addressing/build-fixtures.mjs',
};

function out(res) {
  if (res.error) return { error: res.error.code };
  return { region: res.region, offset: hexs(res.offset) };
}

const doc = {
  contract_version: 1,
  generated_by: 'scripts/rex_profiles/addressing/differential/export-vectors.mjs',
  date: '2026-09-25',
  usage: 'testes diferenciais da implementación Rust: para cada vector, a implementación debe producir "expect"; os campos engine_agree=son a concordancia do segundo motor independente (scripts/rex_profiles/addressing/crosscheck/). Para bytes, reproduza o fixture co PRNG_SPEC (non hai ROMs comerciais neste ficheiro).',
  fixture_prng_spec: PRNG_SPEC,
  real_case_pointers: Object.fromEntries(
    Object.keys(MODULES).map((p) => [p, `data/rex_profiles/addressing/${p}/evidence/real-case.json`]),
  ),
  profiles: {},
};

for (const name of Object.keys(MODULES)) {
  const mod = MODULES[name];
  const c = CASES[name];
  const size = FIXTURES[name].rom_size;
  const state = name === 'md-ssf2' ? { rom_size: size, banks: {} } : { rom_size: size };
  const eng = ENGINES[name](state);
  const rom = FIXTURES[name].build();

  const translate = c.translate_cases.map((cc) => {
    const st = cc.mapper_state;
    const r = mod.translate(hx(cc.cpu_address), st);
    const e = st && !mod.validateState(st) && hx(cc.cpu_address) <= BUS_LIMIT ? eng(hx(cc.cpu_address)) : null;
    return { name: cc.name, cpu_address: cc.cpu_address, mapper_state: st, expect: cc.expect ? { region: cc.expect.region, offset: cc.expect.offset } : { error: cc.expect_error.code }, engine_agree: e ? !!(e.error ? cc.expect_error && e.error.code === cc.expect_error.code : e.region === cc.expect.region && e.offset === hx(cc.expect.offset)) : 'n/a' };
  });
  const negatives = c.translate_negatives.map((cc) => ({ name: cc.name, cpu_address: cc.cpu_address, mapper_state: cc.mapper_state, expect_error: cc.expect_error.code }));

  const invert = c.invert_cases.map((ic) => {
    const off = ic.rom_offset_value ?? hx(ic.rom_offset);
    const st = ic.mapper_state ?? state;
    const r = mod.invert(off, st);
    return { name: ic.name, rom_offset: ic.rom_offset ?? String(off), mapper_state: st, expect: r.error ? { error: r.error.code } : { aliases: r.aliases.map(hexs) } };
  });
  // mostras adicionais verificadas por enumeración exaustiva (crosscheck verde)
  const rng = makeRng(0xd1f2 ^ size);
  const extraInvert = [];
  for (let i = 0; i < 60; i += 1) {
    const off = (rng(size) & ~0xffff) | (rng(size) & 0x8000);
    const r = mod.invert(off, state);
    extraInvert.push({ rom_offset: hexs(off), aliases: r.aliases.map(hexs) });
  }

  const read = (c.read_cases ?? []).map((rc) => {
    const res = mod.read(hx(rc.cpu_address), rc.length, rc.mapper_state ?? state, rc.rom_short_by ? rom.slice(0, rom.length - rc.rom_short_by) : rom);
    const segs = (res.segments ?? []).map((seg) => {
      if (seg.error) return { region: seg.region, offset: seg.offset !== undefined ? hexs(seg.offset) : undefined, error: seg.error.code, detail_contains: seg.error.detail ? 'ver detalle' : undefined };
      return { region: seg.region, offset: hexs(seg.offset), bytes_hex: Buffer.from(seg.bytes.slice(0, 32)).toString('hex') };
    });
    return { name: rc.name, cpu_address: rc.cpu_address, length: rc.length, mapper_state: rc.mapper_state ?? state, rom_short_by: rc.rom_short_by ?? 0, expect_segments: segs, expect_error: res.error ? res.error.code : undefined };
  });

  const entry = { fixture: { sha256: sha256(rom), rom_size: size }, translate, translate_negatives: negatives, invert_cases: invert, invert_samples_exhaustive_verified: extraInvert, read_cases: read };

  if (name === 'md-ssf2') {
    const seqs = [];
    const r2 = makeRng(0x5e70);
    for (let t = 0; t < 12; t += 1) {
      let st = { rom_size: 0x800000, banks: {} };
      const writes = [];
      const n = 1 + r2(6);
      for (let k = 0; k < n; k += 1) {
        const addr = 0xa13000 | (r2(0x100) & ~1);
        const data = r2(0x100);
        const w = mdSsf2.writeMapperRegister(addr, data, st);
        if (!w.error) st = w.state;
        writes.push({ cpu_address: hexs(addr).slice(0, 8), data });
      }
      const probes = [];
      for (let win = 0; win < 8; win += 1) {
        const addr = win * 0x80000 + 0x12345;
        const tr = mdSsf2.translate(addr, st);
        probes.push({ cpu_address: `0x${addr.toString(16)}`, offset: hexs(tr.offset) });
      }
      seqs.push({ seq: t, writes, expect_banks: st.banks, probes });
    }
    entry.ssf2_write_sequences = seqs;
    entry.ssf2_pinned_write_register_cases = c.write_register_cases ?? [];
  }

  doc.profiles[name] = entry;
}

const json = JSON.stringify(doc, null, 2) + '\n';
const target = new URL('differential/rust-vectors-v1.json', DATA);
mkdirSync(new URL('differential/', DATA), { recursive: true });
writeFileSync(target, json);
console.log(json.length, 'bytes; sha256:', createHash('sha256').update(json).digest('hex'));
