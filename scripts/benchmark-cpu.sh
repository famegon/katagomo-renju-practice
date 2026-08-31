#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
engine_path="${KATAGOMO_ENGINE:-${project_root}/build/engine-eigen/katago}"
model_path="${KATAGOMO_MODEL:-${project_root}/models/zhizi_renju28b_s1600.bin.gz}"
threads="${KATAGOMO_BENCH_THREADS:-8}"
mode="${KATAGOMO_BENCH_MODE:-fixed}"
output_dir="${project_root}/artifacts/stage1/benchmark"

test -x "${engine_path}"
KATAGOMO_MODEL="${model_path}" "${project_root}/scripts/verify-model.sh"
mkdir -p "${output_dir}"

run_benchmark() {
  local log_path="$1"
  shift
  "${engine_path}" benchmark \
    -config "${project_root}/config/benchmark.cfg" \
    -model "${model_path}" \
    -numpositions 1 \
    -sgf "${project_root}/benchmarks/empty-15.sgf" \
    "$@" 2>&1 | tee "${log_path}"
}

case "${mode}" in
  fixed)
    for visits in 100 500 1000; do
      run_benchmark \
        "${output_dir}/fixed-${threads}threads-${visits}visits.log" \
        -visits "${visits}" \
        -threads "${threads}"
    done
    ;;
  threads)
    for candidate_threads in 1 2 4 6 8 10; do
      run_benchmark \
        "${output_dir}/sweep-${candidate_threads}threads-100visits.log" \
        -visits 100 \
        -threads "${candidate_threads}"
    done
    ;;
  *)
    echo "Unknown KATAGOMO_BENCH_MODE: ${mode} (expected fixed or threads)" >&2
    exit 2
    ;;
esac

echo "Benchmark logs written to ${output_dir}"
