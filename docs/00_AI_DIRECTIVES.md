# 00 - DIRETRIZES PARA AGENTES DE IA (AGNOSTICO)
**Status:** Definitivo
**Objetivo:** Ponto de entrada unico para **qualquer** agente de IA (Cursor, Codex, Claude, Trae, Bonsai, etc.).

> **QUALQUER AGENTE DE IA:**
> Este repositorio e editado por multiplas IAs e por humanos. Para evitar erros, alucinacoes e trabalho duplicado, **sempre** siga o fluxo abaixo. As regras completas estao em `.cursorrules` (raiz do projeto); este documento e o indice obrigatorio para todas as ferramentas.

---

## 1. FLUXO OBRIGATORIO (ANTES DE CODIGO OU DECISOES)

Antes de escrever codigo, criar arquivos ou propor mudancas arquiteturais, execute **nesta ordem**:

1. **Ler `docs/06_AI_MEMORY_BANK.md`** — contexto da ultima sessao, decisoes consolidadas e proximo passo.
2. **Ler `docs/03_ROADMAP_MVP.md`** — fase atual do projeto. Identifique qual Sprint esta marcada como "EM ANDAMENTO".
3. **Ler `docs/08_TREE_ARCHITECTURE.md`** — sempre que for **criar ou mover** arquivos ou pastas.
4. **Responder com "[Contexto Carregado]"** seguido de um plano de acao em bullet points antes de gerar codigo.

**SE VOCE NAO SEGUIR ESTE FLUXO, SEU CODIGO SERA REJEITADO.**

---

## 2. ACOES PROIBIDAS (LISTA DE BLOQUEIO)

Estas acoes sao **terminantemente proibidas**. Se voce executar qualquer uma, o trabalho sera descartado:

| # | Acao Proibida | Por que |
|---|--------------|---------|
| 1 | Escrever codigo para Fases futuras do Roadmap | Causa scope creep e codigo orfao |
| 2 | Inventar APIs, funcoes ou bibliotecas que nao existem | Alucinacao — gera codigo que nao compila |
| 3 | Usar `malloc()`/`free()` em codigo C gerado | Hardware 16-bit tem 64KB — alocacao estatica apenas |
| 4 | Usar `Vec::new()` dentro de loops de 60Hz no Rust | Causa stuttering no emulador |
| 5 | Adicionar dependencias npm ou crates sem aprovacao | Deve estar listado em `02_TECH_STACK.md` |
| 6 | Criar arquivos fora da arvore definida em `08_TREE_ARCHITECTURE.md` | Quebra a estrutura padrao |
| 7 | Modificar `04_HARDWARE_SPECS.md` | Baseado em silicio real — imutavel |
| 8 | Alterar "Decisoes Arquiteturais Consolidadas" no Memory Bank | Requer ordem expressa do usuario |
| 9 | Gerar ou distribuir ROMs comerciais | Violacao legal — ver `07_TEST_AND_COMPLIANCE.md` |
| 10 | Usar nomes de hardware (VDP, PPU, OAM, CRAM) no UGDM | UGDM e agnostico — ver `05_ARCHITECTURE_UGDM.md` |
| 11 | Pular a validacao UGDM antes de chamar o compilador | Fluxo sequencial obrigatorio — ver `05_ARCHITECTURE_UGDM.md` secao 9 |
| 12 | Usar Redux, Electron, ou Python no runtime | Proibidos no `02_TECH_STACK.md` |

---

## 3. CHECKLIST PRE-CODIGO (Valide ANTES de escrever qualquer linha)

Antes de gerar codigo, responda mentalmente a cada pergunta:

- [ ] Li o `06_AI_MEMORY_BANK.md` e sei onde o projeto parou?
- [ ] A tarefa que vou fazer pertence a Fase/Sprint ATUAL do `03_ROADMAP_MVP.md`?
- [ ] Sei exatamente em qual diretorio o arquivo deve ser criado (`08_TREE_ARCHITECTURE.md`)?
- [ ] As tecnologias que vou usar estao aprovadas no `02_TECH_STACK.md`?
- [ ] Se vou manipular hardware, consultei os limites exatos no `04_HARDWARE_SPECS.md`?
- [ ] Se vou criar/modificar o UGDM, segui o schema do `05_ARCHITECTURE_UGDM.md`?
- [ ] Meu codigo nao viola nenhuma regra da secao "ACOES PROIBIDAS" acima?

**Se qualquer resposta for "nao" ou "nao sei", PARE e leia o documento correspondente.**

---

## 4. PROTOCOLO DE HANDOFF (ENCERRAMENTO DE SESSAO)

Para que a proxima sessao (ou outra IA) nao trabalhe com contexto desatualizado:

* Ao **encerrar** uma sessao em que algo relevante foi feito (codigo novo, decisao, bug corrigido), **proponha ou aplique** uma atualizacao em `docs/06_AI_MEMORY_BANK.md` nas secoes:
  - **"O que acabou de acontecer"**
  - **"Proximo passo imediato"** (se mudou)
* **Nunca** altere a secao "Decisoes Arquiteturais Consolidadas" sem ordem explicita do usuario.
* O campo **"Ultima sessao"** no topo do `06_AI_MEMORY_BANK.md` deve refletir a data e ferramenta usada.

---

## 5. CONVENCAO DE BRANCHES (MULTIPLAS IAs)

Quando varias IAs ou pessoas trabalharem em paralelo:

* Preferir **uma branch por tarefa/feature** (ex.: `feat/tauri-setup`, `fix/viewport-resize`).
* Antes de criar arquivos em uma branch, confirme no `06_AI_MEMORY_BANK.md` se ha branch recomendada.
* Nao altere a branch principal (`main`) sem merge explicito apos revisao.

---

## 6. ONDE ESTA CADA COISA (MAPA DE REFERENCIA RAPIDA)

| O que voce precisa | Arquivo | Quando consultar |
|--------------------|---------|-----------------|
| Contexto atual e proximo passo | `docs/06_AI_MEMORY_BANK.md` | **SEMPRE** no inicio da sessao |
| Fase do projeto e escopo | `docs/03_ROADMAP_MVP.md` | Antes de qualquer tarefa |
| Onde colocar cada arquivo | `docs/08_TREE_ARCHITECTURE.md` | Antes de criar/mover arquivos |
| Tecnologias aprovadas | `docs/02_TECH_STACK.md` | Antes de importar libs/crates |
| Limites de hardware | `docs/04_HARDWARE_SPECS.md` | Ao trabalhar com graficos/audio/memoria |
| Modelo de dados (UGDM) | `docs/05_ARCHITECTURE_UGDM.md` | Ao criar/modificar formato de dados |
| Testes e compliance legal | `docs/07_TEST_AND_COMPLIANCE.md` | Ao lidar com ROMs ou builds |
| Visao do Produto (PRD) | `docs/01_PRD_MASTER.md` | Para entender o escopo completo |
| Regras da IA (Cursor) | `.cursorrules` | Leitura automatica no Cursor |
| Regras da IA (Claude) | `CLAUDE.md` | Leitura automatica no Claude Code |

---

## 7. VALIDACAO DA ESTRUTURA

O projeto possui scripts que verificam se a arvore de diretorios esta de acordo com `docs/08_TREE_ARCHITECTURE.md`:

* **Windows (PowerShell):** `.\scripts\check-tree.ps1`
* **Node.js (cross-platform):** `node scripts/check-tree.js`

Execute antes de commit ou em CI.

---

## 8. SINAIS DE QUE VOCE ESTA SAINDO DO TRILHO

Se voce perceber qualquer um destes sinais, **PARE imediatamente** e releia a documentacao:

1. Voce esta criando mais de 3 arquivos sem ter planejado onde cada um vai
2. Voce esta importando uma biblioteca que nao esta no `02_TECH_STACK.md`
3. Voce esta escrevendo codigo para uma feature que nao faz parte do Sprint atual
4. Voce esta inventando um formato de dados diferente do UGDM
5. Voce esta trabalhando ha mais de 10 minutos sem ter respondido "[Contexto Carregado]"
6. Voce nao sabe dizer em qual Sprint do Roadmap a tarefa se encaixa
7. Voce esta usando float em codigo que sera executado no hardware 16-bit

---

**[Fim das Diretrizes]**
*Se voce e uma IA e esta em Cursor, as regras em `.cursorrules` ja referenciam estes documentos. Em outras ferramentas, use este arquivo como primeiro passo e depois leia os documentos listados acima.*
