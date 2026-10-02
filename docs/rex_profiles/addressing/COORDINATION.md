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

## 2026-09-25 — resolucao documental da sessao duplicada (estado final da rodada A)

Levantamento do que restou do segundo executor nesta branch:

- **Nunca comitado (zero rastre no `git log --all`):** `scripts/rex_profiles/
  addressing/fixtures.mjs`, `md_linear.mjs`, `md_linear.test.mjs` (underscores).
  Os arquivos nao existem mais no arvore; `git status` limpo. Nada a reconciliar
  em codigo: a unica implementacao md-linear na branch e `md-linear.mjs`
  (kebab), com cadeia completa pin (`e070d5a`) → GREEN (`8130640`) e evidencia
  imutavel em `data/rex_profiles/addressing/md-linear/evidence/`.
- **Comitado e ainda presente:** `docs/rex_profiles/addressing/MD_LINEAR.md`
  (MAIUSCULAS, `7452dc3`). Comparado com o `md-linear.md` da cadeia aceita:
  mesmas fontes centrais (GPGX@939ce4f), divergencia contratual real —
  MD_LINEAR.md admite `rom_size` minimo 0x8000 (32KB); a especificacao
  aceita + implementada + pinada exige 0x10000 (64KB, um banco SSF2-less
  canonico). MD_LINEAR.md traz ainda duas citacoes uteis NAO presentes na
  spec aceita: SGDK@2eac605 `memory_base.h` (confirma base ROM $000000 e
  RAM 68k $FF0000) e a nota anti-confusao de que `flamewing/mdcomp` e area
  de codec (agente B), nao de mapa de memoria.
- **Autoria:** todos os commits da branch compartilham `Codex
  <codex@local.invalid>` (config do host); metadata de autor NAO distingue
  as sessoes. A distincao utilizavel e estrutural: somente a cadeia kebab
  satisfaz o contrato v1 (expectativas pinadas antes da implementacao com
  SHA-256 registrado em evidencia + RED documentado + GREEN sem tocar
  expectativas).
- **Prevalencia proposta (decisao final = integrador):** prevalece a cadeia
  kebab como autoridade contratual; `MD_LINEAR.md` nao e apagado — sugerido
  como (a) registro historico e (b) fonte das duas citacoes adicionais, a
  incorporar em `md-linear.md` na proxima revisao se o integrador aceitar.

Nenhum arquivo do outro executor foi alterado ou removido por mim em toda a
rodada. Processos alheios nao foram mortos.
