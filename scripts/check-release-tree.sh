#!/usr/bin/env bash
set -euo pipefail

MAX_TRACKED_BYTES="${RELEASE_GUARD_MAX_BYTES:-10485760}"

if [[ ! "$MAX_TRACKED_BYTES" =~ ^[0-9]+$ ]] || [[ "$MAX_TRACKED_BYTES" -le 0 ]]; then
  echo "release-tree guard: RELEASE_GUARD_MAX_BYTES must be a positive integer" >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "release-tree guard: run this command inside a Git worktree" >&2
  exit 2
}
cd "$repo_root"

failures=0
seen_rejections="$(mktemp "${TMPDIR:-/tmp}/katagomo-release-guard.XXXXXX")"
trap 'rm -f "$seen_rejections"' EXIT

reject() {
  echo "release-tree guard: $1" >&2
  failures=$((failures + 1))
}

reject_once() {
  local key="$1"
  local message="$2"
  if ! grep -Fqx -- "$key" "$seen_rejections"; then
    printf '%s\n' "$key" >> "$seen_rejections"
    reject "$message"
  fi
}

path_rejection_reason() {
  local path="$1"
  case "$path" in
    models/.gitkeep|models/MANIFEST.json|.env.example|*/.env.example)
      return 1
      ;;
    models/*)
      echo "downloaded model"
      ;;
    vendor/KataGomo|vendor/KataGomo/*)
      echo "reproducible KataGomo checkout"
      ;;
    build|build/*|artifacts|artifacts/*|logs|logs/*|analysis_logs|analysis_logs/*|gtp_logs|gtp_logs/*)
      echo "generated build/runtime output"
      ;;
    .venv|.venv/*|*/.venv|*/.venv/*|node_modules|node_modules/*|*/node_modules|*/node_modules/*)
      echo "local dependency environment"
      ;;
    .env|.env.*|*/.env|*/.env.*)
      echo "environment file that may contain secrets"
      ;;
    *.pem|*.key|*.p12|*.pfx|id_rsa|*/id_rsa|id_ed25519|*/id_ed25519|credentials.json|*/credentials.json|service-account.json|*/service-account.json)
      echo "likely credential file"
      ;;
    *.log|.DS_Store|*/.DS_Store)
      echo "local log or OS metadata"
      ;;
    *)
      return 1
      ;;
  esac
}

# Check the current index as well as committed history so newly staged files are covered.
while IFS= read -r -d '' path; do
  if reason="$(path_rejection_reason "$path")"; then
    reject_once "path:$path" "forbidden tracked path ($reason): $path"
  fi

  blob_oid="$(git rev-parse --verify ":$path" 2>/dev/null || true)"
  blob_size="$(git cat-file -s ":$path" 2>/dev/null || true)"
  if [[ "$blob_size" =~ ^[0-9]+$ ]] && [[ "$blob_size" -gt "$MAX_TRACKED_BYTES" ]]; then
    reject_once "blob:${blob_oid:-$path}" "tracked blob exceeds ${MAX_TRACKED_BYTES} bytes (${blob_size} bytes): $path"
  fi
done < <(git ls-files -z)

# A shallow clone cannot prove that omitted history is clean. CI uses fetch-depth: 0.
if [[ "$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)" == "true" ]]; then
  reject_once "history:shallow" "repository is shallow; fetch full history before release validation"
fi

# Inspect every file tree reachable from local branches, remote refs, and tags. A path or
# blob committed and later deleted remains a release failure because a normal push can
# publish that object. Rejections are deduplicated by path or blob object ID.
while IFS= read -r commit; do
  [[ -n "$commit" ]] || continue
  short_commit="${commit:0:12}"
  while IFS=$'\t' read -r metadata path; do
    [[ -n "$path" ]] || continue
    read -r _mode object_type blob_oid blob_size <<< "$metadata"
    [[ "$object_type" == "blob" ]] || continue

    if reason="$(path_rejection_reason "$path")"; then
      reject_once \
        "path:$path" \
        "reachable history contains forbidden path ($reason) in $short_commit: $path"
    fi
    if [[ "$blob_size" =~ ^[0-9]+$ ]] && [[ "$blob_size" -gt "$MAX_TRACKED_BYTES" ]]; then
      reject_once \
        "blob:$blob_oid" \
        "reachable history contains blob over ${MAX_TRACKED_BYTES} bytes (${blob_size} bytes) in $short_commit: $path"
    fi
  done < <(git ls-tree -r -l "$commit")
done < <(git rev-list --all)

# Secret-content scanning intentionally covers tracked files in the current working tree
# only. It uses high-confidence shapes and prints filenames, never credential values.
secret_pattern='-----BEGIN ([A-Z0-9]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}'
if secret_files="$(git grep -I -l -E -e "$secret_pattern" -- 2>/dev/null)"; then
  while IFS= read -r path; do
    [[ -n "$path" ]] && reject_once "secret:$path" "possible embedded credential detected: $path"
  done <<< "$secret_files"
fi

if [[ "$failures" -ne 0 ]]; then
  echo "release-tree guard: FAILED with $failures problem(s)" >&2
  exit 1
fi

echo "release-tree guard: OK (current index and all reachable commits checked; blobs <= ${MAX_TRACKED_BYTES} bytes)"
