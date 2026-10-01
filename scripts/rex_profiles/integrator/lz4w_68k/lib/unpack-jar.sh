#!/usr/bin/env bash
# Desempacota cada caso com a referência Java OFICIAL (jar v1.43) sob o MESMO
# contexto visto pelo 68k: dict@input quando há prefixo-dicionário.
# Os dicts grandes (BYOR) ficam no diretório do driver (streams), não no
# diretório de casos comidos ao git; os streams/plain são lidos de <cases-dir>.
# Sandbox: timeout obrigatório; rc registrado (não confundir com causa).
set -euo pipefail
JAR="${LZ4W_JAR:-/home/misael/.cache/rex-codecs/oracle-tools/SGDK211/bin/lz4w.jar}"
CASES="${1:?uso: unpack-jar.sh <cases2-dir> <saida-dir> <log-dir> [dir-com-dicts]}"
OUT="$2"
LOGS="$3"
DICTDIR="${4:-$CASES}"
mkdir -p "$OUT" "$LOGS"
for f in "$CASES"/*.stream; do
  cid="$(basename "$f" .stream)"
  dict=""
  for cand in "$DICTDIR/$cid.dict" "$CASES/$cid.dict"; do
    [ -f "$cand" ] && { dict="$cand"; break; }
  done
  args=("$f" "$OUT/$cid.out")
  if [ -n "$dict" ]; then
    args=("$dict@$f" "$OUT/$cid.out")
  fi
  set +e
  timeout 60 java -jar "$JAR" u "${args[@]}" >"$LOGS/$cid.out.log" 2>&1
  echo "$cid rc=$?" | tee -a "$LOGS/rc.tsv"
  set -e
done
