# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Ultima Atualizacao:** 2026-03-04
**Ultima sessao:** 2026-03-04 (Codex - Sessao 26: warnings live de hardware endurecidos no editor, cobertura desktop E2E expandida e Memory Bank retomado como handoff obrigatorio)
**Fase Atual:** Hardening/QA do MVP (Build -> ROM -> Emulacao validado em Windows com upstream real; desktop E2E multi-target validado localmente e em runner GitHub/Windows real; validacao live do editor agora coberta para bloqueios fatais e warnings nao-fatais)
**Branch sugerida:** `feat/<tema>` para trabalho paralelo; usar `main` apenas quando o usuario pedir edicao direta no workspace atual

> **DIRETRIZ DE SISTEMA PARA AGENTES DE IA:**
> Este e o bloco de memoria primario do projeto. Leia este arquivo integralmente antes de qualquer codigo ou decisao.
> Atualize "O que acabou de acontecer", "Proximo passo imediato" e o cabecalho ao encerrar sessoes relevantes.
> Nao altere a secao "Decisoes Arquiteturais Consolidadas" sem ordem expressa do usuario.
>
> **CANONICO DESDE 2026-02-28:**
> Entradas antigas que afirmam "MVP completo", "pipeline completo" ou "produto funcional" devem ser tratadas como historico de claim de entrega, nao como prova funcional.
> Para decisoes atuais, a auditoria e o plano deste documento sao a referencia operacional.

---

## 1. STATUS ATUAL DO PROJETO

* **O que acabou de acontecer (2026-03-04 - sessao 26):**
  - A validacao live do editor foi consolidada como trilha canonica de UX: `validate_scene_draft` no backend Rust, `sceneRevision` + estados `pending/fresh/stale/error` no store e bloqueio explicado de `Build & Run` no frontend.
  - A paridade entre preview live e validacao autoritativa foi endurecida em Rust, reduzindo risco de preview "mentir" sobre o resultado real do build.
  - O desktop E2E passou a cobrir, alem de `build-run`, `sprite overflow` e `VRAM overflow`, tambem `VRAM warning` nao-fatal em Mega Drive e SNES, verificando que o build continua habilitado enquanto o painel e a UX exibem o warning correto.
  - Nesta sessao foi adicionada uma nova classe de warning live de hardware: `Sprite Warning` quando a contagem de sprites fica alta, mas ainda abaixo do limite fatal. O backend Mega Drive e SNES agora emitem esse warning canonicamente.
  - O runner `scripts/e2e-tauri-build-run.mjs`, os aliases npm e o workflow `.github/workflows/desktop-e2e.yml` foram expandidos para `live-warning-sprites` em Mega Drive e SNES, e os dois cenarios passaram localmente no app Tauri real.
  - Foi identificada uma lacuna processual: o `06_AI_MEMORY_BANK.md` nao estava sendo atualizado a cada sessao relevante. A partir desta sessao, o handoff de memoria volta a ser tratado como obrigatorio ao fechar cada iteracao material.
  - Nesta maquina local o `gh` CLI nao esta disponivel. Quando a alteracao tocar arquivos monitorados pelo workflow desktop, o caminho operacional canonico para disparo remoto passa a ser o proprio `push`, que aciona `.github/workflows/desktop-e2e.yml` por filtro de caminho.

* **O que acabou de acontecer (2026-03-03 - sessao 25):**
  - O workflow `.github/workflows/desktop-e2e.yml` passou por completo no GitHub Windows runner real (`Desktop E2E`, SHA `4986440`), com `Build debug desktop app`, smoke Mega Drive e smoke SNES concluindo com sucesso.
  - O `CI` comum tambem passou no mesmo commit, confirmando que o baseline rapido e o smoke desktop dedicado ficaram verdes no ambiente remoto institucional.
  - O runner `scripts/e2e-tauri-build-run.mjs` ganhou timeout configuravel e diagnostico do estado do app quando o emulador nao ativa, evitando falha cega em ambiente limpo.
  - A falha remota do SNES foi rastreada ate `build_orch.rs`: o caminho `PVSNESLIB_LIBDIR_WIN` estava sendo serializado de forma incompativel com `wlalink` no runner Windows. O path foi corrigido para formato com `/`, e os testes Rust/clippy voltaram a passar antes do rerun remoto.
  - `App.tsx` deixou de registrar abertura/criacao de projeto como sucesso quando a hidratacao da cena falha, e `InspectorPanel.tsx` agora expõe `Falha ao salvar` no proprio botao quando a persistencia falha, reduzindo falso positivo de UX.
  - O endurecimento de UX foi validado localmente com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit` e `npm test`.

* **O que acabou de acontecer (2026-03-03 - sessao 24):**
  - Foi confirmado via GitHub API que o branch `feat/desktop-e2e-workflow` ja aciona o `CI` remoto em `push`, provando que a autenticacao e a observacao de Actions no repositorio estao funcionais.
  - O workflow `.github/workflows/desktop-e2e.yml` foi endurecido com `push`/`pull_request` filtrados por caminho, suporte a `workflow_call`, `concurrency`, `timeout` e resolucao canonica de `target`.
  - A estrategia elimina o bloqueio operacional de depender da `default branch` para usar apenas `workflow_dispatch`, sem reabsorver o smoke desktop no `ci.yml` comum.
  - `docs/07_TEST_AND_COMPLIANCE.md` e `docs/09_AGENT_DEV_MODE.md` foram atualizados para refletir que o smoke desktop institucional agora e dedicado, reutilizavel e acionavel remotamente antes do merge.

* **O que acabou de acontecer (2026-03-02 - sessao 23):**
  - O runner desktop `scripts/e2e-tauri-build-run.mjs` foi endurecido para ler `project.rds` e validar que o `target` hidratado pela UI corresponde ao fixture aberto.
  - Foram adicionados aliases npm por target: `test:e2e:desktop:md` e `test:e2e:desktop:snes`, eliminando ambiguidade na execucao local do smoke desktop.
  - O fixture canonico `snes_dummy` passou no mesmo runner desktop/Tauri, validando `Build -> Load ROM -> Run frames` tambem para SNES na janela real do app.
  - Foi criado `.github/workflows/desktop-e2e.yml` como workflow Windows separado, com `workflow_dispatch`, provisionamento de `tauri-driver` + `msedgedriver` e execucao controlada de Mega Drive, SNES ou ambos.
  - A estrategia adotada evita transformar o `ci.yml` comum em gargalo lento/frágil, mas institucionaliza uma regressao desktop repetivel e documentada.

* **O que acabou de acontecer (2026-03-02 - sessao 22):**
  - O fluxo oficial de Windows foi validado com os componentes reais: `scripts/validate-upstream-windows.ps1 -SkipRustTests` passou baixando/instalando SGDK, PVSnesLib e cores Libretro oficiais e executando o smoke test ignorado `official_windows_upstream_validation_smoke_test`.
  - O orchestrator SNES em `build_orch.rs` foi corrigido para usar layout canonico de workspace (`hdr.asm`/`data.asm` apenas na raiz do workspace), compatibilizar o caminho da PVSnesLib com `snes_rules` no Windows e impedir regressao com testes novos.
  - Foi criado um ponto canonico de abertura de projeto por caminho (`open_project_path`) no backend/frontend para permitir automacao desktop sem depender de dialogo nativo.
  - Foi criado o runner `scripts/e2e-tauri-build-run.mjs`, usando `tauri-driver` oficial, `msedgedriver` nativo e a janela real do app para validar `Build -> Load ROM -> Run frames`.
  - O E2E desktop/Tauri real passou em Windows com o fixture canonico `megadrive_dummy`, buildando o app Tauri debug, clicando `Build & Run`, entrando na aba `game` e confirmando framebuffer nao vazio no canvas.
  - `docs/03_ROADMAP_MVP.md`, `docs/07_TEST_AND_COMPLIANCE.md`, `docs/08_TREE_ARCHITECTURE.md`, `docs/09_AGENT_DEV_MODE.md` e `README.md` foram atualizados para refletir esse novo baseline verificado.

* **O que acabou de acontecer (2026-03-02 - sessao 21):**
  - `README.md`, `CLAUDE.md` e `docs/00_AI_DIRECTIVES.md` foram realinhados ao estado real do projeto, eliminando claims antigas de `Fase 0` e referencias obsoletas como `check-tree.js`.
  - Foi criado `docs/09_AGENT_DEV_MODE.md` como documento canonico para hierarquia de verdade, gates de entrega, matriz de maturidade e regras anti-poluicao para agentes.
  - O baseline de CI em `.github/workflows/ci.yml` foi endurecido com `npm run check:tree`, `npm run lint` e `cargo clippy -- -D warnings`, alem dos gates ja existentes.
  - Foi introduzido um baseline real de ESLint no frontend, com configuracao explicita em `eslint.config.mjs` e scripts npm dedicados para estrutura e lint.
  - O gate de `cargo clippy` expôs problemas reais no backend e eles foram corrigidos em `build_orch.rs`, `libretro_ffi.rs` e `dependency_manager.rs` em vez de serem suprimidos.
  - O validador estrutural `scripts/check-tree.cjs` foi corrigido para refletir a raiz real do repositorio, incluindo `.github/` e `data/`.
  - `docs/02_TECH_STACK.md`, `docs/03_ROADMAP_MVP.md`, `docs/07_TEST_AND_COMPLIANCE.md` e `docs/08_TREE_ARCHITECTURE.md` foram atualizados para manter coerencia com o novo baseline.

* **O que acabou de acontecer (2026-02-28 - sessao 19):**
  - Foi criado o baseline inicial de CI em `.github/workflows/ci.yml`, executando `cargo test --lib`, `npm test` e `npx tsc --noEmit` em Windows para proteger os proximos fixes.
  - `Deep Profiler`, `Asset Extractor` e `RetroFX` passaram a se declarar explicitamente como `Experimental` na UI, com botoes principais desabilitados para evitar falsa impressao de feature pronta.
  - A ordem executiva foi ajustada: CI primeiro, honestidade imediata de UX depois, e so entao os fixes P0 do fluxo canonico.
  - O arquivo acidental `nul` na raiz do repositorio foi removido para limpar o workspace e o `git status`.
  - A documentacao estrutural e o roadmap foram alinhados com essa nova ordem operacional.

* **O que acabou de acontecer (2026-02-28 - sessao 20):**
  - O `Pause/Resume` do viewport foi corrigido para interromper apenas o loop de frames sem chamar `emulator_stop()`, preservando o estado do core Libretro carregado.
  - O `ViewportPanel` ganhou protecao contra start duplo do loop enquanto `startFrameLoop()` ainda esta inicializando, evitando corrida entre efeitos do React.
  - O autosave do `HierarchyPanel` para adicionar/remover entidades passou a persistir sempre a cena fresca do store, removendo o snapshot stale de `activeScene`.
  - `project.rds` e `scenes/*.json` agora sao gravados com arquivo temporario + substituicao atomica em `project_mgr.rs`, com caminho especifico de replace no Windows.
  - O IPC `save_scene_data` deixou de escrever JSON bruto direto no disco e passou a salvar via `project_mgr::save_scene()`, reaproveitando validacao semantica e persistencia atomica.
  - A suite Rust backend subiu para **25/25** e os testes de `build_orch` foram serializados localmente para evitar lock intermitente de fixture no Windows.

* **O que acabou de acontecer (2026-02-28 - sessao 18):**
  - Foi implementado um gerenciador de dependencias de terceiros em `src-tauri/src/tools/dependency_manager.rs`, com detecao de status, instalacao sob demanda e log streaming para SGDK, PVSnesLib e cores Libretro oficiais.
  - O frontend agora faz preflight amigavel de dependencias antes de `Build & Run` e no carregamento manual de ROM, com consentimento explicito do usuario e abertura do `Runtime Setup` quando necessario.
  - A aba `Runtime Setup` foi adicionada ao `ToolsPanel`, tornando visivel o estado de instalacao local e a origem oficial de cada componente externo.
  - O caminho SNES deixou de ser apenas pseudo-workspace: `build_orch.rs` agora gera `hdr.asm`, `data.asm`, regras `gfx4snes`, staging de asset real convertido para `.bmp` e copia a ROM final para `build/snes/out/`.
  - A fixture canonica `snes_dummy` passou a usar um asset real (`assets/sprites/hero.ppm`) para exercitar o caminho oficial de staging de imagem.
  - O hardware profile do SNES foi endurecido para refletir o exporter atual: sprites simples quadrados de um unico tamanho por cena, evitando promessas que o emitter ainda nao suporta.
  - O roadmap foi reconciliado em `docs/03_ROADMAP_MVP.md`: Fases 1 e 2 agora aparecem como `implementadas em codigo, validacao externa pendente`, em vez de `concluidas`.
  - A suite Rust backend foi expandida e passou a **24/24** testes, incluindo o workspace SNES com asset real. `npm test` segue em **38/38** e `npx tsc --noEmit` segue OK.

* **O que estamos fazendo AGORA:**
  - Mantendo o fluxo canonico `Build -> ROM -> Emulacao` sob hardening depois da validacao oficial de Windows e do fechamento do desktop E2E para Mega Drive e SNES.
  - Expandindo a cobertura da validacao live do editor para warnings intermediarios e paridade entre preview, UX de bloqueio e validacao autoritativa no backend.
  - O baseline de CI inclui estrutura, lint, typecheck, `cargo clippy`, testes frontend e testes Rust, e existe workflow desktop dedicado com gatilhos remotos controlados para regressao multi-target.
  - O protocolo operacional desta fase passa a ser ciclico: proxima iteracao tecnica, disparo remoto do workflow desktop, proxima iteracao tecnica e registro no Memory Bank, sem deixar lacunas de handoff entre sessoes materiais.

* **Estado real resumido:**
  - Frontend/editor: funcional e agora com fluxo amigavel para instalar dependencias externas sem sair do app.
  - Build pipeline: real por target, com staging de assets e workspace SNES agora validado no Windows com PVSnesLib oficial e `snes_rules` real.
  - Emulacao integrada: backend usa Libretro real via FFI e o fluxo oficial com cores upstream reais foi verificado em Windows.
  - Suite Rust backend: passando localmente (`cargo test --lib` 28 aprovados, 1 ignorado), cobrindo parser/schema, hardware validation, build orchestration, dependency manager, emulacao Libretro mock, ponto canonico `open_project_path` e um E2E headless `Build -> Load -> Run`.
  - Toolchains continuam fora do Git, mas agora existe jornada automatica para baixar os pacotes oficiais no Windows mediante consentimento do usuario.
  - O app agora possui um E2E de nivel desktop/Tauri repetivel em `scripts/e2e-tauri-build-run.mjs`, usando `tauri-driver` oficial e fixtures canonicas de Mega Drive e SNES.
  - O workflow dedicado `.github/workflows/desktop-e2e.yml` institucionaliza a regressao desktop em Windows, com `workflow_dispatch`, `workflow_call` e gatilhos `push`/`pull_request` filtrados por caminho, e agora ja foi validado em runner GitHub/Windows real.
  - A UX live do editor ja cobre estados fatais e nao-fatais: overflow de sprites, overflow de VRAM, warning de VRAM alta e warning de alta contagem de sprites em ambos os targets.
  - O modo de trabalho dos agentes agora esta consolidado em documento canonico proprio para reduzir divergencia de onboarding, claims falsos de entrega e poluicao estrutural.
  - Dados em `data/`: `rom_teste.bin` e `sonic_test.gen` continuam uteis para validacao manual de Mega Drive, mas o uso dessas ROMs deve respeitar compliance/licenciamento.

* **Validacoes verificadas em 2026-03-04:**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 51/51.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado (`official_windows_upstream_validation_smoke_test`).
  - `npm run test:e2e:desktop:live-warning-vram:md -- --native-driver <msedgedriver>` -> OK, warning live nao-fatal de VRAM em Mega Drive no app Tauri real.
  - `npm run test:e2e:desktop:live-warning-vram:snes -- --skip-build --native-driver <msedgedriver>` -> OK, warning live nao-fatal de VRAM em SNES no app Tauri real.
  - `node scripts\e2e-tauri-build-run.mjs --scenario live-warning-sprites --project src-tauri/tests/fixtures/projects/megadrive_dummy --skip-build --native-driver <msedgedriver>` -> OK, warning live nao-fatal de sprites em Mega Drive no app Tauri real.
  - `node scripts\e2e-tauri-build-run.mjs --scenario live-warning-sprites --project src-tauri/tests/fixtures/projects/snes_dummy --skip-build --native-driver <msedgedriver>` -> OK, warning live nao-fatal de sprites em SNES no app Tauri real.

* **Validacoes verificadas em 2026-03-03:**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 39/39.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 28 aprovados / 1 ignorado (`official_windows_upstream_validation_smoke_test`).
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` -> OK, com SGDK, PVSnesLib e cores Libretro oficiais.
  - `npm run test:e2e:desktop:md -- --skip-build --native-driver <msedgedriver>` -> OK, validando Mega Drive na janela real do app Tauri.
  - `npm run test:e2e:desktop:snes -- --skip-build --native-driver <msedgedriver>` -> OK, validando SNES na janela real do app Tauri.
  - GitHub Actions `CI` (`22606646061`) -> OK em `windows-latest`.
  - GitHub Actions `Desktop E2E` (`22606643935`) -> OK em `windows-latest`, com `Run Mega Drive desktop smoke` e `Run SNES desktop smoke` ambos verdes.

* **Proximo passo imediato:**
  1. Confirmar no GitHub Actions o run remoto acionado pelo proximo `push` que tocar `src/`, `src-tauri/`, `package.json`, `scripts/` ou `.github/workflows/desktop-e2e.yml`.
  2. Expandir o modelo de warning live para outro limite util do editor sem poluir o backend com heuristicas duplicadas.
  3. Reexecutar o smoke upstream oficial sempre que mudancas tocarem o caminho SNES/Windows, agora que o baseline remoto ja esta comprovado.
  4. Continuar o ciclo obrigatorio de handoff: iteracao tecnica, validacao remota e atualizacao do Memory Bank na mesma sessao.

---

## 2. DECISOES ARQUITETURAIS CONSOLIDADAS (NAO SUGIRA MUDANCAS)

As seguintes decisoes ja foram debatidas e sao finais:

1. **Framework Desktop:** Tauri (Rust + WebView). Nao Electron. Todo acesso ao sistema de arquivos passa pelo backend Rust via IPC (`invoke`).
2. **Linguagem Frontend:** React com TypeScript + TailwindCSS + Vite.
3. **Gerencia de Estado (UI):** Zustand ou Context API. Proibido Redux.
4. **Alocacao de Memoria no C (Engine de Exportacao):** Alocacao estatica apenas (arrays fixos). Proibido `malloc()`/`free()` para entidades do jogo.
5. **Formato de Salvamento (UGDM):** JSON puro com extensao `.rds`. Sem SQLite. Compativel com Git.
6. **Emulacao Integrada:** Libretro API via FFI no Rust. Sem emulador proprio.
7. **UGDM Agnostico:** Nenhuma referencia a hardware especifico (VDP, PPU, OAM, CRAM) no modelo de dados. Traducao ocorre nos Hardware Profiles.

---

## 3. PROBLEMAS CONHECIDOS & ALERTAS

* **[2026-02-28]** `README.md`, `docs/03_ROADMAP_MVP.md` e o historico antigo do Memory Bank divergiam sobre o status real. Ate uma reconciliacao completa, este arquivo e a referencia operacional canonica.
* **[2026-03-02]** `README.md`, `CLAUDE.md` e `docs/00_AI_DIRECTIVES.md` foram realinhados, mas novas mudancas de estado devem continuar atualizando esses arquivos na mesma sessao para evitar regressao documental.
* **[2026-02-28]** O backend agora executa Libretro real e o build nao reporta sucesso sem ROM, mas isso ainda depende de core/toolchain externos configurados. Sem essas dependencias, o comportamento correto agora e erro explicito.
* **[2026-03-02]** Ja existe teste de interface Tauri/React validando `Build -> Load ROM -> Run frames` no nivel de aplicacao desktop, mas ele ainda depende de `tauri-driver` e `msedgedriver` provisionados localmente.
* **[2026-03-02]** O fluxo oficial com SGDK/PVSnesLib/cores Libretro reais foi validado em Windows, mas deve ser reexecutado sempre que mudancas tocarem build, emulacao ou toolchains.
* **[2026-03-02]** O caminho SNES oficial foi validado com `snes_rules` real, mas qualquer mudanca no workspace/Makefile deve ser tratada como area sensivel e voltar a passar pelo smoke upstream.
* **[2026-03-03]** O workflow desktop `desktop-e2e.yml` ja foi validado em runner GitHub/Windows real. Qualquer mudanca no caminho SNES/Windows ou no runner E2E deve preservar esse baseline remoto.
* **[2026-03-04]** Nesta maquina local o `gh` CLI nao esta instalado. O disparo remoto do workflow desktop deve ocorrer por `push` path-filtered ou por API/web quando houver autenticacao disponivel, mas o agente nao deve assumir `gh workflow run` como baseline universal.
* **[2026-03-04]** Atualizacao do `06_AI_MEMORY_BANK.md` ao fim de cada sessao material volta a ser exigencia operacional. Ausencia de handoff aqui deve ser tratada como bug de processo.
* **[2026-02-28]** `Deep Profiler`, `Asset Extractor` e `RetroFX` permanecem visiveis por contexto de produto, mas agora devem continuar explicitamente marcados como experimentais ate deixarem de ser stub/parcial.
* **[2026-02-28]** No Windows, a deteccao de `bash` deve ignorar o shim do WSL (`C:\\Windows\\System32\\bash.exe`) e privilegiar Git Bash/MSYS2. Essa regra ja foi aplicada no codigo e nao deve ser removida sem substituto equivalente.
* **[2026-02-28]** `data/sonic_test.gen` e a documentacao associada sao um ponto de atencao de compliance/licenciamento. O software pode operar com ROMs fornecidas pelo usuario para fins educacionais, pesquisa e preservacao, mas nao deve redistribuir ROM comercial como parte do produto.
* **[2026-02-28]** Integrar cores oficiais de Libretro/RetroArch exige atencao a licencas. Antes de automatizar bundle/download, verificar compatibilidade de distribuicao com o carater proprietario do projeto.
* **[2026-02-23]** `cargo clippy` e `cargo build` requerem `CARGO_BUILD_JOBS=2` e `RUST_MIN_STACK=16777216` para evitar stack overflow na compilacao do crate `windows` e `regex-automata` no Windows. Configurado em `src-tauri/.cargo/config.toml`.
* **[2026-02-23]** `check-tree.js` foi renomeado para `check-tree.cjs` porque `package.json` usa `"type": "module"` e o script usa `require()`. Qualquer referencia residual ao nome antigo deve ser tratada como bug documental/processual.
* **[2026-02-23]** Os icones em `src-tauri/icons/` ainda sao placeholders gerados por script.
* **[2026-02-23]** `bootstrap.ps1` tem bugs de encoding e nao deve ser usado como fonte canonica de setup sem revisao.

---

## 4. PROXIMO PASSO IMEDIATO (PARA A IA EXECUTAR QUANDO SOLICITADA)

**Tarefa:**
Rebaseline tecnico do MVP para alinhar implementacao, documentacao e compliance antes de qualquer nova feature.

**Pre-requisitos operacionais:**
* Nao iniciar features novas de editor/UX/NodeGraph/Tools enquanto `Build -> ROM -> Emulacao` nao estiver funcional de verdade.
* Se alterar emulacao, consultar `docs/02_TECH_STACK.md`, `docs/07_TEST_AND_COMPLIANCE.md` e fontes oficiais de Libretro/RetroArch.
* Se for adicionar nova crate ou dependencia de suporte para download/extracao de cores, registrar a mudanca em `docs/02_TECH_STACK.md` e justificar no PR/handoff.

**Sequencia de acoes recomendada:**
1. Manter o CI baseline verde em toda alteracao relevante (`npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture`, `npm test`).
2. Corrigir P0 do fluxo canonico (pause/resume, autosave stale residual, escrita atomica, handlers criticos).
3. Validar com SGDK real um projeto dummy gerado pelo app e confirmar que a ROM de saida abre em core Libretro real.
4. Validar com PVSnesLib real o mesmo fluxo para SNES e ajustar o `Makefile`/resources se houver divergencia com `snes_rules`.
5. Cobrir casos com assets de sprite reais em ambos os alvos, garantindo que `resources.res`/recursos sejam aceitos pelas toolchains oficiais.
6. Expandir ou parametrizar o E2E de nivel aplicacao desktop para cobrir tambem o target SNES.
7. So depois disso retomar polish de editor, NodeGraph, RetroFX e Tools.

**Validacao minima obrigatoria antes de marcar qualquer item como concluido:**
* `npm run check:tree`
* `npm run lint`
* `npx tsc --noEmit`
* `npm test`
* `cargo clippy -- -D warnings`
* `cargo test --lib -- --nocapture`
* teste manual ou automatizado de `Build -> Run` com ROM real no target afetado
* atualizacao do README e deste Memory Bank se o status do produto tiver mudado

---

## 5. MARCOS VERIFICADOS

* **2026-02-23 - Base do projeto:**
  - Scaffold Tauri + React + TypeScript + Vite.
  - Estrutura de pastas backend/frontend criada.
  - `cargo clippy` e `npm run build` ja foram validados historicamente.

* **2026-02-23 a 2026-02-27 - Editor e UX de demo:**
  - Layout principal do editor, hierarchy, inspector, viewport e console.
  - Estado global com Zustand.
  - Menus, dialogs de arquivo e ferramentas de editor.
  - Viewport de cena, drag de entidades, inspectors para componentes principais.

* **2026-02-24 a 2026-02-27 - Features de demonstracao:**
  - NodeGraph, RetroFX, Tools panel, Patch Studio, Deep Profiler e Asset Extractor.
  - Suporte de UI para MD/SNES e parte do codegen de demonstracao.

* **2026-02-26 a 2026-02-28 - Testes verificados:**
  - Testes frontend de `nodeCompiler` e `editorStore` existentes e passando.
  - Suite Rust backend criada e validada localmente, cobrindo parser/schema, hardware profiles, build orchestration e emulacao Libretro mock.

* **2026-02-28 - Auditoria e hardening tecnico:**
  - Status real recalibrado.
  - Schema de novo projeto corrigido.
  - Fixtures canonicas adicionadas.
  - Build orchestration revisado.
  - Libretro real integrado no backend.
  - Prioridade redirecionada para validacao externa com toolchains/cores reais e E2E de aplicacao.

---

## 6. HISTORICO RESUMIDO DE SESSOES

| Data | Ferramenta | Resumo |
|------|-----------|--------|
| 2025-10-14 | - | Criacao inicial da base documental (`docs/00` a `docs/08`) e scripts de validacao |
| 2026-02-22 | Claude Code | Revisao ampla da documentacao, blindagem anti-alucinacao e atualizacao inicial do Memory Bank |
| 2026-02-23 | Claude Code | Fase 0 concluida: scaffold Tauri/React/Rust, organizacao de pastas, build basico |
| 2026-02-23 | Claude Code | Sprints 1.1 a 1.5: layout do editor, parser UGDM, codegen SGDK, orchestrator parcial e emulador simulado |
| 2026-02-24 | Claude Code | Fases 2 e 3 declaradas como concluidas: SNES, NodeGraph e RetroFX em nivel de demo |
| 2026-02-25 | Claude Code | Fase 4 declarada como concluida: Patch Studio, Deep Profiler e Asset Extractor |
| 2026-02-25 a 2026-02-27 | Claude Code | Polish/QA do editor, dialogs, menus, testes frontend e correcoes de UI/store |
| 2026-02-28 | Codex | Auditoria tecnica do status real, atualizacao canonica do Memory Bank e alinhamento documental inicial |
| 2026-02-28 | Codex | Hardening do MVP: schema canonico, fixtures backend, testes Rust, Libretro real via FFI, build orchestration revisado e UI alinhada |
| 2026-02-28 | Codex | Setup automatico sob demanda para SGDK/PVSnesLib/cores Libretro, caminho SNES com asset real, deteccao robusta de bash no Windows e roadmap reconciliado |
| 2026-02-28 | Codex | CI baseline com GitHub Actions, bloqueio imediato de superfices experimentais e reordenacao do plano por impacto |
| 2026-02-28 | Codex | Fixes P0 do fluxo canonico: pause/resume sem reset, autosave fresco no hierarchy, persistencia atomica e suite Rust 25/25 |
| 2026-03-02 | Codex | Alinhamento documental completo, ESLint baseline real, `cargo clippy` corrigido, CI endurecido com estrutura/lint/clippy e criacao do documento canonico `09_AGENT_DEV_MODE.md` |
| 2026-03-02 | Codex | Validacao upstream oficial em Windows com SGDK/PVSnesLib/cores Libretro reais, correcoes de workspace SNES e fechamento do E2E desktop/Tauri real |
| 2026-03-02 | Codex | Expansao do desktop E2E para SNES, aliases npm por target e workflow Windows manual `desktop-e2e.yml` |
| 2026-03-03 | Codex | Validacao do `desktop-e2e.yml` em runner GitHub/Windows real, endurecimento diagnostico do runner desktop e correcao final do path SNES para `wlalink` no Windows |
| 2026-03-04 | Codex | Validacao live consolidada no editor, bloqueio explicado de `Build & Run`, paridade preview/autoritativo endurecida e cobertura desktop E2E expandida para warnings de VRAM |
| 2026-03-04 | Codex | Warning live de alta contagem de sprites adicionado em Mega Drive e SNES, runner/workflow desktop expandidos para `live-warning-sprites` e Memory Bank retomado como handoff obrigatorio |

---

**[Sinalizador de Fim de Leitura]**
*Se voce e uma IA e acabou de ler este documento no inicio de uma sessao, responda com: **"[Contexto Carregado] Hardening do MVP. Prioridade: preservar o fluxo canonico validado, manter o desktop E2E repetivel e expandir cobertura sem poluir a arquitetura."***
