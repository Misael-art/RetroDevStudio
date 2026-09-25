# Perfil de codecs REX — agente B

Propriedade: `scripts/rex_profiles/codecs/`, `data/rex_profiles/codecs/`,
`docs/rex_profiles/codecs/`. Este diretório registra referências fixadas,
oráculos verificados e status por capacidade. Não é contrato congelado:
o contrato de codec vem do integrador; até ele ser publicado, nada aqui
autoriza implementação "pronta".

Ordem da missão: aPLib -> LZ4W SGDK -> Nemesis -> Kosinski -> Enigma.

## Matriz de capacidades (atualizada a cada entrega)

| Perfil | Fase 1 fonte/commit/licença | Fase 2 vetores | Fase 3 implementação | Fase 4 negativos | Fase 5 cross-oracle | Status |
|---|---|---|---|---|---|---|
| aplib | OK | OK (8 plains CROSS-OK + 8 goldens GOLDEN-CONFIRMED, manifest com hashes) | pendente | pendente | OK paridade apultra<->APJ | Experimental (vetores confirmados; aguarda contrato p/ produto) |
| lz4w-sgdk | OK | pendente | pendente | pendente | OK paridade básica de oráculo | Experimental (referência fixada) |
| nemesis | OK | pendente | pendente | pendente | pendente | Experimental (referência fixada) |
| kosinski | OK | pendente | pendente | pendente | pendente | Experimental (referência fixada) |
| enigma | OK | pendente | pendente | pendente | pendente | Experimental (referência fixada) |

"Nenhum" = capacidade não declarada. Cross-oracle da coluna 5 é verificação
dos oráculos entre si (pré-condição), não prova do produto.

## Regras deste diretório

- Nunca ajustar a referência para a implementação sob teste passar.
- Roundtrip interno produto<->produto não conta como prova.
- Streams do corpus BYOR ficam fora do git; apenas hashes e metadados.
- Ferramentas pesadas: um job por vez, com `timeout` obrigatório
  (ver limitações de oráculos em `ORACLE-INVENTORY.md`).
