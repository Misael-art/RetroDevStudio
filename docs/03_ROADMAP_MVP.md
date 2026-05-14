# 03 - ROADMAP MACRO & MVP TATICO

**Status:** Documento vivo
**Ultima revisao canonica:** 2026-05-14 (rodada 43)
**Fase ativa real:** Core MVP promovido tecnicamente em main; hardening continua nas superficies experimentais

**Nota 2026-05-14 (rodada 43, branch `codex/sgdk-stable-node-engine-blaze`):** a prova SGDK/no-code deixou de depender de fake. O fake SGDK/ROM foi renomeado para fallback unitario e nao conta como Stable. `official_sgdk_nocode_game_builds_and_runs_with_real_toolchain --ignored` gera um jogo persistente 100% por nodes, compila com SGDK oficial, gera ROM real e roda Genesis Plus GX por 60 frames (`non_black_pixels=15506`, sem edicao manual, sem fake). O corpus real `F:\Projects\MegaDrive_DEV\SGDK_Engines` foi processado por `sgdk_corpus_real_build_rom_emulation_report --ignored`: **122 projetos**, **68** com build/ROM/emulacao reais, **54** com bridge formal persistida, **0 falhas**, `stable_candidate=true`. `BLAZE_ENGINE` esta coberto por modo compativel real com build SGDK, ROM real e Genesis Plus GX (`non_black_pixels=71680`), mantendo o budget original bloqueante documentado e gerando budget compativel conservador. **SGDK Stable local: SIM nesta branch. Node Engine Stable local: SIM nesta branch.** Promocao institucional ainda exige barra ampla final, commit/push, PR/checks remotos, merge para `main` e readiness no destino.

**Nota 2026-05-13 (rodada 41, main):** PR #4 (`codex/sgdk-nocode-production-ui`) foi mergeado em `main` por merge commit `91bb8eb354389e370bb59d6a5ae84c21b4a1429f`, contendo o head `d21939ce83f360072a64637170922c78e2dd149d`. Os checks remotos de `pull_request` passaram no SHA do PR: `CI` run `25788180025` e `Desktop E2E` run `25788180007`; um run separado de `Desktop E2E` no evento `push` falhou no mesmo SHA e nao foi tratado como gate de PR. Em `main`, `npm run release:readiness:promotion` passou com `Pronto para promocao: SIM`, divergencia `+0 / -0`, baseline, build debug, upstream oficial, desktop E2E simples e QA RC A-F consumido das evidencias `qa-rc-2026-05-13T01-31-23-216Z-*`. UI/CX production hardening esta integrado em `main`. Isto nao promove SGDK nem Node Engine: SGDK continua **Experimental**, Node/Phase D continua **Experimental/Parcial**, `BLAZE_ENGINE` continua stress/blocker legitimo, e ainda faltam AST C completo, round-trip/build/emulacao dos 122 projetos e ROM/emulacao institucional de jogo no-code.

**Nota 2026-05-13 (rodada 40, branch `codex/sgdk-nocode-production-ui`):** a frente SGDK/no-code avancou sem promocao de maturidade e foi estabilizada para fechamento de branch. A UI principal ficou mais compacta e produtiva (topbar com warnings sob popover, status bar inferior, viewport com toggles pequenos, Inspector com diagnostico importado colapsado e Hierarchy com badges compactos). A cor-chave magenta agora e tratada no preview por flood fill a partir da borda, sem mutar assets, com toggle de debug e preservando magenta legitimo isolado no interior do sprite. O NodeGraph declara o vocabulario no-code obrigatorio e tem auto-layout por sistema; o compilador experimental prova C deterministico para um jogo Mega Drive 100% por nodes em teste unitario. O inventario SGDK agora gera gaps acionaveis e `node_candidates`; no corpus real seguem **122 projetos**, **32.251 candidatos de nodes** em **100 projetos**, e os gaps agregados seguem inalterados (`preprocessor_condition=1471`, `function_like_macro=484`, `unsupported_resource_kind=236`, `assembly_source=150`, `multiline_macro=90`, `inline_assembly=47`, `lossy_source_encoding=33`). Gates locais frescos: `check:tree`, `lint`, `tsc`, `npm test` **301/301**, `cargo clippy`, `cargo test --lib` **333/11 ignored**, corpus inventory real, matriz SGDK **7/7**, preflight SGDK, upstream oficial, QA RC A-G com evidencias `qa-rc-2026-05-13T01-31-23-216Z-*`, Debug/Portable/MSI. `release:readiness:promotion` continua sendo gate de governanca para destino `main`; fora de `main`, nao autoriza promocao. SGDK continua **Experimental** e Node/Phase D continua **Experimental/Parcial** porque ainda faltam AST C completo, round-trip/build/emulacao por projeto para os 122 e ROM/emulacao institucional de jogo no-code.

**Nota 2026-05-12 (rodada 38, branch `codex/sgdk-nocode-engine-hardening`):** foi iniciado hardening SGDK/no-code a partir de `origin/main` sem promover maturidade. O novo inventario estrutural SGDK (`src-tauri/src/core/sgdk_corpus_inventory.rs`) expõe comandos IPC para inspecionar projeto/corpus, gera source mapping de C/H/RES/assets, chamadas SGDK por familia e semantic gaps. No host, o corpus `F:\Projects\MegaDrive_DEV\SGDK_Engines` foi catalogado com **122 projetos** e artifact `src-tauri/target-test/validation/sgdk-corpus-inventory.json` contendo `project_details` completos. A barra local passou baseline, corpus real, QA RC A-G, builds Debug/Portable/MSI, upstream oficial e matriz SGDK 7/7; apos o commit tecnico `37a0c52`, `release:readiness:promotion` rodou os gates internos verdes, mas permaneceu `Pronto para promocao: NAO` porque a branch estava 1 commit a frente de `origin/main`. A fotografia mostra gaps agregados grandes (`preprocessor_condition`, macros, assembly, inline assembly, encoding e resource kinds sem mapping); portanto SGDK continua **Experimental** e Node/Phase D continua **Experimental/Parcial**.

**Nota 2026-05-11 (rodada 37, main):** PR #3 (`codex/product-hardening-runtime-setup`) foi mergeado em `main` por merge commit `76ccd7d978ea741771478d89053818285213d32e` apos checks remotos verdes no SHA `d2fec08eba2ec68d31714439bd92e8637d423114` (`CI` run `25704763249`, `Desktop E2E` run `25704763247`). Em `main`, `npm run release:readiness:promotion` passou novamente com `Pronto para promocao: SIM`, divergencia `+0 / -0`, baseline, upstream oficial e desktop E2E simples verdes. O core MVP continua promovivel; SGDK continua **Experimental**, Node/Phase D continua **Experimental/Parcial** sem jogo completo por nodes e sem AST C completo.

**Nota 2026-05-11 (rodada 36, branch `codex/product-hardening-runtime-setup`):** apos a promocao de PR #2, foi iniciado hardening incremental em branch nova. Runtime Setup agora tem retry/backoff para requests oficiais, cache local de metadata GitHub Releases (`toolchains/.cache/github-releases/`) e fallback controlado para cache com mensagens acionaveis de rate limit/erro remoto sem vazar token. NodeGraph ganhou validador exportado e preview no painel para refs/portas quebradas, mismatch de tipo/kind, ciclos `exec`, entrada ausente e nos soltos. Barra local e fluxos reais foram rerodados: `npm test` **292**, `cargo test --lib` **329/10 ignored**, upstream oficial `success=true`, `qa-rc` A-G fresco (`qa-rc-2026-05-11T23-49-20-465Z-*`), corpus SGDK **7/7** e Debug/Portable/MSI gerados. Isto nao promove SGDK nem Node Engine: SGDK continua **Experimental**, Node/Phase D continua **Experimental/Parcial** sem jogo completo por nodes e sem AST C completo, `BLAZE_ENGINE` continua stress/blocker legitimo.

**Nota 2026-05-11 (rodada 35, main):** PR #2 foi tirado de draft e mergeado em `main` por merge commit `35ab81ff63628ad50d4f5afff289f32013171c99`, apos checks remotos verdes no SHA `3b2b33e15f688939f7cca038be00ab3c1b8ad0b5` (`CI` pull_request `25698765825`, `Desktop E2E` pull_request `25698765818`). Em `main`, `npm run release:readiness:promotion` passou com `Pronto para promocao: SIM` no commit `35ab81f`, consumindo baseline, upstream, desktop smoke e QA A-G fresco `qa-rc-2026-05-11T21-20-39-556Z-*`. Isto promove tecnicamente o core MVP no destino canonico; SGDK segue **Experimental**, `support_status` inalterado, Node/Phase D segue heuristica sem AST C completo, e `BLAZE_ENGINE` permanece stress/blocker legitimo.

**Nota 2026-05-11 (rodada 34, branch `feat/sgdk-vram-residency-streaming-r14`):** hardening de CI/setup sem mudanca de maturidade: o `desktop-smoke` remoto bateu rate limit em `api.github.com` ao consultar a release oficial do SGDK sem token. O Runtime Setup agora usa `RDS_GITHUB_TOKEN`/`GITHUB_TOKEN` somente para GitHub API, e o workflow `desktop-e2e.yml` injeta o `github.token` read-only como `RDS_GITHUB_TOKEN`. Gates locais pos-correcao reexecutados e verdes, incluindo upstream oficial, `qa-rc` A-G fresco (`qa-rc-2026-05-11T21-20-39-556Z-*`), corpus SGDK `7/7` e Debug/Portable/MSI regenerados. A leitura continua: PR #2 e trilha de promocao; merge para `main` e `release:readiness:promotion` no destino ainda obrigatorios. SGDK segue **Experimental**; Fase D segue heuristica.

**Nota 2026-05-11 (rodada 33, branch `feat/sgdk-vram-residency-streaming-r14`):** PR #2 existe e o SHA `7bf026b` foi pushado com hotfix para `Desktop E2E` remoto (`live-stale` e overflow/interceptacao da topbar). A barra local pos-hotfix ficou verde (`npm test` 291, Rust baseline, upstream oficial, matriz desktop local 16/16, `qa-rc` A-G fresco `qa-rc-2026-05-11T18-14-46-427Z-*`, corpus SGDK `7/7`, Debug/Portable/MSI regenerados). GitHub Actions ficou verde em `push` e `pull_request` para `CI` e `Desktop E2E` (runs `25689348726`, `25689348725`, `25689350772`, `25689350771`). `release:readiness:promotion` foi reexecutado em worktree limpo e falhou apenas por governanca: branch muitos commits a frente de `origin/main`, PR ainda `draft/open`, sem merge para `main`. Isso mantem a leitura de PR pronto para promocao, nao MVP fechado. SGDK segue **Experimental**; Fase D segue heuristica.

**Nota 2026-05-11 (rodada 32, branch `feat/sgdk-vram-residency-streaming-r14`):** host Windows rechecado e barra tecnica local renovada: baseline frontend/Rust verde, corpus SGDK real `7/7`, upstream oficial `success=true`, `qa-rc` A-G fresco (`qa-rc-2026-05-11T11-53-47-951Z-*`), portable/release EXE e MSI canonicos gerados. `release:readiness:promotion` rodou em modo estrito e falhou apenas por governanca contra `origin/main` (201 commits a frente no snapshot pre-commit documental). Isso mantem a leitura de hardening e **nao** promove o MVP publicamente. SGDK segue **Experimental**; Fase D segue heuristica.

**Nota 2026-05-10 (rodada 31, branch `feat/sgdk-vram-residency-streaming-r14`):** host Windows preparado e barra tecnica local revalidada: baseline frontend/Rust verde, corpus SGDK real `7/7`, upstream oficial `success=true`, `qa-rc` A-G fresco (`qa-rc-2026-05-10T19-50-53-457Z-*`), portable/release EXE e MSI canonicos gerados. Isso melhora a fotografia de hardening, mas **nao** promove o MVP publicamente: a branch continua +200 vs `origin/main` e a promocao institucional ainda depende de governanca Git/PR limpa. SGDK segue **Experimental**; Fase D segue heuristica.

**Nota 2026-05-02 (rodada 29, branch `feat/sgdk-vram-residency-streaming-r14`):** sprint de maturidade de IDE reforcou o fluxo real de criador: viewport como mesa de composicao (mundo/janela/camera/regiao editavel), selecao densa com picker+solo, tilemap/brush junto ao stage, objeto -> Logic -> fonte com retorno para objeto e Art -> Scene com contexto preservado. O `qa-rc` final tem evidencias dedicadas `qa-rc-2026-05-02T05-14-22-572Z-*` e gates completos verdes. Mantem-se heuristico onde nao ha AST completo; SGDK **Experimental**; `support_status` inalterado.

**Nota 2026-04-30 (rodada 28, branch `feat/sgdk-vram-residency-streaming-r14`):** picker denso evoluiu de lista para fluxo de selecao mais robusto com **filtro por tipo/contexto** e **spotlight** de isolamento visual no stage. Mantem-se heuristico onde nao ha AST completo; SGDK **Experimental**; `support_status` inalterado; gates verdes — ver `docs/06_AI_MEMORY_BANK.md` checkpoint rodada 28.

**Nota 2026-04-30 (rodada 27, branch `feat/sgdk-vram-residency-streaming-r14`):** picker denso evoluiu para interacao de editor (teclado + preview de hover no viewport), e o retorno **Art -> Scene** passou a preservar contexto operacional (foco de entidade + reentrada em paint quando o alvo e tilemap). Continua **heuristico** onde nao ha AST completo; SGDK **Experimental**; `support_status` inalterado; gates verdes — ver `docs/06_AI_MEMORY_BANK.md` checkpoint rodada 27.

**Nota 2026-04-30 (rodada 26, branch `feat/sgdk-vram-residency-streaming-r14`):** **Shift+clique** com pilha densa abre **lista de escolha** de entidades; faixa tilemap no viewport embute **paleta**; **Logic** com encadeamento **exec** por layout e quick actions extra por **papel importado**; **Inspector** com **multiplas** acoes **Abrir fonte** quando ha varios caminhos. Continua **heuristico** (Fase D, atalhos de graph); SGDK **Experimental**; `support_status` inalterado; gates verdes — ver `docs/06_AI_MEMORY_BANK.md` checkpoint rodada 26.

**Nota 2026-04-30 (rodada 25, branch `feat/sgdk-vram-residency-streaming-r14`):** reforco da **vertical IDE** em cenas importadas: **Alt+clique** no viewport para selecionar entidades empilhadas; **duplo-clique** (tilemap -> pintura; entidade com grafo -> Logic); **faixa de estado** do fluxo tilemap no stage; **Node Graph** com inferencia importada visivel + abertura de **fonte principal**; **Art** com caminho de volta quando nao ha sprite. Continua **heuristico** onde nao ha AST (Fase D); SGDK **Experimental**; `support_status` inalterado; gates verdes — ver `docs/06_AI_MEMORY_BANK.md` checkpoint rodada 25.

**Nota 2026-04-30 (rodada 24, branch `feat/sgdk-vram-residency-streaming-r14`):** acrescenta-se a faixa de **autoria no viewport** quando colisao/mundo excedem 320x224 (atalhos para centro colisao, modo colisao, pan livre vs clamp) e o papel importado **HUD / UI** no grafo Phase D + Hierarchy. O restante da rodada 23 (mundo/camera, cena densa, tilemap, objeto->no->fonte, Art Workspace) mantem-se como workflow **real** mas ainda parcialmente **heuristico** onde nao ha AST. Gates canonicos verdes no host (detalhe numerico em `docs/06_AI_MEMORY_BANK.md` checkpoint rodada 24). SGDK continua **Experimental**; `support_status` inalterado.

**Nota 2026-04-29 (rodada 23):** apos fechar o blocker de OOM do `qa-rc`, a sprint elevou o editor para uso mais operacional em cenas importadas: viewport com mundo/camera e minimapa navegavel, acao explicita para normalizar cena densa, fluxo tilemap -> pintura direto por Hierarchy/Inspector, navegacao objeto->logica->objeto e abertura de fonte real no Inspector, alem da sincronizacao automatica do sprite selecionado no Art Workspace. SGDK continua **Experimental** e `support_status` permanece inalterado; ver `docs/06_CURRENT_WAVE_AI_BANK.md`.

> **DIRETRIZ PARA AGENTES E HUMANOS**
> Este roadmap e a matriz central de maturidade do produto.
> Ele nao substitui o `Memory Bank` como diario operacional, mas passa a ser a referencia permanente para:
> `fases`, `superficies visiveis`, `importadores`, `escopo do MVP` e `status de maturidade`.

---

## Como Ler

- Hierarquia de verdade:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.
- `docs/06_CURRENT_WAVE_AI_BANK.md` guarda cronologia da wave, evidencias recentes e proximo passo.
- Este arquivo guarda a fotografia permanente de escopo e maturidade do produto.
- **Codificacao:** este roadmap e os docs canonicos associados sao mantidos em **UTF-8**; evitar texto com sequencias tipo `canÃ´nico` (mojibake de Latin-1 sobre UTF-8) ao editar.

### Eixos canonicos de leitura


| Eixo          | Valores                                             | Uso                                                           |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Escopo        | `Core MVP`, `Experimental`, `Fora do MVP/Q2`        | Diz se o item conta para o fechamento atual do produto ou nao |
| Implementacao | `Ausente`, `Parcial`, `Em codigo`                   | Diz se a capacidade existe no repositorio hoje                |
| Certificacao  | `Nenhuma`, `Local`, `Institucional`, `Em hardening` | Diz quanta prova real existe para o fluxo afetado             |


### Vocabulario travado

- `Em codigo`: existe no repositorio.
- `Validado localmente`: ha prova local do fluxo afetado.
- `Validado institucionalmente`: ha evidencia canonica da rodada/host institucional.
- `Em hardening`: existe validacao real, mas ainda nao ha barra para chamar de fechado.
- `Experimental`: superficie visivel, parcial ou fora do criterio de fechamento.
- `Fora do MVP/Q2`: nao entra no fechamento atual, mesmo que exista algum codigo.

---

## Estado Executivo Atual

- Data de referencia: `2026-05-13`.
- Leitura honesta: o core MVP esta tecnicamente promovido em `main`, mas o produto amplo continua em hardening nas superficies experimentais.
- O core canonico `Projeto -> Editor -> Build -> ROM -> Emulacao` existe e ja foi provado para `Mega Drive` e `SNES`.
- `Desktop E2E` remoto ficou verde no GitHub/Windows em `2026-04-16` (runs #143/#144, commit `c1a7870`) e foi revalidado no PR #4 em `2026-05-13` para o SHA `d21939c` (`Desktop E2E` pull_request `25788180007`).
- `release:readiness:promotion` foi reexecutado em `main` no commit `91bb8eb354389e370bb59d6a5ae84c21b4a1429f` e retornou `Pronto para promocao: SIM`.
- Superficies `Experimental` reais continuam visiveis, mas nao podem contaminar a leitura do fechamento do MVP.

---

## Bloqueadores Reais

- ~~`Desktop E2E` remoto ainda precisa ficar verde de forma repetivel no runner GitHub/Windows.~~ **Resolvido em 2026-04-16:** runs #143/#144 passaram com 16/16 cenarios.
- ~~A fotografia institucional de promocao precisa ser regenerada no destino de promocao (`main` apos merge).~~ **Revalidado em 2026-05-13 rodada 41:** PR #4 mergeado e `release:readiness:promotion` passou em `main` com `Pronto para promocao: SIM`.
- MSI/portable foram revalidados localmente em `2026-05-11`; precisam continuar sendo revalidados quando o fluxo `Menu inicial -> Criar Projeto` ou packaging mudar.
- ~~A trilha publica ainda precisa refletir o estado real da wave candidata; PR #2 esta `draft/open` e a branch `feat/sgdk-vram-residency-streaming-r14` continua muitos commits a frente de `origin/main`, bloqueio de governanca ate merge.~~ **Resolvido em 2026-05-11 rodada 35:** PR #2 saiu de draft e foi mergeado em `main`.
- Bloqueios de maturidade **locais** para SGDK/Node Stable foram removidos na branch `codex/sgdk-stable-node-engine-blaze` pela prova real descrita acima. Bloqueios restantes sao de governanca/publicacao: commit/push final, PR/checks remotos, merge para `main`, readiness no destino e repeticao da barra ampla institucional.

---

## Fases

A coluna `Certificacao` usa exclusivamente o vocabulario travado deste roadmap:
`Nenhuma`, `Local`, `Institucional`, `Em hardening`.


| Fase                            | Certificacao  | Leitura objetiva                                                                          |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| Fase 0 - Fundacao               | Institucional | Base desktop e estrutura canonica consolidadas                                            |
| Fase 1 - Core Mega Drive        | Em hardening  | Build real, ROM real e emulacao real provados em Windows; hardening continua              |
| Fase 2 - SNES                   | Em hardening  | Pipeline oficial e emulacao oficial provados em Windows; hardening continua               |
| Fase 3 - Visual Logic & RetroFX | Local         | NodeGraph canonico e camada visual existem; superficies ainda heterogeneas                |
| Fase 4 - Camada Pro             | Local         | Patching, profiling, reverse e utilitarios existem, mas nem tudo e criterio de fechamento |
| Fase 5 - Release                | Institucional | PR #2 mergeado e readiness de promocao verde em `main`; repetir quando escopo mudar       |


---

## Matriz de Superficies

A matriz abaixo espelha as superficies perceptiveis do shell atual em `src/App.tsx`, `src/components/viewport/ViewportPanel.tsx` e `src/components/tools/ToolsPanel.tsx`.
Capacidades nao visuais, importadores e itens legados continuam nas secoes proprias deste roadmap.


| Item                                   | Escopo       | Implementacao | Certificacao  | Evidencia atual                                                                                                                                                                            | Bloqueador para subir                                                                   | Conta para fechamento do MVP? |
| -------------------------------------- | ------------ | ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------- |
| Menu inicial / Criacao de projeto      | Core MVP     | Em codigo     | Em hardening  | Wizard endurecido, `manual-qa-status.json` A/F passed e packaging rebuildado em `2026-04-15`                                                                                               | Revalidar MSI/portable e rerodar `qa-rc` sempre que onboarding/wizard mudar             | Sim                           |
| Scene workspace                        | Core MVP     | Em codigo     | Em hardening  | `manual-qa-status.json` A-C/F passed; rodada 29 adiciona evidencias `G-scene-authoring`, `G-dense-solo-authoring` e `G-tilemap-authoring` para composicao, selecao densa e pintura no stage | Manter shell desktop, persistencia e `Desktop E2E` verdes apos mudancas sensiveis       | Sim                           |
| Hierarchy panel                        | Core MVP     | Em codigo     | Local         | Painel dedicado no shell, integracao real em `App.tsx` e cobertura em `HierarchyPanel.test.tsx`                                                                                            | Falta prova institucional dedicada alem da rodada geral do editor                       | Sim                           |
| Layer panel                            | Core MVP     | Em codigo     | Em hardening  | `manual-qa-status.json` A-B/F passed valida LayerPanel, visibilidade, renome e vinculacao                                                                                                  | Rerodar `qa-rc` sempre que fluxo de camadas mudar                                       | Sim                           |
| Inspector panel                        | Core MVP     | Em codigo     | Em hardening  | `manual-qa-status.json` E/F passed prova selecao, edicao de `Pos X` e persistencia no reopen                                                                                               | Repetir prova institucional apos mudancas de selecao/props                              | Sim                           |
| Game workspace / Build & Run           | Core MVP     | Em codigo     | Institucional | `manual-qa-status.json` D passed, `build-report.json` de `2026-04-15`, pipelines MD/SNES provados em Windows e `Desktop E2E` remoto verde em `2026-04-16` (runs #143/#144, 16/16 cenarios) | Rerodar readiness limpo e revalidar MSI/portable quando build/shell mudar               | Sim                           |
| Explorer workspace                     | Core MVP     | Em codigo     | Local         | Workspace real na rail, lazy-load no shell e cobertura em `ExplorerWorkspace.test.tsx`                                                                                                     | Falta prova institucional dedicada no fluxo de projeto                                  | Nao                           |
| Logic workspace / NodeGraph canonico   | Core MVP     | Em codigo     | Em hardening  | `NodeGraphEditor.test.tsx`, `nodeCompiler.test.ts`, emissao SGDK/SNES reais, prova `qa-rc` rodada 29 `G-logic-authoring` e validador rodada 36 para refs/portas/tipos/ciclos              | Refinamento continuo de UX do canvas; sem vender heuristica Phase D como AST completo  | Nao                           |
| ArtStudio workspace                    | Experimental | Em codigo     | Em hardening  | `ArtStudioPanel.test.ts`, backend `photo2sgdk`, prova local de runtime em `build_orch.rs` e prova `qa-rc` rodada 29 `G-art-workspace` com ponte Scene -> Art -> Scene                       | Falta prova institucional `ArtStudio -> build -> runtime`; segue Experimental           | Nao                           |
| RetroFX workspace                      | Experimental | Em codigo     | Local         | `RetroFXDesigner.test.tsx`, persistencia em `scene JSON` e emissao MD/SNES provadas localmente                                                                                             | Falta prova institucional `RetroFX -> build -> runtime`                                 | Nao                           |
| Debug workspace (casca de ferramentas) | Core MVP     | Em codigo     | Local         | Workspace real na rail, alternancia `Tools/Inspector` no shell e cobertura base em `ToolsPanel.test.tsx`                                                                                   | Falta rodada institucional dedicada para a casca completa do workspace                  | Nao                           |
| Paleta Contextual                      | Core MVP     | Em codigo     | Local         | Aba real do `Debug workspace`, descoberta guiada em `App.test.tsx` e suporte a autoria contextual                                                                                          | Falta prova institucional dedicada de authoring pelo painel                             | Nao                           |
| Runtime Setup                          | Core MVP     | Em codigo     | Em hardening  | Aba real do shell, `dependency_manager` ativo no Rust, token GitHub restrito a API oficial, retry/cache de metadata oficial e upstream Windows `success=true` na rodada 36                 | Falta rodada institucional dedicada em host Windows limpo apos alteracoes de toolchain  | Sim                           |
| Patch Studio                           | Core MVP     | Em codigo     | Local         | `patch_studio.rs` real e roundtrip BPS coberto em `src-tauri/src/lib.rs`                                                                                                                   | Falta prova institucional dedicada quando UI/export/apply mudar                         | Nao                           |
| Deep Profiler                          | Core MVP     | Em codigo     | Local         | `deep_profiler.rs` ativo, testes de profile e superficie visivel no `Debug workspace`                                                                                                      | Falta prova institucional dedicada em rodada de playtest/debug                          | Nao                           |
| Asset Browser                          | Experimental | Em codigo     | Em hardening  | `manual-qa-status.json` E passed instancia asset real e preserva selecao no Inspector; rotulo `experimental` na UI alinhado ao roadmap (nao e drift de readiness); fluxo de duplo clique/lista continua coberto em testes de shell onde aplicavel | Manter rotulo e docs sincronizados; QA institucional quando o fluxo de assets mudar     | Nao                           |
| Asset Extractor                        | Experimental | Em codigo     | Local         | Aba real do shell, IPC/backend existentes e cobertura base em `ToolsPanel.test.tsx`                                                                                                        | Falta prova ponta a ponta com ROM real e rodada institucional dedicada                  | Nao                           |
| Memory Viewer                          | Experimental | Em codigo     | Local         | Aba real do shell, leitura de memoria via IPC e cobertura base em `ToolsPanel.test.tsx`                                                                                                    | Falta prova institucional com emulador ativo e ROM real                                 | Nao                           |
| VRAM Viewer                            | Experimental | Em codigo     | Local         | Ferramenta real visivel no shell e integrada ao core ativo                                                                                                                                 | Falta rodada institucional dedicada com ROM/emulador reais                              | Nao                           |
| Reverse Workspace                      | Experimental | Em codigo     | Local         | Aba real do shell, lazy-load provado em `ToolsPanel.test.tsx` e backend de leitura/disassembly/anotacoes existente                                                                         | Falta certificacao de trace/projecao e UX tecnica final                                 | Nao                           |


---

## Matriz de Importadores


| Item             | Escopo         | Implementacao | Certificacao | Evidencia atual                                                                                                                                                                                                                         | Bloqueador para subir                                                                                                         | Conta para fechamento do MVP? |
| ---------------- | -------------- | ------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `sgdk`           | Experimental   | Em codigo     | Em hardening | Fase E provada: desktop E2E `qa-rc` A-G verde (import -> colisao -> persistir -> reabrir -> Build & Run -> ROM `SEGA` verificada). Rodada 19: Scene/Hierarchy/Inspector/Tools passaram a compartilhar contexto de cena/importacao e decisao de instancia auditavel; o gate oficial Windows voltou a fechar no comando canonico mesmo quando `%OS%` nao vem herdado, porque `validate-upstream-windows.ps1` e o launcher do make SGDK em `build_orch.rs` ficaram mais robustos. Preflight, fixture `sgdk_e2e_donor`, smoke idempotente, Fases B-E. **Rodada 14:** caminho MD ganhou analise de residencia/streaming (`analysis_mode`, `asset_total`, `resident`, `streamable`, `dma/frame`) para SGDK gerenciado; matriz de corpus ampliada para estresse (`BLAZE_ENGINE`) com 6 fluxos base + 1 blocker legitimo auditavel. | Fase D parcial (heuristica sem AST); criterio explicito para sair de **Experimental** continua em `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (sem promocao automatica de `support_status`) | Nao                           |
| `mugen`          | Experimental   | Em codigo     | Local        | `import_mugen_project`, wizard dedicado e smoke idempotente em `smoke_import_mugen_project_is_idempotent`                                                                                                                               | Falta prova institucional alem da rodada local                                                                                | Nao                           |
| `ikemen_go`      | Experimental   | Em codigo     | Local        | Perfil proprio no registry, roteado pelo adapter MUGEN, smoke dedicado em `smoke_import_ikemen_go_reuses_mugen_adapter_without_losing_assets`                                                                                           | Falta evidencia institucional dedicada e validacao de metadata propria                                                        | Nao                           |
| `godot`          | Experimental   | Em codigo     | Local        | `import_godot_project`, smoke idempotente em `smoke_import_godot_project_is_idempotent`                                                                                                                                                 | Falta prova institucional alem da rodada local                                                                                | Nao                           |
| `construct`      | Experimental   | Em codigo     | Local        | Registry `importable: true`, `import_construct_project` e smoke idempotente em `smoke_import_construct_project_builds_scene_and_is_idempotent`                                                                                          | Falta prova institucional dedicada e QA manual com projetos Construct reais                                                   | Nao                           |
| `rpg_maker`      | Experimental   | Em codigo     | Local        | Registry `importable: true`, `import_rpg_maker_project` e smoke idempotente em `smoke_import_rpg_maker_project_builds_scene_and_is_idempotent`                                                                                          | Falta prova institucional dedicada e QA manual com projetos RPG Maker reais                                                   | Nao                           |
| `openbor`        | Experimental   | Em codigo     | Local        | Registry `importable: true`, `import_openbor_project` e smoke idempotente em `smoke_import_openbor_project_builds_scene_and_is_idempotent`                                                                                              | Falta prova institucional dedicada e QA manual com projetos OpenBOR reais                                                     | Nao                           |
| `gamemaker`      | Fora do MVP/Q2 | Parcial       | Nenhuma      | Registry com `support_status: Parcial`, ainda nao importavel                                                                                                                                                                            | Falta adapter canonico importavel e escopo aprovado                                                                           | Nao                           |
| `unity_2d`       | Fora do MVP/Q2 | Ausente       | Nenhuma      | Presente apenas como perfil nao suportado no registry                                                                                                                                                                                   | Falta adapter e escopo aprovado                                                                                               | Nao                           |
| `paper2d_bridge` | Fora do MVP/Q2 | Ausente       | Nenhuma      | Presente apenas como perfil nao suportado no registry                                                                                                                                                                                   | Falta adapter e escopo aprovado                                                                                               | Nao                           |


---

## Nao Confundir

- Checklist operacional nao e a mesma coisa que evidencia institucional.
- `Em codigo` nao significa `validado`.
- `Validado localmente` nao significa `pronto para promocao`.
- `Experimental` nao significa `inexistente`; significa `nao elegivel para claim plena`.
- `Fora do MVP/Q2` nao significa `nunca`; significa `nao conta para o fechamento atual`.
- Build por target, importadores, legados e updater continuam relevantes, mas nao entram como linha da matriz de superficies se nao forem perceptiveis como superficie propria no shell.

---

## Roadmap Operacional

### Prioridades imediatas

1. ~~Fechar o `Desktop E2E` remoto no GitHub/Windows e manter o badge honesto.~~ **Resolvido em 2026-04-16.**
2. Regenerar `release-readiness:promotion` em worktree limpo com os artefatos e QA corretos da propria rodada, incluindo o `Desktop E2E` verde.
3. Fechar o gap de governanca com `origin/main` (merge do branch `feat/desktop-e2e-workflow`).
4. Revalidar MSI/portable sempre que onboarding, shell ou wizard mudarem.
5. Continuar o hardening do shell e do primeiro sucesso sem abrir frentes novas antes da hora.
6. Manter todas as superficies `Experimental` claramente fora da leitura de fechamento do MVP ate existir prova correspondente.

### Fora do MVP/Q2

- Docking livre completo como default
- Auto-updater final de producao
- Conversao ampla de gameplay para MUGEN
- Promocao institucional de adapters ainda sem prova suficiente
- Expansoes visuais que concorram com a estabilizacao do fluxo core

---

## Iniciativa de Hardening de Importadores (Sessoes A-E)

**Contexto:** pedido operacional de `2026-04-18` para elevar os 7 importadores preservados (`sgdk`, `mugen`, `ikemen_go`, `godot`, `construct`, `rpg_maker`, `openbor`) de `Experimental` para `Completo e totalmente funcional resiliente a diferentes tipos de projetos`. Em vez de flipar labels, o trabalho foi segmentado em 5 sessoes com evidencia real a cada passo, aderente a governanca deste roadmap (`Experimental nao significa inexistente; significa nao elegivel para claim plena`).

### Sessao A - Fundacao transversal (concluida em 2026-04-18)

Objetivo: estabelecer o minimo canonico para que qualquer importador possa ter evidencia institucional repetivel.


| Entrega                                                                                                                                                                                                                                | Status    | Evidencia                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| 7 fixtures minimas no arsenal de testes (`write_sgdk_fixture`, `write_mugen_fixture`, `write_godot_fixture`, `write_construct_fixture`, `write_rpg_maker_fixture`, `write_openbor_fixture` + compartilhamento do MUGEN para ikemen_go) | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests`         |
| 7 smoke tests de idempotencia (re-import nao duplica scenes/assets)                                                                                                                                                                    | Concluido | `smoke_import_`* (7 testes, todos verdes)               |
| Helper `count_files_in` para assertions de idempotencia                                                                                                                                                                                | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests`         |
| Correcao de 4 initializers faltando `cells` em `TilemapComponent`                                                                                                                                                                      | Concluido | `ast_generator.rs:2367`, `project_mgr.rs:949,1752,5877` |
| Normalizacao da coluna `Certificacao` em 4 valores canonicos                                                                                                                                                                           | Concluido | Este arquivo (Matriz de Superficies/Importadores)       |


**Gate local:** 262 cargo test --lib verdes (incluindo os 7 smoke novos), 232 vitest verdes, clippy clean, Vite build OK.
**Gate institucional:** adiado: `tauri-driver` ausente no host; `cargo install tauri-driver --locked` continua como pre-requisito para `qa-rc`/`e2e-tauri-build-run`.

### Sessao B - Hardening por importador, camada 1 (concluida em 2026-04-18)

Objetivo: cobrir cenarios minimos de resiliencia por importador: diretorio donor vazio, artefato-raiz ausente e leitura tolerante a BOM/CRLF/caminhos Unicode em host Windows.


| Entrega                                                                                                                                                | Status    | Evidencia                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------- |
| 7 testes `*_handles_empty_project_dir` (sgdk, mugen, ikemen_go via dispatcher, godot, construct, rpg_maker, openbor)                                   | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| 7 testes `*_handles_missing_root_artifact` (donor tem arquivos auxiliares mas falta manifesto/ponto-de-entrada canonico)                               | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| 4 testes `*_handles_lossy_text_or_unicode_paths` (godot, construct, rpg_maker, openbor) cobrem BOM UTF-8, CRLF e nomes Unicode NFC plausiveis em NTFS  | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| Helpers `list_project_artifact_files` + `assert_no_import_side_effects` provam que falha nao escreve em `scenes/` ou `assets/`                         | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| ikemen_go validado via `import_external_project("ikemen_go", ...)` preservando `profile.id == "ikemen_go"` e `source_engine == "ikemen_go"` apos falha | Concluido | `ikemen_go_handles_*_via_dispatcher`            |


**Gate local:** `cargo test --lib --test-threads=1` 287/0/3, `cargo clippy -- -D warnings` clean, 232 vitest verde, `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK.
**Escopo respeitado:** nenhum importador foi promovido; `support_status` do registry permanece `Experimental`/`Parcial` exatamente como estava. Non-UTF8 raw filename (nao-Windows) nao foi incluido nesta sessao por nao ser portavel em NTFS; fica opcional sob `#[cfg(unix)]` em futuras rodadas.

### Sessao C - Hardening por importador, camada 2 (pendente)

Objetivo: cobrir variantes reais de projetos encontradas no selvagem.

- `sgdk`: projeto com overlay parcial, projeto sem `rescomp.txt`, projeto multi-scene
- `mugen`/`ikemen_go`: charset `.def` com caracteres acentuados, stage com BG/ANIM multi-frame, DEF faltando assets
- `godot`: projetos Godot 3 (ausencia de `[gd_scene format=3]`), tscn com recursos binarios aninhados, project.godot mal formado
- `construct`: `.c3p` zipado vs `.c3proj` descompactado, plugins customizados nao-Sprite
- `rpg_maker`: MV vs MZ (`.rmmz` vs `.rpgproject`), tilesets com autotile, MapInfos encadeado
- `openbor`: levels com herdado `@import`, chars com frame-offset negativo, stages sem `music`

### Sessao D - Unificacao de `ImportReport` e degradacao graciosa (pendente)

Objetivo: remover assimetria entre `import_sgdk_project` (retorna `Scene` direto) e os demais (`ExternalImportReport`/`MugenImportReport`). Todos os importadores devem expor o mesmo contrato de `ImportReport { primary_scene, imported_scenes, skipped_sources, warnings }`.

- Refatorar `import_sgdk_project` para retornar `SgdkImportReport`
- Introduzir trait `ImportAdapter` com metodo unificado
- Promover `skipped_sources` a cidadao primeiro: cada skip precisa ser rastreavel com motivo (`ParseError`, `UnsupportedVariant`, `MissingAsset`)
- Adicionar log persistido por import em `<projeto>/.rds/import-log-<timestamp>.jsonl`

### Sessao E - QA institucional e promocao controlada (pendente)

Objetivo: transformar evidencia local em evidencia institucional, importador por importador.

- Criar `scripts/qa-import-<target>.ps1` por importador com projeto real anonimizado
- Rodar em host Windows limpo com `tauri-driver` instalado
- Atualizar `manual-qa-status.json` com resultado por importador
- Promover somente os importadores com prova institucional repetivel de `Experimental` para o proximo nivel
- Nunca flipar label sem evidencia correspondente

### Barra de promocao

Um importador **so** pode sair de `Experimental` para uma categoria superior (`Importador Completo`) quando satisfazer, em ordem:

1. Smoke tests canonicos (Sessao A)
2. Testes de resiliencia minima (Sessao B)
3. Testes de variantes reais (Sessao C)
4. `ImportReport` unificado e log persistido (Sessao D)
5. Evidencia institucional em host Windows limpo (Sessao E)

Saltar etapas e explicitamente proibido por governanca deste roadmap.

---

## Programa SGDK Real-World Import

**Contexto:** pedido operacional de `2026-04-18` para levar o importador SGDK de "gera recursos e cena base" para "materializa projeto canonico editavel, preserva rastreabilidade ao doador SGDK, recompila ROM funcional e permite evolucao visual/logica no editor". O programa e SGDK-first e **nao** faz round-trip textual do C legado: migra para o modelo canonico do RetroDevStudio.

Nenhum importador e promovido por esta frente; a barra de promocao continua sendo a "Barra de promocao" acima. O programa existe para encerrar, por classe de projeto, o gap entre importar e `recompilar ROM funcional editavel`.

### Referencias de classe (nao corpus obrigatorio de CI)

Os projetos usados como referencia entram apenas como classes, nao como fixtures promovidas:

- plataforma (estudo)
- platformer engine
- run and gun
- luta / engine
- shmup
- plataforma (extra)

### Matriz de compatibilidade SGDK por capacidade

Matriz de capacidades avaliada por classe de projeto, sem claim inflado.


| Capacidade                                                                                                     | Fase dona | Certificacao atual                   | Observacao                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descoberta de projeto (index de manifests/roots/recursos)                                                      | A         | Em codigo, Local                     | `scan_legacy_sgdk_project` + `find_sgdk_manifest_paths` existem                                                                                                                                                                                                                                                                                                                                          |
| Ingestao de assets (SPRITE/IMAGE/TILESET/MAP/WAV/XGM)                                                          | A         | Em codigo, Local                     | `import_sgdk_resources_into_scene` com idempotencia validada                                                                                                                                                                                                                                                                                                                                             |
| `SgdkImportReport` rico (primary_scene, imported_scenes, skipped_sources, warnings, fallbacks, source_summary) | A         | Em codigo, Local                     | Retorna relatorio estruturado e paridade com demais adapters                                                                                                                                                                                                                                                                                                                                             |
| Manifesto de import `.rds/imports/sgdk/*.json`                                                                 | A         | Em codigo, Local                     | Fingerprint do doador + mapeamento recurso->asset gravado                                                                                                                                                                                                                                                                                                                                                |
| Sintese de cenas (multiplas cenas / niveis)                                                                    | B         | Local (2026-04-18 rodada 4)          | Cada tilemap anchor IMAGE/TILESET/TILEMAP/MAP vira cena propria em `scenes/<slug>.json`; primaria mantem sprites+audio+camera em `scenes/main.json`                                                                                                                                                                                                                                                      |
| Tilemap real com `cells[]` a partir do doador                                                                  | B         | Local (2026-04-18 rodada 4)          | `extract_sgdk_tilemap_cells` faz dedupe 8x8 via HashMap<[u8;256], u32> com fallback explicito preservado quando PNG indisponivel/<8x8/totalmente transparente                                                                                                                                                                                                                                            |
| `SceneLayer` coerente (cenario, gameplay, HUD, parallax)                                                       | B         | Local (2026-04-18 rodada 4)          | `derive_sgdk_scene_layers` emite `layer_background` (tile, depth 0), `layer_gameplay` (sprite, depth 10), `layer_audio_objects` (object, depth 20, locked=true); HUD/parallax nao inventados                                                                                                                                                                                                             |
| Animacoes editaveis em `SpriteComponent.animations`                                                            | C         | Local (2026-04-19 rodada 5)          | `derive_sgdk_sprite_sheet_from_rescomp_png` materializa animacoes a partir da grelha rescomp (SGDK `bin/rescomp.txt` SPRITE); timer SGDK=0 gera aviso + fps=8 so para preview no editor; fallback explicito se PNG/parametros nao alinharem                                                                                                                                                              |
| Colisao canonica (`CollisionMap`)                                                                              | C         | Local (2026-04-19 rodada 5)          | `derive_sgdk_scene_collision_map_from_tile_cells`: solido onde indice de tile != 0 (indice 0 = tile totalmente transparente do dedupe 8x8); mensagem rastreavel no report/ledger; cenas secundarias com cells recebem o mesmo                                                                                                                                                                            |
| Logica importavel (`graph_ref` + `logic_hints` + `external_source_ref`)                                        | D         | Parcial, Local (2026-04-19 rodada 8) | Rodada 7 + `phase_d.cross_unit_function_refs` / `entity_spr_local_signal_hits`; stencil shmup/run-and-gun em secundario quando SPR_* + identificador do recurso na mesma linha; `deserializeNodeGraph` alinha portos ao editor e filtra arestas quebradas; testes `sgdk_phase_d_platformer_horizontal_scan_fixture_class`, `sgdk_phase_d_resolve_prefabs_hydrates_secondary_graph_ref`; sem AST completo |
| Build funcional (import -> salvar -> reabrir -> ROM funcional) | E | Local (2026-04-21 rodada 10) | Preflight verde no host; `qa-rc` A-G reprovado e recuperado no mesmo host; fix canonico no runner para forcar build debug via Tauri CLI em `qa-rc` (evita bootstrap `localhost` do direct-cargo); cadeia SGDK confirmada com evidencias (`manual-qa-status.json` + screenshot bloco G). Sem promocao institucional e sem mudar `support_status` |
| Reimport controlado / idempotente                                                                              | A         | Em codigo, Local                     | Smoke idempotente cobre assets/scene; manifesto agora cobre ledger                                                                                                                                                                                                                                                                                                                                       |

### Rodada 12 - Corpus real SGDK (matriz por titulo)

Checklist operacional para sair de fixture/E2E controlado e registrar compatibilidade por projeto real (import -> report/ledger -> cenas -> tilemaps -> animacoes -> collision map -> `graph_ref` -> salvar/reabrir -> build/ROM), com resultado **Passou** / **Parcial** / **Falhou** e blocker concreto.

- **Documento vivo:** `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (seis pastas sob `F:\Projects\MegaDrive_DEV\SGDK_Engines`, existencia verificada no host desta rodada).
- **Gates do repositorio (rodada 12):** `check:tree`, `tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1` verdes; suite `cargo test sgdk_matrix_corpus_ ... --ignored` com contrato `stamp_imported_sgdk_metadata` + `source_kind`.

### Rodada 13 - Resolver de raiz SGDK e matriz 6/6

- **Codigo:** `resolve_sgdk_import_root` em `src-tauri/src/core/project_mgr.rs` (BFS limitada, candidatos explicitos, sem mascarar doador invalido como raiz direta).
- **Matriz:** seis titulos com fluxo parcial completo ate ROM `SEGA` no host de referencia; linha 2 documentada com `mddev_reference_redirect`.
- **Gates (rodada 13, host local):** `check:tree`, `lint`, `tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `cargo test sgdk_matrix_corpus_ ... --ignored --test-threads=1` (6/6), `npm run preflight:sgdk-e2e`, `npm run test:e2e:desktop:qa-rc`.
- **Estado honesto:** SGDK permanece **Experimental**; criterio de suporte completo na matriz ainda exige leitura governada por colunas (ex.: Collision **Parcial** em varias linhas) e decisao explicita futura sobre `support_status`.

### Rodada 14 - VRAM residency / streaming (Mega Drive)

- **Codigo canonico:** `md_profile.rs` agora separa volume total de assets e conjunto residente simultaneo, com modo `native_static` vs `sgdk_managed`.
- **Regra aplicada:** em SGDK gerenciado, excesso apenas no total streamavel não bloqueia sozinho; overflow de residente continua fatal; warnings distinguem `total`, `resident`, `streamable` e `dma/frame`.
- **Auditoria de build:** `build_orch.rs` emite linha `MD VRAM analysis` no log para rastreabilidade de QA.
- **Corpus:** `Metal Slug` e `Mortal Kombat` passam com ROM `SEGA` e budget auditável; `BLAZE_ENGINE` adicionado como estresse com bloqueador fatal legítimo (sem promoção de status).
- **Estado honesto:** SGDK segue **Experimental**.

### Rodada 15 - Breakdown de residência VRAM (Mega Drive / QA)

- **Modelo:** `HwStatus` e `md_profile` expõem composição por categoria (`sprite_resident_bytes`, `tilemap_resident_bytes`, `hud_resident_bytes`, `streamable_sprite_bytes`, `animated_swap_bytes`, `dma_frame_bytes`) mais contadores `banks`/`cells` da heurística `sgdk_managed`.
- **Build / validação:** logs e avisos `[SGDK Gerenciado]` incluem os mesmos eixos para responder "o que está residente e por quê" sem alterar a regra de fatalidade (overflow residente real, sprite overflow real).
- **UI:** `HardwareLimitsPanel` mostra linha compacta de QA (somente target Mega Drive).
- **Estado honesto:** SGDK segue **Experimental**; sem mudança de `support_status`.

### Fases

- **Fase A - Importador estrutural.** Projeto SGDK grande abre sem colapsar em cena opaca; gera manifesto `.rds/imports/sgdk/*.json`; reimport idempotente e auditavel; `SgdkImportReport` rico.
- **Fase B - Cena e assets. (concluida em 2026-04-18 rodada 4.)** Tilemaps relevantes viram `cells[]` (dedupe 8x8, indices 1-based, fallback explicito preservado quando reconstrucao impossivel); multiplas cenas e `SceneLayer` coerentes aparecem na Hierarchy via `listScenes`/`switchScene` (sem mudanca de frontend). Evidencia: inventario `scenes[]` por role no ledger SGDK (introduzido como `sgdk-import/v2` na rodada 4; o repo hoje persiste `sgdk-import/v4` como superset retrocompativel com `phase_c` + `phase_d`); `SgdkImportReport` ganhou `primary_scene_path` + `additional_scenes`; +6 testes Fase B (`sgdk_phase_b_import_populates_tilemap_cells_from_png`, `*_builds_multi_scene_when_multiple_tilemap_anchors_exist`, `*_derives_scene_layers_grouping_entities_coherently`, `*_keeps_explicit_fallback_when_tilemap_source_is_too_small`, `*_ledger_persists_scene_inventory_and_bumps_schema_version`, `*_reimport_multi_scene_is_idempotent_and_does_not_duplicate_scene_files`); teste existente `*_exposes_rich_fields_and_persists_ledger` reescrito para assertar ausencia do fallback "cells[] vazio" quando PNG permite reconstrucao. Gates locais da rodada 4: `cargo test --lib` 295/0/3 (+8), `cargo clippy -- -D warnings` clean, 232 vitest, check:tree/lint/tsc OK. SGDK continua `Experimental`; promocao continua bloqueada por Fases C+D+E.
- **Fase C - Animacao e colisao. (concluida no caminho canonico + fixtures em 2026-04-19 rodada 5.)** `SpriteComponent.animations` derivados da folha PNG alinhada ao SPRITE rescomp; `CollisionMap` na `Scene` quando `cells[]` existe; ledger `sgdk-import/v4` inclui bloco `phase_c`; reimport idempotente coberto (`sgdk_phase_c_reimport_preserves_sprite_animations_and_collision_map`). Barra (classe real plataforma+luta) continua em QA manual fora do CI.
- **Fase D - Logica jogavel. (parcial; hardening multi-ficheiro + auditoria TU em 2026-04-19 rodada 8.)** Rodada 7 + evidencia `func(` entre ficheiros escaneados (`cross_unit_function_refs`) e toques SPR locais por recurso (`entity_spr_local_signal_hits`); materializacao de classe alta tambem em sprite secundario quando ha prova textual SPR+identificador; editor hidrata `graph_ref` com portos canonicos; testes `sgdk_phase_d_platformer_horizontal_scan_fixture_class`, `sgdk_phase_d_resolve_prefabs_hydrates_secondary_graph_ref` e multificheiro RG estendido; sem AST completo.
- **Fase E - Build funcional. (provada localmente no host em 2026-04-21 e rerodada em 2026-04-23 pos `d24cf14`.)** Preflight explicito de `toolchains/sgdk`, `tauri-driver` e msedgedriver segue ativo; `qa-rc` A-G foi reprovado e recuperado no host real, com correcao canonica no runner para forcar build debug via Tauri CLI no cenario `qa-rc` (evita bootstrap `localhost` observado com direct-cargo). Mantem-se sem claim institucional: exige repeticao em host limpo/CI e SGDK segue `Experimental`.

### Gates por rodada

Adicionais aos gates gerais deste roadmap, aplicados sempre que o programa avancar:

- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- `npm run preflight:sgdk-e2e`
- `npm run test:e2e:desktop:qa-rc`

### Nao confundir

- Esta frente **nao** e reescrita textual do C doador; o objetivo e migrar para o modelo canonico.
- Compatibilidade "totalmente funcional" se obtem por classe de projeto, nao em um salto unico.
- Os seis titulos do corpus real estao na matriz `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`; o CI continua protegido por fixtures minimas e smoke ate a matriz fechar com **Passou** repetivel por titulo.

---

## Regra de Atualizacao

- Atualize este roadmap quando mudar o estado real de uma fase, superficie visivel ou importador.
- Nova superficie visivel no produto exige linha nova na `Matriz de Superficies` antes de qualquer claim de entrega.
- Novo importador no registry exige linha nova na `Matriz de Importadores` antes de qualquer claim de entrega.
- Um item nao pode continuar descrito como `planejamento` se o codigo o marcar como `importable: true`.
- Um item nao pode sair de `Experimental` sem evidencia institucional e sem alinhamento de UI, docs e backend.
- `README.md` nao deve manter claims de readiness mais especificas ou mais otimistas do que este arquivo.
