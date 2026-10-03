#!/usr/bin/env bash
# Constrói a ROM do harness LZ4W-variantes com a toolchain OFICIAL embutida no
# SGDK 2.11 (cpp/as/ld/objdump/objcopy/ar sob wine) e PROVA que o desempacotador
# montado é byte-idêntico ao da libmd.a oficial (extraída com ar.exe).
# NADA daqui entra no produto: é ferramenta externa de medição (LGPL, apenas
# executamos a referência; nenhum código é transplantado).
set -euo pipefail

SDK="${GDK:-/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11}"
BIN="$SDK/bin"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${1:?uso: build-rom.sh <workdir> <cases-out>}"
CASES="$2"
mkdir -p "$WORK/obj"

wine_tool() { timeout 120 wine "$BIN/$1.exe" "${@:2}" 2>&1 | grep -v -E 'fixme|err:' || true; }
# wrapper com rc real (pipes engolem rc): usa pipefail + captura
run_wine() { # $1=exe resto=args ; imprime stdout sem ruído wine; rc propagado
  local exe="$1"; shift
  set +e
  timeout 120 wine "$BIN/$exe.exe" "$@" >"$WORK/obj/.wine-out" 2>"$WORK/obj/.wine-err"
  local rc=$?
  set -e
  grep -v -E 'fixme|err:' "$WORK/obj/.wine-out" || true
  if [ $rc -ne 0 ]; then grep -v -E 'fixme|err:' "$WORK/obj/.wine-err" >&2 || true; fi
  return $rc
}

# --- 1) official.s = ferramentas OFFICIALS (verbatims) ---------------------
# cpp expande '#include "asm_mac.i"' (mesmo preprocessador do build SGDK; só
# macros — nenhuma alteração de instruções). cpp.exe acha cc1.exe pelo caminho
# WINDOWS do bin (prefixo wine do host mapeia /mnt/sdcard -> G:).
WINBIN=$(printf '%s' "$BIN" | sed 's|^/mnt/sdcard|G:|' | tr '/' '\\')
case "$WINBIN" in
  G:\\*) : ;;
  *) echo "FATAL: mapeamento wine /mnt/sdcard -> G: ausente (prefixo do host)"; exit 5 ;;
esac
run_wine cpp -B "${WINBIN}\\" -I "$SDK/inc" -P -o "$WORK/obj/official.s" "$SDK/src/tools_a.s" \
  || { grep -v -E 'fixme|err:' "$WORK/obj/.wine-err" >&2; exit 3; }

# --- 2) master.s amarra harness + official + tabela de casos ---------------
cat > "$WORK/obj/master.s" <<'EOF'
.include "harness.s"
.include "official.s"
.include "table.s"
EOF
cp "${HARNESS:-$HERE/harness.s}" "$WORK/obj/harness.s"
cp "${TABLE:-$CASES/table.s}" "$WORK/obj/table.s"

run_wine as -m68000 --register-prefix-optional --bitwise-or \
  -I "$WORK/obj" -o "$WORK/obj/master.o" "$WORK/obj/master.s"

# --- 3) prova de identidade: bytes da FUNÇÃO oficial vs libmd.a ------------
mkdir -p "$WORK/obj/libmd"
( cd "$WORK/obj/libmd" && run_wine ar x "$SDK/lib/libmd.a" tools_a.o )
# nomes de seção: func _name -> .text.asm.lz4w_unpack
sz_of() { # <obj> <section> -> bytes (sem cabeçalho)
  run_wine objdump -h "$1" | awk -v s="$2" '$2==s {print strtonum("0x" $3)}'
}
MYSZ=$(sz_of "$WORK/obj/master.o" ".text.asm.lz4w_unpack")
LIBSZ=$(sz_of "$WORK/obj/libmd/tools_a.o" ".text.asm.lz4w_unpack")
run_wine objcopy -j .text.asm.lz4w_unpack -O binary --gap-fill 0x00 \
  "$WORK/obj/master.o" "$WORK/obj/mine.bin"
run_wine objcopy -j .text.asm.lz4w_unpack -O binary --gap-fill 0x00 \
  "$WORK/obj/libmd/tools_a.o" "$WORK/obj/lib.bin"
if [ "$MYSZ" != "$LIBSZ" ] || ! cmp -s "$WORK/obj/mine.bin" "$WORK/obj/lib.bin"; then
  echo "FATAL: desempacotador montado DIFERE do oficial (mine=$MYSZ lib=$LIBSZ)"; exit 4
fi
echo "identidade-oficial: OK ($(stat -c%s "$WORK/obj/mine.bin") bytes, sha256=$(sha256sum "$WORK/obj/mine.bin" | cut -d' ' -f1))"

# --- 4) link + bin + padding ----------------------------------------------
cat > "$WORK/obj/rom.ld" <<'EOF'
SECTIONS {
  . = 0x00000000;
  .text : { *(.text.vectors) *(.text.asm.qsort) *(.text.asm.lz4w_unpack)
            *(.text) *(.rodata) }
  /DISCARD/ : { *(.comment) *(.note*) *(.debug*) }
}
EOF
run_wine ld -T "$WORK/obj/rom.ld" -o "$WORK/obj/rom.elf" "$WORK/obj/master.o"
run_wine objcopy -O binary "$WORK/obj/rom.elf" "$WORK/rom.raw"
python3 - "$WORK/rom.bin" <<'EOF'
import sys
from pathlib import Path
p = Path(sys.argv[1]); data = Path(str(p).replace('.bin', '.raw')).read_bytes()
n = (len(data) + 0x7FFFF) & ~0x7FFFF  # pad to 512 KiB
p.write_bytes(data + b"\x00" * (n - len(data)))
print(f"rom_size={n}")
EOF
rm -f "$WORK/rom.raw"
echo "rom=$WORK/rom.bin sha256=$(sha256sum "$WORK/rom.bin" | cut -d' ' -f1)"
