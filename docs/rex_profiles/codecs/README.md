# Perfil de codecs REX — agente B

Propriedade: `scripts/rex_profiles/codecs/`, artefatos de perfil em
`data/rex_profiles/codec/<id>/` (caminho do contrato v1) e
`docs/rex_profiles/codecs/`. Este diretório registra referências fixadas,
oráculos verificados e status por capacidade. Não é contrato congelado:
o contrato de codec vem do integrador; até ele ser publicado, nada aqui
autoriza implementação "pronta".

Ordem da missão: aPLib -> LZ4W SGDK -> Nemesis -> Kosinski -> Enigma.

## Matriz de capacidades (atualizada a cada entrega)

| Perfil | Fase 1 fonte/commit/licença | Fase 2 vetores | Fase 3 implementação | Fase 4 negativos | Fase 5 cross-oracle | Status |
|---|---|---|---|---|---|---|
| aplib | OK | OK (8 plains CROSS-OK + 8 goldens GOLDEN-CONFIRMED, manifest com hashes) | pendente | pendente | OK paridade apultra<->APJ | Experimental (vetores confirmados; aguarda contrato p/ produto) |
| lz4w-sgdk | OK | OK (12 plains RT-OK + 9 goldens GOLDEN-CONFIRMED, manifest com hashes) | pendente | pendente (negativos do ORÁCULO registrados; do produto após contrato) | N/A estrutural: sem 2º oráculo multi-autor (limitação declarada no manifest) | Experimental (vetores confirmados por oráculo único do ecossistema) |
| nemesis | OK (mdcomp HEAD; LGPL, ferramenta externa) | parcial: 9 plains RT-OK no domínio ×32 (hashes no manifest); goldens literais **blocked com motivo** (exigem espelhar tabela adaptativa de nibble) | pendente | parciais: padding fora do domínio + loop sem limite documentados | blocked: 1 oráculo só nesta rodada | Experimental (roundtrip fixado; produto aguarda contrato) |
| kosinski | OK (mdcomp HEAD; LGPL, ferramenta externa) | OK (12 plains RT-OK+MIRROR + 8 goldens GOLDEN-CONFIRMED, manifest com hashes; descritor = palavra 16 bits LE LSB-first com early-fetch — corrigido por calibração 12/12) | pendente | pendente (perigos do oráculo sob truncado/refs inválidos registrados) | blocked: só 1 oráculo nesta rodada (koscmp); paridade com driver 68k não executada | Experimental (vetores confirmados; aguarda contrato p/ produto) |
| enigma | OK | pendente | pendente | pendente | pendente | Experimental (referência fixada) |

"Nenhum" = capacidade não declarada. Cross-oracle da coluna 5 é verificação
dos oráculos entre si (pré-condição), não prova do produto.

## Regras deste diretório

- Nunca ajustar a referência para a implementação sob teste passar.
- Roundtrip interno produto<->produto não conta como prova.
- Streams do corpus BYOR ficam fora do git; apenas hashes e metadados.
- Ferramentas pesadas: um job por vez, com `timeout` obrigatório
  (ver limitações de oráculos em `ORACLE-INVENTORY.md`).
