#!/usr/bin/env bash
# Constrói vetores do perfil Kosinski (variante base, não-modular) usando o
# oráculo externo mdcomp `koscmp` (commit 72c6df40, LGPL-3.0 — FERRAMENTA
# EXTERNA; nenhum código transplantado para o produto).
# Saída publicada: data/rex_profiles/codec/kosinski/.
#
# Camadas de prova (contrato v1 §4):
#  1. plain: koscmp p -> koscmp -x == original            (roundtrip oráculo)
#  2. espelho: mirror_decode(koscmp-p(plain)) == plain    (o modelo do
#     escritor/leitor Python reproduz o oráculo em TODAS as streams reais;
#     qualquer divergência aborta antes de publicar)
#  3. golden: koscmp -x golden == expected exato          (stream artesanal
#     aceita pelo oráculo — independência builder<->decoder do oráculo)
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"
KOS="$CACHE/oracle-tools/bin/koscmp"
SRC="$REPO/scripts/rex_profiles/codecs/kosinski"
OUT="$REPO/data/rex_profiles/codec/kosinski"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

[ -x "$KOS" ] || { echo "oráculo ausente: $KOS (ver scripts/rex_profiles/codecs/setup-oracles.sh)"; exit 1; }

python3 "$SRC/gen_vectors.py" "$T/vectors"
mkdir -p "$OUT/plain" "$OUT/golden"

kos() { run_oracle 60 null -- "$KOS" "$@" </dev/null >/dev/null 2>&1; }

rows=()
mir_ok=0; mir_tot=0

# 1+2: roundtrip do oráculo em cada plain + paridade do espelho
for f in "$T/vectors/plain/"*.bin; do
  name="$(basename "$f" .bin)"
  if ! kos "$f" "$T/$name.kos"; then
    echo "FALHA encode: $name"; rows+=("plain	$name	-	-	-	-	ENC-FAIL"); continue
  fi
  if ! kos -x "$T/$name.kos" "$T/$name.out"; then
    echo "FALHA decode: $name"; rows+=("plain	$name	-	-	-	-	DEC-FAIL"); continue
  fi
  if ! cmp -s "$f" "$T/$name.out"; then
    echo "FALHA roundtrip: $name"; rows+=("plain	$name	-	-	-	-	RT-FAIL"); continue
  fi
  # espelho sobre a stream REAL do oráculo (calibração contínua do modelo)
  if python3 - "$SRC" "$T/$name.kos" "$f" <<'EOF'
import sys
sys.path.insert(0, sys.argv[1])
from kos_mirror import mirror_decode
st = open(sys.argv[2], "rb").read()
exp = open(sys.argv[3], "rb").read()
got, consumed = mirror_decode(st)
sys.exit(0 if got == exp and isinstance(got, bytes) and 0 <= consumed <= len(st) else 1)
EOF
  then mir_ok=$((mir_ok+1)); else echo "ESPELHO-DIVERGE: $name"; fi
  mir_tot=$((mir_tot+1))
  cp "$f" "$OUT/plain/$name.bin"
  cp "$T/$name.kos" "$OUT/plain/$name.kos"
  rows+=("plain	$name	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	$(stat -c%s "$T/$name.kos")	$(sha256sum "$T/$name.kos" | cut -d' ' -f1)	RT-OK+MIRROR")
done

if [ "$mir_ok" -ne "$mir_tot" ] || [ "$mir_tot" -eq 0 ]; then
  echo "espelho diverge do oráculo em $((mir_tot-mir_ok))/$mir_tot — NÃO PUBLICAR"
  exit 1
fi
echo "espelho vs oráculo: $mir_ok/$mir_tot OK"

# 3: goldens artesanais confirmados pelo oráculo
for f in "$T/vectors/golden/"*.kos; do
  name="$(basename "$f" .kos)"
  exp="${f%.kos}.expected.bin"
  if kos -x "$f" "$T/g.out" && cmp -s "$exp" "$T/g.out"; then
    cp "$f" "$OUT/golden/$name.kos"
    cp "$exp" "$OUT/golden/$name.expected.bin"
    rows+=("golden	$name	$(stat -c%s "$exp")	$(sha256sum "$exp" | cut -d' ' -f1)	$(stat -c%s "$f")	$(sha256sum "$f" | cut -d' ' -f1)	GOLDEN-CONFIRMED")
  else
    echo "GOLDEN REJEITADO: $name"
    rows+=("golden	$name	-	-	-	-	GOLDEN-REJEITADO")
  fi
done

printf 'kind\tnome\tplain_bytes\tplain_sha256\tcomp_bytes\tcomp_sha256\tstatus\n' > "$OUT/manifest.tsv"
printf '%s\n' "${rows[@]}" >> "$OUT/manifest.tsv"

# comportamento do ORÁCULO sob entrada malformada (registrado; o PRODUTO deve
# dar erro estruturado — a referência C++ lê bytes não-inicializados após EOF)
probe() { # $1=nome $2=arquivo
  if run_oracle 60 null -- "$KOS" -x "$2" "$T/p.out" </dev/null >"$T/p.log" 2>&1; then
    echo "$1: oráculo ACEITA rc=0 out=$(stat -c%s "$T/p.out" 2>/dev/null || echo '?')"
  else
    echo "$1: oráculo rc=$?"
  fi
}
head -c $(( $(stat -c%s "$T/vectors/golden/m05_separate_long_far.kos") - 1 )) \
  "$T/vectors/golden/m05_separate_long_far.kos" > "$T/trunc.kos"
probe "trunc-remove-1-byte" "$T/trunc.kos"
printf '\x02\x00\xff\xff\x00' > "$T/badref.kos"   # separado dist=3, histórico 0
probe "dist-maior-que-historico" "$T/badref.kos"

grep -c GOLDEN-CONFIRMED "$OUT/manifest.tsv" | xargs -I{} echo "goldens confirmados: {}"
# hash agregado da fixture — receita canônica e reproduzível:
#   sha256( (sha256sum ordenado de plain/ e golden/) || bytes de manifest.tsv )
AGG=$( { find "$OUT/plain" "$OUT/golden" -type f | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum | cut -d' ' -f1 )
echo "agregado=$AGG"
echo "publicado em $OUT"
