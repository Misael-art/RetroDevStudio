# Avaliação de desenvolvimento — baseline de 2026-09-06

Status: referência histórica e planejamento; não substitui o Memory Bank nem a matriz de maturidade do roadmap. Preservar este snapshot. Correções posteriores devem ser adicionadas com data e motivo, sem apagar a observação original.

## Origem e limites

Avaliação solicitada pelo usuário em 2026-09-06, seguida de autorização para registrá-la e preparar quatro agentes paralelos. Base inspecionada: `0c245386c2f1144ad4458b4f0c95c0f9d2f997b5`, branch `convergence/reproducibility`, checkout `/mnt/sdcard/Projects/RetroDevStudio`. O SHA identifica o código avaliado, não o futuro commit documental.

Método: leitura da documentação canônica, PRD e inspeção estática dos caminhos principais. Não houve certificação funcional completa, suíte completa ou consulta atual ao CI remoto. Evidências históricas de Windows/Linux não foram repetidas nesta avaliação. Nenhuma função foi promovida, nenhuma decisão arquitetural consolidada foi alterada e não houve mudança de código de produto.

## Observações reproduzidas

| ID | Observação em 2026-09-06 | Fonte e método | Implicação |
| --- | --- | --- | --- |
| ENV-01 | Host `DRIFTED`; jdk21 incompatível, ghidra/m68k_gcc/sgdk/pvsneslib/libretro_snes ausentes, libretro_md incompatível | `npm run host:diagnose`, exit 10 | Não certificar Build → ROM → Emulação neste ambiente |
| ENV-02 | Bootstrap full encerrou com exit 1, exigindo autenticação sudo | `bash scripts/bootstrap.sh --ensure --profile full` | Reparo administrativo pendente; não contornar autenticação |
| GOV-01 | check:tree falhou por `.codex`, `.omo`, `.worktrees` na raiz | `npm run check:tree`, exit 1 | Preservar trabalhos e recuperar estrutura sem afrouxar gate |
| GOV-02 | 12 worktrees registrados; HEAD 58 commits à frente e 0 atrás do main local | `git worktree list`; `git rev-list --left-right --count main...HEAD` = `0 58` | Auditar convergência; não inferir situação do remoto |
| NODE-01 | Trace local simulado; resolução de runtime retorna unsupported_runtime_mapping | `src/core/nodegraph/nodeEngine.ts`, `resolveRuntimeEvidenceForGraph` | Proveniência de build não prova execução de node na ROM |
| IMP-01 | Bridges GML preservam lógica sem executá-la automaticamente no SGDK | `src-tauri/src/core/gml_to_nodes.rs`, `convert_generic_bridge_graph` | Importação estrutural não comprova equivalência comportamental |
| RUN-01 | Trace depende de adapter; API Libretro padrão não fornece o PC pretendido neste caminho | `src-tauri/src/emulator/libretro_ffi.rs`, `RuntimeExecutionTraceCapture` | Instrumentação demanda trabalho especializado |
| SAVE-01 | Save state em memória existe; observação de SRAM não certifica persistência em disco | `libretro_ffi.rs`, `save_state` e observação de RETRO_MEMORY_SAVE_RAM | Testar reinicialização e durabilidade separadamente |
| PROF-01 | Profiler estático estima SAT e DMA sem executar ROM | `src-tauri/src/tools/deep_profiler.rs`, `profile_bytes` | Não apresentar estimativas como medidas dinâmicas |
| PROF-02 | dma_per_frame usa min(MD_DMA_VBLANK_BYTES) antes de comparar > mesmo limite | `deep_profiler.rs`, cálculo de DMA | Condição de overflow inalcançável por inspeção; reproduzir com regressão antes de corrigir |
| PAR-01 | Harness exclui áudio exato, ciclos M68K/Z80, scanlines VDP e timing DMA | `src-tauri/src/core/parity_harness.rs`, `not_measured_default` | Hashes de frames/estado não provam equivalência universal |
| REL-01 | Documentação registra Windows congelado/pendente e requisitos de distribuição não fechados | `docs/11_CROSS_PLATFORM_PLAN.md` e Memory Bank | Dependência documental; verificar estado atual antes de agir |

Fingerprint observado: `82f39923d69557b647ed3a4ec5053ce67885ac125ee79666116d03d5968fff5a`. Lock digest: `d531c4b9617af47108819d965b7cb58db1e2780a5f8a9edead08668870f5bb5d`. Report gerado: `src-tauri/target-test/validation/host-readiness.json` (mutável; os valores acima preservam a fotografia textual).

## Risco de edição concorrente

Contagem `wc -l` no checkout, incluindo testes embutidos quando presentes; não é métrica isolada de qualidade.

| Arquivo | Linhas |
| --- | ---: |
| src-tauri/src/core/project_mgr.rs | 24404 |
| src-tauri/src/compiler/ast_generator.rs | 5344 |
| src/App.tsx | 5217 |
| src-tauri/src/compiler/build_orch.rs | 4967 |
| src/components/artstudio/ArtStudioPanel.tsx | 4281 |
| src/components/nodegraph/NodeGraphEditor.tsx | 3315 |
| src/components/tools/ToolsPanel.tsx | 2795 |
| src-tauri/src/emulator/libretro_ffi.rs | 2166 |
| src/core/store/editorStore.ts | 1142 |

## Frentes e capacidade necessária

1. Alta capacidade: semântica NodeGraph → UGDM/IR → emitters → ROM; integridade e migração de projetos; runtime/FFI; medição dinâmica; importação com preservação de comportamento.
2. Alta capacidade com pesquisa delimitada: equivalência entre runtimes e engenharia reversa. Decompilação pareada continua sujeita ao GO formal do roadmap; este plano não a autoriza.
3. Menor/intermediária: textos, acessibilidade, componentes isolados, fixtures delimitadas, regressões de bugs especificados e documentação de fluxos certificados.
4. Escalonar tarefas inicialmente simples quando passarem a envolver schema, perda de dados, concorrência, compilação, FFI, dependências ou arquivos centrais de outro responsável.

## Cronograma estimativo, não compromisso

Hipótese: três frentes de implementação, integrador/revisor e hosts oficiais disponíveis. Semanas relativas ao início efetivo após desbloqueios. Reestimar ao fim das primeiras duas semanas. Não autoriza antecipar fases do roadmap.

| Janela | Trabalho complexo | Trabalho simples paralelo | Saída exigida |
| --- | --- | --- | --- |
| 1–2 | Convergência, host, base e contratos | Inventário de ações, evidências e UX | Base conhecida, ownership e baseline reproduzível |
| 3–6 | Criar/salvar/reabrir/build/run e contratos de compilação | Onboarding, acessibilidade e regressões | Jogo representativo salvo, reaberto e executado |
| 7–12 | Semântica dos nodes, assets, áudio e saves MD/SNES | QA ArtStudio/RetroFX e fixtures | Fatias verticais certificadas por target |
| 13–18 | Um importador prioritário com subset definido e diagnóstico/replay necessário | Corpus e documentação | Compatibilidade demonstrada e perdas explícitas |
| 19–24 | Estabilidade, instalação limpa e distribuição | QA de instalação e tutoriais | Candidato certificado no mesmo commit |
| 25–28 | Reserva para integração e bloqueios | Regressão direcionada | Defeitos impeditivos fechados |

Faixa original: 20–28 semanas para produto delimitado, aproveitando código existente. Não cobre todas as promessas do PRD. Instrumentação profunda, importadores amplos e reconstrução exigem trimestres adicionais e reestimativa por prova técnica; não há data confiável para conversão universal.

## Critério de produto

Ação do usuário → persistência → processamento real → resultado observável → reabertura/repetição → erro tratado. Cada capacidade anunciada precisa de evidência correspondente. Testes unitários e framebuffer não preto são evidências úteis, mas insuficientes para certificar gameplay, áudio, saves ou equivalência completos.

## Comparações futuras

Usar os IDs acima e o protocolo em [13_PLANO_EXECUCAO_PARALELA.md](13_PLANO_EXECUCAO_PARALELA.md). Registrar deltas no Current Wave com SHA, host, cenário e evidências; a maturidade oficial continua exclusivamente no roadmap. Não calcular percentual global de conclusão pelo número de arquivos, commits, testes ou linhas. Ausência de execução significa NÃO MEDIDO, não regressão nem aprovação.
