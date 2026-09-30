# Contrato — perfil `mugen.character.v1` (Experimental)

Conversão **delimitada** de um personagem MUGEN para projeto editável do RetroDev e ROM SGDK.
Não é conversão integral de MUGEN, não cobre stages, screenpacks, som e IA, e não executa
nenhum conteúdo do pacote.

## Pipeline versionado

```
entrada (pasta do pacote)                    DEF/AIR/SFF/CMD/CNS/ST, só leitura
  → inventário                               DEF [Files] (parser canônico do produto)
  → representação                            rex-mugen: air::Air, sff::Sff (índices + paleta)
  → diagnóstico                              diag::Diagnostic / Metric (rex-mugen/diag/v1)
  → plano de conversão                       plan::CharacterPlan (fidelidade por item)
  → projeto resultante                       core/mugen_profile.rs + project_mgr (modelo do produto)
       sprite.asset (atlas VDP), sprite.animations (frame_durations, loop_start, mugen_frames),
       graphs/mugen_<id>.json (NodeGraph), assets/mugen/<id>_import_report.json
  → ROM                                      compilador canônico + compiler/mugen_runtime.rs
```

Não existe formato de projeto próprio, build próprio nem editor próprio. A representação da
crate é intermediária e é transformada explicitamente no modelo do produto; os testes cobrem
essa transformação.

## Entrada e segurança

- Arquivos são **dados**; nada é executado.
- Todo caminho do DEF precisa ficar dentro da pasta do pacote. Caminhos absolutos, `..` que
  escapem e links para fora são recusados. Isso vale para SFF, AIR, CMD, CNS e ST, e também
  para o caminho legado.
- Limites de tamanho:

| Arquivo | Limite |
|---|---|
| textos (AIR, CMD, CNS, ST) | 1 MiB |
| SFF | 32 MiB |
| imagens do SFF | até 8192 |
| dimensão de sprite | até 1024 px |
| bytes decodificados | 64 MiB |

- Tudo que lê e valida o pacote roda **antes** de qualquer gravação; uma recusa não deixa
  atlas nem entidade no projeto. Limite: uma falha de E/S depois do início das gravações ainda
  pode deixar arquivos (a importação não é transacional).

## Formatos e recursos

| Recurso | Suporte | Classificação |
|---|---|---|
| SFF v1 (PCX 8 bpp, links, `same_palette`) | sim | — |
| SFF v2 | não | recusa no perfil (cai no caminho legado, se houver PNGs extraídos) |
| paleta | 15 cores + transparente, na grade de 9 bits do VDP | direto se já estiver na grade; aproximado com contagem de pixels arredondados e fundidos |
| eixo/origem | âncora comum na célula (múltiplo de 8, até 248 px) | direto; célula maior é recusada |
| tempos por frame | 1..255 ticks; `-1` = parado | direto; `0` → 1 e `>255` → 255, aproximados e diagnosticados |
| `Loopstart` | sim | direto (runtime) |
| flip H/V/HV por frame | em torno do eixo, convenção "largura − eixo" | direto (runtime) |
| offset x/y por frame | somado à posição | direto (runtime); **sem facing no v1** (personagem sempre virado para a direita) |
| Clsn1/Clsn2 por frame e default | tabelas na ROM + contagem do frame atual observável na RAM | direto como dado; **nenhuma regra de jogo as usa no v1** |
| blend (A, S, …) | não | frame exibido opaco, aproximado |
| escala/ângulo/`Interpolate` | não | diagnóstico; ignorados |
| frame com sprite ausente | não | a action **não é convertida** (um frame vazio encurtaria a animação no `rescomp`) |

## Revisão da fonte antes de importar (Ken real, 2026-09-30)

O comando canônico `analyze_mugen_source` é somente leitura. `source.rs` inventaria
DEFs de personagem (storyboards não são candidatos), chaves duplicadas e referências
relativas sem escolher silenciosamente entre colisões. O backend informa localização,
hashes, SFF/versão, sprites/eixos, ações, dependências e controllers originais; o plano
prevê transformações para as ações selecionadas. DEFs múltiplos exigem seleção.
Limites da análise: 4.096 arquivos, 16 níveis, 128 MiB no pacote, textos até 1 MiB;
links simbólicos são recusados. Esses são limites do analisador, não do hardware.

Escolhas persistidas em `review_options`: DEF, lista de ações (vazia = todas),
paleta e modo de comportamento. ACT MUGEN tem exatamente 768 bytes/256 RGB em ordem
invertida. A escolha substitui explicitamente a paleta dos sprites selecionados;
`null` usa a embutida. O DEF determina a primeira paleta sugerida. Não há detecção
automática do significado de paletas alternativas ou suporte a ACT estendida.
O digest é SHA-256 da sequência ordenada de caminhos UTF-8 e bytes: para cada arquivo,
comprimento do caminho (`u64` little endian), caminho, comprimento (`u64`), conteúdo.
A importação repete a análise e recusa digest diferente do revisado.

`visual_review` preserva PNGs reais, hashes RGBA/índices/paleta e metadados por
elemento AIR (até 1.024 elementos e 16 MiB codificados). A composição tem palco
comum e margem de 128 px; offsets fora dele exigem seleção menor. A revisão e as
escolhas reabrem no relatório existente. Nenhum asset BYOR é versionado no repo.
As cores da prévia são a representação RGB normalizada da grade CRAM; a curva
RGB565 do core é uma fronteira separada, verificada pelo oráculo independente.
O staging BMP reserva índice 0 exclusivamente à máscara: preto opaco usa outro
índice, inclusive na busca da cor aproximada.

O modo opcional `authored_visual_demo` exige ações 0/20/21/200. Cria comportamento
RetroDev rotulado: direções, neutral e botão A; velocidades 0/2,5/−1,75/0 px/tick,
editáveis, facing fixo à direita. **Não converte o CNS original.** Controllers e
grafo original ficam no relatório/arquivo de referência; nada desconhecido é
removido da fonte. Som permanece asset manual, caixas permanecem dados e não
produzem dano. O modo padrão continua o subconjunto original anterior.
O comando A autoral é de nível: pode reiniciar o ataque após voltar ao idle
se permanecer pressionado. A captura desktop mede a duração efetiva do input
em quadros emulados (a UI atual observa lotes), não o tempo solicitado no harness.

O atlas permanece em ROM e o SGDK carrega o quadro corrente. A estimativa de
residência de projetos `imported_mugen`/`imported_ikemen_go` usa o modo SGDK
gerenciado existente (dois quadros conservadores); warnings de transferências
continuam. O custo compilado é medido separadamente por `maxNumTile`, peças e
tiles no artefato. Não se reduz resolução nem se descarta frame para vencer uma
estimativa que conte o atlas inteiro como residente. A célula de 248 px é uma
restrição deste perfil/rescomp, não tamanho máximo universal de personagem.

QA BYOR: `mugen_real_pilot_build_and_capture` e desktop `--scenario mugen-real`,
com `RDS_MUGEN_REAL_SOURCE`/saídas locais. `scripts/verify-mugen-real.py` usa Pillow
PCX, AIR/ACT independentes e tiles VDP da ROM, conferindo máscara/pixels/ordem/
tempo/geometria e negativos. Python/Pillow são ferramentas de QA já presentes,
não dependências do app. Contrato do oráculo restrito ao piloto Ken SFF v1 +
recursos SGDK 2.11 sem compressão. Evidência e limites em
`docs/rex_profiles/mugen_sgdk/REAL_MISSION.md`.

## Comportamento

| MUGEN | Suporte v1 |
|---|---|
| `[Statedef S]`, S ≥ 0 | `fsm_state`; o corpo seleciona `anim` a cada quadro (`set_animation_state`) |
| `ChangeState` | `fsm_transition` com condição real; a `anim` do destino é aplicada no mesmo tick |
| gatilho `command = "x"` | nó `input_command` do produto |
| gatilho `stateno = K` | restringe o estado de origem |
| gatilho `AnimTime = 0` | `sprite_anim_done`: verdadeiro no quadro em que a 1ª passagem completa `total` ticks; animação com frame `-1` nunca completa |
| `triggerall` + exatamente um `trigger1` | AND |
| `[Statedef -1]` | vale para todo estado (ou só para `stateno = K`), antes das transições do próprio estado |
| outros gatilhos, OR (`trigger2..N`), `-2`/`-3` | ponte explícita `mugen_changestate_unsupported_trigger`, **sem transição** |
| `VelSet` com x constante, `trigger1 = 1` (seção «Locomoção horizontal») | `set_velocity` do perfil no corpo do estado e na entrada da transição; integrado no runtime | **direto** (múltiplo de 1/256 px/tick) ou **aproximado** (arredondado, com o valor efetivo no relatório) |
| `VelSet` fora do contrato (expressão, outro gatilho, y ≠ 0, x omitido, parâmetro extra, fora da faixa) | nó de referência **não ligado** | `unsupported`, com o motivo |
| VelAdd/PosSet/PosAdd/PlaySnd | nó presente só como referência (`wired: false`), **não executado** | `unsupported` no relatório |
| HitDef | ponte `mugen_hitdef` (herdado) |

Ordem por quadro na ROM: leitura do joypad → FSM (transições) → tick de animação →
`SPR_update`. O runtime MUGEN existe só no emissor Mega Drive; no SNES, `sprite_anim_done`
bloqueia o build.

## Edição no modelo

Editar `frame_durations`, `loop_start` ou `mugen_frames` (flags, axis, caixas) no modelo muda
a ROM. Valores fora do representável (duração 0 ou fora de −1/1..255, `loop_start` ≥ frames,
tamanhos divergentes, deslocamento fora de −128..127, animação sem tabela num sprite MUGEN)
**bloqueiam o build** com `#error`; nunca são aproximados.

### Coerência das durações (fronteira de consumo: `mugen_anim_table`, backend)

Fonte canônica do tempo: `frame_durations` (ticks). `mugen_frames[].duration` espelha o mesmo dado
e é validado contra ele na geração:

| Situação do projeto | Tratamento |
|---|---|
| os dois campos presentes, mesmo comprimento, mesmos valores | gera normalmente |
| valores diferentes em algum quadro | **bloqueia o build**: `animacao 'X': quadro N: frame_durations = A mas mugen_frames[i].duration = B; ... (nenhum foi escolhido)` |
| comprimentos diferentes (`frames`, `frame_durations`, `mugen_frames`) | **bloqueia o build** com as três contagens; nada é truncado |
| `frame_durations` ausente, `mugen_frames` presente (legado) | interpretação inequívoca: a única fonte é `mugen_frames[].duration`; usada **só na geração**, o projeto não é reescrito. O Inspector preenche `frame_durations` apenas quando a pessoa edita um quadro |
| só `frame_durations` (sem `mugen_frames`) | animação nativa (FPS), sem runtime MUGEN |

Abrir o projeto nunca corrige nem sobrescreve; o Inspector mostra o conflito e não oferece edição até
que os campos sejam reconciliados no projeto.

## Unidades de duração (auditoria, etapa 2 da UX v2)

A duração é **por elemento** da animação (uma por linha de frame do `.air`), em **ticks de 1/60 s**;
não é FPS e não há valor uniforme por animação.

| Fronteira | Campo | Unidade e valores |
|---|---|---|
| AIR (`air.rs`) | 5º campo da linha (`tempo`) | tick de 1/60 s; `-1` = infinito (`None`); `>= 0` aceito; `< -1` → `air.frame.bad_time` (linha ignorada) |
| Plano (`plan.rs`) | `PlannedFrame.timer: u8` | `-1` → `0` (parado, **direto**); `1..=255` → igual (**direto**); `0` → `1` e `>255` → `255` (**aproximado**, com diagnóstico `plan.frame.zero_time`/`time_clamped`) |
| Modelo (`AnimationDef`) | `frame_durations[i]` e `mugen_frames[i].duration` (`i32`) | ticks; `-1` = parado (o importador grava `0 → -1`); os dois campos devem ser iguais — a UI grava ambos. `fps` é só um resumo (`60/média`) e **não afeta a ROM** das animações MUGEN |
| Gerador (`ast_generator.rs`) | `timers: Vec<u8>` | `frame_durations[i]`: `-1 → 0`, `1..=255 → i`, qualquer outro valor **falha o build** com `duracao N fora de -1 ou 1..=255` |
| Runtime (`mugen_runtime.rs`) | `rds_mugen_<v>_timer` | um decremento por quadro do jogo; frame com timer `T` fica `T` quadros; `0` = parado. O quadro do jogo é 1/60 s no NTSC (1/50 s no PAL) |
| Inspector | campo «Quadro N (ticks)» | mesma faixa: `-1` ou inteiro `1..=255`; `0`, `< -1`, `> 255`, vazio e não inteiro são recusados com diagnóstico, sem alterar o último valor válido. Não há ação que uniformize as durações |

A coerência entre `frame_durations` e `mugen_frames[].duration` é conferida na geração (seção seguinte).

## Controle pelo teclado (etapa 3 da UX v2)

Comandos e ações **já convertidos** e provados no desktop com a fixture `walker`
(`crates/rex-mugen/fixtures/walker`, previsão em `fixture.rs`):

| MUGEN | Produto | Prova |
|---|---|---|
| `command = F`, `time = 1` (direção segurada) + `ChangeState` no `[Statedef -1]` | `input_command` → estado 20 → animação de caminhada; `AnimTime = 0` volta ao estado 0 e o `-1` religa enquanto a tecla segue segurada (1 tick de idle entre ciclos) | ArrowRight nativo → ack da sessão → 12/6 ticks (4 editado para 12) + índice da animação na RAM |
| `command = a` | botão A do Mega Drive (KeyZ) → estado 200 → animação de **ataque** | ack da sessão → 3/8 ticks, uma só vez; índice na RAM |

**Fixture `walker` sem movimento de posição** (não tem `VelSet`); a locomoção tem contrato próprio na seção
«Locomoção horizontal» e a fixture `strider`. A ação é «animação de
ataque»: nada de acerto, dano ou colisão. `command` só reconhece a forma segurada (`/`, `~`, `$` e
sequências não foram exercitados nesta fixture).

## Locomoção horizontal (`VelSet`, Experimental)

Subconjunto **restrito**: só a componente x constante de `VelSet`. Não é física do MUGEN.

| Item | Contrato |
|---|---|
| Unidade e frequência | pixels por **tick lógico**; 1 tick = 1 quadro emulado (1/60 s no NTSC; no PAL o quadro é 1/50 s e a velocidade em px/s cai proporcionalmente — **PAL não medido**) |
| Coordenada, direção e facing | x cresce para a **direita**; x positivo desloca à direita, negativo à esquerda. **Facing fixo à direita** (sem inversão do sinal nem espelhamento); `VelSet x = -1.75` anda para a esquerda de costas |
| Sintaxe aceita | `x = N` ou `value = N[, 0]`, `N` literal decimal `[+-]dígitos[.dígitos]` (até 6 inteiros e 9 decimais); `y` ausente ou `0`; gatilho **exatamente** `trigger1 = 1` (todo tick em que o estado está ativo), sem `triggerall`; parâmetros `type`, `name`, `x`, `y`, `value`, `trigger<N>` |
| Representação | **Q8.8** (múltiplos de 1/256 px/tick), `s16`: \|v\| ≤ 127,99609375. Literal fora da grade é **arredondado ao mais próximo, metade para longe do zero** e o relatório o marca `approximate` com o valor efetivo (`2.4` → `614/256 = 2,3984375`) |
| Ordem por tick | joypad → FSM (`Statedef -1`, transições do estado; a entrada em um estado aplica a animação **e** o `VelSet` do estado no mesmo tick) → tick de animação → **integração da posição** (`acc += vx; passo = acc >> 8; acc -= passo << 8; x += passo`) → `SPR_update` |
| Fracionário | o acumulador (`s16`, 0..255) nunca é zerado: deslocamento após n ticks = `floor(Σ vx_q8 / 256)`. Para velocidade negativa o piso é em direção a −∞ (o 1º passo de −0,5 px/tick já move 1 px e o 2º não move) |
| Componentes omitidos | y omitido = 0 (não há vertical); x omitido ou só `y` = **recusado** (não se assume «inalterado»); estado **sem** `VelSet` **mantém** a velocidade anterior (como o MUGEN), então toda parada precisa de um `VelSet x = 0` no estado de destino |
| Parada e troca de direção | definidas pelos estados/comandos da fixture: um comando `neutral = 5` (nenhuma direção; notação numérica do RetroDev, **não** é sintaxe padrão do MUGEN) leva 20/21 → 0; `back` em 20 e `fwd` em 21 trocam direto de estado sem passar pelo 0 |
| Limites | sem limite de tela, colisão, chão nem paredes: a posição é um `s16` (dá a volta em ±32767); fora da tela o sprite some |
| Estado por entidade | `rds_mugen_<v>_vx` (`s16`), `rds_mugen_<v>_xacc`, e a máquina de estados `fsm_state_<entidade>`; duas entidades não compartilham velocidade, acumulador, posição nem índice de estado. Um `VelSet` em sprite sem tabela MUGEN válida (ou no SNES) **bloqueia o build** (`#error`) |
| Rejeições | expressão, `const(...)`, expoente, vírgula decimal, valor fora da faixa, vertical ≠ 0, gatilho ≠ `trigger1 = 1`, `triggerall`, parâmetro extra (`ignorehitpause`, `persistent`, …): `unsupported` no relatório, nó de referência não ligado; no modelo, valor não representável vira `#error` no build, nunca 0 |
| Fora do escopo | `PosAdd`/`PosSet` (incremento/atribuição de posição, com contrato e prova próprios), `VelAdd`, `physics`/atrito de `Statedef`, facing, gatilhos `Time`/`Vel`/`Pos`, vertical |
| Por que não o `set_velocity` nativo | ele alimenta o sistema de física do produto (`_vel_x/16`, atrito, paredes); a semântica difere (Q8.8 por tick, sem física). Reaproveita-se o **tipo de nó** no grafo (perfil `mugen.character.v1`), não a semântica. Proveniência: nenhum código do SGDK Forge foi transplantado nem consultado nesta rodada |
| Editor | Inspector → «Velocidade dos estados (MUGEN)»: px/tick, aviso de arredondamento, diagnóstico e valor mantido em entrada inválida; grava o literal no nó do grafo (`components.logic.graph`, corpo e entrada) |

Prova (fixture `strider`, `crates/rex-mugen/fixtures/strider`): a ROM real no core real bate o contrato
**em todos os quadros** (teste ignorado `mugen_strider_real_build_run_locomotion`) e o cenário desktop
`mugen-locomotion` mede a posição por quadro emulado no viewport.

## Esquema de diagnóstico (`rex-mugen/diag/v1`)

| Estrutura | Campos |
|---|---|
| `Diagnostic` | `code` estável (ex.: `plan.frame.blend_unsupported`), `severity` (`info`/`warning`/`error`), `source` (`arquivo:linha` ou `arquivo@0xOFFSET`), `message` e `action` (o que fazer) |
| `Metric` | `name`, `unit`, `value` (**`null` = indisponível**, nunca zero), `origin`, `window`, `availability` (`"available"` ou o motivo), `subject`, `budget`, `over_budget` |
| `Provenance` (resources/behavior no relatório) | `item`, `source`, `source_sha256`, `transform`, `target`, `fidelity` (`direct`/`approximate`/`manual`/`unsupported`), `reason`, `consequence` |

Valores de `origin`:
- `A_static_estimate`: estimativa, **não é medida de hardware**;
- `B_rom_instrumentation`: exige custo declarado; não usado no v1;
- `C_core_observation`;
- `D_host_app`.

Métricas do v1, todas de origem A: `cell_width`, `cell_height`, `tiles_per_frame`,
`palette_colors` (orçamento 15), `merged_pixels` (orçamento 0) e `hardware_sprites_per_frame`
(**indisponível**: quem decide é o corte do `rescomp`).
A telemetria é local: nada é enviado, os caminhos gravados são relativos ao pacote e os
buffers são limitados.
