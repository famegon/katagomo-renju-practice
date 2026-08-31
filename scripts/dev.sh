#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

test -x .venv/bin/python
test -f models/zhizi_renju28b_s1600.bin.gz

if [[ -z "${KATAGOMO_ENGINE:-}" ]]; then
  if [[ -x build/engine-opencl/katago ]]; then
    export KATAGOMO_ENGINE="${project_root}/build/engine-opencl/katago"
    export KATAGOMO_ANALYSIS_CONFIG="${project_root}/config/analysis-opencl.cfg"
  elif [[ -x build/opencl-probe/katago ]]; then
    export KATAGOMO_ENGINE="${project_root}/build/opencl-probe/katago"
    export KATAGOMO_ANALYSIS_CONFIG="${project_root}/config/analysis-opencl.cfg"
  else
    export KATAGOMO_ENGINE="${project_root}/build/engine-eigen/katago"
    export KATAGOMO_ANALYSIS_CONFIG="${project_root}/config/analysis.cfg"
  fi
fi

export KATAGOMO_MODEL="${KATAGOMO_MODEL:-${project_root}/models/zhizi_renju28b_s1600.bin.gz}"
exec .venv/bin/python -m uvicorn server.app:app \
  --host 127.0.0.1 \
  --port "${KATAGOMO_PORT:-8000}"
