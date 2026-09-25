#!/usr/bin/env bash
# Constrói vetores do perfil Nemesis com o oráculo externo mdcomp `nemcmp`
# (commit 72c6df40, LGPL-3.0 — FERRAMENTA EXTERNA; nada transplantado).
# Saída publicada: data/rex_profiles/codec/nemesis/.
#
# Prova desta fase (roundtrip-only, declarada no manifest):
#   plain -> nemcmp (encode) -> nemcmp -x (decode) == plain, para plains no
#   domínio do formato (múltiplos de 32). Goldens artesanais (stream literal
#   montado à mão) ficam BLOQUEADOS com motivo: exigiriam espelhar a tabela
#   adaptativa de códigos de nibble do encoder; ajustar a referência é
#   proibido. Negativos documentam o padding silencioso fora do domínio.
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"
NEM="$CACHE/oracle-tools/bin/nemcmp"
SRC="$REPO/scripts/rex_profiles/codecs/nemesis"
OUT="$REPO/data/rex_profiles/codec/nemesis"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

[ -x "$NEM" ] || { echo "oráculo ausente: $NEM"; exit 1; }

python3 "$SRC/gen_vectors.py" "$T/vectors"
mkdir -p "$OUT/plain"

rows=()
for f in "$T/vectors/plain/"*.bin; do
  name="$(basename "$f" .bin)"
  case "$name" in neg_*) continue ;; esac
  if ! run_oracle 60 null -- "$NEM" "$f" "$T/$name.nem" </dev/null >"$T/e.log" 2>&1; then
    echo "FALHA encode: $name"; rows+=("plain	$name	-	-	-	-	ENC-FAIL"); continue
  fi
  if ! run_oracle 60 null -- "$NEM" -x "$T/$name.nem" "$T/$name.out" </dev/null >"$T/d.log" 2>&1; then
    echo "FALHA decode: $name"; rows+=("plain	$name	-	-	-	-	DEC-FAIL"); continue
  fi
  if cmp -s "$f" "$T/$name.out"; then
    cp "$f" "$OUT/plain/$name.bin"
    cp "$T/$name.nem" "$OUT/plain/$name.nem"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	$(stat -c%s "$T/$name.nem")	$(sha256sum "$T/$name.nem" | cut -d' ' -f1)	RT-OK")
  else
    echo "FALHA roundtrip: $name ($(stat -c%s "$T/$name.out") vs $(stat -c%s "$f"))"
    rows+=("plain	$name	$(stat -c%s "$f")	-	-	-	RT-FAIL")
  fi
done

# NEGATIVOS: comportamento do oráculo fora do domínio (padding silencioso)
probe_out_of_domain() { # $1=nome $2=bytes
  head -c "$2" "$T/vectors/plain/$1.bin" > "$T/oob.bin"
  run_oracle 60 null -- "$NEM" "$T/oob.bin" "$T/oob.nem" </dev/null >/dev/null 2>&1 || { echo "$1: encode rc!=0"; return; }
  run_oracle 60 null -- "$NEM" -x "$T/oob.nem" "$T/oob.out" </dev/null >/dev/null 2>&1 || { echo "$1: decode rc!=0"; return; }
  echo "$1: oráculo ACEITA $2 bytes fora do domínio; decode devolve $(stat -c%s "$T/oob.out") bytes (padding)"
}
probe_out_of_domain neg_tiny_6 6
probe_out_of_domain neg_100 100

printf 'kind\tnome\tplain_bytes\tplain_sha256\tcomp_bytes\tcomp_sha256\tstatus\n' > "$OUT/manifest.tsv"
printf '%s\n' "${rows[@]}" >> "$OUT/manifest.tsv"
AGG=$( { find "$OUT/plain" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
grep -c RT-OK "$OUT/manifest.tsv" | xargs -I{} echo "roundtrips OK: {}"
echo "publicado em $OUT"
