# ADDENDUM-A às expectativas congeladas da Etapa 5 — mudança de MECÂNICA, números intactos

Congelado e commitado ANTES de qualquer nova execução, em atendimento à regra do
documento original ("nenhuma mudança de semântica é feita sem novo congelamento
prévio"). Os NÚMEROS da tabela original (modas 24/41, recarga 0→byte, razão ≥
0,80, transições ≥ 5, cobertura ≥ 40 %, decremento-1 ≥ 80 %, modos distintos)
permanecem exatamente os de `EXPECTATIONS-ETAPA5.md`. O que muda aqui é somente
o instrumento de medição, porque a corrida 2 provou que o instrumento antigo é
estruturalmente incapaz de medir.

## Falha registrada da corrida 2 (2026-10-03) — evidência

- Binário no HEAD exato `32995c3` (SHA `0aff755b…`), ROM pinada `c7da53a1…`,
  Xvfb pinado `5bfd315a…`; `exit_code=1`.
- As 14 checagens de jornada anteriores ao sampler passaram na ordem: painel
  23/24, edição 40 com SHA independente `57026bd8…`, offset único `0x13BAE`,
  BPS exportado e aplicado byte a byte igual à mutação independente, salvar →
  destruir → recriar → reabrir restaurando 40/41/proveniência/pixels, base
  preservada até o jogo.
- O abortou foi o sampler ao vivo: `A amostragem da corrida base nao acompanhou
  os frames de tela: {"from":1500,"to":1967,"stoppedAt":1650,"samples":283}`
  (série bruta não persistida — o abortou ocorreu antes das métricas).
- Arquivos com hash (locais, não versionados):
  `src-tauri/target-test/validation/inspection-2026-10-03T04-07-35-935Z-cadence-journey/report.json`
  = `6b091d5b221407084430b960adb0b344e01f8d1e30f8eb747b06a85212f2e3bf`;
  `…/validation/desktop-e2e-failure-sonic-cadence-journey.json` =
  `9665e66845a433982fbb96969dc4dbe8eb80e4da786c323eabe3312512237f4c`;
  `/home/misael/rds-scratch/cadence-journey-20261003-02/desktop.json` =
  `dd7c176aecdae1dd896512f411f1844999c8e3155bf6833015c1dce6297bc541` (cópia
  preservada em `…/evidence-run2/`).

## Causa-raiz (verificada em código, não presumida)

1. O contador exposto à página (`data-rendered-frames`) é quantizado de 10 em
   10 frames por design (`ViewportPanel.tsx:1524`, `setState` só a cada
   `counter % 10 === 0`). Gaps de 24 vs 41 frames são indistinguíveis por esse
   contador, e a detecção de recarga "timer 0 → byte" exige observar TODOS os
   frames individuais — impossível do lado da página com esse sinal.
2. O pump do Game View execa exatamente 1 frame por `emulator_run_frame` a cada
   ~16 ms (`emulatorService.ts::startFrameLoop`). Cada leitura de memória por
   IPC serializa com esse pump; a taxa observada (283 amostras para ~150 frames
   em ~28 s, deadline de 30 s do WebDriver atingido) confirma que amostrar por
   frame do lado da página destrói a própria vazão que pretende medir.

## Mecânica substituta (números e gates ao vivo preservados)

- **Gates ao vivo na Game View permanecem**: `Jogar ROM base`/`Jogar versão
  modificada`, gate de identidade (`data-rom-sha256`/`data-rom-size`), Enter
  nativo segurado ≥ 30 frames de tela, avanço de ACK, negativo KeyQ, frame
  buffer não reutilizado entre corridas, ≥ 10 frames de tela após a primeira
  observação (medidos no contador quantizado — múltiplos de 10 continuam
  atendendo ao limiar). O sampler RAF de memória é REMOVIDO.
- **Números de cadência passam a ser medidos no core** por uma nova
  `emulator_run_frames_sampled` (comando que mantém o mutex do core tomado
  durante o lote, execa `run_frame` 1:1 e grava por frame a janela de memória
  pedida — mesma família dos `emulator_run_frames`/`emulator_observe` já
  usados pelos botões "Observar ROM base/aplicada" da própria barra).
- **Rota replicada exatamente como a Etapa 4** (frame-indexada, sem
  presunção): `emulator_load_rom(rom)` → `emulator_run_frames(900)` →
  `emulator_send_input(START)` → `emulator_run_frames_sampled(2, janela)` →
  `emulator_send_input(neutro)` → `emulator_run_frames_sampled(1999, janela)`;
  total 2901 frames; START pressionado nos frames 900–901 (route 900..902 da
  Etapa 4). Janela de amostragem: região 2 (WRAM), offset 0xD000, length 0x40,
  gravada a partir do frame absoluto 1500 (índice = `frame_index()` do próprio
  core, contado desde a carga).
- **Re-anchor reformulado com o mesmo rigor**: o índice do primeiro sample deve
  ser exatamente 1500, os frames devem ser consecutivos sem buraco
  (1401 amostras até 2900), e a ROM observada deve ter SHA igual ao artefato da
  jornada (base: `c7da53a1…`; modificada: `.bin` aplicado pelo BPS da UI,
  `57026bd8…` nesta linha de código). Cada artefato ancora no seu próprio 0.
- **Candidato do jogador**: re-verificação por dados inalterada
  (decremento-1 ≥ 80 % entre amostras adjacentes com `anim == 5`; ≥ 3 recargas
  0 → byte; cobertura `anim == 5` ≥ 40 % da janela) — agora computada sobre
  pares de frames estritamente adjacentes (delta 1 por construção).
- **Ordem da etapa 5 da jornada**: jogar base (portões ao vivo) → jogar
  modificada (portões ao vivo) → pausar via botão nativo `viewport-pause`
  (para o pump; sem intercalação de frames com a observação) → observar base no
  core → observar o `.bin` modificado pela UI no core → checagem discriminante
  dos modos → base em disco inalterada. Persistir as duas séries brutas junto
  do relatório, como na corrida 1/2.
- O retorno do novo comando inclui identidade lida do próprio core
  (caminho/SHA da ROM carregada, frames antes/depois), para o gate de
  identidade da observação não depender de presunção do driver.

## O que NÃO muda

- Nenhum número da tabela original; nenhuma recusa de pipeline; nenhum gate de
  UI; nenhuma promessa de maturidade. Veredito continua allPass somente com
  todos os portões acima na ordem; qualquer desvio numérico ⇒ FAIL/INCONCLUSIVE
  registrado com a série bruta persistida.
