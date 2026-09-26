#!/usr/bin/env bash
# reproduce.sh — replay das streams do codec DO PRODUTO no desempacotador 68000
# OFICIAL (tools_a.s do SGDK 2.11) sob MAME, com desempate tripartite contra o
# oráculo Java lz4w.jar v1.43 e contra o plano esperado pelo produto.
#
# Pré-requisitos (medidos neste host; registrar no doc se divergir):
#   SGDK 2.11 em $GDK (padrão /mnt/sdcard/... , mapeado para G: no wine),
#   wine, MAME 0.289, Java 17, lz4w.jar v1.43 no cache do oráculo, gawk, zip,
#   e a ROM BYOR congelada em posse local (NUNCA no git).
#
# Política BYOR: este script NÃO escreve evidência no repositório. O workdir
# guarda bytes derivados da ROM; apenas logs de veredito, cases2.json e
# SHA-256 são promovidos para data/rex_profiles/integrator/... (manual, com
 # revisão do conteúdo). Nada de stream/dict/plain da ROM entra no git.
#
# Uso: REX_CODECS_SHA=<sha256 do rex_codecs.rs em revisão> bash reproduce.sh <workdir>
set -euo pipefail

W="${1:?uso: reproduce.sh <workdir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/lib"
PRODUCT="${PRODUCT_REPO:-/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21}"
SRC="$PRODUCT/src-tauri/src/tools/reverse/decomp/rex_codecs.rs"
PIN="${REX_CODECS_SHA:?REX_CODECS_SHA obrigatório (sha256 do rex_codecs.rs que está sendo medido)}"
ROM="${HAMOOPIG_ROM:-$PRODUCT/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin}"
ROM_PIN=558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9
JAR="${LZ4W_JAR:-/home/misael/.cache/rex-codecs/oracle-tools/SGDK211/bin/lz4w.jar}"
export LZ4W_JAR="$JAR"

mkdir -p "$W"
echo "== pinos =="
echo "$PIN  $SRC" | sha256sum -c - || { echo "FATAL: rex_codecs.rs fora do pino $PIN"; exit 2; }
echo "$ROM_PIN  $ROM" | sha256sum -c - || { echo "FATAL: ROM fora do pino BYOR"; exit 2; }

echo "== driver (encoder/decoder do produto, cópia verbatim) =="
mkdir -p "$W/crate" "$W/streams"
cp "$HERE/driver_integrator.rs" "$W/crate/main.rs"
cp "$SRC" "$W/crate/rex_codecs.rs"
(cd "$W/crate" && rustc --edition 2021 -A warnings -o driver main.rs)
echo "driver-sha256=$(sha256sum "$W/crate/driver" | cut -d' ' -f1)"
timeout 300 "$W/crate/driver" "$W/streams" "$ROM" >"$W/driver.stdout" 2>"$W/driver.stderr"
cat "$W/driver.stdout" "$W/driver.stderr"

# Um job pesado por vez: cada linha abaixo é build de ROM + execução MAME,
# executados em série. run16 tem veredito INVERTIDO por contrato (o 68k DEVE
# divergir; o produto recusa a stream).
RUNS="runI:i20_lits_odd,i21_short_mix,i22_long_far_nodict,i23_long_zero_value,i24_dict_mixed
runC:i09_corpus_orig_c8cc8
runE:i18_corpus_edit_c8cc8
run14:i14_encoder_deep_16384
run15:i15_hardware_ceiling_16385
run16:i16_beyond_ceiling_16386"

for entry in $RUNS; do
  name="${entry%%:*}"
  list="${entry#*:}"
  d="$W/$name"
  echo
  echo "==== $name ($list) ===="
  python3 "$LIB/gen_rust_cases.py" "$W/streams" "$d" "$list" | tee "$d.gen.log"
  HARNESS="$LIB/harness2.s" TABLE="$d/table2.s" bash "$LIB/build-rom.sh" "$d" "$d" 2>&1 | tee "$d.build.log"
  (cd "$d" && zip -q rom.zip rom.bin)
  dump=$(python3 -c "import json;t=json.load(open('$d/cases2.json'))['dst_total'];print((t+0xFF)&~0xFF)")
  REX_DUMP_BYTES="$dump" bash "$LIB/run-capture.sh" "$d/rom.zip" "$d/capture.bin" 2>&1 | tail -3 | tee "$d.mame.log"
  bash "$LIB/unpack-jar.sh" "$d/cases2" "$d/jar-out" "$d/jar-log" "$W/streams" >"$d.jar.log" 2>&1 || true
  rc=0
  python3 "$LIB/compare_rust.py" "$d" "$d/capture.bin" "$d/jar-out" "$d/jar-log" >"$d.verdict.log" 2>&1 || rc=$?
  cat "$d.verdict.log"
  echo "rom-sha256=$(sha256sum "$d/rom.bin" | cut -d' ' -f1)"
  echo "capture-sha256=$(sha256sum "$d/capture.bin" | cut -d' ' -f1)"
  if [ "$name" = run16 ]; then
    if [ $rc -eq 0 ]; then
      echo "FATAL: run16 — o 68k reproduziu uma stream fora do teto; o teto medido está errado"
      exit 1
    fi
    echo "run16: DIVERGÊNCIA DO 68k CONFIRMADA (recusa do produto é correta)"
  elif [ $rc -ne 0 ]; then
    echo "FATAL: $name divergiu do esperado (ver $d.verdict.log)"
    exit 1
  fi
done
echo
echo "reproduce: FIM — workdir $W"
