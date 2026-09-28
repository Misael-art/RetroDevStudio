# Relatório — recuperação de regra de gameplay (`m68k.counter_threshold_state_gate.v1`, Experimental)

Branch `codex/rex-gameplay-recovery` · worktree `REX-GAMEPLAY-RECOVERY-2026-09-28` ·
base `a08c2c680c6dd76eaf8d3ad6b5502a1db6532ccc` · data 2026-09-28.
Contrato: `crates/rex-gameplay/CONTRACT.md`. Evidência: `data/rex_profiles/gameplay_recovery/evidence/2026-09-28-prova-real/`.

## 1. Rotina escolhida

Regra de coleta → abertura de passagem do template autoral `reference_platformer`
(código SGDK gerado pelo pipeline canônico a partir do grafo lógico do template):
com o bit Right do input, `reference_score += passo`; se `reference_score >= limiar`,
`goal_open := 1`, senão `goal_open := 0`, seguido de uma chamada externa (opaca).

| Item | Valor (build `original_t6`) |
|---|---|
| Entrada / saída | `0x000946` / `0x000970` |
| Blocos | `0x000946–0x000970`, `0x000CAE–0x000CCC` |
| Memória lida/escrita | `0xE0FF0054` (contador, L, com sinal), `0xE0FF0062` (estado, L) |
| Entrada de registrador | `Dk` (bits do joypad) |
| Instruções | subconjunto fechado de 12 formas (CONTRACT.md) |
| Dependência externa | `JSR abs.L` opaco + `PEA`/`MOVE.L -(SP)` de argumentos |
| Participação no gameplay | provada por efeito: `goal_open` controla a barreira; jogador bloqueado em x=36 até a abertura (§5) |

**Nível de assistência (rotulado):** localização por **varredura estrutural sem símbolos**
(`scan_guarded_candidates`), que encontrou exatamente 1 candidato. Os símbolos ELF
(`logic_var_reference_score`, `logic_var_goal_open`) **só validam** depois do resultado.
Isso **não é descoberta automática de rotinas em geral**: a varredura só reconhece a forma com guarda.
Todos os escritores absolutos de score/goal_open (`0x954`, `0x96A`, `0xCB0`) estão dentro da região.
Escritas indiretas não são cobertas.

Não houve mudança de compilador nem de flags de build.

## 2. Produto × referência

O caminho `rex_gameplay::recover` recebe apenas os bytes da ROM, a entrada, as saídas e rótulos opcionais.
Fonte C, AST, grafo autoral e valores esperados não entram. Retidos:
- `two_passages` (fixture): endereços, polaridade e saídas diferentes. Foi inspecionado no desenho (não é cego).
- `blind_step3_t37`: gerado na prova, com passo 3 e limiar 37. Foi recuperado como `>= 37`, passo 3.
  **Limitação:** ele tem a mesma entrada/saída do original. É cego quanto a constantes, não quanto a disposição.
- O teste `recognition_does_not_depend_on_rom_hash_or_absolute_offsets` cobre a relocação.

## 3. Equivalência (antes da edição) — por conjunto declarado, não universal

Oráculo independente: a **ROM original executada pelo core Libretro** com estado injetado na WRAM.
A previsão vem do avaliador da regra recuperada. São 80/80 casos (40 por ROM, original e cega):
contadores `0, 1, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF, 0xFFFFFFF0` e `T-passo-2..T-passo+1`,
estado inicial 0/1 e input nenhum/Right (guarda desligada/ligada). A comparação cobre as escritas
de memória do contador e do estado. Os testes do pacote cruzam, além disso, o executor por instrução
(com flags N/Z/V/C) com a regra e verificam os controles original/original e no-op.

## 4. Edição e reconstrução

Edição: limiar 6 → 12 no nó `rom_counter_compare`. O grafo foi salvo e reaberto (`open_graph` remonta,
reeleva e recusa adulteração).

| Caminho | SHA-256 | Observação |
|---|---|---|
| base `original_t6` | `86c4e90d…4f7e` | |
| **patch** (`patch_moveq_immediate`) | `4030ec74…b1db` | muda só `0x000961` (5→13, `K = T - 1`) |
| **regeneração a partir do grafo** | `4030ec74…b1db` | verificada igual ao patch, não presumida |
| no-op (regenerar grafo não editado) | `86c4e90d…4f7e` | = base |
| recompilação SGDK com limiar 12 | `06fe310e…104f` | oráculo independente |

Patch × recompilação SGDK: a única diferença é o byte `0x00018F`, o checksum do cabeçalho.
**Explicado na rodada 2 (§8.5):** é o checksum SGDK/sizebnd (XOR), que o patcher não atualiza.
Não há crescimento: um limiar fora de `[-127, 128]` é recusado.

## 5. Efeito no jogo (camada técnica: chamadas diretas ao core)

Previsão registrada antes da captura (`prediction_before_capture` no `report.json`). Mesmo estado salvo,
`score=0` e `goal_open=0` injetados, Right segurado por 30 quadros:

| ROM | abre em score | x do jogador |
|---|---|---|
| original t6 | 6 | 36 até q6, depois +2/quadro (84 em q30) |
| editada t12 | **12** | preso em 36 até q12, depois +2/quadro (72 em q30) |
| no-op t6 | 6 | quadros idênticos à original |

Nos quadros 7–12 a original passa a barreira (x+14 > 50) enquanto a editada segue bloqueada.
Controles: as séries da no-op são iguais às da original; as séries da editada diferem das da original
(isso pega resposta reutilizada); a ROM antiga não satisfaz a previsão "abre em 12"; o SHA da ROM
carregada é registrado em cada execução.

**Correção declarada:** na primeira execução, o critério físico era "original com x > 66 no quadro 21".
Esse limiar numérico foi escolhido sem base e falhou (x = 66). Ele foi trocado pelo critério por quadro
acima. A previsão causal (variável, condição, momento, bloqueio) não mudou.

## 6. Matriz de evidência

| Camada | Estado |
|---|---|
| Pacote `rex-gameplay` (16 testes, clippy) | verde |
| Adaptador `src-tauri` + prova real SGDK/core | verde (`rex_gameplay_real_gate…`, ignorado na suíte normal) |
| Comando Tauri / IPC | **não existe** — proposta em `INTEGRATION_PROPOSAL.md` |
| UI (nós, Inspector) e E2E por teclado | **não existe** — dono: integrador |

Não houve promoção de maturidade além de `gates-proprios-aprovados` (entrada proposta no registry).

## 7. Comandos

```
cd crates/rex-gameplay && CARGO_TARGET_DIR=../../target/crates-gates cargo test && cargo clippy --all-targets -- -D warnings
CARGO_TARGET_DIR=$PWD/target cargo test --manifest-path src-tauri/Cargo.toml --lib rex_gameplay -- --include-ignored --nocapture --test-threads=1
CARGO_TARGET_DIR=$PWD/target cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```
Requer SGDK oficial e core Libretro detectados. O teste recusa toolchain falso.

---

## 8. Rodada 2 — endurecimento (código `9b3e755`, reconhecedor congelado em `4163c47`)

Evidência: `data/rex_profiles/gameplay_recovery/evidence/2026-09-28-rodada2/`
(`report.json`, grafos, `SHA256SUMS`, `real-run.log`, `FREEZE.md`).

### 8.1 Regeneração: o que vem de onde

A regeneração passou a ser emitida a partir da regra semântica (`emit.rs`), e não mais
remontada das instruções salvas.

| Origem | O que fornece |
|---|---|
| campos semânticos da regra = nós do grafo (`semantic:*`) | bit da guarda, endereço do contador, passo, limiar (imediato do MOVEQ), operador (ordem do CMP + condição), polaridade (alvo do Bcc), valor e endereço de estado, alvo e argumentos do JSR, saída (alvos de BEQ/BRA) |
| alocação recuperada (`alloc:*`, não editável) | registradores D0/D2/D3 |
| layout do mapping (`layout:*`) | offset de cada instrução, tamanho `.S`/`.W` dos desvios |
| constante do perfil (`fixed:*`) | `ADDQ.L #8,SP` |
| ROM-base | **só bytes fora da região**, verificados como inalterados |

Provas (`tests/hardening.rs`):
- cada byte mapeado é emitido exatamente uma vez;
- toda instrução, exceto a limpeza fixa da pilha, depende de algum campo semântico;
- para 8 campos semânticos, perturbar o campo muda **exatamente** as instruções que declaram
  depender dele e nenhuma outra. A saída é, portanto, função da semântica, e não um patch de
  constante isolado.

A regeneração recusa quando a semântica sem edição não reproduz o mapping.
Na ROM real: regenerar = `4030ec74…b1db` = patch; método `regenerate_region_from_semantics`.

### 8.2 Variantes retidas deslocadas

- Reconhecedor congelado **antes** da preparação: commit `4163c47`, árvore `src` `9af241b`
  (`FREEZE.md`, commit `d55c59e`). Diff do reconhecedor desde então: vazio. Nenhuma correção,
  então nenhuma variante foi rebaixada a regressão.

| Variante | SHA | Entrada | Contador | Estado | Passo/limiar recuperados |
|---|---|---|---|---|---|
| original | `86c4e90d…4f7e` | `0x946` | `E0FF0054` | `E0FF0062` | 1 / 6 |
| `shifted_step2_t20` (`a_shift_*`) | `f049bbc3…78a2` | `0x976` (+48) | `E0FF0054` (0) | `E0FF007A` (+24) | 2 / 20 ✓ |
| `shifted_z_step4_t30` (`z_shift_*`) | `b370d889…050e` | `0x976` (+48) | `E0FF0054` (0) | `E0FF007A` (+24) | 4 / 30 ✓ |

- **Fica demonstrado às cegas:** código deslocado, endereço de estado deslocado e constantes
  diferentes. As três variantes retidas foram recuperadas com os valores da fonte e passaram
  40/40 casos de equivalência no core cada.
- **Não demonstrado às cegas:** endereço do contador diferente. Nas duas tentativas o GCC
  manteve `logic_var_reference_score` em `0xE0FF0054` (a segunda variante foi desenhada depois
  de a primeira não mover o contador). Só a fixture `two_passages`, que não é cega
  (`E0FF0058`), cobre isso.

### 8.3 Localização ambígua

- **Duas rotinas compatíveis:** `locate` lista as duas; `locate_unique` recusa com
  `0x000946` e `0x020946`.
- **Nenhuma rotina compatível:** recusa com a contagem de quase-casos.
- **Padrão semelhante com semântica diferente:** reportado como quase-caso, com motivo, e
  nunca aceito. Os três casos:
  - `BCS` em vez de `BLT` (sem sinal);
  - os dois ramos escrevendo o mesmo valor;
  - ramos escrevendo em endereços de estado diferentes.
- Na prova real, o produto usa `locate_unique`. Nas ROMs reais, 142 aberturas
  `BTST ; BEQ` foram recusadas como quase-casos.

### 8.4 Chamada opaca

- **No patch e na regeneração:** os bytes `0xCB6..0xCC8` (`PEA`, `MOVE.L -(SP)`, `JSR 0xB10C`,
  `ADDQ.L #8,SP`) e o corpo do callee ficam idênticos. A única mudança é `0x961`.
- **No grafo:** o nó é `understood: false`.
- **Na regra:** `evaluate` devolve a chamada como evento `(alvo, arg imediato, ponteiro)`, e
  não como efeito sobre a memória.
- **Ponto de observação da equivalência:** a WRAM é lida depois de quadros completos. Isso
  inclui o callee e o resto do jogo. A alegação vale só para contador e `goal_open`, cujos
  escritores absolutos (`0x954`, `0x96A`, `0xCB0`) estão todos na região. Não se alegam os
  efeitos do callee, registradores, CCR, VDP ou som.

### 8.5 Checksum (pipeline real)

O `build_orch` masteriza o cabeçalho e grava `rom_mastering::sgdk_checksum`: o XOR de todas
as palavras exceto `0x18E` (SGDK sizebnd 2.11).

| ROM | gravado | XOR SGDK | soma MD | `inspect_rom_mastering` |
|---|---|---|---|---|
| original t6 | `14BB` | `14BB` | `CE17` | `matching_sgdk` |
| patch t12 | `14BB` | `14B5` | `CE1D` | **`mismatch`** |
| recompilação SGDK t12 | `14B5` | `14B5` | `CE1D` | — |

- Recalculando o XOR SGDK na saída do patch, ela fica **byte a byte igual** à recompilação SGDK.
- A política não foi alterada (proposta em `INTEGRATION_PROPOSAL.md` §5). Até decisão, a ROM
  patcheada sai com checksum SGDK desatualizado.
- O core não valida o campo, e a execução no core não prova compatibilidade com hardware.

### 8.6 Previsão causal: planejado × diagnóstico

A cadeia limiar → `goal_open` → bloqueio/passagem se manteve.

- **Controles planejados antes da 1ª execução** (`controls_planned_before_execution`):
  - abre em 6 (original) ✓;
  - abre em 12 (editada) ✓;
  - no-op igual à original ✓;
  - editada diferente da original ✓;
  - editada bloqueada, x máx 36 ✓;
  - **original com x > 66 no quadro 21 ✗** (x = 66). Esse critério foi escolhido sem base e
    continua registrado como falho; não é mais usado como gate.
- **Observações de diagnóstico** (`diagnostic_observations`), surgidas depois da captura:
  - divergência por quadro (7–12), que substitui o critério x > 66 como gate físico;
  - o byte de checksum `0x18F`.

### 8.7 Gates desta rodada

| Gate | Resultado |
|---|---|
| crate `rex-gameplay` | 23 testes (6 unit + 10 perfil + 7 endurecimento), clippy `--all-targets` limpo |
| prova real | verde em 9 s após builds (5 builds SGDK) |
| `cargo clippy -- -D warnings` (src-tauri) | verde; 0 avisos em `rex_gameplay.rs` com `--all-targets` |

A suíte `cargo test --lib` completa não foi reexecutada: nenhum arquivo fora do território
mudou desde a rodada 1 (771/0/67).

Comando da prova real:

```
CARGO_TARGET_DIR=$PWD/target cargo test --manifest-path src-tauri/Cargo.toml --lib rex_gameplay -- --include-ignored --nocapture --test-threads=1
```
