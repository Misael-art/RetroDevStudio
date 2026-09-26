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
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"
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
  if ! run_oracle 60 null -- "$ENI" "$f" "$T/$name.eni" </dev/null >"$T/e.log" 2>&1; then
    echo "ENCODE-RECUSA $name ($(head -c 100 "$T/e.log" | tr '\n' ' '))"
    rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	-	-	ENC-RECUSA"); continue
  fi
  if ! run_oracle 60 null -- "$ENI" -x "$T/$name.eni" "$T/$name.out" </dev/null >"$T/d.log" 2>&1; then
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

# ---------------------------------------------------------------------------
# NEGATIVOS negative-spec: derivados do CONTRATO v1/domínio (plain PAR;
# header autodescritivo é entrada NÃO-confiável), NÃO do oráculo (a referência
# descarta cauda ímpar em silêncio e aceita truncamento/modo inválido sem
# erro). Sem espelho do decode (empacotador variável blocked), cada spec tem
# SONDA DETERMINÍSTICA que reproduz o número medido 2026-09-25; divergência
# aborta antes de publicar.
NEGT="$OUT/negative"
rm -rf "$NEGT"; mkdir -p "$NEGT"
fail_neg=0

# e01: entrada ÍMPAR fora do domínio (diretriz do integrador: o produto NÃO
# pode truncar silenciosamente). O oráculo descarta a cauda: decode == 4 exato.
cp "$T/vectors/plain/odd_bytes_tail.bin" "$NEGT/e01_odd_bytes_tail.bin"
run_oracle 60 null -- "$ENI" "$NEGT/e01_odd_bytes_tail.bin" "$T/e01.eni" </dev/null >/dev/null 2>&1 \
  && run_oracle 60 null -- "$ENI" -x "$T/e01.eni" "$T/e01.out" </dev/null >/dev/null 2>&1 \
  && [ "$(stat -c%s "$T/e01.out")" = "4" ] \
  && echo "sonda e01 OK: ímpar 5 -> oráculo devolve 4 (cauda descartada; produto: recusar)" \
  || { echo "SONDA-DIVERGE e01 (out=$(stat -c%s "$T/e01.out" 2>/dev/null || echo rc!=0), spec: 4)"; fail_neg=1; }

# e02: truncado do último byte — oráculo produz 4098 ≠ 4096 sem sinalizar
L4=$(stat -c%s "$OUT/plain/planes_4k.eni")
head -c $((L4-1)) "$OUT/plain/planes_4k.eni" > "$NEGT/e02_truncated_last_byte.eni"
run_oracle 60 null -- "$ENI" -x "$NEGT/e02_truncated_last_byte.eni" "$T/e02.out" </dev/null >/dev/null 2>&1
if [ "$(stat -c%s "$T/e02.out" 2>/dev/null)" = "4098" ]; then
  echo "sonda e02 OK: cortado -> 4098 bytes no oráculo (reproduzido; produto: truncated)"
else
  echo "SONDA-DIVERGE e02: out=$(stat -c%s "$T/e02.out" 2>/dev/null || echo rc!=0) (spec: 4098)"; fail_neg=1
fi

# e03: declaração inflada em [4..5] ignorada pelo oráculo (saída byte-idêntica)
python3 - "$OUT/plain/planes_4k.eni" "$NEGT/e03_len_inflated.eni" <<'EOF'
import sys
st = bytearray(open(sys.argv[1], "rb").read())
assert st[:2].hex() == "0b1f", "e03 exige o header conhecido de planes_4k"
st[4:6] = b"\xff\xff"
open(sys.argv[2], "wb").write(bytes(st))
EOF
run_oracle 60 null -- "$ENI" -x "$NEGT/e03_len_inflated.eni" "$T/e03.out" </dev/null >/dev/null 2>&1
cmp -s "$T/e03.out" "$OUT/plain/planes_4k.bin" \
  && echo "sonda e03 OK: declaração inflada IGNORADA pelo oráculo (produto: declarações não-confiáveis)" \
  || { echo "SONDA-DIVERGE e03 (out=$(stat -c%s "$T/e03.out" 2>/dev/null || echo rc!=0))"; fail_neg=1; }

# e04: modo 0x02 inexistente decodica IDÊNTICO ao pleno (falsa-aceitação total)
{ printf '\x02'; tail -c +2 "$OUT/plain/const_500.eni"; } > "$NEGT/e04_mode_02.eni"
run_oracle 60 null -- "$ENI" -x "$NEGT/e04_mode_02.eni" "$T/e04.out" </dev/null >/dev/null 2>&1
cmp -s "$T/e04.out" "$OUT/plain/const_500.bin" \
  && echo "sonda e04 OK: modo inexistente aceito como válido (produto: rejeitar)" \
  || { echo "SONDA-DIVERGE e04"; fail_neg=1; }

# e05: stream vazia aceita com 0 bytes
: > "$NEGT/e05_empty_stream.eni"
run_oracle 60 null -- "$ENI" -x "$NEGT/e05_empty_stream.eni" "$T/e05.out" </dev/null >/dev/null 2>&1 \
  && [ "$(stat -c%s "$T/e05.out")" = "0" ] \
  && echo "sonda e05 OK: stream vazia falsa-aceita (produto: truncated)" \
  || { echo "SONDA-DIVERGE e05"; fail_neg=1; }

# e06: 255 bytes de 0xFF aceitos silenciosamente (0 bytes de saída)
head -c 255 /dev/zero | tr '\0' '\377' > "$NEGT/e06_garbage_ff_255b.eni"
run_oracle 60 null -- "$ENI" -x "$NEGT/e06_garbage_ff_255b.eni" "$T/e06.out" </dev/null >/dev/null 2>&1 \
  && [ "$(stat -c%s "$T/e06.out")" = "0" ] \
  && echo "sonda e06 OK: lixo aceito sem erro (produto: erro estruturado limitado)" \
  || { echo "SONDA-DIVERGE e06"; fail_neg=1; }

# e07: stream REAL válida + max_out=1024 (nenhuma sonda: limite é obrigação do produto)
cp "$OUT/plain/planes_4k.eni" "$NEGT/e07_planes_4k.eni"

cp "$SRC/negative-spec.json" "$NEGT/negative-spec.json" \
  || { echo "negative-spec.json ausente em $SRC"; fail_neg=1; }
[ "$fail_neg" = 0 ] || { echo "negativos não reproduzidos — NÃO PUBLICAR"; exit 1; }
for v in e01_odd_bytes_tail.bin e02_truncated_last_byte.eni e03_len_inflated.eni \
         e04_mode_02.eni e05_empty_stream.eni e06_garbage_ff_255b.eni e07_planes_4k.eni; do
  rows+=("negative	${v%.*}	-	-	$(stat -c%s "$NEGT/$v")	$(sha256sum "$NEGT/$v" | cut -d' ' -f1)	NEGATIVE-SPEC")
done

printf 'kind\tnome\tplain_bytes\tplain_sha256\tcomp_bytes\tcomp_sha256\tstatus\n' > "$OUT/manifest.tsv"
printf '%s\n' "${rows[@]}" >> "$OUT/manifest.tsv"
AGG=$( { find "$OUT/plain" "$OUT/negative" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
grep -c RT-OK "$OUT/manifest.tsv" | xargs -I{} echo "roundtrips OK: {}"
grep -c NEGATIVE-SPEC "$OUT/manifest.tsv" | xargs -I{} echo "negativos negative-spec: {}"
echo "publicado em $OUT"
