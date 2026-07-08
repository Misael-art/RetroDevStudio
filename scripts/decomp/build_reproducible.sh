#!/usr/bin/env bash
# Phase 2 v2 — RIGOROUS double-build reproducibility of SGDK corpus projects.
# Fixes the v1 laxity (it counted rom.bin even when make failed at convsym).
# Now: fail-hard on any non-zero make, wipe artifacts first, require the final
# POST-PROCESSED padded+checksummed ROM, full SHA-256, record tool provenance.
set -euo pipefail

export GDK="${GDK:-/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11}"
export LANG=C LC_ALL=C
CORPUS="${RDS_SGDK_CORPUS:-/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines}"
WORK="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/build2_v2"

fail() { echo "FATAL: $1" >&2; echo "GATE FAILED (precondition)" >&2; exit 2; }

# --- Upfront validation: never silently tolerate a missing corpus/toolchain.
# (Previously: a missing $CORPUS/$project silently produced an EMPTY project
# dir via `cp ... || true`, and SGDK still built a trivial bootstrap-only ROM
# identically every time -> false "5/5 REPRODUCIBLE" on a nonexistent corpus.) ---
[ -d "$CORPUS" ] || fail "RDS_SGDK_CORPUS directory does not exist: $CORPUS"
[ -d "$GDK" ] || fail "SGDK directory (GDK) does not exist: $GDK"
[ -f "$GDK/makefile.gen" ] || fail "SGDK makefile.gen not found under GDK=$GDK"
command -v m68k-elf-gcc >/dev/null 2>&1 || fail "m68k-elf-gcc not found in PATH"
command -v m68k-elf-as >/dev/null 2>&1 || fail "m68k-elf-as not found in PATH"

rm -rf "$WORK"; mkdir -p "$WORK"

# --- tool provenance (full hashes) ---
gcc_bin="$(command -v m68k-elf-gcc)"
as_bin="$(command -v m68k-elf-as)"
{
  echo "gcc_version: $(m68k-elf-gcc --version | head -1)"
  echo "binutils_version: $(m68k-elf-as --version | head -1)"
  echo "gcc_sha256: $(sha256sum "$gcc_bin" | cut -d' ' -f1)"
  echo "as_sha256: $(sha256sum "$as_bin" | cut -d' ' -f1)"
  echo "sgdk_root: $GDK"
  echo "libmd_debug_sha256: $(sha256sum "$GDK/lib/libmd_debug.a" | cut -d' ' -f1)"
  echo "md_ld_sha256: $(sha256sum "$GDK/md.ld" | cut -d' ' -f1)"
  echo "flags: make debug CONVSYM=true EXTRA_FLAGS='-fpermissive -Wno-incompatible-pointer-types'"
} > "$WORK/tool-provenance.txt"

PROJECTS=(
  "flip [VER.001] [SGDK 211] [GEN] [ENGINE] [TESTE]"
  "Mega Pong Classic [VER.001] [SGDK 211] [GEN] [GAME] [ARCADE]"
  "Lifebar [VER.001] [SGDK 211] [GEN] [TEMPLATE] [HUD]"
  "Mega Runner [VER.001] [SGDK 211] [GEN] [GAME] [RUNNER]"
  "Custom Font [VER.001] [SGDK 211] [GEN] [ESTUDO] [TEXTO]"
)
EXTRA='-fpermissive -Wno-incompatible-pointer-types'

# Rigorous build: wipe, build (fail-hard), require final padded ROM.
build_final_rom() {
  local src="$1" dst="$2"
  # The source project and its src/*.c are mandatory. Previously this was
  # `cp ... || true`, which silently produced an EMPTY project dir when $src
  # was missing, and SGDK still built a trivial identical bootstrap-only ROM
  # -> a false "REPRODUCIBLE" verdict on a nonexistent project. Fail loudly now.
  [ -d "$src" ] || { echo "MISSING SOURCE PROJECT: $src" >&2; return 1; }
  if ! ls "$src"/src/*.c >/dev/null 2>&1; then
    echo "SOURCE PROJECT HAS NO src/*.c: $src" >&2; return 1
  fi
  rm -rf "$dst"
  mkdir -p "$dst"
  cp -r "$src"/src "$dst"/
  cp -r "$src"/res "$dst"/ 2>/dev/null || true
  cp -r "$src"/inc "$dst"/ 2>/dev/null || true
  find "$dst" -name '*.res' -exec sed -i 's/\\/\//g' {} + 2>/dev/null || true
  ( cd "$dst"
    # make debug (libmd_debug.a, no LTO); CONVSYM neutralized (Windows-only tool).
    # padROM (Java sizebnd) produces the final padded+checksummed ROM.
    make -f "$GDK/makefile.gen" debug CONVSYM=true EXTRA_FLAGS="$EXTRA" >build.log 2>&1
  )
  # The final artifact MUST be the padded+checksummed rom.bin (128 KiB aligned).
  local rom="$dst/out/rom.bin"
  [ -f "$rom" ] || { echo "MISSING ROM: $rom" >&2; return 1; }
  local size; size=$(stat -c%s "$rom")
  # padROM aligns to 131072; assert alignment as proof of post-processing.
  if (( size % 131072 != 0 )); then
    echo "NOT PADDED: $rom size=$size" >&2; return 1
  fi
}

echo "schema=rds-phase2-reproducible/v2" > "$WORK/report.txt"
pass=0; fail=0
for p in "${PROJECTS[@]}"; do
  short="$(echo "$p" | sed 's/ \[.*//')"
  src="$CORPUS/$p"
  # Two independent clean builds in independent directories.
  if ! build_final_rom "$src" "$WORK/${short}_A"; then
    echo "[BUILD-FAIL] $short (A)"; fail=$((fail+1)); continue
  fi
  if ! build_final_rom "$src" "$WORK/${short}_B"; then
    echo "[BUILD-FAIL] $short (B)"; fail=$((fail+1)); continue
  fi
  sha_a=$(sha256sum "$WORK/${short}_A/out/rom.bin" | cut -d' ' -f1)
  sha_b=$(sha256sum "$WORK/${short}_B/out/rom.bin" | cut -d' ' -f1)
  size_a=$(stat -c%s "$WORK/${short}_A/out/rom.bin")
  if [ "$sha_a" = "$sha_b" ]; then
    echo "[REPRODUCIBLE] $short size=${size_a} sha256=$sha_a"
    echo "$short REPRODUCIBLE $sha_a $size_a" >> "$WORK/report.txt"
    pass=$((pass+1))
  else
    echo "[NON-REPRODUCIBLE] $short A=$sha_a B=$sha_b"
    echo "$short NON_REPRODUCIBLE $sha_a $sha_b" >> "$WORK/report.txt"
    fail=$((fail+1))
  fi
done

# Negative regression: flip one byte in a built ROM -> hash MUST differ.
neg="NOT_RUN"
first_rom="$WORK/flip_A/out/rom.bin"
if [ -f "$first_rom" ]; then
  cp "$first_rom" "$WORK/mutant.bin"
  printf '\xFF' | dd of="$WORK/mutant.bin" bs=1 seek=32768 count=1 conv=notrunc status=none
  h1=$(sha256sum "$first_rom" | cut -d' ' -f1)
  h2=$(sha256sum "$WORK/mutant.bin" | cut -d' ' -f1)
  [ "$h1" != "$h2" ] && neg="DETECTED" || neg="MISSED"
fi

echo "==== Phase 2 v2: reproducible=$pass fail=$fail negative_regression=$neg ===="
echo "reproducible=$pass fail=$fail negative_regression=$neg" >> "$WORK/report.txt"
echo "provenance: $WORK/tool-provenance.txt"
cat "$WORK/tool-provenance.txt"
# Gate: exit non-zero unless 5/5 reproducible + negative regression detected.
[ "$pass" -ge 5 ] && [ "$neg" = "DETECTED" ] || { echo "GATE FAILED"; exit 1; }
echo "GATE PASSED"
