// Cross-check BYOR do decoder aPLib: implementação JS do agente A contra as
// expectativas estruturais medidas por ela mesma na ROM comercial local.
//
// Este script NÃO implementa o decoder: ele importa o `aplib.mjs` do branch A
// (pinado por SHA-256 do conteúdo extraído via `git show`, nunca do working
// tree) e o executa sobre os dois streams APLIB do TiledImage visível, exigindo
// o enquadramento estrutural que a própria agente A mediu (16 000/4 485 e
// 2 240/1 196). Os SHA-256 de saída que ele imprime são os mesmos que o aceite
// `#[ignore]` do produto em Rust (`byor_aplib_*`) pinam — e quem decide esses
// hashes são os dois decodificadores de referência sobre o stream extraído da
// ROM, não nem A nem o produto:
//
//   dd if=$ROM bs=1 skip=$((0x2e4d4)) count=4485 of=/tmp/tileset.ap
//   ~/.cache/rex-codecs/oracle-tools/apultra -d /tmp/tileset.ap /tmp/o1.bin
//   java -jar ~/.cache/rex-codecs/oracle-tools/SGDK211/bin/apj.jar u /tmp/tileset.ap /tmp/o2.bin s
//   sha256sum /tmp/o1.bin /tmp/o2.bin
//
// ROM comercial: lida do caminho local durável, nunca staged. Ausência ou
// identidade divergente é falha (rc != 0), nunca skip.
//
// Uso:
//   node scripts/rex_profiles/integrator/aplib/byor_cross_check.mjs
//   RDS_HAMOOPIG_ROM=/caminho/hamoopig-reference.bin node <este script>

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROM_SHA256 = '558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9';
const ROM_SIZE = 917504;
const ROM_DEFAULT = 'data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin';

// Implementação de referência (agente A) e suas expectativas estruturais, do
// `visible-resource-manifest.json` de `codex/rex-a-addressing`.
const ORACLE_REV = 'codex/rex-a-addressing';
const ORACLE_PATH = 'scripts/rex_profiles/lz4w/aplib.mjs';
const ORACLE_SHA256 = '62425497c5a2cdbef80012f83f095604186cb698943d8529ef21de0c39a823c0';

const ALVOS = [
  { nome: 'tileset-0x21b44', stream: 0x2e4d4, decodedBytes: 16000, bytesConsumed: 4485 },
  { nome: 'tilemap-0x21b4c', stream: 0x2d534, decodedBytes: 2240, bytesConsumed: 1196 },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const falhe = (msg) => {
  console.error(`FALHA: ${msg}`);
  process.exit(1);
};

const romPath = process.env.RDS_HAMOOPIG_ROM ?? ROM_DEFAULT;
let rom;
try {
  rom = readFileSync(romPath);
} catch (e) {
  falhe(`ROM BYOR ausente ou ilegível em ${romPath}: ${e.message}`);
}
if (rom.length !== ROM_SIZE) falhe(`ROM ${romPath} tem ${rom.length} B, esperado ${ROM_SIZE} B`);
if (sha256(rom) !== ROM_SHA256) falhe(`identidade da ROM divergente em ${romPath}`);

const conteudoOraculo = execFileSync('git', ['show', `${ORACLE_REV}:${ORACLE_PATH}`]);
if (sha256(conteudoOraculo) !== ORACLE_SHA256) {
  falhe(`decoder de referência divergiu do hash pinado (${ORACLE_REV}:${ORACLE_PATH})`);
}
const dir = mkdtempSync(join(tmpdir(), 'rex-aplib-oracle-'));
const arquivoOraculo = join(dir, 'aplib.mjs');
writeFileSync(arquivoOraculo, conteudoOraculo);
const { aplibDecode } = await import(`file://${arquivoOraculo}`);

const resultado = {
  schema: 'rex-integrator-aplib-byor-crosscheck/v1',
  rom: { caminho: romPath, sha256: ROM_SHA256, sizeBytes: ROM_SIZE },
  oraculo: { rev: ORACLE_REV, caminho: ORACLE_PATH, sha256: ORACLE_SHA256 },
  alvos: [],
};

for (const alvo of ALVOS) {
  const d = aplibDecode(rom, { offset: alvo.stream });
  const ok = d.output.length === alvo.decodedBytes && d.bytesConsumed === alvo.bytesConsumed;
  resultado.alvos.push({
    nome: alvo.nome,
    streamOffset: `0x${alvo.stream.toString(16)}`,
    decodedLen: d.output.length,
    esperadoDecodedLen: alvo.decodedBytes,
    bytesConsumed: d.bytesConsumed,
    esperadoBytesConsumed: alvo.bytesConsumed,
    fimDoStream: `0x${(alvo.stream + d.bytesConsumed).toString(16)}`,
    decodedSha256: sha256(d.output),
    ok,
  });
  if (!ok) {
    falhe(
      `${alvo.nome}: decodificado ${d.output.length} B / consumidos ${d.bytesConsumed} B ` +
        `diverge da expectativa ${alvo.decodedBytes} B / ${alvo.bytesConsumed} B`,
    );
  }
}

console.log(JSON.stringify(resultado, null, 1));
