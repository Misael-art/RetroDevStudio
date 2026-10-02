// Testes do perfil md-linear contra expectativas pinadas ANTES da implementacao
// (commit das expectativas precede o commit da implementacao; ver
// data/rex_profiles/addressing/md-linear/expected/translate-cases.json).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { translate, invert, read, validateState } from './md-linear.mjs';
import { buildMdLinearFixture, sha256 } from './build-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_PATH = join(HERE, '../../../data/rex_profiles/addressing/md-linear/expected/translate-cases.json');
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));

const parseHex = (s) => parseInt(s, 16);
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('fixture autoral reproduz o sha256 pinado', () => {
  const rom = buildMdLinearFixture();
  assert.equal(rom.length, expected.fixture.rom_size);
  assert.equal(sha256(rom), expected.fixture.sha256);
});

test('translate: casos positivos pinados', () => {
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

test('translate discrimina formula errada: espelho exige mascara, nao offset direto', () => {
  // Se a implementacao usasse offset = cpu_address (sem mascara), 0x080000
  // retornaria offset 0x080000 (fora da ROM de 512KB) em vez de 0x000000.
  const got = translate(0x080000, { rom_size: 0x80000 });
  assert.deepEqual(got, { region: 'rom', offset: 0x000000 });
});

test('translate: entradas invalidas nao causam panic', () => {
  for (const bad of [-1, 1.5, NaN, '0x0', undefined]) {
    const got = translate(bad, { rom_size: 0x80000 });
    assert.equal(got.error.code, 'out-of-range', `entrada ${String(bad)}`);
  }
  assert.equal(validateState(null).error.code, 'unsupported');
  assert.equal(validateState({ rom_size: 'x' }).error.code, 'unsupported');
});

test('invert: todos os aliases pinados (ordem crescente)', () => {
  for (const c of expected.invert_cases) {
    const got = invert(parseHex(c.rom_offset), c.mapper_state);
    if (c.expect_error) {
      assert.equal(got.error.code, c.expect_error.code, c.name);
      continue;
    }
    assert.ok(!got.error, `${c.name}: ${JSON.stringify(got.error)}`);
    const want = c.expect_aliases.map(parseHex);
    assert.deepEqual(got.aliases, want, c.name);
  }
});

test('invert: alias errado seria detectado (sem espelho -> lista curta demais)', () => {
  const { aliases } = invert(0x000000, { rom_size: 0x80000 });
  assert.equal(aliases.length, 8);
  assert.ok(aliases.includes(0x380000), 'ultimo espelho presente');
});

test('read: segmentos pinados, incluindo cruzamento de espelho e bordas', () => {
  const rom = buildMdLinearFixture();
  for (const c of expected.read_cases) {
    const romArg = c.rom_short_by ? rom.slice(0, rom.length - c.rom_short_by) : rom;
    const got = read(parseHex(c.cpu_address), c.length, c.mapper_state, romArg);
    if (c.expect_error) {
      assert.equal(got.error.code, c.expect_error.code, c.name);
      assert.equal(got.segments, undefined, `${c.name}: erro top-level nao vem com segments`);
      continue;
    }
    assert.ok(got.segments, `${c.name}: sem segments`);
    assert.equal(got.segments.length, c.expect_segments.length, `${c.name}: contagem de segmentos`);
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
      if (wantSeg.bytes_len !== undefined) {
        assert.equal(gotSeg.bytes.length, wantSeg.bytes_len, `${c.name} seg ${i}: tamanho`);
      }
    });
  }
});

test('read: cruzamento de bloco de assinatura e linear (offset continuo) e discriminaria bloco errado', () => {
  const rom = buildMdLinearFixture();
  // 0x1FFF8..0x1FFFF (bloco 0) e 0x20000..0x20007 (bloco 1) tem streams distintos,
  // mas pertencem ao MESMO segmento linear de offset (espelho de 512KB nao é
  // cruzado aqui). Uma implementacao que reiniciasse offset a cada bloco de 64KB
  // ou trocasse blocos produziria bytes diferentes dos reais da fixture.
  const { segments } = read(0x01FFF8, 16, { rom_size: 0x80000 }, rom);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].offset, 0x1fff8);
  const bytes = Buffer.from(segments[0].bytes);
  assert.equal(bytes.length, 16);
  const firstHalf = bytes.subarray(0, 8).toString('hex');
  const secondHalf = bytes.subarray(8, 16).toString('hex');
  assert.notEqual(firstHalf, secondHalf, 'blocos vizinhos devem ter streams distintos');
  assert.equal(secondHalf, Buffer.from(rom.slice(0x20000, 0x20008)).toString('hex'), 'bytes do bloco 1 corretos');
});

test('read: ROM curta gera out-of-range sem clamp silencioso', () => {
  const rom = buildMdLinearFixture().slice(0, 0x80000 - 8); // 8 bytes menor que rom_size
  const got = read(0x07FFF0, 16, { rom_size: 0x80000 }, rom);
  assert.equal(got.segments.length, 2);
  assert.equal(got.segments[0].bytes.length, 8);
  assert.equal(got.segments[1].error.code, 'out-of-range');
});

test('read: length invalido e endereco acima do bus sao rejeitados antes de alocar', () => {
  const rom = buildMdLinearFixture();
  assert.equal(read(0x000000, 0, { rom_size: 0x80000 }, rom).error.code, 'out-of-range');
  assert.equal(read(0x1000000, 1, { rom_size: 0x80000 }, rom).error.code, 'out-of-range');
  assert.equal(read(0x000000, 1, { rom_size: 0x80000 }, null).error.code, 'unsupported');
});

test('evidencia: hash do arquivo de expectativas bate com o registrado na evidencia', () => {
  const evidencePath = join(HERE, '../../../data/rex_profiles/addressing/md-linear/evidence/translate-fixture.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const expectedBytes = readFileSync(EXPECTED_PATH);
  assert.equal(sha256(expectedBytes), evidence.expected.output_sha256);
  assert.equal(expectedBytes.length, evidence.expected.output_len);
  assert.equal(evidence.expected.pinned_before_implementation, true);
  assert.equal(evidence.rom.sha256, expected.fixture.sha256);
});
