#!/usr/bin/env bash
# Constrói o fixture REX de contexto aPLib com o SGDK pinado pelo lock do host.
#
# Saída (--out DIR): project/ (fontes + boot), out/rom.bin e
# fixture-build-report.json com SHA-256 de ROM, fontes e toolchain, os offsets
# dos recursos no artefato e a conferência de que TileSet e os dois TileMaps
# estão comprimidos com APLIB (campo compression == 1) no ROM compilado.
#
# A ROM NÃO vai para o git: é artefato reconstruído de fontes autoriais +
# toolchain oficial, consumida por caminho explícito (RDS_REX_CTX_FIXTURE_ROM).
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
# O esperado é escrito ANTES de qualquer compilação: gen_fixture.py só conhece
# constantes de autoria e a semântica do rescomp lida no SDK pinado.
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
APLIB = 1  # Compression.AUTO=0, NONE=1, APLIB=2, LZ4W=3 -> rescomp grava ordinal()-1

def find_tileset(comp, num_tile):
    hits = []
    for off in range(0, len(rom) - 8, 2):
        c, nt = struct.unpack_from(">HH", rom, off)
        ptr = struct.unpack_from(">I", rom, off + 4)[0]
        if c == comp and nt == num_tile and 0 < ptr < len(rom):
            hits.append({"header_offset": off, "stream_offset": ptr, "num_tile": nt})
    return hits

def find_tilemap(comp, w, h):
    hits = []
    for off in range(0, len(rom) - 8, 2):
        c, mw, mh = struct.unpack_from(">HHH", rom, off)
        ptr = struct.unpack_from(">I", rom, off + 6)[0]
        if c == comp and mw == w and mh == h and 0 < ptr < len(rom):
            hits.append({"header_offset": off, "stream_offset": ptr, "w": w, "h": h})
    return hits

def find_palette(num_color):
    hits = []
    for off in range(0, len(rom) - 6, 2):
        n = struct.unpack_from(">H", rom, off)[0]
        ptr = struct.unpack_from(">I", rom, off + 2)[0]
        if n == num_color and 0 < ptr < len(rom):
            hits.append({"header_offset": off, "stream_offset": ptr, "num_color": n})
    return hits

# Conferencia assistida por simbolo: o scan acima acha o header pelo padrao de
# bytes; o dump do linker (out/symbol.txt) declara endereco e tamanho por nome.
# As duas fontes tem que concordar, senao o scan casou com coincidencia. No
# cartucho o endereco 68k coincide com o deslocamento no arquivo.
def load_symbols(path):
    sims = {}
    with open(path) as fh:
        for linha in fh:
            partes = linha.split()
            if len(partes) == 3:
                sims.setdefault(partes[2], int(partes[0], 16))
    return sims

def exige(nome, hits, esperado=1):
    if len(hits) != esperado:
        sys.stderr.write("FATAL: %s: esperado %d ocorrência(s), encontrados %d\n"
                         % (nome, esperado, len(hits)))
        sys.exit(7)
    return hits[0]

# Compressão conferida NO ARTEFATO: um stream APLIB que não economiza o bastante
# é trocado silenciosamente por NONE pelo rescomp (Util.isCompressionValuable),
# então presumir pelo .res não vale.
ts = exige("TileSet APLIB", find_tileset(APLIB, truth["tileset"]["num_tile"]))
tm = exige("TileMap ctx_map APLIB", find_tilemap(APLIB, truth["map"]["cols"], truth["map"]["rows"]))
gh = exige("TileMap ctx_ghost APLIB",
           find_tilemap(APLIB, truth["ghost"]["cols"], truth["ghost"]["rows"]))
pl = exige("Palette 48 cores", find_palette(truth["palette"]["num_color"]))

# nenhum dos três pode existir como NÃO comprimido (seria o descarte silencioso)
for nome, hits in (("TileSet NONE", find_tileset(0, truth["tileset"]["num_tile"])),
                   ("ctx_map NONE", find_tilemap(0, truth["map"]["cols"], truth["map"]["rows"])),
                   ("ctx_ghost NONE",
                    find_tilemap(0, truth["ghost"]["cols"], truth["ghost"]["rows"]))):
    if hits:
        sys.stderr.write("FATAL: %s: o rescomp descartou o APLIB deste recurso\n" % nome)
        sys.exit(8)

# Conferencia com o dump do linker: simbolo, endereco do header, endereco do
# stream e tamanho declarado. Duas fontes independentes tem que concordar.
sims = load_symbols(os.path.join(out_dir, "project", "out", "symbol.txt"))
recursos = {"tileset": ("ctx_tiles", ts), "ctx_map": ("ctx_map", tm),
            "ctx_ghost": ("ctx_ghost", gh), "palette": ("ctx_pal", pl)}
conferencia = {}
for chave, (simbolo, recurso) in recursos.items():
    header = sims.get(simbolo)
    stream = sims.get(simbolo + "_data")
    tam = sims.get(simbolo + "_data_size")
    if header is None or stream is None or tam is None:
        sys.stderr.write("FATAL: symbol.txt sem %s / %s_data / %s_data_size\n"
                         % (simbolo, simbolo, simbolo))
        sys.exit(9)
    if header != recurso["header_offset"] or stream != recurso["stream_offset"]:
        sys.stderr.write("FATAL: simbolo %s diverge do scan (header %s/%s, stream %s/%s)\n"
                         % (simbolo, hex(header), hex(recurso["header_offset"]),
                            hex(stream), hex(recurso["stream_offset"])))
        sys.exit(9)
    conferencia[chave] = {"symbol": simbolo, "header_addr": header,
                          "stream_addr": stream, "data_size": tam}

# Folga sobre o critério do rescomp (Util.isCompressionValuable): APLIB só é
# mantido se economizar >120 bytes e ficar em <=85% do cru. Documentar a folga
# é o que diz se o fixture sobrevive a uma mudança pequena de autoria. O
# tamanho vem de <recurso>_data_size, emitido pelo linker: "ate o proximo
# vizinho" nao vale porque o stream do tileset e o ultimo do ROM.
def folga(plain, ap):
    return {"plain": plain, "aplib": ap, "economia": plain - ap,
            "percentual": round(100.0 * ap / plain, 1),
            "economia_minima_exigida": 120, "folga_de_celulas": (plain - ap) - 121}

medidas = {}
for chave in ("tileset", "ctx_map", "ctx_ghost"):
    verdade = truth[{"tileset": "tileset", "ctx_map": "map",
                     "ctx_ghost": "ghost"}[chave]]
    medidas[chave] = folga(verdade["plain_bytes"], conferencia[chave]["data_size"])
for chave, m in medidas.items():
    if m["economia"] <= 120 or m["aplib"] * 100 > m["plain"] * 85:
        sys.stderr.write("FATAL: %s fora do critério de valor do APLIB: %s\n" % (chave, m))
        sys.exit(10)

# A associacao existe NO ARTEFATO como struct Image da SGDK: tres ponteiros
# consecutivos (paleta/tileset/tilemap). E o unico vinculo verificavel entre
# recursos; o produto o segue em vez de inferir por proximidade ou tamanho.
# O bloco acima ja provou que endereco 68k == deslocamento no arquivo, entao
# aqui os dois podem ser comparados diretamente.
addr_img = sims.get("ctx_image")
if addr_img is None:
    sys.stderr.write("FATAL: ctx_image ausente do symbol.txt\n")
    sys.exit(11)
cadeia = list(struct.unpack_from(">III", rom, addr_img))
if cadeia != [sims["ctx_pal"], sims["ctx_tiles"], sims["ctx_map"]]:
    sys.stderr.write("FATAL: ctx_image nao aponta para a trinca esperada: %s\n"
                     % [hex(v) for v in cadeia])
    sys.exit(11)
# Varredura integral: a cadeia do ghost foi descartada pelo linker (struct sem
# referencia no codigo), entao NENHUM ponteiro liga ctx_ghost ao tileset. Essa
# associacao e da classe "desconhecida no artefato" e deve ser registrada como
# tal, nao como sucesso.
alvo_ghost = [sims["ctx_pal"], sims["ctx_tiles"], sims["ctx_ghost"]]
cadeias_ghost = [off for off in range(0, len(rom) - 12, 2)
                 if struct.unpack_from(">III", rom, off) == alvo_ghost]
associacoes = {
    "verificada_por_ponteiro": {
        "endereco": addr_img, "symbol": "ctx_image",
        "campos": {"palette": cadeia[0], "tileset": cadeia[1], "tilemap": cadeia[2]},
        "origem": "sgdk Image emitido pela fonte autoral e conferido contra symbol.txt"},
    "desconhecida_no_artefato": {
        "recurso": "ctx_ghost", "por_que": "o linker descartou ctx_ghost_image "
        "(struct sem referencia); nenhum ponteiro liga o mapa ao tileset",
        "cadeias_com_o_mesmo_trinco": len(cadeias_ghost),
        "regra": "o produto NAO pode associar ctx_ghost a ctx_tiles por "
                 "proximidade de arquivo ou por tamanho"},
}

report = {
    "schema": "rex-context-aplib-fixture-build/v1",
    "authored_fixture": True,
    "byor": False,
    "rom_path": os.path.abspath(rom_path),
    "rom_sha256": hashlib.sha256(rom).hexdigest(),
    "rom_len": len(rom),
    "compression_field_meaning": "0=NONE 1=APLIB 2=LZ4W (rescomp Basics.Compression)",
    "resources": {"tileset_aplib": ts, "tilemap_ctx_map_aplib": tm,
                  "tilemap_ctx_ghost_aplib": gh, "palette": pl},
    "symbol_crosscheck": conferencia,
    "stream_sizes": medidas,
    "associacoes": associacoes,
    "ground_truth": truth,
}
with open(os.path.join(out_dir, "fixture-build-report.json"), "w") as fh:
    json.dump(report, fh, indent=2)
print(json.dumps({"rom_sha256": report["rom_sha256"],
                  "resources": report["resources"],
                  "stream_sizes": medidas,
                  "associacoes": associacoes}, indent=2))
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
    "res/map.png": os.path.join(out_dir, "project", "res", "map.png"),
    "res/ghost.png": os.path.join(out_dir, "project", "res", "ghost.png"),
    "res/pal.pal": os.path.join(out_dir, "project", "res", "pal.pal"),
    "toolchain/libmd.a": os.path.join(sdk, "lib", "libmd.a"),
    "toolchain/rescomp.jar": os.path.join(sdk, "bin", "rescomp.jar"),
    "toolchain/apj.jar": os.path.join(sdk, "bin", "apj.jar"),
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
