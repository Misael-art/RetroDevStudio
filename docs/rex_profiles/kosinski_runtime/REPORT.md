# Relatório de entrega — decodificador Kosinski em Rust (`crates/rex-kosinski`)

**Data:** 2026-09-27 · **Frente:** B (ferramenta REX) · **Branch:**
`codex/rex-kosinski-decoder` @ worktree `REX-KOSINSKI-DECODER-2026-09-27`,
base registrada `9b2389d27c4945c2e13d4344d0ad4e341c784861`
(`codex/rex-b-codecs`, PR #79 — nada mesclado por esta frente).

**Classificação permitida (única):** *Decodificação Kosinski verificada no
contrato e corpus descritos.* Nada além disso é alegado: não há edição
Kosinski, reinserção, suporte geral a Sonic, cobertura de todas as variantes,
modo modular ou descompilação universal.

## 1. O que foi entregue

| Artefato | Papel | SHA-256 |
|---|---|---|
| `crates/rex-kosinski/src/lib.rs` | decoder (decode puro, sem deps, sem Tauri, sem FS) | `7f70a772b611af68af8a8bc2bd9db4c8e6be404348ce697c2b355e3b11f156d8` |
| `crates/rex-kosinski/tests/contract.rs` | 21 testes de contrato (goldens, plains, negativos, bordas) | `c43f4d1c394930024562ef88eac4a5daab42c60f8f3c2415548d8b38e7ac7753` |
| `crates/rex-kosinski/tests/mutations.rs` | 3 testes (truncamento sistemático, mutação com seed, negativo discriminativo) | `97476a1868237cdfc6fd90ea2a4d00e1d010b6f49164f1187faff24f5ca50b4c` |
| `crates/rex-kosinski/examples/decode.rs` | CLI de modo diferencial (usado só pelo script do oráculo) | `b7d3698218d11ecc5e3af6d9dcecf5c2e3d14d05002780e2b85da1cc66e3e508` |
| `docs/rex_profiles/kosinski_runtime/CONTRACT.md` | contrato v1 fixado ANTES da implementação | `3062965930ceeaa423d2718fe9b3a929df9d4c4ce2db51b294e66002e3b5798f` |
| `data/rex_profiles/kosinski_runtime/overlap_echo.kos` + `.expected.bin` | fixture autoral desta frente (eco sobreposto; expectativa derivada do contrato, confirmada pelo oráculo) | stream `ffde8de70ee9a51823cc9ce07a9062c684ab606a7e5aa4c237b98c582c2b7a53`; saída `7b346904f63cc07f1d8cc2d88d7dae08a3f088a0e4159d5214c27a6571a51eb4` |
| `scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh` | comparação externa isolada por sandbox (timeout + ulimit) | `559fb82be5816ff4286d1783d14f2a93b6691f949af7c34e3892553a87e95d9c` |
| `docs/rex_profiles/kosinski_runtime/evidence/differential-vs-koscmp.tsv` | evidência da última execução diferencial (60 linhas) | `8087d6ee072d6dfbb9607c37897ca403138f7bb8433601f5423623ff7bfab236` |

Manifesto do pacote é exclusivo (`data/rex_profiles/kosinski_runtime/manifest.json`);
nenhum manifesto compartilhado, `lib.rs` do produto, módulo de codec, IPC, UI,
harness E2E, Memory Bank, Current Wave ou ROUND_STATE foi alterado.

## 2. API e chamada com limites

```rust
use rex_kosinski::{decode, KosError};

let stream: &[u8] = &std::fs::read("recurso.kos")?;
let d = decode(stream, /*max_output*/ 4 * 1024 * 1024, /*work_limit*/ 64 * 1024 * 1024)?;
// d.output          : bytes decodificados (<= max_output, garantido)
// d.bytes_consumed  : posição exatamente após o terminator; padding/dados
//                     seguintes NÃO são consumidos (bytes_consumed <= stream.len())
```

Erros estruturados (`KosError`): `Truncated`, `InvalidReference`,
`ExcessiveOutput`, `WorkLimit`, `EmptyInput`. `Err` nunca devolve bytes
parciais. Orçamento de trabalho determinístico: 1 unidade por bit de
descritor, 1 por byte de input lido, 1 por byte escrito — timeout externo
não o substitui. Nenhuma leitura de filesystem, relógio ou aleatoriedade
dentro do decoder; aritmética validada antes de indexar/alocar.

## 3. Matriz de cobertura (token / borda / erro)

| Elemento do contrato | Cobertura | Resultado |
|---|---|---|
| literal (bit 1) | m01, m02*, plains `single`/`abcdef`/`odd3` | ok (m02 = exceção contratual, `Truncated`) |
| inline `0,0` (len 2..5, dist=0x100−d, d=0→256) | m03, m07 (dist==histórico), k04 | ok |
| separado 2 bytes `0,1` Count3≠0 (len 2..9) | m04, `ab_repeat` | ok |
| separado 3 bytes c≥2 (len até 256, dist até 8192) | m05, m08, far_window/near_window | ok |
| terminator c==0 (para AÍ; trailing intacto) | todos os goldens/plains + medição de padding (§6) | ok |
| quirk `c==1` continue (consome, não copia) | m06 | ok |
| cópia sobreposta byte a byte (eco) | `overlap_echo` (autoral), `noisy_runs_16k` | ok — confirmada pelo oráculo |
| EARLY FETCH (fetch no pop do 16º bit) | m09, m10, far_window, k05 + controle de mutação (§5) | ok |
| descriptor atravessando borda de 16 bits | m10 | ok |
| input vazio | `EmptyInput` | ok |
| input 1 byte (descritor incompleto) | `Truncated` | ok |
| EOF após literal sem terminator | k01, m02 → `Truncated` | ok |
| EOF no meio de separado (faltam Low/High) | k02 → `Truncated` | ok |
| referência antes do 1º byte escrito | k03, sonda `02 00 FF FF` → `InvalidReference` | ok |
| dist inline além do histórico | k04 → `InvalidReference` | ok |
| saída > max_output em stream BEM-FORMADA | k05 (512 bytes, max_out=16) → `ExcessiveOutput`; com max_out=512 → `Ok` consumed=296 | ok |
| work_limit mínimo | orçamento 16 → `WorkLimit`; 17 → `Ok` (fronteira exata medida) | ok |
| limite exato de saída | teste de borda `output == max_output` | ok |
| bytes arbitrários | ver §4 | sem pânico |

## 4. Validações executadas (itens 1–10 da missão)

1. **Goldens com hashes esperados:** 9 goldens bem-formados decodificam para
   os `.expected.bin` publicados (byte a byte) com `bytes_consumed` exato
   (m01=11, m03=11, m04=18, m05=115, m06=14, m07=10, m08=17, m09=23, m10=21);
   m02 → `Truncated` (exceção registrada no perfil).
2. **Controle late-fetch:** ver §5.
3. **Negativos k01–k05 + bordas:** todos no contrato (§3); bordas adicional:
   vazio, 1 byte, truncamentos sistemáticos de m01, m05−1B, sonda `0200FFFF`,
   eco, saída no limite exato, fronteira de orçamento.
4. **Comparação com oráculo pinado (saída completa, não rc+tamanho):**
   `scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh`
   → **60 linhas: 58 conformes, 0 divergências não-explicadas, 2 sondas de
   defeito do oráculo** (aceita m05−1B com 8692 bytes; `0200FFFF` → rc=0,
   0 bytes — ambos recusados estruturadamente pelo produto). Todas as
   conformes comparam SHA-256 de bytes (goldens oráculo-vs-espera +
   rust-vs-espera; plains reencode→decodificações duplas; `overlap_echo`;
   k05 oráculo-vs-rust `110009dcee21620b166f3abfecb5eff7a873be729d1c2d53822e7acc5f34eb9b`).
   TSV publicado em `evidence/` (sha §1). Repór: `bash scripts/.../differential-vs-koscmp.sh`
   (aborta se koscmp ou o checkout mdcomp divergirem dos pins).
5. **Expectativas independentes do decoder:** ouro = `.expected.bin`
   publicados pelo perfil REX-B (confirmados por `koscmp` em rodada anterior,
   agregado `ea866df797126230b36e27b76ca569d4fd8528d291e86fe578491998ec3d96d1`);
   a fixture autoral nova (`overlap_echo`) foi derivada do contrato e depois
   **confirmada pelo oráculo** (não pelo decoder).
6. **Truncamentos + mutações com seed:** sobre as 27 streams publicadas
   (4798 bytes no total): 4798 prefixos + 4798 mutações determinísticas
   (LCG seed `0xDEADBEEF`, XOR com bit 0 forçado). Nenhum pânico; todo
   resultado ou `Ok` coerente (`bytes_consumed ≤ len`, `output ≤ max_output`)
   ou `Err` dos 5 códigos contratuais. Nem toda mutação é inválida — o teste
   exige coerência, não erro.
7. **Negativos discriminativos:** além da recusa contratual (k01–k05), a
   mutação `m01[2] ^= 0x20` permanece bem-formada e decodifica, mas a saída
   difere da espera independente (mesmo comprimento, conteúdo divergente) —
   detectada somente por comparação externa. Teste dedicado em mutations.rs.
8. **Bytes após o terminator/padding:** contrato `bytes_consumed ≤ len`
   provado nas 12 plains (todas com 1 byte de padding: ex. abcdef 11/12,
   far_window 1085/1086); nunca exigido `==`.
9. **BYOR:** **não medido** — nenhuma stream Kosinski real de ROM nesta base;
   `resource-identification-in-rom` permanece `blocked`. Nenhum offset ou
   suporte de jogo foi inventado.
10. **Gates do pacote:** `cargo fmt --check` ok; `cargo clippy --all-targets
    -- -D warnings` sem avisos; `cargo test` **24/24 verdes SEM oráculo**
    (21 contract + 3 mutations). A comparação com oráculo vive em comando
    separado e documentado (§4.4), fora da suíte normal.

## 5. Controle de mutação EARLY→LATE FETCH (item 2)

Executado em cópia isolada do crate (código entregue intocado; SHA de
`lib.rs` reconferido após o controle). O reabastecimento antecipado foi
removido (leitor "late fetch", que busca a próxima palavra apenas no início
do próximo token). A suíte **rejeitou** o mutante com 3 falhas, todas
`InvalidReference`:

- `golden_m09_early_fetch_fronteira_16o_bit` (contract.rs:38)
- `plains_roundtrip_oraculo_reproduzidos_com_padding_parcial` — caso
  `far_window_40k` (contract.rs:126)
- `negativos_k01_a_k05_erros_estruturados` — caso k05 (contract.rs:150)

**Nota honesta de não-discriminação:** `golden_m10` **passou** sob o mutante
— coincidência de valores de bytes naquela stream específica; m10 sozinha
NÃO discrimina early fetch. A discriminação real vem de m09 + plains
(`far_window` entre elas) + k05. Recipe de reexecução: copiar
`crates/rex-kosinski` para um diretório temporário com `data/` acessível na
mesma posição relativa, eliminar o bloco de fetch antecipado dentro de
`next_bit` (linhas `if self.bits_left == 0 && !self.desc_eof { … }`) e rodar
`cargo test` — esperar exatamente as 3 falhas acima.

## 6. Referências, versões e pins

| Item | Valor |
|---|---|
| Variante | Kosinski base, não-modular (descritor 16-bit LE LSB→MSB, early fetch, terminator `00 F0 00`) |
| Oráculo | mdcomp `koscmp`, SHA-256 `a74c92957eccf9c1e5143167af9d6d98b2ce087aed8fe10d50b1f9c016373ea3`; checkout mdcomp `72c6df405a75d322c5b3722da46c3abb864d3793`; LGPL-3.0 — **somente ferramenta externa; nenhum código transplantado ao produto** |
| Fixtures | 27 streams do perfil REX-B (`data/rex_profiles/codec/kosinski/`), SHAs conferidos contra `manifest.tsv` nesta sessão (ex.: m09 `da295741…`, m10 `7a04a5db…`, k01 `462fd236…`, k05 `160ac892…`, zeros_64k `e887c360…`); agregado `ea866df7…` |
| Paridade com 2º descodificador 68k | **não executada** — permanece `blocked` (1 oráculo apenas) |
| Modo modular (`-m`) | não coberto — `blocked` |

## 7. Desvios e pendências registradas

- **`npm run check:tree` neste worktree sinaliza `crates/`** (raiz ausente de
  `docs/08_TREE_ARCHITECTURE.md`). A missão designa explicitamente
  `crates/rex-kosinski/`; docs canônicos pertencem ao integrador e **não foi
  editado nada deles**. Devolução: integrador decide a linha de `crates/` na
  árvore canônica.
- Encoder Kosinski, autodescoberta em ROM, reinserção, UI: fora de escopo
  desta entrega (missão).
- O quirk `continue` (c==1) é aceito (obrigação contratual do perfil);
  implementações futuras não devem rejeitá-lo.
- Nada foi mesclado, publicado ou promovido; suporte segue `fixture-only`
  até decisão do integrador.

## 8. Instrução para adaptar o módulo ao contrato de codecs do produto

1. Manter `decode(&[u8], max_output, work_limit) -> Result<KosDecoded, KosError>`
   como núcleo puro; o wrapper do produto converte `KosError` nos códigos
   estruturados já definidos no contrato v1 do produto (`truncated`,
   `invalid-reference`, `excessive-output`, `work-limit`) sem perder
   `bytes_consumed`.
2. `bytes_consumed` é a chave do emolduramento em ROM: o integrador usa
   `pos + bytes_consumed` para localizar o próximo recurso; **não** exigir
   `==` ao tamanho do slot (padding medido após o terminator).
3. Escolher limites por política de recurso (o decoder não os conhece):
   sugestão atual do corpus — `max_output` = teto do recurso, `work_limit`
   ≥ 4× (`bytes descritor + input + saída`); orçamento do tipo 17 medido na
   fronteira mínima.
4. Não transplantar código LGPL do mdcomp; este crate é implementação
   original derivada do contrato medido.
5. Reexecutar `differential-vs-koscmp.sh` em qualquer mudança de `lib.rs`
   (pins abortam a corrida se divergirem).
