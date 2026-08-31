#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${project_root}/build/forbidden-helper"

"${project_root}/scripts/fetch-engine.sh"
command -v cmake >/dev/null

cmake \
  -S "${project_root}/native/forbidden_helper" \
  -B "${build_dir}" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "${build_dir}" --parallel

test -x "${build_dir}/forbidden_helper"
echo "Built official Board::isForbidden helper: ${build_dir}/forbidden_helper"
