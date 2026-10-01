# Perfil: Enigma — fase 2 (roundtrip) + negativos concluídos; goldens blocked com motivo

Status: **Experimental — vetores roundtrip fixados pelo oráculo mdcomp
enicmp; implementação de produto não começada** (aguarda janela).

Propriedade: scripts/rex_profiles/codecs/enigma/,
data/rex_profiles/codec/enigma/, docs/rex_profiles/codecs/enigma.md.

## Referência fixada

mdcomp `enicmp` C++ HEAD (`src/lib/enigma.cc`), commit
`72c6df405a75d322c5b3722da46c3abb864d3793`, LGPL-3.0 — **somente ferramenta
externa; proibido transplantar código**. Formato: array de int16 BE com modo
inline e modo codificado (delta + códigos de comprimento variável + threshold
de zeros). Sem segundo oráculo exercitado (blocked).

## Fatos medidos

- Roundtrip exato `plain -> enicmp -> enicmp -x == plain` em 10 fixtures
  (vazio, 1 word, zeros, constantes, rampa com sinal, deltas extremos,
  ruído inline, runs, limiar de zeros, array 4k).
- **Comprimento ímpar (alinhamento — diretriz do integrador)**: o oráculo
  descarta a cauda órfã em silêncio (5→4, re-asserido no build). Domínio do
  formato: plain com `len % 2 == 0` (array de int16 BE). O produto DEVE
  recusar ímpar com erro estruturado (`input-not-in-domain`), nunca truncar
  como a referência.
- **Truncamento**: aceito sem erro (rc=0) com saída maior que o prefixo
  legítimo permite; sem o último byte também produz o array completo.
  O decoder clássico não tem detecção de truncamento nem limite de
  trabalho — `truncated`/`excessive-output`/`work-limit` são obrigações do
  produto, não espelháveis no oráculo.
- Goldens literais (stream artesanal) blocked com motivo: exigiriam
  espelhar bit-a-bit o empacotador de códigos variáveis do enicmp antes de
  existir decoder do produto para cruzar — adivinhar a referência é proibido.

## Negativos negative-spec (fase 4) — 7 vetores, derivados do contrato

Como não há espelho do decode (empacotador variável blocked), cada spec em
`negative/negative-spec.json` carrega uma **sonda determinística** executada
pelo build que reproduz o número medido no oráculo; qualquer divergência
aborta antes de publicar. O oráculo **nunca é verificador do spec**.

| Vector | Mutação | Medido no oráculo | Obrigação do produto |
|---|---|---|---|
| e01 | plain ímpar (5 B) | decode → 4 B (cauda descartada) | recusar (`input-not-in-domain`) |
| e02 | planes_4k.eni −1 byte | rc=0, **4098** ≠ 4096 | `truncated` |
| e03 | bytes [4..5] → 0xFFFF (declaração inflada) | saída byte-idêntica ao pleno — declaração IGNORADA | declarações são entrada não-confiável |
| e04 | modo 0x09 → 0x02 (código inexistente) | decodifica idêntico ao pleno | rejeitar modo não-definido |
| e05 | stream vazia | rc=0, 0 bytes | `truncated` |
| e06 | 255 B de 0xFF (lixo) | rc=0, 0 bytes, silencioso | erro estruturado dentro de limites |
| e07 | stream REAL válida + `max_out=1024` | (sem sonda — stream boa) | `excessive-output` |

A semântica completa dos cabeçalhos (campos após o byte de modo) **não foi
fixada** nesta fase — apenas o observado nas 11 streams publicadas; a
especificação final pertence à fase 3.

## Regenerar

`bash scripts/rex_profiles/codecs/enigma/build-vectors.sh`
(timeout em toda chamada ao oráculo; imprime `agregado=`, `roundtrips OK:` e
`negativos negative-spec:`; aborta se qualquer sonda divergir).

## Pendências

- [x] Negativos estruturados derivados do contrato (e01..e07 com sondas
      determinísticas re-asseridas no build).
- [ ] Rust produto (decode+encode) contra estes vetores (janela pesada do
      integrador).
- [ ] Modelo de stream literal p/ goldens (decidir com integrador).
- [ ] Paridade com driver 68k clássico de Sonic (2º oráculo).
- [ ] Identificação de recurso real em ROM: integrador.

## Regenerável
