# Perfil: Nemesis — fase 2 (roundtrip) + negativos concluídos; goldens blocked com motivo

Status: **Experimental — vetores roundtrip fixados pelo oráculo mdcomp nemcmp;
implementação de produto não começada** (aguarda janela do integrador).

Propriedade: scripts/rex_profiles/codecs/nemesis/,
data/rex_profiles/codec/nemesis/, docs/rex_profiles/codecs/nemesis.md.

## Referência fixada

Oráculo: mdcomp `nemcmp` C++ HEAD (`src/lib/nemesis.cc`), commit
`72c6df405a75d322c5b3722da46c3abb864d3793`, **LGPL-3.0 — somente ferramenta
externa; proibido transplantar código ao produto**. Sem segundo oráculo
exercitado nesta rodada (paridade multi-autor `blocked`).

## Fatos medidos (não presumidos)

- **Domínio/alinhamento explícitos** (diretriz do integrador): Art Words 8×8
  de planos de bit → plain deve ser **múltiplo de 32 bytes E > 0**. Fora do
  domínio o oráculo é silencioso e perigoso: entrada de 6 bytes decodifica em
  32, de 100 em 128 (padding); **o encode de plain VAZIO SEGFAULTA o oráculo
  (rc=139)**; bytes não-Nemesis para `nemcmp -x` podem entrar em loop sem
  limite de trabalho (ver ORACLE-INVENTORY limitação 1 — sempre `timeout` +
  `</dev/null`).
- **Truncamento NÃO é detectável por metadados**: `planes_64k.nem` sem o
  último byte decodifica rc=0 com **65536 bytes — o MESMO tamanho do pleno**,
  divergindo no conteúdo só a partir do byte 65508. Um decoder que valida só
  tamanho aceita lixo; o produto precisa de parser real (ou max_out+work-limit
  como cinto).
- Codificação é adaptativa por nibble (tabela dinâmica); o parser do encoder
  não é reproduzível por spec estática → **goldens literais bloqueados com
  motivo**: construir espelho da tabela seria adivinhar a referência. A prova
  publicada é `plain -> nemcmp -> nemcmp -x == plain` (9/9 RT-OK), que fixa o
  resultado do decode do produto para cada fixture.

## Vetores publicados (fixture-only)

- 9 plains: fronteiras de canal (0x00/0xFF/0x55-AA), gradientes, runs longos,
  rampa de nibble 512, pseudoaleatório semeado (0xBEEF), repetição a 4k,
  planes 64k.
- 7 negativos `negative-spec` (n01..n07) em `negative/`, derivados do
  **contrato/domínio**, com **sonda determinística re-asserida a cada build**
  (não há espelho do decode; o oráculo nunca é verificador do spec):

| Vector | Entrada | Medido no oráculo | Obrigação do produto |
|---|---|---|---|
| n01 | plain 6 B (fora de domínio) | decode → 32 B padding | recusar (`input-not-in-domain`) |
| n02 | plain 100 B | decode → 128 B padding | recusar |
| n03 | stream vazia | rc=0, 0 B | `truncated` |
| n04 | 64 B de 0xFF (lixo) | **1048544 B** de saída (reproduzido exato) | falha limitada: `max_out`+`work-limit` |
| n05 | planes_64k.nem −1 byte | rc=0, tamanho **pleno** 65536, conteúdo diverge no rabo | `truncated` (parser real) |
| n06 | prefixo 8 B de alt_55_aa_96.nem | loop morto só pelo sandbox (rc=137) | `work-limit`+cancelamento |
| n07 | stream REAL válida + `max_out=1024` | (sem sonda — stream boa) | `excessive-output` |

Regenerável: `bash scripts/rex_profiles/codecs/nemesis/build-vectors.sh`
(imprime `agregado=`, `roundtrips OK:` e `negativos negative-spec:`; aborta
se qualquer sonda divergir — a prova da referência muda, o spec não).

## Requisitos que isso impõe ao produto

- Recusar entrada fora do domínio com erro estruturado (não padrinhar).
- `work-limit` + cancelamento cooperativo obrigatórios no decoder (o oráculo
  não os tem; um decoder de produto sem limite herda o loop).
- Encode do produto não precisa reproduzir bytes do nemcmp — deve decodificar
  exato pelo nemcmp (contrato v1 §4).

## Pendências

- [x] Negativos estruturados derivados do contrato (n01..n07 com sondas
      determinísticas re-asseridas no build).
- [ ] Espelho da tabela adaptativa p/ goldens literais (decidir com o
      integrador se vale a janela; hoje: blocked justificado).
- [ ] Implementação Rust (janela pesada).
- [ ] Modo `=[pointer]` do CLI: capacidade separada blocked.
- [ ] Identificação de recurso real em ROM: integrador.
