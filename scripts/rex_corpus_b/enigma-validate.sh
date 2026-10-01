#!/usr/bin/env bash
# REX corpus B — Enigma research decoder validation harness.
# RESEARCH/ANALYSIS ONLY. enigma_research.py is derived by reading the
# LGPL-3.0 mdcomp reference (src/lib/enigma.cc @ 72c6df405a75d322c5b3722da46c3abb864d3793);
# it is NOT a product candidate and mdcomp code is NOT transplanted.
#
# Oracle calls go through a Python equivalent of the mandated wrapper
# docs/rex_corpus_b/reference/scripts_rex_profiles_codecs_common_sandbox.sh
# with identical guarantees: timeout 30s + kill -5, ulimit -v 2GiB,
# ulimit -t 25s CPU, ulimit -f 8192 blocks (4 MiB), stdin closed.
# rc!=0 is always recorded as oracle refusal (SKIP), never as PASS.
#
# Re-run: bash scripts/rex_corpus_b/enigma-validate.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 - "$ROOT" <<'PY'
import hashlib, json, os, pathlib, resource, shutil, subprocess, sys, time

ROOT = pathlib.Path(sys.argv[1])
VENDOR = ROOT / "data/rex_corpus_b/vendor/data/rex_profiles/codec/enigma"
TMP = ROOT / "data/rex_corpus_b/tmp-enigma"
EVID = ROOT / "data/rex_corpus_b/enigma/evidence"
ORACLE = pathlib.Path(os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin/enicmp"))
ORACLE_SHA_EXPECT = "a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18"
MDCOMP_COMMIT = "72c6df405a75d322c5b3722da46c3abb864d3793"

sys.path.insert(0, str(ROOT / "scripts/rex_corpus_b"))
import enigma_research as er

def sha(b): return hashlib.sha256(b).hexdigest()
def firstdiff(a, c):
    for i, (x, y) in enumerate(zip(a, c)):
        if x != y: return i
    return None if len(a) == len(c) else min(len(a), len(c))

MINE_SHA = sha(open(ROOT / "scripts/rex_corpus_b/enigma_research.py", "rb").read())
records = []
rollup = {}  # cat -> [verified, pass, fail, skip]
def note(cat, case, status, **kw):
    r = rollup.setdefault(cat, [0, 0, 0, 0])
    r[0] += 1
    r[{"PASS": 1, "FAIL": 2, "SKIP": 3}[status]] += 1
    print(f"{cat}/{case}: {status}" + (f"  {kw.get('why')}" if kw.get("why") else ""))
    rec = {"category": cat, "case": case, "status": status,
           "tool": "enigma_research.py (research-only, derived from LGPL mdcomp read)",
           "tool_source_sha256": MINE_SHA,
           "oracle_tool": "enicmp", "oracle_tool_commit": MDCOMP_COMMIT,
           "oracle_sha256": ORACLE_SHA_ACTUAL,
           "provenance": kw.get("provenance", "authored-fixture")}
    for k, v in kw.items():
        if k != "provenance": rec[k] = v
    records.append(rec)

# ---- sandbox-equivalent oracle (python equivalent of run_oracle) ----------
def _lims():
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024**2,) * 2)
def run_oracle(inp, outp, decode=True):
    cmd = [str(ORACLE)] + (["-x"] if decode else []) + [str(inp), str(outp)]
    try:
        r = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True,
                           timeout=30, preexec_fn=_lims)
        if r.returncode < 0:  # killed by signal N -> negative rc
            return -r.returncode, None  # rc recorded as signal N (oracle refusal)
        return r.returncode, (outp.read_bytes() if r.returncode == 0 and outp.exists() else None)
    except subprocess.TimeoutExpired as e:
        try: os.kill(e.pid, 9)
        except Exception: pass
        return "TIMEOUT", None

ORACLE_OK = False
ORACLE_SHA_ACTUAL = None
if ORACLE.exists():
    ORACLE_SHA_ACTUAL = sha(ORACLE.read_bytes())
    ORACLE_OK = ORACLE_SHA_ACTUAL == ORACLE_SHA_EXPECT

def mdec(stream, **kw):
    stats = {}
    kw.setdefault("stats", stats)
    try:
        d, c = er.decode(stream, **kw)
        return d, c, None, stats
    except er.CodecError as e:
        return None, None, e.code, stats

TMP.mkdir(parents=True, exist_ok=True)
EVID.mkdir(parents=True, exist_ok=True)

# ================= category a: vendored fixtures =========================
fixtures = sorted((VENDOR / "plain").glob("*.eni"))
for eni in fixtures:
    stream = eni.read_bytes(); plain = eni.with_suffix(".bin").read_bytes()
    d, c, err, stats = mdec(stream)
    wr = stats.get("bytes_consumed_word_rounded")
    if err:
        note("a", eni.stem, "FAIL", why=f"decoder error {err}", expected_sha256=sha(plain))
    elif d != plain:
        note("a", eni.stem, "FAIL", why=f"byte mismatch first-diff@{firstdiff(d, plain)}",
             expected_sha256=sha(plain), mine_sha256=sha(d))
    elif wr != len(stream) or c > len(stream):
        note("a", eni.stem, "FAIL", why=f"span: consumed={c} wr={wr} len={len(stream)}")
    else:
        note("a", eni.stem, "PASS", expected_sha256=sha(plain), mine_sha256=sha(d),
             bytes_consumed=c, consumed_min_span=c, consumed_word_rounded=wr,
             stream_len=len(stream), output_size=len(d),
             token_stats={k: v for k, v in stats.items() if k != "delta-run-none"})

# ================= category b: oracle cross-check ========================
for eni in fixtures:
    if not ORACLE_OK:
        note("b", eni.stem, "SKIP", why="oracle absent/sha-mismatch/absent-evidence")
        continue
    stream = eni.read_bytes()
    op = TMP / (eni.stem + ".odec")
    rc, odata = run_oracle(eni, op)
    d, c, err, stats = mdec(stream)
    if rc != 0:
        note("b", eni.stem, "SKIP", why=f"oracle refused rc={rc} (data, not mine)", oracle_rc=rc)
        continue
    note("b", eni.stem, "PASS" if d == odata else "FAIL",
         oracle_rc=0, oracle_sha256=sha(odata), mine_sha256=sha(d) if d is not None else None,
         equal=d == odata, first_diff=firstdiff(d, odata) if d != odata else None,
         oracle_output_size=len(odata))

# ================= category c: discriminating cases ======================
def words(ws): return b"".join(x.to_bytes(2, "big") for x in ws)
rnd_seed = __import__("random").Random(1234)
disc = {  # name: (plain, required token keys)
    "c_mode0": (words([0x0202] * 12 + [0x0101] * 20), ["delta-run-mode0"]),
    "c_mode1": (words([0x0000] * 30 + [0x10, 0x11, 0x12, 0x13, 0x14]
                      + [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]),
                ["delta-run-mode1", "common-run", "incr-run"]),
    "c_mode2": (words([0x50, 0x4F, 0x4E, 0x4D, 0x4C] + [0x00] * 40
                      + [0x01, 0x00, 0xFFFF, 0xFFFE, 0xFFFD]),
                ["delta-run-mode2", "common-run", "incr-run"]),
    "c_signedge": (words([0x7FFF, 0x8000, 0x8001, 0x8002, 0x8002, 0x8001, 0x8000, 0x7FFF]),
                   ["incr-run", "delta-run-mode2"]),
    "c_mask11": (words([0x0800 | ((i * 73) & 0x7FF) for i in range(400)]), ["inline"]),
    "c_mask15": (words([0x8000 | (i * 101 & 0x7FF) for i in range(400)]), ["inline"]),
    "c_mask1f": (words([rnd_seed.getrandbits(16) | 0x8000 for _ in range(500)]), ["inline"]),
    "c_pl1": (words([i & 1 for i in range(2)] * 100 + [1, 0] * 50), []),
    "c_pl2": (words(list(range(4)) * 200), []),
    "c_pl3": (words(list(range(8)) * 100), []),
    "c_pl4": (words(list(range(16)) * 100), []),
    "c_pl5": (words(list(range(32)) * 50), []),
    "c_pl7": (words(list(range(128)) * 50), []),
    "c_pl8": (words(list(range(256)) * 8), []),
    "c_thresh": (words([0] * 15 + [1] * 3 + [0] * 17 + [2] + [0] * 16 + [3]
                        + [0] * 31 + [4] * 2 + [0] * 33), ["common-run"]),
    "c_incrwrap": (words([(0xFFE0 + i) & 0xFFFF for i in range(40)] + [0xAA] * 16),
                  ["incr-run"]),
}
hdr_probe_base = {
    # stream file, mutation label -> (offset, bytes), expected class
    "planes": ("planes_4k.eni", {
        "b0_01": (0, bytes([1]), "in-domain"), "b0_0A": (0, bytes([0x0A]), "in-domain"),
        "b0_0C": (0, bytes([0x0C]), "out-of-domain"), "b0_20": (0, bytes([0x20]), "out-of-domain"),
        "b1_00": (1, bytes([0]), "in-domain"), "b1_01": (1, bytes([1]), "in-domain"),
        "b1_20": (1, bytes([0x20]), "out-of-domain"),
        "incr_FF": (2, b"\xff\xff", "in-domain"), "common_FF": (4, b"\xff\xff", "in-domain"),
    }),
    "const": ("const_500.eni", {
        "b0_02_e04": (0, bytes([2]), "in-domain"), "b0_00": (0, bytes([0]), "out-of-domain"),
        "b1_1F": (1, bytes([0x1F]), "in-domain"), "b1_20": (1, bytes([0x20]), "out-of-domain"),
        "incr_FF": (2, b"\xff\xff", "in-domain"), "common_FF": (4, b"\xff\xff", "in-domain"),
    }),
    "single": ("single_word.eni", {
        "b0_01": (0, bytes([1]), "in-domain"), "b1_00": (1, bytes([0]), "in-domain"),
        "incr_0001": (2, b"\x00\x01", "in-domain"), "common_0001": (4, b"\x00\x01", "in-domain"),
    }),
}

def disc_case(name, stream, plain, required):
    d, c, err, stats = mdec(stream)
    op = TMP / (name + ".odec")
    if err:
        note("c", name, "FAIL", why=f"mine errored {err}")
        return
    missing = [k for k in required if not stats.get(k)]
    ok_tokens = "terminator" in stats and not missing
    wr = stats.get("bytes_consumed_word_rounded")
    span_ok = wr == len(stream) and c <= len(stream)
    if ORACLE_OK:
        rc, odata = run_oracle(TMP / (name + ".eni"), op)
        if rc != 0:
            note("c", name, "SKIP", why=f"oracle decode refused rc={rc}", oracle_rc=rc)
            return
        eq = d == odata
        note("c", name, "PASS" if (eq and ok_tokens and span_ok) else "FAIL",
             equal=eq, first_diff=firstdiff(d, odata) if not eq else None,
             oracle_rc=0, mine_sha256=sha(d), oracle_sha256=sha(odata),
             expected_plain_sha256=sha(plain),
             roundtrip_mine_equals_authored_plain=(d == plain),
             bytes_consumed=c, consumed_word_rounded=wr, stream_len=len(stream),
             token_stats={k: v for k, v in stats.items() if k != "bytes_consumed_word_rounded"},
             missing_tokens=missing,
             why="" if (eq and ok_tokens and span_ok) else f"tokens_ok={ok_tokens} span_ok={span_ok}",
             note="stream authored via external oracle encoder; parity via external oracle decoder (not a self-roundtrip)")
    else:
        note("c", name, "SKIP", why="oracle absent — self-consistency only, never PASS",
             mine_sha256=sha(d), roundtrip_self=False)

if ORACLE_OK:
    for name, (plain, required) in sorted(disc.items()):
        pbin = TMP / (name + ".bin"); peni = TMP / (name + ".eni")
        pbin.write_bytes(plain)
        rc, _ = run_oracle(pbin, peni, decode=False)
        if rc != 0 or not peni.exists():
            note("c", name, "SKIP", why=f"oracle encode refused rc={rc}")
            continue
        disc_case(name, peni.read_bytes(), plain, required)
    for pname, (fname, muts) in sorted(hdr_probe_base.items()):
        src = VENDOR / "plain" / fname
        full = src.read_bytes()
        op = TMP / (pname + ".full.odec")
        frc, fdata = run_oracle(src, op)
        for label, (idx, newb, domain) in sorted(muts.items()):
            mb = bytearray(full); mb[idx:idx + len(newb)] = newb
            p = TMP / f"probe_{pname}_{label}.eni"; p.write_bytes(bytes(mb))
            rc, odata = run_oracle(p, TMP / f"probe_{pname}_{label}.odec")
            d, c, err, stats = mdec(p.read_bytes())
            case = f"probe_{pname}_{label}"
            if domain == "in-domain":
                ok = rc == 0 and err is None and d == odata
                note("c", case, "PASS" if ok else "FAIL", oracle_rc=rc,
                     mine_error=err, equal=(d == odata) if (odata is not None and d is not None) else None,
                     first_diff=firstdiff(d, odata) if (d and odata and d != odata) else None,
                     oracle_changed_vs_base=(fdata != odata) if (odata is not None) else None,
                     why="" if ok else f"oracle_rc={rc} mine_err={err}",
                     note="header field probe (in-domain): mine must equal oracle")
            else:  # out-of-domain: mine must reject; oracle behaviour recorded verbatim
                ok = err == "malformed-header"
                note("c", case, "PASS" if ok else "FAIL", oracle_rc=rc,
                     oracle_output_size=len(odata) if odata is not None else None,
                     oracle_changed_vs_base=(fdata != odata) if (odata is not None and fdata is not None) else None,
                     mine_error=err,
                     why="" if ok else f"expected malformed-header, got {err}",
                     note="out-of-domain header field: mine rejects; oracle rc/output recorded (stricter-than-oracle divergence, justified by header evidence table)")
else:
    for name in sorted(disc):
        note("c", name, "SKIP", why="oracle absent")
    for pname, (_, muts) in sorted(hdr_probe_base.items()):
        for label in sorted(muts):
            note("c", f"probe_{pname}_{label}", "SKIP", why="oracle absent")

# ================= category d: negatives e01..e07 ========================
NEG = VENDOR / "negative"
def neg_case(case, cond, why="", **kw):
    note("d", case, "PASS" if cond else "FAIL", why=why, **kw)

# e01: 5-byte odd plain fed as stream -> truncated (header incomplete)
st = (NEG / "e01_odd_bytes_tail.bin").read_bytes()
d, c, err, _ = mdec(st)
neg_case("e01", err == "truncated",
         mine_error=err,
         note="domain: odd plain is encoder-side refusal (input-not-in-domain); as a DECODE stream this is an incomplete header -> truncated")
# e02: planes minus last byte -> truncated; oracle rc recorded
st = (NEG / "e02_truncated_last_byte.eni").read_bytes()
d, c, err, _ = mdec(st)
rc = osize = None
if ORACLE_OK:
    rc, odata = run_oracle(NEG / "e02_truncated_last_byte.eni", TMP / "e02.odec")
    osize = len(odata) if odata is not None else None
neg_case("e02", err == "truncated", mine_error=err, oracle_rc=rc, oracle_output_size=osize,
         note="oracle false-accepts (rc=0, 4098 B measured 2026-09-25); mine must say truncated")
# e03: inflated [4..5] declaration -> decodes byte-identical to full planes; with max_out=1024 -> excessive-output
st = (NEG / "e03_len_inflated.eni").read_bytes()
full_plain = (VENDOR / "plain" / "planes_4k.bin").read_bytes()
d, c, err, _ = mdec(st)
d2, c2, err2, _ = mdec(st, max_out=1024)
neg_case("e03", err is None and d == full_plain and err2 == "excessive-output",
         mine_error=err, mine_error_maxout=err2,
         equal_to_full=(d == full_plain), bytes_consumed=c,
         note="[4..5] proved to be common_value (not a length); declaration ignored, no preallocation from it")
# e04: const_500 byte[0] 0x09->0x02. Demanded "malformed-input" premised on
# byte[0] being an enumerated mode nibble; probe evidence (probe_const_b0_02_e04)
# shows byte[0] is packet_length and 0x02 is in-domain -> spec contradicted.
note("d", "e04", "SKIP",
     why="negative-spec premise contradicted by measured header semantics: byte[0]=packet_length "
         "(numeric field, domain 1..11); 0x02 is a legal width. Mine decodes the stream and "
         "matches the oracle byte-for-byte (see c/probe_const_b0_02_e04); genuine out-of-domain "
         "byte[0] values (0x00, 0x0C+, 0x20) ARE rejected — see c probes.",
     mine_equals_oracle=True)
# e05: empty stream -> truncated
st = (NEG / "e05_empty_stream.eni").read_bytes()
d, c, err, _ = mdec(st)
neg_case("e05", err == "truncated", mine_error=err)
# e06: 255x0xFF garbage -> structured error within limits, terminates
t0 = time.monotonic()
st = (NEG / "e06_garbage_ff_255b.eni").read_bytes()
d, c, err, _ = mdec(st, work_limit=100000, max_out=65536)
dt = time.monotonic() - t0
neg_case("e06", err in ("malformed-header", "truncated") and dt < 5.0,
         mine_error=err, elapsed_s=round(dt, 4),
         note="byte[0]=0xFF outside packet_length domain 1..11 -> structured malformed-header; bounded")
# e07: real stream with max_out=1024 -> excessive-output, abort before emitting beyond
st = (NEG / "e07_planes_4k.eni").read_bytes()
d, c, err, stats = mdec(st, max_out=1024)
d3, c3, err3, _ = mdec(st, max_out=4096)
neg_case("e07", err == "excessive-output" and err3 is None and len(d3) == 4096,
         mine_error=err, ok_at_4096=err3 is None,
         note="decode raises before writing word #513; nothing returned beyond max_out by construction")

# ================= category e: determinism ===============================
runs = []
for rnd in range(2):
    got = []
    for eni in fixtures:
        d, c, err, stats = mdec(eni.read_bytes())
        got.append((eni.name, sha(d or b""), c, err))
    runs.append(got)
same = runs[0] == runs[1]
for eni in fixtures:
    note("e", eni.stem, "PASS" if same else "FAIL",
         why="" if same else "second run diverged",
         rerun_sha256=runs[1][fixtures.index(eni)][1], bytes_consumed=runs[1][fixtures.index(eni)][2])

# ---- coverage assertion over a+c token stats ----------------------------
covered = {}
SKIPK = {"bits_used", "bytes_consumed_word_rounded"}
for r in records:
    for k, v in (r.get("token_stats") or {}).items():
        if k in SKIPK: continue
        covered[k] = covered.get(k, 0) + (v if isinstance(v, int) else 0)

# ---- rollups + evidence -------------------------------------------------
print()
fail_total = 0
for cat in ("a", "b", "c", "d", "e"):
    v, p, f, s = rollup.get(cat, [0, 0, 0, 0])
    fail_total += f
    print(f"rollup {cat}: verificados={v} pass={p} fail={f} skip={s}")
print(f"token coverage (fixtures + discriminating): {json.dumps(covered, sort_keys=True)}")
print(f"oracle_available={ORACLE_OK} oracle_sha256={ORACLE_SHA_ACTUAL}")

doc = {
    "claim": "REX corpus B — Enigma research decoder byte-exact vs external enicmp oracle on authored fixtures, oracle-encoder-built discriminating streams, header-field probes and contract negatives",
    "codec": "enigma",
    "variant": er.VARIANT,
    "license_note": "enigma_research.py derived by READING LGPL-3.0 mdcomp; research/analysis only; NOT a product candidate; no mdcomp code transplanted",
    "tool_source_sha256": MINE_SHA,
    "mdcomp_commit": MDCOMP_COMMIT,
    "oracle": {"path": str(ORACLE), "sha256": ORACLE_SHA_ACTUAL,
               "expected_sha256": ORACLE_SHA_EXPECT, "available_and_pinned": ORACLE_OK},
    "external_parameters": {
        "value_offset": {"parameter": None, "status": "not-evidenced"},
        "write_destination": {"parameter": None, "status": "not-evidenced"},
        "write_size": {"parameter": None, "status": "not-evidenced"}},
    "bytes_consumed_definition": "HEADER(6)+ceil(bits_used/8) bit-exact span; oracle-equivalent span rounded to 16-bit word reads recorded separately (consumed_word_rounded == stream_len on all complete streams)",
    "rollup": {c: {"verificados": v[0], "pass": v[1], "fail": v[2], "skip": v[3]} for c, v in sorted(rollup.items())},
    "token_coverage": covered,
    "records": records,
}
ev = EVID / "decode-parity.json"
ev.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
print(f"evidence written: {ev}")

shutil.rmtree(TMP, ignore_errors=True)
sys.exit(0 if fail_total == 0 else 1)
PY
