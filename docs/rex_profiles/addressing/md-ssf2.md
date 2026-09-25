# Perfil de enderecamento: Mega Drive mapper SSF2 (`md-ssf2`)

Perfil de referencia para o bank switch do cartucho Super Street Fighter 2
(documentado por Bart Trzynadlowski; ver comentario na fonte primaria).
Selecao contextual da rodada REX (mapper MD com estado explicito), nao uma
alegacao de popularidade.

Fonte primaria (fixada por commit, consultada como especificacao; **nenhum
codigo copiado**):

- Repositorio: https://github.com/ekeeke/Genesis-Plus-GX
- Commit: `939ce4f045f981f89965f24780cef045cc5e52d7`
- Arquivos citados:
  - `core/cart_hw/md_cart.c:1301-1316` — `mapper_512k_w`: "512K ROM paging";
    base do banco = `(data << 19) & cart.mask`; "cartridge area ($000000-$3FFFFF)
    is divided into 8 x 512K banks"; janela alvo derivada de
    `address = (address << 2) & 0x38` (indice base em unidades de 64KB).
  - `core/cart_hw/md_cart.c:1322-1330` — `mapper_ssf2_w`: "only banks 1-7 are
    remappable, bank 0 remains unchanged" (teste `address & 0x0E`).
  - `core/cart_hw/md_cart.c:322-326,337-350` — ROM elevada/pad (0xFF) a potencia
    de 2; `cart.mask = size - 1`.
  - `core/cart_hw/md_cart.c:356-367` — estado inicial: mapeamento default linear
    (janela i => ROM offset `i * 0x80000` dentro da mascara); reinitializado em
    /VRES (`bankshift = 1`, md_cart.c:573-574).
  - `core/mem68k.c:967-970` — escritas do 68k em `$A130xx` (case `TIME`) chegam
    ao handler com o endereco completo.
  - Regioes fora do cartucho: mesmas citadas de `md-linear` (mem68k.c:141-167,
    genesis.c:77-113).
- Licenca: Genesis-Plus-GX License (estilo MAME, nao comercial). Nao autoriza
  transplantar codigo; este perfil e reimplementacao a partir da especificacao.

## Modelo de estado (o estado faz parte da identidade da observacao)

```json
{
  "rom_size": 4194304,
  "banks": { "1": 5, "2": 0 }
}
```

- `rom_size`: obrigatorio, potencia de 2 entre 0x80000 (512KB, uma janela) e
  0x800000 (8MB). ROM SSF2 real de 5MB exige normalizacao (pad 0xFF ate 8MB)
  registrada na evidencia, igual ao perfil linear.
- `banks`: mapa **opcional** janela->valor escrito. Estado inicial (reset, sem
  escritas): identidade, janela `i` => valor `i`. Valor de janela ausente = `i`.
- Valor de banco bruto e mascarado na traducao: base efetiva =
  `(valor << 19) & (rom_size - 1)` (fiel a `mapper_512k_w`); escrever valor
  alem do fim da ROM espelha por mascara, nao vira erro.

## Registradores (`write_mapper_register`, funcao pura)

- Escritas do 68k em `0xA13000-0xA130FF` (janela TIME) chegam ao mapper.
- Janela alvo `w = (addr & 0x0E) >> 1` (bits 1-3 do endereco; decodificacao
  espelhada: `0xA13022` tambem seleciona a janela 1, `0xA130FF` a janela 7).
- `w == 0` (enderecos `0xA130F0/F1` e espelhos): escrita **sem efeito**;
  a janela 0 e fixa no banco 0 (`mapper_ssf2_w`).
- `w >= 1`: `banks[w] = data` (bruto). Reescrita substitui o valor anterior.
- Fora de `0xA13000-0xA130FF`: erro `unsupported` (nao e registrador deste
  mapper). O perfil nunca muta estado recebido; retorna estado novo.

## Regioes suportadas por `translate`

| Janela CPU | Regiao | Traducao |
|---|---|---|
| `0x000000-0x07FFFF` | `rom` | `offset = addr & (rom_size-1)` (janela 0 fixa; identica ao linear pois `rom_size >= 0x80000`) |
| `0x080000 + i*0x80000 .. +0x7FFFF` (i=1..7) | `rom` | `offset = ((banks[i] << 19) & (rom_size-1)) + (addr & 0x7FFFF)` com `banks[i]` default `i` |
| Demais regioes | iguais a `md-linear` | `z80-ram`/`io`/`cart-io`/`work-ram` com os mesmos offsets e `unsupported` para o resto |

Escritas nos registradores mudam traducoes seguintes: `translate(0x080000)`
no estado inicial retorna offset `0x080000`; com `banks[1]=5` retorna
`0x280000`. O par (endereco, mapper_state) e a identidade da observacao.

## Erros estruturados

- Mesmos codigos de `md-linear` (`out-of-range`, `unsupported`), mais:
- `rom_size < 0x80000` -> `unsupported` (SSF2 exige ao menos uma janela de 512KB).
- `banks` com valor nao inteiro/negativo -> `unsupported` com janela indicada.

## `invert(rom_offset, mapper_state)`

Retorna **todos** os aliases no estado dado:

- Janela 0: alias `offset` quando `offset <= 0x7FFFF` (e `offset <= rom_size-1`).
- Janelas i=1..7: alias `i*0x80000 + (offset - base_i)` quando
  `base_i <= offset <= base_i + 0x7FFFF`, com `base_i = (banks[i]<<19) & mask`.
- Resultado ordenado crescente; dois bancos apontando ao mesmo trecho geram
  aliases distintos (enderecos CPU diferentes). Lista vazia e resposta valida.

## `read(cpu_address, length, mapper_state, rom)`

Semantica de segmentos identica a `md-linear` (cruzamento de janela com bancos
distintos gera dois segmentos com offsets nao contiguos; ROM menor que
`rom_size` declarado -> `out-of-range` no trecho faltante; regiao sem backing
ROM -> segmento classificatorio com `error`).

## Limites explicitos (v1)

- Nao modela SRAM do SSF2 (`0x200000-0x20FFFF` quando habilitada), MegaSD
  enhanced SSF2, Everdrive extended SSF (`mapper_512k_w` direto), nem /VRES
  (o estado inicial documentado e o de reset; quem chama reconstroi estados
  intermediarios com `write_mapper_register`).
- Nao executa nem inspeciona a ROM: a deteccao de qual mapper um cartucho real
  usa e hipotese registrada no inventario do corpus, nunca conclusao do perfil.
- Header nao e prova: strings do header nao sao usadas para escolher o mapa.
