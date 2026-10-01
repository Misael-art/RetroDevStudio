# FASE 6 — Corrección do vocabulario de evidencia e cadeia completa (Misión A)

**Estado: Experimental.** Esta fase non promove maturidade: corrige a forza
das afirmacións herdadas, pecha a cadea de evidencia ao máximo alcanzable
sen executar bytes, e declara a lacuna exacta que queda.

| | |
|---|---|
| Branch | `codex/rex-corpus-a` (worktree exclusiva `~/RDS-REX-CORPUS-A`) |
| Base desta fase | `52f9abe` (relatorio de integracion) |
| Territorio | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| Amostras | 4 de desenvolvemento + 1 reservada, sen tocar o corpus (`stage.sh` só le) |

## 1. Por que se corrige o vocabulario

A Fase 5 gravaba `confianza=confirmado-estaticamente` en oito rexistros. O
rótulo cubría **dous niveis de proba distintos** e unha inferencia que non
se fixo:

- en Sonic 1, a única evidencia era unha `lea` solitaria — unha **referencia
  estática** a un enderezo, sen chamada conectada;
- na reservada, a evidencia era `lea` seguida de chamada a unha rutina común
  — un **vínculo estrutural**, pero **non** a identificación da rutina como
  decoder nin o consumo en runtime.

`confirmado-estaticamente` retirase. O vocabulario `rex-corpus-resource/v2`
nomea a medida, separando o que o encargo pide separar:

| Nivel | Que se mediu | Rexistros |
|---|---|---|
| `candidato` | decodifica limpo, sen evidencia de consumidor | 0 versionados |
| `referencia-estatica` | o enderezo é operando dunha instrución medida; sen chamada conectada | 3 (Sonic 1) |
| `vinculo-estrutural` | `lea fluxo,An` seguida, na ventá, de chamada a unha rutina | 5 (reservada) |
| `observado-en-runtime` | require executar a ROM — **esta misión non o alega** | rexeitado en `validar()` |

Regras novas do gardafío (`ResourceRecord::validar`):

- `vinculo-estrutural` **esixe** unha carga con chamada; unha `lea` solitaria
  non o sustenta;
- `referencia-estatica` esixe unha forma de instrución e **prohíbe** que haxa
  carga con chamada medida — se a hai, o rexistro mentiría por defecto;
- **a táboa de punteiros deixa de vincular**: a Fase 4 xa refutara R1 (as
  táboas da reservada desaparecen entre `min=3` e `min=4`; Altered Beast
  produce táboas que comezan en `0x12`), pero a gramática aínda a contaba
  como vínculo — mesmo erro que a Fase 2 retractou en `0x745DC`. O CLI
  `consumidor` (schema **`rex-corpus-consumer/v3`**) deixa de poñer
  `vinculo=si` por táboa.

## 2. A busca de opcodes non é análise de alcanzabilidade

`cargas_abs_l`, `call_sites`, `references_to` e `tables_for` fan **varredura
lineal aliñada a palabra** sobre toda a imaxe: un `41 F9 …` pode casar en
bytes de datos. Isto era sabido (o control de non-vacuidade da Fase 4 §6
medio 9 formas `lea A0+chamada` das cales só 6 apuntan a fluxos que
decodifican), pero non estaba declarado nos rexistros. Agora cada rexistro
con evidencia de instrución leva a limitación:

```text
evidencia por varredura lineal aliñada a palabra: un opcode pode casar en
bytes de datos; sen análise de alcanzabilidade
```

Unha análise de alcanzabilidade desde o punto de entrada é proposta para o
integrador (ver §10).

## 3. Rexistros rexenerados — as medidas non cambiaron

Os oito rexistros rexeneráronse **coa ferramenta** (receita da Fase 5 §5.2,
imaxes BYOR locais, mesmos perfís pinados). Diff campo a campo contra as
copias previas:

| Campo | Cambio |
|---|---|
| `schema_version` | `rex-corpus-resource/v1` → `v2` |
| `confianza` | `confirmado-estaticamente` → `referencia-estatica` (Sonic) / `vinculo-estrutural` (reservada) |
| `limitacions` | + a limitación de varredura lineal (§2) |
| `offset`, `tramo_entrada`, `bytes_consumidos`, `saida_bytes`, `saida_sha256`, `evidencia_consumidor`, hashes, mapper | **idénticos byte a byte** |

O histórico v1 queda no git; ningún dato medido se tocou.

## 4. A cadeia, elos por elo

A misión pide demostrar identidade → referencia → consumidor → parámetros →
decode do produto → comparación independente. Isto é o que se ten **medido**
en cada elo, sen executar a ROM:

1. **Identidade**: os perfís pinan o SHA-256 dos bytes (`c7da53a1…` Sonic,
   `304f56ba…` reservada). A diverxencia do checksum declarado do cabezallo
   de Sonic segue rexistrada como diverxencia medida sen explicación (Fase 1).
2. **Referencia**: en ambas imaxes, `lea abs.l` co enderezo do fluxo como
   operando — bytes comprobados na imaxe local (`41 F9 00 03 F0 9A` en
   `0x03082`, etc.).
3. **Consumidor**: na reservada, as 6 cargas van seguidas, na ventá de 16
   bytes, de `jsr $085A2` (6/6, un só destino). En Sonic 1, os 3 sitios levan
   `bsr.w` de 16 bits: `61 00 05 2A` → `$0189C`, `61 00 E8 0C` → `$0189C`,
   `61 00 C6 D4` → `$0189C` — **os tres conflúen no prólogo da mesma rutina**.
4. **Parámetros** (medidos nesta fase, bytes na imaxe):

   | ROM | sitio | fonte (A0) | destino (A1) | chamada |
   |---|---|---|---|---|
   | reservada | `0x016D2` | `$071C6C` | `$FF8000` | `jsr $085A2` |
   | reservada | `0x087FC` | `$0389A0` | `$FF7000` | `jsr $085A2` |
   | reservada | `0x08842` | `$01F596` | `$FF8000` | `jsr $085A2` |
   | reservada | `0x10636` | `$0795A2` | `$FF7000` | `jsr $085A2` |
   | reservada | `0x10852` | `$01CAEC` | `$FF7000` | `jsr $085A2` |
   | reservada | `0x119B4` | `$0389A0` | `$FF7000` | `jsr $085A2` |
   | Sonic 1 | `0x01364` | `$072E7C` | `$A00000` (VRAM) | `bsr.w $0189C` |
   | Sonic 1 | `0x03082` | `$03F09A` | `$FF0000` | `bsr.w $0189C` |
   | Sonic 1 | `0x051BC` | `$06175E` | `lea $9400…` (forma curta) | `bsr.w $0189C` |

   A forma é uniforme: fonte en A0, destino en A1, chamada á rutina — a
   convención dun descompresor con parámetros en rexistros de dirección.
   É forma medida; a semántica de escrita en A1 **non está executada**.5. **Identidade da rutina**: ver §5.
6. **Decode do produto**: os 8 fluxos decodifican con `rex-kosinski`; consumo,
   saída e SHA-256 versionados nos rexistros.
7. **Comparación independente**: ver §6.

## 5. A rutina `$085A2` é un descompresor con convención Kosinski (medida morfolóxica)

Decodificación manual dos bytes da imaxe reservada en `$085A2…$08641` —
**160 bytes, do prólogo ao `rts`** (reprodución: `xxd -s 0x85A2 -l 160`
sobre a imaxe staged; SHA-256 dos 160 bytes:
`e8028514cfa2b24f49cd07ee523af573b7cb404b62cf45ff9484a69090b26f90`):

| Enderezo | Bytes | Instrución | Papel |
|---|---|---|---|
| `085A2` | `55 8F` | `subq.b #2,(A7)` | rebaixe en 2 o byte en `(A7)`: a palabra alta do enderezo de retorno vira **slot do descritor** (non move o SP) |
| `085A4` | `1F 58 00 01` | `move.b (A0)+,$01(A7)` | **refacho do descritor**: 1º byte da stream → byte baixo do word en `(A7)` |
| `085A8` | `1E 98` | `move.b (A0)+,(A7)` | 2º byte → byte alto |
| `085AA` | `3A 17` | `move.w (A7),D5` | descritor en D5 — word big-endian lido da pila ⇒ **1º byte da stream = byte baixo** |
| `085AC` | `78 0F` | `moveq #15,D4` | contador de 16 bits |
| `085AE` | `E2 4D` | `lsr.w #1,D5` | consome bit LSB→MSB |
| `085B0` | `40 C6` | `move.w SR,D6` | captura C |
| `085B2` | `51 CC 00 0C` | `dbf D4,$085C0` | mentres quedan bits, salta o refacho; ao esgotar D4, cae no refacho de `085B6` |
| `085B6` | `1F 58 00 01`, `1E 98`, `3A 17`, `78 0F` | refacho EARLY da palabra seguinte + reinicio do contador | consumido só ao esgotar os 16 bits |
| `085C0` | `44 C6` | `neg.w D6` | bit → máscara 0/`FFFF` |
| `085C2` | `64 04` | `bcc.s $085C8` | **bit 0 → match; bit 1 → literal** |
| `085C4` | `12 D8` | `move.b (A0)+,(A1)+` | **literal: byte da stream → destino** |
| `085C6` | `60 E6` | `bra.s $085AE` | volta a consumir bits |
| `085DE` | `65 2C` | `bcs.s $0860C` | 2º bit=1 → match **separado** (2 bytes: `10 18`, `12 18` a D0/D1) |
| `08612`–`08616` | `14 01`, `EB 4A`, `14 00` | `move.b D1,D2; lsl.w #5,D2; move.b D0,D2` | a distancia constrúese como `(High&0xF8)<<5 \| Low` — a mesma aritmética do perfil |
| `08618` | `02 41 00 07` | `andi.w #7,D1` | `count3 = High&7` |
| `0861C` | `67 10` | `beq.s $0862E` | `count3==0` → caso especial (byte estendido / terminador) |
| `0861E`–`08620` | `16 01`, `52 43` | `move.b D1,D3; addq.w #1,D3` | contador de copia `count3+1` (un `dbf` con el copia `count3+2`) |
| `0862E`–`08641` | `12 18 67 0C`, bucles de copia, `54 8F`, `4E 75` | coda: byte estendido (`0` = terminador → `addq.b #2,(A7)`; `rts`) | **epilogo medido**: o `addq` desfai o `subq` de entrada |

> **Corrección aritmética desta fase:** unha versión anterior da táboa
> situaba o `neg.w` en `$085DC`, o `bcc` en `$085C0` e os alvos de `dbf`
> e `bra` con base errónea. O desprazamento de `Bcc`/`BSR`/`DBcc` do 68000
> é relativo á **palavra de extensión** (`instrución+2`), non ao fin da
> instrución — os enderezos de arriba están recomputados con esa semántica
> e verificados byte a byte contra a imaxe.

Convencións comprobadas contra o perfil fixado (`data/rex_profiles/codec/kosinski`,
`ea866df7…`): descritor little-endian co 1º byte da stream como byte **baixo**
(o `MOVE.W` do 68000 lê big-endian: `mem[A7]` é o byte alto ⇒ o 2º byte vai
ao alto), bits LSB→MSB, **1=literal**, 2º bit 1=separado/0=inline, e a
aritmética de distancia do match separado idéntica.

**Identidade entre xogos**: a rutina de Sonic 1 é **idéntica byte a byte nos
160 bytes, do prólogo á coda** (`$0189C…$0193B` vs `$085A2…$08641`, mesmo
SHA-256 `e8028514…`); diverxe só despois do `rts`, nos bytes da función
seguinte de cada xogo. Os tres `bsr.w` de Sonic apuntan a `$0189C` —
**o prólogo** —, a mesma convención de entrada da reservada (unha versión
anterior dicía `$0189E`: o mesmo erro aritmético da nota, xa corrixido).

**O que isto proba**: a rutina chamada polos 6 sitios (e polos 3 de Sonic)
ten a forma completa dun descompresor de bit-streams cos parámetros
(A0=fonte, A1=destino) e as convencións de bits de Kosinski base, medida
fim a fim.

**O que NON proba**: sen executar unha instrución. Fóra do alcance da
decodificación manual quedan o mecanismo de desprazamento variable do laço
de copia e a reconstrución do enderezo de retorno (a palabra alta en `(A7)`
é sobrescrita polo descritor e só o byte 0 se restaura co `addq` medido) —
como o retorno funciona queda **aberto e declarado**. Non se demostrou que
eses fluxos se carguen nunca en pantalla. Por iso os rexistros quedan en
`vinculo-estrutural`, non nun rótulo de "recurso consumido".

## 6. Comparación independente do produto decodificado

Segunda implementación do codec, escrita de cero en Python
(`~/.retrodev/rex_corpus_a_work/tools/kosinski_ref.py`, SHA-256
`ee9bbde9782727bd9d88b9652a98e0d159fa7cc80b75777df0aa9316384881ab`;
non se versiona na árbore para non engadir unha dependencia — o listado
completo está no §6.1):

- **Validación**: 27 vectores do perfil fixado — **21 aceptas** byte-exactos
  (9 golden + 12 plain), **5 negativos rexeitados pola razón declarada**,
  `m02` rexeitado como `fluxo-truncado` (a excepción contratual coñecida da
  Fase 3 §6). Log: `~/.retrodev/rex_corpus_a_work/logs/verificacao-cruzada-python.log`
  (SHA-256 `0ae43988be84c5a7bb7dbeb4e417b11ca18ec16b8f42dde15040bcd7fd2d1466`).
- **Aplicación aos 8 fluxos reais** (offs dos rexistros versionados, imaxes
  BYOR locais): **8/8** reproducen consumo, tamaño e SHA-256 byte a byte.

| offset | consumo | saída | SHA-256 |
|---|---|---|---|
| `0x3F09A` | 8453 | 41984 | igual ó versionado |
| `0x6175E` | 1419 | 4096 | igual |
| `0x72E7C` | 5974 | 7110 | igual |
| `0x1CAEC` | 611 | 8192 | igual |
| `0x1F596` | 374 | 2248 | igual |
| `0x389A0` | 514 | 1568 | igual |
| `0x71C6C` | 656 | 2248 | igual |
| `0x795A2` | 7581 | 7936 | igual |

**Qué proba e qué non**: proba que os SHA-256 versionados son unha propiedade
do **formato** (dúas implementacións, linguas distintas, camiños de código
distintos, 27 vectores de acordo), non dunha implementación. **Non é un
segundo oráculo**: o mesmo operador escribiu ambas; a paridade con oráculo
independente segue `blocked` como declara o perfil (Fase 3 §8).

### 6.1 Listado de `kosinski_ref.py` (reproducible sen dependencias)

A copia de traballo está fóra da árbore
(`~/.retrodev/rex_corpus_a_work/tools/kosinski_ref.py`, SHA-256
`ee9bbde9782727bd9d88b9652a98e0d159fa7cc80b75777df0aa9316384881ab`). O
listado completo é o seguinte; para reproducir a comparación:

```bash
python3 - <<'PY'
import sys, json, hashlib
sys.path.insert(0, '/home/misael/.retrodev/rex_corpus_a_work/tools')
import kosinski_ref as kr
sonic = open('…/staged/Sonic the Hedgehog (USA, Europe).bin','rb').read()
hold  = open('…/holdout/staged/Streets of Rage (World).gen','rb').read()
for f, img in (('data/rex_corpus_a/evidencia/sonic-1-usa-europe.rexistros.jsonl', sonic),
               ('data/rex_corpus_a/evidencia/streets-of-rage-world-ptbr-reservada.rexistros.jsonl', hold)):
    for l in open(f):
        r = json.loads(l)
        out, c = kr.decode(img[r['offset']:], max_output=r['saida_bytes']+1)
        assert hashlib.sha256(out).hexdigest() == r['saida_sha256']
        assert c == r['bytes_consumidos'] and len(out) == r['saida_bytes']
print("8/8 fluxos reproducidos")
PY
```

```python
class Truncated(Exception): pass
class InvalidReference(Exception): pass
class ExcessiveOutput(Exception): pass
class WorkLimit(Exception): pass
class EmptyInput(Exception): pass

class Decoder:
    def __init__(self, st, max_output=2_097_152, work_limit=4_000_000):
        self.st = st
        self.max_output = max_output
        self.work_limit = work_limit
        self.pos = 0
        self.out = bytearray()
        self.work = 0
        self.desc = 0
        self.bits = 0
        self.desc_eof = False

    def spend(self, n):
        self.work += n
        if self.work > self.work_limit:
            raise WorkLimit

    def fetch_desc(self):
        if self.pos + 2 > len(self.st):
            self.desc_eof = True
            raise Truncated
        self.desc = self.st[self.pos] | (self.st[self.pos + 1] << 8)
        self.pos += 2
        self.bits = 16
        self.spend(2)

    def next_bit(self):
        if self.bits == 0:
            if self.desc_eof:
                raise Truncated
            self.fetch_desc()
        self.bits -= 1
        bit = self.desc & 1
        self.desc >>= 1
        self.spend(1)
        if self.bits == 0 and not self.desc_eof:
            if self.pos + 2 > len(self.st):
                self.desc_eof = True
            else:
                self.fetch_desc()
        return bit

    def getbyte(self):
        if self.pos >= len(self.st):
            raise Truncated
        b = self.st[self.pos]
        self.pos += 1
        return b

    def push(self, b):
        if len(self.out) >= self.max_output:
            raise ExcessiveOutput
        self.out.append(b)
        self.spend(1)

    def run(self):
        if not self.st:
            raise EmptyInput
        while True:
            if self.next_bit() == 1:
                self.push(self.getbyte())
                continue
            if self.next_bit() == 1:
                low = self.getbyte()
                high = self.getbyte()
                count3 = high & 7
                if count3 != 0:
                    ln = count3 + 2
                else:
                    c = self.getbyte()
                    if c == 0:
                        return bytes(self.out), self.pos
                    if c == 1:
                        continue
                    ln = c + 1
                dist = 0x2000 - (((high & 0xF8) << 5) | low)
            else:
                h = self.next_bit()
                l = self.next_bit()
                ln = ((h << 1) | l) + 2
                d = self.getbyte()
                dist = 0x100 - d
            if dist == 0 or dist > len(self.out):
                raise InvalidReference
            start = len(self.out) - dist
            for i in range(ln):
                self.push(self.out[start + i])

def decode(st, max_output=2_097_152, work_limit=4_000_000):
    return Decoder(st, max_output, work_limit).run()

MOTIVO = {Truncated: "fluxo-truncado", InvalidReference: "referencia-invalida",
          ExcessiveOutput: "saida-excesiva", WorkLimit: "orzamento",
          EmptyInput: "entrada-baleira"}
```

## 7. Auditoría da mostra reservada nas regras

A misión pediu comprobalo: **a reservada si influenciou regras**, e as
afirmacións en contrario da Fase 5 corríxense:

- **R6 (carga `lea abs.l`)** naceu da medida na reservada (Fase 4 §6: 383
  cargas, 6 con candidato como operando, todas en A0). A codificación foi
  derivada de `4E B9` e testada con TDD sobre fixtures autorais, pero a
  **existencia da regra e a ventá de 16 bytes** veñen desa medida.
- **R7** medíuse primeiro na reservada (6/6 → `$085A2`) e refutouse como
  requisito ao aplicala a Sonic.
- polo tanto, `FASE5-PERFIS.md` §5.1 ("non se empregou para axustar ningunha
  regra") e `RELATORIO-INTEGRACION.md` §4 estaban **incorrectos** — e a
  validación "non vista" das regras R6/R7 acabou sendo **Sonic 1** (aplicáronse
  despois), non a reservada.
- os 5 rexistros da reservada son **in-sample** para a regra que os detectou.
  As medidas seguen sendo medidas verdadeiras (bytes, consumo, saída, SHA);
  o rótulo epistémico da validación é o que cambia, non o dato.

## 8. Controis discriminativos desta fase

Mutación aplicada: `Evidencia::e_carga_con_chamada()` → sempre `false`
(o vínculo estrutural non vería a chamada).

```text
cargo test --offline --no-fail-fast → 7 FAILED en 4 binarios:
  evidence.rs   rexistro_estrutural_cunha_carga_con_chamada_valida
                rexistro_referencia_estatica_rexeitase_se_a_medida_e_mais_forte_ou_mais_feble
  cli.rs        rexistro_seralliza_un_recurso_confirmado_pola_carga_medida
                perfil_escrito_polo_cli_reler_se_e_aplica_a_a_imaxe_que_pinna
                rexistro_aceita_o_enderezo_en_hexadecimal_sem_gardarse_un_token_malo
  consumer.rs   rexistro_versiona_o_esquema_a_confianza_e_o_offset_medido
  artefactos.rs rexistros_versionados_len_a_gramatica_de_evidencia_e_non_inventan_confianza
restauración byte a byte → 161 passed · 0 failed
```

## 9. Gates

Executados en `~/RDS-REX-CORPUS-A/scripts/rex_corpus_a`:

| Gate | Resultado |
|---|---|
| `cargo test --offline` | **161 passed · 0 failed** (antes desta fase: 157) |
| `cargo clippy --offline --all-targets -- -D warnings` | sen avisos |
| `cargo fmt -- --check` | exit 0 |
| `npm run check:tree` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| Bytes comerciais no índice | ningún |

## 10. Lacuna exacta que queda (para o integrador)

1. **Execución**: nada aquí executa a ROM. A demostración de que os fluxos se
   consumen en pantalla (ou de que A1 recibe esas escritas) require unha
   xanela de emulación coordinada.
2. **Mecánica interna restante**: a rutina está medida fim a fim (160 bytes
   idénticos nos dous xogos, do `subq` ao `rts`); quedan por decodificar o
   mecanismo de desprazamento variable do laço de copia e a reconstrución do
   enderezo de retorno (a palabra alta en `(A7)` é sobrescrita polo
   descritor e só o byte 0 se restaura co `addq` da coda).
3. **Convención de entrada de Sonic — RESOLTA nesta rodada**: os tres
   `bsr.w` apuntan a `$0189C`, **o prólogo** — a mesma convención da
   reservada. A versão anterior desta fase dicía `$0189E` por un erro
   aritmético na base do desprazamento (§5, nota de correção).
4. **Alcanzabilidade**: a varredura de opcodes non parte de código
   alcanzable (§2). Proposta: semente de alcanzabilidade desde o vector de
   entrada (`$000004`) seguindo `jmp/jsr/bsr/bra` — sen desassemblador
   completo.
5. **Propostas a territorio compartido** (sen tocar aquí): as da Fase 4 §12
   e Fase 5 §9 mantéñense; engádese a de `bsr`/`lea (d16,PC),An` como
   evidencia de primeira clase (daría a Sonic o mesmo nivel estrutural da
   reservada, se a convención de entrada se reconcilia).

## 11. Que NON proba esta fase

- Non se executou unha ROM nin unha liña de xogo modificado; non hai
  reinserción; non se escribiu ROM modificada.
- `vinculo-estrutural` non significa "recurso consumido": significa carga
  medida + chamada medida á rutina.
- A identidade morfolóxica de `$085A2` é análise estática de bytes, non
  execución. A rutina está medida fim a fim (160 bytes idénticos nos dous
  xogos); o mecanismo de desprazamento variable do laço de copia e a
  reconstrución do enderezo de retorno quedan por decodificar (§10.2).
- A comparación independente (§6) é entre dúas implementacións do mesmo
  operador; non é paridade de oráculo.
