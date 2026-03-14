# 03 - ROADMAP MACRO & MVP TATICO
**Status:** Documento vivo
**Ultima revisao canonica:** 2026-03-14
**Fase ativa real:** Release candidate / beta testing do desktop Tauri, com packaging MSI validado e updater em placeholder por politica de dependencias

> **DIRETRIZ PARA AGENTES DE IA**
> Este roadmap precisa refletir estado real do codigo, nao claims historicas.
> Se uma feature existe no repositorio, mas ainda depende de repeticao institucional/CI ou de cobertura complementar por target, ela deve ser tratada como `validada, em hardening`.
> Nenhuma fase ou etapa pode ser considerada `realmente fechada` sem certificacao real: caminho canonico funcional, gates aplicaveis verdes, prova correspondente no fluxo afetado e ausencia de erro bloqueante no escopo certificado.

## Semantica de status

- `Implementada em codigo`: existe no repositorio, mas ainda nao possui certificacao real suficiente.
- `Validada`: existe prova funcional real no escopo afetado, mas ainda pode depender de repeticao institucional, cobertura complementar ou endurecimento adicional.
- `Em hardening`: ja passou por validacao real, mas ainda nao deve ser tratada como definitivamente fechada.
- `Concluida e verificada`: so usar quando o caminho estiver certificado de forma real, sem erro bloqueante no escopo, sem gate vermelho e sem divergencia entre docs/UI e backend.
- `Experimental`: superficie visivel, parcial, congelada ou ainda incapaz de sustentar claim de entrega real.

---

## Estado Real em 2026-03-14

### Ja implementado em codigo
- Editor Tauri + React + TypeScript funcional.
- Schema canonico de projeto/cena, fixtures dummy e testes Rust.
- Build orchestration real por target (`megadrive` e `snes`) com erro explicito sem toolchain.
- Emulacao integrada por Libretro real via FFI no Rust.
- Callback de audio em batch no Libretro agora aceita batches reais sem crash e preserva o ultimo buffer descartavel do core.
- Instalacao sob demanda de SGDK, PVSnesLib e cores Libretro oficiais no Windows.
- Caminho SNES com staging de asset real e workspace compativel com `snes_rules`.
- Baseline de CI com GitHub Actions para `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `cargo clippy -- -D warnings`, `cargo test --lib` e `npm test`.
- Validacao oficial upstream em Windows com SGDK, PVSnesLib e cores Libretro reais via `scripts/validate-upstream-windows.ps1`.
- E2E de aplicacao desktop/Tauri via `scripts/e2e-tauri-build-run.mjs` para `Build -> Load ROM -> Run frames`.
- Workflow dedicado `.github/workflows/desktop-e2e.yml` validado em runner GitHub/Windows real para Mega Drive e SNES.
- Cobertura desktop E2E dos estados live `LIVE`, `WARN`, `BLOQUEADO`, `ERRO LIVE`, `DESATUAL.` e `ANALISANDO` por target no runner canonico/workflow dedicado.
- Runner desktop com diagnostico explicito de bootstrap do driver (`code/syscall/path`) para falhas locais de permissao (`spawn EPERM`).
- Runner desktop com hint operacional para falhas de sessao (`DevToolsActivePort/chrome not reachable`) e script de diagnostico com `-SessionProbe` para evidencia local reproduzivel.
- Pause/resume do viewport preservando o core Libretro, autosave fresco no hierarchy e persistencia atomica de projeto/cena.
- Undo/redo do editor com atalhos globais, pilha limitada e agrupamento de drag no viewport.
- Grid snap de 8px no Scene View com toggle visual e atalho `G`.
- Resolucao de prefab no pipeline canonico com merge de entidades antes de validacao/build/codegen.
- Deep Profiler destravado na UI e conectado ao backend real, agora com deteccao adaptativa de SAT por scoring de candidatos em vez de offsets fixos e aviso heuristico funcional sem badge `Experimental`.
- Asset Extractor destravado na UI e conectado ao backend real, agora com modos `auto`/`2bpp`/`4bpp` e autodeteccao heuristica para tiles 2bpp, permanecendo `Experimental` ate validar extracao ponta a ponta com ROM real.
- RetroFX agora persiste configuracao de parallax/raster no scene JSON, o designer foi reabilitado e o pipeline SGDK/SNES passou a emitir scroll/parallax real, permanecendo `Experimental` ate validacao com ROM real.
- NodeGraph agora persiste nos componentes de logica via `LogicComponent.graph`, com roundtrip de serializacao no frontend e autosave no JSON da cena.
- NodeGraph agora compila os nos persistidos para C no pipeline canonico, com emissao integrada no game loop SGDK/SNES para `event_start`, `sprite_move`, `condition_overlap`, `action_sound`, `effect_parallax`, `effect_raster`, `sprite_anim`, `scroll_tilemap`, `move_camera` e guards booleanos via `logic_and`.
- Patch Studio agora gera BPS com `SourceCopy` quando encontra runs reaproveitaveis da ROM original, reduzindo tamanho de patch sem alterar o apply canonico ja validado.
- Save states basicos do emulador agora usam serializacao real do Libretro com slot em memoria, IPC dedicado e controles de salvar/carregar no `Game View`.
- `Game View` agora expoe `pause`, `resume` e `step 1 frame` no proprio painel, reaproveitando `emulator_run_frame` e o loop canonico existente sem pipeline paralelo.
- `Game View` agora recebe audio real do Libretro por evento `emulator://audio`, reproduz via Web Audio API com fila curta sincronizada ao frame loop e expoe toggle de mute no painel.
- `ToolsPanel` agora expoe um `Memory Viewer` basico ligado ao Libretro real, com leitura de SRAM/WRAM/VRAM, grid hexadecimal e auto-refresh, mantido como `Experimental`.
- `project.rds` e `scenes/*.json` agora carregam `schema_version`, aplicam migracao pass-through de `1.0.0` e preservam compatibilidade com fixtures legadas sem o campo.
- O editor agora suporta fluxo basico de multi-cena com catalogo, troca/criacao pela `Hierarchy`, persistencia do `scene_path` ativo e atualizacao canonica de `entry_scene` para manter o build alinhado a cena selecionada.
- O `Inspector` agora edita `Physics`, `Audio` e `Input` no caminho canonico da cena e exibe resumo read-only do `LogicComponent.graph`, mantendo a edicao estrutural do grafo restrita ao `NodeGraph`.
- Features ainda parciais agora ficam explicitamente marcadas como `Experimental` na UI para nao mentir sobre prontidao.
- Onda M concluida em codigo: Asset Browser experimental, hot reload de assets, gizmos de resize, VRAM Viewer experimental, performance overlay e rewind no Game View.
- Onda N concluida em codigo: FSM Builder, flow nodes, timeline sequence e hardware event nodes integrados de ponta a ponta no NodeGraph.
- Onda O concluida em codigo: monitoramento live de VRAM, sprites por scanline, DMA e bancos de paleta no `HardwareStatus`, toolbar e paineis.
- Onda P concluida em codigo: build multi-target com relatorio comparativo, Reverse Explorer experimental e deterministic replay com controles no Game View.
- Onda Q concluida em codigo: schema migration chain ate `1.2.0`, knowledge tooltips no Inspector e compliance de patches com aviso legal e trilha de auditoria.
- Onda R concluida em codigo para release candidate: packaging MSI validado localmente, onboarding de primeiro uso com template funcional e configuracao placeholder de updater.

### Ainda em hardening
- Runtime real de auto-update continua bloqueado ate aprovacao explicita para adicionar `tauri-plugin-updater` sob a politica atual de dependencias.
- Repeticao institucional do bundle MSI, do smoke desktop e do fluxo oficial upstream em Windows quando build, emulacao, onboarding ou packaging forem alterados.
- Este host ainda pode exigir diagnostico adicional para bootstrap WebDriver (`DevToolsActivePort` / `chrome not reachable`) e para `spawn EPERM` em builds desktop fora do wrapper MSVC canonico.
- Decisao final de governanca do workflow desktop dedicado (`push`/`pull_request` path-filtered, `workflow_dispatch`, `workflow_call` ou gate protegido).
- Auditoria residual de UX e release notes para transformar o release candidate em beta institucional.

---

## FASE 0 - FUNDACAO
**Status:** CONCLUIDA E VERIFICADA

- [x] Scaffold Tauri + React + TypeScript + Vite.
- [x] Estrutura de pastas alinhada com `08_TREE_ARCHITECTURE.md`.
- [x] Backend Rust organizado em modulos.
- [x] Frontend com store, IPC e layout base.

---

## FASE 1 - CORE MEGA DRIVE
**Status:** VALIDADA EM WINDOWS, EM HARDENING

### Entregas implementadas
- [x] Parser/manager canonico para `project.rds` e `scenes/*.json`.
- [x] AST UGDM -> C para SGDK.
- [x] Timing de animacao parametrizavel no codegen SGDK e SNES a partir de `AnimationDef.fps`.
- [x] Pipeline basico de tilemap para SGDK com AST dedicado, emissao de plano/scroll e staging de asset `.bmp`.
- [x] Collision AABB basica no game loop SGDK com filtros por `layer/collides_with` a partir de `CollisionComponent`.
- [x] Input mapping basico no game loop SGDK via `JOY_readJoypad` por `InputComponent`.
- [x] Physics basica no game loop SGDK com gravidade/subpixels, clamp de velocidade, friccao e bounce simples a partir de `PhysicsComponent`.
- [x] Pipeline de audio SGDK com coleta de `AudioComponent`, staging de assets, `WAV`/`XGM` no `resources.res`, `XGM_setPCM` para SFX e `XGM_startPlay` para BGM.
- [x] Build workspace real com `main.c`, `resources.res`, `Makefile` e deteccao de ROM.
- [x] Hardware validation para Mega Drive.
- [x] Emulacao Libretro real para ROM externa e ROM gerada.
- [x] Instalacao automatica sob demanda de SGDK e core Libretro de Mega Drive.

### Gate obrigatorio para considerar a fase realmente fechada
- [x] Validar em Windows o fluxo `instalar SGDK -> Build & Run -> ROM abrindo em core Libretro oficial`.
- [x] Registrar evidencias dessa validacao no `06_AI_MEMORY_BANK.md`.

---

## FASE 2 - ABSTRACAO SNES
**Status:** VALIDADA EM WINDOWS, EM HARDENING

### Entregas implementadas
- [x] Target `snes` no schema/projeto.
- [x] Hardware profile SNES com regras alinhadas ao exporter atual.
- [x] Emitter SNES e workspace PVSnesLib com `main.c`, `hdr.asm`, `data.asm` e regras de conversao de assets.
- [x] Staging de asset real para `.bmp` no caminho SNES.
- [x] Pipeline basico de tilemap para SNES com `bgInitTileSet`, `bgInitMapSet` e staging de dados `.pic/.map/.pal`.
- [x] Collision AABB basica no game loop SNES com filtros por `layer/collides_with` a partir de `CollisionComponent`.
- [x] Input mapping basico no game loop SNES via `scanPads`/`padsCurrent` por `InputComponent`.
- [x] Physics basica no game loop SNES com gravidade/subpixels, clamp de velocidade, friccao e bounce simples a partir de `PhysicsComponent`.
- [x] Pipeline de audio SNES com coleta de `AudioComponent`, staging raw no workspace, rotulos em `data.asm`, `spcLoad` para BGM e `spcPlaySound` para SFX.
- [x] Instalacao automatica sob demanda de PVSnesLib e core Libretro de SNES.

### Gate obrigatorio para considerar a fase realmente fechada
- [x] Validar em Windows o fluxo `instalar PVSnesLib -> Build & Run -> ROM abrindo em core Libretro oficial`.
- [x] Confirmar o caminho com shell Unix-like suportado e registrar prerequisitos oficiais.

---

## FASE 3 - VISUAL LOGIC & RETROFX
**Status:** CONCLUIDA EM CODIGO, VALIDADA LOCALMENTE, EM BETA TESTING

- [x] NodeGraph UI agora persiste o grafo em `LogicComponent.graph` com roundtrip de serializacao.
- [x] NodeGraph compilado para fragmentos C no pipeline SGDK/SNES para os nos MVP, scroll/camera/animacao e efeitos visuais (`event_start`, `sprite_move`, `condition_overlap`, `action_sound`, `effect_parallax`, `effect_raster`, `sprite_anim`, `scroll_tilemap`, `move_camera`, `logic_and` como guard booleano).
- [x] NodeGraph agora inclui FSM Builder, flow nodes, timeline sequence e hardware event nodes no editor e no pipeline canonico SGDK/SNES.
- [x] RetroFX UI existente.
- [x] RetroFX persiste configuracao no scene JSON, exporta parallax/raster real no pipeline SGDK/SNES e permanece `Experimental` ate validar com ROM real.
- [x] `Game View` consome audio do emulador via `emulator://audio` e Web Audio com mute local, sem criar loop paralelo ao `emulator_run_frame`.
- [x] A camada de UX do editor agora inclui hot reload, resize gizmos, VRAM Viewer, performance overlay e rewind integrados ao fluxo canonico.
- [x] O monitor live de hardware agora expoe budgets de VRAM, sprites por scanline, DMA e bancos de paleta.
- [x] Testes frontend existentes e passando.

---

## FASE 4 - CAMADA PRO
**Status:** CONCLUIDA EM CODIGO, VALIDADA LOCALMENTE, EM BETA TESTING

- [x] Patch Studio.
- [x] Deep Profiler visivel, conectado ao backend real, com deteccao adaptativa de SAT e aviso heuristico sem badge `Experimental`.
- [x] Asset Extractor visivel, conectado ao backend real e mantido como `Experimental` ate validar extracao ponta a ponta com ROM real.
- [x] Build multi-target com relatorio comparativo por target no ToolsPanel.
- [x] Reverse Explorer basico e experimental para ROMs Mega Drive e SNES.
- [x] Deterministic replay com gravacao, reproducao e validacao opcional de framebuffer final.
- [x] Knowledge Engine basico no Inspector via JSON estatico empacotado no app.
- [x] Schema migration chain ate `1.2.0` com warning para projetos mais novos que o app.
- [x] Compliance de patches com aviso legal, bloqueio de export de ROM completa e auditoria em `project.rds`.

---

## FASE 5 - RELEASE
**Status:** RELEASE CANDIDATE / BETA TESTING

- [x] Windows MSI packaging validado localmente.
- [x] Onboarding de primeiro uso com template funcional.
- [x] Configuracao placeholder de updater com endpoint e pubkey placeholder.
- [ ] Runtime real de auto-update (bloqueado pela regra atual de nao adicionar dependencias novas).

---

## ONDAS M-R (ESTADO REAL)

- Wave M - concluida (`c5aeae4`, `6a64a9a`, `d04b9d5`, `3bccffc`, `64e5f8f`, `71d227e`)
- Wave N - concluida (`a5e9a01`, `27e9375`, `31e5e4a`, `0d8db6b`)
- Wave O - concluida (`6272eda`, `5520c5b`, `b765796`, `9bdaa48`)
- Wave P - concluida (`8fb9d25`, `738b898`, `23977f1`)
- Wave Q - concluida (`ac4a4f5`, `f46e4a8`, `733f75f`)
- Wave R - concluida em release candidate, com updater ainda placeholder (`a7f6529`, `7c3e84d`, `1f012bd`)

---

## Ordem Executiva Atual

1. Manter o baseline canonico verde antes e depois de qualquer ajuste relevante.
2. Repetir bundle MSI e smoke desktop em host Windows institucional para mudancas sensiveis de build, emulacao, packaging, onboarding e projeto.
3. Executar QA do onboarding/template inicial, replay/rewind, build multi-target e Patch Studio com compliance.
4. Decidir se a dependencia `tauri-plugin-updater` pode ser aprovada sob a politica atual.
5. Preparar release notes, criterios de aceite e checklist de beta testing antes de promover o release candidate.

---

## Regra de Atualizacao

- Marque `[x]` apenas quando houver codigo funcional e validacao correspondente.
- Nao use `[x]` para simular progresso quando a prova ainda for mock, stub, output parcial ou fluxo paralelo ao canonico.
- Se a validacao ja ocorreu, mas ainda depender de repeticao institucional ou cobertura adicional, marque como hardening e nao como totalmente encerrada.
- Se houver erro bloqueante conhecido, regressao aberta ou evidencia insuficiente, rebaixe o status em vez de manter claim otimista.
- Sempre atualize este arquivo junto de `06_AI_MEMORY_BANK.md` quando o status do produto mudar.
