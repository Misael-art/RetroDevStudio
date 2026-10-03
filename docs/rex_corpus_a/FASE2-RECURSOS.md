# FASE 2 — Recursos reais e consumidores (Misión A)

Estado: **Experimental**. Ferramenta e evidencias medidas; ** ningún recurso do
corpus foi confirmado**.

| | |
|---|---|
| Branch | `codex/rex-corpus-a` (worktree exclusiva `~/RDS-REX-CORPUS-A`) |
| Base declarada | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Fase anterior | `592de95` (inventario Fase 1; `ae3cc4c` pre-rebase) |
| Territorio rastreado | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| Artefactos comerciais | **non versionados**; só hashes, offsets e lonxitudes |

## Como se reproducen as medidas

As imaxes son as xa normalizadas por `stage.sh` (Fase 1). Todo o que segue é
lectura; nada escribe na ROM nin no corpus.

```bash
A=~/RDS-REX-CORPUS-A/scripts/rex_corpus_a
W=~/.retrodev/rex_corpus_a_work            # staged/ + logs/
cargo build --offline --manifest-path $A/Cargo.toml
B=$A/target/debug/rex-corpus

$B magia       --imaxe "$W/staged/Sonic the Hedgehog (USA, Europe).bin"
$B scan        --imaxe "$W/staged/Sonic the Hedgehog (USA, Europe).bin"
$B consumidor  --imaxe "$W/staged/Sonic the Hedgehog (USA, Europe).bin" --endereco 476636
$B roundtrip   --imaxe "$W/staged/Sonic the Hedgehog (USA, Europe).bin" --offset 14206
```

Os `--offset`/`--endereco` son decimais por contrato: a ferramenta non acepta
`0x…` para non ter dous parsing distintos da mesma cifra.

## Superficie entregada nesta fase

| Verbo | Que mide | Saída |
|---|---|---|
| `scan` | candidatos Kosinski por barrido acoutado, co consumo e a saída de cada un | `CAND`, `negativas …`, `RESUMO candidatos=N tope=` |
| `roundtrip` | ciclo `decode -> encode -> decode` independente nun offset | `RT offset=… saida=… consumo=… reescrito=… recuperado=… saida_sha256=… ciclo=` |
| `magia` | ocurrencias dos marcadores `KosM` `KosP` `EniM` `GSS ` `Unic` | `SEQ <marc> ocorrencias=… desprazamentos=… tope=`, `RESUMO maxias=N veredito=` |
| `consumidor` | chamadas `jsr`/`jmp`, referencias de bytes crús e táboas de punteiros que conteñen un enderezo | `ENDERESO … referencias=… chamadas=… taboas=… vinculo=`, `REF`, `CHAMADA`, `TABOA` |

Módulos novos: `src/scan.rs`, `src/consumer.rs`, `src/magia.rs`,
`src/resource.rs` (rexistro `rex-corpus-resource/v1`). O códec **non se
duplica**: consómese `rex_kosinski::decode`, `rex_kosinski::encode` e
`rex_kosinski::edit::sha256_hex` dos `crates/` fixados.

## Evidencia 1 — non hai maxia da familia Kosinski neste corpus

Sondeo sobre as cinco imaxes normalizadas (`magia-staged.log`,
SHA-256 `4cf507b346a615b9c27bb5339b4af01155fe42bf2ec63dbfa32f24a045b2d5ce`):

| Imaxe | bytes | `KosM` | `KosP` | `EniM` | `GSS␠` | `Unic` | veredito |
|---|---|---|---|---|---|---|---|
| Sonic the Hedgehog (USA, Europe) | 531 577 | 0 | 0 | 0 | 0 | 0 | sen-maxia-familiar |
| Sonic (Translated PtBr → mesmo contido) | 531 577 | 0 | 0 | 0 | 0 | 0 | sen-maxia-familiar |
| Altered Beast (USA, Europe) | 524 288 | 0 | 0 | 0 | 0 | 0 | sen-maxia-familiar |
| Rocket Knight Adventures (USA) | 1 048 576 | 0 | 0 | 0 | 0 | 0 | sen-maxia-familiar |
| Golden Axe (World) | 524 288 | 0 | 0 | 0 | 0 | 0 | sen-maxia-familiar |

Limitación metodolóxica rexistrada: **un sondeo sobre o contedor `.zip` non
vale**. Os membros están comprimidos, polo que a busca dos catro bytes no
contedor non podería atopalos aínda que existisen dentro da ROM. Toda a táboa
anterior é sobre bytes *normalizados*, e a súa conclusión está acoutada a este
corpus: non autoriza a afirmar que ninguén use eses contedores.

## Evidencia 2 — decodificar é banal; confirmar non o é

Barrido completo de cada imaxe con `scan` (paso 2, `min-saida` 16, orzamento
4 000 000, tope 4096 candidatos — nunca acadado):

| ROM | intentos | candidatos limpos | taxa |
|---|---|---|---|
| Sonic 1 | 265 788 | 254 | 0,096 % |
| Altered Beast | 262 144 | 3 103 | 1,183 % |
| Rocket Knight | 524 288 | 1 178 | 0,225 % |
| Golden Axe | 262 144 | 93 | 0,035 % |

Un Kosinski **base sen maxia** non ten sinatura: calquera secuencia de bits
pode formar descritores lexibles. Que tres ROMs que non empregan este formato
producan milleiros de decodificacións limpas é a medida que refuta a idea de
que «un decode correcto» sexa evidencia dun recurso.

## Evidencia 3 — pechar o ciclo tampouco é evidencia (refutación propia)

Aplicouse `roundtrip` aos **4 628 candidatos** das catro ROMs. Resultado:
**4 628 `ciclo=ok`, 0 diverxencias** (logs `roundtrip-*.log`, SHA-256
`ce5b1329…32723`, `b97edbfca…38427`, `8a3c69a1…f00f0`, `45422dcfc…d800e5`).

Lectura correcta: pechar `decode → encode → decode` é unha **propiedade do
códec** (determinismo), non do dato. Unha ferramenta que reportase
`ciclo=ok` como confirmación de recurso estaría a medir o seu propio
implementamento. Esta é a refutación interna da fase: `roundtrip` serve para
validar o ciclo do códec e **non** para confirmar recursos.

Medidas secundarias do mesmo log (bytes plantados fronte a bytes reescritos):

| ROM | saida bytes | consumo bytes | reescrito bytes | `reescrito > consumo` | `=` | `<` |
|---|---|---|---|---|---|---|
| Sonic 1 | 453 443 | 273 306 | 78 895 | 10 | 3 | 241 |
| Altered Beast | 26 997 239 | 28 629 807 | 737 997 | 1 | 41 | 3 061 |
| Rocket Knight | 1 597 597 | 1 735 632 | 49 577 | 11 | 18 | 1 149 |
| Golden Axe | 11 967 | 13 595 | 2 329 | 4 | 14 | 75 |

Os 26 casos (`10+1+11+4`) nos que o stream reescrito é **máis longo** que o
tramo orixinal non son unha diverxencia de ciclo — a saída é idéntica —, pero
si son un dato do encoder estratexia en tramos curtos. Exemplo medido:
`RT offset=0x72E8A saida=20 consumo=24 reescrito=25`. Queda como observación
para o integrador, sen tocar `crates/rex-kosinski`.

## Evidencia 4 — estrutura real en Sonic 1, sen recurso confirmado

`consumidor` sobre catro enderezos (`consumidor-sonic.log`, SHA-256
`b4d097955f008deac582cda4d2ad6604cc500126c6c4c54a30dd1cbbb37a33fb`):

```
ENDERESO 0x745DC referencias=1 chamadas=0 taboas=1 vinculo=si
TABOA base=0x71A9C entradas=19 primeiro=0x745DC crecente=si
ENDERESO 0x71A9C referencias=1 chamadas=0 taboas=0 vinculo=non
REF offset=0x71998 operando=0x71A9C
ENDERESO 0x78B44 referencias=1 chamadas=0 taboas=0 vinculo=non
REF offset=0x7199C operando=0x78B44
```

O que se comproba: existe unha **táboa de longwords crecentes de 19 entradas
en `0x71A9C`** e outra en `0x78B44`, e ambas están citadas nun índice
en torno a `0x71990` (`0x71AE8, 0x78C04, 0x71A9C, 0x78B44`). É un vínculo
estrutural medido na imaxe local, non transplantado doutra revisión.

O que **non** se comproba: as aparicións en `0x71998`/`0x7199C` **non son
unha chamada**. Non hai `4E B9`/`4E FD` que apunte a eses enderezos, e o propio
índice non cumpre a forma de táboa crecente (os seus valores alternan), polo
que `taboas=0` e o veredito honesto é `vinculo=non`. Ningún dos dous casos se
presentou como recurso: `resource.rs` só admite `confianza` acompañada de
`evidencia_consumidor`, e aquí non hai consumidor que executar.

## Control discriminativo (non vacuidade)

Proba nova: `roundtrip_reescribe_con_o_encoder_en_vez_de_volver_decodificar_o_plantado`.
Planta oito literais idénticos (13 bytes) e exixe `reescrito < consumo`, é dicir
que o encoder produza un stream propio en vez de ecoar os bytes plantados.

Mutación aplicada a `fechar_ciclo` (substituír a saída do encoder por
`imaxe[offset..offset+consumo]`) → `test result: FAILED. 15 passed; 1 failed`,
fallando **exactamente** a proba de control. Restaurada a orixinal
(`Ok(enc) => enc.stream`) → suite completa verde. Sen este control, as catro
probas de `roundtrip` pasarían tamén cunha implementación que nin chamase ao
encoder.

## Gates

| Comando | Resultado |
|---|---|
| `cargo test --offline` | **97 passed · 0 failed** (cli 23, consumer 20, container 9, inventory 20, json 9, magia 7, mdheader 9) |
| `cargo fmt -- --check` | exit **0** verificado (sen `tail` no medio) |
| `cargo clippy --all-targets -- -D warnings` | sen avisos |
| `npm run check:tree` | OK: estrutura conforme `docs/08_TREE_ARCHITECTURE.md` |

## O que esta fase NON proba

- Non confirma **ningún recurso** do corpus: non hai maxia, non hai chamada
  `jsr`/`jmp` aos enderezos das táboas, e non se executa o xogo.
- Non proba **reinserción segura**: `roundtrip` non escribe na imaxe; ningún
  byte se reinsertou e **non se xerou ROM modificada**.
- Non proba **execución** nin emulación: non houbo xanela coordinada polo
  integrador, e o traballo estático non a exige.
- Non valida o **aceite externo** do códec contra referencia fixada — iso é
  Fase 3 e corresponde ao fluxo do axente B, sen duplicalo.
- Non xeraliza: a mostra son cinco imaxes de catro títulos; a mostra reservada
  (`Streets of Rage`, papel `reservada`) **non se tocou** nesta fase.
- Non declara cobertura universal nin decompilación de lóxica: `consumer.rs`
  recoñece dous opcodes de chamada absoluta longa e táboas de longwords
  ascensentes, nada máis.

## Handoff

Fase 3: aceite do ciclo do códec contra a referencia fixada (sen duplicar o
agente B), rexistro de entradas/saídas/límites/hashes e a distinción Kosinski
modular / Kosinski+ **só** se existir un fluxo confirmado — aquí non existe,
 polo que se declarará `non executado` en vez de inventalo.
Fase 4: tentar refutar as regras coa mostra reservada (`REX_ROLES=reservada`).
