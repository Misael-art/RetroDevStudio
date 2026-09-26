// Testes do decoder aPLib raw (sem header), porta JS do contrato do agente B
// calibrado 12/12 contra apultra + APJ (docs/rex_profiles/codecs/aplib.md do
// workspace REX-B). Oráculos: vetores dourados em
// data/rex_profiles/codecs/aplib-golden/ (copia SHA-registrada).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aplibDecode, AplibError } from "./aplib.mjs";

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data/rex_profiles/codecs/aplib-golden",
);

const goldenNames = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".ap"))
  .map((f) => f.slice(0, -3))
  .sort();

test("golden: os 9 vetores dourados decodifican byte a byte", () => {
  assert.equal(goldenNames.length, 9);
  for (const name of goldenNames) {
    const ap = new Uint8Array(readFileSync(join(GOLDEN_DIR, `${name}.ap`)));
    const expected = new Uint8Array(readFileSync(join(GOLDEN_DIR, `${name}.expected.bin`)));
    const { output, bytesConsumed } = aplibDecode(ap, { maxSize: 1 << 20 });
    assert.deepEqual([...output], [...expected], `vector ${name}`);
    // EOD detectado: consumo termina xusto tras o byte de comando 0x00
    assert.ok(bytesConsumed <= ap.length, `vector ${name}: consumo ${bytesConsumed} > ${ap.length}`);
  }
});

test("golden: bytes_consumed remata tras o byte EOD, ignorando datos posteriores", () => {
  const ap = new Uint8Array(readFileSync(join(GOLDEN_DIR, "g08_eod_trailing.ap")));
  assert.equal(ap.length, 11); // 6 bytes de fluxo real + 5 de lixo
  const { bytesConsumed } = aplibDecode(ap, { maxSize: 1 << 20 });
  assert.equal(bytesConsumed, 6);
});

test("offset: decodifica un desprazamento arbitrario dentro do buffer", () => {
  const ap = new Uint8Array(readFileSync(join(GOLDEN_DIR, "g03_short_match.ap")));
  const pad = new Uint8Array(5).fill(0xaa);
  const buf = new Uint8Array(pad.length + ap.length + 3);
  buf.set(pad, 0);
  buf.set(ap, pad.length);
  const { output, bytesConsumed } = aplibDecode(buf, { offset: pad.length, maxSize: 1 << 16 });
  assert.equal(bytesConsumed, ap.length);
  assert.deepEqual([...output], [0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
});

test("erro: fluxo truncado nun literal dispara AplibError(truncated)", () => {
  const ap = new Uint8Array(readFileSync(join(GOLDEN_DIR, "g01_literals.ap")));
  assert.throws(
    () => aplibDecode(ap.subarray(0, ap.length - 1), { maxSize: 1 << 16 }),
    (e) => e instanceof AplibError && e.kind === "truncated",
  );
});

test("erro: rep-match sen match previo dispara AplibError(invalid-reference)", () => {
  // 'Z' literal; tag 0x80: token 10 -> gamma par (0,0) = 2 -> off_hi = 2-LWM(3) = -1
  // => rep-match, pero offset_history aínda é válido.
  const bytes = Uint8Array.from([0x5a, 0x80, 0x40, 0x00]);
  assert.throws(
    () => aplibDecode(bytes, { maxSize: 1 << 16 }),
    (e) => e instanceof AplibError && e.kind === "invalid-reference",
  );
});

test("erro: referencia máis alá da saída producida dispara invalid-reference", () => {
  // 'A' literal; tag 0xC0: token 110 -> cmd 0x0a -> off = 5, len = 2 > saída (1 byte)
  const bytes = Uint8Array.from([0x41, 0xc0, 0x0a]);
  assert.throws(
    () => aplibDecode(bytes, { maxSize: 1 << 16 }),
    (e) => e instanceof AplibError && e.kind === "invalid-reference",
  );
});

test("erro: output que excede maxSize dispara AplibError(overflow)", () => {
  const ap = new Uint8Array(readFileSync(join(GOLDEN_DIR, "g06_mid_offset.ap")));
  assert.throws(
    () => aplibDecode(ap, { maxSize: 100 }),
    (e) => e instanceof AplibError && e.kind === "overflow",
  );
});
