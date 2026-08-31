#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
engine_dir="${project_root}/vendor/KataGomo"
engine_repo="https://github.com/hzyhhzy/KataGomo.git"
engine_commit="df152116e3787c75c6a3de099d261ca092b7dfc1"

if [[ -e "${engine_dir}" && ! -d "${engine_dir}/.git" ]]; then
  echo "Refusing to replace non-Git path: ${engine_dir}" >&2
  exit 1
fi

if [[ -d "${engine_dir}/.git" ]] && git -C "${engine_dir}" rev-parse --verify HEAD >/dev/null 2>&1; then
  actual_commit="$(git -C "${engine_dir}" rev-parse HEAD)"
  actual_remote="$(git -C "${engine_dir}" remote get-url origin 2>/dev/null || true)"
  if [[ "${actual_commit}" != "${engine_commit}" ]]; then
    echo "Existing KataGomo checkout is ${actual_commit}, expected ${engine_commit}." >&2
    echo "It was left untouched. Move it aside or select the recorded commit manually." >&2
    exit 1
  fi
  if [[ "${actual_remote}" != "${engine_repo}" ]]; then
    echo "Existing KataGomo origin is ${actual_remote}, expected ${engine_repo}." >&2
    echo "It was left untouched." >&2
    exit 1
  fi
  if [[ -n "$(git -C "${engine_dir}" status --porcelain)" ]]; then
    echo "Existing KataGomo checkout has local changes or untracked files." >&2
    echo "It was left untouched; restore a clean official checkout before building." >&2
    exit 1
  fi
  echo "KataGomo source already verified: ${actual_commit}"
  exit 0
fi

mkdir -p "${project_root}/vendor"
if [[ ! -d "${engine_dir}/.git" ]]; then
  git init "${engine_dir}"
  git -C "${engine_dir}" remote add origin "${engine_repo}"
elif ! git -C "${engine_dir}" remote get-url origin >/dev/null 2>&1; then
  git -C "${engine_dir}" remote add origin "${engine_repo}"
fi

echo "Fetching official KataGomo Gom2024 commit ${engine_commit}..."
git -C "${engine_dir}" fetch --depth 1 origin "${engine_commit}"
git -C "${engine_dir}" checkout --detach "${engine_commit}"
test "$(git -C "${engine_dir}" rev-parse HEAD)" = "${engine_commit}"
