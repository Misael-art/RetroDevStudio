# CAUSA DO MAGENTA — ETAPA 1 (fechada 2026-10-03)

Pergunta do achado: `inspection-2026-10-03T12-27-57-691Z-anim-integrada-passo9.png`
mostra o preview walk-1 totalmente magenta apesar do PASSO 9 aprovar pixels e
hit-test. Causa estabelecida com reprodução e evidência, sem atribuição
automática à extração, ao host ou ao screenshot.

## Resumo do veredito

**Camada de apresentação do produto**: sob o compositor acelerado do WebKitGTK,
uma janela destruída e recriada no mesmo processo nunca repinta o bitmap
decodificado do `<img>` do palco de inspeção — a região exibe apenas o fundo CSS
`bg-[#ff00ff]` (matte de transparência), e o raster da janela está defasado
(~+99px em y) em relação ao layout do DOM. Os dados (canvas decodificado) estão
byte a byte corretos em todas as observações, inclusive na reabertura.

Exonerados com evidência: extração/deco (pixels iguais à referência
independente), bytes da ROM (SHA-256 da base preservado; ROM editada do pump
registrada no relatório), host readiness (verificado nos runs), caminho de
screenshot (a captura é o pixmap raiz X11, externo ao WebKit; a mesma captura
mostra o resto da UI correto).

## Linha de evidência (run-03, sem mitigação)

- Binário: SHA-256 `8cc79c724d0192cda0fe4adc87b740a8c73f3558d93c73799957b145e4e0fed6` (HEAD `573e2c0`, gate de proveniência `__RDS_BUILD_COMMIT__` confirmado no run).
- ROM base BYOR: `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` (531577 B); ROM aplicada no pump: `b1ed600d361af9b146a06fb42545572999c12194731fc69de3ba319852079b86`; core Genesis Plus GX v1.7.4 `46a5521`.
- Expectativas congeladas antes da execução: `../../EXPECTATIONS-VISUAL-ETAPA1.md` (commit `08d3918`).
- Relatório completo: `report-diagnostico-sem-mitigacao-run03.json` (SHA-256 `eca15e8465f7b65811fad5715d1ea28add20d79137525bb1af08f1d463a3688a`), `defeito_reproduzido: true`, `allPass: true` (todos os gates da matriz congelada passam, incluindo o gate que EXIGE divergência de janela com dados intactos).

Observações O0–O3 (canvas medido via `readRenderedSpriteFramePixels` vs
referência independente `renderSonicFrameReference`; janela via pixmap raiz X11):

| Obs | quadro | pixelsSha256 do canvas | igual à referência | janela == raster |
|---|---|---|---|---|
| o0-stand-instancia1 | stand | `7354bcfb…462e7` | sim | sim (0 mismatch) |
| o1-walk1-instancia1 | walk-1 | `6e11229e…0338` | sim | sim (0 mismatch) |
| o2-walk1-pos-pump | walk-1 (ROM editada) | `abbf2d5e…78ac` | sim | sim (0 mismatch) |
| o3-walk1-pos-reabertura | walk-1 (ROM editada) | `abbf2d5e…78ac` (idêntico a O2) | sim | **NÃO — 12258 pixels divergentes no recorte declarado, magenta_fraction 0.175** |

O retângulo layout é o mesmo em O0–O3 e P1–P3 (`x=1409.84, y=691.98,
122×122`; devicePixelRatio 1), ou seja: a divergência não é do DOM nem do
hit-test — é do raster apresentado.

## Análise offline da captura defeituosa (O3, run-03)

Cópia arquivada: `capture-inspection-2026-10-03T16-44-57-791Z-visual-o3-walk1-pos-reabertura.png`
(SHA-256 `207b233f7ef40cda74ee55925c942d458dbcf93f0683a1c25bf910b8f81c11fe`),
1920×1080, recomputada por PIL/numpy fora do app:

- Existe exatamente **uma** região magenta pura na janela: bloco sólido de
  120×120 = 14400 pixels em x∈[1411,1530], y∈[792,911] — o matte CSS do `<img>`
  pintado com defasamento de ~+99px em y sobre o retângulo declarado.
- A referência independente walk-1 em 120×120 (3× nearest) tem 6183 pixels
  opacos e 8217 transparentes (índice 0 → matte). Na posição do bloco
  observado, os 8217 pixels transparentes coincidem com magenta e **0 de 6183**
  posições do sprite coincidem com qualquer cor do sprite: nenhum bitmap
  pintado, apenas o fundo.

## Sondas discriminantes (mesmo run, mesma instância pós-reabertura)

Qualquer gatilho de repintura restaura a apresentação correta
(byte-exact vs raster independente, `mismatches: 0`):

| Sonda | gatilho | resultado |
|---|---|---|
| P1 | escrita de estilo (`backgroundColor` do fundo) | crop == raster, 0 mismatches |
| P2 | `display:none`→`block` + duplo `requestAnimationFrame` | crop == raster, 0 mismatches |
| P3 | reatribuição do `src` | crop == raster, 0 mismatches |

Conclusão: o bitmap está decodificado e disponível (o canvas mede correto); o
compositor não o leva ao raster da janela nova até que algo force uma repintura.

## A/B do mecanismo

- Run: `report-diagnostico-ab-compositing-off.json` (SHA-256
  `89a35a2bfcf1be6de6269dfb3a286c286ff893306898f85423be6208ed975356`), mesmo
  binário `8cc79c72…`, mesma ROM, mesma sequência O0–O3 + sondas.
- Única diferença: `WEBKIT_DISABLE_COMPOSITING_MODE=1` no ambiente do app.
- Resultado: `defeito_reproduzido: false`; **O3 pós-reabertura com janela igual
  ao raster independente (0 mismatches, magenta_fraction 0.57 = matte correto
  nas posições transparentes)**; todas as demais gates inalteradas e verdes.

Mecanismo classificado: **compositor acelerado do WebKitGTK sob janela
destruída/recriada** (caminho de surface/GPU do WebKit em render por software
baixo Xvfb). Não é timing (as sondas não esperaram; a condição verificada foi
o próprio raster), não é arbitragem de sleep, não é a extração.

## Controle negativo (propriedade exigida pelo contrato congelado)

A apresentação correta com dados corretos passa (O0–O2, e O3 no A/B) e a
apresentação invisível com dados corretos **falha** o gate de recorte de janela
(O3 run-03). O harness de diagnóstico distingue os dois mundos — a limitação
estrutural anterior (`readRenderedSpriteFramePixels` medir o bitmap decodificado
via `drawImage`, nunca o raster da janela) está coberta pela captura X11
externa.

## Capturas de referência arquivadas

- `capture-…16-44-57-791Z-visual-o1-walk1-instancia1.png` (baseline correto,
  instância 1) — SHA-256 `f9fbf6279c1ee67d00f26308583d635aac5656e7247096842f271f357c2e3326`
- `capture-…16-50-21-710Z-visual-o3-walk1-pos-reabertura.png` (reabertura
  correta com compositing off) — SHA-256 `a081b0bef97d45dfe23b9bbcd47941f61b69d8aab17d03418f93f0c47332fc52`
- Capturas originais do achado (preservadas, seção anterior deste diretório):
  `captura-original-passo9-magenta.png` `02d6adb7…`,
  `captura-original-passo2-stand-ok.png` `8eb45b37…`.

## Descobertas de produto/CX registradas durante a reprodução

(Adaptações de condução no relatório `notes[]`; gates inalterados.)

1. A troca nativa de `<select>` de quadro não confirma seleção com o runtime da
   Game View vivo no mesmo contexto (evidência run 16:28).
2. O botão visível "Parar" navega para o workspace Scene
   (`App.tsx` `resetEmulatorSession(true)`) e a sessão de inspeção é `useState`
   local (`InspectionPanel.tsx:85`), perdida no desmonte — o utilizador é
   ejectado da sua área de trabalho de animação (evidência run 16:36).

Ambas entram na ETAPA 2 (workspace de animação) como requisitos reais.

## Input para a decisão de correção (ETAPA 3)

A evidência A/B aponta o caminho da correção: desativar o compositing
acelerado do WebKitGTK em Linux antes da criação da webview no próprio binário
(o que o QA provou por variável de ambiente), e/ou eliminar a dependência de
alpha na apresentação (matte opaco colado no raster exibido). A mitigação por
ambiente de QA **não** conta como correção: a jornada retificada da ETAPA 3
tem de passar no binário final sem `WEBKIT_DISABLE_COMPOSITING_MODE`, com o
sprite visível pós-reabertura igual à referência independente e o magenta puro
a falhar.
