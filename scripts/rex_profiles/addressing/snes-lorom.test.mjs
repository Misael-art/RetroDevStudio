// Testes do perfil snes-lorom contra expectativas pinadas ANTES da
// implementacao (commit das expectativas precede este arquivo; ver
// data/rex_profiles/addressing/snes-lorom/expected/translate-cases.json).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { translate, invert, read, validateState } from './snes-lorom.mjs';
import { buildSnesLoromFixture, sha256 } from './build-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_PATH = join(HERE, '../../../data/rex_profiles/addressing/snes-lorom/expected/translate-cases.json');
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));

const parseHex = (s) => parseInt(s, 16);
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('fixture autoral reproduz o sha256 pinado', () => {
  const rom = buildSnesLoromFixture();
  assert.equal(rom.length, expected.fixture.rom_size);
  assert.equal(sha256(rom), expected.fixture.sha256);
});

test('translate: casos positivos pinados (paginas, aliases A15, espelho, regioes)', () => {
  for (const c of expected.translate_cases) {
    const got = translate(parseHex(c.cpu_address), c.mapper_state);
    assert.ok(!got.error, `${c.name}: inesperado erro ${JSON.stringify(got.error)}`);
    assert.equal(got.region, c.expect.region, `${c.name}: regiao`);
    assert.equal(got.offset, parseHex(c.expect.offset), `${c.name}: offset`);
  }
});

test('translate: negativos pinados (ambiguous onde as fontes divergem, nunca palpite)', () => {
  for (const c of expected.translate_negatives) {
    const got = translate(parseHex(c.cpu_address), c.mapper_state);
    assert.ok(got.error, `${c.name}: esperava erro, recebi ${JSON.stringify(got)}`);
    assert.equal(got.error.code, c.expect_error.code, `${c.name}: codigo`);
    assert.equal(got.offset, undefined, `${c.name}: erro nao carrega offset`);
    assert.ok(typeof got.error.detail === 'string' && got.error.detail.length > 0, `${c.name}: detalhe`);
  }
});

test('translate discrimina formula errada: pagina exige (bank&0x7F)*0x8000, nao bank*0x8000 nem bank*0x10000', () => {
  assert.deepEqual(translate(0x808000, { rom_size: 0x100000 }), { region: 'rom', offset: 0x000000 });
  assert.deepEqual(translate(0x208000, { rom_size: 0x100000 }), { region: 'rom', offset: 0x000000 });
  assert.deepEqual(translate(0x008000, { rom_size: 0x100000 }), { region: 'rom', offset: 0x000000 });
  assert.deepEqual(translate(0x018000, { rom_size: 0x100000 }), { region: 'rom', offset: 0x010000 });
});

test('translate: entradas invalidas nao causam panic', () => {
  for (const bad of [-1, 1.5, NaN, '0x0', undefined]) {
    const got = translate(bad, { rom_size: 0x100000 });
    assert.equal(got.error.code, 'out-of-range', `entrada ${String(bad)}`);
  }
  assert.equal(validateState(null).error.code, 'unsupported');
  assert.equal(validateState({ rom_size: 'x' }).error.code, 'unsupported');
});

test('invert: todos os aliases pinados (ordem crescente, lista vazia valida)', () => {
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

test('read: segmentos pinados (corte por pagina, espelho, sem clamp em bordas)', () => {
  const rom = buildSnesLoromFixture();
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
      if (wantSeg.error && !wantSeg.region) {
        assert.ok(gotSeg.error, `${c.name} seg ${i}: esperava erro`);
        assert.equal(gotSeg.error.code, wantSeg.error.code, `${c.name} seg ${i}`);
        return;
      }
      assert.equal(gotSeg.region, wantSeg.region, `${c.name} seg ${i}: regiao`);
      if (wantSeg.offset !== undefined && !wantSeg.error) {
        assert.equal(gotSeg.offset, parseHex(wantSeg.offset), `${c.name} seg ${i}: offset`);
      }
      if (wantSeg.bytes_hex !== undefined) {
        assert.equal(hex(gotSeg.bytes), wantSeg.bytes_hex, `${c.name} seg ${i}: bytes`);
      }
      if (wantSeg.error) {
        assert.ok(gotSeg.error, `${c.name} seg ${i}: esperava erro`);
        assert.equal(gotSeg.error.code, wantSeg.error.code, `${c.name} seg ${i}: codigo`);
        if (wantSeg.error.detail_contains) {
          assert.ok(gotSeg.error.detail.includes(wantSeg.error.detail_contains), `${c.name} seg ${i}: detalhe`);
        }
      }
    });
  }
});

test('evidencia: hash do arquivo de expectativas bate com o registrado na evidencia', () => {
  const evidencePath = join(HERE, '../../../data/rex_profiles/addressing/snes-lorom/evidence/translate-fixture.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const expectedBytes = readFileSync(EXPECTED_PATH);
  assert.equal(sha256(expectedBytes), evidence.expected.output_sha256);
  assert.equal(expectedBytes.length, evidence.expected.output_len);
  assert.equal(evidence.expected.pinned_before_implementation, true);
  assert.equal(evidence.rom.sha256, expected.fixture.sha256);
});
