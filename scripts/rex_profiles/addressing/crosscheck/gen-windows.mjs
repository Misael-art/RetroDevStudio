// Xerador de táboas de ventanas para o cross-check (rodada REX-A, validacion
// externa 2026-09-25).
//
// Que fa: le o boards.bml CRUDO de bsnes (fixado por commit + sha256),
// extrai mecanicamente as ventanas ROM dos taboleiros LOROM / HIROM /
// EXHIROM (e as ventanas Save dos taboleiros -RAM correspondentes como
// evidencia) e as escribe como DATOS puros en
// data/rex_profiles/addressing/crosscheck/windows-generated.json.
//
// Por que: o cross-check non debe fiarse da transcricion humana da formula
// fechada de cada perfil. Estes datos aliméntanse ao matcher xenerico
// (crosscheck/engine.mjs) coas primitivas formais reduce/mirror de bsnes
// (memory.cpp:63-65). Ningunha liña de código GPL transcrita: só extraese a
// táboa declarativa de ventás (feitos, non expressão creadora).
//
// Uso (reproducible para o integrador):
//   gh api "repos/byuu/bsnes/contents/bsnes/target-bsnes/resource/system/boards.bml?ref=7d5aa1e656b9171524d01b1b22917197d8121cb4" --jq .content | base64 -d > /tmp/rex-crosscheck/boards.bml
//   sha256sum /tmp/rex-crosscheck/boards.bml   # debe dar PINNED_SHA256
//   node scripts/rex_profiles/addressing/crosscheck/gen-windows.mjs /tmp/rex-crosscheck/boards.bml data/rex_profiles/addressing/crosscheck/windows-generated.json

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseBoardWindows } from './engine.mjs';

export const SOURCE = {
  project: 'bsnes',
  repo: 'byuu/bsnes',
  commit: '7d5aa1e656b9171524d01b1b22917197d8121cb4',
  path: 'bsnes/target-bsnes/resource/system/boards.bml',
  license: 'GPL-3.0 (usado SO como especificacion; extraese a taboa de ventas, non se transcribe codigo)',
  fetch_command: 'gh api "repos/byuu/bsnes/contents/bsnes/target-bsnes/resource/system/boards.bml?ref=7d5aa1e656b9171524d01b1b22917197d8121cb4" --jq .content | base64 -d',
  sha256: 'b8006d805bef610bb527a486e8b576d48531e6afd94fce7083d3ca9eb553b378',
};

export const PRIMITIVES = {
  reference: 'bsnes@7d5aa1e sfc/memory/memory.cpp:63-65 (Bus::map) + memory-inline.hpp (reduce/mirror)',
  model: 'offset=reduce(A,mask); base=mirror(base,size); offset=base+mirror(offset,size-base)',
  note: 'as primitivas implementan-se EN JS en engine.mjs a partir desta descricion formal, non do codigo orixinal',
};

const BOARDS = [
  { key: 'LOROM', board: 'LOROM', saveBoard: 'LOROM-RAM' },
  { key: 'HIROM', board: 'HIROM', saveBoard: 'HIROM-RAM' },
  { key: 'EXHIROM', board: 'EXHIROM', saveBoard: 'EXHIROM-RAM' },
];

export function generateWindows(bmlText) {
  const digest = `0x${createHash('sha256').update(bmlText).digest('hex').slice(0, 8)}`;
  if (!/^database\b/.test(bmlText)) {
    throw new Error('a entrada non parece boards.bml de bsnes');
  }
  const boards = {};
  for (const { key, board, saveBoard } of BOARDS) {
    const rom = parseBoardWindows(bmlText, board, 'Program');
    const save = parseBoardWindows(bmlText, saveBoard, 'Save');
    if (rom.length === 0) throw new Error(`taboleiro ${board} sen ventas Program`);
    boards[key] = { board, rom_windows: rom, save_board: saveBoard, save_windows: save };
  }
  return boards;
}

function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error('uso: gen-windows.mjs <boards.bml> <saida.json>');
    process.exit(2);
  }
  const buf = readFileSync(inPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE.sha256) {
    console.error(`sha256 NON coincide co fixado:\n  esperado ${SOURCE.sha256}\n  recibido ${sha}`);
    process.exit(1);
  }
  const text = buf.toString('latin1').replace(/\r\n/g, '\n');
  const boards = generateWindows(text);
  const doc = {
    contract_version: 1,
    generated_by: 'scripts/rex_profiles/addressing/crosscheck/gen-windows.mjs',
    generated_on: '2026-09-25',
    source: { ...SOURCE, input_sha256_verified: sha },
    primitives: PRIMITIVES,
    derivation: 'ventanas ROM/Save extraidas mecanicamente do BML crudo; os valores numericos (banks/mask/base) son datos do arquivo orixinal, non a aritmetica fechada dun perfil',
    boards,
  };
  writeFileSync(outPath, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`escrito ${outPath} (sha entrada ${sha.slice(0, 12)}…)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
