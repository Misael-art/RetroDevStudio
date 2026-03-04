# 03 - ROADMAP MACRO & MVP TATICO
**Status:** Documento vivo
**Ultima revisao canonica:** 2026-03-04
**Fase ativa real:** Hardening do fluxo `Build -> ROM -> Emulacao` ja validado em Windows com upstream real e em runner GitHub/Windows real

> **DIRETRIZ PARA AGENTES DE IA**
> Este roadmap precisa refletir estado real do codigo, nao claims historicas.
> Se uma feature existe no repositorio, mas ainda depende de repeticao institucional/CI ou de cobertura complementar por target, ela deve ser tratada como `validada, em hardening`.
> Nenhuma fase ou etapa pode ser considerada `realmente fechada` sem certificacao real: caminho canonico funcional, gates aplicaveis verdes, prova correspondente no fluxo afetado e ausencia de erro bloqueante no escopo certificado.

## Semantica de status

- `Implementada em codigo`: existe no repositorio, mas ainda nao possui certificacao real suficiente.
- `Validada`: existe prova funcional real no escopo afetado, mas ainda pode depender de repeticao institucional, cobertura complementar ou endurecimento adicional.
- `Em hardening`: ja passou por validacao real, mas ainda nao deve ser tratada como definitivamente fechada.
- `Concluida e verificada`: so usar quando o caminho estiver certificado de forma real, sem erro bloqueante no escopo, sem gate vermelho e sem divergencia entre docs/UI e backend.
- `Experimental`: superficie visivel, parcial, congelada ou ainda incapaz de sustentar claim de entrega real.

---

## Estado Real em 2026-03-03

### Ja implementado em codigo
- Editor Tauri + React + TypeScript funcional.
- Schema canonico de projeto/cena, fixtures dummy e testes Rust.
- Build orchestration real por target (`megadrive` e `snes`) com erro explicito sem toolchain.
- Emulacao integrada por Libretro real via FFI no Rust.
- Instalacao sob demanda de SGDK, PVSnesLib e cores Libretro oficiais no Windows.
- Caminho SNES com staging de asset real e workspace compativel com `snes_rules`.
- Baseline de CI com GitHub Actions para `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `cargo clippy -- -D warnings`, `cargo test --lib` e `npm test`.
- Validacao oficial upstream em Windows com SGDK, PVSnesLib e cores Libretro reais via `scripts/validate-upstream-windows.ps1`.
- E2E de aplicacao desktop/Tauri via `scripts/e2e-tauri-build-run.mjs` para `Build -> Load ROM -> Run frames`.
- Workflow dedicado `.github/workflows/desktop-e2e.yml` validado em runner GitHub/Windows real para Mega Drive e SNES.
- Pause/resume do viewport preservando o core Libretro, autosave fresco no hierarchy e persistencia atomica de projeto/cena.
- Features ainda parciais agora ficam explicitamente marcadas como `Experimental` na UI para nao mentir sobre prontidao.

### Ainda em hardening
- Repeticao institucional do fluxo oficial em Windows quando build/emulacao/toolchains forem alterados.
- Decisao final de governanca do workflow desktop dedicado (`push`/`pull_request` path-filtered, `workflow_dispatch`, `workflow_call` ou gate protegido).
- Auditoria residual de UX para handlers async fora do endurecimento ja aplicado em abertura de projeto e salvamento no inspector.

---

## FASE 0 - FUNDACAO
**Status:** CONCLUIDA E VERIFICADA

- [x] Scaffold Tauri + React + TypeScript + Vite.
- [x] Estrutura de pastas alinhada com `08_TREE_ARCHITECTURE.md`.
- [x] Backend Rust organizado em modulos.
- [x] Frontend com store, IPC e layout base.

---

## FASE 1 - CORE MEGA DRIVE
**Status:** VALIDADA EM WINDOWS, EM HARDENING

### Entregas implementadas
- [x] Parser/manager canonico para `project.rds` e `scenes/*.json`.
- [x] AST UGDM -> C para SGDK.
- [x] Build workspace real com `main.c`, `resources.res`, `Makefile` e deteccao de ROM.
- [x] Hardware validation para Mega Drive.
- [x] Emulacao Libretro real para ROM externa e ROM gerada.
- [x] Instalacao automatica sob demanda de SGDK e core Libretro de Mega Drive.

### Gate obrigatorio para considerar a fase realmente fechada
- [x] Validar em Windows o fluxo `instalar SGDK -> Build & Run -> ROM abrindo em core Libretro oficial`.
- [x] Registrar evidencias dessa validacao no `06_AI_MEMORY_BANK.md`.

---

## FASE 2 - ABSTRACAO SNES
**Status:** VALIDADA EM WINDOWS, EM HARDENING

### Entregas implementadas
- [x] Target `snes` no schema/projeto.
- [x] Hardware profile SNES com regras alinhadas ao exporter atual.
- [x] Emitter SNES e workspace PVSnesLib com `main.c`, `hdr.asm`, `data.asm` e regras de conversao de assets.
- [x] Staging de asset real para `.bmp` no caminho SNES.
- [x] Instalacao automatica sob demanda de PVSnesLib e core Libretro de SNES.

### Gate obrigatorio para considerar a fase realmente fechada
- [x] Validar em Windows o fluxo `instalar PVSnesLib -> Build & Run -> ROM abrindo em core Libretro oficial`.
- [x] Confirmar o caminho com shell Unix-like suportado e registrar prerequisitos oficiais.

---

## FASE 3 - VISUAL LOGIC & RETROFX
**Status:** IMPLEMENTADA NO EDITOR, CONGELADA ATE FECHAR VALIDACAO DO CORE

- [x] NodeGraph UI e compilador frontend existente.
- [x] RetroFX UI existente.
- [x] RetroFX rotulado como `Experimental` enquanto nao persistir/exportar efeito real.
- [x] Testes frontend existentes e passando.
- [ ] Retomar evolucao apenas depois que o hardening do core e a cobertura desktop multi-target estiverem estabilizados.

---

## FASE 4 - CAMADA PRO
**Status:** IMPLEMENTADA NO EDITOR, CONGELADA ATE FECHAR VALIDACAO DO CORE

- [x] Patch Studio.
- [x] Deep Profiler visivel, mas travado como `Experimental` ate gerar relatorio real.
- [x] Asset Extractor visivel, mas travado como `Experimental` ate extrair assets reais de forma confiavel.
- [ ] Retomar expansao apenas depois que o pipeline oficial validado estiver institucionalizado em workflow repetivel.

---

## Ordem Executiva Atual

1. Manter o CI baseline verde antes e depois de qualquer fix relevante.
2. Tornar a validacao oficial upstream repetivel e institucional para mudancas sensiveis.
3. Decidir se o workflow desktop dedicado permanece em `push`/`pull_request` path-filtered ou migra para gate manual/ambiente protegido.
4. Auditar handlers async residuais fora de `App.tsx` e `InspectorPanel`.
5. So depois disso avaliar novas expansoes do desktop E2E sem contaminar o `ci.yml` comum.
6. So depois disso destravar novas iteracoes de editor, ferramentas e targets futuros.

---

## Regra de Atualizacao

- Marque `[x]` apenas quando houver codigo funcional e validacao correspondente.
- Nao use `[x]` para simular progresso quando a prova ainda for mock, stub, output parcial ou fluxo paralelo ao canonico.
- Se a validacao ja ocorreu, mas ainda depender de repeticao institucional ou cobertura adicional, marque como hardening e nao como totalmente encerrada.
- Se houver erro bloqueante conhecido, regressao aberta ou evidencia insuficiente, rebaixe o status em vez de manter claim otimista.
- Sempre atualize este arquivo junto de `06_AI_MEMORY_BANK.md` quando o status do produto mudar.
