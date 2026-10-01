#!/usr/bin/env bash
# Ponto de entrada reproduzivel da validacao do decoder Nemesis de pesquisa
# (REX corpus B). Nao toca produto, nao roda cargo/npm, nao toca o corpus ROM.
#
# Uso:
#   bash scripts/rex_corpus_b/nemesis-validate.sh
# Saida: uma linha por caso com PASS/FAIL/SKIP explicito + rollup
#   verificados/pass/fail/skip (por categoria e total), e evidencia JSON em
#   data/rex_corpus_b/nemesis/evidence/decode-parity.json
#
# Variaveis:
#   REX_NEMCMP  caminho do binario do oraculo (padrao
#               ~/.cache/rex-codecs/oracle-tools/bin/nemcmp). O SHA-256 do
#               binario e comparado com o pin registrado em
#               docs/rex_corpus_b/RECONCILIACAO.md; se nao bater, o oraculo e
#               tratado como INDISPONIVEL e os casos ancorados nele viram SKIP
#               (ausencia de evidencia nunca e PASS).
#   KEEP_TMP=1  nao apagar data/rex_corpus_b/tmp depois de rodar
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 ausente: validacao exige apenas python3 (sem rede, sem cargo, sem npm)" >&2
  exit 127
fi

rc=0
python3 "$HERE/nemesis_validate.py" "$@" || rc=$?

if [ "${KEEP_TMP:-0}" != "1" ]; then
  rm -rf "$ROOT/data/rex_corpus_b/tmp"
fi
exit "$rc"
