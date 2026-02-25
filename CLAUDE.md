# CLAUDE.md - RetroDev Studio

## Projeto
RetroDev Studio: plataforma desktop para desenvolvimento de jogos 16-bit (Mega Drive, SNES).
Stack: Tauri (Rust) + React (TypeScript) + SGDK/PVSnesLib.

## Fase Atual
**Fase 0 (Fundacao)** — nenhum codigo fonte existe ainda. O proximo passo e inicializar o scaffold Tauri + React + Rust.

## Leitura Obrigatoria (ANTES de qualquer acao)
1. `docs/06_AI_MEMORY_BANK.md` — estado atual do projeto
2. `docs/03_ROADMAP_MVP.md` — fase e sprint atual (NAO antecipe fases futuras)
3. `docs/08_TREE_ARCHITECTURE.md` — onde colocar cada arquivo
4. `docs/00_AI_DIRECTIVES.md` — regras completas, acoes proibidas, checklist

Responda com "[Contexto Carregado]" antes de propor qualquer acao.

## Regras Criticas
- Escopo restrito a Fase/Sprint marcada como "EM ANDAMENTO" no Roadmap
- Tecnologias permitidas: APENAS as listadas em `docs/02_TECH_STACK.md`
- Proibido: Electron, Redux, Python no runtime, malloc/free em codigo C gerado
- UGDM e agnostico: sem referencias a VDP/PPU/OAM/CRAM no modelo de dados
- Coordenadas e variaveis de jogo: inteiros apenas (sem float)
- Hardware specs em `docs/04_HARDWARE_SPECS.md` sao imutaveis
- Compliance legal: nunca distribuir ROMs, apenas patches IPS/BPS

## Ao Encerrar Sessao
Se algo relevante foi feito, proponha atualizacao do `docs/06_AI_MEMORY_BANK.md`.

## Comandos Uteis
- Validar estrutura: `node scripts/check-tree.js`
- Linter Rust: `cargo clippy -- -D warnings`
- Linter Frontend: `npx eslint .`
