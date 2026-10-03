#!/usr/bin/env bash
# Constrói o fixture REX LZ4W autoral com o SGDK pinado pelo lock do host.
#
# Saída (--out DIR): project/ (fonte + boot copiado pelo makefile.gen),
# out/rom.bin (a ROM do fixture) e fixture-build-report.json com SHA-256 de
# ROM, fontes, toolchain e o resultado da conferência do header LZ4W.
#
# A ROM NÃO vai para o git: é artefato reconstruído a partir de fontes
# autoriais + toolchain oficial, e o teste de aceite a consome por caminho
# explícito (RDS_REX_LZ4W_FIXTURE_ROM), como os fixtures de logic-recovery.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || { echo "uso: build-fixture.sh --out DIR" >&2; exit 2; }

sgdk_root() {
  local cand
  for cand in "${SGDK_ROOT:-}" "${GDK:-}" "${SGDK:-}"; do
    [ -n "$cand" ] && [ -f "$cand/makefile.gen" ] && { echo "$cand"; return 0; }
  done
  local cache
  cache="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.paths.native_cache)' \
    "$REPO/src-tauri/target-test/validation/host-readiness.json" 2>/dev/null || true)"
  [ -n "$cache" ] && [ -f "$cache/toolchains/sgdk/makefile.gen" ] && { echo "$cache/toolchains/sgdk"; return 0; }
  return 1
}
m68k_root() {
  local cache="$1"
  [ -x "$cache/toolchains/m68k-elf/bin/m68k-elf-gcc" ] && { echo "$cache/toolchains/m68k-elf"; return 0; }
  command -v m68k-elf-gcc >/dev/null 2>&1 && { echo ""; return 0; }
  return 1
}

SDK="$(sgdk_root)" || { echo "FATAL: SGDK (makefile.gen) não localizado; configure SGDK_ROOT/GDK" >&2; exit 3; }
CACHE="$(dirname "$(dirname "$SDK")")"
M68K="$(m68k_root "$CACHE")" || { echo "FATAL: m68k-elf-gcc ausente" >&2; exit 4; }

command -v java >/dev/null 2>&1 || { echo "FATAL: java ausente (rescomp.jar)" >&2; exit 5; }

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$HERE/project" "$OUT/project"
cp "$HERE/gen_fixture.py" "$OUT/gen_fixture.py"
mkdir -p "$OUT/project/inc"
python3 "$OUT/gen_fixture.py" "$OUT/project"

export SGDK="$SDK"
export PATH="$M68K/bin:$SDK/bin:$PATH"
( cd "$OUT/project" && make >/dev/null )

ROM="$OUT/project/out/rom.bin"
[ -f "$ROM" ] || { echo "FATAL: make não produziu $ROM" >&2; exit 6; }

python3 - "$ROM" "$OUT" <<'PY'
import hashlib, json, os, struct, sys
rom_path, out_dir = sys.argv[1], sys.argv[2]
rom = open(rom_path, "rb").read()
truth = json.load(open(os.path.join(out_dir, "project", "ground_truth.json")))
count = truth["tile_count"]
hits = []
for off in range(0, len(rom) - 8, 2):
    comp, nt = struct.unpack_from(">HH", rom, off)
    ptr = struct.unpack_from(">I", rom, off + 4)[0]
    if comp == 2 and nt == count and ptr < len(rom):
        hits.append({"header_offset": off, "stream_offset": ptr, "num_tiles": nt,
                     "expected_len": nt * 32})
if not hits:
    # compressão que perde para o dado cru é descartada pelo rescomp (comp=0):
    # o fixture precisa comprimir, senão não há recurso LZ4W para o produto.
    sys.stderr.write("FATAL: nenhum header TileSet com compression=2 no ROM do fixture\n")
    sys.exit(7)
if len(hits) != 1:
    sys.stderr.write("FATAL: esperado 1 recurso LZ4W, encontrados %d\n" % len(hits))
    sys.exit(8)
report = {
    "schema": "rex-lz4w-fixture-build/v1",
    "authored_fixture": True,
    "byor": False,
    "rom_path": os.path.abspath(rom_path),
    "rom_sha256": hashlib.sha256(rom).hexdigest(),
    "rom_len": len(rom),
    "resource": hits[0],
    "ground_truth": truth,
}
with open(os.path.join(out_dir, "fixture-build-report.json"), "w") as fh:
    json.dump(report, fh, indent=2)
print(json.dumps({"rom_sha256": report["rom_sha256"], "resource": hits[0]}, indent=2))
PY

python3 - "$OUT" "$SDK" <<'PY'
import hashlib, json, os, sys
out_dir, sdk = sys.argv[1], sys.argv[2]
paths = {
    "gen_fixture.py": os.path.join(out_dir, "gen_fixture.py"),
    "src/main.c": os.path.join(out_dir, "project", "src", "main.c"),
    "res/main.res": os.path.join(out_dir, "project", "res", "main.res"),
    "makefile": os.path.join(out_dir, "project", "makefile"),
    "res/tiles.png": os.path.join(out_dir, "project", "res", "tiles.png"),
    "toolchain/libmd.a": os.path.join(sdk, "lib", "libmd.a"),
    "toolchain/rescomp.jar": os.path.join(sdk, "bin", "rescomp.jar"),
}
digests = {}
for label, path in paths.items():
    try:
        with open(path, "rb") as fh:
            digests[label] = {"sha256": hashlib.sha256(fh.read()).hexdigest(),
                              "bytes": os.path.getsize(path)}
    except OSError:
        digests[label] = {"sha256": None, "bytes": None}
report_path = os.path.join(out_dir, "fixture-build-report.json")
report = json.load(open(report_path))
report["source_sha256"] = digests
report["sgdk_root"] = sdk
json.dump(report, open(report_path, "w"), indent=2)
print("fixture-build-report.json atualizado")
PY

echo "OK: fixture em $OUT/project/out/rom.bin"
