#!/usr/bin/env bash
# stage.sh — normalizacion acoutada de contenedores do corpus (MISSAO A, Fase 1).
#
# Solo fai unha cousa: copiar MEMBROS ILLADOS dun contenedor de texto plano
# (lista de "SHA256<TAB>caminho") para o directorio de traballo local,
# comprando limites declarados antes de descomprimir nada.
#
# Non escribe nunca no corpus: o corpus ábrese só en lectura.
# Non versiona bytes comerciais: o directorio de traballo esta fóra da árbore.
#
# Uso:   scripts/rex_corpus_a/stage.sh [--dry-run] [manifesto]
# Env:   REX_CORPUS_A       raiz do corpus (caminhos relativos do manifesto)
#        REX_CORPUS_A_WORK  directorio local de saida (default ~/.retrodev/rex_corpus_a_work)
#        REX_ROLES          papeis a procesar, separados por espazo (default todos)
#        REX_MAX_CONTAINER  bytes (default 16777216)
#        REX_MAX_MEMBERS    por contenedor (default 8)
#        REX_MAX_UNCOMP     bytes por membro (default 4194304)
#        REX_MAX_RATIO      factor comp/uncomp (default 32)
set -euo pipefail

WORK="${REX_CORPUS_A_WORK:-$HOME/.retrodev/rex_corpus_a_work}"
ROOT="${REX_CORPUS_A:-}"
ROLES="${REX_ROLES:-}"
MAX_CONTAINER="${REX_MAX_CONTAINER:-16777216}"
MAX_MEMBERS="${REX_MAX_MEMBERS:-8}"
MAX_UNCOMP="${REX_MAX_UNCOMP:-4194304}"
MAX_RATIO="${REX_MAX_RATIO:-32}"
DRY_RUN=0
MANIFEST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
    *) MANIFEST="$1" ;;
  esac
  shift
done

[ -n "$MANIFEST" ] || { echo "ERRO: falta o manifesto de membros" >&2; exit 2; }
[ -f "$MANIFEST" ] || { echo "ERRO: manifesto inexistente: $MANIFEST" >&2; exit 2; }

if ! command -v unzip >/dev/null 2>&1; then
  echo "ERRO: unzip non dispoñible; a normalizacion non pode executarse" >&2
  exit 3
fi

UNZIP_VERSION="$(unzip -v 2>/dev/null | awk 'NR==1 {print $2, $3, $4}')"
mkdir -p "$WORK/staged"

# Proveniancia de cada byte staged: una fila por arquivo escrito nesta execucion.
# Reescribase dende cero para que o ficheiro reflicta SO o que hay en staged agora.
PROV="$WORK/proveniencia.tsv"
if [ "$DRY_RUN" -eq 0 ]; then
  umask 077
  printf 'staged_sha256\tstaged_len\tstaged_path\tcontainer_rel\tcontainer_sha256\tmember\tmember_crc32\tmethod\tmember_uncomp_len\tpapel\n' > "$PROV"
fi

refusa() {
  echo "RECUSA $1 :: $2"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  return 0
}

escrito=0
recusados=0
copias=0

while IFS=$'\t' read -r papel want_sha src; do
  [ -n "${src:-}" ] || continue
  case "$src" in \#*) continue ;; esac
  if [ -n "$ROLES" ] && ! printf '%s' " $ROLES " | grep -q " $papel "; then
    echo "SALTADO $src :: papel=$papel non esta en REX_ROLES='$ROLES'"
    continue
  fi
  rel_src="$src"
  case "$src" in /*) : ;; *) [ -n "$ROOT" ] && src="$ROOT/$src" ;; esac
  [ -f "$src" ] || { echo "RECUSA $src :: arquivo_inexistente"; recusados=$((recusados + 1)); continue; }

  have_sha="$(sha256sum "$src" | cut -d' ' -f1)"
  if [ "$have_sha" != "$want_sha" ]; then
    echo "RECUSA $src :: hash_divergente (esperado $want_sha, observado $have_sha)"
    recusados=$((recusados + 1))
    continue
  fi

  size="$(stat -c %s "$src")"
  if [ "$size" -gt "$MAX_CONTAINER" ]; then
    echo "RECUSA $src :: contenedor_excede_limite ($size > $MAX_CONTAINER)"
    recusados=$((recusados + 1))
    continue
  fi

  ext="$(printf '%s' "$src" | tr '[:upper:]' '[:lower:]' | sed 's/.*\.//')"
  case "$ext" in
    zip)
      # Unha soa lectura do indice (unzip -v) dá: Length Method Size Cpr Date Time CRC-32 Name.
      # Non se descomprime nada ata que todos os limites esten comprados.
      table="$(unzip -v "$src" 2>/dev/null | awk '
        NF>=8 && $1 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ && $7 ~ /^[0-9a-fA-F]{8}$/ {
          name=$8; for(i=9;i<=NF;i++) name=name" "$i;
          printf "%s\t%s\t%s\t%s\t%s\t%s\n", $1, $3, $2, $7, name, ""
        }')"
      count="$(printf '%s\n' "$table" | grep -c . || true)"
      if [ "$count" -eq 0 ]; then
        echo "RECUSA $src :: indice baleiro ou non parseable"
        recusados=$((recusados + 1))
        continue
      fi
      if [ "$count" -gt "$MAX_MEMBERS" ]; then
        echo "RECUSA $src :: membros_exceden_limite ($count > $MAX_MEMBERS)"
        recusados=$((recusados + 1))
        continue
      fi
      if printf '%s\n' "$table" | cut -f5 | grep -qE '^/|\.\.|^.:|\\|/'; then
        echo "RECUSA $src :: membro_con_camino_non_illado"
        recusados=$((recusados + 1))
        continue
      fi
      while IFS=$'\t' read -r mlen csize method mcrc mname _; do
        [ -n "${mlen:-}" ] || continue
        if [ "$mlen" -gt "$MAX_UNCOMP" ]; then
          echo "RECUSA $src::$mname :: membro_excede_limite_descompresion ($mlen > $MAX_UNCOMP)"
          recusados=$((recusados + 1))
          continue 2
        fi
        if [ "$csize" -gt 0 ]; then
          ratio=$((mlen / csize))
          if [ "$ratio" -gt "$MAX_RATIO" ]; then
            echo "RECUSA $src::$mname :: ratio_excede_limite ($ratio > $MAX_RATIO)"
            recusados=$((recusados + 1))
            continue 2
          fi
        fi
        out="$WORK/staged/$(basename "$src" .zip)__$(basename "$mname")"
        echo "INDICE $src::$mname method=$method uncomp=$mlen comp=$csize crc32=$mcrc -> $out"
        if [ "$DRY_RUN" -eq 1 ]; then continue; fi
        umask 077
        tmp="$out.part"
        if ! unzip -p "$src" "$mname" > "$tmp"; then
          rm -f "$tmp"
          echo "RECUSA $src::$mname :: extraccion_fallou"
          recusados=$((recusados + 1))
          continue 2
        fi
        mv -f "$tmp" "$out"
        obs="$(sha256sum "$out" | cut -d' ' -f1)"
        prov_len="$(stat -c %s "$out")"
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
          "$obs" "$prov_len" "$out" "$rel_src" "$want_sha" "$mname" "$mcrc" "$method" "$mlen" "$papel" >> "$PROV"
        echo "ESCRITO $out sha256=$obs len=$prov_len orixe=$src::$mname"
        escrito=$((escrito + 1))
      done <<EOF
$table
EOF
      ;;
    bin|gen|md|smd)
      out="$WORK/staged/$(basename "$src")"
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "PLANEADO $src -> $out ($size bytes)"
        continue
      fi
      umask 077
      cp "$src" "$out"
      obs="$(sha256sum "$out" | cut -d' ' -f1)"
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$obs" "$size" "$out" "$rel_src" "$want_sha" '-' '-' 'store' "$size" "$papel" >> "$PROV"
      echo "COPIA $out sha256=$obs len=$size orixe=$src"
      copias=$((copias + 1))
      ;;
    *)
      echo "RECUSA $src :: extension_non_declada ($ext)"
      recusados=$((recusados + 1))
      ;;
  esac
done < "$MANIFEST"

echo "RESUMO escrito=$escrito copias=$copias recusados=$recusados unzip='$UNZIP_VERSION' work=$WORK"
