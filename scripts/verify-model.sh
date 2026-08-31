#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
model_path="${KATAGOMO_MODEL:-${project_root}/models/zhizi_renju28b_s1600.bin.gz}"
expected_size="269873929"
expected_sha256="5aa1381aa37ba1b724469c5c8df3b59177079f5c57b355856e144b8146581f6f"
actual_size="$(wc -c < "${model_path}" | tr -d ' ')"
actual_sha256="$(shasum -a 256 "${model_path}" | awk '{print $1}')"

test "${actual_size}" = "${expected_size}"
test "${actual_sha256}" = "${expected_sha256}"
gzip -t "${model_path}"
echo "Model size, gzip stream, and SHA-256 verified."
