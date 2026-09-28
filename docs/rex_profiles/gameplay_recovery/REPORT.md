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

Patch × recompilação SGDK: a única diferença é o byte `0x00018F` (checksum do cabeçalho).
O SGDK grava ali um valor que **não** é a soma padrão do Mega Drive (base: `0x14BB` gravado,
`0xCE17` calculado). Pelo contrato, o patcher só atualiza o checksum quando a base tem checksum
padrão válido, e ele não adivinha a convenção do SGDK. O core não valida esse campo. O teste exige
identidade fora de `0x18E..0x190`, e o fato fica registrado no `report.json`.
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
