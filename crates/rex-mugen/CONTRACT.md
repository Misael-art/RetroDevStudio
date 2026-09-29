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
**bloqueiam o build** com `#error`; nunca são aproximados. `mugen_frames[].duration` é
informativo; a fonte do tempo é `frame_durations`.

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
