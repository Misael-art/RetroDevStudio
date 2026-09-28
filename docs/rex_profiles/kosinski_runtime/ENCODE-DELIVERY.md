# Entrega ETAPA 5 — Encoder Kosinski + contêiner de edição autoral (frente B)

Data: 2026-09-28 · Branch `codex/rex-kosinski-decoder` · PR #81
Classificação permitida (única): **"Decodificação, codificação e edição de
conteúdo autoral Kosinski verificadas no contrato descrito."**
NÃO reivindicado: identificação/edição na UI do RetroDev Studio, suporte a
Sonic ou ROM comercial, autodescoberta de compressão, modo Kosinski modular.

## 1. O que foi provado (cadeia completa, fora do Rust)

`plain autoral → encode → stream → decode → alteração delimitada →
recompressão → decode EXTERNO (koscmp) → conteúdo editado esperado`, mais a
SIMULAÇÃO de reinserção em slot autoral preservando bytes vizinhos byte a byte
e recusando sem escrita quando não cabe. Evidência auditável:

- `evidence/differential-vs-koscmp.tsv` — 58 linhas: **53 PARIDADE +
  1 DIVERGENCA-CONTRATUAL (m02) + 2 SONDA-DEFEITO (não cotadas) +
  2 CONTROLE-CORRUPCAO**, 0 DIVERGE; rc=0. Direção A (streams de referência →
  decoder do produto) e direção B (streams do produto → oráculo externo, con-
  teúdo completo), incluindo a linha `edicoe-ciclo-decode` que confirma por
  fora o plain editado vindo do contêiner.
- `evidence/encoder-sizes-vs-oracle.tsv` — tabela de tamanhos abaixo.
- Pins do oráculo: koscmp SHA-256 `a74c9295…`, checkout mdcomp commit
  `72c6df40…`; o script ABORTA se divergirem. Toda chamada ao oráculo passa
  por `sandbox.sh` (timeout + ulimits + stdin fechado).
- Determinismo medido em 2026-09-28: duas corridas novas do diferencial
  produziram `differential.tsv` e `sizes.tsv` **byte-idênticos** às evidências
  publicadas (`45e42f7f…` e `7700221f…`), rc=0 nas duas.

## 2. API pública (forma final proposta)

Tudo no crate `rex-kosinski`, puro: sem Tauri, sem dependências externas, sem
filesystem na lógica. Reexportado na raiz:
`rex_kosinski::{decode, encode, KosError, KosDecoded, EncError, KosEncoded,
edit::{build, open, reinsert, SlotInfo, EditError, sha256_bytes, sha256_hex}}`.

```rust
// encode.rs — contrato em ENCODE-CONTRACT.md
pub fn encode(plain: &[u8], max_stream: usize, work_limit: usize)
    -> Result<KosEncoded, EncError>;
// KosEncoded { stream: Vec<u8>, plain_len: usize }
// EncError::StreamLimit | WorkLimit — limites EXPLÍCITOS e separados da
// capacidade do formato (STRATEGY_WINDOW ≠ FORMAT_MAX_DIST no código-fonte,
// fixados iguais por escolha documentada, não por confusão).

// edit.rs — contêiner §9 do ENCODE-CONTRACT
pub fn build(plain: &[u8], slot_cap: usize, max_stream: usize, work_limit: usize)
    -> Result<Vec<u8>, EditError>;
pub fn open(container: &[u8], max_output: usize, work_limit: usize)
    -> Result<SlotInfo, EditError>;
pub fn reinsert(container: &[u8], new_plain: &[u8], max_stream: usize, work_limit: usize)
    -> Result<Vec<u8>, EditError>;
// EditError::Malformed | StreamTooLarge | DecodeFailed | IdentityMismatch | WorkLimit
// Geometria: [8B "REXKOS0A"][u32 plain_len][u32 stream_len][u32 slot_cap]
//            [32B sha256(plain)][slot: stream + 0x00 padding][8B "REXKOS0B"]
// Nunca realoca, nunca conserta ponteiros, nunca muta a entrada; recusa é
// sempre SEM escrita parcial.
```

Limites de trabalho são orçamentos determinísticos (fórmula pinada em
ENCODE-CONTRACT §5: `ABCDEF`→25, vazio→7). P1 pinada:
`decode(encode(p)).bytes_consumed == encode(p).len()` (sem padding na stream).

## 3. Exemplos executáveis

```bash
# ciclo de edição demonstrativo (artefatos + asserções; rc≠0 em qualquer falha):
cargo run --release --manifest-path crates/rex-kosinski/Cargo.toml \
  --example edit_cycle -- /tmp/rex-edit-cycle
# saída: "edicoe-ciclo ok slot_cap=… stream_base=… stream_edit=… host=… bytes"

# encode CLI (mesmo estilo do example decode existente):
cargo run --release --manifest-path crates/rex-kosinski/Cargo.toml \
  --example encode -- <plain.bin> <stream.kos>
```

`edit_cycle` cobre: recusa sem escrita quando excede o slot, geometria
preservada, vizinhos de 4096 B byte-idênticos antes/depois (LCG 0x11112222 /
0x33334444), e identidade divergente recusada no consumidor demonstrativo.

## 4. Tamanhos vs. encoder de referência (koscmp, medido)

| caso | plain | oráculo | produto | nota |
|---|---:|---:|---:|---|
| abcdef | 6 | 12 | 11 | |
| ab_repeat | 800 | 20 | 19 | |
| empty | 0 | 6 | 5 | |
| far_window_40k | 40048 | 1086 | 1085 | |
| near_window_2k | 1680 | 76 | 76 | |
| noisy_runs_16k | 16384 | 1526 | **2084** | limitação da estratégia (§5) |
| odd3 | 5 | 10 | 10 | |
| pseudo_random_8k | 8192 | 394 | 394 | |
| single | 1 | 6 | 6 | |
| text_rep | 6000 | 106 | 105 | |
| tile_like | 8192 | 164 | 163 | |
| zeros_64k | 65536 | 838 | 838 | |

Tamanho do produto ≤ tamanho do oráculo em 11/12 casos; único pior:
`noisy_runs_16k` (+558 B) — consequência da heurística 3-gram + chain-64,
não do formato.

## 5. Limitações registradas (não escondidas)

1. **Estratégia não ótima** (promessa explícita do ENCODE-CONTRACT §1): match
   mais longo sobre índice de 3-grams com chain limitado a 64; casos com
   many-runs ruidosos comprimem menos que o koscmp (tabela).
2. **Contêiner ≠ transação BPS/IPS**: o slot é simulação de reinserção com
   recusa; não produz patch nem toca fluxo de patch existente.
3. **Sem BYOR / sem ROM comercial**: fixtures autorais apenas.
4. **Variante base somente**: modo modular Kosinski fora de escopo.
5. **SHA-256 próprio** (FIPS 180-4, sem dependências) validado contra
   `hashlib` em 3/3 vetores, incluindo 1000×'a' (16 blocos).
6. Early-fetch do decoder espelhado no encoder (regra medida, ENCODE-CONTRACT
   §3 retificado): placeholder obrigatório quando qualquer 16.º bit é emitido
   e há byte seguinte — inclusive o 2.º bit do terminador.

## 6. Proposta de adaptação (para o integrador — NÃO entregue aqui)

- Consumir `encode`/`edit::*` atrás do contrato de codecs de
  `src-tauri/src/rex_resources.rs`: mapear `EncError`/`EditError` para os
  erros estruturados existentes; a transação BPS/IPS atual permanece dona da
  escrita em ROM — o contêiner fornece apenas o ciclo autoral comprovado.
- UI (camada contextual) fica fora desta entrega; nenhuma reivindicação de
  suporte na interface.
- Este pacote fornece API, exemplo executável, tabela de tamanhos e contrato;
  não possui arquivos compartilhados nem manifestos.

## 7. Artefatos e procedência (SHA-256 completos)

Fixtures autorais (criadas nesta missão, procedência: geradores documentados
nos commits `36741a5`/`f3c51f2`):

```
242aa3709ac72780db96b77384d1771695915f7a4bab4946634cb1823560db26  data/rex_profiles/kosinski_runtime/edit/base_plain.bin
324ecaa23fe3a8b35d1f3a2c1a2a4713a48b7652a61bd94a9bb0dbad6636273e  data/rex_profiles/kosinski_runtime/edit/edited_plain.bin
93c5f007220b38ab257456a0e96540d148d4425cf91569dbcdfe6b72685538a4  data/rex_profiles/kosinski_runtime/encdir/lit14_mod16.bin
26828dc7c50bd8560ad3b1b254014fe7d3eea21e54e4f9a945845f832a30f09c  data/rex_profiles/kosinski_runtime/encdir/lit15_straddle.bin
0214f8ff8f7361495befb1e395fab0da8b29388248719b3fb03de39e3ad8f0f0  data/rex_profiles/kosinski_runtime/encdir/sep_pair.bin
```

Código e testes (SHA medidos na HEAD `f3c51f2` + commits desta publicação;
`edit_cycle.rs` reflete a reformatatação `cargo fmt` do commit de ETAPA 6 —
somente quebra de linhas, nenhuma mudança de comportamento):

```
a18fa9fec70f6aa91d42f59b2c38e491ea0c41ccb2d489d9a82dabfdc8634360  crates/rex-kosinski/src/encode.rs
6583b32f7871d281eba93f35f582a4d9d8d4e32d93a4aa4db6ad3a8933f3e4b0  crates/rex-kosinski/src/edit.rs
0f6e09458d0225363b9fa069d695f937de0be1da550ee611614e5b876776820e  crates/rex-kosinski/src/lib.rs
9473f8652f71b8d8195e61343f5a494a685057355564e9ec32cf03c6c6f0c67f  crates/rex-kosinski/tests/encode.rs
f5a7c5b3d7a2fc3006482968e4f8e56089b3e024472aca717f8eda3038ce9705  crates/rex-kosinski/tests/edit.rs
f126e874f50bcc7f26ea13210ec3ce9da00f1786a1da3dd04c63c0bf65162617  crates/rex-kosinski/examples/encode.rs
24ebdead4ca4034dca3095e9d16ea77994d0d8c494dfe3d64d46eac23b67a27c  crates/rex-kosinski/examples/edit_cycle.rs
8bdd2e446e842639517fdfbb7bfecf30bd64d8abc387b5f30506a19e80c90197  docs/rex_profiles/kosinski_runtime/ENCODE-CONTRACT.md
80f53636d07727461aa7f61c8387f2d2cfd012bede375f21ad7e8cdddd2a1b17  scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh
45e42f7f6fc698e38bc67ae8eac4a0794a61f72267b5f0b0f129381dca10cd8c  docs/rex_profiles/kosinski_runtime/evidence/differential-vs-koscmp.tsv
7700221fb36c97794c6d7fd16a112db9abf5cd808ab6802afa7dbd88edd1611b  docs/rex_profiles/kosinski_runtime/evidence/encoder-sizes-vs-oracle.tsv
```

Nota honesta de herança: o SHA de `lib.rs` da entrega do decoder
(`7f70a772…`) mudou para `0f6e0945…` **apenas** pela adição das linhas
`pub mod encode; pub mod edit; pub use encode::{…}` — nenhuma linha da lógica
do decodificador foi alterada (ver diffs de `2b50cab`/`f3c51f2`).

## 8. Regressão local (sem oráculo)

`cargo test` do crate: **49 testes verdes** (22 contrato + 16 encode +
8 edit + 3 mutations). `cargo fmt --check` e `cargo clippy --all-targets
-- -D warnings`: limpos. A suíte normal não exige koscmp instalado.
