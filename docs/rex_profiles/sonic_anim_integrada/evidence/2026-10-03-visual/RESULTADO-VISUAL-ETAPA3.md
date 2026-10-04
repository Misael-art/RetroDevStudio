# RESULTADO-VISUAL-ETAPA3 — jornada retificada no binário final (2026-10-03)

Expectativas congeladas antes de implementar/executar:
`../EXPECTATIONS-VISUAL-ETAPA3.md` (commit `94f5fca`, sozinho).
Correção de produto: `932f2c6` (`app_lib::run()` define
`WEBKIT_DISABLE_COMPOSITING_MODE=1` em Linux antes do Builder — E3-0).
Adaptações de harness: `a0067d8` (E3-1..E3-4).

## corrida provada

- Cenario: `sonic-anim-integrada` pelo runner isolado
  (`runner-metadata-e3-run01.json`, SHA-256
  `d033263c741624702389d88bf34c70133926acb434e7969381a8d9978e87e15d`).
- Binário: SHA-256 `ce54d579381257364514c28833876127359edbaf61448726fee9709602ec7623`,
  construído em `a0067d8` limpo; proveniência no boot do app
  (`buildCommit a0067d8…`, `dirty:false`); nenhum commit entre build e execução.
- Ambiente SEM mitigação: `WEBKIT_DISABLE_COMPOSITING_MODE` ausente do
  processo do harness (E3-1 abortaria se ativa); Xvfb pinado
  `5bfd315a…`, tela 1920×1080×24, dpr 1.
- ROM base BYOR: `c7da53a1…` (531577 B), preservada byte a byte
  (`final.base_preservada`).
- Relatório: `report-jornada-retificada-e3-run01.json` (SHA-256
  `507c1250daa1dc7a5408858808111e190570394b1aa1e732ca2c7d8bc29ed23a`) —
  `allPass: true`, 28 checks, 0 falhas, 0 aborted; 10 passos congelados
  executados na mesma jornada.
- Log do runner: `desktop-e3-journey-run01.log` fica fora do repo
  (`.gitignore` de `*.log`); SHA-256 `898121f039d00b00e3fda52ca1e91b5c3b130788556f5369912ade7cd8ba16d2`,
  preservado em `~/rds-scratch/anim-e3-journey-20261003-01/desktop.log`.

## as cinco dimensões (separadas, como congelado)

1. **Integridade dos dados** — pintura 1 pixel com diff exatamente 2 bytes
   cumulativos (`passo3/`passo5), cadência 23→40 acumulada na mesma cópia,
   BPS export→apply reproduz a cópia byte a byte (`passo6`), ledger nomeia os
   dois domínios com SHA de cópia por entrada (`passo9.ledger_nomeia_os_dominios`),
   restauração seletiva devolve o byte $17 preservando o pixel (`passo10`).
2. **Apresentação visual** — E3-2: recorte do pixmap X11 da janela
   recriada, posição declarada do palco, comparado ao raster independente:
   **tentativa 1 já com 0 mismatches** e `canvas_matches_reference` true
   (magenta_fraction 0,57 = matte correto nas posições transparentes, o mesmo
   número do A/B da ETAPA 1). Captura arquivada:
   `capture-2026-10-03T21-23-15Z-e3-walk1-visivel-pos-reabertura-1.png`
   (SHA-256 `554eb5ff9ec1bf573124e3954447ee811a9fce8e5ac95c1075b3583853880027`);
   passo9 da jornada: `…-anim-integrada-passo9.png` (SHA-256
   `8e8e05a8af02fa26e3026e030447d53020fe6c13d3c8194efbdc4398099157e1`).
   Não-vacuidade (E3-3): o mesmo analisador reprova a captura defeituosa
   arquivada da ETAPA 1 (12258 mismatches > 0) e a referência recomposta é o
   bitmap medido no run-03 (`abbf2d5e…78ac`). O controle positivo offline
   (captura correta arquivada `a081b0be…`) bate 0 mismatches contra o mesmo
   esperado — calibração do gate ao vivo.
3. **Persistência** — salvar → destruir janela → reiniciar processo →
   reabrir do disco (`passo8` + `passo9.copia_reaberta_e_a_jornada`); banner
   de retomada coexiste com o fluxo explícito e cede quando a sessão viva é
   reaberta (`e34.banner_retomada_cede_apos_reabertura_explicita`); no
   diagnóstico, o remontage na mesma página hidrata a sessão viva pelo cache
   de módulo (contrato E2-7; ver "pendências").
4. **Execução no core** — "Jogar ROM modificada" com gate de identidade dos
   bytes carregados, reancoragem do contador, ack de start, avanço real de
   frames e framebuffer não reutilizado (6 checks `modificada-integrada.*`).
5. **Usabilidade humana** — NÃO declarada: nenhum participante até aqui;
   avaliação pertence à ETAPA 4. Nada neste run afirma usabilidade.

## veredito

O achado da ETAPA 1 (janela destruída/recriada nunca repinta o bitmap sob
compositor acelerado) está corrigido no produto: a jornada retificada passou
no binário final **sem** a mitigação de ambiente, com o sprite visível pós-
reabertura igual à referência independente na primeira captura, e o magenta
puro continuaria a falhar o gate (provado analiticamente contra a captura
defeituosa arquivada). Regressões preservadas: suites 930/0 (vitest),
850/0/80 (cargo test --lib), clippy/fmt/tsc/lint/check:tree verdes.

## pendências registradas (para ETAPA 4 / follow-up)

- A perna E3-4 do cenario de diagnóstico (remontagem hidratada) foi
  implementada mas só é exercitada em corridas do cenario
  `sonic-anim-visual-diagnostico`; a jornada integrada cobriu o seu
  equivalente (banner que cede). Pendente: rodar o diagnóstico no binário
  final se a perna for usada como evidência de PR.
- Risco aceito (E3-0): render por software em Linux; sem medição de
  regressão de fluidez na UI além do pump do core (que passou com folga).
- Limites: Linux-only; perfil `sonic1_sonic` Rev00 demonstrado permanece
  Experimental; sem merge/release/promoção; nada foi ampliado (codecs,
  variantes, animações).
