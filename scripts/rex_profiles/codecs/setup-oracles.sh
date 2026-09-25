#!/usr/bin/env bash
# Reconstrói os oráculos externos do agente B (codecs) neste host.
# Propriedade: docs/rex_profiles/codecs/ORACLE-INVENTORY.md registra os pins.
# Nunca executa nada sem `timeout`; oráculos mdcomp podem entrar em loop.
set -euo pipefail

CACHE="${REX_CODEC_CACHE:-$HOME/.cache/rex-codecs}"
REFS="$CACHE/references"
BIN="$CACHE/oracle-tools"
mkdir -p "$REFS" "$BIN/bin"

git clone --filter=blob:none https://github.com/emmanuel-marty/apultra "$REFS/apultra" 2>/dev/null || true
git -C "$REFS/apultra" checkout -q 8f340057d7402c10da3d9c76c599f9ab83b8a22d
make -C "$REFS/apultra" -j4
cp "$REFS/apultra/apultra" "$BIN/apultra"

git clone --filter=blob:none https://github.com/flamewing/mdcomp "$REFS/mdcomp" 2>/dev/null || true
git -C "$REFS/mdcomp" checkout -q 72c6df405a75d322c5b3722da46c3abb864d3793

# mdcomp precisa apenas de headers do Boost (mpl, io). Baixados portáteis,
# sem tocar no sistema. SHA-256 conferido no inventário.
if [ ! -d "$BIN/boost_1_86_0" ]; then
  curl -sfL -o "$BIN/boost.tar.gz" https://archives.boost.io/release/1.86.0/source/boost_1_86_0.tar.gz
  echo "2575e74ffc3ef1cd0babac2c1ee8bdb5782a0ee672b1912da40e5b4b591ca01f  $BIN/boost.tar.gz" | sha256sum -c
  tar xzf "$BIN/boost.tar.gz" -C "$BIN" boost_1_86_0/boost
fi
M="$REFS/mdcomp"
for t in koscmp nemcmp enicmp; do
  g++ -std=c++17 -O2 -I"$M/include" -I"$BIN" "$M"/src/lib/*.cc "$M/src/tools/$t.cc" -o "$BIN/bin/$t"
done

# SGDK v2.11 oficial (jars lz4w/apj/rescomp como referências de encoder).
if [ ! -f "$BIN/SGDK211/bin/lz4w.jar" ]; then
  curl -sfL -o "$BIN/sgdk211.7z" https://github.com/Stephane-D/SGDK/releases/download/v2.11/sgdk211.7z
  echo "5cc704b7e3a15183c33e721a1d7f84c067cf78808754556d03bb14764df51437  $BIN/sgdk211.7z" | sha256sum -c
  7z x -y -o"$BIN/SGDK211" "$BIN/sgdk211.7z" >/dev/null
fi
echo "5cc704b7e3a15183c33e721a1d7f84c067cf78808754556d03bb14764df51437  $BIN/sgdk211.7z"
sha256sum "$BIN/SGDK211/bin/lz4w.jar" "$BIN/SGDK211/bin/apj.jar" "$BIN/SGDK211/bin/rescomp.jar"

echo "OK: apultra=$("$BIN/apultra" 2>&1 | head -1)"
