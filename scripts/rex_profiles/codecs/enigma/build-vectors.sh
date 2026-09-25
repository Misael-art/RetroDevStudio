#!/usr/bin/env bash
# Constrói vetores do perfil Enigma com o oráculo externo mdcomp `enicmp`
# (commit 72c6df40, LGPL-3.0 — FERRAMENTA EXTERNA; nada transplantado).
# Saída publicada: data/rex_profiles/codec/enigma/.
#
# Prova desta fase (roundtrip-only, declarada no manifest):
#   plain -> enicmp (encode) -> enicmp -x (decode) == plain, para arrays de
#   int16 BE cobrindo os modos inline/codificado do formato. Goldens
#   literais blocked com motivo (ver gen_vectors.py/manifest). Negativos:
#   truncamento e entrada de tamanho ímpar medidos, não presumidos.
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
ENI="$CACHE/oracle-tools/bin/enicmp"
SRC="$REPO/scripts/rex_profiles/codecs/enigma"
OUT="$REPO/data/rex_profiles/codec/enigma"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

[ -x "$ENI" ] || { echo "oráculo ausente: $ENI"; exit 1; }

python3 "$SRC/gen_vectors.py" "$T/vectors"
mkdir -p "$OUT/plain"

rows=()
for f in "$T/vectors/plain/"*.bin; do
  name="$(basename "$f" .bin)"
  case "$name" in odd_bytes_tail) continue ;; esac
  if ! timeout 60 "$ENI" "$f" "$T/$name.eni" </dev/null >"$T/e.log" 2>&1; then
    echo "ENCODE-RECUSA $name ($(head -c 100 "$T/e.log" | tr '\n' ' '))"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	-	-	ENC-RECUSA"); continue
  fi
  if ! timeout 60 "$ENI" -x "$T/$name.eni" "$T/$name.out" </dev/null >"$T/d.log" 2>&1; then
    echo "DECODE-RECUSA $name"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	$(stat -c%s "$T/$name.eni")	$(sha256sum "$T/$name.eni" | cut -d' ' -f1)	DEC-RECUSA"); continue
  fi
  if cmp -s "$f" "$T/$name.out"; then
    cp "$f" "$OUT/plain/$name.bin"
    cp "$T/$name.eni" "$OUT/plain/$name.eni"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	$(stat -c%s "$T/$name.eni")	$(sha256sum "$T/$name.eni" | cut -d' ' -f1)	RT-OK")
  else
    echo "RT-DIFF $name: in=$(stat -c%s "$f") out=$(stat -c%s "$T/$name.out")"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	$(stat -c%s "$T/$name.eni")	$(sha256sum "$T/$name.eni" | cut -d' ' -f1)	RT-DIFF")
  fi
done

# NEGATIVOS medidos no oráculo (registrados; produto deve dar erro estruturado)
probe() { # $1=nome $2=src $3=nbytes
  head -c "$3" "$2" > "$T/p.bin"
  if timeout 60 "$ENI" -x "$T/p.bin" "$T/p.out" </dev/null >"$T/p.log" 2>&1; then
    echo "$1: oráculo ACEITA truncada rc=0 out=$(stat -c%s "$T/p.out")"
  else
    echo "$1: oráculo rc=$?"
  fi
}
# os .eni do oráculo ficam em $T/ (não copiados p/ vectors/plain)
probe "trunc-mitade-array" "$T/planes_4k.eni" 40
probe "trunc-remove-ultimo-byte" "$T/ramp_signed.eni" $(( $(stat -c%s "$T/ramp_signed.eni") - 1 ))

# NEGATIVO de domínio medido: comprimento ímpar -> decode devolve um byte a
# menos (cauda órfã descartada). Registrado no manifest como ODD-TAIL-NEG.
if timeout 60 "$ENI" "$T/vectors/plain/odd_bytes_tail.bin" "$T/odd.eni" </dev/null 2>&1 \
   && timeout 60 "$ENI" -x "$T/odd.eni" "$T/odd.out" </dev/null 2>&1; then
  echo "odd-tail: in=$(stat -c%s "$T/vectors/plain/odd_bytes_tail.bin") out=$(stat -c%s "$T/odd.out") (esperado: ORÁCULO DESCARTA cauda ímpar)"
  rows+=("neg	odd_bytes_tail	5	$(sha256sum "$T/vectors/plain/odd_bytes_tail.bin" | cut -d' ' -f1)	$(stat -c%s "$T/odd.eni")	$(sha256sum "$T/odd.eni" | cut -d' ' -f1)	ODD-TAIL-OUT-$(( $(stat -c%s "$T/odd.out") ))")
fi

printf 'kind\tnome\tplain_bytes\tplain_sha256\tcomp_bytes\tcomp_sha256\tstatus\n' > "$OUT/manifest.tsv"
printf '%s\n' "${rows[@]}" >> "$OUT/manifest.tsv"
AGG=$( { find "$OUT/plain" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
grep -c RT-OK "$OUT/manifest.tsv" | xargs -I{} echo "roundtrips OK: {}"
echo "publicado em $OUT"
