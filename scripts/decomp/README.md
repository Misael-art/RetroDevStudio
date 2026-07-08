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
  >=2 perfis de otimizacao (release -O3 LTO vs debug -O1 no-LTO).

## Estado medido neste host (ver `ghidra_boundary_sample.txt`)
- **Ghidra 12.1.2 + jdk21-openjdk instalados** (repo oficial Arch `extra`; nenhum
  AUR/binario nao-verificado). Fase 5 **desbloqueada e medida**, nao mais BLOCKED.
- Boundary benchmark (5 projetos, 2 perfis): release -O3 LTO precisao~0,70-0,74 /
  recall~0,79-0,84; debug -O1 no-LTO precisao~0,85-0,87 / recall~0,94-0,96.
  Resolucao de nomes via Ghidra **NAO** e recuperacao semantica — mede apenas
  fronteiras de funcao inferidas vs ground truth binario.
- Holdout Tier 0: raw_byte_hit_rate~0,251, **unique_resolution_rate~0,132** (13,2%),
  0 vazamento (familia/ROM), reproduzivel identico em 2 execucoes.

## Limitacoes honestas
- Fingerprint exato transfere pouco entre projetos (LTO/constprop): unique_resolution
  ~13,2% em holdout sem vazamento — evidencia preliminar de identidade de bytes, nao
  cobertura semantica nem recuperacao de codigo-fonte.
- Boundary benchmark do Ghidra usa ELFs simbolizados do corpus SGDK como ground truth
  local; nao usa nem versiona ROM comercial.
- Estes scripts NAO implementam scanner de ROMs, ledger de produto, LLM nem UI —
  continuam bloqueados ate GO formal (`docs/12_DECOMPILACAO_PAREADA_PLANO.md`).
