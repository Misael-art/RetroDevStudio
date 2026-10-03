# Evidência offline da ETAPA 1 — achado magenta (antes da reprodução)

Capturas copiadas sem alteração do worktree de entrega
(`REX-SONIC-ANIM-INTEGRADA-2026-10-03/src-tauri/target-test/validation/`),
hashes conferidos na cópia:

- `captura-original-passo9-magenta.png` — SHA-256
  `02d6adb72177c6241f8f9872cd3c26c95911dcb1f08614149ba82d737b7e64b2`
  (nome original: `inspection-2026-10-03T12-27-57-691Z-anim-integrada-passo9.png`).
- `captura-original-passo2-stand-ok.png` — SHA-256
  `8eb45b379501b9db35b94b80cc1607d0717b0ac622fe6dca38de4a6f073681d7`
  (nome original: `inspection-2026-10-03T12-27-57-691Z-anim-integrada-passo2.png`).

Análise por pixel (PIL, fora do app), recorte 120×120 do palco do frame:

- passo2 (instância 1, quadro stand 96×120 de conteúdo): 6192 pixels magenta
  (índice 0 transparente sobre o fundo CSS `#ff00ff`) + cores reais do Sonic
  — apresentação correta.
- passo9 (instância 2, pós-reabertura, walk-1 120×120): 14400/14400 pixels
  magenta sólidos, 1 cor distinta — nenhum conteúdo da imagem pintado.

Relatório run-4 (`../2026-10-03-journey/report-journey-run4.json`, passo 9):
`recompose.pixels_checked.pixelsSha256 =
abbf2d5e76e7a3f78a26504a8dbb58bb93c8d190b6769b45e8e0413178ed78ac`,
byte a byte igual à referência independente `renderSonicFrameReference` (`scripts/qa/sonic-frame-reference.mjs`), que nunca produz magenta.

Fatos de código (leitura, sem mudança):
- `<img data-testid="inspection-sprite-frame-image">` usa fundo CSS
  `bg-[#ff00ff]` desde o commit 57460b8 (rodada multiframe) para expor
  transparência do índice 0.
- `palette_rgba` (sprite_composition.rs:352) emite alpha 0 apenas no índice 0;
  nenhum caminho do encoder produz (255,0,255).
- `readRenderedSpriteFramePixels` mede o bitmap decodificado via `drawImage`,
  não o raster da janela — incapaz por construção de ver este defeito.

Conclusão desta fase: dados exonerados; defeito na camada de apresentação
(WebKit não pintou o conteúdo da imagem na instância pós-reabertura).
Mecanismo exato (textura do compositor vs. imagem transparente vs. repintura)
classificado pela reprodução `sonic-anim-visual-diagnostico` com probes
P1/P2/P3 e A/B `WEBKIT_DISABLE_COMPOSITING_MODE=1`, conforme
EXPECTATIONS-VISUAL-ETAPA1.md (congelado em 08d3918).
