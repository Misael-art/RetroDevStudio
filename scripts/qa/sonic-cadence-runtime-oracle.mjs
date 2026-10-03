// Verificador INDEPENDENTE do oracle de cadência Sonic 1 (Etapa 4).
// Não importa nenhum módulo de produto: lê os JSONs gravados pelo harness
// (src-tauri .../inspection.rs::sonic_cadence_runtime_oracle_...), recalcula
// gaps e transições a partir das séries brutas e confere as expectativas
// congeladas ANTES da execução em
// docs/rex_profiles/sonic_cadence/EXPECTATIONS-ETAPA4.md.
// Uso: node scripts/qa/sonic-cadence-runtime-oracle.mjs --oracle <dir> [--report <out.json>]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ROM_SHA256 = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
const CORE_SHA256 = "07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1";
const WAIT_ADDR = 0x13bae;
const CONSUMER_PROLOGUE_ADDR = 0x139c4;
const CONSUMER_PROLOGUE = Buffer.from("43f900013b4870001028001cb028001d", "hex");
// Expectativas da tabela congelada (byte -> {H_N, H_N1}):
const EXPECT = { "A1-original": 23, "B40-pipeline": 40, "C60-pipeline": 60 };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const af = (n) => "0x" + n.toString(16).toUpperCase();

function diffOffsets(a, b) {
  const out = [];
  if (a.length !== b.length) return ["comprimentos diferentes"];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

// Recalcula transições e gaps a partir das linhas brutas {frame,timer,frame_byte}.
// Só contam transições entre amostras de frames consecutivos (sem buracos).
function recompute(rows) {
  const transitions = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].frame !== rows[i - 1].frame + 1) continue;
    if (rows[i].frame_byte !== rows[i - 1].frame_byte) transitions.push(rows[i].frame);
  }
  const gaps = [];
  for (let i = 1; i < transitions.length; i++) gaps.push(transitions[i] - transitions[i - 1]);
  const counts = new Map();
  for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
  let mode = null;
  let best = -1;
  for (const [g, c] of counts) if (c > best) { mode = g; best = c; }
  return { transitions, gaps, mode, modeRatio: gaps.length ? best / gaps.length : 0 };
}

export function verify(oracleDir, readJson) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, pass: ok, detail: detail ?? null });
  const manifest = readJson(`${oracleDir}/manifest.json`);

  check("manifesto: schema rex-sonic-cadence-oracle/v1", manifest.schema === "rex-sonic-cadence-oracle/v1");
  check(
    "manifesto: documento de expectativas anterior à execução referenciado",
    manifest.expectations_doc === "docs/rex_profiles/sonic_cadence/EXPECTATIONS-ETAPA4.md",
    manifest.expectations_doc
  );
  check("C6/manifesto: SHA da ROM base é o pinado", manifest.base_rom_sha256 === ROM_SHA256);
  check("manifesto: core é o pinado", manifest.core_sha256 === CORE_SHA256, manifest.core_sha256);
  check("manifesto: rota de input registrada", typeof manifest.route === "string" && manifest.route.includes("900"));
  check("C5: recusas do pipeline registradas (0x00,0x80,0xFE,0xFF,noop,recurso)",
    Array.isArray(manifest.pipeline_refusals) &&
    ["0x00", "0x80", "0xFE", "0xFF"].every((v) => manifest.pipeline_refusals.includes(v)));

  const runs = {};
  for (const entry of manifest.runs) {
    runs[entry.run_id] = { meta: entry, full: readJson(`${oracleDir}/run-${entry.run_id}.json`) };
  }
  for (const id of Object.keys(EXPECT)) check(`run presente: ${id}`, Boolean(runs[id]));
  check("run presente: A2-original-controle", Boolean(runs["A2-original-controle"]));
  check("run presente: A3-original-pos-variantes", Boolean(runs["A3-original-pos-variantes"]));
  check("run presente: D-consumidor-adulterado", Boolean(runs["D-consumidor-adulterado"]));

  // Lidos dos ARQUIVOS-ROM apontados pelo manifesto (byte cru, sem produto).
  const romOf = (id) => readFileSync(runs[id].full.rom_path);
  let romA; let romB; let romC; let romD;
  try {
    romA = romOf("A1-original");
    romB = romOf("B40-pipeline");
    romC = romOf("C60-pipeline");
    romD = romOf("D-consumidor-adulterado");
  } catch (e) {
    check("ROMs do oracle legíveis", false, String(e));
    return { checks, allPass: false };
  }
  check("C6: arquivo da ROM A com SHA pinado", sha256(romA) === ROM_SHA256, sha256(romA));
  check("C4: cópia B difere de A exatamente em 1 byte em " + af(WAIT_ADDR),
    JSON.stringify(diffOffsets(romA, romB)) === JSON.stringify([WAIT_ADDR]));
  check("C4: cópia C difere de A exatamente em 1 byte em " + af(WAIT_ADDR),
    JSON.stringify(diffOffsets(romA, romC)) === JSON.stringify([WAIT_ADDR]));
  check("byte B/C lido cru: 40 e 60", romB[WAIT_ADDR] === 40 && romC[WAIT_ADDR] === 60,
    `${romB[WAIT_ADDR]},${romC[WAIT_ADDR]}`);
  check("C7: prologue do consumidor intacto em A/B/C",
    [romA, romB, romC].every((r) => r.subarray(CONSUMER_PROLOGUE_ADDR, CONSUMER_PROLOGUE_ADDR + 16).equals(CONSUMER_PROLOGUE)));
  check("D: adulteração é 1 byte e cai no prologue do consumidor",
    diffOffsets(romA, romD).length === 1 && diffOffsets(romA, romD)[0] === CONSUMER_PROLOGUE_ADDR,
    JSON.stringify(diffOffsets(romA, romD)));

  // Recálculo independente das séries.
  const measured = {};
  for (const [id, interval] of Object.entries(EXPECT)) {
    const rows = runs[id].full.series?.rows ?? [];
    const rec = recompute(rows);
    measured[id] = { ...rec, interval };
    check(`${id}: >= 5 transições`, rec.transitions.length >= 5, `transições=${rec.transitions.length}`);
    check(`${id}: >= 80% dos gaps coincidem com a moda`, rec.modeRatio >= 0.8 || gapsEmpty(rec),
      `ratio=${rec.modeRatio.toFixed(2)} moda=${rec.mode}`);
    check(`${id}: reload observado == byte do arquivo (${interval})`,
      runs[id].full.discovery?.reload_byte === interval,
      `reload=${runs[id].full.discovery?.reload_byte}`);
  }
  function gapsEmpty(rec) { return rec.transitions.length < 2; }

  // Arbitragem H-N vs H-N+1 (todas as corridas devem escolher a mesma).
  const votes = [];
  for (const [id, interval] of Object.entries(EXPECT)) {
    const mode = measured[id].mode;
    if (mode === interval) votes.push([id, "H_N"]);
    else if (mode === interval + 1) votes.push([id, "H_N1"]);
    else votes.push([id, "FORA"]);
  }
  const verdictes = new Set(votes.map(([, v]) => v));
  const verdict = verdictes.size === 1 && !verdictes.has("FORA") ? [...verdictes][0] : "INCONCLUSIVE";
  check("arbitragem: 23/24, 40/41, 60/61 exatamente sobre a tabela congelada",
    votes.every(([, v]) => v !== "FORA"), JSON.stringify(votes));
  check("arbitragem: hipótese única entre as três corridas", verdict !== "INCONCLUSIVE", verdict);

  // C1/C2: determinismo entre as três leituras do original.
  const ser = (id) => JSON.stringify(runs[id].full.series);
  check("C1: A1 == A2 (mesma ROM, mesma série)", ser("A1-original") === ser("A2-original-controle"));
  check("C2: A1 == A3 (original inalterada depois das variantes)", ser("A1-original") === ser("A3-original-pos-variantes"));

  // C3: mutação discriminante.
  const mA = measured["A1-original"].mode, mB = measured["B40-pipeline"].mode, mC = measured["C60-pipeline"].mode;
  check("C3: modos A/B/C pairwise distintos", mA !== mB && mB !== mC && mA !== mC, `${mA},${mB},${mC}`);

  // D negativo.
  const dRows = runs["D-consumidor-adulterado"].full.series?.rows ?? [];
  const dRec = dRows.length ? recompute(dRows) : { mode: null, transitions: [] };
  check("D: consumidor adulterado NÃO reproduz a cadência original (23/24)",
    !(dRec.mode === 23 || dRec.mode === 24),
    dRec.mode === null ? "cadência não descobrível (esperado sob adulteração)" : `modo=${dRec.mode}`);

  const allPass = checks.every((c) => c.pass);
  return {
    schema: "rex-sonic-cadence-runtime-verification/v1",
    verdict,
    measured: {
      A1_original: { interval: 23, gap_mode: mA },
      B40_pipeline: { interval: 40, gap_mode: mB },
      C60_pipeline: { interval: 60, gap_mode: mC },
      D_tampered: { gap_mode: dRec.mode, transitions: dRec.transitions.length },
    },
    votes,
    checks,
    allPass,
  };
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
if (args.includes("--help") || !flag("--oracle")) {
  console.error("uso: node sonic-cadence-runtime-oracle.mjs --oracle <dir> [--report <out.json>]");
  process.exit(2);
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const result = verify(flag("--oracle"), readJson);
if (flag("--report")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(flag("--report"), JSON.stringify(result, null, 2));
}
for (const c of result.checks) {
  console.log(`${c.pass ? "OK  " : "FAIL"} ${c.name}${c.detail ? " :: " + c.detail : ""}`);
}
console.log(`veredito: ${result.verdict} :: allPass=${result.allPass}`);
process.exit(result.allPass ? 0 : 1);
