#!/usr/bin/env bash
set -uo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
required_failures=0
warnings=0

pass() {
  printf 'PASS  %s\n' "$1"
}

fail() {
  printf 'FAIL  %s\n' "$1"
  required_failures=$((required_failures + 1))
}

warn() {
  printf 'WARN  %s\n' "$1"
  warnings=$((warnings + 1))
}

info() {
  printf 'INFO  %s\n' "$1"
}

first_line() {
  sed -n '1p'
}

printf 'KataGomo Renju Practice environment check\n'
printf 'Project: %s\n\n' "${project_root}"

kernel="$(uname -s 2>/dev/null || true)"
if [[ "${kernel}" == "Darwin" ]]; then
  macos_version="$(sw_vers -productVersion 2>/dev/null || printf 'unknown')"
  pass "macOS ${macos_version}"
else
  fail "This release targets macOS; detected ${kernel:-unknown OS}."
fi

machine_arch="$(uname -m 2>/dev/null || true)"
case "${machine_arch}" in
  arm64)
    pass "Apple Silicon (arm64), the validated platform"
    ;;
  x86_64)
    warn "Intel Mac detected. The CPU/Eigen path is experimental and not yet verified by the project."
    ;;
  *)
    fail "Unsupported or unknown architecture: ${machine_arch:-unknown}"
    ;;
esac

if command -v brew >/dev/null 2>&1; then
  brew_prefix="$(brew --prefix 2>/dev/null || true)"
  pass "Homebrew (${brew_prefix:-prefix unavailable})"
else
  fail "Homebrew is missing. Install it from https://brew.sh/ before running make setup."
fi

if developer_dir="$(xcode-select -p 2>/dev/null)"; then
  pass "Xcode Command Line Tools (${developer_dir})"
else
  fail "Xcode Command Line Tools are missing. Run: xcode-select --install"
fi

if command -v xcrun >/dev/null 2>&1 && xcrun --find clang >/dev/null 2>&1; then
  clang_version="$(xcrun clang --version 2>/dev/null | first_line)"
  pass "Apple compiler (${clang_version:-clang found})"
else
  fail "Apple clang was not found through xcrun. Install the Xcode Command Line Tools."
fi

if command -v python3 >/dev/null 2>&1; then
  python_version="$(python3 -c 'import platform; print(platform.python_version())' 2>/dev/null || true)"
  if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    pass "Existing Python ${python_version} (3.11 or newer)"
  else
    fail "Existing Python ${python_version:-unknown} is too old; Python 3.11 or newer is required."
  fi
else
  fail "python3 is missing; install a stable Python 3.11 or newer."
fi

if command -v cmake >/dev/null 2>&1; then
  cmake_version="$(cmake --version 2>/dev/null | first_line)"
  pass "CMake (${cmake_version:-version unavailable})"
else
  warn "CMake is not installed yet; make setup will install it with Homebrew."
fi

if command -v brew >/dev/null 2>&1; then
  eigen_prefix="$(brew --prefix eigen 2>/dev/null || true)"
  if [[ -n "${eigen_prefix}" && -f "${eigen_prefix}/include/eigen3/Eigen/Core" ]]; then
    pass "Eigen (${eigen_prefix})"
  else
    warn "Homebrew Eigen is not installed yet; make setup will install it."
  fi
else
  info "Eigen could not be checked until Homebrew is available."
fi

for required_command in curl git shasum gzip; do
  if command_path="$(command -v "${required_command}" 2>/dev/null)"; then
    pass "${required_command} (${command_path})"
  else
    fail "${required_command} is missing."
  fi
done

if command_path="$(command -v jq 2>/dev/null)"; then
  pass "jq (${command_path})"
else
  warn "jq is not installed yet; make setup will install it with Homebrew."
fi

if command -v node >/dev/null 2>&1; then
  node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  if node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null; then
    pass "Optional test runtime Node.js ${node_version}"
  else
    warn "Node.js ${node_version:-unknown} is older than 18; web tests will not run."
  fi
else
  warn "Node.js is not installed. Runtime use is unaffected, but make test requires Node 18 or newer."
fi

available_kib="$(df -Pk "${project_root}" 2>/dev/null | awk 'END {print $4}')"
if [[ "${available_kib}" =~ ^[0-9]+$ ]]; then
  available_gib="$(awk -v kib="${available_kib}" 'BEGIN {printf "%.1f", kib / 1024 / 1024}')"
  if (( available_kib < 1048576 )); then
    fail "Only ${available_gib} GiB is available; at least 1 GiB is required for a reliable setup."
  elif (( available_kib < 3145728 )); then
    warn "${available_gib} GiB is available; 3 GiB or more is recommended for source, model, and build files."
  else
    pass "Disk space (${available_gib} GiB available)"
  fi
else
  warn "Available disk space could not be determined."
fi

doctor_port="${KATAGOMO_PORT:-8000}"
if [[ ! "${doctor_port}" =~ ^[1-9][0-9]{0,4}$ ]] || (( 10#${doctor_port} > 65535 )); then
  fail "KATAGOMO_PORT must be an integer from 1 to 65535; got ${doctor_port}."
elif command -v lsof >/dev/null 2>&1; then
  port_owner="$(lsof -nP -iTCP:"${doctor_port}" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 {print $1 " (PID " $2 ")"}')"
  if [[ -n "${port_owner}" ]]; then
    warn "Port ${doctor_port} is already in use by ${port_owner}; stop it or set KATAGOMO_PORT to another port."
  else
    pass "Configured port ${doctor_port} is available"
  fi
else
  warn "Port ${doctor_port} availability was not checked because lsof is unavailable."
fi

if [[ -x "${project_root}/.venv/bin/python" ]]; then
  venv_version="$("${project_root}/.venv/bin/python" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)"
  info "Project virtual environment is present (Python ${venv_version:-unknown})."
else
  info "Project virtual environment is not present yet; make setup will create .venv."
fi

if [[ -x "${project_root}/build/engine-eigen/katago" ]]; then
  info "CPU/Eigen engine is built."
else
  info "CPU/Eigen engine is not built yet; make engine will build it."
fi

if [[ -f "${project_root}/models/zhizi_renju28b_s1600.bin.gz" ]]; then
  info "Renju model file is present; make verify-model performs full integrity checks."
else
  info "Renju model is not present yet; make model downloads and verifies the official file."
fi

printf '\nSummary: %d required failure(s), %d warning(s).\n' "${required_failures}" "${warnings}"
if (( required_failures > 0 )); then
  printf 'Fix the FAIL items, then run make doctor again. No packages were installed.\n'
  exit 1
fi

printf 'Required environment checks passed. No packages were installed or changed.\n'
