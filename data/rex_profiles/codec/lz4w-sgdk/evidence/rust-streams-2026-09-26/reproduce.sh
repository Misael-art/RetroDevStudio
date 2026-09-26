#!/usr/bin/env bash
# reproduce.sh — cadeia completa do replay 68k das streams do encoder Rust
# (pacote rust-streams-2026-09-26). Pré-requisitos (medidos, registrar se
# divergir): SGDK 2.11 + wine, MAME 0.289, Java 17, lz4w.jar v1.43 no cache
# do oráculo, e a ROM BYOR congelada em posse local (NUNCA no git):
#   ROM=/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin
#   (sha256 558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9)
# Uso: bash reproduce.sh <workdir-vazio>
set -euo pipefail
W="${1:?uso: reproduce.sh <workdir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VS="$(cd "$HERE/../../../../../.." && pwd)/scripts/rex_profiles/codecs/lz4w-sgdk/variants"
RS="$VS/rust_streams"
ROM="${HAMOOPIG_ROM:-/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin}"
PIN_LEGACY=07ee9b2c8f62ac7116a775bedd86eacba76ca2ccdc5148824e5b15b1cccb3d9d
PIN_WIP=04eaa0b0c1b2aa97d46ba537c9098904f2f8c62681a48ea095ec5f07a086ee3c
mkdir -p "$W"

# 0) pinos dos snapshots dos dois encoder
echo "$PIN_LEGACY  $HERE/snapshots/rex_codecs-07ee9b2c.rs" | sha256sum -c -
echo "$PIN_WIP  $HERE/snapshots/rex_codecs-04eaa0b0.rs" | sha256sum -c -

# 1) streams do encoder LEGACY (r01-r05 + r11/r12 + r09/r10 corpus)
REX_CODECS_SRC="$HERE/snapshots/rex_codecs-07ee9b2c.rs" REX_CODECS_SHA="$PIN_LEGACY" \
  bash "$RS/gen_rust_streams.sh" "$W/legacy" "$ROM"

# 2) streams/medidas do encoder WIP (r13 + recusas medidas no decoder WIP)
mkdir -p "$W/wip/streams" "$W/wip/crate"
cp "$HERE/driver.rs" "$W/wip/crate/main.rs"
cp "$HERE/snapshots/rex_codecs-04eaa0b0.rs" "$W/wip/crate/rex_codecs.rs"
(cd "$W/wip/crate" && rustc --edition 2021 -A warnings -o driver main.rs)
timeout 180 "$W/wip/crate/driver" wip "$W/wip/streams" "$ROM" "$W/legacy/streams" \
  | tee "$W/wip/stdio.log"

# 3) run A (r01..r10, 7 casos) — tabela + ROM + capture + jar + comparação
python3 "$RS/gen_rust_cases.py" "$W/legacy/streams" "$W/runA"
HARNESS="$RS/harness2.s" TABLE="$W/runA/table2.s" bash "$VS/build-rom.sh" "$W/runA" "$W/runA"
(cd "$W/runA" && zip -q rom.zip rom.bin)
REX_NCASES=7 REX_DST_STRIDE=512 REX_DUMP_BYTES=0xB400 \
  bash "$VS/run-capture.sh" "$W/runA/rom.zip" "$W/runA/capture.bin"
bash "$RS/unpack-jar.sh" "$W/runA/cases2" "$W/runA/jar-out" "$W/runA/jar-log" "$W/legacy/streams"
python3 "$RS/compare_rust.py" "$W/runA" "$W/runA/capture.bin" "$W/runA/jar-out" "$W/runA/jar-log" || true
# esperado: 6 OK + DIVERGE r10 (diff 68k @160)

# 4) run r11 (caso único) e run r12 — divergência mínima + fronteira OK
for c in r11_wrap_deep_ref r12_boundary_ok_ref; do
  mkdir -p "$W/$c"
  python3 "$RS/gen_rust_cases.py" "$W/legacy/streams" "$W/$c" "$c"
  HARNESS="$RS/harness2.s" TABLE="$W/$c/table2.s" bash "$VS/build-rom.sh" "$W/$c" "$W/$c"
  (cd "$W/$c" && zip -q rom.zip rom.bin)
  stride=$(( ( $(python3 -c "import json;print(json.load(open('$W/$c/cases2.json'))['cases'][0]['stride'])") ) ))
  REX_NCASES=1 REX_DST_STRIDE=$stride REX_DUMP_BYTES=$stride \
    bash "$VS/run-capture.sh" "$W/$c/rom.zip" "$W/$c/capture.bin"
  bash "$RS/unpack-jar.sh" "$W/$c/cases2" "$W/$c/jar-out" "$W/$c/jar-log"
  if [ "$c" = "r11_wrap_deep_ref" ]; then
    python3 "$RS/compare_rust.py" "$W/$c" "$W/$c/capture.bin" "$W/$c/jar-out" "$W/$c/jar-log" || true
    # esperado: DIVERGE (68k lê ROM aliassada), jar==Rust
  else
    python3 "$RS/compare_rust.py" "$W/$c" "$W/$c/capture.bin" "$W/$c/jar-out" "$W/$c/jar-log"
    # esperado: OK (fronteira off=16385 funciona no 68k)
  fi
done

# 5) run r13 — stream do encoder WIP decodificando idêntica no 68k
mkdir -p "$W/r13_wip_edit_c8cc8"
python3 "$RS/gen_rust_cases.py" "$W/wip/streams" "$W/r13_wip_edit_c8cc8" r13_wip_edit_c8cc8
HARNESS="$RS/harness2.s" TABLE="$W/r13_wip_edit_c8cc8/table2.s" \
  bash "$VS/build-rom.sh" "$W/r13_wip_edit_c8cc8" "$W/r13_wip_edit_c8cc8"
(cd "$W/r13_wip_edit_c8cc8" && zip -q rom.zip rom.bin)
REX_NCASES=1 REX_DST_STRIDE=1792 REX_DUMP_BYTES=1792 \
  bash "$VS/run-capture.sh" "$W/r13_wip_edit_c8cc8/rom.zip" "$W/r13_wip_edit_c8cc8/capture.bin"
bash "$RS/unpack-jar.sh" "$W/r13_wip_edit_c8cc8/cases2" "$W/r13_wip_edit_c8cc8/jar-out" \
  "$W/r13_wip_edit_c8cc8/jar-log" "$W/wip/streams"
python3 "$RS/compare_rust.py" "$W/r13_wip_edit_c8cc8" "$W/r13_wip_edit_c8cc8/capture.bin" \
  "$W/r13_wip_edit_c8cc8/jar-out" "$W/r13_wip_edit_c8cc8/jar-log"
# esperado: OK — e no log do passo 2: recusa de r10-legacy (off 18555),
# recusa de r12 (off 16385 — 1 word além do teto deste decoder) e
# r13-slot 150 > 144.
echo "reproduce: FIM (confira as 4 linhas de veredito acima contra manifest.json)"
