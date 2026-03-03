# 09 - AGENT DEV MODE & QUALITY GATES
**Status:** Canonico
**Objetivo:** Consolidar a hierarquia de verdade, os gates de entrega, a matriz de maturidade e as regras anti-poluicao do projeto.

> Este documento nao substitui o `Memory Bank` como fonte de estado atual.
> Ele codifica como agentes e humanos devem trabalhar para que o projeto nao acumule duplicacoes, informativos falsos, fakes, gambiarras e regressao silenciosa.

---

## 1. HIERARQUIA DE VERDADE

| Ordem | Fonte | Resolve o que |
|------|-------|---------------|
| 1 | `docs/06_AI_MEMORY_BANK.md` | Estado operacional real, prioridade imediata e conflitos de sessao |
| 2 | `docs/03_ROADMAP_MVP.md` | Escopo do produto e fase vigente |
| 3 | `docs/09_AGENT_DEV_MODE.md` | Regras de processo, gates e anti-poluicao |
| 4 | `docs/08_TREE_ARCHITECTURE.md` | Onde arquivos e diretorios devem existir |
| 5 | `docs/02_TECH_STACK.md` | Tecnologias e ferramentas aprovadas |
| 6 | `docs/07_TEST_AND_COMPLIANCE.md` | Compliance, validacao minima e barra de entrega |
| 7 | `README.md` / `CLAUDE.md` | Onboarding resumido, sem autoridade sobre estado real |

**Regra pratica**
- Se uma fonte inferior contradizer uma superior, a fonte superior vence.
- Se a divergencia for detectada durante a tarefa, o agente deve corrigi-la na mesma sessao.
- Nenhum agente pode usar onboarding desatualizado como justificativa para estado falso do produto.

---

## 2. MODO OBRIGATORIO DE EXECUCAO

1. Ler `docs/06_AI_MEMORY_BANK.md`.
2. Ler `docs/03_ROADMAP_MVP.md`.
3. Ler `docs/08_TREE_ARCHITECTURE.md` antes de criar ou mover arquivos.
4. Ler `docs/02_TECH_STACK.md` antes de adicionar dependencia ou ferramenta.
5. Ler `docs/07_TEST_AND_COMPLIANCE.md` ao tocar build, emulacao, toolchains, ROMs ou entrega.
6. Responder com `[Contexto Carregado]` e um plano antes de escrever codigo relevante.
7. Implementar no caminho canonico existente, nao em um paralelo.
8. Rodar os gates aplicaveis.
9. Atualizar docs canonicos se o estado real mudou.

Uma tarefa nao esta concluida enquanto o repositorio continuar anunciando um estado mais maduro do que o codigo e os gates sustentam.

---

## 3. GATES NAO NEGOCIAVEIS

### 3.1 Baseline minimo local e CI
- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy -- -D warnings`
- `cargo test --lib -- --nocapture`

### 3.2 Gates extras quando a mudanca toca o core
- Reexecutar `scripts/validate-upstream-windows.ps1` quando a mudanca tocar build/emulacao de Mega Drive ou SNES com toolchains oficiais no Windows.
- Confirmar shell Unix-like suportado quando a mudanca tocar o caminho SNES de Windows.
- Revalidar com cores Libretro oficiais quando a mudanca tocar carga de ROM ou selecao de core.
- Reexecutar o runner desktop `scripts/e2e-tauri-build-run.mjs` quando a mudanca tocar o fluxo `Build -> Load ROM -> Run frames` do app como um todo.
- Preferir o workflow dedicado `.github/workflows/desktop-e2e.yml` para repeticao institucional em Windows, seja via `workflow_dispatch`, `workflow_call` ou gatilhos `push`/`pull_request` filtrados por caminho, preservando o `ci.yml` comum como baseline rapido e robusto.

### 3.3 Regra de entrega
- Nao usar termos como `pronto`, `completo`, `fechado`, `MVP concluido` ou `pipeline validado` sem satisfazer os gates correspondentes.
- Superficie parcial deve permanecer marcada como `Experimental` ou equivalente ate o backend e os gates sustentarem o fluxo.

---

## 4. REGRAS ANTI-POLUICAO E ANTI-GAMBIARRA

- Nao criar modulo, store, IPC, pipeline ou emitter duplicado quando ja existe um canonico.
- Nao criar documento paralelo para estado real; use `06_AI_MEMORY_BANK.md` e `03_ROADMAP_MVP.md`.
- Nao manter arquivo, nome, script ou comando obsoleto referenciado pela documentacao.
- Nao adicionar dependencia nova sem aprovacao do usuario e atualizacao de `docs/02_TECH_STACK.md`.
- Nao adicionar gate de CI que nao foi reproduzido localmente.
- Nao esconder falha real atras de `TODO`, `stub`, mock permanente ou texto de marketing.
- Nao deixar UI anunciar sucesso se o backend falhou ou se a persistencia nao ocorreu.
- Nao commitar toolchains de terceiros no repositorio.
- Nao inventar fixtures ou testes que nao exercitam o caminho canonico.

---

## 5. REGRAS DE COESAO E CONSERVACAO FUNCIONAL

- Toda mudanca em `save`, `build`, `run`, `emulator`, `dependency setup` ou `schema` deve preservar o comportamento canonico ou ajustar testes/fixtures na mesma sessao.
- Mudancas em fluxo publico do app devem priorizar o arquivo canonico responsavel em vez de espalhar logica em novos arquivos.
- Se uma mudanca tornar um documento ou comentario falso, ele deve ser corrigido junto.
- Se uma feature nao esta pronta, a UI deve dizer isso explicitamente.
- Se uma refatoracao remove comportamento, o agente deve provar que a perda foi intencional e documentada.

---

## 6. MATRIZ DE MATURIDADE ATUAL (2026-03-03)

Escala:
- `0` inexistente
- `1` scaffold
- `2` prova de conceito
- `3` alpha interna funcional
- `4` beta tecnica / hardening
- `5` pronta para release

| Area | Nota | Leitura objetiva | Gargalo atual |
|------|------|------------------|---------------|
| Infra | 4.5/5 | Base de app, IPC, persistencia, CI e workflow desktop dedicado agora estao validados localmente e em runner GitHub/Windows real | Falta decidir a governanca final do workflow sem perder agilidade |
| Editor | 3.0/5 | Editor funcional para uso interno com persistencia e viewport | Nem toda superficie esta integrada ao pipeline real |
| Build | 4.0/5 | Pipeline real por target com workspace, staging e ROM validado com upstream oficial em Windows | Export ainda simples e SNES continua sensivel a mudancas no workspace |
| Emulacao | 4.2/5 | Libretro FFI real, carga de ROM, input e framebuffer validados com smoke upstream, runner local e workflow GitHub/Windows | Falta apenas preservar esse baseline ao endurecer o processo |
| Toolchains | 4.0/5 | Setup sob demanda real e validado em Windows com SGDK, PVSnesLib e cores Libretro oficiais | Continua dependente de ambiente externo e compliance de licenca |
| UX | 2.5/5 | UI mais honesta e com superficies experimentais rotuladas | Ainda ha polimento e previsibilidade a fechar |
| Testes | 4.9/5 | Baseline forte de testes, smoke upstream oficial, desktop E2E multi-target e workflow dedicado reutilizavel agora validados em runner GitHub/Windows real | Falta apenas calibrar custo/processo do gate remoto sem afrouxar cobertura |

Leitura sintetica:
- O projeto esta acima de simples scaffold ou demo.
- O estado correto e `alpha interna em hardening`, nao `Fase 0`.
- O bloqueio principal nao e mais ausencia de validacao oficial nem de runner remoto; agora e endurecer UX/processo sem diluir o gate conquistado.

---

## 7. CHECKLIST DE FECHAMENTO DE SESSAO

- [ ] O estado real anunciado pelo repositorio continua honesto?
- [ ] Os documentos de onboarding continuam coerentes com o Memory Bank?
- [ ] Os gates aplicaveis foram rodados e passaram?
- [ ] Se algo continua parcial, a UI e a documentacao deixam isso claro?
- [ ] Nao foi criado modulo, script, doc ou fluxo paralelo ao canonico?
- [ ] O Memory Bank precisa ser atualizado?

---

## 8. FALHAS PROCESSUAIS QUE DEVEM GERAR CORRECAO IMEDIATA

1. README ou arquivo de onboarding chamando de concluido algo ainda nao validado.
2. CI verde, mas porque o gate foi afrouxado ou desviado.
3. Feature visivel sem rotulo de parcial/experimental, apesar de backend incompleto.
4. Duplicacao de store, service, pipeline, schema ou documentacao de estado.
5. Dependencia nova adicionada sem justificativa e sem reflexo nos docs canonicos.
6. Mudanca de fluxo publico sem teste, fixture ou prova funcional correspondente.

---

**Regra final**
O projeto deve preferir um estado honesto, testado e coeso a um estado aparentemente mais avancado, mas sustentado por stubs, documentos falsos ou gambiarras.
