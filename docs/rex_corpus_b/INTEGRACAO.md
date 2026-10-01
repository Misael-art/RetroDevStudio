# INSTRUCOES DE INTEGRACAO — frente B (corpus BYOR, Nemesis/Enigma + contexto grafico)

Para o integrador. Nada aqui exige produto; tudo e ferramenta de pesquisa
somente-leitura sobre ROM BYOR identificada por SHA-256.

## 1. Ordem sugerida de leitura

1. `RELATORIO-INTEGRACION-B.md` — o que esta provado, o que nao, decisoes suas.
2. `RECONCILIACAO.md` — base, pins de oraculos, lacunas com estado.
3. `NEMESIS-RESEARCH.md` / `ENIGMA-RESEARCH.md` — contratos dos codecs e
   divergencias registradas (inclui a 4ª divergencia: len=0).
4. `MD-CONTEXTO-GRAFICO.md` — contrato grafico (chunky, nametable, paleta) e
   classificacao de evidencias corrigida.

## 2. Como reproduzir cada prova (com as ROMs BYOR do host)

```bash
cd /home/misael/RDS-REX-CORPUS-B

# 1. Paridade externa de TODOS os recursos do locator (196/196)
python3 scripts/rex_corpus_b/confirmar-oraculo-pulseman.py \
    --localizar "data/rex_corpus_b/recursos/locate-Pulseman (Japan) (Translated En) (Translated PtBr).json" \
    --out data/rex_corpus_b/recursos/pulseman-oraculo-completo.json

# 2. Varredura de consumidor (Sonic 1: localizado; Pulseman: negativo delimitado)
python3 scripts/rex_corpus_b/test-procurar-consumidor.py          # controle positivo
python3 scripts/rex_corpus_b/procurar-consumidor.py --rom ROM --nome X \
    --tabela 0x1b64c --tamanho 24 --out data/rex_corpus_b/recursos/consumidor-X.json

# 3. Composicao dos 6 nametables Sonic 1 (consumidor + value_offset=0 pre-condicao)
python3 scripts/rex_corpus_b/test-compor-recurso.py               # stream empacotada pelo oraculo
python3 scripts/rex_corpus_b/compor-recurso.py --rom ROM --offset 0x65432 \
    --consumidor data/rex_corpus_b/recursos/consumidor-sonic1-mapas.json \
    --out data/rex_corpus_b/recursos/sonic1-mapa-0x65432.json \
    --render /tmp/rex-corpus-b/composicao                          # PNGs FORA do Git

# 4. Reclassificacao das evidencias Sonic 1 (6 recursos / 6 nao-recursos)
python3 scripts/rex_corpus_b/classificar-sonic1.py

# 5. Divergencia len=0 do Nemesis (oraculo tolera / strict recusa / lenient idêntico)
python3 scripts/rex_corpus_b/test-nemesis-len0.py \
    --out data/rex_corpus_b/nemesis/evidence/len0-fixture.json

# 6. Suites de codec completas
bash scripts/rex_corpus_b/nemesis-validate.sh
bash scripts/rex_corpus_b/enigma-validate.sh
```

## 3. O que o integrador pode consumir direto

* **Paridade externa como prova de perfil:** os 196 registros de
  `pulseman-oraculo-completo.json` sao o par (meu decode, oraculo) que o
  contrato v1 pede para `candidate → decoded`; `bytes_consumed` exato em cada
  um.
* **value_offset `consumer-proven`:** a cadeia `0x1b6c4 → $171E` com `d0=0` e
  destino `$FF4000` fixa `value_offset=0` para o perfil Enigma do produto,
  SE o contrato quiser aceitar evidencia de consumidor (decisao sua — §5 do
  relatorio).
* **Recursos contextuais:** os seis `sonic1-mapa-*.json` sao nametables
  completos (campos + estatisticas + negativos), com os vinculos nao provados
  marcados `not-evidenced` e a referencia faltante escrita em cada um.
* **Regra de classificacao:** decode rc=0 do oraculo que le alem do EOF ou
  fora de dominio e FALSA ACEITACAO, nao recurso (`sonic1-classificacao.json`).

## 4. Riscos e limites para a integracao

1. **Sem execucao de ROM:** toda a cadeia do consumidor e estatica. Antes de
   expor no produto, observe os 6 mapas em emulacao (janela do integrador).
2. **Consumidor ausente ≠ ausente:** o negativo de Pulseman e delimitado as
   formas varridas (lista de lacunas no proprio JSON).
3. **Len=0:** se o produto usar o decoder strict, streams com registros
   `len=0` inatingiveis serao recusadas — o oraculo as aceita; o modo
   lenient existe e esta testado, a escolha e de contrato.
4. **Territorio:** nada fora de `scripts|docs|data /rex_corpus_b/` foi
   tocado; sem merge, sem release, sem alteracao de produto/crates/docs comuns.
