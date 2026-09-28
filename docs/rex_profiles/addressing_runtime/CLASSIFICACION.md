# Clasificación de capacidades dos cinco perfis (roda REX A, fase 6 — etapa 1)

**Estado: Experimental.** Esta táboa non promotiona nada: describe, para cada
perfil do paquete `rex-addressing`, que está **validado con evidencia
executada**, que é **política conservadora escollida a conciencia** e que é
**formato explicitamente non suportado**. A confusión entre as dúas primeiras
classes é o que converte unha biblioteca honesta nunha afirmación falsa: moitas
das segundas *parecen* soporte se só se le o nome da función.

Directriz que orixina este documento: *diferencie comportamento validado /
política conservadora / formato explicitamente non suportado*, e *preserve o
tratamento explícito dos casos sen modelo independente*.

## 0. Como se le cada clase

| Clase | Criterio para entrar | Que **non** significa |
|---|---|---|
| **A. Validado** | O comportamento está fixado por cando menos **unha** fonte executada independente da implementación: vectores diferenciais pinados, referencia cruzada, test de regras derivado a man da spec, ou imaxe real BYOR | Non é "probablemente correcto"; se cambia, un test ponse vermello |
| **B. Política conservadora** | Decisión deliberada ante ambigüidade: a biblioteca **rexeita, clasifica ou delega** onde o hardware decidiría outra cousa. Está pinada con test, pero o test fixa a *decisión*, non a *verdade do silicio* | Non é un bug coñecido nin un caso sen implementar: é "aquí dicemos non a propósito" |
| **C. Non suportado** | Fóra do contrato: **non hai código** que o intente, e calquera entrada dese territorio ou ben erroa con `unsupported` ou ben se resolve polo mapa base (que **non** é unha afirmación sobre o chips) | Non é "pendente"; é alcance declarado (tamén en `CONTRATO.md` §10) |

Tipos de evidencia citados abaixo:

- **V** — `vectors/rust-vectors-v1.json` (sha256 `da09b5b2…e048`, xerado no
  commit `9ec21ac`), consumido por `tests/differential.rs`.
- **R** — referencia independente: `tests/support/windows_engine.rs` (matcher de
  xanelas declarativas derivado mecanicamente de `boards.bml` de bsnes,
  `windows-generated.json` sha256 `b8006d80…3b78`) e a simulación da táboa de
  páxinas de GPGX para SSF2. **Non reutiliza as fórmulas dos perfis.**
- **S** — test de regras do propio perfil (`tests/<perfil>_rules.rs`),
  expectativa escrita a man desde `docs/rex_profiles/addressing/<perfil>.md`.
- **B** — imaxe real do corpus BYOR (`tests/byor.rs`, `#[ignore]`, identidade
  comprobada antes de varrer).

## 1. `md-linear` — cartucho de Mega Drive sen mapper

**A. Validado**

| Comportamento | Evidencia |
|---|---|
| Xanela do cartucho `$000000-$3FFFFF` con espello por máscara `addr & (rom_size-1)` | V, R, S (`rexion_non_rom_clasifican_se_sin_inventar_bytes`) |
| Tres clases de `translate` (ROM / Device / Invalid) e `Invalid` **sen** offset | V, S (`estado_amañado_non_devolve_offset_cero`) |
| `invert` devolve **toda** a lista de aliases en orde crecente; offset inexistente = lista baleira, non erro | V, S (`invert_fora_da_rom_e_lista_baleira_e_los_aliases_crecentes`), propiedade de retradución |
| `read` corta no borde do espello e no fin da xanela; os aliases comparten bytes físicos | V, S (`lectura_enorme_non_reserva_nin_clampa`), `tests/read_semantics_audit.rs::enderezo_do_bus_e_offset_fisico_non_son_o_mesmo_concepto` |
| Clasificación de `$A00000-$A01FFF` (RAM do Z80, `offset = addr & 0x1FFF`), `$A10000-$A1FFFF` (IO), `$A13000-$A130FF` (CartIo), `$E00000+` (WorkRam, `offset = addr & 0xFFFF`) | V, R, S |
| Tamaños binarios en [64KB, 4MB]; calquera outro rexeitado con `unsupported` | V, S (`so_tamanos_binarios_entre_64kb_e_4mb_son_estado_valido`) |
| Enderezos reais da imaxe Sonic (BYOR): offsets e aliases coinciden coa referencia | B |

**B. Política conservadora**

| Decisión | Por que é decisión, non hardware | Evidencia |
|---|---|---|
| Claves alleas no estado **ignóranse** | A referencia auditada (`md-linear.mjs`) míraas ou non: `md-linear` non ten estado de mapper, así que non hai nada que interpretar. Os tres perfis SNES fan o contrario (rexeitan). A asimetría é deliberada e pinada para que un endurecemento futuro sexa un cambio de contrato visible | S (`clave_estraña_en_md_linear_comportase_como_na_referencia`) |
| `rom_size` non binario → rexeitar con nota de normalización (pad `0xFF`), non adiviñar un espello irregular | Unha máscara necesita potencia de 2; padar é responsabilidade da capa chamante e rexístrase na evidencia | V, S |
| `$E00000-$FFFFFF` etiquetado `WorkRam` para toda a faixa, incluída `$FF0000-$FFFFFF` que moitos cartuchos usan como SRAM con batería | Herda a etiqueta da referencia; **corrixila require re-exportar os vectores**, fóra desta rolda. Non se inventan bytes, así que non é un erro de seguridade, só de nome | B (`a_sram_declarada_polo_header_non_e_rom`), `CONTRATO.md` §10 |
| Bus de son do Z80 (`$A04000-$A0BFFF`) e portas do VDP (`$C00000-$DFFFFF`) → `unsupported` | Poderían clasificarse como rexións; non se fai porque non hai nada que traducir | S |
| Lectura que sae da xanela do cartucho remata cun `Segment::Invalid`, **non** cun `Err` (ver §8) | Canal de erro elixido para non reservar memoria proporcional ao `length` | S, `tests/read_semantics_audit.rs` |

**C. Non suportado** — mapeadores Mega Drive de calquera outro tipo (Kosinski-adjacent,
SAM Coupe, Mega CD, TMSS, Everdrive/MegaSD), tamaño real de SRAM/batería,
interleaving, e calquera escritura ao dispositivo (a biblioteca non ten
`write` neste perfil).

## 2. `md-ssf2` — mapper de 512 KB por xanela

**A. Validado**

| Comportamento | Evidencia |
|---|---|
| Oito xanelas de `0x80000`; xanela 0 fixa ao banco 0; `offset = base + (addr & 0x7FFFF)` | V, R (táboa de páxinas GPGX), S |
| Base de xanela `(banco & (mask>>19)) << 19`, alxebricamente idéntica a `(banco << 19) & mask` sen depender dunha envoltura de 32 bits | S (`banco_fora_do_fin_da_rom_espealla_por_mascara_non_e_erro`) |
| Estado inicial = identidade; en 4MB é bijectivo (1 alias por offset) | S (`estado_inicial_e_identidade_e_bixectivo_en_4mb`) |
| Decodificación do rexistrador `w = (addr & 0x0E) >> 1` (bits 1-3 da páxina `$A13000-$A130FF`); `w == 0` sen efecto | V, S (`decodificacion_da_xanela_use_os_bits_1_a_3_da_paxina`, `a_xanela_0_e_fixa_e_a_escrita_non_ten_efecto`) |
| `write_mapper_register` **pura**: devolve estado novo, o recibido queda idéntico | S (`escrita_e_pura_non_muta_o_estado_recibido`) |
| Unha escrita só move a súa xanela: as outras sete seguen byte a byte iguais | S (`ningunha_escrita_move_unha_xanela_non_escrita`, en `tests/ssf2_writes.rs`) |
| `invert` no estado dado, con aliases de bases coincidentes | V, S (`inversion_con_bancos_devolve_tódolos_aliases_en_orde`) |
| `read` **un segmento por xanela**, cortando na fronteira aínda que a ROM sexa continua | V, S (`lectura_corta_por_xanela_a_nda_que_a_rom_sea_contigua`), `tests/read_semantics_audit.rs::a_secuencia_loxica_e_a_fisica_cortan_por_motivos_distintos` |

**B. Política conservadora**

| Decisión | Evidencia |
|---|---|
| Clave `banks["0"]` rexeitada **aínda que o hardware a ignore**: un estado que pide remapear o non remapeable está mal formado | S (`banco_mal_formado_rexeitase_con_unsupported`) |
| Banco escrito máis alá do fin da ROM → **espello por máscara, non erro** (a spec di iso; un `Ambiguous` sería inventar) | V, S |
| Non se emenden corredores físicamente contiguos: a identidade da xanela é parte do observado | V, S, audit |
| `read` de lonxitude descomunal non reserva: avanza por corredores e pecha con `Invalid` | S, audit |

**C. Non suportado** — os demais rexistros do SSF2 fóra da páxina `$A130xx`,
outros mapeadores de Mega Drive, a táboa de páxinas completa do emulador (aquí
simúlanse as 64 entradas que definen o espello, non se emula o resto), e
calquera xestión de *reset* que volva os bancos a identidade: non hai modelo de
*timing*, só de estado.

## 3. `snes-lorom`

**A. Validado**

| Comportamento | Evidencia |
|---|---|
| ROM = metade alta de cada banco, `offset = ((banco & 0x7F)·0x8000 + (a & 0x7FFF)) & máscara` | V, R, S (`rom_e_aritmetica_de_pagina_con_espeello`) |
| WRAM `7E/7F` (`offset = a`), espello WRAM `a ≤ 0x1FFF` e IO `0x2000-0x7FFF` nos bancos de sistema, SRAM `70-7D`/`F0-FF` na metade baixa | V, R, S (`rexions_non_rom_clasifican_se_sin_inventar_bytes`) |
| `invert` = páxina `p`, o seu aliás `p + 0x80` e as equivalencias do espello; `7E/7F` nunca son alias | V, S (`invert_devolve_todos_os_aliases_de_pagina_e_espeello`) |
| `read` **nunca emenda**: corredor ≤ 32 KB e despois `$xxFFFF` ven a metade baixa doutro dispositivo | V, S (`lectura_corta_en_cada_pagina_e_classifica_o_resto`) |
| Metade baixa de bancos `40-7D`/`C0-FF` → `Ambiguous` (snes9x di ROM, bsnes di open bus) | V, S (`metade_baixa_con_a15_desconectado_e_ambiguous_nunca_palpito`) |

**B. Política conservadora**

| Decisión | Evidencia |
|---|---|
| Claves alleas → `unsupported` (LoROM non ten rexistradores; aceptalas sería fingir un estado que o cartucho non ten) | S (`clave_estraña_en_lorom_e_rexeitada_non_ignorada`) |
| `Ambiguous` **existe só neste perfil**: cando as dúas fontes pinadas diverxen, a biblioteca non elixe | V, S |
| Bus pre-check antes de reservar (`cpu_address + length - 1 > 0xFFFFFF` → `Err`) | S (`lectura_rexeita_antes_de_reservar`) |

**C. Non suportado** — DSP1/DSP2/SA1/SuperFX/CX4/S-RTC (as súas xanelas fixas
`40-7D`/`C0-FF` en modo *extended* non se modelan: resólvense co mapa base, o
cal **non** é unha afirmación sobre eses chips), ExLoROM, `map_lorom_offset`,
BS-X, S-RTC, tamaño real de SRAM, e MROM/MM0.

## 4. `snes-hirom`

**A. Validado**

| Comportamento | Evidencia |
|---|---|
| ROM lineal `((banco << 16) + a) & máscara`; bancos `40-7D`/`C0-FF` completos, `00-3F`/`80-BF` só metade alta | V, R, S (`rom_e_lineal_con_mascara_de_tamaño`) |
| SRAM `20-3F`/`A0-BF` en `$6000-$7FFF` con `offset = a & 0x1FFF`; WRAM/espello/IO como en LoROM; reserva `3E/3F/BE/BF` baixos | V, R, S |
| `read` **emende** bancos completos e corta na porta `7E` ou no fin do bus | V, S (`lectura_emenda_bancos_completos_mas_corta_na_metade_alta`, `lectura_reproduce_o_espeillo_en_cada_banco`) |
| **Fórmula de `invert` corrixida** (`rel ∈ [0x8000, 0x10000)` para bancos de metade): a anterior inventaba `start + 0x8000 + rel` | V (vectores **posteriores** á corrección `b952329`), S (`invert_aliases_de_banco_metade_e_completo`, `invert_co_espeello_de_tamaño_un_só_grupo_de_bancos`), control de mutación M1 en `MUTATION-CONTROLS.md` |
| Sen ambigüidade: `Ambiguous` nunca aparece neste perfil | S (`hirom_non_produce_ambiguidade_en_ningun_banco`) |

**B. Política conservadora** — claves alleas rexeitadas; potencias de 2 en
[64KB, 4MB] (máis de 4MB **non** é HiROM, é ExHiROM, e o erro dio); pre-check do
barramento. Evidencia: S (`clave_estraña_en_hirom_e_rexeitada_non_ignorada`,
`so_tamanos_binarios_entre_64kb_e_4mb_son_estado_valido`,
`lectura_rexeita_antes_de_reservar`).

**C. Non suportado** — BBRAM, CX4/SA1 en modo HiROM, SDD-1/D-EPX (descompresión
de datos: os bytes *non* son os do arquivo), BS-X, e a *prosa* "128 KB contiguos"
da WRAM: o que se entrega é `offset = a` por banco, diverxencia de texto
rexistrada en `CONTRATO.md` §10, non "corrixida" por simpatía coa prosa.

## 5. `snes-exhirom`

**A. Validado**

| Comportamento | Evidencia |
|---|---|
| Dúas áreas sobre o mesmo bus: área 2 `0x400000 + (addr mod half2)` (bancos `00-3F` alta, `40-7D` enteiros), área 1 `addr mod 0x400000` (A22/A23 desconectados) | V, R, S (`area_dous_base_catro_megabytes_e_espeello_mod_half2`, `area_una_desconecta_a22_e_a23`) |
| Total en (4MB, 8MB] coa **segunda área** binaria: 5MB e 6MB válidos, 7MB rexeitado | V, S (`so_a_segunda_area_ten_que_ser_potencia_de_dous`), control de mutación M3/M3b |
| `invert` con dúas fórmulas, unha por área (a de área 2 modular) | V, S (`invert_aliases_da_area_una`, `invert_aliases_da_area_dous_co_espeello`) |
| `read` corta na fronteira de **área** (non nunha máscara única) e emenda bancos dentro dela | V, S (`lectura_emende_bancos_e_corta_na_fronteira_da_área`, `lectura_wrap_da_area_dous_no_tamanho_declarado`) |

**B. Política conservadora** — `<= 4MB` devolve "isto é snes-hirom" en vez de
intentar un mapa; `> 8MB` é irremediable nun bus de 24 bits; pre-check do
barramento; imaxe non binaria rexeitada con nota de pad. Evidencia: S
(`clave_estraña_en_exhirom_e_rexeitada_non_ignorada`,
`en_enderezos_fora_do_barramento_non_hai_aritmética`,
`lectura_rexeita_antes_de_reservar`).

**C. Non suportado (e sen evidencia de imaxe real)** — os tres perfis SNES son
**só de fixture**: o corpus BYOR autorizado contén **unha** imaxe crúa (Mega
Drive), así que aquí non hai perna B. Isto é un límite do corpus, non do
deseño. ExHiROM *fóra* do contrato (p. ex. 7MB, ou boards con área 2 non binaria)
erro con `unsupported`, non con bytes.

## 6. Transversal (os cinco perfis)

- **A**: `translate` ten tres clases e o erro nunca é `offset = 0`; `read` devolve
  corredores continuos de offset, non bytes; `invert` devolve aliases, non un
  enderezo canónico; toda a aritmética é `u32`/`u64` explícita sen `unwrap` en
  `src/` (`CONTRATO.md` §9) — probado polo barreiro exhaustivo `#[ignore]` de
  `tests/inversion.rs` (16,7 M de enderezos por perfil).
- **B**: **ningún perfil detecta o seu propio mapa**. Quen elixe `md_linear` ou
  `snes_hirom` é a capa chamante; o tamaño e o banner non deciden. `corpus-identification`
  segue `blocked` nos manifests do produto.
- **B**: rexións non-ROM **clasifícanse, non se rechean** (`DeviceNoBacking` +
  `ErrorCode::Unsupported`); imaxe máis curta que `rom_size` → prefixo real +
  `Segment::Invalid`, **sen clamp**.
- **C**: detección automática, codecs, descompilación, chips especiais,
  escritura, e calquera acceso ao sistema de ficheiros (a imaxe entra como
  `&[u8]`).

## 7. Casos sen modelo independente: consérvase o tratamento explícito

Na columna "referencia independente" de `tests/differential.rs` cada perfil
imprime o reconto executado:

| Perfil | Casos graduados | Sen modelo | Suma (`translate` + `translate_negatives`) |
|---|---|---|---|
| `md-linear` | 29 | 4 | 33 |
| `md-ssf2` | 22 | 9 | 31 |
| `snes-lorom` | 23 | 5 | 28 |
| `snes-hirom` | 21 | 5 | 26 |
| `snes-exhirom` | 28 | 5 | 33 |
| **Total** | **123** | **28** | **151** |

Os 28 *sen modelo* son **todos** `translate_negatives`: ningún caso positivo de
tradución queda sen comparación executada (eses 101 están todos graduados). A
lista literal de motivos imprímaa o propio test (`oracle_cross_check`), non a
documentación.

Non se toca `engine_agree` nin os vectores históricos para facer esa columna máis
bonita: as 12 filas con `engine_agree: false` son un defecto do *exportador* de
vectores (constrúe o seu motor unha soa vez co estado da fixture, polo que
ignora o `mapper_state` propio de cada caso), rexistrado no comentario de
`Reference::for_case` en `tests/harness_selfcheck.rs`.

## 8. Desviación atopada nesta auditoría (e como queda)

`CONTRATO.md` §7 afirmaba, sen calificar:

> `cpu_address + length - 1 > 0xFFFFFF` → `OutOfRange` **antes** de calquera reserva de memoria.

Eso é certo para os tres perfis SNES. **Non** o é para `md-linear`/`md-ssf2`: eses
comproban `cpu_address > 0xFFFFFF` e `length < 1` á porta, e se o percorrido sae
da xanela do cartucho devolven `Ok(...)` cun `Segment::Invalid(Unsupported)` final
(ou `DeviceNoBacking`). A intención do §9 (non reservar proporcional ao `length`)
cúmprese nos cinco; a *letra* do §7 só en tres.

Resolto **estreitando a afirmación**, non cambiando comportamento:

1. §7 di agora onde se comproba cada cousa en cada familia, con test que o fija:
   `tests/read_semantics_audit.rs::a_fronteira_do_barramento_usa_dous_canais_distintos`.
2. A rama `u32::try_from(cursor)` dos dous perfis MD é **non alcanzable**: a
   xanela do cartucho remata en `$3FFFFF`, e o percorrido xa se detén aí con
   `Unsupported` moito antes de que `cursor` poida pasar de `0xFFFFFFFF`. Píñase
   como defensiva para que ninguén a tome por comportamento observable:
   `a_rama_de_esesgo_do_barramento_en_md_non_e_alcanzable`.
3. Compromiso de deseño para a capa de recursos (etapa 2, aínda non implementada
   neste commit): **non** herda a ambigüidade. Valida a fronteira do bus ela
   mesma antes de despachar a calquera perfil, así que os seus consumidores ven
   un só canal de erro. Se esa capa chega e o compromiso non se cumpre, este
   parágrafo queda como falla da rolda.

Un endurecemento futuro dos perfis MD (pre-check como os SNES) é posible e
quebraría *ese* test de auditoría, non os vectores pinados: ningún caso de
lectura dos vectores cruza a fronteira do bus por ese camiño. Queda como
decisión do integrador, non se aplica aquí unilateralmente.

## 9. Matriz resumo

| Perfil | A (validado) | B (política) | C (non suportado) | imaxe real (perna B) |
|---|---|---|---|---|
| `md-linear` | 7 filas | 5 | mapeadores alleos, SRAM real, escritura | si (Sonic, `#[ignore]`) |
| `md-ssf2` | 8 | 4 | resto de rexistros, timing de reset | si (mesma imaxe, `sen_mapper_linear_e_ssf2_identidade_leeen_igual`) |
| `snes-lorom` | 5 | 3 | DSP1/DSP2/SA1/SuperFX/CX4, ExLoROM, BS-X | non (corpus) |
| `snes-hirom` | 5 | 3 | BBRAM, SDD-1, CX4 en modo HiROM | non (corpus) |
| `snes-exhirom` | 4 | 3 | 7MB e área 2 non binaria, > 8MB | non (corpus) |

Recontos executados nesta rolda (non de memoria): 565 entradas nos vectores
pinados (105/133/106/103/118 por perfil, incluídas as 60 mostras de inversión
verificadas de cada un), 151 casos de tradución dos cales 123 graduados contra a
referencia independente, **81 tests rápidos verdes, 0 fallos, 9 `#[ignore]`**
(8 BYOR + 1 barreiro exhaustivo). A clasificación enteira é **Experimental**: non
se promotiona ningunha palabra do roadmap.
