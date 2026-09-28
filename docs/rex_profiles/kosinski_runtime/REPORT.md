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
| `crates/rex-kosinski/tests/contract.rs` | 22 testes de contrato (goldens, plains, negativos, bordas, limites no ponto de uso) | `f5aad06afcd950d8b3d22be5d9b3b8d8750cbdfbcdb54ba3eb280385b7c9afb0` |
| `crates/rex-kosinski/tests/mutations.rs` | 3 testes (truncamento sistemático, mutação com seed, negativo discriminativo) | `97476a1868237cdfc6fd90ea2a4d00e1d010b6f49164f1187faff24f5ca50b4c` |
| `crates/rex-kosinski/examples/decode.rs` | CLI de modo diferencial (usado só pelo script do oráculo) | `b7d3698218d11ecc5e3af6d9dcecf5c2e3d14d05002780e2b85da1cc66e3e508` |
| `docs/rex_profiles/kosinski_runtime/CONTRACT.md` | contrato v1 fixado ANTES da implementação | `3062965930ceeaa423d2718fe9b3a929df9d4c4ce2db51b294e66002e3b5798f` |
| `data/rex_profiles/kosinski_runtime/overlap_echo.kos` + `.expected.bin` | fixture autoral desta frente (eco sobreposto; expectativa derivada do contrato, confirmada pelo oráculo) | stream `ffde8de70ee9a51823cc9ce07a9062c684ab606a7e5aa4c237b98c582c2b7a53`; saída `7b346904f63cc07f1d8cc2d88d7dae08a3f088a0e4159d5214c27a6571a51eb4` |
| `data/rex_profiles/kosinski_runtime/limite_probe.kos` + `.expected.bin` | fixture autoral da revisão (item 4: cópia larga len=256 dist=1 + terminator; exercita corte de limites durante a decodificação) | stream `bfc118ff5c2dfa9410de92387dc3152d4571a503a0532bf24ca5afade0b5b79c`; saída `77608f24da6140277bd789efec57a179b1c1e57f44045ebd2b39e3c1e7e18d42` |
| `data/rex_profiles/kosinski_runtime/manifest.json` | manifesto exclusivo do pacote (2 vetores: overlap_echo, limite_probe) | `8005ec4547c49ea73dac80ec0eaac8997419743b9dbd158e798624a9aab4a278` |
| `scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh` | comparação externa isolada por sandbox (timeout + ulimit); tabela auditável da revisão | `168f23cf88923de9e649867a2a11f07618a750a1a718c2554c0b8ed6814b8dac` |
| `docs/rex_profiles/kosinski_runtime/evidence/differential-vs-koscmp.tsv` | evidência da execução diferencial auditável (39 linhas: 36 paridade + 1 contratual + 2 sondas) | `89d9eef6b6ff2d3f966eb1d254bc14159fbe8303b236ef9c1061d8fa3206c7cf` |

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
| saída > max_output em stream BEM-FORMADA | k05 (512 bytes, max_out=16) → `ExcessiveOutput`; com max_out=512 → `Ok` consumed=296; **corte durante a cópia longa** (§9) | ok |
| work_limit mínimo | orçamento 16 → `WorkLimit`; 17 → `Ok` (fronteira exata medida); **corte no 91º byte de uma cópia de 256** (§9) | ok |
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
   reescrito em **tabela auditável** (revisão PR #81, item 3): cada linha traz
   `caso | categoria | entrada_sha256 | esperado | oraculo | produto |
   veredito | justificativa`. Vereditos: **PARIDADE (36)**,
   **DIVERGENCA-CONTRATUAL (1 = m02, NUNCA contada como paridade positiva;
   falha se o produto deixar de recusar `Truncated` exatamente)** e
   **SONDA-DEFEITO-NAO-COTADA (2)** — as duas sondas de defeito do oráculo
   (aceita m05−1B com 8692 bytes > 8451 esperados; `0200FFFF` → rc=0,
   saída vazia) são diagnóstico documentado, **não paridade**.
   `DIVERGE` inaceitável = 0. Categorias: 9 goldens, 12 plain-encode
   (reencode reproduz a stream publicada; produto não tem encoder —
   declarado na linha), 12 plain-decode, 2 runtime (`overlap_echo` e
   `limite_probe`, espera derivada da gramática do contrato), 1 k05 bem-formada
   (`110009dcee21620b166f3abfecb5eff7a873be729d1c2d53822e7acc5f34eb9b` pinado
   no próprio script). Aborta se koscmp ou o checkout mdcomp divergirem dos
   pins. TSV publicado em `evidence/` (sha no apêndice A).
   Contagem antiga (58/60 em 60 linhas) foi substituída — a reformulação
   passou a tratar m02 como divergência contratual explícita em vez de
   "conforme", somou `limite_probe` e unificou oráculo+produto por caso.
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
10. **Gates do pacote (reexecutados após a revisão):** `cargo fmt --check` ok;
    `cargo clippy --all-targets -- -D warnings` sem avisos; `cargo test`
    **25/25 verdes SEM oráculo** (22 contract + 3 mutations). A comparação com
    oráculo vive em comando separado e documentado (§4.4), fora da suíte
    normal.

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

## 7. Gates abertos e pendências registradas

- **GATE ABERTO — `check:tree` (revisão PR #81, item 5; não enfraquecido por
  esta frente).** Diagnóstico exato neste worktree (comando
  `node scripts/check-tree.cjs`, código de saída **1**):
  ```text
  ERRO: Diretorios na raiz que nao estao em docs/08_TREE_ARCHITECTURE.md:
    - crates
  Diretorios permitidos na raiz: .github, data, docs, src, src-tauri, toolchains, scripts
  ```
  Causa: a allowlist de raízes é **literal em código** —
  `scripts/check-tree.cjs:12`:
  `const allowedDirs = [".github", "data", "docs", "src", "src-tauri", "toolchains", "scripts"];`
  (o script não deriva a lista de `docs/08`; o texto é apenas mensagem).
  **Mudança mínima proposta ao integrador** (nada aplicado por esta frente):
  ① adicionar `"crates"` a `allowedDirs` em `scripts/check-tree.cjs:12` e
  ② registrar a seção `crates/` (pacotes Rust autônomos fora do Tauri) em
  `docs/08_TREE_ARCHITECTURE.md`, mantendo script e doc em acordo.
  Alternativa de localização compatível com as regras ATUAIS (sem tocar
  script nem doc): mover o pacote para baixo de uma raiz já permitida —
  ex. `src-tauri/vendor/rex-kosinski/` — ao custo de insinuar acoplamento ao
  app Tauri que o pacote não tem. A missão fixou `crates/rex-kosinski/`;
  decisão final é do integrador.
- Encoder Kosinski, autodescoberta em ROM, reinserção, UI: fora de escopo
  desta entrega (missão). **Kosinski não está disponível na interface do
  produto** — nada foi integrado.
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

## 9. Limites exercitados DURANTE a decodificação (revisão PR #81, item 4)

Não há truncamento no final nem conferência posterior à alocação:

- `max_output`: cobrado **por byte escrito**, no ponto de uso —
  `push()` (`crates/rex-kosinski/src/lib.rs:173-179`) retorna
  `ExcessiveOutput` quando `out.len() >= max_output` **antes** de qualquer
  `Vec::push`; é chamado dentro do laço de cópia (`lib.rs:165-169`) e no
  literal (`lib.rs:123`). O `Vec` jamais cresce além do teto.
- `work_limit`: `spend()` (`lib.rs:40-46`) usa `checked_add` e recusa
  **antes** da operação seguinte; é invocado por bit de descritor, por byte
  lido e por byte escrito — um token `len=256` não consegue alocar 256 bytes
  sem 256 unidades de orçamento.

Prova em testes (suíte normal, sem oráculo):
`limites_cortam_durante_a_copia_larga_nao_so_no_fim` usa a stream autoral
`15 00 41 FF F8 FF 00 00 00` (literal `'A'` + separado `len=256, dist=1` +
terminador): com `max_output=10` o erro vem **no meio da cópia**
(`ExcessiveOutput` — um truncador retornaria `Ok`); com `work_limit=100` o
orçamento corta no **91º byte copiado** (`WorkLimit` — um verificador pós-
alocação não cortaria em meio ao token). Controle positivo sem limites
apertados: 257×`0x41`, `bytes_consumed=9`. A mesma stream foi adicionada ao
modo diferencial como `limite_probe`, **confirmada pelo oráculo** (paridade
na tabela auditável). As provas anteriores seguem intactas: early-fetch
(m09/m10 + controle §5), referências sobrepostas (m07, `overlap_echo`,
`noisy_runs_16k`), consumo (`bytes_consumed` exato nos 9 goldens + 12
plains), terminador (todas as streams bem-formadas; k01/k02/m02 recusados),
padding (§4.8) e ausência de pânico (§4.6).

## 10. Naturezas de verificação (revisão PR #81, item 2)

- **Comparação externa com `koscmp`: EXECUTADA** — oráculo pinado, sandbox
  com timeout, tabela auditável §4.4 (paridade=36; divergência contratual
  esperada=1; sondas de defeito=2, não cotadas).
- **Revisão independente por outro executor: NÃO EXECUTADA.** Isso não
  invalida nem diminui as verificações próprias desta frente, que foram
  executadas por inteiro: TDD com falha observada, fmt, clippy `-D warnings`,
  25/25 testes sem oráculo, controle de mutação, truncamentos/mutações com
  seed e a comparação externa acima. Não existe nos docs canônicos regra que
  condicione essas verificações a autorização; a regra literal aplicável ao
  vocabulário de entrega é `docs/09_AGENT_DEV_MODE.md` §3.2:
  "`Validado institucionalmente`: ha evidencia canonica da rodada/host
  institucional." — por isso esta entrega **não** usa esse rótulo; ela se
  limita à classificação autorizada pela missão:
  *Decodificação Kosinski verificada no contrato e corpus descritos.*
  (Expectativas manuais vs comparação executável, item 4 do briefing
  original: as esperas dos goldens/plains são publicas e verificaveis por
  qualquer executor com `koscmp` pinado; a suíte `cargo test` cobre as
  expectativas contratuais sem oráculo — uma não substitui a outra.)

## 11. Licenças e proveniência (revisão PR #81, item 6)

| Artefato | Papel | Licença/proveniência | Código incorporado? |
|---|---|---|---|
| mdcomp `koscmp` + checkout `72c6df40…` | **referência externa usada só para comparação** (executada em sandbox) | LGPL-3.0-or-later | **NÃO** — nenhum código, binário ou objeto transplantado/embutido; apenas fatos de formato medidos e citados em CONTRACT.md |
| `crates/rex-kosinski/*` | implementação desta frente | original (esta frente), sem dependências (`Cargo.lock`: zero deps) | — |
| `data/rex_profiles/codec/kosinski/**` (27 streams + esperas) | fixtures/vetos | **authored-fixture** sintéticas do perfil REX-B, geradas por `gen_vectors.py` autoral e confirmadas pelo oráculo; agregado `ea866df7…` | — |
| `data/rex_profiles/kosinski_runtime/*` | fixture autoral `overlap_echo` + manifesto | autoral desta frente, expectativa derivada do contrato, confirmada pelo oráculo | — |
| `scripts/rex_profiles/codecs/common/sandbox.sh` | isolador de oráculo (herança #79) | autoral REX | — |
| Nenhuma ROM/comercial/BYOR foi usada | — | corpus BYOR **não medido** | — |

## 12. Herança da cadeia da PR #79 (base dependente preservada)

Testes e modo diferencial **exigem** estes arquivos herdados do branch base
`codex/rex-b-codecs` (commit `9b2389d`), que esta frente não duplicou nem
alterou:

- `data/rex_profiles/codec/kosinski/{plain,golden,negative}/*.kos` e
  `.expected.bin`/`.expected.json` — as 27 streams que `tests/contract.rs` e
  `tests/mutations.rs` leem via caminho relativo (`perfil()`), mais as
  esperas publicadas;
- `data/rex_profiles/codec/kosinski/manifest.tsv` — verificação de SHAs das
  fixtures (§6);
- `scripts/rex_profiles/codecs/common/sandbox.sh` — `run_oracle` usado pelo
  diferencial;
- `docs/rex_profiles/codecs/kosinski.md` + `evidence/` do perfil — contexto
  das pins/hashes citados.

Por isso a PR mira `codex/rex-b-codecs` como base, não `main`.

Reprodutibilidade medida nesta revisão: o diferencial foi executado 2× (e
novamente 2× após a correção da justificativa no script) com as fixtures lidas
de `data/` (fonte única) e produziu TSV **byte-idêntico** em cada par de
corridas — SHA-256 final `89d9eef6…` nas duas últimas.

## Apêndice A — comandos validados e SHA por artefato (revisão de 2026-09-27)

Comando de validação (caminho real **confirmado por execução** de um CWD
estranho; proibido orientar `git checkout` no diretório canônico ocupado
pelo integrador):

```bash
cargo test --manifest-path /home/misael/Projects/REX-KOSINSKI-DECODER-2026-09-27/crates/rex-kosinski/Cargo.toml
```

Modo diferencial (requer koscmp pinado; usa `REX_REPO` automático do worktree):

```bash
bash /home/misael/Projects/REX-KOSINSKI-DECODER-2026-09-27/scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh
```

| Artefato | SHA-256 |
|---|---|
| `crates/rex-kosinski/src/lib.rs` (inalterado pela revisão — sem mudança de produção) | `7f70a772b611af68af8a8bc2bd9db4c8e6be404348ce697c2b355e3b11f156d8` |
| `crates/rex-kosinski/tests/contract.rs` (22 testes, +`limites_cortam...`) | `f5aad06afcd950d8b3d22be5d9b3b8d8750cbdfbcdb54ba3eb280385b7c9afb0` |
| `crates/rex-kosinski/tests/mutations.rs` | `97476a1868237cdfc6fd90ea2a4d00e1d010b6f49164f1187faff24f5ca50b4c` |
| `crates/rex-kosinski/examples/decode.rs` | `b7d3698218d11ecc5e3af6d9dcecf5c2e3d14d05002780e2b85da1cc66e3e508` |
| `scripts/rex_profiles/codecs/kosinski_runtime/differential-vs-koscmp.sh` (tabela auditável) | `168f23cf88923de9e649867a2a11f07618a750a1a718c2554c0b8ed6814b8dac` |
| `docs/rex_profiles/kosinski_runtime/evidence/differential-vs-koscmp.tsv` (39 linhas: 36/1/2) | `89d9eef6b6ff2d3f966eb1d254bc14159fbe8303b236ef9c1061d8fa3206c7cf` |
| `docs/rex_profiles/kosinski_runtime/CONTRACT.md` (inalterado) | `3062965930ceeaa423d2718fe9b3a929df9d4c4ce2db51b294e66002e3b5798f` |
| commit da entrega original | `3fea06e` |
| commit desta revisão | consultável via `git log --oneline -2` na branch (auto-referência: um commit não pode conter o próprio SHA) |

## 13. Continuação (2026-09-28) — codificação e edição de conteúdo autoral (Etapas 1–5 da missão do encoder)

**Classificação atualizada (única permitida):** *"Decodificação, codificação
e edição de conteúdo autoral Kosinski verificadas no contrato descrito."*
Continua **sem** alegar: UI do produto, ROM comercial/BYOR, autodescoberta,
modo modular, patch format.

Commits desta fase (branch `codex/rex-kosinski-decoder`, sobre `1af7017`):
`0b752b7` contrato do ENCODER antes da implementação · `2b50cab` encoder +
16 testes + retificação §3 · `36741a5` paridade bidirecional + controles de
corrupção · `f3c51f2` contêiner de edição + ciclo completo.

Entregue: `src/encode.rs`, `src/edit.rs`, `tests/encode.rs` (16),
`tests/edit.rs` (8), `examples/encode.rs`, `examples/edit_cycle.rs`,
`ENCODE-CONTRACT.md` (+ retificações §3 early-fetch e §9.item-3),
`ENCODE-DELIVERY.md` (API, tabela de tamanhos, limitações, proposta de
adaptação), 5 fixtures autorais novas (`encdir/`, `edit/`). **Decoder,
CONTRACT.md e fixtures herdadas inalterados** — a única mudança em `lib.rs`
são as linhas de wiring `pub mod encode; pub mod edit; pub use …`
(SHA `7f70a772…` → `0f6e0945…`; lógica do decoder byte a byte idêntica,
verificável nos diffs).

Evidência reconciliada (detalhe e SHAs completos em `ENCODE-DELIVERY.md`):

- Diferencial externo agora **58 linhas: 53 PARIDADE + 1 DIVERGENCA-CONTRATUAL
  (m02) + 2 SONDA-DEFEITO (não cotadas) + 2 CONTROLE-CORRUPCAO**, 0 DIVERGE,
  rc=0 — direção A (streams de referência → decoder do produto) e direção B
  (streams do produto → koscmp, conteúdo completo), incluindo confirmação
  EXTERNA do plain editado que sai do contêiner (`edicoe-ciclo-decode`) e
  vizinhos de 4096 B byte-idênticos antes/depois da reinserção.
  TSV: `evidence/differential-vs-koscmp.tsv` sha `45e42f7f…` (substitui a
  tabela 39/36+1+2 da seção 4.4 — contagem anterior fica válida apenas para a
  entrega do decoder).
- Tamanhos vs. koscmp: `evidence/encoder-sizes-vs-oracle.tsv` — produto ≤
  oráculo em 11/12 casos; único pior `noisy_runs_16k` (+558 B), registrado
  como limitação da estratégia não ótima (promessa explícita do contrato),
  não escondido.
- Gates locais: `cargo test` **49/49 verdes sem oráculo** (22 contract +
  3 mutations + 16 encode + 8 edit), `cargo fmt --check` e
  `cargo clippy --all-targets -- -D warnings` limpos.

Estado de gates/herança atualizado:

- O gate `check:tree` (§7) foi **fechado pelo integrador no tronco** em
  2026-09-28 (`crates/` oficial + `crates/registry.json` + `crates:gates`);
  nesta branch a script herdada ainda rejeita `crates/` — reprodução do
  fechamento pertence à cadeia do integrador, não a esta frente.
- Dívida devolvida à frente B pelo integrador (documentada, **não** tratada
  nesta missão do encoder): fixtures lidas fora do crate
  (`data/rex_profiles/codec/kosinski`) e metadata `license` ausente —
  próxima rodada B deve vendorizar ou parametrizar por env.
