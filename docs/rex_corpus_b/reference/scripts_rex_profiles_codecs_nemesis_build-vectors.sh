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

# ---------------------------------------------------------------------------
# NEGATIVOS negative-spec: derivados do CONTRATO v1/domínio, NÃO do oráculo
# (a referência não valida nada — ela SEGFAULTA no encode de plain vazio e
# aceita truncamento devolvendo o MESMO tamanho de saída). Sem espelho Python
# do decode (tabela adaptativa blocked), cada spec carrega uma SONDA
# DETERMINÍSTICA que reproduz exatamente o número medido em 2026-09-25;
# qualquer divergência aborta antes de publicar.
NEGT="$OUT/negative"
rm -rf "$NEGT"; mkdir -p "$NEGT"
fail_neg=0

# artefatos determinísticos (derivados dos plains/streams publicados)
printf 'ABCDEF' > "$NEGT/n01_align_input_6b.bin"                      # 6 B, %32 != 0
head -c 100 /dev/zero | tr '\0' '\272' > "$NEGT/n02_align_input_100b.bin"  # 100 B de 0xBA
: > "$NEGT/n03_empty_stream.nem"
head -c 64 /dev/zero | tr '\0' '\377' > "$NEGT/n04_garbage_ff_64b.nem"
L64=$(stat -c%s "$OUT/plain/planes_64k.nem")
head -c $((L64-1)) "$OUT/plain/planes_64k.nem" > "$NEGT/n05_truncated_last_byte.nem"
head -c 8 "$OUT/plain/alt_55_aa_96.nem" > "$NEGT/n06_hanging_prefix.nem"
cp "$OUT/plain/planes_64k.nem" "$NEGT/n07_planes_64k.nem"              # stream REAL válida p/ max_out=1024

# sonda n01/n02: padding silencioso FORA do domínio (medido: 6->32, 100->128)
probe_domain() { # $1=in $2=tamanho-de-saida-esperado-da-pollinga
  run_oracle 60 null -- "$NEM" "$1" "$T/pd.nem" </dev/null >/dev/null 2>&1 \
    || { echo "SONDA-FAIL encode $1"; fail_neg=1; return; }
  run_oracle 60 null -- "$NEM" -x "$T/pd.nem" "$T/pd.out" </dev/null >/dev/null 2>&1 \
    || { echo "SONDA-FAIL decode $1"; fail_neg=1; return; }
  [ "$(stat -c%s "$T/pd.out")" = "$2" ] \
    || { echo "SONDA-DIVERGE $1: oráculo devolveu $(stat -c%s "$T/pd.out"), spec diz $2"; fail_neg=1; return; }
  echo "sonda domínio OK: $(basename "$1") -> oráculo.pad(2)=$2 (o produto DEVE recusar)"
}
probe_domain "$NEGT/n01_align_input_6b.bin" 32
probe_domain "$NEGT/n02_align_input_100b.bin" 128

# sonda n03: stream vazia é falsa-aceita com 0 bytes
run_oracle 60 null -- "$NEM" -x "$NEGT/n03_empty_stream.nem" "$T/n03.out" </dev/null >/dev/null 2>&1 \
  && [ "$(stat -c%s "$T/n03.out")" = "0" ] \
  && echo "sonda n03 OK: oráculo aceita stream vazia (produto: truncated)" \
  || { echo "SONDA-DIVERGE n03"; fail_neg=1; }

# sonda n04: 64 bytes de 0xFF expandem para EXATAMENTE 1048544 (limite de
# trabalho/max_out do produto é obrigação — esta é a prova quantitativa)
run_oracle 60 null -- "$NEM" -x "$NEGT/n04_garbage_ff_64b.nem" "$T/n04.out" </dev/null >/dev/null 2>&1
if [ "$(stat -c%s "$T/n04.out" 2>/dev/null)" = "1048544" ]; then
  echo "sonda n04 OK: garbage-64B -> 1048544 B no oráculo (reproduzido)"
else
  echo "SONDA-DIVERGE n04: out=$(stat -c%s "$T/n04.out" 2>/dev/null || echo rc!=0) (spec: 1048544)"; fail_neg=1
fi

# sonda n05: truncado de 1 byte é falsa-aceito COM O MESMO TAMANHO do pleno
# (65536) e conteúdo divergente a partir do byte 65508 — por isso o spec não
# pode ser verificado por tamanho; verificador real é o parser do produto.
run_oracle 60 null -- "$NEM" -x "$NEGT/n05_truncated_last_byte.nem" "$T/n05.out" </dev/null >/dev/null 2>&1
if [ "$(stat -c%s "$T/n05.out" 2>/dev/null)" = "65536" ] && ! cmp -s "$T/n05.out" "$OUT/plain/planes_64k.bin"; then
  echo "sonda n05 OK: oráculo finge sucesso em stream cortada (tamanho pleno, conteúdo diverge)"
else
  echo "SONDA-DIVERGE n05: out=$(stat -c%s "$T/n05.out" 2>/dev/null || echo rc!=0)"; fail_neg=1
fi

# sonda n06: prefixo de 8 bytes faz o oráculo entrar em loop e morrer no
# limite do sandbox (medido rc=137/SIGKILL) — work-limit/cancelamento do
# produto são obrigatórios. rc != 0 (kill/timeout/erro) satisfaz a prova.
rc06=0
run_oracle 60 null -- "$NEM" -x "$NEGT/n06_hanging_prefix.nem" "$T/n06.out" </dev/null >/dev/null 2>&1 || rc06=$?
if [ "$rc06" = 0 ]; then
  echo "SONDA-DIVERGE n06: oráculo TERMINOU LIMPO (o perigo de loop sumiu — reavaliar spec)"; fail_neg=1
else
  echo "sonda n06 OK: oráculo morreu sob limite do sandbox (rc=$rc06) — work-limit necessário"
fi

cp "$SRC/negative-spec.json" "$NEGT/negative-spec.json" \
  || { echo "negative-spec.json ausente em $SRC"; fail_neg=1; }
[ "$fail_neg" = 0 ] || { echo "negativos não reproduzidos — NÃO PUBLICAR"; exit 1; }
for v in n01_align_input_6b n02_align_input_100b n03_empty_stream n04_garbage_ff_64b \
         n05_truncated_last_byte n06_hanging_prefix n07_planes_64k; do
  file="$NEGT/$v.nem"; [ -f "$file" ] || file="$NEGT/$v.bin"
  rows+=("negative	$v	-	-	$(stat -c%s "$file")	$(sha256sum "$file" | cut -d' ' -f1)	NEGATIVE-SPEC")
done

printf 'kind\tnome\tplain_bytes\tplain_sha256\tcomp_bytes\tcomp_sha256\tstatus\n' > "$OUT/manifest.tsv"
printf '%s\n' "${rows[@]}" >> "$OUT/manifest.tsv"
AGG=$( { find "$OUT/plain" "$OUT/negative" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
grep -c RT-OK "$OUT/manifest.tsv" | xargs -I{} echo "roundtrips OK: {}"
grep -c NEGATIVE-SPEC "$OUT/manifest.tsv" | xargs -I{} echo "negativos negative-spec: {}"
echo "publicado em $OUT"
