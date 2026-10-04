# C3 — reconfirmação offline da prova visual no destino da consolidação (2026-10-03)

Escopo: reverificar a prova de apresentação da ETAPA 3 no worktree
`REX-SONIC-CONSOLIDACAO-2026-10-03` (HEAD `36c9a05`), sem tocar produto,
WebDriver ou ROM. A correção executada reproduz os cálculos congelados de
`EXPECTATIONS-VISUAL-ETAPA3.md` (E3-2/E3-3); não há expectativa nova —
reexecutar e reprovar a captura defeituosa é o critério.

Script: `~/rds-scratch/c3-verify.mjs` (scratch; importa os helpers exportados
do harness versionado `scripts/e2e-tauri-build-run.mjs` —
`decodeWindowPng`, `renderPresentedFrameRaster`, `cropWindowRgb`,
`compareWindowCropToExpected` — e o verificador independente
`scripts/qa/sonic-frame-reference.mjs`).

## resultados (saída literal da correção)

1. **Base pinada** — ROM BYOR `c7da53a1…c81ebb`, 531577 B: confere.
2. **Referência recomposta** — mutação determinística da jornada (pixel
   walk-1 `paintedIndex=6`, cadência 40 em `0x13BAE`) recomposta pelo
   verificador independente → `pixels_sha256 =
   abbf2d5e76e7a3f78a26504a8dbb58bb93c8d190b6769b45e8e0413178ed78ac`
   (igual ao relatório E3 run-01, passo 9).
3. **Dimensões de dados ≠ raster** (exigência da missão):
   - dados do quadro: 40×40 RGBA = 6400 B (o que o core compõe);
   - raster apresentado: 120×120 RGB = 43200 B (CSS 3× com matte magenta
     `#ff00ff` nas posições transparentes) — o que a janela pinta.
4. **Negativo discriminante preservado** — a captura defeituosa arquivada
   (`capture-inspection-2026-10-03T16-44-57-791Z-visual-o3-walk1-pos-reabertura.png`,
   SHA-256 `207b233f7ef40cda74ee55925c942d458dbcf93f0683a1c25bf910b8f81c11fe`)
   continua REPROVADA pelo mesmo comparador independente: **12258 mismatches
   em 14400** no retângulo congelado (x=1411, y=693, recorte 120×120).
5. **Positivo no binário final** — a captura da jornada retificada
   (`capture-2026-10-03T21-23-15Z-e3-walk1-visivel-pos-reabertura-1.png`,
   SHA-256 `554eb5ff9ec1bf573124e3954447ee811a9fce8e5ac95c1075b3583853880027`)
   BATE com **0 mismatches em 14400** contra o raster independente recomposto
   no mesmo retângulo, e o recorte não é magenta sólido (não-vacuidade:
   o gate reprovaria 14400/14400 se a janela tivesse sumido de novo).

## leitura

Os dois lados da prova continuam válidos no destino da consolidação: o
comparador independente discrimina a falha de apresentação da ETAPA 1
(reprova a captura defeituosa arquivada) e confirma o sprite real na captura
do binário final (0 mismatches, mate magenta nas posições transparentes).
Dados ≠ apresentação: as dimensões comparadas são as do raster da janela
(120×120), não as do bitmap composto (40×40), como exigido.

## limites

- Reconfirmação offline das capturas arquivadas; não reexecuta a jornada
  ao vivo (isto pertence a C6, gates + cenários no destino).
- O retângulo congelado é o do run ao vivo E3-2; a janela em Xvfb pinado
  1920×1080×4 com posicionamento determinístico produziu 0 mismatches na
  primeira tentativa ao vivo e aqui — evidência de coincidência de
  posicionamento, não de medição independente de geometria.
