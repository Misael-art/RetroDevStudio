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
| aplib | OK | OK (8 plains CROSS-OK + 9 goldens GOLDEN-CONFIRMED incl. g08 fronteira de bytes_consumed, manifest com hashes) | pendente (contrato do produto entregue: `scripts/.../aplib/PRODUCT-CONTRACT.md` + `verify-product.sh`) | OK 7 negativos negative-spec derivados do contrato (defeito de validação da referência registrado; oráculos não executados neles) | OK paridade apultra<->APJ | Experimental (vetores+negativos confirmados; pacote p/ implementação nativa do integrador) |
| lz4w-sgdk | OK | OK (12 plains RT-OK + 9 goldens GOLDEN-CONFIRMED + dicionário d01 DICT-RT-OK com paridade de espelho byte a byte, manifest com hashes) | pendente | OK 7 negativos negative-spec derivados do contrato (truncated ×3, invalid-reference ×3, excessive-output ×1; oráculos não executados neles); defeitos do oráculo registrados | N/A estrutural: sem 2º oráculo multi-autor (limitação declarada no manifest); divergência jar↔68k no bit-fonte ROM registrada na fonte, prova em emulação pendente | Experimental (vetores+negativos+dicionário confirmados por oráculo único do ecossistema; produto aguarda contrato) |
| nemesis | OK (mdcomp HEAD; LGPL, ferramenta externa) | parcial: 9 plains RT-OK no domínio ×32 (hashes no manifest); goldens literais **blocked com motivo** (exigem espelhar tabela adaptativa de nibble) | pendente | parciais: padding fora do domínio + loop sem limite documentados | blocked: 1 oráculo só nesta rodada | Experimental (roundtrip fixado; produto aguarda contrato) |
| kosinski | OK (mdcomp HEAD; LGPL, ferramenta externa) | OK (12 plains RT-OK+MIRROR com camada strict/contrato 12/12 + 10 goldens GOLDEN-CONFIRMED — m09/m10 discriminam a fronteira de early-fetch; exceção declarada m02 sem EOD; manifest com hashes) | pendente | OK 5 negativos negative-spec derivados do contrato (k01–k05: truncated ×2, invalid-reference ×2, excessive-output em stream válida), verificados pelo espelho strict sem executar o oráculo; padding de 1 byte pós-terminator medido no koscmp | blocked: só 1 oráculo nesta rodada (koscmp); paridade com driver 68k não executada | Experimental (vetores+negativos confirmados; aguarda contrato p/ produto) |
| enigma | OK (mdcomp HEAD; LGPL, ferramenta externa) | parcial: 10 arrays int16 BE RT-OK (hashes no manifest); goldens literais **blocked com motivo** | pendente | parciais: cauda ímpar descartada (5->4) + truncado aceito sem erro medidos | blocked: 1 oráculo só nesta rodada | Experimental (roundtrip fixado; produto aguarda contrato) |

"Nenhum" = capacidade não declarada. Cross-oracle da coluna 5 é verificação
dos oráculos entre si (pré-condição), não prova do produto.

## Regras deste diretório

- Nunca ajustar a referência para a implementação sob teste passar.
- Roundtrip interno produto<->produto não conta como prova.
- Streams do corpus BYOR ficam fora do git; apenas hashes e metadados.
- Ferramentas pesadas: um job por vez, com `timeout` obrigatório
  (ver limitações de oráculos em `ORACLE-INVENTORY.md`).
