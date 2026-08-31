#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
engine_path="${KATAGOMO_ENGINE:-${project_root}/build/engine-eigen/katago}"
model_path="${KATAGOMO_MODEL:-${project_root}/models/zhizi_renju28b_s1600.bin.gz}"
output_dir="${project_root}/artifacts/stage1"
response_path="${output_dir}/analysis-response.jsonl"
stderr_path="${output_dir}/analysis-stderr.log"

test -x "${engine_path}"
KATAGOMO_MODEL="${model_path}" "${project_root}/scripts/verify-model.sh"
mkdir -p "${output_dir}"

"${engine_path}" analysis \
  -config "${project_root}/config/analysis.cfg" \
  -model "${model_path}" \
  < "${project_root}/smoke/renju-analysis.jsonl" \
  > "${response_path}" \
  2> "${stderr_path}"

jq -e -s '
  length > 1 and
  all(.[];
    .id == "stage1-renju-100" and
    (.isDuringSearch | type) == "boolean" and
    (.policy | length) == 226 and
    (.moveInfos | type) == "array" and
    all(.moveInfos[];
      has("move") and
      has("prior") and
      has("visits") and
      has("winrate") and
      has("order") and
      has("pv") and
      (.pv | type) == "array"
    ) and
    (.rootInfo | type) == "object" and
    (.rootInfo |
      has("currentPlayer") and
      has("visits") and
      has("winrate")
    )
  ) and
  any(.[]; .isDuringSearch == true) and
  ((map(select(.isDuringSearch == false)) | length) == 1)
' "${response_path}" >/dev/null

echo "Live and final JSON responses verified: ${response_path}"
tail -n 1 "${response_path}" | jq '{id,turnNumber,isDuringSearch,rootInfo,policyLength:(.policy|length),top3:.moveInfos[:3]}'
