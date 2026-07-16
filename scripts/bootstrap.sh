#!/usr/bin/env bash
# Safe bootstrap for an existing RetroDev Studio checkout on Linux.
# This script does not scaffold or rewrite tracked project files.

set -u

INSTALL_MISSING_TOOLS=0
ENSURE_HOST=0
SKIP_NPM_CI=0
RUN_BASELINE=0
RUN_UPSTREAM_VALIDATION=0
DIAGNOSTICS_ONLY=0
OFFLINE=0
PROFILE="full"

usage() {
  cat <<'USAGE'
RetroDev Studio Linux bootstrap

Usage:
  scripts/bootstrap.sh [options]

Options:
  --ensure                      Repair the host from the tracked immutable lock.
  --profile full                Select the mandatory v1 profile (only full exists).
  --offline                     Use only the verified portable download cache.
  --install-missing-tools       Install user-scoped helper tools when safe.
                                Currently this may run: cargo install tauri-driver --locked
  --skip-npm-ci                 Do not run npm ci/npm install.
  --run-baseline                Run check:tree, lint, tsc, npm test, cargo clippy and cargo test.
  --run-upstream-validation     Run scripts/validate-upstream-linux.sh after bootstrap.
  --diagnostics-only            Print diagnostics and exit without installing or running npm/gates.
  -h, --help                    Show this help.

In --ensure mode this script may invoke sudo/pacman for the locked distribution
substrate. Project toolchains are then provisioned from immutable official
artifacts by the shared host manager; credentials are never stored.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ensure)
      ENSURE_HOST=1
      ;;
    --profile)
      shift
      PROFILE="${1:-}"
      ;;
    --offline)
      OFFLINE=1
      ;;
    --install-missing-tools)
      INSTALL_MISSING_TOOLS=1
      ;;
    --skip-npm-ci)
      SKIP_NPM_CI=1
      ;;
    --run-baseline)
      RUN_BASELINE=1
      ;;
    --run-upstream-validation)
      RUN_UPSTREAM_VALIDATION=1
      ;;
    --diagnostics-only)
      DIAGNOSTICS_ONLY=1
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

if [[ "$PROFILE" != "full" ]]; then
  echo "Only profile 'full' is supported in v1." >&2
  exit 2
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This bootstrap supports Linux only. Use scripts/bootstrap.ps1 on Windows." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOOTSTRAP_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/retrodevstudio/bootstrap"
LOG_FILE="$BOOTSTRAP_CACHE/bootstrap.log"
PORTABLE_CACHE="$PROJECT_ROOT/toolchains/.cache/artifacts"
PINNED_NODE_VERSION="24.18.0"
PINNED_NODE_SHA256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
PINNED_NODE_ARCHIVE="node-v${PINNED_NODE_VERSION}-linux-x64.tar.xz"
PINNED_NODE_URL="https://nodejs.org/dist/v${PINNED_NODE_VERSION}/${PINNED_NODE_ARCHIVE}"

mkdir -p "$BOOTSTRAP_CACHE" "$PORTABLE_CACHE"

step() {
  local module="$1"
  local level="$2"
  local message="$3"
  local line="[$module] [$level] $message"
  printf '%s\n' "$line"
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line" >> "$LOG_FILE"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

command_version() {
  if command_exists "$1"; then
    "$1" --version 2>/dev/null | head -n 1
  else
    printf 'missing'
  fi
}

ensure_arch_substrate() {
  if [[ "$ENSURE_HOST" != "1" ]]; then
    return 0
  fi
  local os_id
  os_id="$(. /etc/os-release && printf '%s' "$ID")"
  if [[ "$os_id" != "arch" && "$os_id" != "manjaro" && "$os_id" != "biglinux" ]]; then
    step "HOST" "FAIL" "Unsupported Linux distribution: $os_id"
    return 11
  fi
  if [[ "$(uname -m)" != "x86_64" ]]; then
    step "HOST" "FAIL" "Unsupported architecture: $(uname -m)"
    return 11
  fi
  local missing_packages=()
  command_exists curl || missing_packages+=(curl)
  command_exists tar || missing_packages+=(tar)
  command_exists unzip || missing_packages+=(unzip)
  command_exists xz || missing_packages+=(xz)
  command_exists git || missing_packages+=(git)
  command_exists rustup || missing_packages+=(rustup)
  command_exists gcc || missing_packages+=(base-devel)
  command_exists make || missing_packages+=(make)
  command_exists cmake || missing_packages+=(cmake)
  command_exists 7z || missing_packages+=(7zip)
  command_exists bison || missing_packages+=(bison)
  command_exists flex || missing_packages+=(flex)
  command_exists makeinfo || missing_packages+=(texinfo)
  command_exists pkg-config || missing_packages+=(pkgconf)
  if command_exists pkg-config; then
    pkg-config --exists webkit2gtk-4.1 || missing_packages+=(webkit2gtk-4.1)
    pkg-config --exists librsvg-2.0 || missing_packages+=(librsvg)
  fi
  if [[ "${#missing_packages[@]}" -eq 0 ]]; then
    step "HOST" "OK" "Arch/Manjaro substrate already satisfies the probes; sudo not required."
    return 0
  fi
  if [[ "$OFFLINE" == "1" ]]; then
    step "HOST" "FAIL" "Offline bootstrap cannot install system packages: ${missing_packages[*]}"
    return 10
  fi
  step "HOST" "INFO" "Installing missing substrate packages: ${missing_packages[*]}"
  sudo pacman -S --needed --noconfirm "${missing_packages[@]}"
}

ensure_pinned_node() {
  if [[ "$ENSURE_HOST" != "1" ]]; then
    return 0
  fi
  local node_root="$BOOTSTRAP_CACHE/node-v${PINNED_NODE_VERSION}-linux-x64"
  local portable_archive="$PORTABLE_CACHE/$PINNED_NODE_SHA256"
  if [[ ! -x "$node_root/bin/node" ]]; then
    if [[ ! -f "$portable_archive" ]]; then
      if [[ "$OFFLINE" == "1" ]]; then
        step "NODE" "FAIL" "Pinned Node archive is absent from offline cache: $portable_archive"
        return 10
      fi
      local staged="$portable_archive.part"
      step "NODE" "INFO" "Downloading pinned official Node $PINNED_NODE_VERSION."
      curl --fail --location --connect-timeout 20 --max-time 1800 --retry 3 --retry-all-errors --continue-at - --output "$staged" "$PINNED_NODE_URL"
      printf '%s  %s\n' "$PINNED_NODE_SHA256" "$staged" | sha256sum --check --status
      mv "$staged" "$portable_archive"
    fi
    printf '%s  %s\n' "$PINNED_NODE_SHA256" "$portable_archive" | sha256sum --check --status || {
      step "NODE" "FAIL" "Pinned Node cache checksum mismatch."
      return 12
    }
    rm -rf "$node_root.tmp"
    mkdir -p "$node_root.tmp"
    tar -xJf "$portable_archive" --strip-components=1 -C "$node_root.tmp"
    rm -rf "$node_root"
    mv "$node_root.tmp" "$node_root"
  fi
  export PATH="$node_root/bin:$HOME/.cargo/bin:$PATH"
  [[ "$(node --version)" == "v${PINNED_NODE_VERSION}" ]] || {
    step "NODE" "FAIL" "Pinned Node activation failed."
    return 12
  }
}

ensure_pinned_rust() {
  if [[ "$ENSURE_HOST" != "1" ]]; then
    return 0
  fi
  export PATH="$HOME/.cargo/bin:$PATH"
  if ! command_exists rustup; then
    step "RUST" "FAIL" "rustup is unavailable after substrate provisioning."
    return 10
  fi
  if [[ "$OFFLINE" != "1" ]]; then
    rustup toolchain install 1.97.0 --profile minimal --component clippy --component rustfmt
  fi
  rustup run 1.97.0 rustc --version >/dev/null 2>&1 || {
    step "RUST" "FAIL" "Pinned Rust 1.97.0 is unavailable."
    return 10
  }
}

assert_existing_checkout() {
  local missing=0
  for required in \
    "$PROJECT_ROOT/package.json" \
    "$PROJECT_ROOT/src-tauri/Cargo.toml" \
    "$PROJECT_ROOT/scripts/build.mjs" \
    "$PROJECT_ROOT/scripts/validate-upstream-linux.sh"; do
    if [[ ! -e "$required" ]]; then
      step "BOOT" "FAIL" "Missing required checkout path: $required"
      missing=1
    fi
  done
  return "$missing"
}

show_diagnostics() {
  local required_missing=0
  for command_name in node npm git rustc cargo make java; do
    if command_exists "$command_name"; then
      step "DIAG" "OK" "$command_name: $(command_version "$command_name")"
    else
      step "DIAG" "WARN" "$command_name: missing"
      case "$command_name" in
        node|npm|git|rustc|cargo)
          required_missing=1
          ;;
      esac
    fi
  done

  if command_exists tauri-driver; then
    step "DIAG" "OK" "tauri-driver: $(command_version tauri-driver)"
  else
    step "DIAG" "WARN" "tauri-driver: missing (cargo install tauri-driver --locked)"
  fi

  if command_exists m68k-elf-gcc; then
    step "DIAG" "OK" "m68k-elf-gcc: $(command_version m68k-elf-gcc)"
  else
    step "DIAG" "WARN" "m68k-elf-gcc: missing (required for native Linux SGDK build)"
  fi

  if command_exists chromedriver || command_exists msedgedriver; then
    step "DIAG" "OK" "native WebDriver detected"
  else
    step "DIAG" "WARN" "native WebDriver missing (chromedriver or msedgedriver)"
  fi

  if [[ -n "${RETRODEV_GHIDRA_HOME:-}" && -x "$RETRODEV_GHIDRA_HOME/support/analyzeHeadless" ]]; then
    step "DIAG" "OK" "Ghidra: $RETRODEV_GHIDRA_HOME"
  elif command_exists analyzeHeadless; then
    step "DIAG" "OK" "Ghidra analyzeHeadless found in PATH"
  else
    step "DIAG" "WARN" "Ghidra analyzeHeadless missing (required only for decompilation pipeline)"
  fi

  return "$required_missing"
}

install_user_scoped_tools() {
  if [[ "$INSTALL_MISSING_TOOLS" != "1" ]]; then
    return 0
  fi

  if ! command_exists cargo; then
    step "INSTALL" "WARN" "cargo missing; cannot install user-scoped Rust helper tools."
    return 1
  fi

  if ! command_exists tauri-driver; then
    step "INSTALL" "INFO" "Installing tauri-driver with cargo install tauri-driver --locked"
    cargo install tauri-driver --locked
    local status=$?
    if [[ "$status" -ne 0 ]]; then
      step "INSTALL" "FAIL" "cargo install tauri-driver failed with exit code $status"
      return "$status"
    fi
  fi
}

run_checked() {
  local label="$1"
  shift
  step "RUN" "INFO" "$label"
  "$@"
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    step "RUN" "FAIL" "$label failed with exit code $status"
    return "$status"
  fi
}

run_npm_install() {
  if [[ "$SKIP_NPM_CI" == "1" ]]; then
    step "NPM" "INFO" "Skipping npm ci/npm install."
    return 0
  fi

  cd "$PROJECT_ROOT" || return 1
  if [[ -f package-lock.json ]]; then
    run_checked "npm ci" npm ci
  else
    run_checked "npm install" npm install
  fi
}

run_baseline() {
  if [[ "$RUN_BASELINE" != "1" ]]; then
    return 0
  fi

  cd "$PROJECT_ROOT" || return 1
  run_checked "check tree" npm run check:tree &&
    run_checked "lint" npm run lint &&
    run_checked "typescript" npx tsc --noEmit &&
    run_checked "frontend tests" npm test &&
    run_checked "rust clippy" cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings &&
    run_checked "rust tests" cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1
}

run_upstream_validation() {
  if [[ "$RUN_UPSTREAM_VALIDATION" != "1" ]]; then
    return 0
  fi

  cd "$PROJECT_ROOT" || return 1
  run_checked "Linux upstream validation" bash scripts/validate-upstream-linux.sh --skip-rust-tests
}

: > "$LOG_FILE"
step "BOOT" "INFO" "RetroDev Studio Linux bootstrap at $PROJECT_ROOT"

assert_existing_checkout || exit 1
ensure_arch_substrate || exit $?
ensure_pinned_node || exit $?
ensure_pinned_rust || exit $?
show_diagnostics
diagnostic_status=$?

if [[ "$DIAGNOSTICS_ONLY" == "1" ]]; then
  step "BOOT" "OK" "Diagnostics-only mode complete."
  exit 0
fi

if [[ "$diagnostic_status" -ne 0 ]]; then
  step "BOOT" "FAIL" "Required baseline tools are missing. Rerun with --ensure."
  exit 1
fi

if [[ "$ENSURE_HOST" == "1" ]]; then
  host_args=(ensure --profile "$PROFILE")
  [[ "$OFFLINE" == "1" ]] && host_args+=(--offline)
  step "HOST" "INFO" "Running manifest-driven host repair."
  node "$PROJECT_ROOT/scripts/host-manager.mjs" "${host_args[@]}"
  host_status=$?
  if [[ "$host_status" -ne 0 ]]; then
    step "HOST" "FAIL" "Host remains blocked; see host-readiness.json (exit $host_status)."
    exit "$host_status"
  fi
fi

install_user_scoped_tools &&
  run_npm_install &&
  run_baseline &&
  run_upstream_validation
status=$?

if [[ "$status" -eq 0 ]]; then
  step "BOOT" "OK" "Bootstrap complete."
else
  step "BOOT" "FAIL" "Bootstrap failed with exit code $status."
fi

exit "$status"
