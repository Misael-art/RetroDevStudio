# 00 - DIRETRIZES PARA AGENTES DE IA (AGNOSTICO)
**Status:** Definitivo
**Objetivo:** Ponto de entrada unico para qualquer agente de IA que atue neste repositorio.

> Este repositorio e editado por multiplas IAs e por humanos.
> O objetivo destas diretrizes e impedir alucinacao, escopo falso, regressao silenciosa, poluicao estrutural e informativo mentiroso de entrega.

---

## 0. HIERARQUIA DE VERDADE

Se dois documentos entrarem em conflito, siga esta ordem:

| Ordem | Fonte | Autoridade |
|------|-------|------------|
| 1 | `docs/06_AI_MEMORY_BANK.md` | Estado operacional real, prioridade atual e restricoes de sessao |
| 2 | `docs/03_ROADMAP_MVP.md` | Escopo e fase vigente do produto |
| 3 | `docs/09_AGENT_DEV_MODE.md` | Modo canonico de desenvolvimento, gates e anti-poluicao |
| 4 | `docs/08_TREE_ARCHITECTURE.md` | Estrutura de arquivos e diretorios |
| 5 | `docs/02_TECH_STACK.md` | Tecnologias aprovadas |
| 6 | `docs/07_TEST_AND_COMPLIANCE.md` | Compliance e barra minima de validacao |
| 7 | `README.md` / `CLAUDE.md` | Onboarding resumido, sem autoridade sobre estado real |

Se um documento de menor prioridade estiver desatualizado, ele deve ser corrigido na mesma sessao que detectar a divergencia.

---

## 1. FLUXO OBRIGATORIO (ANTES DE CODIGO OU DECISOES)

Antes de escrever codigo, criar arquivos, alterar CI ou propor mudancas arquiteturais, execute nesta ordem:

1. Ler `docs/06_AI_MEMORY_BANK.md`.
2. Ler `docs/03_ROADMAP_MVP.md`.
3. Ler `docs/08_TREE_ARCHITECTURE.md` se for criar, mover ou renomear arquivos/pastas.
4. Ler `docs/09_AGENT_DEV_MODE.md` se a tarefa tocar processo, CI, documentacao de estado, multi-agente, governanca ou conflito entre documentos.
5. Consultar `docs/02_TECH_STACK.md` e `docs/07_TEST_AND_COMPLIANCE.md` quando a tarefa tocar stack, build, emulacao, toolchains, compliance ou gates.
6. Responder com `[Contexto Carregado]` e um plano de acao antes de gerar codigo relevante.

**SE VOCE NAO SEGUIR ESTE FLUXO, O TRABALHO DEVE SER TRATADO COMO NAO CONFIAVEL.**

---

## 2. ACOES PROIBIDAS (LISTA DE BLOQUEIO)

Estas acoes sao proibidas. Se acontecerem, o trabalho deve ser rejeitado ou refeito:

| # | Acao proibida | Por que |
|---|---------------|---------|
| 1 | Escrever codigo para fases futuras do roadmap | Cria scope creep e codigo orfao |
| 2 | Inventar APIs, funcoes, binarios ou bibliotecas que nao existem | Gera codigo que nao compila |
| 3 | Usar `malloc()`/`free()` em codigo C gerado | Viola a restricao do runtime/exporter |
| 4 | Usar `Vec::new()` em loop critico de 60 Hz no backend | Pode causar stutter |
| 5 | Adicionar dependencia npm/crate sem aprovacao e sem atualizar `docs/02_TECH_STACK.md` | Quebra governanca do stack |
| 6 | Criar arquivos fora da arvore definida em `docs/08_TREE_ARCHITECTURE.md` | Polui o projeto |
| 7 | Modificar `docs/04_HARDWARE_SPECS.md` | Base imutavel de hardware real |
| 8 | Alterar "Decisoes Arquiteturais Consolidadas" do Memory Bank sem ordem expressa | Quebra acordo do projeto |
| 9 | Gerar, empacotar ou distribuir ROM comercial | Viola compliance |
| 10 | Usar nomes de hardware especifico no UGDM | O UGDM deve permanecer agnostico |
| 11 | Pular a validacao UGDM antes do compilador/exporter | Viola a sequencia canonica |
| 12 | Usar Redux, Electron ou Python no runtime do app | Fora do stack aprovado |
| 13 | Declarar entrega sem rodar os gates minimos aplicaveis | Produz falso positivo de entrega |
| 14 | Manter UI parcial/stub sem rotulo claro de `Experimental` | Engana usuario e equipe |
| 15 | Criar modulo, doc ou fluxo duplicado para evitar integrar o canonico | Aumenta incoerencia e perda de funcao |
| 16 | Adicionar gate no CI que nao foi reproduzido localmente | Gera ruido e falha processual fake |

---

## 3. CHECKLIST PRE-CODIGO

Antes de escrever qualquer linha, valide mentalmente:

- [ ] Li o `06_AI_MEMORY_BANK.md` e sei onde o projeto parou?
- [ ] A tarefa pertence a fase/sprint atual de `03_ROADMAP_MVP.md`?
- [ ] Sei exatamente onde o arquivo deve existir segundo `08_TREE_ARCHITECTURE.md`?
- [ ] As tecnologias que vou usar estao aprovadas em `02_TECH_STACK.md`?
- [ ] Se a tarefa toca processo/CI/documentacao de estado, consultei `09_AGENT_DEV_MODE.md`?
- [ ] Se a tarefa toca build/emulacao/toolchains/legal, consultei `07_TEST_AND_COMPLIANCE.md`?
- [ ] Minha mudanca preserva o caminho canonico em vez de criar um paralelo?
- [ ] Se eu mudar o status real do produto, vou atualizar a documentacao correspondente na mesma sessao?

Se qualquer resposta for `nao` ou `nao sei`, pare e leia o documento correspondente.

---

## 4. PROTOCOLO DE HANDOFF

Ao encerrar uma sessao relevante:

- Atualize ou proponha atualizacao em `docs/06_AI_MEMORY_BANK.md`.
- Atualize tambem `docs/03_ROADMAP_MVP.md` se o status real do produto mudou.
- Corrija documentos de onboarding que tiverem ficado em conflito com o estado real.
- Nunca altere a secao "Decisoes Arquiteturais Consolidadas" sem ordem expressa do usuario.

---

## 5. CONVENCAO DE BRANCHES

Quando houver multiplos agentes ou trabalho paralelo:

- Preferir uma branch por tarefa/feature.
- Usar `main` apenas quando o usuario pedir edicao direta no workspace atual ou quando o trabalho for explicitamente local e linear.
- Antes de criar branch ou arquivos em paralelo, confira `docs/06_AI_MEMORY_BANK.md`.

---

## 6. MAPA DE REFERENCIA RAPIDA

| O que voce precisa | Arquivo | Quando consultar |
|--------------------|---------|-----------------|
| Estado atual e proximo passo | `docs/06_AI_MEMORY_BANK.md` | Sempre no inicio |
| Fase e escopo do produto | `docs/03_ROADMAP_MVP.md` | Antes de qualquer tarefa |
| Regras de modo de desenvolvimento | `docs/09_AGENT_DEV_MODE.md` | Processo, CI, docs, multi-agente |
| Onde colocar arquivos | `docs/08_TREE_ARCHITECTURE.md` | Antes de criar/mover |
| Tecnologias aprovadas | `docs/02_TECH_STACK.md` | Antes de adicionar dependencia |
| Compliance e gates | `docs/07_TEST_AND_COMPLIANCE.md` | Build, emulacao, toolchains, entrega |
| Limites de hardware | `docs/04_HARDWARE_SPECS.md` | Graficos, audio, memoria |
| Modelo de dados UGDM | `docs/05_ARCHITECTURE_UGDM.md` | Schema e pipeline de dados |
| Regras do Cursor | `.cursorrules` | Leitura automatica no Cursor |
| Regras do Claude | `CLAUDE.md` | Leitura automatica no Claude Code |

---

## 7. VALIDACAO MINIMA DE ESTRUTURA E PROCESSO

O baseline minimo antes de declarar entrega de uma mudanca relevante e:

- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy -- -D warnings`
- `cargo test --lib -- --nocapture`

Se a mudanca tocar build, emulacao, toolchains ou integracao com dependencias reais, a validacao manual com upstream oficial continua obrigatoria.

---

## 8. SINAIS DE QUE VOCE ESTA SAINDO DO TRILHO

Pare imediatamente se perceber qualquer um destes sinais:

1. Voce esta criando arquivos sem conseguir apontar o canonico correspondente.
2. Voce esta adicionando dependencia nova sem documentar o stack.
3. Voce esta fazendo UI ou docs parecerem mais prontas do que o backend realmente suporta.
4. Voce esta criando um segundo fluxo de build, persistencia, store ou IPC porque o primeiro esta incomodo.
5. Voce rodou zero gates, mas ja esta chamando a tarefa de concluida.
6. Existe divergencia clara entre `README`, `CLAUDE`, `Memory Bank` e `Roadmap`, e voce pretende ignorar isso.
7. Voce nao sabe explicar qual e a fonte de verdade do estado atual.

---

**[Fim das Diretrizes]**
Use este arquivo como indice obrigatorio. Para o modo detalhado de governanca e blindagem do processo, consulte `docs/09_AGENT_DEV_MODE.md`.
