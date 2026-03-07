# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Ultima Atualizacao:** 2026-03-07
**Ultima sessao:** 2026-03-07 (Codex - Sessao 49: bloqueio ambiental no gate Rust durante tentativa de K1)
**Fase Atual:** Expansao do pipeline canonico apos hardening do MVP (Build -> ROM -> Emulacao validado em Windows com upstream real; desktop E2E multi-target validado localmente e em runner GitHub/Windows real; build/codegen e runtime agora cobrem Physics, Audio, RetroFX e NodeGraph expandido, com audio frontend real sem abrir pipeline paralelo)
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

* **O que acabou de acontecer (2026-03-07 - sessao 49):**
  - A retomada da onda K foi iniciada em `K1` (distribuicao de sprites por scanline nos hardware profiles), mas a tarefa foi revertida antes de commit para parar limpo quando o gate Rust voltou a falhar por ambiente, nao por logica do feature.
  - `npm run check:tree`, `npm run lint`, `npx tsc --noEmit` e `npm test` permaneceram verdes nesta sessao.
  - O bloqueio esta concentrado no rebuild do crate Tauri: `cargo clippy -- -D warnings` e `cargo check` falharam repetidamente porque a policy local de Application Control bloqueia a execucao de `target\\debug\\build\\tauri-plugin-dialog-*\\build-script-build` (`os error 4551`), inclusive fora do sandbox.
  - Depois de tres tentativas de correcao (execucao normal, limpeza seletiva de artefatos e execucao fora do sandbox), o bloqueio foi classificado como ambiental/infra e nenhuma nova tarefa da fila foi concluida nesta sessao.
  - O ultimo commit funcional e validado permanece `65920ac` (`feat: remove profiler experimental badge`).

* **O que acabou de acontecer (2026-03-07 - sessao 48):**
  - Onda J concluida: J1-J5.
  - J1 fechou as lacunas do Inspector: Physics, Audio e Input agora sao editaveis no painel canonico, `LogicComponent` ganhou resumo read-only do grafo e os patches do editor passaram a suportar caminhos aninhados como `physics.max_velocity.x` sem pipeline paralelo.
  - J2 endureceu o `Deep Profiler`: a deteccao de SAT deixou de depender de offsets fixos e passou a escolher candidatos por scoring adaptativo, reaproveitando parsing plausivel de sprites e cobrindo o novo fluxo com fixtures Rust dedicadas.
  - J3 expandiu o `Asset Extractor`: o backend/IPC/UI agora aceitam `bpp_mode` (`auto`, `2bpp`, `4bpp`), com autodeteccao heuristica de tiles 2bpp e decode canonico dedicado para esse formato.
  - J4 otimizou o `Patch Studio`: `create_bps` passou a emitir `SourceCopy` quando encontra runs reaproveitaveis na ROM original, reduzindo o tamanho de patches sem alterar o caminho canonico de apply.
  - J5 concluiu o hardening experimental da onda: o `Deep Profiler` perdeu o badge `Experimental`, ficou com aviso heuristico funcional na UI e os testes Rust do mock core foram endurecidos para aguardar a DLL ficar carregavel antes de executar a bateria canonica.
  - Os commits desta onda foram `ed14bdd` (`fix: harden mock core library loading`), `1384848` (`feat: expand inspector component editing`), `15df9dd` (`feat: improve deep profiler sat detection`), `352f454` (`feat: add auto bpp asset extraction`) e `6ea3f07` (`feat: optimize bps patch creation`), seguidos do fechamento documental/badge desta sessao.
  - O baseline permaneceu verde ao final do checkpoint da onda com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture`.

* **O que acabou de acontecer (2026-03-06 - sessao 47):**
  - H1 foi concluida no compilador do NodeGraph: o no `sprite_anim` agora resolve `target`/`anim` contra as `AnimationDef` do sprite canonico e reaproveita `AstNode::SetAnimation` para chegar aos emitters SGDK/SNES sem nova trilha de animacao.
  - H2 e H3 foram concluidas no pipeline de logica: `scroll_tilemap` e `move_camera` agora geram AST dedicado e scroll runtime real nos emitters SGDK/SNES, incluindo follow de `CameraComponent` quando o alvo aponta para uma camera com `follow_entity`.
  - H4 foi concluida no data-flow do NodeGraph: `logic_and` agora compila guards booleanos inline reutilizaveis por `condition_overlap`, com resolucao de portas e emissao C dedicada nos dois emitters sem duplicar um segundo compilador.
  - I1 e I2 foram concluidas no runtime do emulador: o backend passou a drenar `audio_buffer` para o evento `emulator://audio` com `sample_rate` real do core, e o `Game View` agora reproduz o audio no frontend via Web Audio API com fila curta, mute e cleanup completo no ciclo de vida da aba.
  - Os commits de codigo desta rodada foram `1d1dd3d` (`feat: compile remaining nodegraph nodes`) e `b3de050` (`feat: add emulator audio playback`); a documentacao canonica foi sincronizada na sequencia desta mesma sessao.
  - O baseline local permaneceu verde ao final do fechamento do bloco, com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture`.

* **O que acabou de acontecer (2026-03-06 - sessao 46):**
  - G2 foi concluida no pipeline canonico: `AudioComponent` agora entra no AST, os emitters SGDK/SNES geram init/playback real de audio (`XGM_setPCM`/`XGM_startPlay` e `spcLoad`/`spcPlaySound`) e o `build_orch` passou a fazer staging de assets de audio para os dois targets, com cobertura Rust dedicada.
  - G3 foi concluida no pipeline canonico: `scene.retrofx` agora gera `SetupParallax`/`SetupRasterEffect` no AST, e os emitters SGDK/SNES passaram a injetar setup e atualizacao frame-a-frame de scroll/raster no game loop sem criar uma trilha paralela ao renderer existente.
  - G4 foi concluida no compilador do NodeGraph: os nos `effect_parallax` e `effect_raster`, que ja existiam na paleta do frontend, agora sobem do grafo persistido para os AST nodes canonicos de `RetroFX`, chegando ao codegen SGDK/SNES com testes de AST e de emissao.
  - Os commits desta rodada foram `5c58eda` (`feat: add audio build pipeline`), `f5c0c16` (`feat: emit retrofx build effects`) e `1b12b1f` (`feat: compile retrofx nodegraph effects`).
  - O baseline local permaneceu verde ao final de cada tarefa, com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture`.

* **O que acabou de acontecer (2026-03-06 - sessao 45):**
  - E3 foi concluida no caminho canonico do emulador: `libretro_ffi.rs` agora resolve `retro_get_memory_data`/`retro_get_memory_size`, expoe leitura segura por regiao e o backend passou a servir `emulator_read_memory(region, offset, length)` com tamanho total reportado.
  - O `ToolsPanel` ganhou a aba `Memory Viewer`, ligada ao IPC real do emulador, com seletor de SRAM/WRAM/VRAM, offset/length em hexadecimal, grid de 16 bytes por linha, coluna ASCII e auto-refresh opcional de 1s, mantida como `Experimental`.
  - F1 foi concluida no schema canonico: `project.rds` agora persiste `schema_version = 1.0.0`, cenas aceitam `schema_version` opcional com compatibilidade retroativa e `project_mgr` passou a aplicar migracao pass-through + warning em versoes desconhecidas.
  - Fixtures dummy canonicas foram atualizadas para incluir `schema_version`, preservando a leitura de fixtures legadas sem o campo e cobrindo essa compatibilidade com testes Rust dedicados.
  - F2 foi concluida no editor/projeto: o backend agora lista/cria/troca cenas canonicamente, a `Hierarchy` ganhou catalogo e seletor de cena ativa com criacao de nova cena, e o frontend passou a persistir `scene_path` ativo sem abrir um pipeline paralelo de carregamento.
  - A troca de cena agora atualiza `project.entry_scene` de forma autoritativa no backend, garantindo que `Build -> ROM -> Emulacao` siga a cena ativa selecionada no editor.
  - O baseline local permaneceu verde ao final do fechamento da fila remanescente com os gates exigidos (`npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture`).

* **O que acabou de acontecer (2026-03-06 - sessao 43):**
  - B1 foi concluida no caminho canonico do editor: `editorStore` agora mantem `undoStack/redoStack` limitadas, `undo/redo` reais e agrupamento transacional para drag no viewport, com atalhos globais `Ctrl+Z`, `Ctrl+Shift+Z` e `Ctrl+Y`.
  - B2 foi concluida no Scene View: `ViewportPanel` agora aplica `snap-to-grid` de 8px no drag, exibe toggle visual no cabecalho e aceita atalho `G` quando a aba `Cena` esta ativa e nenhum campo editavel esta em foco.
  - B3 foi concluida no pipeline canonico: prefabs em `prefabs/*.json` agora sao resolvidos com merge de entidade antes de `validation/build/codegen`, preservando coerencia entre preview autoritativo, AST e ROM gerada.
  - O backend ganhou fixture canonica `prefab_dummy` e cobertura Rust para merge/resolucao de prefab no `project_mgr` e para consumo desses componentes herdados no `ast_generator`.
  - C1 foi concluida no painel Tools: `Deep Profiler` foi destravado, ligado ao IPC `profiler_analyze_rom` e agora renderiza heatmaps/metricas reais mantendo badge `Experimental` ate validacao ponta a ponta com ROM real.
  - C2 foi concluida no painel Tools: `Asset Extractor` foi destravado, ligado ao IPC `assets_extract` e agora exibe os arquivos gerados mantendo badge `Experimental` ate validar extracao ponta a ponta com ROM real.
  - C3 foi concluida no editor: `retrofx` agora faz parte do schema canonico de cena em Rust + TypeScript, o `RetroFX Designer` voltou a salvar configuracoes reais de parallax/raster no JSON da cena e a superficie segue marcada como `Experimental` porque ainda nao ha emissao no build.
  - D1 foi concluida no editor visual: `NodeGraphEditor` agora carrega/salva o grafo da entidade em `LogicComponent.graph`, com serializacao JSON validada, autosave no scene JSON e testes de roundtrip no frontend.
  - D2 foi concluida no pipeline canonico: o compilador agora traduz o `NodeGraph` persistido para operacoes reais no game loop SGDK/SNES, cobrindo `event_start`, `sprite_move`, `condition_overlap` com AABB runtime e `action_sound`, com testes dedicados no AST generator e nos dois emitters.
  - E1 foi concluida no emulador: save states agora usam `retro_serialize_size`/`retro_serialize`/`retro_unserialize` reais no FFI, com slot em memoria no `EmulatorCore`, IPC `emulator_save_state`/`emulator_load_state`, botões no `Game View` e cobertura Rust/React para salvar e restaurar estado.
  - E2 foi concluida no `Game View`: o painel agora expoe controles locais de `Pausar`, `Retomar` e `Step 1 frame`, reaproveitando o loop canonico e `emulator_run_frame` para stepping sem abrir um segundo pipeline de execucao.
  - O runner de testes frontend foi endurecido em `vite.config.ts` para usar um unico worker em `threads`, eliminando os timeouts de `vitest-pool` que impediam o gate canonico `npm test` neste host.
  - O baseline local desta rodada permaneceu verde apos cada tarefa com os gates exigidos (`npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture`).

* **O que acabou de acontecer (2026-03-06 - sessao 42):**
  - A1 foi concluida no pipeline canonico: `AnimationDef.fps` agora alimenta o AST e o timing de animacao emitido em SGDK e SNES, removendo o valor hardcoded no codegen.
  - A2 foi concluida no pipeline canonico: entidades com `TilemapComponent` agora geram AST dedicado, emissao real de tilemap/scroll em SGDK e SNES e staging de assets `.bmp`/`.pic`/`.map`/`.pal` no orchestrator.
  - A3 foi concluida no pipeline canonico: `CollisionComponent` com `shape = aabb` agora gera checks AABB no AST com filtro por `layer/collides_with`, e os emitters SGDK/SNES passaram a injetar os checks manuais no game loop.
  - A4 foi concluida no pipeline canonico: `InputComponent` agora gera leitura de input no AST e bindings por acao, com emissao real via `JOY_readJoypad` no SGDK e `scanPads`/`padsCurrent` no SNES.
  - A5 foi concluida no pipeline canonico: `retro_audio_sample_batch` agora consome batches reais no FFI, preserva o ultimo buffer descartavel de audio e o mock core passou a exercitar esse callback sem crash no loop do emulador.
  - A cobertura Rust do compilador/build foi expandida para os cinco pontos (timing de animacao, tilemap, collision, input e audio), preservando o caminho canonico existente sem criar pipeline paralelo.
  - O baseline local desta rodada autonoma ficou verde com os gates exigidos (`npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture`).

* **O que acabou de acontecer (2026-03-06 - sessao 41):**
  - O runner canonico `scripts/e2e-tauri-build-run.mjs` passou a classificar falhas de bootstrap de sessao WebDriver (`DevToolsActivePort`, `chrome not reachable`, `session not created`) com hint operacional direto no erro final.
  - O hint agora inclui caminho do app alvo, endpoint do driver e a trilha recomendada de recuperacao (`diagnose-desktop-e2e.ps1 -SessionProbe` + fallback para runner GitHub/Windows).
  - O script `scripts/diagnose-desktop-e2e.ps1` foi expandido com modo opcional `-SessionProbe`, que executa probe real de `InitSession` contra `msedgedriver` com log verbose e registra evidencias fora da arvore do repo (`%TEMP%`), evitando poluicao estrutural.
  - A reproducao local confirmou de forma deterministica que o bloqueio atual continua em `session not created: DevToolsActivePort file doesn't exist` (driver sobe, app inicia, handshake nao conecta em 60s).
  - Foi identificada nova restricao de infraestrutura no host: `npm run tauri build -- --debug --no-bundle` pode falhar por `spawn EPERM` no `beforeBuildCommand` (esbuild/vite), reforcando que a certificacao institucional deve permanecer no runner GitHub/Windows enquanto a policy local nao for ajustada.
  - O baseline local de qualidade permaneceu verde nesta iteracao (`check:tree`, `lint`, `tsc`, `npm test`, `cargo clippy`, `cargo test --lib`), mantendo o bloqueio restrito ao bootstrap desktop/WebDriver e build desktop local.

* **O que acabou de acontecer (2026-03-05 - sessao 40):**
  - O runner canonico `scripts/e2e-tauri-build-run.mjs` foi endurecido para modo fallback `--external-driver`, permitindo conectar em um `tauri-driver` iniciado fora do processo Node quando o host bloquear bootstrap interno.
  - Foi aplicado ajuste de compatibilidade no bootstrap interno do runner: `tauri-driver` agora sobe com `stdio: inherit` (em vez de `pipe`) para evitar `spawn EPERM` em hosts com policy restritiva de pipes em `child_process`.
  - O runner ganhou guard-rail para falha operacional clara quando `127.0.0.1:4444` ja esta ocupado e para encerramento precoce do processo de driver durante handshake.
  - `docs/07_TEST_AND_COMPLIANCE.md` foi atualizado para documentar o fallback `--external-driver` e o criterio operacional quando o host local falhar em `DevToolsActivePort/chrome not reachable`.
  - Foi criado `scripts/diagnose-desktop-e2e.ps1` para diagnostico operacional padronizado (versions, binarios, snapshot de processos, probe de spawn e porta 4444) e a arvore canonica (`docs/08_TREE_ARCHITECTURE.md`) foi atualizada com o novo script.
  - O baseline local do ciclo permaneceu verde (`check:tree`, `lint`, `tsc`, `npm test`, `cargo clippy`, `cargo test --lib`).
  - **BLOQUEADO POR INFRA:** apos destravar o bootstrap (`spawn EPERM`), a validacao desktop local avancou para novo bloqueio em criacao de sessao WebDriver (`DevToolsActivePort file doesn't exist` / `chrome not reachable`) para cenarios desktop reais.

* **O que acabou de acontecer (2026-03-05 - sessao 39):**
  - Foi concluida nova rodada de auditoria de handlers async residuais no frontend, com endurecimento de disparo em `src/components/tools/ToolsPanel.tsx` (`void` explicito em `onClick`/`useEffect`) para evitar promessas sem tratamento implícito.
  - O runner canonico `scripts/e2e-tauri-build-run.mjs` recebeu diagnostico de infraestrutura mais explicito para bootstrap do desktop: erro de spawn agora reporta `code`, `syscall` e caminhos de `tauri-driver`/`native-driver`.
  - O evento de desvio estrutural local foi resolvido na mesma iteracao: pasta inesperada `Microsoft/` na raiz foi removida e `check:tree` voltou a ficar verde.
  - O baseline local desta iteracao ficou verde (`check:tree`, `lint`, `tsc`, `npm test`, `cargo clippy`, `cargo test --lib`).
  - `tauri-driver.exe --help` permanece funcional neste host.
  - **BLOQUEADO POR INFRA:** os cenarios desktop `live-ok` (Mega Drive/SNES) continuam falhando localmente no bootstrap com `spawn EPERM`, agora com diagnostico completo de caminho no runner.

* **O que acabou de acontecer (2026-03-05 - sessao 38):**
  - O runner canonico `scripts/e2e-tauri-build-run.mjs` ganhou o cenario `live-ok`, validando explicitamente o estado `LIVE` (sem bloqueio, sem warning, sem erro e sem estado pendente/stale) a partir de um draft saudavel.
  - O cenario novo garante no app desktop/Tauri que a toolbar mostra `LIVE: Preview live sincronizado.` com `Build & Run` habilitado e sem `aria-describedby` de bloqueio.
  - `package.json` ganhou aliases por target para o novo cenario (`test:e2e:desktop:live-ok:md` e `...:snes`).
  - `.github/workflows/desktop-e2e.yml` foi atualizado para executar `live-ok` em Mega Drive e SNES e incluir ambos no gate final de outcomes.
  - `src/App.test.tsx` ganhou cobertura de integracao para o estado `LIVE` limpo, garantindo ausencia de summaries residuais.
  - `src/core/validation/liveValidationController.test.ts` ganhou cobertura unit para os indicadores `ANALISANDO` e `LIVE`.
  - O baseline local da iteracao ficou verde (`node --check`, `check:tree`, `lint`, `tsc`, `npm test`, `cargo clippy`, `cargo test --lib`).
  - `tauri-driver.exe --help` voltou a responder neste host, removendo o bloqueio anterior no binario em si.
  - **BLOQUEADO POR INFRA:** validacao desktop local de `live-ok` ainda falha no bootstrap do driver com `spawn EPERM`, mesmo com `npm.cmd` e `msedgedriver` local.

* **O que acabou de acontecer (2026-03-05 - sessao 37):**
  - O runner canonico `scripts/e2e-tauri-build-run.mjs` foi expandido com o cenario `live-stale`, cobrindo o estado intermediario `DESATUAL.` e a transicao `DESATUAL.` -> `ANALISANDO` apos clicar `Revalidar agora`.
  - O cenario novo valida no app desktop/Tauri que `Build & Run` permanece habilitado, sem `aria-describedby` de bloqueio, com hint visual explicito de stale e resumo visual de pending (`Live em analise...`) apos revalidacao manual.
  - `package.json` ganhou aliases por target para o novo cenario (`test:e2e:desktop:live-stale:md` e `...:snes`).
  - `.github/workflows/desktop-e2e.yml` foi atualizado para executar `live-stale` em Mega Drive e SNES e incluir ambos no gate final de outcomes.
  - O baseline local da iteracao ficou verde (`node --check`, `check:tree`, `lint`, `tsc`, `npm test`, `cargo clippy`, `cargo test --lib`).
  - **BLOQUEADO POR INFRA:** execucao desktop local de `live-stale` em MD/SNES falhou com `spawn UNKNOWN`; `tauri-driver.exe --help` segue bloqueado por policy de Application Control no Windows local.
  - **BLOQUEADO POR INFRA:** disparo remoto imediato do workflow desktop nao ocorreu nesta sessao porque `gh` nao esta instalado nesta maquina (`gh --version` falhou).

* **O que acabou de acontecer (2026-03-05 - sessao 36):**
  - O estado `ANALISANDO` no ponto de decisao `Build & Run` agora tem resumo visual explicito na toolbar (`Live em analise...`), mantendo paridade de UX com `WARN`, `ERRO LIVE`, `DESATUAL.` e `BLOQUEADO`.
  - `src/App.test.tsx` ganhou cobertura para validar que `ANALISANDO` nao bloqueia o build e expoe o resumo visual correto.
  - O baseline local estatico permaneceu verde (`check:tree`, `lint`, `tsc`, `clippy`, `cargo test --lib`).
  - Nesta execucao, `npm test` em modo default voltou a falhar por timeout de worker (`vitest-pool`); o fallback deterministico `npx vitest run --no-file-parallelism --maxWorkers=1` passou com 59/59.
  - **BLOQUEADO POR INFRA:** validacao desktop local continua bloqueada por policy de Application Control no `tauri-driver.exe`, mantendo erro `spawn UNKNOWN` no runner.

* **O que acabou de acontecer (2026-03-05 - sessao 35):**
  - O runner canonico `scripts/e2e-tauri-build-run.mjs` foi expandido com o cenario `live-error`, cobrindo `ERRO LIVE` no ponto de decisao sem bloquear indevidamente `Build & Run`.
  - O cenario novo injeta draft invalido semanticamente seguro para UI e valida que a toolbar exibe `ERRO LIVE` + resumo `Live com falha: ...`, mantendo `Build & Run` habilitado e sem motivo de bloqueio.
  - `package.json` ganhou aliases por target para o novo cenario (`test:e2e:desktop:live-error:md` e `...:snes`).
  - `.github/workflows/desktop-e2e.yml` foi atualizado para executar os dois cenarios `live-error` (Mega Drive e SNES) e inclui-los no gate final de verificacao de outcomes.
  - O baseline local permaneceu verde (`node --check` no runner, `check:tree`, `lint`, `tsc`, `npm test`, `clippy`, `cargo test --lib`).
  - **BLOQUEADO POR INFRA:** execucao desktop local do novo cenario falhou pelo mesmo motivo estrutural (`spawn UNKNOWN`), com confirmacao de bloqueio do `tauri-driver.exe` por policy de Application Control.

* **O que acabou de acontecer (2026-03-05 - sessao 34):**
  - Foi aplicado hardening em handlers async residuais da UI (`ToolsPanel`, `ViewportPanel`, `HierarchyPanel`) para normalizar erros desconhecidos com `Error.message`/`String(error)`, evitando logs opacos como `[object Object]`.
  - A mudanca melhora a paridade entre falha real e motivo visual no console sem alterar fluxo canonico de IPC/store.
  - O baseline local permaneceu verde apos os ajustes (`check:tree`, `lint`, `tsc`, `npm test`, `clippy`, `cargo test --lib`).
  - **BLOQUEADO POR INFRA:** tentativa de `desktop-e2e` local segue falhando em `spawn UNKNOWN`; o `tauri-driver.exe` continua bloqueado por policy de Application Control no Windows local.

* **O que acabou de acontecer (2026-03-05 - sessao 33):**
  - A descricao de estado `DESATUAL.` no controller live foi alinhada ao comportamento real da UI: agora orienta `edite a cena` **ou** `use Revalidar agora`.
  - O hint visual da toolbar no `App.tsx` tambem foi atualizado para refletir o mesmo contrato, evitando divergencia textual entre badge/detail e acao disponivel.
  - `liveValidationController.test.ts` foi ajustado para travar essa mensagem canonicamente e impedir regressao documental/UX.
  - O baseline local foi reexecutado por completo e permaneceu verde (`check:tree`, `lint`, `tsc`, `npm test`, `clippy`, `cargo test --lib`).
  - **BLOQUEADO POR INFRA:** o teste desktop real continua impossivel neste host porque `tauri-driver` segue bloqueado por policy de Application Control, mantendo o mesmo `spawn UNKNOWN` no runner E2E.

* **O que acabou de acontecer (2026-03-05 - sessao 32):**
  - A UX do ponto de decisao `Build & Run` passou a exibir motivo textual explicito tambem para `ERRO LIVE` (`Live com falha: ...`), eliminando dependencia de tooltip para entender o estado.
  - O ajuste foi feito no caminho canonico existente (badge/summary da toolbar), sem criar painel paralelo nem bypass da validacao autoritativa.
  - `src/App.test.tsx` ganhou cobertura para `ERRO LIVE` verificando: botao de build permanece habilitado, motivo visual aparece ao lado do build e o fluxo canonico continua executavel.
  - `src/core/validation/liveValidationController.test.ts` ganhou caso explicito para indicador `ERRO LIVE` com `detail` do erro de validacao.
  - O baseline local foi reexecutado e ficou verde: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture`.
  - **BLOQUEADO POR INFRA:** tentativa de `desktop-e2e` local continua falhando em `spawn UNKNOWN`; diagnostico permanece apontando bloqueio do `tauri-driver.exe` por policy de Application Control no Windows local.

* **O que acabou de acontecer (2026-03-05 - sessao 31):**
  - O estado `DESATUAL.` da toolbar ganhou acao explicita `Revalidar agora`, sem criar fluxo paralelo: a acao apenas dispara novo ciclo do controller live canonico (`validate_scene_draft`).
  - O store ganhou um gatilho dedicado (`requestHwValidationRefresh` / `hwValidationRefreshTick`) para permitir revalidacao manual sem mutar a cena e sem bypass da validacao autoritativa Rust.
  - A cobertura de integracao em `src/App.test.tsx` foi expandida para validar o botao `Revalidar agora`, o incremento do tick de revalidacao e o log correspondente.
  - O baseline local passou em `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture`.
  - **BLOQUEADO POR INFRA:** tentativa de validacao desktop real (`npm run test:e2e:desktop:md -- --skip-build --native-driver .\\msedgedriver.exe`) falhou com `spawn UNKNOWN`; diagnostico confirmou que o `tauri-driver.exe` esta bloqueado por policy de Application Control no Windows local.

* **O que acabou de acontecer (2026-03-04 - sessao 30):**
  - A mensagem inicial do console no store deixou de afirmar `Roadmap MVP completo` e agora declara explicitamente `Status: hardening do MVP canonico`.
  - Foi adicionada cobertura em `src/core/store/editorStore.test.ts` para impedir regressao de claim otimista no bootstrap da UI.
  - O baseline local foi reexecutado com sucesso em `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `cargo clippy -- -D warnings` e `cargo test --lib -- --nocapture`.
  - `npm test` em modo default voltou a falhar neste ambiente por timeout de worker (`vitest-pool`); o fallback deterministico `npx vitest run --no-file-parallelism --maxWorkers=1` passou com 56/56.
  - **BLOQUEADO POR INFRA:** a validacao remota `desktop-e2e` nao foi disparada nesta sessao; comando tentado `gh --version` falhou porque `gh` nao esta instalado nesta maquina.

* **O que acabou de acontecer (2026-03-04 - sessao 29):**
  - O editor ganhou badge de estado live na toolbar (`LIVE`, `WARN`, `DESATUAL.`, `ERRO LIVE`, `BLOQUEADO`) no ponto de decisao de `Build & Run`, sem abrir fluxo paralelo ao painel de hardware.
  - O resumo de warning na toolbar foi mantido e agora convive com sinalizacao explicita de frescor/estado do preview, reduzindo risco de interpretar diagnostico stale como certificado.
  - A logica da badge foi centralizada em `liveValidationController` para evitar duplicacao de regras de estado entre `App.tsx` e outros consumidores.
  - A cobertura local foi expandida para stale/warn/bloqueado tanto em unit tests do controller quanto em testes de integracao do App.
  - O runner desktop/Tauri foi atualizado para exigir tambem o estado da badge (`WARN`/`BLOQUEADO`) nos cenarios live, tornando o E2E aderente ao novo contrato de UX.
  - O app debug Tauri foi rebuildado e os cenarios de warning live (VRAM em Mega Drive e sprites em SNES) passaram no app real com `RDS_E2E_DRIVER_TIMEOUT_MS=60000`.

* **O que acabou de acontecer (2026-03-04 - sessao 28):**
  - A UX live do editor foi endurecida no ponto de decisao: warnings nao-fatais agora aparecem tambem na toolbar, ao lado de `Build & Run`, sem bloquear o build.
  - O frontend passou a resumir o primeiro warning live fresco como `Build com alerta: ...`, deixando claro o risco mesmo quando o build continua habilitado.
  - O runner `scripts/e2e-tauri-build-run.mjs` foi endurecido com `RDS_E2E_DRIVER_TIMEOUT_MS`, porque o `tauri-driver` local estava ficando pronto mais lentamente do que o timeout fixo anterior e gerando falso negativo de infraestrutura.
  - `.github/workflows/desktop-e2e.yml` foi ajustado para usar esse timeout configuravel no runner Windows remoto, reduzindo flakiness por startup lento do WebDriver.
  - A nova UX foi validada no app Tauri real com `VRAM warning` em Mega Drive e `Sprite Warning` em SNES, confirmando que a toolbar exibe o alerta correto sem desabilitar `Build & Run`.
  - O patch de blindagem textual dos canonicos permaneceu local durante esta iteracao e sera consolidado no mesmo ciclo de commit/push desta sessao, em vez de ficar como diff solto.

* **O que acabou de acontecer (2026-03-04 - sessao 27):**
  - Foi aplicada blindagem textual adicional nos canonicos (`README.md`, `docs/03_ROADMAP_MVP.md`, `docs/07_TEST_AND_COMPLIANCE.md` e `docs/09_AGENT_DEV_MODE.md`) para deixar explicito que nenhuma etapa pode ser considerada concluida sem certificacao real.
  - A definicao operacional agora esta repetida em multiplos pontos: `concluido/validado` exige caminho canonico real, gates aplicaveis verdes, prova funcional correspondente e ausencia de erro bloqueante no escopo certificado.
  - Foi reforcado que mock, stub, CI verde afrouxado, log cosmetico, fixture artificial fora do caminho canonico ou documento otimista nao contam como prova de entrega.
  - Warnings so podem coexistir com claim de entrega quando forem comprovadamente nao-fatais, explicitamente sinalizados e incapazes de mascarar problema real; caso contrario, o status correto permanece `em hardening`.

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
  - A toolbar do editor agora tambem expoe warning live nao-fatal perto de `Build & Run`, para que o usuario nao dependa exclusivamente do painel lateral para entender o risco atual.
  - O modo de trabalho dos agentes agora esta consolidado em documento canonico proprio para reduzir divergencia de onboarding, claims falsos de entrega e poluicao estrutural.
  - Dados em `data/`: `rom_teste.bin` e `sonic_test.gen` continuam uteis para validacao manual de Mega Drive, mas o uso dessas ROMs deve respeitar compliance/licenciamento.

* **Validacoes verificadas em 2026-03-06 (sessao 41):**
  - `node --check scripts/e2e-tauri-build-run.mjs` -> OK.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-desktop-e2e.ps1` -> OK.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-desktop-e2e.ps1 -SessionProbe` -> FALHOU no probe de sessao (`500 Internal Server Error` com `DevToolsActivePort file doesn't exist` no log verbose do `msedgedriver`).
  - `npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe` -> FALHOU (`session not created: DevToolsActivePort file doesn't exist`), agora com hint operacional no runner.
  - `npm.cmd run tauri build -- --debug --no-bundle` -> FALHOU no host local por `spawn EPERM` durante `beforeBuildCommand` (vite/esbuild).
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 62/62.
  - `cargo clippy -- -D warnings` (em `src-tauri/`) -> OK.
  - `cargo test --lib -- --nocapture` (em `src-tauri/`) -> OK, 39 aprovados / 1 ignorado.

* **Validacoes verificadas em 2026-03-06 (sessao 42):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 62/62.
  - `cargo clippy -- -D warnings` (em `src-tauri/`) -> OK.
  - `cargo test --lib -- --nocapture` (em `src-tauri/`) -> OK, 58 aprovados / 1 ignorado.

* **Validacoes verificadas em 2026-03-05 (sessao 40):**
  - `node --check scripts/e2e-tauri-build-run.mjs` -> OK.
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 62/62.
  - `cargo clippy -- -D warnings` (em `src-tauri/`) -> OK.
  - `cargo test --lib -- --nocapture` (em `src-tauri/`) -> OK, 39 aprovados / 1 ignorado.
  - `npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe` -> FALHOU (`session not created: DevToolsActivePort file doesn't exist`).
  - `npm.cmd run test:e2e:desktop:live-ok:snes -- --skip-build --native-driver .\\msedgedriver.exe` -> FALHOU (`session not created: DevToolsActivePort file doesn't exist`).
  - `npm.cmd run test:e2e:desktop:md -- --skip-build --native-driver .\\msedgedriver.exe` -> FALHOU (`session not created: chrome not reachable`).
  - `npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe --app F:\\Projects\\RetroDevStudio\\src-tauri\\target\\debug\\retro-dev-studio.exe` -> FALHOU (`DevToolsActivePort`), descartando path virtual como causa primaria.
  - `npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe --external-driver` -> FALHOU (`DevToolsActivePort`), confirmando que o fallback externo remove o bloqueio de spawn, mas nao o bloqueio de sessao.
  - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=0' npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe` -> FALHOU (`chrome not reachable`).
  - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=0 --remote-allow-origins=*' npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe` -> FALHOU (`DevToolsActivePort`).
  - `tauri-driver --port 4444 --native-port 9517 --native-driver <msedgedriver> + --external-driver` -> FALHOU (`DevToolsActivePort`), descartando conflito simples de porta nativa.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-desktop-e2e.ps1` -> OK (diagnostico consolidado: `cmd-ignore` passa, `cmd-pipe` falha com `EPERM`, sem listener em `:4444` fora de execucao do runner).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> OK.
  - `gh --version` -> FALHOU (`gh` nao reconhecido nesta maquina).

* **Validacoes verificadas em 2026-03-05 (sessao 39):**
  - `node --check scripts/e2e-tauri-build-run.mjs` -> OK.
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 62/62.
  - `cargo clippy -- -D warnings` (em `src-tauri/`) -> OK.
  - `cargo test --lib -- --nocapture` (em `src-tauri/`) -> OK, 39 aprovados / 1 ignorado.
  - `npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn EPERM`, com diagnostico de driver path no runner).
  - `npm.cmd run test:e2e:desktop:live-ok:snes -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn EPERM`, com diagnostico de driver path no runner).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> OK.
  - `gh --version` -> FALHOU (`gh` nao reconhecido nesta maquina), mantendo bloqueio para disparo remoto via CLI.

* **Validacoes verificadas em 2026-03-05 (sessao 38):**
  - `node --check scripts/e2e-tauri-build-run.mjs` -> OK.
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 62/62.
  - `cargo clippy -- -D warnings` (em `src-tauri/`) -> OK.
  - `cargo test --lib -- --nocapture` (em `src-tauri/`) -> OK, 39 aprovados / 1 ignorado.
  - `npm.cmd run test:e2e:desktop:live-ok:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn EPERM`).
  - `npm.cmd run test:e2e:desktop:live-ok:snes -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn EPERM`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> OK.

* **Validacoes verificadas em 2026-03-05 (sessao 37):**
  - `node --check scripts/e2e-tauri-build-run.mjs` -> OK.
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 59/59.
  - `cargo clippy -- -D warnings` (em `src-tauri/`) -> OK.
  - `cargo test --lib -- --nocapture` (em `src-tauri/`) -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:live-stale:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `npm run test:e2e:desktop:live-stale:snes -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).
  - `gh --version` -> FALHOU (`gh` nao reconhecido nesta maquina), bloqueando disparo remoto imediato via CLI.

* **Validacoes verificadas em 2026-03-05 (sessao 36):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> FALHOU neste ambiente com timeout de worker em `vitest-pool` (sem execucao real dos testes).
  - `npx vitest run --no-file-parallelism --maxWorkers=1` -> OK, 59/59 (fallback deterministico para timeout de worker em modo `forks`).
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:live-error:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).

* **Validacoes verificadas em 2026-03-05 (sessao 35):**
  - `node --check scripts/e2e-tauri-build-run.mjs` -> OK.
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 58/58.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:live-error:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).

* **Validacoes verificadas em 2026-03-05 (sessao 34):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 58/58.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).

* **Validacoes verificadas em 2026-03-05 (sessao 33):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 58/58.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).

* **Validacoes verificadas em 2026-03-05 (sessao 32):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 58/58.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).

* **Validacoes verificadas em 2026-03-05 (sessao 31):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 56/56.
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `npm run test:e2e:desktop:md -- --skip-build --native-driver .\\msedgedriver.exe` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> FALHOU (`spawn UNKNOWN`).
  - `C:\\Users\\misae\\.cargo\\bin\\tauri-driver.exe --help` -> FALHOU (arquivo bloqueado por policy de Application Control do Windows).

* **Validacoes verificadas em 2026-03-04 (sessao 30):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> FALHOU neste ambiente com timeout de worker em `vitest-pool` (sem execucao real dos testes).
  - `npx vitest run --no-file-parallelism --maxWorkers=1` -> OK, 56/56 (fallback deterministico para o timeout de worker em modo `forks`).
  - `cargo clippy -- -D warnings` -> OK.
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `gh --version` -> FALHOU (`gh` nao reconhecido); bloqueio de infraestrutura para disparo remoto imediato do `desktop-e2e`.

* **Validacoes verificadas em 2026-03-04 (sessao 29):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npx vitest run --no-file-parallelism --maxWorkers=1` -> OK, 55/55 (fallback deterministico para ambiente com timeout de worker em modo `forks`).
  - `cargo test --lib -- --nocapture` -> OK, 39 aprovados / 1 ignorado.
  - `cargo clippy -- -D warnings` -> OK.
  - `npm run tauri build -- --debug --no-bundle` -> OK (rebuild do app desktop para validar a UX nova no binario real).
  - `node scripts\e2e-tauri-build-run.mjs --scenario live-warning-vram --project src-tauri/tests/fixtures/projects/megadrive_dummy --skip-build --native-driver <msedgedriver>` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> OK, warning + badge `WARN` em Mega Drive.
  - `node scripts\e2e-tauri-build-run.mjs --scenario live-warning-sprites --project src-tauri/tests/fixtures/projects/snes_dummy --skip-build --native-driver <msedgedriver>` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> OK, warning + badge `WARN` em SNES.

* **Validacoes verificadas em 2026-03-04 (sessao 28):**
  - `npm run check:tree` -> OK.
  - `npm run lint` -> OK.
  - `npx tsc --noEmit` -> OK.
  - `npm test` -> OK, 53/53.
  - `node scripts\e2e-tauri-build-run.mjs --scenario live-warning-vram --project src-tauri/tests/fixtures/projects/megadrive_dummy --skip-build --native-driver <msedgedriver>` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> OK, toolbar exibindo `Build com alerta: VRAM Warning...` em Mega Drive.
  - `node scripts\e2e-tauri-build-run.mjs --scenario live-warning-sprites --project src-tauri/tests/fixtures/projects/snes_dummy --skip-build --native-driver <msedgedriver>` com `RDS_E2E_DRIVER_TIMEOUT_MS=60000` -> OK, toolbar exibindo `Build com alerta: Sprite Warning...` em SNES.

* **Validacoes verificadas em 2026-03-04 (sessao 26/27):**
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
  1. Desbloquear no host a execucao dos build scripts Tauri em `src-tauri\\target\\debug\\build\\*` (ou fornecer ambiente/workspace whitelist equivalente) para que `cargo clippy` e `cargo test --lib` voltem a executar localmente.
  2. Reexecutar os gates Rust canonicos a partir do estado atual limpo e, somente com eles verdes, retomar exatamente `K1. Per-scanline sprite distribution check` em `md_profile.rs` e `snes_profile.rs`.
  3. Apos destravar o gate, continuar a onda K na ordem (`K1 -> K2 -> K3`) e seguir o restante da fila sem abrir pipeline paralelo fora do fluxo canonico.

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
| 2026-03-04 | Codex | Blindagem textual dos canonicos para exigir certificacao real antes de qualquer claim de fase, etapa ou feature concluida |
| 2026-03-04 | Codex | Warning live resumido na toolbar do editor, runner desktop endurecido para startup lento do `tauri-driver` e nova validacao real de warnings no app Tauri |
| 2026-03-04 | Codex | Badge de estado live na toolbar (`LIVE/WARN/DESATUAL./ERRO/BLOQUEADO`), cobertura de testes ampliada e validacao desktop real apos rebuild |
| 2026-03-05 | Codex | Cenario desktop `live-ok` adicionado para estado `LIVE` por target, workflow desktop expandido e cobertura local App/controller fechando indicadores live |
| 2026-03-05 | Codex | Hardening async residual em `ToolsPanel`, limpeza do desvio estrutural local (pasta `Microsoft`) e diagnostico `spawn EPERM` enriquecido no runner desktop |
| 2026-03-05 | Codex | Runner desktop com fallback `--external-driver`, ajuste de compatibilidade de spawn (`stdio: inherit`) e isolamento do novo bloqueio local em `DevToolsActivePort` |

---

**[Sinalizador de Fim de Leitura]**
*Se voce e uma IA e acabou de ler este documento no inicio de uma sessao, responda com: **"[Contexto Carregado] Hardening do MVP. Prioridade: preservar o fluxo canonico validado, manter o desktop E2E repetivel e expandir cobertura sem poluir a arquitetura."***
