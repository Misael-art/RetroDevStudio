# Perfil de endereçamento SNES: LoROM (`snes-lorom` v1)

**Estado:** Experimental — referência sintética/fixture-only para tradução de
endereços. Não declara suporte a jogo nenhum; não recupera lógica comercial;
não implica codecs SNES (contrato v1 seção 3).
**Escopo:** converter CPU address 24 bits do 65C816 (brr:bbbbbb:aaaa aaaa aaaa aaaa)
em região + offset dentro da ROM normalizada, e a inversão (offset → aliases).

## Fontes primárias fixadas (consultadas como especificação; nenhum código transplantado)

| Fonte | Commit pinado | Licença | Uso aqui |
| --- | --- | --- | --- |
| bsnes `bsnes/target-bsnes/resource/system/boards.bml` (board LOROM/LOROM-RAM) | `7d5aa1e656b9171524d01b1b22917197d8121cb4` | GPL-3.0 (arquivo de dados BML; consulta) | Janelas normativas: ROM `00-7d,80-ff:8000-ffff mask=0x8000` (boards.bml:818-820); SRAM `70-7d,f0-ff:0000-7fff mask=0x8000` (boards.bml:824-827) |
| snes9x `memmap.cpp` `map_lorom`/`Map_LoROMMap`/`map_System` | `1bcc369e89f08243e0a462882fb1f3e42e51de3a` | Snes9x License — **não comercial** (não OSI); apenas consulta, sem cópia | Fórmula `addr = (bank & 0x7F) * 0x8000` + offset intra-janela com `-(i & 0x8000)` (memmap.cpp:2504-2517); espelho por tamanho `map_mirror`; WRAM `0000-1FFF` espelhada nos bancos `00-3D/80-BD` (map_System) |
| SNESdev wiki "Memory map" | acessado 2026-09-25 (https://snes.nesdev.org/wiki/Memory_map) | CC BY-SA | Corrobora A15 desconectado: metades baixas alias de páginas vizinhas (fonte do caso `ambiguous` abaixo) |

## Modelo de estado

```json
{ "rom_size": 1048576 }
```

- `rom_size`: obrigatório, potência de 2 em [0x8000 (32KB), 0x400000 (4MB)].
  A janela LoROM alcança no máximo 128 páginas de 32KB = 4MB; dump maior
  (ExLoROM/SDD-1) → `unsupported` (perfil separado ou bloqueado).
- LoROM não tem registradores de mapper neste perfil: sem estado de bancos.
  Não há mapper a escrever; qualquer estado extra desconhecido → erro.

## Regiões (espaço 24 bits; b = banco, a = addr16)

| Faixa CPU | Região | Offset |
| --- | --- | --- |
| b ∈ $00-$7D ou $80-$FF (exceto $7E/$7F), a ≥ $8000 | `rom` | `((b & 0x7F) * 0x8000 + (a & 0x7FFF)) & (rom_size - 1)` |
| b ∈ $7E, $7F | `wram` | `(b & 1) * 0x10000 + a` & 0xFFFF (WRAM 64KB) |
| b ∈ $00-$3D ou $80-$BD, a < $2000 | `wram-mirror` | `a & 0x1FFF` (espelho do início da WRAM; s9x map_System) |
| b ∈ $70-$7D ou $F0-$FF, a < $8000 | `sram` | `a & 0x7FFF` (janela declarada; tamanho real é propriedade do save, não deste perfil) |
| b ∈ $00-$3D ou $80-$BD, $2000 ≤ a < $8000, fora do espelho WRAM | `io` | `a` (janelas PPU/APU $21xx, joypad $40xx, CPU/DMA $42xx-$43xx, timer $45xx, SMP $5xxx, DSP $6xxx: classificadas, nao decodificadas) |
| demais faixas com a < $8000 | `unsupported` | open bus / reservado conforme janela |

- Precedência na ordem da tabela (espelho WRAM vence `io`); janela ROM nunca
  cobre a < $8000 (ver ambiguidade abaixo).
- Fora de 24 bits → `out-of-range`. Erros nunca viram offset 0.

## Casos ambíguos documentados (não adivinhados)

- **A15 desconectado**: b ∈ $40-$7D e b ∈ $C0-$FF com a < $8000. bsnes não
  mapeia (open bus); snes9x `Map_LoROMMap` (memmap.cpp:2741-2744) mapeia
  ROM aliás `(b & 0x7F) * 0x8000 + a`. Divergência entre referências fixadas
  ⇒ `translate` retorna `{ error: { code: "ambiguous" } }` (exceto onde a
  tabela acima já classificou sram/wram-mirror/io).
- Variantes com offset de dados (`map_lorom_offset` SDD-1/FPA 6MB, multitap):
  excluídas do perfil; ficariam em outro id de perfil se comprovadas.

## Aliases e inversão

`invert(rom_offset, state)` retorna todos os CPU addresses da janela ROM cujo
offset mascarado coincide: para toda página p = `rom_offset >> 15` com
`p < 128` e para todo banco b ∈ {p, p|0x80} ∩ $00-$7D,$80-$FF (exceto
$7E/$7F e exceto sobreposição sram/io), alias = `b*0x10000 + 0x8000 +
(rom_offset & 0x7FFF)`; o espelhamento por `rom_size` reintroduz páginas
equiválentes (offset e offset ± 4MB quando dentro da ROM). Lista vazia é
resposta válida; offset ≥ rom_size → lista vazia; não-inteiro → `out-of-range`.

## `read(cpu_address, length, state, rom)`

Segmentos por janela de 32KB (a < $8000 nunca é ROM; a ≥ $8000 pertence à
página `(b&0x7F)`): cruzamento $8000/$FFFF entre bancos com páginas
diferentes produz segmentos não contíguos; ROM menor que `rom_size` →
`out-of-range` no trecho faltante (sem clamp); região sem backing ROM →
segmento classificatório com `error: unsupported`.

## Limites explícitos (v1)

- Não decodifica registradores PPU/APU/CPU individualmente; só classifica a
  janela `io`. Não modela SRAM real (tamanho/bateria), vetores de reset,
  ExHiROM/HiROM/ExLoROM nem chips MSP1/DSP/SFX/BB (perfis próprios).
- Header `SEGA`/`Nintendo` e bytes de mapa do cabeçalho **não provam** o
  mapa: detecção real é hipótese registrada no inventário do corpus.
- Prova é fixture autoral; nada aqui é evidência de jogo real.
