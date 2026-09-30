# Fixtures autorais rex_corpus_d

Sem bytes comerciais. Gerado por `scripts/rex_corpus_d/fixture.mjs` (deterministico).

| arquivo | sha256 | conteudo |
| --- | --- | --- |
| `synthetic-sonic-v1.bin` | `ee27ec11ed2fa88d662e13d9b063290c3bf6095b5bd6d19235fd5c4336494911` | ROM sintetica 0x30000 com tabela de mapping v1 em `0x211E2`, DPLC v1 em `0x217FE` e arte 4bpp chunky em `0x21AFE` |

Usado pelos suites `reader`, `compose` e `chain` como oracle de formato sem tocar em ROM comercial.
Para regenerar e conferir: `node -e "import('./scripts/rex_corpus_d/fixture.mjs').then(...)"` — o
gerador do arquivo esta documentado no historico da MISSAO D (mesma sequencia de bytes do teste).
