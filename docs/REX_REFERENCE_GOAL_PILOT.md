# REX — decisão de objetivo no jogo de referência (Experimental)

Fatia dependente de `codex/rex-branch-compare-pilot`, publicada em
`codex/rex-reference-goal-pilot`, sem merge. O código desta fatia mantém o
perfil Experimental de autoria e reutiliza o perfil condicional apenas no
comportamento delimitado abaixo; não amplia o conjunto de instruções M68K.

## Resultado demonstrado

O comportamento é autoria do template builtin `reference_platformer`, não
recuperação de uma ROM externa. O grafo lê `reference_score`, soma um ponto
por frame em que a entrada real `BUTTON_RIGHT` é consumida, grava o resultado,
compara `reference_score >= threshold` e, no ramo verdadeiro, grava
`goal_open=1` e destrói o sprite `goal` real; no ramo falso, mantém o sprite
visível. O parâmetro exposto no editor é `threshold`, rotulado “Limiar de
score”, com semântica e origem autoral visíveis. O source mapping persistido é
`graphs/reference_platformer_logic.json:24`.

A mesma sequência foi executada nos dois caminhos:

| estado | limiar | entrada | score esperado | ramo esperado | observação do framebuffer real |
| --- | ---: | --- | ---: | --- | --- |
| ROM gerada antes da edição | 6 | `right=true` por 8 frames, depois neutro | 8 | true / passagem aberta | core Libretro `320×224`: marcador amarelo `38 → 0`, bounds `x=236..243, y=162..167` |
| ROM gerada após edição | 12 | `right=true` por 8 frames, depois neutro | 8 | false / passagem fechada | core Libretro `320×224`: marcador amarelo `38 → 38`, mesmos bounds |

Essa é a observação que comprova a ROM gerada pelo grafo: o passo
`persist_reopen_compile_and_execute_edited_goal_threshold` do relatório
identifica a ROM recompilada após a reabertura e a execução controlada observa
o estado visual correspondente. Hashes e build verde são apenas identificação,
não a prova causal.

## Rastreabilidade da execução

Relatório final local:
`src-tauri/target-test/validation/reference-platformer-2026-09-22T19-30-25-133Z-report.json`.

- Binário realmente exercitado nos três E2Es: `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `9d403c96214f81262553676213ab39b6afc49865450a59ae57c90ec78e316d2f`.
- ROM original antes da edição: SHA-256 `1cd050a94201ba71bfcece016799154adbdc2dc937b83a8c1de4dfecb96284a0`.
- ROM recompilada após `threshold=12`: SHA-256 `2b5fa899ba453e0d26f1f8336cd1c12cc2914aa5893b3b6e10bb5eb3644a3c00`.
- `main.c` gerado após a edição/reabertura: SHA-256 `39c1e963c5b0d1a09fce2d69bb5f957651b054592a91080d828255da3851aa4e`.
- ROM gerada pelo grafo e observada antes da edição: o próprio relatório registra o caminho de build e o core observa o ramo verdadeiro com `yellowPixels=0` após 8 frames de entrada; a ROM editada registra `yellowPixels=38` após os mesmos 8 frames.
- Capturas legíveis: [`04-goal-open-before-edit.png`](../src-tauri/target-test/validation/reference-platformer-2026-09-22T19-30-25-133Z-04-goal-open-before-edit.png), [`05-authored-threshold-editor.png`](../src-tauri/target-test/validation/reference-platformer-2026-09-22T19-30-25-133Z-05-authored-threshold-editor.png) e [`06-goal-closed-after-edit.png`](../src-tauri/target-test/validation/reference-platformer-2026-09-22T19-30-25-133Z-06-goal-closed-after-edit.png).

Hashes das capturas, na mesma ordem: `3104ec32b4ae96dab1288adc8061a87e775d913db3fbc357340a990c0a4d4a9f`, `9e2dc6eb0cdb444a5546f316572c18d8a120670f84266905a19108044c16ee23` e `c832ffbc22a171c2d4cbba4fa47ff2cb81b2699b971c4b47def677644d6802dc`.

O fluxo de interface comprovado foi: wizard → NodeGraph → alterar o limiar
→ salvar → fechar/reiniciar → reabrir → confirmar `12` e o mapping → compilar
→ executar. A entrada e a saída são as do jogo builtin executado pelo core;
não há simulação exclusiva do harness.

## Matriz de aceite

### Comprovado

| critério | evidência |
| --- | --- |
| autoria explícita e parâmetro editável | nó `condition_compare` builtin com `authoring_origin=authored_builtin_reference_platformer`, semântica visível e input `node-param-score_threshold-b` |
| entrada/saída no jogo real | `BUTTON_RIGHT` consumido pelo loop da ROM; `reference_score` e `goal_open` observados pelo IPC/core e marcador do framebuffer |
| persistência | save, reinício, reabertura e leitura do limiar `12` + mapping `graphs/reference_platformer_logic.json:24` |
| ROM gerada pelo grafo | ROM original e recompilada identificadas no passo de build; cada uma executada no core com a mesma sequência e resultado visual diferente |
| ADDQ como regressão | `logic-recovery-2026-09-22T19-29-22-989Z-report.json`: original `0x12340058→0x12340059`, patch #2 `→0x1234005A`, original/original, no-op, overflow `0x1234FFFF→0x12340000`, flags e wrap comprovados |
| branch-compare como regressão | `logic-recovery-branch-2026-09-22T19-29-49-280Z-report.json`: vetor comum `[3,4,5,0,0xFFFF,0x1234]`, ramos `[0,1,1,0,0,1]`; fronteiras assinadas, limiar e word-wrap preservados |
| limite de instruções | o comportamento autoral usa apenas nós existentes de entrada, variável, soma, comparação, desvio, escrita e destruição; não declara suporte geral nem adiciona instrução M68K ao perfil |

### Pendências

- Não é reconstrução de Sonic nem recuperação da rotina autoral; autoria e recuperação assistida continuam explicitamente separadas.
- Não há equivalência geral de M68K, callers indiretos/PC-relative, contexto de chamada, outras larguras/operações ou suporte SNES.
- O marcador amarelo é um oráculo visual independente para este sprite próprio; não constitui um detector visual geral de objetivos.
- CI e Desktop E2E do commit `a5604af77cfc6f10521a3a587512d499b7b706ac` terminaram com sucesso: runs [CI #35775883898](https://github.com/Misael-art/RetroDevStudio/actions/runs/35775883898) e [Desktop E2E #35775883908](https://github.com/Misael-art/RetroDevStudio/actions/runs/35775883908). Esta linha documental será publicada em commit dependente próprio; o workflow disparado por esse HEAD também será acompanhado.

## Regressões preservadas

As fixtures duráveis permanecem em `src-tauri/tests/fixtures/logic_recovery_sgdk/`
e `src-tauri/tests/fixtures/logic_recovery_branch_sgdk/`. Os artefatos em
`src-tauri/target-test/validation/` são regeneráveis e serão publicados pelos
artefatos do workflow; corpus BYOR, ROMs comerciais e trabalhos alheios não
entram no commit.
