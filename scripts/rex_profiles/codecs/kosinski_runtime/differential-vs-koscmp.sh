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
#   CONTROLE-CORRUPCAO        — stream do PRODUTO mutada de forma
#                               determinística; prova de que a comparação de
#                               conteúdo completo detecta erro (a) e de que o
#                               produto recusa estruturalmente o que o oráculo
#                               engole (b). NUNCA cotada como paridade.
#   DIVERGE                   — qualquer outro resultado = falha do script.
#
# DIREÇÕES COBERTAS (ETAPA 3 da missão de codificação, 2026-09-27):
#   A (herdada): streams de referência/autorais → decode do produto e do
#      oráculo, conteúdo completo comparado.
#   B (nova):    plains autorais → ENCODE do produto → DECODE do oráculo
#      (`koscmp -x`), conteúdo completo comparado com o plain (nunca só
#      prefixo/hashes parciais). Inclui vazio, fronteiras de descritor
#      (15_lit estraddle e forma 14-mod-16 com placeholder do terminator),
#      eco, refs curtas/longas, pouco compressível e repetitivo.
#   Tabela de tamanhos produto vs oráculo (sizes.tsv) para os 12 plains.
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

cargo build --release --manifest-path "$REPO/crates/rex-kosinski/Cargo.toml" --examples >/dev/null || { echo "build rust falhou"; exit 1; }
BIN="$REPO/crates/rex-kosinski/target/release/examples/decode"
BIN_ENC="$REPO/crates/rex-kosinski/target/release/examples/encode"

sha()   { sha256sum "$1" | cut -d' ' -f1; }
line()  { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" | tee -a "$ROWS"; }
kosx()  { run_oracle 60 "$2" -- "$KOS" -x "$1" "$2" </dev/null >/dev/null 2>&1; }
kosenc(){ run_oracle 60 "$2" -- "$KOS"   "$1" "$2" </dev/null >/dev/null 2>&1; }
rustr() { "$BIN" "$1" "$2" 2>"$OUT/rust.err" >/dev/null; }
# coluna de resultado: rc + sha do arquivo de saida (ou 'sem-arquivo')
res()   { local rc="$1" f="$2" errf="${3:-}"; local e=""; [ -n "$errf" ] && [ -s "$errf" ] && e=" $(head -c 120 "$errf" | tr '\t\n' '  ' | sed 's/[[:space:]]\+$//')"; local s="rc=$rc"; if [ -f "$f" ]; then s="$s sha=$(sha "$f")"; else s="$s sem-arquivo"; fi; s="$s$e"; printf '%s' "$s" | sed 's/[[:space:]]\+$//'; }

par=0; contratual=0; sonda=0; corr=0; bad=0

# patch byte isolado (determinístico): file, offset decimal, hex novo, saida
patchbyte() { local f="$1" off="$2" hex="$3" o="$4"
  { head -c "$off" "$f"; printf "\x$hex"; tail -c "+$((off + 2))" "$f"; } > "$o"; }

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
#          (linha herdada da entrega do decoder; o encoder do produto e
#          coberto pela DIRECAO B em §6 — aqui a espera e a stream publicada)
for f in "$PERFIL"/plain/*.bin; do
  name="$(basename "$f" .bin)"
  pub="$PERFIL/plain/$name.kos"
  enc="$OUT/$name.reencode.kos"; rm -f "$enc"
  enc_rc=0; kosenc "$f" "$enc" || enc_rc=$?
  if [ -f "$enc" ] && cmp -s "$enc" "$pub"; then
    line "$name-reencode" "plain-encode" "$(sha "$f")" "sha=$(sha "$pub")" "$(res "$enc_rc" "$enc")" "N/A (espera = stream publicada; produto em §6)" "PARIDADE" "paridade contra a espera = stream publicada (linha herdada da etapa do decoder)"
    par=$((par+1))
  else
    line "$name-reencode" "plain-encode" "$(sha "$f")" "sha=$(sha "$pub")" "$(res "$enc_rc" "$enc")" "N/A (espera = stream publicada; produto em §6)" "DIVERGE" "reencode nao reproduziu a stream"
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

# ---- 6) DIRECAO B (ETAPA 3): stream do PRODUTO -> decode do ORACULO,
#         comparacao de conteudo COMPLETO com o plain autoral.
#         Cobertura: 12 plains do perfil (inclui vazio, single, pseudo-
#         aleatorio pouco compressivel, zeros/eco longo, janela distante)
#         + 3 fixtures autorais encdir (estraddle 15 lit, forma 14-mod-16
#         com placeholder do terminator, separado count3 real).
encdir_produto() { # plain -> $OUT/<nome>.prod.kos ; rc 0 se ok
  local plain="$1" out="$2"
  "$BIN_ENC" "$plain" "$out" >/dev/null 2>"$OUT/enc.err"
}
prodrow() { # nome plain esperacao_txt
  local name="$1" plain="$2" just="$3"
  local pst="$OUT/$name.prod.kos" orc="$OUT/$name.prodb.oracle.bin" rs="$OUT/$name.prodb.rust.bin"
  rm -f "$pst" "$orc" "$rs"
  if ! encdir_produto "$plain" "$pst"; then
    line "$name-produto" "produto-stream-oraculo" "sem-stream" "-" "encode-falhou: $(head -c 80 "$OUT/enc.err")" "-" "DIVERGE" "encoder do produto recusou plain autoral valido"
    bad=$((bad+1)); return
  fi
  local orc_rc=0 rust_rc=0
  kosx "$pst" "$orc" || orc_rc=$?
  rustr "$pst" "$rs" || rust_rc=$?
  if [ -f "$orc" ] && [ -f "$rs" ] && cmp -s "$orc" "$plain" && cmp -s "$rs" "$plain"; then
    line "$name-produto" "produto-stream-oraculo" "$(sha "$pst")" "sha=$(sha "$plain")" "$(res "$orc_rc" "$orc")" "$(res "$rust_rc" "$rs" "$OUT/rust.err")" "PARIDADE" "$just (stream do produto decodificada pelo oraculo com conteudo completo igual ao plain)"
    par=$((par+1))
  else
    line "$name-produto" "produto-stream-oraculo" "$(sha "$pst")" "sha=$(sha "$plain")" "$(res "$orc_rc" "$orc")" "$(res "$rust_rc" "$rs" "$OUT/rust.err")" "DIVERGE" "saida do oraculo ou do produto difere do plain"
    bad=$((bad+1))
  fi
}
for f in "$PERFIL"/plain/*.bin; do
  name="$(basename "$f" .bin)"
  prodrow "$name" "$f" "direcao B do plain do perfil"
done
for f in "$RUNTIME"/encdir/*.bin; do
  name="$(basename "$f" .bin)"
  prodrow "$name" "$f" "direcao B da fronteira/shape autoral"
done

# ---- 6b) tabela de tamanhos produto vs encoder de referencia (ETAPA 5);
#          nao contada como paridade — diagnostico cotavel no REPORT.
SIZES="$OUT/sizes.tsv"
printf 'caso\tplain_len\toraculo_stream_len\tproduto_stream_len\tdelta\tproduto_menor\n' > "$SIZES"
for f in "$PERFIL"/plain/*.bin "$RUNTIME"/encdir/*.bin; do
  name="$(basename "$f" .bin)"
  o_size="-"; p_size="-"
  [ -f "$OUT/$name.reencode.kos" ] && o_size="$(stat -c%s "$OUT/$name.reencode.kos")"
  [ -f "$OUT/$name.prod.kos" ] && p_size="$(stat -c%s "$OUT/$name.prod.kos")"
  delta="-"; menor="-"
  if [ "$o_size" != "-" ] && [ "$p_size" != "-" ]; then
    delta=$((p_size - o_size)); [ "$delta" -lt 0 ] && menor=sim || menor=nao
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$(stat -c%s "$f")" "$o_size" "$p_size" "$delta" "$menor" | tee -a "$SIZES"
done

# ---- 7) controles de corrupcao deterministicos sobre streams DO PRODUTO
#         (missao de codificacao, ETAPA 3: um que produz saida ERRADA
#         detectada por fora; um recusado ESTRUTURALMENTE pelo produto).
# (a) literais: `lit14_mod16` tem layout exato pinado na suite (FF BF + 14
#     literais + placeholder 00 00 + 00 F0 00). Mutar o 1o byte de dado
#     (offset 2, 41 -> 7A) da saida ERRADA identica nos dois leitores; a
#     comparacao de conteudo completo com o plain detecta o erro por fora.
stA="$OUT/lit14_mod16.prod.kos"; wantA="$OUT/controle-a.want"; rm -f "$wantA"
{ printf '\xff\xbf'; printf 'ABCDEFGHIJKLMN'; printf '\x00\x00\x00\xf0\x00'; } > "$wantA"
if cmp -s "$stA" "$wantA"; then
  badA="$OUT/controle-a.kos"; patchbyte "$stA" 2 7a "$badA"
  oA="$OUT/controle-a.oracle.bin"; rA="$OUT/controle-a.rust.bin"; rm -f "$oA" "$rA"
  orc_rc=0; kosx "$badA" "$oA" || orc_rc=$?
  rust_rc=0; rustr "$badA" "$rA" || rust_rc=$?
  plainA="$RUNTIME/encdir/lit14_mod16.bin"
  if [ -f "$oA" ] && [ -f "$rA" ] && cmp -s "$oA" "$rA" && ! cmp -s "$oA" "$plainA"; then
    line "controle-a-literais-corrompidos" "controle-corrupcao" "$(sha "$badA")" "ambos=errado e identico; != sha(plain) $(sha "$plainA")" "$(res "$orc_rc" "$oA")" "$(res "$rust_rc" "$rA" "$OUT/rust.err")" "CONTROLE-CORRUPCAO" "mutacao de byte de dado NAO e detectavel por decoder fiel; a comparacao de conteudo completo com a espera detecta (fora do decoder) — prova de que a paridade da direcao B e nao-vacia"
    corr=$((corr+1))
  else
    line "controle-a-literais-corrompidos" "controle-corrupcao" "$(sha "$badA")" "ambos errados identicos, != plain" "$(res "$orc_rc" "$oA")" "$(res "$rust_rc" "$rA" "$OUT/rust.err")" "DIVERGE" "controle-a nao produziu o padrao esperado de erro detectavel"
    bad=$((bad+1))
  fi
else
  line "controle-a-literais-corrompidos" "controle-corrupcao" "$(sha "$stA" 2>/dev/null)" "layout FF BF + 14 lit + 00 00 + 00 F0 00" "-" "-" "DIVERGE" "stream do produto divergiu do layout pinado — encoder mudou sem atualizar o controle"
  bad=$((bad+1))
fi
# (b) referencia: `sep_pair` tem layout exato pinado (FF 0A + 8 lit + F8 FE
#     + 00 F0 00). Mutar Low F8->00 da dist=256 > historico (16 bytes):
#     o produto DEVE recusar InvalidReference; o oraculo engole (medido).
stB="$OUT/sep_pair.prod.kos"; wantB="$OUT/controle-b.want"; rm -f "$wantB"
{ printf '\xff\x0a'; printf 'ABCDEFGH'; printf '\xf8\xfe\x00\xf0\x00'; } > "$wantB"
if cmp -s "$stB" "$wantB"; then
  badB="$OUT/controle-b.kos"; patchbyte "$stB" 10 00 "$badB"
  oB="$OUT/controle-b.oracle.bin"; rB="$OUT/controle-b.rust.bin"; rm -f "$oB" "$rB"
  orc_rc=0; kosx "$badB" "$oB" || orc_rc=$?
  rust_rc=0; rustr "$badB" "$rB" || rust_rc=$?
  if grep -q "erro InvalidReference" "$OUT/rust.err" && { [ ! -f "$oB" ] || ! cmp -s "$oB" "$RUNTIME/encdir/sep_pair.bin"; }; then
    line "controle-b-ref-corrompida" "controle-corrupcao" "$(sha "$badB")" "produto=InvalidReference; oraculo engole (saida != plain ou incompleta)" "$(res "$orc_rc" "$oB")" "$(res "$rust_rc" "$rB" "$OUT/rust.err")" "CONTROLE-CORRUPCAO" "recusa estrutural do produto sobre stream corrompida do proprio produto; contraste com a tolerancia do oraculo registrada em CONTRACT sec4; NAO conta como paridade"
    corr=$((corr+1))
  else
    line "controle-b-ref-corrompida" "controle-corrupcao" "$(sha "$badB")" "produto=InvalidReference" "$(res "$orc_rc" "$oB")" "$(res "$rust_rc" "$rB" "$OUT/rust.err")" "DIVERGE" "produto deixou de recusar a referencia corrompida"
    bad=$((bad+1))
  fi
else
  line "controle-b-ref-corrompida" "controle-corrupcao" "$(sha "$stB" 2>/dev/null)" "layout FF 0A + 8 lit + F8 FE + 00 F0 00" "-" "-" "DIVERGE" "stream do produto divergiu do layout pinado — encoder mudou sem atualizar o controle"
  bad=$((bad+1))
fi

# ---- 8) ciclo de EDIÇÃO autoral (ETAPA 4/5): exemplo executável produz
#         host_v0/host_v1 + slot re-inserido; o oraculo confirma por fora o
#         conteudo editado (decode do slot, conteudo completo) e os vizinhos
#         sao comparados byte a byte.
cargo build --release --manifest-path "$REPO/crates/rex-kosinski/Cargo.toml" --example edit_cycle >/dev/null || { echo "build edit_cycle falhou"; exit 1; }
EDD="$OUT/edit"; rm -rf "$EDD"; mkdir -p "$EDD"
"$REPO/crates/rex-kosinski/target/release/examples/edit_cycle" "$EDD" >"$EDD/cycle.log" 2>&1
if [ ! -s "$EDD/edited_slot.kos" ]; then
  line "edicao-ciclo" "edicao" "-" "koscmp -x slot editado == edited_plain" "edit_cycle falhou: $(head -c 100 "$EDD/cycle.log")" "-" "DIVERGE" "exemplo de ciclo nao produziu artefatos"
  bad=$((bad+1))
else
  edout="$EDD/edited_slot.oracle.bin"; rm -f "$edout"
  ed_rc=0; kosx "$EDD/edited_slot.kos" "$edout" || ed_rc=$?
  if [ -f "$edout" ] && cmp -s "$edout" "$EDD/edited_plain.expect"; then
    line "edicao-ciclo-slot-externo" "edicao" "$(sha "$EDD/edited_slot.kos")" "sha=$(sha "$EDD/edited_plain.expect")" "$(res "$ed_rc" "$edout")" "N/A (decode externo e a prova)" "PARIDADE" "conteudo editado confirmado pelo ORACULO a partir do slot re-inserido pelo produto (plain -> stream -> decode -> edicao delimitada -> recompressao -> decode externo)"
    par=$((par+1))
  else
    line "edicao-ciclo-slot-externo" "edicao" "$(sha "$EDD/edited_slot.kos")" "sha=$(sha "$EDD/edited_plain.expect")" "$(res "$ed_rc" "$edout")" "-" "DIVERGE" "oraculo nao reproduziu o conteudo editado esperado"
    bad=$((bad+1))
  fi
  # vizinhos: 4096 B antes + 4096 B depois do contêiner (definidos no exemplo)
  nb_ok=1
  head -c 4096 "$EDD/host_v0.bin" > "$EDD/n.pre0"; head -c 4096 "$EDD/host_v1.bin" > "$EDD/n.pre1"
  tail -c 4096 "$EDD/host_v0.bin" > "$EDD/n.post0"; tail -c 4096 "$EDD/host_v1.bin" > "$EDD/n.post1"
  [ "$(stat -c%s "$EDD/host_v0.bin")" = "$(stat -c%s "$EDD/host_v1.bin")" ] || nb_ok=0
  cmp -s "$EDD/n.pre0" "$EDD/n.pre1" || nb_ok=0
  cmp -s "$EDD/n.post0" "$EDD/n.post1" || nb_ok=0
  cmp -s "$EDD/host_v0.bin" "$EDD/host_v1.bin" && nb_ok=0 # o slot DEVE ter mudado
  if [ "$nb_ok" = 1 ]; then
    line "edicao-ciclo-vizinhos" "edicao" "$(sha "$EDD/host_v1.bin")" "pre/post 4096B identicos; comprimentos identicos; slot alterado" "N/A (comparacao direta dos hosts)" "N/A" "PARIDADE" "reinsercao simulada preserva os vizinhos do slot autoral byte a byte e so o interior do contêiner mudou (geometria fixa, sem realocacao)"
    par=$((par+1))
  else
    line "edicao-ciclo-vizinhos" "edicao" "$(sha "$EDD/host_v1.bin")" "pre/post identicos + slot alterado" "-" "-" "DIVERGE" "preservacao de vizinhos falhou"
    bad=$((bad+1))
  fi
fi

echo
echo "TOTAIS: paridade=$par divergencia-contratual-esperada=$contratual sondas-nao-cotadas=$sonda controles-corrupcao=$corr DIVERGE(inaceitavel)=$bad  (tsv: $ROWS; tamanhos: $SIZES)"
if [ "$bad" != 0 ]; then exit 1; fi
# Esperado (pos-ETAPAS 3-4): 53 PARIDADE = 36 da entrega do decoder (9
# goldens + 12 plain-encode + 12 plain-decode + 2 runtime + 1 k05)
# + 15 DIRECAO B + 2 ciclo de EDICAO (slot externo + vizinhos);
# 1 DIVERGENCA-CONTRATUAL (m02); 2 SONDA-DEFEITO; 2 CONTROLE-CORRUPCAO.
# Total = 58 linhas.
if [ "$par" != 53 ] || [ "$contratual" != 1 ] || [ "$sonda" != 2 ] || [ "$corr" != 2 ]; then
  echo "ATENCAO: contagens divergem do esperado (paridade=53, contratual=1, sondas=2, controles=2) — revisar suite nova?"; exit 2;
fi
exit 0
