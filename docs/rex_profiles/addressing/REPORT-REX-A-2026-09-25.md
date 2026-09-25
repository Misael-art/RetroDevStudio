# Informe REX — Agente A: perfiles de endereçamento + inventario de corpus

Fecha: 2026-09-25 · Branch: `codex/rex-a-addressing` · BASE: `0d8c413`
Propiedad: `scripts/rex_profiles/addressing/`, `data/rex_profiles/addressing/`,
`docs/rex_profiles/addressing/`. Nada fuera de estos directorios fue tocado.

## 1. Perfiles entregados (5/5)

| Perfil | Tests | Casos pinados (pos/neg/invert/read/otros) | Fuentes fijadas | Cadena de commits |
|---|---|---|---|---|
| `md-linear` | 12 | 22 / 11 / 5 / 7 / — | Genesis-Plus-GX@`939ce4f` (license no comercial, solo consulta; cero lineas transcritas) | `7452dc3`→`e070d5a`→`8130640` |
| `md-ssf2` | 13 | 18 / 13 / 9 / 11 / 15 (registro) | mismas fuentes + ventanas/registro SSF2 mapeados a mano contra la spec | `3fb0ff9`→`bf79daa`→`5f7b217`→`eb09e39` |
| `snes-lorom` | 8 | 18 / 10 / 8 / 10 / — | bsnes@`7d5aa1e` boards.bml + snes9x@`1bcc369` memmap.cpp (solo consulta; licencias GPL-3.0 / Snes9x no comercial; cero lineas transcritas) | `c9a80c3`→`2a16914`→`2a03a9c`→`81ebca7`→`bddf0b2` |
| `snes-hirom` | 8 | 18 / 8 / 7 / 10 / — | mismas fuentes (map_hirom:2521-2534, Map_HiROMMap:3101-3119) | `08f0f87`→`37b608b`→`b068700` |
| `snes-exhirom` | 9 | 25 / 8 / 13 / 12 / — | mismas fuentes (Map_ExtendedHiROMMap:3120-3128, boards.bml:706-720) | `4265c98`→`436459d`→`50b83b7` |

Suite completa (fase 1): **50 tests, 50 pasan, 0 fallan** (`node --test
scripts/rex_profiles/addressing/`); tras a fase 2, 89/89 — ver sección 4.

Garantías de método (contrato v1, `docs/rex_profiles/CONTRACTS.md` +
`7db9da4`):

- Expectativas pinadas ANTES de cada implementación, con `pinning_history` y
  SHA-256 del archivo de expectativas registrado en la evidencia
  (`data/rex_profiles/addressing/<perfil>/evidence/translate-fixture.json`).
- Calculadoras independientes derivadas solo de la FÓRMULA de la spec
  (invert por fuerza bruta sobre las 16M direcciones del bus, read byte a
  byte) validaron los literales antes del pin; dos errores propios de
  transcripción fueron cazados así antes de commit (`81ebca7`, pre-pin
  exhirom).
- Tests discriminan fórmula equivocada (LoROM↔HiROM↔ExHiROM, swap de áreas),
  endian (checksums/offsets BE), estado errado (registro SSF2, `rom_size`,
  claves extra) y errores estructurados (nunca offset 0, sin `panic`).
- Fixtures autorales (patrones por banco, SHA-256 inmovilizados); ROMs
  comerciales no se usaron en ningún test.

## 2. Límites declarados (no es soporte general)

- `corpus-identification: blocked` en los cinco manifests: ningún perfil
  detecta el mapa de una ROM real; la detección (p. ej. puntuación
  LoROM-vs-HiROM de snes9x `Score*ROM`) queda como hipótesis de inventario.
- No modelados: ExMMD/MBD-512-extra, chips de oclusión (DSP1/2, SuperFX,
  SA1, CX4, SPC7110, BS-Cart), SRAM grande, DMA BWE/BWB, Game Genie,
  cabeceras .fig/.gd3, MBD con registros no documentados.
- Prueba sintética ≠ prueba en juego real: los fixtures son la especificación
  ejecutable, no evidencia de comportamiento en hardware.

## 3. Inventario ligero del corpus autorizado (`corpus-inventory-2026-09-25.json`)

Solo lectura: sin extracción a disco, sin copia de ROMs; los miembros de
archive se listan (`unzip -l -v` / `7z l -slt`) y las cabeceras se leen por
tubería (`unzip -p`/`7z x -so | head -c 68KB`) únicamente para señales.

Alcance: 10 directorios MD/SNES de `/home/misael/emulation/roms`
(`sfc snes sneshd snesna sufami satellaview genesis megadrive megadrivejp
genesiswide`). Total corpus completo leído: 9059 archivos / ~167 GB; el
alcance inventariado: **256 archivos / ~3.8 GB**, sha256 por archivo.

| Clase | n | Nota |
|---|---|---|
| `header-signal` | 190 | banner SNES en 0x7FC0/0xFFC0 (±512 SMC) o cabecera MD "SEGA" en 0x100 leída; map_bits declarados: nibble 2 (LoROM) 33, nibble 3 (HiROM/ExHiROM) 81 — **hipótesis de cabecera, no prueba de mapa** |
| `no-banner-in-sniff-window` | 31 | dumps >32KB sin banner en la ventana de 68KB (candidatos ExHiROM/Unl/SD-board; escaneo profundo fuera del alcance ligero) |
| `document` | 31 | txt/.directory de EmuDeck |
| `out-of-scope-32x-cd` | 2 | Doom/MK2 "MD+" son paquetes 32X+CD: fuera de los perfiles MD lineales |
| `misplaced-other-platform` | 1 | 7z en `sfc/` que contiene un `.nes` |
| `no-rom-content` | 1 | `Super Mario World (USA).zip` = placeholder sin ROM |

Brechas registradas: sufami/satellaview/megadrivejp/genesiswide están vacíos
(solo metadata); 4 archivos sin miembro ROM; snesna pesa 2.9 GB (hacks MSU1
con audio — el `.sfc` interno es candidato a datos appended, sin verificar
en modo ligero).

## 4. Fase 2 — comparación executábel independente (directiva: "duas
calculadoras derivadas da mesma fórmula podem repetir o mesmo erro")

Referencia obtida **sen tocar os perfis** (`scripts/rex_profiles/addressing/crosscheck/`,
commit `1d3f1f0`, 27 testes):

- Motor de xanelas declarativas: `windows-generated.json` (sha256
  `2de90492ed92066eb524f83f9985d84ada97e80987ff2705d554b14f86b115fa`) xerado
  mecanicamente do `boards.bml` cru de bsnes@`7d5aa1e` (sha256 do input
  reverificado byte a byte: `b8006d805bef610bb527a486e8b576d48531e6afd94fce7083d3ca9eb553b378`);
  primitivas `Bus::reduce`/`Bus::mirror` reimplementadas a partir da
  descrición de `memory.cpp:63-65`/`memory-inline.hpp`, non do perfil.
- Rexións internas como DATOS coa cita de orixe (snes9x@`1bcc369`
  memmap.cpp, GPGX@`939ce4f`, bsnes boards.bml), terceira representación
  distinta das if-cadeas dos perfis.
- Simulación da táboa de páxinas GPGX para SSF2 (reloxes independentes do
  estado do perfil).
- Comparacións: (1) todos os vetores pinados; (2) fuzz determinista con
  semente incluíndo marxes de fronteira; (3) **enumeración exaustiva dos
  16.777.216 enderezos do bus** vs `invert` analítico; (4) segmentación de
  `read` byte a byte; (5) 150 secuencias aleatorias de escrita de rexistro
  SSF2; (6) exclusións SNES (7E/7F nunca alias; reservas 3E/3F/BE/BF).

**Hallazgo real (o método cumpriu o seu propósito):** o `invert` de
`snes-hirom` tiña unha fórmula errada. Os literais pre-pin validaran contra
unha calculadora que derivaba da **mesma** fórmula da spec → mesmo erro
confirmado empiricamente. Corrección en `b952329` (`rel = (offset −
(banco<<16)&mask) & mask`; bancos de metade alta: alias se `rel ∈
[0x8000,0x10000)`; bancos completos: `rel < 0x10000`; 7E/7F excluídos),
verificada por forza bruta por tamaño (64KB…4MB, todos os offsets, 0 fallos).
Os 4 casos `invert_cases` afectados re-pináronse con nota de revisión
(`revision_2026_09_25` en cada caso + `pinned_before_implementation_note`;
novo sha do arquivo `19e8deea10970179593804428fd92b638ed862cb233f0ecbc3c202b9ae7628ac`,
15683 bytes; histórico con sha antigo `6fb5ebac…` marcado "substituído";
spec `snes-hirom.md` e evidencia actualizadas). Preservar vs. rectificar
resolveuse a favor da verdade factual, coa cadea de evidencia completa.

Suite tras fase 2: **89 testes, 89 pasan, 0 falan** (50 perfis + 27
crosscheck + 8 casos reais + 4 integridade de vectores).

## 5. Casos reais autorizados (lectura dirixida, sen inventario novo)

Verificador determinista `scripts/rex_profiles/addressing/real_cases/verify.mjs`
(commit `6915a91`); evidencia en `data/.../<perfil>/evidence/real-case.json`;
testes con skip se o corpus non está presente. Política: só lectura, sen
extracción a disco, membros lidos en memoria con `unzip -p`; nada de ROMs no
repositorio — só hashes, enderezos e hashes de fragmentos.

| Perfil | Caso | Contêiner sha256 | Membro ROM sha256 | Paridade motor≡perfil | Aliases byte a byte |
|---|---|---|---|---|---|
| `md-linear` | Sonic 1 (USA,Eu) `.bin` | `c7da53a1…c81ebb` (sen contêiner: membro = ficheiro) | mesma | 6000 mostras, 0 mism | 12000 lecturas, 0 mism |
| `md-ssf2` | SSF2 (USA) `.zip`→`.bin` | `75932b70…0850` | `eaf902ab…1271` (5MB, pad 0xFF a 8MB rexistrado) | 6000+3000 (con banco trocado), 0 mism | 0 — a identidade SSF2 non ten aliases (esperado; duplicación cuberta no crosscheck) |
| `snes-lorom` | Metal Jack (Japan, Trad En) `.zip`→`.sfc` | `73d66d8d…d903` | `3a1b64d7…0881` (1MB) | 6000, 0 mism | 11908 lecturas, 0 mism |
| `snes-hirom` | Chrono Trigger (USA) `.zip`→`.sfc` | `1ae09131…f37f` | `06d1c2b0…29a9` (4MB) | 6000, 0 mism | 4469 lecturas, 0 mism |
| `snes-exhirom` | **fixture-only explícito** | — | — | — | — |

- **Header como hipótese, confirmación externa + comportamental**: Sonic
  banner "SEGA MEGA DRIVE" en 0x100 + espellado linear medido (195 pares
  A/A+0x80000/A+0x280000 idénticos). Metal Jack: `$FFD5=0x00` (nibble baixo
  0 = LoROM; o banner en 0xFFC0 está vacío, coherente con LoROM) + banner
  visible nos bancos 00/40/80/C0 da metade alta co mesmo offset
  (discriminación comportamental LoROM-vs-HiROM) + referencia
  superfamicom.org ("ROM Bank LoROM, 8 Mb").
  Chrono Trigger: `$FFD5=0x31` (nibble baixo 1 = HiROM; sneslab: nibble alto
  = velocidade, baixo = mapa) + superfamicom.org ("ROM Bank HiROM, 32 Mb") +
  banner en 00/40/80/C0.
- **SSF2 — estado de rexistradores + troca de banco verificable** (item 3):
  escrita `0x12` en `0xa1300a` → `banks{5:18}` → base
  `(0x12<<19)&(8MB−1)` = `0x900000 & 0x7FFFFF` = `0x100000` → probe `0x292345` → offset `0x112345`
  (perfil ≡ motor GPGX ≡ bytes reais do ficheiro, sha do fragmento
  `f38455ab…17fba33`, `bytes_igual_ficheiro: true`).
- **ExHiROM fixture-only** (item 4): os únicos membros >4MB con sinal de
  header usan chips de fábrica (Star Ocean / Seiken Densetsu 3) ou SPC7110
  (Tales of Phantasia / Dragon Quest III — `$FFD5&0x0F==5` é hipótese
  **refutada** por referencia externa; Super Metroid rexeitado como caso
  HiROM por ser tabo SPC7110; Chrono Trigger+ MSU1 rexeitado). Os 31
  ficheiros sen banner **non** se clasificaron automaticamente (directiva
  honrada); candidatos examinados quedan rexistrados no `real-case.json`.
- Normalizacións rexistradas, non ocultas: apêndice "ESE_S1_TC_V_2.00" (7289
  bytes) fóra do `rom_size` de Sonic; pad 0xFF do membro SSF2 5MB→8MB.

## 6. Vectores diferenciais para a implementación Rust (item 5)

`data/rex_profiles/addressing/differential/rust-vectors-v1.json` (commit
`9ec21ac`) — sha256 `da09b5b2e84aeac4a95ee02fa6cc8fb6e77aa6a43ecce77a010d3082d741e048`,
183184 bytes, `contract_version: 1`, determinista (exportador
`differential/export-vectors.mjs`). Por perfil contén:

- `translate` completo dos casos pinados (positivos con `expect` e campo
  `engine_agree` do segundo motor; negativos con código de erro);
- `invert_cases` pinados + 60 mostras por perfil (`invert_samples_exhaustive_verified`)
  cuxa lista de aliases foi verificada por enumeración exaustiva do bus;
- `read_cases` con `expect_segments` e `bytes_hex` (≤32B por segmento) de
  **fixture autoral** — o JSON inclúe `fixture_prng_spec` (xorshift32 por
  bloque, seeds por perfil) para que Rust recree os mesmos bytes; sha256 do
  fixture por perfil; sen ROMs comerciais no ficheiro;
- SSF2: 12 secuencias de escrita de rexistro (estado inicial → `expect_banks`
  → probes nas 8 xanelas) + os casos pinados de rexistro;
- `real_case_pointers` ás evidencias de caso real (identidade de membro ≠
  identidade de contêiner).

Teste de integridade `rust-vectors.test.mjs` (4/4): fixture sha ≡
reconstrución; cada vector ≡ saída actual do perfil; replay de read co
mesmo truncado (`rom_short_by`) co que se exportou; secuencias SSF2 ≡
perfil. O integrador pode usar o JSON sen executar Node.

## 7. Límites da fase 2 (engadir aos da sección 2)

- Caso real N=1 por perfil; a paridade motor≡perfil é mostral (6000/3000
  enderezos con semente fixa), non exhaustiva sobre os datos reais; a
  enumeración exhaustiva execútase sobre fixtures, non sobre ROMs comerciais.
- `md-ssf2` en caso real: xanela de identidade sen aliases (esperado por
  deseño: as 8 xanelas cubren bases mutuamente excluíntes);
  a troca de banco verificouse cunha escrita, non cun programa emulado.
- Os bytes reais lidos do corpus só se comparan/hashan en memoria; ningún
  fragmento ROM acaba no repositorio (só sha256 de fragmentos).
- O crosscheck compara rexións sen respaldo (wram/io/sram) só como clase
  "unbacked": os seus offsets son convención do perfil, non tradución ROM.
- Os vectores Rust reflicten o contrato v1; se o integrador cambia a
  semántica de erro/segmentos, re-xerar co exportador (determinista).

## 8. Siguiente paso (para el integrador)

- Revisar/mergear esta rama sobre la base acordada
  `codex/rex-integrator-profiles-codecs` (el agente A no hace merge).
  Commits da fase 2: `359395a` (COORDINATION), `1d3f1f0` (crosscheck),
  `b952329` (fix hirom invert), `6915a91` (casos reais), `9ec21ac`
  (vectores diferenciais) + docs.
- Consumir `data/rex_profiles/addressing/differential/rust-vectors-v1.json`
  (sha256 `da09b5b2…1e048`) para o teste diferencial da implementación Rust;
  non fai falta Node.
- Desambiguar la sesión duplicada documentada en `COORDINATION.md`
  (archivos underscore/`MD_LINEAR.md` de otro executor ya no están en el
  árbol; la historia de commits los menciona).
- Si se quiere desbloquear `corpus-identification`: ventana de verificación
  pesada (escaneo de banners en bancos altos + comparación con tablas de
  placas conocidas) — fuera del presupuesto de esta ronda.
- Nota para `docs/06_AI_MEMORY_BANK.md` (se propone, no se edita por
  propiedad): rodada REX-A fase 2 — crosscheck executivo independente
  cazou e corrigiu un `invert` de HiROM incorrecto nos vectores pinados
  (re-pin documentado en `19e8deea…`); 4 casos reais con identidade
  membro≠contêiner; ExHiROM queda fixture-only; suite 89/89; vectores
  diferenciais `rust-vectors-v1.json` dispoñibles para Rust.
