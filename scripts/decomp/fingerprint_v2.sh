#!/usr/bin/env bash
# Fingerprint M68K v2 — corrects the v1 methodology.
# v1 used objdump -d labels (imprecise) and truncated hashes. v2:
#   - boundaries from the ELF symbol table (F .text: address + size)
#   - validates each range lies within .text
#   - FULL SHA-256 over the exact function bytes
#   - hash -> {identities} map; separates raw_byte_hit from unique_resolution
#   - reports coverage by function COUNT and by BYTES
#   - runtime SGDK vs game-specific reported separately
set -uo pipefail   # not -e: some corpus ELFs legitimately lack F .text symbols
CORPUS="${RDS_SGDK_CORPUS:-/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines}"
WORK="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/m68k_fp_v2"
rm -rf "$WORK"; mkdir -p "$WORK"
OBJDUMP=m68k-elf-objdump
OBJCOPY=m68k-elf-objcopy
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
done < <(find "$CORPUS" -maxdepth 3 -type f -name 'rom.out' | sort)
[ -f "$WORK/invalid.log" ] && invalid=$(wc -l < "$WORK/invalid.log") || invalid=0

total=$(wc -l < "$FP")
uniq_hashes=$(cut -f4 "$FP" | sort -u | wc -l)

# hash -> distinct names. Ambiguous = a hash mapping to >1 distinct name.
# unique_resolution instances = function instances whose hash maps to exactly 1 name.
awk -F'\t' '{names[$4][$2]=1; proj[$2][$1]=1; sz[$2]=$3}
END{
  amb_hashes=0; unamb_hashes=0;
  for(h in names){ c=0; for(nm in names[h]) c++; if(c>1) amb_hashes++; else unamb_hashes++ }
  print "ambiguous_hashes="amb_hashes;
  print "unambiguous_hashes="unamb_hashes;
}' "$FP" > "$WORK/ambiguity.txt"

# Per-instance: raw_byte_hit is trivially 100% within the corpus (every function
# matches itself); the meaningful number is unique_resolution rate = fraction of
# instances whose hash is globally unambiguous.
awk -F'\t' '
{ recs[NR]=$0; hashname[$4][$2]=1 }
END{
  tot=0; uniq=0; ambig=0;
  for(i=1;i<=NR;i++){ split(recs[i],f,"\t"); h=f[4]; nm=f[2];
    c=0; for(x in hashname[h]) c++;
    tot++; if(c==1) uniq++; else ambig++ }
  printf "instances=%d unique_resolution=%d ambiguous_instances=%d unique_resolution_rate=%.3f\n", tot, uniq, ambig, (tot>0?uniq/tot:0);
}' "$FP" > "$WORK/resolution.txt"

# Runtime vs game-specific: a name seen in >=3 distinct projects OR matching an
# SGDK runtime prefix counts as runtime library; else game-specific.
awk -F'\t' '
{ projset[$2][$1]=1; size[$2]=$3 }
END{
  rt_fn=0; gs_fn=0; rt_by=0; gs_by=0;
  for(nm in projset){ np=0; for(p in projset[nm]) np++;
    isrt = (np>=3) || (nm ~ /^(SYS_|VDP_|DMA_|Z80_|YM2612_|SPR_|SPRITES_|PAL_|MEM_|JOY_|TSK_|SND_|XGM|PSG_|BMP_|TRM_|MAP_|TILE|_start|__)/);
    if(isrt){ rt_fn++; rt_by+=size[nm] } else { gs_fn++; gs_by+=size[nm] } }
  printf "runtime_names=%d runtime_bytes=%d game_specific_names=%d game_specific_bytes=%d\n", rt_fn, rt_by, gs_fn, gs_by;
}' "$FP" > "$WORK/categories.txt"

total_bytes=$(awk -F'\t' '{s+=$3} END{print s}' "$FP")

cat > "$WORK/fingerprint-v2-manifest.json" <<EOF
{
  "schema": "rds-m68k-fingerprint/v2",
  "toolchain": "$TOOLCHAIN",
  "method": "symbol-table F .text boundaries (addr+size), range-validated, full sha256",
  "elfs_processed": $n,
  "function_instances": $total,
  "function_bytes": $total_bytes,
  "unique_full_sha256": $uniq_hashes,
  "invalid_ranges_skipped": $invalid,
  "$(grep ambiguous_hashes "$WORK/ambiguity.txt")": null,
  "resolution": "$(cat "$WORK/resolution.txt")",
  "ambiguity": "$(tr '\n' ' ' < "$WORK/ambiguity.txt")",
  "categories": "$(cat "$WORK/categories.txt")",
  "note_v1_60_3pct": "PRELIMINARY byte-hit only; superseded by unique_resolution_rate above"
}
EOF
echo "==== Fingerprint v2 ===="
echo "elfs=$n instances=$total bytes=$total_bytes unique_sha256=$uniq_hashes invalid=$invalid"
cat "$WORK/ambiguity.txt"; cat "$WORK/resolution.txt"; cat "$WORK/categories.txt"
echo "manifest: $WORK/fingerprint-v2-manifest.json"
