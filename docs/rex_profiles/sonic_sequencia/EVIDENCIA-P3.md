# EVIDENCIA-P3/P4 — prova da reordenação `id_Wait` (PARTE 2)

Frente de sequência (PR dependente sobre `codex/rex-sonic-consolidacao`).
Expectativas congeladas em `EXPECTATIONS-SEQUENCIA.md` (`d80b30c`); contrato em
`CONTRACT-SEQUENCIA.md`. Este arquivo registra **o que foi realmente executado**
e separa isso do que **não** foi aprovado. Nenhum byte de ROM/binário entra no
repositório; só SHA-256 + JSON versionados.

## Identidade imutável

- ROM base BYOR Sonic 1 USA/EU, 531577 B, SHA-256
  `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` (confere com
  o pino da frente de cadência).
- Base do PR (ancestral comprovado): `5340002` (HEAD de
  `codex/rex-sonic-consolidacao`, PR #103 OPEN, sem merge).
- Janela escrevível deste incremento: `0x13BAF..0x13BC0` (18 entradas).

## Artefatos de prova (SHAs)

Gerados por `RDS_DECOMP_WORK` isolado em `~/rds-scratch/p3-sequencia-20261003T225945Z/`:

| Artefato | SHA-256 | Papel |
|---|---|---|
| `sequence-reordered.bin` (cópia BYOR, NÃO versionada) | `833badf842032fa9e4d912a37e67cf33074ead85b6de7f0b21cbe0defcfa5e57` | saída da pipeline canônica |
| `sequence-reorder.bps` | `5b1b8fe5a66a7ad7dab6efd3c1bfa89f0e4bf5e029bd0f676cb79553b1ae2d52` | patch ida-e-volta |
| `sonic-sequence-proof.json` | `c07ffccdffc7873bf577df3fa5d5774423422ed27fdd466aa3a7106f3a82dc79` | relatório determinístico |
| `sonic-sequence-core-proof.json` | `30c3ef042118bd72c709e31a5fe850682d9111eab94ef43284298f85c844d8c8` | observação no core |
| `sequence-verifier.json` | `59631ef4885a9289775921f8d6173ebaee204ad3870d09c03cca2ab6a8806504` | verificador independente |

## O que a ROM real carregou (byte exato, do despejo)

- `0x13BAE=17` (intervalo · domínio da cadência, **intocado**).
- `0x13BAF..0x13BC0 = 01×12 03 02 02 02 03 04` (18 entradas).
- `0x13BC1=FE 0x13BC2=02` (terminador `afBack k=2`), `0x13BC3=00` (pad),
  `0x13BC4..=1F 3A 3B FF...` (início da anim 6, **intocado**).

## Critério §5.1 — proposta discriminante (pré-congelada)

Mover a primeira `03` (índice 12) para a posição 0:
`proposal = [3,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,3,4]`. Primeiro frame observado:
`01 → 03`. Multiconjunto `{01×12,02×3,03×2,04}` preservado.

## Critério §5.3 — verificador INDEPENDENTE (node puro, sem importar produto)

`scripts/qa/sonic-sequence-contract.mjs --rom <cópia> --base <BYOR>` — 13/13 OK:

```
OK  intervalo-intacto-0x17 :: 0x17
OK  terminador-fe02-intacto :: 0xFE 0x2
OK  padding-00-intacto :: 0x0
OK  vizinho-anim6-head-intacto :: 0x1F 0x3A 0x3B 0xFF
OK  sem-byte-reservado-na-janela :: nenhum
OK  multiconjunto-preservado :: 0x3 0x1 ... 0x1 0x2 0x2 0x2 0x3 0x4
OK  discriminante-primeiro-frame-01-a-03 :: frames[0]=0x3
OK  iguala-permutacao-congelada :: 0x3 0x1 0x1 0x1 0x1 0x1 0x1 0x1 0x1 0x1 0x1 0x1 0x1 0x2 0x2 0x2 0x3 0x4
OK  base-sha256-pino :: c7da53a10c...1ebb
OK  mesmo-tamanho :: 531577 vs 531577
OK  escrita-confinada-a-janela :: 2 byte(s) alterado(s): 0x13BAF,0x13BBB
OK  nao-e-troca-de-identicas :: 2 diferenca(s)
OK  fora-da-janela-identico-a-base :: 0 divergencia(s) externas
```

`--selfcheck` prova que o verificador **discrimina**: aceita a permutação real e
**recusa uma troca de entradas idênticas como NÃO-prova** (difs=0 → falha).

## Critério §5.3 — byte na ROM pela PIPELINE CANÔNICA (não injeção)

`inspection::sonic_sequence_byor_reorders_through_pipeline_and_bps_roundtrip`
(ROM real → `edit_sonic_sequence` → `persist_sonic_edit`):

- `bytes_changed=2`, `changed_offsets=[80815,80827]` = `0x13BAF,0x13BBB`
  (exatamente as duas posições trocadas).
- `outside_window_identical=true`; intervalo/terminador/pad/anim6 byte a byte
  intactos; `proposto ≠ aplicado` (ordem vigente era a original antes de gravar).
- **BPS ida-e-volta**: `create_bps(base, cópia)` → `apply_bps(base, patch)`
  reproduz a cópia **byte exato**; `back ≠ base`.
- **Restauração seletiva**: `restore_sonic_sequence` devolve a **cópia integral
  à base** (só a sequência voltou); restaurar de novo é no-op.
- **5 negativos** recusam sem escrever e sem registrar edição:
  `seq_length_divergent`, `seq_token_reserved`, `seq_frame_invalid`,
  `edit_resource_unsupported`, `noop`.
- BYOR **intacta** do começo ao fim.

## Critério §5.3c — ordem de frame OBSERVADA NO CORE real

`inspection::sonic_sequence_byor_core_first_wait_frame_becomes_art_03`
(Genesis Plus GX via `EmulatorCore`, rota de teclado, **sem injeção de estado**;
índices do objeto do jogador comprovados pela sonda de cadência: frame `0xD01B`,
anim `0xD01D`, timer `0xD01F`):

| caso | 1º frame em `id_Wait` | frame | timer |
|---|---|---|---|
| base (BYOR) | arte **01** | 1108 | 23 |
| cópia reordenada (pipeline) | arte **03** | 1108 | 23 |

Mesmo frame e mesmo timer entre os dois runs → a **única** diferença é o script
reordenado. Isto prova que reordenar a ROM (não só miniaturas) é observável no
core, com a assinatura do primeiro frame = arte `03`, como congelado.

## Gates do destino (executados vs. afirmados)

Rodei no destino desta frente (worktree, core Libretro headless; nada de
`--all-targets`):

| Gate | Comando | Resultado |
|---|---|---|
| estrutura | `npm run check:tree` | OK (raiz conforme 08_TREE_ARCHITECTURE) |
| lint FE | `eslint src vite.config.ts --max-warnings=0` | exit 0 |
| tipos FE | `tsc --noEmit` | exit 0 |
| testes FE | `npm test -- --run` | 933 passed / 6 skipped (99 arquivos) |
| formatação RS | `cargo fmt --check` | limpo |
| clippy | `cargo clippy -- -D warnings` | exit 0 (profile dev) |
| testes RS | `cargo test --lib` | 858 passed / 0 failed / 82 ignored |
| BYOR sequência | `--ignored sonic_sequence_byor_reorders` | 1 passed |
| BYOR core | `--ignored sonic_sequence_byor_core` | 1 passed |
| verificador indep. | `node scripts/qa/sonic-sequence-contract.mjs` | 13/13 + selfcheck |

**NÃO afirmados / não executados:**
- `cargo clippy --all-targets`: **não** verde — aviso pré-existente
  `duplicate_macro_attributes` em `compiler/ast_generator.rs:3479` (não
  introduzido por esta frente; só aparece no profile de teste).
- **§5.2 jornada desktop WebDriver pela UI renderizada** (abrir→editar→aplicar→
  exportar/reaplicar BPS→salvar→reiniciar→reabrir→executar no app real):
  **NÃO executada nesta sessão.** Motivo: não há binário do app pré-construído
  desta branch; exige um `cargo tauri build` completo (job pesado) e ligar um
  novo cenário `sonic-sequencia-journey` ao harness (`e2e-tauri-build-run.mjs`,
  ~11,5k linhas). A transportadora UI→core desse painel já foi provada na
  jornada de cadência (#100) com o MESMO `InspectionPanel`; os controles de
  sequência têm testes unitários (vitest, P2). O clique-a-clique renderizado
  fica como item aberto, não como aprovado.
- Usabilidade: **nenhuma** declaração (sem participante humano).

## Limites

- Superfície permanece **Experimental** até a jornada desktop §5.2 rodar verde.
- Nada autoriza mudar contagem de frames, outro byte da ROM, outro jogo, ou
  animações dependentes de velocidade. PAL não medido.
- Fork deliberado ordem×duração (ver `CONTRACT-SEQUENCIA.md`): editar duração
  **depois** de reordenar é recusado pela revalidação de cadência; deixado ao
  operador. Esta frente não resolve edição mista.
