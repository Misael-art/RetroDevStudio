# Perfil: Nemesis — fase 2 (roundtrip) concluída; goldens blocked com motivo

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

- Domínio: Art Words 8×8 de planos de bit → **múltiplos de 32 bytes**.
  Fora do domínio o oráculo é silencioso e perigoso: entrada de 6 bytes
  decodifica em 32, de 100 em 128 (padding); bytes não-Nemesis para
  `nemcmp -x` podem entrar em loop sem limite de trabalho (ver
  ORACLE-INVENTORY limitação 1 — sempre `timeout` + `</dev/null`).
- Codificação é adaptativa por nibble (tabela dinâmica); o parser do encoder
  não é reproduzível por spec estática → **goldens literais bloqueados com
  motivo**: construir espelho da tabela seria adivinhar a referência. A prova
  publicada é `plain -> nemcmp -> nemcmp -x == plain` (9/9 RT-OK), que fixa o
  resultado do decode do produto para cada fixture.

## Vetores publicados (fixture-only)

9 plains: fronteiras de canal (0x00/0xFF/0x55-AA), gradientes, runs longos,
rampa de nibble 512, pseudoaleatório semeado (0xBEEF), repetição a 4k,
planes 64k. Regenerável: `bash scripts/rex_profiles/codecs/nemesis/build-vectors.sh`
(imprime `agregado=` e `roundtrips OK:`; aborta em qualquer divergência).

## Requisitos que isso impõe ao produto

- Recusar entrada fora do domínio com erro estruturado (não padrinhar).
- `work-limit` + cancelamento cooperativo obrigatórios no decoder (o oráculo
  não os tem; um decoder de produto sem limite herda o loop).
- Encode do produto não precisa reproduzir bytes do nemcmp — deve decodificar
  exato pelo nemcmp (contrato v1 §4).

## Pendências

- [ ] Espelho da tabela adaptativa p/ goldens literais (decidir com o
      integrador se vale a janela; hoje: blocked justificado).
- [ ] Implementação Rust + negativos estruturados (janela pesada).
- [ ] Modo `=[pointer]` do CLI: capacidade separada blocked.
- [ ] Identificação de recurso real em ROM: integrador.
