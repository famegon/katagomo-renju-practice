#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${project_root}/vendor/KataGomo/cpp"
build_dir="${project_root}/build/engine-eigen"

"${project_root}/scripts/fetch-engine.sh"

command -v cmake >/dev/null
command -v brew >/dev/null
eigen_prefix="$(brew --prefix eigen)"

cmake \
  -S "${source_dir}" \
  -B "${build_dir}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_BACKEND=EIGEN \
  -DUSE_AVX2=OFF \
  -DBUILD_DISTRIBUTED=OFF \
  -DUSE_TCMALLOC=OFF \
  -DEIGEN3_INCLUDE_DIRS="${eigen_prefix}/include/eigen3"

cmake --build "${build_dir}" --parallel
"${build_dir}/katago" version
