#!/usr/bin/env bash
# Safe bootstrap for an existing RetroDev Studio checkout on Linux.
# This script does not scaffold or rewrite tracked project files.

set -u

INSTALL_MISSING_TOOLS=0
SKIP_NPM_CI=0
RUN_BASELINE=0
RUN_UPSTREAM_VALIDATION=0
DIAGNOSTICS_ONLY=0

usage() {
  cat <<'USAGE'
RetroDev Studio Linux bootstrap

Usage:
  scripts/bootstrap.sh [options]

Options:
  --install-missing-tools       Install user-scoped helper tools when safe.
                                Currently this may run: cargo install tauri-driver --locked
  --skip-npm-ci                 Do not run npm ci/npm install.
  --run-baseline                Run check:tree, lint, tsc, npm test, cargo clippy and cargo test.
  --run-upstream-validation     Run scripts/validate-upstream-linux.sh after bootstrap.
  --diagnostics-only            Print diagnostics and exit without installing or running npm/gates.
  -h, --help                    Show this help.

This script never installs system packages automatically. Install native Linux
packages such as make, Java, m68k-elf-gcc, chromedriver, Ghidra/JDK21 or
Libretro cores through the host package manager or official upstream channels.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This bootstrap supports Linux only. Use scripts/bootstrap.ps1 on Windows." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_ROOT/bootstrap.log"

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
show_diagnostics
diagnostic_status=$?

if [[ "$DIAGNOSTICS_ONLY" == "1" ]]; then
  step "BOOT" "OK" "Diagnostics-only mode complete."
  exit 0
fi

if [[ "$diagnostic_status" -ne 0 ]]; then
  step "BOOT" "FAIL" "Required baseline tools are missing. Install them manually, then rerun."
  exit 1
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
