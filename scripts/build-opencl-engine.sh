#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${project_root}/vendor/KataGomo/cpp"
build_dir="${project_root}/build/engine-opencl"

"${project_root}/scripts/fetch-engine.sh"
command -v cmake >/dev/null

cmake \
  -S "${source_dir}" \
  -B "${build_dir}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_BACKEND=OPENCL \
  -DUSE_AVX2=OFF \
  -DBUILD_DISTRIBUTED=OFF \
  -DUSE_TCMALLOC=OFF

cmake --build "${build_dir}" --parallel
"${build_dir}/katago" version
