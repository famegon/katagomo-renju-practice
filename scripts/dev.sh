#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

if [[ ! -x .venv/bin/python ]]; then
  echo "Project virtual environment is missing. Run: make setup" >&2
  exit 1
fi

if [[ -z "${KATAGOMO_ENGINE:-}" ]]; then
  if [[ -x build/engine-opencl/katago ]]; then
    export KATAGOMO_ENGINE="${project_root}/build/engine-opencl/katago"
    export KATAGOMO_ANALYSIS_CONFIG="${project_root}/config/analysis-opencl.cfg"
  else
    export KATAGOMO_ENGINE="${project_root}/build/engine-eigen/katago"
    export KATAGOMO_ANALYSIS_CONFIG="${project_root}/config/analysis.cfg"
  fi
fi

export KATAGOMO_MODEL="${KATAGOMO_MODEL:-${project_root}/models/zhizi_renju28b_s1600.bin.gz}"
export KATAGOMO_ANALYSIS_CONFIG="${KATAGOMO_ANALYSIS_CONFIG:-${project_root}/config/analysis.cfg}"
export KATAGOMO_FORBIDDEN_HELPER="${KATAGOMO_FORBIDDEN_HELPER:-${project_root}/build/forbidden-helper/forbidden_helper}"
export KATAGOMO_ENGINE_LOG="${KATAGOMO_ENGINE_LOG:-${project_root}/artifacts/stage2/engine-stderr.log}"

if [[ ! -x "${KATAGOMO_ENGINE}" ]]; then
  echo "KataGomo engine is missing or not executable: ${KATAGOMO_ENGINE}" >&2
  echo "Run: make engine (or make opencl)" >&2
  exit 1
fi
if [[ ! -f "${KATAGOMO_MODEL}" ]]; then
  echo "Renju model is missing: ${KATAGOMO_MODEL}" >&2
  echo "Run: make model, or set KATAGOMO_MODEL to the verified official model." >&2
  exit 1
fi
KATAGOMO_MODEL="${KATAGOMO_MODEL}" "${project_root}/scripts/verify-model.sh"
if [[ ! -f "${KATAGOMO_ANALYSIS_CONFIG}" ]]; then
  echo "Analysis config is missing: ${KATAGOMO_ANALYSIS_CONFIG}" >&2
  exit 1
fi
if [[ ! -x "${KATAGOMO_FORBIDDEN_HELPER}" ]]; then
  echo "Forbidden-move helper is missing or not executable: ${KATAGOMO_FORBIDDEN_HELPER}" >&2
  echo "Run: make forbidden-helper" >&2
  exit 1
fi

echo "Starting KataGomo opening trainer"
echo "  engine: ${KATAGOMO_ENGINE}"
echo "  model: ${KATAGOMO_MODEL}"
echo "  config: ${KATAGOMO_ANALYSIS_CONFIG}"
echo "  helper: ${KATAGOMO_FORBIDDEN_HELPER}"
echo "  URL: http://127.0.0.1:${KATAGOMO_PORT:-8000}"
exec .venv/bin/python -m uvicorn server.app:app \
  --host 127.0.0.1 \
  --port "${KATAGOMO_PORT:-8000}"
