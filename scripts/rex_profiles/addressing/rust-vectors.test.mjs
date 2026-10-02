// Integridade dos vectores diferenciais para a implementación Rust
// (data/rex_profiles/addressing/differential/rust-vectors-v1.json).
// Non re-executa o export (sen efectos colaterais): verifica que o JSON
// pinado é auto-consistente coas fixtures e cos perfis neste commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mdLinear from './md-linear.mjs';
import * as mdSsf2 from './md-ssf2.mjs';
import * as snesLorom from './snes-lorom.mjs';
import * as snesHirom from './snes-hirom.mjs';
import * as snesExhirom from './snes-exhirom.mjs';
import { buildMdLinearFixture, buildMdSsf2Fixture, buildSnesLoromFixture, buildSnesHiromFixture, buildSnesExhiromFixture, sha256 } from './build-fixtures.mjs';

const DATA = new URL('../../../data/rex_profiles/addressing/', import.meta.url);
const doc = JSON.parse(readFileSync(new URL('differential/rust-vectors-v1.json', DATA), 'utf8'));

const MODS = { 'md-linear': mdLinear, 'md-ssf2': mdSsf2, 'snes-lorom': snesLorom, 'snes-hirom': snesHirom, 'snes-exhirom': snesExhirom };
const FIX = { 'md-linear': buildMdLinearFixture, 'md-ssf2': buildMdSsf2Fixture, 'snes-lorom': buildSnesLoromFixture, 'snes-hirom': buildSnesHiromFixture, 'snes-exhirom': buildSnesExhiromFixture };
const hx = (v) => (typeof v === 'string' ? parseInt(v, 16) : v);

test('rust-vectors-v1: fixture sha256 ≡ reconstrución determinista', () => {
  for (const [name, e] of Object.entries(doc.profiles)) {
    assert.equal(sha256(FIX[name]()), e.fixture.sha256, name);
    assert.equal(e.fixture.rom_size, FIX[name]().length, name);
  }
});

test('rust-vectors-v1: cada vector translate ≡ saída actual do perfil', () => {
  for (const [name, e] of Object.entries(doc.profiles)) {
    for (const v of e.translate) {
      const r = MODS[name].translate(hx(v.cpu_address), v.mapper_state);
      if (v.expect.error) assert.equal(r.error.code, v.expect.error, `${name} ${v.name}`);
      else {
        assert.equal(r.region, v.expect.region, `${name} ${v.name}`);
        assert.equal(r.offset, hx(v.expect.offset), `${name} ${v.name}`);
      }
    }
    for (const v of e.translate_negatives) {
      const r = MODS[name].translate(hx(v.cpu_address), v.mapper_state);
      assert.equal(r.error.code, v.expect_error, `${name} ${v.name}`);
    }
  }
});

test('rust-vectors-v1: invert/read ≡ saída actual (con bytes do fixture autoral)', () => {
  for (const [name, e] of Object.entries(doc.profiles)) {
    const rom = FIX[name]();
    for (const v of e.invert_cases) {
      if (v.expect?.aliases) {
        const r = MODS[name].invert(hx(v.rom_offset), v.mapper_state ?? undefined);
        assert.deepEqual(r.aliases.map((x) => `0x${x.toString(16).padStart(6, '0')}`), v.expect.aliases, `${name} ${v.name}`);
      }
    }
    for (const v of e.read_cases) {
      // replay espello do export: buffer = fixture completa, truncada só por rom_short_by
      // (o mapper_state.rom_size pode declarar un mapa maior que o ficheiro)
      const rr = MODS[name].read(hx(v.cpu_address), v.length, v.mapper_state, v.rom_short_by ? rom.slice(0, rom.length - v.rom_short_by) : rom);
      if (v.expect_error) { assert.equal(rr.error.code, v.expect_error, `${name} ${v.name}`); continue; }
      assert.ok(!rr.error, `${name} ${v.name}: ${JSON.stringify(rr.error)}`);
      assert.equal(rr.segments.length, v.expect_segments.length, `${name} ${v.name}`);
      for (let i = 0; i < rr.segments.length; i += 1) {
        const seg = rr.segments[i];
        const want = v.expect_segments[i];
        if (want.bytes_hex !== undefined) {
          assert.equal(Buffer.from(seg.bytes.slice(0, 32)).toString('hex'), want.bytes_hex, `${name} ${v.name} seg ${i}`);
        } else {
          assert.equal(seg.error.code, want.error, `${name} ${v.name} seg ${i}`);
        }
      }
    }
  }
});

test('rust-vectors-v1: secuencias SSF2 ≡ perfil actual', () => {
  const seqs = doc.profiles['md-ssf2'].ssf2_write_sequences;
  for (const s of seqs) {
    let st = { rom_size: 0x800000, banks: {} };
    for (const w of s.writes) {
      const r = mdSsf2.writeMapperRegister(hx(w.cpu_address), w.data, st);
      if (!r.error) st = r.state;
    }
    assert.deepEqual(st.banks, s.expect_banks, `seq ${s.seq}`);
    for (const p of s.probes) {
      assert.equal(mdSsf2.translate(hx(p.cpu_address), st).offset, hx(p.offset), `seq ${s.seq} probe ${p.cpu_address}`);
    }
  }
});
