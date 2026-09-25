#!/usr/bin/env bash
# Constrói vetores do perfil LZ4W-SGDK usando o oráculo externo (lz4w.jar v1.43,
# SGDK v2.11, MIT, hash em ORACLE-INVENTORY.md). Saída: data/rex_profiles/codec/lz4w-sgdk/.
# Limitação declarada: LZ4W é formato de autor único; não existe segundo oráculo
# independente multi-autor (buscado 2026-09-25). decode-oráculo == encode-oráculo
# (mesmo jar) => paridade interna de ECOSSISTEMA, não independência multi-autores.
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
LZ4W="$CACHE/oracle-tools/SGDK211/bin/lz4w.jar"
SRC="$REPO/scripts/rex_profiles/codecs/lz4w-sgdk"
OUT="$REPO/data/rex_profiles/codec/lz4w-sgdk"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

python3 "$SRC/gen_vectors.py" "$T/vectors"
mkdir -p "$OUT/plain" "$OUT/golden"
cp "$T/vectors/golden/"* "$OUT/golden/"

u() { timeout 60 java -jar "$LZ4W" "$@" s </dev/null >/dev/null 2>&1; }

rows=()
for f in "$T/vectors/plain/"*.bin; do
  name="$(basename "$f" .bin)"
  u p "$f" "$T/$name.lz4" || { echo "FALHA pack: $name"; rows+=("plain	$name	-	-	-	-	FALHA"); continue; }
  ok=true
  u u "$T/$name.lz4" "$T/$name.out" || ok=false
  $ok && cmp -s "$f" "$T/$name.out" || ok=false
  if $ok; then
    cp "$T/$name.lz4" "$OUT/plain/$name.lz4"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	$(stat -c%s "$T/$name.lz4")	$(sha256sum "$T/$name.lz4" | cut -d' ' -f1)	RT-OK")
  else
    echo "FALHA roundtrip: $name"
    rows+=("plain	$name	-	-	-	-	FALHA")
  fi
done

for f in "$T/vectors/golden/"*.lz4; do
  name="$(basename "$f" .lz4)"
  exp="${f%.lz4}.expected.bin"
  ok=true
  u u "$f" "$T/g.out" || ok=false
  $ok && cmp -s "$exp" "$T/g.out" || ok=false
  if $ok; then
    rows+=("golden	$name	$(stat -c%s "$exp")	$(sha256sum "$exp" | cut -d' ' -f1)	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	GOLDEN-CONFIRMED")
  else
    echo "GOLDEN REJEITADO: $name"
    rm -f "$OUT/golden/$name.lz4" "$OUT/golden/$name.expected.bin"
    rows+=("golden	$name	-	-	-	-	GOLDEN-REJEITADO")
  fi
done

# comportamento do ORÁCULO sob entrada malformada (registrado, não exigido do produto)
trunc_probe() { # $1=nome $2=arquivo $3=nbytes
  head -c "$3" "$2" > "$T/tr.bin"
  if timeout 60 java -jar "$LZ4W" u "$T/tr.bin" "$T/tr.out" s </dev/null >"$T/tr.log" 2>&1; then
    echo "$1: oráculo ACEITA rc=0 out=$(stat -c%s "$T/tr.out" 2>/dev/null || echo '?')"
  else
    echo "$1: oráculo recusa rc=$? ($(head -c 120 "$T/tr.log" | tr '\n' ' '))"
  fi
}
trunc_probe "trunc-antes-EOD" "$OUT/golden/k09_mixed.lz4" 6
trunc_probe "trunc-metade-match-longo" "$OUT/golden/k07_long_match_near.lz4" 4
trunc_probe "sem-final-word" "$OUT/golden/k01_literals_even.lz4" 12

{
  echo -e "kind	name	plain_len	plain_sha256	stream_len	stream_sha256	status"
  printf '%s\n' "${rows[@]-}"
} > "$OUT/manifest.tsv"

# hash agregado da fixture — receita canônica (mesma dos perfis mdcomp):
#   sha256( sha256sum ordenado (LC_ALL=C) dos arquivos de plain/ e golden/
#           concatenado com os bytes de manifest.tsv )
AGG=$( { find "$OUT/plain" "$OUT/golden" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
echo "OK -> $OUT"
