#!/usr/bin/env bash
# Fase 5 — Ghidra headless boundary benchmark (M68000).
# Diagnostica Ghidra/JDK21. Se ausentes, imprime o pedido de autorizacao e SAI
# sem instalar/baixar nada. Se presentes, mede function-boundary precision/recall
# comparando as fronteiras inferidas pelo Ghidra (em ELF STRIPADO, sem simbolos)
# com o ground truth da symbol-table (F .text) do ELF simbolizado correspondente.
# Avalia >=5 projetos e >=2 perfis de otimizacao (release -O3 LTO vs debug -O1).
#
# Fail-hard: any required sample returning MISSING_ELF/STRIP_FAIL/GHIDRA_EMPTY
# fails the whole gate (exit 1), unless explicitly relaxed via
# RDS_GHIDRA_ALLOW_FAILURES (default 0 = zero tolerance). This is the auditable
# knob mentioned in scripts/decomp/README.md; do not raise it silently.
set -uo pipefail

CORPUS="${RDS_SGDK_CORPUS:-/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines}"
DEBUG_ELF_DIR="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/build2_v2"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"; export JAVA_HOME
ALLOW_FAILURES="${RDS_GHIDRA_ALLOW_FAILURES:-0}"
OUT_DIR="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/ghidra_boundary"

GHIDRA_HOME="${RETRODEV_GHIDRA_HOME:-/opt/ghidra}"
ANALYZE="$GHIDRA_HOME/support/analyzeHeadless"
[ -x "$ANALYZE" ] || ANALYZE="$(command -v analyzeHeadless 2>/dev/null || true)"
JAVA_MAJOR=$("$JAVA_HOME/bin/java" -version 2>&1 | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)

mkdir -p "$OUT_DIR"

if [ -z "${ANALYZE:-}" ] || [ ! -x "${ANALYZE:-/nonexistent}" ] || [ "${JAVA_MAJOR:-0}" -lt 21 ]; then
  echo "== Fase 5 BLOCKED: analyzeHeadless=${ANALYZE:-MISSING} java=${JAVA_MAJOR:-0} (precisa >=21) =="
  cat <<'EOF'
Autorizacao humana necessaria (nada instalado):
  sudo pacman -S jdk21-openjdk        # repo oficial extra
  sudo pacman -S ghidra               # repo oficial extra (12.x)
  # ou tarball oficial NSA + export RETRODEV_GHIDRA_HOME=/opt/ghidra (verifique checksum)
EOF
  cat > "$OUT_DIR/ghidra-boundary-report.json" <<EOF
{ "schema": "rds-ghidra-boundary/v1", "ok": false, "blocked": true,
  "reason": "analyzeHeadless or JDK21 not found; nothing installed" }
EOF
  exit 3
fi

# Unique per-invocation work dir (mktemp -d), created only once we are past
# the BLOCKED check. A prior fixed path (/tmp/rds_ghidra_boundary, shared by
# every invocation) let two concurrent runs clobber each other's
# truth.txt/ghidra.txt mid-evaluation, producing "file not found" errors and
# an invalid JSON manifest. The template keeps a leading non-dot component
# (Ghidra rejects a path segment STARTING with '.', e.g. '.retrodev';
# 'rds_ghidra_boundary.XXXXXX' does not start with one).
WORK="$(mktemp -d "/tmp/rds_ghidra_boundary.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FATAL: $1" >&2; echo "GATE FAILED (precondition)" >&2; exit 2; }

# --- Upfront validation (only reached once Ghidra/JDK21 are confirmed present) ---
[ -d "$CORPUS" ] || fail "RDS_SGDK_CORPUS directory does not exist: $CORPUS"
command -v m68k-elf-objdump >/dev/null 2>&1 || fail "m68k-elf-objdump not found in PATH"
command -v m68k-elf-strip >/dev/null 2>&1 || fail "m68k-elf-strip not found in PATH"

# Exact, locale-independent project resolution: the family/project name is the
# corpus directory's basename up to " [" — matched EXACTLY, never a prefix
# glob. A prior version used `ls -d "$CORPUS/$p"* | head -1`, whose match order
# depends on the current locale's collation; on this host it silently resolved
# "Custom Font" to the sibling "Custom Fonts Example" directory (which has no
# built ROM at all) instead of "Custom Font [...]" (which does), producing a
# false MISSING_ELF for a project that is actually present and built.
find_project_dir() {
  local want="$1" d base name
  for d in "$CORPUS"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    name="${base%% \[*}"
    if [ "$name" = "$want" ]; then
      printf '%s\n' "${d%/}"
      return 0
    fi
  done
  return 1
}

mkdir -p "$WORK/proj"   # $WORK is already a fresh, unique dir from mktemp -d
provenance="ghidra=$(pacman -Q ghidra 2>/dev/null || echo unknown) jdk=$(pacman -Q jdk21-openjdk 2>/dev/null || echo unknown) analyzeHeadless_sha=$(sha256sum "$ANALYZE" | cut -c1-16)"
echo "provenance: $provenance"

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

RESULTS_TSV="$WORK/results.tsv"   # label \t status \t truth \t ghidra \t exact_tp \t fp \t fn \t prec \t rec \t prec_tol4 \t rec_tol4 \t mean_addr_err
: > "$RESULTS_TSV"

evaluate() { # label, unstripped_elf -> appends one row to $RESULTS_TSV
  local label="$1" elf="$2"
  if [ ! -f "$elf" ]; then
    printf '%s\tMISSING_ELF\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\n' "$label" >> "$RESULTS_TSV"
    echo "$label MISSING_ELF"
    return
  fi
  local strp="$WORK/$(echo "$label" | tr ' /' '__').stripped"
  if ! m68k-elf-strip -o "$strp" "$elf" 2>/dev/null; then
    printf '%s\tSTRIP_FAIL\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\n' "$label" >> "$RESULTS_TSV"
    echo "$label STRIP_FAIL"
    return
  fi
  truth_addrs "$elf" > "$WORK/truth.txt"
  ghidra_addrs "$strp" > "$WORK/ghidra.txt"
  local nt ng
  nt=$(wc -l < "$WORK/truth.txt"); ng=$(wc -l < "$WORK/ghidra.txt")
  if [ "$ng" -eq 0 ]; then
    printf '%s\tGHIDRA_EMPTY\t%d\t0\t0\t0\t%d\t0\t0\t0\t0\t0\n' "$label" "$nt" "$nt" >> "$RESULTS_TSV"
    echo "$label GHIDRA_EMPTY (truth=$nt)"
    return
  fi
  # exact TP + tolerant TP(+-4 bytes) + mean address error for nearest-matched.
  local line
  line=$(awk -v tol=4 '
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
      printf "%d\t%d\t%d\t%d\t%d\t%.3f\t%.3f\t%.3f\t%.3f\t%.2f", nt, ng, tp, fp, fn, (ng?tp/ng:0), (nt?tp/nt:0), (ng?tp_tol/ng:0), (nt?tp_tol/nt:0), (matched?sumerr/matched:0);
    }' "$WORK/truth.txt" "$WORK/ghidra.txt")
  printf '%s\tOK\t%s\n' "$label" "$line" >> "$RESULTS_TSV"
  echo "$label OK $line"
}

echo "== PROFILE release (-O3 LTO, corpus) =="
for p in "${PROJECTS[@]}"; do
  d=$(find_project_dir "$p" || true)
  evaluate "release/$p" "${d:-/nonexistent}/out/rom.out"
done
echo "== PROFILE debug (-O1 no-LTO, build_reproducible) =="
for p in "${PROJECTS[@]}"; do
  evaluate "debug/$p" "$DEBUG_ELF_DIR/${p}_A/out/rom.out"
done

# --- Aggregate: count failures, compute honest min/max/mean prec/rec per profile ---
total_samples=$(wc -l < "$RESULTS_TSV")
failed_samples=$(awk -F'\t' '$2!="OK"{c++} END{print c+0}' "$RESULTS_TSV")
ok_samples=$((total_samples - failed_samples))

profile_stats() { # profile_prefix -> "min_prec max_prec mean_prec min_rec max_rec mean_rec n"
  awk -F'\t' -v pfx="$1" '
    $1 ~ ("^" pfx "/") && $2=="OK" {
      p=$8+0; r=$9+0; n++;
      if(n==1||p<minp) minp=p; if(n==1||p>maxp) maxp=p; sump+=p;
      if(n==1||r<minr) minr=r; if(n==1||r>maxr) maxr=r; sumr+=r;
    }
    END {
      if(n==0){ print "0 0 0 0 0 0 0"; exit }
      printf "%.3f %.3f %.3f %.3f %.3f %.3f %d\n", minp, maxp, sump/n, minr, maxr, sumr/n, n;
    }' "$RESULTS_TSV"
}
read -r rel_min_prec rel_max_prec rel_mean_prec rel_min_rec rel_max_rec rel_mean_rec rel_n <<< "$(profile_stats release)"
read -r dbg_min_prec dbg_max_prec dbg_mean_prec dbg_min_rec dbg_max_rec dbg_mean_rec dbg_n <<< "$(profile_stats debug)"

gate_ok=true
gate_reason="null"
if [ "$total_samples" -eq 0 ]; then
  gate_ok=false; gate_reason='"no samples evaluated"'
elif [ "$failed_samples" -gt "$ALLOW_FAILURES" ]; then
  gate_ok=false; gate_reason="\"$failed_samples sample(s) failed (MISSING_ELF/STRIP_FAIL/GHIDRA_EMPTY), allowed=$ALLOW_FAILURES\""
fi

# --- JSON report: per-sample rows + honest min/max/mean per profile (never a
# single curated range) + overall ok/reason. ---
{
  echo "{"
  echo "  \"schema\": \"rds-ghidra-boundary/v1\","
  echo "  \"ok\": $gate_ok,"
  echo "  \"reason\": $gate_reason,"
  echo "  \"provenance\": \"$provenance\","
  echo "  \"total_samples\": $total_samples,"
  echo "  \"ok_samples\": $ok_samples,"
  echo "  \"failed_samples\": $failed_samples,"
  echo "  \"allow_failures\": $ALLOW_FAILURES,"
  echo "  \"profiles\": {"
  echo "    \"release\": { \"n\": $rel_n, \"min_precision\": $rel_min_prec, \"max_precision\": $rel_max_prec, \"mean_precision\": $rel_mean_prec, \"min_recall\": $rel_min_rec, \"max_recall\": $rel_max_rec, \"mean_recall\": $rel_mean_rec },"
  echo "    \"debug\": { \"n\": $dbg_n, \"min_precision\": $dbg_min_prec, \"max_precision\": $dbg_max_prec, \"mean_precision\": $dbg_mean_prec, \"min_recall\": $dbg_min_rec, \"max_recall\": $dbg_max_rec, \"mean_recall\": $dbg_mean_rec }"
  echo "  },"
  echo "  \"samples\": ["
  awk -F'\t' '
    { if(NR>1) printf ",\n";
      printf "    { \"label\": \"%s\", \"status\": \"%s\", \"truth\": %s, \"ghidra\": %s, \"exact_tp\": %s, \"fp\": %s, \"fn\": %s, \"precision\": %s, \"recall\": %s, \"precision_tol4\": %s, \"recall_tol4\": %s, \"mean_addr_err\": %s }",
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12 }
    END { print "" }
  ' "$RESULTS_TSV"
  echo "  ],"
  echo "  \"note\": \"function-boundary precision/recall vs symbol-table ground truth; name resolution is NOT semantic decompilation\""
  echo "}"
} > "$OUT_DIR/ghidra-boundary-report.json"

# Self-validate the JSON we just wrote.
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$OUT_DIR/ghidra-boundary-report.json" 2>/tmp/ghidra_json_err; then
  cat /tmp/ghidra_json_err >&2
  fail "generated ghidra-boundary-report.json is not valid JSON"
fi

# Markdown/text summary alongside the JSON.
{
  echo "# Ghidra boundary benchmark"
  echo "- provenance: $provenance"
  echo "- samples: $total_samples (ok=$ok_samples failed=$failed_samples, allow_failures=$ALLOW_FAILURES)"
  echo "- release: n=$rel_n precision[min=$rel_min_prec max=$rel_max_prec mean=$rel_mean_prec] recall[min=$rel_min_rec max=$rel_max_rec mean=$rel_mean_rec]"
  echo "- debug:   n=$dbg_n precision[min=$dbg_min_prec max=$dbg_max_prec mean=$dbg_mean_prec] recall[min=$dbg_min_rec max=$dbg_max_rec mean=$dbg_mean_rec]"
  echo
  echo "| label | status | truth | ghidra | exact_tp | fp | fn | precision | recall |"
  echo "|---|---|---|---|---|---|---|---|---|"
  awk -F'\t' '{printf "| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n", $1,$2,$3,$4,$5,$6,$7,$8,$9}' "$RESULTS_TSV"
} > "$OUT_DIR/ghidra-boundary-report.md"

echo "== done =="
echo "release: n=$rel_n precision[min=$rel_min_prec max=$rel_max_prec] recall[min=$rel_min_rec max=$rel_max_rec]"
echo "debug:   n=$dbg_n precision[min=$dbg_min_prec max=$dbg_max_prec] recall[min=$dbg_min_rec max=$dbg_max_rec]"
echo "report: $OUT_DIR/ghidra-boundary-report.json ; $OUT_DIR/ghidra-boundary-report.md"

if [ "$gate_ok" = "true" ]; then
  echo "GATE PASSED"
  exit 0
else
  echo "GATE FAILED ($failed_samples/$total_samples samples failed)"
  exit 1
fi
