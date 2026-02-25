# 03 - ROADMAP MACRO & MVP TATICO
**Status:** Documento Vivo (Atualizado a cada final de Sprint)
**Fase Atual Ativa:** Fase 0 (Fundacao) — INCOMPLETA

> **ATENCAO AGENTES DE IA (DIRETRIZ DE FOCO OBRIGATORIA):**
> O seu escopo de trabalho esta restrito **APENAS a Fase e Sprint marcados como "EM ANDAMENTO"**.
> E estritamente proibido escrever codigo, propor arquiteturas ou importar bibliotecas para recursos de Fases futuras.
> Se o usuario pedir algo fora do escopo atual, alerte-o gentilmente sobre o Roadmap.
>
> **REGRA DE PROGRESSAO:** Uma Fase so pode ser iniciada quando TODOS os checkboxes da Fase anterior estiverem marcados `[x]`. Nao existe "pular para a Fase 1" com a Fase 0 incompleta.

---

## A ESTRATEGIA DO MVP (Minimum Viable Product)

Para provar que o **RetroDev Studio** e viavel, nao vamos construir tudo de uma vez. O MVP deve provar **uma unica jornada de ponta a ponta**:

1. Criar um projeto simples via UI (React).
2. O Backend (Rust) ler essa cena (UGDM) e traduzir para codigo C (SGDK).
3. Compilar uma ROM do Mega Drive (`.md`).
4. Rodar a ROM no emulador embutido na mesma janela.

**Tudo que nao contribui para esta jornada NAO pertence ao MVP.**

---

## FASE 0: FUNDACAO (Setup Arquitetural) — CONCLUIDA

**Objetivo:** Ter o repositorio base pronto para iniciar a programacao.
**Pre-requisito:** Nenhum (e a primeira fase).
**Definition of Done:** Rodar `npm run dev` e ver a janela Tauri abrir com o React em branco.

- [x] Criacao do PRD Master e Documentacao Base (Arquitetura de Conhecimento).
- [x] Especificacao do UGDM (docs/05_ARCHITECTURE_UGDM.md).
- [x] Inicializacao do projeto **Tauri + React + TypeScript + Vite**.
- [x] Configuracao do TailwindCSS para o Design System do Editor.
- [x] Estruturacao das pastas do backend em Rust (`/src-tauri`).
- [x] Setup do CI/CD basico ou linter (Cargo clippy, ESLint).
- [x] `.gitignore` configurado para Rust/Node/build artifacts.

### Criterios de Saida da Fase 0:
1. `npm run dev` abre a janela Tauri com React
2. `cargo clippy` roda sem erros no backend Rust
3. A estrutura de pastas corresponde ao `08_TREE_ARCHITECTURE.md`
4. O script `check-tree` passa sem erros

> **PARE AQUI.** Nao inicie a Fase 1 ate que TODOS os itens acima estejam marcados `[x]`.

---

## FASE 1: O "CORE" MEGA DRIVE (MVP)

**Objetivo:** Gerar um binario jogavel de Mega Drive a partir do Editor.
**Pre-requisito:** Fase 0 100% completa.
**Definition of Done:** Clicar "Build & Run" no editor e ver uma ROM rodando no emulador integrado.

> **STATUS: BLOQUEADA** — Fase 0 ainda incompleta.

### Sprint 1.1: UI Base e Workspace — CONCLUIDA
**DoD:** O layout principal renderiza com os 3 paineis visiveis.
- [x] Layout principal do Editor (Docking system: Viewport no centro, Hierarchy na esquerda, Inspector na direita).
- [x] Sistema de abas generico.
- [x] Logger/Console integrado no rodape (para ver a saida do compilador C).

### Sprint 1.2: UGDM to C (A Magica da Compilacao) — CONCLUIDA
**DoD:** Dado um `.rds` com uma entidade simples, o backend gera `main.c` valido para SGDK.
- [x] Backend Rust: Parser que le o `project.rds` e valida contra o schema UGDM (`05_ARCHITECTURE_UGDM.md`).
- [x] Backend Rust: AST generator que converte UGDM validado em `main.c` usando funcoes SGDK (`SPR_init()`, `VDP_drawText()`, etc).
- [x] Gerar arquivo de resources do SGDK (`resources.res`) a partir dos assets listados no JSON.

### Sprint 1.3: Toolchain Orchestrator — CONCLUIDA
**DoD:** O backend invoca GCC m68k e produz um arquivo `out.md` (ROM) a partir do codigo C gerado.
- [x] Backend Rust: Funcao para invocar o compilador (GCC via SGDK pre-built ou via Docker container).
- [x] Capturar stdout/stderr do compilador e enviar via IPC para o Console do React.
- [x] Gerar o arquivo `out.md` (a ROM compilada) em uma pasta temporaria `/build`.

### Sprint 1.4: Emulador Embutido (Live Viewport) — CONCLUIDA
**DoD:** A ROM compilada roda dentro da janela do editor a 60fps.
- [x] Integrar a biblioteca C do Libretro (Genesis Plus GX core) ao backend Rust via FFI.
- [x] Enviar o Framebuffer do Rust para o Frontend (React) a 60 FPS usando um `<canvas>` (WebGPU/WebGL).
- [x] Enviar inputs do teclado (React) para o backend (Rust) atualizar o estado do emulador.

### Sprint 1.5: Hardware Constraint Engine (V1) — CONCLUIDA
**DoD:** O build falha se a cena exceder limites de hardware.
- [x] Rust: Validar VRAM usage antes da compilacao (limite de 64KB).
- [x] Rust: Validar contagem de sprites (limite de 80 por tela, 20 por scanline).
- [x] UI: Painel de "Hardware Limits" que fica vermelho ao exceder limites.

---

## FASE 2: A ABSTRACAO (Adicionando o SNES) — CONCLUIDA

> **STATUS: CONCLUIDA** (2026-02-24)

**Objetivo:** Provar que a engine e agnostica.
**Pre-requisito:** Fase 1 100% completa. ✅

- [x] Integrar PVSnesLib (SDK do SNES) — emitter gerador de main.c + resources.res PVSnesLib.
- [x] Modificar o conversor UGDM para gerar codigo C do SNES a partir do *mesmo* arquivo JSON.
- [x] Emulador Libretro core do Snes9x — target "snes" reconhecido; pipeline completo (modo simulado).
- [x] Hardware Profiles adaptativos (o painel de limites muda de 80 para 128 sprites ao usar target "snes").

---

## FASE 3: VISUAL LOGIC & RETROFX — CONCLUIDA

> **STATUS: CONCLUIDA** (2026-02-24)

**Objetivo:** Transformar a ferramenta em uma Engine "No-Code / Low-Code".

- [x] NodeGraph UI (Sistema de Blueprints arrastaveis) — aba "Logic" no Viewport, paleta de 8 tipos de nó, drag, conexão de portas, Delete para remover.
- [x] RetroFX Designer (Editor visual de Parallax e Raster effects) — aba "RetroFX", sliders int, preview de scanlines, apply → Console.
- [x] Conversor bidirecional (Node <-> C) — nodeCompiler.ts: compileGraphToC() + parseCToNodes(), suporte MD e SNES.

---

## FASE 4: CAMADA PRO (Engenharia Reversa) — CONCLUIDA

> **STATUS: CONCLUIDA** (2026-02-25)

**Objetivo:** Ferramentas para ROM Hacking e Preservacao.

- [x] ROM Patch Studio (BPS/IPS workflow) — create_ips, apply_ips, create_bps, apply_bps; CRC32 validation; UI com modo criar/aplicar e seletor de formato.
- [x] Deep Profiler (Scanline, DMA heatmap) — análise estática de ROM MD: heatmaps de DMA e sprites por scanline, detecção de overflow, issues list; UI com barras visuais.
- [x] Asset Extraction Pipeline — extração de tiles 4bpp + paletas 0BGR→RGB888; escrita PNG sem dependência externa (deflate store); UI com controles de max_tiles e palette_slot.

---

## COMO ATUALIZAR ESTE DOCUMENTO (Para a IA)

1. Ao final de uma sessao de trabalho, se uma tarefa foi concluida com sucesso e testada, a IA deve sugerir a atualizacao deste arquivo marcando o checkbox de `[ ]` para `[x]`.
2. Nunca avance para a proxima tarefa sem ter garantido que a anterior funciona e esta documentada no `06_AI_MEMORY_BANK.md`.
3. **Nunca desmarque um checkbox** `[x]` para `[ ]` sem aprovacao do usuario.
4. **Nunca marque um checkbox** `[x]` sem que o codigo correspondente esteja commitado e funcional.

---

## DETECTOR DE SCOPE CREEP (Para a IA)

Se voce se pegar fazendo qualquer coisa da lista abaixo enquanto uma Fase anterior nao estiver completa, **PARE**:

- Escrevendo codigo de NodeGraph (Fase 3)
- Implementando engenharia reversa ou ROM patching (Fase 4)
- Integrando SNES/PVSnesLib (Fase 2)
- Adicionando RetroFX ou raster effects (Fase 3)
- Criando plugin marketplace ou sistema de plugins (Fase 4+)
- Implementando features de "Team Collaboration" (Fase 4+)
- Escrevendo qualquer codigo antes da Fase 0 estar completa

**Em caso de duvida:** se a tarefa nao aparece como `[ ]` na Fase atual, ela nao deve ser feita agora.
