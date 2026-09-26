#!/usr/bin/env python3
"""Monta o diretório de casos do replay RUST (casos + table2.s + cases2.json)
a partir da saída do driver (gen_rust_streams.sh).

Layout por caso na ROM (harness2): gap 0x5AA5*128 + prefixo-dicionário +
stream. O harness copia o prefixo para o dst e chama unpack(src, dst+plen);
os buffers dst são contíguos com stride por caso (Work RAM ≤ 64 KiB no total).

Política BYOR: dicts derivados da ROM com mais de DICT_COMMIT_MAX bytes NÃO
são copiados para o diretório de Commit — apenas SHA-256 + offset de origem
(regeneráveis via gen_rust_streams.sh com a ROM congelada).
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

STREAMS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("streams")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("cases2")
DICT_COMMIT_MAX = 512  # só p/ dicts DERIVADOS DA ROM (BYOR); sintéticos sempre
ROM_DERIVED = {
    "r09_corpus_orig_c8cc8",
    "r10_corpus_rust_edit_c8cc8",
    "r13_wip_edit_c8cc8",
}
WRAM_LIMIT = 0xFC00  # 0xFF0200..0xFFFFFF menos margem p/ stack

CASES = OUT / "cases2"
CASES.mkdir(parents=True, exist_ok=True)

FULL_ORDER = [
    "r01_lits_odd",
    "r02_short_mix",
    "r03_long_far_nodict",
    "r04_long_zero_value",
    "r05_dict_mixed",
    "r09_corpus_orig_c8cc8",
    "r10_corpus_rust_edit_c8cc8",
]
# argv[3]: lista opcional de casos (run B/C de redução mínima ocupam a
# Work RAM inteira sozinhas — cada uma vira ROM própria de caso único).
ORDER = sys.argv[3].split(",") if len(sys.argv) > 3 else FULL_ORDER

lines = [
    "# gerado por gen_rust_cases.py — tabela p/ harness2 (streams do encoder Rust)",
    "\t.section .rodata",
    "\t.even",
]
meta = []
offset = 0
for cid in ORDER:
    stream = (STREAMS / f"{cid}.stream").read_bytes()
    plain = (STREAMS / f"{cid}.plain").read_bytes()
    dictp = STREAMS / f"{cid}.dict"
    dct = dictp.read_bytes() if dictp.exists() else b""
    if len(dct) % 2 or len(stream) % 2:
        raise SystemExit(f"{cid}: blob ímpar (dict={len(dct)} stream={len(stream)})")
    stride = (len(dct) + len(plain) + 0x180 + 0xFF) & ~0xFF
    if offset + stride > WRAM_LIMIT:
        raise SystemExit(f"{cid}: Work RAM estourada (offset={offset:#x} stride={stride:#x})")
    (CASES / f"{cid}.stream").write_bytes(stream)
    (CASES / f"{cid}.plain_expected").write_bytes(plain)
    dict_sha = None
    if dct:
        dict_sha = hashlib.sha256(dct).hexdigest()
        if cid not in ROM_DERIVED or len(dct) <= DICT_COMMIT_MAX:
            (CASES / f"{cid}.dict").write_bytes(dct)
    meta.append({"id": cid, "dict_len": len(dct), "dict_sha256": dict_sha,
                 "dict_committed": (CASES / f"{cid}.dict").exists(),
                 "stream_len": len(stream), "plain_len": len(plain),
                 "stride": stride, "dst_offset": offset})
    lines.append(f"{cid}_blob:")
    lines.append("\t.rept 128\n\t.word 0x5AA5\n\t.endr")
    lines.append(f"{cid}_dict:")
    for i in range(0, len(dct), 16):
        lines.append("\t.byte " + ",".join(f"0x{b:02X}" for b in dct[i:i + 16]))
    lines.append(f"{cid}_src:")
    for i in range(0, len(stream), 16):
        lines.append("\t.byte " + ",".join(f"0x{b:02X}" for b in stream[i:i + 16]))
    lines.append("\t.even")
    offset += stride

lines.append("\t.text")
lines.append("case_table:")
for m in meta:
    cid = m["id"]
    lines.append(f"\t.long {cid}_src")
    lines.append(f"\t.long {cid}_dict")
    lines.append(f"\t.long {m['dict_len']}")
    lines.append(f"\t.long {m['stride']}")
lines.append("case_table_end:")
(OUT / "table2.s").write_text("\n".join(lines) + "\n")
(OUT / "cases2.json").write_text(json.dumps(
    {"dst_total": offset, "cases": meta}, indent=2) + "\n")

shutil.copy(STREAMS / "rust_meta.tsv", OUT / "rust_meta.tsv")
for m in meta:
    print(f"caso={m['id']} dict={m['dict_len']} stream={m['stream_len']} "
          f"plain={m['plain_len']} stride={m['stride']:#x} off={m['dst_offset']:#x} "
          f"dict_committed={m['dict_committed']}")
print(f"total={len(meta)} wam_bytes={offset:#x}")
