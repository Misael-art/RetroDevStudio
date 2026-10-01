# FASE 5 — CLI reutilizable, perfis versionados e rexistros de recurso

**Estado: Experimental.** Esta fase entrega ferramentas, contratos e artefactos
reutilizables; non promove maturidade. Ningún byte comercial está no índice,
ningunha ROM se executou e ningunha ROM modificada se escribiu.

| | |
|---|---|
| Base | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Branch | `codex/rex-corpus-a` (worktree exclusiva `~/RDS-REX-CORPUS-A`) |
| Territorio | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| Binario medidor | `target/debug/rex-corpus` SHA-256 `ed988e3e07eb92c1ba0eabc890403265f8ec25b9ec0b85ea3f2808b72f09845f` |
| Imaxes | 4 de desenvolvemento + 1 reservada (`data/rex_corpus_a/inventario.json` e a folla de proveniancia local da reservada) |
| Dependencias consumidas | `crates/rex-addressing` (`md_linear`) e `crates/rex-kosinski` (`decode`), sen duplicar nin modificar |

## 1. Que se engade

Tres superficies novas, todas puras:

- **`src/evidence.rs`** — `rex-corpus-evidence/v1`: a gramática das cadeas que
  van en `consumer_evidence`. Antes era un `Vec<String>` libre: calquera texto
  valía, así que un rexistro podía afirmar `confirmado-estaticamente` cunha
  proba inventada. Agora as cadeas **fabrícanse** desde as estruturas que mide
  `consumer` e **len** só se cumpren a gramática.
- **`src/perfil.rs`** — `rex-corpus-perfil/v1`: o perfil reutilizable. Fixa o
  SHA-256 dos bytes, a orientación medida, o codec/variante declarados e os
  límites do sondeo.
- **`src/main.rs`: `cmd_perfil` e `cmd_rexistro`** — dous subcomandos novos que
  usan `rex-addressing` para traducir enderezo→offset e `rex-kosinski` para
  medir consumo/saída, e escriben o rexistro `rex-corpus-resource/v1`.

`ResourceRecord::validar()` (`src/resource.rs:76`) é a porta: rexeita
confianzas que non corresponden á evidencia medida e calquera cadea fóra da
gramática. O esquema do rexistro **non** cambia (`rex-corpus-resource/v1`):
ninguén o consume fóra desta crate e o que precisaba fixarse era o formato das
súas cadeas de evidencia.

## 2. `rex-corpus-perfil/v1`

Un obxecto plano dunha liña; as claves saen nunha orde fixa, así que dous
perfis cos mesmos bytes dan bytes idénticos (probado en `tests/perfil.rs`).

| Campo | Que fixa | Como se obtén |
|---|---|---|
| `perfil_id` | perfil de enderezamento | defecto: `md_linear::PROFILE_ID` (`md-linear`) |
| `imaxe_normalizada_sha256` | **os bytes exactos** aos que aplican os offsets | SHA-256 da imaxe entregada |
| `orientacion` | `lineal` / `interlazado-smd` / `non-identificada` | `layout::detect`, medida |
| `codec`, `variante` | que se busca | declarado polo operador (defecto `kosinski`/`base`) |
| `estado_revision` | estado da revisión | defecto `descoecida`: **non se adiviña** |
| `desde`, `ata`, `stride`, `min_saida`, `max_saida`, `orzamento` | xanela e límites do sondeo | `ScanLimits::DEFAULT` |
| `ventanxa_chamada`, `min_entradas` | radio da evidencia estrutural | 16 bytes / 3 entradas |
| `limite_bytes` | teito de lectura da imaxe | `--max-bytes`, defecto 16 MiB |

`Perfil::parse` rexeita con `MotivoPerfil` (`sen-esquema`, `esquema-incorrecto`,
`hash-co-forma-invalida`, `campo-obrigatorio-ausente`, `numero-invalido`,
`orientacion-descoecida`). Un hash baleiro, `null`, en minúsculas, de 63 ou 65
díxitos, ou unha orientación que `layout` non produce non son erros de lectura:
son recusas.

## 3. `rex-corpus-evidence/v1`

```text
evidencia := lea@HEX / A<d> [ / chamada@HEX / HEX ]
           | chamada@HEX / HEX
           | taboa@HEX / ENTRADAS / (crecente|decrecente)
           | ref@HEX
HEX        := "0x" [5-7] díxitos hexadecimais en maiúsculas
```

- `HEX` leva ancho **mínimo** cinco díxitos e máximo sete: unha imaxe de 4 MiB
  chega a `0x400000` e o ancho non pode truncar. `0x40` rexeitase na lectura:
  non é a forma en que se mediu.
- **`ref` non vincula.** A Fase 2 tomou por vínculo a presenza de bytes (a
  retractación de `0x745DC`, `docs/rex_corpus_a/FASE4-REFUTACION.md` §4) e o
  código queda a dicilo: `Evidencia::vincula()` devolve `false` só para
  `Referencia`. Unha `ref` pode acompañar un rexistro; soa non o confirma.
- `Carga` pode ir **sen** `chamada`: Sonic 1 chama a súa rutina con `bsr` de 16
  bits (`61 00 …`), non con `jsr abs.l`, e esixir a chamada perdería os tres
  vínculos (é a refutación de R7, §7 do informe da Fase 4).

## 4. Os dous subcomandos e os seus códigos

```
rex-corpus perfil   --imaxe FICHEIRO [--out FICHEIRO] [--perfil-id ID] [--codec C]
                    [--variante V] [--estado-revision S] [--ata N]
                    [--ventanxa-chamada N] [--min-entradas N] [--max-bytes N]
rex-corpus rexistro --imaxe FICHEIRO --perfil FICHEIRO --endereco N [--endereco N …]
                    [--max-bytes N]
```

`--endereco` acepta decimal ou hexadecimal (`0x1CAEC`); un token que non é
número é un erro de uso con código 2, **nunca** un enderezo descartado en
silencio.

| Saída | `perfil` | `rexistro` |
|---|---|---|
| 0 | perfil escrito ou impreso | polo menos un rexistro válido (ou ningún, declarado) |
| 2 | sen `--imaxe` | sen `--imaxe`, sen `--perfil`, sen `--endereco`, `--endereco` malformado |
| 3 | — | perfil ilexible (motivo en stderr, ex. `sen-esquema`) |
| 4 | imaxe ausente (`non executado`) | imaxe ou perfil ausentes (`non executado`) |
| 5 | — | `PERFIL-DIVERXENCIA`, `ORIENTACION-DIVERXENCIA` ou rexistro rexeitado por `validar()` |

Tres portas que a misión pide e aquí son mecánicas:

1. **Non transplantar offsets.** O perfil pinna o SHA-256; se os bytes
   entregados non coinciden, `rexistro` para con código 5 en vez de aplicar
   offsets doutra revisión.
2. **Non executar.** Un rexistro con `confianza=observado-en-runtime` rexeitase
   en `validar()`: esta misión non executa a ROM.
3. **Non inventar un offset.** `md-linear` enmascara co `rom_size`, que ten que
   ser potencia de 2. Nunha imaxe de 531 577 bytes o `rom_size` efectivo é
   `0x100000`, así que un enderezo da zona de recheo traduce a un offset que non
   existe no arquivo. Iso declárase `non-traducible=offset-fora-da-imaxe` e
   conta en `non_traducibles`, non se decodifica.

## 5. Artefactos versionados

Só hashes, offsets e lonxitudes. Nin bytes comerciais, nin rutas locais (o
test `perfis_versionados_lean_o_esquema_e_pinan_unha_imaxe_do_corpus` probe que
ningunha cadea contén `/home/`).

| Ficheiro | SHA-256 | Que fixa |
|---|---|---|
| `data/rex_corpus_a/perfis/sonic-1-usa-europe.md-linear.json` | `7235780e9890349f295ad9d2fdbe688e886cc3433efa88440e4cce83243fad21` | imaxe `c7da53a1…`, lineal |
| `data/rex_corpus_a/perfis/altered-beast-usa-europe-ptbr.md-linear.json` | `282649b7f44c518d302ccc2634a4748ea0f3d60e7f33aa9b2ce809c32b4254f0` | imaxe `a60aff25…`, lineal |
| `data/rex_corpus_a/perfis/golden-axe-world-ptbr.md-linear.json` | `fcd41d0570697f5474264148b79ee1b1ceea55b74d2b592c44c39c890d9ebc1c` | imaxe `75613dde…`, lineal |
| `data/rex_corpus_a/perfis/rocket-knight-usa-ptbr.md-linear.json` | `496d2fea63d7aed786cefaf859c4683d8024be7b114604cb42c67ec9183e8cb5` | imaxe `a30de82d…`, lineal |
| `data/rex_corpus_a/perfis/streets-of-rage-world-ptbr-reservada.md-linear.json` | `ad459d5e7f356550ffc6b76f5ced314333cef327161e5a22db56af0d7a4ea3a4` | imaxe `304f56ba…`, lineal |
| `data/rex_corpus_a/evidencia/sonic-1-usa-europe.rexistros.jsonl` | `2e6cf1d428f56b5828f372d0c07a578d8d6385255cce1e2849f7faed6f14fe2a` | 3 rexistros |
| `data/rex_corpus_a/evidencia/streets-of-rage-world-ptbr-reservada.rexistros.jsonl` | `6feb945469765120ddfeb76fcf47272015e4ffec175d1541eb793b1c4e165f86` | 5 rexistros |

O pin da reservada (`304f56ba2560a7cd6b93dd092cb0d17e4cd783b9086cf4bf069d6fdd2cb3961d`)
é o `staged_sha256` da súa folla de proveniancia local: contedor
`fbb1f3694132fb85cfd1ccc2d39642da0b0306c523d834fadda792ea3ab68efc`, membro
`Streets of Rage (World).gen`, CRC-32 `88e4ef3c`, método `Defl:N`,
524 288 bytes. Non está en `inventario.json` porque a Fase 1 a excluíu como
mostra reservada.

### 5.1 Os oito rexistros medidos

Xerados **pola ferramenta** sobre as imaxes locais (BYOR), non escritos a man:

| Imaxe | Offset | Consumo | Saída | Evidencia | Confianza |
|---|---|---|---|---|---|
| Sonic 1 | `0x3F09A` | 8453 | 41984 | `lea@0x03082/A0` | confirmado-estaticamente |
| Sonic 1 | `0x6175E` | 1419 | 4096 | `lea@0x051BC/A0` | confirmado-estaticamente |
| Sonic 1 | `0x72E7C` | 5974 | 7110 | `lea@0x01364/A0` | confirmado-estaticamente |
| Reservada | `0x1CAEC` | 611 | 8192 | `lea@0x10852/A0/chamada@0x1085E/0x085A2` | confirmado-estaticamente |
| Reservada | `0x1F596` | 374 | 2248 | `lea@0x08842/A0/chamada@0x0884E/0x085A2` | confirmado-estaticamente |
| Reservada | `0x389A0` | 514 | 1568 | `lea@0x087FC/A0/chamada@0x08808/0x085A2` + `lea@0x119B4/A0/chamada@0x119C0/0x085A2` | confirmado-estaticamente |
| Reservada | `0x71C6C` | 656 | 2248 | `lea@0x016D2/A0/chamada@0x016DE/0x085A2` | confirmado-estaticamente |
| Reservada | `0x795A2` | 7581 | 7936 | `lea@0x10636/A0/chamada@0x10642/0x085A2` | confirmado-estaticamente |

Consumos e saídas coinciden byte a byte co medido na Fase 4 (`FASE4-REFUTACION.md`
§6 e táboa de `0x1CAEC`… `0x795A2`): a ferramenta non reinterpreta, repite.

Os tres de Sonic 1 son o caso que a Fase 4 predixo: a carga absoluta longa
existe (`41 F9 00 03 F0 9A` en `0x03082` = `lea $3F09A,A0`, bytes comprobados
na imaxe local) pero **non** hai `jsr abs.l` despois — hai `43 F9 …` (`lea
destino,A1`) e un `bsr`. Unha gramática que obrigase a chamada perderíaos;
vinculan igual porque o operando dunha instrución de carga é un consumidor, non
unha casualidade de bytes.

A mostra reservada entra aquí **só** como medida estática dos vínculos que a
Fase 4 xa intentou refutar; non se empregou para axustar ningunha regra.

### 5.2 Reprodución

```bash
BIN=scripts/rex_corpus_a/target/debug/rex-corpus
IMG=/home/misael/.retrodev/rex_corpus_a_work/staged        # BYOR, non versionado
HOLD=/home/misael/.retrodev/rex_corpus_a_holdout/staged
$BIN perfil --imaxe "$IMG/Sonic the Hedgehog (USA, Europe).bin" \
            --out data/rex_corpus_a/perfis/sonic-1-usa-europe.md-linear.json
$BIN rexistro --imaxe "$IMG/Sonic the Hedgehog (USA, Europe).bin" \
  --perfil data/rex_corpus_a/perfis/sonic-1-usa-europe.md-linear.json \
  --endereco 0x3F09A --endereco 0x6175E --endereco 0x72E7C \
  | grep -F '{"schema_version":"rex-corpus-resource/v1"' \
  > data/rex_corpus_a/evidencia/sonic-1-usa-europe.rexistros.jsonl
```

`rexistro` imprime verbos e rexistros intercalados en stdout (o ser humano ve o
que pasó e a máquina le o JSON); o artefacto versionado queda filtrado pola
etiqueta do esquema, así que cada liña do `.jsonl` é un rexistro e nada máis.
A saída é determinista: mesma imaxe, mesmo perfil, mesmos enderezos → bytes
idénticos (a orde das claves é fixa en `to_json`).

## 6. Testes

`cargo test --offline`: **157 passed · 0 failed** (antes da fase, 115).

| Obxectivo | Testes |
|---|---|
| Gramática da evidencia | `tests/evidence.rs` 14 (formato, lectura, recusa de formas inventadas, as cinco regras de `validar()`) |
| Perfil | `tests/perfil.rs` 6 (lectura dos campos declarados, forma do hash, campos obrigatorios, orientación, teito de bytes) |
| CLI | `tests/cli.rs` 50 (+11 nesta fase: rexistro confirmado/candidato/non-fluxo/dous perfis diverxentes/perfil malformado/enderezo fóra do barramento/zona de recheo/hexadecimal, e o perfil escrito polo CLI aplicado á súa imaxe) |
| Artefactos versionados | `tests/artefactos.rs` 3 (**sen ROM**: forma, pin contra inventario, gramática de cada cadea, coherencia `confianza` ⟺ evidencia vinculante, arithmetic `tramo ≥ consumo`, `saida` dentro do perfil, ningún `/home/`, ≥2 recursos confirmados) |
| Contrato antigo | `tests/consumer.rs` 25 — a mostra `tabla@0xC0` estaba fóra da gramática; pasa a `taboa@0x000C0/3/crecente` e o teste chama a `validar()` |

### 6.1 Controls discriminativos (mutación → FAIL → restaurar → PASS)

| Mutación | Efecto esperado | Observado |
|---|---|---|
| `hex5`: ancho mínimo 5 → 1 | aceptar `0x40` | `parse_rexeita_formas_que_non_saen_da_gramatica` **FAILED** |
| `Evidencia::vincula()` → sempre `true` | que unha `ref` confirme | `referencia_crua_non_e_un_vinculo` e `rexistro_confirmado_sen_evidencia_vinculante_rexeitase` **FAILED** |
| `Perfil::encaza()` → sempre `true` | aplicar offsets doutra imaxe | `rexistro_rexeite_un_perfil_que_non_pinna_a_imaxe_entregada` **FAILED** |
| garda da zona de recheo desactivada | decodificar recheo | `rexistro_non_inventa_un_offset_na_zona_de_recheo_da_imaxe` **FAILED** e pánico real en `src/main.rs` (`imaxe[offset..]` fóra de rango) |
| nun rexistro versionado quitar a evidencia vinculante | `confirmado` sen proba | `rexistros_versionados_len_a_gramatica_de_evidencia_…` **FAILED** |

Despois de cada restauración, suite completa en verde (157) e os dous ficheiros
mutados comprobados byte a byte contra a copia previa (`diff` sen saída).

## 7. Que NON proba esta fase

- **Non se executou nin un byte.** `confirmado-estaticamente` significa que o
  enderezo do fluxo é o operando dunha instrución de carga medida nesta ROM, non
  que a ROM chamase a esa rutina nin que eses bytes acaben en pantalla.
- **Non hai decompilación de lóxica.** `A0`/`A1`, `bsr`/`jsr` e `0x085A2` son
  formas e destinos de opcode; non se nomeou ningunha rutina nin se probou que
  descomprima.
- **Non hai reinserción.** Non se escribiu ningunha ROM modificada; o ciclo do
  codec (Fase 3) non proba reinserción segura.
- **Un decode correcto segue sen confirmar un recurso por si só**: por iso o
  rexistro só é `confirmado` cando hai evidencia vinculante, e a proba de
  non-vacuidade está no CLI (`tests/cli.rs`: a mesma imaxe con e sen a
  convención `lea`+`jsr` dá `candidato` e `confirmado-estaticamente`).
- **Nun hai cobertura universal nin corpus ampliable.** Oito rexistros de dúas
  imaxes (`md-linear` sen mapper); as outras tres imaxes de desenvolvemento non
  deron ningún vínculo, e o que refutou a Fase 4 (R6, R7) segue refutado.
- **Os campos non medidos seguen `not_measured`**, non se enchen cun estimado.
  O `rom_size` efectivo que `md-linear` necesita (`0x100000` nun arquivo de
  531 577 bytes) vai declarado na `limitacions` de cada rexistro de Sonic, non
  se maquilla nin se rechea o arquivo.

## 8. Gates

| Comando | Resultado |
|---|---|
| `cargo test --offline` | **157 passed · 0 failed** (artefactos 3, cli 50, consumer 25, container 9, evidence 14, inventory 20, json 9, magia 7, mdheader 9, perfil 6, spec 5) |
| `cargo clippy --offline --all-targets -- -D warnings` | sen avisos |
| `cargo fmt -- --check` | exit 0 |
| `npm run check:tree` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| Bytes comerciais no índice | ningún: `git add` restrinxido a `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/`; os artefactos versionados conteñen hashes, offsets e lonxitudes |

## 9. Débeda que deixa esta fase (para o integrador)

Nada disto se tocou aquí — territorio compartido ou do agente B:

1. `crates/rex-addressing`: `md_linear::translate` enmascara sen consultar o
   límite real do arquivo; a zona de recheo resolvese no chamador
   (`cmd_rexistro`), pero a información "este offset está dentro da ROM" é do
   perfil, non do chamador. Proposta: que `Translate::Rom` leve un campo de
   `dentro_da_imaxe` ou que `validate_state` acepte `rom_len` real.
2. `rex_corpus::consumer::tables_for`: segue aceptando táboas cuxa primeira
   entrada cae moi abaixo do mapa (`primeiro=0x12` en Altered Beast). Proposta
   de umbral: `primeiro >= 0x400` ou `--min-entradas` por defecto maior.
3. Glob de aceite `m02` e `vendoring` de `negative/*.expected.json` en
   `crates/rex-kosinski/fixtures/`, e a etiqueta `ERR-eod` de `gen_vectors.py`
   (inconsistencia de nome rexistrada na Fase 3).
