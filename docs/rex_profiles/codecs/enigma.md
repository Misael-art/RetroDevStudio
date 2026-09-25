# Perfil: Enigma — fase 2 (roundtrip) concluída; goldens blocked com motivo

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
- **Comprimento ímpar**: o oráculo descarta a cauda órfã em silêncio
  (5→4). Negativo medido, publicado no manifest como ODD-TAIL.
- **Truncamento**: aceito sem erro (rc=0) com saída maior que o prefixo
  legítimo permite; sem o último byte também produz o array completo.
  O decoder clássico não tem detecção de truncamento nem limite de
  trabalho — `truncated`/`excessive-output`/`work-limit` são obrigações do
  produto, não espelháveis no oráculo.
- Goldens literais (stream artesanal) blocked com motivo: exigiriam
  espelhar bit-a-bit o empacotador de códigos variáveis do enicmp antes de
  existir decoder do produto para cruzar — adivinhar a referência é proibido.

## Regenerar

`bash scripts/rex_profiles/codecs/enigma/build-vectors.sh`
(timeout em toda chamada; imprime `agregado=` e `roundtrips OK:`).

## Pendências

- [ ] Rust produto + negativos estruturados (janela pesada do integrador).
- [ ] Modelo de stream literal p/ goldens (decidir com integrador).
- [ ] Paridade com driver 68k clássico de Sonic (2º oráculo).
- [ ] Identificação de recurso real em ROM: integrador.
