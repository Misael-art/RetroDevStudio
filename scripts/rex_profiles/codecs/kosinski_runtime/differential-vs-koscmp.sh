#!/usr/bin/env bash
# MODO DIFERENCIAL (documentado, separado da suíte normal do pacote):
# compara o decodificador Rust `crates/rex-kosinski` byte a byte com o oráculo
# externo mdcomp `koscmp` (LGPL-3.0 — FERRAMENTA EXTERNA, nada transplantado)
# sobre TODAS as streams do perfil Kosinski + fixtures da missão.
#
# TABELA AUDITÁVEL (revisão PR #81, item 3, 2026-09-27) — cada linha traz:
#   caso | categoria | entrada_sha256 | esperado | oraculo | produto |
#   veredito | justificativa
# Vereditos:
#   PARIDADE                  — oráculo E produto reproduzem a espera; cotado.
#   DIVERGENCA-CONTRATUAL     — recusa deliberada do produto registrada no
#                               CONTRACT §4 (exceção do oráculo); NÃO cotada
#                               como paridade positiva; falha se o produto
#                               deixar de recusar exatamente como fixado.
#   SONDA-DEFEITO-NAO-COTADA  — demonstração de defeito da referência;
#                               NUNCA contada como paridade.
#   DIVERGE                   — qualquer outro resultado = falha do script.
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
printf 'caso\tcategoria\tentrada_sha256\tesperado\toraculo\tproduto\tveredito\tjustificativa\n' > "$ROWS"

cargo build --release --manifest-path "$REPO/crates/rex-kosinski/Cargo.toml" --example decode >/dev/null || { echo "build rust falhou"; exit 1; }
BIN="$REPO/crates/rex-kosinski/target/release/examples/decode"

sha()   { sha256sum "$1" | cut -d' ' -f1; }
line()  { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" | tee -a "$ROWS"; }
kosx()  { run_oracle 60 "$2" -- "$KOS" -x "$1" "$2" </dev/null >/dev/null 2>&1; }
kosenc(){ run_oracle 60 "$2" -- "$KOS"   "$1" "$2" </dev/null >/dev/null 2>&1; }
rustr() { "$BIN" "$1" "$2" 2>"$OUT/rust.err" >/dev/null; }
# coluna de resultado: rc + sha do arquivo de saida (ou 'sem-arquivo')
res()   { local rc="$1" f="$2" errf="${3:-}"; local e=""; [ -n "$errf" ] && [ -s "$errf" ] && e=" $(head -c 120 "$errf" | tr '\t\n' '  ' | sed 's/[[:space:]]\+$//')"; local s="rc=$rc"; if [ -f "$f" ]; then s="$s sha=$(sha "$f")"; else s="$s sem-arquivo"; fi; s="$s$e"; printf '%s' "$s" | sed 's/[[:space:]]\+$//'; }

par=0; contratual=0; sonda=0; bad=0

# ---- 1) goldens: espera publicada (oráculo confirmou na rodada do perfil);
#         oráculo E produto devem bater a espera byte a byte.
for f in "$PERFIL"/golden/*.kos; do
  name="$(basename "$f" .kos)"
  exp="$PERFIL/golden/$name.expected.bin"
  orc="$OUT/$name.oracle.bin"; rs="$OUT/$name.rust.bin"; rm -f "$orc" "$rs"
  orc_rc=0; kosx "$f" "$orc" || orc_rc=$?
  rust_rc=0; rustr "$f" "$rs" || rust_rc=$?
  ocol="$(res "$orc_rc" "$orc")"; pcol="$(res "$rust_rc" "$rs" "$OUT/rust.err")"
  if [ "$name" = "m02_single_with_eod" ]; then
    # exceção registrada no CONTRACT §4: oráculo aceita por exaustão (sem
    # terminator); produto DEVE recusar com Truncated. NAO e paridade.
    if grep -q "erro Truncated" "$OUT/rust.err"; then
      line "$name" "golden-excecao" "$(sha "$f")" "produto=Truncated; oraculo aceita" "$ocol" "$pcol" "DIVERGENCA-CONTRATUAL" "CONTRACT sec4 linha 1 (aceitacao por exaustao do oraculo; recusa estruturada do produto)"
      contratual=$((contratual+1))
    else
      line "$name" "golden-excecao" "$(sha "$f")" "produto=Truncated" "$ocol" "$pcol" "DIVERGE" "produto nao recusou como o contrato fixa"
      bad=$((bad+1))
    fi
    continue
  fi
  if [ -f "$orc" ] && [ -f "$rs" ] && cmp -s "$orc" "$exp" && cmp -s "$rs" "$exp"; then
    line "$name" "golden" "$(sha "$f")" "sha=$(sha "$exp")" "$ocol" "$pcol" "PARIDADE" "ambos reproduzem a espera publicada"
    par=$((par+1))
  else
    line "$name" "golden" "$(sha "$f")" "sha=$(sha "$exp")" "$ocol" "$pcol" "DIVERGE" "oraculo ou produto difere da espera"
    bad=$((bad+1))
  fi
done

# ---- 2a) plains: re-encode do oráculo deve reproduzir a stream publicada.
#          (produto nao tem encoder — escopo; coluna produto documenta)
for f in "$PERFIL"/plain/*.bin; do
  name="$(basename "$f" .bin)"
  pub="$PERFIL/plain/$name.kos"
  enc="$OUT/$name.reencode.kos"; rm -f "$enc"
  enc_rc=0; kosenc "$f" "$enc" || enc_rc=$?
  if [ -f "$enc" ] && cmp -s "$enc" "$pub"; then
    line "$name-reencode" "plain-encode" "$(sha "$f")" "sha=$(sha "$pub")" "$(res "$enc_rc" "$enc")" "SEM-ENCODER (fora de escopo)" "PARIDADE" "paridade contra a espera = stream publicada (encoder do produto nao faz parte desta entrega)"
    par=$((par+1))
  else
    line "$name-reencode" "plain-encode" "$(sha "$f")" "sha=$(sha "$pub")" "$(res "$enc_rc" "$enc")" "SEM-ENCODER (fora de escopo)" "DIVERGE" "reencode nao reproduziu a stream"
    bad=$((bad+1))
  fi
done

# ---- 2b) plains decode: espera = plain.bin original; oráculo E produto.
for f in "$PERFIL"/plain/*.bin; do
  name="$(basename "$f" .bin)"
  pub="$PERFIL/plain/$name.kos"
  orcd="$OUT/$name.oracle.out"; rsd="$OUT/$name.rust.out"; rm -f "$orcd" "$rsd"
  orc_rc=0; kosx "$pub" "$orcd" || orc_rc=$?
  rust_rc=0; rustr "$pub" "$rsd" || rust_rc=$?
  if [ -f "$orcd" ] && [ -f "$rsd" ] && cmp -s "$orcd" "$f" && cmp -s "$rsd" "$f"; then
    line "$name-decode" "plain-decode" "$(sha "$pub")" "sha=$(sha "$f")" "$(res "$orc_rc" "$orcd")" "$(res "$rust_rc" "$rsd" "$OUT/rust.err")" "PARIDADE" "roundtrip completo do oráculo; produto reproduz os dois"
    par=$((par+1))
  else
    line "$name-decode" "plain-decode" "$(sha "$pub")" "sha=$(sha "$f")" "$(res "$orc_rc" "$orcd")" "$(res "$rust_rc" "$rsd" "$OUT/rust.err")" "DIVERGE" "saida difere do plain"
    bad=$((bad+1))
  fi
done

# ---- 3) fixtures autorais: espera derivada do CONTRATO (nunca do decoder);
#         oráculo confirma por fora.
confirm_runtime() { # nome stream exp esperado_txt
  local name="$1" st="$2" exp="$3" just="$4"
  local orc="$OUT/$name.oracle.bin" rs="$OUT/$name.rust.bin"
  rm -f "$orc" "$rs"
  local orc_rc=0 rust_rc=0
  kosx "$st" "$orc" || orc_rc=$?
  rustr "$st" "$rs" || rust_rc=$?
  if [ -f "$orc" ] && [ -f "$rs" ] && cmp -s "$orc" "$exp" && cmp -s "$rs" "$exp"; then
    line "$name" "runtime" "$(sha "$st")" "sha=$(sha "$exp")" "$(res "$orc_rc" "$orc")" "$(res "$rust_rc" "$rs" "$OUT/rust.err")" "PARIDADE" "$just"
    par=$((par+1))
  else
    line "$name" "runtime" "$(sha "$st")" "sha=$(sha "$exp")" "$(res "$orc_rc" "$orc")" "$(res "$rust_rc" "$rs" "$OUT/rust.err")" "DIVERGE" "oraculo ou produto difere da espera do contrato"
    bad=$((bad+1))
  fi
}
confirm_runtime "overlap_echo" "$RUNTIME/overlap_echo.kos" "$RUNTIME/overlap_echo.expected.bin" "eco sobreposto; espera autoral derivada do contrato, confirmada pelo oráculo"

confirm_runtime "limite_probe" "$RUNTIME/limite_probe.kos" "$RUNTIME/limite_probe.expected.bin" "copia len=256 dist=1 (eco) - espera derivada da gramatica do contrato (CONTRACT sec2), confirmada pelo oraculo; exercita enforcement de limites no teste limites_cortam_durante_a_copia_larga_nao_so_no_fim"

# ---- 4) k05 com limite suficiente: stream BEM-FORMADA de 512 bytes de saida;
#         espera fixada pela evidencia (sha abaixo); paridade oraculo<->produto.
K05_PIN="110009dcee21620b166f3abfecb5eff7a873be729d1c2d53822e7acc5f34eb9b"
st="$PERFIL/negative/k05_excessive_output.kos"
orc="$OUT/k05.oracle.bin"; rs="$OUT/k05.rust.bin"; rm -f "$orc" "$rs"
orc_rc=0; kosx "$st" "$orc" || orc_rc=$?
rust_rc=0; rustr "$st" "$rs" || rust_rc=$?
if [ -f "$orc" ] && [ -f "$rs" ] && [ "$(sha "$orc")" = "$K05_PIN" ] && [ "$(sha "$rs")" = "$K05_PIN" ]; then
  line "k05-bem-formada" "limites" "$(sha "$st")" "sha=$K05_PIN (pin desta evidencia)" "$(res "$orc_rc" "$orc")" "$(res "$rust_rc" "$rs" "$OUT/rust.err")" "PARIDADE" "sem max_apertado os 512 bytes batem o pin; recusas com max_out=16 vivem na suíte de testes (sem oraculo)"
  par=$((par+1))
else
  line "k05-bem-formada" "limites" "$(sha "$st")" "sha=$K05_PIN" "$(res "$orc_rc" "$orc")" "$(res "$rust_rc" "$rs" "$OUT/rust.err")" "DIVERGE" "saida difere do pin"
  bad=$((bad+1))
fi

# ---- 5) sondas de defeito da referência — DIAGNÓSTICO, NUNCA paridade.
#         (revisão PR #81 item 3: não cotadas como conformidade)
m5="$PERFIL/golden/m05_separate_long_far.kos"
head -c $(( $(stat -c%s "$m5") - 1 )) "$m5" > "$OUT/m05-minus1.kos"
rm -f "$OUT/m05-minus1.oracle.bin" "$OUT/m05-minus1.rust.bin"
orc_rc=0; kosx "$OUT/m05-minus1.kos" "$OUT/m05-minus1.oracle.bin" || orc_rc=$?
rust_rc=0; rustr "$OUT/m05-minus1.kos" "$OUT/m05-minus1.rust.bin" || rust_rc=$?
if grep -q "erro Truncated" "$OUT/rust.err"; then
  line "sonda-m05-1B-truncado" "sonda-defeito" "$(sha "$OUT/m05-minus1.kos")" "produto=Truncated (CONTRACT sec4); defeito do oraculo documentado" "$(res "$orc_rc" "$OUT/m05-minus1.oracle.bin")" "$(res "$rust_rc" "$OUT/m05-minus1.rust.bin" "$OUT/rust.err")" "SONDA-DEFEITO-NAO-COTADA" "oraculo ACEITAVA stream truncada com saida maior (8692>8451, medido); produto recusa; NAO conta como paridade"
  sonda=$((sonda+1))
else
  line "sonda-m05-1B-truncado" "sonda-defeito" "$(sha "$OUT/m05-minus1.kos")" "produto=Truncated" "$(res "$orc_rc" "$OUT/m05-minus1.oracle.bin")" "$(res "$rust_rc" "$OUT/m05-minus1.rust.bin" "$OUT/rust.err")" "DIVERGE" "produto deixou de recusar truncamento"
  bad=$((bad+1))
fi
printf '\x02\x00\xff\xff' > "$OUT/probe-0200ffff.kos"
rm -f "$OUT/probe-0200ffff.oracle.bin" "$OUT/probe-0200ffff.rust.bin"
orc_rc=0; kosx "$OUT/probe-0200ffff.kos" "$OUT/probe-0200ffff.oracle.bin" || orc_rc=$?
rust_rc=0; rustr "$OUT/probe-0200ffff.kos" "$OUT/probe-0200ffff.rust.bin" || rust_rc=$?
if grep -q "erro InvalidReference" "$OUT/rust.err"; then
  line "sonda-ref-antes-historico" "sonda-defeito" "$(sha "$OUT/probe-0200ffff.kos")" "produto=InvalidReference (CONTRACT sec4); defeito do oraculo documentado" "$(res "$orc_rc" "$OUT/probe-0200ffff.oracle.bin")" "$(res "$rust_rc" "$OUT/probe-0200ffff.rust.bin" "$OUT/rust.err")" "SONDA-DEFEITO-NAO-COTADA" "oraculo nao valida historico (seekg invalido; rc=0/0 bytes medidos); produto recusa; NAO conta como paridade"
  sonda=$((sonda+1))
else
  line "sonda-ref-antes-historico" "sonda-defeito" "$(sha "$OUT/probe-0200ffff.kos")" "produto=InvalidReference" "$(res "$orc_rc" "$OUT/probe-0200ffff.oracle.bin")" "$(res "$rust_rc" "$OUT/probe-0200ffff.rust.bin" "$OUT/rust.err")" "DIVERGE" "produto deixou de recusar referencia invalida"
  bad=$((bad+1))
fi

echo
echo "TOTAIS: paridade=$par divergencia-contratual-esperada=$contratual sondas-nao-cotadas=$sonda DIVERGE(inaceitavel)=$bad  (tsv: $ROWS)"
if [ "$bad" != 0 ]; then exit 1; fi
# Esperado (esta suite): 36 PARIDADE = 9 goldens bem-formados + 12 plain-encode
# + 12 plain-decode + 2 runtime (overlap_echo, limite_probe) + 1 k05;
# 1 DIVERGENCA-CONTRATUAL (m02); 2 SONDA-DEFEITO (nao cotadas). Total = 39.
if [ "$par" != 36 ] || [ "$contratual" != 1 ] || [ "$sonda" != 2 ]; then
  echo "ATENCAO: contagens divergem do esperado (paridade=36, contratual=1, sondas=2) — revisar suite nova?"; exit 2;
fi
exit 0
