# FASE 4 — xeneralizar as regras e intentar refutalas

**Estado: Experimental.** Nada desta fase promove maturidade: as regras miden
cinco imaxes locais, non un corpus universal, e dúas das tres regras que
aguantaban na Fase 2 **caen** ao xeneralizalas.

| | |
|---|---|
| Base | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Branch | `codex/rex-corpus-a` (worktree exclusiva `~/RDS-REX-CORPUS-A`) |
| Territorio | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| Binario medidor | `target/debug/rex-corpus` SHA-256 `2feb89b085b12f12d11735929e4674965ab5ab700b9417369c839bc5e325ac01` |
| ROMs | 4 de desenvolvemento + 1 reservada, segundo `data/rex_corpus_a/inventario.json` |

## 1. Método

A Fase 2 deixou tres regras de vínculo (`chamada`, `referencia crúa`, `táboa de
punteiros`) validadas en Sonic 1. Xeneralizar significa aplicalas **sen
axustalas** ás outras catro imaxes, incluída a reservada. Refutar significa
buscar o cambio de parámetro ou a imaxe onde a regra deixa de dicir o que
dicía. Case todos os números desta sección saen do CLI (`consumidor`, `magia`,
`scan`, `roundtrip`); indícase expresamente os dous agregados (§6, distribución
de cargas por rexistro e taxa base) que veñen dunha lectura directa dos bytes,
coa receita para reproducilos. O código que non é ferramenta utilizouse para
explorar, desbotouse, e a regra resultante volveu escribirse con TDD sobre
fixtures autorais (§6).

## 2. Medidas de base (`scan`, `magia`)

| Imaxe | bytes | intentos | candidatos | densidade | maxias |
|---|---|---|---|---|---|
| Sonic the Hedgehog (USA, Europe) | 531 577 | 265 788 | 254 | 0,096 % | 0 |
| Altered Beast (USA, Europe) | 524 288 | 262 144 | 3 103 | **1,184 %** | 0 |
| Golden Axe (World) | 524 288 | 262 144 | 93 | 0,035 % | 0 |
| Rocket Knight Adventures (USA) | 1 048 576 | 524 288 | 1 178 | 0,225 % | 0 |
| Streets of Rage (World) — reservada | 524 288 | 262 144 | 92 | 0,035 % | 0 |

- **A maxia aguantou**: cinco secuencias (`KosM`, `KosP`, `EniM`, `GSS `,
  `Unic`) en 0 ocurrencias nas cinco imaxes. Segue sendo *unha medida*, non un
  diagnóstico: non permite nin afirmar nin negar o subformato.
- **A densidade de candidatos non é unha constante do formato**: 34× de
  separación entre Golden Axe (0,035 %) e Altered Beast (1,184 %). Calquera
  "taxa típica de falsos positivos Kosinski" está refutada; a densidade é
  propiedade da ROM, non do codec.
- Na imaxe reservada, 38 dos 92 candidatos decodifican en menos de 64 bytes de
  saída (ratio saída/consumo 0,7–0,85): son *decodificacións que poden existir
  por construción* do formato, non recursos. Iso é exactamente o que a misión
  prohíbe tratar como negativo absoluto.

## 3. Táboa de regras

| Regra | Predición | Medida | Veredito |
|---|---|---|---|
| R1 `tables_for(min=3)` | as táboas que conteñen un candidato ligano como recurso | AB 3→1→0 ao subir o umbral; reservada 8→0; `primeiro=0x12` en AB | **refutada** (§4) |
| R2 maxias de contedor | se hai contedores, aparécen | 0 en 5/5 | aguantou, **non diagnóstica** |
| R3 ciclo decode→encode→decode | fechar o ciclo apoia a natureza Kosinski | 4 720/4 720 (0 diverxentes) en todo o corpus | **refutada como evidencia** (§5) |
| R4 densidade de candidatos como taxa propia do formato | unha taxa comparable entre ROMs | 0,035 %–1,184 % | **refutada** (§2) |
| R5 chamada `jsr`/`jmp abs.l` ao enderezo do fluxo | o consumidor chama ao fluxo | 0 casos en 5/5 imaxes | **refutada como forma de vínculo**: a chamada vai á rutina |
| R6 carga `lea abs.l,An` co fluxo como operando | quen pasa o fluxo á rutina | Sonic 3, reservada 5 (6 cargas), AB/GA/RKA 0 | **suficiente onde existe; non universal** (§6, §7) |
| R7 `jsr abs.l` a unha rutina compartida tras a carga | un único destino por ROM | reservada 6/6 → `0x85A2`; Sonic 0/3 | **refutada como requisito** (§7) |

## 4. Refutación de R1 — a táboa ascendente era ruído do umbral

Varrida de `--min-entradas` sobre os candidatos de cada ROM
(`~/.retrodev/rex_corpus_a_work/logs/varrida-min-entradas.log`, SHA-256
`f2058883fde08871cacd5b66e67ddc5271ba676e55816ec9473ca2ab86999cea`):

| Imaxe | min=3 vinculados (táboas) | min=4 | min=6 | menor `primeiro` |
|---|---|---|---|---|
| Altered Beast | 3 (3) | 1 (1) | 0 (0) | `0x12` |
| Golden Axe | 0 (0) | 0 | 0 | — |
| Rocket Knight | 0 (0) | 0 | 0 | — |
| Sonic 1 | 3 (0) | 3 (0) | 3 (0) | — (as súas 3 son cargas, non táboas) |
| Reservada | 13 (8) | 5 (0) | 5 (0) | `0x60b48` |

Dous feitos matan a regra:

1. As táboas da imaxe reservada **desaparecen** ao pasar de 3 a 4 entradas, e
   as de Altered Beast caen a 0 en min=6. Un vínculo que depende dese
   parámetro non é estrutura, é o punto onde o ruído ascendente deixa de
   cuaxar.
2. As tres táboas de Altered Beast comezan con valores de `0x12`, `0x18`,
   `0xca0`: `tables_for` acepta calquera longword *non nula e menor que o
   tamaño da imaxe*, e un punteiro de 18 bytes non é un offset desta ROM.

Na Fase 2 `vinculo=si` para `0x745DC` apoiábase nesta regra. Retírase: coa
varrida medida, esa categoría non distingue recurso de azar. O que si se
mantén é a observación estrutural (existen táboas de longwords ordenadas),
non a súa interpretación como evidencia de consumo.

## 5. Refutación de R3 — o ciclo segue sen dicir nada

`roundtrip` na imaxe reservada: `RESUMO ciclos=92 diverxentes=0`. En todo o
corpus: **4 720 ciclos, 0 diverxentes**. Unha taxa de peche do 100 % nun
poboado que inclúe os 38 candidatos de saída < 64 bytes (que case certainly
non son fluxos Kosinski) é a proba máis limpa de que pechar o ciclo mide
*determinismo do par decode/encode*, non a natureza do dato. Repítese a
conclusión da Fase 2 con 4 720 casos no canto de 4 628.

## 6. R6 — a carga absoluta longa: o vínculo que a ferramenta non vía

`call_sites` buscaba `4E B9`/`4E FD` cuxo *destino* fose o enderezo do fluxo.
Medido na imaxe reservada: **cero** casos así — e en cambio 383 cargas
`lea abs.l,An` das cales 6 teñen un candidato como operando. A convención real
é `lea fluxo,A0` → `lea destino,A1` → `jsr rutina`: a chamada apunta á rutina,
non ao fluxo, polo que o vínculo existía e a ferramenta non o modelaba.

**Codificación** (derivada, non lembrada): `lea abs.l,An` =
`0100 ddd 111 | 111 001`, co mesmo par `111/001` (absoluto longo) que confirma
`4E B9` = `jsr abs.l`. Os oitos opcodes válidos son `41 F9 … 4F F9` — primeiro
byte impar, nibre alto `4`. `4E F9` (`jmp abs.l`) queda fóra porque o seu
primeiro byte é par. Isto está fixado en `tests/consumer.rs`
(`carga_abs_l_cobre_os_oito_rexistros_coa_codificación_derivada_de_4eb9`).

**Medida na imaxe reservada** (`consumidor-cargas-holdout.log`):

| | |
|---|---|
| Cargas `lea abs.l` na imaxe | 383 |
| Distribución por rexistro | A0=28, A1=158, A2=73, A3=31, A4=23, A5=28, A6=39, A7=3 |
| Cargas cuxo operando é candidato | **6 — todas en A0** |
| Enderezos distintos | 5 (`0x389A0` aparece 2 veces) |
| Seguidas dunha chamada dentro de 16 bytes | 6/6, todas a `0x085A2` |

As agregacións «383» e «distribución por rexistro» non as emite o CLI (que
enumera as cargas dun enderezo dado, non o total da imaxe), así que se
reproducen así, en lectura, sobre o mesmo ficheiro que mediu `scan`:

```bash
python3 - "$IMAXE" <<'PY'
import sys, os
im=open(sys.argv[1],'rb').read()
R={0x41:0,0x43:1,0x45:2,0x47:3,0x49:4,0x4B:5,0x4D:6,0x4F:7}
L=[(o,R[im[o]],int.from_bytes(im[o+2:o+6],'big'))
   for o in range(0,len(im)-6,2) if im[o] in R and im[o+1]==0xF9]
print(len(L), {r:sum(1 for _,x,_ in L if x==r) for r in range(8)})
C={int(l.split('=')[1].split(' ')[0],16)
   for l in open(os.path.expanduser('~/.retrodev/rex_corpus_a_work/logs/scan-holdout.log'))
   if l.startswith('CAND ')}
print(len([1 for _,_,v in L if v in C]), [(hex(o),hex(v)) for o,r,v in L if r==0 and v in C])
PY
```

Que deu `383 {0: 28, 1: 158, 2: 73, 3: 31, 4: 23, 5: 28, 6: 39, 7: 3}` e
`6 [('0x16d2','0x71c6c'), ('0x87fc','0x389a0'), ('0x8842','0x1f596'),
('0x10636','0x795a2'), ('0x10852','0x1caec'), ('0x119b4','0x389a0')]`.

**Control de taxa base.** Se os operandos fosen uniformes na xanela de
262 144 posiciones, esperaríanse `383 × 92/262144 = 0,13` coincidencias
(`0,0098` restrinxindo a A0). Medíronse 6, todas no rexistro A0; as outras 355 cargas non dan
ningunha. A comparación non é un test de significancia — os punteiros reais dunha ROM non son uniformes — pero si
cualifica a orde de magnitude: non é o que produce o azar.

**Control de non-vacuidade.** Das 22 cargas a A0 cuxo operando **non** é
candidato, 3 si levan unha chamada nos 16 bytes seguintes (`0xB74C→0xB768`,
`0x10E50→0x6F3D4`, `0x10EA6→0x1D0DA`). A forma `lea A0 + chamada` aparece polo
tanto 9 veces na ROM e só 6 apuntan a un fluxo que decodifica. É dicir, a
forma por si soa non abonda — hai enderezos coa mesma sintaxe que o sondeo
rexeitou — e o vínculo require a conxunción: que o operando decodifique **e**
que a carga sexa un operand de instrución.

## 7. Refutación de R7 — a convención de chamada varía entre ROMs

Aplicando a mesma medida a Sonic 1, as súas tres cargas teñen `destino=ningunha`:
non hai `jsr abs.l` despois.

| ROM | carga | seguinte instrución (bytes medidos) |
|---|---|---|
| Sonic 1 | `0x01364` | `43 F9 00 A0 00 00` (`lea $A00000,A1`) e `61 00 05 2A` (`bsr`) |
| Sonic 1 | `0x03082` | `43 F9 00 FF 00 00` (`lea $FF0000,A1`) e `61 00 …` |
| Sonic 1 | `0x051BC` | `43 F8 94 00` (`lea ($9400,A0),A1`) e `61 00 …` |
| Reservada | 6 casos | `43 F9 00 FF 70 00`/`00 FF 80 00` e `4E B9 00 00 85 A2` |

Se R7 se impuxese como requisito, os tres vínculos de Sonic perderíanse. A
ferramenta polo tanto informa a chamada cando existe e `chamada=ningunha` cando
non, en vez de exigir unha convención. Non se interpreta o `bsr` de 16 bits
(Fase 5 se fai falta): o vínculo medido é a carga, non o destino.

## 8. Enderezos con evidencia estrutural

Oito enderezos cumpren R6: 3 en Sonic 1 e 5 na imaxe reservada; as outras
tres imaxes dan cero. Os bytes de saída non se versionan.

| ROM | fluxo | consumo | saída | rexistro | chamada | destino |
|---|---|---|---|---|---|---|
| Sonic 1 | `0x3F09A` | 8 453 | 41 984 | A0 | ningunha | — |
| Sonic 1 | `0x6175E` | 1 419 | 4 096 | A0 | ningunha | — |
| Sonic 1 | `0x72E7C` | 5 974 | 7 110 | A0 | ningunha | — |
| Reservada | `0x1CAEC` | 611 | 8 192 | A0 | `0x1085E` | `0x085A2` |
| Reservada | `0x1F596` | 374 | 2 248 | A0 | `0x0884E` | `0x085A2` |
| Reservada | `0x389A0` | 514 | 1 568 | A0 | `0x08808`, `0x119C0` | `0x085A2` |
| Reservada | `0x71C6C` | 656 | 2 248 | A0 | `0x016DE` | `0x085A2` |
| Reservada | `0x795A2` | 7 581 | 7 936 | A0 | `0x10642` | `0x085A2` |

Cos tres de Sonic, o obxectivo de «≥2 recursos reais confirmados na mostra de
desenvolvemento» está cuberto **sen** tocar a mostra reservada. Golden Axe
(93 candidatos), Rocket Knight (1 178) e Altered Beast (3 103) quedan con
**cero**: nesas ROMs os fluxos non se referencian con carga absoluta longa e a
ferramenta non modela o resto das convencións; a ausencia é un resultado
medido, non unha refutación dos seus candidatos.

## 9. Control discriminativo (mutación)

Mutación aplicada a `cargas_abs_l`: substituír a comprobación do opcode por
`if true` (calquera word aliñado vale como carga).

```
### MUTADO ###    consumidor_non_confunde_unha_referencia_de_datos_cunha_carga_de_operando ... FAILED
                  consumidor_atopa_a_chamada_a_referencia_e_a_táboa_que_vinculan_un_enderezo ... FAILED
                  test result: FAILED. 37 passed; 2 failed
### RESTAURADO ### 11 obxectivos de test, todos "test result: ok"
```

O control relevante é o primeiro: imita a forma que Rocket Knight produce de
verdade (`31 FC` precede os bytes do enderezo, un inmediato de 16 bits que non
é un punteiro). Coa mutación, iso contaríase como vínculo. Sen mutación dá
`cargas=0 vinculo=non`, que é o que se mide na ROM real.

## 10. Que NON proba esta fase

- Non se executou ningún byte: nada do anterior di que `0x085A2` sexa un
  descompresor, nin que eses oito fluxos se carguen nunca en pantalla. Di que
  o enderezo de cada fluxo é o operando dunha instrución de carga absoluta
  longa medida nesta ROM.
- Non se fixo decompilación de lóxica nin se nomearon rotinas: `A0`/`A1` e
  `bsr`/`jsr` son formas de opcode, non semántica de programa.
- R6 non é universal: 0/3 imaxes de desenvolvemento a empregan. Unha ROM que
  referencie os seus fluxos por táboa ou por desprazamento relativo PC segue
  sen detectar.
- Non se mediu paridade con outro decodificador externo nesta fase (fíxose na
  Fase 3 contra mdcomp).
- Non se escribiu ningunha ROM modificada, nin se reinseriu nada.
- A mostra segue sendo de 5 imaxes e 1/xogos por convención de chamada. Non se
  declara cobertura universal.

## 11. Gates

| Comando | Resultado |
|---|---|
| `cargo test --offline` | **123 passed · 0 failed** (cli 39, consumer 25, inventory 20, container 9, json 9, magia 7, mdheader 9, spec 5). Antes da fase: 115 |
| `cargo clippy --offline --all-targets -- -D warnings` | sen avisos |
| `cargo fmt -- --check` | exit 0 |
| `npm run check:tree` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| Bytes comerciais no índice | ningún: `git add` restrinxido a `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |

Probas novas desta fase: 5 unitarias (`carga_abs_l_*`) e 3 de CLI
(`consumidor_etiqueta_…`, `consumidor_distingue_a_convencion_sonic_…`,
`consumidor_non_confunde_…`), todas escritas antes da implementación.

### Logs identificados

Todos en `~/.retrodev/rex_corpus_a_work/logs/`, xerados co binario
`2feb89b0…` (ningún contén bytes comerciais: só offsets, lonxitudes e hashes).

| Log | SHA-256 (16 primeiros) |
|---|---|
| `consumidor-cargas-Sonic the Hedgehog (USA, Eur.log` | `d7d6a8caa77e5d46` |
| `consumidor-cargas-holdout.log` | `a99ced1c1195b204` |
| `consumidor-cargas-holdout-min4.log` | `5b570bc1fe98badd` |
| `consumidor-cargas-Altered Beast (USA, Europe) .log` | `4522a88e0fa0f62a` |
| `consumidor-cargas-Altered Beast (USA, Europe) -min4.log` | `fa9de0cea5b44812` |
| `consumidor-cargas-Altered Beast (USA, Europe) -min6.log` | `9d1ed2d430f7dc9f` |
| `consumidor-cargas-Golden Axe (World) (Translat.log` | `4bf8f1d92abc4450` |
| `consumidor-cargas-Rocket Knight Adventures (US.log` | `ffe1869d86d1e957` |
| `varrida-min-entradas.log` | `f2058883fde08871` |
| `regenero-v2.log` (as 15 execucións) | `e7caa8b4a26b8442` |

Os logs de Golden Axe, Rocket Knight e Sonic son **idénticos byte a byte** en
min=3/4/6: nas dúas primeiras non hai ningún vínculo que eliminar, e en Sonic
os tres son cargas, unha categoría que `--min-entradas` non afecta. É a
comprobación de que a varrida só move a regra de táboas.

## 12. Manexo para o integrador

1. `rex-corpus-consumer` pasa a **v2**: `ENDERESO` leva `cargas=` e aparecen
   liñas `CARGA`. Non hai consumidores programáticos deste formato aínda.
2. `ResourceRecord.consumer_evidence` (en `src/resource.rs`) é un `Vec<String>`
   libre; a Fase 5 quere meter estas evidencias nel e necesita un contrato de
   string (`lea:<offset>:A<n>→<destino>`?). Qeda pendente a decisión.
3. `tables_for` debería rexeitar valores por debaixo dun mínimo de offset
   (os `0x12` de Altered Beast) ou deixar de emitir `vinculo=si`. Proposta:
   esixir `primeiro >= 0x400` ou un `--min-entradas` por defecto maior. Non o
   cambiei aquí para non decidir polo integrador a súa barra de evidencia.
4. A detección de `bsr`/`lea (d16,PC),An` falta; con ela Sonic pasaría de
   «carga sen chamada» a vínculo completo.
