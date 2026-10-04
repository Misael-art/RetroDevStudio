# EXPECTATIONS-VISUAL-ETAPA1 — congelado antes de reproduzir (missão visual, 2026-10-03)

Escopo: estabelecer a CAUSA do achado magenta do PASSO 9 (jornada integrada,
run-4 @ b824e11, captura
`inspection-2026-10-03T12-27-57-691Z-anim-integrada-passo9.png`) com
reprodução e evidência. Este arquivo congela observáveis, protocolo e matriz
de decisão ANTES de qualquer execução de diagnóstico. Nenhum código de
produto ou harness foi alterado quando este arquivo foi commitado sozinho.

## Evidência offline já coletada (somente leitura das capturas existentes)
Análise por pixel (PIL, retângulo de conteúdo do `<img>` na janela real):
- passo2 (instância 1, stand 32×40 nativo, conteúdo CSS 96×120): 6192 px
  magenta (fundo CSS através da transparência índice 0) + cores do corpo do
  Sonic (p.ex. (36,36,144)) → apresentação correta.
- passo9 (instância 2 pós-restart, walk-1 40×40 nativo, conteúdo CSS
  120×120): 14400 px = 100% da área exatamente (255,0,255), zero pixels de
  imagem → o bitmap decodificado NÃO foi pintado na janela.
- O mesmo run-4 registrou no report (`recompose.pixels_checked`) pixels RGBA
  medidos no canvas IGUAIS byte a byte à referência independente
  (`renderSonicFrameReference(journeyBytes, 6)`, sha
  `abbf2d5e76e7a3f78a26504a8dbb58bb93c8d190b6769b45e8e0413178ed78ac`), e o
  hit-test de layout passou. Logo: dados corretos, apresentação errada.
  `drawImage` lê o bitmap decodado, não o raster da janela — a prova do
  PASSO 9 nunca observou a janela real.

## Lado de código verificado por leitura (sem alteração)
- `InspectionPanel.tsx:859`: o `<img data-testid="inspection-sprite-frame-image">`
  tem `background-color #ff00ff` (bicolor magenta) deliberado desde 57460b8
  (rodada multiframe) para expor a transparência índice 0 sob o PNG.
- `sprite_composition.rs`: PNG RGBA8 real (alfa 0 no índice 0, 255 nos
  demais); `palette_rgba` nunca produz magenta; magenta só pode vir do
  fundo CSS ou de preenchimento do próprio compositor.
- Harness (`readRenderedSpriteFramePixels`): canvas 2D offscreen — verifica
  pixels acessíveis da imagem, não a apresentação na janela.

## Protocolo de reprodução (cenário de diagnóstico dedicado, binário canônico deste worktree)
Mesma Xvfb pinada (sha 5bfd315a…), mesma ROM BYOR (sha c7da53a1…), janela
1920×1080, gate de proveniência ativo. Observações em série, cada uma com
captura real da janela + recorte do retângulo de conteúdo do `<img>`:
1. O0 instância 1: sessão completa → compor stand → pixels de canvas +
   recorte da janela comparados contra raster independente esperado
   (referência ampliada 3× vizinho mais próximo sobre o fundo magenta).
2. O1 instância 1: compor walk-1 (base) → mesmas medições.
3. O2 instância 1 pós-emulador: rodar o core (portão do PASSO 7) → fechar →
   recompor walk-1 → mesmas medições. Discrimina "quebra com o emulador na
   mesma instância" de "quebra só com a instância nova".
4. O3 instância 2: salvar sessão → destruir janela → recriar → reabrir →
   compor walk-1 (cópia da jornada) → mesmas medições. Reprodução-alvo do
   defeito.
5. Sondas discriminantes na instância em defeito (registradas como
   observação, não como gate):
   - P1: `img.style.background = "transparent"` → recorte escurece para o
     fundo do palco (#0b0f19) ⇒ conteúdo da imagem pintado como transparente
     (defeito de rasterização da camada); permanece magenta ⇒ preenchimento
     magenta do próprio compositor (textura ausente).
   - P2: alternar `display:none`/`block` (repaint forçado) e recapturar ⇒
     recuperável por repintura ou persistente.
   - P3: reatribuir o mesmo `src` e recapturar ⇒ recuperável por re-render.
6. A/B de ambiente (execução separada, somente diagnóstico): repetir O0/O3
   com `WEBKIT_DISABLE_COMPOSITING_MODE=1` no ambiente do app. Se a
   apresentação ficar correta, o mecanismo é o compositor acelerado do
   WebKitGTK sob rasterização por software; sem essa variável no fluxo
   normal, o produto continua exposto.

## Matriz de decisão (causa)
- C1 (esperado em toda observação): hash dos pixels de canvas == referência
  independente. Se falhar em O3, a causa NÃO é apresentação e este
    congelado é revisto por adendo antes de qualquer nova execução.
- C2 (defeito-alvo em O3 sem mitigação): recorte da janela 100% magenta com
  C1 verdadeiro ⇒ apresentação desconectada dos dados.
- Classificação: P1 + A/B decidem entre "camada rasterizada vazia" e
  "textura ausente preenchida pelo compositor". Em ambos os ramos a causa é
  da camada de apresentação do produto (PNG transparente + fundo CSS +
  compositor), NÃO da extração, dos bytes da ROM, do host ou do screenshot.

## Prova visual discriminante (contrato novo do harness, a ser congelado em adendo próprio antes da jornada retificada)
- A verificação visual de frame composto deve comparar o RECORTE DA JANELA
  real contra o raster independente esperado (escala inteira 3×, bordas
  excluídas, fundo magenta composto, alpha resolvido), com divergência
  reportada em pixels contados.
- Controle negativo obrigatório: uma apresentação invisível (imagem correta
  nos dados, nada pintado na janela — p.ex. opacidade 0) DEVE falhar a prova
  visual. Uma área magenta vazia DEVE falhar o PASSO 9.
- Esperas apenas condicionais e diagnosticáveis (waitFor com condição
  verificável + orçamento declarado); nenhum sleep arbitrário.

## O que esta Etapa NÃO muda
- Nenhum byte de produto ou harness é alterado por este congelado; a
  retificação (fix de apresentação + prova visual) terá adendo próprio
  congelado antes de rodar.
- A captura antiga do passo9 permanece intacta em
  `src-tauri/target-test/validation/` da worktree de entrega e será copiada
  (SHA registrado) para a pasta de evidência desta missão.
- Os contratos de dados (pixels_sha256 RGBA puro, png_sha256 do artefato,
  proveniência por SHA, N+1, BPS, restauração seletiva) permanecem como
  congelados em EXPECTATIONS-INTEGRADA.md + ADDENDUM-1/2.
