// Verificador INDEPENDENTE da jornada Sonic cadence (Etapa 5/6).
// Nao importa nenhum modulo de produto nem confia no report do driver: le as
// series BRUTAS em hex gravadas pelo cenario (raw_rows com indices absolutos do
// core), recalcula coverage/transicoes/recargas/gaps/moda do zero e confere as
// expectativas congeladas em docs/rex_profiles/sonic_cadence/EXPECTATIONS-ETAPA5.md
// + EXPECTATIONS-ETAPA5-ADDENDUM-A.md (com Retificacao A) + os pins de ROM/byte
// lidos direto dos arquivos-ROM apontados.
// Uso: node scripts/qa/sonic-cadence-journey-verifier.mjs --report <pilotDir/report.json> [--out <veredito.json>]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_ROM_SHA256 = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
const BASE_ROM_SIZE = 531577;
const WAIT_ADDR = 0x13bae;
// Tabela congelada: byte do arquivo-ROM -> modo esperado dos gaps (H_N+1, NTSC).
const EXPECT = { base: { interval: 23, mode: 24 }, modificada: { interval: 40, mode: 41 } };
const WINDOW = { recordFrom: 1500, recordTo: 2900, totalFrames: 2901 };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const af = (n) => "0x" + n.toString(16).toUpperCase();

// Reimplementacao propria (nao importada do driver) da analise sobre as linhas
// brutas {frame, bytes_hex}: so contam pares estritamente adjacentes dentro da
// janela congelada; obFrame = +0x1b, obAnim = +0x1d, timer = +0x1f do objeto
// em 0xD000 (oracle da Etapa 4).
function recomputeSeries(rows, expectedByte) {
  const window = rows.filter((r) => r.frame >= WINDOW.recordFrom && r.frame <= WINDOW.recordTo);
  const decoded = window.map((r) => {
    const bytes = Buffer.from(r.bytes_hex, "hex");
    return { frame: r.frame, frameByte: bytes[0x1b], anim: bytes[0x1d], timer: bytes[0x1f] };
  });
  const idleTotal = decoded.filter((d) => d.anim === 5).length;
  let adjacentIdlePairs = 0;
  let decrementOne = 0;
  let transitions = 0;
  const reloadFrames = [];
  for (let i = 1; i < decoded.length; i += 1) {
    const a = decoded[i - 1];
    const b = decoded[i];
    if (a.anim !== 5 || b.anim !== 5 || b.frame !== a.frame + 1) continue;
    adjacentIdlePairs += 1;
    if (a.timer >= 1 && b.timer === a.timer - 1) decrementOne += 1;
    if (a.frameByte !== b.frameByte) transitions += 1;
    if (a.timer === 0 && b.timer === expectedByte) reloadFrames.push(b.frame);
  }
  const gaps = [];
  for (let i = 1; i < reloadFrames.length; i += 1) {
    const gap = reloadFrames[i] - reloadFrames[i - 1];
    if (gap > 0 && gap <= 600) gaps.push(gap);
  }
  const counts = new Map();
  for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  let mode = null;
  let best = -1;
  for (const [gap, count] of counts) if (count > best) { mode = gap; best = count; }
  return {
    window_rows: decoded.length,
    idle_coverage_ratio: decoded.length ? idleTotal / decoded.length : null,
    adjacent_idle_pairs: adjacentIdlePairs,
    timer_decrement_one_ratio: adjacentIdlePairs ? decrementOne / adjacentIdlePairs : null,
    transitions,
    reloads: reloadFrames.length,
    reload_zero_to_byte_frames: reloadFrames,
    gaps,
    gap_mode: mode,
    gap_mode_ratio: gaps.length ? best / gaps.length : null,
  };
}

function windowContinuity(rows) {
  if (rows[0]?.frame !== WINDOW.recordFrom || rows.at(-1)?.frame !== WINDOW.totalFrames) return `bordas ${rows[0]?.frame}..${rows.at(-1)?.frame}`;
  for (let i = 1; i < rows.length; i += 1) if (rows[i].frame !== rows[i - 1].frame + 1) return `buraco em ${rows[i - 1].frame}->${rows[i].frame}`;
  if (rows.length !== WINDOW.totalFrames - WINDOW.recordFrom + 1) return `contagem ${rows.length}`;
  return null;
}

export function verify(reportPath, readJson, readFile) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, pass: Boolean(ok), detail: detail ?? null });
  const report = readJson(reportPath);
  const pilotDir = report.pilot_dir;

  check("schema do report da jornada", report.schema === "rex-sonic-cadence-journey/v1", report.schema);
  check("documento de expectativas referenciado", report.expectations === "docs/rex_profiles/sonic_cadence/EXPECTATIONS-ETAPA5.md", report.expectations);
  check("report declara allPass=true", report.allPass === true);
  check("SHA da ROM base no report e o pinado", report.base_rom_sha256 === BASE_ROM_SHA256, report.base_rom_sha256);
  check("binary_sha256 registrado", typeof report.binary_sha256 === "string" && report.binary_sha256.length === 64);

  // As series brutas ficam no validationDir irmao do pilotDir, com o prefixo
  // do pilotDir (`<prefixo>-cadence-journey`) + `-series-<label>.json`.
  const series = {};
  for (const label of Object.keys(EXPECT)) {
    const guess = path.join(path.dirname(pilotDir), `${path.basename(pilotDir)}-series-${label}.json`);
    try { series[label] = readJson(guess); } catch { series[label] = null; }
  }

  let baseRom; let appliedRom;
  try {
    const baseSeries = series.base ?? {};
    check("serie base presente com schema v1", baseSeries?.schema === "rex-sonic-cadence-journey-series/v1", baseSeries?.schema ?? "ausente");
    baseRom = readFile(baseSeries.rom_path);
    appliedRom = readFile(path.join(pilotDir, "cadence-40-applied.bin"));
  } catch (error) {
    check("ROMs base/aplicada legiveis", false, String(error));
    return { checks, allPass: false };
  }

  check("arquivo-ROM base lido cru bate com o pin", sha256(baseRom) === BASE_ROM_SHA256 && baseRom.length === BASE_ROM_SIZE, `${baseRom.length} bytes`);
  const diffs = [];
  for (let i = 0; i < Math.max(baseRom.length, appliedRom.length); i += 1) if (baseRom[i] !== appliedRom[i]) diffs.push(i);
  check(`copia aplicada difere da base em exatamente 1 byte em ${af(WAIT_ADDR)}`, diffs.length === 1 && diffs[0] === WAIT_ADDR, JSON.stringify(diffs));
  check("bytes da tabela lidos crus dos arquivos (23 base, 40 aplicada)", baseRom[WAIT_ADDR] === 23 && appliedRom[WAIT_ADDR] === 40, `${baseRom[WAIT_ADDR]},${appliedRom[WAIT_ADDR]}`);

  const measured = {};
  for (const [label, expect] of Object.entries(EXPECT)) {
    const s = series[label];
    if (!s) { check(`serie ${label} presente`, false); continue; }
    check(`serie ${label}: sha da ROM observada bate com o arquivo`, s.rom_sha256 === sha256(label === "base" ? baseRom : appliedRom), s.rom_sha256);
    check(`serie ${label}: core reportado`, Boolean(s.core_label), s.core_label);
    const bad = windowContinuity(s.raw_rows ?? []);
    check(`serie ${label}: bruto continuo ${WINDOW.recordFrom}..${WINDOW.totalFrames} sem buracos`, bad === null, bad ?? `ok (${s.raw_rows?.length} linhas)`);
    check(`serie ${label}: descarte fora da janela = exatamente [${WINDOW.totalFrames}]`, JSON.stringify(s.dropped_outside_window) === JSON.stringify([WINDOW.totalFrames]), JSON.stringify(s.dropped_outside_window));
    const m = recomputeSeries(s.raw_rows, expect.interval);
    measured[label] = m;
    check(`${label}: intervalo do arquivo-ROM == serie congelada (${expect.interval})`, s.interval_byte === expect.interval, s.interval_byte);
    check(`${label}: cobertura idle >= 0,40`, m.idle_coverage_ratio >= 0.4, m.idle_coverage_ratio?.toFixed(4));
    check(`${label}: timer decresce de 1 em >= 80% dos pares adjacentes idle`, m.timer_decrement_one_ratio >= 0.8, m.timer_decrement_one_ratio?.toFixed(4));
    check(`${label}: >= 3 recargas 0 -> ${expect.interval}`, m.reloads >= 3, m.reloads);
    check(`${label}: >= 5 transicoes de frame`, m.transitions >= 5, m.transitions);
    check(`${label}: modo dos gaps == ${expect.mode} (H_N+1 congelado)`, m.gap_mode === expect.mode, `modo=${m.gap_mode} razao=${m.gap_mode_ratio?.toFixed(3)}`);
    check(`${label}: razao da moda >= 0,80`, m.gap_mode_ratio >= 0.8, m.gap_mode_ratio?.toFixed(4));
    check(`${label}: todos os gaps sao a moda (histograma unico)`, m.gaps.every((g) => g === m.gap_mode), JSON.stringify(m.gaps.slice(0, 5)));
  }

  const mBase = measured.base?.gap_mode;
  const mMod = measured.modificada?.gap_mode;
  check("discriminante: modos base e modificada distintos", mBase !== null && mMod !== null && mBase !== mMod, `${mBase} vs ${mMod}`);
  const failed = checks.filter((c) => !c.pass);
  return {
    schema: "rex-sonic-cadence-journey-verification/v1",
    verdict: mBase === 24 && mMod === 41 && failed.length === 0 ? "H_N+1 confirmado na jornada desktop" : "INCONCLUSIVE/FAIL",
    measured: { base: { interval: 23, gap_mode: mBase }, modificada: { interval: 40, gap_mode: mMod } },
    checks,
    allPass: failed.length === 0,
  };
}

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
if (args.includes("--help") || !flag("--report")) {
  console.error("uso: node sonic-cadence-journey-verifier.mjs --report <pilotDir/report.json> [--out <veredito.json>]");
  process.exit(2);
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readFile = (p) => readFileSync(p);
const result = verify(flag("--report"), readJson, readFile);
if (flag("--out")) await import("node:fs").then(({ writeFileSync }) => writeFileSync(flag("--out"), JSON.stringify(result, null, 2)));
for (const c of result.checks) console.log(`${c.pass ? "OK  " : "FAIL"} ${c.name}${c.detail !== null && c.detail !== undefined ? " :: " + c.detail : ""}`);
console.log(`veredito: ${result.verdict} :: allPass=${result.allPass}`);
process.exit(result.allPass ? 0 : 1);
