// Verificador INDEPENDENTE do contrato de REORDENAÇÃO do script id_Wait
// (PARTE 2 — frente de sequência). Nao importa nenhum modulo de produto: le
// uma copia BYOR (produzida pelo pipeline canônico) e, opcionalmente, a ROM
// base, e confere byte a byte cada afirmacao congelada em
// docs/rex_profiles/sonic_sequencia/EXPECTATIONS-SEQUENCIA.md secao 5 e em
// CONTRACT-SEQUENCIA.md. Uso:
//   node scripts/qa/sonic-sequence-contract.mjs --rom <copia-reordenada.bin>
//        [--base <BYOR-original.bin>] [--report <out.json>]
//   node scripts/qa/sonic-sequence-contract.mjs --selfcheck
//
// Fonte da verdade dos bytes: despejo direto da ROM pinada em 2026-10-03
// (independente do produto). Convencao de endereco: offset de arquivo ==
// endereco CPU 68K (a cadencia comprovou file_offset = cpu_addr - 0x100000).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// --- Fatos de byte congelados (do despejo da ROM pinada) -------------------
const BASE_SHA256 = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
const INTERVAL_ADDR = 0x13bae; // dominio da CADENCIA: fora deste incremento.
const INTERVAL_VALUE = 0x17;
const FRAMES_ADDR = 0x13baf; // janela escrevivel deste incremento
const FRAMES_LEN = 18;
const FRAMES_END = FRAMES_ADDR + FRAMES_LEN; // 0x13bc1 (exclusive)
const TERMINATOR_ADDR = FRAMES_END; // 0x13bc1
const TERMINATOR = [0xfe, 0x02]; // afBack k=2 — preservar
const PAD_ADDR = TERMINATOR_ADDR + 2; // 0x13bc3
const PAD_VALUE = 0x00;
const NEIGHBOR_ADDR = PAD_ADDR + 1; // 0x13bc4 — inicio do script da anim 6
const NEIGHBOR_HEAD = [0x1f, 0x3a, 0x3b, 0xff]; // bytes literais confirmados
// Ordem original das 18 entradas (frame references).
const ORIGINAL_FRAMES = [
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x03, 0x02, 0x02, 0x02, 0x03, 0x04,
];
// A prova DISCRIMINANTE pre-congelada (EXPECTATIONS secao 5.1): mover a
// primeira `03` (indice 12) para a posicao 0. Multiconjunto preservado; o
// primeiro frame observado passa de 01 a 03.
const DISCRIMINATING_FRAMES = (() => {
  const p = ORIGINAL_FRAMES.slice();
  [p[0], p[12]] = [p[12], p[0]];
  return p;
})();
const SORTED_ORIGINAL = ORIGINAL_FRAMES.slice().sort((a, b) => a - b);
// Bytes nunca validos como entrada de moldura.
const TOKEN_BYTES = new Set([0x00, 0xfd, 0xfe, 0xff]);
const is_frame_value = (b) => b >= 0x01 && b <= 0x04;

const af = (n) => "0x" + n.toString(16).toUpperCase();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sortedOf = (a) => a.slice().sort((x, y) => x - y);

export function verify(copy, base, opts = {}) {
  // pinBase: confere o SHA-256 da base contra o pino da ROM real. Desligado
  // apenas no --selfcheck, que usa uma base sintetica derivada dos contratos.
  const pinBase = opts.pinBase !== false;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, pass: !!ok, detail: detail ?? null });

  const frames = [...copy.subarray(FRAMES_ADDR, FRAMES_END)];
  const multisetOk = eq(sortedOf(frames), SORTED_ORIGINAL);

  // Estrutura do script preservada (independente da base).
  check("intervalo-intacto-0x17", copy[INTERVAL_ADDR] === INTERVAL_VALUE, af(copy[INTERVAL_ADDR]));
  check("terminador-fe02-intacto", eq([...copy.subarray(TERMINATOR_ADDR, TERMINATOR_ADDR + 2)], TERMINATOR),
    [...copy.subarray(TERMINATOR_ADDR, TERMINATOR_ADDR + 2)].map(af).join(" "));
  check("padding-00-intacto", copy[PAD_ADDR] === PAD_VALUE, af(copy[PAD_ADDR]));
  check("vizinho-anim6-head-intacto",
    eq([...copy.subarray(NEIGHBOR_ADDR, NEIGHBOR_ADDR + NEIGHBOR_HEAD.length)], NEIGHBOR_HEAD),
    [...copy.subarray(NEIGHBOR_ADDR, NEIGHBOR_ADDR + NEIGHBOR_HEAD.length)].map(af).join(" "));

  // Dominio: nenhuma entrada e token/reservada; multiconjunto preservado.
  check("sem-byte-reservado-na-janela", frames.every(is_frame_value),
    frames.filter((b) => !is_frame_value(b)).map(af).join(",") || "nenhum");
  check("multiconjunto-preservado", multisetOk, frames.map(af).join(" "));

  // Propriedade DISCRIMINANTE: primeira entrada vira 03 (era 01) e iguala a
  // permutacao pre-congelada. Uma troca de entradas identicas nao satisfaz
  // isto e, portanto, e declarada NAO-prova.
  check("discriminante-primeiro-frame-01-a-03", frames[0] === 0x03 && ORIGINAL_FRAMES[0] === 0x01,
    `frames[0]=${af(frames[0])}`);
  check("iguala-permutacao-congelada", eq(frames, DISCRIMINATING_FRAMES),
    frames.map(af).join(" "));

  if (base) {
    const sha = createHash("sha256").update(base).digest("hex");
    if (pinBase) {
      check("base-sha256-pino", sha === BASE_SHA256, sha);
    } else {
      check("base-sintetica-selfcheck", sha !== BASE_SHA256, "pino real suprimido no --selfcheck");
    }
    check("mesmo-tamanho", copy.length === base.length, `${copy.length} vs ${base.length}`);
    // Toda diferenca cai DENTRO da janela autorizada: nada fora de
    // 0x13BAF..0x13BC0 muda (intervalo, terminador, pad, vizinhos, todo o
    // resto da ROM). Isto prova que "reordenar miniaturas" nao e reordenar a
    // ROM — a escrita real esta contida no script id_Wait.
    const diffs = [];
    const n = Math.min(copy.length, base.length);
    for (let i = 0; i < n; i++) if (copy[i] !== base[i]) diffs.push(i);
    check("escrita-confinada-a-janela",
      diffs.length > 0 && diffs.every((i) => i >= FRAMES_ADDR && i < FRAMES_END),
      `${diffs.length} byte(s) alterado(s): ${diffs.slice(0, 24).map(af).join(",")}${diffs.length > 24 ? " ..." : ""}`);
    // Troca de identicas = byte a byte igual a base = NAO-prova. Exigimos ao
    // menos uma diferenca real.
    check("nao-e-troca-de-identicas", diffs.length > 0, `${diffs.length} diferenca(s)`);
    // A regiao fora da janela bate exatamente com a base.
    let outsideDiff = 0;
    for (let i = 0; i < n; i++) if (i < FRAMES_ADDR || i >= FRAMES_END) if (copy[i] !== base[i]) outsideDiff++;
    check("fora-da-janela-identico-a-base", outsideDiff === 0, `${outsideDiff} divergencia(s) externas`);
  } else {
    check("base-fornecida", false, "rode com --base <BYOR> para confinar a escrita");
  }

  const allPass = checks.every((c) => c.pass);
  return {
    classification:
      "contrato-de-reordenacao-provado-estaticamente; byte-na-rom-e-ordem-no-core-medidos-pela-pipeline-canonica",
    window: { frames_addr: FRAMES_ADDR, frames_end_exclusive: FRAMES_END, len: FRAMES_LEN },
    interval_addr: INTERVAL_ADDR,
    original_frames: ORIGINAL_FRAMES,
    expected_discriminating_frames: DISCRIMINATING_FRAMES,
    observed_frames: frames,
    terminator: "FE 02 (afBack k=2) preservado",
    loop_effect:
      "afBack fixa as duas ULTIMAS POSICOES; mover 03 para a posicao 0 muda o primeiro frame observado no core",
    base_supplied: !!base,
    checks,
    allPass,
  };
}

// --selfcheck: exercita verify() com fluxos de bytes derivados SOMENTE dos
// contratos publicos (nenhum modulo de produto), garantindo que o verificador
// discrimina a permutacao real e REJEITA uma troca de entradas identicas.
function selfcheck() {
  const synthetic = (frames) => {
    const rom = new Uint8Array(NEIGHBOR_ADDR + 8);
    rom[INTERVAL_ADDR] = INTERVAL_VALUE;
    rom.set(ORIGINAL_FRAMES, FRAMES_ADDR);
    rom.set(TERMINATOR, TERMINATOR_ADDR);
    rom[PAD_ADDR] = PAD_VALUE;
    rom.set(NEIGHBOR_HEAD, NEIGHBOR_ADDR);
    const base = rom.slice();
    rom.set(frames, FRAMES_ADDR);
    return { copy: rom, base };
  };
  const good = synthetic(DISCRIMINATING_FRAMES);
  const goodReport = verify(good.copy, good.base, { pinBase: false });
  const identicalSwap = synthetic([...ORIGINAL_FRAMES]); // "troca" 01<->01: igual
  const swapReport = verify(identicalSwap.copy, identicalSwap.base, { pinBase: false });
  const results = [
    { name: "selfcheck-permutacao-valida-passa", pass: goodReport.allPass },
    {
      name: "selfcheck-troca-de-identicas-e-recusada-como-nao-prova",
      pass: !swapReport.allPass &&
        swapReport.checks.some((c) => c.name === "nao-e-troca-de-identicas" && !c.pass) &&
        swapReport.checks.some((c) => c.name === "escrita-confinada-a-janela" && !c.pass),
    },
  ];
  const allPass = results.every((r) => r.pass);
  return { mode: "selfcheck", results, allPass };
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
if (args.includes("--selfcheck")) {
  const r = selfcheck();
  for (const x of r.results) console.log(`${x.pass ? "OK  " : "FAIL"} ${x.name}`);
  console.log(r.allPass ? "SELFCHECK: OK" : "SELFCHECK: FALHOU");
  process.exit(r.allPass ? 0 : 1);
}
if (args.includes("--help") || !flag("--rom")) {
  console.error("uso: node sonic-sequence-contract.mjs --rom <copia.bin> [--base <BYOR.bin>] [--report <out.json>] | --selfcheck");
  process.exit(2);
}
const copy = readFileSync(flag("--rom"));
const basePath = flag("--base");
const base = basePath ? readFileSync(basePath) : null;
const result = verify(copy, base);
if (flag("--report")) writeFileSync(flag("--report"), JSON.stringify(result, null, 2));
for (const c of result.checks) {
  console.log(`${c.pass ? "OK  " : "FAIL"} ${c.name}${c.detail ? " :: " + c.detail : ""}`);
}
console.log(result.allPass ? "CONTRATO-SEQUENCIA: TODOS OS CHECKS PASSARAM" : "CONTRATO-SEQUENCIA: FALHOU");
process.exit(result.allPass ? 0 : 1);
