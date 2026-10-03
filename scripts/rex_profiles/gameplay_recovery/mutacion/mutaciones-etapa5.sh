#!/usr/bin/env bash
# Bateria de mutacions da ETAPA 5 (xeracion da copia modificada).
#
# Como se executa (despois da raiz do repositorio):
#   bash scripts/rex_profiles/gameplay_recovery/mutacion/mutaciones-etapa5.sh
#
# Que fai: aplica UNA mutación cada vez sobre o código de produto desta etapa,
# executa as dous arquivos de probas afectados, restaura o arquivo desde a copia
# tomada en memoria e confire o SHA-256 ao final. Unha mutación que sobrevive é
# un oco de proba: a proba non está a aserdar o comportamento que di aserdar.
#
# Saída: unha liña por mutación (`id rc=[0|1] [contaxes]`) e o veredicto de
# restauración. rc=1 = morta (ben); rc=0 = sobreviviu (hai que escribir proba).
set -u

SCENE=src/core/nodegraph/rexGameplayScene.ts
PANEL=src/components/tools/RexGameplayRulePanel.tsx
TESTS="src/core/nodegraph/rexGameplayScene.test.ts src/components/tools/RexGameplayRulePanel.test.tsx"

if [ ! -f "$SCENE" ] || [ ! -f "$PANEL" ]; then
  echo "Execute na raiz do repositorio."; exit 2
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$SCENE" "$WORK/scene.bak"
cp "$PANEL" "$WORK/panel.bak"
SHA_SCENE=$(sha256sum "$SCENE" | cut -d' ' -f1)
SHA_PANEL=$(sha256sum "$PANEL" | cut -d' ' -f1)

mut() {
  id="$1"; file="$2"; from="$3"; to="$4"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if s.count(frm) != 1:
    print(f"ANCORA_AMBIGUA count={s.count(frm)}")
    sys.exit(9)
open(path, "w").write(s.replace(frm, to))
PY
  if [ $? -ne 0 ]; then
    echo "$id ERRO_ANCORA"
    cp "$WORK/scene.bak" "$SCENE"; cp "$WORK/panel.bak" "$PANEL"
    return
  fi
  # O código de saída se captura DIRECTAMENTE: cunpipe dentro de $( ) o
  # PIPESTATUS do pai non corresponde a vitest e daría un rc mentira (medido:
  # daba rc=0 con 4 probas mortas).
  npx vitest run $TESTS > "$WORK/saida-$id.txt" 2>&1
  rc=$?
  contaxes=$(sed 's/\x1b\[[0-9;]*m//g' "$WORK/saida-$id.txt" \
    | grep -oE "Tests +[0-9]+ failed \| [0-9]+ passed \([0-9]+\)" | head -1)
  cp "$WORK/scene.bak" "$SCENE"; cp "$WORK/panel.bak" "$PANEL"
  echo "$id rc=$rc [${contaxes:-sen contaxes: a suite nin sequera executou}]"
}

echo "# mutaciones-etapa5 · $(date -u +%Y-%m-%dT%H:%MZ)"
echo "# escena=$SHA_SCENE painel=$SHA_PANEL"

echo "## prepararXeracion (rexGameplayScene.ts)"
mut M1 "$SCENE" 'limiar-${gardada.threshold_current}' 'limiar-${gardada.threshold_recovered}'
mut M2 "$SCENE" 'noop: gardada.threshold_current === gardada.threshold_recovered,' 'noop: false,'
mut M3 "$SCENE" 'if (method !== "patch" && method !== "regenerate") {' 'if (false) {'

echo "## superficie de xeración (RexGameplayRulePanel.tsx)"
mut M4 "$PANEL" 'setConfirmacion(null);
    setXeracion(null);
    if (gardadaBruta === null)' 'if (gardadaBruta === null)'
mut M5 "$PANEL" 'if (resposta.input_sha256.toLowerCase() !== pendente.request.expected_sha256.toLowerCase()) {' 'if (false && resposta.input_sha256) {'
mut M6 "$PANEL" 'if (resposta.output_path !== pendente.request.output_path) {' 'if (false && resposta.output_path) {'
mut M7 "$PANEL" 'disabled={!podeXerar || busy !== null}' 'disabled={busy !== null}'
mut M8 "$PANEL" 'return `0x${offset.toString(16).padStart(6, "0")}`;' 'return `0x${offset.toString(16)}`;'

NOVA_SCENE=$(sha256sum "$SCENE" | cut -d' ' -f1)
NOVA_PANEL=$(sha256sum "$PANEL" | cut -d' ' -f1)
if [ "$SHA_SCENE" = "$NOVA_SCENE" ] && [ "$SHA_PANEL" = "$NOVA_PANEL" ]; then
  echo "RESTAURACION_OK scene=$NOVA_SCENE panel=$NOVA_PANEL"
else
  echo "RESTAURACION_FALLADA scene=$SHA_SCENE/$NOVA_SCENE panel=$SHA_PANEL/$NOVA_PANEL"
  exit 1
fi
