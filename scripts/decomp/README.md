# scripts/decomp — reproducao versionada do spike de decompilacao (Experimental)

Scripts versionados que **reproduzem** as evidencias do spike de decompilacao M68K.
NAO fazem parte do pipeline de producao; NAO ha scanner, ledger de produto, LLM
nem UI de decompilacao. Superficie **Experimental**. Toda ROM/corpus e **BYOR**
(host-provided, somente leitura); nada de ROM comercial e versionado — os scripts
registram apenas hashes/metadados/derivados.

**Nao confundir com a fixture dinamica Control/Positive/Negative da camada
Gameplay Parity** (`parity_fixture_*` em `src-tauri/src/core/parity_harness.rs`):
essa fixture e construida canonicamente pelos proprios testes Rust via
`makefile.gen` do SGDK, com saida em `src-tauri/target-test/validation/parity-fixture/`
— nao depende deste diretorio nem de `RDS_DECOMP_WORK`. Ambas reutilizam a mesma
fonte C aberta em `src-tauri/tests/fixtures/sgdk_spike/`.

## Variaveis de ambiente (BYOR / host)
| Var | Default | Uso |
|-----|---------|-----|
| `RDS_SGDK_CORPUS` | `/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines` | corpus SGDK (fonte+ROM), read-only |
| `GDK` | `/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11` | SGDK para rebuild |
| `RDS_DECOMP_WORK` | `$HOME/.retrodev/decomp_work` | dir de saida (fora do repo; sem ROM no repo) |
| `RDS_ALLOW_SGDK_DEBUG_FALLBACK` | (unset) | opt-in do build debug/no-LTO no `build_orch` |
| `RETRODEV_GHIDRA_HOME` | `/opt/ghidra` | instalacao do Ghidra para `ghidra_boundary.sh` |

## Scripts
- `build_reproducible.sh` — **Fase 2**: recompila >=5 projetos Tier 0 do corpus BYOR
  em duas arvores independentes com `set -euo pipefail`; exige ROM final
  padded+checksummed; compara SHA-256 completo; mutacao negativa obrigatoria.
  Debug/no-LTO e **calibracao**, nao reproducao de release (registrado no manifesto).
- `fingerprint_v2.sh` — **Fase 3 fingerprint**: fronteiras por symbol-table `F .text`
  (addr+size, validado dentro de `.text`), SHA-256 completo, mapa `hash->identidades`,
  separa `raw_byte_hit` de `unique_resolution`; runtime SGDK vs game-specific.
- `holdout_v2.sh` — **Fase 4 holdout**: split por familia antes da extracao, dedup por
  SHA de ROM, guardas de vazamento, duas execucoes identicas. Metricas: raw byte hit,
  unique resolution, ambiguidade, nao resolvidos. **13,2% (unique_resolution_rate) =
  resolucao unica de nomes por identidade de bytes; NAO e recuperacao de codigo/logica.**
- `ghidra_boundary.sh` + `GhidraListFunctions.java` — **Fase 5**: diagnostica
  Ghidra/JDK21; se ausentes, imprime o pedido de autorizacao e **sai (exit 3) sem
  instalar nada**. Quando presentes, importa ELFs M68K **estripados** (sem simbolos)
  em Ghidra headless (postScript Java, sem PyGhidra) e compara as fronteiras
  inferidas contra o ground truth da symbol-table (`F .text`) do ELF simbolizado
  correspondente: precisao, recall, FP, FN e erro de endereco, em >=5 projetos x
  >=2 perfis de otimizacao (release -O3 LTO vs debug -O1 no-LTO). Falha (exit != 0)
  se qualquer amostra obrigatoria der `MISSING_ELF`/`STRIP_FAIL`/`GHIDRA_EMPTY`
  (`RDS_GHIDRA_ALLOW_FAILURES` e o unico opt-out, default 0 = zero tolerancia).
  Resolucao de projeto por nome exato (nao prefixo/glob) e diretorio de trabalho
  unico por execucao (`mktemp -d`) — ver "Bugs corrigidos" abaixo.

## Estado medido neste host (ver `ghidra_boundary_sample.json`/`.md`)
- **Ghidra 12.1.2 + jdk21-openjdk instalados** (repo oficial Arch `extra`; nenhum
  AUR/binario nao-verificado). Fase 5 **desbloqueada e medida**, nao mais BLOCKED.
- Boundary benchmark (5 projetos, 2 perfis, execucao limpa e isolada, 10/10 amostras
  OK, `GATE PASSED`): **release -O3 LTO precisao[min=0,587 max=0,738 media=0,691] /
  recall[min=0,512 max=0,841 media=0,748]**; **debug -O1 no-LTO precisao[min=0,850
  max=0,873 media=0,859] / recall[min=0,940 max=0,957 media=0,951]**. O minimo do
  perfil release (`Custom Font`, prec=0,587/rec=0,512) e um resultado real medido,
  nao um outlier descartado — reportar apenas a faixa `~0,70-0,74` teria escondido
  o pior caso genuino. Resolucao de nomes via Ghidra **NAO** e recuperacao
  semantica — mede apenas fronteiras de funcao inferidas vs ground truth binario.
- Holdout Tier 0: raw_byte_hit_rate~0,251, **unique_resolution_rate~0,132** (13,2%),
  0 vazamento (familia/ROM), reproduzivel identico em 2 execucoes.

## Bugs corrigidos nesta auditoria (2026-07-08)
- **`holdout_v2.sh`/`fingerprint_v2.sh` aceitavam corpus vazio e saiam 0** (`GATE
  PASSED` com metricas zeradas). Agora validam `RDS_SGDK_CORPUS`/ferramentas no
  inicio e exigem minimos auditaveis (`RDS_HOLDOUT_MIN_PROJECTS`,
  `RDS_HOLDOUT_MIN_FUNCTIONS`, `RDS_FP_MIN_ELFS`, `RDS_FP_MIN_FUNCTIONS`; default 1
  = "nao vazio") antes de declarar sucesso.
- **`fingerprint-v2-manifest.json` gerava JSON invalido**: uma chave era construida
  via `grep ambiguous_hashes ...`, que tambem casava a substring dentro de
  `unambiguous_hashes`, embutindo uma quebra de linha crua nao escapada como chave
  JSON (`jq`/`JSON.parse` rejeitavam o arquivo). Reescrito para emitir cada campo
  como numero JSON real, calculado em variaveis shell, nunca como blob `chave=valor`
  embutido; o proprio script agora auto-valida o JSON gerado (`node -e
  "JSON.parse(...)"`) e falha se invalido.
- **`build_reproducible.sh` reportava falso "5/5 REPRODUCIBLE" com corpus
  ausente**: `cp "$src"/src "$dst"/ 2>/dev/null || true` engolia o erro quando o
  projeto fonte nao existia, deixando o diretorio de build vazio; o SGDK ainda
  assim compilava um ROM bootstrap trivial identico em toda execucao. Agora exige
  `$src` e `$src/src/*.c` antes de copiar, com falha explicita caso contrario.
- **`ghidra_boundary.sh` resolvia projeto por prefixo glob dependente de locale**
  (`ls -d "$CORPUS/$p"* | head -1`): no corpus real existem `Custom Font [...]`
  (com ROM construida) e `Custom Fonts Example [...]` (sem ROM); a ordem de
  colacao do `ls` escolhia a dependendo do locale, as vezes resolvendo para o
  projeto ERRADO e reportando `MISSING_ELF` para um projeto que na verdade existe
  e esta construido. Corrigido para casamento exato pelo nome antes de ` [`.
- **`ghidra_boundary.sh` usava um diretorio de trabalho fixo
  (`/tmp/rds_ghidra_boundary`)**: duas execucoes concorrentes (mesmo do mesmo
  operador, em terminais diferentes) podiam se sobrescrever no meio de uma
  avaliacao, produzindo erros de arquivo ausente e JSON invalido. Corrigido para
  `mktemp -d` unico por execucao, com limpeza via `trap ... EXIT`.

## Limitacoes honestas
- Fingerprint exato transfere pouco entre projetos (LTO/constprop): unique_resolution
  ~13,2% em holdout sem vazamento — evidencia preliminar de identidade de bytes, nao
  cobertura semantica nem recuperacao de codigo-fonte.
- Boundary benchmark do Ghidra usa ELFs simbolizados do corpus SGDK como ground truth
  local; nao usa nem versiona ROM comercial. Resolucao de fronteiras **NAO** e
  decompilacao semantica nem recuperacao de codigo-fonte.
- Estes scripts NAO implementam scanner de ROMs, ledger de produto, LLM nem UI —
  continuam bloqueados ate GO formal (`docs/12_DECOMPILACAO_PAREADA_PLANO.md`).
