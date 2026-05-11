# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-05-11 (rodada 33 - hotfix CI desktop remoto verde; PR #2 draft; promocao bloqueada por merge/main)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-05-11 (rodada 33)`, na branch `feat/sgdk-vram-residency-streaming-r14`, o hotfix `7bf026b` (`fix(e2e): harden live stale and toolbar overflow`) foi commitado e pushado. Ele corrige o estado `DESATUAL.` imediato apos edicao de cena validada, ajusta o oraculo E2E para revalidacao que completa rapido e impede que widgets informativos da topbar interceptem botoes centrais no runner remoto. Passaram localmente `check:tree`, `lint`, `tsc --noEmit`, `npm test` (291), `cargo clippy -D warnings`, `cargo test --lib` (325 passed / 10 ignored), `validate-upstream-windows.ps1 -SkipRustTests`, `preflight:sgdk-e2e`, matriz desktop local 16/16, `test:e2e:desktop:qa-rc` A-G (`manual-qa-status.json` `2026-05-11T18:15:08.061Z`, evidencias `qa-rc-2026-05-11T18-14-46-427Z-*`), `sgdk_matrix_corpus_ --ignored` (7/7), `build:debug`, `build:portable` e `build:msi`. No GitHub Actions, o SHA `7bf026b` passou `CI` e `Desktop E2E` em `push` e `pull_request` (runs `25689348726`, `25689348725`, `25689350772`, `25689350771`). O PR #2 existe, mas segue `draft/open`; `gh` nao esta instalado neste host. `release:readiness:promotion` foi reexecutado em worktree limpo e falhou apenas porque a branch esta +204 vs `origin/main`; a promocao real ainda exige merge/main e rerun no destino. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica; `BLAZE_ENGINE` segue blocker legitimo auditavel.

**Atualizacao ativa anterior:** em `2026-05-11 (rodada 32)`, na branch `feat/sgdk-vram-residency-streaming-r14`, o host Windows foi rechecado sem exigir novo codigo de setup: os scripts canonicos localizaram `cargo`, `tauri-driver` (`C:\Users\misae\.cargo\bin\tauri-driver.exe`), `msedgedriver` e WiX/cache existentes. Passaram `check:tree`, `lint`, `tsc --noEmit`, `npm test` (290), `cargo clippy -D warnings`, `cargo test --lib` (325 passed / 10 ignored), `release:readiness:baseline` com auxiliares, `preflight:sgdk-e2e` (`Ready: SIM`), `test:e2e:desktop:qa-rc` A-G (`qa-rc-2026-05-11T11-53-47-951Z-*`), `validate-upstream-windows.ps1 -SkipRustTests` (`success=true`), `sgdk_matrix_corpus_ --ignored` (7/7), `build:portable` e `build:msi`. `release:readiness:promotion` rodou em modo estrito e saiu com codigo 1 apenas por governanca; o snapshot pre-commit documental indicou branch +201 vs `origin/main`, e a branch continua a frente apos registrar esta rodada. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica; `BLAZE_ENGINE` segue blocker legitimo auditavel.

**Atualizacao anterior adicional:** em `2026-05-10 (rodada 31)`, na branch `feat/sgdk-vram-residency-streaming-r14`, o host Windows foi preparado e a barra tecnica local voltou a ficar verde: Rust MSVC `1.95.0`, Visual Studio Build Tools/VC Tools, `cargo-clippy`, `tauri-driver v2.0.6` e WiX 3.14 cacheado em `%LOCALAPPDATA%\tauri\WixTools314`. Passaram `check:tree`, `lint`, `tsc --noEmit`, `npm test` (290), `cargo clippy -D warnings`, `cargo test --lib` (325 passed / 10 ignored), `sgdk_matrix_corpus_ --ignored` (7/7), `validate-upstream-windows.ps1 -SkipRustTests` (`success=true`), `preflight:sgdk-e2e` (`Ready: SIM`), `test:e2e:desktop:qa-rc` (A-G passed), `build:portable` e `build:msi`. O MSI foi desbloqueado apos falha ambiental de download do `wix314-binaries.zip` (`timeout: global`) via cache local verificado por SHA-256. `release:readiness:baseline` passou os gates, mas a promocao segue **NAO** por governanca: branch continua +200 vs `origin/main` e ha worktree amplo a consolidar. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica.

**Continuacao rodada 23 (codigo, sem commit/push):** grafos Phase D encadeiam no terminal por *papel*; `tail_node` apos `scroll_bg`. Tilemap: `buildTilemapAuthoringBrush` no Inspector/Hierarchy; paleta com `resolveProjectAssetPath`. Viewport: DOADOR/STAGING/INFERIDA + moldura staging; Inspector: `Pos:`.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

---

### CHECKPOINT operacional (2026-05-11 - rodada 33, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** corrigir falhas reais do `Desktop E2E` remoto no PR, consolidar branch pushada, verificar CI remoto e registrar o bloqueio externo restante sem claim de promocao.
- **Git/governanca:** commit `7bf026b` (`fix(e2e): harden live stale and toolbar overflow`) pushado para `origin/feat/sgdk-vram-residency-streaming-r14`; PR #2 (`https://github.com/Misael-art/RetroDevStudio/pull/2`) permanece `draft/open`. `gh --version` falha porque `gh` nao esta instalado; a verificacao remota foi feita pela API publica do GitHub. Sem autorizacao/autenticacao para merge, a entrega fica como PR pronto para promocao, nao MVP fechado.
- **Correcoes de codigo:** `editorStore` marca validacao live como `stale` no momento da mudanca de cena ja validada; runner desktop aceita transicao rapida de revalidacao para `LIVE`; topbar/metrics deixam de interceptar clique no Build/Run em largura de runner remoto.
- **Baseline local:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**291** testes); `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK; `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` OK (**325** passed / **10** ignored).
- **Fluxo real/QA/corpus:** `validate-upstream-windows.ps1 -SkipRustTests` OK; `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); matriz desktop local 16/16 OK; `npm run test:e2e:desktop:qa-rc` OK, `manual-qa-status.json` `2026-05-11T18:15:08.061Z`, blocos A-G `passed`; `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**).
- **Packaging:** `npm run build:debug`, `npm run build:portable` e `npm run build:msi` OK. Artefatos canonicos existentes: `src-tauri/target-test/debug/retro-dev-studio.exe` (timestamp local `2026-05-11 15:50:56`), `src-tauri/target-test/release/retro-dev-studio.exe` (`2026-05-11 15:27:21`) e `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi` (`2026-05-11 15:27:05`).
- **CI remoto:** SHA `7bf026b` verde no GitHub Actions: `CI` push `25689348726`, `Desktop E2E` push `25689348725`, `CI` pull_request `25689350772`, `Desktop E2E` pull_request `25689350771`. O blocker anterior do PR (`25670163191`, `smoke_snes` + `live_stale_*`) foi resolvido.
- **Readiness estrito:** `npm run release:readiness:promotion` reexecutado em worktree limpo apos push; baseline, upstream, desktop smoke, QA consumido e artefatos passaram; resultado final `Pronto para promocao: NAO` apenas por governanca (`+204` vs `origin/main`). Rerun em `main` ainda e obrigatorio apos merge.
- **Status honesto:** SGDK permanece **Experimental**; `support_status` inalterado; Phase D continua heuristica, sem AST C completo; nao criar tag/release antes de merge e readiness verde no destino.

### CHECKPOINT operacional (2026-05-11 - rodada 32, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** preparar/confirmar o host para execucao local completa, rerodar os gates de hardening e registrar o bloqueio real sem inflar escopo.
- **Git/governanca:** worktree versionavel limpo antes das atualizacoes documentais; branch rastreia `origin/feat/sgdk-vram-residency-streaming-r14`; o snapshot pre-commit documental era `origin/main...HEAD = 0/201`, e cada commit documental posterior aumenta a contagem sem alterar a natureza do bloqueio. `Rascunho.txt` existe na raiz, mas esta ignorado em `.git/info/exclude` e nao deve ser versionado sem curadoria.
- **Baseline local:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**290** testes); `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK; `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` OK (**325** passed / **10** ignored).
- **Readiness/QA:** `npm run release:readiness` inicial mostrou fotografia **NAO** por baseline/QA nao consumidos nesta rodada e governanca; `npm run release:readiness:baseline` executou baseline + auxiliares com gates tecnicos verdes; `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); `npm run test:e2e:desktop:qa-rc` OK com `manual-qa-status.json` `2026-05-11T11:54:18.251Z`, blocos A-G `passed` e evidencias `qa-rc-2026-05-11T11-53-47-951Z-*`.
- **Toolchains/corpus:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` OK (`upstream-validation.json success=true`); `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**). `BLAZE_ENGINE` continua blocker legitimo auditavel, sem assert de ROM.
- **Packaging:** `npm run build:portable` gerou `src-tauri/target-test/release/retro-dev-studio.exe`; `npm run build:msi` gerou `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`; `release:readiness:promotion` tambem regenerou o EXE debug canonico.
- **Readiness estrito:** `npm run release:readiness:promotion` rodou baseline, upstream e Desktop E2E simples, consumiu `manual-qa-status.json` fresco e saiu com codigo 1 por um unico bloqueio de governanca contra `origin/main` (201 commits a frente no snapshot pre-commit documental).
- **Status honesto:** nao declarar fechamento do MVP nesta revisao. A retomada exata e consolidar/mesclar a branch candidata ou manter o PR como trilha de governanca, rerodar `npm run release:readiness:promotion` no destino de promocao e sincronizar README/onboarding se o merge mudar a leitura publica. SGDK permanece **Experimental**; `support_status` inalterado; Phase D continua heuristica, sem AST C completo.

### CHECKPOINT operacional (2026-05-10 - rodada 31, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** preparar host Windows e fechar a barra tecnica local sem inflar escopo nem promover superficies experimentais.
- **Host/toolchain:** `scripts\setup-rust.ps1` instalou Rust MSVC `1.95.0`; Visual Studio Build Tools 2022/VC Tools foi instalado via `winget`; `scripts\run-cargo-msvc.cmd --version` passou; `rustup component add clippy` instalou `cargo-clippy`; `cargo install tauri-driver --locked` instalou `tauri-driver v2.0.6`; WiX 3.14 foi cacheado em `%LOCALAPPDATA%\tauri\WixTools314` com SHA-256 `6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31`.
- **Correcoes de codigo desta rodada:** Clippy novo exigiu `sort_by_key` em tres ordenacoes (`ast_generator.rs` e `project_mgr.rs`); foi aplicado o menor diff sem alterar comportamento.
- **Baseline verde:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**290** testes); `scripts\run-cargo-msvc.cmd clippy --manifest-path .\src-tauri\Cargo.toml -- -D warnings` OK; `scripts\run-cargo-msvc.cmd test --manifest-path .\src-tauri\Cargo.toml --lib -- --nocapture --test-threads=1` OK (**325** passed / **10** ignored).
- **Corpus/official toolchains/desktop:** `scripts\run-cargo-msvc.cmd test sgdk_matrix_corpus_ --manifest-path .\src-tauri\Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**; BLAZE segue blocker legitimo auditavel); `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` OK (`upstream-validation.json success=true`); `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); `npm run test:e2e:desktop:qa-rc` OK com `manual-qa-status.json` `2026-05-10T19:51:16.583Z`, blocos A-G `passed` e evidencias `qa-rc-2026-05-10T19-50-53-457Z-*`.
- **Packaging:** `npm run build:portable` gerou `src-tauri/target-test/release/retro-dev-studio.exe`; `npm run build:msi` gerou `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`. Primeira tentativa de MSI falhou por ambiente (`tauri-bundler` timeout ao baixar `wix314-binaries.zip` do GitHub); a retomada foi cachear WiX 3.14 localmente e rerodar o comando canonico.
- **Readiness:** `npm run release:readiness:baseline` executou baseline + auxiliares com gates tecnicos verdes. A promocao publica continua bloqueada por governanca: branch sem upstream proprio e +200 commits vs `origin/main`, alem de worktree amplo ainda nao consolidado antes do commit/PR. `release:readiness` simples sem `--manual-qa-json` ainda mostra A-F pendente por nao consumir o report de QA; a trilha de promocao usa o JSON explicitamente.
- **Status honesto:** SGDK permanece **Experimental**; `support_status` inalterado; Phase D continua heuristica, sem AST C completo; ArtStudio/RetroFX/Reverse/Asset Extractor/Memory/VRAM continuam experimentais salvo prova dedicada futura. `Rascunho.txt` e rascunho operacional solto na raiz; nao versionar sem curadoria.

### CHECKPOINT operacional (2026-05-10 - rodada 30, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** inspeccao real de estado, baseline local possivel, readiness e saneamento de falso positivo em scripts de QA; sem promocao de produto.
- **Git/governanca:** branch sem upstream proprio, `HEAD` em `7467046`, `origin/main...HEAD = 0/200`; worktree amplo e sujo com mudancas em docs, scripts, frontend, backend Rust e testes. `Rascunho.txt` existe na raiz como rascunho operacional nao canonico e nao deve ser versionado sem curadoria.
- **Baseline frontend:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**290** testes).
- **Bloqueio Rust/MSVC:** `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` nao executou porque `cargo` nao esta no PATH; `scripts\run-cargo-msvc.cmd clippy ...` e `scripts\run-cargo-msvc.cmd test ...` falharam por `vswhere.exe not found at "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"`. Retomada: instalar/provisionar Rust + Visual Studio Build Tools/Installer com VC tools, confirmar `vswhere.exe` e rerodar clippy/test pelos comandos canonicos.
- **Desktop QA:** `npm run preflight:sgdk-e2e` falhou com `tauri-driver: FALTA`; `toolchains/sgdk` OK e `toolchains/webdriver/msedgedriver.exe` OK. `scripts\diagnose-desktop-e2e.ps1` agora executa sem crash e confirma `tauri-driver` ausente. Retomada: provisionar `tauri-driver` via cargo em host com Rust e rerodar preflight + `npm run test:e2e:desktop:qa-rc`.
- **Upstream oficial:** `scripts\validate-upstream-windows.ps1 -SkipRustTests` foi corrigido para propagar exit code real do wrapper `.cmd` mesmo com stdout/stderr capturados. Report fresco: `success=false`, `blocking_status_codes=["toolchain_missing"]`, fase `upstream_smoke` falhou por ausencia de `vswhere`/MSVC. Isso substitui o falso positivo anterior desta mesma rodada.
- **Readiness:** `npm run release:readiness` gerou `Pronto para promocao: NAO`; bloqueadores: baseline institucional nao executada pelo agregador, worktree sujo, branch +200 vs `origin/main`, portable/release EXE ausente, MSI ausente e QA A-F pendente na fotografia atual.
- **Status honesto:** SGDK permanece **Experimental**; `support_status` inalterado; `qa-rc` de `2026-05-02` continua evidencia historica, mas nao e fotografia fresca de `2026-05-10`.

### CHECKPOINT operacional (2026-05-02 — rodada 29, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Baseline real antes da edicao:** o `qa-rc` A-G ja passava, mas a experiencia de criador ainda era dispersa: viewport informativo porem pesado em banners, tilemap com estado visivel mas acoes afastadas do alvo, selecao densa dependente de lista/spotlight sem solo persistente, e Logic/Art ainda pareciam continuacoes fracas do objeto selecionado.
- **Viewport / composicao:** `ViewportPanel` passou a montar um contexto de autoria (`creatorWorkflow`) com labels de mundo, janela MD 320x224, camera, regiao editavel, entidade selecionada, fontes e tilemap ativo. A mesa de composicao no stage ganhou foco de entidade, centralizacao e **Solo** para reduzir caos em cenas grandes.
- **Selecao densa:** o picker por Shift+clique agora tem acao `Selecionar + foco` e **Isolar alvo**, com solo visual persistente no canvas ate o usuario desligar. Alt+clique/teclado/filtros/spotlight da rodada anterior continuam.
- **Tilemap central:** a faixa de pintura no viewport mostra alvo/brush/tool e ganhou acoes `Focar alvo` e `Voltar select`, evitando que o usuario precise lembrar em qual painel a paleta/estado esta.
- **Objeto -> Logic -> fonte / Art:** Inspector e Logic ganharam pontes por `data-testid`/UI real para objeto -> Logic, Logic -> Scene, source paths multiplos/fallback honesto e objeto -> Art. Art mostra `artstudio-scene-context-bridge` para retornar a Cena sem reset mental.
- **Provas reais no app:** `qa-rc-2026-05-02T05-14-22-572Z-*` cobre composicao de cena, pilha densa com picker/solo, tilemap grande em paint, objeto -> Logic -> fonte, Art -> Scene com contexto e fluxo continuo salvar/reabrir/build/ROM `SEGA`.
- **Ainda heuristico / Experimental:** Fase D continua sem AST C completo; `entity_role`, `confidence`, `role_reason`, `driver_functions` e quick actions sao assistivos/heuristicos. `BLAZE_ENGINE` permanece blocker legitimo auditavel; SGDK **Experimental**; `support_status` inalterado.
- **Gates:** `check:tree` OK; `lint` OK; `tsc --noEmit` OK; `npm test` **288** passed; `cargo clippy -D warnings` OK; `cargo test --lib --test-threads=1` **325** passed / **10** ignored; `cargo test sgdk_matrix_corpus_ --ignored` **7** passed; `validate-upstream-windows -SkipRustTests` **exit 0**; `preflight:sgdk-e2e` **Ready: SIM**; `qa-rc` **A-G OK** (`qa-rc-2026-05-02T05-14-22-572Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 28, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Cena densa (B):** picker com filtros (`all/sprite/tilemap/camera/imported`) + `Spotlight` de isolamento visual no viewport durante preview.
- **UX (G):** contagem `filtradas/total` e estado vazio orientado por filtro, reduzindo tentativa-e-erro.
- **Ainda heuristico / Experimental:** inferencia de papel continua heuristica; spotlight/filtro melhoram usabilidade, nao elevam status de AST/importador; SGDK **Experimental**.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**277**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T09-26-03-255Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 27, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Cena densa (B):** picker `viewport-dense-stack-picker` com navegacao de teclado (`↑/↓/Enter/Esc`) e pre-selecao visual por hover/focus no viewport.
- **Art (F):** `ArtStudioPanel` reentra em `Scene` com contexto preservado; se a entidade for tilemap, ativa `paint` com brush canonico sem perder foco.
- **Prova:** regressao frontend `ArtStudioPanel.test.ts` cobrindo retorno contextual.
- **Ainda heuristico / Experimental:** Fase D continua sem AST completo; picker e quick actions sao assistivos (nao inferencia forte); SGDK **Experimental**.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**277**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T08-32-55-700Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 26, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Viewport / cena densa / tilemap (A/B/C):** **Shift+clique** com pilha >1 abre picker denso; **Alt+clique** mantem ciclo; faixa tilemap embute **`TilePalette`**; hints toolbar **Shift=lista · Alt=ciclo**; logs duplo-clique / Inspector alinhados a paleta no stage.
- **Logic (E):** `appendExecChainEdgesFromLayout` + botao **Encadear exec (layout)**; quick actions **projectile_motion**, **camera_rig**, **fighter_combat**, **support_state_tick**, **hud_vblank_tick**; empty state ordenado por `entity_role` (mapa fixo; heuristica).
- **Inspector (D):** botoes **Abrir fonte (n)** por caminho unico (`source_paths` ∪ `external_source_refs`).
- **Ainda heuristico / Experimental:** Fase D sem AST completo; encadeamento layout e quick actions sao **atalhos de autor** a revisar por jogo; SGDK **Experimental**; corpus **BLAZE** continua blocker auditavel.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**276**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T02-28-49-421Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 25, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Viewport / cena densa / tilemap (A/B/C):** `collectEntitiesUnderPoint` + **Alt+clique** cicla sobreposicoes sem iniciar arrasto; **duplo-clique** em tilemap ativa pintura (`buildTilemapAuthoringBrush`, `activeTilemapId`); duplo-clique em entidade com grafo abre Logic; faixa **Fluxo tilemap** (`viewport-tile-paint-flow-strip`) mostra alvo/brush/ferramenta; tooltip do overlay e do Navegador do Mundo alinhados a autoria.
- **Objeto -> logica -> fonte (D/E):** `NodeGraphEditor` — cartao inferencia + `openProjectSourcePath` para primeiro `source_paths` / `external_source_refs`; mensagens de erro explicitas se faltar editor/caminho.
- **Art (F):** `ArtStudioPanel` — `artstudio-no-sprite-context` + retorno a Cena.
- **Ainda heuristico / Experimental:** Fase D sem AST; inferencia importada; corpus **BLAZE** e cenarios com build bloqueado **improprios para autoria completa**; SGDK **Experimental**.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**275**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T01-16-50-322Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 24, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Viewport / autoria (BLOCO A):** `ViewportPanel.tsx` — cartao `viewport-world-authoring-strip` quando mundo largo ou colisao em px maior que 320x224: texto orientado a autoria, ate 3 avisos de `hwStatus.warnings` (colisao/mapa), botoes **Centro colisao**, **Modo colisao**, **Pan livre** (desliga clamp ao mundo), **Clamp on**; callback `focusCollisionMapCenter`.
- **Logic / heuristica importada (BLOCO E):** `project_mgr.rs` — papel lexical **`hud_actor`** (sinais `hud`, `score`, `health`, `lifebar`, `gauge`, `font`, `ui_`); ramo Phase D com no **`role_hud_scroll_tick`** (`scroll_tilemap`, label explicitando HUD/heuristica); prioridade de papel e faixa Y em `sprite_role_priority` / `sgdk_role_lane_base_y` atualizadas. `importedEntityContext.ts` + `HierarchyPanel.tsx` — rotulo **HUD / UI** e chip **HUD** alinhados ao resto do shell.
- **Limites honestos:** Fase D continua sem AST C completo; posicoes donor/staging/inferida e grafos seguem **heuristicos** onde nao ha prova estrutural; cenarios de corpus com build bloqueado (ex. linha BLAZE) permanecem **improprios para autoria completa** ate resolver blockers de hardware/doador.
- **Gates desta rodada (host):** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**275** passed), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` (**325** passed / **10** ignored, mesma continuacao de sprint), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (**7** passed), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` (**exit 0**, ~171s, `processSweep.strategy=cim`), `npm run preflight:sgdk-e2e` (**Ready: SIM**), `npm run test:e2e:desktop:qa-rc` (**OK** `qa-rc-2026-04-30T00-28-55-771Z-*`, A-G).
- **Governanca:** SGDK **Experimental**; `support_status` inalterado; **sem commit/push**.

### CHECKPOINT operacional (2026-04-21 — commit consolidado)

**Git:** mensagem `fix(md): validar CollisionMap world-sized; endurecer teste matriz SGDK P2` na branch `feat/desktop-e2e-workflow` (`git log -1 --oneline`).

- **Rust / hardware:** `md_profile.rs` e `snes_profile.rs` — `CollisionMap` world-sized (scroll/plataforma) deixa de ser **fatal** por exceder viewport; mantem validacao conservadora (tile multiplo de 8, limites de grid e de bytes em `data`, integridade `len` vs `width*height`, overflow com `checked_mul`); aviso quando o mundo em pixels excede a area visivel. Testes de regressao: `collision_map_wider_than_viewport_is_non_fatal_with_warning` (MD e SNES).
- **Corpus matriz Platformer 2:** teste renomeado `sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker`; com `--ignored`, doador ausente **panic** salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`; assert final exige ROM com marca `SEGA`; leitura da ROM no ramo fake usa `project.join(rom_path)`.
- **Documentacao:** `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (linha 1, comando e evidencia); `docs/06_CURRENT_WAVE_AI_BANK.md` (rodada 11+). Comentario UGDM em `CollisionMap` (`entities.rs`) alinhado a mapas maiores que viewport.
- **Gates verificados nesta entrega:** `npm run check:tree`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`, e `cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker ... --ignored` no host com corpus (ex.: `mode=sgdk_detect rom_sega=true`).
- **Governanca:** SGDK permanece **Experimental**; `support_status` nao promovido; matriz linha 1 **Parcial** (programa dos seis titulos incompleto).

### CHECKPOINT operacional (2026-04-22 — rodada 12)

- **Build/constraints:** `build_orch.rs` passa `project.template_metadata.source_kind` para `validate_scene_with_source_kind` (MD/SNES).
- **Regressao:** `sgdk_managed_vram_overflow_warns_but_native_still_aborts`.
- **Corpus matriz:** helper com `stamp_imported_sgdk_metadata` + assert `source_kind=imported_sgdk`.

### CHECKPOINT operacional (2026-04-23 — rodada 13)

- **Resolver SGDK:** `resolve_sgdk_import_root` + integracao em `import_sgdk_project`; testes `sgdk_resolver_*`; ambiguidade multi-candidato falha com mensagem e lista de roots.
- **Matriz corpus:** `cargo test sgdk_matrix_corpus_ ... --ignored --test-threads=1` => **6/6** no host; linha 2 `MATRIX_PE` com `resolution_kind=mddev_reference_redirect`.
- **Gates locais desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `npm run preflight:sgdk-e2e`, `npm run test:e2e:desktop:qa-rc`.

### CHECKPOINT operacional (2026-04-23 — rodada 14)

- **MD hardware model:** `md_profile.rs` deixou de usar apenas `vram_used` agregado para SGDK importado; agora separa `asset_total`, `resident`, `streamable` e `dma/frame` com `analysis_mode=sgdk_managed`.
- **Build audit:** `build_orch.rs` emite linha `MD VRAM analysis: ...` antes da validação fatal/warn, permitindo QA entender por que passou com warning vs bloqueou.
- **Corpus real:** `sgdk_matrix_corpus_` ampliado para incluir `BLAZE_ENGINE`; suite no host: 7/7 testes passando (6 com ROM `SEGA` + 1 bloqueador esperado auditavel).
- **Gates da rodada:** `check:tree`, `lint`, `tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `cargo test sgdk_matrix_corpus_ --ignored`, `validate-upstream-windows -SkipRustTests`, `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc`.

### CHECKPOINT operacional (2026-04-24 — rodada 15)

- **MD `HwStatus` + `md_profile`:** composicao de residencia por categoria + contadores `banks`/`cells` da heuristica `sgdk_managed`; `vram_used`/`dma_used` mantem a semantica agregada da rodada 14.
- **Build / matriz:** `MD VRAM analysis` e `MATRIX_* hw` incluem `spr_res`, `tile`, `hud`, `strm_spr`, `anim_sw`, `banks`, `cells`; regressao `sgdk_managed_vram_overflow_warns_but_native_still_aborts` asserta `spr_res=` no log; corpus BLAZE asserta `banks=` no log de build.
- **SGDK:** continua **Experimental**; sem promocao de `support_status`.

### CHECKPOINT operacional (2026-04-25 — rodada 16)

- **Frontend:** `src/core/assetInstantiation.ts` + testes; `AssetPreview.tsx` (estados de carregamento); `InspectorPanel.tsx` (texto de diagnostico do preview); `ToolsPanel.tsx` (regra de instanciação).
- **Gates nesta entrega parcial:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, vitest focado (`assetInstantiation`, `InspectorPanel`). Suite completa / Rust / E2E nao rerodada nesta continuacao.
- **SGDK:** continua **Experimental**; sem promocao de `support_status`; sem commit automatico.

### CHECKPOINT operacional (2026-04-25 — rodada 17)

- **E2E `qa-rc`:** bloco G alargado (cena `entry_scene`, `projectSourceKind`, onboarding, `instantiateBrowserImageAsset`, reopen `entityCount`, Inspector fallback testid).
- **Viewport:** contador `tm-fallback` + onboarding condicionado a cena vazia.
- **Gates:** `npm test` 246/246; `cargo clippy -D warnings`; `cargo test --lib`; `sgdk_matrix_corpus_` ignorados 7/7; `preflight:sgdk-e2e`; `test:e2e:desktop:qa-rc` OK.
- **Limite:** `validate-upstream-windows.ps1` falhou (WMI/CIM); nao equivaler a gate verde até corrigir host ou script.
- **SGDK:** Experimental; sem commit/push.

### CHECKPOINT operacional (2026-04-25 — rodada 18)

- **Gate oficial Windows:** `scripts/validate-upstream-windows.ps1` agora isola o sweep de processos num caminho resiliente (`Get-CimInstance Win32_Process` com fallback para `Get-Process`), materializa `ExitCode` do `cargo` antes de decidir o resultado, e escreve `processSweep`, timeouts e estado do self-test em `upstream-validation.json`.
- **Cobertura do fallback:** `src/core/validateUpstreamWindows.test.ts` força falha CIM via `RDS_VALIDATE_FORCE_CIM_FAILURE=1` + `-SelfTestProcessSweep` e asserta `processSweep.strategy === "get-process"` sem esconder o fallback no report.
- **Asset visual state canonico:** `src/core/assetVisualState.ts`, `src/core/useProjectAssetVisualState.ts` e `src/components/common/AssetPreview.tsx` centralizam `idle/loading/loaded/missing/failed/legacy_fallback`; `InspectorPanel.tsx` e `ViewportPanel.tsx` passam a falar a mesma lingua para preview real, erro, ausente e tilemap legado sem `cells[]`.
- **Produto/CX SGDK importado:** `App.tsx` abre a `entry_scene` e seleciona a primeira entidade visual relevante; Inspector mostra preview/caminho/estado visual/fallback explicito; `scripts/e2e-tauri-build-run.mjs` bloco G foi atualizado para procurar os sinais novos do Inspector (`Estado visual` / preview/fallback testids).
- **Gates desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`, `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1`, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests`, `npm run preflight:sgdk-e2e` e `npm run test:e2e:desktop:qa-rc`.
- **Governanca:** SGDK continua **Experimental**; sem mudanca de `support_status`; sem commit/push nesta sessao.

### CHECKPOINT operacional (2026-04-26 — rodada 20)

- **Produto/CX da IDE:** `importedEntityContext.ts` passou a derivar papel, classe, confianca e detalhe auditavel da entidade importada; `HierarchyPanel.tsx` mostra chips de papel importado e usa o mesmo foco de cena do `App.tsx`; `InspectorPanel.tsx` ganhou cartao de contexto importado com resumo, funcoes-chave e caminhos-fonte; `ViewportPanel.tsx` e `SceneAssetHealthBadge.tsx` passaram a exibir o mesmo vocabulario de saude visual; `AssetBrowserSelectionCard.tsx` passou a mostrar referencias de cena, papel importado e item-guia.
- **Arquitetura/frontend:** o shell agora compartilha contratos pequenos e reusaveis para foco de cena, estado visual, saude de assets e browser de assets, em vez de replicar `ifs` em `App.tsx`, `ToolsPanel.tsx`, `InspectorPanel.tsx` e `ViewportPanel.tsx`. `sceneWorkspaceContext.ts` passou a preferir entidade foco por score semantico, e `assetBrowserModel.ts` ordena referencias por foco/papel em vez de ordem acidental.
- **Fase D importada:** `src-tauri/src/ugdm/components.rs` ganhou `ImportedLogicSemantics`; `project_mgr.rs` passou a calcular `entity_semantic_profile`, persistir `imported_semantics`, promover `external_source_refs`/`logic_hints` com `driver_functions` e `source_paths`, reconhecer `beat_em_up_close_range_signals`, evitar colapsar tudo no sprite primario e materializar `graph_ref`/movimento/rotulos conforme papel (`player_avatar`, `enemy_actor`, `projectile_actor`, `fighter_actor`, etc.). Ledger e testes de corpus agora carregam o motivo do papel e as fontes reais por entidade.
- **Provas/gates desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (`27` ficheiros / `272` testes), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` (`320 passed / 0 failed / 10 ignored`), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (`7 passed / 0 failed / 0 ignored`), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\\\validate-upstream-windows.ps1 -SkipRustTests` (`success=true`, `processSweep.strategy=get-process`, `usedCanonicalRetry=false`), `npm run preflight:sgdk-e2e` (`Ready: SIM`) e `npm run test:e2e:desktop:qa-rc` (`code=0`, `manual-qa-status.json` em `2026-04-26T05:19:54.185Z`, blocos A-G `passed`) verdes.
- **Governanca:** SGDK continua **Experimental**; `support_status` permanece inalterado; a limitacao honesta continua sendo a Fase D sem parser/AST completo, apesar do ganho material de semantica e rastreabilidade.

### CHECKPOINT operacional (2026-04-25 — rodada 19)

- **Produto/CX da IDE:** `sceneWorkspaceContext.ts` passou a dar o mesmo contexto importado/overlay/nativo para `App.tsx`, `HierarchyPanel.tsx`, `InspectorPanel.tsx` e `ToolsPanel.tsx`; a IDE agora destaca cena ativa, entidade guia, fallback legado e proximo passo de forma consistente, em vez de espalhar sinais tecnicos por painel.
- **Desacoplamento real:** `sceneAssetHealth.ts`, `assetBrowserModel.ts`, `useAssetBrowserState.ts`, `SceneWorkspaceNotice.tsx`, `AssetBrowserSelectionCard.tsx` e `SceneAssetHealthBadge.tsx` extraem responsabilidades que estavam crescendo dentro de `ViewportPanel.tsx` e `ToolsPanel.tsx`. O Asset Browser ganhou decisao de instancia visivel (sprite vs tilemap) com `reason` auditavel e texto de acao.
- **Gate oficial Windows endurecido alem do fallback CIM:** `scripts/validate-upstream-windows.ps1` deixou de depender apenas de `%OS%`; a deteccao de Windows passou a usar `OS`, `$IsWindows` e `System.Environment.OSVersion`. No backend Rust, `build_orch.rs` injeta `OS=Windows_NT` antes de chamar o make SGDK em Windows, evitando que `common.mk` caia no ramo Linux e procure `m68k-elf-gcc`.
- **Cobertura nova:** `src/core/validateUpstreamWindows.test.ts` agora cobre tambem o caso sem `%OS%`; `src-tauri/src/compiler/build_orch.rs` ganhou o teste `megadrive_build_forces_windows_os_env_for_sgdk_make`.
- **Gates desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (`267` testes), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` (`319` passed / `0` failed / `10` ignored), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (`7` passed / `0` failed), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests`, `npm run preflight:sgdk-e2e` e `npm run test:e2e:desktop:qa-rc` verdes. `upstream-validation.json` desta rodada ficou com `success=true`; `manual-qa-status.json` de `2026-04-25T18:43:11.668Z` voltou com blocos A-G `passed`.

