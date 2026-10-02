#!/usr/bin/env bash
# Verifica um decoder nativo do produto contra a fixture publicada do perfil
# aplib (data/rex_profiles/codec/aplib/), SEM tocar nos oráculos para os
# negativos. CLI esperado (definido em PRODUCT-CONTRACT.md §1/§3):
#
#   $BIN --stream S --out O [--max-out N] [--consumed-out F]
#     sucesso: exit 0, saída decodificada em O, bytes_consumed em F
#     erro:    exit != 0, stderr deve conter o código do contrato
#              (truncated|invalid-reference|excessive-output|overflow|work-limit)
#
# Uso: REX_APLIB_BIN=/caminho/do/bin scripts/rex_profiles/codecs/aplib/verify-product.sh
set -euo pipefail

REPO="${REX_REPO:-$(git rev-parse --show-toplevel)}"
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"
FIX="$REPO/data/rex_profiles/codec/aplib"
BIN="${REX_APLIB_BIN:?defina REX_APLIB_BIN com o CLI do decoder nativo}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

pass=0; fail=0
dec() { # $1=stream $2=out $3=max_out(ou -) $4=consumed_file(ou -)
  local args=(--stream "$1" --out "$2")
  [ "$3" != "-" ] && args+=(--max-out "$3")
  [ "$4" != "-" ] && args+=(--consumed-out "$4")
  run_oracle 20 null -- "$BIN" "${args[@]}" 2>"$T/err"
}

expect_ok() { # $1=nome $2=stream $3=plain esperado $4=consumed exato (ou -)
  local c="$T/c"
  if dec "$2" "$T/out" - "$c" && cmp -s "$3" "$T/out"; then
    if [ "$4" != "-" ] && [ "$(cat "$c")" != "$4" ]; then
      echo "FAIL $1: bytes_consumed=$(cat "$c") esperado $4"; fail=$((fail+1)); return
    fi
    echo "PASS $1"; pass=$((pass+1))
  else
    echo "FAIL $1: $(head -c 200 "$T/err")"; fail=$((fail+1))
  fi
}

expect_err() { # $1=nome $2=stream $3=max_out(ou -) $4=código esperado
  if dec "$2" "$T/bad" "$3" -; then
    echo "FAIL $1: produto ACEITOU stream que deve dar $4 (saiu $(stat -c%s "$T/bad" 2>/dev/null || echo '?') bytes)"; fail=$((fail+1))
  elif grep -q "$4" "$T/err"; then
    echo "PASS $1 ($4)"; pass=$((pass+1))
  else
    echo "FAIL $1: erro esperado $4, obtido: $(head -c 200 "$T/err")"; fail=$((fail+1))
  fi
}

# 1) goldens (streams montados à mão, GOLDEN-CONFIRMED pelos oráculos)
while IFS=$'\t' read -r kind name rest; do
  [ "$kind" = "golden" ] || continue
  stream="$FIX/golden/$name.ap"
  plain="$FIX/golden/$name.expected.bin"
  if [ "$name" = "g08_eod_trailing" ]; then
    consumed=6   # para de onde está o EOD; ver PRODUCT-CONTRACT §3
  else
    consumed=$(stat -c%s "$stream")
  fi
  expect_ok "golden/$name" "$stream" "$plain" "$consumed"
done < <(tail -n +2 "$FIX/manifest.tsv")

# 2) streams reais dos oráculos: para cada nome, o produto decodifica o
# stream do apultra E o do APJ; as duas saídas devem ser idênticas entre si e
# bater com plain_len/plain_sha256 do manifest (os .bin não são publicados).
while IFS=$'\t' read -r kind name plen psha _rest; do
  [ "$kind" = "plain" ] || continue
  if dec "$FIX/plain/$name.apultra.ap" "$T/a" - "$T/ca" \
     && dec "$FIX/plain/$name.apj.ap" "$T/b" - "$T/cb"; then
    if cmp -s "$T/a" "$T/b" \
       && [ "$(stat -c%s "$T/a")" = "$plen" ] \
       && [ "$(sha256sum "$T/a" | cut -d' ' -f1)" = "$psha" ] \
       && [ "$(cat "$T/ca")" = "$(stat -c%s "$FIX/plain/$name.apultra.ap")" ] \
       && [ "$(cat "$T/cb")" = "$(stat -c%s "$FIX/plain/$name.apj.ap")" ]; then
      echo "PASS plain/$name (produto==produto, manifest, consumed exato)"; pass=$((pass+1))
    else
      echo "FAIL plain/$name: saída/consumed divergem do manifest"; fail=$((fail+1))
    fi
  else
    echo "FAIL plain/$name: produto recusou stream legítimo: $(head -c 200 "$T/err")"; fail=$((fail+1))
  fi
done < <(tail -n +2 "$FIX/manifest.tsv")

# 3) negativos (negative-spec; NUNCA enviados aos oráculos)
for j in "$FIX"/negative/*.expected.json; do
  name="$(basename "$j" .expected.json)"
  err=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['expected_error'])" "$j")
  mo=$(python3 -c "import json,sys;v=json.load(open(sys.argv[1]))['max_out'];print('-' if v is None else v)" "$j")
  expect_err "negative/$name" "$FIX/negative/$name.ap" "$mo" "$err"
done

echo "aplib-verify: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
