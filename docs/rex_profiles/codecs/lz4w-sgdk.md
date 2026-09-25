# Perfil: LZ4W SGDK (stream cru do CLI v1.43) — fases 1–2 concluídas

Status: **Experimental — referência fixada e vetores confirmados pelo oráculo
externo do ecossistema; SEM segundo oráculo independente multi-autor
(limitação estrutural do formato, declarada)**. Implementação de produto ainda
não começada.

## Referência fixada

| Papel | Artefato | Pin | Licença |
|---|---|---|---|
| oráculo externo (encode+decode) | `lz4w.jar` v1.43 (SGDK release v2.11) | SHA-256 `bfcf9c692696aac21be23f0d48a9ccf788963a4ae7039cb7af276ed745bca4bb` | MIT (SGDK) |
| fonte do oráculo | `tools/lz4w/src/sgdk/lz4w/LZ4W.java` | SGDK git `2eac605a7744a6eb4f61824bb24ccab39b8bd8b8` | MIT |
| desempacotador alvo no hardware | `lz4w_unpack` 68k | mesmo commit, `src/tools_a.s:253+` (jump-table) | MIT |

Independência: **não alcançável** — LZ4W é formato proprietary de autor único
(Stephane Dallongeville). Busca GitHub/web em 2026-09-25 não encontrou segunda
implementação independente licenciada (cópias do asm/portes SGDK; GnGeo sem
licença). Encode e decode de referência vêm do MESMO jar: paridade de
ecossistema, declarada como tal — não equivalente ao par apultra/APJ do aPLib.
O desempacotador 68k é um terceiro leitor do mesmo formato; prová-lo exige
janela de emulação com o integrador.

## Variante fixada

Stream cru do CLI (sem header de tamanho no arquivo — verificado no byte 0 de
saídas reais; `tools.h`/doc não descrevem header para o modo standalone do
jar). Modo dicionário `PREV&IN` = capacidade separada, `blocked`.

## Especificação do formato (calibrada 2026-09-25 vs 8 streams reais do jar)

- Stream = palavras de 16 bits, lidas big-endian da stream; todo o codec é
  orientado a PALAVRAS (o "W" do nome).
- Header de bloco (16 bits): `LLLL MMMM OOOOOOOO`
  - `L` = nº de palavras literais seguintes (0..15), copiadas byte a byte;
  - `M != 0`: match curto, `len = M+1` palavras, `off = O+1` palavras;
  - `M == 0, O != 0`: match longo, `len = O+2` palavras; após os literais,
    uma palavra de offset: `off = ((-valor) & 0x7FFF) + 1`; bit `0x8000` =
    fonte ROM (offset relativo ajustado por `offsetAdj` — fora dos goldens);
  - `L=M=O=0`: EOD.
- Após o EOD: palavra final `0x8000|ultimo byte` se a saída tem comprimento
  ímpar; `0x0000` caso contrário. A doc `bin/lz4w.txt` afirma `D==0 escreve
  byte` — **contradiz o código do oráculo e a medição**; referência registrada
  = código+empiria, divergência documental = fato do perfil.
- Casos degenerados: vazio → `0000 0000` (EOD+final); 1 byte → `0000 80XX`.
  O formato lida com ambos (ao contrário do aPLib).
- Truncamento: o loop para silenciosamente quando faltam palavras; o jar lança
  `ArrayIndexOutOfBoundsException` (rc=1) na leitura fora do fim, mas ACEITA
  rc=0 stream sem palavra final. Erros estruturados do contrato v1 são
  obrigações do produto; não existe espelho de erro no oráculo.

## Vetores fase 2 (construídos e confirmados)

`scripts/rex_profiles/codecs/lz4w-sgdk/` → `data/rex_profiles/codec/lz4w-sgdk/`:
- 12 plains (inclui vazio, 1 byte, ímpar, literais>15 palavras, match curto
  off 1, match longo off 1 e off 2 com palavra 0x7FFF, janela longa 40k,
  pseudoaleatório) roundtrip `RT-OK` no oráculo (pack→unpack byte-exato).
- 9 goldens montados à mão pela spec, validados por espelho Python calibrado
  nos 8 streams reais e publicados só com `u` do oráculo decodificando exato
  (`GOLDEN-CONFIRMED`). Três goldens coincidem byte a byte com a saída do
  próprio encoder em entradas pequenas (k02/k03/k04) — confirmação extra.
- Negativos estruturais do oráculo registrados na evidência (trunc antes do
  EOD → rc=1 AIOOBE; sem palavra final → rc=0 aceita).
- Holdout: `noisy_runs_16k`, `pseudo_random_8k` e `far_window_40k` não foram
  usados para ajustar a spec (calibração usou só os 8 probes reais).

## Pendências deste perfil

- [x] Fase 1: fonte/commit/licença/variante.
- [x] Fase 2: vetores + holdout + negativos de oráculo com manifest/evidência.
- [ ] Implementação Rust do produto (contrato v1 §4) via janela do integrador.
- [ ] Cross-check asm 68k vs jar (janela de emulação; divergência seria
      defeito do ECOSSEMA, não do produto).
- [ ] Capacidade dicionário `PREV&IN` e matches fonte-ROM: vetores próprios.
- [ ] Caso de recurso real p/ integrador ou rótulo fixture-only permanente.
