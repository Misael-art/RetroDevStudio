#!/usr/bin/env bash
# Linux upstream validation for RetroDev Studio.
# Detects native host dependencies, applies host cache hygiene (GTK3 compose
# cache) and writes an audit JSON report.

set -u

SKIP_RUST_TESTS=0
REQUIRE_DECOMP_TOOLS=0
PRINT_JSON=0

usage() {
  cat <<'USAGE'
RetroDev Studio Linux upstream validation

Usage:
  scripts/validate-upstream-linux.sh [options]

Options:
  --skip-rust-tests       Do not run ignored Rust smoke tests even if host deps are ready.
  --require-decomp-tools  Treat Ghidra/JDK21 readiness as blocking.
  --json                  Print the generated JSON report to stdout.
  -h, --help              Show this help.

Environment:
  RDS_VALIDATE_REPORT_PATH  Override report path.
  SGDK_ROOT or GDK          Native Linux SGDK root.
  RDS_EDGE_DRIVER_PATH      Native Linux WebDriver path.
  RETRODEV_GHIDRA_HOME      Ghidra installation root containing support/analyzeHeadless.
  RDS_GTK3_COMPOSE_CACHE_DIR  Override GTK3 compose cache dir used by host hygiene.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-rust-tests)
      SKIP_RUST_TESTS=1
      ;;
    --require-decomp-tools)
      REQUIRE_DECOMP_TOOLS=1
      ;;
    --json)
      PRINT_JSON=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This validation script supports Linux only. Use scripts/validate-upstream-windows.ps1 on Windows." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VALIDATION_DIR="$REPO_ROOT/src-tauri/target-test/validation"
REPORT_PATH="${RDS_VALIDATE_REPORT_PATH:-$VALIDATION_DIR/upstream-validation-linux.json}"
mkdir -p "$VALIDATION_DIR" "$(dirname "$REPORT_PATH")"

status_codes=()
warnings=()
phases=()
rust_smoke_status="skipped"
rust_smoke_log=""

add_code() {
  status_codes+=("$1")
}

add_warning() {
  warnings+=("$1")
}

add_phase() {
  phases+=("$1:$2")
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

command_ok() {
  [[ -n "$(command_path "$1")" ]]
}

is_native_executable_path() {
  local candidate="$1"
  [[ -n "$candidate" && -x "$candidate" && "$candidate" != *.exe ]]
}

find_first_native() {
  local candidate
  for candidate in "$@"; do
    if is_native_executable_path "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

detect_sgdk_root() {
  local candidate
  for candidate in "${SGDK_ROOT:-}" "${GDK:-}" "$REPO_ROOT/toolchains/sgdk"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

detect_native_webdriver() {
  if is_native_executable_path "${RDS_EDGE_DRIVER_PATH:-}"; then
    printf '%s\n' "$RDS_EDGE_DRIVER_PATH"
    return 0
  fi

  find_first_native \
    "$REPO_ROOT/toolchains/webdriver/msedgedriver" \
    "$REPO_ROOT/toolchains/webdriver/chromedriver" \
    "$(command_path msedgedriver)" \
    "$(command_path chromedriver)"
}

detect_ghidra_headless() {
  if [[ -n "${RETRODEV_GHIDRA_HOME:-}" && -x "$RETRODEV_GHIDRA_HOME/support/analyzeHeadless" ]]; then
    printf '%s\n' "$RETRODEV_GHIDRA_HOME/support/analyzeHeadless"
    return 0
  fi
  command_path analyzeHeadless
}

detect_java_major() {
  if ! command_ok java; then
    printf '0\n'
    return 0
  fi
  java -version 2>&1 | awk -F '"' '/version/ {split($2, parts, "."); if (parts[1] == "1") print parts[2]; else print parts[1]; exit}'
}

detect_libretro_core() {
  local core_dir="$REPO_ROOT/toolchains/libretro/cores"
  local core
  for core in \
    "$core_dir/genesis_plus_gx_libretro.so" \
    "$core_dir/picodrive_libretro.so" \
    "$core_dir/blastem_libretro.so" \
    "$core_dir/bsnes_libretro.so" \
    "$core_dir/snes9x_libretro.so"; do
    if [[ -f "$core" ]]; then
      printf '%s\n' "$core"
      return 0
    fi
  done
  find "$core_dir" -maxdepth 1 -type f -name '*_libretro.so' 2>/dev/null | sort | head -n 1
}

echo "== RetroDev Studio: Linux upstream validation =="

node_path="$(command_path node)"
npm_path="$(command_path npm)"
cargo_path="$(command_path cargo)"
rustc_path="$(command_path rustc)"
make_path="$(command_path make)"
java_path="$(command_path java)"
tauri_driver_path="$(command_path tauri-driver)"
m68k_path="$(command_path m68k-elf-gcc)"
sgdk_root="$(detect_sgdk_root || true)"
webdriver_path="$(detect_native_webdriver || true)"
ghidra_path="$(detect_ghidra_headless || true)"
java_major="$(detect_java_major)"
libretro_core_path="$(detect_libretro_core || true)"

[[ -n "$node_path" ]] || add_code "node_missing"
[[ -n "$npm_path" ]] || add_code "npm_missing"
[[ -n "$cargo_path" ]] || add_code "cargo_missing"
[[ -n "$rustc_path" ]] || add_code "rustc_missing"

sgdk_makefile_ok=false
sgdk_compiler_ok=false
sgdk_make_ok=false
sgdk_java_ok=false
if [[ -n "$sgdk_root" ]]; then
  [[ -f "$sgdk_root/makefile.gen" ]] && sgdk_makefile_ok=true
  if is_native_executable_path "$sgdk_root/bin/m68k-elf-gcc" || [[ -n "$m68k_path" ]]; then
    sgdk_compiler_ok=true
  fi
  [[ -n "$make_path" ]] && sgdk_make_ok=true
  [[ -n "$java_path" ]] && sgdk_java_ok=true
else
  add_code "sgdk_root_missing"
fi

if [[ "$sgdk_makefile_ok" != "true" || "$sgdk_compiler_ok" != "true" || "$sgdk_make_ok" != "true" || "$sgdk_java_ok" != "true" ]]; then
  add_code "toolchain_missing"
fi

if [[ -z "$tauri_driver_path" ]]; then
  add_code "tauri_driver_missing"
fi

if [[ -z "$webdriver_path" ]]; then
  add_code "webdriver_missing"
fi

if [[ -z "$libretro_core_path" ]]; then
  add_code "libretro_core_missing"
fi

ghidra_ok=false
jdk21_ok=false
if [[ -n "$ghidra_path" ]]; then
  ghidra_ok=true
else
  add_warning "ghidra_missing"
  [[ "$REQUIRE_DECOMP_TOOLS" == "1" ]] && add_code "ghidra_missing"
fi

if [[ "$java_major" =~ ^[0-9]+$ && "$java_major" -ge 21 ]]; then
  jdk21_ok=true
else
  add_warning "jdk21_missing"
  [[ "$REQUIRE_DECOMP_TOOLS" == "1" ]] && add_code "jdk21_missing"
fi

add_phase "host_detection" "completed"

# Higiene do cache de compose do GTK3.
# Apos upgrade do gtk3 no host, caches antigos em ~/.cache/gtk-3.0/compose
# disparam "Gtk-WARNING: cache version is different" no primeiro launch do app.
# Caches mais antigos que a libgtk-3 instalada sao removidos aqui; o GTK
# regenera o cache silenciosamente no proximo launch.
detect_gtk3_lib() {
  local candidate
  for candidate in \
    /usr/lib/libgtk-3.so.0 \
    /usr/lib64/libgtk-3.so.0 \
    /usr/lib/x86_64-linux-gnu/libgtk-3.so.0 \
    /usr/lib/aarch64-linux-gnu/libgtk-3.so.0; do
    if [[ -e "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

gtk3_lib_path="$(detect_gtk3_lib || true)"
gtk3_compose_cache_dir="${RDS_GTK3_COMPOSE_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/gtk-3.0/compose}"
gtk3_hygiene_status="not_applicable"
gtk3_stale_caches_removed=0
if [[ -n "$gtk3_lib_path" && -d "$gtk3_compose_cache_dir" ]]; then
  gtk3_hygiene_status="clean"
  for compose_cache in "$gtk3_compose_cache_dir"/*.cache; do
    [[ -f "$compose_cache" ]] || continue
    if [[ "$compose_cache" -ot "$gtk3_lib_path" ]]; then
      rm -f "$compose_cache"
      gtk3_stale_caches_removed=$((gtk3_stale_caches_removed + 1))
    fi
  done
  if [[ "$gtk3_stale_caches_removed" -gt 0 ]]; then
    gtk3_hygiene_status="regenerated"
    add_warning "gtk3_compose_cache_stale_removed"
  fi
fi
add_phase "gtk3_cache_hygiene" "completed"

if [[ "${#status_codes[@]}" -eq 0 && "$SKIP_RUST_TESTS" != "1" ]]; then
  rust_smoke_log="$VALIDATION_DIR/linux-upstream-rust-smoke.log"
  echo "Running official SGDK smoke test..."
  (
    cd "$REPO_ROOT" &&
      cargo test --manifest-path src-tauri/Cargo.toml --lib official_sgdk_nocode_game_builds_and_runs_with_real_toolchain -- --ignored --nocapture --test-threads=1
  ) >"$rust_smoke_log" 2>&1
  smoke_status=$?
  if [[ "$smoke_status" -eq 0 ]]; then
    rust_smoke_status="passed"
    add_phase "official_sgdk_smoke" "passed"
  else
    rust_smoke_status="failed"
    add_code "official_sgdk_smoke_failed"
    add_phase "official_sgdk_smoke" "failed"
  fi
else
  add_phase "official_sgdk_smoke" "skipped"
fi

success=false
if [[ "${#status_codes[@]}" -eq 0 ]]; then
  success=true
fi

join_by_unit_sep() {
  local IFS=$'\037'
  printf '%s' "$*"
}

STATUS_CODES="$(join_by_unit_sep "${status_codes[@]}")"
WARNINGS="$(join_by_unit_sep "${warnings[@]}")"
PHASES="$(join_by_unit_sep "${phases[@]}")"
export REPO_ROOT REPORT_PATH VALIDATION_DIR STATUS_CODES WARNINGS PHASES
export success node_path npm_path cargo_path rustc_path make_path java_path tauri_driver_path m68k_path
export sgdk_root sgdk_makefile_ok sgdk_compiler_ok sgdk_make_ok sgdk_java_ok
export webdriver_path ghidra_path ghidra_ok jdk21_ok java_major libretro_core_path
export rust_smoke_status rust_smoke_log SKIP_RUST_TESTS REQUIRE_DECOMP_TOOLS
export gtk3_lib_path gtk3_compose_cache_dir gtk3_hygiene_status gtk3_stale_caches_removed

node <<'NODE'
const fs = require("node:fs");

const splitList = (value) => value ? value.split("\x1f").filter(Boolean) : [];
const phases = splitList(process.env.PHASES).map((entry) => {
  const [name, status] = entry.split(":");
  return { name, status };
});

const report = {
  schema: "rds-linux-upstream-validation/v1",
  success: process.env.success === "true",
  host_platform: "linux",
  repo_root: process.env.REPO_ROOT,
  validation_dir: process.env.VALIDATION_DIR,
  blocking_status_codes: splitList(process.env.STATUS_CODES),
  warnings: splitList(process.env.WARNINGS),
  phases,
  checks: {
    baseline_tools: {
      node: process.env.node_path || null,
      npm: process.env.npm_path || null,
      cargo: process.env.cargo_path || null,
      rustc: process.env.rustc_path || null,
    },
    sgdk: {
      root: process.env.sgdk_root || null,
      makefile_gen: process.env.sgdk_makefile_ok === "true",
      native_compiler: process.env.sgdk_compiler_ok === "true",
      native_compiler_path: process.env.m68k_path || null,
      make: process.env.sgdk_make_ok === "true",
      make_path: process.env.make_path || null,
      java: process.env.sgdk_java_ok === "true",
      java_path: process.env.java_path || null,
    },
    desktop_e2e: {
      tauri_driver: process.env.tauri_driver_path || null,
      native_webdriver: process.env.webdriver_path || null,
    },
    libretro: {
      native_core: process.env.libretro_core_path || null,
    },
    decompilation_optional: {
      ghidra_headless: process.env.ghidra_path || null,
      ghidra_ok: process.env.ghidra_ok === "true",
      java_major: Number(process.env.java_major || 0),
      jdk21_ok: process.env.jdk21_ok === "true",
      required: process.env.REQUIRE_DECOMP_TOOLS === "1",
    },
    rust_smoke: {
      skipped_by_flag: process.env.SKIP_RUST_TESTS === "1",
      status: process.env.rust_smoke_status,
      log: process.env.rust_smoke_log || null,
    },
    gtk3_host_hygiene: {
      applicable: process.env.gtk3_hygiene_status !== "not_applicable",
      gtk3_lib: process.env.gtk3_lib_path || null,
      compose_cache_dir: process.env.gtk3_compose_cache_dir || null,
      stale_caches_removed: Number(process.env.gtk3_stale_caches_removed || 0),
      status: process.env.gtk3_hygiene_status,
    },
  },
};

fs.writeFileSync(process.env.REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
NODE

echo "Report: $REPORT_PATH"
echo "Success: $success"
if [[ "${#status_codes[@]}" -gt 0 ]]; then
  echo "Blocking status codes:"
  printf '  - %s\n' "${status_codes[@]}"
fi
if [[ "${#warnings[@]}" -gt 0 ]]; then
  echo "Warnings:"
  printf '  - %s\n' "${warnings[@]}"
fi

if [[ "$PRINT_JSON" == "1" ]]; then
  cat "$REPORT_PATH"
fi

if [[ "$success" == "true" ]]; then
  exit 0
fi
exit 1
