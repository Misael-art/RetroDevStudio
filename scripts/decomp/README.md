# scripts/decomp — reproducao versionada do spike de decompilacao (Experimental)

Scripts versionados que **reproduzem** as evidencias do spike de decompilacao M68K.
NAO fazem parte do pipeline de producao; NAO ha scanner/ledger/LLM/UI. Superficie
**Experimental**. Toda ROM/corpus e **BYOR** (host-provided, somente leitura); nada
de ROM comercial e versionado — os scripts registram apenas hashes/metadados/derivados.

## Variaveis de ambiente (BYOR / host)
| Var | Default | Uso |
|-----|---------|-----|
| `RDS_SGDK_CORPUS` | `/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines` | corpus SGDK (fonte+ROM), read-only |
| `GDK` | `/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11` | SGDK para rebuild |
| `RDS_DECOMP_WORK` | `$HOME/.retrodev/decomp_work` | dir de saida (fora do repo; sem ROM no repo) |
| `RDS_ALLOW_SGDK_DEBUG_FALLBACK` | (unset) | opt-in do build debug/no-LTO no `build_orch` |

## Scripts
- `build_reproducible.sh` — **Fase 2**: recompila >=5 projetos Tier 0 em duas arvores
  independentes com `set -euo pipefail`; exige ROM final padded+checksummed; compara
  SHA-256 completo; mutacao negativa obrigatoria. Debug/no-LTO e **calibracao**, nao
  reproducao de release (registrado no manifesto).
- `fingerprint_v2.sh` — **Fase 3 fingerprint**: fronteiras por symbol-table `F .text`
  (addr+size, validado dentro de `.text`), SHA-256 completo, mapa `hash->identidades`,
  separa `raw_byte_hit` de `unique_resolution`; runtime SGDK vs game-specific.
- `holdout_v2.sh` — **Fase 4 holdout**: split por familia antes da extracao, dedup por
  SHA de ROM, guardas de vazamento, duas execucoes identicas. Metricas: raw byte hit,
  unique resolution, ambiguidade, nao resolvidos. **13,2% = resolucao unica de nomes por
  identidade de bytes; NAO e recuperacao de codigo/logica.**
- `ghidra_boundary.sh` — **Fase 5**: diagnostica Ghidra/JDK21; se ausentes, imprime o
  pedido de autorizacao e **sai sem instalar nada**. Boundary precision/recall so roda
  apos autorizacao humana + instalacao versionada.

## Limitacoes honestas
- Ghidra/JDK21 ausentes neste host → Fase 5 **BLOCKED**; boundary precision/recall nao medido.
- Fingerprint exato transfere pouco entre projetos (LTO/constprop): unique_resolution ~13,2%
  em holdout sem vazamento — evidencia preliminar, nao cobertura semantica.
