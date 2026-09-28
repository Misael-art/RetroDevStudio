# Adaptación da biblioteca `rex-addressing` ao produto — proposta exacta

**Estado: PROPOSTA. Nada do que hai aqui está aplicado.** Non se tocou `src-tauri/`,
nin IPC, nin UI, nin o `lib.rs` do produto, nin manifests compartidos, nin o harness
principal. O checkout canónico pertence ao integrador. A asinatura da API debe
concertarse antes de estabilizar calquera sinatura pública.

Todo arquivo ou símbolo citado foi lido no canónico o 2026-09-28; as rutas son
realidades verificadas, non suposicións.

## 0. Requisitos que fixa o propio réxistrexo

`crates/registry.json`, campo `regra` (verbatim):

> Compilar e pasar nos gates proprios NAO registra integracao ao produto. O nivel
> backend-integrado exige, na ordem: dependencia por path em src-tauri/Cargo.toml
> (sem criar workspace na raiz), adaptador no backend e uma chamada real testada
> pelo backend.

Son tres pasos, con esa orde. Esta proposta os enumera nesa orde e non reclama o
nivel `backend-integrado` mentres non estean os tres executados **e** medidos.

## 1. Paso cero: localización e receita de aplicación

- Tronco actual: `crates/rex-addressing/` (promocionado polo integrador desde
  `scripts/rex_profiles/addressing_runtime/rex-addressing/`, segundo
  `registry.json → pacotes[rex-addressing].origem`).
- A miña rama `codex/rex-rust-addressing` entrega en
  `scripts/rex_profiles/addressing_runtime/rex-addressing/` porque a promoción é
  acción do integrador, non da fronte A.
- Receita de aplicación, por entrega: `git cherry-pick -x <sha>` de cada commit da
  rama (nunca merge), e despois o mesmo movemento de ruta xa aplicado na promoción:
  `scripts/rex_profiles/addressing_runtime/rex-addressing/` → `crates/rex-addressing/`.
  Os commits novos desta rolda son tres (`57e51d3`, `58a06dd`, `f9c1913`) máis os da
  ETAPA 4 e 5; os tres primeiros xa entraron no tronco, de modo que **o que falta por
  aplicar son os da capa de recursos** (`src/resource.rs`, os dous arquivos de testes,
  `examples/` e estes documentos).
- O paquete é relocable: non le `data/` nin corpus externo (a diferenza de
  `rex-kosinski`); os vectores pinados viven dentro del. Polo tanto o movemento de
  ruta non cambia ningún teste.

## 2. Paso un: dependencia por path, sen workspace

Non hai workspace na raiz do canónico (`Cargo.toml` non existe; o package é
`retro-dev-studio`, lib `app_lib`, `src-tauri/Cargo.toml:1-9`). Non crear un.

```toml
# src-tauri/Cargo.toml, sección [dependencies]
rex-addressing = { path = "../crates/rex-addressing", package = "rex-addressing" }
```

- O crate non ten dependencias (`crates/rex-addressing/Cargo.toml [dependencies]` e
  `[dev-dependencies]` baleiros). Non entra **ningunha** dependencia nova no
  `Cargo.lock` do produto, o cal honra a regra de non engadir dependencias.
- Non activar features: o crate non as ten.
- Consecuencia que o integrador debe aceptar: `cargo audit` sobre o bloque novo é
  trivialmente limpo (sen terceira man de obra), pero o lock cambia e o gate
  `npm run security:audit` debe re-executarse el, non eu.

## 3. Paso dous: adaptador no backend

Arquivo novo, un só, para que a crate siga sen serde e sen filesystem:

`src-tauri/src/tools/reverse/addressing_adapter.rs`

### 3.1 Que bytes se lle entregan (o punto sutil)

`rex_read_rom` (`tools/reverse/loader.rs:99`) devolve **bytes brutos**, non
normalizados. Os perfis asumen a imaxe lineal do cartucho, así que o adaptador debe
normalizar antes de traduzir enderezos:

```rust
let (identity, raw) = rex_read_rom(&path)?;
let (_variant, normalized) = platform::identify_md(&raw)?;      // loader.rs:39 usa o mesmo
if sha256_hex(&normalized) != identity.normalized_sha256 {      // core/rom_mastering.rs:327
    return Err("bytes normalizados non coinciden coa identidade".into());
}
```

Ese espello de hash é o padrón que o produto xa emprega en
`rex_undo_normalization` (`loader.rs:120-130`): comparar contra a identidade antes
de usar os bytes. `sha256_hex` é `pub(crate)`, logo o adaptador chámao directamente e
**non** se engaden `sha2` nin `ring`.

### 3.2 Identidade da imaxe

`ImageIdentity` (crate) ten tres campos. Proposta de enchido:

| campo | valor | por que |
| --- | --- | --- |
| `origin` | `byor://<original_sha256>` | inmutable, citábel, sen ruta do usuario (a crate recusa `origin` baleiro: `bad-attestation`) |
| `sha256_hex` | `identity.normalized_sha256` | é o hash **da imaxe que se traduce**; minúsculas hex, que é o que a crate valida (64 díxitos `[0-9a-f]`) |
| `byte_len` | `normalized.len()` | a crate comproba que coincida cos bytes entregados |

Non usar `original_sha256` como `sha256_hex`: nun dump `.smd` intercalado serían
dous mundos distintos e a procedencia deixaría de reconstruír a saída byte a byte.

### 3.3 Estado do mapper: explícito, nunca deducido

A crate pide `&MapperState` (BTreeMap de claves → `Value`). O adaptador constrúeo con
política conservadora e **sen autodedección** (fora do obxectivo da entrega):

- `rom_size` ← `normalized.len()`, sempre.
- `banks` ← só cando o chamador pasou un perfil `md-ssf2` cunha táboa explícita de
  `(xanela, banco)`; en calquera outro perfil a clave non se escribe.
- Se o chamador pide un perfil con rexistradores que a crate non soporta para ese
  perfil, a propia crate recusa (`bad-state`); o adaptador non o disfraza.

### 3.4 Erros

`ResourceError` xa imprime o código estable como primeiro token
(`bad-attestation: … (en 0x…) rexión io`). Dous niveis:

- sinatura interna do adaptador: `Result<ReadReporte, ResourceError>` (non perdemos nada);
- frontada IPC: `Result<Dto, String>` co `to_string()` do erro, que preserva o código
  como prefixo. **Non** aplanar a `ok`+`message` sen o código: a UI precisa
  distinguir `incompatible-size` de `non-rom-region` para explicarllelo a quen mira.

### 3.5 DTO

O serde vive no adaptador, non na crate. Campos mínimos para non perder procedencia:

```text
perfil, contract_version, origen, sha256_imaxe, bytes_imaxe,
estado (mapa serializado), cpu_enderezo, lonxitude,
segmentos[{ indice, cpu_enderezo, cpu_lonxitude, rom_offset, rexión }],
bytes_sha256            // hash dos bytes devoltos, non dos da imaxe
```

`segmentos` é o campo que xustifica a existencia da capa: reconstrúe byte a byte a
saída sen volver chamala (`rom_offset` + `cpu_enderezo` + `cpu_lonxitude`), e é o que
permite detectar un banco equivocado sen ler a documentación da crate.

## 4. Paso tres: unha chamada real, testada polo backend

Só un comando para empezar (a superficie de bancos queda para despois, se o integrador a
quere):

```rust
#[tauri::command]
async fn rex_addressing_read(
    rom_path: String,
    profile_id: String,
    cpu_address: u32,
    length: u32,
) -> Result<tools::reverse::addressing_adapter::ReadReporte, String> {
    run_heavy_result_command("rex_addressing_read", move || {
        tools::reverse::addressing_adapter::ler_recurso(&rom_path, &profile_id, cpu_address, length)
    })
    .await
}
```

- `run_heavy_result_command` é o envoltorio que o produto xa usa para as cinco
  `rex_resource_*` (`lib.rs:435`, e `lib.rs:2445-2517`).
- Rexistro en `generate_handler` (`lib.rs:5160-5164`): acción do integrador.
- Chamada real testada polo backend: un `#[test]` en `app_lib` que vaia polo
  adaptador cunha fixture autoral do propio repo (a mesma xerada por
  `tests/support/banked.rs`), non con corpus BYOR. O test debe asertar `bytes`, o
  `rom_offset` do segmento e o hash da lectura; así o gate do produto demostra a
  cadea completa identidade → tradución → bytes.
- UI: non forma parte desta proposta. mentres non haxa fluxo pola interface, o nivel
  `fluxo-do-usuario-comprovado` segue sen tocar.

## 5. Límites que o adaptador debe manter en voz alta

A crate **non** fai iso, e o adaptador non debe simular que o fai:

- Autodedección de mapper nin de perfís. Perfil e estado entran polas mans do chamador.
- Identificación automática de recursos de calquera xogo (iso é `rex_resources.rs`,
  outra capa, con outros contratos).
- Chips especiais SNES (`SA1`, `DSP`, `C×4`, obxectos, DMA): non modelados; calquera
  lectura que os crucen debe recusarse ou etiquetarse, non resolver.
- ExHiROM fóra de 5/6/8 MB: recusa explícita (`incompatible-size`), non reintentos.
- Escrita de recursos: a capa de enderezamento le e traduce; non escribe. A edición
  do produto segue en `rex_resource_apply_edit`, que revalida `expected_rom_sha256`.
- Escrita de rexistradores SSF2 pola IPC: `read_sequence` existe na crate, pero se
  o integrador non a quere exposta, non se expón; non hai razón para que a interface
  poida cambiar de banco antes de que haxa un fluxo que o necesite.

## 6. Pendente de asinatura (preguntas concretas para o integrador)

1. Nomes e idioma dos campos do DTO: o produto usa camelCase inglés no IPC actual?
   Prefiro copiar o voso padrón, non inventar un.
2. `Result<Dto, String>` con código prefixado, ou `ok`+`message`? A capa perde
   información se o código non sobrevive.
3. Exposición de `read_sequence` na primeira entrega (recomendo: non).
4. Se se engade serde **na crate** (recomendo: non; mantela sen dependencias e con
   DTO no adaptador).
5. Orixe do perfil/estado na UI real: selección explícita do usuario, arquivo de
   perfil, ou herdado de `RexRomIdentity`? Calquera das tres é válida para a crate;
   a que elixades fixa o contrato do adaptador.

## 7. Rexistros e clasificación

- `crates/registry.json → rex-addressing`: `maturidade` só pasa a
  `backend-integrado` cando os tres pasos estean executados e medidos, e o `nao_alega`
  debe reescribirse para dicir o que **si** se alega: un punto de lectura, cun perfil
  escollido a man, sobre unha imaxe autoral.
- A clasificación do produto segue **Experimental**, limitada aos perfis
  demostrados (`docs/rex_profiles/addressing_runtime/CLASSIFICACION.md`).
- Sugerencia de texto para o Memory Bank, non aplicada desde esta rama: rexistrar a
  entrega como "capa de lectura de recursos con procedencia, sen integración" mentres
  non se apliquen os pasos 2-4.
