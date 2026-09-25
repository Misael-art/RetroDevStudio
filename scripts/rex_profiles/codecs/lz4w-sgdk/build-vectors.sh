#!/usr/bin/env bash
# Constrói vetores do perfil LZ4W-SGDK usando o oráculo externo (lz4w.jar v1.43,
# SGDK v2.11, MIT, hash em ORACLE-INVENTORY.md). Saída: data/rex_profiles/codec/lz4w-sgdk/.
# Limitação declarada: LZ4W é formato de autor único; não existe segundo oráculo
# independente multi-autor (buscado 2026-09-25). decode-oráculo == encode-oráculo
# (mesmo jar) => paridade interna de ECOSSISTEMA, não independência multi-autores.
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"
LZ4W="$CACHE/oracle-tools/SGDK211/bin/lz4w.jar"
SRC="$REPO/scripts/rex_profiles/codecs/lz4w-sgdk"
OUT="$REPO/data/rex_profiles/codec/lz4w-sgdk"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

python3 "$SRC/gen_vectors.py" "$T/vectors"
mkdir -p "$OUT/plain" "$OUT/golden" "$OUT/dict" "$OUT/negative"
cp "$T/vectors/golden/"* "$OUT/golden/"
cp "$T/vectors/negative/"* "$OUT/negative/"
cp "$T/vectors/dict/"* "$OUT/dict/"

u() { run_java 60 512 -- -jar "$LZ4W" "$@" s </dev/null >/dev/null 2>&1; }

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

# --- dicionário: dependência DECLARADA (CONTRACTS §4). Stream gerado pelo
# oráculo com `d01_dict.bin@d01_plain.bin` (separador real '@'; a ajuda do CLI
# diz '&' e está errada — defeito de doc registrado). Roundtrip com dicionário
# exige EXATIDÃO; sem dicionário o oráculo estoura (IndexOutOfBounds, medido
# 2026-09-25) — o produto deve retornar invalid-reference, documentado em
# dict/d01.meta.json. Espelho Python (modo prev) valida paridade antes de publicar.
D="$T/vectors/dict/d01"
( cd "$T/vectors/dict" && u p "d01_dict.bin@d01_plain.bin" "$T/d01.lz4" ) || { echo "FALHA pack c/ dict"; exit 1; }
( cd "$T/vectors/dict" && u u "d01_dict.bin@$T/d01.lz4" "$T/d01.out" ) || { echo "FALHA unpack c/ dict"; exit 1; }
cmp -s "$D"_plain.bin "$T/d01.out" || { echo "FALHA roundtrip c/ dict"; exit 1; }
python3 -c "
import importlib.util, sys
sys.argv = ['gv', '$T/mirror-out']
spec = importlib.util.spec_from_file_location('gv', '$SRC/gen_vectors.py')
gv = importlib.util.module_from_spec(spec); spec.loader.exec_module(gv)
prev = open('$D' + '_dict.bin','rb').read()
st = open('$T/d01.lz4','rb').read()
exp = open('$D' + '_plain.bin','rb').read()
got = gv.mirror_dict_decode(st, prev)
assert got == exp, f'espelho dict diverge do oráculo: {got!r}'
g2 = gv.mirror_dict_decode(st, b'')
assert g2 == 'ERR-off', f'sem dict esperava ERR-off, obtive {g2!r}'
print('espelho dict: paridade OK; sem-dict referencia fora do contexto (ERR-off)')
"
cp "$T/d01.lz4" "$OUT/dict/d01_stream.lz4"
rows+=("dictionary	d01	$(stat -c%s "${D}_plain.bin")	$(sha256sum "${D}_plain.bin" | cut -d' ' -f1)	$(stat -c%s "$T/d01.lz4")	$(sha256sum "$T/d01.lz4" | cut -d' ' -f1)	DICT-RT-OK (dict $(stat -c%s "${D}_dict.bin") B declarado)")

# negativos negative-spec: NÃO vão ao oráculo (expectativa é do contrato)
for f in "$T/vectors/negative/"*.lz4; do
  name="$(basename "$f" .lz4)"
  exp="$T/vectors/negative/$name.expected.json"
  cp "$f" "$OUT/negative/$name.lz4"
  cp "$exp" "$OUT/negative/$name.expected.json"
  err=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['expected_error'])" "$exp")
  rows+=("negative	$name	-	$(sha256sum "$exp" | cut -d' ' -f1)	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	NEGATIVE-SPEC:$err")
done

# comportamento do ORÁCULO sob entrada malformada (registrado, não exigido do produto)

trunc_probe() { # $1=nome $2=arquivo $3=nbytes
  head -c "$3" "$2" > "$T/tr.bin"
  if run_java 60 512 -- -jar "$LZ4W" u "$T/tr.bin" "$T/tr.out" s </dev/null >"$T/tr.log" 2>&1; then
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
#   sha256( sha256sum ordenado (LC_ALL=C) dos arquivos de plain/, golden/, dict/ e
#           negative/ concatenado com os bytes de manifest.tsv )
AGG=$( { find "$OUT/plain" "$OUT/golden" "$OUT/dict" "$OUT/negative" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
echo "OK -> $OUT"
