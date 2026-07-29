# Diagnostico Profundo - RetroDev Studio
**Data:** 2026-07-28
**Host:** Linux (Manjaro), checkout `/mnt/sdcard/Projects/RetroDevStudio`
**Branch analisada:** `codex/w7-4-blastem-parity` (33 a frente / 30 atras de `origin/main`)
**Metodo:** leitura dos docs canonicos (06 Memory Bank, 03 Roadmap, 06 Current Wave, 01 PRD, 07 Test&Compliance, 10 QA, 11 Cross-Platform) + verificacao factual no codigo, no Git e no GitHub. Gates reexecutados neste host.

> Este documento e um diagnostico, NAO um documento canonico. Nao promove superficie, nao altera maturidade e nao substitui `docs/06_AI_MEMORY_BANK.md`.
> Em conflito, prevalecem `docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

---

## 0. Acoes Ja Tomadas Sobre Este Diagnostico (2026-07-28)

| # | Achado | Acao | Estado |
|---|---|---|---|
| 1 | CI remoto morto por billing | Repositorio tornado **publico** pelo usuario; rerun confirmou jobs executando com `runner_id` real e 18-20 steps | **RESOLVIDO** |
| 2 | `reproducibility-program` orfa | PR #29 aberto contra `main`, com 2 correcoes: pin `brace-expansion` envelhecido (advisory GHSA-mh99-v99m-4gvg) e teste de host nao hermetico | Em convergencia |
| 3 | Rodada 83 nao commitada | Verificado que o PR #25 (ja em `main`) e superconjunto estrito: mesmo guard por revisao, **mais** guard por `generation`, guard por `projectDir` e contrato `SceneDraftReceipt`. Alteracoes locais descartadas apos backup em `.claude/cleanup-backups/rodada83-uncommitted-*.patch` | **RESOLVIDO** |
| 4 | Branches divergentes | Ordem de convergencia definida: PR #29 -> PR #28 -> PR #23 (rebase) -> `ui-overhaul-fase-a` | Em andamento |

**Achado adicional durante a execucao (nao estava no diagnostico original):** a raiz do repositorio hospeda **10 worktrees git vivos** em `.codex/worktrees/`, `.worktrees/` e `.claude/worktrees/` (~112.000 arquivos). Duas tinham trabalho nao commitado, incluindo **~4.000 linhas de UI nao commitadas** em `.worktrees/ui-overhaul-fase-a` (Fase B: `Tabs.test.tsx`, `ViewportPanel.test.tsx`, `gameViewportScale.test.ts` e 28 arquivos modificados). Tudo preservado em `.claude/cleanup-backups/ui-overhaul-faseB-*`. Isso agrava o Gap #1 e e a causa real da falha local de `check:tree` — nao residuo de ferramenta, como se supunha.

---

## 1. Veredito Em Uma Frase

O produto tem **massa critica de engenharia real** (137k linhas, 86 comandos IPC, fluxo `Build -> ROM -> Emulacao` provado com toolchain oficial), mas **nao esta a caminho de "concluido"** porque quatro linhas de trabalho vivas nunca convergiram para `main`, o CI remoto esta morto por billing desde 2026-07-17, e a prova real do produto vive em 29 testes `#[ignore]` que so rodam num host Windows especifico. O gap dominante hoje **nao e falta de feature — e falta de convergencia e de reprodutibilidade**.

---

## 2. O Que Esta Verde (verificado agora, neste host)

| Gate | Resultado |
|---|---|
| `npm run lint` | **PASS** (0 warnings) |
| `npx tsc --noEmit` | **PASS** |
| `npm test` | **PASS** — 49 arquivos, **475 passed / 6 skipped** |
| `npm run check:tree` | **FAIL** — apenas por `.codex/` e `.worktrees/` nao declarados |
| `cargo clippy --lib -D warnings` | **PASS** (rebuild completo do target Linux, 17m27s) |
| `cargo test --lib` | interrompido para liberar o checkout; delegado a CI, que agora executa |

Sinais positivos objetivos:

- **Higiene de codigo excepcional para o tamanho:** 1 unico TODO/FIXME/`unimplemented!` em ~137.000 linhas (58.385 TS/TSX + 79.189 Rust).
- **Superficie funcional real:** 86 comandos Tauri expostos, cobrindo projeto, cena, build multi-target, emulador (save state, load state, rewind, replay, memoria, input), ROM analysis, disassembly, xrefs, call graph, patch IPS/BPS, parity, importadores.
- **Disciplina de honestidade documental acima da media:** o Memory Bank corrige as proprias alegacoes falsas (rodada 80 corrigindo a rodada 79), separa `Experimental` de `Stable`, e o roadmap tem vocabulario travado. Isso e um ativo raro.
- **Emulacao e evidencia real:** parity cross-core executado com dois cores Libretro reais (Genesis Plus GX + BlastEm), divergencia reportada como divergencia — nao mascarada.

---

## 3. Gap #1 — Fragmentacao De Integracao (BLOQUEADOR ESTRUTURAL)

`main` parou em **2026-07-13** (`e700477`). Desde entao o trabalho real acontece em branches que nunca voltam:

| Branch | Commits a frente de main | Atras de main | PR | Estado do PR |
|---|---|---|---|---|
| `codex/ui-overhaul-fase-a` | 36 | 30 | **nenhum** | — |
| `codex/w7-4-blastem-parity` (atual) | 33 | 30 | #23 | **DRAFT + CONFLICTING**, aberto ha 1 mes |
| `codex/gameplay-parity-slice` | 16 | 0 | #28 | OPEN, checks FAILURE |
| `codex/reproducibility-program` | 7 | 0 | **nenhum** | — |

Consequencias concretas:

1. **`ui-overhaul-fase-a` esta empilhada sobre `w7-4-blastem-parity`** — herda os 33 commits nao mergeados. Se a base nunca entrar, a UI nova tambem nao entra.
2. **`reproducibility-program` esta orfa e e a mais estrategica das quatro.** Ela entrega exatamente o que falta para o produto ser distribuivel: `src-tauri/Cargo.lock` versionado, `rust-toolchain.toml`, `.node-version`, `.npmrc`, `.gitattributes`, `NOTICE` (licencas), `toolchains/host-requirements.lock.json` (999 linhas de contrato de provisionamento), e os scripts `host:diagnose` / `host:ensure` / `host:certify` / `security:audit` / `security:licenses` / `architecture:metrics`. **Nada disso esta em `main`.**
3. **Trabalho duplicado ja aconteceu:** a rodada 83 (nao commitada, na sua working tree) implementa um guard de race condition no `HierarchyPanel`; PR #25 — que resolveu o mesmo P0 por outro caminho — ja foi mergeado em `main` em 2026-07-10. As duas solucoes coexistem em universos separados.
4. **Working tree suja com 233 linhas reais escondidas em ~19.000 linhas de churn de CRLF.** `git diff --stat` mostra 9.200 insercoes; `git diff --ignore-cr-at-eol --stat` mostra 233. O `.gitattributes` que resolve isso existe... na branch orfa `reproducibility-program`.

---

## 4. Gap #2 — CI Remoto Morto (BLOQUEADOR EXTERNO)

Todos os runs de GitHub Actions desde **2026-07-17** falham em 4-5 segundos, com `runner_id=0` e zero steps executados. Causa registrada no proprio repo (`4cd843d docs(repro): record external Actions billing blocker`): **falha de pagamento ou limite de gastos na conta GitHub**. Nao e falha de codigo nem de YAML.

Impacto:

- PR #28 e PR #23 mostram `validate` e `desktop-smoke` como FAILURE — o que **nao** significa regressao de codigo, mas torna impossivel distinguir falha real de falha de infraestrutura.
- O `desktop-e2e.yml` — que a documentacao canonica define como **a evidencia institucional** quando o host local falha em WebDriver — esta indisponivel.
- Nenhum merge governado pode acontecer enquanto isso durar, porque a barra do projeto exige checks remotos verdes.

Alem do billing, o CI tem um gap arquitetural: **`ci.yml` e `desktop-e2e.yml` rodam exclusivamente em `windows-latest`.** Nao existe job Linux, apesar de a Fase 5 do `docs/11_CROSS_PLATFORM_PLAN.md` prever `linux-validate` e de o desenvolvimento atual acontecer em Linux.

---

## 5. Gap #3 — A Prova Do Produto Nao E Reproduzivel

Este e o gap mais profundo e o menos visivel.

**29 testes Rust estao marcados `#[ignore]`** — e sao exatamente os que provam que o produto faz o que promete:

- `official_sgdk_nocode_game_builds_and_runs_with_real_toolchain` (Mega Drive no-code -> ROM -> emulacao)
- `official_snes_nocode_game_builds_and_runs_with_real_toolchain` (SNES equivalente)
- `sgdk_corpus_real_build_rom_emulation_report` (o corpus de 122 projetos, base da alegacao "68 builds reais")
- `sgdk_matrix_corpus_*` (7 titulos reais: Platformer 2, NEXZR MD, BLAZE_ENGINE, Metal Slug, Mortal Kombat, Shadow Dancer)
- `gamemaker_vertical_compatibility_harness_basic_platform`, `openbor_*`, `import_godot_real_host_projects_*`
- `parity_fixture_control/positive/negative`, `w7_4_cross_core_real_parity_*`, `reference_candidate_real_core_*`

Esses testes dependem de:

- **171 referencias hardcoded a caminhos `F:\...`** no codigo-fonte (`F:\Projects\MegaDrive_DEV\SGDK_Engines`, `F:\Projects\Game Maker\...`, `F:\Projects\Godot\...`).
- Toolchains instaladas manualmente e nao versionadas.
- Um host Windows especifico que hoje esta congelado (a documentacao registra "Windows limpo, UAC, MSVC, Git Bash, Edge/WebDriver seguem sem evidencia desta rodada").

**Efeito pratico:** as alegacoes mais fortes do produto ("122 projetos processados, 68 com ROM e emulacao real", "SGDK Stable local: SIM") **nao podem ser reverificadas por ninguem que nao seja voce, nessa maquina, com esse disco F:**. Se aquele host sumir, a evidencia sumiu junto. Isso e uma divida de reprodutibilidade, nao de codigo.

O contrato `toolchains/host-requirements.lock.json` + `npm run host:certify` da branch `reproducibility-program` e a resposta certa para isso — e esta fora de `main`.

---

## 6. Gap #4 — Release Engineering Ausente

O produto nao pode ser entregue a um usuario final hoje. Verificado em `src-tauri/tauri.conf.json` e `release-manifest.json`:

| Item | Estado real |
|---|---|
| Assinatura de codigo | `signed: false`, `status: "unsigned"` — sem certificado |
| Auto-updater | `pubkey: "PLACEHOLDER_UPDATER_PUBKEY_BLOCKED_BY_NO_NEW_DEPS"`, endpoint `https://updates.retrodevstudio.example.invalid/...`, `createUpdaterArtifacts: false`, status `deferred` |
| Bundles | apenas `["msi"]` — sem `deb`, `appimage`, `dmg` |
| `Cargo.lock` | **gitignored** em `main` (`.gitignore:19`) — build Rust nao e reproduzivel |
| Versao | `0.1.0` desde sempre; sem canal, sem tag, sem release publicada |
| `release-readiness.json` | ultimo de **2026-06-28**, `readyForPromotion: false` |
| `release-manifest.json` | de **2026-06-24**, aponta para a branch `codex/main-user-flow-hardening` |
| Licenca | README diz "Proprietaria"; `NOTICE` de terceiros so existe na branch orfa. Core BlastEm e **GPLv3** — a propria doc marca "revisao obrigatoria antes de redistribuicao" |

Ha tambem uma pendencia legal nao resolvida: o app depende de cores Libretro cujas licencas (GPLv3 no caso do BlastEm) sao incompativeis com distribuicao proprietaria sem analise. Isso precisa de decisao antes de qualquer release, nao depois.

---

## 7. Gap #5 — Escopo Funcional x PRD

O `docs/01_PRD_MASTER.md` define tres camadas (Core / Pro / Enterprise). Mapeando contra o codigo real:

### Camada Core — em grande parte presente
Scene View, Game View, Hierarchy, Inspector, Prefabs (`resolve_scene_prefabs`), Asset Browser, Undo/Redo, Grid Snap, Live Hardware Monitor, UGDM, NodeGraph (~35 tipos de node reais), Hardware Constraint Engine (VRAM/sprites/DMA/paletas), RetroFX, emulador integrado.

**Ausentes na camada Core:**
- **Hot Reload** — 0 ocorrencias no codigo.
- **Debugger com breakpoints** — 0 ocorrencias. `frame_step` — 0 ocorrencias. O emulador tem save state/rewind/replay, mas nao tem depuracao.
- **Gizmos** — praticamente inexistentes (2 referencias).
- **Autoria de audio** — **nao existe workspace de som.** Sao 7 workspaces (Scene, Game, Explorer, Logic, Art, FX, Debug) e nenhum e audio. `audio_pipeline.rs` faz apenas *inspecao* de arquivos WAV em `assets/audio` e emite warnings; nao ha tracker, nao ha editor XGM, nao ha design sonoro. Para um produto que se propoe "a Unity dos 16 bits", **audio e um buraco de primeira grandeza** — o proprio estudo de UI ja identificou "Som" como workspace faltante.

### Camada Pro — parcial, quase toda `Experimental`
Portabilidade assistida, asset converter, ROM analyzer, patch studio, reverse explorer, deep profiler, multi-target build, replay determinístico: existem em codigo, **nenhum com certificacao institucional**. Behavior Reconstruction Assistant: nao implementado.

### Camada Enterprise — **inexistente**
- Plugin Marketplace: **0** ocorrencias.
- Knowledge Engine (docs embarcadas, tutoriais interativos, hardware theory mode): **0**.
- Team Collaboration: **0**.
- Compliance Layer: parcialmente atendida (BYOR, patches IPS/BPS).
- Versioned Project System: `schema_version` existe, mas nao ha sistema de migracao explicito.

### Camada de IA (secao 5 do PRD) — **inexistente no runtime**
Nenhuma integracao LLM no app. As unicas mencoes a LLM sao no plano de decompilacao — e la estao explicitamente **BLOQUEADAS ate GO formal**.

### Faltando transversalmente
- **i18n / localizacao:** zero. A UI mistura portugues e ingles hardcoded (`"Composicao e edicao da cena"`, workspace `"Scene"`). Um produto internacional precisa disso; um produto so em PT-BR precisa ao menos de consistencia.
- **Acessibilidade:** so comeca a ser tratada na branch `ui-overhaul-fase-a` ("add accessible dialogs").
- **Telemetria/crash reporting:** ausente (coerente com a postura de privacidade, mas e uma escolha a registrar).

---

## 8. Gap #6 — Maturidade Declarada

O proprio roadmap responde a pergunta "quanto falta": na **Matriz de Superficies**, de 36 linhas avaliadas, **apenas 7 contam para o fechamento do MVP** e 29 sao explicitamente "Nao".

Superficies ainda `Experimental` (lista do readiness): ArtStudio, RetroFX, Asset Extractor, Reverse Explorer, Memory Viewer, importadores MUGEN / Godot / Ikemen GO — mais Asset Browser, NodeGraph/SGDK Visual No-Code, Gameplay Parity, Cross-Core Parity, Cycle Report, GameMaker, Construct, RPG Maker, OpenBOR, decompilacao pareada.

O programa de promocao de importadores (Sessoes A-E do roadmap) esta **parado na Sessao C**: A e B concluidas em 2026-04-18; **C (variantes reais), D (`ImportReport` unificado) e E (QA institucional) permanecem pendentes ha mais de 3 meses.** Nenhum dos 7 importadores pode sair de `Experimental` sem elas — regra do proprio roadmap ("saltar etapas e explicitamente proibido").

---

## 9. Gap #7 — Riscos Estruturais De Codigo

Nao sao bugs, sao riscos de manutencao que ficarao caros na fase de fechamento:

| Arquivo | Linhas | Risco |
|---|---|---|
| `src-tauri/src/core/project_mgr.rs` | **24.403** | God module: projetos, cenas, TODOS os importadores (SGDK, MUGEN, Godot, Construct, RPG Maker, OpenBOR, GameMaker), ledgers, tilemaps, colisao. Qualquer mudanca em importador toca o mesmo arquivo — causa direta dos conflitos de merge entre agentes paralelos. |
| `src-tauri/src/lib.rs` | 8.186 | 86 comandos IPC num arquivo so |
| `src/components/viewport/ViewportPanel.tsx` | 5.458 | viewport + emulador + colisao + pintura |
| `src/App.tsx` | 5.191 | shell, roteamento por estado, menus, wizard, command palette |
| `src/App.test.tsx` | 4.359 | 70 testes num arquivo |

`project_mgr.rs` sozinho e ~31% de todo o backend Rust. A branch `reproducibility-program` ja reconheceu isso (adicionou `scripts/architecture-metrics.mjs` e extraiu `project_asset_scope.rs`) — de novo, fora de `main`.

---

## 10. Gap #8 — Deriva Documental

| Documento | Ultima revisao | Deriva observada |
|---|---|---|
| `README.md` | — | Aponta `main` em `a3135707` (PR #5, 2026-05-18). `main` real: `e700477` (PR #27, 2026-07-13). **22 PRs de defasagem.** |
| `docs/10_QA_ROTEIRO_RC.md` | 2026-04-04 | Roteiro A-F; o pipeline ja usa A-H |
| `docs/03_ROADMAP_MVP.md` | 2026-06-28 | Nao registra rodadas 78-83 nem o programa de reprodutibilidade |
| `docs/06_AI_MEMORY_BANK.md` | 2026-07-10 | Diz "PR #25 permanece DRAFT" — PR #25 foi **MERGEADO** em 2026-07-10 |
| `docs/12_DECOMPILACAO_PAREADA_PLANO.md` | 2026-07-08 | mais recente que o roadmap que deveria governa-lo |

Ha tambem **duplicacao dentro dos proprios docs**: `docs/07_TEST_AND_COMPLIANCE.md` secao 3 tem os itens 11-17 listados duas vezes com numeracao conflitante; `docs/03_ROADMAP_MVP.md` tem linhas duplicadas para `sgdk`, `mugen`, `ikemen_go`, `openbor` e `gamemaker` na Matriz de Importadores. Isso e sintoma de merge documental sem curadoria.

---

## 11. Caminho Para "Concluido" — Ordem Sugerida

A ordem importa: os itens 1-3 destravam todo o resto e nao dependem de escrever feature nova.

### Onda 0 — Destravar (dias, nao semanas)
1. **Resolver o billing do GitHub Actions.** Sem isso nada pode ser mergeado sob a governanca do proprio projeto. E acao sua, externa ao codigo.
2. **Mergear `codex/reproducibility-program` primeiro** (0 commits atras de main, sem conflito). Isso traz `.gitattributes` — que **elimina o churn de CRLF** — mais `Cargo.lock`, `rust-toolchain.toml`, `NOTICE` e o contrato de host. Todo merge subsequente fica mais barato.
3. **Convergir as outras tres branches** na ordem: `gameplay-parity-slice` (#28, ja mergeable) -> `w7-4-blastem-parity` (#23, precisa rebase, esta CONFLICTING) -> `ui-overhaul-fase-a` (rebase apos a base entrar).
4. **Decidir o destino da rodada 83 nao commitada**: main ja tem a correcao do PR #25 para o mesmo P0. Escolher uma implementacao e descartar a outra explicitamente.
5. Adicionar `.codex/` e `.worktrees/` ao `.gitignore` ou a `docs/08_TREE_ARCHITECTURE.md` — `check:tree` volta ao verde.

### Onda 1 — Reprodutibilidade (semanas)
6. **Eliminar as 171 dependencias de `F:\`**: converter para variaveis de ambiente (`RDS_SGDK_CORPUS_ROOT` ja existe — estender o padrao) e documentar em `host-requirements.lock.json`.
7. **Job `linux-validate` no CI** (Fase 5 do plano cross-platform, ja especificado, so falta aplicar).
8. **Promover um subconjunto dos 29 testes `#[ignore]` para CI**, com fixtures BYOR-safe sinteticas. Meta minima: `official_sgdk_nocode_game_builds_and_runs_with_real_toolchain` e o equivalente SNES rodando no runner, nao no seu disco.
9. Fechar **Sessao C/D/E** do programa de importadores — ou, alternativa honesta, **cortar escopo**: declarar 2-3 importadores como alvo de promocao e mover o resto para "Fora do MVP/Q2".

### Onda 2 — Produto (meses)
10. **Workspace de audio** — o maior buraco funcional do Core. Sem ele nao existe "jogo completo sem sair do app".
11. **Debugger real** (breakpoints, frame stepping) — hoje o emulador integrado nao depura.
12. **i18n** e consolidacao de idioma da UI.
13. Quebra de `project_mgr.rs` por importador (reduz conflito entre agentes paralelos de forma estrutural).

### Onda 3 — Distribuicao
14. Decisao de licenciamento (GPLv3 dos cores x README "Proprietaria") — **antes** de empacotar.
15. Certificado de assinatura, canal de release, chave real do updater, bundles Linux (`deb`/`appimage`).
16. Rodada institucional completa: `release:readiness:promotion` verde em `main` limpo, com QA A-H fresco.

### Onda 4 — Fora do MVP (decisao de produto)
Camada Enterprise (marketplace, knowledge engine, colaboracao) e camada de IA do PRD nao existem em nenhuma forma. **Recomendacao honesta: nao trate isso como "faltando para concluir".** Trate como PRD v4.0 sendo uma visao de 3-5 anos, e reescreva o criterio de "produto completo" para a v1.0 real — senao o projeto nunca fecha por definicao.

---

## 12. Recomendacao Central

O maior risco deste projeto hoje **nao e tecnico, e de convergencia**. Ha quatro frentes de trabalho competente rodando em paralelo, cada uma com gates locais verdes, nenhuma delas em `main` — enquanto `main` esta parado ha 15 dias e o CI que arbitraria a integracao esta desligado por uma questao de faturamento.

A engenharia esta boa. A honestidade documental esta acima da media do setor. **O que falta e fechar o ciclo: destravar o CI, mergear a branch de reprodutibilidade, convergir as demais, e so entao voltar a escrever feature.** Continuar abrindo frentes antes disso multiplica o custo de integracao a cada rodada.

Segunda recomendacao, igualmente importante: **redefina "produto completo"**. O PRD atual descreve uma plataforma que nenhum time deste tamanho fecha. Um `docs/01_PRD_MASTER.md` com um recorte v1.0 explicito — provavelmente Core + parte da Pro, Mega Drive Stable, SNES em hardening, 2 importadores promovidos, audio incluido — transformaria "quanto falta?" numa pergunta com resposta.
