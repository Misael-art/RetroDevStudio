# 09 - AGENT DEV MODE & QUALITY GATES
**Status:** Canonico
**Objetivo:** Consolidar a hierarquia de verdade, os gates de entrega e o protocolo que impede drift documental.

> Este documento nao substitui o `Memory Bank` como fonte de estado atual.
> Ele define como humanos e agentes devem trabalhar para que o repositorio nao volte a produzir:
> claims falsos, docs conflitantes, fluxos paralelos e maturidade inflada.

---

## 1. HIERARQUIA DE VERDADE

| Ordem | Fonte | Resolve o que |
|------|-------|---------------|
| 1 | `docs/06_AI_MEMORY_BANK.md` | Estado operacional real, prioridade imediata e conflitos de sessao |
| 2 | `docs/03_ROADMAP_MVP.md` | Escopo do produto, fases e matriz permanente de maturidade |
| 3 | `docs/09_AGENT_DEV_MODE.md` | Regras de processo, sincronizacao documental e gates |
| 4 | `docs/08_TREE_ARCHITECTURE.md` | Onde arquivos e diretorios devem existir |
| 5 | `docs/02_TECH_STACK.md` | Tecnologias e ferramentas aprovadas |
| 6 | `docs/07_TEST_AND_COMPLIANCE.md` | Compliance, validacao minima e barra de entrega |
| 7 | `README.md` / `CLAUDE.md` | Onboarding resumido, sem autoridade sobre estado real |

**Regra pratica**
- Se uma fonte inferior contradizer uma superior, a fonte superior vence.
- Se a divergencia for detectada durante a tarefa, ela deve ser corrigida na mesma sessao.
- Nenhum agente pode usar onboarding desatualizado para justificar estado falso do produto.

### Papel de cada documento canonico

- `docs/06_AI_MEMORY_BANK.md` + `docs/06_CURRENT_WAVE_AI_BANK.md`: diario operacional, evidencias recentes, proximo passo.
- `docs/03_ROADMAP_MVP.md`: matriz central de fases, superficies e importadores.
- `README.md`: onboarding curto e links; nao pode carregar snapshot institucional detalhado.

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
10. Quando a entrega estiver validada com gates verdes e houver mudancas rastreaveis do escopo, criar commit(s) coerentes e executar `git push` no branch atual, salvo instrucao contraria do usuario ou necessidade explicita de curadoria adicional antes da publicacao.

Uma tarefa nao esta concluida enquanto o repositorio continuar anunciando um estado mais maduro do que o codigo e os gates sustentam.
Uma tarefa tambem nao esta concluida enquanto faltar certificacao real no escopo alterado: prova funcional correspondente, gates verdes e ausencia de erro bloqueante ou regressao conhecida naquele fluxo.

---

## 3. PROTOCOLO DE SINCRONIZACAO DOCUMENTAL

### 3.1 Regras obrigatorias

1. Se o estado de uma feature mudar, atualizar `docs/06_CURRENT_WAVE_AI_BANK.md` e `docs/03_ROADMAP_MVP.md` na mesma sessao.
2. Se o onboarding/resumo publico mudar, atualizar `README.md` na mesma sessao.
3. Se surgir nova superficie visivel ou novo importador no codigo, criar linha correspondente na matriz do roadmap antes de qualquer claim de entrega.
4. Um item nao pode continuar descrito como `planejamento` se o codigo o marcar como `importable: true`.
5. Um item nao pode sair de `Experimental` sem evidencia institucional e sem alinhamento de UI, docs e backend.
6. `docs/09_AGENT_DEV_MODE.md` nao deve manter matriz independente de maturidade do produto; a matriz permanente vive em `docs/03_ROADMAP_MVP.md`.

### 3.2 Vocabulario controlado

- `Em codigo`: existe no repositorio.
- `Validado localmente`: ha prova local do fluxo afetado.
- `Validado institucionalmente`: ha evidencia canonica da rodada/host institucional.
- `Em hardening`: existe validacao real, mas o item ainda nao deve ser tratado como fechado.
- `Experimental`: visivel, parcial ou fora do criterio de fechamento.
- `Fora do MVP/Q2`: nao entra no fechamento atual, mesmo que exista algum codigo.

---

## 4. GATES NAO NEGOCIAVEIS

### 4.1 Baseline minimo local e CI

- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy -- -D warnings`
- `cargo test --lib -- --nocapture --test-threads=1`

### 4.2 Gates extras quando a mudanca toca o core

- Reexecutar `scripts/validate-upstream-windows.ps1` quando a mudanca tocar build/emulacao de Mega Drive ou SNES com toolchains oficiais no Windows.
  O modo canonico de execucao e direto: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests`.
  Nao embrulhar esse script com `scripts/run-in-msvc.cmd`, porque ele proprio ja resolve o runner MSVC canonico internamente.
- Confirmar shell Unix-like suportado quando a mudanca tocar o caminho SNES de Windows.
- Revalidar com cores Libretro oficiais quando a mudanca tocar carga de ROM ou selecao de core.
- Reexecutar o runner desktop `scripts/e2e-tauri-build-run.mjs` quando a mudanca tocar o fluxo `Build -> Load ROM -> Run frames` do app como um todo.
- Preferir o workflow dedicado `.github/workflows/desktop-e2e.yml` para repeticao institucional em Windows, seja via `workflow_dispatch`, `workflow_call` ou gatilhos `push`/`pull_request` filtrados por caminho, preservando o `ci.yml` comum como baseline rapido e robusto.

### 4.3 Regra de entrega

- Nao usar termos como `pronto`, `completo`, `fechado`, `MVP concluido` ou `pipeline validado` sem satisfazer os gates correspondentes.
- `Validado` e `concluido` exigem certificacao real, nao so implementacao em codigo ou CI verde.
- Certificacao real, neste projeto, significa ao mesmo tempo:
  - caminho canonico exercitado de verdade
  - gates aplicaveis verdes
  - ausencia de erro bloqueante no escopo certificado
  - nenhuma divergencia entre UI, docs e backend sobre o estado entregue
- Warning so pode coexistir com claim de entrega quando estiver comprovadamente nao-fatal, explicitamente sinalizado e sem mascarar problema real. Se houver duvida, o status correto e `hardening`.
- Superficie parcial deve permanecer marcada como `Experimental` ou equivalente ate o backend e os gates sustentarem o fluxo.

---

## 5. REGRAS ANTI-POLUICAO E ANTI-GAMBIARRA

- Nao criar modulo, store, IPC, pipeline ou emitter duplicado quando ja existe um canonico.
- Nao criar documento paralelo para estado real; use `06_AI_MEMORY_BANK.md` e `03_ROADMAP_MVP.md`.
- Nao manter arquivo, nome, script ou comando obsoleto referenciado pela documentacao.
- Nao adicionar dependencia nova sem aprovacao do usuario e atualizacao de `docs/02_TECH_STACK.md`.
- Nao adicionar gate de CI que nao foi reproduzido localmente.
- Nao esconder falha real atras de `TODO`, `stub`, mock permanente ou texto de marketing.
- Nao tratar mock, stub, fixture artificial ou log de console como prova suficiente de fluxo real.
- Nao deixar UI anunciar sucesso se o backend falhou ou se a persistencia nao ocorreu.
- Nao commitar toolchains de terceiros no repositorio.
- Nao inventar fixtures ou testes que nao exercitam o caminho canonico.

---

## 6. REGRAS DE COESAO E CONSERVACAO FUNCIONAL

- Toda mudanca em `save`, `build`, `run`, `emulator`, `dependency setup` ou `schema` deve preservar o comportamento canonico ou ajustar testes/fixtures na mesma sessao.
- Mudancas em fluxo publico do app devem priorizar o arquivo canonico responsavel em vez de espalhar logica em novos arquivos.
- Se uma mudanca tornar um documento ou comentario falso, ele deve ser corrigido junto.
- Se uma feature nao esta pronta, a UI deve dizer isso explicitamente.
- Se uma refatoracao remove comportamento, o agente deve provar que a perda foi intencional e documentada.

---

## 7. CHECKLIST DE FECHAMENTO DE SESSAO

- [ ] O estado real anunciado pelo repositorio continua honesto?
- [ ] O roadmap central (`docs/03_ROADMAP_MVP.md`) continua coerente com o codigo?
- [ ] O diario operacional (`docs/06_CURRENT_WAVE_AI_BANK.md`) foi atualizado se o estado mudou?
- [ ] O onboarding publico (`README.md`) continua coerente com o roadmap e o Memory Bank?
- [ ] Os gates aplicaveis foram rodados e passaram?
- [ ] Se houve nova superficie visivel ou importador, a matriz do roadmap recebeu a linha correspondente?
- [ ] Existe certificacao real suficiente para qualquer claim de `validado`, `concluido` ou `fechado` feita nesta sessao?
- [ ] Se algo continua parcial, a UI e a documentacao deixam isso claro?
- [ ] Nao foi criado modulo, script, doc ou fluxo paralelo ao canonico?

---

## 8. FALHAS PROCESSUAIS QUE DEVEM GERAR CORRECAO IMEDIATA

1. `README.md` ou arquivo de onboarding chamando de concluido algo ainda nao validado.
2. CI verde, mas porque o gate foi afrouxado ou desviado.
3. Feature visivel sem rotulo de parcial/experimental, apesar de backend incompleto.
4. Duplicacao de store, service, pipeline, schema ou documentacao de estado.
5. Dependencia nova adicionada sem justificativa e sem reflexo nos docs canonicos.
6. Mudanca de fluxo publico sem teste, fixture ou prova funcional correspondente.
7. Claim de `concluido` ou `validado` sustentada apenas por mock, stub, output cosmetico ou teste que nao passa pelo caminho canonico.
8. Item descrito como `planejamento` apesar de o registry real do codigo marca-lo como `importable: true`.
9. Nova superficie visivel no produto sem linha correspondente no roadmap central.

---

**Regra final**
O projeto deve preferir um estado honesto, testado e coeso a um estado aparentemente mais avancado, mas sustentado por stubs, documentos falsos ou gambiarras.
