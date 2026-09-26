#!/usr/bin/env python3
"""Comparação tripartite do replay de streams RUST:
   esperado (Rust encode/decode)  vs  68k OFICIAL (capture.bin)  vs  jar v1.43.
Saída COMPLETA byte a byte; primeiro byte divergente reportado.
Uso: compare_rust.py <cases2-dir> <capture.bin> <jar-out-dir> <jar-logs-dir>
"""
import json
import sys
from pathlib import Path

CASES = Path(sys.argv[1])
CAP = Path(sys.argv[2])
JAROUT = Path(sys.argv[3])
JARLOGS = Path(sys.argv[4])

spec = json.loads((CASES / "cases2.json").read_text())
cap = CAP.read_bytes()
status = cap[:0x100]

def first_diff(a: bytes, b: bytes):
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i, a[i], b[i]
    if len(a) != len(b):
        return n, None, None
    return None, None, None

failures = 0
for i, m in enumerate(spec["cases"]):
    cid = m["id"]
    plen = m["dict_len"]
    stride = m["stride"]
    expected = (CASES / "cases2" / f"{cid}.plain_expected").read_bytes()
    ret68 = int.from_bytes(status[i * 4:i * 4 + 4], "big")
    buf = cap[0x100 + m["dst_offset"]: 0x100 + m["dst_offset"] + stride]
    prefix_intact = True
    if plen:
        dpath = CASES / "cases2" / f"{cid}.dict"
        if dpath.exists():
            dct = dpath.read_bytes()
        else:  # dict grande fora do git: valida pelo SHA e regenera da memória cap
            dct = buf[:plen]
        prefix_intact = buf[:plen] == dct
        if m.get("dict_sha256"):
            import hashlib
            prefix_intact = prefix_intact and hashlib.sha256(buf[:plen]).hexdigest() == m["dict_sha256"]
    if ret68 > len(buf) - plen:
        print(f"{cid}: 68k retornou {ret68} > capacidade do buffer; saída truncada p/ análise")
        ret68 = min(ret68, (len(buf) - plen) & ~1)
    out68 = buf[plen:plen + ret68]
    tail = buf[plen + len(expected): plen + len(expected) + 32]
    over = any(b != 0xFE for b in tail)
    d_len68, d_off68, a68, b68 = None, None, None, None
    off, v68, vex = first_diff(out68, expected)
    ok68 = off is None
    # jar
    jar_p = JAROUT / f"{cid}.out"
    jar_rc = "?"
    for line in (JARLOGS / "rc.tsv").read_text().splitlines() if (JARLOGS / "rc.tsv").exists() else []:
        if line.startswith(f"{cid} "):
            jar_rc = line.split("rc=")[1]
    okjar = None
    jar_note = ""
    if jar_p.exists():
        jarout = jar_p.read_bytes()
        dpath = CASES / "cases2" / f"{cid}.dict"
        dct = dpath.read_bytes() if dpath.exists() else (buf[:plen] if plen else b"")
        if dct and jarout.startswith(dct):
            jarout = jarout[len(dct):]
            jar_note = " (saída jar incluía prefixo; removido p/ comparação)"
        offj, _, _ = first_diff(jarout, expected)
        okjar = offj is None
        if not okjar:
            jar_note += f" primeiro diff jar @{offj}"
    else:
        jar_note = " (sem saída jar)"
    verdict = "OK" if (ok68 and okjar and prefix_intact and not over) else "DIVERGE"
    if verdict != "OK":
        failures += 1
    print(f"{verdict:8s} {cid:28s} ret68k={ret68:5d} esperado={len(expected):5d} "
          f"68k_igu={'S' if ok68 else 'N'} jar_igu={('S' if okjar else 'N') if okjar is not None else '?'}"
          f"(rc={jar_rc}) prefix_ok={'S' if prefix_intact else 'N'} sem_overwrite={'S' if not over else 'N'}{jar_note}")
    if not ok68:
        print(f"         primeiro diff 68k @{off}: 68k={v68} esperado={vex} "
              f"(len 68k={len(out68)} esperado={len(expected)})")

print("RESULTADO:", "TODOS OS CASOS IDÊNTICES (68k == jar == esperado-Rust)" if failures == 0
      else f"{failures} caso(s) com divergência")
sys.exit(0 if failures == 0 else 1)
