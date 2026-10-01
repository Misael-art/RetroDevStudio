# 06 - AI MEMORY BANK & CONTEXT TRACKER

### Checkpoint 2026-09-30 (o) — MUGEN: **cadeia original do Ken (Stand_X) convertida da fonte e comparada com referência independente** (Experimental mantido)

Frente `codex/rex-mugen-original-chain`, dependente de `codex/rex-mugen-real` (PR #90 @ `508db51b20c701f61a8fcdbc9bf43a642d28fa3c`);
PR dependente publicado sem merge/release. Detalhe, auditoria com arquivo:linha, tabela operação → implementação → teste → resultado → limite em
`docs/rex_profiles/mugen_sgdk/ORIGINAL_CHAIN.md`; hashes e números em `ORIGINAL_CHAIN_EVIDENCE.json`; contrato em `crates/rex-mugen/CONTRACT.md` («Cadeia original»).
Conserve (i)–(o) na integração futura (`0194f94` continua fora da base).

**Cadeia.** `ken.cmd:963` `[State -1]` (comando `x`, `command != "holddown"`, `statetype = S`, `ctrl = 1`, reentrada `stateno = 200` + `time > 5`) → `ken.cns:285` Statedef 200
(`ctrl 0`, `velset 0,0`, `anim 200`) → AIR 2+2+2 → `ken.cns:343` `ChangeState 0 ctrl 1` em `AnimTime = 0`. **`common1.cns` não existe** (pacote nem máquina): o estado 0 é um
**stand-in autoral declarado**; HitDef, PlaySnd, poweradd, juggle, movetype, physics e 55 dos 56 controladores do `-1` ficam **não convertidos**, listados com origem e motivo.
Estado 200 = parcial; estado 0 = autoral. Nenhuma instalação externa foi presumida equivalente.

**Produto.** `core/mugen_chain.rs` (subconjunto mínimo e reutilizável: comandos de 1 elemento, gatilhos simples, `ChangeState`, `Statedef type/ctrl/anim/velset`), nó
`mugen_state_program` (programa como string JSON + digest que cobre o mapeamento de fonte; adulterar bloqueia o build), runtime `rds_mc_<v>_*` na ordem comandos → −1 → estado
atual → rastro → avanço, anel de rastreio na RAM (pad amostrado, estado, `vtimer`), revisão de origem na UI (4 classes: convertido/aproximado/autoral/não convertido), opção
`original_chain` + escolha de cadeia no assistente. `authored_visual_demo` segue padrão. O editor de grafos só conhece parâmetros string/número e rejeitava tipos
desconhecidos (corrigido, com teste).

**Prova.** Referência independente `scripts/verify-mugen-chain.py` (lê CMD/CNS/AIR sozinha, lógica de 3 valores sobre todos os controladores do `-1`/`-2`, alimentada pelo pad que a ROM amostrou):
**0 divergências** no core direto (197 ticks) e na UI real com teclado nativo (336 ticks), 7 controles negativos recusados, 184/295 quadros de pixels idênticos ao Pillow
(defasagem 0 vblank pelo `vtimer`; 1 tick = 1 vblank). Toque → 1 ataque de 6 ticks; segurar → 1 ataque; 2º toque cedo ignorado; `Time = 6` reentra; X+baixo não ataca.
Fluxo UI: importar → revisar origem → salvar → reiniciar → reabrir (relatório e digest idênticos; editor de grafos intacto) → Build & Run → teclado nativo. Instâncias independentes
provadas na ROM real. Negativos: dependência ausente, condição não suportada, comando incorreto/ausente, mapeamento adulterado, estado ambíguo/animação ausente.

**Caminho de input.** Sem lotes: `emulator_run_frame` quadro a quadro (core de debug ≈ 10,6 quadros/s); os «dez ticks» vinham do harness (duas requisições + polling ≈ 1 s). Entrega pode cair
no quadro em curso ou no seguinte; semântica de comando = borda (segurar não repete). **Limitação medida, não corrigida:** o joypad é nível, não fila: 1 de 9 toques nativos (6 ms) se perdeu;
recomendação: latch de 1 pressão por quadro em `emulator_send_input` (afeta todos os cenários; fora desta frente).

**Regressões e gates.** Reexecutados no binário final (app `2f8457a9432b1fee7cf595ad9d6fe61546a752b1dda43a3fe541a21c06bdb39d`): `mugen-real` + oráculo Pillow (204/211 quadros), `mugen-import`,
`mugen-control`, `mugen-locomotion`, strider real e provas reais da cadeia. `mugen-real` falhou 2× sob carga do host (flutuação do harness) antes de passar sem mudança de código. Gates: tree, lint, tsc, fmt,
clippy `-D warnings`, frontend 831/0/6, Rust 832/0/75, `crates:gates` 4 pacotes. ROM UI `028158917e7cb847276b7f536204424fed6f743548b53034332398fbfc47d513`,
ELF `ad21039b6677685719cd0b0f4da90fa0218cbc75231b26cdd7891b1af3e02d6d`; ROM backend `c421c92d5065e4d8ff8de22aa3541e3b5d4795e27f249190f2a0959cbc6ae666`; programa `87cbd0bbee56468bc12db16790deaffbdabd5609841996526917f9eeefb58a14`;
core Genesis Plus GX v1.7.4 `46a5521` (`07c10476…`). CI por SHA: consultar no PR.

**Não provado:** conversão integral do Ken, colisão/dano/combate, facing, andar/pular/agachar (dependem do `common1.cns`), fidelidade ao motor MUGEN real (nenhum runtime original executou; borda do botão simples e `buffer.time` padrão não confirmados na doc primária), PAL, tempo real.

### Checkpoint 2026-09-30 (n) — Ken Majik real: triagem, revisão visual e cadeia SGDK → ROM → core → UI comprovadas (Experimental mantido)

Frente isolada `codex/rex-mugen-real`, dependente de `codex/rex-mugen-locomotion`
@ `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` (PR #87 confirmado aberto,
base UX v2 `d1b5a4d2bc37d4a9d3c78ea708b899ed44a38d7a`). Worktree
`/home/misael/Projects/REX-MUGEN-REAL-2026-09-30`; checkout canônico e seus
arquivos não rastreados preservados. `0194f9465e759a3ba3d6fae84b4f5aef0576a4af`
continua fora da base: conservar (i)–(n) na integração futura. Sem merge/release.
Matriz única, comparação Forge → RetroDev, limites e reprodução em
`docs/rex_profiles/mugen_sgdk/REAL_MISSION.md`; manifesto completo de hashes
e metadados em `REAL_EVIDENCE.json`, sem pixels/ROM/corpus BYOR no Git.

**Fonte e diagnóstico.** Operador autorizou expressamente `Ken_Majik_.zip`,
SHA `b244ec9a105fa0131b37c075dc06b032a87cf0f839f46ec7054ac60d9bd6f14c`;
`ken8.def`, SFF v1.0.1.0 com 201 sprites, AIR 102 ações, `ken1.act`;
`common1.cns` ausente e introdução absoluta registrados. Consulta Forge
somente leitura, licença MIT conferida, sem transplante/preparo do doador.
Pillow PCX independente confrontou os 201 índices/paletas com Rust sem
divergência: a primeira falha era **ACT ignorada**, não decoder. Outra falha
na fronteira BMP/tiles perdia 172 pixels de preto opaco no idle por associar
RGB preto ao índice de máscara 0; corrigida e coberta por regressão.
Corrigidos também pares numéricos escalares que causavam panic e orçamento
que contava atlas inteiro residente apesar do streaming SGDK existente.

**Produto.** Triagem Rust reutilizável anterior à conversão: DEF inequívoco,
duplicados/case/referências ausentes ou ambíguas, versões, inventário de
sprites/ações/controllers e localização; digest conferido novamente ao
importar. Seleção ACT/ações explícita, fonte intacta e derivados rastreáveis.
Wizard canônico recebe revisão com miniaturas reais, ação/quadro, original e
RGB333 na mesma escala, checker, eixo opcional e duração AIR; escolhas,
relatório e pixels reabrem. Stage/screenpack continuam na rota existente.
Piloto seleciona 0/20/21/200, 21 elementos AIR/18 células, 104×104, âncora
(51,98), durações 6/5/2; 15 cores opacas, zero fusões e sem redução de resolução.
**CNS original não convertido:** modo `authored_visual_demo` explicitamente
rotulado, grafo/controllers originais preservados como referência, facing
fixo à direita, sem acerto/dano/colisão. Nenhum flip nas ações selecionadas.

**Aceite real.** UI Tauri: selecionar/analisar/inspecionar/importar → editar
VelSet do estado 20 (2,5 → 1,5) → salvar/encerrar/reabrir → Build & Run oficial
→ teclado nativo →/←/Z, acks mesma sessão/seq → core/canvas integralmente
iguais. App `9b602ff3519f179804722da1f3ba3b35d28bdb1deeb2fb3d646c7a29d4ce5d36`;
ROM UI `0e8af2eb8015beb6830b5074f8ed52e8537d4e9bf86f48d023d9d27f8febe6fe`;
ELF `6e3eae8d525cbe1361c3d70812998122fabfbb6c6dee8bf302ab359a020b7fec`.
Core oficial Genesis Plus GX v1.7.4 `46a5521`, hash
`07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1`.
Oráculo externo independente passou em 21 prévias, 27 frames compilados por
projeto, 204 core e 212 UI: pixels/máscara, geometria, ordem e ticks exatos;
paleta/sprite/eixo/flip/imagem antiga alterados são recusados. Galeria de
mesma pose fonte/prévia/core/UI e sequência GIF inspecionadas, locais em
`~/.retrodev/mugen-real-2026-09-30/oracle/`.
UI mede caminhada 384/256, volta −448/256, paradas imóveis. Solicitação de
toque nativo foi observada em lote de 10 ticks: **dois** ataques completos
de 6 ticks, idle entre eles e depois; comando autoral de nível pode repetir
enquanto pressionado. Backend de um tick prova um ciclo. Não alegar input
instantâneo/um único ataque na UI. Curva RGB565 do core verificada pela fonte
imutável `46a55214d0dab654e5a525ae0c54921ca9716872`, separada da prévia RGB.
Custos compilados: 96 tiles/3.072 B residentes, até 8 peças, pico 4 peças e
104 px/scanline, até 3.072 B de tiles por troca. CPU/DMA temporal, hardware
físico, PAL e FPS real não medidos; warning conservador permanece.

**Validação.** `mugen-import`, `mugen-control`, `mugen-locomotion` verdes no
mesmo app; 14 processos próprios por cenário, 0 vivos. Gates: tree, lint,
tsc, fmt, clippy `-D warnings`, frontend 828/0/6 (834), Rust 818/0/72 (890),
`crates:gates` quatro pacotes, syntax harness e oráculo. Patch transitivo
único `brace-expansion` 5.0.9 → 5.0.12 remove vulnerabilidades altas; audit
no limiar high passa com quatro moderadas Vitest registradas como dívida de
teste. RustSec passa com oito avisos informacionais herdados, cadeias e IDs
registrados no documento de missão; nenhuma dependência Rust nova/alterada.
Licenças reexecutadas (334 npm/499 Cargo/15 toolchains). Host READY,
fingerprint `60249508aff61897cdd43160d4716b2344d69282507a36c5a457c0028143f6e2`.
`host:certify` passou: READY, frontend 831/0/3 com ambiente oficial habilitado,
Rust 818/0/72 e validação upstream Linux SGDK/PVSnesLib/core `success: true`.

Commits de produto `90481e7d50b047ff0711d09290abbfe2b6269041`, QA
`44a850c8e11b14d178683129dbb3ff9a454b2a99`, segurança
`23df72290ccdf29acbe5322756c35979d9af23f0`. Publicar PR dependente da branch
de #87, consultar CI pelo SHA final (não presumido neste checkpoint).
Esta prova é do piloto delimitado; não promove suporte geral MUGEN nem maturidade.

### Checkpoint 2026-09-29 (m) — MUGEN UX v2, lote 4: **locomoção horizontal por `VelSet` (x constante, Q8.8) importada, editável e comprovada na ROM** (Experimental mantido)
Rama `codex/rex-mugen-locomotion` (dependente de `codex/rex-mugen-ux-v2` @ `d1b5a4d`, CI verde por SHA). `0194f94` (checkpoint (i), só docs) segue fóra das duas ramas: conservar (i), (j), (k), (l) e (m) na integración sen duplicar.
**Subconjunto** (contrato completo em `crates/rex-mugen/CONTRACT.md`, «Locomoção horizontal»): `VelSet x = N` / `value = N[, 0]`, `N` literal decimal, `trigger1 = 1`; px por tick (1 tick = 1 quadro emulado), x+ = direita, facing fixo à direita, Q8.8 com arredondamento ao mais próximo, deslocamento = `floor(Σ vx_q8/256)`; estado sen `VelSet` mantém a velocidade. Recusado com motivo (`unsupported`, sen ligar o nó): expressão/`const()`, outro gatilho, y≠0, x omitido, parámetro extra, fóra da faixa. **`PosAdd`/`PosSet`/`VelAdd` seguen fóra.**
**Cadea:** CNS → `parse_velset` → nós `set_velocity` de perfil (corpo + entrada) no grafo da entidade (persistido em `graph_ref`) → Inspector («Velocidade dos estados», px/tick, aviso de arredondamento, diagnóstico) → `LogicOp::MugenSetVelocityX` → runtime (`vx`/`xacc` por entidade). **Corrixido:** a máquina de estados era global (`fsm_state`); agora `fsm_state_<entidade>` (duas entidades con FSM non compartían estado por accidente).
**Prova nova.** Rust: 7 testes de produto + `mugen_strider_real_build_run_locomotion` (ROM/core reais, 195 quadros, 0 divergências vs contrato). Desktop `mugen-locomotion` (build final: app `f74e17be99abdf19a095d778dafa96f27edfdb72d4865a7787003def1fc24796`, `dist/index.html` `ad9b20abad2ffc865376095121a1ebbf1fc74b308bf610953604b039d8888ac0`, ROM `fda7472c023fca6e29cbb6678963ed9e032bdc41b0b71dd4071437b357246fc9`, ELF `b20bbd08d430b62ce3dbc19e22bf910c345ac067ce148c0dfa894377e21632a8`, fixture `strider.*` em `mugen-locomotion-2026-09-29T19-01-27-240Z-report.json`; 480 quadros): importar → relatório (4 VelSet `direct`) → digitar velocidade (`x`, `const(...)`, `200` recusados; `2.4` com aviso; **2.5 → 3.75**) → duplicar (2ª entidade parada) → salvar → reiniciar → reabrir → Build & Run → teclas nativas: sen input parado em x=96; Right e Left deslocam; troca Right→Left segurando; soltura → idle com posição constante; velocidade editada (960/256) e não editada (−448/256) batem **em todos os quadros** (0 divergências; x final 204 = esperado 204); animação 4/6 ticks independente da velocidade (19 trechos); ataque 3/8; outra entidade em x=288 intacta (visual e RAM); RAM em repouso = visual. Negativo: import con `x = const(...)` recusado e visível.
**Regressões reexecutadas no mesmo código (verdes; hash do app por execução, o build muda o hash):** `mugen-import` app `d00dcc3bbb2fccbd6d90731a5930ab17218cfc4a283cdf291bbb36ec700faeec`, ROMs `9108cb9a…` (idle 5/9) e `8e7e4a22…` (20/9); `mugen-control` app `567c94879d1757e7eefc5c4409f5f6003c85fe07676c844d094026d5e4b20408`, ROM `3c1fc3e8…`. Detalhe: `mugen-import` (relatório reabrível, 5/9 → 20/9), `mugen-control` (ataque por teclado, duração 4→12), coerência das duas representações (testes Rust), encerramento de sesións en sucesso e falla controlada (14 procesos acompañados, 0 vivos). A repetición da dixitación do Inspector agora é o helper `typeIntoInputAndExpect` (≤3 tentativas registadas; só acepta campo = texto dixitado + evidencia específica); nas execucións deste lote todas as entradas foron aceitas na 1ª tentativa; a causa do timeout antigo segue **sen atribuír**.
**Limitações:** PAL non medido; tempo real non certificado (core de debug ≪ 60 fps; medida en quadros emulados); sen colisión, límite de pantalla, chan, física, facing nin combate; fixture usa `command = 5` (neutro, extensión RetroDev); só un personaxe/fixture; SFF v2/son/stage fóra. Non se consultou o SGDK Forge nin se copiou código seu; a semántica de `VelSet` segue o coñecemento do MUGEN, sen cópia de documentación.

### Checkpoint 2026-09-29 (l) — MUGEN UX v2, lote 3: **coerência de duração no backend, limpeza própria do harness e personagem importado controlado pelo teclado** (Experimental mantido)
Rama `codex/rex-mugen-ux-v2` sobre `916da06` (CI de `916da06`: `CI` e `Desktop E2E` ainda `in_progress` na última consulta — não presumido; consultar por SHA). `0194f94` (checkpoint (i), só docs) segue fóra da rama; conservar (i), (j), (k) e (l) na integración sen duplicar.
**1. Coerência.** `mugen_anim_table` valida `frame_durations` × `mugen_frames[].duration` na geração: valor diferente ou comprimento diferente **bloqueia o build** (`#error`) com animação, quadro e valores; legado sen `frame_durations` usa `mugen_frames` só na geración (proxecto nunca reescrito); Inspector mostra o conflito e non edita. Testes Rust novos (5 unitarios + regresión de divergencia ponta a ponta); a proba 5/9 → 20/9 reexecutada verde. Política em `crates/rex-mugen/CONTRACT.md`.
**2. Limpeza do harness.** Falla real: a 2ª instância do app (após reiniciar) escapaba ao `finally`. Agora o harness acompanha sesións e PIDs (starttime de `/proc`), fecha todas as sesións no `finally`, espera limitada, SIGTERM→SIGKILL só a PIDs seus. Prova: sucesso e **falla controlada** (`RDS_E2E_INJECT_FAILURE=after-restart`) com 14 procesos acompañados (driver, driver nativo, as 2 instâncias do app e filhos), 0 vivos, confirmado por `ps` externo.
**3. Controle pelo teclado** (`--scenario mugen-control`, fixture autoral `walker`; app `83933a2e…`, frontend `dist/index.html` `75038b65…`, ROM `5b152a96…`, ELF `0a32e7a2…`, fixture `walker.{def,air,cmd,cns,sff}` sha em `mugen-control-2026-09-29T14-43-50-116Z-report.json`): importar → compatibilidade (sprites/animações/comandos/estados direct; colisões/som/stage ausentes) → duração da caminhada 4→12 pelo Inspector (`0` recusado, «Mantido: 4») → salvar → reiniciar → reabrir → relatório reaberto → Build & Run (ROM em execução = compilada) → foco → ArrowRight/KeyZ **nativos**. Observado: intenção e ack da mesma sessão/seq; sen input, idle o tempo todo (RAM=0); segurando →: verde **12**, azul **6**, gap de idle 1 tick, RAM=animação de caminhada; solto: volta ao idle; KeyZ: hitA **3**, hitB **8** uma só vez, RAM=animação de ataque; sen input outra vez: idle. Ação declarada como «animação de ataque».
**Prova herdada:** relatório reabrível, 5/9 → 20/9 (`mugen-import` reexecutado no binário do lote, verde). **Limitações:** **sen movimento de posición** (VelSet/PosAdd non convertidos; borda esquerda constante); só comando direção segurada e botão; sen acerto/dano/colisão; PAL e tempo real non medidos (core de debug ≪ 60 fps; medida em quadros emulados); leitura de RAM dependente do símbolo `rds_mugen_<v>_anim` no ELF; SFF v2/som/stage fóra.
Gates: `check:tree`, `lint`, `tsc`, `npm test` 821/0/6, `cargo fmt --check`, `clippy --lib` e `clippy` `-D warnings`, `cargo test --lib` 803/0/70, `crates:gates` (4 pacotes), `node --check`.

### Checkpoint 2026-09-29 (k) — MUGEN UX v2, etapa 2: **tempo por quadro editável no Inspector, em ticks de 1/60 s** (Experimental mantido)
Rama `codex/rex-mugen-ux-v2`, sobre `2522569` (CI `CI` + `Desktop E2E` `success`, consultado por SHA). **Integração futura:** `0194f94` (checkpoint (i), só docs) está fóra desta rama (`0194f94...HEAD` = 1 vs 1); conservar (i) e este (j)/(k) ao integrar, sen duplicar nin reescrever historia.
**Achado da auditoria** (unidades em `crates/rex-mugen/CONTRACT.md`, «Unidades de duração»): a duración é por elemento, em ticks de 1/60 s (`-1` = parado; gerador aceita `-1|1..=255`); o Inspector expunha só «Animacoes (FPS)», campo que **não altera a ROM** das animações MUGEN. Agora: animações MUGEN mostram «Quadro N (ticks)» (ajuda para iniciantes, `= s`), gravando `frame_durations[i]` **e** `mugen_frames[i].duration` só do quadro editado; entradas `0`, `<-1`, `>255`, vazias ou não inteiras dão diagnóstico com «Mantido: N» e não mudam o estado; sen ação que uniformice. Animações nativas seguem com FPS.
**Prova nova** (`--scenario mugen-import`, pela UI: importar → editar → salvar → encerrar → reabrir → Build & Run; binário `c44f5305…`, `dist/index.html` `f8c27a72…`): idle `action_0` 5/9 ticks; editado o quadro 1 para 20 → ROM `9b521159…` → `5f75177a…`; **medido no core em quadros emulados** (cada `putImageData` do viewport = 1 quadro): original 5/9 (23 e 22 trechos, todos exatos), editado 20/9 (10 e 11 trechos, todos exatos), 0 trechos fora; `action_200` 3,6,4,2 intacta no disco; valores recusados `0`, `-2`, `x` mantêm 20; relatório MUGEN reabrível. Instância pós-reinício encerrada.
**Limitações:** em ms de parede o core de debug roda ~7× abaixo do tempo real no harness (razão 0,548 ≈ 5/9 correcta) — por isso a medida é em quadros; um só personagem/animação (probe), não é suporte geral a animações MUGEN; `frame_durations` vs `mugen_frames.duration` sen conferência no gerador; PAL não medido. Gates: `check:tree`, `lint`, `tsc`, `npm test`; Rust não tocado (gates Rust não reexecutados).

### Checkpoint 2026-09-29 (j) — MUGEN UX v2, etapa 1: **relatório de compatibilidade reabrible** (Experimental mantido)
Rama `codex/rex-mugen-ux-v2`. Novo menú Projeto → «Relatorio MUGEN» (`menu-action-mugen-report`) reabre o panel a partir de `assets/mugen/<id>_import_report.json` no disco (`showMugenCompatibility(dir, true)`), sen depender do estado da sesión que importou; «Fechar» limpa o estado. Sen relatorio → aviso explicativo. Proba: `npm test` 813/0/6, E2E desktop `--scenario mugen-import` verde co paso novo `report_reopened_after_restart` (importar → reiniciar app → reabrir proxecto → menú → mesmas categorías, totais e perdas que o panel da importación e que o JSON gravado). Fóra de escopo (non iniciado): SFF v2, son, stage, comandos de golpe.

### Checkpoint 2026-09-29 (h) — integrador, **PR #85 MUGEN → SGDK integrado na árbore do integrador: importación de personaje, panel de compatibilidade e edición persistente probados na UI** (Experimental; publicado como PR #86 sen merge, sen release, sen promoción de maturidade)

**Estado real desta superficie.** O produto acepta **un** caso de uso MUGEN:
importar un personaje do subconxunto `air` + `sff v1` + paleta nivel VDP +
`cmd`/`cns` lidos como perfis, e levalo a ROM real por Build & Run. O degrau
declarado en `crates/registry.json` para `rex-mugen` é
**`gates-proprios-aprovados`** — non se subiu a `backend-integrado` nin a
`fluxo-do-usuario-comprovado` neste checkpoint, porque a promoción é decisión
do operador; o que existe é evidencia. Todo o fluxo permanece etiquetado
`Experimental` no informe do E2E e na UI.

**Commits desta célula:** `b410de0` (merge curado do PR #85 sobre o tronco do
integrador; pais `e319fb9` + `bd02e3c`; índice de 72 ficheiros, +7910 / −88) e
o commit de curaduría que rexistra esta célula (reescribe a entrada `rex-mugen`
de `crates/registry.json`, emenda `docs/rex_profiles/ROUND_STATE.md` e reforza
unha aserción do harness). **O PR #85 mantense draft no remoto: non se fixo
merge del, nin release, nin promoción de maturidade, e non se lle engadiu
comentario ningún — o #85 só se referencia.**

**Publicación desta frente (2026-09-29, ordem expresa do operador: "faça push
da branch `codex/rex-integrator-mugen-85` e abra um PR integrado no GitHub, sem
merge, sem release e sem promoção de maturidade").** Antes do push, o tronco do
integrador `codex/rex-integrator-crates-registry` adiantouse en fast-forward
`00f9d29..e319fb9` (publica `aa959a9` + `e319fb9`; `git fetch` antes do push
confirmou 0 atrás / 2 á frente) para que o diff do PR sexa exactamente a
integración de #85 máis a curaduría. Esta frente quedou en `d36df92` no remoto
e abriu-se o **PR #86** (`Integrate experimental MUGEN import flow`, base
`codex/rex-integrator-crates-registry`, head `codex/rex-integrator-mugen-85`,
24 commits, 113 ficheiros, +18009/−90, `isDraft=false`, `mergeable=MERGEABLE`,
`mergeStateStatus=CLEAN`), coa descrición obrigatoria completa: base, merge
curado, curaduría, conflito de `src-tauri/Cargo.toml`, os 11 gates do destino
coas contaxes, os 8 puntos do E2E e as 8 limitacións rexistradas. **CI
terminal sobre o SHA pinado `d36df92`, medido por consulta pontual sen monitor
permanente:** catro runs `completed`/`success` — `CI` `36542842781`
(`linux-validate` 08:27:36Z→08:40:54Z; `validate` →08:50:28Z), `Desktop E2E`
`36542842770` (`desktop-smoke` →08:46:52Z), `CI` `36542937864` (`validate`
→08:52:04Z; `linux-validate` →08:41:42Z) e `Desktop E2E` `36542937819`
(`desktop-smoke` →08:48:23Z); `CodeRabbit` `pass` (reviews desactivados para
esta base) e `Sourcery review` `skipping`. Despois desa medição, `eaf980c`
(só os dous documentos de estado: rexistro desta mesma publicación) entrou na
mesma branch por fast-forward `d36df92..eaf980c`, e o seu CI tamén é terminal
verde — `CI` `36546968827` (push) + `36546969248` (pull_request) e `Desktop E2E`
`36546969249` (pull_request), todos `completed`/`success` (`CodeRabbit` `pass`,
`Sourcery` `skipping`); **non houbo run `Desktop E2E` de `push` porque o
disparador `push` do workflow filtra por `paths:` e `docs/` non está nessa
lista** — o gate de PR seguiu executado e verde. O CI do commit que leva esta
liña non se volveu pinar aqui para non mover o head outra vez: consúltase con
`gh pr checks 86`. **Aínda sen merge nese intre: #86 quedou
aberto para revisión humana (pecha na célula (i)) e #85 segue draft.**

**Revisión das 5 superficies centrais tocadas (todas reservadas ao integrador).**
`src-tauri/src/lib.rs` (+91/−14): envolve a importación externa nas dúas vías,
chama `discard_failed_import(project_dir, origin)` segundo a orixe reservada do
cartafol e fusiona `mugen_profile::summary_line()` no aviso de éxito.
`src/App.tsx` (+74): estado `mugenCompatibility`, render do panel,
`__RDS_E2E__.setNextExternalImportPath` e `testid` de confirmación.
`src/core/diagnostics.ts` (+45/−2): `mugenImportCause()` con causa + acción
suxerida para os catro casos e peche «Nenhum projeto foi criado.».
`scripts/e2e-tauri-build-run.mjs` (+291/−2): escenario `mugen-import`.
`src-tauri/Cargo.toml`: único conflito da integración, 2 liñas de path-deps,
resolto conservando `rex-kosinski`, `rex-gameplay` **e** `rex-mugen`, sen apagar
avanço do integrador (`git diff --diff-filter=U` = 0, ningún marcador na árbore).

**Barra no destino (todos rc=0).** `npm run check:tree`, `npm run lint`,
`npx tsc --noEmit`, `npm test` **812 passed / 0 failed / 6 skipped**, `cargo fmt
--check`, `cargo clippy --lib -- -D warnings`, `cargo clippy -- -D warnings`,
`cargo test --lib` **796 executados / 0 fallos / 70 ignorados**, `npm run
crates:gates` cos 4 paquetes, `node --check` do harness e `npm run host:certify`
(host **READY**, fingerprint `60249508…`, lock `dd99a22f…`, smoke oficial
SGDK/PVSnesLib `Success: true`). A barra foi **reexecutada íntegra sobre a árbore
final curada** (2026-09-29T03:00Z–03:17Z) despois de reescribir o rexistro e
reforzar a aserción do harness, con contaxes idénticas; o E2E non se volveu
executar porque entre run7 e esa reexecución non mudou ningún byte de produto,
de fixture ou do escenario. Reconciliación independente da contaxe Rust: base
`a08c2c6` 770/66 + PR 15/3 (os 18 `#[test]` de `mugen_profile.rs`, 3 deles
`#[ignore]`) + integrador 11/1 = **796/70**; os 781/0/69 anunciados pola fronte
son unha medición anterior á súa propia entrega. **Débeda preexistente, non
atribuíble ao PR:** `cargo clippy --all-targets` reproba con 46 avisos de
`#[cfg(test)]` (`rex_context` 18, `rex_aplib` 8, `rex_resources` 5, `project_mgr`
5, `rex_codecs` 4, e 1 cada un en `logic_recovery`, `holdout`,
`graphics_discovery`, `lib.rs:165`, `build_orch:5227`); cruzadas as 45
localizacións únicas coas liñas engadidas polo PR, **0** caen nelas. Rexístrase e
non se corrige (atribúese, non se arrecula o avance alleo).

**E2E desktop `mugen-import` verde** (run7, 2026-09-29T02:46Z–02:47Z, binario
SHA-256 `1b46ff50…`, fixture autoral con SHA por arquivo). As 7 validacións
pedidas polo operador están probadas, con separación honesta entre o que proba o
core e o que só proba a interface: (1) a falla non deixa projeto fantasma
(`failed_import_does_not_leave_a_project_that_looks_valid`,
`failed_import_into_existing_empty_dir_keeps_the_dir_empty`, e no E2E a
comprobación explícita de que o `escapeName` desta execución non chegou ao
disco); (2) o relatório aparece na UI (tests do panel + asercións DOM, 7
categorías `{sprites/animations/commands/states: direct, collisions: manual,
sound/stage: absent}`, texto cru de 15 527 caracteres); (3) o éxito resume perdas
(`successful_import_summarizes_losses_by_category`,
`sentinel_summary_exposes_every_loss_class`, e o console `[MUGEN] probe
(Experimental): 12 funcionam igual, 0 con diferenca, 1 precisam de ajuste seu, 0
nao convertidos`); (4) os caminhos fora do paquete recusanse (4 tests negativos +
o negativo do E2E); (5) o projeto aberto anterior non muda tras a falla
(`activeProjectDir` invariado — **só probado no E2E**, sen test Rust); (6) o
personaxe aparece no core (Build & Run real, mostra no canvas 320×224 en (96,96):
idle0=11, idle1=14; a proba `mugen_probe_real_build_run_edit_and_effect` segue
`#[ignore]`); (7) a edición no Inspector persiste tras salvar, reiniciar e
reabrir (x 96→140, reapertura en 140, ROM `10658a6c…` vs `5a6aff76…`, personaxe
na posición nova e vella baleira — **só probado no E2E**).

**Dous achados na superficie do propio integrador.** (a) A aserción do projeto
fantasma comparaba só o *conteo* de cartafoles `Mugen_Escape_*`, polo que non era
discriminante cando xa existía un de outra execución — endurecida para esixir que
o nome desta proba non estea no disco, e run7 reexecutado despois do endurecemento.
(b) Tras o reinicio do E2E queda unha instancia de `retro-dev-studio` viva
(observado en run4 e run7) — rexistrada como límite do harness, **non** corrixida
nesta rolda. O cartafol `Mugen_Escape_1790639205721` que aínda existe en
`~/Documents/RetroDevProjects` non é un fantasma MUGEN: o seu `project.rds`
declara `template_id = "starter_guided"`, `source_kind = "builtin"`, polo que o
creou o onboarding doutra rolda; non se borrou.

**Condición do host (non escondida).** O output primario pasou a ser un panel
rotado `1280x800+0+0` e o compositor recorta alí as xanelas, así que o
redimensionado a 1920×1080 CSS era imposible (`inner=948x564`, factor físico/CSS
1,35). Un vixía temporal **fóra do repo** colocou só a xanela da app de proba no
monitor externo (`3456x1458+1281+0`, físico 2592×1458 = 1920×1080 CSS) para
reproducir o mesmo viewport da proba da fronte. Non se mudou a configuración de
pantallas do operador nin se alterou o harness para aceptar outra xeometría.

**Limites rexistrados (o que non se alega).** SFF v2, som, stage e colisión
lóxica seguen fóra. Comando por teclado e golpe son proba técnica/core, **non**
de UI. O relatório de compatibilidade non ten reapertura futura. O Inspector usa
a etiqueta «FPS» para unha animación MUGEN (rótulo inadecuado, coñecido). Non se
copia o runtime C `mg_*` (base HAMOOPIG de terceiros, licenza non verificada —
`docs/rex_profiles/mugen_sgdk/AUDIT.md`) e non se asume licenza estra. **Aberto,
en mans do operador:** promoción de degrau, licenza e fluxo de usuario completo
(para á importación, edición de animación e xogo).

**Evidencia:** `data/rex_profiles/mugen_sgdk/evidence/2026-09-28-integracao-integrador/`
(logs por paso, informe do E2E, 6 capturas, `LEIAME-e2e-e-host.md` cos descartes
explícitos das execucións non válidas e `SHA256SUMS` de 26 ficheiros verificados)
e `data/rex_profiles/mugen_sgdk/evidence/2026-09-29-pos-curaduria/` (reexecución
da barra sobre a árbore final, `LEIAME.md` con rc/comando/log/medida por gate e
`SHA256SUMS` de 11 ficheiros verificados).

**Arquivos alheios á rolda** (`APJ-unpack`, `a.out`, `apultra-decode`,
`.mimosa/`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/`,
`data/canonical-local-2026-09-21/`, `__pycache__/` e o log de consulta CI da
fronte) seguen intocados: non executados, non stagingados, non apagados.

### Checkpoint 2026-09-26 (g) — integrador, **aPLib em Rust canônico**: decoder aceito pelos vetores, um bug de formato achado por arbitragem em stream real e aceite BYOR das duas streams (Experimental; sem merge, sem release, sem promoção)

**Commits desta frente** (`codex/rex-integrator-aplib-decode`, baseada no trunk
do integrador `d0744b0`, +8 commits): `9a9b66d` (vetores da agente B importados
para namespace próprio, 49 arquivos pinados por SHA + hash agregado `3a9d7e9e…`),
`d27be00` (`aplib_decode`/`AplibLimits` em `src-tauri/src/tools/reverse/decomp/
rex_aplib.rs`, variante SGDK **raw sem header `"AP\0"`**), `9fb2c12`
(`verify_aplib_resource` em `rex_resources.rs:148` — recusa `compression != Aplib`,
exige `expected_len`, decodifica **sem dicionário** — e a garantia de que a via
LZ4W continua recusando header APLIB), `d10d5ab` (correção do token `110` + os
dois vetores discriminadores + script de reconstrução) e `a69614e` (aceite BYOR
das duas streams reais + perna JS independente); `73961e5` registra o estado na
matriz e no consolidado. **Push feito** após `git fetch` (branch nova no remoto;
CI consultado **uma vez**: `validate`, `linux-validate`, `desktop-smoke`
`in_progress`; sem monitor permanente).

**Hipótese testada:** um decoder que passa nos 49 vetores pinados por dois
oráculos decodifica corretamente os streams APLIB do alvo visível. **A hipótese
estava errada**, e a frente só o soube porque o aceite BYOR foi executado: com
**todos** os 49 vetores verdes, o decoder divergia de cada um dos dois
decodificadores de referência em **703 dos 16 000 bytes** do TileSet real
(`0x2e4d4`), com enquadramento idêntico (`bytes_consumed` 4485, plain 16 000 B;
antes `34a894c3…`, depois `dd7affc3…`).

**Causa (defeito de produto, não de fixture):** o token `110` não gravava
`offset_history`, então o rep-match seguinte reusava offset obsoleto. A regra
"quem escreve no histórico são `10` **e `110`**; `111` não escreve e devolve LWM
a 3" **não estava** na especificação da agente B, e nenhum vetor importado coloca
um rep-match depois de `110`/`111` — lacuna de cobertura, não de conteúdo. Por
isso os dois novos casos entraram como vetores **irmãs**
(`data/rex_profiles/integrator/aplib/discriminating/`, SHA por arquivo, `ORIGEM.md`
com receita de reconstrução e de ambos os oráculos) e o conjunto pinado de B
permaneceu íntegro (`verify_vectors.py` rc=0). Autoridade do formato: **os dois
decodificadores externos** (`apultra` exemplar `64be2a7a…`, origem declarada
commit `8f340057…`; `apj.jar` SGDK v2.11 `2d8cdc63…`, hash conferido **antes** da
primeira execução) mais o JS da agente A (`aplib.mjs`, conteúdo `62425497…`) —
três caminhos concordantes; nem o produto nem o port da agente A são autoridade.
Não-vacuidade provada removendo a correção: **só** o teste novo cai.

**Aceite BYOR (`#[ignore]`, falha honesta sem arquivo/identidade):** ROM
`558bea6c…`; TileSet `0x21b44` → stream `0x2e4d4` (4485 → 16 000 B, `dd7affc3…`);
TileMap `0x21b4c` → stream `0x2d534` (1196 → 2 240 B, `c196aa5b…`); separação
estrutural `0x2d534 + 1196 < 0x2e4d4`. Nenhum byte comercial entra no
repositório: só offsets, comprimentos e SHA-256.

**Gates (árvore commitada):** `cargo test --lib` **687 passed / 0 failed / 54
ignored**, `--ignored byor_aplib` **1 passed**, `cargo clippy -- -D warnings`
rc=0, `cargo fmt -- --check` limpo, `npm run check:tree` OK. `cargo
clippy --all-targets` **não** é baseline limpa neste repositório (21 falhas de
estilo pré-existentes em `#[cfg(test)]`, inclusive código não tocado por esta
rodada) — o gate declarado é o outro.

**Não provado / aberto (registrado, não promovido):** **não há encoder aPLib**,
então a paridade bidirecional exigida por `CONTRACTS` §4
(`decode(produto, encode(ref))` e `decode(ref, encode(produto))`) e a
editabilidade **sem expansão** de um recurso APLIB continuam abertas — este é o
próximo incremento; os 95,90 % de correspondência por pixel do alvo seguem
medidos **só em JS**, não no produto (reconstrução visual e reinserção com
transação são etapas separadas); identificação continua assistida pelo header
(sucesso de decode não prova identificação); `work-limit`/`cancelled`/`overflow`
são política do produto sem vetor de oráculo; a variante com header `"AP\0"` está
fora do escopo. **A linha aPLib da matriz de codecs NÃO foi promovida** (missões
desta rodada vetam promoção de maturidade, merge e release); o que existe é
evidência registrada em `docs/rex_profiles/ROUND_STATE.md` e no adendo §8 de
`docs/rex_profiles/APLIB_TILEDIMAGE_PROXIMA_PROVA_2026-09-26.md`. Arquivos
alheios à rodada (`APJ-unpack`, `a.out`, `apultra-decode`, `.mimosa/`,
`src-tauri/src-tauri/`, corpus `data/canonical-local-2026-09-21/`) seguem
intocados: não executados, não stagingados, não apagados.

### Checkpoint 2026-09-26 (f) — integrador, **piso do formato medido**: o déficit do corpus é qualidade de parsing, não falta de espaço (Experimental; sem merge, sem release, sem promoção)

**Commits deste lote:** `c296102` (instrumento de piso `dp_floor.py` + varredura
`floor_sweep.py` + emenda §9 do `BENCH_SPEC.md`) e `563c5f0` (dumps opcionais de
material fora do repositório + teste que decodifica os streams de piso pelo
decoder do produto), seguidos do commit de evidência/documento
(`.../evidence/2026-09-26-r5-floor-dump/`, §6 de
`LZ4W_ENCODER_444_VS_448_2026-09-26.md`, linha `encode` e histórico de
`ROUND_STATE.md`). PINO DO CODIFICADOR INTACTO: `rex_codecs.rs @
bee8524f…` — nada neste lote toca o caminho de produção, então o replay 68k `r14`
continua valendo.

**Por que este passo veio antes de mexer no compressor.** O checkpoint (e) deixou
uma pergunta em aberto com resposta cara de adivinhar: dos −9 156 B de déficit do
corpus, quanto era culpa do parse guloso e quanto é limite do formato? Sem esse
número, integrar um DP seria aposta. Com ele, é decisão.

**O instrumento.** DP de custo explícito sobre `(posição i, literais pendentes p
0..14)` — 1 word de descritor + 1 por literal + 1 de offset para match longo +
terminador de 2 words, na janela do codificador (0x4000 words) e na convenção de
offset do produto (espaço dicionário+saída, sem o bit 0x8000). O estado `p` não é
ornato: sem ele o modelo erra, e foi exatamente o bug do DP portado de `LZ4W.java`
que piorou o produto (382 B contra 380 B) no checkpoint (d).

**Duas correções metodológicas que este checkpoint deve registrar.**
1. *Matches maximais não são ótimos.* A primeira versão restringia cada fonte ao
   seu comprimento máximo; passou 25 vezes no selftest aleatório e **falhou na
   26.ª** (`plain=[2,2,1,2,1,0,2,1,1,1,1,2] dict=[2]`: 10 words contra 9 da busca
   exaustiva). O número que a versão restrita dava para o fixture (444 B) era
   coincidente com o correto por acaso — e teria sido publicado como piso.
2. *O selftest precisava ser não-vacuo.* Contando os tipos de transição emitidos,
   as duas primeiras configurações **nunca** produziam um match longo nem
   encostavam no teto curto de 16 words. Entraram então "fontes distantes"
   (dicionário acima de 0x100, onde só o formato longo alcança), "repetição"
   (alfabeto de 1 word, tetos de 16 e 257) e "janela curta" (o recorte de `WINDOW`
   jamais exercido por entrada pequena com janela real). 1 165 entradas depois, a
   DP coincide com a busca exaustiva em todas.

**Medida (rounda `2026-09-26-r5-floor-dump`).** Gap produto − piso, no plain **sem
edição**: positivo em **160/160** recursos do corpus; soma **9 394 B** (ajuste
7 480 B em 128, validação 1 914 B em 32); mediana 56/60 B; máximo 150 B; **zero
empates e zero perdas** no corpus. Agregado: soma de slots 225 562 B, soma de
pisos 225 324 B → a folga somada do corpus viraria **+238 B** (hoje −9 156 B), e
**125/160** recursos teriam o plain não-editado cabendo no slot contra **1** hoje
— mas 35 continuariam fora, porque a sobra não é uniforme. No fixture autoral o
produto **já está no piso** (444 B == `rescomp` == DP): o gap de 146 B contra slot
de 144 B da edição canônica não é culpa do parse, e o incremento de parsing não
abre aquele alvo.

**Reconciliação por caminhos independentes.** Os 9 394 B aparecem somados (a) em
Python, pelos comprimentos que o modelo anuncia, e (b) em Rust, pelos 161 streams
lidos do disco e decodificados por `lz4w_decode_with_dictionary` — todos voltam ao
plain exato consumindo-se inteiros. E o `bench.json` de r5 é campo a campo idêntico
ao da rodada pinada r4 (161/161 linhas; resumo inteiro igual fora de
`tempo_rodada_ms` 25 526 → 23 352), o que prova que instalar o dump não moveu
nenhuma medição.

**Custo do instrumento:** 59,4 s para os 161 recursos em Python não otimizado
(~0,4 s/recurso) — cabe no orçamento de 2 s/recurso da especificação, então a
viabilidade de um DP no produto não está limitada por tempo neste primeiro exame.

**O que este checkpoint NÃO afirma (e por isso o incremento ainda não entrou).**
O piso é do plain sem edição, logo "cabe no slot" é condição necessária: um bit
invertido custa tipicamente 2–6 B por cima do piso. Não houve replay no
desempacotador 68000 dos streams de piso — é obrigação de quem integrar, no pino
novo, junto com o teto de hardware de 16 385 words, a proteção de dependentes, os
limites de tempo/memória e a recusa honesta (`needs_space`) quando não couber. E
o DP como escrito é O(posições × candidatos × comprimentos): no produto vai
precisar de orçamento por posição, e um teto de candidatos faria do resultado um
**limitante superior** (só "gap > 0" continua valendo com poda; "gap == 0" não).

**Gates:** `cargo test --lib` 669 passed / 0 failed / 53 ignored; `cargo clippy --
-D warnings` rc=0; `cargo fmt -- --check` rc=0; `dp_floor.py --selftest` rc=0.
`clippy --all-targets` mantém 10 achados **pré-existentes** em `project_mgr.rs`,
`holdout.rs`, `lib.rs`, `graphics_discovery.rs`, `build_orch.rs`,
`logic_recovery.rs` — nenhum em `rex_*.rs`, nenhum introduzido aqui. Frontend
intocado neste lote.

**Higiene BYOR:** os dumps de material (806 arquivos, 11 613 804 B) ficaram em
`/tmp/rex-lz4w-floor-dumps-2026-09-26` e são descartáveis; o versionado é o
SHA-256 de cada um dentro de `floor-sweep.jsonl`. O caminho de dump é recusado por
asserção se estiver dentro do repositório.

**Próximo comando (PASSO 3, integração):** portar a DP para `rex_codecs.rs` atrás
de orçamento explícito, re-pinar o codificador, refazer o replay 68k no pino novo e
publicar antes/depois com perdas e empates pela especificação congelada.
**Em paralelo (PASSO 5):** TiledImage/APLIB em frente separada. **Bloqueio:**
nenhum externo. **Fora de escopo por ordem do operador:** merge, release, promoção
de maturidade, expansão de ROM, realocação de ponteiros, promoção do marco do
fixture para cobertura BYOR.

### Checkpoint 2026-09-26 (e) — integrador, capacidade REAL do codificador LZ4W medida, um incremento pinado e o descarte silencioso da UI corrigido (Experimental; sem merge, sem release, sem promoção)

**Commits da entrega:** `2ffb076` (benchmark congelado), `39c0fd9` (incremento
do codificador + replay 68k `r14`), `6351f15` (aviso de UI) e o commit de
documentação que traz este registro — todos sobre `47f2c89` (ETAPA E), branch
`codex/rex-integrator-profiles-codecs`. Nada além disso ficou não commitado: os
arquivos alheios à rodada (`.mimosa/`, `APJ-unpack`, `a.out`,
`apultra-decode`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/`,
`data/canonical-local-2026-09-21/`) permanecem intactos e **não** staged — o
último é corpus BYOR e nunca entra no git.

**Objetivo recebido:** tornar mais recursos comprimidos editáveis **sem
expansão**, *medindo a capacidade real do encoder* — em vez de acumular ajustes
de parsing sem saber qual gargalo fecha.

**Decisão metodológica central:** congelar a medição antes de mexer no
codificador. `scripts/rex_profiles/integrator/lz4w_recompress/BENCH_SPEC.md`
(§1-§8) fixa conjuntos (S-A fixture autoral, S-B corpus BYOR), split de
validação por `índice % 5` (32 recursos) vs ajuste (128), as 4 edições por
recurso definidas **antes** de medir, orçamento (2 s/recurso, 120 s/rodada,
publicado como perda se estourar), a barreira de re-decode do que o codificador
emite, e a regra de honestidade que o operador exigiu: **no-op que preserva o
stream original não conta como sucesso do encoder** — sai em coluna própria
(`noop_preservando_stream`). O teste do benchmark é `#[ignore]` e só roda com
`RDS_REX_BENCH_OUT` absoluto; ele **falha** se a ROM do corpus ou do fixture
faltar ou divergir do SHA pino (aceite BYOR sem `return` silencioso).

**Linha de base (roda `r1`, `rex_codecs.rs @ 656bdc9f…`):** 160 recursos LZ4W
verificados, folga somada **−13 188 B**, **1** recurso com folga ≥ 0; das 644
edições predefinidas **2 cabem**, **523** `needs_space`, **119** no-op. Fixture:
re-encode do plain não editado = **448 B** contra o `rescomp` de **444 B**.

**Diagnóstico token a token (não se começou por reescrever o compressor):** três
instrumentos independentes e concordantes — `tokens.py` (tokenizador próprio,
só imprime depois de reproduzir o plain e consumir o stream inteiro),
`model_encoder.py` (réplica **linha a linha do codificador daquela linha de
base**, validada por igualdade byte a byte, o que permite inverter decisões sem
reverter código) e `probe_candidates.py` (varredura sob três modelos: ideal sem
cap, real dicionário-primeiro, mesclado). A divergência está em **uma posição**:
no word 200 do plain do fixture, o dicionário tem 2 329 candidatos e o melhor
representável `(3, 156)` está na **tabela de saída**; na ordem dicionário-primeiro
o teto de 128 candidatos se esgota no dicionário antes de a saída ser consultada
(`melhor_só_dict = (2, 1135)`, não representável). Alcançar aquele candidato
naquela ordem custaria ~2 330 avaliações — **18× o teto**; na ordem mesclada ele
chega em **3**. Conclusão registrada: o defeito é a **ordem** em que o orçamento
é gasto, não o tamanho do orçamento. (Redação anterior, já retirada do estado
corrente, atribuía o gap ao cap ou ao lazy de 1 passo — a sonda refutou as duas.)

**Incremento entregue (único, delimitado):** `find_best` intercala as duas listas
descendentes por proximidade com **mesmo** cap de 128, **mesma** janela
(0x4000 words), **mesmo** `consider()`, **mesmo** filtro de aceite e **mesma**
regra lazy. Formato intocado.

**Antes/depois com perdas e empates declarados:** comparação recurso a recurso do
campo `reencode_base` entre `r1` e `r2` (161 linhas = 160 do corpus + 1 do
fixture): folga somada **−13 188 → −9 156 B** (+4 032 B), no corpus **158
melhoraram / 0 pioraram / 2 empataram**, fixture **448 → 444 B, byte a byte
idêntico ao stream do `rescomp`**. Reproduzido **campo a campo** no pino final
`bee8524f…` (roda `r4`: 161/161 linhas iguais, resumo igual exceto o tempo de
rodada 27 440 → 25 526 ms). Replay no **desempacotador 68000 oficial** do SGDK
2.11 sob MAME 0.289 (`lz4w-68k/evidence/2026-09-26-r14`, 12 casos, 7 ROMs): as
streams do codificador novo batem 68k == jar v1.43 == esperado-Rust, e a recusa
contratual além do teto de hardware (`i16`, off 16386) continua divergindo no
68k por contrato. Determinismo entre duas corridas registrado no manifesto.

**O que o incremento NÃO resolveu (e isso é o achado, não um rodapé):** a
editabilidade **não** aumentou. Continua **1/160** recurso com folga não
negativa (`0xc8cc8`, +2 B), e a coluna nova de **capacidade por amostragem**
(24 bits invertidos por recurso, espaçados uniformemente; um bit só "cabe" se o
re-encode cabe **e** a re-decodificação reproduz o plain editado) diz o mesmo:
só `0xc8cc8` tem bit amostral cabível (16 de 24), os outros 159 têm zero, e a
edição canônica de 1 pixel ali custa **146 B contra slot de 144 B** (`needs_space`
honesto, nada forçado). Mediana do déficit restante **56 B/recurso** contra
2-6 B por bit: **empatar com o `rescomp` é condição necessária, não
suficiente.** Amostragem é amostragem — exaustivo seria O(bits) codificações por
recurso e estouraria o orçamento.

**UI (obrigação de corretude do PASSO 4, não extra):** o descarte de edição fora
do intervalo era silencioso (`paintAt` retornava cedo; o formulário não validava
nada). `editRejectReason` agora explica tile/linha/coluna/índice/nenhum-recurso
no painel (`rex-resource-notice`) e como `warn` no log da ferramenta, preserva a
fila válida e **não** envia o candidato inválido. A guarda do **núcleo** continua
definitiva (o teste afirma que `rexResourceApplyEdit` recebe só a edição boa).
Nenhum controle inválido foi exposto para facilitar teste — os campos aceitam
entrada livre porque o usuário pode digitar qualquer valor, e é esse caso que a
mensagem cobre.

**Gates (todos rc=0, medidos nesta ordem, um job pesado por vez):**
`check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` **701 passed / 6
skipped**, `cargo fmt --check`, `cargo clippy -- -D warnings`,
`cargo test --lib` **669 passed / 0 failed / 52 ignored**; §5 do diagnóstico
reexecutado (passo 4 dif == log versionado). Nota: `cargo clippy --all-targets`
tem 10 achados **pré-existentes** em arquivos que este lote não toca
(`project_mgr.rs`, `holdout.rs`, `lib.rs`, `graphics_discovery.rs`,
`build_orch.rs`, `logic_recovery.rs`) — nenhum em `rex_*.rs`.

**Higiene de evidência:** `sa-dict.bin` (391 560 B, **fixture autoral**) é
versionado uma vez (`r1`); cópias byte a byte idênticas em `r2/r3/r4` foram
substituídas por `sa-dict.bin.sha256` com a verificação `cmp` registrada.
`bench.json` só contém metadados (offsets, comprimentos, contagens) — nenhum
byte da ROM comercial. Cada rodada ganhou `manifest.json` com pino do codificador;
onde o hash da fonte **não** foi registrado no momento da corrida (`r2`, `r3`)
isso está dito em vez de inventado, e `r4` fecha a lacuna.

**Próximo incremento (PASSO 3, medido antes de integrar):** parse de **custo
explícito** — caminho mais curto sobre as words com custo real de token +
literais + descrito + word de offset, respeitando ≤15 literais/token e o teto de
128 candidatos — para obter o **piso** por recurso; validar contra busca
exaustiva em entradas pequenas e **não** chamar de "ótimo" sem essa comparação.
Contexto que a mídia anterior não tinha: o DP ótimo do `LZ4W.java` já foi
tentado nesta rodada, ficou verde no suíte e **piorou** (382 B vs 380 B); um DP
fiel precisa de estado `(posição × literais pendentes mod 15)`.

**Bloqueios e fora de escopo:** nenhum externo. Permanecem fora por ordem do
operador: merge, release, promoção de maturidade, expansão de ROM, realocação de
ponteiros, promoção do marco do fixture para cobertura BYOR, e misturar
otimização LZ4W + codec novo (aPLib) + UI num único commit. O alvo comercial
`0xc8cc8` segue **BLOQUEADO** quanto a efeito de jogo.

### Checkpoint 2026-09-26 (d) — integrador, ETAPA E: edição de recurso comprimido com efeito **causal demonstrado na aplicação** (Experimental; sem merge, sem release, sem promoção)

**HEAD na abertura deste checkpoint:** `d4043eb` (branch
`codex/rex-integrator-profiles-codecs`). Não commitados neste momento:
`scripts/e2e-tauri-build-run.mjs` (cenário novo + helpers),
`src-tauri/src/tools/reverse/decomp/rex_resources.rs` (teste de fronteira +
limpeza de lints), `scripts/rex_profiles/integrator/lz4w_fixture/{README.md,gen_fixture.py}`,
`scripts/rex_profiles/integrator/lz4w_fixture/analyze-frame.py` (novo), os dois
relatórios de evidência e o `manifest.json` em
`data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/`, e o
`fixture-build-report.json` versionado (sha da receita + registro de reprodução).

**Hipótese:** a cadeia LZ4W do produto — descoberta → decode → transação canônica
→ BPS → re-aplicação → emulação — produz um efeito observável **na tela do app**
quando a edição é feita pela interface real sobre o núcleo real, e os negativos
alcançáveis pela interface são recusados sem escrita.

**Evidência a favor (medida, binário `e69077927863c15788bf2006e344f71f4a4b84408714201c48a67d450fc26574`,
core Genesis Plus GX v1.7.4 `46a5521`):** cenário E2E `rex-lz4w-fixture-effect`
verde **duas vezes** com o código final (run10 e run11, `rc=0` lido nos próprios
logs, não de notificação). Pela UI: recurso único (header 95464, stream `0x5f988`,
slot 444 B, `1/5 candidatos` verificados), prévia == fonte recomposto
(`19cc30aefe4da564`), no-op honesto, edição `tile 0, row 5, col 7 → idx 15`
aplicada pela transação (modificada `e55dba92…`, BPS `52ce036f…` de 74 B, 268
bytes distintos confinados em `5f9a1..5fb3f`, `diferenteForaDoSlot:0`), BPS
re-aplicado à base reproduzindo o hash exato, cópia reaberta decodificando no
plain editado (`917048cc35508e9a`). Pela emulação: **1 byte** no WRAM (`0x5e`,
`f0→ff`) e **exatamente 1 pixel de tela** diferente, na coordenada `(7,5)` prevista
pelo fonte **antes** de qualquer emulação, com as classes de cor esperadas
(`0x212021 → 0x8c008c`), canvas do app == framebuffer do core (320×224). Pelos
negativos: fila de intervalo guardada (0 entradas, 0 escritas, sha da cópia
inalterado; controle positivo enfileira 1) e `rom_identity_mismatch` quando o
arquivo muda sob o painel (TOCTOU), com a ROM do fixture verificada intacta.

**Evidência contra / limitações (registradas como não provadas, não como sucesso):**
(a) a perna de **VRAM não é alcançável** — o core devolve
`retro_get_memory_size(VIDEO_RAM) == 0` enquanto `emulator_read_memory` responde
`ok:true` com dados vazios; a comparação ingênua diria "0 divergências" de forma
**vaciada**, então o relatório publica `vram.observed:false` com o motivo e a
cadeia fica provada por WRAM + framebuffer; (b) o DAC do Mega Drive **funde** as
16 palavras de paleta autorais em **11 cores** (índices colididos
`[0,1,2,3,4,6,7,8,9,10]`) — índice→cor é função mas não é injetiva, logo a
identidade do pixel alterado é estabelecida por **posição** e a cor só confirma a
classe (diagnóstico em `analyze-frame.py`); (c) a recusa de intervalo do **núcleo**
é **inalcançável pela UI**: `CompressedResourcePanel.tsx` descarta
`editTile >= num_tiles` no cliente, então o E2E prova a guarda do cliente e a
recusa do núcleo (`rex_resources.rs:634`) foi fixada pelo teste unitário
`apply_rejects_tile_outside_resource_without_writing` (que também asserta que a
cópia em disco não mudou); (d) isto é prova de **mecanismo em dado autoral** — o
alvo comercial `0xc8cc8` continua `semanticState: BLOQUEADO`, e nenhuma afirmação
visual é feita sobre ele.

**Retratação de redação no estado corrente:** a frase "a tela do app ainda não foi
capturada por emulação" (ROUND_STATE, linha da ETAPA D) estava desatualizada e foi
substituída; ela permanece verdadeira apenas para o alvo comercial.

**Reprodução durável do artefato testado:** `build-fixture.sh` reproduziu o ROM
bit-idêntico (`159298eb…`, 393216 B) em caminho versionado-de-receita e o
`fixture-build-report.json` do tronco agora registra a receita atual
(`gen_fixture.py 3e474f44…`, sha anterior `1445132f…` produzia o mesmo ROM — a
diferença é comentário + achatamento de `tile_pixels`). `/tmp` deixa de ser a única
origem; gap declarado: o cenário ainda alimenta a cópia em `/tmp`.

**Relatório técnico da etapa (consolidação auditável):**
`docs/rex_profiles/RELATORIO_ETAPA_E_2026-09-26.md` — veredito, tabela de artefatos
com SHA-256 reconferido contra o disco, método com as cinco barreiras não-vacuosas,
os dez passos com valores medidos, o argumento de causalidade, onde vive cada
negativo, as limitações não provadas, portas com a reconciliação 699↔702 e a receita
de reprodução. Todo número foi confrontado com o `manifest.json` e com o
`rex-lz4w-fixture-effect-report-run11.json` antes do commit; a auditoria acrescentou
ao relatório e ao manifesto a limitação de que **as corridas rc=0 abriram a ROM em
`/tmp`** (`fixture.romPath`), com o caminho durável devolvendo o mesmo SHA.

**Gates deste checkpoint:** `cargo test --lib -- --nocapture` **669 passed / 0 failed /
51 ignored**; `cargo clippy -- -D warnings` limpo; `cargo fmt --check` limpo;
`npm run check:tree`, `npm run lint`, `npx tsc --noEmit` rc=0; `npm test`
**699 passed / 6 skipped (705)**, arquivos 75/1 skipped (76); `npm run host:certify`
**READY** (fingerprint `60249508…`, lock `dd99a22f…`) com a mesma suíte Rust
(669/0/51) e **702 passed / 3 skipped** no frontend. A diferença 699↔702 é
reconciliada e não é comparação de tips: os 3 testes a mais vêm de guardas por
disponibilidade de toolchain em `scripts/decomp/decomp-scripts.test.mjs`
(`HAS_SGDK_BUILD_TOOLCHAIN`, `GHIDRA_AVAILABLE`, `HAS_M68K_TOOLS`), que o profile
`full` exporta; total idêntico (705), zero falhas nas duas corridas. Log das
portas promovido com `gates-2026-09-26.log` no pacote de evidência. Achado paralelo honesto: `cargo clippy
--all-targets` (gate mais estrito que o documentado) falha em 10 lints de código
de teste **pré-existente** de outros módulos (`build_orch.rs`, `project_mgr.rs`×5,
`graphics_discovery.rs`, `holdout.rs`, `logic_recovery.rs`, `lib.rs`) — atribuídos
e **não** corrigidos nesta rodada.

**Próximo comando:** commit deste conjunto revisado + `git push` após fetch seguro.
**Bloqueio externo:** nenhum. Por ordem do operador continuam fora do escopo:
merge de PR, release e promoção de maturidade; expansão de ROM/realocação de
ponteiros; bytes comerciais no staging.


### Checkpoint 2026-09-26 (c) — integrador, ETAPA D: edição de 1 pixel com efeito **previsto** que sobrevive ao 68000, em fixture autoral (Experimental; sem merge, sem release)

**HEAD no checkpoint:** `a96fb15` (branch `codex/rex-integrator-profiles-codecs`), com
três arquivos de trabalho modificados e não commitados neste instante
(`src-tauri/src/tools/reverse/decomp/rex_resources.rs`,
`scripts/rex_profiles/integrator/lz4w_68k/driver_integrator.rs`,
`scripts/rex_profiles/integrator/lz4w_68k/reproduce.sh`) mais o pacote do fixture
(`scripts/rex_profiles/integrator/lz4w_fixture/`) e os dois pacotes de evidência
(`data/rex_profiles/integrator/lz4w-fixture/`,
`data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r13/`) como não rastreados.
Os 7 commits anteriores e o checkpoint pendente do Memory Bank permanecem intactos
(`658d756` + `13a5792` + `a96fb15`). Arquivos alheios continuam intocados.

**Hipótese:** a meta da rodada (uma edição de recurso comprimido com efeito causal
demonstrado) era alcançável **sem** tocar a ROM comercial, desde que o consumidor do
recurso fosse conhecido por construção e a edição respeitasse a granularidade real do
formato.

**Evidência a favor (medida):** fixture SGDK 2.11 autoral
(`scripts/rex_profiles/integrator/lz4w_fixture/`, ROM `159298eb…`, TileSet LZ4W em
header `95464`/stream `391560`, 16 tiles 8x8, plain 512B, empacotado 444B). O aceite
`--ignored` do produto: decode == fonte recomposta; no-op honesto; a edição **prevista
antes de qualquer emulação** `tile 0, linha 5, coluna 7: índice 0 -> 15` re-codifica a
440B e **cabe** no slot de 444B pela transação canônica (identidade, evidência,
dependentes, roundtrip, BPS); a ROM modificada reabre e re-decodifica para o plain
planejado; a coordenada de tela prevista é `(7,5)` e a prévia é renderizada (SHA dos
pixels e do PNG no log). Durabilidade: runF do replay 68000 (`…/lz4w-68k/evidence/
2026-09-26-r13/runs/runF`) desempacota no `lz4w_unpack` oficial, sob MAME 0.289, tanto
o stream do rescomp (`i30`) quanto o **escrito pelo produto** (`i31`) para exatamente
512 bytes, `68k == jar == esperado`, sem sobrescrever vizinhos.

**Evidência contra / medida negativa (registrada em vez de escondida):** o codificador
do produto gasta **mais** que o empacotador oficial no plain não-editado (448B vs 444B;
no fixture anterior, 380B vs 378B), então folga inicial é **negativa**. No fixture sem
plantio, a varredura **exaustiva** dos 15.360 candidatos de 1 pixel deu `0 cabem`
(`…/lz4w-fixture/evidence/2026-09-26/fixture-acceptance-exhaustive-before-plant.log`,
8,40 s). Causa estrutural: o LZ4W casa **words de 16 bits**, não pixels — uma edição de
1 pixel só encurta o stream se tornar dois words adjacentes idênticos. O plantio do
near-miss (`linha 5, coluna 7` guarda `(v+1)&15`) cria exatamente essa condição; sem
ele não haveria caso positivo, o que tornaria o teste inútil como discriminante.
Um porte do DP ótimo de `LZ4W.java` foi implementado, ficou verde no suíte inteiro e
**piorou** o resultado (382B vs 380B) — foi **revertido** (`git checkout --`) em vez de
entregue; o modelo de custo de 1 palavra/token ignora o chunk de 15 literais (custo
real de 16 literais + match curto: 20 words, não 17), logo um DP fiel precisa do estado
`(posição x literais pendentes mod 15)`.

**Correção de redação (retratação parcial):** o bloqueio comercial é o **consumidor não
provado** (a sonda do core só alcança as regiões que o libretro expõe; CRAM e o destino
do desempacotador ficam `missing`), **não** ausência de espaço — a edição canônica do
aceite BYOR (`pixel (0,7,4) -> idx 15`) cabe e é aplicada. A ROM comercial não foi
alterada nem instrumentada nesta rodada.

**Últimos comandos e resultados:** `cargo test --lib -- --ignored --nocapture
fixture_lz4w` -> 1 passed em 1,21 s (planta primeiro) e o log de 8,40 s da varredura
exaustiva anterior; `bash scripts/rex_profiles/integrator/lz4w_68k/reproduce.sh` com
`REX_CODECS_SHA=656bdc9f…` -> 7 execuções, 12 casos, 11 `68k == jar == esperado` e 1
divergência **esperada** (run16, além do teto 16385); `cargo test --lib` -> 668 passed /
0 failed / 51 ignored. **Próximos comandos:** `cargo fmt --check`,
`cargo clippy -- -D warnings`, `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`,
`npm test`, `npm run host:certify`, depois commit + conferência remota por fetch antes
de qualquer push. **Bloqueio concreto:** nenhum externo nesta etapa; a ETAPA E (tela do
app capturada por emulação no cenário E2E `rex-lz4w-fixture-effect`) é o trabalho
seguinte, e a meta visual **não** será declarada concluída enquanto `semanticState`
estiver BLOQUEADO.

### Checkpoint 2026-09-26 (b) — integrador retomado: contrato LZ4W fechado contra o 68000 real (Experimental; sem merge, sem release)

**Estado de partida preservado** (exigência do prompt de retomada): 7 commits locais
não enviados (`e942848..7e19d6a`) + a alteração pendente no Memory Bank, que foi
commitada verbatim como `658d756` antes de qualquer outra escrita. Arquivos
alheios na árvore (`APJ-unpack`, `apultra-decode`, `a.out`, `.mimosa/`,
`src-tauri/src-tauri/`, `data/canonical-local-2026-09-21/`) **não foram executados,
apagados nem staged**; continuam fora do escopo deste checkpoint.

**Hipótese testada:** o decoder do produto tratava a janela de busca do compressor
(`0x4000` words) como limite do formato e, portanto, recusava um offset que o
desempacotador 68000 oficial ainda lê corretamente. **Evidência a favor (medida no
hardware, não simulada):** `.long_match` em `tools_a.s` faz
`move.w (a0)+,d0; add.w d0,d0; bcs .lm_rom; lea -2(a1,d0.w),a2` — aritmética de
16 bits com displacement sinalado ⇒ leitura para trás exige `value >= 0x4000`, ou
seja `off <= 16385`. Replay sob MAME 0.289 com o `lz4w_unpack` montado do asm
oficial (identidade conferida contra `libmd.a`: 5056 bytes, SHA-256 `ff18bacb…`,
em **cada** uma das 6 construções de ROM): `i15` (off 16385, `value 0x4000`) é
reproduzido **byte a byte** pelo 68k e pelo jar; `i16` (off 16386, `value 0x3FFF`)
**diverge no hardware** no byte 0 (`0x24` em vez de `0xBE`, leitura para frente
aliassando a ROM) enquanto o jar de 32 bits reproduz o pretendido. **Evidência
contra nenhuma alternativa:** o produto aceita até 16385 e recusa de 16386 em
diante, exatamente como o hardware; os goldens são calculados à mão, não pela
fórmula do produto.

**Commit do produto:** `13a5792` separou
`MATCH_LONG_FORMAT_MAX_OFFSET_WORDS` (16385, formato/decoder) de
`ENCODER_WINDOW_WORDS` (0x4000, estratégia/codificador) e acrescentou 8 regressões
(16384/16385 aceitos, 16386 recusado citando o teto medido, `value 0` = off 1,
fonte-ROM acima do teto não-ROM aceita — limites independentes —, fonte-ROM além
do histórico recusada, truncamentos dentro de segmento estruturados, e um andador
de tokens que exige que todo offset não-ROM emitido caiba na janela legível).
Cabeçalho obsoleto do módulo corrigido (o arquivo já trateia streams prev-block).

**Prova externa obrigatória executada** (`Rust encode -> 68k decode`, fora do
roundtrip interno): 10 casos / 6 ROMs, todos com veredito esperado —
`i20..i24` (famílias emitidas pelo encoder atual: literais+cauda ímpar, curtos
off 2/off 1, longo auto-referente de 620 B, longo `value 0x0000`, dicionário
misto) idênticos no 68k e no jar; `i09` (stream **original** do recurso 0xc8cc8
com o menor prefixo-dicionário aceito pelo produto, medido em 4096 bytes)
idêntico; `i18` (edição canônica re-codificada pelo encoder **atual**) idêntico
no 68k, e o slot continua o bloqueio real: **150 bytes contra 144** →
`needs_space`, nada forçado por sobrescrita; `i14` é a prova profunda: off 16384
emitido pelo encoder, reproduzido byte a byte pelo hardware. Receita, pins,
SHA-256 por execução e limites do que está provado em
`docs/rex_profiles/LZ4W_68K_ORACLE.md`; evidência (logs, comprimentos, hashes —
**sem byte algum da ROM comercial**) em
`data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26/`; ferramenta de
medição vendorada com proveniência em `scripts/rex_profiles/integrator/lz4w_68k/`
(SHAs por arquivo em `PROVENANCE.md`). **As suítes A e B continuam não
integradas**; só a ferramenta de medição foi copiada, com origem no commit
`9b2389d` do worktree da agente-B.

**ETAPA C (precisão da observação) aplicada:** toda alegação de "não é
descompactado" foi rebaixada ao que foi medido — *nenhuma diferença observada nas
regiões que o core expõe* (`emulator_read_memory` regiões 2/3; CRAM e a
chamada/destino do desempacotador ficam `missing`, porque o core libretro não
expõe tracer e instrumentar o jogo exigiria modificar a ROM comercial, o que está
fora da autorização). O relatório do E2E passou a publicar `observed` e
`coverage` em vez de uma única frase conclusiva.

**Gates neste HEAD:** `cargo test --lib` **668 passed / 50 ignored**; `cargo
clippy -- -D warnings` limpo; `cargo fmt --check` limpo; testes BYOR ignoráveis
reexecutados antes do commit (`160/191` verificados, `preservados=159`, varredura
`fit=4` só no alvo conhecido). Frontend intocado por este checkpoint (a mudança em
`scripts/e2e-tauri-build-run.mjs` é texto de relatório/comentário, sem alteração
de asserção).

**Próximo comando exato:** retomar a ETAPA D — varredura limitada dos recursos
LZ4W com tiles comprovadamente em tela reutilizando `Lz4wDictionaryIndex`; se
nenhum couber no slot, o caminho autorizado é **aPLib em Rust canônico** com os
vetores da agente-B e oráculo independente, ou fixture SGDK autoral rotulado como
fixture (nunca como sucesso BYOR). Bloqueio concreto atual: **nenhum recurso LZ4W
conhecido aceita reinserção dentro do espaço original** (`fit=4` apenas em
0xc8cc8, todas as edições `needs_space`), e expansão de ROM/realocação de
ponteiros não está autorizada nesta rodada.


### Checkpoint 2026-09-26 — retratação da classe do alvo, sonda causal sem diferença observada e três defeitos de formato corrigidos (Experimental; sem merge)

O operador reabriu apenas o aceite semântico/visual do alvo 0xc8cc8. **Retratação**: a leitura "9 paletas × 16 cores" e o mecanismo "cor de transparência tornada opaca" eram inferências sem evidência de consumidor — retirados do estado corrente (histórico preservado nos checkpoints 2026-09-25 (b)/(c)). O "efeito de recolorimento dos lutadores" era **ruído de medição**: o resume do loop vivo entre runs separados avançava o jogo por tempo real variável, dessincronizando os frames comparados. A sonda causal nova — WRAM/VRAM lidas via `emulator_read_memory` (regiões 2/3 do GPGX; CRAM não é exposta) com run_frames determinístico — **não mediu nenhuma diferença** entre original e modificado em 900 frames, com controle original/original idêntico (determinismo e metodologia validados). **Precisão (ETAPA C, 2026-09-26): isso não prova que "o recurso 0xc8cc8 não é descompactado"** — a sonda só alcança as regiões que o core expõe (regiões 2/3; CRAM e a chamada/destino do desempacotador ficam `missing`). O que fica registrado é *ausência de diferença observada nas regiões amostradas*, que é enunciado mais fraco; consumidor continua **não provado** e a edição semântica deste recurso permanece **BLOQUEADA** (o E2E registra `semanticState: BLOQUEADO`, agora com campos `observed`/`coverage` explícitos, e exige frames idênticos).

**Três defeitos reais corrigidos nesta rodada**: (1) o encoder emitia matches longos não-ROM com offset até 0x8000 words, mas o 68000 lê o word de offset como int16 após duplicação — v < 0x4001 é referência PARA FRENTE, fora do formato; janela do encoder e validação do decoder restauradas ao limite oficial de 0x4000 (o 18bdff92, artefato do binário pré-correção, decodificava byte 30 como índice 1 com dano colateral em 36-44); (2) o preview em grade lia a faixa de tiles linearmente (`src=(y*8+x)*4`), escondendo edições fora do tile 0/linha 0 — mapeamento corrigido + teste de regressão; (3) a transação não verificava a ida-e-volta — agora redecodifica o novo stream com o mesmo dicionário e recusa qualquer divergência. Evidência de bytes: intervalo alterado [30,31), byte 30 0x00→0xF0 (pixel (0,7,4)→índice 15, a única edição que coube: needs_space honesto de 150>144 nas demais posições com o encoder corrigido). Índice de dicionário reutilizável (`Lz4wDictionaryIndex`) para a varredura (item 7); varredura orçada (64 candidatos/recurso, progresso, checkpoint promovido para `scripts/rex_profiles/integrator/analysis-2026-09-26/rex-scan-checkpoint.log`): fit=0 nos 18 recursos com tiles em tela. Simulação do desempacotador 68000 (`scripts/rex_profiles/integrator/analysis-2026-09-26/rex_68000_sim.py`, fiel a tools_a.s: COPY_MATCH, .lm_len via salto relativo, .lmr com tabela de paridade, ROM-source em espaço do stream): asm ≡ Rust nos streams decodificáveis; 25/191 headers são falsos positivos estruturais (tamanho 0/inválido). **Superação metodológica (2026-09-26): a simulação deixou de ser o padrão — o desempacotador real foi montado do `tools_a.s` oficial e executado sob MAME; ver checkpoint do integrador abaixo e `docs/rex_profiles/LZ4W_68K_ORACLE.md`.** E2E final: fluxo UI completo (verificar/prévia/no-op/editar/transação/BPS re-aplicado com hash exato/salvar-reabrir com prévia alterada `74c38128`/canvas == core 320×224/frames idênticos). 159 recursos verificados preservados. Gates locais verdes; push `0ba067b`+; sem merge/release.

### Checkpoint 2026-09-25 (c) — formato chunky corrigido e efeito observado no jogo pela UI (Experimental; sem merge)

O operador identificou o defeito que invalidava a prova visual anterior: tiles MD 4bpp são **chunky (nibble empacotado)** — `byte = tile*32 + linha*4 + col/2`, nibble alto na coluna par — e não planar. Confirmado na fonte (`ImageUtil.convert8bppTo4bpp` do rescomp do toolchain pinado: `result[i] = (data[2i]<<4)|data[2i+1]`) e consistente com o editor de tiles Sonic já existente (`sprite_composition`). Correção no produto: contrato único `md_pixel_location`/`md_read_pixel_index`/`md_write_pixel_index` (preserva o outro nibble e todos os demais bytes), **golden literal assimétrico** `12 34 56 78` -> índices 1..8 com expectativa escrita à mão (não derivada do renderer), testes de primeira/última posição, no-op e limites.

**Efeito observado no jogo, pela UI, com o E2E `rex-lz4w-effect` completo**: fluxo inteiro pela interface (verificar 160 recursos -> prévia chunky -> no-op -> edição pelo formulário pixel (0,0) índice 15 -> transação aplicada (159 preservados) -> BPS re-aplicado à cópia da base com hash exato -> **salvar/reabrir**: a ROM modificada reabre no painel com identidade própria e prévia de pixels diferente -> ROM modificada executada no core). Duas capacidades registradas em separado: framebuffer do core via `emulator_observe` (determinístico) e **apresentação pelo canvas do app** — o canvas 320×224 exibe byte a byte a subimagem 256×192 do core em (0,0) (HAMOOPIG usa 256×192; comparador localiza o conteúdo dentro do canvas). **Efeito**: frame 2 das timelines determinísticas, 3174 px em caixa (56,114) 208×94 — **os dois lutadores recolorem**. Explicação honesta: o alvo 0xc8cc8 não é tile — são **288 bytes = 9 paletas × 16 cores** (classe PALETA) e o pixel (0,0) editado é a cor 0 da paleta 0, a cor de transparência, tornada opaca; todo sprite com paleta 0 recolore. A asserção do E2E agora codifica o efeito esperado por classe (paleta: recolorimento da faixa dos sprites; tile: caixa pequena). hashes: modified `a51cfaf9…` (idêntico ao teste Rust — determinismo), patch `2aaf7808…`. Pendente honesto: recurso da classe TILE renderizando em tela que aceite edição transacional (varredura completa por tile em andamento a pedido do operador; 18 recursos com tiles em tela por casamento invariante de paleta recusam 1 pixel no tile 0). Gates: frontend/tsc/lint limpos, Rust 23 rex + suíte, fmt/clippy ok; push `da5851d`; sem merge/release.

### Checkpoint 2026-09-25 (b) — cadeia LZ4W pela UI até patch verificado; efeito visual bloqueado no alvo (Experimental; sem merge)

Na branch integradora `codex/rex-integrator-profiles-codecs` (PR #78), a cadeia de recurso comprimido chegou à UI do produto com transação canônica. **No produto (Rust + IPC + UI)**: `reinsert_transaction` com identidade SHA da ROM, evidência re-verificada contra os bytes, tamanhos/overflow, dicionário fixado, no-op explícito, dependências verificadas sobre o conjunto analisável declarado (160/191 recursos LZ4W verificados no corpus congelado; 159 preservados + 1 editado) e patch BPS pelo pipeline canônico re-aplicado à base com hash exato. Nova aba "Recursos comprimidos" no Reverse Workspace: listagem estrutural rotulada, prévia chunky 4x com pixels SHA-256, edição por formulário (tile/linha/coluna/índice) e por clique, proveniência com caminhos da cópia modificada e do patch. Aceites BYOR separados em testes `#[ignore]` com SHA-256 obrigatório (ausência de ROM = falha, nunca PASS silencioso).

**E2E `rex-lz4w-effect`** (binário canônico reconstruído): navegação pela UI, verificação (160 recursos), prévia, no-op, edição via formulário, transação aplicada, patch BPS re-aplicado à cópia da base com hash exato, e timelines original-vs-modificado no core Libretro com `emulator_run_frames` + `emulator_observe` (framebuffer direto do core, determinístico). **Resultado honesto: nenhum frame difere** — o alvo 0xc8cc8 (9 tiles, frame 24×24 confirmado pela estrutura SpriteFrame na ROM, classe faísca de golpe) não renderiza na janela explorada (boot, título, round, caminhada com contato, 6 golpes com snapshots densos); o protótipo teto pode não invocar faíscas visualmente. Negativos comprovados em produção: ROM com identidade errada recusada; dependente conhecido alterado recusado pela UI (`dependent_modified: 0x91a00 dependente de 0x8ff8e`); falta de espaço (`excessive_output`); resposta da transação distinta exibida como erro do painel. Bloqueio exato registrado: encontrar um recurso LZ4W com renderização observada (candidatos: estados de KO/fim de round; grafo de ponteiros SpriteDefinition -> TileSet para achar o recurso renderizado). Zero divergências nos 159 recursos verificados preservados — nada disso equivale o jogo inteiro. Gates: frontend 699/6, Rust 655/0/50, clippy/fmt/tree limpos; commits coesos, push `0a6f689`, CI por consulta pontual; sem merge/release.

### Checkpoint 2026-09-25 (a) — primeira cadeia real comprimida executada no produto (Experimental; sem merge)

Na branch integradora `codex/rex-integrator-profiles-codecs` (PR #78, sobre #77), o LZ4W SGDK foi implementado em Rust canônico (`src-tauri/src/tools/reverse/decomp/rex_codecs.rs`) com oráculo oficial bidirecional: `decode(produto, encode(lz4w.jar, x)) == x` e `decode(lz4w.jar, encode(produto, x)) == x`. Dois defeitos reais foram fechados durante o diferencial: (1) literais são words LE copiadas verbatim (não BE); (2) match longo exige comprimento ≥ 3 (byte extra 0 = "sem match") e o offset longo é negação de **15 bits** (`& 0x7FFF`). Descoberta estrutural decisiva: **todos** os ~190 streams LZ4W da HAMOOPIG congelada são prev-block (o ResComp empacota cada recurso com os bytes anteriores como dicionário, flag ROM source); o decoder ganhou `lz4w_decode_with_dictionary` (port exato do unpacker: offsetAdj +1/token, +1/word longo, -comprimento/match) e o teste de corpus verifica 100+ streams decodificando exatamente `numTile*32` bytes com dicionário = prefixo da ROM. O encoder ganhou dicionário + lazy matching (o autocontido dá needs_space em 157/160 — honesto, os originais dependem do dicionário).

Primeira cadeia real executada no produto (`rex_resources.rs`, teste `chain_scan_decode_edit_reinsert_on_frozen_corpus`): scan estrutural de headers TileSet -> verificação por decode exato -> edição determinística de pixel -> re-codificação com dicionário -> reinserção em cópia sem expansão -> diff de 74 bytes confinado à região do stream (header `0x25788`, stream `0xc8cc8`, 9 tiles; ROM original `558bea6c…` -> modificada `a51cfaf9…`) -> o stream reinserido decodifica para a edição e **todos os outros recursos verificam byte a byte idênticos** (nenhum dependente quebrado; candidatos com dependentes ou sem espaço são recusados de forma estruturada). Identificação é estrutural assistida e rotulada (header declara codec/tamanho), não descoberta automática. Pendentes para o aceite integral da rodada: prévia PNG no produto, IPC/UI, efeito observado no core Libretro via E2E desktop, aPLib decoder/encoder, perfis de endereçamento no produto. Agentes A e B entregaram parciais (PRs #80/#79) e estão bloqueados por limite de uso até ~15:21; MD linear completo do A (3 commits) e vetores Nemesis/Enigma/aPLib/LZ4W do B. Gates do integrador: 17 testes rex focados verdes, clippy/fmt limpos; sem merge/release.

### Checkpoint 2026-09-24 (e) — rodada REX paralela iniciada: contratos v1 e base confirmada (Experimental; sem merge)

Branch integradora `codex/rex-integrator-profiles-codecs` criada sobre `0d8c413` (sem merge/release; cadeia #75→#76→#77 conferida OPEN/MERGEABLE com bases corretas — #76 sobre `codex/nodegraph-organize-authoring`, #77 sobre `codex/reusable-behaviors`). Validação independente do integrador, distinta das provas do executor: o CI remoto do HEAD `0d8c413` agora está **verde em todos os checks** (`validate`, `linux-validate`, `desktop-smoke` consultados via `gh pr checks 77`), resolvendo a pendência do checkpoint 2026-09-25 (c); os quatro relatórios de prova foram reconferidos programaticamente (coleta 4/4, independência 6/6, NodeGraph 13/13, reference-platformer 16/16, todos `failed=0` e app SHA `9a6afe4b7c822b0ab750f8b518bb16376dae75b2698406161f3683d442d8a696`, binário local com o mesmo hash); o corpus local teve os quatro SHA-256 reconferidos (Sonic BYOR, HAMOOPIG, Taiketsu, doador PNG). Diff do harness `59714bd..0d8c413` revisado por inteiro: mudanças **endurecem** gates (avanço de quadros exigido, apoio real observado, liberação de B consumida pela ROM, trajetórias preservadas em falha, áudio medido durante fonte ativa com SFX de salto); nenhuma flexibilização detectada.

Contratos REX v1 congelados em `docs/rex_profiles/CONTRACTS.md` (perfil/evidência/endereçamento/codec/recurso comprimido; erros estruturados; status cumulativos separados; oráculo externo fixado antes da implementação). Estado da rodada e dono do job pesado único (integrador) em `docs/rex_profiles/ROUND_STATE.md`, matriz inicial toda `blocked`. Worktrees A (`/home/misael/RDS-REX-A-addressing`, branch `codex/rex-a-addressing`) e B (`/home/misael/Projects/REX-B-CODECS-2026-09-24`, branch `codex/rex-b-codecs`) sobre a mesma base `0d8c413`; prompts A/B/integrador versionados em `docs/handoffs/`. Corpus preservado intacto e somente leitura para A/B. Próximo passo: publicar branch, alinhar A/B com os contratos, agentes em paralelo e integração MD linear/SSF2 + aPLib/LZ4W com cadeia real comprimida.

### Checkpoint 2026-09-25 (c) — PR #77 e correção de gate Desktop E2E no CI (Experimental; sem merge)

Branch `codex/collect-counter-goal` publicada, PR dependente [#77](https://github.com/Misael-art/RetroDevStudio/pull/77) contra `codex/reusable-behaviors` (#76), sem merge/release. O primeiro Desktop E2E remoto do HEAD `5eaa4af` falhou em `reference-platformer` por duas asserções herdadas do comportamento antigo: procurava `static s32 logic_var_reference_score` embora o C atual declare `static volatile s32` desde `6ab0b44`, e exigia áudio não nulo numa janela tardia após o VGM do template (gerado para tocar meio segundo e terminar). O E2E agora exige explicitamente a declaração `static volatile s32`, mantém comparação de layout não vazia/igual após salvar e reabrir, e aciona um SFX de salto pelo teclado nativo para medir crescimento de frames não nulos recebidos e renderizados no AudioContext durante uma fonte ativa. A prova acústica/loopback permanece separada e inconclusiva quando indisponível. Regressão local `reference-platformer-2026-09-25T01-09-09-520Z-report.json` passou 16/16 no mesmo app SHA `9a6afe4b7c822b0ab750f8b518bb16376dae75b2698406161f3683d442d8a696`; projeto preservado em `/home/misael/Documents/RetroDevProjects/Reference_Platformer_1790298551976`. Novo CI do commit de follow-up ainda pendente neste checkpoint; não usar o CI falho anterior como aceite.

### Checkpoint 2026-09-25 (b) — guarda por instancia e validação integrada (Experimental; sem merge)

Na branch `codex/collect-counter-goal`, sobre HEAD inicial `59714bd`, foi confirmado um defeito real distinto do falso negativo do salto: duas entidades com grafo serializado idêntico e mesmo `node_id` compartilhavam a guarda de `event_start` (`graph_sha256` truncado + nó), de modo que só o primeiro script de início executava. O teste em `ast_generator.rs` usa AST real e C emitido, falhou antes da correção (1 declaração para 2 entidades) e passou depois. A guarda agora codifica `entity_id` e `node_id` em hexadecimal, preservando identidade sem colisão da sanitização ou hash curto; `event_update` segue por quadro. Nenhuma mudança em `volatile`. O harness desktop passou a esperar apoio/borda de input efetivamente consumidos na ROM e registrar trajetórias de RAM, sem afrouxar negativos.

Gates: `cargo fmt --check`, `cargo clippy -- -D warnings`, Rust 634 passed / 47 ignored, lint, `tsc --noEmit`, frontend 696 passed / 6 skipped, `check:tree`, `node --check` do E2E e `host:certify` passaram. Build canônico `npm run build:debug` com frontend atualizado gerou o app SHA `9a6afe4b7c822b0ab750f8b518bb16376dae75b2698406161f3683d442d8a696`. No mesmo binário, em sequência: `collect-goal-2026-09-25T00-25-09-531Z-report.json` 4/4, ROM `4ffc4da9478869c876459cb46205a9c6d503a2fb2624b99c023239aac340dccd`; `behaviors-independence-2026-09-25T00-31-49-668Z-report.json` 6/6, ROM `56f014ff828a7e5e018241abb579a8394dd4793f12863e4b36c8644755061a98`; `nodegraph-authoring-2026-09-25T00-46-31-751Z-report.json` 13/13, ROM `3044e663a6285c9622d28a0a3fd11dee888a1e48c2d2daa3225596bd8f09bd04`. Projetos gerados foram preservados com `RDS_E2E_KEEP_PROJECT=1`. Tentativas falhas e trilhas permanecem em `target-test/validation`: apoio ainda falso no primeiro toque, botão ainda não liberado na ROM, amostragem que perdeu quadros intermediários, e uma colisão transitória na porta 4444 do driver. Nenhuma dessas falhas foi promovida a prova positiva.

Provas: coleta creditou cada item uma vez, contador 1→2, passagem abriu em 2, objetivo one-shot e recarga da mesma ROM zerou contador/flags; pixel B e áudio sem linha de base continuam inconclusivos. Salto: ápices J1/J2/segurado/J4 15/15/15/15, pressão no ar sem reinício, botão segurado sem novo salto no pouso, apoio independente; passagens bloqueadas dos dois lados, saída de sobreposição e abertura no limiar com C independente ainda fechada. NodeGraph incluiu troca real Z→X, persistência/reabertura e vitória por teclado. Limite: "reiniciar partida" provado aqui por recarga da ROM; reinício de cena e reset interno não foram equiparados. Passagem continua restrita ao movimento horizontal do comportamento. Próximo passo: revisão final do diff/staging, commits coesos, push da branch e atualização do PR dependente; acompanhar CI sem merge/release.

### Checkpoint 2026-09-25 — reprodução do salto e causa das falhas do E2E (Experimental; sem correção de produto)

Na branch `codex/collect-counter-goal`, HEAD `59714bd`, o app SHA `77ec65468b424ef5d1049dc2e4250581bf866f35d5028c58110305d0a9bdfa94` foi reexercitado pelo E2E `behaviors-independence` com `--skip-build` e `RDS_E2E_KEEP_PROJECT=1`. Falha J1 reproduzida na ROM SHA `b2371fa816f4a59c05da44152fecafba6578331c8246f3be1823ec408e1c2ee2`; projeto `/home/misael/Documents/RetroDevProjects/Behaviors_1790294005954`, trilha `src-tauri/target-test/validation/behaviors-independence-2026-09-24T23-53-24-306Z-failed-salto-J1-trace.json`. O ACK nativo de X/B foi verdadeiro, mas na ROM o Player 2 ficou em `y=176`, `vel_y=0`, `_on_ground=0` durante o toque; somente depois o apoio virou 1. A espera inicial inferia apoio por Y estável sem verificar o apoio real. O C gerado preservado contém o ramo `BUTTON_B && !rds_joy_prev_1`, a condição `spr_player__player_2_on_ground` e a escrita de impulso `spr_player__player_2_vel_y = -64`. A falha J4 posterior mostrou ACK de soltura com `rds_joy_prev_1=16` ainda na ROM no momento da nova pressão: faltava um quadro de liberação consumido. Outra falha de medição contava ápices só depois do toque, omitindo a subida durante o toque. Não há evidência de que `volatile` ou a guarda `event_start` tenham causado essas falhas.

O harness `scripts/e2e-tauri-build-run.mjs` agora observa posição, velocidade, apoio e botão anterior na RAM, grava trilha integral quando `sampleUntil` falha, espera apoio real e a liberação de B consumida pela ROM, e inclui amostras do toque no ápice. Reexecução no mesmo app: `behaviors-independence-2026-09-25T00-02-10-776Z-report.json` passou 6/6; ROM SHA `d6c6a845cd2cabe24868a3219dd62c470440d8e26e7748bec339874cc9eb1ac7`. Salto: ápices J1/J2/segurado 15/15/15, J4 11, Player 3 5, Player 2 enquanto Player 3 no ar 11; passagem A/B abertas em score 28 e C fechada. Projeto completo preservado em `/home/misael/Documents/RetroDevProjects/Behaviors_1790294533598`; C gerado SHA `724200fe8fedd1fe773cc859d3263945adcc26972a2a111772512e6987008fbc`, ELF SHA `65b8ce616ff0879f1425e661b0b82b3c572a5e9e501feddfc0c9de8a3ecfe3ef`, ROM local coincide com o relatório. `node --check`, `check:tree` e `git diff --check` passaram. Próximo trabalho: avaliar guardas de `event_start` para duas instâncias equivalentes no AST/C real e executar os três E2Es sequenciais após build canônico e gates; coleta 4/4 neste app é prova herdada, `nodegraph-authoring` ainda não foi reexecutado neste app. Nenhum commit ou push nesta etapa.

### Checkpoint 2026-09-24 (d) — diagnóstico inicial da regressão de salto (Experimental; sem push)

Handoff recebido na branch `codex/collect-counter-goal`, HEAD `59714bd`, três commits à frente de `origin/codex/collect-counter-goal`; somente `data/canonical-local-2026-09-21/` está não rastreado e deve ser preservado. `npm run host:diagnose`: READY (fingerprint `60249508…`, lock `dd99a22f…`). Antes de build pesado: 84 GiB livres, 6,3 GiB de RAM disponível; não encerrar processos de outras sessões.

Evidência herdada: `collect-goal-2026-09-24T21-15-11-612Z-report.json` passou 4/4 no app SHA `77ec65468b424ef5d1049dc2e4250581bf866f35d5028c58110305d0a9bdfa94`, ROM SHA `3754f582f063c59fb42007717f11393ef21595583137bb64a70e5b01860251a2`. O `keyboard_collect_goal` registra contador 1→2, passagem fechada→aberta, objetivo uma vez e recarga da mesma ROM com estado zerado. Pixel do item B e áudio sem controle não são prova. Os últimos relatórios de `behaviors-independence` e `nodegraph-authoring` completos são anteriores (app SHA `12dc97d9…`); tentativas posteriores deixaram screenshots `21-23-34-639Z` e `21-20-08-009Z`, mas não relatório final. Não reutilizar esses relatórios como aceite do app atual.

Hipótese atual ainda não confirmada: possível interação de ordem/estado na ROM gerada após a guarda `event_start`; `volatile` não está implicado. Inspeção inicial: o comportamento de salto começa em `event_update`, lê `input_pressed` e `condition_on_ground` da entidade alvo; `sgdk_emitter` emite lógica no `SpriteUpdate`, com `rds_joy_prev` atualizado no `VSync`. A física escreve `_on_ground` por entidade. O teste auxiliar `generate_ast` em `ast_generator.rs` remove guardas e não serve para validar o programa final; `event_start_runs_once_per_match_not_every_frame` usa AST real, mas não cobre duas instâncias equivalentes. Próximo passo exato: preservar um projeto/reprodução atual e seu `main.c`, ROM, hashes e trajetória RAM; comparar C com `edb3477`, identificar onde o impulso some e então escrever regressão que falhe antes da correção. Rodar os três E2Es no mesmo novo binário apenas depois da correção e dos gates. Nenhuma mudança de produto foi feita neste checkpoint.

### Checkpoint 2026-09-24 (c) — salto do chão e prova física da passagem (Experimental; sem merge)

PR #76. Salto de "Movimento e salto" só com apoio (novo nó `condition_on_ground`, estado de apoio por entidade medido em todo quadro na física SGDK). Passagens encadeáveis no mesmo movimento. E2E `behaviors-independence` 6/6 no binário `12dc97d9…` (commit `dec2f65`): salto do chão, pressão no ar sem reinício, segurar sem voo, novo salto após pousar, apoio independente; passagem bloqueia pela esquerda/direita a 8 px/quadro sem sobrepor a colisão, quem começa sobreposto sai, atravessa no mesmo lugar após o limiar e a outra passagem (60) segue fechada — tudo por posição na RAM contra limites de colisão. `nodegraph-authoring` 13/13 no mesmo binário. Matriz: `docs/REX_BEHAVIORS.md`.

### Checkpoint 2026-09-24 (b) — comportamentos reutilizáveis (Experimental; sem merge)

Branch `codex/reusable-behaviors`, dependente do PR #75. "Movimento e salto" e "Passagem condicionada" parametrizados, gerando nós canônicos; instâncias com id único na cena, plano com conflitos antes de aplicar/editar/remover, duplicação de entidade remapeando comportamentos. E2E `behaviors-independence` 6/6 no binário `ccd0dab9…` (commit `9fb0c89`): duas cópias do jogador com controles/velocidades próprios, editar/desfazer, cópia remapeada, remoção, reinício e teclado com controles negativos; passagem abre no score 20. Defeitos corrigidos: salto sem efeito em entidades que compartilham sprite (variável de física errada no gerador), cópias de prefab herdando lógica manual/`graph_ref`, edição perdida ao trocar de entidade, commit obsoleto após refazer, grupo recolhido encobrindo nós. `nodegraph-authoring` reexecutado 13/13 no mesmo binário. Matriz: `docs/REX_BEHAVIORS.md`.

### Checkpoint 2026-09-24 — NodeGraph organizado e editável (Experimental; sem merge)

Branch `codex/nodegraph-organize-authoring` (sobre a arte da raposinha). Organizar pelas conexões reais (só posições, semântica guardada), fixar, organizar seleção, desfazer/refazer com Ctrl+Z/Ctrl+Y, registro visual único, cartões em português com entidade/miniatura, portas tipadas, ímã de conexão com Esc, grupos e navegação por entidade, regras editáveis com "Senão". E2E desktop `nodegraph-authoring` 13/13 no binário `bcd94007…` (commit `bb0b2d0`): pulo trocado de A/Z para B/X comprovado jogando, limiares 12/60 independentes, som `victory`, sobreposições 93→0, reinício/reabertura preservados, grafo de 106 nós em 22 ms. Corrigidos: `BUTTON_START`→`BUTTON_A`, histórico apagado pelo eco do autosave, Backspace apagando nó. Usabilidade humana não validada. Matriz: `docs/REX_NODEGRAPH_AUTHORING.md`.

### Checkpoint 2026-09-23 (d) — arte da raposinha e paisagem no template (Experimental; sem merge)

Branch isolada `codex/reference-platformer-fox-art`. Os placeholders do template `reference_platformer` foram substituídos por candidatos técnicos criados a partir de fontes originais: raposinha kawaii de cachecol vermelho e espada de madeira (cinco quadros 32×32), portão 24×32, bandeira 16×32 e fundo de montanhas/floresta 320×224. Conversão e workset validados com o SGDK Forge; primeiro plano de grama/terra/tijolo continua provisório. A arte é `technical_candidate`, com aprovação estética humana pendente. Rebuild desktop do commit `9901b5f` SHA `9224bdd04343d14402e83b61d842a4ee0fe485c62805bb6715b1fbcfc629cb37`; autoria guiada 10/10 e reference-platformer 16/16 reexecutados nesse binário, incluindo salvamento/reinício/reabertura e vitória por teclado. Evidências finais versionadas e hashes em `data/reference_platformer_art/README.md` e `data/reference_platformer_art/doc/evidence/`; evidências anteriores preservadas. Não confundir este checkpoint com o aceite de arte final.

### Checkpoint 2026-09-23 (c) — autoria guiada ponta a ponta (Experimental; sem merge)

Aceite `authoring-acceptance` passou 10/10 no binário `6cebe930…` (commit `a6c02af`): criar fase, ver recursos, editar cenário/colisão/animação, duas passagens, associar som, salvar, reiniciar, reabrir, compilar e vencer jogando pelo teclado, com o som `victory` observado nas amostras recebidas do core. Corrigidas perdas silenciosas de trabalho (recarga do disco na hierarquia e no salvar com falha, debounce do NodeGraph), PPM no WebView, overrides de prefab, semântica de tile vazio, paredes laterais e identidade da ROM no Build & Run. Regressões reexecutadas: reference-platformer, ADDQ, branch-compare, reinserção Sonic. Matriz: `docs/REX_AUTHORING_ACCEPTANCE.md`.

### Checkpoint 2026-09-23 (b) — cenário/colisão/animação pela UI e reinserção gráfica em ROM (Experimental; sem merge)

E2E `reference-platformer-2026-09-23T03-06-00-927Z-report.json` 16/16: fosso pintado (visual + colisão) e FPS idle 12 editados pela UI chegam à ROM (descida física no fosso, região visual alterada vs. controle, troca de frame a cada 5), junto com a segunda passagem. Corrigidos: reidratação do NodeGraph que apagava edições locais; override parcial de sprite em instância de prefab que invalidava o salvar (outras edições aninhadas do Inspector em prefabs não auditadas); validação do NodeGraph para referência de entidade e parâmetros. Etapa 6: reinserção de tiles 4bpp com tamanho preservado no frame Sonic stand (DPLC `0x217FE`, tiles 11..16 compartilhados com o frame 5), E2E `inspection-sonic-tiles` passou (negativos, BPS, base intacta, 96 pixels no torso em jogo, reabertura). Regressões reexecutadas: Sonic paleta + jogo canônico, ADDQ e branch-compare verdes. Pendentes: associar SFX pela UI, concluir o objetivo por teclado nativo no fluxo autoral, loopback acústico.

### Checkpoint 2026-09-23 — fluxo autoral: input real, SFX audível, passagens reutilizáveis (Experimental; sem merge)

Branch `codex/rex-reference-goal-pilot`, commit `c3f6de4`. Corrigidos defeitos que invalidavam provas anteriores: KeyZ chegava como MD C (GPGX: RetroPad Y=A), Build & Run deixava `coreEpoch` obsoleto (teclado recusado; o fallback no core mascarava), `SOUND_PCM_CH_AUTO` tornava todo SFX XGM v1 mudo, `input_pressed` era "segurado", BGM reiniciava por frame, passagem só bloqueava pela direita, entidades de mesmo asset colapsavam, colisão pintada não tinha efeito físico. E2E `reference-platformer-2026-09-23T02-17-00-937Z-report.json` (binário `95095d3d…`) passou 15/15, incluindo salto/movimento nativos lidos da RAM, áudio encaminhado ao AudioContext e segunda passagem criada pela UI (Inspector duplicar/posicionar + painel Passagens) com abertura independente. SFX de vitória provado por teste real contra controle com WAV silenciado. Loopback acústico inconclusivo no host. Pendentes: animação na ROM, validação de regra pela UI, autoria completa sem preparação, reinserção gráfica em ROM. Matriz em `docs/REX_REFERENCE_GOAL_PILOT.md`.

### Checkpoint 2026-09-22 — passagem transitável ligada ao objetivo autoral (Experimental; sem merge)

A branch dependente `codex/rex-reference-goal-pilot` agora mantém entidade `passage_blocker`, marcador `goal` e sensor `goal_sensor` separados. O bloqueador visual e sólido é contornado somente quando `goal_open` vale 1; inputs equivalentes observaram player `x=41..50` bloqueado e `x=57..66` após atravessar, com pixels da barreira `399→0`. O score foi lido da RAM real nas fronteiras abaixo/igual/acima de 6 e 12, e após 8 frames: score 8 em ambas as ROMs, abrindo só limiar 6. O grafo/C compara o score já armazenado após incrementar. A UI expõe `Pontos para abrir passagem`; foi exercitado editar 6→12, salvar, fechar/reiniciar, reabrir e confirmar source mapping antes de compilar/executar.

E2E desktop final `src-tauri/target-test/validation/reference-platformer-2026-09-22T23-32-40-004Z-report.json`; binário exercitado SHA `f0eada419f91f8b05b0a0ddf2484684f14ef0bf0b9fbb85eb23235e68c72e319`. As ROMs imutáveis testadas: limiar 6 `0351d890630885daf2115fca32c6c94bcc6d4461f721f9516150960b59adcd8c`, limiar 12 `bd97076a3a85c1bd3b5b2986664bb1214b1fc975bf28ba4ef6b457597afd87ee`. O contato real com sensor leu `goal_reached=1`; no C gerado, a chamada PCM precede a escrita one-shot observada. A captura acústica desta chamada não é medida. O smoke genérico de salto fica separado e inconclusivo se faltar ACK/efeito visual; isso não é usado como evidência da passagem. As capturas, fonte e cópias ROM são anexadas pelo workflow Desktop E2E.

O perfil e o comportamento seguem **Experimental**, limitados ao grafo/template Mega Drive provado. ADDQ e branch-compare continuam regressões separadas; sem aumento do conjunto de instruções, sem declaração de suporte geral e sem merge. Consulte `docs/REX_REFERENCE_GOAL_PILOT.md` para a matriz comprovado/pendente.

### Checkpoint 2026-09-22 — perfil ROM→Node delimitado (Experimental; implementado; equivalência e causalidade pendentes)

Foi implementado o primeiro perfil de recuperação de lógica ROM com contrato exato: Mega Drive/M68K, `ADDQ.W #1,D0; RTS` em quatro bytes contíguos, source mapping por offset/hash, flags word completas, nenhum efeito de memória, estados independentes e patch somente para cópia distinta com SHA-256 e imediato `1..8`. A UI `ReverseWorkspace` e o NodeGraph carregam o nó `rom_addq_word`, com origem `rom_recovered`, sem sobrescrever lógica existente. O emissor SGDK materializa a semântica preservando `D0[31:16]`; o emissor SNES bloqueia explicitamente esse perfil MD-only.

Limitações são parte do contrato: callers indiretos/PC-relative e trace dinâmico continuam desconhecidos; a varredura estrutural lista apenas `JSR` absoluto; bytes fora do corpo de quatro bytes não são inferidos. A fixture durável `src-tauri/tests/fixtures/logic_recovery_sgdk/` (com o resumo versionado `e2e-proof-report.json`) e a receita `npm run fixture:logic-recovery` agora cobrem separadamente node→C→ROM e rotina vinculada→patch→ROM. O E2E final `src-tauri/target-test/validation/logic-recovery-2026-09-22T14-06-47-769Z-report.json` passou com SGDK/Genesis Plus GX oficiais: estado/input comum `0x12340058`, warmup controlado de 120 frames, uma asserção, oracle independente de D0/flags em WRAM, node/original-original/no-op/#2, hashes completos e reabertura com operação, conexão e source mapping. O ROM efetivamente gerado pelo grafo reaberto é identificado como `generated_from_reopened_nodegraph` e foi observado como `0x12340058→0x12340059`; original #1 repete o resultado e patch #2 produz `0x1234005A`. O relatório também fixa o binário Tauri realmente testado pelo SHA `47afc7269b9873d8664abe9594375482c00f3b77b09b76235b1f14d457cb8c78`. ROMs: node `6d4fb26780426fd73c010840d4facbd8059ddeb29e4e777106a1fa9fb63f18a4`; grafo `728be5cb72b7a38704a1acdd70db7e47801265f921cf6b14902ca060461aa7a8`; rotina `2e0a6b19b6f73891e16a5a23c4df211721e13eb59b0431b43ceb9601bb181ce2`; patch #2 `08c69960430610c983f0721a63ac8f538d74fc8896c7927abfda8e9621af7e86`. Isso fecha a causalidade somente para o perfil/fixture delimitado, não equivalência geral, Sonic ou callers reais. A ROM autoral `/tmp/rds-reference-platformer-proof.bin` continua corretamente rejeitada.

### Checkpoint 2026-09-22 — autoria persistente de tilemap (Experimental)

O relatório fresco `src-tauri/target-test/validation/reference-platformer-2026-09-22T02-58-57-254Z-report.json` fecha o fluxo desktop nativo do template `reference_platformer`: paleta PPM `P6` carregada por IPC seguro de bytes do projeto, pintura `col=1,row=25` `0→2`, undo/redo `0→2`, colisão separada preservada em `88`, save, leitura do JSON salvo, reabertura com valor `2` e rebuild. A ROM inicial/autoral mudou a ROI do tilemap de `92e737c5` para `26a7da45`; o mesmo hash foi observado após a reabertura. O emissor SGDK agora transporta `cells[]` como overlay esparso via `VDP_setTileMapXY`, preservando o mapa-base carregado por `VDP_drawImageEx`; `cells` vazio mantém o caminho legado. O tileset PPM não depende mais do `asset://` MIME/decoder do WebView na paleta.

O cenário continua `Experimental`: a prova é do jogo builtin autocontido, não de equivalência/reconstrução de ROM comercial. O checkpoint de tilemap antecede o aceite inicial do bloco F, registrado acima; esse aceite é restrito à fixture SGDK e ao perfil `ADDQ.W #1,D0; RTS`.

### Checkpoint 2026-09-21 — template builtin de jogo de referência (Experimental)

Na branch `codex/rex-sonic1-pilot`, foi adicionado o template registry `reference_platformer` e sua materialização nativa no backend. O projeto é autocontido para Mega Drive: player com três animações, colisão/física/input, objetivo com overlap, tilemap/mapa de colisão, câmera, dois SFX, BGM VGM e NodeGraph de movimento/salto/objetivo. Assets são gerados pelo próprio template; não há ROM comercial, BYOR ou dependência de corpus.

Prova local real: build com SGDK oficial detectado no host produziu ROM com assinatura `SEGA`; a ROM carregou no núcleo Libretro oficial, executou 45 frames com `Right`, mudou o framebuffer e manteve pixels não vazios. Um conflito inicial de símbolos (`goal` sprite vs. `goal` SFX) foi corrigido renomeando o SFX para `goal_sound`. O template e o build real têm testes dedicados; o template continua `Experimental`.

Em 2026-09-22, o cenário WebDriver nativo `reference-platformer` passou no binário canônico: wizard, quatro entidades visíveis, NodeGraph persistido, salvar, build oficial, ROM de 524.288 bytes com cabeçalho `SEGA`, framebuffer 320×224 não vazio, ACK nativo de Right/A, movimento (`diffBytes=924`), salto (`diffBytes=462`), pausa/retomada, fechamento, reabertura e novo build/run. Relatório final: `src-tauri/target-test/validation/reference-platformer-2026-09-22T01-29-49-822Z-report.json`. O emitter SGDK agora carrega paletas sem sobrescrever `PAL0` de tilemap, marca sprites como `VISIBLE`, escreve velocity runtime para `set_velocity` e limita a física ao piso derivado do collision map.

Na mesma base, a inspeção visual desktop passou para HAMOOPIG e Taiketsu usando somente as referências preservadas localmente: HAMOOPIG `558bea6c…f8529be9`, candidato independente `42128/192`, preview `256×16`, frames `spr_ryo_100/frame-0..4`, persistência e recomposição após reinício; Taiketsu `3967996a…42bc7c`, `spr_spark0/frame-0`, nativo `24×24`, pixels idênticos antes/depois da reabertura. O cenário Sonic atual passou a identificação, composição, edição de paleta, BPS, comparação base/aplicada e integridade da BYOR, mas expirou no segundo trecho de boot da trajetória canônica; portanto essa reexecução não é contada como aceite novo do gameplay Sonic, e a evidência aprovada anterior permanece explicitamente histórica.

O teste manual `reference_platformer_real_toolchain_build` agora também exige stream de áudio Libretro não vazio e não silencioso depois do build oficial; passou com SGDK/Libretro instalados. Isso comprova playback determinístico do core para a música autoral do template, não equivalência de hardware. Pintura/undo-redo de tilemap ainda tem cobertura unitária/UI, mas não uma prova desktop autoral dedicada; recuperação de rotina ROM para nós continua bloqueada por ausência de rotina delimitada, source mapping e equivalência independente.

Não alterar as decisões arquiteturais consolidadas por causa desta fatia. Ainda faltam a prova de edição autoral detalhada de sprites/tilemaps/áudio, a recuperação de rotinas ROM para nós e qualquer afirmação de equivalência com jogos importados.

### Checkpoint 2026-09-20 — Sprite-Frame-02 multi-recurso (Experimental)

Branch isolada `codex/rex-sprite-frame-02`, commit de implementação `470ae81`, dependente de `codex/rex-sprite-frame-01-integration`, sem merge. A composição assistida foi generalizada para `spr_ryo_100/frame-0..4` (frame 4 deduplicado com frame 2) e para `spr_spark0/frame-0` de Taiketsu. ROMs BYOR: HAMOOPIG `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`; Taiketsu `3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c`. Fontes: Ryo `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`; Spark `cafaf180ba006903242aa822fb3c0dceb42424a9e0bd07a5a19b75f33a4bf196`.

Destino local verificado: binário `src-tauri/target-test/debug/retro-dev-studio`, SHA `743e22d58668a47734b1ace47fd597e35554303c9e2527765d6a3f9ed0fba476`, frontend `791d6a7`. Taiketsu desktop passou seleção nativa, pixels independentes antes/depois, salvar, reinício, atualização visual da lista persistente, reabertura e recomposição na sessão `inspection-1789914271-00000000`; pixel independente `601829b5a8ab8853fdc1d9047f95ecdfcc6e0f91f73a88ae226ad55c3e70679f`; offsets `0x80060+0x120`, paleta `0x2e134+0x20`, descritor `0x22f94`, nativo `24×24`, CSS `72×72`. Cancelamento separado fechou `cancelled` na sessão `inspection-1789914403-00000000`. A prova Ryo dos frames 0–4 é histórica e vinculada ao binário `082c66d…`; matriz em `docs/REX_SPRITE_FRAME_02_MULTI_RESOURCE.md`.

Classificação permanece Experimental e restrita às ROMs/recursos comprovados. A ROM fornece bytes/offsets/paleta/descritores; metadados do doador fornecem identidade semântica, frame, posições/flips/transparência e transformação do compilador. Não declarar extração automática geral, animação ou reconstrução do jogo.

### Checkpoint 2026-09-20 — destino combinado #70 + #71 certificado e reexecutado

Ancestralidade revalidada por SHA: #69 = `ee70bc4444830eaaa5914175729e23feca06b94e`; #66/#67/#68 = `ba637cf`/`9f77b40`/`09e1d13`, nenhum ancestral de #69. `10c89d1` não é ancestral de #69; seu patch equivalente `e998bbd` é que está na linha de inspeção. O #70 (`8843018`) é ancestral do #71 (`d9fe40d`), e os heads REX chegaram ao destino por `177c831`, `63e730d` e `af6c0f3`. O resultado combinado está sendo preparado em `codex/rex-sprite-frame-01-integration`, sem merge. A comparação de código/testes e a distinção entre ausente, equivalente e presente estão registradas no Current Wave e em `docs/REX_SPRITE_FRAME_01_HAMOOPIG.md`.

Os holdouts `.mimosa`, `.zcode`, `src-tauri/.mimosa` e `src-tauri/src/tools/reverse/decomp-recovery/` permanecem não rastreados e não staged; não foram restaurados nem removidos. No destino `codex/rex-sprite-frame-01-integration`, `check:tree`, lint, tsc, Vitest `622/6`, Rust `615/40`, clippy/fmt e `host:certify` passaram; a certificação reportou frontend `625/3`, Rust `615/40` e upstream SGDK/PVSnesLib `Success: true`.

O build canônico do `d9fe40d7b5fcf56127889e4e1095413083b8dd63` gerou `/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/debug/retro-dev-studio`, 370.695.936 bytes, SHA `e1174d3b0ef8ff45c41dea91535050f99e9f4fc55368a99cd379ca52c86d460c`. A prova desktop no mesmo binário passou com ROM HAMOOPIG SHA `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`, sessão `inspection-1789907881-00000000`, run `run-inspection-1789907881-00000000-00000001`, candidato `42128/192`, frames 0→1→0, pixels independentes, mutação rejeitada, salvar/reiniciar/reabrir e negativo de wizard. O cancelamento foi separado e passou com sessão/run `inspection-1789907951-00000000`/`run-inspection-1789907951-00000000-00000001`, ambos `cancelled`.

Capturas do destino: frame-0 `inspection-2026-09-20T12-37-49-567Z-sprite-frame-0.png` SHA `0fd0d4c5bec385a8594cbb4a93f2d57c81698381588876306c35cb4c8c0a7784`; frame-1 `...sprite-frame-1.png` SHA `d25bc82ebfba9d2a1318dd77d8a8b42b04e167b338d33bb59eec4e7b931a6ec0`; sprite após reinício `...sprite-after-restart.png` SHA `7aa6a80a850159f9e1c8aeb02ee931012776e2640ae7a6706b8811d6dbb43685`. O fluxo permanece Experimental e sem merge.

### Checkpoint 2026-09-20 — PR #71 frame-0/frame-1 reexecutado no HEAD final

No branch isolado `codex/rex-sprite-frame-01`, o HEAD `f0d33470f7e677ab6f5012e0488c152e1258c667` contém o código já provado do PR #71 e o rustfmt exigido pelo CI (`f0d3347`). O build canônico `/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/debug/retro-dev-studio` foi refeito com sucesso e tem SHA-256 `e0fec553aceb18df25d30fc22d3655ff8b8f3fdfc00b6fbbed69a28b87da8982`. O frontend runtime da prova desktop corresponde ao commit de código `5b16970d2c35057805e1ea509da077cade5c13fd`; `f0d3347` é apenas formatação de teste Rust.

ROM BYOR: `/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/hamoopig/reference.bin`, 917.504 bytes, SHA `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`. Fonte PNG doadora: `/mnt/sdcard/Projects/Sgdk Forge/SGDK_projects/HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/res/sprite/ryo/100.png`, SHA `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`; ambas foram preservadas, sem substituir a ROM atual do projeto.

E2E desktop final da seleção `frame-0 → frame-1 → frame-0`, sessão `inspection-1789869813-00000000`, run `run-inspection-1789869813-00000000-00000001`: passou com o rótulo correto `label=prévia anterior removida na troca` e `previousPreviewRemovedOnChange=true`; esse E2E comprova limpeza da prévia anterior na troca, não resposta fora de ordem. A prova determinística de resposta fora de ordem está em `src/components/tools/InspectionPanel.test.tsx:335`: promises controladas mantêm A pendente, B conclui e A é liberada por último; imagem, seleção e proveniência B permanecem. Identidade da ROM/sessão/candidato, offsets e tamanhos foram confirmados no desktop. Frame-0: `0x863A0+0x800`, descritor `0x22260`, paleta `0x2CC68+0x20`, nativo `64×104`, CSS `192×312`, PNG `8bb4dc723fa4d9435f6eaa3ce1c2248df7a20e30b800a6c56bfdd0a54fa96168`, canvas `c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc`, referência RGBA independente `50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58`, índices `938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c`. Frame-1: `0x86BA0+0x840`, descritor `0x222A2`, mesma paleta, nativo `64×104`, CSS `192×312`, PNG `48f82e1ccfb3e96552858cdeb99e535c1823b23e7f938286024d43a047f0fdc8`, canvas `c63a0fd26c561806f5319fb24380983db10b99998048c678f81d2bf45c7fbde0`, referência RGBA independente `15dab9d16df147cc1bb81348fbc0d0a7e65458b34d3d77541df536024af768d0`, índices `77b3b0dba715b352c3ace058abefa5d5d1918d2393dc2064b60a9ed01e0e1903`.

Salvo com frame-1 selecionado, o app foi encerrado e reiniciado; wizard tratado somente por controles visíveis. A seleção, composição, proveniência, ROM, sessão, candidato `0xA490+192` e offsets foram restaurados; pixels foram capturados novamente, CSS `192×312`, escala inteira 3×, `pixelated`, `fullyVisible=true`, `unobstructed=true`. Negativo do wizard: `unobstructed=false`, `selectionUnchanged=true`, `syntheticEvents=false`. Negativos de frame desconhecido e associação frame/metadado divergente foram rejeitados sem reutilização de preview anterior. Capturas finais: frame-0 `inspection-2026-09-20T02-03-19-690Z-sprite-frame-0.png` (SHA `3cd14965d1812455d0fb800b7cb3d4e4a8bc006ccd8de1d4fb0ab09c0b579db8`), frame-1 `...sprite-frame-1.png` (SHA `a810c47180e7b0f0fdef96a20a7f66188adf3c3e689d174c7853c541d28deb6e`), pós-reinício `...sprite-after-restart.png` (SHA `3873e4a1c2f066bb51b7f7379a11617c7e0fe6b3f6d2514665b326d3b06ec891`).

Suíte frontend reexecutada isoladamente com `--pool=forks --maxWorkers=1 --no-file-parallelism`: `621 passed / 6 skipped`; o teste focado após o caso determinístico passou `8/8`; `host:certify` passou com `624 passed / 3 skipped` e Rust completo aprovado (testes ignorados permanecem condicionais). O primeiro timeout/erro de worker ocorreu somente na execução concorrente com a compilação Rust; a repetição serial não removeu nem afrouxou testes. O desktop não foi repetido para esta alteração exclusiva de teste/rótulo; as capturas dos dois frames permanecem válidas. O holdout `src-tauri/src/tools/reverse/decomp-recovery/object_diff.rs` continua intacto apesar do I/O error `rg` reproduzível; não houve limpeza.

Cancelamento permanece explicitamente **herdado do executor do PR #70** e não foi reexecutado nesta alteração de composição. A fatia continua **Experimental**, assistida por metadado doador; não certifica extração automática geral, animação ou reconstrução do jogo. Nenhum merge foi feito.

### Checkpoint 2026-09-19 — REX-04 correção visual do frame no PR #71

No branch `codex/rex-sprite-frame-01`, o commit `30cd753fa0f67d873ff02b30244359657d8f70f1` corrige a apresentação do frame composto sem ampliar o escopo assistido: a imagem saiu do grid que permitia colapso e passou a uma área própria com largura mínima, rolagem inteira e `shrink-0`; metadados ficam abaixo, em linhas separadas. O CSS força `content-box`, `width:192px`, `height:312px`, `max-width:none`, `max-height:none` e `image-rendering:pixelated`, preservando transparência e proporção. O E2E agora mede o retângulo efetivo subtraindo as bordas e reprova se o conteúdo não for exatamente `192×312`, escala 3×, pixelated, visível, desobstruído e sem sobreposição dos metadados.

Build canônico: `/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `c73bd83e8df66ccb1bd08aff55b5ab40ef85ffa8334d84be1e53fa27518b6dc6`; frontend carregado declarou o mesmo commit. ROM BYOR SHA `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`; fonte doadora SHA `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`.

E2E desktop passou com sessão `inspection-1789849980-00000000`, composição independente e mutação rejeitada, salvar/reiniciar/reabrir, negativo de wizard e releitura integral dos pixels. O log registra, antes e depois do reinício: `css.width=192`, `css.height=312`, `boxSizing=content-box`, bordas 1px descontadas, `content.width=192`, `content.height=312`, `integerScale=true`, `pixelated=true`, `fullyVisible=true`, `unobstructed=true`, `metadataBelow=true`. PNG composto `8bb4dc723fa4d9435f6eaa3ce1c2248df7a20e30b800a6c56bfdd0a54fa96168`; RGBA independente `50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58`; canvas `c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc`; índice `938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c`. Log SHA `0f1dd209e76bd87140ba66fb6babfe0a8c97cdb330e30316ff7609945d842350`; captura pós-reinício SHA `b1653fb8ff2b3fbb83791950ed9e663394fea5417f7e5094c2f953a836b582da`.

O preflight reportou uma tentativa inicial de conexão recusada do driver, mas a execução WebDriver subsequente completou normalmente; não foi tratado como sucesso prematuro. A área de sprite está legível na captura pós-reinício. O cancelamento continua explicitamente herdado do executor do PR #70. A composição segue **Experimental**, assistida por metadado doador; não representa extração automática geral, animação ou reconstrução do jogo.

### Checkpoint 2026-09-19 — REX-04/Sprite-Frame-01 HAMOOPIG reexecutado no HEAD final

No branch isolado `codex/rex-sprite-frame-01`, o build canônico do produto em `2425bd0383d800fe66ab956f5f9be135c0e1494b` gerou `/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/debug/retro-dev-studio` com SHA `4d9f95790b6758271240d21ae186d5e1079cb8590cfd15c0037231fd8fb47b8d`. O frontend carregado declarou o mesmo commit. A execução `sprite-frame-01-e2e-final-head.log` passou com ROM BYOR `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`, fonte doadora `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`, sessão `inspection-1789834584-00000000`, recurso `spr_ryo_100/frame-0` e frame nativo 64×104.

A composição independente continuou com PNG `8bb4dc723fa4d9435f6eaa3ce1c2248df7a20e30b800a6c56bfdd0a54fa96168`, RGBA do PNG `50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58`, canvas WebKit `c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc` e índices `938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c`. O candidato de tiles permaneceu separado (`0xA490`, 192 bytes, PNG `33c3dd82d68b123f0e37b3baa1163cad69ef33c522dad80139ae9b611a6dd13f`, pixels `a5b33b5c97f32106fda7e610da91ff3bcce67c92375d673ee25f7389af1ed480`). A mutação visual foi rejeitada; após reinício a prévia foi capturada novamente com `fullyVisible=true`, `unobstructed=true`, hit-test em `IMG`, e identidade ROM/sessão/candidato confirmada. O negativo do wizard rejeitou o clique nativo obstruído (`selectionUnchanged=true`, `syntheticEvents=false`). Capturas: `inspection-2026-09-19T16-16-06-738Z-sprite-before-restart.png` e `inspection-2026-09-19T16-16-06-738Z-sprite-after-restart.png`.

O cancelamento é explicitamente **herdado do executor do PR #70**, não reexecutado nesta alteração de composição; não deve ser contado como nova prova deste binário. A árvore continua com os untracked de outras sessões preservados e não staged. A documentação abaixo mantém os checkpoints históricos; este checkpoint é o destino atual da matriz.

### Checkpoint 2026-09-19 — REX-04/Sprite-Frame-01 HAMOOPIG fechado no desktop

Commit `57460b8` publicado na branch isolada `codex/rex-sprite-frame-01`; PR #70 foi preservado sem merge. A fatia não trata prévia de tiles como sprite: compõe somente `spr_ryo_100/frame-0` (64×104) com tiles, posições, ordem vertical ResComp, flips, paleta MD RGB333 e transparência, explicitamente marcada como Experimental e assistida por metadado doador.

Referências: ROM BYOR histórica de 917.504 bytes, SHA `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`; fonte `res/sprite/ryo/100.png`, SHA `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`; offsets compilados `0x863A0/0x800`, `0x2CC68/0x20`, `0x22260/0x30`. RGBA independente do PNG: `50cba0…`; canvas WebKit: `c70a3d…`; índices do frame: `938611…`.

Binário canônico final: `/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/debug/retro-dev-studio`, SHA `529372408000893eea87f23bf47fedf5552af69301a75294b17b878888606fba`, frontend `57460b8`. E2E final passou com identificação, catálogo/candidato independente `0xA490+192`, composição, mutação rejeitada, salvar, reiniciar, reabrir e releitura de pixels; sessão `inspection-1789833207-00000000`. O negativo do wizard registrou obstrução e seleção inalterada. Evidências: `src-tauri/target-test/validation/sprite-frame-01-e2e-final-2.log` e screenshots `inspection-2026-09-19T15-53-12-704Z-sprite-{before,after}-restart.png`.

Diagnóstico corrigido durante a execução final: um run foi rejeitado honestamente por HTTP 400 `element click intercepted` porque o drawer Console cobria o controle; o harness passou a fechá-lo por botão visível e clique WebDriver nativo, sem remover overlay por JavaScript. O cancelamento continua explicitamente herdado da evidência do PR #70 e não foi repetido nesta alteração de composição. Holdout, scanner, oráculo de paletas, IPC/UI e arquivos untracked de outras sessões permanecem preservados.

### Checkpoint 2026-09-19 — prova visual de reabertura endurecida no harness `0e34773`

O cenário `inspection-complete` foi reexecutado sem repetir os testes do scanner. O binário/frontend permaneceram no produto `441533f8c231e38be185f0526fd609559e8ffec5`, SHA `97569a6f9b9c70402e8d6ebdec877a0450e338b45e39cb363f3b082398bb662`; o harness alterado está em `0e34773`. A ROM HAMOOPIG preservada tem 917.504 bytes e SHA `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`.

Sessão `inspection-1789823471-00000000`, run `run-inspection-1789823471-00000000-00000001`: identificação/análise concluídas; candidato `inspection-candidate-tile4bpp_block@0000A490-0000`, offset `42128`, tamanho `192`, `tile4bpp_block`, preview `256x16`; PNG SHA `33c3dd82d68b123f0e37b3baa1163cad69ef33c522dad80139ae9b611a6dd13f`; pixels RGBA SHA independente `a5b33b5c97f32106fda7e610da91ff3bcce67c92375d673ee25f7389af1ed480`. A mutação de um pixel continuou rejeitada (`d1eabd7d37515d98eb8313c34ce4bf9e0eb5fbd65ba572fc8127183ef8a37954`).

Após reinício, o wizard foi tratado por controles visíveis; o mesmo helper de clique WebDriver, em modo esperado-bloqueado, registrou `unobstructed=false`, overlay do wizard, `selectionUnchanged=true` e `syntheticEvents=false`, sem clicar no elemento coberto. Depois, a sessão/candidato foram reabertos e o painel foi rolado até a prévia: viewport `1920x1080`, retângulo `201.156x14.4375`, `fullyVisible=true`, `unobstructed=true`, hit-test em `IMG`, tamanho renderizado suficiente. A captura efetivamente apresentada está em [after-restart](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-19T13-10-56-962Z-after-restart.png), SHA `2da6ed188265be20d196b0e964c38baa6ddbe47c266a76f7f4ac6faf99ddd49e`; [before-restart](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-19T13-10-56-962Z-before-restart.png), SHA `6ef0053a33c8647cfbb12becf0fdbcde051ab972f040a5cd03e49a031011c238`.

O cancelamento permanece explicitamente **evidência herdada do executor**, não reexecutada nesta rodada: `run-inspection-1789820344-00000000-00000001`, sessão `inspection-1789820344-00000000`. O estado segue Experimental e sem merge.

### Checkpoint 2026-09-19 — integração isolada auditada para #69

O PR #69 e os PRs REX #66–#68 eram linhas paralelas; nenhum head REX é ancestral do #69. `10c89d1` também não é ancestral do #69: `e998bbd` é o patch equivalente já presente na inspeção. Nesta branch isolada, #66/#67/#68 foram integrados por `177c831`, `63e730d` e `af6c0f3`, respectivamente. O holdout foi restaurado pelo merge de #66 — não “preservado” de um HEAD que já o continha — e os conflitos foram resolvidos por código, sem cópia indiscriminada. Untracked de outras sessões permanecem preservados.

No PR #70, `441533f` corrige a prova de reabertura após reinício: o wizard é tratado por controles visíveis, o negativo de hit-test confirma que um clique nativo não atravessa o overlay, e a sessão/candidato/prévia são revalidados após o reinício. A execução histórica em `9f0167e` comprovou restauração de estado, mas a captura pós-reinício coberta pelo wizard permanece preservada somente como evidência da lacuna visual.

Comparação: #66 trouxe holdout, confronto e renderer chunky; #67 trouxe cache/avanço monotônico e guarda contra streams periódicos; #68 trouxe o oráculo independente de paletas/pixels; #69 trouxe IPC/UI, progresso, cancelamento, catálogo, prévias e persistência. No destino `af6c0f3`, todos esses conjuntos estão presentes e exportados conjuntamente (`holdout` + `inspection`).

Matriz anterior: binário `f7f14045cc7fa1dec41bbe076d612932412a454261d5666dff507b0ec3e6c42c`, sessão `inspection-1789788024-00000000`; restauração de estado passou, mas a captura pós-reinício ficou coberta pelo wizard. Matriz corrigida em `441533f`: binário canônico `97569a6f9b9c70402e8d6ebdec877a0450e338b45e39cb363f3b082398bb6622`, frontend runtime e Git `441533f8c231e38be185f0526fd609559e8ffec5`; HAMOOPIG `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`, candidato `42128/192`, `256x16`, PNG `33c3dd82d68b…6dd13f`, pixels RGBA `a5b33b5c97f3…ed480`, mutação rejeitada; negativo de obstrução `topTestId=project-wizard-body`, `unobstructed=false`, sem disparar seleção; cancelamento reexecutado no mesmo binário com `run-inspection-1789820344-00000000-00000001` e sessão `inspection-1789820344-00000000` cancelados; reabertura visual corrigida com sessão `inspection-1789820281-00000000`, run `run-inspection-1789820281-00000000-00000001`, screenshots `inspection-2026-09-19T12-17-53-569Z-{before,after}-restart.png`; negativo controlado `1f3d1060ffd631dd9ecbebf8b940a797cf597c10198497d1f5707d4e1785553a`, 17º candidato `16384/128` sem preview.

Gates locais do destino: check:tree, lint, TypeScript, Vitest `618/6`, clippy, fmt e Rust `608/40` passaram. O rebuild canônico passou via shell de login após diagnóstico do primeiro erro de PATH (`cargo metadata` não encontrado no processo `rtk npm`). `host:certify` passou no destino: frontend `621/3`, Rust `608/40`, upstream SGDK/PVSnesLib `Success: true`. CI remoto será disparado ao publicar o branch; classificação continua **Experimental**, sem merge e sem certificação de extração completa/reconstrução.

### Checkpoint 2026-09-18 — REX-04 inspeção visual: hardening e bloqueio E2E do WebKit

Corrigidos os três achados funcionais: listener de progresso instalado antes de `inspectionStart` com reconciliação por `inspectionStatus`; respostas assíncronas de catálogo/prévia/status protegidas por sequência, sessão, filtro e candidato; e sessões persistidas listáveis/selecionáveis após reinício, com aba “Inspeção visual” acessível antes de existir manifesto. Adicionados seletores de QA aos controles e testes atrasados/remount no painel.

Diagnóstico: o timeout da descoberta real foi localizado no scanner de tiles, que recalculava janelas sobrepostas e podia retroceder o cursor; aplicado cache dos blocos avaliados e avanço monotônico. Testes focados de `graphics_discovery`: 14 passados, 2 ignorados; clippy verde. O binário canônico foi recompilado com hash `03674e8b2f1f88bbecf66f724f1b3f8a3a3e11442a8fcb879f9ad50ddca19180` antes da última rodada de UI.

A E2E desktop ainda não fecha: o WebKitWebDriver falha no clique nativo (`POST /element/.../click` com mensagem vazia) e eventos DOM/Enter não ativam “Identificar base”; a sessão fica sem `inspection-start`, portanto cancelamento/salvar/reinício não podem ser afirmados. O runner registra a chamada e preserva o estado; a classificação permanece **Experimental**, sem aceite. O erro I/O independente continua reproduzido em `src-tauri/src/tools/reverse/decomp-recovery/object_diff.rs` (`stat`, `sha256sum`, `wc` retornam `Input/output error`) e não foi apagado. `host:diagnose` READY; `host:certify` permanece pendente da rodada final.

### Checkpoint 2026-09-17 — REX-04 inspeção visual desktop (Experimental)

Implementada no branch `codex/rex04-inspection-ipc` a fatia de inspeção visual somente leitura: abertura BYOR e identificação por conteúdo, catálogo de extração, descoberta em `spawn_blocking`, evento de progresso/cancelamento, paginação/filtros de candidatos, regiões UNKNOWN preservadas, prévias PNG reais com proveniência, escolha manual de paleta e persistência/reabertura com verificação da identidade da ROM. A aba é isolada no Reverse Workspace e não promove candidatos a recursos confirmados.

Hardening: catálogo validado contra bytes normalizados e serialização canônica; intervalos, overflow, cobertura, status, schema e limites verificados; artefatos usam escrita imutável sem panic e deduplicação de referências; caminhos são contidos e re-hashados; erros IPC carregam `code`, `message` e `retryable`; IDs de candidatos vêm do backend e sessões correlacionam ROM, catálogo, run e geração.

Gates locais: lint, TypeScript, build frontend, Vitest completo (615/6 em execução independente; 618/3 no run da certificação antes de ENOSPC), cargo fmt/clippy e Rust lib (592/40) passaram. `host:diagnose` final está READY, mas duas execuções de `host:certify` terminaram por `ENOSPC` nos workers da suíte frontend mesmo depois de remover de forma recuperável o cache gerado `src-tauri/target-test/dev`; a certificação completa permanece bloqueada por capacidade do host. Não há promoção de REX-04, nem aceite inferido do PR #68; hashes canônicos HAMOOPIG/Taiketsu preservados. Limitação conhecida: a substituição concorrente de caminhos de artefato não é coberta; cancelamento ocorre em pontos seguros entre fases.
    ### Rodada 4b — corrida de época no backend fechada sob o mutex (2026-09-13)

Re-revisão de `1a1fc65` reproduziu corrida P1: conferência de época antes do mutex permitia input antigo aplicar controles ao core novo. Corrigido: época conferida DENTRO da seção crítica (`emulator_send_input_locked`, lock mantido até o set_joypad); a recarga incrementa `CORE_EPOCH` sob o mesmo lock. Teste determinístico força a interleaving e exige recusa sem aplicação. 5 passagens de UI no binário canônico com motivo correto por passagem (stale-session rejeitada pelo oráculo de sessão estranha após navegar de volta para a aba Jogo e fechar o drawer de Console que abre sozinho com erros). Rust 561/36; store 86/86; frontend 614/6.

### Re-revisão e905e20 — REV-05 fechado na rodada 4 (2026-09-12)

Três lacunas fechadas: (1) hold de sessão na primeira linha da carga/stop (invalidação antes do await; envios bloqueados e contados); (2) negativos reais novos — blocked-during-load (teclas na janela pendente: hold, sessão nula, 4 bloqueios, sem ack, canvas inalterado) e inflight-across-reload (request A atravessa a transição sem crédito e sem vazamento — A/B 20/20 no mesmo processo); (3) corrida de resposta antiga coberta pelo inflight; stale-session preservado com rótulo preciso. Política no backend: `CORE_EPOCH` (load incrementa, send recusa obsoleta, drain de controles). Achado: vazamento real de send_input através da recarga (frame 0, estável em 3 execuções) fechado pela época. Store 86/86.

### Re-revisão e905e20 — 2026-09-12: REV-05 parcial

Host diagnose READY; 83 testes do store passaram; PR #63 e905e20 OPEN com 8 checks verdes consultados. ACK ok:true e geração frontend são melhorias confirmadas, mas aceite integral não sustentado. `loadRomIntoEmulator` só invalida/troca sessão depois de await emulatorLoadRom: a sessão antiga permanece válida durante a carga pendente. Probe de ordem sobre handler real preservado em `/home/misael/RetroDevStudio/review-e905e20/load-order.cjs` e `.json`.

Harness atualizado tem negativos sem teclas e sessão divergente; faltam teclas presentes com backend recusando/pendente e prova de nenhum Step após falha de ACK. Negativo de sessão envia input novo após recarga completa e cobra época velha, não resolve ACK antigo atrasado numa troca A→B. Corrigir invalidação no início/ordenação e medir esses negativos reais. Relatório completo `/home/misael/RetroDevStudio/review-e905e20/REVIEW.md`.

Diferença 614/3 versus 611/6 consistente com pré-requisitos condicionais no código, mas conjunto exato de IDs não comparado nesta revisão. Sem reexecução de certify completo/UI; nenhuma alteração de produto ou merge. Experimental; REV-01..04 mantêm aceites anteriores.


### Re-revisão 2026-09-12 — REV-04 aceito; REV-05 parcial

Revisados b09772a / 87108bb e HEAD documental 7873886. Host diagnose READY. **REV-04: 15 testes focados passaram**, incluindo regiões vazias, índices divergentes e sequência não canônica. Aceite local desses achados; não equivalência universal.

**REV-05 ainda não prova entrega aceita:** o handler atualiza lastSentJoypad antes de emulatorSendInput e ignora resposta estruturada ok:false (só captura Promise rejection). Probe com handler real extraído/transpilado e backend recusando retornou right:true, erro null, predicado do harness aprovado. Isso comprova falso positivo do oráculo, não falha espontânea do runtime. Solicitação, confirmação e consumo não devem compartilhar rótulo. Corrigir ACK ok:true correlacionado à sequência/sessão; cobrir recusado, pendente, resposta tardia e reset entre cargas. Manter prova de teclado e canvas real, mas repetir o positivo com confirmação antes de cada Step.

Evidências duráveis: `/home/misael/RetroDevStudio/review-rex-2026-09-12/REVIEW.md`, `input-ack-probe.cjs`, `input-ack-probe.json`. PR #62 checks principais verdes; PR #63 em novo HEAD 7873886 com checks ainda em execução na consulta. Nenhum merge. Sem alterações de produto; sem reexecução de UI real, suíte integral ou host:certify nesta revisão. Classificação Experimental/fatias iniciais.


### Re-revisão REX — 2026-09-11: aceite parcial de d3e8f11

REX-REV-01/02/03 corrigidos no escopo testado: SMD padrão, parsing de header curto e undo com identidade. Execução independente do núcleo reverso: **94 passed / 1 ignored**, incluindo as cinco regressões anteriores. Host diagnose READY. PR #62 cc88bb3 e #63 d3e8f11 com checks validate/linux-validate/desktop-smoke verdes consultados; nenhum merge realizado.

**REX-REV-04 ainda parcial:** dois probes independentes adicionais reprovaram (0 passed / 2 failed, exit 101). `evaluate_identical_equivalence` aprova regiões vazias e índices de frame incompatíveis (0 versus 999) com hashes iguais. Corrigir completude e identidade das observações; os testes anteriores misturavam múltiplas ausências e não isolavam esses casos.

**REX-REV-05 permanece bloqueado:** desktop-ui-proof.py itera chaves right/start do roteiro contra keymap com ArrowRight/Enter. Reprodução da expressão em JavaScript: 180 frames, 70 com input solicitado, **zero teclas selecionadas**. Assim os checkpoints não certificam o roteiro declarado. Corrigir mapeamento joypad→teclas, simultâneos/press/release, observar input real e confirmar conclusão de cada frame; delay de 4ms e DOM click não provam contagem exata/hit-testing. Carga compartilhada e canvas do produto são melhorias, mas não fecham o aceite.

Evidências: `/home/misael/RetroDevStudio/re-review-rex-2026-09-11/REVIEW.md`, `input-probe.json`, `oracle-probes.log`, snapshot isolado `source/`. Apenas testes adicionais na cópia externa; produto intocado. Não reexecutados UI real, suíte completa, build oficial ou host:certify nesta revisão. Classificação: **Experimental**, fatias iniciais; extração REX-04 e reconstrução por nós continuam pendentes.


### Revisão independente REX — 2026-09-11: aceite reprovado

Avaliado `cdf9a24b44c5d4d02e4cc6670a76cba47d07f1d3` (PR #63 sobre #62). Host diagnose READY; checks remotos validate/linux-validate/desktop-smoke consultados verdes, mas não cobrem os defeitos abaixo. **Não aceitar REX-02 como robusto/concluído; endurecer oráculos REX-00/03.** Não houve entrega ROM→jogo editável por nós.

Prova independente em cópia isolada de git archive: **83 testes existentes passaram, 5 regressões novas falharam, 1 ignorado, exit 101**. Implementação preservada; só testes acrescentados na cópia externa. Evidência durável: `/home/misael/RetroDevStudio/review-rex-2026-09-11/REVIEW.md`, `review-tests.log`, `manifest.json` e `source/`.

- REX-REV-01 (P1): SMD usa erroneamente blocos 512 e transformação própria; fixture independente do formato padrão de 16KiB é rejeitada. Os testes do executor geram entradas com o próprio interleave errado, inclusive a prova sobre bytes reais. Corrigir algoritmo e golden independente; referência primária Genesis Plus GX `core/loadrom.c`, `deinterleave_block`.
- REX-REV-02 (P1): 272 bytes com assinatura SEGA são aceitos pela identificação e causam panic no slicing do header (`loader.rs:82`). Validar tamanho antes de indexar em todos os entrypoints.
- REX-REV-03 (P1): `rex_undo_normalization` aceita raw alterada porque zero passos significa zero verificação; falta checar hashes/tamanhos de entrada e saída e cadeia inteira.
- REX-REV-04 (P1): equivalência retorna passed para 180 frames declarados sem framebuffer/regiões/estado final e para regiões com IDs/tamanhos diferentes. Ambos reproduzidos. Exigir completude e identidade dos dados antes de comparar.
- REX-REV-05 (P2): desktop-ui-proof.py usa IPC/canvas independente e binário anterior, sem teste dos controles visíveis; imprime matches sem reprovar por divergência. Reclassificar como probe IPC; criar teste da UI real com asserções no HEAD final.

Preservados código do executor, corpus e ROMs. Nenhum merge. Revisão não reexecutou suíte completa, UI desktop ou host:certify; não certifica release. Próximo: corrigir REX-REV-01..05 com negativos independentes e gates no destino antes de prosseguir à extração REX-04.


### Re-revisão REX — REV-04 e REV-05 fechados na rodada 3 (2026-09-12)

A rodada 3 reproduziu um novo falso positivo no REV-05: `lastSentJoypad` era gravado antes do IPC e só `.catch()` era tratado, mas `emulator_send_input` sinaliza falha por valor resolvido `{ok:false}` — logo os "180/180" mediam passagem pelo handler, não entrega aceita.

Corrigido: `lastJoypadRequest` (intenção) separado de `lastJoypadAck` (gravado só com `ok:true`), correlacionados por **sessão de carga + sequência monotônica**; ack de seq anterior ou de sessão anterior é descartado. Sessão gerada no frontend — suficiente, pois a época é capturada no fechamento do envio e reconferida na resolução; contrato Rust/TS inalterado. Ciclo de vida ancorado em `setEmulatorLoaded`, invalidando tudo em stop/recarga. 10 testes em `editorStore.test.ts` (recusado, pendente, atrasado, sessão anterior).

Reexecutado pela UI real (binário `856cc431…`, ROM `558bea6c…`): positivo PASS com 3 transições confirmadas por ack; negativo sem teclas e negativo de sessão obsoleta ambos FAIL-AS-EXPECTED, este último recusado por `ack de sessão estranha`. O positivo confirma **3 transições, não 180** — o número anterior contava verificações vazias que passavam vacuamente. Framebuffer segue 166/180 e não discrimina input.

Limitações declaradas: o ack confirma a última transição de cada frame (envios intermediários no mesmo frame não são confirmados individualmente); e o ack prova aceitação pelo backend, **não** consumo pelo jogo — o efeito de runtime é registrado à parte.

Armadilha de build registrada: `cargo build` não roda o `beforeBuildCommand`, e o binário embutia `dist` antigo; grep no binário é inconclusivo (assets comprimidos). O harness ganhou preflight de contrato em runtime e o binário medido veio de `npm run build:debug`.

Gates: `host:certify` READY, Rust 560/36, frontend 614/3. Classificação segue **Experimental**; REX-04 não iniciado; nenhum merge.

### Re-revisão REX — rodada 2 (2026-09-11), parcialmente superada pela rodada 3

REV-04: regiões vazias = missing; frame_index comparado por posição + sequência canônica 0..n-1 (probes do revisor adotados). REV-05: mapeamento campo→código de tecla corrigido (bug raiz: `start`/`right` comparados contra `Enter`/`ArrowRight`), teclado nativo WebDriver com codepoints, observação do produto via `lastSentJoypad` no store (180/180 observações de joypad por frame conferem, 2 press/2 release; a coincidência de framebuffer com o backend é 166/180 — a janela de boot 0..13 é excluída e não discrimina input, ver achado do efeito de estado), auto-teste negativo detecta ausência de input (exit 1). Achados novos: recarga quente ≠ power-on (14 frames; protocolo agora warm-up → pause → stop → load startPaused), loop livre iniciava frames fantasma pausado (gate adicionado), efeito de ordem do core invalida WRAM A/B como oráculo (corroboração apenas). Gates: Rust 560/36, frontend 601/6.

### Programa REX — REX-REV-01..05 corrigidos (2026-09-11)

Cinco achados do aceite reprovado corrigidos com regressões do revisor adotadas verbatim: SMD no formato padrão 16 KiB (GPGX `deinterleave_block`, golden independente, passo `deinterleave_smd_frame16k`; manifests antigos rejeitados), identificação exige 0x200 bytes sem panic em nenhum entrypoint, `rex_undo_normalization` valida identidade completa (entrada/cadeia/saída — raw alterado rejeita), oráculos de equivalência exigem observação completa e contrato de região (region_id/size), e a prova de UI agora usa o caminho do controle visível "Carregar ROM" (`__RDS_E2E__.loadRomForEmulation`), controles Pausar/Step, teclado do produto e canvas real do app com 4/4 checkpoints byte-idênticos ao backend + auto-teste negativo (exit 1) + hash do binário. Gates no HEAD: Rust 557/36, frontend 601/6, provas reais passando.

### Programa REX — REX-02 executado (2026-09-11)

Identificação MD por conteúdo e normalização reversível entregues em `codex/rex-02-normalizacao` (base PR #62): variantes raw/smd(±512)/byteswap16 com passos de `NormalizationStep` hash-por-passo no manifesto, `rex_undo_normalization` byte-exato, truncamento provável como erro e divergência header×tamanho como nota (evidência real: HAMOOPIG 0xFFFFF vs 0xE0000). 12 testes unitários + prova real nas duas referências com round-trip SMD em bytes reais; run `rex02-md-identification-v1` no ledger. Contêineres zip/7z continuam não suportados (erro explícito, sem dependência nova). Próximo: REX-04 (extração visual organizada).

### Programa REX — REX-00/01/03 executados (2026-09-10)

Primeira fatia do executor entregue em `codex/rex-00-oraculos` (base `a75fd30`): oráculos de equivalência (`tools/reverse/equivalence.rs`, `rex-equivalence/v1`) sobre o parity harness, ledger v2 (`decomp-ledger/v2` com corpus por conteúdo, capacidades por perfil e runs de cenário append-only, migração v1→v2 testada) e matriz de capacidades MD honesta (nada `verified_for_profile`). Provas medidas no host READY: HAMOOPIG mesma-ROM 180 frames com input definido — determinismo só entre power-ons frescos, veredito `indeterminate` porque o core não expõe VRAM/SRAM (missing registrado), e **savestate restore não é fiel ao power-on** (achado novo); negativo Taiketsu — prévia regenerada com 12.620 px não pretos e heartbeat rejeitada pelos oráculos (150/180 frames divergentes, WRAM divergente); UI desktop real (tauri-driver) com 4/4 checkpoints byte-idênticos ao backend. Evidências duráveis em `/home/misael/RetroDevStudio/rex-evidence-2026-09-10/`; ledger em `~/.retrodev/decomp_work/ledger.json`. Nada disso promove superfície nem fecha GUARD-SGDK-EQUIVALENCE-01 (que agora tem reprodução formal do negativo). Próximo: REX-02/04.

### Planejamento Programa REX — 2026-09-10

A pedido do operador, o plano canônico `12_DECOMPILACAO_PAREADA_PLANO.md` foi ampliado com o Programa REX: 17 tickets (REX-00 a REX-16), dependências, contratos, corpus/holdout, migração SGDK 1.60/1.80/2.00→2.11, extração/editabilidade, patches, IR/nodes, jogo novo e expansão por plataformas. Prompt vigente: `PROMPT_AGENTE_RECONSTRUCAO_ROM.md`. É planejamento, não implementação ou promoção. Estimativa inicial de 24 semanas refere-se somente a um perfil MD delimitado e deve ser recalibrada após corpus/gates; não há prazo ou garantia universal. Primeiro trabalho do executor: baseline/proveniência/oráculos, incluindo mesma-ROM com input e UI. PR #61 permanece draft sob investigação. Não há autorização nova de merge, dependências ou envio externo de ROM. Host diagnose desta rodada: READY, fingerprint d68f75b76d036d7cd200befab0255bd9479604798bf9c0fcbea892c7ce2ceef1.


### GUARD-SGDK-EQUIVALENCE-01 — aceite suspenso (2026-09-10)

O usuário contestou a fidelidade da prévia importada; PR #61 permanece draft e não deve ser integrado como conversão fiel. Execução sem exceção e heartbeat não certificam preservação do jogo original. Os candidatos anteriores abaixo são históricos, não entrega final aceita.

Referência padrão escolhida pelo usuário: `/mnt/sdcard/SGDKForge/SGDK_projects/HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/out/rom.bin`, 917504 bytes, SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`. Cópia imutável local e relatório em `/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/`.

Prova independente: exatamente essa ROM carregada no backend real do desktop, Genesis Plus GX v1.7.4 46a5521, 180 comandos de frame e 180 eventos recebidos, framebuffer 320x224. `hamoopig/backend-reference-180.png` mostra título completo, personagem, logo e textos, visualmente coerente com a imagem externa fornecida. Não é comparação pixel a pixel sincronizada, certificação de gameplay, desempenho ou carregamento via botão. Harness `backend-reference.py`; relatório `hamoopig/backend-reference.json`. Tentativas anteriores `same-rom-desktop.py` falharam: override de invoke não funciona porque a propriedade é não gravável; suas capturas/status não certificam carregamento.

A prévia importada foi regenerada de recursos com lógica parcial, não corresponde aos bytes da referência. Próximos gates separados: (1) ROM idêntica, input e frames nos caminhos externo/interno; (2) migração de fonte SGDK preservando comportamento e origem; (3) fonte → IR/nodes → C com estados, paletas, planos e criação/liberação de sprites preservados; (4) métricas de decompilação pareadas com fonte/ELF. Recursos de estados alternativos não podem ser contabilizados como atores simultâneos; catálogo total não equivale a residência em VRAM.

Compatibilidade 1.60/1.80/2.00 → 2.11 solicitada: pendente de fixtures e validação por versão; os dois projetos fornecidos já portados para 2.11 não demonstram migração automática dessas versões. Não substituir assets ausentes por arte/áudio inventados. Preservar doadores e créditos. Nenhuma promoção de Experimental.



### Estado operacional — revisão independente de runtime e decompilação (2026-09-10)

- **#60 integrado** em `main` (`616abdbcceb787879a7a1f2071c46919ed71bb06`). A integração desta revisão é rastreada pelo PR #61; os checks verdes de `90aae29` antecedem a correção de residência descrita abaixo e não a certificam. O candidato de produto final é `c042ecfc9ebb5fa419682d23bb4db4b42fc0b68e`.
- **GUARD-IMPORT-RUNTIME-01:** a prévia importada do Taiketsu tentava alocar 2.459 tiles de sprites (78.688 bytes) simultaneamente e passava `NULL` de `SPR_addSprite` para `SPR_setAnim`. A captura de 15.835 pixels não pretos era **ADDRESS ERROR**, não execução de jogo. Portanto os antigos registros `14/14 IBRE`/`emulation_visible_ok` só demonstram imagem produzida; não certificam ausência de exceção ou equivalência de gameplay.
- Correção em revisão: cenas acima dos 420 tiles padrão usam residência de sprites pela janela visível; liberam os que saem antes de alocar os que entram, reservam VRAM descontando os tiles de background e guardam posição/animação/loop/visibilidade enquanto fora da tela. Ao reentrar, a animação reinicia no primeiro frame; não se promete continuidade temporal fora da tela. Falhas de capacidade/animação permanecem sinalizadas, sem desreferenciar ponteiro nulo.
- **Prova real local pós-correção:** Taiketsu importado, SGDK oficial, Genesis Plus GX, 150 frames, heartbeat em RAM **52 → 112** nos últimos 60 frames com Right pressionado, erro de residência **0**, 17.192 pixels não pretos e captura inspecionada sem tela de exceção. Escopo: **prévia de recursos importados**, não jogo de luta original convertido. Grafo mantém 357 nodes, 344 edges, 5 bridges e conversão por entidade 0. Artefatos: `src-tauri/target-test/validation/sgdk-taiketsu-real/`; evidência anterior preservada externamente em `/home/misael/RetroDevStudio/taiketsu-runtime-review-2026-09-10/before`.
- QA adicional: C efetivamente emitido compilado com AddressSanitizer/UBSan; entrada/saída do viewport, liberação antes de alocação, estado de animação/loop/visibilidade, retorno nulo e erros persistentes passaram. Harness local em `target-test/validation/sprite-residency/`, não substitui hardware real. 24 testes unitários do emitter passaram. Certificação integral de `c042ecf`: **host:certify READY**, 604 testes frontend e 524 Rust (33 ignored), upstream SGDK/PVSnesLib oficiais, clippy completo e fmt verdes. Binário desktop compilado pelo script canônico. Build & Run real MD/SNES confirmado; teclado Right observado no histórico de input da ROM MD em RAM. O primeiro clique automatizado SNES não iniciou build e o harness falhou a asserção final; outro clique explícito pelo controle habilitado executou o fluxo. Ocorrência semelhante na prévia Taiketsu; causa do primeiro clique não isolada, falhas preservadas e não contabilizadas como sucesso. No desktop Taiketsu, heartbeat em RAM 161→166 e erro de residência zero confirmaram execução após Build & Run.
- **GUARD-DECOMP-DETERMINISM-01 fechado localmente:** Etapa A real rerodada em `90aae29`; SMOKE_TEST e BLUE_CIRCUIT têm **14/14 objetos exatos cada**, além de ROMs idênticas em duas cópias limpas. GCC LTO exigiu semente por arquivo e o mesmo caminho de compilação, arquivado em diretório exclusivo após cada passe. Nenhum objeto anterior é reutilizado. Relatório em `target-test/validation/decomp/etapa-a-report.json`; histórico em `/home/misael/RetroDevStudio/decomp-review-2026-09-10`.
- Métricas corrigidas do parser nm/Ghidra: SMOKE_TEST 876 funções (sem ELF original para boundary); BLUE_CIRCUIT 778, precision 0,9632107 / recall 0,3701799. Taiketsu original: 1.536 funções, precision 1 / recall 0,1126302; rebuild do **doador original** ainda bloqueado por `registerState` no boot customizado. Esse bloqueio é distinto do crash da prévia importada corrigido acima. Provenance diff cobre apenas o primeiro objeto comparável, explicitamente.
- Entrega verificável local: `/home/misael/RetroDevStudio/verified-2026-09-10-c042ecf/LEIA-ME.md`, launcher `abrir-studio.sh`, projetos editáveis MD/SNES e prévia importada, ROMs, logs e screenshots em `evidence/`. `evidence/provenance.json` registra o estado final de integração/CI e hashes dos artefatos. O launcher depende do binário debug e das dependências deste host; não é instalador portátil nem certificação de release. Auditoria npm registrou 4 avisos moderados preexistentes; não se afirma ausência de vulnerabilidades.
- **GUARD-SPRITE-PRIORITY-01:** revisão do header SGDK oficial confirmou `TILE_ATTR(pal, prio, flipV, flipH)`. O gerador passava `priority_high` no quarto argumento, espelhando o sprite e fixando prioridade alta. Correção nos caminhos direto e de residência: prioridade no segundo argumento, flips desligados. Teste negativo reproduziu a falha antes da mudança; nova regressão cobre foreground/background em ambos os alocadores. Revalidação do candidato final e hashes da entrega são registrados em `evidence/provenance.json`; os números de `c042ecf` acima são o baseline anterior a esta correção.
- GOV-01 no checkout original permanece: preservar `.mimosa`/`.zcode` e dados de outras sessões. Nenhuma promoção de Experimental, nenhuma UI/LLM de decompilação e nenhuma distribuição de ROM comercial autorizada nesta rodada.
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-09-08 (HOST-WIN-01 validado no Windows; A/B/C revisados; GOV-01 original preservado)

**GUARD-DECOMP-DETERMINISM-01 (2026-09-10, em validação):** contador completo revelou 3/14 objetos exatos no SMOKE_TEST, apesar de ROM idêntica. Probes preservados em `/home/misael/RetroDevStudio/decomp-seed-probe-2026-09-10`: semente fixa remove IDs LTO aleatórios; descompressão das seções LTO mostrou `getcwd()` divergente mesmo com `-ffile-prefix-map`. Benchmark agora usa semente por arquivo e duas cópias limpas no mesmo `compile-workspace`, arquivando cada árvore integral em rebuild-a/b antes da próxima; política e flags constam no relatório. Não remove seções da comparação nem reutiliza objetos. Ghidra console inclui sufixo `(GhidraScript)`: parser corrige esse formato e mantém rejeição de endereço inválido. Nova Etapa A em execução; não herdar aceite 2/2 antigo.

**Atualização 2026-09-10 — GUARD-ANIM-01 integrado:** PR #60 mergeado em `616abdbcceb787879a7a1f2071c46919ed71bb06` após todos os checks verdes no commit `4377914`; host:certify Linux READY, 604 frontend/494 Rust, provas oficiais MD/SNES. O conjunto #58/#59 passou baseline local (604 frontend/522 Rust), mas Etapa A real foi reaberta: parser Ghidra não obteve resultado válido e cópia encontrou symlink de configuração `.agent`. Configurações de agente não fazem parte do snapshot de build; fontes/ROMs do doador ficam intactas. Correção/diagnóstico e nova medição em andamento; não declarar Etapa A concluída.

**Integração em revisão (2026-09-09 — GUARD-IMPORT-DECOMP-01):** PRs #58/#59 combinados apenas no worktree `codex/import-decomp-review`, sobre #60; nenhum merge desses PRs em main nesta rodada. Revisão corrige ledger que silenciava corrupção, serializa atualizações e grava atomicamente, distingue versões da ROM por identidade imutável, aceita anotações reais `nm -l`, rejeita endereços Ghidra inválidos e deduplica métricas; objetos do rebuild são contados recursivamente em ambos os lados. Hash reutiliza implementação existente, sem nova dependência direta sha2. Import code-only exige manifests vazios válidos; falhas/recursos não suportados não viram sucesso vazio. Testes e certificação em andamento.

**Retificação de alcance das provas herdadas:** 14/14 IBRE e pixels não pretos dos checkpoints abaixo medem import/build/captura, não equivalência ou gameplay. GUARD-ANIM-01 demonstrou que essa captura podia ser uma tela de exceção. Contagem antiga “2/2 objetos” ignorava objetos aninhados; resultados da Etapa A precisam de nova medição com o contador corrigido. Os números históricos ficam preservados, sem aceite ampliado. GO segue limitado a Fase 0 Sprint 1 + Etapa A, sem LLM/UI.

**Atualização ativa (2026-09-09 — GUARD-ANIM-01):** PR #57 integrada em `10d15f6` após CI verde. A prova anterior de framebuffer não preto não certificava gameplay: entrada Direita revelou `ADDRESS ERROR` do SGDK. Causa reproduzida: `SPR_setAnim(..., 1)` sem segunda linha de animação no atlas rescomp. Correção materializa sequências por linha, preserva tempos individuais e rejeita frames inexistentes. Teste oficial agora exige a cena verde conhecida após 60 frames com Direita pressionada: passou com 42.496 pixels de cena; o framebuffer antigo tinha zero. Não extrapolar esta prova dirigida para todos os jogos, nem para paridade de importações. Validação integral e integração desta correção ainda em andamento; #58/#59 seguem em revisão.

**Atualização ativa (2026-09-08 — GUARD-NATIVE-01/GUARD-ROM-01):** PRs #55/#56 integradas com CI verde. Abertura direta Linux revelou descoberta incompleta do compilador gerenciado e checksum SGDK invalidado pelo mastering do header; correções e provas negativas registradas no Current Wave. Código `a775762` certificado READY (604 frontend/492 Rust), abertura direta MD/SNES com pixels reais e sem diagnóstico bloqueante; checksum final MD confirmado byte-a-byte pelo sizebnd oficial. Próximo gate: CI e integração no destino. #53 e GOV-01 continuam abertos; nenhuma promoção de maturidade.

**Atualização anterior (2026-09-08 — GUARD-PATH-01):** reproduzida e corrigida perda do PATH do shell ao preparar Java no build SGDK. Testes antes 1 passed/2 failed, depois 3 passed; host:certify Linux READY com provas oficiais MD/SNES. Detalhes e limites no Current Wave: a relação causal completa com o exit 5 de nm (#53) ainda requer evidência Windows; nenhuma promoção de maturidade.

**Atualização ativa mais recente (2026-09-08 — HOST-WIN-01 fechado tecnicamente no runner):** o PR #51 (`codex/host-win01-detection`, SHA `ed80c82`) passou `host:certify` no Linux (`READY`; fingerprint `77bbc2a76ab04417b2c5e4f0ddcd82e10dcc4ef220883510652c9f67e632425c`; lock `dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`) e o Desktop E2E Windows `34220094748` terminou **success**, com **16/16 cenários**: Mega Drive, SNES, overflow, warnings, healthy, error e stale, sem skips. A correção usa os artefatos oficiais imutáveis SGDK 2.11 (`sgdk211.7z`, SHA-256 `5cc704b7e3a15183c33e721a1d7f84c067cf78808754556d03bb14764df51437`, 54.060.415 bytes) e PVSnesLib 4.5.0 (`pvsneslib_450_64b_windows.zip`, SHA-256 `22c56150f3e8cb38702d4ad5e565c0b4b685807300d612061d87a7f5aea2a69f`, 9.994.749 bytes), com descoberta canônica de MSVC/WebView2/npm e handoff do cache gerenciado para o app. Para o SGDK Windows, o Make nativo `mingw32-make` é preferido quando disponível; o fallback oficial permanece e o shell alternativo usa `SHELL=sh.exe`/`-j1`. **A-01** continua com prova negativa real aprovada (`1 passed`) e controle positivo MD/SNES byte-a-byte idêntico; **B-01** segue revisado (5 focados; reprodução antes 4 passed/1 failed); **C-01** está integrado em `main` (`bd45299`). Nenhum PR foi mergeado nesta retomada: a decisão depende dos checks/proteção/revisão finais. **GOV-01 continua parcial no checkout canônico:** `.mimosa` e `.zcode` pertencem a outra sessão/processo vivo e permanecem intactos; o branch externo certificado não fecha essa causa. Nenhuma superfície foi promovida para Stable; gameplay, leitor de tela real e release continuam não medidos.

**Atualização ativa mais recente (2026-09-08 — retomada delimitada do Integrador):** **A-01 fechou a prova negativa operacional**: com SGDK/m68k-elf-gcc oficiais, um `logic_math` com `%` falha no build, não retorna `rom_path`, não anuncia ROM gerada e registra o nó como `unsupported` sem localização C; uma ROM antiga pré-existente no diretório de saída não é reutilizada. O controle positivo MD/SNES permanece verde e as ROMs suportadas continuam byte-a-byte idênticas; isso não prova gameplay nem semântica completa. **B-01 foi revisado**: 5 testes focados passam; revertendo somente as comparações corrigidas, a reprodução termina em **4 passed / 1 failed**, pois o caso acima do orçamento volta a produzir `Warning` em vez de `Error`. **HOST-WIN-01** foi publicado no PR #51: descoberta de MSVC via `VCToolsInstallDir`/`vswhere`, WebView2 pelo registro do runtime e instalação exata de npm `11.16.0`; o host Linux da validação ficou `READY` e o `host:certify` local passou, mas Windows real ainda depende do CI. Os fixtures POSIX executáveis foram marcados como skip no runner Windows, mantendo o desktop-smoke como prova operacional. PR #50 (A-01) e PR #51 seguem sem merge enquanto os checks remotos não estiverem verdes. **GOV-01 continua parcial:** `.mimosa` e `.zcode` no checkout canônico pertencem a outra sessão/processo vivo e permanecem intactos. Nenhuma superfície foi promovida; acessibilidade por leitor real, gameplay e release continuam não medidos.

**Atualização ativa anterior (2026-09-07 — INT-R1h, primeira fatia de agente integrada):** **C-01** entregue por C e **INTEGRADO** após revisão do Integrador. Correção de 1 elemento em `Console.tsx:192` (`role="log"` + `aria-live="polite"` + `aria-label`): entradas do console — inclusive erros, que abrem o drawer sozinhos — não eram anunciadas para leitores de tela. O Integrador **não aceitou o handoff pela descrição**: reproduziu a regressão (revertendo só o componente, `1 failed | 4 passed`; restaurando, `5 passed`), conferiu que o diff tem exatamente os 2 arquivos da allowlist, validou a alegação de base equivalente (`Console.tsx` idêntico entre `1b2a45b` e `e5e8407`) e confirmou o limite declarado (o componente desmonta com o drawer fechado). Gates no destino: `tsc` 0, `lint` 0, `npm test` **597 passed / 6 skipped (603)** — total 602→603 e passados 596→597, exatamente **+1**, sem teste perdido ou silenciosamente pulado; `cargo` não executado por diff Rust vazio, o que fica **declarado**. **Limite:** é validação unitária de atributos ARIA, **não** prova de anúncio por leitor de tela real. **GOV-01 recorreu** por `.mimosa` e `.zcode` na raiz, ambos com processo vivo de outra sessão: **nada foi movido ou apagado** e o gate **não foi afrouxado**. Propostas de C verificadas de forma independente: **C-02** e **TOOLS-01** abertos como `PROPOSTO` (TOOLS-01 exige aprovação por ampliar a allowlist), `ToolNotices` arquivado.

**Atualização anterior (2026-09-07 — INT-R1g, FLAKE-01 investigado e fechado):**

**Atualização anterior (2026-09-07 — INT-R1e, host Linux alcançou READY):** `bash scripts/bootstrap.sh --ensure --profile full` completou com **exit 0** e `npm run host:diagnose` retornou **`READY`, exit 0, nenhum item não-ready** — os 20 checks passam, incluindo os 7 que bloqueavam a baseline (`jdk21`, `ghidra`, `m68k_gcc`, `sgdk`, `pvsneslib`, `libretro_md`, `libretro_snes`). Fingerprint `82f39923…fff5a` e lock `d531c4b9…5bb5d` **inalterados**: mesmo host, mesmo contrato, mudou só o provisionamento. **ENV-01 e ENV-02 fecham como MELHOROU.** Correção registrada com data e motivo, sem apagar o original: a baseline de 2026-09-06 observou bootstrap exigindo sudo e saindo em exit 1; agora o launcher reportou `sudo not required` — o substrato do host mudou desde então, e **nenhuma autenticação foi contornada**. A restrição de host em A-01/B-01/C-01 fica suspensa. **Limite que continua valendo:** `host:certify` **não** foi executado, nada foi promovido, e o fluxo `Build -> ROM -> Emulação` segue **NÃO MEDIDO** neste SHA. HOST-WIN-01 continua `BLOQUEADO` — este READY é do host Linux, não do runner Windows.

**Atualização anterior (2026-09-07 — INT-R1d, três fatias liberadas com restrição declarada):** por ordem do operador, A-01, B-01 e C-01 passaram a **LIBERADO** sobre `main` `1b2a45bebef6adf0471e46bda608e429bffc480b`, em worktrees e branches disjuntos. **Desvio registrado explicitamente:** a regra vigente exige host **READY** para liberar edição de produto, e o host segue **`DRIFTED`**; em vez de tratar a condição como cumprida, as fatias foram escopadas para não dependerem do host — todas são prováveis por teste unitário. Acompanha a liberação a proibição de declarar build real, ROM, emulação ou medição dinâmica: o que depender de toolchain/core fica **`NÃO MEDIDO`**, e PROF-01 continua valendo (o profiler estima, não mede). Arquivos centrais seguem reservados ao Integrador; HOST-WIN-01 continua `BLOQUEADO`. Detalhes, listas exatas de arquivos e critérios de aceitação no Current Wave.

**Atualização anterior (2026-09-07 — INT-R1c, convergência integrada em `main`):** o PR #41 foi mergeado em `main` por ordem expressa do operador; `main` = `b8987050b02146a1576bc871b39396745afb15b9`. O Programa de Reprodutibilidade (contrato de host, `host-manager.mjs`, `rust-toolchain.toml` versionado, protocolo de host no `AGENTS.md`, gates de `cargo fmt`/licenças/RustSec) passa a existir no tronco, junto com UI fatia 1 e parity rev-2. CI do PR: `validate` PASS, `linux-validate` PASS, `desktop-smoke` **FAIL**. **Limite que não pode ser suavizado:** `main` fica sem gate remoto completo verde, porque o E2E Windows depende de HOST-WIN-01 — detectores `msvc`/`webview2`/`npm` do contrato reportam ausência onde há defeito de detecção — adiado para as Etapas 5-8 enquanto o Windows estiver congelado. Isso **não** certifica `Build -> ROM -> Emulação`; ENV-01/ENV-02 seguem abertos e nenhuma superfície foi promovida. Também registrado: o verde histórico do `desktop-smoke` era sustentado pelo downloader que este programa remove.

**Atualização anterior (2026-09-07 — rodada INT-R1b, convergência executada):** sob autorização do operador, `origin/main` `9b36d2e` foi **mergeado** (não rebaseado) em `convergence/reproducibility`. Destino `1ef03e9b17d27d4d2bce18d698137eb2e3b4fc87` + correções `cc9338f`; a divergência 48/17 virou **0 atrás / 19 à frente** e CONV-01 deixa de bloquear a base. O merge expôs **dois defeitos que nenhum tronco tinha sozinho**: `lib.rs` não compilava (`E0063`) porque `interrupted_install_result`, de `origin/main`, construía `DependencyStatus` sem o campo `applicable` do contrato de host — corrigido com `applicable: true`, pois marcar `false` esconderia o panic no Runtime Setup; e um `clippy::unusual_byte_groupings` em `frame_buffer.rs:116` que **não foi corrigido** por ser área reservada a B e não ser falha de gate. Registrado também que `origin/main` **não tem passo `cargo fmt` no CI** (2171 linhas de diff), gate que chega com este programa. Gates de código verdes no destino: check:tree 0, tsc 0, lint 0, `npm test` 596/6 skipped, fmt 0, clippy 0, `cargo test --lib` **481 passed / 0 failed / 30 ignored**. Isso **não** certifica `Build → ROM → Emulação`: ENV-01/ENV-02 seguem abertos, host `DRIFTED`, reparo dependente de autenticação do operador. Nenhuma superfície promovida, nenhuma fatia A/B/C liberada. Detalhes e próximo passo no Current Wave.

**Atualização anterior (2026-09-06 — rodada INT-R1 do integrador):** ENV-01, ENV-02, GOV-01 e GOV-02 foram reproduzidos no mesmo SHA `0c245386`, com fingerprint e lock digest idênticos aos da baseline. A leitura de convergência da baseline foi corrigida: o `main` local estava obsoleto e, contra o remoto, `origin/main` `9b36d2e00b228a6be3764dbd7d35f5182a78d292` e `HEAD` divergem em **48/17**, sem ancestralidade em nenhuma direção. Achado dominante **CONV-01**: o Programa de Reprodutibilidade não está em `origin/main` (sem `scripts/host-manager.mjs`, sem `toolchains/host-requirements.lock.json`, sem seção de protocolo de host no `AGENTS.md` de lá) e a branch `convergence/reproducibility` nunca foi publicada. Logo não existe base integrada e **nenhuma fatia de código foi liberada**; PROF-02 foi confirmado por inspeção em ambos os troncos, sem correção. Nada foi movido, removido, commitado ou promovido. Tickets INT-01/INT-02/A-01/B-01/C-01 e o próximo passo exato estão no Current Wave.

**Atualização anterior (2026-09-06 — organização documental autorizada):** avaliação do código `0c245386` preservada em [AVALIACAO_DESENVOLVIMENTO_2026_09_06.md](AVALIACAO_DESENVOLVIMENTO_2026_09_06.md), com IDs estáveis e limites da inspeção. [13_PLANO_EXECUCAO_PARALELA.md](13_PLANO_EXECUCAO_PARALELA.md) reúne cronograma estimativo, comparação por evidências e prompts Integrador/A/B/C. Nenhuma rodada de implementação foi liberada ou lançada nesta sessão; leitura paralela pode começar, mas código depende de ticket/base/ownership e host READY. Host observado DRIFTED, bootstrap bloqueado por autenticação, check:tree com falhas preexistentes. Sem promoção de maturidade, alteração de produto ou mudança de decisão arquitetural. Detalhes e próximo passo no Current Wave.

**Atualizacao anterior (2026-09-02 - segunda deriva de toolchain, agora no Rust):** a convergencia de UI avancou (PR #34 `ui-fatia1` em `main` por `0541837`) e logo em seguida **`main` ficou vermelho sem nenhuma mudanca de codigo de produto**. Causa: os dois workflows usavam `dtolnay/rust-toolchain@stable`, que segue o canal. A ultima run verde (2026-07-29) instalou **1.97.1**; a run de 2026-09-02 instalou **1.98.0 (88d9e12ae, 2026-08-18)**, que estreou `clippy::chunks_exact_to_as_chunks` e, sob `-D warnings`, reprovou 7 arquivos intocados (`build_provenance.rs`, `audio_pipeline.rs`, `compatibility_harness.rs` x2, `parity_harness.rs`, `project_mgr.rs`, `tools/reverse/graphics.rs`). Corrigido pela PR #38: pin de `ci.yml` **e** `desktop-e2e.yml` em `dtolnay/rust-toolchain@1.97.1` — a versao comprovadamente verde — com `components: rustfmt, clippy` explicito, porque refs de versao instalam o perfil `minimal` e sem isso o pin trocaria falha de lint por ferramenta ausente. Evidencia: #38 fechou com `validate: pass` e `desktop-smoke: pass`. **Esta e a segunda ocorrencia da mesma classe de falha em duas rodadas consecutivas** — depois do PVSnesLib em 2026-07-29, agora o Rust: dependencia externa nao fixada quebrando o baseline sem commit nosso. Isso eleva a prioridade do `rust-toolchain.toml` versionado (entrega da PR #29, ainda parada), que valeria tambem para build local e nao so para CI. Limites honestos: o pin **congela** em 1.97.1 e nao corrige os 7 sites de `chunks_exact`, que continuam pendentes para quando o toolchain subir de proposito; e o pin de `desktop-smoke` em `windows-2022` segue sendo mitigacao, como ja registrado. Registro adicional da rodada: a PR #35 (`ui-overhaul`) versionava 104 arquivos e 19 MB de mockups em `.codex/`, diretorio nao declarado em `docs/08_TREE_ARCHITECTURE.md`, o que reprovava `npm run check:tree`; foi **destrackeado em vez de afrouxar o gate**, coerente com a reversao do afrouxamento de `.serena` na rodada 71 e com o descarte deliberado do commit `e812828`. Nenhuma superficie foi promovida; nenhuma decisao arquitetural consolidada foi alterada.

**Atualizacao anterior (2026-07-29 - convergencia executada e regressao real do SNES exposta):** a convergencia saiu do diagnostico para execucao. Entraram em `main`: PR #30 (registro do diagnostico), PR #32 (spike de decompilacao curado a partir do PR #23) e PR #33 (`fix/desktop-e2e-runner-pin`). O achado dominante desta rodada e que **restaurar o gate expos um bug real de produto que estava enterrado sob tres camadas de mascaramento**: o bloqueio de billing do Actions escondia a falha de WebDriver do `Desktop E2E`, que por sua vez escondia que o **build SNES estava quebrado**. `render_pvsneslib_makefile` emitia `include ${PVSNESLIB_HOME}/devkitsnes/snes_rules` **antes** de `export ROMNAME`; versoes recentes do PVSnesLib passaram a abortar nesse caso com `snes_rules:60: *** "ROMNAME must be set before including snes_rules"`. Como a toolchain e baixada do upstream a cada execucao de CI, **o SNES quebrou sem nenhuma mudanca no nosso codigo** — ele passava em 2026-07-13 (run `29242338658`). Corrigido movendo `ROMNAME` para antes do include (compativel com as duas versoes: a antiga so usa `$(ROMNAME)` dentro de regras, expandidas no uso) e coberto pela regressao `pvsneslib_makefile_sets_romname_before_including_snes_rules`, que nao existia — motivo pelo qual a quebra passou em silencio. Evidencia de fechamento: run do PR #33 com `Run Mega Drive desktop smoke: success` **e** `Run SNES desktop smoke: success`, primeiro `Desktop E2E` completo verde desde 2026-07-13; `cargo test --lib` **441 passed / 0 failed / 24 ignored** no Windows. Limite honesto obrigatorio: o pin de `desktop-smoke` em `windows-2022` e **mitigacao, nao solucao** — ele congela a imagem do runner e a fragilidade de compatibilidade entre `msedgedriver` e Edge continua aberta. Licao estrutural registrada: a toolchain externa **nao esta fixada**, e essa e exatamente a classe de falha que `toolchains/host-requirements.lock.json` (PR #29) fecha. Nenhuma superficie foi promovida; nenhuma decisao arquitetural consolidada foi alterada. Detalhe operacional completo em `docs/06_CURRENT_WAVE_AI_BANK.md`.

**Atualizacao anterior (2026-07-17):** a branch `codex/reproducibility-program` preserva as Etapas 0/1/2/4 concluidas e fechou os gaps comuns/Linux executaveis: Runtime Setup delega integralmente ao contrato bloqueado, navegador/driver entram no fingerprint, `bigsudo` e automatico no BigLinux, E2E produz evidencia por commit, npm audit esta zerado, npm install scripts possuem allowlist, Tauri/updater/CSP/asset scope foram endurecidos, licencas e metricas arquiteturais ganharam inventario e o CI ganhou validacao Linux/RustSec/Rustfmt. O lock continua `0df750697ecb9a171c11e13d1d3c137f5a8bd9da43ca9448310b630a7f0e9dea` e o fingerprint atual e `b84c6668f17e8eafc0f48eab5097254c529644e8e5cf04ffb9afedd079f9e39c`. Windows foi congelado pelo operador e permanece pendente; logo Etapas 5-8 nao podem receber conclusao formal. Release publico segue proibido sem Windows, signing/updater/licencas de redistribuicao. RustSec tem zero vulnerabilidades, mas registra risco transitivo GTK3/glib informado no Current Wave. Evidencias, testes e proximo comando exato estao em `docs/06_CURRENT_WAVE_AI_BANK.md`.

**Atualizacao anterior (2026-07-28 - diagnostico de produto e inicio da convergencia):** foi registrado `docs/DIAGNOSTICO_PRODUTO_2026_07_28_NAO_CANONICO.md` (NAO canonico) mapeando 8 gaps entre o estado atual e "produto completo", com evidencia verificada em codigo/Git/GitHub. Achado dominante: **o gap principal nao e falta de feature, e falta de convergencia** — `main` parado desde 2026-07-13 enquanto quatro branches vivas acumulavam 7 a 36 commits sem merge. Fatos verificados: CI remoto estava morto desde 2026-07-17 por billing externo (jobs com `runner_id=0`, zero steps) e foi **destravado ao tornar o repositorio publico**; a raiz do repo hospeda 10 worktrees git vivos (~112.000 arquivos) e duas tinham trabalho nao commitado, incluindo ~4.000 linhas de UI Fase B em `.worktrees/ui-overhaul-fase-a`, preservadas em `.claude/cleanup-backups/`; a rodada 83 nao commitada foi **descartada apos backup** por ser superconjunto invertido do PR #25 ja mergeado em `main` (que tem o mesmo guard por revisao mais guards de `generation`/`projectDir` e o contrato `SceneDraftReceipt`). Ordem de convergencia definida: PR #29 (`reproducibility-program`) -> PR #28 (`gameplay-parity-slice`) -> PR #23 (`w7-4-blastem-parity`, exige rebase) -> `ui-overhaul-fase-a`. Nenhuma superficie foi promovida; nenhuma decisao arquitetural consolidada foi alterada.

**Atualizacao anterior (2026-07-13 - Gameplay Parity):** a branch limpa `codex/gameplay-parity-slice`, baseada no `main` certificado em `e700477e`, porta exclusivamente a camada Parity da PR #23: harness/Libretro, contratos e comandos IPC, UI/servico/store, testes e provisionamento canonico de cores. Nenhum arquivo de Decompilacao, Linux, Node ou UI geral entrou. Parity permanece **Experimental**, sem gameplay 1:1 ou cycle accuracy; audio mede o stream entregue pelo core e traces PC/VDP/DMA/scanline ausentes ficam `missing`. Gates locais completos e build debug passaram (**500 frontend / 2 skipped; 481 Rust / 30 ignored**). A prova real host-local foi executada e registrou `blocked_core_missing` por ausencia de core Mega Drive `.so`; auto-provisionamento existente e Windows-only, sem substituicao por fake.

**Atualizacao anterior (2026-07-13 - Node build provenance):** a branch isolada `codex/node-build-provenance`, baseada em `main` `9548dbc`, integra um source map versionado de **proveniência de build** entre NodeGraph, IR Rust, C gerado e ROM. Mappings existem somente quando marcadores do emitter delimitam trecho C real; o restante fica `unsupported` com motivo. O Inspector valida hash/versao e exibe “Proveniência de build observada”. Gates locais completos e build debug passaram (**480 frontend / 2 skipped; 440 Rust / 24 ignored**). A prova SGDK/Libretro oficial e Windows-only e nao esta disponivel neste host Linux, sem substituicao por fake. Node Engine, NodeGraph e Inspector continuam **Experimental**; nao ha observacao de PC, registradores, emulador ou `RuntimeEvidence`. Estado detalhado e proximo gate em `docs/06_CURRENT_WAVE_AI_BANK.md`.

**Atualizacao anterior (2026-07-06 rodada 86 - frente UI fatia 1 v2):** branch `codex/ui-fatia1-tokens-registry` em worktree isolado (`RetroDevStudio-ui-fatia1`), partindo de `main` `9001d2a`; numeracao 78-85 pertence as frentes Linux/parity/integracao em branches proprias. A rodada implementa a fatia 1 v2 do estudo nao-canonico `docs/ESTUDO_UI_PRODUTO_NAO_CANONICO.md` (criado e commitado nesta frente): (1) tokens semanticos `--rds-*` estendidos em `src/styles/index.css` (accent/hover/on-accent/surfaces/text) com migracao de prova em `ToolbarButton` e raiz do shell; o anel `:focus-visible` global ja existia em `main` e foi mantido; (2) **Surface Registry** em `src/core/surfaceRegistry.ts` (`minPersona`/`maturity`/`capability`/`roadmapRef`) derivando o rail (`WORKSPACE_ITEMS`) como fonte unica, com **gate registry x roadmap** em `surfaceRegistry.test.ts` que falha se a linha correspondente sumir da matriz de `docs/03_ROADMAP_MVP.md`; (3) **seletor de persona** Guiado/Criador/Pro/Hacker no topbar com default `pro` (zero regressao provada em teste), gating do rail e dos comandos `workspace.logic/artstudio`, persistencia localStorage, auto-switch para Scene quando o workspace ativo fica oculto e sugestao local de transicao; (4) **densidade de shell** `compact/standard/wide` em `workspaceLayout.ts` (corte compacto subiu para 1440 e passa a cobrir Steam Deck 1280 e notebooks 1366), `data-density`/`data-shell-persona` na raiz do shell e layout salvo por perfil de densidade com fallback para a chave legada; (5) **EmptyState** padrao (`src/components/common/EmptyState.tsx`) aplicado ao Hierarchy sem projeto com CTA real "Abrir projeto"; (6) **autosave de rascunho local** em `scenePersistence.ts` (localStorage por projeto, debounce 2s, badge no topbar, banner de recuperacao que restaura no editor SEM gravar em disco; o persist canonico limpa o draft); (7) auditoria **undo/redo** com teste de contrato em `editorStore.test.ts` (addEntity/updateEntity/updateBackgroundLayer/removeEntity empurram historico; collision paint usa begin/commitHistoryCapture como entrada unica, por design); (8) **metricas locais de produto** em `productMetrics.ts` (100% local, sem rede, opt-out, TTFR e gatilhos objetivos de persona guiado->criador e criador->pro; pro->hacker sem gatilho ate existir superficie de reversa gated). Matriz do roadmap ganhou 5 linhas Experimentais (Surface Registry, Seletor de persona, Shell adaptativo por densidade, Autosave de rascunho local, Metricas locais). Gates no worktree: `check:tree` OK, `lint` OK, `tsc --noEmit` OK, `npm test` **48 arquivos passed / 453 testes passed / 2 skipped / 1 failed** - a unica falha e `scripts/build-environment.test.mjs > prepends the user Cargo bin to PATH on Windows`, **pre-existente em `main` neste host Linux e corrigida pela frente Linux (rodadas 78+) em branch propria; nao tocada aqui para nao misturar escopos**. Gates Rust nao rodados nesta rodada: zero mudanca Rust (diff 100% frontend/docs); CI cobre no push. `tauri-driver` ausente no host: QA-RC desktop fica para host com driver/CI. Status honesto: todas as superficies novas sao **Experimental**, sem promocao Stable; as insercoes canonicas da secao 12 do estudo (tese no PRD, regra normativa do registry no roadmap, linha no tree) permanecem **NAO aplicadas**, aguardando decisao humana. Proximos passos da frente UI: bloco H estendido com asserts por resolucao, drawers overlay no compacto, UI de opt-out de metricas, varredura completa de tokens nos componentes restantes.

**Atualizacao anterior (2026-06-28 rodada 77 - W7.4/W7.5 em hardening):** branch `codex/w7-4-blastem-parity`, partindo de `origin/main`/`main` em `9001d2a`. A rodada adiciona Cross-Core Parity e Cycle Report como superficies **Experimental/em hardening**, sem promocao Stable e sem claim de equivalencia gameplay 1:1. Backend: `parity_harness.rs` preserva divergencia de estado final mesmo quando hashes de framebuffer divergem, valida caminhos obrigatorios para ROM/golden/core e gera `cross-core-parity-report.{json,md}`; `parity_run_cycle_report` gera `rds-cycle-report/v1` com timings de frame no host, hashes, estado final e evidencias `m68k_cycle_trace`, `z80_cycle_trace`, `vdp_scanline_trace`, `dma_timing` marcadas como `missing` quando o core Libretro nao expoe traces internos (`not_cycle_accurate=true`). Dependencias/Libretro: `blastem_libretro` entrou como candidato Mega Drive oficial de instalacao/autodetect ao lado de Genesis Plus GX e PicoDrive; o upstream Libretro foi verificado, mas neste host nao havia `blastem_libretro.dll`, entao a validacao real local usou `Genesis Plus GX v1.7.4 46a5521` vs `PicoDrive 2.05-046e5ff`. Frontend: `parityService.ts`, `editorStore.ts` e `ToolsPanel.tsx` ganharam abas **Cross-Core Parity** e **Cycle Report**, ambas `Experimental`, com erros acionaveis, resumo de divergencias/limitacoes e store do ultimo relatorio. Evidencia host-local: teste ignorado `w7_4_w7_5_real_cores_generate_reports_when_available` passou e gerou reports em `src-tauri/target-test/validation/w7-4-w7-5-real-parity/project/.rds/reports/`; a ROM dummy BYOR-safe divergiu entre cores, o que foi reportado como divergencia, nao como falha mascarada. Gates desta rodada: `check:tree`, lint, tsc, `npm test` **47 arquivos / 442 testes**, `cargo check --lib`, clippy, `cargo test --lib` **457/0/24**, preflight SGDK `Ready: SIM`, `build:debug` e `qa-rc` **A-H passed** (`manual-qa-status.json` 2026-06-28T21:04:51.484Z). Readiness de promocao deve ser lido como governanca de branch ate merge em `main`.

**Atualizacao anterior (2026-06-17 rodada 71 - W7.3 finalizada):** branch `codex/w7-3-parity-robustness`, commit de codigo `e8f5e82` (sobre `f189be0`). Fechou as lacunas deixadas pela rodada 70: (1) `scripts/check-tree.cjs` voltou a NAO ignorar `.serena` (afrouxamento revertido) e `.serena/` foi movido para backup fora da raiz; (2) `ProjectCapabilityPanel.tsx` deixou de chamar parity com `golden_path` vazio (botao que sempre falhava removido; agora orienta para a aba **Tools -> Parity Capture**, superficie canonica - nao existe `RuntimeConsolePanel` na arvore); (3) `ParityCaptureSection` atualiza `lastParityReport`; (4) cobertura de UI parity ampliada (`ProjectCapabilityPanel.test.tsx`, `ToolsPanel.test.tsx`); (5) **causa raiz Rust/QA-RC resolvida** - SGDK em path com espaco (`F:\Projects\Sgdk Forge`) quebrava o make (`*** empty variable name. Stop.`); `build_orch.rs` passa `SGDK`/`GDK` ao make como caminho sem espacos (8.3 ou junction `mklink /J`), com regressao `megadrive_build_passes_space_free_sgdk_paths_to_make`. Gates verdes no commit: check:tree, lint, tsc, `npm test` **411**, clippy, `cargo test --lib` **436/0/23**, preflight **Ready: SIM**, `qa-rc` **A-H passed**, `release:readiness:promotion` com unico bloqueador = governanca de branch (2 a frente de `origin/main`), apontando para `e8f5e82`. Artefatos frescos 2026-06-17: EXE portable (23.555.584 B), MSI (8.249.344 B), `release-manifest.json` (`commit=e8f5e82`). Limites honestos: NAO e BlastEm, NAO faz cycle accuracy, NAO prova gameplay 1:1. Gameplay Parity **Experimental**; nenhuma promocao Stable.

**Atualizacao anterior (2026-06-17 rodada 70 - W7.3 parity/capture robust layer):** branch `codex/w7-3-parity-robustness` criada a partir de `main` (`d17dfde`) para implementar a camada de gameplay parity capture. Backend: `parity_harness.rs` (~742 linhas, 13 testes), `project_capability.rs` (campo `gameplay_parity`), `libretro_ffi.rs` (`pub mod test_helpers`, `capture_runtime_state_bytes`), `lib.rs` (comando `parity_run_capture`). Frontend: `parityService.ts` (6 testes), `projectCapability.ts` (interfaces + `gameplay_parity`), `editorStore.ts` (`lastParityReport`), UI portada em `ProjectCapabilityPanel.tsx` e `ToolsPanel.tsx` (tab "Parity Capture"). Gates: tsc, lint, **406/406 npm test**, clippy OK, **18/18 parity tests** + **434/434 cargo test --lib** (1 pre-existing SGDK toolchain detection failure). `npm run build:debug` OK (41MB EXE). Release/portable build em LTO (timeout ~20 min, retornar em sessao dedicada para `build:portable` + `build:msi`). Superficie **Experimental/em hardening**; nenhuma promocao Stable.

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente (2026-05-30 rodada 69):** a branch `codex/ui-final-operational-hardening` foi aberta a partir de `origin/main`/`main` em `935c604262f7f46198416d139b39ace4cdf550ac` para retomar uma implementacao interrompida e publicada em `origin/codex/ui-final-operational-hardening`. A rodada fecha somente a fatia A+B do handoff anterior: shell/topbar/abrir-importar e NodeGraph sem overlays invasivos. O menu Projeto agora separa `Novo Projeto`, `Abrir Projeto`, `Importar Projeto Externo` e `Importar Asset`; o wizard usa os mesmos nomes explicitos, e `Importar Asset` exige projeto ativo, abre o ArtStudio e registra orientacao para imagem/spritesheets, `command.dat` e audio canonico em `assets/audio`. No NodeGraph, `Logic Context` foi dockado no rail direito `nodegraph-context-rail`, fora da area mensuravel `nodegraph-canvas`, com eventos isolados para nao interferir em pan/drag; o oracle desktop captura esse rail e falha com `nodegraph-context-overlaps-canvas` se houver invasao do canvas. Gates frescos: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**44 arquivos / 400 testes**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**417 passed / 23 ignored**), `npm run build:debug`, `npm run preflight:sgdk-e2e`, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` e `npm run test:e2e:desktop:qa-rc` A-H passaram. Duas tentativas de `npm run release:readiness:promotion` nesta branch foram encerradas apos timeout local sem retorno (aprox. 15 min antes do commit e 40 min apos o push) e nao contam como verde; o gate e de promocao institucional e deve ser rerodado em destino limpo/main apos merge. Schemas Tauri gerados foram preservados em `F:\Projects\RetroDevStudio-cleanup-backups\ui-final-hardening-generated-schemas-20260530-194757.patch` e `ui-final-hardening-generated-schemas-post-readiness-timeout-20260530-202321.patch` antes de restauracao seletiva. Nenhuma superficie foi promovida para Stable; NodeGraph, ArtStudio, SGDK Visual No-Code e importadores continuam **Experimental/em hardening**.

**Atualizacao ativa anterior (2026-05-30 rodada 68):** `F:\Projects\RetroDevStudio` voltou a ser o checkout canonico unico do projeto, limpo e alinhado com `origin/main` em `87096854bb19b3e563fd7bfd834250d41807f920`. Esse `main` contem a frente SGDK Visual No-Code Core B (`c726e43`) e a frente SGDK semantic core A (`8709685`) integrada por fast-forward. `git worktree list` aponta somente para o diretorio canonico; os worktrees antigos foram removidos ou arquivados em `F:\Projects\RetroDevStudio-cleanup-backups\archived-dirs-20260530-102456`, com diffs sujos preservados em `F:\Projects\RetroDevStudio-cleanup-backups\archive-20260530-102456`. Resta apenas `F:\Projects\RetroDevStudio-agent-sgdk-semantic-core`, pasta vazia sem vinculo Git bloqueada por processo externo/handle do Windows; ela pode ser apagada apos o processo que a segura ser encerrado. Gates finais no checkout canonico: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**44 arquivos / 397 testes**), `cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri\Cargo.toml --lib -- --nocapture --test-threads=1` (**417 passed / 23 ignored**), `npm run preflight:sgdk-e2e`, `validate-upstream-windows.ps1 -SkipRustTests`, `npm run test:e2e:desktop:qa-rc` A-H, `npm run build:portable`, `npm run build:msi`, `npm run release:manifest` e `npm run release:readiness:promotion` (`Pronto para promocao: SIM`). Isto organiza o projeto em um unico diretorio funcional e compilado; SGDK Visual No-Code, NodeGraph, ArtStudio e Semantic Core continuam **Experimental/em hardening**, sem promocao Stable.

**Atualizacao ativa anterior (2026-05-30 rodada 67):** a frente SGDK Visual No-Code Core A foi consolidada sobre `origin/main` apos a entrada do Core B. O backend agora adiciona relatorios experimentais de IR semantico, cobertura de nodes, round-trip estatico, restricoes de hardware Mega Drive e export de node graph com familias `vdp_validator`, `dma_budget` e `palette_hblank`, alem de comandos IPC Tauri e wrappers frontend (`sgdkSemantic.ts` / `sgdkSemanticService.ts`). A superficie continua **Experimental/em hardening**: reports estaticos deixam `emulation_visible_ok` nulo quando nao ha gate real, bridges seguem explicitas e nada foi promovido para Stable. Gates da branch antes da consolidacao: `check:tree`, `lint`, `tsc`, `npm test` (**44 arquivos / 386 testes**), `cargo clippy`, `cargo test --lib` (**416 passed / 23 ignored**), `preflight:sgdk-e2e`, `validate-upstream-windows.ps1 -SkipRustTests`, corpus SGDK real 122 projetos, relatorios verticais de logica, matriz SGDK 7/7 e no-code SGDK oficial com toolchain/Libretro reais. Esta rodada existe para somar a base semantica ao hardening visual, nao para declarar SGDK/Node Engine completos.

**Atualizacao ativa anterior (2026-05-30 rodada 66):** a frente SGDK Visual No-Code Core B foi implementada na branch `codex/sgdk-visual-nocode-core-b`, em worktree isolado `F:\Projects\RetroDevStudio-agent-sgdk-nodegraph-artstudio`, partindo de `origin/main` e sem tocar o worktree principal sujo. NodeGraph ganhou canvas com pan/zoom por botao do meio e `Space + drag`, snap-to-grid, grid/minimap escalados, categorias visuais de nodes, group boxes, ponte read-only para bridges, estilos de edge hover/ativo, feedback compacto de hardware (tiles, palettes, sprites/frame, sprites/scanline, VRAM, DMA e estrategias como streaming/banks/palette swaps/multiplexing) e criacao visual de transicoes a partir de `SpriteComponent.commands`/`command.dat`. ArtStudio ganhou metadados de animacao por frame (`frame_durations`, `loop_start`, `onion_skin`, `hitboxes`), timeline com mover/duplicar/remover e drag/drop de frames, editor de duracao/loop/onion/hitbox, preview com onion skin e hitbox overlays, palette manager experimental, comando manual com validacao de tokens, estrategia concreta de importacao de arte sem dependencia nova e helpers testaveis. O contrato TypeScript/Rust de `AnimationDef` foi estendido com defaults/compatibilidade serde para preservar projetos antigos. Gates executados na branch: focused Vitest NodeGraph+ArtStudio OK (**58 testes**), focused Rust round-trip OK (**1 teste**), `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit --pretty false` OK, `npm test -- --pool=threads --maxWorkers=1 --no-file-parallelism --testTimeout=30000` OK (**44 arquivos / 397 testes**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` OK (**414 passed / 23 ignored**) e `npm run test:e2e:desktop:qa-rc` OK A-H com SGDK real via `GDK=F:\Projects\MegaDrive_DEV\sdk\sgdk-2.11`, `tauri-driver` local e `RDS_EDGE_DRIVER_PATH=F:\Projects\RetroDevStudio-main-promotion\toolchains\webdriver\msedgedriver.exe`; evidencias `qa-rc-2026-05-30T12-43-55-834Z-*`. Commit tecnico `feat: harden sgdk visual no-code UX` foi pushado para `origin/codex/sgdk-visual-nocode-core-b`. Status honesto: SGDK Visual No-Code, NodeGraph e ArtStudio continuam **Experimental/em hardening**; nenhuma superficie foi promovida para Stable/pronta.

**Atualizacao ativa anterior (2026-05-27 rodada 65):** PR #17 (`codex/asset-browser-production-x-rebased`) foi integrado em `main` por merge commit `634e2478a19d80d6acbf91216a9d5472de4cb115`, contendo `c4ed1f8aeae2d72b697e1122533b6a1addcf1ce7` e a fatia tecnica `3191e7e`. `git merge-base --is-ancestor c4ed1f8aeae2d72b697e1122533b6a1addcf1ce7 HEAD` passou no destino, `origin/main...HEAD` ficou `0/0` e o worktree `F:\Projects\RetroDevStudio-main-promotion` estava limpo antes do registro documental. Checks remotos do `main` no merge commit: `CI` push `success` (`26529217211`) e `Desktop E2E` push `success` (`26529217613`); os checks remotos previos do branch tambem estavam verdes. Gates pos-merge em `main`: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**44 arquivos / 386 testes**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**413 passed / 23 ignored**), `npm run release:readiness:promotion` (`Pronto para promocao: SIM`) e `git diff --check`. Builds finais: `npm run build:debug`, `npm run build:portable`, `npm run build:msi` e `npm run release:manifest` passaram; artefatos esperados: debug EXE `39773184` bytes, portable EXE `22909952` bytes e MSI `8048640` bytes, com hashes registrados no `src-tauri/target-test/validation/release-manifest.json` gerado no HEAD final. Asset Browser agora esta em `main` como **Experimental/em hardening**; nenhuma superficie foi declarada Stable/pronta. A limpeza de worktrees so pode remover worktrees limpos e mergeados; worktrees sujos seguem preservados com patch.

**Atualizacao ativa mais recente (2026-05-27 rodada 64):** a frente Asset Browser X foi reconstituida de forma conservadora em `codex/asset-browser-production-x-rebased`, criada a partir de `origin/main` `5090d5957ceddcfbe9ac730391479616ce357cd6`, sem rebasear a branch antiga divergente. O worktree original `F:\Projects\RetroDevStudio-agent-x-asset-browser` permanece preservado em `codex/asset-browser-production-x` (`2aca62e860b92f8c298822e1d467140d8d8e7b78`), sem remoto, com os schemas gerados sujos ja salvos antes em `F:\Projects\RetroDevStudio-cleanup-backups\asset-browser-x-audit-dirty-20260526-224618.*` e novamente em `F:\Projects\RetroDevStudio-cleanup-backups\asset-browser-x-current-dirty-20260527-045031.*`. A curadoria reaproveitou apenas o delta ainda util: busca/filtros por tipo/gerado/orfao/over-budget, classificacao de assets, resumo rapido de orcamento usando `HwStatus`, marcador de orfao, preview seguro para nao-imagens, detalhes de cena/grafo em "Usado por", abertura direta no ArtStudio sem inserir na cena e regressao de UI/modelo. Foram descartados como superseded/ruido os commits antigos de workspace shell, Runtime Setup, NodeGraph, command.dat, GameMaker/Godot ja absorvidos por `main`, alem de schemas Tauri gerados; ruídos criados por build/QA foram preservados em `F:\Projects\RetroDevStudio-cleanup-backups\asset-browser-x-rebased-generated-noise-20260527-064710.*` e `asset-browser-x-rebased-cargo-noise-20260527-065137.*` antes da limpeza. Gates locais da branch rebased: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**44 arquivos / 386 testes**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**413 passed / 23 ignored**), `npm run test:e2e:desktop:qa-rc` A-H com `RDS_EDGE_DRIVER_PATH=F:\Projects\RetroDevStudio-main-promotion\toolchains\webdriver\msedgedriver.exe` e evidencias `qa-rc-2026-05-27T09-49-29-979Z-*`, e `git diff --check`. Asset Browser continua **Experimental/em hardening**; nenhuma superficie foi declarada Stable/pronta.

**Atualizacao ativa mais recente (2026-05-26 rodada 63):** PR #14 (`codex/godot-2d-subset-y`, head `230ed12d8d755b33fceb0e70af7790386e2c8161`), PR #15 (`codex/command-palette-shortcut-editor-r`, head `6f282d0fd0459fb765cbcf61f1b39400bdc0566d`) e PR #16 (`codex/e2e-create-game-from-zero-s`, head `b4bf3d42917b4748614d1148e7a19abc5dedbf80`) foram confirmados integrados em `main` pelos merge commits `0c0f59e451b158f55c85a928f451f1d9b610d034`, `f20ccd19bb033cea95507ea45b6a5e99042a7029` e `42db9fb30dcc79d659929c6f0d285f2be449d325`. `git merge-base --is-ancestor` confirmou os tres heads dentro do destino. Apos `git fetch --prune origin`, `git checkout main` e `git pull --ff-only origin main`, o readiness inicial pos-merge executou build/baseline/upstream/desktop E2E, mas bloqueou por governanca porque a validacao migrou `src-tauri/tests/fixtures/projects/megadrive_dummy/scenes/main.json` de `schema_version` `1.6.0` para `1.7.0` e tocou arquivos gerados sem diff material; o estado foi preservado em `F:\Projects\RetroDevStudio-cleanup-backups\main-readiness-post-pr15-pr16-dirty-20260526-221524.patch`, `.status.txt` e `.hashes.txt`. O ajuste tecnico minimo `9a058f004d43ae16d3047add78c1a4254ceb48a6` (`test: refresh megadrive fixture schema version`) foi pushado em `main`, deixando o destino local/remoto nesse SHA antes do registro documental. Gates pos-merge em `main`: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**43 arquivos / 379 testes**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**413 passed / 23 ignored**), `npm run release:readiness:promotion` (`Pronto para promocao: SIM`) e `git diff --check`. Checks remotos confirmados via GitHub API: PRs #14/#15/#16 com `validate` e `desktop-smoke` `success`; `main` em `9a058f004d43ae16d3047add78c1a4254ceb48a6` tambem com `validate` e `desktop-smoke` `success`. Godot 2D subset, Command Palette/Shortcut Editor e Create Game E2E estao integrados apenas como superficies Experimentais/em hardening; nenhuma superficie foi declarada Stable/pronta. Auditoria inicial de `codex/asset-browser-production-x`: worktree `F:\Projects\RetroDevStudio-agent-x-asset-browser`, branch local `2aca62e860b92f8c298822e1d467140d8d8e7b78`, sem remoto `origin/codex/asset-browser-production-x`, sujo em `src-tauri/gen/schemas/acl-manifests.json`, `desktop-schema.json` e `windows-schema.json`; backup preservado em `F:\Projects\RetroDevStudio-cleanup-backups\asset-browser-x-audit-dirty-20260526-224618.patch`, `.cached.patch`, `.status*.txt`, `.hashes.txt` e `.log.txt`. Comparacao: `origin/main...HEAD = 106/6`, `HEAD` nao e ancestral de `origin/main` e `origin/main` nao e ancestral de `HEAD`; a branch mistura commits antigos parcialmente absorvidos com uma fatia Asset Browser ainda nao limpa. Decisao conservadora: nao rebasear, nao fechar e nao remover ate curadoria manual/tecnica dedicada do patch e dos commits unicos.

**Atualizacao ativa anterior (2026-05-26 rodada 60):** PR #12 (`codex/nodegraph-execution-inspector-w`, head `28263357e5c01c2bbe4aca98d39a8451658d6066`) e PR #13 (`codex/save-sram-project-settings-u`, head `96d49579da778eef8e8176643e7db6c947dd9cb9`) foram confirmados integrados em `main` pelos merge commits `d4b3b5942dde886f35965b5cc71f297d2e5e8520` e `ee07110ea22804dc8cb36296b6b281f8d316e07d`. O `main` final local/remoto esta em `ee07110ea22804dc8cb36296b6b281f8d316e07d`, e `git merge-base --is-ancestor` confirmou os dois heads dentro do destino. Gates pos-merge em `main`: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test -- --no-file-parallelism --maxWorkers=1` apos timeout isolado de worker no primeiro `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**406 passed / 22 ignored**), `npm run release:readiness:promotion` e `git diff --check`. O readiness final retornou `Pronto para promocao: SIM`; a primeira tentativa detectou sujeira gerada por validacao, preservada antes da limpeza em `F:\Projects\RetroDevStudio-cleanup-backups\main-readiness-dirty-20260526-150245.patch`, e o rerun verde tambem teve diff gerado preservado em `F:\Projects\RetroDevStudio-cleanup-backups\main-readiness-dirty-postsuccess-20260526-151520.patch`. NodeGraph Inspector e Save/SRAM estao integrados como superficies Experimentais/em hardening; nenhuma superficie foi declarada Stable. Proxima leva: abrir/processar `codex/godot-2d-subset-y`, `codex/command-palette-shortcut-editor-r` e `codex/e2e-create-game-from-zero-s`; `codex/asset-browser-production-x` permanece intocada ate auditoria do worktree sujo.

**Atualizacao ativa anterior (2026-05-25 rodada 57):** apos a integracao AAA em `main` e o registro documental `72c31f787b1b8af0b6811134bb74181c2be903e5`, a triagem governada foi corrigida com rebase final das branches pendentes sobre `origin/main`. `codex/release-manifest-packaging-z` PR #11 (`a699e02`), `codex/nodegraph-execution-inspector-w` PR #12 (`e2bf5b1`) e `codex/save-sram-project-settings-u` PR #13 (`49626a9`) estao abertos com `CI / validate` e `Desktop E2E / desktop-smoke` verdes em `push` e `pull_request`, aguardando autenticacao/merge humano. `codex/godot-2d-subset-y` (`30b495c`), `codex/command-palette-shortcut-editor-r` (`0ff2506`) e `codex/e2e-create-game-from-zero-s` (`4d1f717`) foram rebaseadas, validadas, pushadas e estao com checks remotos de `push` verdes; `gh auth status` continua sem login, entao PRs locais nao puderam ser criados para Y/R/S. `git merge-tree --write-tree origin/main <branch>` ficou limpo para Z/W/U/Y/R/S apos o rebase final. A branch `codex/asset-browser-production-x` tem remoto ausente e worktree com gerados sujos, portanto foi preservada e nao removida. Em `main`, `npm run build:debug`, `npm run build:portable`, `npm run build:msi` e `npm run release:readiness:promotion` passaram; readiness retornou `Pronto para promocao: SIM` em `72c31f787b1b8af0b6811134bb74181c2be903e5`. Artefatos finais: `src-tauri/target-test/debug/retro-dev-studio.exe`, `src-tauri/target-test/release/retro-dev-studio.exe` e `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`. Isto nao promove SGDK/Node Engine/GameMaker/Godot/MUGEN/Ikemen/OpenBOR/SNES/ArtStudio/AAA para Stable; todas as superficies parciais seguem Experimental/Em hardening ate evidencia institucional completa.

**Atualizacao ativa anterior (2026-05-25 rodada 56):** apos a integracao AAA em `main` (`fc925e2b200ca92409e7773fd0126484d4798505`), a triagem governada inicial das branches pendentes foi executada sem limpeza destrutiva. Um commit documental posterior em `main` exigiu o rebase final registrado na rodada 57.

**Atualizacao ativa mais recente (2026-05-25 rodada 55):** PR #10 (`codex/aaa-capability-layer-q`) foi aberto e mergeado em `main` por `962e856aeee948c0e6b96be9ec3fb4d6b053ecd9`, contendo `d3651ecec3a41652ba2f2731ddb6577071221c81`. A branch ja tinha sido rebased sobre `origin/main` (`25166c7ff8712dad286e73b41ae5e577029d9e67`) e validada localmente com `check:tree`, `lint`, `tsc`, `npm test` **357/357**, `cargo clippy`, `cargo test --lib` **398 passed / 22 ignored**, `build:debug`, `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc` A-H (`qa-rc-2026-05-24T20-49-39-814Z-*`), `validate-upstream-windows.ps1 -SkipRustTests` e `git diff --check`. Em `main` pos-merge, os checks remotos `CI / validate` e `Desktop E2E / desktop-smoke` do commit `962e856aeee948c0e6b96be9ec3fb4d6b053ecd9` completaram com `success`, e `npm run release:readiness:promotion` retornou `Pronto para promocao: SIM`. A camada adiciona diagnostics experimentais de capability, ROM mastering, runtime contracts, audio, asset quality e templates SGDK no produto, mas **nao** declara AAA pronto nem promove SGDK/Node Engine/GameMaker/Godot/MUGEN/OpenBOR/SNES/ArtStudio para Stable.

**Atualizacao ativa anterior (2026-05-24 rodada 54):** branch `codex/aaa-capability-layer-q` foi rebased sobre `origin/main` (`25166c7ff8712dad286e73b41ae5e577029d9e67`) e validada localmente no head tecnico `c3bea9799347ed1650fc8544419e551857b586cc`. Gates frescos pos-rebase: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` **357/357**, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` **398 passed / 22 ignored**, `npm run build:debug`, `npm run preflight:sgdk-e2e`, `npm run test:e2e:desktop:qa-rc` A-H (`qa-rc-2026-05-24T20-49-39-814Z-*`), `powershell -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` e `git diff --check`. A camada adiciona diagnostics experimentais de capability, ROM mastering, runtime contracts, audio, asset quality e templates SGDK no produto, mas **nao** declara AAA pronto nem promove SGDK/Node Engine/GameMaker/Godot/MUGEN/OpenBOR/SNES/ArtStudio para Stable.

**Atualizacao ativa anterior (2026-05-24 rodada 53):** PR #9 (`codex/full-product-cohesion-integration`) foi mergeado em `main` por `b1fa27bced08163f751ab5615332cb0a793fc06a`, contendo `b80accca85312e531783caa1d3ec9a58ed4b4101`. Apos o merge, `main` recebeu o hotfix `f59309c067b467cf21ad48ddc5d6c4415012d78e` para alinhar o build real ao preflight: `BuildEnvironment::detect()` agora aceita `GDK`/`GDK_WIN` como aliases oficiais de SGDK, alem de `SGDK_ROOT` e `toolchains/sgdk`. `npm run release:readiness:promotion` passou no destino com `Pronto para promocao: SIM`; gates locais rodados incluem `check:tree`, `lint`, `tsc`, `npm test` **350/350**, `cargo clippy`, `cargo test --lib` **383/22 ignored**, `build:debug`, `build:portable`, `build:msi`, `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc` A-H (`qa-rc-2026-05-24T16-02-05-806Z-*`), `validate-upstream-windows.ps1 -SkipRustTests` e `git diff --check`. Artefatos gerados: `src-tauri/target-test/debug/retro-dev-studio.exe`, `src-tauri/target-test/release/retro-dev-studio.exe` e `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`. Checks remotos do PR #9 estavam verdes; no hotfix `f59309c`, `CI / validate` e `Desktop E2E / desktop-smoke` remotos tambem completaram com `success`. Sem promocao SGDK/Node Engine/GameMaker/Godot/MUGEN/OpenBOR/SNES/ArtStudio/AAA para Stable; superficies parciais continuam Experimental/Em hardening conforme roadmap.

**Atualizacao ativa anterior (Agente Q, branch `codex/aaa-capability-layer-q`):** criada camada experimental de evidencia pratica, sem claim de "AAA pronto": modelo Rust/TypeScript `ProjectCapabilityReport`, comandos Tauri `inspect_project_capability`, `inspect_rom_mastering`, `inspect_runtime_contracts`, `inspect_audio_pipeline`, `list_sgdk_pattern_templates` e `inspect_asset_quality`, e paineis integrados em Debug/Tools, Build/Game status, Inspector, ArtStudio e NodeGraph. ROM mastering so inspeciona SEGA/SNES, regiao, SRAM, checksum, tamanho, alinhamento, SHA256 e extensao; runtime evidence probe fica desligado por padrao; templates SGDK entram como galeria Experimental. Status: capability diagnostics **Experimental**, sem promocao de SGDK/Node Engine/ArtStudio/SNES/GameMaker/MUGEN/OpenBOR.

**Atualizacao ativa anterior (2026-05-23 rodada 51, branch `codex/release-manifest-packaging-z`):** adicionou `scripts/release-manifest.mjs` e o script npm `release:manifest`, gerando `src-tauri/target-test/validation/release-manifest.json` para distribuicao interna auditavel. O manifesto registra versao, commit, branch, data, EXE debug, EXE portable, MSI, SHA256/tamanho, readiness report, resumo de toolchains, CI quando disponivel, signing e updater. Cobertura: schema minimo, hashes SHA256, erro acionavel para artefato ausente, leitura correta do upstream report e bloqueio de assinatura falsa sem certificado real. Status historico honesto: `validate-upstream-windows.ps1 -SkipRustTests` falhou duas vezes com `toolchain_missing` e `release-readiness.md` seguia `Pronto para promocao: NAO`; a branch precisa de rebase e validacao fresca sobre `origin/main`.

**Atualizacao ativa anterior:** em `2026-05-20 (rodada 50)`, a branch `codex/product-ui-workspace-redesign` fechou o **bloco H** do QA RC com asserts automaticos em `scripts/e2e-tauri-build-run.mjs` e **12 screenshots** (`H-ui-layout-*`) para 1366x768, 1920x1080 e 2560x1080 sobre Scene/Logic/Game/Debug. E2E: `clickByTestId`, retorno a Scene antes do botao Objeto->Art pos-Logic (Inspector desmontado com `showRight=false`), espera do side rail do NodeGraph apos lazy-load, timeout de arranque do driver em `qa-rc`, janela 1920 no onboarding RC. Topbar: scroll horizontal no bloco central. Gates: `check:tree`, `lint`, `tsc`, `npm test` **322/322**, `cargo clippy`, `cargo test --lib`, `preflight:sgdk-e2e`, `validate-upstream-windows.ps1 -SkipRustTests`, `build:debug`/`portable`/`msi`, QA RC A-H verde (`qa-rc-2026-05-20T07-45-07-583Z-*`). UI hardening **SIM para a fatia H**; promocoes SGDK/Node Engine inalteradas (**sem** promocao Stable institucional).

**Atualizacao ativa anterior:** em `2026-05-19 (rodada 48)`, a branch `codex/project-cohesion-full-build` consolidou `main` (GameMaker vertical via PR #8) com `codex/command-dat-artstudio-node-runtime`: coexistem `compatibility_harness`/`gml_to_nodes` e `input_commands`/`input_command`/ArtStudio Comandos. GameMaker e command.dat permanecem **Experimental**; SGDK/Node Engine sem promocao Stable institucional nesta rodada.

**Atualizacao ativa anterior:** em `2026-05-19 (rodada 47)`, a branch `codex/command-dat-artstudio-node-runtime` fechou uma frente paralela em worktree isolada (`F:\Projects\RetroDevStudio-command-dat`) para transformar `command.dat` local/BYOR em comandos visuais e nodes executaveis. O parser canonico Rust (`src-tauri/src/core/input_commands.rs`) e o espelho frontend (`src/core/inputCommands.ts`) suportam o subset `[Command]`, `name`, `command`, `time`, direcoes `_1.._9`, aliases `D/F/B/U/DF/DB/UF/UB`, `_P/_K`, botoes MUGEN `a,b,c,x,y,z`, simultaneo `+`, sequencias por virgula e janela por frames. `SpriteComponent.commands` persiste bindings experimentais; ArtStudio importa arquivo local, mostra chips visuais por perfil Mega Drive/SNES/teclado/mouse e associa comandos a sequencias; NodeGraph ganhou `input_command`, quick action e codegen SGDK/SNES com matcher por ring buffer. Tokens fora do subset geram `unsupported_tokens` e bloqueiam C via `#error` acionavel. A prova real `official_sgdk_nocode_game_builds_and_runs_with_real_toolchain --ignored` passou com SGDK v2.11/Libretro reais e o projeto no-code persistente inclui Hadouken por `input_command`, ROM real e framebuffer visivel. Gates finais verdes: `check:tree`, `lint`, `tsc`, `npm test` **315/315**, `cargo clippy`, `cargo test --lib` **344/16 ignored**, preflight SGDK/E2E, `build:debug` e QA RC A-G. Superficie segue **Experimental**, sem scraping de wikis e sem claim de compatibilidade total de todos os dialetos.

**Atualizacao ativa anterior:** em `2026-05-18 (rodada 46)`, a branch `codex/product-compatibility-wave` iniciou hardening real de importadores sem mexer no core SGDK/Node/BLAZE. A base `main` estava limpa/alinhada em `a0fe109` e `npm run release:readiness:promotion` passou com `Pronto para promocao: SIM` antes da feature. O perfil `gamemaker` passou de Parcial/nao importavel para **Experimental/importavel** com adapter GMX/GMZ/GMEZ em `src-tauri/src/core/project_mgr.rs`: extrai pacotes 7z via `sevenz-rust2` ja existente, detecta layouts `sprites/objects/rooms` e `Assets/Sprites/Objects/Rooms`, importa rooms/instances/sprites/objetos, cria entidades editaveis/camera por view e preserva GML como bridge semantica visivel (`logic_hints`, `graph_origin=gamemaker_gmx`, `imported_semantics.source=gamemaker_gmx`). Cobertura focada passou: teste unitario de GMX, matriz de perfis e teste host-local ignorado contra `F:\Projects\Game Maker\Basic_platform_game_example.gmez` e `F:\Projects\Godot\Super Bowsette Source Code Beta 0.1\src`. Isto nao declara conversao GameMaker nativa completa, nao cobre `.yyp/.yy` modernos e nao prova ainda SGDK C/ROM/emulacao para GameMaker.

**Atualizacao ativa anterior:** em `2026-05-18 (rodada 45)`, o PR #5 (`https://github.com/Misael-art/RetroDevStudio/pull/5`, branch `codex/sgdk-stable-node-engine-blaze`) foi integrado em `main` por merge commit `a31357072c93431ce441ff51a88a51004365ca88`, contendo o head `7768f4bcc3c2109eac4ec2531bd8078a8dfeba81`. Apos rerun do `Desktop E2E` remoto, os checks `CI`, `Desktop E2E` e `CodeRabbit` ficaram verdes; o `main` local foi atualizado por fast-forward e `npm run release:readiness:promotion` passou com `Pronto para promocao: SIM`. Em seguida foi aberta a branch `codex/product-professionalization-wave` para avancar UX/CX sem regressao. Primeira fatia implementada: registro central de atalhos (`src/core/shortcuts.ts`) com agrupamento, normalizacao, deteccao de conflitos e matching de eventos; o menu/topbar agora mostra atalhos em tooltips/labels, `Ctrl+/` abre o mapa central e `Ctrl+Alt+F/S/R` aciona foco/layout salvo/restaurado. Cobertura: `src/core/shortcuts.test.ts`, `App.test.tsx` para menu/atalho central, `npm run check:tree`, `git diff --check`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**307/307**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` e `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**336 passed / 15 ignored**) verdes. Isto nao promove novas superficies: command palette, editor de shortcuts, ArtStudio, importadores, SNES parity e debug/profiling avancado seguem pendentes/Experimentais ate prova dedicada.

**Atualizacao ativa anterior:** em `2026-05-17 (rodada 44)`, a branch `codex/sgdk-stable-node-engine-blaze` endureceu a prova Stable com framebuffer visivel obrigatorio (`non_black_pixels > 0`) via `corpus_libretro_visible_smoke`. A causa das ROMs pretas em **Mega Drive Breakout** e **Procedural Animation** foi `XGM_startPlay` bloqueando saida visivel no Libretro; a correcao compila com `-DRDS_CORPUS_VISIBLE_SMOKE` (`RDS_EXTRA_FLAGS` -> `EXTRA_FLAGS` do SGDK) e suprime BGM nesse modo, injetando paleta/texto deterministico em `sgdk_emitter.rs`. O runner `sgdk_corpus_real_build_rom_emulation_report --ignored` fechou **122/122** com **68** build/ROM/emulacao visivel (`emulation_visible_ok=68`), **54** bridge formal, **0** falhas, `stable_candidate=true`, `fake_toolchain_used=false` (report em `src-tauri/target-test/validation/sgdk-corpus-real-build/`). Regressoes: `sgdk_corpus_regression_mega_drive_breakout_visible_framebuffer`, `sgdk_corpus_regression_procedural_animation_visible_framebuffer`. No-code real e BLAZE compat real permanecem verdes; barra local incluiu QA RC `qa-rc-2026-05-18T02-34-48-725Z-*`. SGDK Stable local: **SIM**; Node Engine Stable local: **SIM**; `support_status` publico permanece sem promocao automatica nesta fatia.

**Atualizacao ativa anterior:** em `2026-05-13 (rodada 41)`, o PR #4 (`https://github.com/Misael-art/RetroDevStudio/pull/4`) foi confirmado como mergeado em `main` por merge commit `91bb8eb354389e370bb59d6a5ae84c21b4a1429f`, contendo o head `d21939ce83f360072a64637170922c78e2dd149d` da branch `codex/sgdk-nocode-production-ui`. Os checks remotos de `pull_request` estavam verdes no SHA do PR: `CI` run `25788180025` e `Desktop E2E` run `25788180007`; havia um run separado de `Desktop E2E` no evento `push` com falha no mesmo SHA, mas ele nao era o gate de PR usado para merge. `main` local foi atualizado por fast-forward, `git merge-base --is-ancestor d21939ce83f360072a64637170922c78e2dd149d HEAD` confirmou o head do PR em `main`, e `npm run release:readiness:promotion` passou em `main` com `Pronto para promocao: SIM`, divergencia `+0 / -0`, commit `91bb8eb354389e370bb59d6a5ae84c21b4a1429f`. O readiness reexecutou `check:tree`, `lint`, `tsc --noEmit`, `npm test` **301/301**, `cargo clippy`, `cargo test --lib`, `build:debug`, `validate-upstream-windows.ps1 -SkipRustTests` e desktop E2E simples; consumiu QA RC A-F de `qa-rc-2026-05-13T01-31-23-216Z-*`. UI/CX production hardening esta integrado em `main`, mas SGDK Stable: **NAO**; Node Engine Stable: **NAO**. Ainda faltam AST C completo, round-trip/build/emulacao dos 122 projetos, reducao governada dos gaps do corpus e ROM/emulacao institucional de jogo 100% no-code. `BLAZE_ENGINE` permanece blocker/stress corpus legitimo.

**Atualizacao ativa anterior:** em `2026-05-13 (rodada 40)`, a branch `codex/sgdk-nocode-production-ui` foi estabilizada para fechamento: o shell manteve topbar compacta com badge/popover de warnings, status bar inferior, viewport com toggles pequenos para camera/bounds/labels/staging/warnings/key color, Hierarchy com badges compactos e Inspector com campos editaveis antes do diagnostico importado colapsado. A transparencia de magenta agora usa flood fill a partir da borda, tornando transparente somente a cor-chave conectada ao fundo e preservando magenta legitimo isolado no interior do sprite. O `NodeGraphEditor` declara o vocabulario no-code obrigatorio (`input_*`, movimento, spawn/destroy, animacao, camera, timer, variaveis, flow, FSM, audio, tilemap, hardware budget e bridge) e expoe `autoLayoutNodeGraph`; o compilador experimental `src/core/nodegraph/nodeCompiler.ts` prova C deterministico para um jogo Mega Drive 100% por nodes em teste unitario. No backend, `src-tauri/src/core/sgdk_corpus_inventory.rs` emite semantic gaps acionaveis (`impact`, `severity`, `suggestion`, flags de bloqueio no-code/build/round-trip) e `node_candidates` por projeto. O corpus real `F:\Projects\MegaDrive_DEV\SGDK_Engines` continuou com **122 projetos** e gaps agregados inalterados (`preprocessor_condition=1471`, `function_like_macro=484`, `unsupported_resource_kind=236`, `assembly_source=150`, `multiline_macro=90`, `inline_assembly=47`, `lossy_source_encoding=33`), mas o report regenerado registra **32.251 candidatos de nodes** em **100 projetos**. Gates locais frescos desta estabilizacao: `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` **301/301**, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` **333 passed / 11 ignored**, `cargo test sgdk_corpus_inventory` **4 passed / 1 ignored**, `cargo test sgdk_corpus_inventory_real_corpus_report --ignored` OK, `cargo test sgdk_matrix_corpus_ --ignored` **7/7**, `npm run preflight:sgdk-e2e` OK, `validate-upstream-windows.ps1 -SkipRustTests` OK, `npm run test:e2e:desktop:qa-rc` A-G OK com evidencias `qa-rc-2026-05-13T01-31-23-216Z-*`, `build:debug` OK, `build:portable` OK e `build:msi` OK. Readiness de promocao continua nao promocional fora de `main`: deve ser lida como governanca de branch/PR ate merge e rerun no destino canonico. Isto **nao** promove SGDK nem Node Engine: ainda nao ha AST C completo, round-trip/build/emulacao dos 122 projetos nem ROM de jogo no-code institucionalmente provada.

**Atualizacao ativa anterior:** em `2026-05-12 (rodada 38)`, foi criada a branch `codex/sgdk-nocode-engine-hardening` a partir de `origin/main` (`4bf4db585b0091e0a8c0460450832067bcf6c05c`). Baseline inicial passou: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**292**), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` e `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**329 passed / 10 ignored**). Foi adicionado `src-tauri/src/core/sgdk_corpus_inventory.rs` com scanner estrutural SGDK (C-lite/RES/assets/source mapping/semantic gaps) e comandos IPC `inspect_sgdk_project_inventory` / `inspect_sgdk_corpus_inventory`. O teste ignorado `sgdk_corpus_inventory_real_corpus_report` catalogou o corpus real `F:\Projects\MegaDrive_DEV\SGDK_Engines` com **122 projetos** e gerou `src-tauri/target-test/validation/sgdk-corpus-inventory.json` (**20,817,228 bytes**) contendo resumo e `project_details` por projeto. Gaps agregados: `preprocessor_condition=1471`, `function_like_macro=484`, `unsupported_resource_kind=236`, `assembly_source=150`, `multiline_macro=90`, `inline_assembly=47`, `lossy_source_encoding=33`. A verificacao local pos-implementacao passou `check:tree`, `lint`, `tsc --noEmit`, `npm test` (**292/292**), `cargo clippy`, `cargo test --lib` (**332 passed / 11 ignored**), o filtro `sgdk_corpus_inventory`, o corpus real ignorado, `sgdk_matrix_corpus_ --ignored` (**7/7**), `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc` A-G, `build:debug`, `build:portable`, `build:msi` e `validate-upstream-windows.ps1 -SkipRustTests`. Apos o commit tecnico `37a0c52`, `npm run release:readiness:promotion` reexecutou baseline, build debug, upstream e desktop E2E verdes, mas retornou `Pronto para promocao: NAO` porque a branch estava 1 commit a frente de `origin/main`; isso e bloqueio de governanca pre-merge/main, nao evidencia de Stable. Isto **nao** promove SGDK nem Node Engine: SGDK segue **Experimental**, Node/Phase D segue **Experimental/Parcial**, e o inventario ampliado mostra trabalho real restante antes de AST/round-trip/no-code Stable.

**Atualizacao ativa anterior:** em `2026-05-11 (rodada 37)`, o PR #3 (`https://github.com/Misael-art/RetroDevStudio/pull/3`) foi confirmado com `CI` e `Desktop E2E` remotos verdes no SHA `d2fec08eba2ec68d31714439bd92e8637d423114` (runs `25704763249`, `25704763247`), `draft=false`, `mergeable=true`, e foi mergeado em `main` por merge commit `76ccd7d978ea741771478d89053818285213d32e`. `main` local foi atualizado por fast-forward e `npm run release:readiness:promotion` passou no commit `76ccd7d` com `Pronto para promocao: SIM`, divergencia `+0 / -0`, baseline local, upstream oficial e desktop E2E simples verdes. A mudanca integrada endurece Runtime Setup com retry/cache/fallback e adiciona validacao visual de NodeGraph. Isto mantem o core MVP promovivel em `main`, mas **nao** promove SGDK nem Node Engine: SGDK segue **Experimental**, Node/Phase D segue **Experimental/Parcial** sem jogo completo criado por nodes e sem AST C completo; `BLAZE_ENGINE` segue blocker/stress corpus legitimo.

**Atualizacao ativa anterior:** em `2026-05-11 (rodada 36)`, apos a promocao do PR #2, foi aberta a branch `codex/product-hardening-runtime-setup` a partir de `main` para avancar hardening implementavel sem inflar status. `src-tauri/src/tools/dependency_manager.rs` passou a usar retry/backoff para downloads/metadados oficiais, cache local de metadata de GitHub Releases em `toolchains/.cache/github-releases/`, fallback para cache quando a API falha e mensagens acionaveis para rate limit/erro remoto sem expor tokens; `.gitignore` ignora esse cache. `src/components/nodegraph/NodeGraphEditor.tsx` ganhou `validateNodeGraph` com erros para refs/portas quebradas, incompatibilidade de tipo/kind e ciclos `exec`, alem de avisos de entrada ausente/no solto e preview no painel. Cobertura nova: testes Rust do cache/rate-limit/retry e teste Vitest de validacao do grafo. Gates frescos nesta branch: `check:tree`, `lint`, `tsc --noEmit`, `npm test` (**292**), `cargo clippy`, `cargo test --lib` (**329** passed / **10** ignored), `validate-upstream-windows.ps1 -SkipRustTests` (`success=true`), `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc` A-G (`qa-rc-2026-05-11T23-49-20-465Z-*`), `sgdk_matrix_corpus_ --ignored` (**7/7**) e `build:debug`/`build:portable`/`build:msi`. Isto nao promove SGDK nem Node Engine: SGDK segue **Experimental**, Node/Phase D segue **Experimental/Parcial** sem jogo completo criado por nodes e sem AST C completo; `BLAZE_ENGINE` segue blocker/stress corpus legitimo.

**Atualizacao anterior adicional:** em `2026-05-11 (rodada 35)`, o GitHub CLI foi instalado via `winget` (`gh 2.92.0`), mas o host local nao tinha sessao `gh` nem `GH_TOKEN`/`GITHUB_TOKEN`. O conector GitHub autenticado como `Misael-art` confirmou PR #2 em `head_sha=3b2b33e15f688939f7cca038be00ab3c1b8ad0b5`, `draft=true`, checks `CI` e `Desktop E2E` de pull_request verdes (`25698765825`, `25698765818`), marcou o PR como ready e fez merge commit `35ab81ff63628ad50d4f5afff289f32013171c99` em `main`. Em `main`, `npm run release:readiness:promotion` passou com `Pronto para promocao: SIM` no mesmo commit, consumindo QA A-G fresco `qa-rc-2026-05-11T21-20-39-556Z-*`, baseline, upstream e desktop smoke. Isso fecha a governanca tecnica de promocao do core MVP em `main`; SGDK segue **Experimental**, `support_status` inalterado, Node/Phase D segue heuristica sem AST C completo, e `BLAZE_ENGINE` continua blocker/stress corpus legitimo.

**Atualizacao anterior adicional:** em `2026-05-11 (rodada 34)`, na branch `feat/sgdk-vram-residency-streaming-r14`, foi corrigido um bloqueio novo do `desktop-smoke` remoto: a consulta de release oficial do SGDK em `api.github.com` estava sem autenticacao e esbarrou em `403 rate limit exceeded`. `src-tauri/src/tools/dependency_manager.rs` agora injeta `Authorization: Bearer ...` a partir de `RDS_GITHUB_TOKEN`/`GITHUB_TOKEN` somente para `https://api.github.com/`; `.github/workflows/desktop-e2e.yml` passa `${{ github.token }}` como `RDS_GITHUB_TOKEN`. Cobertura: `github_api_get_uses_ci_token_only_for_github_api`. Gates locais pos-correcao reexecutados: `check:tree`, `lint`, `tsc --noEmit`, `npm test` (291), `cargo clippy -D warnings`, `cargo test --lib` (326 passed / 10 ignored), `validate-upstream-windows.ps1 -SkipRustTests`, `preflight:sgdk-e2e`, `sgdk_matrix_corpus_ --ignored` (7/7), `test:e2e:desktop:qa-rc` A-G (`qa-rc-2026-05-11T21-20-39-556Z-*`), `build:debug`, `build:portable` e `build:msi`. Isto nao muda status de produto: PR #2 segue como trilha de promocao; merge/main e `release:readiness:promotion` no destino continuam obrigatorios. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica.

**Atualizacao anterior adicional:** em `2026-05-11 (rodada 33)`, na branch `feat/sgdk-vram-residency-streaming-r14`, o hotfix `7bf026b` (`fix(e2e): harden live stale and toolbar overflow`) foi commitado e pushado. Ele corrige o estado `DESATUAL.` imediato apos edicao de cena validada, ajusta o oraculo E2E para revalidacao que completa rapido e impede que widgets informativos da topbar interceptem botoes centrais no runner remoto. Passaram localmente `check:tree`, `lint`, `tsc --noEmit`, `npm test` (291), `cargo clippy -D warnings`, `cargo test --lib` (325 passed / 10 ignored), `validate-upstream-windows.ps1 -SkipRustTests`, `preflight:sgdk-e2e`, matriz desktop local 16/16, `test:e2e:desktop:qa-rc` A-G (`manual-qa-status.json` `2026-05-11T18:15:08.061Z`, evidencias `qa-rc-2026-05-11T18-14-46-427Z-*`), `sgdk_matrix_corpus_ --ignored` (7/7), `build:debug`, `build:portable` e `build:msi`. No GitHub Actions, o SHA `7bf026b` passou `CI` e `Desktop E2E` em `push` e `pull_request` (runs `25689348726`, `25689348725`, `25689350772`, `25689350771`). O PR #2 existe, mas segue `draft/open`; `gh` nao esta instalado neste host. `release:readiness:promotion` foi reexecutado em worktree limpo e falhou apenas porque a branch continua muitos commits a frente de `origin/main`; a promocao real ainda exige merge/main e rerun no destino. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica; `BLAZE_ENGINE` segue blocker legitimo auditavel.

**Atualizacao anterior adicional (2):** em `2026-05-11 (rodada 32)`, na branch `feat/sgdk-vram-residency-streaming-r14`, o host Windows foi rechecado sem exigir novo codigo de setup: os scripts canonicos localizaram `cargo`, `tauri-driver` (`C:\Users\misae\.cargo\bin\tauri-driver.exe`), `msedgedriver` e WiX/cache existentes. Passaram `check:tree`, `lint`, `tsc --noEmit`, `npm test` (290), `cargo clippy -D warnings`, `cargo test --lib` (325 passed / 10 ignored), `release:readiness:baseline` com auxiliares, `preflight:sgdk-e2e` (`Ready: SIM`), `test:e2e:desktop:qa-rc` A-G (`qa-rc-2026-05-11T11-53-47-951Z-*`), `validate-upstream-windows.ps1 -SkipRustTests` (`success=true`), `sgdk_matrix_corpus_ --ignored` (7/7), `build:portable` e `build:msi`. `release:readiness:promotion` rodou em modo estrito e saiu com codigo 1 apenas por governanca; o snapshot pre-commit documental indicou branch +201 vs `origin/main`, e a branch continua a frente apos registrar esta rodada. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica; `BLAZE_ENGINE` segue blocker legitimo auditavel.

**Atualizacao anterior adicional (3):** em `2026-05-10 (rodada 31)`, na branch `feat/sgdk-vram-residency-streaming-r14`, o host Windows foi preparado e a barra tecnica local voltou a ficar verde: Rust MSVC `1.95.0`, Visual Studio Build Tools/VC Tools, `cargo-clippy`, `tauri-driver v2.0.6` e WiX 3.14 cacheado em `%LOCALAPPDATA%\tauri\WixTools314`. Passaram `check:tree`, `lint`, `tsc --noEmit`, `npm test` (290), `cargo clippy -D warnings`, `cargo test --lib` (325 passed / 10 ignored), `sgdk_matrix_corpus_ --ignored` (7/7), `validate-upstream-windows.ps1 -SkipRustTests` (`success=true`), `preflight:sgdk-e2e` (`Ready: SIM`), `test:e2e:desktop:qa-rc` (A-G passed), `build:portable` e `build:msi`. O MSI foi desbloqueado apos falha ambiental de download do `wix314-binaries.zip` (`timeout: global`) via cache local verificado por SHA-256. `release:readiness:baseline` passou os gates, mas a promocao segue **NAO** por governanca: branch continua +200 vs `origin/main` e ha worktree amplo a consolidar. SGDK **Experimental**; `support_status` inalterado; Fase D continua heuristica.

**Continuacao rodada 23 (codigo, sem commit/push):** grafos Phase D encadeiam no terminal por *papel*; `tail_node` apos `scroll_bg`. Tilemap: `buildTilemapAuthoringBrush` no Inspector/Hierarchy; paleta com `resolveProjectAssetPath`. Viewport: DOADOR/STAGING/INFERIDA + moldura staging; Inspector: `Pos:`.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

---

### CHECKPOINT operacional (2026-05-11 - rodada 37, main)

- **Escopo da rodada:** integrar PR #3 apos CI remoto verde e rerodar readiness de promocao no destino real.
- **PR/CI remoto:** PR #3 (`https://github.com/Misael-art/RetroDevStudio/pull/3`) estava `open`, `draft=false`, `mergeable=true`, com head `d2fec08eba2ec68d31714439bd92e8637d423114`. GitHub Actions passou `CI` run `25704763249` e `Desktop E2E` run `25704763247`; o job `desktop-smoke` concluiu todos os cenarios MD/SNES, overflow/warning/healthy/error/stale com sucesso.
- **Merge/main:** PR #3 foi mergeado por merge commit `76ccd7d978ea741771478d89053818285213d32e`; `git checkout main` + `git pull --ff-only origin main` atualizou o destino local por fast-forward.
- **Readiness em main:** `npm run release:readiness:promotion` saiu com codigo 0 e `Pronto para promocao: SIM` em `main`, commit `76ccd7d978ea741771478d89053818285213d32e`, divergencia `+0 / -0`. O report foi atualizado em `src-tauri/target-test/validation/release-readiness.json`/`.md`.
- **Gates consumidos pelo readiness:** `check:tree`, `lint`, `tsc --noEmit`, `npm test` (**292**), `cargo clippy`, `cargo test --lib`, `build:debug`, `validate-upstream-windows.ps1 -SkipRustTests` (`success=true`) e desktop E2E simples. QA A-G consumido do report fresco `manual-qa-status.json` de `2026-05-11T23:49:43.761Z`.
- **Status honesto:** core MVP continua tecnicamente promovivel em `main`. SGDK permanece **Experimental**, Node Engine permanece **Experimental/Parcial**, nao ha AST C completo nem jogo completo por nodes validado; `BLAZE_ENGINE` continua blocker/stress corpus legitimo.

### CHECKPOINT operacional (2026-05-11 - rodada 36, branch `codex/product-hardening-runtime-setup`)

- **Escopo da rodada:** avancar hardening de produto e NodeGraph apos a promocao de PR #2, em branch nova baseada em `main`, sem promover superficies experimentais.
- **Runtime Setup/rede:** `dependency_manager.rs` agora centraliza requests oficiais em `send_request_with_retry` (3 tentativas, backoff curto, status transientes), usa cache local de metadata de GitHub Releases em `toolchains/.cache/github-releases/` e cai para esse cache quando a API falha. Mensagens de rate limit/erro remoto orientam configurar `RDS_GITHUB_TOKEN`/`GITHUB_TOKEN` ou tentar novamente depois, sem registrar valor de token. `.gitignore` passou a ignorar `toolchains/.cache/`.
- **NodeGraph:** `NodeGraphEditor.tsx` exporta `validateNodeGraph`, detectando referencias de node/porta quebradas, incompatibilidade entre portas `exec`/`data`, mismatch de `dataType`, ciclos `exec`, entrada ausente e nos soltos. O painel mostra contagem erro/aviso e preview das primeiras ocorrencias. Isto e base real de validacao, mas ainda nao fecha Phase D.
- **Cobertura focada:** `cargo test --manifest-path src-tauri\Cargo.toml dependency_manager -- --nocapture --test-threads=1` OK (**8** testes); `npx vitest run src/components/nodegraph/NodeGraphEditor.test.tsx` OK (**16** testes); `npx tsc --noEmit` OK.
- **Baseline completo:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**292** testes); `cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings` OK; `cargo test --manifest-path src-tauri\Cargo.toml --lib -- --nocapture --test-threads=1` OK (**329** passed / **10** ignored).
- **Fluxo real/toolchains/corpus:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` OK (`upstream-validation.json success=true`, `2026-05-11T20:47:15-03:00`); `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); `npm run test:e2e:desktop:qa-rc` OK A-G (`manual-qa-status.json` `2026-05-11T23:49:43.761Z`, evidencias `qa-rc-2026-05-11T23-49-20-465Z-*`); `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri\Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**), mantendo `BLAZE_ENGINE` como blocker/stress corpus legitimo.
- **Packaging:** `npm run build:debug`, `npm run build:portable` e `npm run build:msi` OK. Artefatos verificados: Debug EXE 36,087,808 bytes (`2026-05-11 20:53:36`), Portable EXE 20,592,640 bytes (`2026-05-11 21:01:20`) e MSI 7,331,840 bytes (`2026-05-11 21:01:05`).
- **Status honesto:** core MVP continua promovido tecnicamente em `main` pela rodada 35. Esta branch melhora robustez e validacao, mas **nao** torna SGDK Stable, **nao** torna Node Engine Stable e **nao** resolve AST C/round-trip completo para SGDK_Engines. A proxima promocao exige PR desta branch, CI remoto verde e readiness se/apos merge em `main`.

### CHECKPOINT operacional (2026-05-11 - rodada 35, main)

- **Escopo da rodada:** remover bloqueio de governanca do PR #2, promover a branch candidata para `main` e executar readiness no destino real de promocao.
- **GitHub/gh:** `gh` nao existia no host; `winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements` instalou GitHub CLI `2.92.0` em `C:\Program Files\GitHub CLI\gh.exe`. `gh auth status` confirmou ausencia de login local e nao havia `GH_TOKEN`/`GITHUB_TOKEN`; o conector GitHub da sessao estava autenticado como `Misael-art` e foi usado para as operacoes governadas.
- **PR/merge:** PR #2 (`https://github.com/Misael-art/RetroDevStudio/pull/2`) foi confirmado em `head_sha=3b2b33e15f688939f7cca038be00ab3c1b8ad0b5`, `draft=true`, `mergeable=true`; checks pull_request `CI` (`25698765825`) e `Desktop E2E` (`25698765818`) estavam verdes. O PR foi marcado como ready e mergeado por merge commit `35ab81ff63628ad50d4f5afff289f32013171c99`.
- **Main:** `git checkout main` + `git pull --ff-only origin main` deixou `main` em `35ab81ff63628ad50d4f5afff289f32013171c99`; `git merge-base --is-ancestor 3b2b33e15f688939f7cca038be00ab3c1b8ad0b5 HEAD` confirmou o SHA do PR dentro de `main`.
- **Readiness em main:** `npm run release:readiness:promotion` saiu com codigo 0 e `Pronto para promocao: SIM` em `src-tauri/target-test/validation/release-readiness.md`, commit `35ab81ff63628ad50d4f5afff289f32013171c99`, branch `main`, divergencia `+0 / -0`. Gates consumidos: `check:tree`, `lint`, `tsc --noEmit`, `npm test` (**291**), `cargo clippy`, `cargo test --lib` (**326** passed / **10** ignored), `build:debug`, `validate-upstream-windows`, `desktop-e2e` e QA A-G fresco `qa-rc-2026-05-11T21-20-39-556Z-*`.
- **Status honesto:** core MVP esta promovivel em `main` pela barra tecnica atual; nao houve promocao de SGDK para Stable, Node Engine para Stable, nem fechamento de Phase D/AST. `BLAZE_ENGINE` continua blocker/stress corpus legitimo; superficies ArtStudio/RetroFX/Reverse/Asset Extractor/Memory/VRAM seguem experimentais salvo prova dedicada.

### CHECKPOINT operacional (2026-05-11 - rodada 34, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** resolver falha de CI causada por rate limit da GitHub API durante instalacao automatica do SGDK no desktop smoke remoto, sem criar dependencia nova e sem relaxar teste.
- **Causa raiz:** `dependency_manager.rs` consultava GitHub Releases via `api.github.com` sem token; apos varias execucoes remotas no mesmo dia, o runner recebeu `403 rate limit exceeded` antes de baixar o asset SGDK.
- **Correcao:** helper `github_api_get` adiciona `Authorization: Bearer <token>` somente para URLs `https://api.github.com/`, lendo `RDS_GITHUB_TOKEN` primeiro e `GITHUB_TOKEN` como fallback. O workflow `desktop-e2e.yml` injeta `${{ github.token }}` como `RDS_GITHUB_TOKEN` no job.
- **Cobertura:** teste Rust `github_api_get_uses_ci_token_only_for_github_api` garante token no GitHub API e ausencia de token em API externa.
- **Gates locais:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**291**); `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK; `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` OK (**326** passed / **10** ignored).
- **Fluxo real/artefatos:** `validate-upstream-windows.ps1 -SkipRustTests` OK (`upstream-validation.json` `success=true`, `2026-05-11T18:14:21-03:00`); `preflight:sgdk-e2e` OK; `sgdk_matrix_corpus_ ... --ignored` OK (**7/7**); `test:e2e:desktop:qa-rc` OK A-G com evidencias `qa-rc-2026-05-11T21-20-39-556Z-*`; `build:debug`, `build:portable` e `build:msi` OK. Artefatos verificados: Debug EXE 36,062,208 bytes (`2026-05-11 18:23:36`), Portable EXE 20,574,208 bytes (`2026-05-11 18:34:08`) e MSI 7,323,648 bytes (`2026-05-11 18:33:52`).
- **Status honesto:** a correcao endurece CI/setup e nao promove produto. PR #2 ainda precisa de checks remotos verdes no SHA corrente, merge para `main` e `release:readiness:promotion` no destino. SGDK segue **Experimental**; Phase D segue heuristica.

### CHECKPOINT operacional (2026-05-11 - rodada 33, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** corrigir falhas reais do `Desktop E2E` remoto no PR, consolidar branch pushada, verificar CI remoto e registrar o bloqueio externo restante sem claim de promocao.
- **Git/governanca:** commit `7bf026b` (`fix(e2e): harden live stale and toolbar overflow`) pushado para `origin/feat/sgdk-vram-residency-streaming-r14`; PR #2 (`https://github.com/Misael-art/RetroDevStudio/pull/2`) permanece `draft/open`. `gh --version` falha porque `gh` nao esta instalado; a verificacao remota foi feita pela API publica do GitHub. Sem autorizacao/autenticacao para merge, a entrega fica como PR pronto para promocao, nao MVP fechado.
- **Correcoes de codigo:** `editorStore` marca validacao live como `stale` no momento da mudanca de cena ja validada; runner desktop aceita transicao rapida de revalidacao para `LIVE`; topbar/metrics deixam de interceptar clique no Build/Run em largura de runner remoto.
- **Baseline local:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**291** testes); `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK; `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` OK (**325** passed / **10** ignored).
- **Fluxo real/QA/corpus:** `validate-upstream-windows.ps1 -SkipRustTests` OK; `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); matriz desktop local 16/16 OK; `npm run test:e2e:desktop:qa-rc` OK, `manual-qa-status.json` `2026-05-11T18:15:08.061Z`, blocos A-G `passed`; `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**).
- **Packaging:** `npm run build:debug`, `npm run build:portable` e `npm run build:msi` OK. Artefatos canonicos existentes: `src-tauri/target-test/debug/retro-dev-studio.exe` (timestamp local `2026-05-11 15:50:56`), `src-tauri/target-test/release/retro-dev-studio.exe` (`2026-05-11 15:27:21`) e `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi` (`2026-05-11 15:27:05`).
- **CI remoto:** SHA `7bf026b` verde no GitHub Actions: `CI` push `25689348726`, `Desktop E2E` push `25689348725`, `CI` pull_request `25689350772`, `Desktop E2E` pull_request `25689350771`. O blocker anterior do PR (`25670163191`, `smoke_snes` + `live_stale_*`) foi resolvido.
- **Readiness estrito:** `npm run release:readiness:promotion` reexecutado em worktree limpo apos push; baseline, upstream, desktop smoke, QA consumido e artefatos passaram; resultado final `Pronto para promocao: NAO` apenas por governanca (branch muitos commits a frente de `origin/main`). Rerun em `main` ainda e obrigatorio apos merge.
- **Status honesto:** SGDK permanece **Experimental**; `support_status` inalterado; Phase D continua heuristica, sem AST C completo; nao criar tag/release antes de merge e readiness verde no destino.

### CHECKPOINT operacional (2026-05-11 - rodada 32, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** preparar/confirmar o host para execucao local completa, rerodar os gates de hardening e registrar o bloqueio real sem inflar escopo.
- **Git/governanca:** worktree versionavel limpo antes das atualizacoes documentais; branch rastreia `origin/feat/sgdk-vram-residency-streaming-r14`; o snapshot pre-commit documental era `origin/main...HEAD = 0/201`, e cada commit documental posterior aumenta a contagem sem alterar a natureza do bloqueio. `Rascunho.txt` existe na raiz, mas esta ignorado em `.git/info/exclude` e nao deve ser versionado sem curadoria.
- **Baseline local:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**290** testes); `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK; `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` OK (**325** passed / **10** ignored).
- **Readiness/QA:** `npm run release:readiness` inicial mostrou fotografia **NAO** por baseline/QA nao consumidos nesta rodada e governanca; `npm run release:readiness:baseline` executou baseline + auxiliares com gates tecnicos verdes; `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); `npm run test:e2e:desktop:qa-rc` OK com `manual-qa-status.json` `2026-05-11T11:54:18.251Z`, blocos A-G `passed` e evidencias `qa-rc-2026-05-11T11-53-47-951Z-*`.
- **Toolchains/corpus:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` OK (`upstream-validation.json success=true`); `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**). `BLAZE_ENGINE` continua blocker legitimo auditavel, sem assert de ROM.
- **Packaging:** `npm run build:portable` gerou `src-tauri/target-test/release/retro-dev-studio.exe`; `npm run build:msi` gerou `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`; `release:readiness:promotion` tambem regenerou o EXE debug canonico.
- **Readiness estrito:** `npm run release:readiness:promotion` rodou baseline, upstream e Desktop E2E simples, consumiu `manual-qa-status.json` fresco e saiu com codigo 1 por um unico bloqueio de governanca contra `origin/main` (201 commits a frente no snapshot pre-commit documental).
- **Status honesto:** nao declarar fechamento do MVP nesta revisao. A retomada exata e consolidar/mesclar a branch candidata ou manter o PR como trilha de governanca, rerodar `npm run release:readiness:promotion` no destino de promocao e sincronizar README/onboarding se o merge mudar a leitura publica. SGDK permanece **Experimental**; `support_status` inalterado; Phase D continua heuristica, sem AST C completo.

### CHECKPOINT operacional (2026-05-10 - rodada 31, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** preparar host Windows e fechar a barra tecnica local sem inflar escopo nem promover superficies experimentais.
- **Host/toolchain:** `scripts\setup-rust.ps1` instalou Rust MSVC `1.95.0`; Visual Studio Build Tools 2022/VC Tools foi instalado via `winget`; `scripts\run-cargo-msvc.cmd --version` passou; `rustup component add clippy` instalou `cargo-clippy`; `cargo install tauri-driver --locked` instalou `tauri-driver v2.0.6`; WiX 3.14 foi cacheado em `%LOCALAPPDATA%\tauri\WixTools314` com SHA-256 `6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31`.
- **Correcoes de codigo desta rodada:** Clippy novo exigiu `sort_by_key` em tres ordenacoes (`ast_generator.rs` e `project_mgr.rs`); foi aplicado o menor diff sem alterar comportamento.
- **Baseline verde:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**290** testes); `scripts\run-cargo-msvc.cmd clippy --manifest-path .\src-tauri\Cargo.toml -- -D warnings` OK; `scripts\run-cargo-msvc.cmd test --manifest-path .\src-tauri\Cargo.toml --lib -- --nocapture --test-threads=1` OK (**325** passed / **10** ignored).
- **Corpus/official toolchains/desktop:** `scripts\run-cargo-msvc.cmd test sgdk_matrix_corpus_ --manifest-path .\src-tauri\Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**7/7**; BLAZE segue blocker legitimo auditavel); `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` OK (`upstream-validation.json success=true`); `npm run preflight:sgdk-e2e` OK (`Ready: SIM`); `npm run test:e2e:desktop:qa-rc` OK com `manual-qa-status.json` `2026-05-10T19:51:16.583Z`, blocos A-G `passed` e evidencias `qa-rc-2026-05-10T19-50-53-457Z-*`.
- **Packaging:** `npm run build:portable` gerou `src-tauri/target-test/release/retro-dev-studio.exe`; `npm run build:msi` gerou `src-tauri/target-test/release/bundle/msi/RetroDev Studio_0.1.0_x64_en-US.msi`. Primeira tentativa de MSI falhou por ambiente (`tauri-bundler` timeout ao baixar `wix314-binaries.zip` do GitHub); a retomada foi cachear WiX 3.14 localmente e rerodar o comando canonico.
- **Readiness:** `npm run release:readiness:baseline` executou baseline + auxiliares com gates tecnicos verdes. A promocao publica continua bloqueada por governanca: branch sem upstream proprio e +200 commits vs `origin/main`, alem de worktree amplo ainda nao consolidado antes do commit/PR. `release:readiness` simples sem `--manual-qa-json` ainda mostra A-F pendente por nao consumir o report de QA; a trilha de promocao usa o JSON explicitamente.
- **Status honesto:** SGDK permanece **Experimental**; `support_status` inalterado; Phase D continua heuristica, sem AST C completo; ArtStudio/RetroFX/Reverse/Asset Extractor/Memory/VRAM continuam experimentais salvo prova dedicada futura. `Rascunho.txt` e rascunho operacional solto na raiz; nao versionar sem curadoria.

### CHECKPOINT operacional (2026-05-10 - rodada 30, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Escopo da rodada:** inspeccao real de estado, baseline local possivel, readiness e saneamento de falso positivo em scripts de QA; sem promocao de produto.
- **Git/governanca:** branch sem upstream proprio, `HEAD` em `7467046`, `origin/main...HEAD = 0/200`; worktree amplo e sujo com mudancas em docs, scripts, frontend, backend Rust e testes. `Rascunho.txt` existe na raiz como rascunho operacional nao canonico e nao deve ser versionado sem curadoria.
- **Baseline frontend:** `npm run check:tree` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` OK (**290** testes).
- **Bloqueio Rust/MSVC:** `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` nao executou porque `cargo` nao esta no PATH; `scripts\run-cargo-msvc.cmd clippy ...` e `scripts\run-cargo-msvc.cmd test ...` falharam por `vswhere.exe not found at "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"`. Retomada: instalar/provisionar Rust + Visual Studio Build Tools/Installer com VC tools, confirmar `vswhere.exe` e rerodar clippy/test pelos comandos canonicos.
- **Desktop QA:** `npm run preflight:sgdk-e2e` falhou com `tauri-driver: FALTA`; `toolchains/sgdk` OK e `toolchains/webdriver/msedgedriver.exe` OK. `scripts\diagnose-desktop-e2e.ps1` agora executa sem crash e confirma `tauri-driver` ausente. Retomada: provisionar `tauri-driver` via cargo em host com Rust e rerodar preflight + `npm run test:e2e:desktop:qa-rc`.
- **Upstream oficial:** `scripts\validate-upstream-windows.ps1 -SkipRustTests` foi corrigido para propagar exit code real do wrapper `.cmd` mesmo com stdout/stderr capturados. Report fresco: `success=false`, `blocking_status_codes=["toolchain_missing"]`, fase `upstream_smoke` falhou por ausencia de `vswhere`/MSVC. Isso substitui o falso positivo anterior desta mesma rodada.
- **Readiness:** `npm run release:readiness` gerou `Pronto para promocao: NAO`; bloqueadores: baseline institucional nao executada pelo agregador, worktree sujo, branch +200 vs `origin/main`, portable/release EXE ausente, MSI ausente e QA A-F pendente na fotografia atual.
- **Status honesto:** SGDK permanece **Experimental**; `support_status` inalterado; `qa-rc` de `2026-05-02` continua evidencia historica, mas nao e fotografia fresca de `2026-05-10`.

### CHECKPOINT operacional (2026-05-02 — rodada 29, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Baseline real antes da edicao:** o `qa-rc` A-G ja passava, mas a experiencia de criador ainda era dispersa: viewport informativo porem pesado em banners, tilemap com estado visivel mas acoes afastadas do alvo, selecao densa dependente de lista/spotlight sem solo persistente, e Logic/Art ainda pareciam continuacoes fracas do objeto selecionado.
- **Viewport / composicao:** `ViewportPanel` passou a montar um contexto de autoria (`creatorWorkflow`) com labels de mundo, janela MD 320x224, camera, regiao editavel, entidade selecionada, fontes e tilemap ativo. A mesa de composicao no stage ganhou foco de entidade, centralizacao e **Solo** para reduzir caos em cenas grandes.
- **Selecao densa:** o picker por Shift+clique agora tem acao `Selecionar + foco` e **Isolar alvo**, com solo visual persistente no canvas ate o usuario desligar. Alt+clique/teclado/filtros/spotlight da rodada anterior continuam.
- **Tilemap central:** a faixa de pintura no viewport mostra alvo/brush/tool e ganhou acoes `Focar alvo` e `Voltar select`, evitando que o usuario precise lembrar em qual painel a paleta/estado esta.
- **Objeto -> Logic -> fonte / Art:** Inspector e Logic ganharam pontes por `data-testid`/UI real para objeto -> Logic, Logic -> Scene, source paths multiplos/fallback honesto e objeto -> Art. Art mostra `artstudio-scene-context-bridge` para retornar a Cena sem reset mental.
- **Provas reais no app:** `qa-rc-2026-05-02T05-14-22-572Z-*` cobre composicao de cena, pilha densa com picker/solo, tilemap grande em paint, objeto -> Logic -> fonte, Art -> Scene com contexto e fluxo continuo salvar/reabrir/build/ROM `SEGA`.
- **Ainda heuristico / Experimental:** Fase D continua sem AST C completo; `entity_role`, `confidence`, `role_reason`, `driver_functions` e quick actions sao assistivos/heuristicos. `BLAZE_ENGINE` permanece blocker legitimo auditavel; SGDK **Experimental**; `support_status` inalterado.
- **Gates:** `check:tree` OK; `lint` OK; `tsc --noEmit` OK; `npm test` **288** passed; `cargo clippy -D warnings` OK; `cargo test --lib --test-threads=1` **325** passed / **10** ignored; `cargo test sgdk_matrix_corpus_ --ignored` **7** passed; `validate-upstream-windows -SkipRustTests` **exit 0**; `preflight:sgdk-e2e` **Ready: SIM**; `qa-rc` **A-G OK** (`qa-rc-2026-05-02T05-14-22-572Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 28, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Cena densa (B):** picker com filtros (`all/sprite/tilemap/camera/imported`) + `Spotlight` de isolamento visual no viewport durante preview.
- **UX (G):** contagem `filtradas/total` e estado vazio orientado por filtro, reduzindo tentativa-e-erro.
- **Ainda heuristico / Experimental:** inferencia de papel continua heuristica; spotlight/filtro melhoram usabilidade, nao elevam status de AST/importador; SGDK **Experimental**.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**277**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T09-26-03-255Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 27, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Cena densa (B):** picker `viewport-dense-stack-picker` com navegacao de teclado (`↑/↓/Enter/Esc`) e pre-selecao visual por hover/focus no viewport.
- **Art (F):** `ArtStudioPanel` reentra em `Scene` com contexto preservado; se a entidade for tilemap, ativa `paint` com brush canonico sem perder foco.
- **Prova:** regressao frontend `ArtStudioPanel.test.ts` cobrindo retorno contextual.
- **Ainda heuristico / Experimental:** Fase D continua sem AST completo; picker e quick actions sao assistivos (nao inferencia forte); SGDK **Experimental**.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**277**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T08-32-55-700Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 26, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Viewport / cena densa / tilemap (A/B/C):** **Shift+clique** com pilha >1 abre picker denso; **Alt+clique** mantem ciclo; faixa tilemap embute **`TilePalette`**; hints toolbar **Shift=lista · Alt=ciclo**; logs duplo-clique / Inspector alinhados a paleta no stage.
- **Logic (E):** `appendExecChainEdgesFromLayout` + botao **Encadear exec (layout)**; quick actions **projectile_motion**, **camera_rig**, **fighter_combat**, **support_state_tick**, **hud_vblank_tick**; empty state ordenado por `entity_role` (mapa fixo; heuristica).
- **Inspector (D):** botoes **Abrir fonte (n)** por caminho unico (`source_paths` ∪ `external_source_refs`).
- **Ainda heuristico / Experimental:** Fase D sem AST completo; encadeamento layout e quick actions sao **atalhos de autor** a revisar por jogo; SGDK **Experimental**; corpus **BLAZE** continua blocker auditavel.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**276**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T02-28-49-421Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 25, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Viewport / cena densa / tilemap (A/B/C):** `collectEntitiesUnderPoint` + **Alt+clique** cicla sobreposicoes sem iniciar arrasto; **duplo-clique** em tilemap ativa pintura (`buildTilemapAuthoringBrush`, `activeTilemapId`); duplo-clique em entidade com grafo abre Logic; faixa **Fluxo tilemap** (`viewport-tile-paint-flow-strip`) mostra alvo/brush/ferramenta; tooltip do overlay e do Navegador do Mundo alinhados a autoria.
- **Objeto -> logica -> fonte (D/E):** `NodeGraphEditor` — cartao inferencia + `openProjectSourcePath` para primeiro `source_paths` / `external_source_refs`; mensagens de erro explicitas se faltar editor/caminho.
- **Art (F):** `ArtStudioPanel` — `artstudio-no-sprite-context` + retorno a Cena.
- **Ainda heuristico / Experimental:** Fase D sem AST; inferencia importada; corpus **BLAZE** e cenarios com build bloqueado **improprios para autoria completa**; SGDK **Experimental**.
- **Gates:** `check:tree`, `lint`, `tsc`, `npm test` (**275**), `cargo clippy -D warnings`, `cargo test --lib` (**325**/10 ignored), `cargo test sgdk_matrix_corpus_ --ignored` (**7**), `validate-upstream-windows -SkipRustTests` (**0**), `preflight:sgdk-e2e`, `qa-rc` (**A-G**, `qa-rc-2026-04-30T01-16-50-322Z-*`).
- **Governanca:** sem commit/push.

### CHECKPOINT operacional (2026-04-30 — rodada 24, branch `feat/sgdk-vram-residency-streaming-r14`)

- **Viewport / autoria (BLOCO A):** `ViewportPanel.tsx` — cartao `viewport-world-authoring-strip` quando mundo largo ou colisao em px maior que 320x224: texto orientado a autoria, ate 3 avisos de `hwStatus.warnings` (colisao/mapa), botoes **Centro colisao**, **Modo colisao**, **Pan livre** (desliga clamp ao mundo), **Clamp on**; callback `focusCollisionMapCenter`.
- **Logic / heuristica importada (BLOCO E):** `project_mgr.rs` — papel lexical **`hud_actor`** (sinais `hud`, `score`, `health`, `lifebar`, `gauge`, `font`, `ui_`); ramo Phase D com no **`role_hud_scroll_tick`** (`scroll_tilemap`, label explicitando HUD/heuristica); prioridade de papel e faixa Y em `sprite_role_priority` / `sgdk_role_lane_base_y` atualizadas. `importedEntityContext.ts` + `HierarchyPanel.tsx` — rotulo **HUD / UI** e chip **HUD** alinhados ao resto do shell.
- **Limites honestos:** Fase D continua sem AST C completo; posicoes donor/staging/inferida e grafos seguem **heuristicos** onde nao ha prova estrutural; cenarios de corpus com build bloqueado (ex. linha BLAZE) permanecem **improprios para autoria completa** ate resolver blockers de hardware/doador.
- **Gates desta rodada (host):** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (**275** passed), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` (**325** passed / **10** ignored, mesma continuacao de sprint), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (**7** passed), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` (**exit 0**, ~171s, `processSweep.strategy=cim`), `npm run preflight:sgdk-e2e` (**Ready: SIM**), `npm run test:e2e:desktop:qa-rc` (**OK** `qa-rc-2026-04-30T00-28-55-771Z-*`, A-G).
- **Governanca:** SGDK **Experimental**; `support_status` inalterado; **sem commit/push**.

### CHECKPOINT operacional (2026-04-21 — commit consolidado)

**Git:** mensagem `fix(md): validar CollisionMap world-sized; endurecer teste matriz SGDK P2` na branch `feat/desktop-e2e-workflow` (`git log -1 --oneline`).

- **Rust / hardware:** `md_profile.rs` e `snes_profile.rs` — `CollisionMap` world-sized (scroll/plataforma) deixa de ser **fatal** por exceder viewport; mantem validacao conservadora (tile multiplo de 8, limites de grid e de bytes em `data`, integridade `len` vs `width*height`, overflow com `checked_mul`); aviso quando o mundo em pixels excede a area visivel. Testes de regressao: `collision_map_wider_than_viewport_is_non_fatal_with_warning` (MD e SNES).
- **Corpus matriz Platformer 2:** teste renomeado `sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker`; com `--ignored`, doador ausente **panic** salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`; assert final exige ROM com marca `SEGA`; leitura da ROM no ramo fake usa `project.join(rom_path)`.
- **Documentacao:** `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (linha 1, comando e evidencia); `docs/06_CURRENT_WAVE_AI_BANK.md` (rodada 11+). Comentario UGDM em `CollisionMap` (`entities.rs`) alinhado a mapas maiores que viewport.
- **Gates verificados nesta entrega:** `npm run check:tree`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`, e `cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker ... --ignored` no host com corpus (ex.: `mode=sgdk_detect rom_sega=true`).
- **Governanca:** SGDK permanece **Experimental**; `support_status` nao promovido; matriz linha 1 **Parcial** (programa dos seis titulos incompleto).

### CHECKPOINT operacional (2026-04-22 — rodada 12)

- **Build/constraints:** `build_orch.rs` passa `project.template_metadata.source_kind` para `validate_scene_with_source_kind` (MD/SNES).
- **Regressao:** `sgdk_managed_vram_overflow_warns_but_native_still_aborts`.
- **Corpus matriz:** helper com `stamp_imported_sgdk_metadata` + assert `source_kind=imported_sgdk`.

### CHECKPOINT operacional (2026-04-23 — rodada 13)

- **Resolver SGDK:** `resolve_sgdk_import_root` + integracao em `import_sgdk_project`; testes `sgdk_resolver_*`; ambiguidade multi-candidato falha com mensagem e lista de roots.
- **Matriz corpus:** `cargo test sgdk_matrix_corpus_ ... --ignored --test-threads=1` => **6/6** no host; linha 2 `MATRIX_PE` com `resolution_kind=mddev_reference_redirect`.
- **Gates locais desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `npm run preflight:sgdk-e2e`, `npm run test:e2e:desktop:qa-rc`.

### CHECKPOINT operacional (2026-04-23 — rodada 14)

- **MD hardware model:** `md_profile.rs` deixou de usar apenas `vram_used` agregado para SGDK importado; agora separa `asset_total`, `resident`, `streamable` e `dma/frame` com `analysis_mode=sgdk_managed`.
- **Build audit:** `build_orch.rs` emite linha `MD VRAM analysis: ...` antes da validação fatal/warn, permitindo QA entender por que passou com warning vs bloqueou.
- **Corpus real:** `sgdk_matrix_corpus_` ampliado para incluir `BLAZE_ENGINE`; suite no host: 7/7 testes passando (6 com ROM `SEGA` + 1 bloqueador esperado auditavel).
- **Gates da rodada:** `check:tree`, `lint`, `tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `cargo test sgdk_matrix_corpus_ --ignored`, `validate-upstream-windows -SkipRustTests`, `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc`.

### CHECKPOINT operacional (2026-04-24 — rodada 15)

- **MD `HwStatus` + `md_profile`:** composicao de residencia por categoria + contadores `banks`/`cells` da heuristica `sgdk_managed`; `vram_used`/`dma_used` mantem a semantica agregada da rodada 14.
- **Build / matriz:** `MD VRAM analysis` e `MATRIX_* hw` incluem `spr_res`, `tile`, `hud`, `strm_spr`, `anim_sw`, `banks`, `cells`; regressao `sgdk_managed_vram_overflow_warns_but_native_still_aborts` asserta `spr_res=` no log; corpus BLAZE asserta `banks=` no log de build.
- **SGDK:** continua **Experimental**; sem promocao de `support_status`.

### CHECKPOINT operacional (2026-04-25 — rodada 16)

- **Frontend:** `src/core/assetInstantiation.ts` + testes; `AssetPreview.tsx` (estados de carregamento); `InspectorPanel.tsx` (texto de diagnostico do preview); `ToolsPanel.tsx` (regra de instanciação).
- **Gates nesta entrega parcial:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, vitest focado (`assetInstantiation`, `InspectorPanel`). Suite completa / Rust / E2E nao rerodada nesta continuacao.
- **SGDK:** continua **Experimental**; sem promocao de `support_status`; sem commit automatico.

### CHECKPOINT operacional (2026-04-25 — rodada 17)

- **E2E `qa-rc`:** bloco G alargado (cena `entry_scene`, `projectSourceKind`, onboarding, `instantiateBrowserImageAsset`, reopen `entityCount`, Inspector fallback testid).
- **Viewport:** contador `tm-fallback` + onboarding condicionado a cena vazia.
- **Gates:** `npm test` 246/246; `cargo clippy -D warnings`; `cargo test --lib`; `sgdk_matrix_corpus_` ignorados 7/7; `preflight:sgdk-e2e`; `test:e2e:desktop:qa-rc` OK.
- **Limite:** `validate-upstream-windows.ps1` falhou (WMI/CIM); nao equivaler a gate verde até corrigir host ou script.
- **SGDK:** Experimental; sem commit/push.

### CHECKPOINT operacional (2026-04-25 — rodada 18)

- **Gate oficial Windows:** `scripts/validate-upstream-windows.ps1` agora isola o sweep de processos num caminho resiliente (`Get-CimInstance Win32_Process` com fallback para `Get-Process`), materializa `ExitCode` do `cargo` antes de decidir o resultado, e escreve `processSweep`, timeouts e estado do self-test em `upstream-validation.json`.
- **Cobertura do fallback:** `src/core/validateUpstreamWindows.test.ts` força falha CIM via `RDS_VALIDATE_FORCE_CIM_FAILURE=1` + `-SelfTestProcessSweep` e asserta `processSweep.strategy === "get-process"` sem esconder o fallback no report.
- **Asset visual state canonico:** `src/core/assetVisualState.ts`, `src/core/useProjectAssetVisualState.ts` e `src/components/common/AssetPreview.tsx` centralizam `idle/loading/loaded/missing/failed/legacy_fallback`; `InspectorPanel.tsx` e `ViewportPanel.tsx` passam a falar a mesma lingua para preview real, erro, ausente e tilemap legado sem `cells[]`.
- **Produto/CX SGDK importado:** `App.tsx` abre a `entry_scene` e seleciona a primeira entidade visual relevante; Inspector mostra preview/caminho/estado visual/fallback explicito; `scripts/e2e-tauri-build-run.mjs` bloco G foi atualizado para procurar os sinais novos do Inspector (`Estado visual` / preview/fallback testids).
- **Gates desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`, `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1`, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests`, `npm run preflight:sgdk-e2e` e `npm run test:e2e:desktop:qa-rc`.
- **Governanca:** SGDK continua **Experimental**; sem mudanca de `support_status`; sem commit/push nesta sessao.

### CHECKPOINT operacional (2026-04-26 — rodada 20)

- **Produto/CX da IDE:** `importedEntityContext.ts` passou a derivar papel, classe, confianca e detalhe auditavel da entidade importada; `HierarchyPanel.tsx` mostra chips de papel importado e usa o mesmo foco de cena do `App.tsx`; `InspectorPanel.tsx` ganhou cartao de contexto importado com resumo, funcoes-chave e caminhos-fonte; `ViewportPanel.tsx` e `SceneAssetHealthBadge.tsx` passaram a exibir o mesmo vocabulario de saude visual; `AssetBrowserSelectionCard.tsx` passou a mostrar referencias de cena, papel importado e item-guia.
- **Arquitetura/frontend:** o shell agora compartilha contratos pequenos e reusaveis para foco de cena, estado visual, saude de assets e browser de assets, em vez de replicar `ifs` em `App.tsx`, `ToolsPanel.tsx`, `InspectorPanel.tsx` e `ViewportPanel.tsx`. `sceneWorkspaceContext.ts` passou a preferir entidade foco por score semantico, e `assetBrowserModel.ts` ordena referencias por foco/papel em vez de ordem acidental.
- **Fase D importada:** `src-tauri/src/ugdm/components.rs` ganhou `ImportedLogicSemantics`; `project_mgr.rs` passou a calcular `entity_semantic_profile`, persistir `imported_semantics`, promover `external_source_refs`/`logic_hints` com `driver_functions` e `source_paths`, reconhecer `beat_em_up_close_range_signals`, evitar colapsar tudo no sprite primario e materializar `graph_ref`/movimento/rotulos conforme papel (`player_avatar`, `enemy_actor`, `projectile_actor`, `fighter_actor`, etc.). Ledger e testes de corpus agora carregam o motivo do papel e as fontes reais por entidade.
- **Provas/gates desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (`27` ficheiros / `272` testes), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` (`320 passed / 0 failed / 10 ignored`), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (`7 passed / 0 failed / 0 ignored`), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\\\validate-upstream-windows.ps1 -SkipRustTests` (`success=true`, `processSweep.strategy=get-process`, `usedCanonicalRetry=false`), `npm run preflight:sgdk-e2e` (`Ready: SIM`) e `npm run test:e2e:desktop:qa-rc` (`code=0`, `manual-qa-status.json` em `2026-04-26T05:19:54.185Z`, blocos A-G `passed`) verdes.
- **Governanca:** SGDK continua **Experimental**; `support_status` permanece inalterado; a limitacao honesta continua sendo a Fase D sem parser/AST completo, apesar do ganho material de semantica e rastreabilidade.

### CHECKPOINT operacional (2026-04-25 — rodada 19)

- **Produto/CX da IDE:** `sceneWorkspaceContext.ts` passou a dar o mesmo contexto importado/overlay/nativo para `App.tsx`, `HierarchyPanel.tsx`, `InspectorPanel.tsx` e `ToolsPanel.tsx`; a IDE agora destaca cena ativa, entidade guia, fallback legado e proximo passo de forma consistente, em vez de espalhar sinais tecnicos por painel.
- **Desacoplamento real:** `sceneAssetHealth.ts`, `assetBrowserModel.ts`, `useAssetBrowserState.ts`, `SceneWorkspaceNotice.tsx`, `AssetBrowserSelectionCard.tsx` e `SceneAssetHealthBadge.tsx` extraem responsabilidades que estavam crescendo dentro de `ViewportPanel.tsx` e `ToolsPanel.tsx`. O Asset Browser ganhou decisao de instancia visivel (sprite vs tilemap) com `reason` auditavel e texto de acao.
- **Gate oficial Windows endurecido alem do fallback CIM:** `scripts/validate-upstream-windows.ps1` deixou de depender apenas de `%OS%`; a deteccao de Windows passou a usar `OS`, `$IsWindows` e `System.Environment.OSVersion`. No backend Rust, `build_orch.rs` injeta `OS=Windows_NT` antes de chamar o make SGDK em Windows, evitando que `common.mk` caia no ramo Linux e procure `m68k-elf-gcc`.
- **Cobertura nova:** `src/core/validateUpstreamWindows.test.ts` agora cobre tambem o caso sem `%OS%`; `src-tauri/src/compiler/build_orch.rs` ganhou o teste `megadrive_build_forces_windows_os_env_for_sgdk_make`.
- **Gates desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test` (`267` testes), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` (`319` passed / `0` failed / `10` ignored), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (`7` passed / `0` failed), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests`, `npm run preflight:sgdk-e2e` e `npm run test:e2e:desktop:qa-rc` verdes. `upstream-validation.json` desta rodada ficou com `success=true`; `manual-qa-status.json` de `2026-04-25T18:43:11.668Z` voltou com blocos A-G `passed`.

### CHECKPOINT operacional (2026-09-08 — rodada HOST-WIN-01/A-01/B-01/C-01 integrada)

- **Integração em `main`:** PR #51 (`ed80c82`) → `8f9c9f8`; PR #49 (`a05f9b4`) → `fbfbf92`; PR #50 (`724342b`) → `5310a0a`; PR #48 (C-01, `883556a`) já contida e não reaplicada. Os quatro SHAs confirmados por `git merge-base --is-ancestor`, não pelo status das PRs. Merges autorizados explicitamente pelo operador, um a um, com o SHA reconfirmado imediatamente antes de cada merge.
- **Achado que domina a rodada:** o Desktop E2E é **intermitente**. O commit `8f9c9f8` falhou (run `34244326095`) e passou 16/16 no re-run **sem alteração de código**. A instabilidade é anterior à rodada (`bd45299` também falhava) e não foi introduzida pela #51. Gatilho provável: concorrência no provisionamento de toolchain no runner Windows.
- **Consequência para governança:** enquanto o mesmo commit puder dar verde ou vermelho, "gates verdes em `main`" **não** é evidência confiável de certificação. Qualquer conclusão futura baseada num único run verde deve ser tratada como não estabelecida.
- **Correção de diagnóstico registrada:** `SGDK real: FALTA / Ready: NAO` no preflight do passo MD ocorre **também nos runs que passam** (o SGDK é provisionado dentro do passo). Não é discriminante de falha, e a causa de B-01 atribuída a ele **não** está provada. B-01 não tem defeito de produto demonstrado — o que não equivale a defeito descartado.
- **Cobertura não fechada:** o verde de A-01 (`724342b`) foi obtido contra `8f9c9f8`, antes de `main` avançar para `fbfbf92`; a combinação A-01 + B-01 só é exercida em `5310a0a`, que fechou `Desktop E2E` e `CI` verdes na **primeira tentativa** (run `34252075629`), 16/16, ledger de 16 marcadores, sem `failure`/`skipped`. Ambas tocam `build_orch.rs`; o verde de primeira tentativa evidencia ausência de conflito semântico entre as fatias, mas não remove a intermitência da suíte.
- **GOV-01:** inalterada e isolada. `.mimosa`/`.zcode` preservados na raiz fiscalizada (pertencem a outra sessão); `check:tree` falha ali e passa em worktree limpo. Nenhuma exceção adicionada à árvore, nada movido ou apagado.
- **Limite de host:** `host:certify` completo e validação oficial Windows não são executáveis a partir do host Linux desta sessão; evidência Windows só via CI remoto. `host:diagnose` local `READY`, lock `d531c4b…`, medido antes do merge da #51 (que altera o lock).
- **Governança:** SGDK continua **Experimental**; nenhuma superfície promovida a Stable; gameplay completo, acessibilidade com leitor de tela real e release seguem **não medidos**.

### CHECKPOINT operacional (2026-09-09 — linha 8 da matriz SGDK: TaiketsuUltraHeroGenesis importado, ROM e grafo semântico provados)

- **Pergunta que abriu a rodada:** "já conseguimos importar `TaiketsuUltraHeroGenesis/src` e disponibilizar a estrutura lógica em nodes?" — a capacidade existia (importador SGDK + NodeGraph, Experimental); o jogo específico **nunca tinha passado pelo pipeline** (zero referências no repo/corpus).
- **Resposta com evidência real (host Linux, SGDK 2.11 oficial, Genesis Plus GX oficial, `fake_toolchain_used=false`):** a linha 8 `sgdk_matrix_corpus_taiketsu_ultra_hero_genesis_partial_flow_documents_build_blocker --ignored` fechou **Passou**: import direto da raiz efetiva `TaiketsuUltraHeroGenesis/src` (`resolution_kind=direct`, `source_kind=imported_sgdk`, 5 cenas, 0 warnings, tilemap/animação/colisão/`graph_ref` presentes), build com ROM `SEGA` (`mode=sgdk_managed`, `resident_kb=32`, `banks=2/8`, `fatal=0`) e emulação visível (90 frames, `320x224`, `non_black_pixels=15856`).
- **Estrutura lógica em nodes — número real:** o extrator semântico entrega grafo de **362 nodes / 344 edges** (`fsm_state=12`, `fsm_transition=5`, `sprite_move=88`, `spawn_entity=99`, `set_position=42`, `sprite_anim=17`, `vdp_validator=26`, `palette_hblank=14`, `destroy_entity=28`, `timer=12`, `scroll_tilemap=6`, `input_held=2`, `event_update=1`, `bridge_unconverted_source=10`) com cobertura `FSMs=2 / states=12 / transitions=5 / actions=245 / bridges=10 / blocking_gaps=5`; reports persistidos em `src-tauri/target-test/validation/sgdk-taiketsu-real/` (incl. `sgdk-nodegraph-report.json`).
- **Limites honestos registrados na linha 8 da matriz:** (1) a materialização por entidade no projeto importado ficou `converted_nodes=0`/`bridge_nodes=0` — o grafo de 362 nodes vive na camada semântica exportável (IR/reports), **não** como FSM nativa editável por entidade no editor (Fase D segue heurística, sem AST completo); (2) passos `sprite_anim` do grafo importado foram ignorados por nomes de animação não casados (`animacao 'idle' nao encontrada`) nos sprites por estado do doador — residual concreto para futura rodada de endurecimento da Fase D em jogos de luta.
- **Mudanças de código (só infra de teste, zero produto):** helper `sgdk_matrix_corpus_donor_path` aceita `RDS_SGDK_MATRIX_CORPUS_ROOT` (mesmo contrato do `RDS_SGDK_CORPUS_ROOT`); runner compartilhado da matriz agora retorna a ROM copiada em tmp (`Option<PathBuf>`) e imprime `MATRIX_* logic:` com contagens converted/bridge; vertical semântico ganhou label `TaiketsuUltraHeroGenesis`; matriz documental ganhou linha 8 + nota 2026-09-08 em `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`.
- **Gates desta rodada (todos medidos no host):** `cargo clippy -D warnings` OK; `cargo test --lib` **487 passed / 0 failed / 32 ignored**; `sgdk_matrix_corpus_ --ignored` **8/8** (7 títulos ausentes pulados via `RDS_SGDK_MATRIX_CORPUS_SKIP=1`, linha 8 rodada real e determinística em 3 execuções); `cargo fmt --check` OK; `npm run lint` OK; `npx tsc --noEmit` OK; `npm test` **601 passed / 6 skipped** (63 arquivos); `check:tree` OK em worktree limpo e no checkout canônico falha **apenas** pelos diretórios GOV-01 (`.mimosa`/`.zcode`, de outra sessão — preservados, nada novo introduzido); `host:diagnose` `READY` (lock `dd99a22f…`); `host:certify` ficou **BLOCKED exclusivamente por `gate_failed:check:tree` da GOV-01** — bloqueio ambiental pré-registrado, sem relação com esta mudança. Backup íntegro do doador em `/tmp/rds-taiketsu-backup/` (original não modificado).

### CHECKPOINT operacional (2026-09-09b — validação desktop da linha 8 no app real + fix de comentários `//` em `.res`)

- **App real validado com o import do Taiketsu:** o app debug (`build:debug`) foi lançado via `tauri-driver`/WebKitWebDriver e o import executado pela API canônica do shell (`window.__RDS_E2E__.importSgdkProject`, o mesmo caminho do wizard). Resultado: **0 erros de console**; cena com 65 entidades renderizada (sprites, hitboxes, hierarquia "CONFORMIDADE MIGRADA", inspector, thumbnails); workspace de lógica com o grafo da entidade editável em lanes, source mapping `src/main.c` e painéis honestos (heurística, gaps, hardware feedback "Sprites/frame 63/80"); Resumo SGDK Logic com 189 nodes heurísticos gerados e badge "EQUIVALÊNCIA GAMEPLAY NÃO CERTIFICADA". Projeto importado pelo usuário fica em `~/Documents/RetroDevProjects/TaiketsuUltraHeroGenesis`. 63 warnings benignos de fetch de asset com fallback `Image()` (assets renderizam; ruído de console a melhorar depois).
- **Bug de produto encontrado e corrigido (regressão real, não específica do doador):** comentários `//` em manifests `.res` (estilo HAMOOPIG, ex.: `//305 = 304` no `sprite.res` do Taiketsu) eram parseados como recursos falsos (`kind='//305'`, name `'='`) e apareciam na UI como **5 "gaps bloqueantes" falsos** com texto truncado. Correção nos **dois** parsers: `parse_sgdk_manifest` (`project_mgr.rs`) e `parse_resource_manifest` (`sgdk_corpus_inventory.rs`) agora ignoram linhas `//` e `;` (comentário oficial do rescomp), cada um com teste de regressão dedicado.
- **Números pós-fix (linha 8 rerodada):** import/build/ROM/emulação idênticos (ROM `SEGA`, 90 frames, `non_black_pixels=15856`); grafo semântico sem as bridges falsas: **362→357 nodes**, bridges **10→5** (`bridge_unconverted_source=5`), gap kind `unsupported_resource_kind` **eliminado**; os 5 `blocking_gaps` restantes são os limites reais da Fase D (`assembly_source`, `complex_state_expression`, `preprocessor_condition`). `converted_nodes=0`/`bridge_nodes=0` por entidade **permanece** (limite heurístico honesto, candidato a futura rodada de endurecimento da Fase D para padrões de jogos de luta).
- **Gates pós-fix:** `fmt` OK; `clippy -D warnings` OK; `cargo test --lib` **489 passed / 0 failed / 32 ignored** (+2 testes de regressão); `lint`/`tsc` OK; `npm test` **601 passed / 6 skipped** (1 falha transitória de worker Vitest no primeiro run — intermitência conhecida de I/O do `/mnt/sdcard`, verde de primeira na rerodada); vertical semântico e linha 8 rerodados verdes. Commit de follow-up no PR #58.

### CHECKPOINT operacional (2026-09-09c — cobertura de lógica do corpus local SGDKForge: 13/13 extraídos, 10 com fluxo completo)

- **Pergunta:** "conseguimos cobrir a lógica de todos os jogos funcionais em `/mnt/sdcard/SGDKForge/`?" — corpus novo do operador, distinto da raiz de referência da matriz. Mapeamento: `SGDK_projects/` com 14 diretórios (12 com fontes + ROM compilada própria; 4 variantes stub vazias de KIRBY/TAIKETSU sem nenhum `.c`), `SGDK_Engines/` com engines (HAMOOPIG-SGDK, Blast-Engine, UltraDrive, PlatformerEngine, MegaDriving, MDSDRV, Awesome_MegaDrive, SGDK-examples) e o TaiketsuUltraHeroGenesis (já coberto pela linha 8). Nenhum outro jogo funcional com ROM própria fora de `SGDK_projects/`.
- **Método (sem tocar no corpus do operador):** staging `/tmp/sgdkforge-corpus` com symlinks dos 12 jogos funcionais + `TaiketsuUltraHeroGenesis/src` (referência); inventário semântico via `sgdk_corpus_inventory_real_corpus_report --ignored` e prova funcional via `sgdk_corpus_real_build_rom_emulation_report --ignored` (import → build SGDK 2.11 real → ROM `SEGA` → emulação visível Genesis Plus GX), ambos com `RDS_SGDK_CORPUS_ROOT` apontando ao staging. Artefatos: `target-test/validation/sgdk-corpus-inventory.json` e `target-test/validation/sgdk-corpus-real-build/sgdk-corpus-real-build-report.{json,md}`.
- **Resultado — cobertura de lógica: 13/13 jogos têm a lógica extraída** (node candidates por jogo: 247–902; total ≈ 5,6 mil; gaps agregados: `preprocessor_condition=247`, `function_like_macro=23`, `assembly_source=16`, `multiline_macro=9`). **Prova funcional: 10/13 com fluxo completo IBRE** (import + build real + ROM `SEGA` + emulação visível): BLUE_CIRCUIT, Celestial Chase Revive, Celestial Chase visual benchmark, GOTHAM_OVERDRIVE, KIRBY CLOUDE, KIRBY GROK BUILD, MARE_BRAVA, SMOKE_TEST, TAIKETSU ULTRA REBIRTH e TaiketsuUltraHeroGenesis. **3/13 bridge_only** (lógica extraída como bridges/candidates, sem projeto nativo buildável nesta rodada): FORGE_REFERENCE (190 candidates), _agent_laboratory (308), _agent_training (428) — o runner registra a categoria honestamente, no mesmo padrão dos 54 bridge-only do corpus de referência. `failed=0`, `fake_toolchain_used=false` em todas as entradas.
- **Segunda regressão de robustez real corrigida (commit no PR #58):** `.mddev/project.json` gravado com **BOM UTF-8** por ferramentas Windows (BLUE_CIRCUIT, Celestial Chase benchmark) derrubava o import inteiro ("expected value at line 1 column 1"). Fix: `load_mddev_project_meta` faz strip de `\u{feff}` antes do `serde_json` + teste de regressão. Pós-fix, os 2 projetos passaram a importar e fecharam IBRE.
- **Gates Rust:** `fmt` OK; `clippy -D warnings` OK; `cargo test --lib` verde (+1 teste de regressão BOM → 490 testes). Frontend não alterado nesta fatia.
- **Follow-ups candidatos (fora do escopo desta rodada):** (1) converter os 3 bridge_only em projetos buildáveis (provável necessidade de anchors de cena/tilemap no importador); (2) cobrir engines/exemplos se o operador quiser engine-code no escopo; (3) silenciar/compactar os warnings benignos de fallback de assets no viewport.

### CHECKPOINT operacional (2026-09-09d — próximos passos executados: corpus re-estagado por projeto real + warnings de fallback agregados)

- **Diagnóstico dos 3 bridge_only da rodada anterior:** `_agent_training` e `_agent_laboratory` são **diretórios-wrapper** contendo projetos aninhados (HYBRIDO_MUAY_THAI — completo; LIVE_BAR_FR2 e SCENE_TILEMAP_CURATION_FIXTURE — completos; TAINA_RESAMPLING_ROUTE_LAB — stub vazio, confirmado com retry por causa dos soluços de I/O do cartão SD). `FORGE_REFERENCE` é **doador code-only**: o `resources.res` só tem comentário ("usa fonte built-in do SGDK"), então o importador não materializa cena/assets e o runner registra bridge-only honesto (190 candidates extraídos).
- **Corpus re-estagado por projeto real (14 doadores, mesmo método de symlinks):** resultado final `failed=0`, **13/14 com fluxo completo IBRE** — entraram como IBRE: HYBRIDO_MUAY_THAI (luta, `non_black_pixels=15954`), LIVE_BAR_FR2 (71680), SCENE_TILEMAP_CURATION_FIXTURE (6844). Único residual: FORGE_REFERENCE (code-only, 190 candidates) — converter doadores code-only em projeto nativo buildável é feature do importador (Fase D), registrada como follow-up, não hackeada nesta rodada. Inventário semântico rerodado: gaps agregados `preprocessor_condition=230`, `function_like_macro=21`, `assembly_source=15`, `multiline_macro=9`.
- **Warnings de fallback de assets agregados (UX):** o viewport emite **um único** aviso de fallback `Image()` por sessão de carregamento (`assetFallbackWarnedRef`) em vez de uma linha por asset (63 no Taiketsu importado). O fallback em si é benigno e continua ativo. `lint`/`tsc` OK; suíte frontend medida nesta rodada.
- **Lição de host registrada:** `find` sobre o cartão SD pode retornar resultado vazio por soluço de I/O — reconfirmar com retry (aconteceu duas vezes nesta rodada com o mesmo comando: 0 resultados → cheio no retry).

### CHECKPOINT operacional (2026-09-09e — doadores code-only buildáveis via Fase D + cobertura das engines do SGDK_Engines)

- **Import code-only implementado no caminho canônico:** `import_sgdk_project` agora detecta doador code-only (manifests `.res` presentes + fontes C + nenhum recurso importável — caso FORGE_REFERENCE, que usa só a fonte built-in do SGDK) e, em vez de rejeitar, cria projeto nativo com cena `code-only`: entidade `code_only_logic` com `graph_ref` → `graphs/sgdk_import_code_only.json` contendo grafo ponte honesto (`event_update` → `bridge_unconverted_source` não bloqueante, `source_file` rastreável ao `main.c` do doador), `imported_semantics` com `audit_flags=["code_only_donor"]`, ledger `sgdk-import/v4` e warning auditável. Teste de regressão dedicado (`import_sgdk_project_supports_code_only_donor_with_bridge_scene`). O emitter já tratava `bridge_unconverted_source` não bloqueante como `NoOp`, então o C gerado compila.
- **Prova real:** corpus SGDKForge rerodado — **14/14 IBRE, `bridge_only=0`, `failed=0`**. FORGE_REFERENCE fechou fluxo completo (ROM `SEGA`, emulação visível com 795 px não-pretos — coerente com jogo de texto/fonte built-in). Relatório: `target-test/validation/sgdk-corpus-real-build/sgdk-corpus-real-build-report.json`.
- **Cobertura das engines (`SGDK_Engines/`, 8 projetos estagiados):** inventário semântico **8/8 com lógica extraída** — SGDK-examples 2.744 candidates, SGDK_MegaDriving 634, HAMOOPIG-SGDK 351, Blast-Engine 233, UltraDrive 53, PlatformerEngine 39, MDSDRV 41, Awesome_MegaDrive 0 (tooling/docs). No build/emu, as 8 importam e são classificadas **bridge-only** — correto: são bibliotecas/suites de exemplo, não jogos standalone; o gate `emulation_visible_ok > 0` do runner (correto para jogos) panica nesse corpus e **não foi afrouxado** — o relatório JSON da varredura fica como evidência. Conversão de exemplos de engines em projetos buildáveis exigiria estagiamento por exemplo + adequação por convenção de cada engine (follow-up registrado, não feito).
- **Gates:** `fmt`/`clippy -D warnings` OK; `cargo test --lib` verde (+1 teste → 491); frontend não alterado nesta fatia. SGDK segue **Experimental**; nenhuma promoção de `support_status` — o import code-only materializa pontes honestas, não AST/FSM.




### CHECKPOINT operacional (2026-09-09 — GO formal da Fase 6: decompilação pareada, Fase 0 Sprint 1 + Etapa A provadas; branch `codex/decomp-pareada-fase0-sprint1`)

> Nota de integração: esta frente é **separada** do PR #58 (import/nodes); checkpoints 09-09b..e vivem naquela branch e devem ser reconciliados no merge pelo integrador.

- **GO formal do operador (2026-09-09):** "trabalhar na decompilação de ROMs e desenvolver esta capacidade testando com `TaiketsuUltraHeroGenesis/src/out/rom.bin`", escopo confirmado por pergunta: **Sprint 1 da Fase 0 + Etapa A, sem LLM** (Etapa B permanece bloqueada até as métricas da A registradas; UI/LLM exigem GO específico com BYOK+orçamento+kill-switch).
- **Núcleo estático implementado e testado** em `src-tauri/src/tools/reverse/decomp/` (árvore autorizada; `#![allow(dead_code)]` documentado — consumidores de produção chegam nas fases seguintes): `triage.rs` (header SEGA/tier), `symbols.rs` (nm/`nm -S`), `rom_library.rs` (pares BYOR + `DecompLedger` `decomp-ledger/v1` em `RDS_DECOMP_WORK`), `ghidra_bridge.rs` (analyzeHeadless; programa **literal** + PATH do filho injetado com diretório validado — padrão exigido pelo scanner Mimosa após bloquear execução com caminho dinâmico), `fingerprint.rs` (SHA-256 por função), `object_diff.rs` (objdump `-dr` normalizado por símbolo), `decomp_orch.rs` (orquestrador). 19 testes unitários novos; `sha2 = "0.10"` promovida a dependência direta (já transitiva no lock).
- **Etapa A executada em 3 pares Tier 0** (relatório `target-test/validation/decomp/etapa-a-report.json`; ledger em `RDS_DECOMP_WORK`): `SMOKE_TEST` (864 funções) e `BLUE_CIRCUIT` (766 funções; boundary Ghidra **precision 0,946 / recall 0,369**) fecharam **self-compare determinístico** — ROM do rebuild duplo idêntica byte-a-byte e objetos 2/2 exatos; `TaiketsuUltraHeroGenesis` medido contra o ground truth real (1.536 funções de texto do `symbol.txt`, 1.295 hashes únicos): boundary **precision 1,0 / recall 0,113** (release build do autor) com **rebuild não reproduzível** no host (boot customizado exige `registerState`, ausente da lib SGDK 2.11/gcc 13.2) — nota honesta no ledger, sem MatchExact.
- **Armadilhas do donor-rebuild resolvidas no core** (reutilizáveis para corpus): cópia do doador pulando `out/`/`.git`/`build`; `ensure_res_dep_files` cria `res/*.d` vazio (makefile.gen 2.x faz `cp res/*.d`, que falha em build limpo); `.d` com paths do build Windows do autor nunca entram no rebuild.
- **Gates:** fmt/clippy OK; `cargo test --lib` com 19 testes novos verdes; frontend sem alteração (601/6 skipped medidos na rodada anterior); `check:tree` OK (subdir `decomp/` sob `tools/reverse/` permitido); GOV-01 segue o único bloqueio ambiental do `host:certify`.
## Checkpoint 2026-09-19 — composição multi-frame assistida

Na branch `codex/rex-sprite-frame-01`, a composição de sprite deixou de estar limitada ao único `spr_ryo_100/frame-0`. O manifesto agora parametriza os frames 0 e 1 do recurso doador HAMOOPIG: frame 0 usa tiles `0x863A0 + 0x800` e descritores `0x22260`; frame 1 usa tiles `0x86BA0 + 0x840` e descritores `0x222A2`; ambos usam a paleta `0x2CC68 + 0x20` da ROM BYOR SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`. O painel passou a selecionar o `frame_id` preservando o recurso e a proveniência assistida.

O oráculo E2E também seleciona o manifesto por `frame_id`, mantém os hashes PNG/RGBA separados e conserva negativos de ordem de tiles, paleta, flip e mutação de pixels. A máscara de transparência do frame 1 coincide com a segunda célula independente do PNG doador SHA-256 `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`. Outros recursos permanecem deliberadamente sem composição automática até que bytes compilados, frame, paleta, fonte e transformações tenham a mesma rastreabilidade. A superfície continua Experimental; não cobre animação, edição do jogo ou extração geral.
### Checkpoint 2026-09-20 — Sonic 1 visual pilot

Branch isolada `codex/rex-sonic1-pilot`, código/harness em `57c2780` e documentação de evidência em `243c3a6`, sem merge. ROM BYOR local fixada por SHA `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` (`531.577` bytes). A fatia assistida `sonic1_sonic/stand` usa bytes comprovados em `0x21AFE+0xA120`, paleta `0x2388+0x20` e mapping `0x21293+21`; o oráculo independente base é `ce95ea66f2cfcec40a0fb12cb35fe5e88530de036de9f897333ce762f06b40d4`. O fluxo UI inclui edição RGB333 em cópia, BPS com CRC da base, aplicação separada, emulação e reabertura persistida; `InspectionPanel 8/8`, composição Rust `9/9`, patch `5/5` e frontend `622/6` passaram com `TMPDIR=/tmp`. O build canônico `src-tauri/target-test/debug/retro-dev-studio` tem SHA `70314bc2289df512fe401fd1b97d17c859f9d6540f8ca8a08d87c4f991cd7ddb`; o desktop E2E final passou com pixels base `ce95ea…`, edição/reabertura `91ee4a…`, patch `35c91e…` e ROM aplicada `d381b1…`. Detalhes em `docs/REX_SONIC1_PILOT.md`. Limitação: Experimental, perfil assistido, sem extração universal ou reconstrução/lógica.

### Checkpoint 2026-09-21 — execução Sonic observável e efeito de paleta separado

No commit de código `c0ad292` foi corrigida a prova de execução do piloto Sonic: a UI usa `emulator_run_frames` em lotes, envia START no frame 900 e expõe ROM, core, frames, framebuffer, pixels não pretos e hash RGBA. O build canônico usado no desktop foi `src-tauri/target-test/debug/retro-dev-studio`, SHA `b069a5fb8928023699816e164876bb39faf58615cbc62fcac3c04bc51f42d77d`; frontend `index-tGPqe_u5.js`, SHA `74d3c8b61a5ff3e25accb547b60f3526d6d96d5a621f69985ba37d612cfc7952`.

O E2E `inspection-sonic` passou no fluxo real identify → compose → edit → save → BPS → apply → run base/applied → restart/reopen. A ROM BYOR original foi relida no fim e permaneceu em `531577` bytes, SHA `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`. Sob o mesmo core `Genesis Plus GX v1.7.4 46a5521`, 1200 frames e START no frame 900, a base produziu framebuffer `320×224` SHA `680faf…` e a aplicada `02b1fb…`; a ROI não preta e o contador de pixels magenta-like diferenciaram a mutação (`0` na base, `189` na ROI aplicada). A prova separa explicitamente “carregou e produziu frames/framebuffer” de “alteração de paleta apareceu no jogo” e inclui capturas reais base/aplicada/reaberta.

Evidências finais: `src-tauri/target-test/validation/sonic1-pilot-2026-09-21T03-56-34-468Z/` e capturas `inspection-2026-09-21T03-56-06-406Z-sonic-*`. O primeiro resultado histórico de 60 frames preto permanece preservado como lacuna anterior, não como prova atual. A superfície continua Experimental, assistida e restrita a esta ROM/recurso; não há declaração de extração universal, equivalência do jogo inteiro ou lógica/nós recuperados.

### Checkpoint 2026-09-21b — PR #74: superfície canônica de jogo e bloqueio de salto

Continuação sobre `5284d458` na branch isolada `codex/rex-sonic1-pilot`, sem merge. A ação `Jogar versão modificada` usa o `loadRomIntoEmulator` canônico já usado pela superfície de emulação; a UI expõe path, tamanho, SHA, core, framebuffer, frames renderizados e ACK de input. Nenhum emulador ou caminho exclusivo do harness foi criado.

Destino: binário `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `7b6ad560b899195b1b22b6a415c38bf6c2d594bbf4f806a7486858a9ac6158ff`; frontend `dist/assets/index-N1yRKj1H.js`, SHA-256 `45523954b6c9cdd8cca8adf727e81ccde60b16973c9b77eb84ce9871150a04eb`; ROM BYOR `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`, 531.577 bytes; ROM aplicada `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`; BPS `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; core `07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1` (`Genesis Plus GX v1.7.4 46a5521`).

O E2E `inspection-sonic` (sessão `inspection-1789983205-00000000`) reexercitou identificação, edição, BPS, base/aplicada, reinício/reabertura, identidade da ROM modificada, framebuffer real `320×224` e preservação da BYOR. Após `frames >= 1800`, a captura `src-tauri/target-test/validation/inspection-2026-09-21T09-33-12-050Z-sonic-game-modified-before-controls.png` (SHA-256 `8a8b9b0de5bdeea7ea2f6cb2a7bbf27e01a1f304911922ce4484252b284bb03f`) mostra Sonic em gameplay, sem o cartão da fase. ArrowRight chegou pelo handler/IPC e alterou a máscara/centróide horizontal independente.

### Checkpoint 2026-09-21c — PR #74: movimento e salto reais na Game View canônica

Continuação no branch `codex/rex-sonic1-pilot`, sem merge. A execução desktop `inspection-sonic` com prefixo `inspection-2026-09-21T14-23-44-938Z` passou no binário `src-tauri/target-test/debug/retro-dev-studio` SHA-256 `126e8b7e341a8b8605011360750ce661d80381a3f0ab8f2adeb149fce317ac10`, ainda sobre `4b96ec3` dirty pelas correções atuais de harness/UI. ROM BYOR: `/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin`, `531577` bytes, SHA `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`; ROM aplicada `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`; BPS `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; core `Genesis Plus GX v1.7.4 46a5521`, SHA `07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1`.

O produto agora expõe `Jogar ROM base` além de `Jogar versão modificada`, ambos pela Game View canônica (`loadRomIntoEmulator`). A prova de identidade do personagem não usa mais ROI magenta como oráculo: a primeira localização usa o template independente do frame `sonic1_sonic/stand` e a trajetória usa WRAM região `2`, objeto candidato `0xD000`, validada pela correlação visual inicial (`center.x≈78,5`, WRAM `x=80`, `y=944`) e pelos deltas causados por input nativo. Na ROM aplicada, `ArrowRight` foi ACK pelo handler do produto e moveu WRAM `x` de `80` para `451`; `KeyZ/A` foi ACK e produziu salto com `y=940 → 904` (`yVel=-1272`) e depois `844`. Pausa/retomada passaram (`2250 → 2260` frames). A sessão foi salva, o app reiniciado, a mesma sessão reaberta, a ROM modificada carregada novamente por interface, e a BYOR original foi relida intacta.

Evidências: `src-tauri/target-test/validation/inspection-2026-09-21T14-23-44-938Z-sonic-base-trajectory.json` SHA `bf766dbb20777aaaed8739f49bc137cb4d5269466f7111aa65518f2b6bc20b65`; `...sonic-trajectory.json` SHA `eb3195bd3746cd270355a5ec4356c21fb1615760dcd98daff0452465a4411b8d`; capturas `...sonic-game-base.png` SHA `a0d57b7194f23106aa30efe5489ec57730d78d6be85625884a50de6e42320aa8`, `...sonic-game-modified-before-controls.png` SHA `44a9fb25b49860f61bf273ce9550f53eab42c19cbe194361666344e2cfff0d45`, `...sonic-game-modified-after-restart.png` SHA `8ae8fb27536fa9037a51b0b097c0383e95d273fd5cf01cb742ba8f52ed26dab9`. Negativos integrados passaram para ROM errada por hash, imagem antiga reutilizada por framebuffer SHA e tecla `Q` sem ACK novo; cenários negativos dedicados ainda podem ser separados se o revisor exigir isolamento por caso. Próximos passos: commit limpo, build canônico no SHA final, E2E/gates finais e CI; manter Experimental e não avançar para lógica/nós.

### CHECKPOINT operacional (2026-09-26 — frente do integrador: encoder aPLib e capacidade medida)

Branch `codex/rex-integrator-aplib-decode`. HEAD deste checkpoint: `290c8ec` (docs da matriz). Cadeia não enviada ao iniciar a barra: `632c195` (encoder guloso + `needs_space`), `745dc59` (cobertura de offsets distantes + capacidade congelada), `3a3db96` (rep-match), `068e89e` (rastreador de tokens), `19bc865` (token `111`), `2f0bd4b` (aceite por oráculo independente), `290c8ec` (registro na matriz). Alterações não commitadas: apenas esta entrada do Memory Bank. Nenhum arquivo alheio foi tocado; os não rastreados preexistentes (`.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`, `data/canonical-local-2026-09-21/`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/`) permanecem como estavam — removi só `src-tauri/analysis/`, duplicata byte a byte (`diff -rq` = idênticos, 8/8) dos dumps regeneráveis que já vivem em `src-tauri/target-test/analysis/aplib/` e que eu mesmo produzi com `RDS_APLIB_DUMP`.

**Hipótese da rodada.** "Tornar mais recursos comprimidos editáveis sem expansão" exige encoder, e encoder exige capacidade *medida* em vez de alegada. A hipótese operacional era: o gap de 44 B (444×…) entre o stream do produto e o do oráculo não vinha de token indisponível no formato, e sim de escolha de parse do guloso — literalmente de rearmar LWM. Isso previa que (a) adicionar o `111` e o rep-match reduziria o gap sem tocar no formato, e (b) a mesa de tokens diria em números onde o parse diverge.

**Evidência a favor.** `token_dump.py` fecha a contabilidade (`1 + Σtags + Σdados = stream consumido`, custo em bits + rabo do último tag = tamanho real) para os **35 streams bem-formados** do acervo — 9 goldens, 16 de dois oráculos sobre 8 plains, 2 discriminantes, 8 dumps do produto — com zero falha; os 7 negativos são recusados cada um pelo motivo estrutural que o define. **7 das 8 mesas de tokens do produto são idênticas às dos dois oráculos** (`apultra` v1.4.8 `64be2a7a…` e `apj.jar` do SGDK 2.11) em contagem por tipo, plain produzido e custo. A perna 2 da paridade do CONTRACTS §4 (oráculo desempacotando stream do produto) passou em **8/8** por `oracle_encode_parity.py`, e a não-vacuidade do aceite foi provada por controle: um bit invertido na tag de `tile_like` foi aceito pelo oráculo mas produziu hash diferente → o script apontou FAIL e saiu com rc=1. Pinos congelados por igualdade em `aplib_encode_tem_a_capacidade_medida_congelada_por_plain`; `text_rep` 29→28 B (igual ao oráculo), `noisy_runs_16k` 1365→1364 B.

**Evidência contra / ainda não alegado.** Optimalidade não é alegada: não houve comparação exaustiva com parse ótimo, e a única divergência restante é real — `noisy_runs_16k` sai 1364 B contra 1205 B do oráculo, e a mesa atribui: o produto paga **+433 B** de `match-10` (305× a 3,36 B contra 179× a 3,31 B) para economizar 272 B entre literais e rep-matches. O `111` economiza 2 bits por ocorrência mas **não** chegou a encolher stream nos dois casos fixados (`ABCDA`, `01 00 02`), porque estoura o tag e cobra um tag extra. Não há oráculo 68000 sob MAME para stream do produto aPLib (só existe para LZ4W), nem reinserção em slot: `reinsert` em `rex_resources.rs` continua caminho exclusivo de LZ4W, então **nenhum recurso APLIB da ROM é editável sem expansão pelo produto hoje** — ligar o encoder a essa via é frente separada, sem autorização para expandir ROM ou realocar ponteiros. A célula da matriz permanece `blocked` por decisão de missão.

**Últimos comandos e resultados.** `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → rc=0. `cargo test --lib -- --nocapture` → `699 passed; 0 failed; 54 ignored`, 61,97 s. `cargo clippy -- -D warnings` → rc=0. `npm run check:tree` → `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` `npx tsc --noEmit` → rc=0. Jobs pesados um por vez, nenhum em background.

**Próximo comando.** `git fetch origin` + `git push origin codex/rex-integrator-aplib-decode` (fast-forward: 0 atrás, 7 à frente), depois conferência pontual de CI. **Sem merge, sem release, sem promoção de maturidade.**

**Bloqueio.** Nenhum técnico. Dois itens ficam entregues à decisão do operador: (a) promover a célula APLIB da matriz e (b) autorizar a frente "encoder → reinsert", que depende da mensagem clara de descarte fora de faixa no UI e da guarda do backend já existentes. O incremento de parse seguinte (rearmar LWM encurtando match, com busca exaustiva em entradas pequenas) está medido mas deliberadamente não executado, porque a meta exige a prova do modelo antes de alegar ganho.

### CHECKPOINT operacional (2026-09-27 — frente do integrador: aPLib entra na transação canônica e na fronteira de produto)

Branch `codex/rex-integrator-aplib-decode`. HEAD deste checkpoint: `41a05b6` (UI) sobre `56faf0d` (transação Rust) e `48562b7` (gate de paridade endurecido, passo 1). Alterações não commitadas: apenas esta entrada e a célula correspondente em `docs/rex_profiles/ROUND_STATE.md`. Os não rastreados preexistentes (`.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`, `data/canonical-local-2026-09-21/`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/`, `scripts/rex_profiles/integrator/aplib/__pycache__/`) permanecem intocados — nada alheio foi apagado nem staged. O item (b) do bloqueio do checkpoint anterior ("autorizar a frente *encoder → reinsert*") é exatamente o que esta barra executou; o item (a), promover a célula APLIB da matriz, continua com o operador.

**Hipótese da rodada.** A reinserção do aPLib não pede arquitetura nova: pede que a sequência de guardas existente aceite um segundo *contrato de histórico*, e que a UI deixe de pressupor LZ4W. Isso previa que (a) as sete guardas poderiam ser compartilhadas sem remover validação específica do LZ4W e (b) nenhum caminho precisaria "adivinhar" codec, porque o header TileSet do SGDK já declara `compression`.

**Implementação.** `TransactionLimits` (orçamentos de decode/encode aPLib e LZ4W), `RecursoVerificado` (o recurso verificado carrega o próprio contrato), `verify_resource_set` (varre candidatos dos **dois** codecs, ignora quem falha na verificação e **recusa sobreposição cross-codec** com `invalid_reference`), `RecursoEditavel::{desempacotar, recodificar_no_espaco}`, `transacao_canonica` (as sete guardas numa só sequência: identidade → evidência → tamanhos → no-op → re-codificação dentro do espaço comprovado → ida-e-volta → cópia + dependentes → BPS re-aplicado com hash exato) e `reinsert_transaction_aplib`. `reinsert_transaction` (LZ4W) foi redirecionada para a mesma função: o corpo de 162 linhas deixou de ser duplicado, mas `verify_lz4w_resource_set`, o dicionário de comprimento par, o índice de dicionário e o encaixe por orçamento de espaço continuam no caminho dele e seguem exercitados pelos testes originais. A fronteira de produto (`list_resources` → `preview_resource` → `apply_resource_edit`) rotula e despacha pelo codec lido do header; os artefatos passam a chamar-se `rex-{codec}-modified-*` / `rex-{codec}-patch-*`.

**Duas mudanças de semântica registradas explicitamente** (não absorvidas em silêncio): (1) `verified_preserved` conta agora sobre o **conjunto dos dois codecs**, então um "preservados N" de ROM mista não é comparável byte-a-byte com o mesmo número de antes; (2) `analyzed_scope` declara o denominador por codec (`3/3 candidatos (LZ4W 2/2 de LZ4W, aPLib 1/1 de aPLib)`); a asserção pré-exigente `contains("2/2")` do tronco LZ4W continua válida por construção desse texto. No painel, o escopo deixou de dizer "Recursos comprimidos LZ4W" e passou a contar por codec.

**Evidência a favor (capacidade medida, foram os números que escolheram a fixture).** Sobre os streams dos oráculos: `tile_like` empata o oráculo em **41 B**, mas a menor edição de 1 pixel custa **+3 B** (44 > 41) — *nenhuma* edição cabe num slot assim, e isso é propriedade do codec sobre aquele plain, não defeito do encoder; `pseudo_random_8k` empata em 294 B com delta mínimo **+1**; `noisy_runs_16k` é o único com folga medida (oráculo **1 366 B**, produto **1 364 B**) e tem edição de 1 pixel de custo **zero** (tile 64, linha 3, coluna 4, índice 11 → 15 → re-codifica em 1 364 B). A fixture de edição usa esses números; a de recusa usa o slot apertado de 41 B e exige que a mensagem carregue `41` e `8192`. Gate de paridade reexecutado nesta célula: **esperado 16 | executado 16 | aprovado 16 | divergente 0**, rc=0, com os dois oráculos independentes (`apultra` v1.4.8 `64be2a7a…`, `apj.jar` SGDK 2.11 `2d8cdc63…`). Novos testes verdes: `conjunto_verificado_reconhece_lz4w_e_aplib_na_mesma_rom`, os cinco `reinsert_aplib_*` (com `excessive_output`, `dependent_modified` e `rom_identity_mismatch`/`evidence_mismatch` cobertos) e `ui_edite_recurso_aplib_pela_mesma_fronteira_do_lz4w`, mais o teste do painel para ROM mista. **Não-vacuidade provada por mutante:** neutra o ramo aPLib de `verify_resource_set` → **6** testes falham (fronteira de produto, tronco e conjunto); o mutante do painel derruba exatamente a asserção `(LZ4W 1, aPLib 1)`. Ambos revertidos e suíte reexecutado.

**Evidência contra / ainda não alegado.** Nada aqui toca o alvo comercial: o passo 4 (reconfirmar `0x2e4d4`/`0x2d534`/paleta derivando de novo dos manifestos atuais, onde existem claims conflitantes `0x2cbc8`/`0x2CC68`) e o passo 5 (fluxo completo pelo app e execução com o desempacotador usado pelo jogo) seguem abertos, e o E2E canônico do fixture **não** foi reexecutado nesta célula — a UI mudou e precisa ser reexecutada antes de qualquer alegação sobre ela. Os dois oráculos de host não substituem o replay 68000. A edição semântica do recurso comercial continua bloqueada, e a ETAPA E continua aceita apenas no escopo do fixture autoral LZ4W. **Achado de fixture registrado:** a semente de dependência cross-codec precisa vir da **cauda** do stream aPLib — com a cabeça (32 B) a transação era aceita, porque a edição começa no tile 64 (offset 2 048 de 16 384) e os primeiros ~170 B re-codificados permanecem idênticos; a guarda existia, o fixture é que não exercitava dependência real.

**Últimos comandos e resultados.** `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → rc=0. `cargo clippy -- -D warnings` → rc=0 (a primeira corrida falhou com 5 lints `doc list item without indentation` da minha própria doc-string numerada; corrigida a doc, sem `#[allow]`). `cargo test --lib -- --nocapture` → **706 passed; 0 failed; 54 ignored** (699 no pino anterior + os 7 desta barra). `npm run check:tree` → OK. `npx tsc --noEmit` → rc=0. `npm run lint` (`--max-warnings=0`) → rc=0. `npm test` → **702 passed; 6 skipped (708)**; delta reconciliado com o 699/705 registrado anteriormente: **+3**, sendo 2 do `6351f15` (avisos de descarte na UI) e 1 deste checkpoint (painel de ROM mista). `python3 scripts/rex_profiles/integrator/aplib/oracle_encode_parity.py src-tauri/target-test/analysis/aplib` → rc=0, 16/16. Jobs pesados um por vez, nenhum em background.

**Próximo comando.** `npm run build:debug` e em seguida o cenário E2E do fixture (as asserções existentes não podem se mover: "exatamente 1 recurso LZ4W", o regex do rótulo `stream (\d+) B`, `.includes("noop")`), depois `git fetch origin` + `git push origin codex/rex-integrator-aplib-decode` e consulta **pontual** do CI no SHA publicado (passo 2, ainda em aberto: `4a389ff`/`cb8557c` verdes, Desktop E2E registrado pela última vez em `e8e834a`; o run fantasma de 14 falhas em background foi substituído e não conta como evidência). **Sem merge, sem release, sem promoção de maturidade.**

**Bloqueio.** Nenhum técnico externo. Ficam abertos o passo 2 (CI por SHA publicado), o passo 4 (reconfirmação dos offsets do TiledImage HAMOOPIG) e o passo 5 (fluxo pelo produto com replay do desempacotador do jogo). Promover a célula APLIB da matriz continua decisão do operador.

### CHECKPOINT operacional (2026-09-27 — frente do integrador: passo 5 fechado, as quatro pernas do recurso aPLib real na mesa)

Branch `codex/rex-integrator-aplib-decode`. HEAD deste checkpoint: `8f2f3f1`, sobre `ce6ed3c` (cenário WebDriver) e `7c65cd5` (varredura de capacidade), que fecham o passo 5 aberto em `94bfa81` (pernas 1 e 3: `5880a22`, `d43fdde`). Alterações não commitadas ao redigir esta entrada: o pacote de evidência `data/rex_profiles/integrator/aplib/evidence/2026-09-27-passo5-perna2-barra/`, esta célula e a célula correspondente em `docs/rex_profiles/ROUND_STATE.md`. Os não rastreados preexistentes (`.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`, `data/canonical-local-2026-09-21/`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/`, `scripts/rex_profiles/integrator/aplib/__pycache__/`) permanecem intocados — nada alheio foi apagado nem staged; o corpus continua somente-leitura e fora do versionamento.

**Hipótese da rodada.** O fluxo de edição de um recurso comprimido real, conduzido pela frente do produto (não por chamada Rust direta), produz bytes que o desempacotador do próprio jogo executa com efeito de tela previsível. Previa duas coisas: (a) a barra é capaz de expressar uma edição que caiba no slot comprovado, e (b) a edição-alvo das pernas 1 e 3 — índice 0, transparente — servia de pino também para a barra.

**A hipótese (b) era falsa, e a barra a refutou antes de qualquer implementação.** O `#[ignore]` da perna 1 morria em `excessive_output` para **todos** os índices 1..15 no pixel `(53,0,4)`. A causa não é o codec: `CompressedResourcePanel.tsx:273` faz `setPaintIndex(Number(event.target.value) || 1)`, então digitar 0 escreve `"1"` no campo antes de `editRejectReason` (linhas 40-42), que reserva 0 como transparente. Medido no navegador: o `value` do DOM após digitar 0 é `"1"`, e o desfecho é byte a byte o do índice 1 explícito (942 B alegados contra 938 B de orçamento), enquanto o índice 0 real custou 937 B nas pernas 1 e 3. **Registrado com asserções que o vigiam, não corrigido** — alterar a semântica de paleta da UI é decisão do operador, e o cenário agora falha se a UI passar a expressar o 0 ou se o clamp mudar de valor.

**Evidência a favor (o alvo foi escolhido por medida, não por opinião).** `7c65cd5` varre os **4** recursos aPLib da ROM com o codificador do produto (75 325 ms, 10 770 tentativas): `0x2e4d4` e `0x2f65a` não aceitam nenhuma edição de 1 pixel que a barra expresse, e mesmo contando o índice 0 o piso passa do slot (4 540 > 4 485; 7 439 > 7 420) — a barra não os edita em nenhuma circunstância. Restam `0x2e12a` (folga 1 B) e `0x2cd94` (folga 0). Dentro de `0x2e12a`, o tile 53 tem exatamente dois pares cabíveis, ambos a 938 B (o teto), e essa lista está pinada no teste do lib. Perna 2 (`ce6ed3c`, cenário `rex-aplib-byor-effect`): `rexResourceList` → `rexResourcePreview` → `rexResourceApplyEdit` (no-op e edição) → reabertura da cópia; cópia `80249128…` com hash anunciado == SHA no disco, 917 504 B (sem expansão), **800** bytes distintos todos dentro de `[0x2e12a, +938)`, **0** fora do slot, **163** preservados, BPS `58ae4f0b…` reaplicado sobre ROM íntegra reproduzindo a cópia, guarda anti-descarte exercida (linha 8 → aviso + fila vazia asserida). Verde duas rodadas, ambos os relatórios no pacote, 62 campos idênticos e um único divergente (texto livre que editei entre as corridas). Perna 4 (`8f2f3f1`): o teste refaz a chamada com os campos da barra, **obriga** o hash `80249128…` e então emula três corridas frescas sob Genesis Plus GX v1.7.4 `46a5521`; coordenadas previstas antes de executar e observadas iguais (`[[213,207],[285,135]]`), **232** pixels em **116** frames, 2 por frame, determinismo base-vs-base **0**, **0** fora dos retângulos das células, e a janela ancorada em evidencia anterior a esta frente (frames 59/69/129/179 batem byte a byte com `rex-evidence-2026-09-10/backend-hamoopig/checkpoint-rgba-hashes.json`).

**Evidência contra / ainda não alegado.** (1) A diferença 119/238 (perna 3) contra 116/232 (perna 4) é real, não atribuída a mecanismo nenhum, e registrada como limite da medição, não resolvida por redação. (2) O `#[ignore]` da perna 4 usa o core do harness da lib, não o app distribuído. (3) BYOR não é dependência provisionável: cenário e os dois aceites não rodam no CI, então o que o CI cobre aqui é o contrato, não esta ROM. (4) Uma edição de 1 pixel de 1 recurso de 1 ROM não prova os outros 3 recursos nem o resto do jogo nem hardware real. (5) O relatório da perna 2 declara em seus próprios limites que o efeito em tela daquela edição não fora executado no core; isso continua verdadeiro para o artefato isolado e só se fecha lendo o pacote inteiro. (6) A linha aPLib da matriz **não foi promovida**: a condição declarada do bloqueio foi alcançada, mas promoção de maturidade é vetada pela ordem do operador.

**Últimos comandos e resultados (árvore final, em `8f2f3f1`).** `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → rc=0. `cargo clippy --lib -- -D warnings` → rc=0. `cargo test --lib -- --nocapture` → **706 passed; 0 failed; 63 ignored**. `cargo test --lib rex06_hamoopig_aplib -- --ignored --nocapture` → 1 passed, 12,24 s. Varredura `--ignored` → 1 passed, 75,43 s. `npm run check:tree` / `npm run lint` / `npx tsc --noEmit` → rc=0. `npm test` → **702 passed; 0 failed; 6 skipped (708)**; os 6 skips reconciliados um a um no manifesto (4 guardas de toolchain em `scripts/decomp/decomp-scripts.test.mjs`, 2 `describe` só-win32 em `src/core/validateUpstreamWindows.test.ts`), e o invariante entre pinos é 702/0. `npm run host:certify` → READY (fingerprint `60249508…`). O log de gates promovido é o da árvore final: um log anterior tinha `cargo fmt --check` rc=1 e foi descartado, com rex06 reexecutado depois do fmt (run `1790493156`) para que o hash do binário bater com o commit. Jobs pesados um por vez, nenhum em background, nenhum processo alheio morto.

**Push e CI registrados por SHA.** `git fetch` + `git push origin codex/rex-integrator-aplib-decode` → fast-forward `94bfa81..f633e07` (0 atrás, 4 à frente). Consulta **pontual**, sem monitor permanente, no SHA publicado `f633e07dbb6bf4ad67ce3f4d829df626bdd069c9`: workflow `CI` → **success** (`validate`, `linux-validate`); workflow `Desktop E2E` → **success** (`desktop-smoke`); run ids `36303792634` / `36303792614`. Isso fecha o passo 2 e o passo 7 do briefing. O que esse verde **não** cobre: os dois aceites `#[ignore]` e o cenário `rex-aplib-byor-effect`, que consomem BYOR — BYOR não é dependência provisionável, então o CI atesta o contrato, não esta ROM.

**Bloqueio.** Nenhum técnico; nenhum item do briefing desta frente fica aberto. Três decisões ficam com o operador: (a) promover — ou não — a célula APLIB da matriz tendo as quatro pernas do passo 5 na mesa; (b) decidir a semântica do índice 0 na UI (o achado está vigiado por asserções, não corrigido); (c) autorizar qualquer frente que dependa de rodar BYOR no CI, o que por política não é provisionável. **Sem merge, sem release, sem promoção de maturidade.**

### CHECKPOINT operacional (2026-09-27 — frente do integrador: entregas 1, 2 e 3 do briefing; o índice 0 deixou de ser achado)

Branch `codex/rex-integrator-aplib-decode`. HEAD desta célula: ver `git log` — os commits do trabalho são `794033e` (entrega 1, registro da matriz), `af5d5d0` (conserto na UI), `d769629` (pino do índice 0 no codec + varredura no domínio real da barra), `eae825a` (regressões no cenário WebDriver) e `ad3ff57` (durações por aplicação e espera de prévia assentada), sobre `19c880f`/`f633e07` (passo 5). Nada alheio foi staged ou apagado: `.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`, `data/canonical-local-2026-09-21/`, `scripts/rex_profiles/integrator/aplib/__pycache__/`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/` seguem não rastreados e intocados; o corpus continua somente-leitura e fora do versionamento.

**Ordem recebida e o que ela decidiu.** Três entregas delimitadas, sem novo GO intermediário: (1) corrigir o estado documental — separar capacidade técnica de maturidade, sem deixar `blocked por decisão de missão` onde o critério foi atendido, preservando histórico; (2) corrigir o índice 0 — "o campo atual usa `min=1` e `Number(value) || 1`, transformando 0 em 1; o índice 0 pertence ao domínio 4bpp e deve ser representável", com tratamento explícito de vazio/decimal/negativo/NaN/acima de 15 e sem substituição silenciosa de entrada inválida por outra cor, e as asserções que preservavam o defeito substituídas por regressões; (3) validar e publicar, reconfirmando espaço e hashes em vez de copiar números antigos. **A decisão (b) do checkpoint anterior ("decidir a semântica do índice 0 na UI") foi executada pela ordem expressa da entrega 2 e sai da lista de pendências do operador.** Seguem com o operador: (a) promover ou não a célula APLIB da matriz e (c) autorizar qualquer frente que dependa de rodar BYOR no CI.

**Semântica, escrita para não ser confundida.** O campo é índice de paleta do **pixel** no 4bpp: domínio `0..15`, e o 0 é o índice que o VDP lê como transparente no plano de tiles. Editar o índice de um pixel **não** edita a cor RGB de nenhuma entrada da paleta — isso é outra superfície, que este painel não toca. A frase está no cabeçalho do painel e em cada queixa de índice inválido.

**O conserto.** `CompressedResourcePanel.tsx` passou a guardar o **texto** do campo (`useState("1")`) e a validá-lo em `paintIndexRejectReason` por forma (vazio, não número, não inteiro, fora de 0..15 — cada uma com queixa própria terminando em "A fila atual foi preservada"); `editRejectReason` aceita agora inteiro em `[0, 16)`; pintura por clique e botão compartilham o mesmo `queuePaint`. A guarda definitiva continua no núcleo, inalterada. Quatro testes novos no arquivo do painel (que passa a ter 10): "digitar índice 0 mantém 0 no campo e a transação recebe índice 0", "entrada de índice inválida diz o motivo e não entra na fila no lugar de outra cor", "pintura por clique usa o índice do campo, inclusive 0, e recusa campo inválido", "índice 0 sobrevive a desfazer (re-editar o pixel), reabrir o recurso e ao no-op". No lib, o pino `indice_0_e_do_dominio_4bpp_ate_o_stream_aplib` confere o bit a bit: `0x5A → 0x0A` no nibble baixo (coluna par), `0xA5 → 0xA0` no alto (coluna ímpar), vizinhos intactos, e o índice 0 sobrevivendo a re-codificação + decode sobre o plain autoral.

**Números re-medidos, não copiados.** Aplicando a edição pinada das pernas 1 e 3 (tile 53, linha 0, coluna 4, índice 5 → **0**) com o encoder atual: **937 B** escritos no slot de **938 B** (folga 1 B), cópia `69389ec2b400220c7a069e4c36326ca3c26d81e85ff0ab81bf798dc9ae4038ac`, BPS `8bf6d3df…` de **853 B**, **781** posições do slot diferentes, prévias `a6a4b603…` → `227a4c2f…`, 164 recursos verificados. Log durável: `.../cargo-sweep-ignorado-final.log` (7 passed, 0 failed, `--ignored`).

**Varredura re-ancorada (`rex-aplib-capacidade-da-barra/v2`, 82 466 ms, 10 740 tentativas).** Ela media 1..15 e deixou de descrever a interface; agora mede os dois domínios lado a lado. `0x2e12a`: piso 932 B (barra, 0..15) vs 934 B (sem o 0), cabíveis **1 694** vs **1 619** — o índice 0 abre **+75** edições de 1 pixel. `0x2cd94`: 78 vs 77 (**+1**). `0x2e4d4` (piso 4 540 > slot 4 485) e `0x2f65a` (7 439 > 7 420): **0** nos dois domínios — para esses dois o conserto da UI não muda nada. Total de edições cabíveis com índice 0: **76**. Higiene de medição corrigida nesta célula: o tile 53 entrava duas vezes na lista de alvos (varredura completa de 64 pixels + amostra genérica `(0,0)`/`(0,4)` por tile), o que contava uma edição em dobro; com `sort_unstable + dedup` as tentativas caem 10 770 → **10 740** (−30 = 2 pixels duplicados × 15 índices) e os cabíveis de `0x2e12a` 1 695 → **1 694** — o único par duplicado que cabia era justamente o do índice 0. A lista pinada do tile 53 passou a `[[0,4,937],[7,5,938],[7,7,938]]`, com `pin_cabiveis == vec![0]` e o cruzamento `cabiveis_sem_indice_0 ==` contagem das entradas com índice ≥ 1 asseridos no teste.

**Prova de UI reexecutada — quatro corridas, registradas como aconteceram.** Cenário `rex-aplib-byor-effect`, schema `v2`. (1) 10:34Z, após build: falha no WebDriver em `setPanelInput("rex-resource-paint-index", …)` com "o setter de HTMLInputElement.value só aceita instância de HTMLInputElement" — em WebKit é o que ocorre quando o elemento não está lá; a espera do harness era por `rex-resource-canvas`, e o painel desmonta prévia **e** campo juntos ao começar a re-decodagem, então a sondagem podia ver o canvas do estado anterior e passar cedo. (2) 10:45Z, mesmo binário, com `selectResource` esperando a condição assentada (campo de índice montado **e** botão aplicar habilitado, i.e. `busy === false`): **verde**, 23 passos. (3) 10:52Z, **build completo novo**: passou 5a, **5b** (o índice 0) e os 14 índices de 6a, e morreu no orçamento de 60 s do desfecho em §6b com a edição na fila e sem erro no painel. (4) 10:58Z, mesmo binário da (3) e orçamento medido: **verde, rc=0**, com `aplicacoes_ms = [7621, 272..327 ×14, 7400]`. O alvo prévio das pernas 2/4 foi preservado como regressão (§6b, 5→4 em `(53,7,5)`): cópia `80249128…`, BPS `58ae4f0b…` reaplicado sobre base íntegra reproduzindo a cópia, 800 bytes distintos, 0 fora de `[0x2e12a, +938)`, 163 preservados. **Achado aberto, honesto:** a corrida (3) estourou 60 s num passo que custa ~7,4 s cronometrados — não foi lentidão sistemática, e a causa daquele travamento único **não foi estabelecida**; o que mudou desde então é diagnóstico (duração por aplicação no relatório, orçamento 180 s, marcadores de passo, `setPanelInput` reportando os testids presentes), não produto.

**Efeito em tela.** A perna 3 já executou a cópia `69389ec2…` no desempacotador do próprio jogo (`rex05`: 2 pixels por frame, **119** frames, coordenadas `[[212,200],[284,128]]`, primeiro frame 59) e a perna 4 executou a cópia da barra `80249128…` (`rex06`: **232** pixels em **116** frames, exatamente as posições previstas `[[213,207],[285,135]]`); os dois testes `--ignored` foram reexecutados hoje às 10:29Z (07:29 local) com o código atual e os relatórios estão no pacote; os dois registram `core.sha256 = 07c10476…`, o mesmo `core_sob_teste` do manifesto, e o vínculo com o binário de teste que os produziu (`app_lib-716403bf8cac2e87`) vive no manifesto e nos logs de `--ignored` — o relatório `rex05` em si não imprime esse caminho, o que fica declarado como limite do pacote. O que a entrega 2 fecha é a **identidade**: a barra produz byte a byte o artefato que o núcleo rodou — a asserção do hash da cópia em disco está no cenário, não só na narrativa.

**Gates.** `npm run check:tree` rc=0 · `npm run lint` rc=0 · `npx tsc --noEmit` rc=0 · `npm test` → **706 passed, 0 failed, 6 skipped** (invariante anterior 702; **+4** = as quatro regressões do painel) · `cargo fmt -- --check` rc=0 · `cargo clippy -- -D warnings` rc=0 · `cd src-tauri && cargo test --lib -- --nocapture` → **707 passed, 0 failed, 63 ignored** (invariante anterior 706; **+1** = o pino do índice 0). Distinção que aprendi a registrar ao corrigir uma invoco errada: `src-tauri/.cargo/config.toml` fixa `target-dir = "target-test"` **relativo ao diretório de invocação**, então `cd src-tauri && cargo …` cai em `src-tauri/target-test` enquanto a forma da raiz (`cargo … --manifest-path src-tauri/Cargo.toml`) cai em `src-tauri/target` — medido com `cargo metadata` nos dois diretórios. O log que carrega os 707 testes mostra `target-test/debug/deps/app_lib-716403bf8cac2e87`, o binário amarrado no manifesto como `harness_de_teste`, de modo que essa corrida é a de `src-tauri`; os logs de `fmt` e `clippy` não imprimem caminho, então a forma exata dessas duas invocações não é decidível pela evidência (o que muda é o diretório de alvo, não o veredito). O `rc=101` no meio da série foi erro de invoco meu: `cargo` rodado na raiz, sem `--manifest-path` ("could not find Cargo.toml"); reexecutei e os números acima são das corridas corretas.

**Evidência promovida.** `data/rex_profiles/integrator/aplib/evidence/2026-09-27-entrega2-indice-0-na-barra/` com `manifest.json` amarrando por SHA-256: binário sob teste `d192fd51…` (build da corrida 3, exercitado nas corridas 3 e 4), core Genesis Plus GX v1.7.4 `46a5521` `07c10476…`, ROM `558bea6c…`, cópias `69389ec2…`/`80249128…`, BPS `8bf6d3df…`(853 B)/`58ae4f0b…`(739 B), os dois relatórios verdes do WebDriver, os dois logs de falha, o JSON v2 da varredura, os relatórios `rex05`/`rex06` e os logs de gates. **ROM e capturas derivadas não são versionadas** — só hashes.

**Limites que continuam sendo parte da alegação.** Um dos 4 recursos aPLib de uma ROM BYOR; os dois recursos ineditáveis em 1 pixel nos dois domínios; execução sob core de harness, não hardware nem app distribuído; BYOR não roda no CI, então o CI atesta o contrato e não esta ROM; "editável" não é "compreendido" — a classe do alvo segue desconhecida. **Maturidade:** nada promovido; o produto continua `Experimental` (a UI o declara no cabeçalho do painel). **Sem merge, sem release, sem promoção de maturidade.**

**Push e CI registrados por SHA.** `git fetch` + `git push origin codex/rex-integrator-aplib-decode` → fast-forward `19c880f..9a4335f` (0 atrás, 6 à frente). Consulta **pontual**, no SHA publicado `9a4335f72bf0f463faa23cdfdd5db45059c71983`: workflow `CI` → **success** (`validate`, `linux-validate`), run `36315702049`; workflow `Desktop E2E` → **success** (`desktop-smoke`), run `36315702070`. O que esse verde **não** cobre continua sendo os aceites `#[ignore]` e o cenário `rex-aplib-byor-effect`, que consomem BYOR: BYOR não é dependência provisionável, então o CI atesta o contrato, não esta ROM. `npm run host:certify` foi executado antes do push (rc=0, `READY`, digital `60249508…`, log promovido no pacote). Este parágrafo foi escrito no commit só de texto `3326228`, que à época ficou sem consulta própria (precedente: `19c880f`, run `36305001760`).

**Consulta pontual do HEAD final `9e63adc` (revisão de 2026-09-27, a pedido do operador).** Push `9a4335f..9e63adc` (2 commits só de texto). `GET /repos/Misael-art/RetroDevStudio/commits/9e63adcc…/check-runs` → `validate` **completed/success** (job `108614432239`, 20m56s) e `linux-validate` **completed/success** (job `108614432149`, 12m40s); run `36317340061`, encerrado às 12:17:25Z. `Desktop E2E` não existe nesse SHA por filtro de caminhos do workflow (`.github/workflows/desktop-e2e.yml`: `src/**`, `src-tauri/**`, `scripts/e2e-tauri-build-run.mjs`, `scripts/build.mjs`, `package*.json`) — `9e63adc` tocou só os dois documentos e o `manifest.json` do pacote; ausência explicada, não lida como PASS nem como falha. **Regra terminal:** o CI da rodada para de ser consultado aqui — o commit que registra esta célula é só texto e não recebe consulta própria, sob pena de uma consulta por commit de registro ao infinito. Nenhum observador ficou de pé (o `gh run watch` desta sessão terminou sozinho; `ps` não retorna `gh run` vivo).

### CHECKPOINT operacional (2026-09-27 — frente do integrador: a edição contextual do recurso aPLib fecha pela **interface**, com dois defeitos reais achados por ela; Experimental; sem merge, sem release, sem promoção)

**Frente e HEAD.** Branch `codex/rex-context-aplib-tilemap`, base canônica
`/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21`. A célula é a prova pelo
produto dos itens 1 a 4 do briefing do operador; os quatro commits que montaram a
superfície já estavam publicados (`c731485` fixture autoral com esperado **antes**
de compilar, `b9cbe8e` modelo de contexto no núcleo, `560347e` IPC somente leitura,
`896a372` UI contextual). Desta célula: `e44f39d` (núcleo), `16ce6bf` (UI) e
`7e10944` (cenário E2E `rex-context-fixture-effect`). **Ordem recebida que guiou o
fechamento:** "O próximo resultado visível deve ser uma edição contextual
utilizável, não apenas outro relatório do backend" + "Não aceite coordenadas,
dimensões ou offsets da UI como autoridade" + "Depois execute o caso BYOR já
comprovado, distinguindo camada reconstruída de framebuffer completo".

**O que passou a existir de fato (medido no WebView, não no núcleo).** Binário
`f56be4517058e38c…` (18:51:20-03:00 = 21:51:20Z; nenhum fonte do produto é mais
novo — `find … -newer <binario>` vazio), cenário rc=0 com 17 passos e 15 638 ms:
a barra descobre o TileSet sozinha (`0x5fa38 — aplib · 16 tiles (stream 169 B)`),
monta contexto com identidade + vínculos + proveniência por vínculo, e a **camada
composta lida do `<img>`** é igual ao esperado do oráculo externo no empacotamento
certo (RGB `7dc94b02…`; alpha provado à parte, 0 divergências RGBA). Os quatro
cliques sob `B`/`H`/nenhum/`V` convergem no **mesmo** pixel de fonte
(`tile 2, linha 4, coluna 7`, índice atual 11) e a barra diz
`4 ocorrências neste mapa verificado`, nomeando o TileMap. Uma edição (11→3) pela
transação canônica altera **exatamente** as quatro posições previstas, 129 bytes,
**0** fora de `[0x5fa38, +169)`, com o único byte do tileset em `0x5fa57`; cópia
`1d6da6d9…`, BPS `2fafda41…` reaplicado reproduzindo o hash da cópia; salvar/reabrir
restaura com identidade **revalidada**. Escala de página 0,75 e clique fora da
camada também assidos.

**Os dois defeitos reais que a interface achou — e que o núcleo não veria.**
(1) **Zoom pedido ≠ zoom desenhado**: o preflight `img { max-width: 100% }` com o
envolucro de flex encolhendo por padrão achatava **só a largura** — 4x de uma camada
120x72 desenhava `193,66x288` px, o pixel deixava de ser quadrado, `image-rendering:
pixelated` perdia o efeito e o mapa ponteiro→pixel da frente passava a corresponder
a outra imagem. Correção `16ce6bf`: `maxWidth: none` nas duas prévias, `shrink-0` no
envolucro dimensionado e trilho `overflow-x-auto` (rolar em vez de comprimir).
(2) **Identidade conferida depois da varredura**: com outro arquivo no caminho, a
transação varria os 205 candidatos (512 KB) e a recusa saía como "recurso não
verificado nesta ROM" depois de >60 s — o **sintoma** descrevendo a cena e escondendo
a **causa**, e o E2E estourando o timeout sem nenhuma superfície de erro. Correção
`e44f39d`: a identidade abre a sequência, o custo da recusa volta a ser um hash, e a
mensagem diz `nada foi varrido e nada foi escrito`. Em ambos os casos o teste foi
escrito e observado **falhando antes** (no de identidade, o primeiro rascunho passou
de imediato e não era RED; ficou discriminante ao usar `stream_offset` de **outra**
ROM, que morria em "recurso 0x109 não verificado nesta ROM"). O E2E agora **assere**
a recusa em ≤1,5 s em vez de só observar.

**Erro meu registrado com log.** A primeira versão desta perna cobrava na barra o
`data_size` do `symbol.txt` (170 B) — mas o símbolo dá o **array linkado**, com byte
de padding; o que a barra anuncia é o **consumo medido** pelo decode (169 B), que é o
que o oráculo `apj.jar` re-empacota. O cenário passou a ler `external-verify.json`
(exigindo `independente_do_produto === true`, SHA do jar, ROM e o `pixels_sha256` da
camada), a cobrar `medido <= array` e a conferir a cauda como zero, registrando
`preenchimento_nonzero`. Logs das três corridas falhas (run2 slot, run3 zoom, run4
identidade) estão versionados no pacote junto da verde.

**Caso BYOR reexecutado (o binário mudou, então a evidência antiga estava
invalidada).** `rex-aplib-byor-effect` rc=0, 0 linhas de ERRO: cópia `80249128…`,
BPS `58ae4f0b…` reaplicado sobre base íntegra, 800 bytes distintos, **0** fora de
`[0x2e12a, +938)`, 163 recursos preservados, 14 edições recusadas por
`excessive_output` e o índice 0 produzindo a cópia `69389ec2…` que a perna 3 já
tinha executado no core — **idêntico aos pinos publicados** antes desta célula. A
perna 14 do cenário contextual abre o BYOR pelo produto e **declara** a prévia como
camada reconstruída (`1018 ocorrências neste mapa verificado`, TileMap `0x21b28` de
1120 células), mantendo as oclusões não modeladas explícitas na barra: camada ≠
framebuffer.

**Negativos e atribuição honesta.** Seis obrigatórios: quatro alcançados e asseridos
pela UI (ghost sem vínculo, tile fora do conjunto, identidade trocada na leitura e na
escrita, resposta obsoleta no mesmo tick, descarte por troca de ROM, clique fora da
camada). Dois são **inalcançáveis por construção** nesta fixture — a referência
inválida e o banco sem cores vivem em `ctx_ghost`, que o linker deixou **sem** struct
`Image`, então não há como a UI chegar lá; ficam provados no núcleo por
`composicao_recusa_referencia_fora_do_tileset_em_vez_de_pintar_ruido` e
`composicao_recusa_banco_que_a_paleta_nao_tem_cores`, e a matriz registra a atribuição
em vez de inflar a prova de interface.

**Gates e host (logs no pacote).** `npm run host:certify` rc=0 — `READY`,
fingerprint `60249508…`, lock `dd99a22f…`, incluindo `check:tree` OK, `lint` OK e
**737** testes de frente (3 skipped) — e `cargo test --lib -- --nocapture
--test-threads=1` **737 passed / 0 failed / 66 ignored** em 104,30 s. Fora do
certify: `cargo fmt --check` OK, `cargo clippy -- -D warnings` limpo,
`npx tsc --noEmit` OK, harness com `node --check` + eslint limpos. Um job pesado por
vez, serializado (E2E fixture → E2E BYOR → certify → fmt/tsc/clippy); nenhum
observador de CI ficou de pé. **Invocação que errei e consertei no meio:** `cargo
clippy` na raiz do repositório falha com "could not find Cargo.toml" — a barra do
projeto é rodar de `src-tauri` (`.cargo/config.toml` fixa `target-dir = target-test`
relativo ao diretório de invocação).

**Limites que continuam sendo parte da alegação.** A frente continua `Experimental`
e a UI declara isso. "Verificada" nomeia o que foi conferido (ponteiro do struct
`Image`, decode com tamanho exato, round-trip pelo oráculo externo) e **não** prova
que o jogo carrega ou exibe o recurso. Não existe controle de "editar só esta
ocorrência": sem duplicação e realocação de tile isso seria destrutivo. Contagem de
ocorrências é **por mapa verificado**, nunca do jogo inteiro. Prioridade (bit 15) é
conferida na palavra da célula mas não entra na composição esperada. O perfil vale
para o toolchain pinado (rescomp `502a4670…`, apj `2d8cdc63…`, libmd `ef904a37…`) e
para os recursos demonstrados. BYOR não é dependência provisionável: os dois
cenários consomem ROM local explícita e não rodam no CI — o CI atesta o contrato, não
esta ROM. **Sem merge, sem release, sem promoção de maturidade.**

**Evidência promovida.** `data/rex_profiles/integrator/context_fixture/evidence/2026-09-27-interface/`
com `manifest.json` amarrando por SHA-256: binário sob teste `f56be451…`, ROM
autoral `705b72eb…` (393 216 B, **não** versionada — refaz pelo README do fixture),
ROM BYOR `558bea6c…` (só hash), oráculo externo `apj.jar` `2d8cdc63…`, as três
receitas autorais (ground truth pré-compilação, `fixture-build-report.json`,
`external-verify.json`), o relatório verde do WebDriver (`3778e45e…`), os três logs
de falha que produziram as correções, o relatório da reexecução BYOR (`ea14fd21…`) e
os logs de gates/certify. O bloco `gates.shas_de_todos_os_artefatos_promovidos` do
manifesto amarra **os 12 arquivos versionados do pacote** por SHA-256 (re-conferidos por
`sha256sum` às 22:24Z; o manifesto não hashia a si mesmo). **Sem merge e sem release: HEAD
desta célula fica na branch da frente.**

**Gates desta célula (medidos, não copiados).** `npm run check:tree` rc=0 **depois** de
criar o diretório de evidência (o `host:certify` rodou antes de
`data/rex_profiles/integrator/context_fixture/` existir, então a conferência de árvore foi
repetida de propósito às 22:23:37Z e o resultado foi **acrescentado ao log promovido**, com
rc medido do processo do npm e não de um pipe — a primeira versão media o `grep`) ·
`npx tsc --noEmit` rc=0 · `npm test` **737 passed, 3 skipped** · `cargo fmt -- --check`
rc=0 · `cargo clippy -- -D warnings` rc=0 (a barra do projeto roda clippy **de
`src-tauri`**: `src-tauri/.cargo/config.toml` fixa `target-dir = "target-test"` relativo ao
diretório de invocação, e rodar na raiz dá "could not find Cargo.toml") · `cargo test --lib`
**737 passed, 0 failed, 66 ignored** (104,30 s) · `node --check` e eslint do harness
`scripts/e2e-tauri-build-run.mjs`, ambos limpos · `npm run host:certify` rc=0, `READY`,
digital `60249508…`. Onde cada número mora, para não pedir confiança: no
`host-certify-2026-09-27.log`, `npm test` está na linha 1450, `cargo test --lib` na 2335 e
`READY`/fingerprint nas 2342/2344; no `gates-rust-ts-2026-09-27.log`, fmt na 2, clippy na 4,
tsc na 8 e `check:tree` nas 9–11. Execução serializada, um job pesado por vez.

**Push e CI registrados por SHA.** Push `896a372..7e10944` (fast-forward, 3 commits:
`e44f39d` núcleo, `16ce6bf` UI, `7e10944` cenário) → runs criados às **22:10:22Z**:
`CI` `36354347243` e `Desktop E2E` `36354347306`. Consulta **pontual** nos SHAs relevantes:
`b9cbe8e` → `validate`/`linux-validate`/`desktop-smoke` **completed/success**; `896a372` →
idem, **success**; `560347e` → **zero check runs** (o commit entrou no push cujo tip era
outro; ausência explicada pelo comportamento do GitHub em pushes em lote, **não** lida como
PASS nem como falha); `7e10944` → **`in_progress` nas duas consultas feitas nesta célula**
(a última às 22:21:29Z): o veredito não estava disponível no momento do registro, então
consta como **não estabelecido**, não como verde. **Regra terminal aplicada
(precedente `19c880f`):** nenhum monitor de CI ficou de pé e a conclusão dessa execução é
reportada **fora** do repositório — criar um commit só para registrar o veredito geraria
uma consulta por commit de registro, ao infinito. O commit que contém este parágrafo é só
de texto (docs + evidência) e não recebe consulta própria. O que o CI cobre aqui é o
contrato: os dois cenários consomem ROM local explícita e não rodam no CI.

### CHECKPOINT operacional (2026-09-28 — frente do integrador: `crates/` formalizado na árvore e duas bibliotecas standalone integradas uma por vez; nenhuma delas alegada ao produto; sem merge, sem release, sem promoção)

**Frente e HEAD.** Branch própria `codex/rex-integrator-crates-registry` sobre a
base canônica `9b27941` (que é o HEAD da rodada contextual de 2026-09-27). A rodada
anterior tinha deixado as duas suítes (agente A de endereçamento, agente B de
codecs) **fora** deste tronco; o operador mandou mudar isso no modo certo: cada
frente continua no seu módulo e na sua evidência, e o integrador fica com as
superfícies compartilhadas. **Ordem recebida:** "Reserve para si manifests
compartilhados, registro de módulos, IPC, UI, harness principal e documentos de
estado. Integre uma entrega por vez; não espere a conclusão das duas para começar a
revisão. Formalize crates/ nas convenções do projeto, preservando a finalidade de
check:tree", e a decisão em sete itens que fixou: `crates/` é a
localização **oficial** das bibliotecas Rust independentes com gates próprios;
integração ao aplicativo é etapa **posterior**, depois da revisão de cada biblioteca;
proibido criar `Cargo.toml` de workspace na raiz só para fazê-las compilar; a gate de
árvore não pode virar caixa livre ("não permita qualquer diretório
indiscriminadamente"); pacote esperado ausente **reprova**; "não registre 'integrado
ao produto' só porque o pacote compila"; e a matriz precisa diferenciar
`biblioteca implementada → gates próprios aprovados → backend integrado → fluxo do
usuário comprovado`.

**O que passou a existir (cinco superfícies, todas do integrador).** (1)
`docs/08_TREE_ARCHITECTURE.md` declara `crates/<nome>/` mais `crates/registry.json` e
`crates/README.md`, com regras de inserção explícitas. (2) `scripts/check-tree.cjs` e
o espelho `scripts/check-tree.ps1` aceitam `crates/` **sob condição de registro**:
diretório não registrado reprova, registro sem `Cargo.toml` reprova, arquivo solto
que não seja registro/README reprova, e o resto da verificação de primeiro nível
permanece. Um dos sete testes novos (`scripts/check-tree-crates.test.mjs`) exige
que as duas implementações aceitem o **mesmo** conjunto de diretórios — a gate
espelhada não pode divergir silenciosamente. (3) `crates/registry.json`, schema
`rex-crate-registry/v1`, é a fonte única da lista; `crates/README.md` registra os
três comandos, os quatro degraus e a frase-operativa "compilar não significa
integrado". (4) `scripts/crates-gates.mjs` + `npm run crates:gates` emitem, por
pacote registrado e na ordem pedida, `cargo fmt --manifest-path <m> -- --check`,
`cargo clippy --manifest-path <m> --all-targets -- -D warnings` e
`cargo test --manifest-path <m> --locked`, com `CARGO_TARGET_DIR` fora da árvore
rastreada e rc=1 para registro ausente/schema errado/pacote sem manifesto. (5) CI:
passo *Crate package gates* nos dois jobs de `.github/workflows/ci.yml`, com
`outcome` na janela de resumo; como os dois jobs rodam em todo push/PR, a ativação
dos gates não exigiu afrouxar filtro de caminho nenhum.

**Não-vacuidade provada, não alegada.** A regra "pacote declarado sem manifesto
reprova" foi mutada temporariamente (`if (false && fs.existsSync(...))`) e caíram
**exatamente** os dois testes que a cobrem; revertido, o suíte voltou a verde. O
mesmo critério vale para o gate de árvore: os testes afirmam sobre a saída do
script numa árvore falsa via `RDS_CHECK_TREE_ROOT`/`RDS_CRATES_ROOT`, e a
existência desse gancho de ambiente está documentada como suporte a teste, não como
comportamento do produto.

**Integração da B (primeira, sozinha).** `3fea06e` + `1af7017` (PR #81, pino revisto
`0b752b7`) entraram por `cherry-pick -x` como `crates/rex-kosinski`, sem merge de
branch e sem tocar a branch da agente. Gates medidos 2026-09-28T02:48Z: fmt OK,
clippy `--all-targets -D warnings` OK, `test --locked` **25 executados / 0 falhas / 0
ignorados** (22 contract + 3 mutations) — a mensagem do commit anuncia 24, registro o
número medido. **A primeira corrida falhou** e a causa não era do pacote: 15 de 25
testes com "fixture golden/…: No such file or directory", porque o crate lê fixtures
por `CARGO_MANIFEST_DIR + ../../data/rex_profiles/codec/kosinski` e esse perfil só
existia na outra linha de branch da B. Fechei como integrador: importei os dados e os
scripts geradores no **mesmo pino**, conferi as 27 linhas de `manifest.tsv` (0
divergências de SHA) e reproduzi o hash agregado `ea866df7…`. **Não reescrevi o teste
de outra agente.** Devolvido à B como trabalho dela: vendorizar as fixtures dentro do
crate (ou receber o caminho por variável de ambiente) para o pacote ser relocável, e
acrescentar a metadata `license` que falta. Ficaram fora desta entrega — e isso está
no registro, não escondido: o contrato v1 do **encoder** (`0b752b7`) e o WIP não
commitado `src/encode.rs`.

**Integração da A (segunda, separada).** Os 17 commits do intervalo
`9b27941..57e51d3` (PR #82) entraram por `cherry-pick -x`, zero conflitos, e o
`git mv` de `scripts/rex_profiles/addressing_runtime/rex-addressing` para
`crates/rex-addressing` executou exatamente o "passo 2" que o `CONTRATO.md` do próprio
perfil apontava como pendente do integrador; a seção "Por que está aquí e non en
`crates/`" do README do pacote foi substituída pela localização atual, e a resolução
do integrador entrou no contrato **como adenda datada** — evidência histórica não se
reescreve. Gates medidos 2026-09-28T02:58Z já na localização nova: fmt OK, clippy OK,
`test --locked` **81 executados / 0 falhas / 9 ignorados** (77 em 10 targets + 4
doc-tests). Os 9 ignorados são os 8 BYOR e o preimage exaustivo, então o gate
ordinário do pacote não depende de ROM comercial — requisito do item 4 da ordem.
Diferença medida e registrada: o README do pacote anuncia 72 testes, a suíte
integrada executa 77. Devolvido à A: os 15 `.expect()` de produção não têm varredura
adversária que prove o invariante no gate. WIP da A (`tests/resource_reader.rs`,
`tests/support/banked.rs`) segue no worktree dela e não foi tocado.

**Matriz e não-promoção.** Seção nova no estado corrente de
`docs/rex_profiles/ROUND_STATE.md` ("Matriz de bibliotecas standalone (`crates/`)"),
com os dois pacotes em `biblioteca implementada: verified` + `gates próprios
aprovados: verified` e **`backend integrado: blocked`** e **`fluxo do usuário
comprovado: blocked`** nos dois. Nenhuma das matrizes anteriores (endereçamento da A,
codecs da B) foi mexida: continuam `blocked`, que é a verdade operacional. Não há
`rex-kosinski` nem `rex-addressing` em `src-tauri/Cargo.toml`, não há adaptador, não
há chamada real pelo backend, e os 737 testes do produto não exercitam os dois
pacotes. `docs/rex_profiles/CONTRACTS.md` ganhou a §6 formalizando a reserva de
superfícies (manifests e lockfiles, registro de módulos, `src/core/ipc/`,
`src/components/`, `scripts/e2e-tauri-build-run.mjs`, `scripts/check-tree.*`,
`scripts/crates-gates.mjs`, `ci.yml`, documentos de estado) e preservando o namespace
de evidência de cada frente.

**Decisão arquitetural registrada (não conflita com as consolidadas).** `crates/`
passa a ser a localização oficial das bibliotecas Rust **standalone** desta árvore,
dirigidas por `--manifest-path` a partir do registro, **sem** workspace na raiz e
**sem** dependência do produto. Isso é decisão de *convenção de árvore e de gates*,
não das "Decisões Arquiteturais Consolidadas": o aplicativo continua com o build que
já tinha.

**Gates desta barra (logs versionados, cada número com onde mora).** Pacote
`data/rex_profiles/integrator/crates_registry/evidence/2026-09-28-barra-de-entrega/`,
com `manifest.json` amarrando SHA-256 por arquivo e o HEAD sob barra `9f83d15f…`:
`check:tree` rc=0 (`gates-frontend.log:6`) · `lint` rc=0 (`:10`) · `tsc --noEmit`
rc=0 (`:14`) · `npm test` **747 passed / 6 skipped (753)** em 118,35 s (`:41-42`, rc
`:46`) · `npm run crates:gates` rc=0, seis gates verdes (`gates-crates.log`: kosinski
`:6/:9/:61`, addressing `:64/:67/:238`, rc `:241`) · `cargo fmt -- --check` rc=0 e
`cargo clippy -- -D warnings` rc=0 do produto (`gates-rust-produto.log:3,6`) ·
`npm run host:certify` rc=0 com **READY**, fingerprint `60249508…`, lock `dd99a22f…`
e `cargo test --lib` **737 passed / 0 failed / 66 ignored** (`host-certify.log:2357`,
`Success: true` `:2363`, `READY` `:2364`). Reconciliação: o registro anterior era
**737/3 (740)**; **+13** são exatamente os dois arquivos de teste desta rodada
(verificados isolados: 13 passed / 0 skipped), e os 3 skips a mais estão em suítes
pré-existentes condicionadas a toolchain/plataforma
(`src/core/validateUpstreamWindows.test.ts`, `scripts/decomp/decomp-scripts.test.mjs`),
não nesta entrega. Os 737 do produto não se moveram porque nenhum fonte de produto
mudou. Jobs pesados serializados, um por vez; nenhum observador de CI deixado de pé.

**Push, CI e a gate reprovada pelo próprio gate.** O push abriu a branch remota
`codex/rex-integrator-crates-registry` no SHA `a556e86`; a consulta foi pontual, sem
monitor, e o rollup terminal (`…/2026-09-28-barra-de-entrega/ci-consulta-a556e86.log:80`)
dá `linux-validate` **success** (`:60`), `desktop-smoke` **success** (`:77`) e
`validate` (windows-latest) **failure** (`:73`, `:78`) — passo 15 *Frontend tests*,
**2 failed / 729 passed / 22 skipped (753)**; o total de 753 bate com o Linux, e os
22 skips foram depois lidos no log do próprio job Windows e decompostos (host-manager 5 +
`decomp-scripts` 11 + `linux-host-scripts` 6 — apêndice de
`…/2026-09-28-gate-cross-platform/ci-windows-1abad5d-extract.log`). Os passos 10 *Structure check* e 13
*Crate package gates* passaram no Windows: os gates dos dois pacotes também correm lá.
Quem reprova são **dois testes meus** (`scripts/check-tree-crates.test.mjs:77`, `:96`)
contra **código meu**: `scripts/check-tree.cjs:47` compunha com `path.join` o caminho
que a gate **imprime**, então no Windows saía `crates\registry.json` enquanto o
espelho `.ps1` imprime `crates/registry.json` — as duas implementações da mesma gate
divergiram na saída. O exame achou um segundo defeito, de veredito: o `.cjs` passava
`path.normalize` no `manifesto` declarado, e no Windows as duas margens convergiam em
barras, portanto uma declaração fora do caminho canônico seria **aceita em silêncio**
— a checagem mordia só no Linux. Reparo `882272c`: caminhos exibidos viram literais
POSIX nas duas implementações e a comparação passa a ser literal (o `.ps1` foi
apertado no mesmo ponto); as duas asserções continuam estritas — o errado era a
produção, não o teste. Não-vacuidade provada por mutação no Linux (reverter o caminho
exibido derruba exatamente 1 teste; reintroduzir o `path.normalize` derruba
exatamente 1 teste; restauração conferida por SHA-256) e paridade real entre `.cjs` e
`.ps1` executados com `pwsh 7.6.6` em quatro casos (`…/2026-09-28-gate-cross-platform/red-green-mutacao.log`
e `parity-cjs-ps1.log`). Barra do reparo: `check:tree`, `lint` e `tsc --noEmit` rc=0,
`npm test` **749 passed / 6 skipped (755)** — os 2 a mais são os dois testes novos
(`gates-frontend-fix.log`). **O veredito pendente chegou medido:** no SHA do reparo
(`1abad5da356781d…`, run 36375754209) o job `validate` de `windows-latest` fechou
**success** (job 108781125205, 03:57:59Z→04:21:14Z, dezoito passos em success), com o
passo 15 *Frontend tests* — onde antes reprovava — e o 16 *TypeScript check* passando.
No runner Windows a suíte da gate aparece com **9 testes e 0 falhas**; os caminhos
impressos são POSIX lá (`crates/rex-kosinski/Cargo.toml`, `crates/rex-addressing/Cargo.toml`)
e o shell do runner é PowerShell. Contagens: **733 passed / 22 skipped (755)** no Windows
contra **749 / 6 (755)** local, decompostas arquivo por arquivo nas duas margens e
reconciliadas (18 − 2 = 16 = 22 − 6 = 749 − 733). Extrato com linha por linha em
`…/2026-09-28-gate-cross-platform/ci-windows-1abad5d-extract.log`; a varredura da mesma
classe nos testes de `scripts/` não achou outra asserção que componha caminho com API de
caminho — mas devolveu um item para o próprio integrador: `crates-gates.mjs:119-123` ainda
aceita o campo `manifesto` como declarado, e quem reprova a declaração torta é o
`check:tree`, que roda antes no mesmo job; a ordem ficou registrada em vez de a checagem
ser duplicada. **Ainda não provado:** integração ao produto, fluxo de usuário, maturidade.

**Limites que continuam sendo parte da alegação.** `crates/` é degrau de
**biblioteca**: a rodada não torna nada "integrado", não prova fluxo de usuário e não
promove maturidade — as duas bibliotecas seguem de frente `Experimental`. O produto
continua com os codecs que já tinha (LZ4W e aPLib na transação canônica e na UI), e
nenhuma linha de `src-tauri/src/tools/reverse/decomp/` foi tocada aqui. A comparação
com ferramenta externa (koscmp) continua fora da suíte ordinária, no script do perfil
(`scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh`). ROM
comercial e corpus BYOR seguem fora da árvore e fora dos gates. **Sem merge, sem
release, sem promoção de maturidade.**

### 2026-09-28 — integración da fronte A ao produto (`backend integrado`) e rolda de aceite

**Subida de degrau, medida e con non-vacuidade.** `crates/rex-addressing` deixou de ser
só biblioteca con gates propios: entrou en `src-tauri/Cargo.toml` como
`rex-addressing = { path = "../crates/rex-addressing" }` (sen workspace na raiz;
`Cargo.lock` de 495 a 496 entradas `[[package]]`, a nova **sen** campo `source` e cero
crates externos), o adaptador vive en
`src-tauri/src/tools/reverse/decomp/rex_addressing.rs` (SHA `7bd75ea9…`, sen cambios
desde a integración) e o comando Tauri `rex_addressing_read_snapshot` está rexistrado
en `generate_handler!`. O contrato do adaptador é decisión do integrador: serialización
no adaptador (o crate segue libre de Tauri/serde), erros estruturados
`InspectionError { code, message, retryable }` sen aplanar falhas do núcleo, perfil e
estado explícitos sen autodeección, identidade da ROM conferida no límite de acceso a
bytes (`rex_read_rom` + `platform::identify_md`, literal `rom_identity_mismatch`), e
só a lectura con snapshot fixo nos dous perfís MD exposta — `read_sequence`, as
escritas e os tres perfís SNES declarados como non expostos no rexistro
(`crates/registry.json`, `maturidade: backend-integrado`). Medido 08:14Z–09:25Z:
**17 probas do adaptador / 0 falhas**, suite `cargo test --lib` **754 / 0 / 66**
(base 737 + 17), gates rc=0. Non-vacuidade: RED observado (16 fallos antes da
implementación) e tres controles de mutación (garda de identidade, procedencia do
segmento, aplanamento de erros) mataron 1/2/8 testes con restauración conferida por
SHA. Fluxo de usuario segue `blocked`: ningún chamador da interface usa o comando e
non hai pantalla de enderezamento.

**Rolda de aceite (segunda perna do día).** `git ls-remote` deu `0e5f804` en
`codex/rex-rust-addressing` — cinco commits mais recentes ca pin `30cb311` xa
integrado (15 vectores en `vectors/acceptance-v1.json`, SHA `54ba2b6e…a216` pinada
dentro de `tests/acceptance.rs`, esperado dun oráculo independente: táboa `boards.bml`
de bsnes + modelo GPGX; rexenerar o JSON require `REX_ACEITE_ESCRIBIR=1` con
`--ignored`, que non se executou). Entraron un a un: dous que tocaban o crate
reescritos de `scripts/…/rex-addressing/` a `crates/rex-addressing/` conservando
autor, data e mensaxe, tres de solos `docs/` por `cherry-pick -x`. **Achado sobre o
mi propio traballo, non de A:** a promoción `9f83d15` deixara
`examples/resource_report.rs` na ruta vella (o paquete graduado ás 08:14Z non tiña
exemplo e `clippy --all-targets` nunca o lintaba) e catro ligazóns relativas do README
do paquete apuntaban tres niveis por riba da raíz. Reparado en `daefb43` (blob
idéntico `7f9a8f5b…`, 0 ligazóns rotas, receitas `cd …` e `CONTRATO.md` §0.1
corrixidos; a evidencia histórica co worktree de A mantense tal cal). Re-medido
11:44Z–12:02Z: gates do paquete **138 executados / 0 falhas / 10 ignorados** en 17
targets (reproducindo exactamente os números de A), exemplo rc=0 desde a localización
nova (resumo `27bebc7b…`), `cargo test --lib` **754 / 0 / 66** con `CARGO_RC=0`
directo (a primeira captura pipesouse a `tail -30` e o seu rc era o de `tail`;
conservouse como `captura-defectuosa-rc-do-pipeline-e-tail30.log`), e barra de
frontend no HEAD final `1f30467` 12:18Z–12:20Z con rc=0 nos tres (`npm test` **749
pasados / 6 saltados / 755**). Evidencia en
`data/rex_profiles/addressing_runtime/evidence/2026-09-28-aceite-integrado/`
(manifesto autocomprobado: 7 artefactos listados, 7 presentes, 0 diverxencias).
**O que a rolda non prova:** os vectores gradúan `read_resource`/`read_sequence`,
superficies que o adaptador non expón — non son evidencia do adaptador nin suben
ningún degrau.

**Estado aberto desta fronte.** Licenza: `rex-addressing` entra no inventario como
`source: workspace` co `license: UNLICENSED` que o paquete xa declaraba; **escoller
licenza é decisión do operador**, non se fixo por suposición. Fronte B: o paquete
`rex-kosinski` ten empacotamento e gates propios (tip `6a2218e`, 52 fixtures con
SHA-256 dentro do crate), pero a perna seguinte — chamadas reais de decode/encode polo
backend adaptadas ao contrato de codecs existente (`CodecError { code, detail }`,
preservando decodificar/codificar/reinserir como operacións distintas; o exemplo de
edición en contedor non substitúe a transación canónica) — aínda non executou. Nada
deste día é merge, release nin promoción de maturidade; ambos os paquetes seguen
`Experimental`. Deuda coñecida e allea, rexistrada como fallo sen tocar: `cargo clippy
--all-targets -- -D warnings` do produto dá rc=101 con 45 lints en código de proba
alleo (0 en `rex_addressing.rs`) e `npm run security:audit` dá rc=1 por
`EALLOWSCRIPTS` (config do host anterior; ningún ficheiro npm se modificou).

### 2026-09-28 — integración da fronte B ao produto (`backend integrado`, só ese degrau)

**Que se fixo.** A perna B executou despois da A, unha entrega por vez. Primeiro
entrou a entrega mais recente da B no crate (`0b752b7..6a2218e`, pino conferido con
`git ls-remote` ás 14:38:34Z): encoder v1, paridade koscmp bidireccional, contedor de
edición autoral e 52 fixtures vendorizadas con SHA-256 dentro do paquete, por
`cherry-pick -x` con paridade byte-exata (diff = 0 bytes) e gates re-medidos **51/0/0**.
Despois construíuse o adaptador `src-tauri/src/tools/reverse/decomp/rex_kosinski.rs`
por TDD estrito: dous RED observados e guardados (capa codec e capa IPC, ambos E0432
`rc=101`), GREEN **16/16** (10 capa codec + 6 capa IPC). O adaptador mapea
`KosError`/`EncError` ao `CodecError { code, detail }` do contrato de codecs do produto
1:1 (truncated / invalid_reference / excessive_output / work_limit / empty_input;
stream_limit / work_limit), preserva `bytes_consumed` (contrato v1 §3: o padding
post-terminator non se consume) e expón **dous comandos Tauri reais**, separados como
pedía a misión: `rex_kosinski_decode` e `rex_kosinski_encode` (`run_heavy_command_
off_main_thread`, rexistrados en `generate_handler!`). `Cargo.lock` gañou 5 liñas: só a
entrada local `rex-kosinski` sen campo `source`, cero crates externos novos.
**Números medidos no destino:** `cargo test --lib` **770/0/66** (base 754 + 16),
`clippy --lib -D warnings` rc=0, `fmt --check` rc=0, `check:tree` rc=0, barra de
frontend sen cambios (749/6/755, rc=0). Non-vacuidade: mutacións M1/M2/M3 mataron
1/1/2 probas e a restauración conferíouse por SHA-256 do adaptador (`3b4115ab…`).
Evidencia con manifesto autoconferido (4/4/0) en
`data/rex_profiles/kosinski_runtime/evidence/2026-09-28-adaptador-backend/`. Commits:
`3428b69` (adaptador + IPC), `9894e88` (evidencia), `4daefe8` (rexistro + matriz),
`daa52da` (rollup CI de ebfa8ea).

**Fronte A pechada por SHA.** O rollup CI do push `ebfa8ea` conferíose con consultas
pontuais: `CI` success; `Desktop E2E` fallou o escenario `reference_goal` cun timeout no
límite (15274 ms sobre orzamento de 15000 ms, 'esgotamento de tempo, nao um defeito
confirmado'); a reexecución do job fallido **no mesmo SHA** deu success. Veredicto por
SHA, sen aprobación retroactiva de ningunha entrega anterior. Log en
`.../2026-09-28-aceite-integrado/ci-consulta-ebfa8ea.log`; manifesto a 8/8/0.

**O que a rolda non proba.** `rex-kosinski` está en `backend-integrado`, non máis alá:
ningunha pantalla chama os comandos (fluxo do usuario bloqueado), ningún recurso real
BYOR se decodificou/recodificou polo produto, e o contedor `edit::build/open/reinsert`
**non se expón** — a propia doc del di «NON transacción canónica de producción», e a
distinción decodificar/codificar/reinserir presérvese por exclusión declarada, non por
implementación.

**Estado aberto.** Licenza dos dous crates (`UNLICENSED`, `source: workspace`) segue
decisión do operador. O siguiente degrau para B é fluxo do usuario (UI que chame
decode/encode) ou reinserción na transación canónica — ambos requiren decisión explícita
do operador antes de calquera promoción.
