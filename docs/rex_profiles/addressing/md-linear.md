# Perfil de enderecamento: Mega Drive linear (`md-linear`)

Perfil de referencia para traducao de enderecos CPU do 68000 em offsets de ROM
para cartuchos Mega Drive **sem mapper** (ROM espelhada por mascara). Selecao
contextual da rodada REX (corpus Sonic/SGDK), nao uma alegacao de popularidade.

Fonte primaria (fixada por commit, consultada como especificacao; **nenhum codigo
copiado** — ver licenca abaixo):

- Repositorio: https://github.com/ekeeke/Genesis-Plus-GX
- Commit: `939ce4f045f981f89965f24780cef045cc5e52d7`
- Arquivos citados:
  - `core/cart_hw/md_cart.c:322-326` — tamanho da ROM elevado a potencia de 2.
  - `core/cart_hw/md_cart.c:337-348` — ROM menor que a potencia de 2 e preenchida com `0xFF`.
  - `core/cart_hw/md_cart.c:350` — `cart.mask = size - 1` (espelhamento por mascara).
  - `core/cart_hw/md_cart.c:356-367` — mapeamento default: `0x000000-$3FFFFF` aponta
    `cart.rom + ((i << 16) & cart.mask)` por bloco de 64KB.
  - `core/cart_hw/md_cart.c:369-377` — `0x400000-$7FFFFF` e area nao usada (open bus).
  - `core/mem68k.c:145-167` — janela `$A0xxxx`: `switch ((address >> 13) & 3)` com
    `default: zram[address & 0x1FFF]` (Z80 RAM de 8KB espelhada) e casos YM2612/misc.
  - `core/mem68k.c:967-970` — `case 0x30: TIME` encaminha escritas `$A130xx` ao
    handler do cartucho (`cart.hw.time_w`).
  - `core/genesis.c:77-87` — `$800000-$DFFFFF` e acesso ilegal (lockup).
  - `core/genesis.c:92-99` — portas VDP em `$C0xxxx/$C8xxxx/$D0xxxx/$D8xxxx`.
  - `core/genesis.c:100-113` — `$E00000-$FFFFFF`: Work RAM de 64KB (`work_ram`),
    leitura via `base + (address & 0xFFFF)` (espelho por 64KB).
- Licenca: Genesis-Plus-GX license (estilo MAME, nao comercial, disponivel em
  `LICENSE.txt` do repositorio acima). A licenca **nao autoriza transplantar
  codigo**; este perfil e uma reimplementacao independente a partir do
  comportamento documentado do hardware naquela fonte.

## Modelo de estado

`mapper_state` (perfil sem banco remapeavel):

```json
{ "rom_size": 524288 }
```

- `rom_size` e **obrigatorio**, inteiro, potencia de 2, entre 0x10000 (64KB) e
  0x400000 (4MB). E o tamanho da ROM **ja normalizada**: ROM cuja com o arquivo
  cru nao potencia de 2 deve ser normalizada (preenchimento com 0xFF ate a
  proxima potencia de 2, como em `md_cart.c:337-348`) por quem chama, e o passo
  de normalizacao e registrado na evidencia, nao dentro do perfil.
- `rom_size > 0x400000` exige mapper (ex.: SSF2) e retorna erro `unsupported`.
- O perfil nao tem registradores com estado; escritas em qualquer endereco nao
  alteram traducoes seguintes. Contraste com `md-ssf2`.

## Regioes suportadas por `translate`

| Janela CPU | Regiao | Offset | Fonte |
|---|---|---|---|
| `0x000000-0x3FFFFF` | `rom` | `addr & (rom_size - 1)` | md_cart.c:350,356-367 |
| `0xA00000-0xA03FFF` e `0xA08000-0xA0BFFF` | `z80-ram` | `addr & 0x1FFF` | mem68k.c:145-167 |
| `0xA10000-0xA12FFF`, `0xA14000-0xA1FFFF` | `io` | `addr - 0xA10000` | mem68k.c (roteamento `$A1xxxx`) |
| `0xA13000-0xA130FF` | `cart-io` | `addr - 0xA13000` | mem68k.c:967-970 (`TIME`) |
| `0xE00000-0xFFFFFF` | `work-ram` | `addr & 0xFFFF` | genesis.c:100-113 |

Alias: cada offset de `rom` aparece `0x400000 / rom_size` vezes dentro da janela
do cartucho (espelho por mascara). `invert` retorna **todos** eles.

## Erros estruturados (`translate`/`read`)

- `addr > 0xFFFFFF` ou `length` invalido -> `out-of-range` (barramento 24 bits do
  68000; validado antes de qualquer alocacao).
- `rom_size` ausente/nao potencia de 2/fora de [0x10000, 0x400000] ->
  `unsupported` com detalhe exigindo normalizacao ou mapper.
- Janelas fora da tabela acima (ex.: `0x400000-0x7FFFFF` open bus,
  `0x800000-0x9FFFFF`, `0xA04000-0xA07FFF`/`0xA0C000-0xA0FFFF` sound bus,
  `0xC00000-0xDFFFFF` VDP) -> `unsupported` com nome da regiao.
- Erro nunca vira offset 0 e nenhuma funcao entra em panic.

## `invert(rom_offset, mapper_state)`

Retorna todos os aliases CPU dentro de `0x000000-0x3FFFFF`:
`offset + k * rom_size` para `k = 0 .. (0x400000/rom_size - 1)`. Lista vazia
quando `rom_offset >= rom_size` (offset inexistente) — resposta valida, nao erro.

## `read(cpu_address, length, mapper_state, rom)`

- Cruza fronteiras de janela/espelho retornando `segments`; cada segmento tem
  `region`, `offset` e `bytes` (para regioes com backing ROM) ou `error`
  (regiao sem backing ou `unsupported`).
- Leitura alem do fim da ROM sem espelho nao existe neste perfil (o espelho por
  mascara cobre toda a janela); `out-of-range` ocorre ao ultrapassar
  `0xFFFFFF` ou com `length < 1`.
- `rom` menor que `rom_size` declarado -> `out-of-range` no trecho faltante
  (sem clamp silencioso), porque o estado declarado e maior que o dispositivo.

## Limites explicitos (v1)

- Nao modela SRAM no espaco do cartucho, TMSS, VDP, YM2612, Mega-CD, SVP,
  mappers (SSF2 e outros), nem espelhamento fino interno da area de I/O
  (apenas a janela por 64KB e classificada).
- Escrita em `cart-io` (`0xA130xx`) nao tem efeito neste perfil (sem estado);
  o mapper SSF2 e perfil separado (`md-ssf2`).
- Header da ROM nao e inspecionado: o perfil nao deduz mapa por texto de header
  (contrato: header sozinho nao prova o mapa).
