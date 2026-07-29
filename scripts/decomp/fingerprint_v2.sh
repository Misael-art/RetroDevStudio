#!/usr/bin/env bash
# Fingerprint M68K v2 — corrects the v1 methodology.
# v1 used objdump -d labels (imprecise) and truncated hashes. v2:
#   - boundaries from the ELF symbol table (F .text: address + size)
#   - validates each range lies within .text
#   - FULL SHA-256 over the exact function bytes
#   - hash -> {identities} map; separates raw_byte_hit from unique_resolution
#   - reports coverage by function COUNT and by BYTES
#   - runtime SGDK vs game-specific reported separately
#
# Fail-hard by design: `set -e` is NOT used because a per-ELF absence of F .text
# symbols is a legitimate, tolerated case (documented in process_elf); overall
# corpus-level tolerance is instead controlled explicitly below via auditable
# minimum-threshold checks before any manifest is declared valid.
set -uo pipefail

CORPUS="${RDS_SGDK_CORPUS:-/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines}"
WORK="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/m68k_fp_v2"
OBJDUMP=m68k-elf-objdump
OBJCOPY=m68k-elf-objcopy

# Minimum thresholds (auditable, env-overridable). A value of 0 found at
# runtime means "empty corpus" and must fail the gate.
MIN_ELFS="${RDS_FP_MIN_ELFS:-1}"
MIN_FUNCTIONS="${RDS_FP_MIN_FUNCTIONS:-1}"

fail() { echo "FATAL: $1" >&2; echo "GATE FAILED (precondition)" >&2; exit 2; }

# --- Upfront validation ---
[ -d "$CORPUS" ] || fail "RDS_SGDK_CORPUS directory does not exist: $CORPUS"
command -v "$OBJDUMP" >/dev/null 2>&1 || fail "$OBJDUMP not found in PATH"
command -v "$OBJCOPY" >/dev/null 2>&1 || fail "$OBJCOPY not found in PATH"

rm -rf "$WORK"; mkdir -p "$WORK"
FP="$WORK/fingerprints.tsv"   # project \t name \t size \t sha256
: > "$FP"
invalid=0

# Toolchain provenance stamped into every record set.
TOOLCHAIN="gcc16.1.0+binutils2.46.1"

process_elf() {
  local proj="$1" elf="$2"
  # .text VMA (col 4) and file offset (col 6), plus size (col 3).
  local hline; hline=$("$OBJDUMP" -h "$elf" 2>/dev/null | grep -E '^[[:space:]]*[0-9]+ \.text ' | head -1)
  [ -n "$hline" ] || return 0
  local tsize tvma toff
  tsize=$((16#$(echo "$hline" | awk '{print $3}')))
  tvma=$((16#$(echo "$hline" | awk '{print $4}')))
  toff=$((16#$(echo "$hline" | awk '{print $6}')))
  local tend=$((tvma + tsize))
  # Dump .text once; function bytes read from this blob at (addr - tvma).
  "$OBJCOPY" -O binary --only-section=.text "$elf" "$WORK/text.bin" 2>/dev/null || return 0

  # Each F .text symbol -> addr, size, name. Capture first (tolerate no matches).
  local syms
  syms=$("$OBJDUMP" -t "$elf" 2>/dev/null | grep -E ' F \.text\b' || true)
  [ -n "$syms" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local addr size name
    addr=$((16#$(echo "$line" | awk '{print $1}')))
    # after the tab: "<size> <name>"
    local rest; rest="${line#*$'\t'}"
    size=$((16#$(echo "$rest" | awk '{print $1}')))
    name=$(echo "$rest" | awk '{print $2}')
    [ "$size" -gt 0 ] || continue
    # Validate the range lies fully within .text.
    if [ "$addr" -lt "$tvma" ] || [ $((addr + size)) -gt "$tend" ]; then
      echo "INVALID $proj $name addr=$addr size=$size" >> "$WORK/invalid.log"
      continue
    fi
    local off=$((addr - tvma))
    local sha
    sha=$(tail -c +$((off + 1)) "$WORK/text.bin" | head -c "$size" | sha256sum | cut -d' ' -f1)
    printf '%s\t%s\t%s\t%s\n' "$proj" "$name" "$size" "$sha" >> "$FP"
  done <<< "$syms"
}

echo "== extracting v2 fingerprints (symbol-table boundaries, full sha256) =="
n=0
while IFS= read -r elf; do
  proj="$(basename "$(dirname "$(dirname "$elf")")" | sed 's/ \[.*//')"
  process_elf "$proj" "$elf"
  n=$((n+1))
done < <(find "$CORPUS" -maxdepth 3 -type f -name 'rom.out' 2>/dev/null | sort)
[ -f "$WORK/invalid.log" ] && invalid=$(wc -l < "$WORK/invalid.log") || invalid=0

total=$(wc -l < "$FP")
uniq_hashes=$(cut -f4 "$FP" | sort -u | wc -l)

# --- Empty-corpus guard: fail explicitly rather than emit an all-zero JSON
# manifest that a naive caller might read as "GATE PASSED". ---
if [ "$n" -lt "$MIN_ELFS" ]; then
  fail "elfs_processed ($n) below minimum ($MIN_ELFS) — empty or missing corpus under $CORPUS"
fi
if [ "$total" -lt "$MIN_FUNCTIONS" ]; then
  fail "function_instances ($total) below minimum ($MIN_FUNCTIONS) — no F .text symbols extracted"
fi

# hash -> distinct names. Ambiguous = a hash mapping to >1 distinct name.
# unique_resolution instances = function instances whose hash maps to exactly 1 name.
ambiguous_hashes=$(awk -F'\t' '{names[$4][$2]=1}
END{ c=0; for(h in names){ n=0; for(nm in names[h]) n++; if(n>1) c++ } print c }' "$FP")
unambiguous_hashes=$((uniq_hashes - ambiguous_hashes))

# Per-instance resolution.
read -r instances unique_resolution ambiguous_instances unique_resolution_rate <<< "$(awk -F'\t' '
{ recs[NR]=$0; hashname[$4][$2]=1 }
END{
  tot=0; uniq=0; ambig=0;
  for(i=1;i<=NR;i++){ split(recs[i],f,"\t"); h=f[4];
    c=0; for(x in hashname[h]) c++;
    tot++; if(c==1) uniq++; else ambig++ }
  printf "%d %d %d %.3f\n", tot, uniq, ambig, (tot>0?uniq/tot:0);
}' "$FP")"

# Runtime vs game-specific: a name seen in >=3 distinct projects OR matching an
# SGDK runtime prefix counts as runtime library; else game-specific.
read -r runtime_names runtime_bytes game_specific_names game_specific_bytes <<< "$(awk -F'\t' '
{ projset[$2][$1]=1; size[$2]=$3 }
END{
  rt_fn=0; gs_fn=0; rt_by=0; gs_by=0;
  for(nm in projset){ np=0; for(p in projset[nm]) np++;
    isrt = (np>=3) || (nm ~ /^(SYS_|VDP_|DMA_|Z80_|YM2612_|SPR_|SPRITES_|PAL_|MEM_|JOY_|TSK_|SND_|XGM|PSG_|BMP_|TRM_|MAP_|TILE|_start|__)/);
    if(isrt){ rt_fn++; rt_by+=size[nm] } else { gs_fn++; gs_by+=size[nm] } }
  printf "%d %d %d %d\n", rt_fn, rt_by, gs_fn, gs_by;
}' "$FP")"

total_bytes=$(awk -F'\t' '{s+=$3} END{print s+0}' "$FP")

# --- Machine-readable manifest: every numeric field is a real JSON number,
# never an embedded "key=value" text blob (that was the v1 bug: an unescaped
# grep-substring match embedded a raw newline as a JSON key). ---
cat > "$WORK/fingerprint-v2-manifest.json" <<EOF
{
  "schema": "rds-m68k-fingerprint/v2",
  "ok": true,
  "toolchain": "$TOOLCHAIN",
  "method": "symbol-table F .text boundaries (addr+size), range-validated, full sha256",
  "elfs_processed": $n,
  "function_instances": $total,
  "function_bytes": $total_bytes,
  "unique_full_sha256": $uniq_hashes,
  "invalid_ranges_skipped": $invalid,
  "ambiguous_hashes": $ambiguous_hashes,
  "unambiguous_hashes": $unambiguous_hashes,
  "unique_resolution": $unique_resolution,
  "ambiguous_instances": $ambiguous_instances,
  "unique_resolution_rate": $unique_resolution_rate,
  "runtime_names": $runtime_names,
  "runtime_bytes": $runtime_bytes,
  "game_specific_names": $game_specific_names,
  "game_specific_bytes": $game_specific_bytes,
  "note_v1_60_3pct": "PRELIMINARY byte-hit only; superseded by unique_resolution_rate above",
  "note_unique_resolution": "byte-identity resolution to a single unambiguous name, NOT semantic/source-code recovery"
}
EOF

# Self-validate the JSON we just wrote (Node is an already-approved dependency).
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$WORK/fingerprint-v2-manifest.json" 2>/tmp/fp_json_err; then
  cat /tmp/fp_json_err >&2
  fail "generated fingerprint-v2-manifest.json is not valid JSON"
fi

echo "==== Fingerprint v2 ===="
echo "elfs=$n instances=$total bytes=$total_bytes unique_sha256=$uniq_hashes invalid=$invalid"
echo "ambiguous_hashes=$ambiguous_hashes unambiguous_hashes=$unambiguous_hashes"
echo "instances=$instances unique_resolution=$unique_resolution ambiguous_instances=$ambiguous_instances unique_resolution_rate=$unique_resolution_rate"
echo "runtime_names=$runtime_names runtime_bytes=$runtime_bytes game_specific_names=$game_specific_names game_specific_bytes=$game_specific_bytes"
echo "manifest: $WORK/fingerprint-v2-manifest.json (valid JSON, self-checked)"
echo "GATE PASSED"
