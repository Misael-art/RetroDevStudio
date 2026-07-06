#!/usr/bin/env bash
# Fase 5 — Ghidra headless boundary benchmark (M68000).
# Diagnostica Ghidra/JDK21. Se ausentes, imprime o pedido de autorizacao e SAI
# sem instalar/baixar nada (o usuario ainda nao autorizou sudo/AUR/global).
# So executa o benchmark real quando RETRODEV_GHIDRA_HOME apontar para um Ghidra
# instalado e um JDK 21+ estiver disponivel.
set -uo pipefail

GHIDRA_HOME="${RETRODEV_GHIDRA_HOME:-}"
ANALYZE=""
if [ -n "$GHIDRA_HOME" ] && [ -x "$GHIDRA_HOME/support/analyzeHeadless" ]; then
  ANALYZE="$GHIDRA_HOME/support/analyzeHeadless"
elif command -v analyzeHeadless >/dev/null 2>&1; then
  ANALYZE="$(command -v analyzeHeadless)"
fi

JAVA_MAJOR=0
if command -v java >/dev/null 2>&1; then
  JAVA_MAJOR=$(java -version 2>&1 | head -1 | grep -oE '[0-9]+' | head -1)
fi

echo "== Fase 5 diagnostico =="
echo "analyzeHeadless: ${ANALYZE:-MISSING}"
echo "java major: ${JAVA_MAJOR:-0} (Ghidra 12 exige >=21)"

if [ -z "$ANALYZE" ] || [ "${JAVA_MAJOR:-0}" -lt 21 ]; then
  cat <<'EOF'

== BLOCKED — autorizacao humana necessaria (nada instalado) ==
Fontes oficiais e comandos (NAO executados por este script):
  JDK 21 (repo oficial 'extra'):  sudo pacman -S jdk21-openjdk
  Ghidra (AUR):                   paru -S ghidra
  Ghidra (tarball oficial NSA):   https://github.com/NationalSecurityAgency/ghidra/releases
                                  export RETRODEV_GHIDRA_HOME=/opt/ghidra
Verifique o checksum publicado pela NSA antes de extrair. Espaco: ~1-2 GB.
Fase 5 permanece FAIL/BLOCKED ate instalacao versionada + autorizacao.
EOF
  exit 3
fi

echo "== Ghidra + JDK 21 disponiveis: pronto para boundary benchmark =="
echo "(implementacao do benchmark headless entra apos autorizacao/instalacao)"
exit 0
