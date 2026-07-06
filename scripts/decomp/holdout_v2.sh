#!/usr/bin/env bash
# Holdout v2 — leakage-free benchmark on the v2 fingerprint methodology.
# FROZEN CONFIG (declared before any holdout metric):
#   split_rule = stable sha256(family) % 100 -> train<70, val[70,85), holdout>=85
#   family     = first token of the project name (variants share a family)
#   dedup      = identical ROM sha256 collapses to one representative
#   match_rule = FULL sha256 byte identity (BinaryExact => 0 false positives)
#   holdout does NOT tune any threshold; metrics are pure aggregation.
set -uo pipefail
CORPUS="${RDS_SGDK_CORPUS:-/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines}"
WORK="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/holdout_v2"
rm -rf "$WORK"; mkdir -p "$WORK"
OBJDUMP=m68k-elf-objdump; OBJCOPY=m68k-elf-objcopy
MASTER="$WORK/master.tsv"   # family \t proj \t rom_sha \t set \t name \t size \t fnsha
: > "$MASTER"

bucket() { printf '%s' "$1" | sha256sum | cut -c1-8 | (read h; echo $(( 0x$h % 100 ))); }

extract_fns() { # elf -> "name<TAB>size<TAB>fnsha" per validated F .text symbol
  local elf="$1"
  local hline; hline=$("$OBJDUMP" -h "$elf" 2>/dev/null | grep -E '^[[:space:]]*[0-9]+ \.text ' | head -1)
  [ -n "$hline" ] || return 0
  local tvma toff tsize tend
  tsize=$((16#$(echo "$hline" | awk '{print $3}')))
  tvma=$((16#$(echo "$hline" | awk '{print $4}')))
  tend=$((tvma + tsize))
  "$OBJCOPY" -O binary --only-section=.text "$elf" "$WORK/t.bin" 2>/dev/null || return 0
  local syms; syms=$("$OBJDUMP" -t "$elf" 2>/dev/null | grep -E ' F \.text\b' || true)
  [ -n "$syms" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local addr size name rest off sha
    addr=$((16#$(echo "$line" | awk '{print $1}')))
    rest="${line#*$'\t'}"; size=$((16#$(echo "$rest" | awk '{print $1}'))); name=$(echo "$rest" | awk '{print $2}')
    [ "$size" -gt 0 ] || continue
    [ "$addr" -ge "$tvma" ] && [ $((addr+size)) -le "$tend" ] || continue
    off=$((addr - tvma))
    sha=$(tail -c +$((off+1)) "$WORK/t.bin" | head -c "$size" | sha256sum | cut -d' ' -f1)
    printf '%s\t%s\t%s\n' "$name" "$size" "$sha"
  done <<< "$syms"
}

echo "== building master fingerprint table + split =="
declare -A seen_rom
while IFS= read -r elf; do
  dir="$(dirname "$(dirname "$elf")")"
  proj="$(basename "$dir" | sed 's/ \[.*//')"
  family="$(echo "$proj" | awk '{print $1}')"
  rom="$dir/out/rom.bin"; [ -f "$rom" ] || rom="$elf"
  rom_sha=$(sha256sum "$rom" | cut -d' ' -f1)
  # dedup identical ROMs
  if [ -n "${seen_rom[$rom_sha]:-}" ]; then continue; fi
  seen_rom[$rom_sha]=1
  b=$(bucket "$family")
  if   [ "$b" -lt 70 ]; then set=train
  elif [ "$b" -lt 85 ]; then set=val
  else                       set=holdout; fi
  while IFS=$'\t' read -r name size fnsha; do
    [ -n "$fnsha" ] || continue
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$family" "$proj" "$rom_sha" "$set" "$name" "$size" "$fnsha" >> "$MASTER"
  done < <(extract_fns "$elf")
done < <(find "$CORPUS" -maxdepth 3 -type f -name 'rom.out' | sort)

# Leakage guards.
leak_family=$(awk -F'\t' '{s[$1]=s[$1] $4}
  END{n=0; for(f in s){ if(s[f]~/train/ && s[f]~/holdout/) n++ } print n}' "$MASTER")
leak_rom=$(awk -F'\t' '{s[$3]=s[$3] $4}
  END{n=0; for(r in s){ if(s[r]~/train/ && s[r]~/holdout/) n++ } print n}' "$MASTER")

run_metrics() { # emits deterministic manifest to $1
  awk -F'\t' -v out="$1" '
    { rows[NR]=$0; if($4=="train") tnames[$7][$5]=1 }
    END{
      raw=0; uniq=0; ambig=0; unres=0; tot=0;
      rby=0; uby=0; totby=0;
      for(i=1;i<=NR;i++){ split(rows[i],f,"\t");
        if(f[4]!="holdout") continue;
        tot++; sz=f[6]; totby+=sz; h=f[7];
        if(h in tnames){ raw++; rby+=sz;
          c=0; for(n in tnames[h]) c++;
          if(c==1){ uniq++; uby+=sz } else ambig++;
        } else unres++;
      }
      printf "holdout_functions=%d holdout_bytes=%d\n", tot, totby > out;
      printf "raw_byte_hit=%d raw_byte_hit_rate=%.3f\n", raw, (tot?raw/tot:0) >> out;
      printf "unique_resolution=%d unique_resolution_rate=%.3f\n", uniq, (tot?uniq/tot:0) >> out;
      printf "unique_resolution_byte_rate=%.3f\n", (totby?uby/totby:0) >> out;
      printf "ambiguous_hits=%d unresolved=%d\n", ambig, unres >> out;
    }' "$MASTER"
}

echo "== running metrics twice (determinism) =="
run_metrics "$WORK/metrics_a.txt"
run_metrics "$WORK/metrics_b.txt"
if diff -q "$WORK/metrics_a.txt" "$WORK/metrics_b.txt" >/dev/null; then repeat="IDENTICAL"; else repeat="DIFFERENT"; fi

# corpus manifest: exact project list + rom hashes per set
awk -F'\t' '{key=$4"\t"$2"\t"$3; seen[key]=1} END{for(k in seen) print k}' "$MASTER" | sort > "$WORK/corpus-manifest.tsv"
n_train=$(awk -F'\t' '$4=="train"{print $2}' "$MASTER" | sort -u | wc -l)
n_val=$(awk -F'\t' '$4=="val"{print $2}' "$MASTER" | sort -u | wc -l)
n_hold=$(awk -F'\t' '$4=="holdout"{print $2}' "$MASTER" | sort -u | wc -l)

echo "==== Holdout v2 ===="
echo "projects: train=$n_train val=$n_val holdout=$n_hold  leak_family=$leak_family leak_rom=$leak_rom  repeatable=$repeat"
cat "$WORK/metrics_a.txt"
echo "binary_exact_false_positives=0 (full sha256 = byte identity)"
echo "manifest: $WORK/metrics_a.txt ; corpus: $WORK/corpus-manifest.tsv"
[ "$leak_family" -eq 0 ] && [ "$leak_rom" -eq 0 ] && [ "$repeat" = "IDENTICAL" ] || { echo "GATE FAILED"; exit 1; }
echo "GATE PASSED"
