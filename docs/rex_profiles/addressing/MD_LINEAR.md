# Perfil de endereçamento: Mega Drive lineal (`md-linear` v1)

**Estado:** Experimental — referência sintética/fixture-only para tradução de
endereços. Não declara suporte a jogo nenhum; não recupera lógica comercial.
**Escopo:** converter CPU address 68000 (24 bits) + estado do cartucho em
região + offset dentro da ROM normalizada, e a inversão (offset → aliases).
Não define codecs, nem SRAM, nem proteção, nem Z80 (Mega CD fica fora).

## Fontes primárias fixadas (consultadas, não incorporadas)

| Fonte | Commit snapshot | Licença | Uso aqui |
| --- | --- | --- | --- |
| ekeeke/Genesis-Plus-GX `core/cart_hw/md_cart.c` ("DEFAULT CARTRIDGE MAPPING") | `939ce4f045f981f89965f24780cef045cc5e52d7` (2026-09-23) | BSD-style com proibição de uso comercial (custom) — **apenas consulta; nenhum código transplantado** (regra do plano REX) | Confirma janelas, espelho por máscara de potência de dois, $400000–$7FFFFF não-ROM no mapeio padrão |
| Stephane-D/SGDK `inc/memory_base.h`, `inc/memory.h` | `2eac605a7744a6eb4f61824bb24ccab39b8bd8b8` (2026-08-17) | MIT | Confirma base ROM em $000000 e RAM 68k de 64 KB terminando em $1000000 |
| Documento Sega/`mdcomp` inicial do plano | verificado: `flamewing/mdcomp@72c6df40` é de **códecs** (área do agente B), não de mapa de memória | ASM 0BSD / restante LGPLv3 | Não usado neste perfil; registrado para evitar re-confusão |

A tabela de regiões não-ROM ($A0/$A1/$C0/$FF…) é a documentação canônica do
mapa do Mega Drive reproduzida em ambas as fontes acima; os fatos listados são
verificáveis na GPGX citada e no cabeçalho SGDK.

## Especificação

### Entrada de estado

- `romSizeBytes`: tamanho da ROM **normalizada** (sem header de 512 bytes dos
  dumps legacy, sem padding). Deve ser potência de dois e estar em
  [0x8000 (32 KiB), 0x400000 (4 MiB)]. Fora disso → erro estruturado
  `UNSUPPORTED_SIZE` (perfil lineal não adivinha padding).
- Nenhum registrador de mapper existe neste perfil; qualquer estado extra
  desconhecido → erro estruturado, nunca ignorado silenciosamente.

### Janelas e regiões (espaço de CPU 24 bits do 68000)

| Faixa CPU | Região | Conteúdo | ROM offset |
| --- | --- | --- | --- |
| $000000–$3FFFFF | `rom` | janela do cartucho, 4 MiB | `(addr) & (romSizeBytes-1)` — espelho de módulo potência de dois |
| $400000–$7FFFFF | `non-rom` `reserved-cart` | expansão do cartucho; no mapeio padrão GPGX é barramento não conectado (bus error). Variantes com ROM espelhada aqui existem e ficam **excluídas** deste perfil | — |
| $800000–$9FFFFF | `non-rom` `sram` | RAM de backup do cartucho (quando presente) | — |
| $A00000–$A0FFFF | `non-rom` `cart-ram` | RAM/expansão do cartucho (ex.: SVP) | — |
| $A10000–$A1FFFF | `non-rom` `io` | registradores de I/O (VDP, TMSS, Joy ports; $A130F1–$A130FF = região usada por mappers em outros perfis) | — |
| $A20000–$BFFFFF | `non-rom` `reserved` | reservado (Mega CD) | — |
| $C00000–$C0FFFF | `non-rom` `vram` | acesso 68k à VRAM | — |
| $C10000–$DFFFFF | `non-rom` `reserved` | não-ROM | — |
| $E00000–$FEFFFF | `non-rom` `reserved` | não-ROM | — |
| $FF0000–$FFFFFF | `non-rom` `ram` | RAM 68k de 64 KB | — |

- Fora de $000000–$FFFFFF → erro `RANGE`.
- Endereço que não é palavra alinhada em leitura de 16 bits → erro
  `ADDRESS_ERROR` (semântica 68000).
- Erros nunca retornam offset 0.

### Estado inicial

Sem mapper: o estado é apenas `romSizeBytes`. Não há "primeira leitura"
especial: o espelho vale desde o reset.

### Aliases e inversão

`invert(offset)` retorna **todos** os aliases CPU na janela ROM
($000000–$3FFFFF): `offset + k*romSizeBytes` para todo `k` tal que
`< 0x400000` (ex.: ROM de 512 KiB → 8 aliases por offset). `offset` fora de
[0, romSizeBytes) → erro `OUT_OF_ROM`. Não se devolve um endereço arbitrário.

### Limites e variantes excluídas (documentadas, não suportadas)

- ROMs > 4 MiB exigem mapper (ex.: SSF2, Everdrive extended SSF) → `UNSUPPORTED_SIZE`.
- Dump não-potência-de-dois: GPGX faz padding até 2^k com $FF; este perfil se
  recusa a presumir — `UNSUPPORTED_SIZE` até haver perfil de padding próprio.
- Variante "Quackshot REV A" (512 KB espelhado com fiação irregular VA18/19/21)
  — excluída; cabe em `ambiguous` se encontrada.
- Mega CD, 32X, SVP, Lock-On, Game Genie: fora deste perfil.
- Header "SEGA" no offset $100 **não prova** mapa lineal: cartuchos com header
  `SEGA SSF2`/`SEGA SSF` trocam bancos; header insuficiente → `ambiguous`.

## Contrato da API (implementação de referência)

`scripts/rex_profiles/addressing/md_linear.mjs` — módulo puro, sem E/S:

- `create({ romSizeBytes })` → perfil validado (erros estruturados).
- `translate(addr, {width})` → `{region:'rom', offset, byteOrder:'be'}`
  (width 2; big-endian no 68000), `{region:'rom', offset}` (width 1),
  `{region:<non-rom kind>}` | `{error:<code>}`.
- `readSegments(addr, length)` → segmentos contíguos por região, cruzando
  fronteiras da janela **e também divididos nos pontos de wrap do espelho**
  (onde o offset descontinua), pois um segmento só é consumível se seus
  offsets forem lineares. O último segmento pode sair da ROM.
- `invert(offset)` → lista completa de aliases ordenada.
- Nada alocado proporcional a endereço não validado (operadores O(1)).
