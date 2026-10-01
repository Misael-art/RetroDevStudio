# MISSAO D — Perfil de sprites Sonic 1 (US/EU): proveniencia e prova

Status: **Experimental** (superficie de engenharia reversa da rodada corpus-D).
Ferramenta: `scripts/rex_corpus_d/` (CLI: `node scripts/rex_corpus_d/cli.mjs`).
Saidas reconstruidas (PNG/HTML/manifest) ficam FORA do Git em `~/.cache/rex-corpus-d/out/`.

## 1. Identidade da ROM (obrigatoria antes de qualquer offset)

| campo | valor |
| --- | --- |
| arquivo | `Sonic the Hedgehog (USA, Europe).bin` |
| SHA-256 | `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` |
| tamanho | 531577 bytes |
| fonte | BYOR local somente-leitura (`/home/misael/emulation/roms/genesis`) |
| referencia cruzada | s1disasm fixado em `064e3c68eb19cc85b8801b087f9d95f9b3e82cea` |

Todo endereco abaixo foi confirmado contra ESTA ROM (scanners de byte-pattern 68k +
comparacao com o disassembly fixado). Offsets de outra revisao nao sao prova.

## 2. Estruturas localizadas

| recurso | endereco | verificacao |
| --- | --- | --- |
| `Map_Sonic` (tabela) | `0x211E2`, 88 palavras = offset RELATIVO | entrada 0 → `0x21292` (MS_Null), entrada 1 → `0x21293` (MS_Stand); bytes literais conferidos contra `spritePiece` v1 |
| payload MS_Stand | `0x21293 + 21` | hash `18749e9ba7ab2eae27ebafd451a6f8a05e42b426b841d03d6ef28b08ed0abae1` (igual ao piloto) |
| `SonicDynPLC` (tabela) | `0x217FE`, 88 palavras relativas | payload stand `04 2000 7003 200B 200E` → 17 slots (arte 0..16) |
| `Art_Sonic` | `0x21AFE + 0xA120` | hash `934e48178cfddd8af1627493114a25d09671bbb4a5626f4d95a93001c8b78589`; maior indice de arte referenciado (1289) fecha exatamente no fim da regiao |
| `Pal_Sonic` | `0x2388 + 0x20` (1 linha, 16 cores) | hash `8391d8af82c19043c89e32abf87bdd057dbe2a845c58a3a58761edceaeeb9f8a`; entrada na tabela de indices de paleta em `0x2180` |
| `Ani_Sonic` (tabela) | `0x13B48`, 31 palavras relativas | scripts comecam logo apos a tabela (`0x13B86`) |

Formatos: `SonicMappingsVer=1` (cabecalho = n pecas; peca 5 bytes
`y, size, flagsHi, tileLo, x`; `tile = ((flagsHi&7)<<8)|tileLo`; flips/pal/pri em
`flagsHi`), `SonicDplcVer=1` (word = `((tiles-1)<<12)|artIndex`). Arte MD 4bpp chunky,
nibble alto primeiro (golden `12 34 56 78 → 1..8` testado).

**Papel do DPLC registrado antes de interpretar indices:** `tile_slot` da peca indexa a
ORDEM DE CARGA do buffer DPLC daquele frame, nao um indice de arte. A arte real e
`slots[tile_slot]`. Frames distintos podem carregar banks diferentes no mesmo slot
(provado abaixo no ciclo de corrida).

## 3. Consumidores estaticos vs observacao de runtime (separados)

Evidencia ESTATICA (padroes de bytes 68k na ROM, enderecos absolutos):

| uso | endereco | padrao |
| --- | --- | --- |
| `Sonic_Animate` carrega `#Ani_Sonic` e le `obAnim/obPrevAni` | `0x139C4` | `43F9 00013B48 7000 1028 001C B028 001D` |
| `Sonic_LoadGfx` faz `lea SonicDynPLC,a2` | `0x13C4E` | `45F9 000217FE` |
| `Sonic_LoadGfx` faz `lea Art_Sonic,a1` | `0x13C7A` | `43F9 00021AFE` |
| handler walk/run referencia `SonAni_Run`/`SonAni_Walk` | `0x13A9C` / `0x13AA8` | `lea` absoluto |
| `move.l #Map_Sonic, obMap(a0)` (6 sitios) | `0x4F8A, 0x4FFE, 0x12C0E, 0x1B9BA, 0x1D0FA, 0x1D132` | `217C …000211E2…0004` / `21FC…D004` |

OBSERVACAO DE RUNTIME (DMA real, conteudo de VRAM/SAT por frame): **NAO executada nesta
rodada** — emulacao longa so na janela do integrador. Plausibilidade visual nao e prova de
que o jogo usa a estrutura; a prova acima e de consumidor estatico. Pendencia registrada
no manifest (`proof_class`).

## 4. Prova de remontagem (mesmo personagem)

Frames compostos (mapeamento → DPLC → arte → paleta → RGBA 32-bit):
`stand (0x01)`, `look_up (0x05)`, `walk13 (0x08)`, `run11 (0x1E)` + flipX de cada um +
sequencia de animacao completa.

- Sequencia: `SonAni_Walk` (anim 0, script especial, intervalo bruto `$FF`, 6 frames
  `0x08,0x09,0x0A,0x0B,0x06,0x07`, terminador loop) expandida por tick em
  `animate-walk.html` e `contact-sheet-walk.png` — poses de caminhada classicas,
  reconheciveis, sem pintura ou substituicao geometrica.
- Descoberta funcional do ciclo de corrida: `run11..run14 (0x1E..0x21)` tem mapping
  IDENTICO (byte a byte) e DPLC alternando dois banks de arte de pernas
  (`426..443` / `84..101`) — e o DPLC, nao o mapping, que anima as pernas.
- Comparacao independente #1: oracle derivado direto do disassembly fixado (reimplementacao
  separada do macro `spritePiece`) → hash RGBA identico ao compositor.
- Comparacao independente #2: oraculo do piloto (rodada anterior,
  `scripts/e2e-tauri-build-run.mjs`, `ce95ea66f2cfcec40a0fb12cb35fe5e88530de036de9f897333ce762f06b40d4`)
  → byte-identicos ao `composeFrame` do frame stand (convencao adotada: canal 3-bit `*36`,
  indice 0 mantem RGB da cor 0 sob alpha 0).
- Comparacao visual: captura de jogo `data/canonical-local-2026-09-21/validation/inspection-2026-09-21T17-51-11-371Z-sonic-game-base.png`
  — pose em pe corresponde ao frame `stand` com flip global X (no jogo Sonic aparece
  voltado a direita; o mapping padrao esta voltado a esquerda; flip = variante
  `BuildSpr_FlipX`, preservada como `globalFlip` na CLI).

## 5. Negativos exigidos (todos no suite `corpus.test.mjs`)

peca deslocada (x += 16 muda pixels e ancora) · tile errado (bit do tileLo) · flip
invertido (bit xflip) · paleta errada (ordem de cores) · sequencia truncada (afEnd
apagado l6 frames demais) · identidade de ROM diferente (1 byte → gate SHA-256 reprova;
CLI aborta antes de compor).

## 6. Validacao em amostra reservada

Regras congeladas no commit `3ae412a`. Amostra reservada escolhida apos congelamento:
`fr_Stop1 = 0x37` (nao usada em nenhum desenvolvimento). Resultado: 2 pecas
`(-16,-19,3x2,t0) (-16,-3,4x3,t6)` identicas ao `MS_Stop1` do disassembly, canvas 32x40,
ancora (16,19), 0 lacunas, pose de derrapagem reconhecivel
(`reserved-stop1.png`). **Nenhuma mudanca de implementacao foi necessaria** — amostra
mantida. Hash RGBA da amostra: `fb492caf18922266c982d61bfa4bb4d77996869a8c86cfc56624ba0173856085`.

## 7. Contrato de integracao com o catalogo grafico

- Cada frame extraido e um registro JSON conforme
  `data/rex_corpus_d/frame-record.schema.json` (ROM → tabela → entrada → pecas →
  slots → arte → paleta → composicao, com endereco absoluto por campo).
- Chave de catalogo proposta: `sonic1-us-eu/<personagem=sonic>/frame/<id-hex>`; o registro
  carrega `rom_used.sha256`, entao uma mudanca de revisao invalida a entrada de forma
  detectavel (mesma politica de origem imutavel + SHA-256 do protocolo do host).
- A superifice do piloto (`sprite_composition.rs` + E2E) le os MESMOS enderecos; este
  perfil e a versao multi-frame/animacao fora do produto. Nenhum codigo de produto,
  crate ou manifesto central foi tocado; nenhuma dependencia nova foi adicionada.

## 8. Limites honestos

- Um personagem (Sonic) e um perfil de ROM (US/EU). Recovery do engine inteiro NAO e
  reivindicado; `Map_Sonic` tem 88 frames, esta prova cobre 4 + sequencia + amostra.
- Linha de paleta 0 apenas; `pri` e lido mas nao modela o render BG/sombra.
- Sem observacao de runtime (VRAM/SAT por frame) nesta rodada — ver secao 3.
- DPLC incremental (buffer persistente entre frames, `f_sonframechg`) e modelado como
  carga por frame; a partilha de payload `frame 60 == frame 83` esta provada, o resto do
  mecanismo de update incremental nao foi re-derivado aqui.
