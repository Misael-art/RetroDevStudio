#!/usr/bin/env bash
# MODO DIFERENCIAL (documentado, separado da suíte normal do pacote):
# compara o decodificador Rust `crates/rex-kosinski` byte a byte com o oráculo
# externo mdcomp `koscmp` (LGPL-3.0 — FERRAMENTA EXTERNA, nada transplantado)
# sobre TODAS as streams do perfil Kosinski + fixture da missão.
#
# Exige oráculo instalado e PINADO; falha se os pins divergem. Toda chamada ao
# oráculo passa por sandbox.sh (timeout + ulimit -v/-t/-f + stdin fechado).
# A suíte `cargo test` funciona SEM este oráculo; este script é o complemento
# de paridade externa (validação item 4 da missão frente B, 2026-09-27).
#
# Uso:  bash scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh [dir-saida]
set -uo pipefail

REPO="${REX_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
KOS="$CACHE/oracle-tools/bin/koscmp"
OUT="${1:-/tmp/rex-kos-diff}"
source "$REPO/scripts/rex_profiles/codecs/common/sandbox.sh"

KOSPIN_SHA="a74c92957eccf9c1e5143167af9d6d98b2ce087aed8fe10d50b1f9c016373ea3"
KOSPIN_COMMIT="72c6df405a75d322c5b3722da46c3abb864d3793"

if [ ! -x "$KOS" ]; then echo "SKIP: oráculo ausente ($KOS). Instale via scripts/rex_profiles/codecs/setup-oracles.sh"; exit 3; fi
got_sha="$(sha256sum "$KOS" | cut -d' ' -f1)"
if [ "$got_sha" != "$KOSPIN_SHA" ]; then echo "ABORT: koscmp divergiu do pin: $got_sha != $KOSPIN_SHA"; exit 4; fi
got_commit="$(git -C "$CACHE/references/mdcomp" rev-parse HEAD)"
if [ "$got_commit" != "$KOSPIN_COMMIT" ]; then echo "ABORT: checkout mdcomp divergiu do pin: $got_commit"; exit 4; fi

PERFIL="$REPO/data/rex_profiles/codec/kosinski"
RUNTIME="$REPO/data/rex_profiles/kosinski_runtime"
mkdir -p "$OUT"
ROWS="$OUT/differential.tsv"
printf 'caso\tpapel\toraculo_rc\trust_rc\tcomparacao\tdetalhe\n' > "$ROWS"

cargo build --release --manifest-path "$REPO/crates/rex-kosinski/Cargo.toml" --example decode >/dev/null || { echo "build rust falhou"; exit 1; }
BIN="$REPO/crates/rex-kosinski/target/release/examples/decode"

sha() { sha256sum "$1" | cut -d' ' -f1; }
line() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$@" | tee -a "$ROWS"; }
kos()    { run_oracle 60 "$2"   -- "$KOS" "$1" "$2" </dev/null >/dev/null 2>&1; }
kosx()   { run_oracle 60 "$2"   -- "$KOS" -x "$1" "$2" </dev/null >/dev/null 2>&1; }
rust()   { "$BIN" "$1" "$2" >/dev/null 2>&1; }

ok=0; bad=0
check_eq() { # caso papel orc_rc rust_rc arq1 arq2
  local caso="$1" papel="$2" orc_rc="$3" rust_rc="$4" a="$5" b="$6"
  if [ -s "$a" ] && [ -s "$b" ] && cmp -s "$a" "$b"; then
    line "$caso" "$papel" "$orc_rc" "$rust_rc" "IGUAL(bytes)" "$(sha "$a")"; ok=$((ok+1))
  elif [ -f "$a" ] && [ ! -s "$a" ] && [ -f "$b" ] && [ ! -s "$b" ]; then
    line "$caso" "$papel" "$orc_rc" "$rust_rc" "AMBAS-VAZIAS" "-"; ok=$((ok+1))
  else
    line "$caso" "$papel" "$orc_rc" "$rust_rc" "DIVERGE" "$(sha "$a" 2>/dev/null || echo -)|$(sha "$b" 2>/dev/null || echo -)"; bad=$((bad+1))
  fi
}

# 1) goldens: oráculo vs espera publicada vs Rust (bytes completos)
for f in "$PERFIL"/golden/*.kos; do
  name="$(basename "$f" .kos)"
  exp="$PERFIL/golden/$name.expected.bin"
  orc="$OUT/$name.oracle.bin"; rs="$OUT/$name.rust.bin"; rm -f "$orc" "$rs"
  orc_rc=0; kosx "$f" "$orc" || orc_rc=$?
  if [ "$name" = "m02_single_with_eod" ]; then
    # exceção registrada: oráculo ACEITA por exaustão; produto dá truncated.
    rust_rc=0; rust "$f" "$rs" || rust_rc=$?
    line "$name" "golden-excecao-contratual" "$orc_rc" "$rust_rc" "ORACULO-ACEITA-PRODUTO-RECUSA" "orc=$(sha "$orc" 2>/dev/null || echo vazio) exp=$(sha "$exp")"
    if [ "$rust_rc" = 1 ]; then ok=$((ok+1)); else bad=$((bad+1)); fi
    continue
  fi
  rust_rc=0; rust "$f" "$rs" || rust_rc=$?
  check_eq "$name-oraculo-vs-espera" "golden" "$orc_rc" "-" "$orc" "$exp"
  check_eq "$name-rust-vs-espera" "golden" "-" "$rust_rc" "$rs" "$exp"
done

# 2) plains: re-encode do oráculo reproduz a stream publicada? saída dos dois == plain?
for f in "$PERFIL"/plain/*.bin; do
  name="$(basename "$f" .bin)"
  pub="$PERFIL/plain/$name.kos"
  enc="$OUT/$name.reencode.kos"; rm -f "$enc"
  enc_rc=0; kos "$f" "$enc" || enc_rc=$?
  if [ -s "$enc" ] && cmp -s "$enc" "$pub"; then
    line "$name-reencode" "plain-encode" "$enc_rc" "-" "IGUAL(bytes)" "$(sha "$pub")"; ok=$((ok+1))
  else
    line "$name-reencode" "plain-encode" "$enc_rc" "-" "DIVERGE" "$(sha "$enc" 2>/dev/null||echo -)|$(sha "$pub")"; bad=$((bad+1))
  fi
  orcd="$OUT/$name.oracle.out"; rsd="$OUT/$name.rust.out"; rm -f "$orcd" "$rsd"
  orc_rc=0; kosx "$pub" "$orcd" || orc_rc=$?
  rust_rc=0; rust "$pub" "$rsd" || rust_rc=$?
  check_eq "$name-oraculo-vs-plain" "plain-decode" "$orc_rc" "-" "$orcd" "$f"
  check_eq "$name-rust-vs-plain" "plain-decode" "-" "$rust_rc" "$rsd" "$f"
done

# 3) fixture autoral da missão: confirmação externa da espera derivada do contrato
st="$RUNTIME/overlap_echo.kos"; exp="$RUNTIME/overlap_echo.expected.bin"
orc_rc=0; kosx "$st" "$OUT/overlap_echo.oracle.bin" || orc_rc=$?
rust_rc=0; rust "$st" "$OUT/overlap_echo.rust.bin" || rust_rc=$?
check_eq "overlap_echo-oraculo-vs-espera" "runtime" "$orc_rc" "-" "$OUT/overlap_echo.oracle.bin" "$exp"
check_eq "overlap_echo-rust-vs-espera" "runtime" "-" "$rust_rc" "$OUT/overlap_echo.rust.bin" "$exp"

# 4) k05 com limite suficiente: stream bem-formada — oráculo produz os mesmos bytes
orc_rc=0; kosx "$PERFIL/negative/k05_excessive_output.kos" "$OUT/k05.oracle.bin" || orc_rc=$?
rust_rc=0; rust "$PERFIL/negative/k05_excessive_output.kos" "$OUT/k05.rust.bin" || rust_rc=$?
check_eq "k05-bem-formada-oraculo-vs-rust" "limites" "$orc_rc" "$rust_rc" "$OUT/k05.oracle.bin" "$OUT/k05.rust.bin"

# 5) sondas de defeito da referência (DIAGNÓSTICO — o produto NÃO herda):
m5="$PERFIL/golden/m05_separate_long_far.kos"
head -c $(( $(stat -c%s "$m5") - 1 )) "$m5" > "$OUT/m05-minus1.kos"
rm -f "$OUT/m05-minus1.oracle.bin" "$OUT/m05-minus1.rust.bin"
orc_rc=0; kosx "$OUT/m05-minus1.kos" "$OUT/m05-minus1.oracle.bin" || orc_rc=$?
rust_rc=0; rust "$OUT/m05-minus1.kos" "$OUT/m05-minus1.rust.bin" || rust_rc=$?
line "m05-1B-truncado" "sonda-defeito" "$orc_rc" "$rust_rc" "ORACULO-ACEITA-PRODUTO-RECUSA" "orc_len=$(stat -c%s "$OUT/m05-minus1.oracle.bin" 2>/dev/null || echo 0) esperado_recusado"
printf '\x02\x00\xff\xff' > "$OUT/probe-0200ffff.kos"
rm -f "$OUT/probe-0200ffff.oracle.bin" "$OUT/probe-0200ffff.rust.bin"
orc_rc=0; kosx "$OUT/probe-0200ffff.kos" "$OUT/probe-0200ffff.oracle.bin" || orc_rc=$?
rust_rc=0; rust "$OUT/probe-0200ffff.kos" "$OUT/probe-0200ffff.rust.bin" || rust_rc=$?
line "ref-antes-historico" "sonda-defeito" "$orc_rc" "$rust_rc" "ORACULO-NAO-VALIDA-PRODUTO-RECUSA" "orc_len=$(stat -c%s "$OUT/probe-0200ffff.oracle.bin" 2>/dev/null || echo 0)"

echo
echo "TOTAIS: conformes=$ok divergentes=$bad  (tsv: $ROWS)"
if [ "$bad" != 0 ]; then exit 1; fi
# conformes: 19 goldens (9x2 + m02) + 36 plains (12x3) + 2 runtime + 1 k05 = 58
# (as 2 sondas de defeito são registradas, não contam como conformidade)
if [ "$ok" != 58 ]; then echo "ATENCAO: contagem de conformes difere da esperada (58) — revisar suite nova?"; fi
exit 0
