# 03 - ROADMAP MACRO & MVP TATICO
**Status:** Documento vivo
**Ultima revisao canonica:** 2026-04-06
**Fase ativa real:** Release candidate / beta testing do desktop Tauri, com baseline automatizada restaurada, persistencia atomica Windows endurecida, schema UGDM migrado explicitamente ate `1.6.0`, galeria de templates alinhada com `platformer_gm`, semantica `prefab` vs `display_name` separada, importacao SGDK generica ainda `Experimental`, importacao MUGEN agora entrando no fluxo canonico como superficie `Experimental` para personagem/stage/screenpack (com assets reais e sem conversao integral de `CMD/CNS` nesta wave), nova camada comum de importadores externos iniciada com registry de perfis, `Ikemen GO` tratado como extensao do eixo MUGEN e `Godot 2D` entrando como primeiro adapter adicional `Experimental` para `assets + cena + audio` sem portar scripts, UI novamente coerente com os badges/documentos de maturidade, smoke desktop completo `Build -> ROM -> Run` reproduzido novamente no host local durante a sprint de consolidacao do Game View, ArtStudio institucionalizado na baseline do workspace como superficie `Experimental`, com validacao minima de dados, ingestao backend Rust, `suggested_frames` alinhados, importacao canonica para `assets/sprites`, pipeline basico validado localmente ate `resources.res/build` e agora um plano de `apply` explicito para `criar entidade` vs `atualizar entidade selecionada`, mantendo a leitura honesta de que ainda falta prova institucional adicional ate o runtime, RetroFX com editor visual-first de parallax/raster ainda `Experimental`, agora deixando explícito quando a configuração está apenas no preview local versus sincronizada no `scene JSON` que o build consome, shell principal reorganizado como workspace adaptativo com rail lateral, painel contextual, presets de layout, focus mode e console colapsavel por padrao, o Project Manager agora capaz de criar projetos com pasta base automatica, expor a arvore host SGDK em modo read-only e adotar projetos SGDK legados via overlay `rds/` com delegacao de build ao Makefile do host sem tocar no codigo original, e agora um reverse core canonico `Experimental` para ROMs Mega Drive/SNES com manifesto, segmentacao, extractors por dominio, disassembly inicial, xrefs/call graph basicos, scaffold dinamico conservador (`ExecutionTraceLog`/`CpuState`), `BinaryDiffScorer` experimental, anotacoes persistidas por hash-bound sidecar e uma trilha operacional explicita para separar leitura util de hoje versus projecao futura ainda `analysis_only`, alem de um NodeGraph mais acolhedor com `Guided Empty State`, quick actions baseadas apenas em nos ja canonicos e pequenos helpers de reparo guiado. A repeticao em baseline commitada continua obrigatoria antes de qualquer claim institucional definitiva.

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

## Estado Real em 2026-03-20

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
- Agregador canonico de readiness de release em `scripts/release-readiness.mjs`, gerando `src-tauri/target-test/validation/release-readiness.{json,md}` com baseline, artefatos, upstream report, dirty worktree e QA manual pendente.
- Cobertura desktop E2E dos estados live `LIVE`, `WARN`, `BLOQUEADO`, `ERRO LIVE`, `DESATUAL.` e `ANALISANDO` por target no runner canonico/workflow dedicado.
- Runner desktop com diagnostico explicito de bootstrap do driver (`code/syscall/path`) para falhas locais de permissao (`spawn EPERM`).
- Runner desktop com hint operacional para falhas de sessao (`DevToolsActivePort/chrome not reachable`) e script de diagnostico com `-SessionProbe` para evidencia local reproduzivel.
- Pause/resume do viewport preservando o core Libretro, autosave fresco no hierarchy e persistencia atomica de projeto/cena endurecida no Windows contra `Access denied` / `Sharing violation`.
- Undo/redo do editor com atalhos globais, pilha limitada e agrupamento de drag no viewport.
- Grid snap de 8px no Scene View com toggle visual e atalho `G`.
- Resolucao de prefab no pipeline canonico com merge de entidades antes de validacao/build/codegen.
- O editor agora separa `activeSceneSource` e `activeScene`, preservando referencias de prefab/graph externo no save enquanto usa a cena resolvida para viewport, inspector e build.
- O `Inspector` agora marca visualmente campos `Herdado` e `Override` para entidades baseadas em prefab.
- `LogicComponent` agora aceita `graph_ref` com persistencia externalizada em `graphs/*.json`, mantendo `graph` inline apenas para retrocompatibilidade.
- O seed `platformer` agora nasce com `prefabs/platformer_*.json`, `graphs/platformer_player_logic.json` e `template_metadata` no `project.rds`.
- O onboarding virou galeria de templates com cards, status de disponibilidade, badge `Experimental`, donor override para templates SGDK externos, botao dedicado `Importar Projeto SGDK` e alinhamento ponta a ponta do template `platformer_gm`.
- O `ViewportPanel` agora renderiza preview real de sprite/tilemap via asset URL, com fallback para caixa colorida.
- O `NodeGraphEditor` agora mostra labels amigaveis em PT-BR e paleta agrupada para leigos, sem alterar os IDs tecnicos serializados.
- O backend agora faz parse de `resources.res` e importa projetos SGDK externos sanitizando apenas assets suportados, ignorando `VGM`, ROMs, `out/`, `boot/`, codigo C e headers.
- O backend agora importa projetos MUGEN em modo `Experimental`, cobrindo personagem/stage/screenpack por `DEF`/`AIR`, atlas visual, colisao MUGEN basica e fallback para sprites extraidos em `work/*_sff` quando existirem.
- O backend agora expoe uma matriz canonica de importadores externos e um comando generico `import_external_project`, permitindo que o wizard trate SGDK, MUGEN, Ikemen GO e Godot 2D sob o mesmo contrato de proveniencia.
- O backend agora importa projetos Godot 2D em modo `Experimental`, cobrindo `project.godot` + `.tscn`, `Sprite2D`, `Camera2D`, `AudioStreamPlayer`/`AudioStreamPlayer2D`, assets reais, cena nativa `.rds` e metadata `source_engine/import_profile`, sem prometer conversao de `GDScript`, `AnimatedSprite2D` ou `TileMap` nesta wave.
- O backend agora possui um reverse core canonico em `src-tauri/src/tools/reverse/`, com adapters iniciais para `Mega Drive` e `SNES`, `RomAnalysisManifest`, segmentacao/banks, hashes, extractors experimentais de `graphics/text/audio`, disassembly inicial `68000/65816`, `xrefs`, `call_graph`, `logic_hints` e sidecar de anotacoes persistido por hash.
- O reverse core agora tambem expoe `ExecutionTraceLog`/`CpuState` para trilha dinamica conservadora, aceita overlay opcional de trace vindo do emulador sem quebrar API publica, possui coleta real via `retro_serialize` quando houver adapter de runtime suportado e ganhou `BinaryDiffScorer` experimental para matching estrutural entre assembly extraido e compilado.
- O `ToolsPanel` agora expõe um `Reverse Workspace` canonico `Experimental`, com abas `ROM Map`, `Hex`, `Graphics`, `Text`, `Audio`, `Code` e `Projection`, além de leitura de `xrefs/call graph` e salvamento de anotacoes.
- O `Reverse Workspace` agora tambem deixa explicito o que ja serve para leitura recorrente hoje, quantas anotacoes persistidas a ROM possui e quando `Projection` continua apenas informativa, evitando claim inflada de engenharia reversa “completa”.
- Deep Profiler destravado na UI e conectado ao backend real, agora com deteccao adaptativa de SAT por scoring de candidatos em vez de offsets fixos e aviso heuristico funcional sem badge `Experimental`.
- Asset Extractor destravado na UI e conectado ao backend real, agora com modos `auto`/`2bpp`/`4bpp`, notice/badge `Experimental` explicitos e autodeteccao heuristica para tiles 2bpp, permanecendo `Experimental` ate validar extracao ponta a ponta com ROM real.
- RetroFX agora persiste configuracao de parallax/raster no scene JSON, o designer foi reabilitado como editor visual-first com lista de camadas, preview animado, controles pedagogicos e persistencia segura na cena fonte, e o pipeline SGDK/SNES continua emitindo scroll/parallax real; a superficie permanece `Experimental` ate validacao com ROM/cenas reais.
- RetroFX agora explicita na UI quando a configuracao ainda esta so no preview local e quando o `scene JSON` ja esta sincronizado para o build local, mantendo a superficie `Experimental` e sem criar fluxo paralelo de emissao.
- NodeGraph agora persiste nos componentes de logica via `LogicComponent.graph`, com roundtrip de serializacao no frontend e autosave no JSON da cena.
- NodeGraph agora compila os nos persistidos para C no pipeline canonico, com emissao integrada no game loop SGDK/SNES para `event_start`, `sprite_move`, `condition_overlap`, `action_sound`, `effect_parallax`, `effect_raster`, `sprite_anim`, `scroll_tilemap`, `move_camera` e guards booleanos via `logic_and`.
- Patch Studio agora gera BPS com `SourceCopy` quando encontra runs reaproveitaveis da ROM original, reduzindo tamanho de patch sem alterar o apply canonico ja validado.
- Save states basicos do emulador agora usam serializacao real do Libretro com slot em memoria, IPC dedicado e controles de salvar/carregar no `Game View`.
- `Game View` agora expoe `pause`, `resume` e `step 1 frame` no proprio painel, reaproveitando `emulator_run_frame` e o loop canonico existente sem pipeline paralelo.
- O `Game View` agora alinha o texto de status e o enablement dos controles ao mesmo conceito de sessao do emulador, evitando contradicoes entre ROM carregada, loop ativo e estado pausado.
- `Game View` agora recebe audio real do Libretro por evento `emulator://audio`, reproduz via Web Audio API com fila curta sincronizada ao frame loop e expoe toggle de mute no painel.
- `ToolsPanel` agora expoe um `Memory Viewer` basico ligado ao Libretro real, com leitura de SRAM/WRAM/VRAM, grid hexadecimal, auto-refresh e sinalizacao `Experimental` explicita.
- O `ArtStudio` agora integra a baseline do workspace como superficie `Experimental`, gravando animacoes no schema canonico da entidade sprite com validacao minima de origem do asset, nomes de sequencia e dimensoes de frame antes de persistir.
- O `ArtStudio` agora aceita ingestao de imagens externas por backend Rust, com suporte multiformato (`PNG`, `BMP`, `JPG/JPEG`, `GIF`, `WebP`, `PPM`), processamento via `spawn_blocking`, preview PNG quantizado em base64, paleta Mega Drive 15+1, bounds alinhado a 8x8, `suggested_frames` explicitos e bloqueio de `Aplicar na Cena` ate a geracao do asset canonico em `assets/sprites`.
- O `ArtStudio` agora gera sprite sheet canonica do projeto via `import_art_asset`, repacotando somente os frames sugeridos em ordem previsivel para manter compatibilidade com o emitter do build sem criar pipeline paralelo.
- O `ArtStudio` agora fecha o pipeline basico local ate o build: `Aplicar` cria/atualiza entidade real na cena, o emitter SGDK consome o `SpriteComponent` canonico, `build_orch.rs` trava o `resources.res` para asset vindo do fluxo do ArtStudio e a UI passou a explicitar `Destino`, `Build` e `Proximo passo` antes do apply para reduzir ambiguidade operacional.
- O Project Manager agora cria projetos mesmo sem pasta base manual, resolvendo automaticamente um diretÃ³rio seguro do sistema para `RetroDevProjects`, e abre/importa projetos SGDK legados por overlay `rds/` nao-destrutivo com indice do host exposto no estado do editor e resumido no `Runtime Setup`, sem sobrescrever `main.c`, headers ou manifests originais.
- O wizard de primeiro uso agora prioriza por padrao um template builtin realmente `ready-to-create` neste host, exibe um card `Primeiro sucesso` com o caminho `Scene -> Game` e manteve os templates SGDK externos honestamente bloqueados ate donor manual.
- A rail lateral do shell agora agrupa os workspaces em `Core`, `Autoria` e `Debug`, mantendo `Art` e `FX` explicitamente marcados como `Exp.` sem abrir a frente de docking livre.
- Projetos SGDK legados adotados por overlay `rds/` agora expõem a arvore host em modo read-only no `Asset Browser`, permitem preview textual seguro de arquivos indexados e delegam `Build & Run` ao Makefile raiz do host quando o projeto aberto esta realmente em modo overlay legado.
- O shell principal agora funciona como workspace adaptativo: rail lateral por contexto (`Scene`, `Game`, `Logic`, `FX`, `Art`, `Debug`), top bar reduzida a acoes globais, painel direito alternando entre `Inspector` e `Tools`, presets `Artist/Logic/Debug/Playtest`, focus mode e console fechado por padrao com autoabertura em erro.
- O `NodeGraphEditor` agora tambem possui `Guided Empty State` com tres quick actions pedagogicas e comentarios automaticos na UI, sempre montados a partir de nos ja canonicos do pipeline atual e sem gravar metadata fora do schema.
- O pipeline de build foi endurecido contra configuracoes hostis de projeto: `build.output_dir` agora precisa permanecer relativo ao workspace e o script canonico `scripts/build.mjs` limpa os artefatos esperados antes da compilacao, falhando explicitamente se o EXE/MSI esperado nao for gerado.
- `project.rds` e `scenes/*.json` agora carregam `schema_version`, aplicam cadeia explicita de migracao ate `1.6.0` (`collision_map`, `layers`, `display_name`) e preservam compatibilidade com fixtures legadas sem o campo.
- O editor agora suporta fluxo basico de multi-cena com catalogo, troca/criacao pela `Hierarchy`, persistencia do `scene_path` ativo e atualizacao canonica de `entry_scene` para manter o build alinhado a cena selecionada.
- O `Inspector` agora edita `Physics`, `Audio` e `Input` no caminho canonico da cena e exibe resumo read-only do `LogicComponent.graph`, mantendo a edicao estrutural do grafo restrita ao `NodeGraph`.
- Features ainda parciais agora ficam explicitamente marcadas como `Experimental` na UI para nao mentir sobre prontidao; `nodeCompiler.ts` frontend legado permanece fora do pipeline canonico e deve ser tratado como superficie experimental/nao-oficial.
- Onda M concluida em codigo: Asset Browser experimental, hot reload de assets, gizmos de resize, VRAM Viewer experimental, performance overlay e rewind no Game View.
- Onda N concluida em codigo: FSM Builder, flow nodes, timeline sequence e hardware event nodes integrados de ponta a ponta no NodeGraph.
- Onda O concluida em codigo: monitoramento live de VRAM, sprites por scanline, DMA e bancos de paleta no `HardwareStatus`, toolbar e paineis.
- Onda P concluida em codigo: build multi-target com relatorio comparativo, Reverse Explorer experimental e deterministic replay com controles no Game View.
- Onda Q concluida em codigo: schema migration chain ate `1.2.0`, knowledge tooltips no Inspector e compliance de patches com aviso legal e trilha de auditoria.
- Onda R concluida em codigo para release candidate: packaging MSI validado localmente, onboarding de primeiro uso com template funcional e configuracao placeholder de updater.
- Rodada de hotfix pos-RC concluida em codigo e certificada localmente: sessao do emulador endurecida, replay vazio rejeitado, build concorrente bloqueado, emitter SNES/RetroFX alinhado ao `HDMATable16`, leitura de input SNES alinhada ao PVSnesLib atual, smoke desktop MD/SNES verde e MSI regenerado apos as correcoes (`26b0911`, `ff0228a`, `e534af2`).
- Hardening adicional do onboarding/editor concluido em codigo e validado localmente: o `NodeGraphEditor` agora hidrata o schema legado do backend, novos projetos passam a nascer com o graph inicial no formato completo do editor, cenas antigas de onboarding reparam placeholder/edge inicial ao carregar e o editor passou a limitar sprites simples ao envelope suportado por target via `sceneConstraints` (`783f1b0`, `3666375`).
- Hardening adicional do fluxo de autoria concluido em codigo e validado localmente: cenas vazias agora oferecem `Sprite Inicial` na `Hierarchy`, o `Asset Browser` instancia imagens direto na cena ativa, o `Scene View` explica como sair do estado vazio e os caminhos receberam cobertura dedicada no frontend (`88df160`).
- Hotfix adicional do build Mega Drive concluido em codigo e validado localmente: o staging SGDK agora copia sprites, tilemaps e audio para `build/megadrive/res/assets/...`, alinhando o workspace ao contrato real do `resources.res`/`ResComp`; a suite Rust de `build_orch` passou a travar esse layout com fixture de sprite real (`ac1ee60`).
- Hotfix adicional do build Mega Drive concluido em codigo e validado localmente: sprites SGDK agora sao convertidos para `.bmp` no staging, o `resources.res` passou a apontar para esse `.bmp` em vez do `.ppm` cru e o smoke oficial de Windows agora exige que um projeto de onboarding Mega Drive compile com toolchain real (`74b781f`).
- O bundle MSI foi reemitido novamente apos o hotfix de conversao SGDK em `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`, alinhando o pacote de reteste ao estado atual do branch.

### Ainda em hardening
- Runtime real de auto-update implementado em codigo: `tauri-plugin-updater = "2"` adicionado ao `Cargo.toml` e plugin registrado em `lib.rs`. Sem UI de update ainda — endpoint/pubkey permanecem placeholder.
- Repeticao institucional do bundle MSI, do smoke desktop e do fluxo oficial upstream em Windows quando build, emulacao, onboarding ou packaging forem alterados.
- Validacao Rust completa do importador MUGEN neste host apos o bloqueio AppLocker sobre a harness recompilada; por enquanto, a rodada ficou com `cargo test --lib --no-run` verde, `cargo clippy` verde e cobertura frontend verde, mas sem claim de certificacao Rust final.
- Este host continua sujeito a diagnosticos ocasionais de WebDriver em cenarios locais (`DevToolsActivePort` / `chrome not reachable` ou policies de `spawn`), mas o smoke desktop canonico `Build -> ROM -> Run` voltou a passar nesta sprint de consolidacao do Game View.
- Decisao final de governanca do workflow desktop dedicado (`push`/`pull_request` path-filtered, `workflow_dispatch`, `workflow_call` ou gate protegido).
- O `ArtStudio` permanece `Experimental`: persistencia/schema, ingestao backend, `suggested_frames`, importacao canonica, plano de apply contextual e pipeline basico ate `resources.res/build` ja estao validados localmente, mas ainda falta repeticao institucional com toolchain oficial e prova adicional da animacao autorada chegando ao runtime.
- O reverse core permanece `Experimental`: manifesto, extractors, disassembly inicial, overlay por trace e anotacoes ja estao reais e cobertos, mas a coleta Libretro fora de adapters suportados, a projecao `.rds` e a recuperacao avancada de logica continuam em hardening.
- O `ToolsPanel` voltou a crescer levemente durante o hardening do `Reverse Workspace` (~`92.23 kB` bruto / `21.84 kB` gzip), entao performance/bundle continua devendo disciplina antes de expandir mais a frente `Experimental`.
- O shell principal agora esta muito mais organizado e responsivo, mas ainda nao implementa docking livre nem serializacao rica de layouts por workspace; por enquanto, a baseline canonica e de presets/contexto, nao de window manager completo.
- Auditoria residual de UX, com prioridade para revalidar o fluxo de autoria pos-hotfix (cena vazia -> sprite inicial -> inspector -> build), o caminho `Novo Projeto -> Build & Run` no Mega Drive e no SNES apos os ajustes de persistencia/schema, a nova UX de import SGDK (meta-sprites, zoom, hierarquia, asset tree, onboarding, warnings) e as superficies ainda `Experimental` (`VRAM Viewer`, `Reverse Explorer`, `Asset Extractor`, `RetroFX`, `ArtStudio`) antes de transformar o release candidate em beta institucional.

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
- Observacao operacional (2026-03-27): nao ha mais itens `[ ]` remanescentes dentro desta fase no roadmap; o proximo trabalho real segue em hardening/QA e nas superficies `Experimental`.

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
- [x] RetroFX visual-first com lista de camadas, preview animado e controles pedagogicos no editor.
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
- [x] Schema migration chain ate `1.6.0` com suporte explicito para `collision_map`, `layers` e `display_name`, mantendo warning para projetos mais novos que o app.
- [x] Compliance de patches com aviso legal, bloqueio de export de ROM completa e auditoria em `project.rds`.

---

## FASE 5 - RELEASE
**Status:** RELEASE CANDIDATE / BETA TESTING

- [x] Windows MSI packaging validado localmente.
- [x] Onboarding de primeiro uso com template funcional.
- [x] Configuracao placeholder de updater com endpoint e pubkey placeholder.
- [x] Runtime real de auto-update: `tauri-plugin-updater = "2"` integrado (`Cargo.toml` + `lib.rs`). Endpoint/pubkey ainda placeholder, sem UI de update.
- **Decisao MVP (2026-03-22):** Auto-updater completo (endpoint real, UI de update, pubkey de producao) **deferido para pos-MVP**. O crate `tauri-plugin-updater` permanece no `Cargo.toml` como placeholder funcional, mas nenhum trabalho adicional sera investido nesta area ate o MVP ser fechado e a dependencia ser aprovada formalmente sob a politica de stack (`docs/02_TECH_STACK.md`).

---

## ONDAS M-R (ESTADO REAL)

- Wave M - concluida (`c5aeae4`, `6a64a9a`, `d04b9d5`, `3bccffc`, `64e5f8f`, `71d227e`)
- Wave N - concluida (`a5e9a01`, `27e9375`, `31e5e4a`, `0d8db6b`)
- Wave O - concluida (`6272eda`, `5520c5b`, `b765796`, `9bdaa48`)
- Wave P - concluida (`8fb9d25`, `738b898`, `23977f1`)
- Wave Q - concluida (`ac4a4f5`, `f46e4a8`, `733f75f`)
- Wave R - concluida em release candidate, com updater ainda placeholder (`a7f6529`, `7c3e84d`, `1f012bd`)

## ONDAS S1-S3 (ESTADO REAL)

- Wave S1 - concluida e validada localmente (`63b0bac`, `14a1d6d`, `7257031`, `e177cc8`, `0ecc6fc`, `9d56f68`)
- Wave S2 - concluida e validada localmente (`a0eaf04`, `d70a9e6`, `4a059a1`)
- Wave S3 - concluida e validada localmente (`4a059a1`, `f978a18`)

## UX SGDK IMPORT (ESTADO REAL)

- Meta-sprites (PROMPT 1) - concluida: campo `meta_sprite` em `SpriteComponent`, bypass de limite simples nos profiles, importador marca sprites >32px
- Viewport sprites (PROMPT 2) - concluida: caminho existente ja resolve via NTFS junctions, sem mudanca necessaria
- Hierarquia por tipo (PROMPT 3) - concluida: agrupamento camera/sprite/tilemap/audio/object com headers collapsiveis
- Warnings SGDK (PROMPT 4) - concluida: VRAM overflow vira warning com `[SGDK Gerenciado]` para projetos `external_sgdk`
- Asset Browser tree (PROMPT 5) - concluida: navegacao hierarquica, toggle tree/grid, thumbnail, botao Instanciar
- Zoom viewport (PROMPT 6) - concluida: Ctrl+Scroll, +/-, Ctrl+0, 0.25x-4.0x, canvas CSS scaling
- Onboarding SGDK (PROMPT 7) - concluida: toast dismissivel para projetos importados, persistido em localStorage
- Camera errors (PROMPT 8) - concluida: guards para 0×0 sprites em ambos os profiles

## IMPORT MUGEN (ESTADO REAL)

- Fluxo canonico de importacao - implementado em codigo: `import_mugen_project` no backend + comando Tauri + botao dedicado no wizard
- Cobertura funcional atual - experimental: personagem, stage e screenpack com assets reais, `AIR`/animacao, audio conservador e fallback para `work/*_sff`
- Fora de escopo desta wave - explicito: conversao total de `CMD/CNS` e paridade completa de gameplay com engines MUGEN/SGDK de luta

## IMPORTADORES EXTERNOS (ESTADO REAL)

- Registry comum de adapters - implementado em codigo: `list_external_import_profiles` expoe perfis com `support_status`, niveis `L1-L4`, target recomendado e importabilidade real
- Wizard/IPC generico - implementado em codigo: `Importar Externo` usa `import_external_project` como rota unica para adapters suportados, sem proliferar fluxos paralelos na UI
- `Ikemen GO` - experimental: tratado como extensao do dominio MUGEN, reutilizando o adapter conservador de `DEF`/`AIR` sem abrir um pipeline separado
- `Godot 2D` - experimental: importa `Sprite2D`, `Camera2D`, `AudioStreamPlayer`/`AudioStreamPlayer2D`, assets reais e metadata de proveniencia; `AnimatedSprite2D`, `TileMap`, `TileMapLayer` e `GDScript` seguem fora de escopo nesta wave
- `GameMaker Studio 2`, `Construct`, `RPG Maker`, `Unity 2D` e `Paper2D bridge` - presentes apenas na matriz de suporte como planejamento honesto; ainda nao possuem adapter canonico importavel

## ONDA 1 — PAINT/ERASE + PALETA CONTEXTUAL (ESTADO REAL)

- EditorMode cleanup - concluida: removido `fill` do union type, simplificado para `select | paint | erase`
- Paleta real por tipo - concluida: `ContextualPalette` consome `listProjectAssets()`, agrupa por sprites/prefabs/tilemaps/audio/other, thumbnails reais, secoes collapsiveis
- Paint com entidade completa - concluida: usa `createSpriteEntityFromAsset()` com sprite dimensionado, ID unico, persist automatico
- Erase com persist - concluida: `persistActiveScene()` apos remocao
- Guard pre-paint - concluida: verifica sprite count vs limite de hardware antes de instanciar
- Cursor contextual - concluida: cursor muda por modo (copy/not-allowed/pointer/crosshair/grabbing)
- Atalhos V/B/E - concluida: alternancia de modo por teclado no scene tab
- Type safety - concluida: `as any` removido do floating toolbar e da ContextualPalette
- Testes - concluida: 10 novos testes para setEditorMode e setActiveBrush
- Validacao: tsc limpo, 139 testes frontend, lint limpo

## SPRINT 1 — INSPECTOR SLIDERS (ESTADO REAL)

- LogicVariableSlider - concluida: slider range/step por variavel `int`/`uint` no InspectorPanel com feedback visual
- Entity header badge - concluida: badge de contagem de variaveis no cabecalho de entidade
- Validacao: tsc limpo, lint limpo, todos os gates verdes

## SPRINT 2 — COLLISION MAP — PILAR 2 (ESTADO REAL)

- CollisionMap struct Rust - concluida: `CollisionMap { width, height, data: Vec<u8> }` em `entities.rs`, validacao MD/SNES, schema bumped `1.3.0 -> 1.4.0`
- Emitters SGDK/SNES - concluidas: `emit_sgdk_with_collision` / `emit_snes_with_collision` emitem `static const u8 rds_collision_map[]`
- EditorMode collision - concluida: `"collision"` adicionado ao union, `updateCollisionMap` com auto-init
- Viewport overlay - concluida: overlay vermelho semi-transparente (alpha 0.35), pintura por click/drag, atalho `C`, cursor highlight
- Validacao: 167 testes Rust, 139 testes frontend, todos os 6 gates verdes (commit `8abf999`)

## SPRINT 3 — LAYER SYSTEM (PILAR 1) + AUTO-UPDATE (ESTADO REAL)

- SceneLayer Rust - concluida: `SceneLayer { id, name, kind, visible, locked, depth, entity_ids }` em `entities.rs`, campo `layers: Option<Vec<SceneLayer>>` em `Scene`, schema bumped `1.4.0 -> 1.5.0`, `layers: None` em todos os literais de teste
- SceneLayer TypeScript - concluida: interface `SceneLayer` em `sceneService.ts`, `layers?: SceneLayer[] | null` em `Scene`
- EditorStore layer actions - concluidas: `activeLayerId`, `createLayer`, `deleteLayer`, `updateLayer`, `assignEntityToLayer`, `setActiveLayerId` em `editorStore.ts`
- LayerPanel UI - concluida: `src/components/hierarchy/LayerPanel.tsx` (277 linhas) com lista de camadas, criar/deletar, toggle visible/locked, renomear inline, atribuir entidade selecionada
- App.tsx tabs - concluida: tabs `Cena|Camadas` no aside esquerdo com `useState<"scene" | "layers">`
- Viewport visibility filter - concluido: entidades em camadas com `visible=false` sao omitidas do canvas (set `hiddenByLayer` antes do forEach)
- tauri-plugin-updater - concluido: `tauri-plugin-updater = "2"` em `Cargo.toml`, plugin registrado em `lib.rs`
- Testes layer actions - concluidos: 12 novos testes para `createLayer`, `deleteLayer`, `updateLayer`, `assignEntityToLayer` em `editorStore.test.ts`
- Validacao: 167 testes Rust, 151 testes frontend (+12), todos os 6 gates verdes

## ONDA 2 — DRAG-TO-PAINT/ERASE + BRUSH GHOST + UX POLISH (ESTADO REAL)

- Drag-to-paint - concluida: arrastar em paint mode stampa sprites continuamente com grid-cell dedup via `paintDragRef`, undo grouping e batch persist
- Drag-to-erase - concluida: arrastar em erase mode remove entidades com dedup via `eraseDragRef`, undo grouping e batch persist
- Brush ghost preview - concluida: retangulo semi-transparente `#89b4fa` com borda dashed na posicao do mouse, dimensoes via `constrainSpriteFrameSize()`
- Escape - concluida: limpa brush e retorna ao select mode
- Status bar contextual - concluida: mostra modo/brush info quando fora do select mode
- Validacao: tsc limpo, 139 testes frontend, lint limpo

---

## Ordem Executiva Atual

1. Manter o baseline canonico verde antes e depois de qualquer ajuste relevante.
2. Gerar `release-readiness.md` a cada rodada de promocao RC -> beta/producao para consolidar baseline, artefatos, dirty worktree e QA manual pendente.
3. Repetir bundle MSI e smoke desktop em host Windows institucional para mudancas sensiveis de build, emulacao, packaging, onboarding, templates e projeto.
4. Executar QA com leigos na nova galeria: `Projeto Vazio`, `Primeiro Projeto`, `Plataforma` e `Importar Projeto SGDK`, confirmando que preview visual, labels PT-BR e cards reduzem a friccao do primeiro uso.
5. Validar manualmente `platformer_seed` e pelo menos um projeto SGDK importado genericamente em `Build & Run` Mega Drive, preservando compliance e sem reintroduzir artefatos proibidos.
6. Planejar a proxima onda de templates/presets com foco em comportamento composto, ja que o suporte a meta-sprites agora existe no validador e no importador SGDK.
7. Decidir se a dependencia `tauri-plugin-updater` pode ser aprovada sob a politica atual e preparar release notes/checklist de beta testing antes de promover o release candidate.

---

## ROADMAP OPERACIONAL TRIMESTRAL — Q2 2026

**Janela:** abril -> junho de 2026
**Objetivo do trimestre:** consolidar o core real do produto, reduzir risco institucional, melhorar UX do shell/autoria diaria e elevar apenas as superficies experimentais com melhor custo/beneficio, sem abrir frentes de alto risco antes da hora.

### Owners sugeridos

- `Infra/Release`: CI, build, MSI, readiness, host Windows limpo
- `Core/Desktop`: shell, viewport, inspector, scene flow, editor
- `Backend/Toolchain`: Rust core, build orchestration, fixtures, importadores
- `UX/Product`: onboarding, ergonomia, densidade visual, narrativa de produto
- `Tools/Experimental`: ArtStudio, RetroFX, Reverse, Asset Extractor
- `QA/Validation`: desktop E2E, QA RC, reports, beta criteria

### Ordem operacional do trimestre

| Ordem | Janela | Frente | Owner sugerido | Dependencias | Risco | Gate de aceite |
|------|--------|--------|----------------|--------------|-------|----------------|
| 1 | Semana 1-2 | Preservacao institucional do core | Infra/Release + QA/Validation | Nenhuma | Alto | `npm run release:readiness:promotion` verde em worktree limpo, com `desktop E2E`, `qa-rc`, `build:debug` e `validate-upstream-windows` verdes |
| 2 | Semana 1-3 | Fixtures BYOR-safe e host limpo | Backend/Toolchain | 1 | Alto | Nenhum teste relevante depende de corpus local oculto, `build/` versionado ou ROM comercial; baseline verde em clone limpo |
| 3 | Semana 2-4 | Hardening de build/release | Infra/Release + Backend/Toolchain | 1, 2 | Alto | `build-report.json` continua fresh-only, MSI reprodutivel, `validate-upstream-windows` repetivel e sem falso-verde conhecido |
| 4 | Semana 3-5 | Performance do shell | Core/Desktop | 1 | Medio | Reducao mensuravel do chunk principal sem regressao em `App.test.tsx`, `qa-rc` ou `desktop-e2e` |
| 5 | Semana 4-6 | Reducao de densidade do shell | UX/Product + Core/Desktop | 4 | Medio | Shell mais legivel, onboarding mais claro e nenhuma perda de acesso ao fluxo core |
| 6 | Semana 5-7 | Onboarding e primeiro sucesso do usuario | UX/Product + Core/Desktop | 5 | Medio | Usuario leigo consegue `criar -> editar -> build -> rodar` sem ambiguidade recorrente |
| 7 | Semana 6-8 | Autoria diaria: inspector, layers, asset browser, scene flow | Core/Desktop | 5, 6 | Medio | Fluxo principal de edicao mais rapido, previsivel e sem regressao de persistencia/build |
| 8 | Semana 7-9 | Import SGDK: robustez para casos reais | Backend/Toolchain + Core/Desktop | 2, 7 | Medio/Alto | Projeto legado real abre, navega, builda e roda sem destruir o host original |
| 9 | Semana 8-10 | NodeGraph: usabilidade para gameplay comum | Core/Desktop + Backend/Toolchain | 7 | Medio | Casos comuns de logica ficam mais acessiveis sem quebrar o emitter SGDK/SNES |
| 10 | Semana 9-11 | ArtStudio: de experimental forte para beta tecnica real | Tools/Experimental + Backend/Toolchain | 2, 7 | Medio | `ArtStudio -> cena -> build -> runtime` provado em rodada institucional |
| 11 | Semana 10-12 | RetroFX: estabilizacao do editor visual-first | Tools/Experimental | 7 | Medio | Configuracao persistida chega ao runtime em casos reais, com docs e UI honestas |
| 12 | Semana 10-12 | Reverse Workspace: consolidacao minima util | Tools/Experimental | 2 | Medio | Manifesto, disassembly, xrefs e anotacoes operam com UX tecnica coerente e sem claim inflada |
| 13 | Semana 12 | Fechamento do trimestre e decisao de Q3 | Infra/Release + UX/Product + QA/Validation | 1-12 | Alto | Maturidade reavaliada, docs canonicas alinhadas e ordem do proximo trimestre definida sem wishful thinking |

### Itens explicitamente fora de Q2 2026

- Docking livre completo como default
- Auto-updater final de producao
- Importador MUGEN com conversao ampla de gameplay
- Novos adapters grandes (`GameMaker Studio 2`, `Construct`, `RPG Maker`, `Unity 2D`, `Paper2D bridge`)
- Expansao de escopo visual que concorra com o hardening do fluxo core

### Regra de governanca do trimestre

- Nenhuma frente `Experimental` sobe de maturidade sem prova canônica correspondente.
- Nenhuma melhoria visual justifica regressao do caminho `Build -> ROM -> Emulacao`.
- Nenhum owner deve abrir frente nova sem fechar o risco da frente anterior de mesma prioridade.
- Qualquer claim de conclusao em Q2 exige: gates aplicaveis verdes, docs coerentes, ausencia de erro bloqueante no escopo e evidencia real do fluxo afetado.

---

## Regra de Atualizacao

- Marque `[x]` apenas quando houver codigo funcional e validacao correspondente.
- Nao use `[x]` para simular progresso quando a prova ainda for mock, stub, output parcial ou fluxo paralelo ao canonico.
- Se a validacao ja ocorreu, mas ainda depender de repeticao institucional ou cobertura adicional, marque como hardening e nao como totalmente encerrada.
- Se houver erro bloqueante conhecido, regressao aberta ou evidencia insuficiente, rebaixe o status em vez de manter claim otimista.
- Sempre atualize este arquivo junto de `06_AI_MEMORY_BANK.md` quando o status do produto mudar.
