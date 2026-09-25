# Nota de coordenacao — rodada REX (propriedade do agente A)

## 2026-09-24 ~23:44 — execucao concorrente detectada neste worktree

Durante a execucao do agente A (ZCode, branch `codex/rex-a-addressing`), um
segundo executor (commits assinados `Codex <codex@local.invalid>`, aparentemente
uma sessao Codex Desktop ativa no host) comecou a escrever NESTE MESMO worktree
e branch, criando arquivos com nomes distintos:

- commit `7452dc3` `docs(rex): pin sources and spec for MD linear addressing profile`
  -> adicionou `docs/rex_profiles/addressing/MD_LINEAR.md` (maiusculas)
- arquivos nao rastreados as 23:38-23:41: `scripts/rex_profiles/addressing/fixtures.mjs`,
  `scripts/rex_profiles/addressing/md_linear.mjs`,
  `scripts/rex_profiles/addressing/md_linear.test.mjs` (underscores)

O agente A (este) usa nomes kebab-case (`md-linear.md`, `build-fixtures.mjs`,
`md-linear.mjs`, `md-linear.test.mjs`) e nao alterou nenhum arquivo do outro
executor. Processos alheios nao foram mortos (regra da rodada).

Risco conhecido: o outro executor pode commitar o diretorio inteiro
(`git add scripts/rex_profiles/addressing/`) e misturar autoria/commits.
Mitigacao adotada: commits pequenos e push imediato apos cada perfil.

Acao sugerida ao integrador: identificar a sessao duplicada antes de revisar a
branch; a decisao de qual trabalho prevalece e do integrador. Os criterios de
aceitacao (contrato v1: expectativas pinadas antes da implementacao, evidencia
em `data/rex_profiles/addressing/<id>/evidence/`) continuam sendo a autoridade,
independente de quem executou.
