# Proveniência das fixtures vendorizadas (`fixtures/`)

Estas cópias existem para a suíte NORMAL do pacote rodar em checkout limpo
ou `cargo package` — sem caminho absoluto, sem ferramenta local oculta e sem
a árvore `data/` do repositório. Cada arquivo abaixo é byte-idêntico à origem
que espelha (conferido com `cmp` na vendorização e revérificado a cada run
por `tests/fixtures.rs`, que pinna SHA-256 dos 52 arquivos).

Origem: perfil de codec Kosinski da frente B (rodadas PR #79/#81), gerado por
`scripts`/`gen_vectors.py` autorais e confirmado pelo oráculo externo `koscmp`
(mdcomp, LGPL-3.0; usado apenas como ferramenta de comparação — nenhum código
ou artefato dele foi copiado para cá). Nenhum arquivo comercial ou de ROM
(BYOR) está aqui: todas as fixtures são autorais/sintéticas.

## Mapa fixture → origem canônica

| Caminho em `fixtures/` | Origem (autoritativa para o modo diferencial) |
|---|---|
| `kosinski/golden/*` (10 `.kos` + 9 `.expected.bin`) | `data/rex_profiles/codec/kosinski/golden/` |
| `kosinski/plain/*` (12 `.kos` + 12 `.bin`) | `data/rex_profiles/codec/kosinski/plain/` |
| `kosinski/negative/*` (5 `.kos`) | `data/rex_profiles/codec/kosinski/negative/` |
| `runtime/overlap_echo.kos` + `.expected.bin` | `data/rex_profiles/kosinski_runtime/` |
| `runtime/edit/base_plain.bin`, `runtime/edit/edited_plain.bin` | `data/rex_profiles/kosinski_runtime/edit/` |

Os SHAs-256 de cada cópia estão pinados em `tests/fixtures.rs` (const
`PINNED`), que é a verificação máquina-a-máquina; esta tabela é o mapa
humano. A origem continua única fonte de verdade do LADO ORÁCULO: o script
`scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh`
continua lendo `data/rex_profiles/*` (inalterado).

## Deliberadamente NÃO vendorizadas

- `golden/m02_single_with_eod.expected.bin` — m02 é exceção contratual
  (`Truncated`); nenhuma espera de saída é lida pela suíte.
- `.json`/`.tsv` de manifesto e evidência (`manifest.tsv`, `manifest.json`,
  `evidence/*`) — documentação de proveniência histórica, vive em `data/`.
- `data/rex_profiles/kosinski_runtime/limite_probe.*` e `encdir/` — lidos
  apenas pelo modo diferencial (caminho do oráculo), não pela suíte normal.
- Qualquer corpus BYOR — não existe neste pacote.

## Política de atualização

Se uma fixture da origem mudar, o pino em `tests/fixtures.rs` falha de
propósito. A atualização correta é: regenerar/confirmar a origem com o
oráculo, republicar a cópia byte-idêntica em `fixtures/` e atualizar o PIN
com justificativa no commit — nunca o inverso (o teste não autoriza edição
silenciosa de espera).
