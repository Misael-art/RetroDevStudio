#!/usr/bin/env bash
# Compila o driver Rust contra a CÓPIA VERBATIM (pinada por SHA-256) do
# encoder do produto (rex_codecs.rs, lido somente leitura — o produto não é
# alterado) e gera as streams do encoder Rust para o replay 68k.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:?uso: gen_rust_streams.sh <outdir> [rom]}"
ROM="${2:-/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin}"
SRC="${REX_CODECS_SRC:-/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/src-tauri/src/tools/reverse/decomp/rex_codecs.rs}"
PIN="${REX_CODECS_SHA:-07ee9b2c8f62ac7116a775bedd86eacba76ca2ccdc5148824e5b15b1cccb3d9d}"
ROM_PIN="${HAMOOPIG_SHA:-558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9}"

echo "$PIN  $SRC" | sha256sum -c - || {
  echo "FATAL: rex_codecs.rs diverge do pino $PIN (WIP do integrador mudou; re-pinar conscientemente)"; exit 2; }
echo "$ROM_PIN  $ROM" | sha256sum -c - || { echo "FATAL: ROM fora do pino BYOR"; exit 2; }

CRATE="$OUT/crate"
mkdir -p "$CRATE" "$OUT/streams"
cp "$HERE/driver.rs" "$CRATE/main.rs"
cp "$SRC" "$CRATE/rex_codecs.rs"   # verbatim; nenhuma edição
(cd "$CRATE" && rustc --edition 2021 -A warnings -o driver main.rs)
echo "driver sha256=$(sha256sum "$CRATE/driver" | cut -d' ' -f1)"
timeout 180 "$CRATE/driver" all "$OUT/streams" "$ROM"
echo "streams-rust: OK -> $OUT/streams"
