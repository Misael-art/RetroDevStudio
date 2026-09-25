# Inventário de oráculos — fase 1 (fixação de referências)

Datas de verificação: 2026-09-24. Host: READY (`host:diagnose`).
Nada aqui foi transplatado para o produto; são ferramentas externas invocadas
por CLI, cada uma com comando exato e limitações observadas.

## Cadeia de proveniência

| Item | Pin | Verificação |
|---|---|---|
| SGDK (git) | `2eac605a7744a6eb4f61824bb24ccab39b8bd8b8` (HEAD 2026-09-24) | `git ls-remote` + clone em `~/.cache/rex-codecs/references/sgdk` |
| SGDK release v2.11 | `sgdk211.7z` SHA-256 `5cc704b7e3a15183c33e721a1d7f84c067cf78808754556d03bb14764df51437` | download oficial GitHub release |
| lz4w.jar (v2.11) | SHA-256 `bfcf9c692696aac21be23f0d48a9ccf788963a4ae7039cb7af276ed745bca4bb` | dentro do 7z acima |
| rescomp.jar (v2.11) | SHA-256 `502a467047df66b7e4c24023fa2ccdceae3e963aee664ede4bdc28fb0f55e603` | idem |
| apj.jar (v2.11) | SHA-256 `2d8cdc63cc800e4b86ff4d9cdfe514001b77f788abcd02d61974dc319d026204` | idem |
| mdcomp (git, C++) | `72c6df405a75d322c5b3722da46c3abb864d3793` (HEAD 2026-09-24) | clone em `~/.cache/rex-codecs/references/mdcomp` |
| apultra v1.4.8 (git) | `8f340057d7402c10da3d9c76c599f9ab83b8a22d` (2023-05-16) | clone em `~/.cache/rex-codecs/references/apultra` |
| Boost headers 1.86.0 | `boost_1_86_0.tar.gz` SHA-256 `2575e74ffc3ef1cd0babac2c1ee8bdb5782a0ee672b1912da40e5b4b591ca01f` | archives.boost.io, usado só p/ compilar mdcomp |

Licenças:
- SGDK: MIT (`license.txt`); ferramentas `apj`/`lz4w`/`rescomp` sob a mesma licença (README apj: "Same license than SGDK").
- apultra: Zlib + CC0 em `matchfinder.c` (README). Adequado como oráculo externo.
- mdcomp: LGPL-3.0, exceto `src/asm` (licença própria). **Proibido transplantar
  código LGPL para o produto**; uso restrito como ferramenta externa de teste.
- aPLib original (Jørgen Ibsen): licença própria "free for any use" — não
  baixado; apultra cobre o formato e é开源 zlib.

## Comandos de oráculo verificados (host atual)

Build: ver `scripts/rex_profiles/codecs/setup-oracles.sh`.

- **aPLib stream (raw, sem header)**
  - encode: `apultra -c IN OUT` (também `-b` para mode 2 bridge)
  - decode: `apultra -d IN OUT`
  - encoder alternativo SGDK: `java -jar apj.jar p|pp IN OUT s`
  - decoder alternativo SGDK: `java -jar apj.jar u IN OUT s`
  - Cross-check observado: apj.p e apultra -c produzem streams que **ambos**
    decodificam nos dois oráculos (paridade em `semi.bin` 77B). O decoder do
    produto deve aceitar stream de apultra **e** de apj (mesmo formato raw
    aPLib; confirmar variantes no contrato).
- **LZ4W SGDK**
  - encode: `java -jar lz4w.jar p IN OUT s`; com dicionário: `p PREV@IN OUT s`
  - decode: `java -jar lz4w.jar u IN OUT s`
  - roundtrip release-jar verificado no host.
  - Dicionário externo é **dependência declarada** (launcher aceita
    `prevfile@infile`); nunca tratar stream LZ4W órfão como autônomo.
- **Kosinski (mdcomp HEAD C++)**
  - encode: `koscmp IN OUT` ; decode: `koscmp -x IN OUT` ; recompress: `-c`
    ; modular: `-m [-p PAD]` (capacidade separada, não incluída na variante
    base)
- **Enigma (mdcomp)**
  - encode: `enicmp IN OUT` ; decode: `enicmp -x IN OUT` (verificado)
- **Nemesis (mdcomp)**
  - encode: `nemcmp IN OUT` ; decode: `nemcmp -x IN OUT`
  - **não verificado roundtrip com dados arbitrários** — ver limitações.

## Limitações e perigos observados (evidências, não suposições)

1. `nemcmp -c <plain>` (decode de bytes não-Nemesis) entrou em loop
   consumindo CPU por >60s e precisou ser morto. Oráculos mdcomp **não**
   têm limite de trabalho; todo teste deles exige `timeout` do harness e
   stdin fechado (`</dev/null`).
2. `nemcmp` roundtrip exato com payload arbitrário falhou silenciosamente:
   provável expectativa de formato ArtWord/tiles no caminho de encode.
   Investigar em `nemesis.md` antes de usar como oráculo de encode genérico.
3. CLI do APJ imprime um byte extra `'T'` no stdout em modo não-silencioso;
   usar sempre o 4º argumento silencioso (`s`) para evitar contaminação —
   observado em arquivo, stdout não contém header.
4. `koscmp -c` **não é decoder puro**: decodifica e re-codifica; usar `-x`
   para decode. Não confundir nos testes diferenciais.
5. Sem JDK no host (só JRE 17): ECJ falhou para fontes SGDK; os jars oficiais
   v2.11 cobrem `lz4w`/`apj`. Paridade jar-vs-HEAD-git é verificada
   comportamentalmente nos vetores, não por build.

## Corpus local (BYOR, read-only)

- `/home/misael/emulation/roms/megadrive/`: hacks MD+ (Doom, MK2) e homebrew
  RocketPanda. **Nenhum Sonic na pasta principal** até o momento — Kosinski/
  Enigma/Nemesis clássicos podem não ter evidência real local; nesse caso os
  perfis ficam **fixture-only** e isso deve ser declarado.
- SNES: títulos comerciais variados (fora do escopo desta rodada de codecs).
- Próximo passo: varredura de assinatura apenas em homebrew autoral/redistribuível
  e via script B; nunca publicar bytes extraídos de ROM comercial.
