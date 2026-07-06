#!/usr/bin/env bash
# Builds the OPEN SGDK parity-spike fixture (src-tauri/tests/fixtures/sgdk_spike)
# into three variants from a single source: base / positive / negative.
# Reproducible; uses the SGDK debug/no-LTO path (compatible with host gcc). No
# commercial ROM. Outputs to $RDS_DECOMP_WORK/spike_fixture/<variant>/out/rom.bin.
set -uo pipefail
export LANG=C LC_ALL=C
export GDK="${GDK:-/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/src-tauri/tests/fixtures/sgdk_spike"
OUT="${RDS_DECOMP_WORK:-$HOME/.retrodev/decomp_work}/spike_fixture"
EXTRA_BASE="-fpermissive -Wno-incompatible-pointer-types"

build_variant() {
  local name="$1" flags="$2"
  local d="$OUT/$name"; rm -rf "$d"; mkdir -p "$d"
  cp -r "$SRC/src" "$d/"
  ( cd "$d" && make -f "$GDK/makefile.gen" debug CONVSYM=true \
      EXTRA_FLAGS="$EXTRA_BASE $flags" >build.log 2>&1 )
  if [ -f "$d/out/rom.bin" ]; then
    echo "$name OK sha256=$(sha256sum "$d/out/rom.bin" | cut -d' ' -f1) size=$(stat -c%s "$d/out/rom.bin")"
  else
    echo "$name FAIL (see $d/build.log)"; tail -4 "$d/build.log"; return 1
  fi
}

build_variant base     "-DROW=10"
build_variant negative "-DROW=14"

# positive = base with one byte flipped in the never-executed padding tail.
# Guarantees a DIFFERENT SHA-256 with byte-identical execution -> identical
# frames (equivalent observable behaviour). Offset 0x1FFF8 is deep in the 0xFF
# padding of a 128 KB ROM whose code is only a few KB.
POS="$OUT/positive"; rm -rf "$POS"; mkdir -p "$POS/out"
cp "$OUT/base/out/rom.bin" "$POS/out/rom.bin"
before=$(od -An -tx1 -j $((0x1FFF8)) -N1 "$POS/out/rom.bin" | tr -d ' ')
printf '\xA5' | dd of="$POS/out/rom.bin" bs=1 seek=$((0x1FFF8)) count=1 conv=notrunc status=none
echo "positive OK sha256=$(sha256sum "$POS/out/rom.bin" | cut -d' ' -f1) size=$(stat -c%s "$POS/out/rom.bin") (padding byte 0x1FFF8: $before->a5)"

echo "== spike fixture built at $OUT =="
