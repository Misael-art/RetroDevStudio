# Prompt de Continuidade (Para qualquer IA)

Use este texto ao iniciar uma sessão com qualquer agente de IA (Cursor, Claude, Codex, Bonsai, etc.) para que ele entenda o status real do projeto, evite duplicações, não remova funções existentes, não inclua features futuras antes de terminar e testar o atual, e avance respeitando a estrutura e a cartilha do projeto.

---

## Como usar

1. Copie o bloco abaixo (entre os marcadores `---`).
2. Cole no início do chat da IA.
3. Em seguida, descreva a tarefa desejada (ex.: "Complete o item 3 da Fase 0" ou "Implemente o parser do project.rds").

Para referência por arquivo: peça à IA que leia este documento antes da tarefa, por exemplo: *"Leia docs/PROMPT_CONTINUIDADE.md e depois [sua tarefa]."*

---

## Bloco para copiar e colar

```
Você está entrando no projeto RetroDev Studio. Siga estritamente as regras abaixo.

**OBRIGATÓRIO — LEIA ANTES DE QUALQUER AÇÃO:**
1. Leia `docs/00_AI_DIRECTIVES.md` (ponto de entrada e lista de ações proibidas).
2. Leia `docs/06_AI_MEMORY_BANK.md` (status real: onde paramos, próximo passo, decisões consolidadas).
3. Leia `docs/03_ROADMAP_MVP.md` (fase e sprint EM ANDAMENTO; não escreva código para fases futuras).
4. Se for criar ou mover arquivos: leia `docs/08_TREE_ARCHITECTURE.md`.
5. Responda com "[Contexto Carregado]" + resumo em 3 bullets: (a) última coisa feita, (b) tarefa atual, (c) onde você vai atuar na árvore. Só depois proponha ou escreva código.

**REGRAS DE CONTINUIDADE (automáticas):**
- **Status real:** O estado do projeto está em `06_AI_MEMORY_BANK.md` (seção 1 e 4). Não assuma que algo já foi feito; confira o que está marcado como feito no Roadmap e no Memory Bank.
- **Sem duplicação:** Antes de criar um arquivo, componente ou função, verifique se já existe (busque no repositório). Não crie cópias ou variantes; reutilize ou estenda o que já existe.
- **Não remover funções:** Não delete, simplifique nem refatore código existente a menos que a tarefa atual seja explicitamente "remover X" ou "refatorar Y". Manter comportamento e APIs já em uso.
- **Não incluir futures antes de terminar e testar:** Só implemente o que pertence à Fase/Sprint marcada como "EM ANDAMENTO" no `03_ROADMAP_MVP.md`. Não adicione features de sprints ou fases posteriores. Não avance para a próxima tarefa até a atual estar implementada e testada (Definition of Done do sprint).
- **Respeitar estrutura e cartilha:** Código só em pastas e arquivos definidos em `08_TREE_ARCHITECTURE.md`. Respeite `.cursorrules` e a "Lista de bloqueio" e o "Checklist pré-código" em `00_AI_DIRECTIVES.md`. Ao encerrar sessão com mudança relevante: atualize `06_AI_MEMORY_BANK.md` (O que acabou de acontecer, Próximo passo, Última sessão).

**Se a tarefa do usuário for de uma fase futura ou ambígua:** Diga que o escopo atual é a Fase/Sprint em andamento (indicada no Memory Bank e no Roadmap), mostre qual é essa fase, e sugira uma tarefa equivalente dentro do escopo ou peça confirmação para expandir o escopo.
```
