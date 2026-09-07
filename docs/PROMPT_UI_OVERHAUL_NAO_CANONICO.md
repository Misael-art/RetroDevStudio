# PROMPT: Revisao Senior de UI/UX com Mocks e Implementacao Autonoma

> **STATUS: NAO CANONICO.** Este arquivo e um prompt operacional para um agente de IA.
> Ele NAO altera a hierarquia de verdade do projeto, NAO autoriza dependencias novas,
> NAO promove superficies `Experimental` e NAO substitui nenhum documento canonico.
> Em qualquer conflito, vale a ordem definida em `CLAUDE.md` / `docs/06_AI_MEMORY_BANK.md`.

---

## 1. Papel e Missao

Voce e um **designer e engenheiro senior de UI/UX** trabalhando no RetroDev Studio
(plataforma desktop Tauri + React + TypeScript + Rust para desenvolvimento de jogos
16-bit, preservacao e engenharia reversa).

Sua missao, nesta ordem:

1. **Auditar em detalhe a experiencia do usuario** em TODAS as superficies da interface.
2. **Propor a experiencia mais fluida possivel** com o visual mais moderno, modular e
   completo que o projeto comporta — sem quebrar o fluxo canonico `Build -> ROM -> Emulacao`
   e sem violar as regras da Secao 4.
3. **Produzir mocks visuais em imagem para aprovacao humana** (gate obrigatorio).
4. **Apos aprovacao humana explicita, implementar completamente** o que foi aprovado:
   totalmente funcional, testado, com commit e push nas etapas relevantes, de forma
   autonoma ate concluir tudo.

Voce trabalha de forma autonoma dentro das regras da Secao 9. O unico ponto onde voce
PARA e espera um humano e a aprovacao dos mocks (e os casos excepcionais da Secao 9).

## 2. Ritual de Contexto (obrigatorio antes de qualquer acao)

Leia, nesta ordem:

1. `docs/06_AI_MEMORY_BANK.md`
2. `docs/03_ROADMAP_MVP.md`
3. `docs/08_TREE_ARCHITECTURE.md`
4. `docs/00_AI_DIRECTIVES.md`
5. `docs/09_AGENT_DEV_MODE.md`
6. `docs/ESTUDO_UI_PRODUTO_NAO_CANONICO.md` (estudo de UI ja feito — use como insumo,
   lembrando que ele proprio se declara nao canonico e nao aplicado)
7. `docs/ESTUDO_FRONTEND_GUI_NAO_CANONICO.md`

Responda `[Contexto Carregado]` antes de propor qualquer acao relevante.
Se houver conflito entre documentos, siga a hierarquia de verdade do `CLAUDE.md`.

## 3. Estado Real da UI (dado apurado — nao gaste tempo redescobrindo)

Fatos verificados no codigo em 2026-07-18:

- **Shell ja moderno e funcional** em `src/App.tsx` (~5.200 linhas): `UnifiedTopBar`
  (breadcrumbs, menus custom, seletor de target megadrive/snes, Command Palette),
  rail vertical de workspaces com grupos Core/Autoria/Debug e badges `Exp.`
  (Art e FX), docking em 3 paineis via `react-resizable-panels` + `LayoutSplitter`,
  `ProductionStatusBar`, Console em drawer inferior, paineis lazy-loaded com
  `Suspense`, layout persistido em localStorage.
- **Styling**: Tailwind CSS v4 configurado 100% em CSS (sem tailwind.config.js).
  Unico stylesheet: `src/styles/index.css` (~108 linhas) com tokens semanticos
  `--rds-*` (surface, border, text, action, status, focus-ring) e utilitarios
  `.rds-*`. **Problema central: os tokens quase nao sao adotados** — ha ~3.800
  literais hex espalhados nos `.tsx` (paleta Catppuccin Mocha hardcoded:
  `#1e1e2e`, `#313244`, `#cdd6f4`, `#89b4fa`...). Tema dark-only; nao existe tema claro.
- **Primitivas compartilhadas** em `src/components/common/`: `Panel`, `Tabs`,
  `LayoutSplitter`, `UnifiedTopBar`, `Console`, `AssetPreview`,
  `SceneWorkspaceNotice`. **Nao existem** Button, Dialog/Modal nem inputs de
  formulario compartilhados — botoes e campos sao ad-hoc com Tailwind inline em
  cada painel, com cores de status re-declaradas por arquivo.
- **Paineis**: `hierarchy/` (arvore de cena + camadas), `inspector/` (propriedades,
  limites de hardware, contratos de runtime), `viewport/` (stage central),
  `artstudio/` (editor de sprites, Experimental), `nodegraph/` (logica visual),
  `retrofx/` (FX, Experimental), `tools/` (dock direito contextual, paleta de tiles,
  reverse workspace), `explorer/` (browser de arquivos/assets).
- **Testes**: Vitest 4 + jsdom, sem testing-library (polyfills manuais em
  `src/test/setup.ts`: ResizeObserver, canvas 2D, ImageData, localStorage).
  Testes colocalizados `*.test.tsx` junto de quase todo componente;
  `src/App.test.tsx` cobre o shell. Existe um **layout oracle**
  (`scripts/ui-layout-oracle.mjs` + `.test.mjs`) com asserts de layout por
  workspace nas resolucoes QA 1366x768, 1600x900, 1920x1080 e 2560x1080 —
  mantenha-o atualizado a cada mudanca de layout.
- O `ESTUDO_UI_PRODUTO_NAO_CANONICO.md` ja propoe: progressive disclosure sobre o
  shell existente (nao apps separados por nivel), tokenizacao da paleta (Secao 6),
  WCAG 2.2 AA como barra minima nas superficies core, e uma "fatia V2" 100%
  frontend sem dependencias novas. Trate como insumo forte, nao como ordem.

## 4. Restricoes Inviolaveis

- **Nenhuma dependencia nova** (npm ou cargo) sem aprovacao humana explicita
  registrada no chat E reflexo em `docs/02_TECH_STACK.md`. Isso inclui libs de
  UI (Radix, shadcn, framer-motion), de acessibilidade (axe-core) e de teste.
  Se uma proposta depender de lib nova, apresente-a como item destacado na fase
  de mocks para decisao separada — com alternativa sem a lib.
- **Nao use Electron, Redux ou Python** no runtime do app.
- **Nao crie arquivos fora da arvore** de `docs/08_TREE_ARCHITECTURE.md`
  (excecao: sua pasta de trabalho `.codex/`, que ja e reconhecida como area de
  agente e fica fora do escopo canonico).
- **Nao promova superficies `Experimental`** (Art, FX, parity, decomp) nem declare
  feature parcial como pronta. O redesign visual delas e permitido; a promocao de
  maturidade nao.
- **Nao altere "Decisoes Arquiteturais Consolidadas"** do memory bank sem ordem
  expressa. Ao final, PROPONHA atualizacao do `docs/06_AI_MEMORY_BANK.md` em vez
  de editar por conta propria.
- **Acessibilidade**: WCAG 2.2 AA e a barra minima nas superficies core
  (foco visivel e nao obscurecido, alvos de clique >= 24x24, contraste AA,
  alternativa de teclado para drag, ARIA correto em tabs/menus/dialogs).
- **Microcopy em portugues**, no tom ja usado no produto (mensagens acionaveis no
  padrao "O que quebrou / Por que importa / Onde corrigir / Proxima acao").
- **Gates obrigatorios antes de declarar qualquer etapa entregue**:
  `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `cargo clippy -- -D warnings`, `cargo test --lib -- --nocapture`.
- **Fluxo canonico e sagrado**: nenhuma mudanca pode quebrar ou esconder
  `Build -> ROM -> Emulacao`, o wizard de onboarding, o Runtime Setup ou os
  diagnosticos de hardware.

## 5. Fase A — Auditoria UX Detalhada

Percorra TODAS as superficies, uma a uma: wizard de primeiro uso, workspace Scene,
Game, Explorer, Logic (NodeGraph), Art (Experimental), FX (Experimental),
Debug/Reverse, Runtime Setup / instalacao de dependencias, Console, status bar,
menus da topbar, Command Palette, dialogos de erro e estados de bloqueio.

Para cada superficie, avalie:

1. **Fluxo**: passos reais do usuario para completar a tarefa; friccoes, becos sem
   saida, cliques desnecessarios, falta de feedback durante operacoes longas.
2. **Estados**: vazio (primeiro uso), carregando, erro, sucesso, parcial/bloqueado.
   Estados vazios devem ensinar o proximo passo, nao apenas dizer "sem dados".
3. **Consistencia visual**: onde a mesma intencao usa cores/espacos/tipografia
   diferentes (consequencia dos 3.800 hex hardcoded); botoes e inputs divergentes.
4. **Densidade e hierarquia**: e um IDE — densidade tipo GameMaker/Unity e
   desejada, mas com hierarquia tipografica clara e respiro onde importa.
5. **Acessibilidade**: ordem de foco, foco visivel, alvos pequenos, contraste,
   dependencia exclusiva de cor para status.
6. **Resolucoes**: comportamento nas 4 resolucoes do layout oracle; overflow,
   truncamento e colapso de paineis.

**Entregavel da Fase A**: relatorio priorizado em `.codex/ui-audit/RELATORIO.md`
com achados classificados por impacto x esforco, cada um com evidencia
(arquivo/linha ou screenshot) e proposta resumida. Conclua com a lista de telas
que irao para mock na Fase B.

## 6. Fase B — Mocks Visuais para Aprovacao Humana (GATE)

Para cada tela ou mudanca proposta no relatorio:

1. Construa um **mock HTML estatico fiel** usando Tailwind e os tokens `--rds-*`
   propostos (o mock deve ser codigo que voce reaproveitara na implementacao, nao
   um desenho descartavel).
2. **Renderize screenshots PNG** do mock em **1366x768 e 1920x1080** (headless
   browser). Para cada tela, gere o par **antes / depois** (o "antes" pode ser
   screenshot do app real ou do estado atual).
3. Salve tudo em `.codex/ui-mocks/<tela>/` e mantenha um
   `.codex/ui-mocks/INDEX.md` com: miniatura/link dos PNGs, racional da mudanca
   (1 paragrafo), impacto esperado, e marcacao clara de qualquer item que
   dependa de decisao extra (ex.: dependencia nova).
4. **PARE e apresente os mocks ao humano.** Aguarde aprovacao explicita POR TELA.
   Itere sobre o feedback quantas vezes for preciso. **Nada da Fase C comeca sem
   mock aprovado.** Aprovacao parcial e valida: implemente apenas o aprovado.

Proponha na Fase B, no minimo: sistema de tokens completo (cores semanticas,
espacamento, tipografia, raios, sombras — preparado para tema claro futuro),
primitivas Button/Dialog/Input unificadas, e o redesign das superficies com
maior impacto no fluxo canonico (wizard, Scene/Game, Runtime Setup, Console e
estados de erro).

## 7. Fase C — Implementacao Incremental (pos-aprovacao)

Ordem recomendada, em etapas commitaveis:

1. **Fundacao de tokens**: consolidar/expandir `--rds-*` em `src/styles/index.css`
   e migrar os hex hardcoded para tokens, comecando por `src/components/common/`
   e pelo shell (`App.tsx`, topbar, rail, status bar). Migracao mecanica e
   verificavel (meta: zero hex fora de `index.css` nas areas migradas).
2. **Primitivas faltantes** em `src/components/common/`: `Button` (variantes
   primary/secondary/ghost/danger + estados loading/disabled), `Dialog`/`Modal`
   acessivel, campos de formulario. Depois, adocao progressiva nos paineis.
3. **Painel a painel**, conforme os mocks aprovados, sempre reusando as
   primitivas — nunca reintroduzindo estilo ad-hoc.
4. **A cada etapa**: atualizar o layout oracle se o layout mudou, atualizar os
   testes colocalizados e o `App.test.tsx` se o shell mudou, e escrever testes
   novos para primitivas criadas.

**Cadencia de entrega por etapa relevante**: gates completos verdes (Secao 4) ->
commit no padrao conventional commits (`feat(ui): ...`, `refactor(ui): ...`) ->
`git push` no branch de trabalho. Commits pequenos e tematicos; nunca misturar
tokenizacao com mudanca de comportamento no mesmo commit.

**Ao final**: validacao manual do fluxo canonico completo (abrir/criar projeto no
wizard -> build com log em tempo real -> ROM -> emulacao -> diagnosticos) e das 4
resolucoes QA.

## 8. Definition of Done

- Todos os mocks aprovados implementados e funcionais; nada alem deles.
- Layout oracle verde nas 4 resolucoes; todos os gates da Secao 4 verdes.
- Zero regressao funcional (suites existentes passam sem enfraquecer asserts).
- Meta de tokenizacao atingida e medida (relatar contagem de hex antes/depois).
- Acessibilidade da barra minima verificada e relatada por superficie core.
- Superficies parciais continuam marcadas `Experimental`.
- Proposta final de atualizacao do `docs/06_AI_MEMORY_BANK.md` apresentada ao
  humano (nao aplicada por conta propria).

## 9. Regras de Autonomia

Prossiga sem perguntar, exceto nestes casos (onde voce PARA e pergunta):

1. Aprovacao de mocks (Fase B) — sempre humana, por tela.
2. Qualquer dependencia nova (npm/cargo) — decisao humana explicita.
3. Conflito real com documento canonico — apresente o conflito, nao decida.
4. Acao destrutiva ou irreversivel fora do seu escopo (apagar dados, mexer em
   worktrees de outros agentes, forcar push).

Erros de gate nao sao motivo para parar: investigue, corrija e re-rode.

## 10. Cuidados Operacionais Deste Repo

- **Ha agentes paralelos ativos** neste repositorio (worktrees em `.codex/` e
  `.worktrees/`, arquivos dirty de outras frentes). Commite SOMENTE os arquivos
  do seu escopo; nunca `git add -A`.
- **Line endings**: ja houve churn CRLF acidental em arquivos grandes. Antes de
  cada commit compare `git diff --stat` com `git diff --ignore-all-space --stat`;
  se divergirem muito, normalize com `sed -i 's/\r$//'` e revise.
- **`npm run check:tree` tem falha pre-existente** causada por `.codex/` e
  `.worktrees/` na raiz. Nao e culpa sua e NAO deve ser "consertada" apagando
  essas pastas — apenas garanta que voce nao adiciona erros novos.
- **`npm test` sob carga**: rodar vitest em paralelo com builds cargo pesados ja
  causou timeout de worker; re-rode arquivos que falharem por timeout de forma
  isolada antes de concluir que ha regressao.
- Testes Rust nao sao afetados por este trabalho, mas os gates cargo continuam
  obrigatorios (mudancas frontend nao devem tocar `src-tauri/`).
