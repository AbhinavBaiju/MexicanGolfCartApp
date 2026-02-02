#!/usr/bin/env bash
set -euo pipefail

log() {
  printf "[deploy] %s\n" "$*"
}

warn() {
  printf "[deploy][warn] %s\n" "$*" >&2
}

die() {
  printf "[deploy][error] %s\n" "$*" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  local cmd="$1"
  if ! have_cmd "$cmd"; then
    die "Missing required command: $cmd"
  fi
}

search_cmd() {
  if have_cmd rg; then
    echo "rg"
  else
    echo "grep -E"
  fi
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local label="${3:-$pattern}"
  local search
  search="$(search_cmd)"
  if ! $search -q "$pattern" "$file"; then
    die "Expected $label in $file"
  fi
}

assert_file_exists() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    die "Missing required file: $file"
  fi
}

run() {
  local cmd="$*"
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    log "DRY_RUN: $cmd"
  else
    log "$cmd"
    eval "$cmd"
  fi
}
