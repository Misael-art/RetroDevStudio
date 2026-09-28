# Proveniência das fixtures

Trechos hex (não ROMs completas) de ROMs **autorais** do template builtin
`reference_platformer`, geradas pelo pipeline canônico (SGDK oficial) no E2E
`reference-platformer-2026-09-25T01-09-09-520Z` do integrador. Nenhum conteúdo
comercial. Cada arquivo registra o SHA-256 e o tamanho da ROM completa de origem.

| Arquivo | Origem | SHA-256 da ROM completa | Papel |
|---|---|---|---|
| `goal_original_t6.hex` | `...-goal-original.rom` (limiar 6) | `836c6204…a8bfc` | ajuste |
| `goal_edited_t12.hex` | `...-goal-edited.rom` (limiar 12, recompilado pelo SGDK) | `5e148243…c2bc` | retida (oráculo de edição) |
| `two_passages.hex` | `...-two-passages.rom` (duas passagens) | `3098cd57…1dc6` | retida (endereços, polaridade, saídas) |

Janelas: cabeçalho `0x100–0x200` e as faixas das regiões recuperadas.

Transparência sobre o retido: a desmontagem de `two_passages` foi inspecionada
durante o desenho do perfil (não é cega). A variante **cega** (passo 3, limiar 37)
é gerada na prova real (`rex_gameplay_real_gate_recovery_equivalence_and_effect`)
e só foi examinada pelo recuperador.
