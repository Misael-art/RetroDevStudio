# FASE 1 — Inventario do corpus (MISSAO A)

Ferramentas: `scripts/rex_corpus_a/` · Artefacto: `data/rex_corpus_a/inventario.json`
Estado: **Experimental**. Esta fase proba só a normalización e a medição de
imaxes. Non localiza recursos, non valida codecs e non executa xogo ningún.

## 1. Base e territorio

| Item | Valor |
| --- | --- |
| Branch | `codex/rex-corpus-a` |
| Worktree | `/home/misael/RDS-REX-CORPUS-A` |
| Base sobre a que se traballou | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Territorio rastreado | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| Corpus (só lectura) | `/home/misael/emulation/roms/{genesis,megadrive,megadrivejp}` |
| Traballo local (non versionado) | `~/.retrodev/rex_corpus_a_work/` |

Non se escribiu en `src/`, `src-tauri/`, `crates/`, manifests compartidos,
workflows, Memory Bank nin nos ficheiros do axente B. O corpus abre-se só en
lectura: `stage.sh` nunca crea, renomea nin trunca dentro de `REX_CORPUS_A`.

## 2. Reprodución

Un só comando, con log en camino estable:

```bash
REX_CORPUS_A=/home/misael/emulation/roms \
  scripts/rex_corpus_a/inventario.sh
# log -> ~/.retrodev/rex_corpus_a_work/logs/inventario.log
```

A cadea é `inventario.sh` → `stage.sh` → `rex-corpus inventario`. O env
`REX_ROLES` ten por defecto **`desenvolvimento`**: o papel `reservada` é o
*holdout* da Fase 4 e por iso **non** se normaliza nesta fase. Executar con
`REX_ROLES=reservada` é a única maneira de traer o holdout, e queda rexistrado
no log.

Cadea de medição por imaxe:

1. `stage.sh` compara o SHA-256 do contenedor **antes** de ler calquera membro
   (diverxencia = RECUSA, nunca extracción).
2. Limites declarados antes de descomprimir: bytes do contenedor, número de
   membros, bytes por membro e ratio comp/uncomp.
3. Cada membro illado escríbese en `staged/` e rexístrase en
   `proveniencia.tsv` (10 campos: hash, lonxitude, caminho, contenedor, hash do
   contenedor, membro, CRC-32, método, lonxitude descomprimida, papel).
4. `rex-corpus inventario` le os bytes staged e volve calcular hash, CRC-32 e
   lonxitude por conta propia. **Ningún campo do manifesto se copia da
   metadata do contenedor sen ser reculado.**

## 3. Factos medidos

`fontes=5 · inventariadas=5 · refusadas=0 · divercentes=0`.
SHA-256 do manifesto: `1c3aab79a35d54d669c566d2d69b9165322952d22ac3ed34055c059f6b8e2f93`
(reproducido byte a byte en dúas execucións independentes).

| Fonte | Contenedor | Membro | Bytes | CRC-32 membro | Layout | Suma declarada / observada | Lonxitude cabeco / arquivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sonic (USA, Europe) `.bin` | `store` | — | 531 577 | — (copia directa) | Lineal | 57871 / 30221 **DISTINTA** | 525734 / 531577 |
| Sonic …PtBr `.zip` | Defl:N | `….bin` | 531 577 | `1de03238` ✓ | Lineal | 57871 / 30221 **DISTINTA** | 525734 / 531577 |
| Altered Beast …PtBr `.zip` | Defl:N | `….SMD` | 524 288 | `f4572342` ✓ | Lineal | 55062 / 55062 ✓ | 524288 / 524288 ✓ |
| Golden Axe …PtBr `.zip` | Defl:N | `….gen` | 524 288 | `b8239aea` ✓ | Lineal | branca / 60017 | not_measured |
| Rocket Knight …PtBr `.zip` | Defl:N | `….md` | 1 048 576 | `4b6ee8b8` ✓ | Lineal | 354 / 354 ✓ | 1048576 / 1048576 ✓ |

Familias distintas inventariadas: 4 (Sonic, Altered Beast, Golden Axe, Rocket
Knight). A sexta praza do límite de 6 deixouse voluntariamente baleira para o
*holdout* reservado.

### Hallazgos

* **A «tradución» PtBr de Sonic non é unha tradución.** O membro do ZIP é
  idéntico byte a byte ao `.bin` orixinal (mesmo SHA-256 `c7da53a1…`, mesmo
  CRC-32 `1de03238`). O manifesto rexístrao como
  `duplicado_de` + `traducion: "sen_diferenza_de_bytes"`. Etiqueta ≠ contido:
  se se confiase no nome, Fase 2 compararía offsets contra unha revisión que
  non existe.
* **Altered Beast leva cabeco xaponés, non portugués.** `0x120` contén
  `8F 62 89 A4 8B 4C`, que se decodifica en CP932 **e** Shift-JIS como
  `獣王記`. A lectura lossy do Rust marca `texto_perdido=true` e
  `campos_perdidos=["titulo_local"]`; o decodificado fixo aquí cunha ferramenta
  externa, e **non** se versionou como fixture.
* **`.smd` non implica entrelazado.** O membro de Altered Beast ten extensión
  `.SMD` pero o layout **medido** (maxia en `0x100`, non en `0x000`) é lineal.
  `layout.rs` decide polos bytes, nunca polo suffixo; a discordancia queda como
  limitación explícita no manifesto. Non se aplicou desentrelazamento.
* **Golden Axe non ten cabeco.** Só 4 bytes non-espazo en `0x100..0x1FF`
  (`SEGA`). Serial, rexión e os rangos numéricos están en branco. O manifesto
  serialízao como `not_measured`, **non** como valor: os 0x20 de recheo son
  metadata sen inicializar, non un `0` numérico. Unha estimación aquí
  produciría un mapper inventado.
* **Sonic: checksum distinta, e as hipóteses refutadas.** O canon do repositorio
  (suma de palabras BE de 16 bits desde `0x200` ata EOF, byte impar final
  agrupado con 0) dá `30221` fronte aos `57871` declarados. Probase que o
  campo cubrise só o rango declarado en `0x1A4` (`0x805A5`) e tampouco
  (`0x7766`). Tampouco é o complemento a dous de ningunha das dúas
  (`0x89F3` / `0x889A`). Queda rexistrado como **diverxencia medida sen
  explicación**, non como erro da ROM. Consecuencia práctica: en Fase 2 a suma
  non servirá como proba de identidade desta imaxe.
* **Sonic ten 5843 bytes máis alá do rango declarado**, e 5526 deles son
  non-cero: é contido real, non recheo. A orixe desa cola non se determinou.

## 4. Límites: o que esta fase **non** proba

* Non hai base de revisión fixada, polo que `revision` é `desconhecida` en todas
  as fontes e `traducion` é `non_determinable` agás onde se provou identidad
  byte a byte.
* A suma de verificación compárase só contra a imaxe local: **non proba
  procedencia** nin autenticidade.
* CRC-32 do membro reculado proba a integridade da extracción, non que o
  contenedor sexa o que di ser.
* Ningún recurso foi localizado, ningún codec executado, ningún byte escrito.
* `scan`, `verify` e `roundtrip` aínda non están implementados; o CLI sae con
  **2** nestes subcomandos en vez de fingir un resultado.

## 5. Verificación

| Gate | Comando | Resultado |
| --- | --- | --- |
| Árbore | `npm run check:tree` | OK — conforme `docs/08_TREE_ARCHITECTURE.md` |
| Probas | `cargo test --offline` | **54 passed · 0 failed** |
| Formateo | `cargo fmt -- --check` | limpo (exit 0) |
| Lint | `cargo clippy --all-targets -- -D warnings` | limpo |
| Inventario real | `scripts/rex_corpus_a/inventario.sh` | `fontes=5 divercentes=0`, exit 0 |

Reparto das 54 probas: `inventory.rs` 20 · `container.rs` 9 · `json.rs` 9 ·
`mdheader.rs` 9 · `cli.rs` 7. Todos os fixtures son autorais (imaxes sintéticas
constrúidas na proba); ningún byte comercial entra na árbore rastreada.

Controles discriminativos que fallan se o código minte:
diferenza de hash → recusan `hash_diverxente`; lonxitude ≠ declarada →
`lonxitude_membro` false; CRC do membro alterado → `crc32_membro` false;
copia directa → emite `hash_contedor` en vez dun CRC inexistente; campo
numérico en branco → `not_measured`, non un valor.

## 6. Contrato do manifesto

`schema_version: rex-corpus-inventario/v1`. Raíz: `schema_version`, `orixe`,
`inventario` (`completo`/`parcial`), `total`, `inventariadas`, `refusadas`,
`fontes`. Orden de chaves determinista (rai o `json.rs` propio, sen
dependencias), polo que dúas execucións coas mesmas entradas dan o mesmo hash.
Sentinela `not_measured` para todo campo non medido. O manifesto contén
metadatos do cabeco (título, serial, rangos) pero **ningún byte do corpo** da
ROM.

## 7. Entrega á Fase 2

Imaxes con cabeco completo e suma coerente (`Altered Beast`, `Rocket Knight`)
son as candidatas a confirmar identidade antes de localizar recursos. Sonic é a
de maior valor pero ten suma diverxente e cola non explicada: calquera offset
que se tome del debe confirmarse **nella**, non transplantado doutra revisión
nin da súa suposta tradución — que, medido, é o mesmo ficheiro.
