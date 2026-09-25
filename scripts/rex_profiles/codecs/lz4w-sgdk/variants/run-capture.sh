#!/usr/bin/env bash
# Executa o harness LZ4W no desempacotador 68k OFICIAL sob MAME 0.289 e despeja
# a RAM via capture.lua. Requisitos medidos nesta maquina (registrar no doc):
#  - a ROM deve estar ZIPada (cart .bin solto cai no gate fuzzy da softlist, rc=6)
#  - -skip_gameinfo: sem isso o MAME abre a modal "Press any key to continue" e
#    o loop de frames nunca comeca (o harness nao roda)
#  - -noplugins: o plugin 'data' deste build quebra no reset (load_dat.lua:163)
#  - -hashpath vazio: neutraliza o fuzzy-match da softlist megadriv
set -euo pipefail
ROM="${1:?uso: run-capture.sh <rom.zip> [saida.bin]}"
OUT="${2:-${REX_CAPTURE:-/tmp/lz4w-variants-h/capture.bin}}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMPTY_HASH="$(mktemp -d)"
mkdir -p "$(dirname "$OUT")"
REX_CAPTURE="$OUT" timeout -k 5 60 stdbuf -oL -eL mame genesis \
  -cart "$ROM" -noplugins -hashpath "$EMPTY_HASH" -skip_gameinfo \
  -autoboot_script "$HERE/capture.lua"
rmdir "$EMPTY_HASH" 2>/dev/null || true
test -s "$OUT" && echo "capture: $OUT ($(stat -c%s "$OUT") bytes, sha256=$(sha256sum "$OUT" | cut -d' ' -f1))"
