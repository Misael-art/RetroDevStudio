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
| VelSet/VelAdd/PosSet/PosAdd/PlaySnd | nó presente só como referência (`wired: false`), **não executado**, `unsupported` no relatório |
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

**Sem movimento de posição:** `VelSet`/`PosAdd` não fazem parte do perfil v1 (`unsupported`), então a
posição do personagem não muda; a prova mede isso (borda esquerda constante). A ação é «animação de
ataque»: nada de acerto, dano ou colisão. `command` só reconhece a forma segurada (`/`, `~`, `$` e
sequências não foram exercitados nesta fixture).

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
