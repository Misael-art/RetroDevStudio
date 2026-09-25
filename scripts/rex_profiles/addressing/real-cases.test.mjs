// Test de regresion dos casos reais autorizados (rodada 2026-09-25).
// Re-executa scripts/rex_profiles/addressing/real_cases/verify.mjs sobre o
// corpus so-lectura e compara byte-a-byte (JSON) coas evidencias pinadas en
// data/rex_profiles/addressing/<perfil>/evidence/real-case.json.
// Se o corpus non esta presente, os casos marcanses como skip explicito —
// a evidencia pinada segue sendo consumible polo integrador (vectores +
// hashes de membro/contener separados).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CORPUS = process.env.REX_CORPUS_DIR || '/home/misael/emulation/roms';
const DATA = new URL('../../../data/rex_profiles/addressing/', new URL(import.meta.url));
const VERIFY = new URL('real_cases/verify.mjs', import.meta.url);

const CONTAINERS = {
  'md-linear': `${CORPUS}/genesis/Sonic the Hedgehog (USA, Europe).bin`,
  'snes-lorom': `${CORPUS}/sfc/Kikou Keisatsu Metal Jack (Japan) (Translated En).zip`,
  'snes-hirom': `${CORPUS}/snes/Chrono Trigger (USA).zip`,
  'md-ssf2': `${CORPUS}/genesis/Super Street Fighter II - The New Challengers (USA) (Translated PtBr).zip`,
};

const corpusPresent = Object.values(CONTAINERS).every((p) => existsSync(p));

let fresh = null;
if (corpusPresent) {
  const out = mkdtempSync(`${tmpdir()}/rex-real-`);
  const r = spawnSync('node', [VERIFY.pathname, '--out', out], { encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, `verify.mjs fallou: ${r.stderr}`);
  fresh = Object.fromEntries(
    Object.keys(CONTAINERS).map((p) => [p, JSON.parse(readFileSync(`${out}/${p}-real-case.json`, 'utf8'))]),
  );
  fresh['snes-exhirom'] = JSON.parse(readFileSync(`${out}/snes-exhirom-real-case.json`, 'utf8'));
}

const pinned = Object.fromEntries(
  [...Object.keys(CONTAINERS), 'snes-exhirom'].map((p) => [
    p,
    JSON.parse(readFileSync(new URL(`${p}/evidence/real-case.json`, DATA), 'utf8')),
  ]),
);

for (const name of Object.keys(pinned)) {
  test(`caso real ${name}: re-execution ≡ evidencia pinada`, { skip: corpusPresent ? false : 'corpus autorizado non presente' }, () => {
    assert.deepEqual(fresh[name], pinned[name], `${name}: deriva non determinista ou corpus modificado`);
  });
}

test('casos reais: invariantes criticas (paridade motor, aliases, troca de banco SSF2)', { skip: corpusPresent ? false : 'corpus autorizado non presente' }, () => {
  for (const name of Object.keys(CONTAINERS)) {
    const j = fresh[name];
    assert.equal(j.parity_engine_vs_profile.mismatches, 0, `${name}: perfil ≠ motor-independente`);
    const alias = j.alias_byte_equality;
    if (alias && name !== 'md-ssf2') {
      assert.equal(alias.mismatches, 0, `${name}: bytes desiguais entre aliases do mesmo offset`);
      assert.ok(alias.alias_reads > 2000, `${name}: varredura de aliases demasiado curta`);
    }
  }
  const ssf2 = fresh['md-ssf2'];
  assert.equal(ssf2.bank_switch_verified.bytes_igual_ficheiro, true, 'SSF2: bytes tralo troco ≠ ficheiro');
  assert.equal(ssf2.parity_engine_vs_profile_switched.mismatches, 0, 'SSF2 trocado: perfil ≠ motor');
  assert.deepEqual(ssf2.bank_switch_verified.expect_banks, { 5: 18 });
  assert.equal(ssf2.bank_switch_verified.probe.perfil_offset, ssf2.bank_switch_verified.probe.offset_esperado);
  assert.equal(ssf2.bank_switch_verified.probe.engine_offset, ssf2.bank_switch_verified.probe.offset_esperado);
});

test('exhirom: entrega fixture-only rexistrada sen clasificacion automatica', () => {
  assert.equal(pinned['snes-exhirom'].kind, 'fixture-only');
  assert.ok(pinned['snes-exhirom'].candidatos_examinados.length >= 3);
  assert.match(pinned['snes-exhirom'].motivo, /31 ficheiros sen banner/);
});

test('identidade separada: hash de membro difire do hash do contener onde hai contener', () => {
  for (const name of ['snes-lorom', 'snes-hirom', 'md-ssf2']) {
    const j = pinned[name];
    assert.notEqual(j.rom_member.sha256, j.container.sha256, `${name}: identidades non separadas`);
    assert.ok(j.rom_member.sha256 && j.container.sha256);
    assert.match(j.rom_member.note || j.rom_member.name, /.*/);
  }
});
