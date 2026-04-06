# 06 - CURRENT WAVE AI BANK (Wave S+)
**Ultima Atualizacao:** 2026-04-06
**Wave Atual:** S+ (Hardening, QA e Recuperacao Conservadora)
**Arquivo Anterior:** docs/06_AI_MEMORY_BANK_WAVE_A_R.md (historico arquivado)

> **DIRETRIZ DE SISTEMA PARA AGENTES DE IA:**
> Este e o bloco de memoria ATIVO do projeto. Leia este arquivo antes de qualquer codigo ou decisao.
> Atualize "O que acabou de acontecer", "Proximo passo imediato" e o cabecalho ao encerrar sessoes relevantes.
> Nao altere a secao "Decisoes Arquiteturais Consolidadas" sem ordem expressa do usuario.
> Historico de sessoes anteriores a 2026-03-14 esta em docs/06_AI_MEMORY_BANK_WAVE_A_R.md.
>
> **WAVE S+ segue ativa em 2026-04-06:**
> Foco: recuperar coerencia multi-agente, manter o fluxo canonico `Build -> ROM -> Emulacao` verde, endurecer hosts Windows limpos e documentar o estado real no GitHub sem claims infladas.

---

## 1. STATUS ATUAL DO PROJETO (Wave S+)

* **O que acabou de acontecer (2026-04-06 - NodeGraph: overview agora sai de alerta passivo para reparo guiado):**
  - **Warnings de grafo ganharam ações locais, sem magia oculta:** `src/components/nodegraph/NodeGraphEditor.tsx` agora oferece `Adicionar Inicio` quando o grafo nao tem evento de entrada e `Ir para No Solto` quando existem nós desconectados, transformando o overview em apoio de reparo em vez de apenas diagnóstico passivo.
  - **A correção continua conservadora e explícita:** `Adicionar Inicio` só cria um `event_start` posicionado perto do grafo atual e deixa a conexão final na mão do usuário; não há autowiring nem alteração silenciosa de fluxo.
  - **Navegação local ficou mais útil para grafos incompletos:** o atalho `Ir para No Solto` recentra o primeiro nó desconectado usando a mesma câmera local não persistida já existente, sem mexer no layout salvo no `LogicComponent.graph`.
  - **Cobertura real adicionada para esses contratos de reparo:** `src/components/nodegraph/NodeGraphEditor.test.tsx` agora trava o fluxo `grafo sem entrada -> adicionar inicio` e o foco guiado em nó solto a partir do overview.
  - **Escopo mantido estritamente no frontend canônico:** nenhuma mudança foi feita em emitter, `nodeCompiler`, schema, build orchestration, emulação ou validação de hardware; esta rodada permaneceu inteiramente dentro do `NodeGraphEditor`.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`216` testes), `npm run build` OK, `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados). O chunk dedicado de `NodeGraphEditor` ficou em ~`33.66 kB` bruto / `9.96 kB` gzip e o shell principal permaneceu em ~`390.42 kB` bruto / `118.55 kB` gzip.

* **O que acabou de acontecer (2026-04-06 - NodeGraph: quick actions agora respeitam a entidade real da cena):**
  - **Atalhos guiados deixaram de nascer com alvos genéricos desconectados da cena:** `src/components/nodegraph/NodeGraphEditor.tsx` agora resolve `Player Controller Basico` e `Logica de Inimigo Simples` a partir da entidade realmente selecionada, usando `entity_id` canônico do editor em vez de fixar sempre `player`/`enemy`.
  - **O fluxo de overlap ficou mais honesto quando existe outra entidade na cena:** o atalho `Logica de Inimigo Simples` passa a usar a primeira contraparte real encontrada no scene graph como alvo complementar do `condition_overlap`, reduzindo o risco de um grafo de onboarding nascer apontando para IDs que nem existem no projeto aberto.
  - **Empty state agora deixa esse contrato visível antes do clique:** o `Guided Empty State` ganhou uma dica contextual explicando qual entidade será usada como alvo principal, sem criar metadata paralela nem alterar schema, emitter ou pipeline SGDK/SNES.
  - **Escopo mantido conservador:** esta rodada ficou restrita ao `NodeGraphEditor` e à sua cobertura frontend; nenhuma mudança foi feita em `nodeCompiler`, emitter Rust, persistência do schema, build orchestration, emulação ou nos contratos do shell principal.
  - **Cobertura real adicionada para gameplay comum:** `src/components/nodegraph/NodeGraphEditor.test.tsx` agora trava três contratos importantes: hint contextual do empty state, atalho de player usando a entidade selecionada como `target` e atalho de inimigo reaproveitando outra entidade real da cena como contraparte de overlap.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`214` testes), `npm run build` OK, `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados). O build de producao manteve o shell em ~`390.42 kB` bruto / `118.55 kB` gzip e o chunk dedicado de `NodeGraphEditor` em ~`32.66 kB` bruto / `9.77 kB` gzip.

* **O que acabou de acontecer (2026-04-04 - Import SGDK: onboarding do Viewport agora distingue overlay legado de import nativo):**
  - **O banner SGDK do Viewport deixou de misturar dois contratos diferentes:** `src/components/viewport/ViewportPanel.tsx` agora gera copy especifica para `external_sgdk` e `imported_sgdk`, em vez de tratar qualquer projeto vindo de SGDK como se fosse a mesma classe de origem.
  - **Overlay legado ficou explicitado onde o usuario mais toma decisoes visuais:** para `external_sgdk`, o onboarding agora diz que o workspace usa um overlay `rds/`, que codigo/manifests do host continuam read-only e que `Build & Run` segue delegado ao `Makefile` do host.
  - **Importacao nativa ganhou mensagem mais honesta:** para `imported_sgdk`, o banner agora explica que o projeto ja foi convertido para o formato nativo do RetroDev, mas ainda carrega semantica de `ResComp/SGDK` para meta-sprites, VRAM e DMA, mantendo warnings como informativos.
  - **Escopo conservador preservado:** nenhuma mudanca foi feita no orquestrador de build, no importador Rust, nas regras de hardware ou na persistencia da cena; esta rodada ajustou apenas a camada de orientacao do `Viewport`.
  - **Cobertura integrada adicionada no shell real:** `src/App.test.tsx` ganhou provas para os dois estados do banner (`overlay legado` e `importado nativo`), reaproveitando o `ViewportPanel` real dentro do app em vez de criar um stub artificial para esse contrato.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`212` testes), `npm run build` OK, `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados). O bundle seguiu controlado com chunk principal em ~`390.42 kB` bruto / `118.55 kB` gzip.

* **O que acabou de acontecer (2026-04-04 - Import SGDK: Explorer agora deixa mais honesto o contrato do overlay legado):**
  - **ExplorerWorkspace passou a explicar o modo legado antes de qualquer clique:** `src/components/explorer/ExplorerWorkspace.tsx` agora mostra um resumo `Overlay SGDK` com `host_root`, quantidade de arquivos indexados, badge de `Read-only host` e a regra objetiva de que `Build & Run delega ao Makefile do host`.
  - **A fronteira entre `rds/` e host ficou explicita na navegacao:** o empty state do `Explorer` agora diferencia o que continua editavel no overlay e o que permanece somente leitura no host SGDK, reduzindo a chance de um agente ou usuario assumir que todo o workspace aberto virou um projeto nativo comum.
  - **Selecoes de cena e asset deixaram de parecer ambíguas:** os cards de detalhe agora mostram `Origem: overlay rds/scenes` e `Origem: assets canônicos do overlay` quando o projeto aberto veio de `external_sgdk`, reforcando que a autoria segue no overlay e nao sobre os arquivos host.
  - **Escopo mantido conservador:** nenhuma mudanca foi feita em `build_orch.rs`, importadores Rust, delegacao de build, schema UGDM, persistencia de cena ou emulacao; a rodada ficou restrita a tornar o fluxo legado mais honesto e menos propenso a erro humano na camada de exploracao.
  - **Cobertura dedicada adicionada para um contrato que antes estava implícito:** `src/components/explorer/ExplorerWorkspace.test.tsx` foi criado para travar o resumo do overlay legado e os labels de origem de cena/asset, evitando regressao silenciosa dessa semantica read-only.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`210` testes), `npm run build` OK, `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados). O bundle seguiu honesto com `ExplorerWorkspace` em ~`16.68 kB` e chunk principal em ~`389.83 kB` bruto / `118.30 kB` gzip.

* **O que acabou de acontecer (2026-04-04 - Autoria diaria: LayerPanel, Asset Browser e Inspector agora explicam melhor o contexto ativo):**
  - **LayerPanel ficou mais orientado ao estado atual da cena:** `src/components/hierarchy/LayerPanel.tsx` agora mostra um resumo compacto com `Camadas`, `Ativa` e `Entidade`, descreve o estado da camada selecionada (`visível/oculta`, `bloqueada/editável`, quantidade de entidades) e oferece `Limpar` para sair da camada ativa sem mudar store, schema ou persistencia.
  - **Atribuicao de entidade deixou de depender de descoberta implícita:** quando existe entidade selecionada, mas nenhuma camada ativa, o painel agora renderiza uma dica explicita para orientar a atribuicao correta antes de entrar no footer de `Atribuir à camada ativa`.
  - **Asset Browser passou a mostrar impacto real na cena ativa:** `src/components/tools/ToolsPanel.tsx` agora exibe se o asset selecionado ainda nao esta referenciado ou quantos itens da cena ativa o utilizam, com labels como `Sprite · hero`, reduzindo o custo de rastrear reutilizacao antes de instanciar ou editar.
  - **Inspector ganhou contexto rapido de destino e organizacao:** `src/components/inspector/InspectorPanel.tsx` agora mostra `Target` e `Camadas` diretamente no cabecalho da entidade, facilitando ler o contexto de build e agrupamento sem navegar para outros paineis.
  - **Escopo permaneceu conservador:** nenhuma mudanca foi feita em schema UGDM, `persistActiveScene`, importadores, build orchestration, emulacao ou layout global; a rodada ficou restrita a descoberta/orientacao da autoria diaria dentro do shell atual.
  - **Bundle permaneceu sob controle depois do pacote de contexto:** `npm run build` seguiu verde e passou a emitir `InspectorPanel` em ~`30.46 kB`, `ToolsPanel` em ~`90.49 kB` e o chunk principal em ~`389.83 kB` bruto / `118.29 kB` gzip. A leitura honesta continua a mesma: o shell esta melhor distribuido, mas ainda nao deve ser tratado como otimizado/final.
  - **Cobertura e baseline renovadas apos a rodada:** `src/components/hierarchy/LayerPanel.test.tsx` foi criado para travar resumo, hint de atribuicao e o fluxo `selecionar camada -> entrar em paint -> atribuir entidade -> limpar`. `src/components/tools/ToolsPanel.test.tsx` agora cobre o resumo de referencias do Asset Browser, e `src/components/inspector/InspectorPanel.test.tsx` cobre o contexto `Target/Camadas`. A barra verde desta rodada fechou com `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`208` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados).

* **O que acabou de acontecer (2026-04-04 - Autoria diaria: Hierarchy agora orienta melhor a cena ativa):**
  - **Hierarchy ganhou contexto rapido de cena sem alterar store, schema ou persistencia:** `src/components/hierarchy/HierarchyPanel.tsx` agora mostra um resumo compacto da cena ativa (`Cenas`, `Camadas`, `Entidades`, `Fundos`) logo abaixo do seletor de cena, reduzindo o custo de orientacao quando o usuario alterna entre cenas e camadas.
  - **Busca da hierarchy deixou de falhar silenciosamente:** quando a cena possui itens mas o filtro nao encontra correspondencias, o painel agora exibe uma mensagem explicita com o termo buscado, em vez de simplesmente parecer vazio.
  - **Escopo mantido conservador:** nenhuma mudanca foi feita em `createScene`, `switchScene`, `persistActiveScene`, schema UGDM, build ou emulacao; a rodada ficou estritamente no fluxo de autoria diaria da sidebar esquerda.
  - **Cobertura e baseline renovadas apos a mudanca:** `src/components/hierarchy/HierarchyPanel.test.tsx` agora trava o resumo da cena e o feedback de filtro vazio. A barra verde desta rodada fechou com `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`203` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados).

* **O que acabou de acontecer (2026-04-04 - Shell menos denso e onboarding mais honesto no primeiro uso):**
  - **Wizard de primeiro uso agora prioriza o caminho realmente criavel neste host:** `src/App.tsx` deixou de selecionar por padrao um template SGDK externo que ainda exige donor manual; a escolha inicial passou a priorizar `starter_guided`/templates builtin disponiveis, reduzindo o risco de o primeiro contato cair num estado bloqueado logo na abertura.
  - **Primeiro sucesso ficou explicitado no proprio wizard:** o modal agora renderiza um card `Primeiro sucesso` com o caminho recomendado ate `Scene -> Game`, incluindo bloqueio honesto para donor SGDK ausente, revisao da cena inicial e `Build & Run` no target selecionado.
  - **Rail lateral ganhou organizacao por etapa de uso sem trocar a arquitetura do shell:** os workspaces agora aparecem agrupados em `Core`, `Autoria` e `Debug`, com `Art` e `FX` marcados como `Exp.` diretamente na navegação para reforcar a maturidade real dessas superficies.
  - **A mudanca foi mantida conservadora:** nenhuma rota, IPC, preset ou contrato do `react-resizable-panels` foi trocado; a rodada ficou restrita a organizacao visual, selecao default do wizard e copy orientada ao fluxo canonico ja existente.
  - **Medicao de bundle apos a rodada de UX/performance:** `npm run build` gerou `assets/index-CBgUETdP.js` com `387.21 kB` bruto / `117.65 kB` gzip. O ganho estrutural da rodada anterior foi preservado; esta rodada concentrou mais legibilidade do shell do que reducao adicional de peso.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`202` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK, `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados) e `npm run build` OK.

* **O que acabou de acontecer (2026-04-04 - Smoke upstream agora certifica `platformer_seed`, import SGDK real e shell mais leve):**
  - **Gate oficial Mega Drive ficou mais fiel ao wizard atual:** `official_windows_upstream_validation_smoke_test` em `src-tauri/src/lib.rs` agora nao valida apenas onboarding e fixtures dummy; ele tambem cria um projeto `platformer_seed` a partir de donor sintetico e importa um projeto SGDK sintetico pelo comando canonico `import_sgdk_project(...)`, levando ambos ate `Build -> ROM -> Run frames` com SGDK real instalado.
  - **Sem criar trilha paralela de certificacao:** `scripts/validate-upstream-windows.ps1` permaneceu intacto como entrypoint institucional; a ampliacao aconteceu no proprio smoke ignorado oficial, preservando `upstream-validation.json` como fonte unica de verdade para esse gate.
  - **Prova real desta certificacao em 2026-04-04:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` fechou `success = true` em `src-tauri/target-test/validation/upstream-validation.json`, com logs explicitos de `onboarding`, `template-platformer_seed`, `imported-sgdk`, `megadrive` e `snes`.
  - **Fotografia institucional renovada no Windows:** `npm run release:readiness:baseline` passou novamente com `build:debug`, `desktop-e2e`, baseline JS/TS e suites Rust, renovando `build-report.json`, `upstream-validation.json` e o `retro-dev-studio.exe` debug na mesma rodada.
  - **Trilha de beta institucional ficou objetiva em documento canonico:** `docs/07_TEST_AND_COMPLIANCE.md` agora lista criterios de aceite da rodada de beta (`promotion`, `A-F`, timestamps frescos, worktree limpo, smoke upstream completo) e os riscos residuais que ainda precisam acompanhar qualquer nota publica.
  - **Shell principal perdeu peso sem trocar arquitetura:** `src/components/viewport/ViewportPanel.tsx` passou a lazy-load `NodeGraphEditor`, `RetroFXDesigner` e `ArtStudioPanel`, mantendo `Scene` e `Game View` diretos e sem mexer no layout canonico baseado em `react-resizable-panels`.
  - **Medicao objetiva apos o split conservador do viewport:** `npm run build` reduziu o chunk principal de `382.41 kB` bruto / `116.40 kB` gzip, enquanto `NodeGraphEditor` (~`31.77 kB`), `RetroFXDesigner` (~`24.90 kB`) e `ArtStudioPanel` (~`47.23 kB`) passaram a sair em chunks proprios. A diretriz continua honesta: performance melhorou materialmente, mas o shell ainda nao deve ser tratado como otimizado/final.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`202` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK, `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` OK e `npm run release:readiness:baseline` OK.

* **O que acabou de acontecer (2026-04-04 - Host limpo: templates externos sem caminho absoluto embedado e higiene do repo):**
  - **Catalogo de templates ficou agnostico ao host:** `data/template_registry.json` deixou de carregar `default_donor_path` absolutos da maquina original (`F:\Projects\MegaDrive_DEV\...`) para `platformer_seed`, `platformer_gm` e demais templates SGDK externos.
  - **Backend agora modela o caso honesto de donor manual:** `src-tauri/src/core/project_mgr.rs` passou a tratar templates SGDK sem donor padrao como `usaveis, mas dependentes de escolha manual neste host`, em vez de marca-los como indisponiveis por causa de um path embedado no repositório.
  - **Erro de criacao ficou mais claro e menos enganoso:** `resolved_template_donor_path(...)` agora exige explicitamente uma pasta doadora manual quando o catalogo nao traz donor padrao, em vez de sugerir que faltou um valor versionado no repo.
  - **Wizard alinhado ao estado real do host:** `src/App.tsx` agora diferencia `Configurado`, `Requer pasta` e `Indisponivel`; templates SGDK externos continuam selecionaveis no card, mas `Criar Projeto` so prossegue depois da escolha de uma pasta doadora valida.
  - **Cobertura frontend endurecida para esse contrato:** `src/App.test.tsx` ganhou prova explicita de que o wizard bloqueia a criacao sem donor path e libera o fluxo assim que o usuario escolhe a pasta doadora manualmente.
  - **Repo mais limpo para multiplos agentes:** `.claude/settings.local.json`, que estava versionado com permissoes e caminhos absolutos da maquina antiga, foi removido do Git e blindado em `.gitignore` como arquivo local.
  - **Validacao real desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`202` testes), `scripts\run-cargo-msvc.cmd clippy --manifest-path .\src-tauri\Cargo.toml -- -D warnings` OK e `scripts\run-cargo-msvc.cmd test --manifest-path .\src-tauri\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`255` aprovados / `0` falhas / `3` ignorados).

* **O que acabou de acontecer (2026-04-04 - QA RC institucional, fixtures BYOR-safe e shell menos denso):**
  - **Roteiro RC `A-F` virou evidencia executavel:** `scripts/e2e-tauri-build-run.mjs` ganhou o cenario `qa-rc`, que percorre onboarding, camadas, colisao/pintura, `Build & Run`, paineis e persistencia no app desktop real, gerando `src-tauri/target-test/validation/manual-qa-status.json` e screenshots `qa-rc-*.png`.
  - **Prova real desta rodada de QA RC (2026-04-04):** todos os blocos `A-F` ficaram `passed` no report canonico, com evidencias para wizard, editor, LayerPanel, camada oculta, pintura, game view e reabertura do projeto.
  - **Promocao institucional ganhou um entrypoint unico:** `npm run release:readiness:promotion` agora representa a fotografia conservadora de RC -> beta/producao, agregando baseline, `build:debug`, `validate-upstream-windows`, desktop E2E e o report `manual-qa-status.json` em modo `strict`.
  - **Promocao institucional comprovada no agregado:** `src-tauri/target-test/validation/release-readiness.json` fechou com `readyForPromotion = true` em `2026-04-04T03:07:15.245Z`, worktree limpo no commit `941b4dbefa5e6187a5d813e02b0254ada950213d` e `A-F` totalmente aprovados.
  - **Roadmap operacional do trimestre registrado:** `docs/03_ROADMAP_MVP.md` agora inclui um plano Q2 2026 com ordem, owners sugeridos, dependencias, risco e gate de aceite, para reduzir drift entre agentes e manter a priorizacao conservadora.
  - **Fixtures ficaram mais honestas para host limpo:** `src-tauri/src/compiler/build_orch.rs` passou a ignorar diretorios `build/` ao copiar fixtures, o teste `patch_studio_bps_roundtrip_preserves_modified_project_rom_hash` migrou para ROM sintetica em memoria e os `build/` versionados de `megadrive_dummy`/`snes_dummy` sairam do repositorio.
  - **Helper de fixture da camada Tauri alinhado ao mesmo contrato:** `src-tauri/src/lib.rs` agora tambem ignora `build/` ao copiar fixtures para workspaces temporarios, com teste sintetico dedicado (`fixture_copy_skips_generated_build_directories`) para impedir reintroducao silenciosa de artefatos gerados no sandbox de testes.
  - **Host local limpo de resquicio ignorado:** o diretorio ignorado `src-tauri/tests/fixtures/projects/megadrive_dummy/build/`, remanescente de rodadas antigas, foi removido manualmente do workspace local para voltar a refletir o contrato `fixture sem build gerado`.
  - **Cobertura nao depende mais de acervo local escondido:** o backend continua provando patch/build com assets tracked ou sinteticos, sem exigir ROM comercial, corpus solto em `data/` ou artefato gerado previamente dentro das fixtures.
  - **Shell principal ficou menos pesado sem trocar arquitetura:** `App.tsx` passou a lazy-load de `ExplorerWorkspace`, `InspectorPanel` e `ToolsPanel`; o `Workspace Guide` foi compactado com detalhes colapsados, reduzindo densidade visual e custo de carga inicial sem mexer no layout canonico baseado em `react-resizable-panels`.
  - **Medicao objetiva desta rodada de bundle:** `npm run build` passou a emitir chunks dedicados para `ExplorerWorkspace` (~26.83 KB), `InspectorPanel` (~52.46 KB) e `ToolsPanel` (~164.01 KB). O chunk principal do shell ainda segue grande (~1,098.25 KB bruto / ~204.66 KB gzip), entao performance continua em hardening e ainda nao autoriza claim de shell final otimizado.
  - **Validacao desta sessao em 2026-04-04:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`200` testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture --test-threads=1` OK (`254` aprovados / `0` falhas / `3` ignorados), `npm run build` OK, `npm run build:debug` OK, `node scripts/e2e-tauri-build-run.mjs --scenario qa-rc --skip-build --native-driver .\\toolchains\\webdriver\\msedgedriver.exe` OK e `npm run release:readiness:promotion` OK.

* **O que acabou de acontecer (2026-04-03 - Recuperacao cautelosa da Wave S+ e recertificacao do baseline):**
  - **Status real consolidado:** a avaliacao profunda confirmou que o projeto continua em `hardening / QA do MVP`; o shell principal e o pipeline canonico estao fortes, mas o produto ainda nao deve ser tratado como release final.
  - **Wave S+ saneada conservadoramente:** a migracao para `rc-dock` foi explicitamente mantida como `deferred` e removida de dependencias/docs ativas; o layout em producao continua baseado em `react-resizable-panels`.
  - **Updater voltou ao estado honesto de placeholder:** o hook de verificacao no frontend foi removido, a pubkey real saiu de `tauri.conf.json` e o arquivo `scripts/_tauri_signing.pub` ficou fora do Git; o crate backend permanece apenas como preparacao institucional, nao como superficie entregue ao usuario.
  - **Bootstrap para host limpo refeito sem comportamento intrusivo:** `scripts/bootstrap.ps1` deixou de criar scaffold, reescrever `.gitignore` ou assumir scripts obsoletos. Agora faz preflight do host Windows (`node`, `npm`, `git`, `rustc`, `cargo`, MSVC e WebView2`) e pode opcionalmente rodar baseline/upstream validation.
  - **Build canonico destravado de forma estrutural:** `scripts/build.mjs` deixou de limpar recursivamente toda a pasta canonica do profile e passou a remover apenas artefatos esperados do runtime, eliminando o bloqueio que fazia `build:debug` ficar preso por limpeza de trees antigas do Cargo.
  - **Validacao upstream ficou reprodutivel:** `validate-upstream-windows.ps1` agora encerra processos residuais do target upstream antes de rodar `cargo test`, e o smoke `official_windows_upstream_validation_smoke_test` passou a emitir logs progressivos por dependencia/build/emulacao.
  - **Dependencias oficiais ficaram mais resilientes:** `install_dependency(...)` agora reaproveita dependencias ja instaladas quando estao saudaveis, e o setup do SGDK auto-recupera `src/boot/{sega.s,rom_head.c}` a partir do template oficial quando a release instalada nao expõe esses arquivos na raiz.
  - **Host limpo sem ROM local escondida:** o teste Rust `patch_studio_bps_roundtrip_preserves_modified_project_rom_hash` deixou de depender de ROM solta em `data/snes roms/` e passou a usar a fixture rastreada `snes_dummy`.
  - **Regressao visual evitada no overlay live:** `ViewportPanel.tsx` preserva o ultimo snapshot util de `hwStatus` para a HUD de performance quando a revalidacao live retorna um payload zerado temporario.
  - **Vitest estabilizado no Windows canonico:** `vite.config.ts` passou a usar `pool: "forks"` no Windows, eliminando o timeout intermitente de worker em `src/App.test.tsx` sem reduzir cobertura.
  - **Build report endurecido para auditoria real:** `scripts/build.mjs` agora gera `src-tauri/target-test/validation/build-report.json` em modo `fresh-only`, registrando apenas os modos executados na rodada atual e impedindo heranca silenciosa de secoes antigas de `debug`, `portable` ou `msi`.
  - **Readiness baseline ficou mais fiel ao estado institucional do Windows:** `scripts/release-readiness.mjs --run-baseline` agora aciona automaticamente `build:debug`, `validate-upstream-windows` e `desktop E2E` quando o host esta apto, exigindo timestamps frescos de `build-report.json`, `upstream-validation.json` e do `retro-dev-studio.exe` gerado na mesma rodada.
  - **Auditoria do GitHub ficou mais legivel:** `.github/workflows/ci.yml` e `.github/workflows/desktop-e2e.yml` agora publicam resumo objetivo em `GITHUB_STEP_SUMMARY` e anexos de `src-tauri/target-test/validation/**`, reduzindo a dependencia de leitura crua de logs por push.
  - **Prova material desta rodada neste host (2026-04-03):** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`200` testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture --test-threads=1` OK (`253` aprovados / `0` falhas / `3` ignorados), `npm run build:debug` OK e `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` OK.

## 1. STATUS ATUAL DO PROJETO

* **O que acabou de acontecer (2026-03-26 - Retomada em host novo: baseline restaurada e ambiente parcialmente preparado):**
  - **Regressao do frontend separada de bug de produto:** `src/App.test.tsx` voltou a passar sem mudar o app em producao; a causa real era drift do ambiente jsdom deste host, que expunha `localStorage/sessionStorage` como objetos sem a interface `Storage`.
  - **Blindagem de teste adicionada:** `src/test/setup.ts` agora aplica polyfill in-memory para `localStorage` e `sessionStorage` quando o host entrega objetos capados, preservando o baseline do Vitest em ambientes Windows heterogeneos.
  - **Wrapper MSVC mais resiliente:** `scripts/run-cargo-msvc.cmd` deixou de assumir `cargo.exe` apenas em `%USERPROFILE%\\.cargo\\bin` e passou a aceitar fallback para o `cargo.exe` resolvido pelo `PATH`, o que destravou este host com Rust instalado em `C:\\Program Files\\Rust stable MSVC 1.94\\bin`.
  - **Host preparado para dev local:** `git safe.directory` foi configurado para o repo atual, o `Visual Studio Build Tools 2022` com workload de C++ passou a ser detectado por `vswhere`, `cl.exe`/`link.exe` ficaram acessiveis via `scripts/run-in-msvc.cmd`, o `Git Bash` real foi confirmado em `C:\\Program Files\\Git\\bin\\bash.exe` e `tauri-driver v2.0.5` foi instalado.
  - **Barra verde desta rodada no host novo:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (177 testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (239 aprovados / 0 falhas / 3 ignorados).
  - **Bloqueio restante ficou objetivo:** `scripts\\run-in-msvc.cmd powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` agora progride ate o SGDK oficial e falha apenas em `java: command not found` ao executar `rescomp.jar`; o host ainda precisa de um JRE/JDK para recuperar a certificacao upstream do caminho Mega Drive oficial.
  - **Status honesto mantido:** o host novo esta apto para retomada de desenvolvimento, lint e suites TS/Rust, mas ainda nao pode ser tratado como totalmente certificado para o smoke upstream oficial de SGDK enquanto o Java nao estiver provisionado.

* **O que acabou de acontecer (2026-03-27 - Host novo recertificado com JDK nativo + upstream oficial):**
  - **Smoke oficial alinhado ao estado real do produto:** `official_windows_upstream_validation_smoke_test` em `src-tauri/src/lib.rs` passou a incluir `jdk` junto de `sgdk`, `pvsneslib` e cores Libretro, evitando que a certificacao oficial continue ignorando o requisito de Java do fluxo SGDK.
  - **Provisionamento via metodo nativo do projeto confirmado:** `scripts\\run-in-msvc.cmd powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` baixou e instalou o `JDK (Temurin LTS)` em `toolchains\\jdk\\bin\\java.exe` usando o mesmo `install_dependency("jdk", ...)` exposto pelo app em `Runtime Setup`.
  - **Certificacao upstream restaurada neste host:** o report canonico `src-tauri\\target-test\\validation\\upstream-validation.json` voltou a registrar `success = true` em `2026-03-27T08:04:15.6691459-03:00`, removendo o ultimo bloqueio objetivo do caminho SGDK oficial neste ambiente.
  - **Script oficial sincronizado:** `scripts\\validate-upstream-windows.ps1` agora anuncia corretamente `JDK, SGDK, PVSnesLib e cores Libretro` como dependencias do smoke upstream em Windows.
  - **Validacao Rust pos-ajuste:** `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`240` aprovados, `0` falhas, `3` ignorados).

* **O que acabou de acontecer (2026-03-27 - Gate upstream oficial endurecido para este host):**
  - **Smoke desktop local reproduzido novamente:** o fluxo Tauri `Build -> ROM -> Run` voltou a passar neste host com `node scripts/e2e-tauri-build-run.mjs --skip-build --app C:\\Users\\misae\\AppData\\Local\\RetroDevStudio\\cargo-target-shadow\\debug\\retro-dev-studio.exe --native-driver .\\toolchains\\webdriver\\msedgedriver.exe`, confirmando `Canvas: 320x224, pixels nao pretos: 558`.
  - **Causa do falso-negativo upstream isolada:** `validate-upstream-windows.ps1` estava sendo executado em cascata por um wrapper MSVC externo e, ao mesmo tempo, chamando `cargo` de forma menos especifica para um teste que vive em `src-tauri/src/lib.rs`; a combinacao produzia corrida/ruido de ambiente e um report `success = false` apesar do smoke ignorado passar manualmente.
  - **Correcao conservadora aplicada no proprio gate:** o script oficial agora usa internamente `scripts\\run-cargo-msvc.cmd` e limita o smoke ignorado a `--lib official_windows_upstream_validation_smoke_test`, alinhando o executor ao wrapper canonico do host e ao alvo real do teste.
  - **Novo modo canonico de execucao em Windows:** depois desse ajuste, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` passa a ser a forma correta de rerodar a validacao upstream; nao e mais necessario embrulhar o script com `scripts\\run-in-msvc.cmd`.
  - **Certificacao oficial revalidada apos o hardening:** o report canonico `src-tauri\\target-test\\validation\\upstream-validation.json` voltou a `success = true` em `2026-03-27T15:04:45.2842827-03:00`, e o teste ignorado `official_windows_upstream_validation_smoke_test` passou integralmente com dependencias oficiais reais neste host.

* **O que acabou de acontecer (2026-03-27 - Build desktop canonico local restaurado neste host):**
  - **Build canônico voltou a responder direto:** `npm run build:debug` passou neste host sem override manual de `beforeBuildCommand`, exercitando o caminho oficial `scripts/build.mjs -> npm run tauri build -> beforeBuildCommand cmd /c npm run build`.
  - **Sem gambiarra fora do script oficial:** o build usou o shadow target automatico ja previsto em `scripts/build.mjs` (`C:\\Users\\misae\\AppData\\Local\\RetroDevStudio\\cargo-target-shadow`) por a workspace estar fora do drive do sistema, mas os artefatos canonicos continuaram sendo staged em `src-tauri\\target-test\\debug\\retro-dev-studio.exe`.
  - **Prova material registrada:** `src-tauri\\target-test\\validation\\build-debug-canonical-20260327.log` capturou o `beforeBuildCommand` real, o `vite build` de producao e o Tauri `--debug --no-bundle` fechando em sucesso, com `build-report.json` atualizado para o modo `debug`.
  - **Distincao operacional importante:** neste host, o comando cru `npm run tauri build -- --debug --no-bundle` continua sendo menos confiavel para diagnostico local de policy/AppLocker; o caminho canonico de projeto e `npm run build:debug` / `node scripts/build.mjs debug`.
  - **Escopo destravado:** com baseline local, upstream oficial, smoke desktop e build desktop canonico novamente verdes neste Windows, o proximo passo pode sair de hardening de host e voltar para UX core/polish sem mentir sobre o estado da base.

* **O que acabou de acontecer (2026-03-28 - Packaging desktop mais limpo para distribuicao local):**
  - **Warning de chunking removido no shell principal:** `App.tsx` deixou de fazer `await import("@tauri-apps/plugin-dialog")` em pontos isolados e passou a usar `import { open } from "@tauri-apps/plugin-dialog"` como os demais paineis, eliminando o warning de build do Vite sobre mistura de import estatico + dinamico do mesmo modulo.
  - **Bundle identifier normalizado antes de distribuicao:** `src-tauri/tauri.conf.json` saiu de `com.retrodevstudio.app` para `com.retrodevstudio.desktop`, removendo o warning do Tauri sobre identificadores terminando em `.app` e evitando conflito conceitual com extensao de bundle do macOS.
  - **Host local precisou de saneamento operacional:** o `build:debug` falhou inicialmente por `os error 112` no `cargo-target-shadow`; o cache descartavel em `C:\\Users\\misae\\AppData\\Local\\RetroDevStudio\\cargo-target-shadow` foi recriado com seguranca, recuperando espaco e permitindo rerun canônico do build desktop.
  - **Prova da rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings`, `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` e `npm run build:debug` voltaram a ficar verdes.
  - **Bloqueio institucional restante nao mudou:** depois desta limpeza, o readiness continua barrado apenas por `QA manual A-F` em `docs/10_QA_ROTEIRO_RC.md`; nao ha mais warning conhecido de `plugin-dialog` ou de bundle identifier no build desktop canonico desta sessao.

* **O que acabou de acontecer (2026-03-28 - Baseline frontend de teste menos ruidosa):**
  - **Setup jsdom endurecido sem tocar no app:** `src/test/setup.ts` agora policia `ImageData`, `canvas.getContext("2d")`, `createImageBitmap` e `fetch("asset://...")` com fallbacks sintéticos locais de teste, reduzindo o ruido que vinha do `ViewportPanel` ao carregar previews no ambiente do Vitest.
  - **Sem dependencia nova nem fixture paralela:** a correcao ficou confinada ao setup global de testes e usa assets sintéticos inline, em vez de exigir `canvas` nativo, fixtures binarias extras ou mudancas no caminho canonico de producao.
  - **Efeito observado:** sumiram os warnings de `asset://` e `HTMLCanvasElement.getContext()` que vinham do `ViewportPanel` no jsdom; a suite continua verde com `192` testes.
  - **Ruido residual ainda externo ao repo:** os warnings de `--localstorage-file` permanecem aparecendo no host Codex/Node atual, mas nao sao gerados por codigo do projeto e nao afetam o resultado da suite.
  - **Prova da rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` ficaram verdes apos o ajuste.

* **O que acabou de acontecer (2026-03-28 - QA desktop: onboarding e shell agora têm evidência automatizada real):**
  - **Runner desktop reaproveitado sem fluxo paralelo:** `scripts/e2e-tauri-build-run.mjs` ganhou o cenario `onboarding-shell`, usando o mesmo `tauri-driver`/`msedgedriver` canonico para validar a galeria inicial, criacao de projeto por template, shell principal carregado e aba `Camadas`.
  - **Sem inventar automacao fora do app:** o cenario usa apenas a UI real (`template-card-platformer_seed`, input `Nome do projeto`, botao `Criar Projeto`, affordances do shell e `+ Camada`) e o estado de automacao ja exposto por `window.__RDS_E2E__`, sem novo IPC nem alteracao no pipeline canonico do produto.
  - **Evidencia material gerada em disco:** a rodada salva screenshots em `src-tauri/target-test/validation/` para wizard, shell/editor e `LayerPanel`, ajudando a reduzir a dependencia de relato manual nos primeiros passos do RC.
  - **Higiene do host preservada:** o projeto criado pela automacao recebe nome unico e e removido ao fim do cenario, evitando sujeira permanente no diretório automatico de projetos do host.
  - **Escopo honesto mantido:** isso nao substitui o QA manual A-F; apenas reduz o bloco de incerteza no primeiro uso/shell e cria uma prova repetivel para o onboarding antes da promocao institucional.

* **O que acabou de acontecer (2026-03-27 - Hardening do setup nativo: precheck no Build All):**
  - **Fluxo publico alinhado:** `Runtime Setup` agora aplica o mesmo precheck conservador de dependencias antes de `Build All Targets`, em vez de deixar o build multi-target cair diretamente no backend com ambiente incompleto.
  - **Dependencias corretas para build multi-target:** o painel passou a exigir `JDK`, `SGDK` e `PVSnesLib` antes de compilar Mega Drive + SNES em sequencia, sem exigir cores Libretro para um fluxo que apenas gera ROMs.
  - **Sem novo IPC ou pipeline paralelo:** o hotfix reutiliza `third_party_get_status` e `third_party_install` ja existentes, mantendo a arquitetura canônica e a UX de instalacao sob demanda.
  - **Cobertura frontend adicionada:** `ToolsPanel.test.tsx` agora prova que um `JDK` ausente e instalado automaticamente antes do `Build All Targets`, e que o build multi-target so dispara depois desse precheck.
  - **Validacao focada desta rodada:** `npx tsc --noEmit`, `npx eslint src/components/tools/ToolsPanel.tsx src/components/tools/ToolsPanel.test.tsx` e `npx vitest run src/components/tools/ToolsPanel.test.tsx` devem permanecer verdes antes de promover este ajuste.

* **O que acabou de acontecer (2026-03-27 - Shell UX: guia contextual de workspace para onboarding):**
  - **Descoberta de recursos sem criar sistema paralelo:** `App.tsx` agora exibe um `Workspace Guide` logo abaixo da top bar quando existe projeto aberto e o shell nao esta em focus mode, usando o workspace atual como contexto (`Scene`, `Logic`, `Game`, `FX`, `Art`, `Debug`).
  - **Acoes rapidas alinhadas ao fluxo real:** cada workspace passou a expor 2-3 CTAs conservadores ja existentes (`Abrir Asset Browser`, `Abrir Paleta Contextual`, `Abrir Runtime Setup`, `Abrir Profiler`, `Rodar no Emulador`, `Validar Projeto`, `Abrir Inspector`) sem novo IPC nem duplicacao de fluxo.
  - **Feedback operacional mais claro:** o card tambem mostra um badge de estado herdando o resumo live atual (`bloqueio de build`, `warning live`, `sessao do emulador pronta` ou painel direito ativo), ajudando usuarios novos a entender o que fazer em seguida.
  - **Cobertura frontend adicionada:** `App.test.tsx` agora prova que o guia aparece no `Scene Workspace`, abre o `Asset Browser`, responde a mudanca para `Logic Workspace` e encaminha corretamente para a `Paleta Contextual`.
  - **Validacao desta rodada:** `npx eslint src/App.tsx src/App.test.tsx`, `npx tsc --noEmit` e `npx vitest run src/App.test.tsx` ficaram verdes (`35` testes), mantendo a mudanca pequena e isolada no shell.

* **O que acabou de acontecer (2026-03-27 - Preview de assets unificado entre Inspector e Asset Browser):**
  - **Resolver preview passou a ter um caminho comum:** `src/core/pathUtils.ts` agora concentra `resolveAbsoluteAssetPreviewSrc()` e `resolveProjectAssetPreviewSrc()`, evitando que cada painel monte `convertFileSrc(...)` por conta propria.
  - **Componente compartilhado criado sem tocar no Viewport:** `src/components/common/AssetPreview.tsx` encapsula preview de imagem com fallback visual consistente e reset automatico quando a origem muda; o `ViewportPanel` continua com sua estrategia propria baseada em canvas/fetch/createImageBitmap, porque ele ainda cobre casos mais robustos e nao valia arriscar essa superficie nesta rodada.
  - **Inspector e Asset Browser alinhados:** `InspectorPanel.tsx` e `ToolsPanel.tsx` passaram a usar o mesmo componente para thumbnails e preview selecionado, com o mesmo comportamento diante de path invalido, imagem nao suportada ou falha de decode no WebView/jsdom.
  - **Cobertura dedicada adicionada:** `InspectorPanel.test.tsx` agora prova a resolucao do caminho canonico para sprite preview e o fallback limpo apos erro; `ToolsPanel.test.tsx` cobre o fallback consistente no preview selecionado do `Asset Browser`.
  - **Validacao completa desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (`185` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` ficaram verdes. O warning conhecido de `asset://`/canvas no jsdom continua nao-bloqueante e segue restrito ao `ViewportPanel`.

* **O que acabou de acontecer (2026-03-27 - NodeGraph com contexto e navegacao local mais proximos de IDE/Blueprint):**
  - **Navegacao sem poluir o grafo salvo:** `NodeGraphEditor.tsx` ganhou um `viewOffset` local nao persistido, permitindo recentrar a vista no grafo sem mover os nos no `LogicComponent.graph` gravado em disco.
  - **Overview contextual adicionado:** o canvas agora mostra um card `Logic Context` com entidade ativa, contagem de nos/conexoes/eventos, alerta para ausencia de evento de entrada e sinalizacao de nos soltos, reduzindo a necessidade de “adivinhar” o estado do grafo.
  - **MiniMapa clicavel real:** o editor agora exibe um `MiniMapa` no canto inferior direito com viewport local e pontos clicaveis por no; tambem ganhou acoes `Ir para Inicio`, `Centralizar Selecao` e `Resetar Vista`, aproximando a navegacao do feeling de ferramentas como Unreal Blueprints sem criar camera persistida nem refatorar o compilador.
  - **Cobertura nova:** `NodeGraphEditor.test.tsx` valida o resumo do grafo, a projecao dos nos no minimapa e o foco do no de entrada sem alterar o grafo serializado.
  - **Validacao focal desta rodada:** `npx eslint src/components/nodegraph/NodeGraphEditor.tsx src/components/nodegraph/NodeGraphEditor.test.tsx`, `npx tsc --noEmit` e `npx vitest run src/components/nodegraph/NodeGraphEditor.test.tsx` ficaram verdes.

* **O que acabou de acontecer (2026-03-27 - Inspector com primeira acao real de preparacao para build):**
  - **Constraint do target reaproveitada no lugar certo:** `sceneConstraints.ts` agora tambem centraliza `constrainSpritePaletteSlot()`, espelhando no frontend o range real de `palette_slot` aceito pelo backend (`0-3` no Mega Drive, `0-7` no SNES).
  - **Inspector deixou de ser so placeholder para sprite:** `InspectorPanel.tsx` ganhou o card `Preparacao para Build` com a acao real `Normalizar Sprite para Mega Drive/SNES`, que aplica em conjunto `frame_width`, `frame_height` e `palette_slot` conforme o target ativo, sem novo IPC nem pipeline paralelo.
  - **Edicao manual ficou mais segura:** alteracoes em `Palette Slot` agora passam pelo mesmo clamp conservador do target atual em vez de deixar valores obviamente invalidos seguirem ate a validacao de hardware/build.
  - **Status honesto preservado para tilemap:** a area de `tilemap` continua explicitamente marcada como `Experimental`, e a extracao automatica de `tileset/tilemap` segue desabilitada ate que exista pipeline oficial ponta a ponta para isso.
  - **Validacao completa desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (`190` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` (`240` aprovados, `0` falhas, `3` ignorados) ficaram verdes.

* **O que acabou de acontecer (2026-03-27 - Higiene de build/workspace, reverse core endurecido e onboarding guiado no NodeGraph):**
  - **Workspace mais limpo e previsivel:** a raiz ganhou hardening de `.gitignore` para `*.tsbuildinfo`, `*.pdb`, `*.ilk`, `*.idb`, `*.app/`, `*.exe` e `toolchains/jdk/`; `src-tauri/.gitignore` passou a blindar `target/`, `target-test/`, `target-sprint*/` e artefatos nativos locais para evitar poluicao acidental do repo durante builds desktop.
  - **Build automation mantida sem fork arquitetural:** `package.json`, `scripts/build.mjs` e `tauri.conf.json` ja sustentavam corretamente `build:debug`, `build:portable` e `build:msi`; nesta rodada o foco foi provar a higiene do workspace e manter o caminho canonico intacto, sem criar wrapper novo.
  - **Reverse core subiu um degrau de robustez:** `trace.rs` agora expõe `ExecutionTraceLog` + `CpuState`; `code.rs` ganhou analise conservadora opcional guiada por trace, alinhamento seguro de endereco em Mega Drive, casos extras de 68000/65816 e blindagem contra falso-positivo em ASCII/pointers no meio de instrucao; `matching.rs` entrou como submodulo experimental com `BinaryDiffScorer` para similaridade estrutural ignorando variacao superficial de registradores.
  - **Cobertura reversa fechada nesta wave sem mudar API publica:** `annotations.rs`, `code.rs` e `mod.rs` ganharam os testes sinteticos faltantes para hash mismatch, manifests/extractors MD/SNES e edge cases de disassembly; a trilha filtrada do reverse core ficou com `36` testes verdes (`36/36`), acima do alvo minimo `>= 35`, sem criar crate paralela `reverse_core`.
  - **NodeGraph ficou mais acolhedor para iniciantes sem mentir sobre escopo:** `NodeGraphEditor.tsx` agora mostra `Guided Empty State` quando o grafo esta vazio, com tres `Quick Actions` (`Player Controller Basico`, `Logica de Inimigo Simples`, `Timer Event`) montadas apenas com nos ja canonicos; apos aplicar um atalho, a UI exibe `Guided Commentary` explicando o fluxo e as limitacoes de hardware/runtime sem gravar metadata fora do schema atual.
  - **Corrida de teste resolvida sem tocar no app:** `App.test.tsx` foi blindado para que o polling de `getHwStatus` nao sobrescreva o estado esperado do performance overlay durante a suite completa; foi drift de teste, nao bug do produto.
  - **Baseline completa desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`191` testes), `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib reverse:: -- --nocapture --test-threads=1` OK (`36` reverse tests, `0` falhas), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`251` aprovados, `0` falhas, `3` ignorados).

* **O que acabou de acontecer (2026-03-27 - Reverse core: coleta real de `ExecutionTraceLog` via Libretro em modo conservador):**
  - **Trace ao vivo sem quebrar contratos existentes:** `libretro_ffi.rs` agora coleta amostras reais de execucao apos `retro_run()` usando `retro_serialize`, acumula isso em `RuntimeExecutionTraceCapture` e mantem a sessao do emulador e o IPC legado intactos.
  - **Primeiro adapter de runtime provado de ponta a ponta:** o core mock de testes passou a fornecer um contador serializado de frames como amostra de PC, permitindo provar coleta real de `ExecutionTraceLog` e overlay no reverse core sem depender de acesso generico a registradores que a API padrao do Libretro nao garante.
  - **Overlay conservador no manifesto:** `trace.rs`, `code.rs`, `mod.rs` e `lib.rs` agora aceitam sobreposicao opcional de trace para marcar funcoes executadas e preencher `manifest.trace`; quando nao ha adapter suportado ou o trace esta vazio, o caminho sem trace continua identico ao comportamento anterior.
  - **Status honesto mantido:** `matching` e `projection` continuam `Experimental`, e cores Libretro reais fora de adapters suportados ainda devolvem nota explicita dizendo que a coleta de PC depende de implementacao especifica por runtime.
  - **Validacao desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (`191` testes), `scripts\\run-cargo-msvc.cmd clippy --manifest-path .\\src-tauri\\Cargo.toml -- -D warnings` OK, `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib reverse:: -- --nocapture --test-threads=1` OK (`37` reverse tests) e `scripts\\run-cargo-msvc.cmd test --manifest-path .\\src-tauri\\Cargo.toml --lib -- --nocapture --test-threads=1` OK (`253` aprovados, `0` falhas, `3` ignorados). O `npm run build:debug` canonico tambem voltou a gerar um executavel atualizado do lote em `src-tauri/target-test/debug/retro-dev-studio.exe`.

* **O que acabou de acontecer (2026-03-27 - Reverse Workspace: manifesto com overlay de trace do emulador no frontend):**
  - **Frontend passou a consumir o caminho trace-aware por padrao:** `ToolsPanel.tsx` agora usa `rom_analyze_with_emulator_trace` no `Reverse Workspace`, deixando o backend decidir automaticamente entre overlay dinamico e fallback estatico sem criar fluxo paralelo na UI.
  - **Estado do trace ficou visivel e honesto no painel:** o manifesto agora mostra um card `Trace dinamico` com `Overlay ativo` quando `manifest.trace.available = true` e `Sem overlay ao vivo` quando a analise seguiu estatica ou o core nao possui adapter suportado.
  - **Escopo preservado:** `Hex/Code`, anotacoes e navegacao do workspace reverso continuam iguais, enquanto `matching` e `projection` permanecem explicitamente `Experimental`.

* **O que acabou de acontecer (2026-03-27 - Reverse Workspace: aba Code priorizada pela sessao executada):**
  - **Funcoes executadas passaram a subir para o topo:** a aba `Code` agora reordena a lista de funcoes usando o campo canonico `executed`, destacando visualmente as entradas tocadas pela sessao do emulador sem alterar offsets salvos, disassembly ou sidecars.
  - **Xrefs e call graph ficaram mais uteis para leitura rapida:** arestas e cross-references tocadas pela sessao sobem para o topo e recebem badge `Trace`, reduzindo o custo de localizar o fluxo realmente percorrido na analise.
  - **Resumo de trace local na propria aba:** a vista `Code` agora mostra um card sintetizando quantas funcoes, xrefs e arestas foram priorizadas pelo overlay dinamico, com fallback honesto para analise estatica quando nao ha sessao compativel.
  - **Validacao desta rodada:** `npx eslint src/components/tools/ToolsPanel.tsx src/components/tools/ToolsPanel.test.tsx` OK, `npx tsc --noEmit` OK e `npx vitest run src/components/tools/ToolsPanel.test.tsx` OK (`7` testes), incluindo cobertura explicita para ordenacao de funcoes/xrefs/call graph quando `trace.available = true`.

* **O que acabou de acontecer (2026-03-28 - Shell UX: UnifiedTopBar + Explorer Workspace sintetizado):**
  - **Top bar unificada e mais legivel:** `App.tsx` deixou a barra superior mais proxima de IDE, com `UnifiedTopBar`, breadcrumbs de contexto e menu de acoes globais sem reintroduzir uma toolbar inchada.
  - **Explorer entrou como workspace real do shell:** a activity bar agora inclui `Explorer`, e o painel central passa a renderizar `ExplorerWorkspace.tsx` para navegar por cenas, assets canonicos e arquivos do host SGDK legado usando apenas APIs/IPC ja existentes.
  - **Sessao do emulador preservada ao navegar:** `ViewportPanel.tsx` deixou de encerrar a sessao inteira do core ao desmontar a vista de jogo; ao sair para `Explorer`, o shell apenas desacopla o runtime visual/audio local, preservando a sessao ativa para quando o usuario voltar ao `Game`.
  - **Arvore canonica do frontend atualizada:** `docs/08_TREE_ARCHITECTURE.md` agora passa a listar explicitamente `src/components/explorer/ExplorerWorkspace.tsx` e `src/components/common/UnifiedTopBar.tsx`, evitando que agentes futuros tratem esses caminhos como drift fora da arquitetura.
  - **Validacao desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit` e `npx vitest run src/App.test.tsx` devem permanecer verdes, incluindo cobertura para menu da top bar, activity rail com `Explorer` e preservacao da sessao ao transitar por esse workspace.

* **O que acabou de acontecer (2026-03-28 - ArtStudio: stage/timeline/inspector mais proximos de ferramenta profissional):**
  - **Layout dockado mais legivel:** `ArtStudioPanel.tsx` passou a separar claramente `main stage`, `timeline` e `inspector`, mantendo a superficie `Experimental`, mas reduzindo a sensacao de painel unico inchado.
  - **Stage recebeu navegacao de autoria real:** o painel agora expoe helpers testaveis para zoom por wheel, pan por arraste e hit-test em `suggested_frames`, preparando a edicao visual sem mudar o pipeline canonico de importacao/aplicar na cena.
  - **Timeline ficou mais editavel:** os cards de sequencia passaram a ser mais claros, com foco acessivel, rename inline e estado contextual do inspector quando uma sequencia ativa e selecionada.
  - **Cobertura focada adicionada:** `ArtStudioPanel.test.ts` agora trava o layout dockado, o comportamento do inspector contextual e os helpers puros de zoom/pan/selecao de frame sugerido.
  - **Status honesto mantido:** esta rodada melhora ergonomia e navegacao do ArtStudio, mas nao altera o posicionamento da superficie como `Experimental` nem promete fechamento adicional do pipeline alem do que ja esta provado em `assets/sprites` -> entidade -> build.

* **O que acabou de acontecer (2026-03-28 - Release readiness endurecido para Windows local):**
  - **Baseline de readiness ficou mais fiel ao gate institucional:** `scripts/release-readiness.mjs` agora executa automaticamente o `desktop E2E` canonico (`scripts/e2e-tauri-build-run.mjs --skip-build --native-driver ...`) quando `--run-baseline` roda em Windows com `toolchains/webdriver/msedgedriver.exe` disponivel.
  - **Menos falso-negativo de promocao:** o agregador deixou de acusar `Desktop E2E nao foi reexecutado nesta rodada` nos hosts Windows aptos, aproximando o report do estado real de distribuicao local.
  - **Gates Rust do baseline ficaram alinhados ao host real:** em Windows, o agregador passou a chamar `scripts/run-cargo-msvc.cmd --manifest-path .\\src-tauri\\Cargo.toml` para `cargo clippy` e `cargo test --lib`, sem forcar `CARGO_TARGET_DIR=cargo-target-shadow` nesses dois gates e reduzindo falso-negativo por ambiente/disco.
  - **Arquivos explicitamente nao canonicos deixaram de bloquear release por engano:** `docs/ESTUDO_FRONTEND_GUI_NAO_CANONICO.md` passou a ser tratado como artefato local de estudo no snapshot de readiness, assim como `.claude/settings.local.json` e `AGENTS.md`.
  - **Bloqueio automatizado caiu para o ultimo gate humano:** com o worktree versionavel limpo e o rerun mais recente de `node scripts/release-readiness.mjs --run-baseline`, o snapshot canonico passou a listar apenas `QA manual ainda pendente: A, B, C, D, E, F` como bloqueador formal para promocao.
  - **Validacao desta rodada:** `node scripts/e2e-tauri-build-run.mjs --skip-build --native-driver .\\toolchains\\webdriver\\msedgedriver.exe` OK (`Canvas 320x224, pixels nao pretos: 558`) e `node scripts/release-readiness.mjs --run-baseline` OK com baseline completa + desktop E2E local.

* **O que acabou de acontecer (2026-03-23 - Reverse Core canonico experimental para ROMs):**
  - **Arquitetura reversa canonica criada:** `src-tauri/src/tools/reverse/` agora concentra `manifest`, `platform`, `loader`, `graphics`, `text`, `audio`, `code`, `trace`, `annotations` e `projection`, com adapter-base por plataforma e implementacoes iniciais para `Mega Drive` e `SNES`.
  - **Manifesto reverso como fonte de verdade:** `RomAnalysisManifest` passou a registrar hashes, header, mapper, chips especiais, segmentos/banks, candidatos de grafico/texto/audio, regioes de codigo, pointer tables, compressao, `logic_hints`, `annotations`, `trace` e `projection_status`.
  - **Compatibilidade sem pipeline paralelo:** `asset_extractor.rs` e `reverse_explorer.rs` agora operam como superfices de compatibilidade derivadas do reverse core canonico, em vez de manter heuristicas soltas sem proveniencia comum.
  - **IPC novo exposto ao app:** `lib.rs` e `toolsService.ts` agora expoem `rom_analyze`, `rom_disassemble`, `rom_get_xrefs`, `rom_get_call_graph`, `rom_extract_graphics`, `rom_extract_text`, `rom_extract_audio` e `rom_save_annotations`.
  - **Workspace reverso integrado na UI:** `ToolsPanel.tsx` ganhou o `Reverse Workspace` como superficie canonica `Experimental`, com abas `ROM Map`, `Hex`, `Graphics`, `Text`, `Audio`, `Code` e `Projection`, incluindo leitura de `xrefs/call graph` e persistencia de anotacoes em sidecar validado por hash.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (177 testes), `cargo clippy -- -D warnings` OK e `cargo test --lib -- --nocapture --test-threads=1` OK (227 aprovados / 0 falhas / 3 ignorados) com `CARGO_TARGET_DIR=C:\\Users\\misae\\AppData\\Local\\RetroDevStudio\\cargo-target-shadow`.
  - **Status honesto mantido:** esta rodada fecha a fundacao/Onda 1 do reverse core e parte inicial da Onda 2 (disassembly/xrefs/anotacoes), mas `trace` com Libretro real, projecao `.rds` e recuperacao avancada de logica continuam em hardening e nao podem ser anunciados como decompilacao completa.

* **O que acabou de acontecer (2026-03-22 - Fechamento do MVP: provas de pipeline e sync documental):**
  - **Auto-updater deferido explicitamente para pos-MVP:** decisao registrada no Roadmap e Memory Bank. O crate `tauri-plugin-updater` permanece como placeholder; nenhum trabalho adicional sera investido ate o MVP ser fechado e a dependencia aprovada formalmente.
  - **ArtStudio multiframe → runtime provado:** novo teste Rust `artstudio_multiframe_animation_reaches_resources_res_and_main_c` prova que um sprite de 4 frames importado via ArtStudio com duas animacoes nomeadas (idle/run) chega ao `resources.res` com `SPRITE` correto e ao `main.c` com `SPR_setAnim` e `SPR_addSprite`.
  - **AnimationDef roundtrip provado:** novo teste Rust `multiframe_sprite_animations_produce_correct_ast_sprite_assets` prova que `AnimationDef` com `fps` e `frames` produz `SpriteAnimation` no AST com `frame_time` correto (60fps projeto / 8fps anim = 8, 60/15 = 4), sorting alfabetico e `default_animation` resolvido.
  - **RetroFX parallax/raster → main.c provado (MD + SNES):** novos testes Rust `retrofx_scene_config_generates_parallax_and_raster_in_main_c` e `retrofx_scene_config_generates_hdma_parallax_in_snes_main_c` provam que config RetroFX persistida na cena JSON (2 parallax layers + 1 raster line) gera `VDP_setScrollingMode(HSCROLL_LINE)`, offsets de parallax no game loop, `retro_hscroll_table[100] += 4` e DMA push no SGDK; e HDMA parallax no SNES.
  - **Release readiness agregada em artefato canonico:** `scripts/release-readiness.mjs` agora consolida baseline, dirty worktree, artefatos, report de build/upstream e checklist manual em `src-tauri/target-test/validation/release-readiness.{json,md}`. `package.json` ganhou `release:readiness` e `release:readiness:baseline`, e o QA RC agora referencia esse report como evidencia formal de promocao.
  - **Maturity matrix corrigida:** Editor subiu de 3.0 para 3.5 (NodeGraph completo, ArtStudio pipeline provado), UX subiu de 2.5 para 3.0 (shell adaptativo, paint/erase, collision map, zoom). Data atualizada para 2026-03-22.
  - **Refactoring de ViewportPanel/ToolsPanel adiado:** apos analise, o ViewportPanel (3355 LOC) tem estado profundamente entrelacado entre Scene View e Game View. Risco de regressao no RC justifica adiar para pos-MVP.

* **O que acabou de acontecer (2026-03-22 - Importadores externos: registry comum + Godot 2D experimental):**
  - **Arquitetura comum de adapters iniciada:** `project_mgr.rs` agora expoe uma matriz canonica de perfis externos (`sgdk`, `mugen`, `ikemen_go`, `godot`, `gamemaker`, `construct`, `rpg_maker`, `unity_2d`, `paper2d_bridge`) com `support_status`, niveis `L1-L4`, target recomendado e flag de importabilidade. Isso passou para o frontend via `list_external_import_profiles` e para o wizard como superficie unica `Importar Externo`.
  - **Primeiro adapter novo alem do eixo SGDK/MUGEN:** `Godot 2D` entrou como importador `Experimental` no backend. O escopo honesto desta wave cobre `project.godot` + `.tscn`, `Sprite2D`, `Camera2D`, `AudioStreamPlayer`/`AudioStreamPlayer2D`, copia real de assets para `assets/sprites` e `assets/audio`, cena `.rds` nativa e metadata de proveniencia registrada.
  - **Limites explicitos do adapter Godot:** `AnimatedSprite2D`, `TileMap`, `TileMapLayer` e qualquer script `GDScript` ainda nao sao convertidos para runtime do RetroDev. Esses itens sao reportados como `skipped_sources`, sem heuristica opaca nem claim de conversao total de logica.
  - **Ikemen GO sem pipeline paralelo:** `ikemen_go` agora e tratado como perfil proprio na matriz de importacao, mas roteado pelo mesmo adapter conservador do dominio MUGEN. Isso evita duplicacao de fluxo enquanto preserva proveniencia distinta no metadata (`source_engine` / `import_profile`).
  - **Metadata mais honesta para importacao externa:** `TemplateMetadata` ganhou `source_engine` e `import_profile`, e o stamp canonico agora diferencia `imported_sgdk`, `imported_mugen`, `imported_ikemen_go` e `imported_godot` sem quebrar retrocompatibilidade do schema.
  - **Resiliencia de validacao restaurada:** o parser Godot foi ajustado para satisfazer `clippy`, o detector de screenpack MUGEN voltou a usar o `[Info] name` real para nomear as cenas, e os testes do mock core passaram a compilar/stagear a DLL em um target seguro derivado de `CARGO_TARGET_DIR`, reduzindo falso-negativo de `LoadLibraryExW failed` neste host Windows.
  - **Cobertura adicionada:** `App.test.tsx` passou a validar o importador externo generico e a selecao de perfil; `project_mgr.rs` ganhou cobertura da matriz de perfis externos e do importador Godot; `lib.rs` ganhou teste do comando Tauri `import_external_project` com perfil `godot` e metadata completa.
  - **Barra real desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (175 testes), `cargo clippy -- -D warnings` OK e `cargo test --lib -- --nocapture --test-threads=1` OK (210 aprovados / 0 falhas / 3 ignorados) usando `CARGO_TARGET_DIR=C:\\Users\\misae\\AppData\\Local\\RetroDevStudio\\cargo-target-shadow` para contornar policy/AppLocker do host.

* **O que acabou de acontecer (2026-03-22 - Importacao MUGEN experimental no fluxo canonico):**
  - **Backend MUGEN entrou no caminho nativo:** `project_mgr.rs` agora expõe `import_mugen_project()` como importador canonico de personagem, stage e screenpack MUGEN, criando projeto `.rds` nativo com cenas reais, assets copiados para `assets/`, metadata `imported_mugen` em `project.rds` e sem abrir pipeline paralelo ao Project Manager.
  - **Escopo honesto desta wave:** a importacao cobre `DEF`/`AIR`, composicao de atlas/animacoes, colisao MUGEN basica e importacao visual/sonora conservadora. A conversao total de gameplay de `CMD/CNS` para a engine continua fora de escopo e nao pode ser anunciada como pronta.
  - **Fallback resiliente para assets MUGEN:** o importador agora suporta tanto `SFF v1` quanto pastas extraidas `work/*_sff` para sprites de screenpack/stage/personagem quando existirem, o que melhora a cobertura sobre colecoes reais de teste sem inferencia heuristica agressiva.
  - **Wizard alinhado ao fluxo real:** `App.tsx` ganhou `Importar Projeto MUGEN`, e `Importar Projeto SGDK` deixou de usar o wrapper legado por padrao, passando a chamar o importador nativo canonico. O caminho de overlay SGDK legado continua disponivel apenas por `Abrir Existente`.
  - **Cobertura adicionada:** `App.test.tsx` cobre o novo botao MUGEN e o SGDK canonico; `project_mgr.rs` ganhou fixtures e testes do importador MUGEN com `character/stage/screenpack`; `lib.rs` ganhou teste do comando Tauri `import_mugen_project`.
  - **Status atual desta trilha:** o fluxo MUGEN segue `Experimental`, mas a validacao Rust completa voltou a ficar verde usando target seguro no host; o baseline valido desta rodada esta registrado no item mais recente acima.

* **O que acabou de acontecer (2026-03-22 - Diretriz de publicacao apos validacao verde):**
  - **Onboarding canonico fechado em `CLAUDE.md`:** a decisao de governanca desta sessao formalizou `CLAUDE.md` como arquivo unico de onboarding para agentes na raiz do repositorio; `AGENTS.md` permanece fora do fluxo institucional por enquanto.
  - **Regra futura para agentes:** `CLAUDE.md` e `docs/09_AGENT_DEV_MODE.md` agora deixam explicito que, quando a entrega tiver gates verdes e houver mudancas rastreaveis no escopo, o agente deve criar commit(s) coerentes e executar `git push` no branch atual, salvo instrucao contraria do usuario ou necessidade real de curadoria adicional antes da publicacao.

* **O que acabou de acontecer (2026-03-21 - Auditoria de tasks interrompidas e refinamento seguro do wizard):**
  - **Sem alteracoes fantasmas nas areas criticas:** a auditoria do worktree confirmou que nao havia mudancas pendentes em `App.tsx`, `ToolsPanel.tsx`, `project_mgr.rs`, `lib.rs` ou `ArtStudioPanel.tsx` vindas do agente interrompido. As unicas diffs locais fora desta rodada estavam restritas ao hardening dos scripts de build e docs correlatos.
  - **Wizard mais claro sem mudar o contrato do backend:** `lib.rs` ganhou o comando `suggest_project_base_dir`, e `App.tsx` agora mostra no onboarding a pasta automatica preferencial antes da criacao, em vez de deixar apenas o texto generico `(automatico pelo sistema)`.
  - **Validacao de template mais explicita:** o card-resumo do template selecionado agora mostra o estado do fluxo (`pronto` vs `indisponivel`), o motivo do bloqueio quando existir e, para seeds `external_sgdk`, a pasta doadora atual ou a instrucao objetiva para liberar o template.
  - **Decisao de governanca mantida:** a rodada nao promoveu duas ideias do rascunho interrompido. `.res` funcional para todos os assets ficou rejeitado por tender a um pipeline paralelo ao emitter canonico; `Adopt Asset` generico para qualquer arquivo do host legado tambem ficou adiado, porque o wrapper `rds/` ja materializa automaticamente os recursos SGDK suportados e o restante ainda exige uma politica de destino canonico que nao vale abrir no hardening atual.
  - **Cobertura nova:** `App.test.tsx` agora cobre a exibicao da pasta base sugerida pelo backend, e `lib.rs` ganhou teste unitario para a sugestao de UI escolher o primeiro candidato automatico esperado.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (174 testes), `cargo clippy -- -D warnings` OK e `cargo test --lib -- --nocapture --test-threads=1` OK (200 aprovados / 0 falhas / 2 ignorados).

* **O que acabou de acontecer (2026-03-21 - Script canonico de build: resiliencia e abertura da pasta do binario):**
  - **Descoberta do `.exe` neste host:** o executavel canonico de debug continua em `src-tauri/target-test/debug/retro-dev-studio.exe`, e o portable/release em `src-tauri/target-test/release/retro-dev-studio.exe`.
  - **Script mais resiliente:** `scripts/build.mjs` agora resolve o `.exe` final de forma mais robusta quando o artefato esperado nao aparece exatamente no nome fixo, escolhe o MSI mais recente e deixou de apagar preventivamente o binario antigo; a validacao passa a exigir que o artefato tenha sido atualizado nesta execucao, evitando falso-verde sem destruir o ultimo build funcional do usuario.
  - **UX de teste local:** o script agora aceita `--open-dir` para abrir a pasta do artefato ao final do build local, sem disparar isso em CI. `package.json` ganhou atalhos `build:debug:open`, `build:msi:open` e `build:portable:open`.
  - **Docs alinhados:** `08_TREE_ARCHITECTURE.md` agora documenta o uso `node scripts/build.mjs <debug|msi|portable|all> [--open-dir]`.

* **O que acabou de acontecer (2026-03-21 - Wrapper SGDK final: Asset Browser legado e delegacao de build):**
  - **Tree host visivel na UI:** `ToolsPanel.tsx` agora renderiza no `Asset Browser` uma secao `Projeto host SGDK` quando `projectLegacyIndex` esta presente. Os buckets `src/`, `inc/`, `res/`, `assets host` e `out/` aparecem como navegacao read-only, deixando claro que o codigo legado foi adotado sem virar editor paralelo.
  - **Preview read-only seguro:** o backend ganhou o comando `read_legacy_project_file`, que so permite abrir arquivos previamente indexados pelo `legacy_sgdk_index.json`, bloqueia caminhos absolutos/`..`, limita preview a texto e marca a leitura como `readonly`. O frontend mostra nota, caminho absoluto e conteudo truncado quando necessario.
  - **Delegacao de build para o host:** `build_orch.rs` agora detecta overlay legado real (`template_id = legacy_sgdk_overlay` ou `legacy_sgdk_index.json`) e, nesse caso, delega o build Mega Drive para o Makefile do host em vez de tentar compilar a cena vazia do overlay. O ROM resultante em `<HOST>/out/` volta pelo caminho canonico para o emulador integrado.
  - **Sem regressao no caminho nativo:** o hardening desta rodada corrigiu uma regressao onde templates com donor SGDK estavam sendo confundidos com overlay legado. O build nativo de templates como `platformer_seed` continua usando o workspace `build/megadrive` do projeto RetroDev, enquanto apenas o wrapper `rds/` delega para o Makefile do host.
  - **Fallback de novo usuario reprovado? nao:** `lib.rs` agora cobre explicitamente `automatic_onboarding_base_dir_supports_canonical_megadrive_build`, provando que o fluxo de pasta automatica (`Documents/RetroDevProjects` ou fallback equivalente) nao deixa caminhos quebrados no primeiro `Build & Run`.
  - **Prova ponta a ponta do legado:** `e2e_legacy_overlay_build_load_and_run_frame` passou no backend e registrou log canonico do fluxo `Build -> ROM -> Emulacao` para projeto SGDK envelopado, incluindo `Modo overlay SGDK legado detectado. Delegando build para host ...` e `ROM gerada: ...\\out\\artifact.md`.
  - **Barra verde desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (173 testes), `cargo clippy -- -D warnings` OK e `cargo test --lib -- --nocapture --test-threads=1` OK (199 aprovados / 0 falhas / 2 ignorados). A primeira execucao completa da suite Rust capturou uma regressao real nos templates com donor SGDK; o orquestrador foi corrigido para delegar apenas overlays legados reais e o rerun serial final ficou verde.

* **O que acabou de acontecer (2026-03-21 - Project Manager: fallback automatico e adocao nao-destrutiva de SGDK legado):**
  - **Criacao sem friccao:** `create_onboarding_project` e `create_project_from_template` deixaram de exigir uma pasta base manual. Quando o usuario nao escolhe diretorio, o backend agora resolve automaticamente uma pasta segura (`Documents/RetroDevProjects` ou fallback equivalente do sistema) e valida escrita com probe fisico antes de criar o projeto.
  - **Fallback seguro para diretÃ³rios ruins:** se a pasta informada pelo usuario nao estiver pronta para escrita, o backend cai graciosamente para uma pasta automatica segura e devolve `notice` no IPC para a UI registrar a realocacao sem quebrar o fluxo do wizard.
  - **Adocao de SGDK legado no abrir/importar:** `open_project_dialog`, `open_project_path` e o novo comando `import_legacy_sgdk_project` agora detectam diretorios SGDK sem `project.rds` e criam um overlay `rds/` no proprio host selecionado, sem sobrescrever `main.c`, `.res`, headers ou `out/`.
  - **Overlay seguro por padrao:** a adocao legada passou a usar `rds/project.rds`, `rds/scenes/main.json`, `rds/assets/...` com projecao canonica dos assets suportados e `rds/legacy_sgdk_index.json` com o mapa dos arquivos host (`.c`, `.h`, `.res`, `res/`, `out/`). O `build/` canonico permanece isolado no overlay para nao arriscar limpar o `out/` original do projeto host.
  - **Indice legado agora hidrata o editor:** `get_scene_data` passou a devolver `legacy_sgdk_index` quando o projeto aberto veio de um overlay `rds/`, e o frontend grava esse payload no store junto de `source_kind` para que a arvore SGDK host exista como estado consultavel do editor, nao apenas como sidecar em disco.
  - **Resumo visivel no workspace canonico:** `Tools -> Runtime Setup` agora exibe um card discreto de `SGDK legado` com host root, overlay `rds/`, contagens por bucket (`.c`, `.h`, manifests, recursos, `out/`) e detalhes sob demanda via `Ver indice`, reduzindo a necessidade de inspecionar o sidecar manualmente.
  - **Cena opcional, metadata obrigatoria:** quando o legado possui manifests `.res`, o overlay gera a cena importada a partir deles usando o mesmo mapeamento canÃ´nico do importador SGDK; quando o host tem apenas `main.c`/headers, o workspace ainda nasce valido com cena vazia e `template_metadata.source_kind = "external_sgdk"`.
  - **Cobertura nova:** `project_mgr.rs` ganhou testes para wrapper de pasta com `main.c` apenas e para overlay com manifests/assets reais; `lib.rs` agora cobre `open_project_path` adotando legado in-place, o fallback de pasta automatica e o comando de importacao legada sem copia de codigo. `App.test.tsx` cobre criacao sem pasta base explicita e importacao SGDK via wrapper.
  - **Logs de validacao desta rodada:** `cargo test --lib import_legacy_sgdk_project_creates_overlay_for_main_c_only_workspace -- --nocapture --test-threads=1` OK com log `[legacy-main-c] overlay=...\\rds`; `cargo test --lib open_project_path_wraps_legacy_sgdk_directory_in_place -- --nocapture --test-threads=1` OK com log `[open-legacy] ...\\rds`; `cargo test --lib import_legacy_sgdk_project_command_wraps_directory_without_copying_code -- --nocapture --test-threads=1` OK com log `[legacy-import-command] ...\\rds`; `cargo test --lib resolve_project_base_dir_with_candidates_falls_back_and_creates_directory -- --nocapture --test-threads=1` OK com log `[fallback-base-dir] requested='...\\not-a-directory' resolved='...\\RetroDevProjects'`; `cargo test --lib get_scene_data_exposes_legacy_sgdk_index_for_overlay_projects -- --nocapture --test-threads=1` OK com log `[scene-data-legacy-index] overlay='...\\rds' c_files=2 manifests=1`.
  - **Barra verde reexecutada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (171 testes), `cargo clippy -- -D warnings` OK e `cargo test --lib -- --nocapture --test-threads=1` OK (193 aprovados / 0 falhas / 2 ignorados).

* **O que acabou de acontecer (2026-03-20 - ArtStudio Sprint 4: prova ponta a ponta ate o build canonico):**
  - **Wiring fechado no frontend:** `ArtStudioPanel.tsx` agora so libera `Aplicar na Cena` depois que o sprite sheet canonico existe em `assets/sprites`; ao aplicar, ele cria ou atualiza uma entidade real com `SpriteComponent.asset`, `frame_width`, `frame_height` e `animations` no caminho canonico do editor.
  - **Factory e schema confirmados:** `editorEntityFactory.ts`, `sceneService.ts` e o schema Rust continuam aceitando os mesmos campos que o ArtStudio grava; o contrato do `SpriteComponent` nao precisou de pipeline paralelo nem adaptacao fora da arquitetura atual.
  - **Emitter SGDK validado:** `sgdk_emitter.rs` segue emitindo `SPRITE nome "path" width height NONE tempo` a partir do AST canonico, com conversao de pixels para tiles de 8x8. O teste novo de `build_orch.rs` trava explicitamente a linha `SPRITE artstudio_hero "assets/sprites/artstudio_hero.bmp" 2 2 NONE 4` para asset vindo do fluxo do ArtStudio.
  - **Teste de integracao real no backend:** `build_generates_megadrive_workspace_for_artstudio_imported_asset` agora cobre `import_art_asset_internal -> project fixture -> run_build_with_environment -> resources.res`, provando que um asset canonico gerado pelo ArtStudio chega ao workspace Mega Drive sem quebrar o build.
  - **Cobertura frontend reforcada:** `ArtStudioPanel.test.ts` agora confirma que, apos importar canonico e clicar em `Aplicar`, a entidade real na cena aponta para `assets/sprites/hero_sheet.png` com `frame_width`, `frame_height` e `animations` corretos.
  - **Gates desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (170 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture --test-threads=1` OK (187 aprovados / 0 falhas / 2 ignorados).
  - **Prova operacional honesta:** o smoke desktop canonico geral (`scripts/e2e-tauri-build-run.mjs --skip-build`) continua verde no host local. A tentativa de repetir o fluxo com um projeto temporario customizado para o ArtStudio esbarrou em erro de WebDriver apos o bootstrap da sessao, e o teste manual ignorado com SGDK oficial excedeu a janela pratica desta sessao. Mesmo assim, a prova local deterministica ate o build ficou fechada pelos testes canonicos e pela emissao verificada do `resources.res`.
  - **Status honesto mantido:** o ArtStudio continua `Experimental` como superficie de autoria, mas o epico de pipeline basico pode ser considerado fechado localmente no escopo `ArtStudio -> entidade sprite -> build workspace/resources.res`. O passo seguinte deixa de ser wiring e passa a ser repeticao institucional com toolchain oficial e prova adicional de runtime quando essa superficie voltar ao foco.

* **O que acabou de acontecer (2026-03-20 - Hardening de build scripts, guardrails de workspace e alinhamento canonico):**
  - **Workspace de build confinado ao projeto:** `build_orch.rs` agora sanitiza `build.output_dir` antes de montar o workspace e rejeita caminhos absolutos, `..` e qualquer valor que tente escapar da raiz do projeto; a suite Rust ganhou cobertura dedicada para esse guardrail e para garantir que diretorios irmaos nao sejam tocados em caso de configuracao hostil.
  - **Script canonico sem falso-verde:** `scripts/build.mjs` agora limpa os artefatos esperados antes da compilacao e falha explicitamente se o EXE/MSI correspondente nao for gerado ao final. Isso elimina o caso em que o script terminava com `exit 0` apenas relatando `nao encontrado`.
  - **Fonte unica de build desktop:** o workflow `.github/workflows/desktop-e2e.yml` passou a chamar `npm run build:debug` em vez de `npm run tauri build -- --debug --no-bundle` diretamente, e agora observa mudancas em `scripts/build.mjs` no path filter.
  - **Governanca alinhada:** `08_TREE_ARCHITECTURE.md` passou a listar os wrappers/scripts reais (`run-in-msvc.cmd`, `run-cargo-msvc.cmd`, `validate-upstream-windows.ps1` e afins), e o guidance canonico de MSI em Windows institucional agora aponta para `scripts/run-in-msvc.cmd npm run build:msi`.
  - **Gate Rust unificado:** a comparacao local desta rodada confirmou flake do mock core quando a suite roda em paralelo; por isso o baseline canonico institucional volta a usar `cargo test --lib -- --nocapture --test-threads=1`, alinhando Memory Bank, CI e documentacao de processo em torno do caminho deterministico.
  - **Validacao desta rodada:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK, `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture --test-threads=1` OK, `node --check scripts/build.mjs` OK e `npm run build:debug` OK com artefato novo em `src-tauri/target-test/debug/retro-dev-studio.exe`. O rerun em paralelo voltou a exibir instabilidade no mock core (`rewind_restores_previous_mock_core_snapshot` / `LoadLibraryExW failed`), reforcando a decisao pelo serial.
  - **Status honesto mantido:** o caminho canonico de build ficou mais seguro e menos ambíguo, mas a robustez institucional completa continua dependendo de repeticao em host Windows apropriado quando o escopo tocar bundle MSI, toolchains reais ou smoke desktop remoto.

* **O que acabou de acontecer (2026-03-20 - Shell UX: Tools workspace e layout adaptativo):**
  - **Workspace mais limpo:** `App.tsx` deixou de concentrar todas as acoes e contextos no topo; a navegacao principal agora usa rail lateral com `Scene`, `Game`, `Logic`, `FX`, `Art` e `Debug`, enquanto a top bar ficou restrita a acoes globais (`Novo`, `Abrir`, `Salvar`, `Build & Run`, `Play`, `Stop`).
  - **Painel contextual real:** `ToolsPanel.tsx` saiu do modelo de tabs planas e passou a operar como workspace contextual com categorias `Create`, `Configure`, `Analyze` e `Experimental`, separando melhor autoria, setup, analise e superficies em hardening.
  - **Modo basico vs avancado:** ferramentas tecnicas deixaram de competir com o fluxo principal; por padrao, o workspace mostra o recorte basico e a trilha avancada fica atras do toggle `Avancado`, com o workspace `Debug` entrando ja orientado para analise.
  - **Indicadores secundarios:** budgets de VRAM, scanline e paleta foram mantidos, mas agora vivem na faixa secundaria junto do estado live, presets de layout e acoes utilitarias, reduzindo competicao visual com o fluxo principal.
  - **Layout adaptativo sem mentir sobre escopo:** o shell ganhou presets `Artist`, `Logic`, `Debug` e `Playtest`, salvamento/restauro de layout, focus mode e painel direito alternavel entre `Inspector` e `Tools`; isso melhora muito a ergonomia, mas ainda nao equivale a docking livre completo.
  - **Console menos invasivo:** `consoleVisible` passou a iniciar fechado, continua disponivel sob demanda e agora abre automaticamente em logs `error`, reduzindo ruido constante sem esconder falhas importantes.
  - **Viewport integrado ao shell:** `ViewportPanel.tsx` agora pode ocultar a barra interna de tabs quando o shell principal assume a navegacao de workspace, evitando duplicacao de contexto entre viewport e App.
  - **Cobertura frontend ajustada:** `ToolsPanel.test.tsx` passou a validar o novo fluxo contextual do `Asset Browser`; `App.test.tsx` agora cobre a alternancia do painel direito entre `Inspector` e `Tools`.
  - **Gates reexecutados no workspace atual:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (169 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture` OK (174 aprovados / 0 falhas / 1 ignorado).
  - **Status honesto mantido:** a UX do shell subiu bastante de nivel, mas esta rodada nao implementou docking livre, drag-and-dock entre paineis ou serializacao canonicamente rica de layouts por modo; o ganho real foi organizacao, responsividade e foco visual dentro da arquitetura atual.

* **O que acabou de acontecer (2026-03-20 - RetroFX: editor visual-first de profundidade e movimento):**
  - **Parallax visual-first:** `RetroFXDesigner.tsx` deixou de ser um formulario tecnico simples e passou a usar layout em 3 areas (`Layers`, `Preview grande`, `Propriedades`), com foco didatico e feedback imediato.
  - **Preview animado real:** o tab `Parallax` agora simula movimento continuo com `play/pause`, loop visual, leitura pedagogica de profundidade e labels amigaveis (`Far`, `Mid`, `Near`) em vez de depender apenas de numeros.
  - **Lista de camadas util:** cada camada ganhou card visual com toggle de visibilidade, velocidade X/Y resumida, indicador de profundidade e reorder por drag para reorganizar o efeito.
  - **Controles melhores:** propriedades da camada selecionada agora usam sliders + input numerico com ajuste fino por teclado, tooltips explicativos e atualizacao instantanea do preview.
  - **Persistencia segura:** o `Salvar RetroFX` agora grava `retrofx` tanto em `activeScene` quanto em `activeSceneSource` antes de chamar `persistActiveScene`, evitando perder configuracao na cena fonte.
  - **Raster preservado:** o tab `Raster` foi mantido como editor auxiliar, com preview local e sem alterar backend/pipeline.
  - **Cobertura dedicada:** `RetroFXDesigner.test.tsx` agora cobre workspace visual/pedagogico, atualizacao imediata dos controles, toggle do preview e persistencia do payload `retrofx`.
  - **Gates reexecutados no workspace atual:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (168 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture` OK (174 aprovados / 0 falhas / 1 ignorado). Houve uma falha transitoria inicial em `tests::e2e_build_load_and_run_frame` por `LoadLibraryExW failed` ao carregar o mock core, mas o teste isolado e o rerun completo passaram, caracterizando instabilidade de host/runner e nao regressao do RetroFX.
  - **Status honesto mantido:** RetroFX continua `Experimental`; a UX de autoria evoluiu muito, mas ainda falta validacao com cenas reais/ROM real para rebaixar risco institucional.

* **O que acabou de acontecer (2026-03-20 - ArtStudio: hardening de importacao e UX de ingestao):**
  - **Causa real das falhas de imagem:** o painel colapsava qualquer erro em `img.onerror` com a mensagem generica `[ArtStudio] Falha ao carregar imagem.`, sem distinguir formato nao suportado, path invalido, falha do asset protocol, arquivo ausente, permissao ou decode quebrado.
  - **Importacao endurecida:** `ArtStudioPanel.tsx` agora aceita `PNG`, `BMP`, `JPG/JPEG`, `GIF`, `WebP` e `PPM`, tenta carregar via `convertFileSrc()` e usa fallback `fetch -> Blob -> objectURL` quando a primeira rota falha.
  - **Ingestao externa segura:** imagens fora de `assets/sprites` deixam de ser rejeitadas como se estivessem quebradas; agora entram no canvas para preparo, slicing e preview, mas continuam bloqueadas para "Aplicar na Cena" ate serem movidas para a arvore canonica do projeto.
  - **UX de producao:** o layout do ArtStudio foi reorganizado em 3 areas claras (`Source / Sprite Sheet`, `Sequences / Configuracao`, `Preview / Output / Apply`), com canvas maior, zoom, pan por scroll, estado vazio instrutivo, metadados do arquivo carregado e CTA principal de importacao mais evidente.
  - **Diagnostico claro:** a UI agora mostra nome do arquivo, formato, resolucao, origem (`Projeto` vs `Externa`) e mensagens acionaveis para `formato nao suportado`, `arquivo nao encontrado`, `permissao`, `asset protocol` e `decode`.
  - **Cobertura frontend:** `ArtStudioPanel.test.ts` agora cobre deteccao de formatos, classificacao de falhas, roundtrip helper de animacoes e dois fluxos reais de importacao (`imagem externa` e `asset do projeto`).
  - **Gates reexecutados no workspace atual:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (164 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture` OK (174 aprovados / 0 falhas / 1 ignorado). Houve uma falha transitoria inicial no mock core `read_memory_returns_predictable_mock_core_bytes`, mas o teste isolado e o rerun completo passaram, caracterizando instabilidade de host/runner e nao regressao do ArtStudio.
  - **Status honesto mantido:** o ArtStudio continua `Experimental`; esta rodada endureceu ingestao, produtividade e seguranca de dados, mas nao abriu conversao para Mega Drive nem integracao nova com NodeGraph.

* **O que acabou de acontecer (2026-03-19 - Decisao e institucionalizacao minima do ArtStudio):**
  - **Status decidido:** o ArtStudio deixou de ser tratado como WIP fora da baseline do workspace e passou a integrar a baseline atual como superficie `Experimental`.
  - **Escopo da institucionalizacao:** nenhuma feature nova foi aberta; a rodada focou apenas em consistencia, persistencia e seguranca de dados do caminho `ArtStudioPanel -> editorStore -> sceneService -> project_mgr -> schema/pipeline`.
  - **Validacao minima no frontend:** `ArtStudioPanel.tsx` agora so aceita salvar sprite sheets que ja estejam dentro de `assets/sprites` do projeto, preserva subdiretorios em vez de achatar para basename, valida nomes/chaves de animacao, rejeita duplicidade apos normalizacao, bloqueia frame maior que o sprite sheet e aplica `constrainSpriteFrameSize()` antes de gravar na entidade.
  - **Sinalizacao honesta:** o painel agora exibe aviso explicito `Experimental - salva animacoes na entidade sprite, mas ainda nao esta totalmente integrado ao pipeline`.
  - **Cobertura adicionada:** `ArtStudioPanel.test.ts` valida origem segura do asset e normalizacao de animacoes; `editorEntityFactory.test.ts` cobre preservacao das animacoes e constrain por target; `sceneService.test.ts` cobre parse do schema com `animations/frame_width/frame_height`; `project_mgr.rs` ganhou roundtrip `save/load` para payload de animacao.
  - **Gates reexecutados no estado atual do workspace:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (159 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture` OK (174 aprovados / 0 falhas / 1 ignorado).
  - **Risco residual mantido explicito:** o ArtStudio ja produz e persiste dados validos no schema canonico, mas ainda nao possui prova ponta a ponta de autoria de animacao chegando ao runtime por fluxo institucional completo; por isso permanece `Experimental`.

* **O que acabou de acontecer (2026-03-19 - Consolidacao do fluxo desktop `Build -> ROM -> Run` e coerencia do Game View):**
  - **Game View coerente:** `ViewportPanel.tsx` passou a usar o mesmo conceito de sessao do emulador (`emulatorLoaded || emulatorActive`) tanto no texto de status quanto nos controles do painel, evitando contradicao entre "Carregue uma ROM" e uma sessao ja existente.
  - **Cobertura frontend reforcada:** `App.test.tsx` agora cobre explicitamente a transicao `ROM carregada -> aguardando emulador -> emulador ativo` e o estado textual de `Emulador pausado`.
  - **Gates reexecutados no estado atual do workspace:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (154 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture` OK (173 aprovados / 0 falhas / 1 ignorado).
  - **Smoke desktop canonico:** `node scripts/e2e-tauri-build-run.mjs --native-driver .\\toolchains\\webdriver\\msedgedriver.exe` passou em 1 tentativa neste host, incluindo `Build -> Load ROM -> Run frames` para o fixture `megadrive_dummy`.
  - **Distincao baseline vs worktree:** o fluxo desktop canonico ficou verde no estado atual do workspace, mas o repositório continua com WIP nao institucionalizado fora do escopo desta sprint (`ArtStudioPanel.tsx`, `useSpriteAnimator.ts`, `components.rs`, `mod.rs`, `serde_helpers.rs`), que nao deve ser promovido automaticamente a baseline de produto.

  - **Atualizacao posterior desta trilha:** apos a rodada de decisao do ArtStudio registrada acima, `ArtStudioPanel.tsx`, `useSpriteAnimator.ts`, `components.rs`, `mod.rs` e `serde_helpers.rs` deixam de contar como WIP fora da baseline do workspace e passam a compor a superficie `Experimental` institucionalizada desta area.

* **O que acabou de acontecer (2026-03-19 - Hardening de persistencia, schema, templates e UI):**
  - **Persistencia Windows:** `project_mgr.rs` passou a tratar `ERROR_ACCESS_DENIED` / `ERROR_SHARING_VIOLATION` como transientes, com retry e fallback `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` para save atomico de projeto/cena.
  - **Schema UGDM 1.6.0:** cadeia explicita de migracao completada (`1.3 -> 1.4` collision_map, `1.4 -> 1.5` layers, `1.5 -> 1.6` display_name), mantendo leitura retrocompativel e escrita no formato novo.
  - **Semantica de entidade:** `prefab` voltou a significar apenas referencia canonica; `display_name` foi introduzido no schema/IPC/frontend; labels visiveis agora seguem `display_name ?? basename(prefab) ?? entity_id`.
  - **Templates ponta a ponta:** `platformer_gm` ficou alinhado entre registry, testes Rust/TS, fixture dummy, wizard e docs.
  - **UI honesta sobre maturidade:** `Asset Extractor` e `Memory Viewer` voltaram a exibir badge/notice `Experimental`; `nodeCompiler.ts` foi marcado como legado/experimental e nao-canonico.
  - **Gates verificados nesta rodada:** `check-tree` OK, `eslint` OK, `tsc --noEmit` OK, `vitest` OK (153 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture` OK (173 aprovados / 0 falhas / 1 ignorado).
  - **Smoke desktop:** naquela rodada, `live-ok` com `--skip-build` voltou a passar no app Tauri local, mas o smoke completo `Build & Run` do dummy Mega Drive ainda falhava neste host. Esse ponto foi revalidado e superado pela sprint posterior de consolidacao do Game View registrada acima.

### Matriz objetiva por subsistema (2026-03-19)

| Subsistema | Status | Leitura objetiva |
|------|------|------|
| Infra desktop Tauri + IPC + store base | Robusto | Integracao Rust/React/Tauri real e coerente. |
| Persistencia de projeto/cena e save atomico Windows | Robusto | Regressao `os error 5` corrigida e validada pelos gates Rust. |
| Schema UGDM, paridade Rust-TS e migracoes | Parcial | Tipos e migracoes explicitas agora cobrem ate `1.6.0`, mas ainda requerem repeticao institucional em cenarios de projeto antigo real. |
| Wizard, onboarding e catalogo de templates | Parcial | Fluxo real e alinhado com `platformer_gm`, ainda em beta manual. |
| Importacao SGDK / overlay `rds/` | Experimental | Fluxo real, ainda sensivel a QA manual e projetos externos. |
| Build orchestration MD/SNES | Robusto | Pipeline canonico `UGDM -> workspace -> ROM` continua real e coberto. |
| Emulacao Libretro / Game View | Parcial | Fluxo real e integrado; o smoke desktop completo `Build -> ROM -> Run` voltou a passar neste host, mas a repeticao institucional ainda deve ocorrer em baseline commitada. |
| Live validation e hardware profiles | Robusto | Validacao autoritativa continua coerente com os targets. |
| Collision map | Parcial | Funcional e migrado, ainda precisa de repeticao institucional apos a rodada de schema. |
| Layer system | Parcial | Funcional e persistente, ainda jovem como superficie de produto. |
| NodeGraph canonico backend (AST/emitter) | Parcial | Codigo real e util, mas ainda concentrado e complexo. |
| `nodeCompiler.ts` frontend legado | Fake | Nao sustenta claim de caminho oficial; ficou explicitamente legado/experimental. |
| RetroFX | Experimental | Superficie real, agora com editor visual-first, preview animado e persistencia coberta por testes; ainda sem certificacao com ROM/cenas reais. |
| Deep Profiler | Parcial | Ferramenta real, mas heuristica. |
| Asset Extractor | Experimental | Ferramenta real, ainda sem certificacao ponta a ponta. |
| Memory Viewer / VRAM Viewer / Reverse Explorer | Experimental | Ferramentas reais de inspecao; o Reverse Workspace agora tem manifesto canonico, disassembly inicial, xrefs/call graph e anotacoes persistidas, mas ainda sem trace/projecao certificados. |
| ArtStudio | Experimental | Superficie institucionalizada na baseline do workspace, com ingestao backend, `suggested_frames`, importacao canonica e pipeline basico ate `resources.res/build` provados localmente; ainda falta repeticao institucional com toolchain oficial e prova adicional de runtime para animacao autorada. |
| Processo, CI e coerencia documental do checkout atual | Parcial | Gates e smoke desktop canonico ficaram verdes no workspace atual, o shell foi reorganizado com sucesso, mas ainda ha WIP fora da baseline commitada e a repeticao institucional continua necessaria. |

* **O que acabou de acontecer (2026-03-19 - ArtStudio Sprint 2: Motor de Animação e UGDM):**
  - **useSpriteAnimator.ts:** Hook para loop de animação com requestAnimationFrame e FPS configurável.
  - **ArtStudioPanel:** Estado com useReducer (SpriteSequence: name, frames, fps, loop); seleção de frames no grid (clique toggle); feedback visual (bg-blue-500/40 + numeração); preview animado com drawImage slice; sequências editáveis (input), deletáveis (lixeira), nova sequência auto-selecionada; botão "Aplicar na Cena" com comportamento misto (Atualizar Entidade Selecionada vs Criar Nova Entidade); validação (sequências com frames); toast "Salvo!" 2s.
  - **editorEntityFactory:** createSpriteEntityFromAsset aceita frameWidth, frameHeight e animations para integração UGDM.
  - Gates: check:tree, lint, 151 testes OK.

* **O que acabou de acontecer (2026-03-19 - ArtStudio Sprint 1: Layout e Sprite Slicer):**
  - ArtStudioPanel reformulado em layout de 3 colunas (estilo Unity Sprite Editor / GameMaker).
  - **Coluna Esquerda:** Botão Carregar Sprite Sheet (Tauri open), canvas com imagem e grid de fatiamento; inputs Frame Width/Height (padrão 32x32).
  - **Coluna Meio:** Paleta Mega Drive (16 slots: transparente + 15 cores); lista Sequences (IDLE, RUN, JUMP) com botão + Nova Sequência; dropdown Compressão SGDK (NONE, APLIB, FAST, BEST).
  - **Coluna Direita:** Preview (placeholder), FPS input, botões Play/Stop/Loop; bloco Output (.res) com string `SPRITE name "path" [W] [H] [COMP]`.
  - Apenas Tailwind; sem lógica de animação nem ferramentas de desenho nesta sprint. Gates: check:tree, lint, tsc, 151 testes OK.

* **O que acabou de acontecer (2026-03-18 - Photo2SGDK Fundacao e Modulo 1):**
  - Integrado modulo Photo2SGDK como Transformador de Assets 100% isolado (nao altera sgdk_emitter, build_orch ou project.rds).
  - **Frontend:** Nova aba AT ArtStudio no ViewportPanel; `ArtStudioPanel.tsx` com area de drop, botao Selecionar imagem, Split View (Original vs Processado); `artStudioService.ts` com `artProcessPalette`.
  - **Backend:** `src-tauri/src/tools/photo2sgdk.rs` com comando IPC `art_process_palette`; quantizacao Median Cut para 15 cores; palette snapping Mega Drive (8 niveis por canal: 0, 36, 73, 109, 146, 182, 219, 255); retorno em base64 PNG.
  - **Dependencias:** `base64 = "0.22"`; `image` com feature `jpeg` para suporte JPG. Documentado em `docs/02_TECH_STACK.md` e `docs/08_TREE_ARCHITECTURE.md`.
  - Gates: check:tree, lint, tsc, 151 testes frontend OK; cargo clippy OK.

* **O que acabou de acontecer (2026-03-18 - Frontend Overhaul + Sprint Visual + Hotfix SGDK 2.11+):**
  - **Frontend Overhaul consolidado:**
    - **Passo 1 (Layout):** Layout dinamico com `react-resizable-panels` (Group, Panel, useDefaultLayout) em `App.tsx`; `LayoutSplitter.tsx` com 4px, hover/active; paineis esquerdo 15%, centro flexivel, direito 20%; persistencia em localStorage `retrodev-layout`.
    - **Passo 2 (NodeGraph):** NodeGraphEditor reformulado estilo Unreal Blueprints/Unity Visual Scripting: paleta com scrollbars customizadas, busca, accordions expansiveis, icones por grupo; nos com headers coloridos por categoria (Eventos=vinho, Acoes=azul, Condicoes=cinza); selecao com ring-2 ring-blue-500 shadow-2xl.
    - **Passo 3 (Asset Browser):** Limpeza de overflow; thumbnails com `imageRendering: pixelated`; Inspector com preview visual via `convertFileSrc` + `resolveProjectAssetPath`; `pathUtils.ts` compartilhado.
    - **Passo 4 (Sprint Visual):** Viewport WYSIWYG com `drawImage` real (pre-carregamento de assets, contornos condicionais apenas quando selecionado ou modo colisao/pintura/apagar); zoom padrao inicial 175% no store e no Game View; fix dos botoes do emulador (Pausar, Retomar, Step, etc.) usando `emulatorActive` como fallback alem de `emulatorLoaded`; busca de padroes no Memory Viewer (hex ou texto, Procurar Proximo, scroll e highlight da linha encontrada).
  - **Hotfix SGDK Emitter 2.11+:** Remocao de `SPR_getX`/`SPR_getY` (inexistentes no SGDK 2.x); posicao de sprites em variaveis locais `spr_XXX_x`/`spr_XXX_y`; atualizacao do driver de audio `2ADPCM` -> `XGM` no `resources.res`.
  - Gates: check:tree, lint, tsc, 151 testes frontend, cargo clippy OK.

* **O que acabou de acontecer (2026-03-17 - Modernizacao SGDK Emitter para 2.11+):**
  - Emitter SGDK atualizado para APIs modernas: `SND_startPlayPCM_XGM` -> `XGM_startPlayPCM`; removido `SPR_getX`/`SPR_getY` (nao existem no SGDK 2.x). Posicao de sprites agora em variaveis locais `spr_XXX_x`/`spr_XXX_y` em main(); MoveSprite e ApplyPhysics atualizam essas vars e chamam `SPR_setPosition`. `rds_collision_map` com `__attribute__((unused))` para silenciar warning. Testes Rust atualizados. Cargo clippy OK; 166 testes passaram (1 falha pre-existente em list_project_templates).

* **O que acabou de acontecer (2026-03-17 - Script unificado de compilacao):**
  - Criado `scripts/build.mjs` como script canonico de compilacao: gera MSI, EXE Debug e EXE Portable. Uso: `node scripts/build.mjs <debug|msi|portable|all>`. Scripts npm: `build:debug`, `build:msi`, `build:portable`, `build:all`. O `build-test.bat` passou a ser wrapper legado que chama `build.mjs debug`. Documentado em `docs/08_TREE_ARCHITECTURE.md`.

* **O que acabou de acontecer (2026-03-17 - UX/UI Passo 2: NodeGraph LG Logic):**
  - NodeGraphEditor reformulado visualmente estilo Unreal Blueprints/Unity Visual Scripting: paleta de nos com scrollbar-thin, busca, accordions expansiveis, icones por grupo; nos com headers coloridos por categoria (Eventos=vinho, Acoes=azul, Condicoes=cinza), corpo bg-slate-900/90, rounded-xl, portas maiores; selecao com ring-2 ring-blue-500 shadow-2xl. Gates: check:tree, lint, tsc, testes frontend OK. Onda de UX do Frontend Overhaul concluida.

* **O que acabou de acontecer (2026-03-17 - hotfix SGDK audio driver):**
  - ResComp falhava com `Unrecognized sound driver: '2ADPCM'`. Emitter SGDK em `sgdk_emitter.rs` passou a emitir `WAV [nome] "[path]" XGM` em vez de `2ADPCM`. Testes em `sgdk_emitter.rs` e `build_orch.rs` atualizados para assert `XGM`. Cargo clippy OK; 166 testes Rust passaram (1 falha pre-existente em `list_project_templates_reads_registry_and_builtin_entries_are_available`).

* **O que acabou de acontecer (2026-03-17 - UX/UI Passo 1: Layout com Splitters):**
  - Layout dinamico com `react-resizable-panels` (Group, Panel, useDefaultLayout) em `App.tsx`; `LayoutSplitter.tsx` com 4px, hover/active; paineis esquerdo 15%, centro flexivel, direito 20%; persistencia em localStorage `retrodev-layout`; mock ResizeObserver em `src/test/setup.ts` para testes jsdom.

* **O que acabou de acontecer (2026-03-17 - UX/UI Passos 3 e 4: feedback visual + tipografia/densidade):**
  - **Passo 3:** Asset Browser Grid View com `imageRendering: pixelated`; Hierarchy ja tinha icones por tipo; Inspector com preview visual do sprite asset (convertFileSrc + resolveProjectAssetPath). Criado `src/core/pathUtils.ts` com `resolveProjectAssetPath` compartilhado; ViewportPanel passou a importar dele.
  - **Passo 4:** Tema Tailwind com `@theme` (font-sans, font-mono) e `@layer base` em `src/styles/index.css`; Inspector com densidade de IDE (py-3->py-2, py-1.5->py-1, px-3->px-2); PropRow com coluna de rotulos fixa (w-24 min-w-24); RecordListEditor em grid `grid-cols-[1fr_1fr_auto]`; Panel header py-1.5->py-1.
  - Gates: check:tree, lint, tsc, 151 testes frontend OK.

* **O que acabou de acontecer (2026-03-17 - bateria grep/validacao + roteiro QA RC):**
  - Executada bateria de grep/read_file para confirmar implementacoes de `SceneLayer`, `CollisionMap` e `sgdk_emitter`/`emit_sgdk_with_collision`/`emit_snes_with_collision`.
  - **SceneLayer:** `entities.rs` (struct Rust), `sceneService.ts` (interface TS), `editorStore.ts` (actions), `LayerPanel.tsx` (UI), `ViewportPanel.tsx` (filtro visibility). Schema 1.5.0.
  - **CollisionMap:** `entities.rs` (struct + `normalize()`), `md_profile.rs`/`snes_profile.rs` (validacao), `sgdk_emitter.rs`/`snes_emitter.rs` (`emit_*_with_collision`), `ViewportPanel.tsx` (overlay + paint). Schema 1.4.0.
  - **sgdk_emitter:** `emit_sgdk_with_collision` em `sgdk_emitter.rs`, `emit_snes_with_collision` em `snes_emitter.rs`; `build_orch.rs` e `lib.rs` passam `collision_slice` para os emitters.
  - Validacoes executadas: `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (151 testes). Cargo clippy/test em background.
  - Criado `docs/10_QA_ROTEIRO_RC.md`: roteiro passo-a-passo para testadores leigos (Blocos A–F: onboarding, camadas, colisao/pintura, Build & Run, ferramentas, persistencia) e checklist de evidencias para promocao RC.
  - Atualizado `docs/08_TREE_ARCHITECTURE.md` com `10_QA_ROTEIRO_RC.md`.

* **O que acabou de acontecer (2026-03-17 - Sprint 3: Layer System Pilar 1 + tauri-plugin-updater):**
  - Implementado Layer System (Pilar 1) de ponta a ponta. Schema UGDM bumped `1.4.0 -> 1.5.0`.
  - **Rust — entities.rs:** Novo struct `SceneLayer { id, name, kind, visible, locked, depth, entity_ids: Vec<String> }` com helper `default_visible() -> bool`. Campo `layers: Option<Vec<SceneLayer>>` adicionado a `Scene`. `CURRENT_SCHEMA_VERSION` bumped para `"1.5.0"`. `layers: None` adicionado a todos os literais `Scene {}` nos testes em `ast_generator.rs`, `project_mgr.rs`, `constraint_engine.rs`, `md_profile.rs`, `snes_profile.rs`.
  - **Rust — tauri-plugin-updater:** `tauri-plugin-updater = "2"` adicionado ao `Cargo.toml`. Plugin registrado em `src-tauri/src/lib.rs` com `.plugin(tauri_plugin_updater::Builder::new().build())`. Sem UI de update — endpoint/pubkey permanecem placeholder.
  - **TypeScript — sceneService.ts:** Interface `SceneLayer { id, name, kind, visible, locked, depth, entity_ids }` adicionada. Campo `layers?: SceneLayer[] | null` adicionado a `Scene`.
  - **TypeScript — editorStore.ts:** Importa `SceneLayer`; `activeLayerId: string | null` no estado; actions `setActiveLayerId`, `createLayer`, `deleteLayer`, `updateLayer`, `assignEntityToLayer` implementadas com undo/redo e persist de `activeSceneSource`.
  - **UI — LayerPanel.tsx:** Novo componente `src/components/hierarchy/LayerPanel.tsx` com lista de camadas, criar/deletar, toggle visible/locked, renomear inline, botao de atribuir entidade selecionada a camada ativa.
  - **UI — App.tsx:** Tabs `Cena|Camadas` no aside esquerdo com `useState<"scene" | "layers">("scene")`; renderiza `<LayerPanel />` quando aba `layers` ativa.
  - **Viewport — ViewportPanel.tsx:** Filtro de visibilidade por camada: conjunto `hiddenByLayer` construido antes do `forEach` de entidades; entidades em camadas com `visible=false` sao saltadas no canvas de cena.
  - **Testes — editorStore.test.ts:** 12 novos testes para `createLayer` (3), `deleteLayer` (3), `updateLayer` (3), `assignEntityToLayer` (3). Tipo `SceneLayer` importado.
  - **Limpeza:** Diretorio untracked `hamoopig_example/` (leftover de smoke testing anterior) removido para manter check:tree verde.
  - **Gates:** tsc limpo, lint limpo, check:tree verde, 151 testes frontend (12 novos), 167 testes Rust (1 ignorado), cargo clippy limpo.
  - Arquivos modificados: `entities.rs`, `ast_generator.rs`, `project_mgr.rs`, `constraint_engine.rs`, `md_profile.rs`, `snes_profile.rs`, `lib.rs`, `Cargo.toml`, `sceneService.ts`, `editorStore.ts`, `editorStore.test.ts`, `LayerPanel.tsx` (novo), `App.tsx`, `ViewportPanel.tsx`, `docs/05_ARCHITECTURE_UGDM.md`, `docs/03_ROADMAP_MVP.md`, `docs/06_AI_MEMORY_BANK.md`.

* **QA Roteiro — Layer System (execucao humana):**
  1. Abrir projeto existente (ex: platformer_seed). Verificar que a aba `Camadas` aparece no painel esquerdo.
  2. Clicar em `+ Camada`. Verificar que uma nova camada e criada com nome padrao e aparece na lista.
  3. Renomear a camada clicando no nome. Verificar que o nome e salvo ao pressionar Enter ou ao perder foco.
  4. Selecionar uma entidade na aba `Cena`. Voltar para `Camadas` e clicar no botao de atribuicao. Verificar que a entidade aparece na camada.
  5. Clicar no icone de visibilidade (olho) da camada. Verificar que a entidade desaparece do canvas de cena. Clicar novamente para restaurar.
  6. Clicar no icone de lock. Verificar feedback visual de camada bloqueada.
  7. Deletar a camada. Verificar que a lista e atualizada e que a entidade ainda aparece na cena (nao e deletada, apenas desatribuida).
  8. Desfazer (`Ctrl+Z`) as operacoes de criar/deletar camada. Verificar que o undo stack funciona corretamente.
  9. Salvar a cena. Fechar e reabrir o projeto. Verificar que as camadas persistem no JSON.

* **O que acabou de acontecer (2026-03-17 - Sprint 2: CollisionMap / Pilar 2):**
  - Implementado CollisionMap de ponta a ponta como pre-requisito de Pilar 1 (Layers). Schema UGDM bumped `1.3.0` -> `1.4.0`.
  - **Rust — entities.rs:** Novo struct `CollisionMap { width, height, data: Vec<u8> }` com metodos `empty(w,h)`, `tile_index`, `is_solid` e `normalize(&self) -> Vec<u8>` (puro, nao-mutante). Campo `collision_map: Option<CollisionMap>` adicionado a `Scene`.
  - **Rust — hardware profiles:** `md_profile.rs` e `snes_profile.rs` agora validam dimensoes (MD: 40x28, SNES: 32x28) e comprimento do `data` array em `validate_scene_with_source_kind`. Erro fatal se fora dos limites.
  - **Rust — emitters:** `sgdk_emitter.rs` e `snes_emitter.rs` ganharam `emit_sgdk_with_collision` / `emit_snes_with_collision` que emitem `static const u8 rds_collision_map[]` antes de `int main()`. Wrapper `emit_sgdk` / `emit_snes` mantem retrocompatibilidade marcada com `#[allow(dead_code)]`.
  - **Rust — build_orch.rs e lib.rs:** Chamam `resolved_scene.collision_map.as_ref().map(|m| m.normalize())` e passam o slice para os novos emitters.
  - **TypeScript — sceneService.ts:** Interface `CollisionMap` + campo `collision_map?: CollisionMap | null` em `Scene`.
  - **TypeScript — editorStore.ts:** `EditorMode` ganhou `"collision"`; action `updateCollisionMap(tileIndex, 0|1)` com auto-init (MD=40x28, SNES=32x28) quando o mapa e null.
  - **UI — ContextualPalette.tsx:** Secao Collision com toggle e instrucoes; badge vermelho no modo collision.
  - **UI — ViewportPanel.tsx:** Overlay vermelho semi-transparente (alpha 0.35) para tiles solidos; pintura por click/drag com dedup de celula (`collisionDragRef`); atalho `C`; cursor highlight (0.55 alpha); botao 🛡️ na toolbar flutuante; status bar contextual `"🛡️ Colisao — Esq: solido · Dir: livre · Esc: sair"`; `onContextMenu` suprime menu nativo no canvas.
  - **Testes:** Todos os 167 testes Rust passaram apos adicionar `collision_map: None` em todos os literais de `Scene {}` nos testes. 139 testes frontend OK. `cargo clippy -- -D warnings` limpo.
  - Arquivos modificados: `entities.rs`, `md_profile.rs`, `snes_profile.rs`, `sgdk_emitter.rs`, `snes_emitter.rs`, `build_orch.rs`, `lib.rs`, `ast_generator.rs`, `sceneService.ts`, `editorStore.ts`, `ContextualPalette.tsx`, `ViewportPanel.tsx`.

* **O que acabou de acontecer (2026-03-17 - Onda 2: Drag-to-Paint/Erase + Brush Ghost + UX Polish):**
  - Implementada a Onda 2 do plano de ferramentas contextuais, adicionando drag-to-paint, drag-to-erase, brush ghost preview, Escape e status bar contextual.
  - **Drag-to-paint:** arrastar com mouse pressionado em paint mode agora stampa sprites continuamente ao longo do caminho, com grid-cell dedup (`paintDragRef` rastreia `lastPaintCell` para evitar re-stamp na mesma celula). Todo o drag agrupa como uma unica entrada de undo via `beginHistoryCapture/commitHistoryCapture`, com batch persist no `mouseUp`.
  - **Drag-to-erase:** arrastar em erase mode agora remove entidades ao longo do caminho, com dedup por `erasedIds: Set<string>` no `eraseDragRef`. Mesmo padrao de undo grouping e batch persist.
  - **Brush ghost preview:** retangulo semi-transparente (`#89b4fa`, alpha 0.25, borda dashed) desenhado na posicao do mouse no canvas quando paint mode + brush ativo. Usa `constrainSpriteFrameSize()` para dimensoes corretas do ghost. Rastreado via `sceneMousePos` state.
  - **Escape:** tecla Escape agora limpa brush (`setActiveBrush(null)`) e retorna ao select mode.
  - **Status bar contextual:** status span do viewport agora mostra modo/brush info: `"✏️ Pintar (brushId)"` ou `"🧹 Apagar — clique/arraste para remover"` quando fora do select mode.
  - `handleMouseLeave` adicionado para limpar ghost preview e finalizar drags ao sair do canvas.
  - Import de `ONBOARDING_SPRITE_SIZE` e `setActiveBrush` adicionados ao componente.
  - Validacao: tsc limpo, 139 testes frontend, lint limpo.
  - Arquivo modificado: `ViewportPanel.tsx`.

* **O que acabou de acontecer (2026-03-17 - Onda 1: Paint/Erase Mode + Paleta Contextual):**
  - Implementada a Onda 1 do plano de ferramentas contextuais inspirado em Tiled/GameMaker, cobrindo modos de edicao (select/paint/erase), paleta de assets real e atalhos de teclado.
  - `EditorMode` simplificado para `"select" | "paint" | "erase"` (removido `fill` que nao tinha suporte no UGDM).
  - `ContextualPalette.tsx` reescrito: substituiu 4 itens mock hardcoded por consumo real de `listProjectAssets()`, agrupamento por tipo (sprites/prefabs/tilemaps/audio/other), thumbnails reais para sprites via `convertFileSrc()`, secoes collapsiveis, botao "Limpar brush" e zero `any`.
  - Paint handler em `ViewportPanel.tsx` agora usa `createSpriteEntityFromAsset()` (entidade completa com sprite dimensionado e ID unico) em vez de prefab stub vazio com `components: {}`.
  - Guard pre-paint: verifica `spriteCount >= sprite_limit` antes de instanciar, mostra warning e cancela se o limite for atingido.
  - Persistencia automatica: `persistActiveScene()` chamado apos paint e apos erase.
  - Cursor contextual: `copy` (paint com brush ativo), `not-allowed` (paint sem brush), `pointer` (erase), `crosshair` (select), `grabbing` (drag).
  - Atalhos de teclado V/B/E para alternar modos no scene tab, com mesmas guardas do atalho G (sem modifiers, sem repeat, sem editable target).
  - Floating toolbar: `as any` substituido por `as const` para type safety.
  - 10 novos testes em `editorStore.test.ts`: 5 para `setEditorMode` (default, switch, return, undo restore) e 5 para `setActiveBrush` (default null, set, assetPath, clear, replace).
  - Validacao: tsc limpo, 139 testes frontend (10 novos), lint limpo.
  - Arquivos modificados: `editorStore.ts`, `ContextualPalette.tsx`, `ViewportPanel.tsx`, `editorStore.test.ts`.

* **O que acabou de acontecer (2026-03-16 - UX SGDK Import: 8-prompt implementation):**
  - Foi implementado um pacote de 8 melhorias de UX para projetos SGDK importados, cobrindo meta-sprites, viewport, hierarquia, validacao, asset browser, zoom, onboarding e camera.
  - **PROMPT 8 (Camera):** Guards em `md_profile.rs` e `snes_profile.rs` agora pulam entidades com sprite 0×0 (cameras sem sprite) em `validate_scene()` e `hw_status()`, eliminando erros falsos de sprite em cenas com camera. Teste: `camera_entity_does_not_produce_sprite_errors`.
  - **PROMPT 1 (Meta-sprites):** `SpriteComponent` em `components.rs` ganhou campo `#[serde(default)] pub meta_sprite: bool`. Quando `meta_sprite: true`, os hardware profiles MD/SNES ignoram o limite simples de 32×32/64×64 (o sprite sera fatiado em runtime pelo SGDK). O importador `import_sgdk_project()` agora marca sprites >32px como `meta_sprite: true`. Testes: `meta_sprite_bypasses_32x32_limit`, `non_meta_sprite_still_rejects_above_32x32`, `meta_sprite_still_counts_vram`.
  - **PROMPT 4 (Warnings):** `validate_scene_with_source_kind()` e `hw_status_with_source_kind()` adicionados em ambos os profiles. Quando `source_kind == "external_sgdk"`, overflow de VRAM vira warning com prefixo `[SGDK Gerenciado]` em vez de erro. O `constraint_engine.rs` e `editor_validation.rs` propagam `source_kind` a partir de `project.template_metadata`. Teste: `sgdk_project_vram_overflow_is_warning_not_error`.
  - **PROMPT 2 (Viewport sprites):** Investigacao confirmou que o caminho existente `resolveProjectAssetPath()` + `convertFileSrc()` ja resolve corretamente assets via NTFS junctions do overlay `rds/`. Nenhuma mudanca de codigo necessaria.
  - **PROMPT 6 (Zoom):** `editorStore.ts` ganhou `viewportZoom` (clamped 0.25-4.0), `setViewportZoom` e `resetViewportZoom`. O `ViewportPanel` agora suporta Ctrl+Scroll para zoom, botoes +/-, Ctrl+0 para reset, indicador de % e escalamento CSS do canvas com `canvasCoords()` zoom-aware.
  - **PROMPT 3 (Hierarquia):** `HierarchyPanel.tsx` agora agrupa entidades por tipo (camera/sprite/tilemap/audio/object) com headers collapsiveis, contagem por grupo e indentacao visual.
  - **PROMPT 5 (Asset Browser):** `ToolsPanel.tsx` ganhou `buildAssetTree()` e `AssetTreeView` recursivo com toggle tree/grid, painel de detalhe com thumbnail e botao Instanciar. Teste ajustado em `ToolsPanel.test.tsx`.
  - **PROMPT 7 (Onboarding):** `editorStore.ts` ganhou `projectSourceKind`, alimentado via `SceneDataResult.source_kind` no `App.tsx`. O `ViewportPanel` mostra toast dismissivel para projetos `external_sgdk`, persistido em localStorage.
  - IPC: `SceneDataResult` em `lib.rs` e `sceneService.ts` ganhou campo `source_kind: String`/`source_kind: string`, alimentado a partir de `project.template_metadata`.
  - Todos os 13 construtores de `SpriteComponent` em `ast_generator.rs` e 1 em `project_mgr.rs` foram atualizados para incluir `meta_sprite: false`.
  - Validacao local: 166 testes Rust, 129 testes frontend, cargo clippy limpo, tsc limpo, lint limpo. O gate `check:tree` falha por diretorio pre-existente `hamoopig_example` (nao introduzido por esta mudanca).

* **O que acabou de acontecer (2026-03-16 - RDS overlay + discovery por subdiretorio):**
  - Foi implementado o conceito de **overlay `rds/`** para projetos SGDK externos: um subdiretorio fino contendo `project.rds`, `scenes/main.json`, `graphs/`, `prefabs/` e NTFS Junctions para `assets/` e `build/`, sem duplicar nenhum arquivo e sem tocar no projeto original.
  - O primeiro overlay foi criado e validado para o projeto `Mortal Kombat Plus [VER.001] [SGDK 211] [GEN] [ENGINE] [LUTA]`, mapeando 4 arquivos `.res` (sprites, audio, stages, gfx) para 12 entidades RDS com 2 background layers, camera e audio bank.
  - O backend ganhou `discover_project_rds()` em `project_mgr.rs`, que busca `project.rds` na raiz e, se nao encontrar, procura em subdiretorios de primeiro nivel com prioridade para `rds/project.rds`.
  - O IPC `open_project_dialog` em `lib.rs` foi atualizado para usar `discover_project_rds()`, permitindo que o usuario aponte para a raiz de qualquer projeto SGDK externo e o app localize automaticamente o overlay `rds/`.
  - Documentacao atualizada: `docs/05_ARCHITECTURE_UGDM.md` secao 10 (overlay e discovery), `docs/08_TREE_ARCHITECTURE.md` (regra de overlay) e `docs/06_AI_MEMORY_BANK.md` (esta entrada).
  - Testes Rust adicionados para: discovery na raiz, discovery em `rds/`, discovery em subdiretorio arbitrario, prioridade raiz sobre subdir e diretorio vazio.

* **O que acabou de acontecer (2026-03-14 - template gallery, prefabs e importador SGDK):**
  - A trilha S1-S3 do plano de templates foi implementada no branch `feat/desktop-e2e-workflow` com os commits `63b0bac`, `14a1d6d`, `7257031`, `e177cc8`, `0ecc6fc`, `9d56f68`, `a0eaf04`, `d70a9e6`, `4a059a1` e `f978a18`.
  - A `Wave S1` ficou funcional de ponta a ponta para uso leigo: o onboarding virou galeria de templates, o app passou a listar seeds pelo `data/template_registry.json`, o seed `platformer_seed` importa apenas assets permitidos do doador SGDK, o `project.rds` agora guarda `template_metadata`, o `ViewportPanel` renderiza preview real de sprite/tilemap e o `NodeGraphEditor` ganhou labels amigaveis em PT-BR.
  - A `Wave S1` tambem corrigiu o codegen de camera no runtime: `move_camera` deixou de hardcodar `BG_A` e agora segue o plano real do tilemap ou sincroniza os dois planos quando ha multiplos backgrounds ativos.
  - A `Wave S2` consolidou a base correta de autoria com heranca: o editor agora distingue `activeSceneSource` (persistivel) de `activeScene` (resolvida), o `Inspector` mostra campos `Herdado`/`Override`, `LogicComponent` ganhou `graph_ref` com persistencia externalizada em `graphs/*.json` e o seed `platformer` passou a nascer com `prefabs/platformer_*.json` + `graphs/platformer_player_logic.json`.
  - A `Wave S3` abriu a porta para reaproveitar projetos SGDK externos com compliance: o backend agora faz parse tolerante de `resources.res`, copia apenas recursos suportados para `assets/`, ignora `VGM`, ROMs, `out/`, `boot/`, codigo C e headers, expõe IPC dedicado `import_sgdk_project` e a galeria foi expandida com seeds experimentais de `rpg`, `fighter`, `racing` e `action`.
  - O wizard agora oferece botao explicito `Importar Projeto SGDK`, reusando nome/pasta base do fluxo canonico, sem criar pipeline paralelo de onboarding.
  - A limitacao estrutural atual do editor continua explicita: o seed `platformer` permanece compilavel com frame simples `32x32`, mesmo quando o asset doador e maior, porque o validador autoritativo de Mega Drive ainda nao aceita meta-sprites compostos; a fidelidade completa do controlador/plano de plataforma fica para uma onda futura de presets/meta-sprites.
  - A rodada completa de validacao desta sessao ficou verde com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (127 testes frontend), `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture --test-threads=1` (154 testes Rust + 1 smoke ignorado), `cargo test official_windows_upstream_validation_smoke_test -- --ignored --nocapture` e `node scripts/e2e-tauri-build-run.mjs --skip-build --native-driver .\\msedgedriver.exe`.

* **O que acabou de acontecer (2026-03-14 - hotfix SGDK sprite conversion):**
  - O reteste manual do RC mostrou que o hotfix anterior havia corrigido o layout do workspace SGDK, mas ainda faltava fechar o formato do asset: o placeholder `assets/sprites/onboarding_player.ppm` estava sendo copiado para `res/assets/...` e referenciado cru no `resources.res`, mas o `ResComp` nao conseguiu abrir esse `.ppm` ASCII `P3`.
  - O commit `74b781f` (`fix: convert sgdk sprite assets for rescomp`) resolveu a regressao no pipeline canonico: o `build_orch` agora converte sprites SGDK para `.bmp` no staging, o `sgdk_emitter` passou a emitir `SPRITE ... "assets/.../*.bmp"` no `resources.res` e o smoke oficial de Windows foi endurecido para exigir que um projeto de onboarding Mega Drive compile com toolchain real antes de passar.
  - A cobertura local passou a travar os dois niveis do contrato: testes Rust focados para `build_orch`/`sgdk_emitter` ficaram verdes, os 6 gates canonicamente exigidos passaram novamente e o smoke `official_windows_upstream_validation_smoke_test` tambem ficou verde com `CARGO_TARGET_DIR` temporario em `C:\retrodev-target` por restricao de espaco livre no `F:`.
  - O bundle MSI foi reemitido apos esse hotfix em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi` (timestamp local 2026-03-14 16:11), alinhando o pacote de reteste ao novo contrato `.bmp` do SGDK.
  - O proximo reteste manual deve repetir `Novo Projeto -> Build & Run` em Mega Drive sem trocar o sprite placeholder; o erro `Can't open image ... onboarding_player.ppm` nao deve mais aparecer.

* **O que acabou de acontecer (2026-03-14 - hotfix SGDK resource staging):**
  - O beta manual do RC encontrou uma regressao real no build Mega Drive do projeto template: o `resources.res` era emitido com paths relativos `assets/...`, mas o `build_orch` fazia staging dos arquivos do projeto em `build/megadrive/assets/...` em vez de `build/megadrive/res/assets/...`, quebrando o `rescomp` com `Can't open image ... res/assets/sprites/onboarding_player.ppm`.
  - O commit `ac1ee60` (`fix: align sgdk asset staging with rescomp`) corrigiu a raiz do problema no backend: o staging SGDK passou a copiar sprites, tilemaps convertidos e assets de audio para dentro de `res/`, alinhando o layout do workspace ao contrato real do `resources.res` e do `ResComp`.
  - A suite Rust de `build_orch` tambem foi endurecida no mesmo commit para travar exatamente esse contrato: o caso Mega Drive com sprite real agora afirma `build/megadrive/res/assets/sprites/onboarding_player.ppm`, e os asserts de tilemap/audio foram movidos para `build/megadrive/res/assets/...`, impedindo regressao silenciosa do layout.
  - O baseline local permaneceu verde apos o hotfix com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` e `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1`.
  - O bundle MSI foi reemitido apos o hotfix em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi` (timestamp local 2026-03-14 15:11), alinhando o pacote de reteste ao staging SGDK corrigido.
  - O proximo reteste manual deve repetir explicitamente o fluxo `Novo Projeto -> Build & Run` no target Mega Drive para confirmar que o placeholder `onboarding_player.ppm` volta a compilar no workspace SGDK real.

* **O que acabou de acontecer (2026-03-14 - hardening scene authoring):**
  - O segundo ciclo de beta manual mostrou que o RC ainda parecia "quebrado" em cenas vazias: ao criar/trocar para uma cena sem entidades, o editor deixava a pessoa sem caminho claro para instanciar sprite, o `Asset Browser` apenas listava arquivos sem criar nada na cena ativa e o `Scene View` nao explicava como sair do estado vazio.
  - O commit `88df160` (`fix: unblock sprite authoring from empty scenes`) fechou esse gargalo no caminho canonico: a `Hierarchy` ganhou CTA explicita `Sprite Inicial` para cenas vazias, reaproveitando o mesmo factory de entidade do onboarding; o `Asset Browser` passou a instanciar assets de imagem diretamente na cena ativa, selecionando a nova entidade e redirecionando o fluxo para o `Scene View`; e o `ViewportPanel` agora exibe hint operacional quando a cena esta vazia.
  - O hardening reutilizou `src/core/editorEntityFactory.ts` como fonte canonica para criar sprites editaveis a partir de assets reais, incluindo graph/logica inicial quando a cena ainda esta vazia, evitando um segundo pipeline de autoria.
  - A cobertura frontend ganhou testes dedicados para os dois caminhos de recuperacao do beta manual: `src/components/hierarchy/HierarchyPanel.test.tsx` valida a criacao de `Sprite Inicial` em cena vazia e `src/components/tools/ToolsPanel.test.tsx` valida a instanciacao de imagem a partir do `Asset Browser`.
  - O baseline local permaneceu verde apos esse hardening com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` e `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1`.
  - O bundle MSI foi reemitido apos esse hardening em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`, pronto para reteste manual do fluxo de autoria corrigido.

* **O que acabou de acontecer (2026-03-14 - hardening onboarding/editor):**
  - A segunda rodada de feedback manual mostrou dois problemas estruturais no fluxo de primeiro uso: o `LogicComponent.graph` semeado pelo onboarding usava um schema minimalista aceito pelo backend, mas rejeitado pelo `NodeGraphEditor`, e o placeholder `onboarding_player.ppm` podia ser redimensionado para estados invalidos no editor, bloqueando o build por overflow de sprite simples no Mega Drive.
  - O commit `783f1b0` (`fix: harden onboarding graph hydration`) tornou o frontend retrocompativel com o schema legado do grafo, adicionou hint visual de conexao no `NodeGraphEditor`, passou a semear novos projetos com o schema completo do editor e normalizou cenas de onboarding antigas no backend, reparando placeholder 16x16 e o edge inicial `event_start -> sprite_move` quando o fluxo vinha quebrado.
  - O commit `3666375` (`fix: clamp simple sprite sizing in editor`) criou `src/core/sceneConstraints.ts` como regra canonica de tamanho de sprite simples no editor, reaproveitada pelo `ViewportPanel` e `InspectorPanel` para impedir dimensoes fora do contrato do target; o placeholder de onboarding ficou travado em 16x16 e sprites simples agora respeitam limites nativos de Mega Drive e SNES ainda no ato da edicao.
  - O baseline local permaneceu verde apos essas correcoes com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture --test-threads=1`.
  - As validacoes extras tambem passaram novamente no host local apos o hardening: `cargo test --manifest-path .\\src-tauri\\Cargo.toml official_windows_upstream_validation_smoke_test -- --ignored --nocapture` ficou verde e o runner desktop `scripts/e2e-tauri-build-run.mjs --skip-build --native-driver msedgedriver.exe` passou para Mega Drive e SNES.
  - O bundle MSI foi reemitido apos esse hardening em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`, substituindo o pacote usado no beta manual anterior.

* **O que acabou de acontecer (2026-03-14 - hotfix pos-RC):**
  - A rodada de validacao manual do MSI revelou bugs reais no RC: ciclo de vida da sessao do emulador ao sair da aba `GM Jogo`, replay vazio aceito como sucesso, reentrada rapida em `Build & Run`, codegen SNES de `RetroFX` com API/HDMA invalida e leitura de input SNES emitindo `scanPads()` fora do contrato atual do PVSnesLib.
  - O hotfix `26b0911` (`fix: harden emulator session lifecycle`) endureceu o frontend/store do emulador: o core deixa de ser derrubado ao trocar de aba, o loop nao inicia sem ROM carregada, os controles do `Game View` respeitam `emulatorLoaded`, `Build & Run` ganhou trava sincrona contra clique concorrente e replay vazio passou a falhar explicitamente no backend.
  - O hotfix `ff0228a` (`fix: emit valid snes retrofx hdma`) corrigiu o emitter SNES para gerar HDMA compativel com `HDMATable16`/`setParallaxScrolling(0)`, removendo a API inexistente `setHDMATable`, o loop C invalido e o buffer customizado que quebravam builds SNES com `RetroFX`.
  - O hotfix `e534af2` (`fix: align snes build pipeline with pvsneslib`) alinhou a leitura de input SNES ao contrato atual do PVSnesLib (sem `scanPads()` explicito) e estabilizou o teste Rust de patch BPS usando uma ROM de teste versionada em `data/`, evitando dependencia de artefato `.sfc` envelhecido em fixture.
  - O baseline local voltou a ficar verde apos os hotfixes com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture --test-threads=1`.
  - As validacoes extras exigidas para build/emulacao tambem passaram: `cargo test official_windows_upstream_validation_smoke_test -- --ignored --nocapture` ficou verde, e o runner desktop `scripts/e2e-tauri-build-run.mjs --skip-build --native-driver msedgedriver.exe` passou para Mega Drive e SNES com o binario reconstruido localmente.
  - Um novo bundle MSI foi gerado apos os hotfixes em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi` (timestamp local 2026-03-14 09:29), substituindo o pacote desatualizado usado no primeiro beta manual.

* **O que acabou de acontecer (2026-03-14):**
  - As ondas M, N, O, P, Q e R foram concluidas em codigo, validadas localmente com os 6 gates canonicos verdes a cada subtarefa e fechadas nesta trilha `feat/desktop-e2e-workflow`.
  - Onda M concluida com `c5aeae4`, `6a64a9a`, `d04b9d5`, `3bccffc`, `64e5f8f` e `71d227e`: Asset Browser experimental, hot reload por polling, resize gizmos no viewport, VRAM Viewer experimental, performance overlay no Game View e rewind com ring buffer.
  - Onda N concluida com `a5e9a01`, `27e9375`, `31e5e4a` e `0d8db6b`: FSM Builder, flow nodes, timeline sequence e hardware event nodes integrados de ponta a ponta no editor, compilador TS, AST Rust e emitters SGDK/SNES.
  - Onda O concluida com `6272eda`, `5520c5b`, `b765796` e `9bdaa48`: budget live de VRAM, metricas de sprites por scanline, budget live de DMA e monitor de bancos de paleta expostos no `HardwareStatus`, toolbar e paineis de monitoramento.
  - Onda P concluida com `8fb9d25`, `738b898` e `23977f1`: build multi-target com relatorio comparativo, Reverse Explorer experimental e deterministic replay integrado ao Game View.
  - Onda Q concluida com `ac4a4f5`, `f46e4a8` e `733f75f`: chain de migracao de schema ate `1.2.0`, knowledge tooltips no Inspector e compliance de patches com aviso legal e trilha de auditoria em `project.rds`.
  - Onda R concluida em estado de release candidate com `a7f6529`, `7c3e84d` e `1f012bd`: packaging MSI configurado e validado localmente, updater apenas em configuracao placeholder por bloqueio da politica de nao adicionar dependencias novas, e wizard de primeiro uso criando projeto template funcional.
  - O bundle MSI foi gerado com sucesso em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`.
  - O baseline final desta rodada permaneceu verde com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture --test-threads=1`.

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
* **[2026-03-04]** `Concluido`, `validado`, `fechado` e termos equivalentes agora devem ser lidos como claims reservadas a certificacao real: caminho canonico funcional, gates aplicaveis verdes, prova correspondente e ausencia de erro bloqueante no escopo. Qualquer excecao deve rebaixar o status para `hardening` ou `experimental`.
* **[2026-03-04]** `tauri-driver` local pode levar mais do que 15s para responder em certas maquinas. O runner desktop agora deve usar `RDS_E2E_DRIVER_TIMEOUT_MS` em vez de depender de timeout fixo curto.
* **[2026-03-05]** Neste host, `child_process.spawn` com `stdio` contendo `pipe` pode falhar com `EPERM`. O runner desktop foi ajustado para bootstrap interno do `tauri-driver` com `stdio: inherit`, mas a criacao de sessao WebDriver ainda pode falhar localmente com `DevToolsActivePort/chrome not reachable`.
* **[2026-03-06]** O script `scripts/diagnose-desktop-e2e.ps1` ganhou `-SessionProbe` para reproduzir localmente o `InitSession` com log verbose do `msedgedriver`; usar esse modo sempre que o runner acusar `DevToolsActivePort/chrome not reachable`.
* **[2026-03-06]** Neste host, `npm run tauri build -- --debug --no-bundle` pode falhar por `spawn EPERM` no `beforeBuildCommand` (vite/esbuild), portanto build desktop local nao deve ser tratado como gate confiavel ate ajuste de policy/ambiente.
* **[2026-03-26 -> resolvido em 2026-03-27]** Neste host novo, o baseline local canonico voltou a ficar verde apos blindagem de `localStorage/sessionStorage` no setup do Vitest e provisionamento do MSVC/`tauri-driver`; o bloqueio remanescente era `java: command not found` no `rescomp.jar`, resolvido no dia seguinte com provisionamento nativo do `JDK` e novo `success = true` no `validate-upstream-windows.ps1`.
* **[2026-02-28]** `Deep Profiler`, `Asset Extractor` e `RetroFX` permanecem visiveis por contexto de produto, mas agora devem continuar explicitamente marcados como experimentais ate deixarem de ser stub/parcial.
* **[2026-02-28]** No Windows, a deteccao de `bash` deve ignorar o shim do WSL (`C:\\Windows\\System32\\bash.exe`) e privilegiar Git Bash/MSYS2. Essa regra ja foi aplicada no codigo e nao deve ser removida sem substituto equivalente.
* **[2026-02-28]** ROMs de validacao local e a documentacao associada sao um ponto de atencao de compliance/licenciamento. O software pode operar com ROMs fornecidas pelo usuario para fins educacionais, pesquisa e preservacao, mas nao deve redistribuir ROM comercial como parte do produto.
* **[2026-02-28]** Integrar cores oficiais de Libretro/RetroArch exige atencao a licencas. Antes de automatizar bundle/download, verificar compatibilidade de distribuicao com o carater proprietario do projeto.
* **[2026-02-23]** `cargo clippy` e `cargo build` requerem `CARGO_BUILD_JOBS=2` e `RUST_MIN_STACK=16777216` para evitar stack overflow na compilacao do crate `windows` e `regex-automata` no Windows. Configurado em `src-tauri/.cargo/config.toml`.
* **[2026-02-23]** `check-tree.js` foi renomeado para `check-tree.cjs` porque `package.json` usa `"type": "module"` e o script usa `require()`. Qualquer referencia residual ao nome antigo deve ser tratada como bug documental/processual.
* **[2026-02-23]** Os icones em `src-tauri/icons/` ainda sao placeholders gerados por script.
* **[2026-02-23]** `bootstrap.ps1` tem bugs de encoding e nao deve ser usado como fonte canonica de setup sem revisao.

---

## 4. PROXIMO PASSO IMEDIATO (PARA A IA EXECUTAR QUANDO SOLICITADA)

**Tarefa:**
Fechar o MVP do desktop Tauri preservando a baseline verde, enquanto o reverse core novo sobe por ondas pequenas (`manifesto -> disassembly/xrefs -> trace -> projecao`), agora ja com scaffold dinamico conservador, sem quebrar o fluxo canonico do produto.

**Pre-requisitos operacionais:**
* Manter os 6 gates canonicos verdes em toda alteracao relevante.
* **Auto-updater deferido para pos-MVP (decisao 2026-03-22):** manter `tauri-plugin-updater` apenas como placeholder; nenhum trabalho adicional (endpoint real, UI, pubkey) sera investido ate o MVP ser fechado e a dependencia formalmente aprovada em `docs/02_TECH_STACK.md`.
* Em Windows, usar `npm run release:readiness:baseline` como fotografia canônica de readiness sempre que a sessao tocar build/toolchains/emulacao; a rodada precisa renovar `build-report.json`, `upstream-validation.json` e o EXE debug.
* Reexecutar bundle MSI e smoke desktop em host Windows institucional sempre que a mudanca tocar packaging, emulacao, build orchestration, onboarding ou fluxo de projeto.
* Se alterar emulacao ou build, consultar `docs/02_TECH_STACK.md`, `docs/07_TEST_AND_COMPLIANCE.md` e as fontes oficiais ja validadas para Libretro, SGDK e PVSnesLib.

**Sequencia de acoes recomendada:**
1. Retomar a trilha de superficies `Experimental` mais promissoras pelo `ArtStudio`, exigindo prova conservadora do caminho `ingestao -> entidade/cena -> build` sem abrir novo pipeline nem inflar maturidade para runtime final.
2. Se `ArtStudio` mantiver baseline verde e prova real ate build, seguir para `RetroFX` com a mesma barra de evidência antes de qualquer claim nova sobre a frente visual do produto.
3. Continuar medindo o chunk principal do shell a cada rodada relevante de `App.tsx`/`ViewportPanel` com `npm run build`, evitando regressao silenciosa de bundle.
4. Repetir bundle MSI apenas quando o escopo tocar release/packaging (`scripts/run-in-msvc.cmd npm run build:msi`).
5. Manter `validate-upstream-windows` e `release:readiness:baseline` como fotografia institucional sempre que alteracoes futuras tocarem build, emulacao, onboarding ou toolchains.

**Validacao minima obrigatoria antes de marcar qualquer item como concluido:**
* `npm run check:tree`
* `npm run lint`
* `npx tsc --noEmit`
* `npm test`
* `cargo clippy -- -D warnings`
* `cargo test --lib -- --nocapture --test-threads=1`
* bundle MSI valido quando o escopo tocar packaging/release
* smoke manual ou automatizado de `Build -> Run` no target afetado
* atualizacao deste Memory Bank e do roadmap canonico quando o estado do produto mudar

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
| 2026-03-04 | Codex | Blindagem textual dos canonicos para exigir certificacao real antes de qualquer claim de fase, etapa ou feature concluida |
| 2026-03-04 | Codex | Warning live resumido na toolbar do editor, runner desktop endurecido para startup lento do `tauri-driver` e nova validacao real de warnings no app Tauri |
| 2026-03-04 | Codex | Badge de estado live na toolbar (`LIVE/WARN/DESATUAL./ERRO/BLOQUEADO`), cobertura de testes ampliada e validacao desktop real apos rebuild |
| 2026-03-05 | Codex | Cenario desktop `live-ok` adicionado para estado `LIVE` por target, workflow desktop expandido e cobertura local App/controller fechando indicadores live |
| 2026-03-05 | Codex | Hardening async residual em `ToolsPanel`, limpeza do desvio estrutural local (pasta `Microsoft`) e diagnostico `spawn EPERM` enriquecido no runner desktop |
| 2026-03-05 | Codex | Runner desktop com fallback `--external-driver`, ajuste de compatibilidade de spawn (`stdio: inherit`) e isolamento do novo bloqueio local em `DevToolsActivePort` |

---

**[Sinalizador de Fim de Leitura]**
*Se voce e uma IA e acabou de ler este documento no inicio de uma sessao, responda com: **"[Contexto Carregado] Hardening do MVP. Prioridade: preservar o fluxo canonico validado, manter o desktop E2E repetivel e expandir cobertura sem poluir a arquitetura."***
* **O que acabou de acontecer (2026-03-20 - ArtStudio Fase 1/2: ingestao backend Rust e profiling real de assets):**
  - **Origem da verdade movida para o Rust:** `ArtStudioPanel.tsx` deixou de depender do decode direto por `convertFileSrc()`/`fetch` como caminho principal; a ingestao agora chama `art_process_palette` no backend e recebe preview PNG em base64, paleta quantizada, bounds e recomendacoes estruturais.
  - **Processamento pesado fora da UI thread:** `photo2sgdk.rs` agora roda via `tauri::async_runtime::spawn_blocking`, evitando bloquear o WebView durante decode, heuristica de transparencia e quantizacao.
  - **Multiformato backend real:** a crate `image` foi estendida com `gif` e `webp`, mantendo `png`, `bmp`, `jpeg` e `pnm`; o backend processa `PNG`, `BMP`, `JPG/JPEG`, `GIF`, `WebP` e `PPM` pelo mesmo caminho.
  - **Heuristicas iniciais de hardware:** o backend agora detecta transparencia por alfa ou cor de canto/borda, reserva o indice 0 da paleta para transparencia, quantiza para 15+1 cores do Mega Drive, calcula `content_bounds` alinhado a 8x8 e devolve sugestao inicial de `frame_width/frame_height` e escala recomendada.
  - **Cobertura Rust com assets reais:** `photo2sgdk.rs` ganhou testes sinteticos e validacao local com `Blackheart_grande.gif`, `Earthquake_large.png`, `MetalSlug_Backgrounds.png`, `KenMasters_normal.png` e `MegaMan_pequeno.png`, todos executados em `cargo test --lib -- --nocapture --test-threads=1` no host atual.
  - **Perfis estruturais observados:** `Blackheart_grande.gif` foi lido como `GIF` com 1 frame efetivo e transparencias por fundo de canto; `Earthquake_large.png` exigiu recomendacao agressiva de downscale (`1%`) e ficou claramente acima de sprite simples; `MetalSlug_Backgrounds.png` acionou transparencia por alfa e reducao de paleta para 15 slots uteis; `KenMasters_normal.png` validou bem a heuristica de fundo solido por canto; `MegaMan_pequeno.png` processou corretamente, mas ainda revela necessidade de auto-slicing mais refinado porque o bounding box global da sheet inteira continua largo demais para inferencia perfeita de frame.
  - **Cobertura frontend atualizada:** `ArtStudioPanel.test.ts` agora mocka o IPC do backend, valida importacao por processamento Rust, erro detalhado e bloqueio correto de `Aplicar na Cena` para imagens externas.
  - **Gates reexecutados no workspace atual:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (170 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture --test-threads=1` OK (183 aprovados / 0 falhas / 1 ignorado).
  - **Status honesto mantido:** o ArtStudio segue `Experimental`; esta rodada fechou ingestao, preview quantizado e diagnostico estrutural, mas ainda nao trouxe a imagem externa para dentro do projeto nem provou `ArtStudio -> entidade sprite -> runtime`.
* **O que acabou de acontecer (2026-03-20 - ArtStudio Sprint 3: auto-slicing refinado e importacao canonica):**
  - **Frames sugeridos no backend:** `photo2sgdk.rs` agora devolve `suggested_frames` explicitos, com dois caminhos de disseccao: `grid` (ignorando celulas 100% vazias) e `auto_islands` (componentes conectados alinhados a 8x8). O modo `auto` escolhe a melhor estrategia segura sem quebrar o pipeline canonico.
  - **Importacao canonica concluida:** o novo comando Tauri `import_art_asset` gera uma sprite sheet limpa dentro de `assets/sprites`, repacotando apenas os frames sugeridos em ordem canonica para que os indices usados nas sequencias batam com o emitter SGDK/PVSnesLib sem criar pipeline paralelo.
  - **UI alinhada com o asset final:** `ArtStudioPanel.tsx` agora desenha os rects sugeridos no canvas, monta sequencias sobre esses rects, reproduz o preview animado usando `(x,y,w,h)` reais e so libera `Aplicar na Cena` depois que o asset canonico e gerado dentro do projeto.
  - **Cobertura nova:** `photo2sgdk.rs` ganhou testes para `grid` skipping, `auto_islands`, importacao canonica em temp project root e validacao de `MegaMan_pequeno.png` com `suggested_frames` multiplos e alinhados a 8; `ArtStudioPanel.test.ts` agora cobre o fluxo `Importar -> Trazer para assets/sprites -> Aplicar`.
  - **Gates reexecutados no workspace atual:** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` OK (170 testes), `cargo clippy -- -D warnings` OK, `cargo test --lib -- --nocapture --test-threads=1` OK (186 aprovados / 0 falhas / 1 ignorado).
  - **Status honesto mantido:** o ArtStudio continua `Experimental`; ingestao, slicing sugerido e importacao canonica estao fechados, mas ainda falta a prova ponta a ponta `ArtStudio -> entidade sprite -> runtime`.
* **O que acabou de acontecer (2026-03-27 - Setup nativo: alinhamento do JDK no frontend e precheck de build):**
  - **Contrato TS alinhado ao backend:** `src/core/ipc/toolsService.ts` agora reconhece `jdk` em `ThirdPartyDependencyId`, refletindo o item que o backend Rust ja expoe em `third_party_get_status`.
  - **Runtime Setup corrigido para o usuario:** `src/components/tools/ToolsPanel.tsx` passou a anunciar explicitamente `JDK (Temurin LTS)` junto de `SGDK`, `PVSnesLib` e cores Libretro, removendo a divergencia entre a UI e o estado real do host.
  - **Build & Run do Mega Drive endurecido:** `src/App.tsx` agora exige `jdk` antes de `Build & Run` em `megadrive`, evitando cair num build SGDK incompleto quando o toolchain existir sem Java funcional.
  - **Cobertura atualizada:** `src/App.test.tsx` ganhou um caso que prova a instalacao automatica do `JDK` antes do build Mega Drive quando ele estiver ausente.
  - **Validacao focada reexecutada no workspace atual:** `npx tsc --noEmit` OK, `npx eslint src/App.tsx src/core/ipc/toolsService.ts src/components/tools/ToolsPanel.tsx src/App.test.tsx` OK e `npx vitest run src/App.test.tsx` OK (31 testes).
* **O que acabou de acontecer (2026-03-27 - UX shell: Game View com escala inteira responsiva):**
  - **Escala fixa removida:** `src/components/viewport/ViewportPanel.tsx` deixou de usar `transform: scale(1.75)` no runtime e passou a calcular a escala inteira do canvas com base no espaco disponivel do stage.
  - **Pixel-perfect mais profissional:** o `Game View` agora preserva a nitidez do framebuffer com `1x/2x/3x...` inteiros, comportamento mais proximo do esperado em ferramentas de emulacao/engine profissionais.
  - **Stage mais legivel:** o canvas de runtime agora fica dentro de um palco dedicado com moldura, sombra e badge `320x224 @ Nx`, melhorando leitura espacial e sensacao de ferramenta final.
  - **Cobertura adicionada:** `src/App.test.tsx` agora valida o helper puro `getGameViewportScale` para garantir que a escala sempre caia em inteiros seguros.
  - **Validacao focada reexecutada no workspace atual:** `npx tsc --noEmit` OK, `npx eslint src/components/viewport/ViewportPanel.tsx src/App.test.tsx` OK e `npx vitest run src/App.test.tsx` OK (33 testes).
