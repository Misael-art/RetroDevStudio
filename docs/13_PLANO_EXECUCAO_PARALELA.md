# 13 — Plano de execução paralela e comparação de desenvolvimento

Status: coordenação operacional autorizada em 2026-09-06. Subordinado ao Memory Bank, roadmap e Agent Dev Mode. Não cria matriz concorrente de maturidade, não autoriza fases futuras e não declara release pronta.

## Documentos de entrada

- [Baseline histórica de 2026-09-06](AVALIACAO_DESENVOLVIMENTO_2026_09_06.md)
- [Prompt Integrador](PROMPT_AGENTE_INTEGRADOR.md)
- [Prompt A — compilação e semântica](PROMPT_AGENTE_A.md)
- [Prompt B — runtime e evidências](PROMPT_AGENTE_B.md)
- [Prompt C — UI e QA delimitado](PROMPT_AGENTE_C.md)

## Como iniciar

Abrir os quatro prompts em sessões distintas. O integrador começa escolhendo e verificando a base; A/B/C podem ler e diagnosticar em paralelo desde o início. Edição de produto somente depois do ticket de liberação do integrador e do host READY. Sem ticket, produzir achados e proposta de menor fatia, sem disputar arquivos. Não é necessário esperar resposta para continuar leitura independente.

A primeira onda trata do hardening existente. Importadores amplos, debugger por node e novas superfícies não entram automaticamente. Windows congelado continua pendente até mudança explícita da decisão do operador.

## Ownership e dependências

| Responsável | Área exclusiva candidata, sujeita ao ticket | Não editar por conta própria |
| --- | --- | --- |
| Integrador | docs canônicos, integração e contratos compartilhados | Não modificar arquivos reservados a A/B/C durante sua execução |
| A | src-tauri/src/compiler/**; src/core/nodegraph/**, exceto legado sem necessidade comprovada | emulator/**, shell, store, IPC e UGDM compartilhados sem contrato integrado |
| B | src-tauri/src/emulator/**; src-tauri/src/core/parity_harness.rs; src-tauri/src/tools/deep_profiler.rs | compiler/**, UI, schema/IPC compartilhado e reverse/** sem reserva |
| C | Componentes e testes isolados explicitamente listados no ticket | App.tsx, ViewportPanel.tsx, NodeGraphEditor.tsx, InspectorPanel.tsx, ToolsPanel.tsx e ArtStudioPanel.tsx inteiros sem reserva exclusiva |

Arquivos compartilhados reservados ao integrador: `src/App.tsx`, `src/core/store/editorStore.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/core/project_mgr.rs`, `src-tauri/src/ugdm/**`, contratos IPC, manifests/locks, scripts de host/CI e documentação canônica. O integrador pode delegar um arquivo integral por ticket, retirando sua própria permissão de edição enquanto a reserva estiver ativa. Testes seguem o dono do arquivo de produção. Mudanças necessárias fora da allowlist são propostas com assinatura/semântica e teste esperado, não aplicadas silenciosamente.

Ordem: base/host → contratos mínimos integrados → A e B e C em arquivos distintos → integração por fatia → QA do destino. Não exigir que A aguarde instrumentação avançada de B para provar geração de ROM; B usa ROM de teste permitida/projeto gerado e C usa contratos existentes. Contratos novos entram antes de seus consumidores.

## Ticket de liberação obrigatório

O integrador registra no Current Wave, em bloco por rodada:

```text
Rodada / objetivo / IDs de baseline:
Base SHA completo / branch destino:
Agente / branch codex/... / worktree absoluto externo à raiz:
Arquivos permitidos (lista exata) / arquivos reservados a outros:
Comportamento antes → depois / fora do escopo:
Contratos já integrados / dependências pendentes:
Host fingerprint / lock digest / READY:
Projeto/corpus permitido / diretório de evidências / janela exclusiva de certificação:
Testes de aceitação / gates aplicáveis:
Status operacional: PROPOSTO | LIBERADO | EM_EXECUCAO | BLOQUEADO | EM_REVISAO | INTEGRADO
```

Estado inicial deste plano: nenhuma rodada de código liberada, nenhuma reserva ativa e nenhum agente lançado por esta sessão documental. Tickets atualizados ficam no Current Wave, evitando um segundo diário mutável.

## Isolamento

- Um worktree/branch por agente criado de SHA explícito; diretórios fora da raiz fiscalizada. Não remover worktrees antigos sem verificar status, integração e preservar alterações.
- Targets/caches graváveis de build por worktree quando necessário, em filesystem nativo; não redirecionar fora das convenções do host-manager nem alterar variáveis globais do usuário.
- Provisionamento e certificação oficial serializados pelo integrador no mesmo host. Não compartilhar sessão do emulador, porta WebDriver, projeto gravável de teste ou report mutável entre agentes.
- Não afrouxar check:tree, CSP, checksums, testes ou guards de revisão para produzir verde.
- Preservar alterações alheias, corpus BYOR externo e origem imutável/SHA-256 de artefatos.
- Um PR por fatia; sem mega-refatoração prévia. Integrar contratos antes dos consumidores; executar gates de novo no destino, no SHA final.
- Publicação Git segue docs/09 e autorização da sessão. Nunca declarar push/merge feito sem sucesso verificável; gates bloqueados impedem anunciar entrega certificada.

## Validação

Para código: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.

Build/runtime/host/toolchains exigem `npm run host:certify`, upstream oficial e E2E aplicável. Dependências/segurança exigem auditorias e inventário conforme docs/07. Não substituir teste oficial ignorado por mock nem contar teste pulado como aprovado. Certificação final respeita Windows e Linux no mesmo commit/lock e as restrições de release existentes.

Mudanças exclusivamente documentais: verificar links, diff, consistência com fontes canônicas e estrutura. Não apresentar esse resultado como certificação de produto. Falhas preexistentes devem ser registradas sem limpeza destrutiva.

## Handoff de cada agente

Entregar: ID/ticket, base e HEAD, arquivos alterados, comportamento antes/depois, IDs de baseline afetados, comandos/exit codes/contagens e skips, prova real versus mock, caminhos e SHA-256 das evidências duráveis, host/lock, riscos, bloqueios e próximo passo exato. Propostas para docs canônicos são enviadas ao integrador; A/B/C não editam simultaneamente o Memory Bank.

## Comparação entre rodadas

Ao integrar cada fatia e no fechamento de cada janela do cronograma, o integrador adiciona no Current Wave uma tabela com este formato. Preservar o histórico; atualizar roadmap apenas quando a certificação justificar.

| ID baseline | SHA anterior → SHA novo | Cenário/target/core e versão | Antes → depois | Resultado | Evidência durável + SHA-256 | Limites/regressões | Responsável |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NODE-01 (exemplo de formato; não resultado) | preencher | preencher | preencher | NÃO MEDIDO | preencher | preencher | A |

Resultado comparativo: MELHOROU, SEM_MUDANÇA, REGREDIU ou NÃO_MEDIDO. Só comparar medidas com cenário, inputs, ROM, target/core/versão e condições conhecidos. Quando código/ROM mudarem, registrar ambos os hashes e justificar a comparação; hashes binários diferentes não significam gameplay diferente. Tempo de build/FPS/memória exigem mesma metodologia, amostra e ambiente comparável.

Métricas úteis: cenários reais aprovados/total definido por capacidade; erros de perda de dados; gaps bloqueantes por subset; importações idempotentes; regressões abertas/fechadas; tempo e memória quando medidos; instalação/reabertura comprovadas. Contagens de testes, commits e LOC são contexto, não percentual de produto concluído.

Não versionar ROM comercial ou binários de terceiros. Relatórios gerados ignorados devem ter resumo durável no Current Wave e referência de artefato com retenção conhecida; um caminho temporário sozinho não preserva evidência.
