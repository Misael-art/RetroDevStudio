#!/usr/bin/env bash
# Fase 5 — Ghidra headless boundary benchmark (M68000).
# Diagnostica Ghidra/JDK21. Se ausentes, imprime o pedido de autorizacao e SAI
# sem instalar/baixar nada. Se presentes, mede function-boundary precision/recall
# comparando as fronteiras inferidas pelo Ghidra (em ELF STRIPADO, sem simbolos)
# com o ground truth da symbol-table (F .text) do ELF simbolizado correspondente.
# Avalia >=5 projetos e >=2 perfis de otimizacao (release -O3 LTO vs debug -O1).
set -uo pipefail

CORPUS="${RDS_SGDK_CORPUS:-/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines}"
DEBUG_ELF_DIR="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/build2_v2"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="/tmp/rds_ghidra_boundary"   # sem dot-dirs: Ghidra rejeita '.retrodev'
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"; export JAVA_HOME

GHIDRA_HOME="${RETRODEV_GHIDRA_HOME:-/opt/ghidra}"
ANALYZE="$GHIDRA_HOME/support/analyzeHeadless"
[ -x "$ANALYZE" ] || ANALYZE="$(command -v analyzeHeadless 2>/dev/null || true)"
JAVA_MAJOR=$("$JAVA_HOME/bin/java" -version 2>&1 | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)

if [ -z "${ANALYZE:-}" ] || [ ! -x "${ANALYZE:-/nonexistent}" ] || [ "${JAVA_MAJOR:-0}" -lt 21 ]; then
  echo "== Fase 5 BLOCKED: analyzeHeadless=${ANALYZE:-MISSING} java=${JAVA_MAJOR:-0} (precisa >=21) =="
  cat <<'EOF'
Autorizacao humana necessaria (nada instalado):
  sudo pacman -S jdk21-openjdk        # repo oficial extra
  sudo pacman -S ghidra               # repo oficial extra (12.x)
  # ou tarball oficial NSA + export RETRODEV_GHIDRA_HOME=/opt/ghidra (verifique checksum)
EOF
  exit 3
fi

rm -rf "$WORK"; mkdir -p "$WORK/proj"
echo "provenance: ghidra=$(pacman -Q ghidra 2>/dev/null) jdk=$(pacman -Q jdk21-openjdk 2>/dev/null) analyzeHeadless_sha=$(sha256sum "$ANALYZE" | cut -c1-16)"

# 5 projetos Tier 0 avaliados em 2 perfis.
PROJECTS=("flip" "Mega Pong Classic" "Lifebar" "Mega Runner" "Custom Font")

truth_addrs() { # unstripped ELF -> sorted decimal F .text addresses
  m68k-elf-objdump -t "$1" 2>/dev/null | grep -E ' F \.text\b' \
    | awk '{print strtonum("0x"$1)}' | sort -n
}

ghidra_addrs() { # stripped ELF -> sorted decimal inferred function starts
  local elf="$1"
  "$ANALYZE" "$WORK/proj" b$RANDOM -import "$elf" -processor "68000:BE:32:default" \
    -postScript GhidraListFunctions.java -scriptPath "$REPO/scripts/decomp" -deleteProject 2>&1 \
    | grep -oE 'GHIDRA_FUNCS=[0-9a-fx,]+' | head -1 | sed 's/GHIDRA_FUNCS=//' \
    | tr ',' '\n' | awk 'NF{print strtonum($0)}' | sort -n
}

evaluate() { # label, unstripped_elf -> emits metrics line
  local label="$1" elf="$2"
  [ -f "$elf" ] || { echo "$label MISSING_ELF"; return; }
  local strp="$WORK/$(echo "$label" | tr ' /' '__').stripped"
  m68k-elf-strip -o "$strp" "$elf" 2>/dev/null || { echo "$label STRIP_FAIL"; return; }
  truth_addrs "$elf" > "$WORK/truth.txt"
  ghidra_addrs "$strp" > "$WORK/ghidra.txt"
  local nt ng
  nt=$(wc -l < "$WORK/truth.txt"); ng=$(wc -l < "$WORK/ghidra.txt")
  [ "$ng" -gt 0 ] || { echo "$label GHIDRA_EMPTY (truth=$nt)"; return; }
  # exact TP + tolerant TP(+-4 bytes) + mean address error for nearest-matched.
  awk -v tol=4 -v label="$label" '
    NR==FNR { truth[FNR]=$1; nt=FNR; seen[$1]=1; next }
    { gh[FNR]=$1; ng=FNR }
    END {
      tp=0; tp_tol=0; sumerr=0; matched=0;
      for (i=1;i<=ng;i++) {
        x=gh[i];
        if (x in seen) { tp++; tp_tol++; matched++; continue }
        best=-1;
        for (j=1;j<=nt;j++) { d=truth[j]-x; if (d<0) d=-d; if (best<0||d<best) best=d }
        if (best>=0 && best<=tol) { tp_tol++; matched++; sumerr+=best }
      }
      fp=ng-tp; fn=nt-tp;
      printf "%s truth=%d ghidra=%d exact_tp=%d fp=%d fn=%d prec=%.3f rec=%.3f prec_tol4=%.3f rec_tol4=%.3f mean_addr_err=%.2f\n", label, nt, ng, tp, fp, fn, (ng?tp/ng:0), (nt?tp/nt:0), (ng?tp_tol/ng:0), (nt?tp_tol/nt:0), (matched?sumerr/matched:0);
    }' "$WORK/truth.txt" "$WORK/ghidra.txt"
}

echo "== PROFILE release (-O3 LTO, corpus) =="
for p in "${PROJECTS[@]}"; do
  d=$(ls -d "$CORPUS/$p"* 2>/dev/null | head -1)
  evaluate "release/$p" "$d/out/rom.out"
done
echo "== PROFILE debug (-O1 no-LTO, build_reproducible) =="
for p in "${PROJECTS[@]}"; do
  evaluate "debug/$p" "$DEBUG_ELF_DIR/${p}_A/out/rom.out"
done
echo "== done =="
