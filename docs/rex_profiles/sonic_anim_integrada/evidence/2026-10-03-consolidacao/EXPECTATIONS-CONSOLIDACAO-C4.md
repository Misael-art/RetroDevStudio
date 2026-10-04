# EXPECTATIONS-CONSOLIDACAO-C4 — medições de efeito do compositing-off (congelado 2026-10-03)

Este documento é commitado SOZINHO, antes de implementar o cenário de
medição, antes de construir qualquer binário novo e antes de qualquer
corrida. Desvio durante a execução = FAIL/INCONCLUSIVE registrado com a
serie bruta; nunca reescrita posterior deste arquivo.

## enquadramento (o que NÃO será afirmado)

- O sucesso da correção `932f2c6` foi demonstrado no ambiente descrito
  (Xvfb 1920×1080×24, WebKitGTK desta máquina, janela destruída/recriada).
  Esta frente NÃO generaliza "compositor acelerado sempre falha" e NÃO
  generaliza "render por software é barato".
- C4 mede o efeito GLOBAL da decisão de produto (binário Linux sempre
  define `WEBKIT_DISABLE_COMPOSITING_MODE=1`) nos caminhos afetados:
  Game View, NodeGraph e prévia MUGEN. Saída possível: manter a política
  com custo medido e registrado; ou, se houver regressão relevante,
  corrigir a política de apresentação MANTENDO o negativo magenta
  discriminante (a captura defeituosa arquivada deve continuar reprovando
  o comparador em qualquer política alternativa).
- Nada aqui troca a correção por variável oculta no harness: o braço
  "flag no ambiente externo" está proibido nas duas corridas; a única
  diferença entre braços é o código do binário.

## braços (condições equivalentes, única variável = binário)

- **A (produto, compositing-off)**: binário pinado `ce54d579…`, construído
  em `a0067d8`; código de produto idêntico ao HEAD do destino (diff vazio
  de `src/`, `src-tauri/src`, manifests entre `a0067d8` e HEAD, verificado
  hoje). Define a env internamente (`lib.rs:5593-5595`).
- **B (baseline, sem a linha)**: branch local-only a partir do commit H1 do
  destino que APAGA as 3 linhas da mitigação; SHA do commit de build e
  SHA-256 do binário gravados na evidência; NUNCA push, NUNCA entra no PR
  integrado, NUNCA é declarado aprovável como produto.
- Corridas na mesma máquina, mesma sessão de runner isolado, Xvfb pinado
  `5bfd315a…`, tela 1920×1080×24, dpr 1; ambiente do processo node SEM
  `WEBKIT_DISABLE_COMPOSITING_MODE` (assert pré-corrida, estilo E3-1);
  nada é definido externamente em A nem em B.
- Pesos serializados: uma corrida pesada por vez; nenhuma outra compilação
  ou E2E concorrente.

## métricas e definição de "tempo emulado vs fluidez apresentada"

Coleta por janela de 20 s, 3 janelas por superfície por braço, amostragem
1 Hz; CPU por `/proc/<pid>/stat` (utime+stime deltas) enumerando a árvore:
processo principal (descoberto por `pgrep -f <caminho-exato-do-binário>`)
+ filhos WebKitWebProcess/WebKitNetworkProcess via `ps --ppid`.

1. **Game View (ROM Sonic BYOR `c7da53a1…`, carregada pelo caminho do
   produto com gate de identidade)**
   - tempo emulado: `frames_run` do core (`emulator_observe`) — delta por
     segundo de relógio;
   - fluidez apresentada: `data-rendered-frames` (contador de pump do
     produto, `ViewportPanel`) — delta por segundo de relógio; as duas
     dimensões são registradas SEPARADAMENTE;
   - CPU: soma da árvore do app;
   - limite esperado: as métricas só valem se `frames_run` avançar > 0 na
     janela (senão = INCONCLUSIVE, não "0 fps bom").
2. **NodeGraph** (editor real, grafo de fixture do cenário existente)
   - apresentada: contagem de frames de repaint NÃO existe como hook —
     LACUNA REGISTRADA como métrica não disponível;
   - resposta de interação: latência click→mudança de estado (botão de
     layout → `data-zoom`/posições atualizarem) e drag de node-card →
     transform atualizado, medida por timestamps WebDriver;
   - CPU: mesma coleta.
3. **MUGEN** (prévia de revisão original/modificada com o fixture já
   usado por `mugen-control`)
   - apresentada: avanço do contador visível `mugen-review-frame` durante
     `mugen-review-play` por segundo de relógio (a prévia é DOM/timeout,
     não canvas — a medição vale como fluidez apresentada daquela
     superfície);
   - CPU: mesma coleta; janela de execução do core MUGEN real onde o
     cenário já a expõe, sem inventar nova rota.

## critérios (congelados)

- **Sem regressão relevante** quando, para cada métrica disponível:
  latência de interação A ≤ B×1.5; fps apresentado A ≥ B×0.6; CPU A ≤
  B×1.5 + 10 pontos percentuais absolutos; `frames_run` A ≈ B (±5%, tempo
  emulado é determinístico e não deve depender do compositor).
- **Regressão relevante** = violação de qualquer critério acima em ≥ 2
  janelas da mesma superfície → a política de apresentação é corrigida
  (escopo: Windows/WebKitGTK condicional, gate de re-pintura, ou escopo
  por janela), mantendo o negativo magenta reprovando o comparador.
- Métrica não disponível (repaint tick do NodeGraph) é registrada como
  lacuna; NUNCA como aprovado.
- Resultado grava: `C4-MEDICOES.md` + JSON por braço em
  `evidence/2026-10-03-consolidacao/`, com SHAs de binário, commit de
  proveniência, ambiente e série bruta de amostras.

## passos de execução (ordem travada)

1. H1: cenário de medição (`compositing-medicao`) adicionado ao harness
   (só test-infra; produto intocado — diff de `src`/`src-tauri/src` vazio
   contra este commit).
2. Build A: reusa `ce54d579…` (sem rebuild; verificação de hash).
3. Branch B + build do binário baseline (cargo serializado).
4. Corridas A (3 superfícies) → B (mesma ordem), logs em
   `~/rds-scratch/c4-<braco>-<data>/`.
5. Análise contra os critérios; `C4-MEDICOES.md`; decisão de política.
