#!/usr/bin/env bash
# Constrói os vetores do perfil aPLib usando SOMENTE os oráculos externos
# (apultra, APJ v1.32) e valida paridade cruzada. Saída: data/rex_profiles/codec/aplib/.
# Nenhum resultado é aceito sem os dois oráculos decodificando exato.
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"
APULTRA="$CACHE/oracle-tools/apultra"
APJ="$CACHE/oracle-tools/SGDK211/bin/apj.jar"
SRC="$REPO/scripts/rex_profiles/codecs/aplib"
OUT="$REPO/data/rex_profiles/codec/aplib"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

python3 "$SRC/gen_vectors.py" "$T/vectors"
mkdir -p "$OUT/plain" "$OUT/golden" "$OUT/negative"
cp "$T/vectors/golden/"* "$OUT/golden/"
cp "$T/vectors/negative/"* "$OUT/negative/"

rows=()
for f in "$T/vectors/plain/"*.bin; do
  name="$(basename "$f" .bin)"
  [ -s "$f" ] || { echo "SKIP $name (formato não representa saída vazia)"; continue; }
  if [ "$(stat -c%s "$f")" -lt 2 ]; then
    echo "SKIP $name (1 byte: encoders de referência não produzem stream; ver golden g01b)"
    continue
  fi
  ok=true
  run_oracle 60 null -- "$APULTRA" -c "$f" "$T/$name.ap" >/dev/null 2>&1 || ok=false
  run_java 60 512 -- -jar "$APJ" p "$f" "$T/$name.apj" s >/dev/null 2>&1 || ok=false
  if $ok; then
    # paridade cruzada: cada oráculo decodifica o stream do outro
    run_oracle 60 null -- "$APULTRA" -d "$T/$name.apj" "$T/x1" >/dev/null && cmp -s "$f" "$T/x1" || ok=false
    run_java 60 512 -- -jar "$APJ" u "$T/$name.ap" "$T/x2" s >/dev/null && cmp -s "$f" "$T/x2" || ok=false
  fi
  if $ok; then
    cp "$T/$name.ap" "$OUT/plain/$name.apultra.ap"
    cp "$T/$name.apj" "$OUT/plain/$name.apj.ap"
    h_in=$(sha256sum "$f" | cut -d' ' -f1)
    h_a=$(sha256sum "$T/$name.ap" | cut -d' ' -f1)
    h_j=$(sha256sum "$T/$name.apj" | cut -d' ' -f1)
    rows+=("plain	$name	$(stat -c%s "$f")	$h_in	$(stat -c%s "$T/$name.ap")	$h_a	$(stat -c%s "$T/$name.apj")	$h_j	CROSS-OK")
  else
    echo "FALHA cross-oracle: $name"
    rows+=("plain	$name	-	-	-	-	-	-	FALHA")
  fi
done

for f in "$T/vectors/golden/"*.ap; do
  name="$(basename "$f" .ap)"
  exp="${f%.ap}.expected.bin"
  ok=true
  run_oracle 60 null -- "$APULTRA" -d "$f" "$T/g1" >/dev/null 2>&1 && cmp -s "$exp" "$T/g1" || ok=false
  run_java 60 512 -- -jar "$APJ" u "$f" "$T/g2" s >/dev/null 2>&1 && cmp -s "$exp" "$T/g2" || ok=false
  if $ok; then
    rows+=("golden	$name	$(stat -c%s "$exp")	$(sha256sum "$exp" | cut -d' ' -f1)	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	-	-	GOLDEN-CONFIRMED")
  else
    echo "GOLDEN REJEITADO (oráculos divergem da especificação): $name"
    rm -f "$OUT/golden/$name.ap" "$OUT/golden/$name.expected.bin"
    rows+=("golden	$name	-	-	-	-	-	-	GOLDEN-REJEITADO")
  fi
done

# negativos: derivados do contrato; NÃO são enviados aos oráculos (a referência
# não valida entrada e tem UB além do EOF — comportamento indefinido não é prova)
for f in "$T/vectors/negative/"*.ap; do
  name="$(basename "$f" .ap)"
  exp="$T/vectors/negative/$name.expected.json"
  cp "$f" "$OUT/negative/$name.ap"
  cp "$exp" "$OUT/negative/$name.expected.json"
  err=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['expected_error'])" "$exp")
  rows+=("negative	$name	-	$(sha256sum "$exp" | cut -d' ' -f1)	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	-	-	NEGATIVE-SPEC:$err")
done

{
  echo -e "kind\tname\tplain_len\tplain_sha256\tapultra_len\tapultra_sha256\tapj_len\tapj_sha256\tstatus"
  printf '%s\n' "${rows[@]-}"
} > "$OUT/manifest.tsv"

# hash agregado da fixture — receita canônica (mesma dos perfis mdcomp):
#   sha256( sha256sum ordenado (LC_ALL=C) dos arquivos de plain/, golden/ e negative/
#           concatenado com os bytes de manifest.tsv )
AGG=$( { find "$OUT/plain" "$OUT/golden" "$OUT/negative" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
echo "OK -> $OUT"
