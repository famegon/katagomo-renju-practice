#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
model_dir="${project_root}/models"
model_path="${model_dir}/zhizi_renju28b_s1600.bin.gz"
partial_path="${model_path}.part"
model_url="https://github.com/hzyhhzy/KataGomo/releases/download/Gomoku_20250206/zhizi_renju28b_s1600.bin.gz"
expected_size="269873929"
expected_sha256="5aa1381aa37ba1b724469c5c8df3b59177079f5c57b355856e144b8146581f6f"

verify_file() {
  local path="$1"
  local actual_size actual_sha256
  actual_size="$(wc -c < "${path}" | tr -d ' ')"
  actual_sha256="$(shasum -a 256 "${path}" | awk '{print $1}')"
  [[ "${actual_size}" = "${expected_size}" && "${actual_sha256}" = "${expected_sha256}" ]]
}

if [[ -f "${model_path}" ]]; then
  if verify_file "${model_path}" && gzip -t "${model_path}"; then
    echo "Model already verified: ${model_path}"
    exit 0
  fi
  echo "Existing model has an unexpected size or SHA-256 and was left untouched: ${model_path}" >&2
  exit 1
fi

mkdir -p "${model_dir}"
echo "Downloading the official 269,873,929-byte Renju b28c512nbt model..."
if [[ -f "${partial_path}" ]]; then
  partial_size="$(wc -c < "${partial_path}" | tr -d ' ')"
  if (( partial_size > expected_size )); then
    echo "Partial download is larger than the official model and was left untouched: ${partial_path}" >&2
    echo "Move or remove it before retrying." >&2
    exit 1
  fi
  if (( partial_size == expected_size )); then
    if verify_file "${partial_path}" && gzip -t "${partial_path}"; then
      mv "${partial_path}" "${model_path}"
      echo "Completed partial download verified: ${expected_sha256}"
      exit 0
    fi
    echo "Completed partial download failed verification and was left untouched: ${partial_path}" >&2
    echo "Move or remove it before retrying." >&2
    exit 1
  fi
  echo "Resuming the existing ${partial_size}-byte partial download."
fi

retry_all_errors=()
if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
  retry_all_errors=(--retry-all-errors)
fi

curl \
  --fail \
  --location \
  --continue-at - \
  --retry 5 \
  --retry-delay 2 \
  "${retry_all_errors[@]}" \
  --connect-timeout 30 \
  --output "${partial_path}" \
  "${model_url}"

if ! verify_file "${partial_path}"; then
  echo "Downloaded model failed size or SHA-256 verification; keeping .part for inspection." >&2
  exit 1
fi
gzip -t "${partial_path}"
mv "${partial_path}" "${model_path}"
echo "Model verified: ${expected_sha256}"
