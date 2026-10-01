# Reconciliação B (2026-09-30) — base, pins, oráculos e conhecimento existente

**Base efetiva:** `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` (confirmada em
`git rev-parse HEAD` no canônico antes da criação da worktree).
**Worktree/branch exclusivos:** `/home/misael/RDS-REX-CORPUS-B` @
`codex/rex-corpus-b`. Território rastreado: `scripts/rex_corpus_b/`,
`docs/rex_corpus_b/`, `data/rex_corpus_b/`.

## 1. Conhecimento Nemesis/Enigma já produzido (cadeia PR #79)

Contratos e vetores vivem no branch `codex/rex-b-codecs` @
`9b2389d27c4945c2e13d4344d0ad4e341c784861` (NÃO mesclados na base desta
frente). Lidos via objeto git (somente-leitura; outros worktrees não são
tocados). Snapshots de referência em `docs/rex_corpus_b/reference/` e
fixtures autorais vendorizadas em `data/rex_corpus_b/vendor/` (60 arquivos;
manifests SHA-256: nemesis `1cfc37568839bcd4…`, enigma `27228903f884f0fa…`).

Fatos MEDIDOS que esta frente herda (não re-presumidos):

- **Nemesis**: plain deve ser múltiplo de 32 B e > 0 (Art Words 8×8 de planos
  de bit); fora do domínio o oráculo padeia (6 B → 32 B; 100 B → 128 B) e
  plain VAZIO SEGFAULTA (rc=139). Truncamento NÃO detectável por tamanho
  (planes_64k −1 byte → rc=0, 65536 B, diverge a partir do byte 65508).
  Encode é tabela adaptativa por nibble — goldens literais blocked com
  motivo; 9 roundtrips RT-OK + 7 negativos (n01..n07) com sondas.
- **Enigma**: domínio é array de int16 BE (plain com `len % 2 == 0`);
  oráculo descarta cauda ímpar em silêncio; truncamento aceito (rc=0 com
  4098 B ≠ esperado); declaração de comprimento inflada IGNORADA; modo
  inexistente (0x02) decodifica como pleno. 10 roundtrips + 7 negativos
  (e01..e07). Semântica completa dos cabeçalhos pós-modo NÃO fixada.
- Parâmetros externos do formato Enigma exigidos pelo jogo (base de tiles /
  deslocamento) NÃO são adivinhados: esta frente deve registrá-los por
  evidência do consumidor real (instrução da missão).

## 2. Oráculos EXISTENTES no host (nenhum foi baixado ou construído agora)

| Item | Pin/versão | Verificação medida 2026-09-30 |
|---|---|---|
| checkout mdcomp | `72c6df405a75d322c5b3722da46c3abb864d3793` | `git rev-parse` em `~/.cache/rex-codecs/references/mdcomp` = pin |
| `nemcmp` | binário compilado do pin | SHA-256 `7563a1522b01a89774dc8909204de433a1f4f87f8a99f6f10311989be2022a27` |
| `enicmp` | binário compilado do pin | SHA-256 `a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18` |
| `koscmp` | mesmo pin | SHA-256 `a74c92957eccf9c1e5143167af9d6d98b2ce087aed8fe10d50b1f9c016373ea3` — **bate o pin da rodada Kosinski** |

Comandos exatos: encode `nemcmp IN OUT` / decode `nemcmp -x IN OUT`;
`enicmp IN OUT` / `enicmp -x IN OUT` (também aceitam `-x={pointer}`,
capacidade separada — non-blocking nesta frente). Licença mdcomp: LGPL-3.0
(except `src/asm`) — **somente ferramenta externa; proibido transplantar
código**. Isolamento obrigatório: `timeout` + stdin fechado + limites de
memória/saída (o próprio inventário mediu loop >60 s e SEGFAULT do oráculo;
`scripts/rex_profiles/codecs/common/sandbox.sh` snapshotado em reference/).

## 3. Contratos comuns v1 (integrador)

`docs/rex_profiles/CONTRACTS.md` v1 (snapshot em reference/):
ProfileManifest/EvidenceRecord congelados; códigos de erro do codec
(`truncated`, `invalid-reference`, `overflow`, `excessive-output`,
`work-limit`, `cancelled`), `bytes_consumed` exato obrigatório, proibido
varrer todos os offsets com todos os codecs, status cumulativos
`candidate → identified → decoded → editable → reinsertable → observed_effect`.
O JSON de entrega desta frente usa os campos da missão, que são um
superconjunto compatível (mapeamento documentado na entrega).

## 4. Lacunas que ESTA frente ataca

1. Nemesis/Enigma nunca tiveram **recurso real em ROM** (perfis fixture-only;
   identificação cabia ao integrador — agora é escopo B com corpus BYOR
   read-only).
2. Goldens literais blocked: esta frente NÃO reabre por suposição — usa os
   roundtrips publicados +_decode do produto candidato vs oráculo_ sobre
   streams reais extraídas (prova externa, não espelho).
3. Reconstrução gráfica (tiles 4bpp empacotados, tilemap, paleta, sprite) é
   território novo: sem painel segundo, sem produto, só scripts próprios.
4. Corpus anterior varrido (megadrive/) não tinha Sonic; a missão aponta
   também `genesis/` e `megadrivejp/` — varredura por hash obrigatória antes
   de qualquer alegação.
