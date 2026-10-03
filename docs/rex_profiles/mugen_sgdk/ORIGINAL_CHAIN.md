# MUGEN: do Ken visual ao comportamento original convertido (Experimental)

Missão de 2026-09-30. Esta frente converte **uma cadeia pequena e real** do CMD/CNS do Ken Majik —
comando → condição → mudança de estado → animação → condição de retorno — com origem rastreável,
execução na ROM oficial e comparação com uma referência independente. O estado operacional continua
no Memory Bank e a maturidade continua `Experimental`; nada aqui promove suporte geral a MUGEN.

Base: PR #90 (`codex/rex-mugen-real` @ `508db51b20c701f61a8fcdbc9bf43a642d28fa3c`, aberto, base
`codex/rex-mugen-locomotion`). Branch desta frente: `codex/rex-mugen-original-chain`, worktree
`REX-MUGEN-ORIGINAL-2026-09-30`, PR dependente (base `codex/rex-mugen-real`). Sem merge nem release.
O checkout do integrador, os worktrees dos territórios corpus A–F e a branch da entrega verificada
não foram tocados. Na abertura não havia app, build nem harness RetroDev ativo (só apps de terceiros do
host); builds e emulação pesada rodaram um passo por vez, na própria worktree.

## 1. Conquista visual preservada

A seleção visual não foi reduzida: ações 0/20/21/200, `ken1.act`, 15 cores opacas, zero fusões,
célula 104×104, âncora (51,98), 21 prévias. As mesmas provas do PR #90 foram reexecutadas **neste
binário** e passaram: oráculo Pillow (`verify-mugen-real.py`: 21 prévias, 204 quadros do core, 211 da UI,
5 controles negativos recusados, core = canvas), `mugen-import`, `mugen-control` e `mugen-locomotion`.
O modo `authored_visual_demo` continua o padrão do assistente e segue rotulado como autoral.

Duas execuções de `mugen-real` falharam sob carga alta do host (load ≈ 9 por apps de terceiros): uma
em `Select mugen-review-frame` logo após a troca de ação, outra no timeout de 120 s da triagem. A
terceira, sem mudança de código, passou integralmente. Registrado como flutuação do harness sob carga,
não como regressão.

## 2. Auditoria da cadeia original

DEF → CMD → CNS → dependências comuns → AIR, do pacote `Ken_Majik_.zip`
(`b244ec9a105fa0131b37c075dc06b032a87cf0f839f46ec7054ac60d9bd6f14c`, uso autorizado pelo operador):

| Elo | Arquivo:linha | O que a fonte diz |
|---|---|---|
| versão | `ken8.def:6` | `mugenversion = 14/04/2001` |
| CMD / estados | `ken8.def:11,13` | `cmd = ken.cmd`, `st = ken.cns` |
| **comuns** | `ken8.def:15` | `stcommon = common1.cns ;Common states (in data/)` — **ausente** do pacote |
| AIR / paleta | `ken8.def:18,20` | `anim = ken.air`, `pal1 = ken1.act` |
| comando `x` | `ken.cmd:272-275` | `command = x`, `time = 1` (botão pressionado, janela de 1 tick) |
| comando `holddown` | `ken.cmd:339-342` | `command = /$D`, `time = 1` (baixo segurado) |
| entrada | `ken.cmd:963-971` `[State -1]` | `ChangeState 200` com `triggerall = command = "x"`, `triggerall = command != "holddown"`, `trigger1 = statetype = S`, `trigger1 = ctrl = 1`, `trigger2 = stateno = 200`, `trigger2 = time> 5` |
| estado | `ken.cns:285-294` `[Statedef 200]` | `type = S`, `movetype = A`, `physics = S`, `juggle = 1`, `velset = 0,0`, `ctrl = 0`, `anim = 200`, `poweradd = 15` |
| efeito | `ken.cns:296` `[State 200, 1]` | `HitDef` em `AnimElem = 2` (dano 34) |
| retorno | `ken.cns:343-347` `[State 200, 2]` | `ChangeState 0`, `ctrl = 1`, `trigger1 = AnimTime= 0` |
| efeito | `ken.cns:349` `[State 200, 3]` | `PlaySnd 6,0` em `time = 1` |
| animação | `ken.air:297-306` | ação 200: três elementos de 2 ticks (total **6**), caixa de ataque no 2º |
| idle | `ken.air:1-9` | ação 0: seis elementos de 6 ticks (laço de 36) |

**`common1.cns` não existe nesta máquina** (busca por nome em todo o disco; o pacote não traz `data/`).
Nenhuma outra instalação foi presumida equivalente. Consequência medida: toda cadeia de golpe do
`ken.cns` termina em estados comuns que o próprio `ken.cns` não define (alvos de `ChangeState` fora do
arquivo: 0, 1, 2, 3, 4, 11, 25, 50, 51, 183, 300, 5110; em pé → 0, agachado → 11, aéreo → 50/51). Não existe
cadeia autocontida de verdade; a escolhida (`Stand_X`, estado 200) é a menor cuja entrada, condição,
animação e condição de retorno estão **inteiras** na fonte. O alvo do retorno (estado 0) é um **stand-in autoral
mínimo e declarado** (`statetype S`, `ctrl 1`, `anim 0`, sem controladores) — não o estado 0 original.
Se o pacote trouxesse `stcommon` resolvível, o conversor leria o estado 0 de lá e registraria o hash
(teste `missing_common_is_reported_and_package_common_supplies_state_zero_with_hash`).

Documentação primária consultada (versão do DEF: 14/04/2001; as páginas são do Elecbyte 2002/2003, a mais
próxima acessível — a diferença é um risco declarado):

- [CNS format](https://www.elecbyte.com/mugendocs/cns.html): ordem de avaliação por tick (−3, −2, −1, estado
  atual; a mudança de estado aborta o resto e continua do início do novo estado no mesmo tick); `Time`
  começa em 0 na entrada; grupos `triggerall`/`triggerN` (E dentro, OU entre grupos); parâmetros do
  `Statedef` aplicados no início do estado.
- [Trigger reference](https://bluesura.github.io/MUGEN/document/Official/2002.04.14/trigger.html) (espelho do
  documento oficial 2002.04.14): `AnimTime` (diferença entre o *looptime* da ação e o tempo da animação; ≤ 0;
  0 ao fim), `Time`, `StateNo`, `StateType`, `Ctrl`, `Command`, operadores.
- [State controller reference](https://www.elecbyte.com/mugendocs/sctrls.html): `ChangeState` (`value`, `ctrl`,
  `anim`); **não define** a ordem entre `ctrl` do `ChangeState` e o `ctrl` do `Statedef` (irrelevante aqui).
- Comandos: `time`/`buffer.time` e `/`, `~`, `$` por [espelho](https://bluesura.github.io/MUGEN/document/Trigger/Command.html).
  O `cmd.html` oficial respondeu 403 no momento do registro: a semântica de **borda de subida** do botão simples
  e o padrão `buffer.time = 1` **não foram confirmados na fonte primária** (o Ken não tem `[Defaults]`).
  É o limite mais importante da semântica de comando; está rotulado `approximate`.

## 3. O que foi implementado

Conversor reutilizável em `src-tauri/src/core/mugen_chain.rs`; runtime C em `compiler/mugen_runtime.rs`;
contrato em `crates/rex-mugen/CONTRACT.md` («Cadeia original»). Subconjunto, e nada além dele:

- comandos de um elemento (`x`, `/x`, `~x`, `/$D`), `time = 1`;
- gatilhos `command =/!=`, `statetype`, `ctrl`, `stateno`, `time`, `animtime` com inteiros literais, `1`;
- `ChangeState` (`value`, `ctrl`); `Statedef` `type`, `ctrl`, `anim`, `velset` (x literal Q8.8, y = 0);
- ordem do tick: comandos → `-1` → estado atual (com reinício no novo estado) → rastro → `Time`/animação avançam.

Controlador, gatilho ou parâmetro fora disso deixa o **controlador inteiro** não convertido, com motivo; nenhuma
avaliação parcial. O relatório separa quatro classes e dá um veredito por estado (nenhum estado é «completo»
com itens de fora). Cada operação convertida carrega `{arquivo, seção, linha, texto}`; o `digest` do programa
cobre o mapeamento e qualquer adulteração (condição, alvo, linha, texto, mapeamento removido) bloqueia o build.

| Classe | Itens (relatório do Ken) |
|---|---|
| **convertido da fonte** (15) | comando `x` e `holddown`; `[State -1]` Stand_X com seus 6 gatilhos; `[Statedef 200]` `type`, `velset`, `ctrl`, `anim`; `[State 200, 2]` e seu `AnimTime = 0` |
| **aproximado** (2) | `AnimTime` = ticks desde a entrada − soma das durações do AIR; ordem por tick e janela de comando (`buffer.time` padrão não confirmado) |
| **autoral RetroDev** (2) | estado 0 stand-in; ligação de botões (MUGEN `x` → Mega Drive A, tecla Z: o teclado do produto não chega a X/Y/Z) |
| **não convertido** (66) | `poweradd`, `juggle`, `movetype`, `physics` do estado 200; `HitDef` (`ken.cns:296`) e `PlaySnd` (`:349`); 55 dos 56 controladores do `-1` (outros golpes, comandos em sequência, `power`, `MoveContact`…); os controladores de `-2` (`Pos y`, sons); todos listados no relatório com arquivo:linha e motivo |

Estado 200: **parcial** (6 convertidos, 6 não convertidos); estado 0: **autoral**.

## 4. Referência independente

`scripts/verify-mugen-chain.py` **não é o gerador da ROM**: lê DEF/CMD/CNS/AIR do pacote com parser próprio,
avalia **todos** os 56 controladores do `-1` e os de `-2` com lógica de três valores (Kleene), e simula o tick
a partir da ordem documentada. Comandos fora do que a entrada usou são provados *insatisfazíveis* pelo alfabeto
do fluxo de pad, não presumidos. Python/Pillow são pré-requisito de QA, nunca dependência do app.

Resultado esperado a partir da fonte, fixado **antes** da primeira execução (o script de entradas está nos
testes ignorados `mugen_original_chain_real_ken_capture` e `mugen_chain_walker_real_build_run`):

| Entrada | Esperado pela fonte | Resultado (ROM oficial, core Genesis Plus GX v1.7.4) |
|---|---|---|
| sem input | estado 0, `ctrl 1`, ação 0 em laço | idêntico em todos os ticks |
| toque em X | no tick da borda: estado 200, `ctrl 0`, ação 200, `Time 0`, vx 0; retorna ao estado 0 com `ctrl 1` em `AnimTime = 0` (6 ticks) | 6 ticks exatos em todos os ataques |
| segurar X | **um** ataque; sem nova borda não reentra | 1 ataque em 12 ticks de pad segurado |
| 2º toque com `Time ≤ 5` | ignorado (`trigger2` exige `time > 5`) | ignorado |
| 2º toque com `Time = 6` | `-1` vem antes do estado: reentra no 200 e reinicia a animação | reentra (backend, ticks 141/147) |
| X + baixo | não ataca (`command != "holddown"`) | estado 0 intacto (o motor original agacharia pelo `common1.cns`) |
| posição/velocidade | `velset = 0,0`: x constante | x constante, vx 0 |
| efeitos opacos | `poweradd`, `PlaySnd` em `Time = 1`, `HitDef` em `AnimElem = 2` | **listados** com o tick em que ocorreriam, não simulados |

Comparação tick a tick da ROM (estado, `Time`, `ctrl`, `StateType`, ação, relógio da animação, vx, comandos) com a
referência, alimentada pelo **pad que a própria ROM amostrou**: 0 divergências no core direto (197 ticks) e na UI
(336 ticks). Sete controles negativos da própria comparação (ataque um tick atrasado, `ctrl` não limpo, animação
errada, duração alterada, ataque extra ao segurar, vazamento de velocidade, `Time` não reiniciado) são recusados.
Pixels: cada quadro do core (184) e da UI (295) foi identificado contra os elementos AIR do Pillow e confere com
o elemento previsto pela referência (defasagem de apresentação **0 vblanks** pelo `vtimer`); 1 tick = 1 vblank em
todos os intervalos, nos dois caminhos.

O que a referência **não** prova: o mesmo entendimento da documentação está nos dois lados; `AnimTime`, a ordem do tick
e a borda do botão simples são leitura da documentação, não execução do motor original. Nenhum runtime MUGEN/Ikemen foi
usado como referência (não há instalação), então nada aqui é «verdade absoluta» do motor.

## 5. Caminho de input (toque que virou dez ticks)

Instrumentação: a ROM grava, a cada tick, o pad que **amostrou**; o harness registra no relógio da página
`keydown`/`keyup` nativos, cada `emulator_send_input` e cada `emulator_run_frame`. Um toque nativo é **uma**
requisição WebDriver (`keyDown`, `pause`, `keyUp`), sem duas viagens HTTP.

| Pergunta | Medida |
|---|---|
| Há avanço em lotes? | **Não.** A UI chama `emulator_run_frame` quadro a quadro: 295 chamadas = 295 quadros apresentados = 295 ticks; `vtimer` avançou 295; nenhum repaint extra |
| Latência de apresentação | o quadro é emitido dentro da própria chamada; o estado decidido num tick aparece no quadro desse tick (0 vblanks) |
| Entrega ao core | `keydown` → ack do IPC: 4–7 ms. A pressão vale no tick da chamada **em curso** ou da seguinte (o nível do joypad é escrito sob um lock próprio, fora do mutex do comando): em todos os toques entregues, a faixa de ticks com A segurado está dentro desses dois candidatos para a descida e para a subida (`delivery_consistent`) |
| Taxa do core de debug | período de quadro mediano **94 ms** (≈ 10,6 quadros/s): é o que transforma 1 quadro em ~0,1 s |
| De onde vieram os «dez ticks» | **do harness**: duas requisições WebDriver separadas + `waitFrames` por *polling* mantinham a tecla ~1 s ≈ 10 quadros. Com uma só requisição (execução final): pausa pedida 0/20/50/100/200/1200 ms → a página viu a tecla por 6/89/90/104/205/1285 ms → o jogo viu A por 0 (perdido)/1/1/1/2/12 ticks |
| Semântica do comando | **borda de subida**: segurar 1285 ms (12 ticks de pad) → um ataque; o fluxo `hold → solta → toca` repete. Não foi imposto «um ataque por pressão»: é o que o CMD/CNS dizem |

**Limitação do caminho de entrega (medida, não corrigida):** o joypad é um *nível*, não uma fila. Dos 9 toques
nativos da execução final, 8 chegaram ao jogo e 1 se perdeu (tecla pressionada e solta entre duas amostras:
6 ms, abaixo do período de quadro de 94 ms; os de 89–90 ms passaram por pouco). Em 60 quadros/s a janela seria ~17 ms; um *latch* de
uma pressão por quadro no `emulator_send_input` resolveria, mas altera a entrada de todos os cenários do
produto e fica fora desta frente (recomendação).

## 6. Validação

Negativos (testes Rust, sem toolchain, salvo onde indicado):

| Negativo | Teste | Resultado |
|---|---|---|
| dependência ausente | `missing_common_*`, `original_chain_import_wires_*` | `dependencies[].status = missing`; estado 0 vira stand-in autoral e é declarado |
| condição não suportada | `original_chain_negatives_*` (`&&`, `MoveContact`, `0 + 1`), `expression_grammar_is_strict` | cadeia recusada com motivo; nada convertido parcialmente |
| comando incorreto / ausente | `original_chain_negatives_*` (`~D, DF, x`; comando `fantasma`) | recusado com motivo |
| mapeamento de fonte adulterado | `negative_tampered_chain_program_or_source_mapping_blocks_the_build` (condição, alvo, linha, texto, mapeamento removido) | `#error mugen_program`, build bloqueado |
| instâncias independentes | `two_chain_instances_keep_independent_state_variables`; ROM real: `mugen_chain_two_instances_real_independent_state` | A só move A, B só move B, juntas movem as duas; `Time`/estado/animação próprios |
| autoral + cadeia / sem escolha | `original_chain_refuses_authored_demo_*` | recusado, projeto intocado |
| grafo no editor | `mugenProgram.test.ts`, `mugen-original` (editor abre, salva, digest intacto) | o editor descartaria um objeto como parâmetro, por isso o programa é uma string JSON |

Regressões reexecutadas no binário final: `mugen-real` + oráculo Pillow, `mugen-import`, `mugen-control`,
`mugen-locomotion`, `mugen_strider_real_build_run_locomotion` e a prova real do piloto (`mugen_real_pilot_build_and_capture`).
Gates e hashes: ver `ORIGINAL_CHAIN_EVIDENCE.json`. CI por SHA: registrado no PR.

## 7. Tabela: operação original → implementação → teste → resultado → limite

| Operação original | Implementação | Teste | Resultado | Limite |
|---|---|---|---|---|
| `ken8.def:15` `stcommon = common1.cns` | dependência resolvida só dentro do pacote; ausente → stand-in declarado | `missing_common_*` | ausente registrado; estado 0 autoral | estado 0 não é o original |
| `ken.cmd:272` comando `x` | borda de subida de `BUTTON_A` (ligação autoral), `time = 1` | ROM (`mugen_original_chain_real_ken_capture`) + UI `mugen-original` + oráculo | um ataque por borda; segurar não repete | borda do botão simples não confirmada em `cmd.html` |
| `ken.cmd:339` `holddown` `/$D` | `BUTTON_DOWN` segurado | X + baixo na ROM e na UI | não ataca | sem agachar (estado comum ausente) |
| `ken.cmd:963-971` Stand_X | `ChangeState 200` no `-1`, antes do estado atual, E/OU dos grupos | referência em 0 divergências | entra no 200 | 55 outros controladores do `-1` não convertidos |
| `ken.cns:285-294` Statedef 200 | `type`, `ctrl`, `velset`, `anim` na entrada, `anim` reinicia | ROM: `ctrl 0`, ação 200, vx 0 | idêntico | `poweradd`, `juggle`, `movetype`, `physics` não convertidos |
| `ken.cns:343-347` retorno | `ChangeState 0 ctrl 1` quando `AnimTime = 0` | ROM: 6 ticks exatos | volta ao 0 com `ctrl 1` | `AnimTime` aproximado (leitura da doc) |
| `ken.cns:296` HitDef | **não convertido** | referência lista o tick | sem acerto/dano | efeito opaco |
| `ken.cns:349` PlaySnd | **não convertido** | referência lista o tick | sem som | efeito opaco |
| `ken.air:297-306` ação 200 | timers 2/2/2 do AIR | pixels: 184 (core) e 295 (UI) quadros | idêntico ao Pillow | — |
| `ken.cns:3974` estado −2 | **não convertido** (3 controladores) | referência avalia com `Pos y = 0` | não dispara | `Pos y` assumido 0 |

## 8. O que NÃO está provado

Conversão integral do Ken; colisão, dano, combate, facing/virada, andar/pular/agachar (dependem do `common1.cns`);
fidelidade ao motor MUGEN real (nenhum runtime original executou); tempo real e PAL; hardware físico; taxa de
quadros do produto (o core de debug roda ~11 quadros/s); toques mais curtos que um quadro (perdem-se, ver §5).
