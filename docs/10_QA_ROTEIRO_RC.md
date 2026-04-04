# 10 - ROTEIRO QA RELEASE CANDIDATE
**Status:** Documento operacional
**Objetivo:** Guiar testadores leigos na validacao do RC antes da promocao a beta institucional.
**Ultima revisao:** 2026-04-04

> Este roteiro e pensado para pessoas sem experiencia tecnica. Cada passo deve ser executavel com cliques e esperas visiveis. Ao concluir, preencha o checklist de evidencias no final.

> Caminho institucional automatizado da Wave S+: `npm run test:e2e:desktop:qa-rc`. Esse cenario executa os blocos `A-F` no app desktop real, grava `src-tauri/target-test/validation/manual-qa-status.json` e salva screenshots `qa-rc-*.png`. Ele nao substitui beta test com pessoas reais, mas passou a ser a evidencia canonica minima da trilha RC neste host Windows.

---

## 1. PRE-REQUISITOS

- [ ] Windows 10/11 (64-bit)
- [ ] RetroDev Studio instalado via MSI (`RetroDev Studio_0.1.0_x64_en-US.msi`) ou executavel de desenvolvimento
- [ ] Espaco em disco livre para toolchains (SGDK, PVSnesLib, cores Libretro) - o app pedira instalacao sob demanda

---

## 2. ROTEIRO PASSO A PASSO

### Bloco A - Primeiro uso e onboarding

| # | Acao | O que esperar | Evidencia |
|---|------|---------------|-----------|
| A1 | Abrir o RetroDev Studio | Janela do app abre, sem erro de crash | Screenshot da janela inicial |
| A2 | Ver a tela de boas-vindas / galeria de templates | Cards: Projeto Vazio, Primeiro Projeto, Plataforma, Importar Projeto SGDK | Screenshot da galeria |
| A3 | Clicar em **Plataforma** | Projeto e criado, editor carrega com cena e entidades | Screenshot do editor com Hierarchy visivel |
| A4 | Aguardar 2-3 segundos | Nenhum erro vermelho na tela; status bar sem mensagem de falha | OK / Falhou |
| A5 | Clicar na aba **Cena** no painel esquerdo | Lista de entidades (Camera, Hero, etc.) aparece | OK / Falhou |
| A6 | Clicar na aba **Camadas** | Lista de camadas aparece; botao "+ Camada" visivel | Screenshot do LayerPanel |

### Bloco B - Edicao de cena e camadas

| # | Acao | O que esperar | Evidencia |
|---|------|---------------|-----------|
| B1 | Clicar em **+ Camada** | Nova camada criada com nome padrao e aparece na lista | OK / Falhou |
| B2 | Clicar no nome da camada para editar | Campo de texto fica editavel | OK / Falhou |
| B3 | Digitar "Fundo" e pressionar Enter | Nome da camada atualiza para "Fundo" | OK / Falhou |
| B4 | Selecionar uma entidade na aba **Cena** (ex: Hero) | Entidade fica destacada | OK / Falhou |
| B5 | Ir para **Camadas** e clicar no botao de atribuir (icone de seta/link) | Entidade aparece na camada selecionada | OK / Falhou |
| B6 | Clicar no icone de olho da camada | Entidade some do canvas de cena | OK / Falhou |
| B7 | Clicar novamente no olho | Entidade volta a aparecer | OK / Falhou |
| B8 | Pressionar **Ctrl+Z** duas vezes | Undo restaura estado anterior (camada deletada ou alteracao revertida) | OK / Falhou |

### Bloco C - Modo colisao e pintura

| # | Acao | O que esperar | Evidencia |
|---|------|---------------|-----------|
| C1 | Pressionar **C** ou clicar no botao de escudo na toolbar do viewport | Modo colisao ativado; overlay vermelho semi-transparente aparece nos tiles solidos | OK / Falhou |
| C2 | Clicar em um tile no canvas | Tile fica vermelho (solido) | OK / Falhou |
| C3 | Clicar com botao direito no mesmo tile | Tile volta a ficar livre (sem overlay) | OK / Falhou |
| C4 | Pressionar **Esc** | Sai do modo colisao | OK / Falhou |
| C5 | Pressionar **B** ou clicar em modo Pintar | Modo pintar ativo; paleta de assets aparece | OK / Falhou |
| C6 | Selecionar um sprite na paleta e clicar no canvas | Novo sprite e criado na posicao clicada | OK / Falhou |
| C7 | Pressionar **V** ou voltar ao modo Selecionar | Modo selecionar ativo | OK / Falhou |

### Bloco D - Build e emulacao (Mega Drive)

| # | Acao | O que esperar | Evidencia |
|---|------|---------------|-----------|
| D1 | Clicar em **Build & Run** na toolbar | Se toolchains nao instaladas: dialogo de instalacao. Se ja instaladas: build inicia | OK / Falhou |
| D2 | Se pedir instalacao: aceitar e aguardar | SGDK, cores Libretro baixados e instalados | OK / Falhou / N/A |
| D3 | Aguardar o build terminar | Barra de progresso ou indicador de conclusao; sem erro vermelho | OK / Falhou |
| D4 | Ver a aba **GM Jogo** | Emulador carrega a ROM; jogo aparece na janela | Screenshot do Game View |
| D5 | Aguardar 2-3 segundos | Jogo roda (sprites se movem ou cena estatica) sem crash | OK / Falhou |
| D6 | Clicar em **Pausar** no Game View | Jogo pausa | OK / Falhou |
| D7 | Clicar em **Continuar** | Jogo volta a rodar | OK / Falhou |

### Bloco E - Ferramentas e paineis

| # | Acao | O que esperar | Evidencia |
|---|------|---------------|-----------|
| E1 | Abrir o painel **Ferramentas** (Tools) | Painel lateral com abas (ex: Asset Browser, Memory Viewer) | OK / Falhou |
| E2 | Clicar em **Asset Browser** | Lista ou arvore de assets do projeto | OK / Falhou |
| E3 | Clicar em um asset de imagem e em **Instanciar** | Sprite e criado na cena ativa | OK / Falhou |
| E4 | Abrir o **Inspector** (painel direito) | Propriedades da entidade selecionada aparecem | OK / Falhou |
| E5 | Alterar um valor (ex: posicao X) no Inspector | Valor atualiza; viewport reflete a mudanca | OK / Falhou |

### Bloco F - Persistencia e fechamento

| # | Acao | O que esperar | Evidencia |
|---|------|---------------|-----------|
| F1 | Fazer uma alteracao na cena (mover sprite, criar camada) | Alteracao visivel no editor | OK / Falhou |
| F2 | Fechar o app (X ou menu) | App fecha sem erro | OK / Falhou |
| F3 | Reabrir o RetroDev Studio | Galeria ou ultimo projeto aparece | OK / Falhou |
| F4 | Abrir o projeto que foi editado | Cena carrega com as alteracoes salvas (camadas, sprites, etc.) | OK / Falhou |

---

## 3. CHECKLIST DE EVIDENCIAS PARA PROMOCAO RC

Preencha apos executar o roteiro. Todos os itens devem estar marcados para aprovar o RC.

### Gates automaticos (executados pelo dev/CI)

- [ ] `npm run check:tree` - OK
- [ ] `npm run lint` - OK
- [ ] `npx tsc --noEmit` - OK
- [ ] `npm test` - baseline vigente verde
- [ ] `cargo clippy -- -D warnings` - OK
- [ ] `cargo test --lib` - baseline vigente verde
- [ ] `npm run test:e2e:desktop:qa-rc` - report gerado em `src-tauri/target-test/validation/manual-qa-status.json`
- [ ] `npm run release:readiness:promotion` - report gerado em `src-tauri/target-test/validation/release-readiness.md`

### Evidencias do roteiro A-F

- [ ] Bloco A (onboarding) - todos os passos OK
- [ ] Bloco B (camadas) - todos os passos OK
- [ ] Bloco C (colisao/pintura) - todos os passos OK
- [ ] Bloco D (Build & Run Mega Drive) - todos os passos OK
- [ ] Bloco E (ferramentas) - todos os passos OK
- [ ] Bloco F (persistencia) - todos os passos OK

### Evidencias opcionais (ambiente com toolchains)

- [ ] Build & Run SNES - ROM compila e abre no emulador
- [ ] Smoke E2E desktop - `npm run test:e2e:desktop:md` e `:snes` passam
- [ ] MSI instalado em maquina limpa - app abre e onboarding funciona

### Bloqueadores conhecidos (nao impedem RC, mas devem ser registrados)

- [ ] `DevToolsActivePort` / `chrome not reachable` - E2E local falha; usar runner GitHub
- [ ] `spawn EPERM` no build - ambiente institucional; usar runner GitHub
- [ ] Toolchain nao instalada - usuario deve aceitar instalacao sob demanda

---

## 4. ONDE COLETAR ARTEFATOS

| Artefato | Local |
|----------|-------|
| Screenshot da janela inicial | Qualquer captura de tela |
| Screenshot da galeria | Tela de onboarding |
| Screenshot do editor | Hierarchy + Viewport visiveis |
| Screenshot do LayerPanel | Aba Camadas |
| Screenshot do Game View | Aba GM Jogo com ROM rodando |
| Report do roteiro A-F | `src-tauri/target-test/validation/manual-qa-status.json` |
| Screenshots automatizadas do QA RC | `src-tauri/target-test/validation/qa-rc-*.png` |
| Report de readiness | `src-tauri/target-test/validation/release-readiness.md` |
| Log de erro (se houver) | Console do app ou mensagem na UI |

---

## 5. CONTATO E ESCALACAO

- Em caso de crash ou erro bloqueante: anotar mensagem exata, passo do roteiro e screenshot.
- Erros de instalacao de toolchain: verificar espaco em disco e permissao de escrita em `toolchains/`.
- Duvidas sobre passos: consultar `docs/06_AI_MEMORY_BANK.md` (secao QA Roteiro) ou `docs/03_ROADMAP_MVP.md`.
