#!/usr/bin/env bash
# inventario.sh — reprodución de un só comando do inventario da Fase 1 (MISSAO A).
#
# Encadea as duas ferramentas que ja existem e non duplica a sua logica:
#   1. stage.sh        -> normaliza membros illados e escribe a folla de proveniancia
#   2. rex-corpus inventario -> le os bytes staged e escribe o manifesto JSON
#
# A saida de ambas queda nun camino ESTABLE ($WORK/logs/inventario.log) para que
# outra persona poida auditar o artefacto sen depender da narracion desta sesion.
#
# Non escribe no corpus (stage.sh abre o corpus só en lectura) e non versiona
# bytes comerciais: só o manifesto JSON entra na árbore rastreada.
#
# Uso:   scripts/rex_corpus_a/inventario.sh
# Env:   REX_CORPUS_A       raiz do corpus (obrigatoria)
#        REX_CORPUS_A_WORK  directorio local (default ~/.retrodev/rex_corpus_a_work)
#        REX_ROLES          papeis a normalizar (default: desenvolvimento)
#        REX_MANIFESTO      lista de fontes (default data/rex_corpus_a/inventario-fontes.tsv)
#
# REX_ROLES ten por defecto SO `desenvolvimento` a proposito: o papel
# `reservada` e o holdout da Fase 4 e non debe acabarse nun staged desta fase.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$AQUI/../.." && pwd)"
WORK="${REX_CORPUS_A_WORK:-$HOME/.retrodev/rex_corpus_a_work}"
ROLES="${REX_ROLES:-desenvolvimento}"
MANIFESTO="${REX_MANIFESTO:-$REPO/data/rex_corpus_a/inventario-fontes.tsv}"
MANIFESTO_JSON="${REX_MANIFESTO_JSON:-$REPO/data/rex_corpus_a/inventario.json}"
LOG="$WORK/logs/inventario.log"

[ -n "${REX_CORPUS_A:-}" ] || {
  echo "ERRO: falta REX_CORPUS_A (raiz do corpus en lectura)" >&2
  exit 2
}
[ -d "$REX_CORPUS_A" ] || { echo "ERRO: REX_CORPUS_A non existe: $REX_CORPUS_A" >&2; exit 2; }
[ -f "$MANIFESTO" ] || { echo "ERRO: manifesto de fontes inexistente: $MANIFESTO" >&2; exit 2; }

mkdir -p "$WORK/logs"

{
  echo "=== rex-corpus inventario $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo "REX_CORPUS_A=$REX_CORPUS_A"
  echo "REX_ROLES=$ROLES"
  echo "manifesto_fontes=$MANIFESTO"
  sha256sum "$MANIFESTO"
} > "$LOG"

echo "-- 1/2 normalizacion (stage.sh) --"
REX_CORPUS_A="$REX_CORPUS_A" REX_CORPUS_A_WORK="$WORK" REX_ROLES="$ROLES" \
  "$AQUI/stage.sh" "$MANIFESTO" 2>&1 | tee -a "$LOG"

PROV="$WORK/proveniencia.tsv"
[ -f "$PROV" ] || { echo "ERRO: stage.sh non deixou folla de proveniancia en $PROV" >&2; exit 3; }

echo "-- 2/2 inventario (rex-corpus) --"
# `inventario` sale con 5 cando hay diverxencias medidas: é un resultado, non
# un fallo do comando, polo que se captura o código en vez de abortar.
set +e
cargo run --offline --quiet --manifest-path "$AQUI/Cargo.toml" -- \
  inventario --proveniencia "$PROV" --out "$MANIFESTO_JSON" 2>&1 | tee -a "$LOG"
rc="${PIPESTATUS[0]}"
set -e

{
  echo "--- RESUMO ---"
  echo "codigo_saida=$rc"
  echo "proveniancia=$PROV"
  sha256sum "$PROV"
  echo "manifesto_json=$MANIFESTO_JSON"
  sha256sum "$MANIFESTO_JSON"
  echo "log=$LOG"
} | tee -a "$LOG"

exit "$rc"
