# CLAUDE.md - RetroDev Studio

## Projeto
RetroDev Studio: plataforma desktop para desenvolvimento de jogos 16-bit (Mega Drive, SNES), preservacao e engenharia reversa orientada a patches.
Stack base: Tauri + React + TypeScript + Rust + SGDK/PVSnesLib + Libretro.

## Estado Atual
**Hardening/QA do MVP**.
O foco real nao e criar feature nova; e fechar o fluxo canonico `Build -> ROM -> Emulacao` com dependencias oficiais e manter o baseline de validacao verde.

## Hierarquia De Verdade
Se houver conflito entre documentos, siga esta ordem:
1. `docs/06_AI_MEMORY_BANK.md`
2. `docs/03_ROADMAP_MVP.md`
3. `docs/09_AGENT_DEV_MODE.md`
4. `docs/08_TREE_ARCHITECTURE.md`
5. `docs/02_TECH_STACK.md`
6. `docs/07_TEST_AND_COMPLIANCE.md`
7. `README.md` e `CLAUDE.md`

`README.md` e este arquivo servem para onboarding. Eles nao podem sobrepor o estado operacional canonicamente registrado.

## Leitura Obrigatoria Antes De Qualquer Acao
1. `docs/06_AI_MEMORY_BANK.md`
2. `docs/03_ROADMAP_MVP.md`
3. `docs/08_TREE_ARCHITECTURE.md`
4. `docs/00_AI_DIRECTIVES.md`
5. `docs/09_AGENT_DEV_MODE.md` quando a tarefa tocar processo, CI, documentacao de estado, multi-agente ou conflito entre documentos

Responda com `[Contexto Carregado]` antes de propor qualquer acao relevante.

## Regras Criticas
- Nao antecipe fases futuras do roadmap.
- Nao declare feature parcial como pronta.
- Mantenha superficies parciais claramente marcadas como `Experimental`.
- Nao introduza dependencia nova sem aprovacao do usuario e reflexo em `docs/02_TECH_STACK.md`.
- Nao crie arquivos fora da arvore definida em `docs/08_TREE_ARCHITECTURE.md`.
- Nao use Electron, Redux ou Python no runtime do app.
- Nao distribua ROM comercial; use BYOR e patches IPS/BPS.
- Nao altere "Decisoes Arquiteturais Consolidadas" do Memory Bank sem ordem expressa.

## Barra Minima Antes De Declarar Entrega
- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy -- -D warnings`
- `cargo test --lib -- --nocapture`
- Validacao manual com dependencias oficiais quando a mudanca tocar build, emulacao ou toolchains reais

## Ao Encerrar Sessao
Se algo relevante foi feito, atualize ou proponha atualizacao de `docs/06_AI_MEMORY_BANK.md`.

## Comandos Uteis
- Validar estrutura: `npm run check:tree`
- Lint frontend: `npm run lint`
- TypeScript: `npx tsc --noEmit`
- Testes frontend: `npm test`
- Lint Rust: `cargo clippy -- -D warnings`
- Testes Rust: `cargo test --lib -- --nocapture`
