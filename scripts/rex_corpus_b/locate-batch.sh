#!/usr/bin/env bash
# Lote serial de localizacao (um por vez: decodificar ROM inteira e pesado).
# So-leitura no corpus; saidas vao para data/rex_corpus_b/recursos/.
set -u
cd "$(dirname "$0")/../.."
G="/home/misael/emulation/roms/genesis"
log() { echo "[$(date +%H:%M:%S)] $*"; }
for f in "$@"; do
  base=$(basename "$f" | sed 's/[^A-Za-z0-9]+/-/g; s/\.[^.]*$//')
  out="data/rex_corpus_b/recursos/locate-${base}.json"
  log "inicio $f -> $out"
  timeout 2400 python3 scripts/rex_corpus_b/locate-streams.py --rom "$f" \
      --confirmar 24 --out "$out" || log "FALHA rc=$? $f"
  log "fim $f"
done
log "lote concluido"
