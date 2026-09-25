// Testes do perfil md-ssf2 contra expectativas pinadas ANTES da implementacao
// (commit bf79daa precede este arquivo; ver
// data/rex_profiles/addressing/md-ssf2/expected/translate-cases.json).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  translate,
  invert,
  read,
  validateState,
  writeMapperRegister,
} from './md-ssf2.mjs';
import { buildMdSsf2Fixture, sha256 } from './build-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_PATH = join(HERE, '../../../data/rex_profiles/addressing/md-ssf2/expected/translate-cases.json');
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));

const parseHex = (s) => parseInt(s, 16);
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('fixture autoral reproduz o sha256 pinado', () => {
  const rom = buildMdSsf2Fixture();
  assert.equal(rom.length, expected.fixture.rom_size);
  assert.equal(sha256(rom), expected.fixture.sha256);
});

test('translate: casos positivos pinados (janelas, banks, mascaras, regioes nao-ROM)', () => {
  for (const c of expected.translate_cases) {
    const got = translate(parseHex(c.cpu_address), c.mapper_state);
    assert.ok(!got.error, `${c.name}: inesperado erro ${JSON.stringify(got.error)}`);
    assert.equal(got.region, c.expect.region, `${c.name}: regiao`);
    assert.equal(got.offset, parseHex(c.expect.offset), `${c.name}: offset`);
  }
});

test('translate: negativos pinados (erro estruturado, nunca offset 0)', () => {
  for (const c of expected.translate_negatives) {
    const got = translate(parseHex(c.cpu_address), c.mapper_state);
    assert.ok(got.error, `${c.name}: esperava erro, recebi ${JSON.stringify(got)}`);
    assert.equal(got.error.code, c.expect_error.code, `${c.name}: codigo`);
    assert.equal(got.offset, undefined, `${c.name}: erro nao carrega offset`);
    assert.ok(typeof got.error.detail === 'string' && got.error.detail.length > 0, `${c.name}: detalhe`);
  }
});

test('translate discrimina estado errado: banks {1:5} vs {1:9} vs identidade divergem', () => {
  const id = translate(0x080000, { rom_size: 0x400000 });
  const b5 = translate(0x080000, { rom_size: 0x400000, banks: { 1: 5 } });
  const b9 = translate(0x080000, { rom_size: 0x400000, banks: { 1: 9 } });
  assert.deepEqual(id, { region: 'rom', offset: 0x080000 });
  assert.deepEqual(b5, { region: 'rom', offset: 0x0a0000 });
  assert.deepEqual(b9, { region: 'rom', offset: 0x120000 });
});

test('translate: entradas invalidas nao causam panic', () => {
  for (const bad of [-1, 1.5, NaN, '0x0', undefined, null]) {
    const got = translate(bad, { rom_size: 0x400000 });
    assert.equal(got.error.code, 'out-of-range', `entrada ${String(bad)}`);
  }
  assert.equal(validateState(null).error.code, 'unsupported');
  assert.equal(validateState({ rom_size: 'x' }).error.code, 'unsupported');
});

test('write_mapper_register: casos pinados (decodificacao, efeito na traducao, acumulacao)', () => {
  for (const c of expected.write_register_cases) {
    let state = c.mapper_state;
    for (const w of c.writes) {
      const got = writeMapperRegister(parseHex(w.cpu_address), w.data, state);
      assert.ok(!got.error, `${c.name}: erro inesperado ${JSON.stringify(got.error)}`);
      state = got.state;
    }
    assert.deepEqual(state.banks ?? {}, c.expect_banks, `${c.name}: banks`);
    assert.equal(state.rom_size, c.mapper_state.rom_size, `${c.name}: rom_size preservado`);
    for (const t of c.expect_translate) {
      const got = translate(parseHex(t.cpu_address), state);
      assert.equal(got.offset, parseHex(t.offset), `${c.name}: translate 0x${parseHex(t.cpu_address).toString(16)}`);
    }
  }
});

test('write_mapper_register: negativos pinados', () => {
  for (const c of expected.write_register_negatives) {
    const got = writeMapperRegister(parseHex(c.cpu_address), c.data, c.mapper_state);
    assert.ok(got.error, `${c.name}: esperava erro, recebi ${JSON.stringify(got)}`);
    assert.equal(got.error.code, c.expect_error.code, `${c.name}: codigo`);
    assert.equal(got.state, undefined, `${c.name}: erro nao carrega estado`);
  }
});

test('write_mapper_register e pura: nunca muta o estado recebido', () => {
  const state = { rom_size: 0x400000, banks: { 1: 5 } };
  const before = JSON.stringify(state);
  const got = writeMapperRegister(0xa130f5, 6, state);
  assert.equal(JSON.stringify(state), before, 'estado original imutado');
  assert.notEqual(got.state, state, 'retorna objeto novo');
  assert.deepEqual(got.state.banks, { 1: 5, 2: 6 });
});

test('write->read observa efeito do registrador na ROM (exigencia da rodada)', () => {
  const rom = buildMdSsf2Fixture();
  const initial = read(0x080000, 8, { rom_size: 0x400000 }, rom);
  assert.equal(hex(initial.segments[0].bytes), 'f4b8fb8371b6131a');
  const { state } = writeMapperRegister(0xa130f3, 5, { rom_size: 0x400000 });
  const after = read(0x080000, 8, state, rom);
  assert.equal(hex(after.segments[0].bytes), '1f7f9e948c416f8e');
  assert.equal(after.segments[0].offset, 0x0a0000);
});

test('invert: todos os aliases pinados (ordem crescente, multi-janela, lista vazia)', () => {
  for (const c of expected.invert_cases) {
    const offset = c.rom_offset_value ?? parseHex(c.rom_offset);
    const got = invert(offset, c.mapper_state);
    if (c.expect_error) {
      assert.ok(got.error, `${c.name}: esperava erro`);
      assert.equal(got.error.code, c.expect_error.code, `${c.name}: codigo`);
      continue;
    }
    assert.ok(!got.error, `${c.name}: ${JSON.stringify(got.error)}`);
    const want = c.expect_aliases.map(parseHex);
    assert.deepEqual(got.aliases, want, c.name);
  }
});

test('read: segmentos pinados, incluindo fronteiras de janela com banks distintos', () => {
  const rom = buildMdSsf2Fixture();
  for (const c of expected.read_cases) {
    const romArg = c.rom_short_by ? rom.slice(0, rom.length - c.rom_short_by) : rom;
    const got = read(parseHex(c.cpu_address), c.length, c.mapper_state, romArg);
    if (c.expect_error) {
      assert.equal(got.error.code, c.expect_error.code, c.name);
      assert.equal(got.segments, undefined, `${c.name}: erro top-level nao vem com segments`);
      continue;
    }
    assert.ok(got.segments, `${c.name}: sem segments`);
    assert.equal(got.segments.length, c.expect_segments.length, `${c.name}: contagem`);
    c.expect_segments.forEach((wantSeg, i) => {
      const gotSeg = got.segments[i];
      if (wantSeg.error) {
        assert.ok(gotSeg.error, `${c.name} seg ${i}: esperava erro`);
        assert.equal(gotSeg.error.code, wantSeg.error.code, `${c.name} seg ${i}`);
        if (wantSeg.error.detail_contains) {
          assert.ok(gotSeg.error.detail.includes(wantSeg.error.detail_contains), `${c.name} seg ${i}: detalhe`);
        }
        return;
      }
      assert.equal(gotSeg.region, wantSeg.region, `${c.name} seg ${i}: regiao`);
      assert.equal(gotSeg.offset, parseHex(wantSeg.offset), `${c.name} seg ${i}: offset`);
      if (wantSeg.bytes_hex !== undefined) {
        assert.equal(hex(gotSeg.bytes), wantSeg.bytes_hex, `${c.name} seg ${i}: bytes`);
      }
    });
  }
});

test('read discrimina formula errada: janela 2 mascarada (66) nao e leitura de 66*512K', () => {
  const rom = buildMdSsf2Fixture();
  const { segments } = read(0x380000, 8, { rom_size: 0x400000, banks: { 7: 66 } }, rom);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].offset, 0x100000);
  assert.equal(hex(segments[0].bytes), hex(rom.slice(0x100000, 0x100008)));
});

test('evidencia: hash do arquivo de expectativas bate com o registrado na evidencia', () => {
  const evidencePath = join(HERE, '../../../data/rex_profiles/addressing/md-ssf2/evidence/translate-fixture.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const expectedBytes = readFileSync(EXPECTED_PATH);
  assert.equal(sha256(expectedBytes), evidence.expected.output_sha256);
  assert.equal(expectedBytes.length, evidence.expected.output_len);
  assert.equal(evidence.expected.pinned_before_implementation, true);
  assert.equal(evidence.rom.sha256, expected.fixture.sha256);
});
