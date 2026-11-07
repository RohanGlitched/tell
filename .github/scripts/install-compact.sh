#!/usr/bin/env bash
# Copyright (C) 2026 Rohan Borade
# SPDX-License-Identifier: Apache-2.0
#
# Makes sure the Compact compilers a job needs are installed, after
# midnightntwrk/setup-compact-action (which runs with continue-on-error). That action, and
# `compact update`, ask the GitHub API for the release list; on a shared runner that call is
# sometimes refused or times out, and the job failed with "Error while fetching compact releases".
#
#   install-compact.sh <default version> [more versions...]
#
# For each version: `compact update` up to 3 times with backoff (with GITHUB_TOKEN set, the
# devtool's API calls are authenticated), then, if that still fails, the release zip itself from
# github.com/midnightntwrk/compact/releases (a download, not an API call), unpacked where the
# devtool keeps it. The first version becomes the default. Fails if any version is missing at the end.
set -uo pipefail

[ $# -ge 1 ] || { echo "usage: $0 <default version> [more versions...]" >&2; exit 2; }
DEFAULT="$1"
ROOT="${COMPACT_DIRECTORY:-$HOME/.compact}"
ARCH=x86_64-unknown-linux-musl
command -v compact >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"

have() { [ -x "$ROOT/versions/$1/$ARCH/compactc.bin" ] && "$ROOT/versions/$1/$ARCH/compactc.bin" --version >/dev/null 2>&1; }
is_default() { [[ "$(readlink -f "$ROOT/bin/compactc" 2>/dev/null)" == "$(readlink -f "$ROOT/versions/$1/$ARCH")"/* ]]; }

retry() { # retry <what> <command...>: 3 attempts, 10 s then 30 s apart
  local what="$1"; shift
  for i in 1 2 3; do
    "$@" && return 0
    [ "$i" = 3 ] && break
    local wait=$((i == 1 ? 10 : 30))
    echo "::warning title=Compact::$what failed (attempt $i of 3); retrying in ${wait}s"
    sleep "$wait"
  done
  return 1
}

# The devtool itself, in case the action failed before installing it.
if ! command -v compact >/dev/null 2>&1; then
  retry "installing the compact devtool" sh -c 'curl --proto "=https" --tlsv1.2 -LsSf --retry 3 https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh' \
    || { echo "::error title=Compact::could not install the compact devtool"; exit 1; }
fi
[ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.local/bin" >> "$GITHUB_PATH"

# Straight from the release page: the same files `compact update` unpacks.
download() {
  local v="$1" dir="$ROOT/versions/$1/$ARCH" tmp
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 --retry-delay 5 -o "$tmp/artifact.zip" \
    "https://github.com/midnightntwrk/compact/releases/download/compactc-v$v/compactc_v${v}_$ARCH.zip" || { rm -rf "$tmp"; return 1; }
  mkdir -p "$dir" && unzip -oq "$tmp/artifact.zip" -d "$dir" && mv "$tmp/artifact.zip" "$dir/artifact.zip"
  chmod +x "$dir"/compactc "$dir"/compactc.bin "$dir"/fixup-compact "$dir"/format-compact "$dir"/zkir* 2>/dev/null
  rm -rf "$tmp"
  have "$v"
}

# `latest` (the Action's input allows it) names no release to download: retry the update only.
if [ "$DEFAULT" = latest ] && [ $# -eq 1 ]; then
  if compact compile --version >/dev/null 2>&1 || retry "compact update" compact update; then compact compile --version; exit 0; fi
  echo "::error title=Compact::could not install the latest compiler"; exit 1
fi

# Every version but the default first (without changing the default), the default last.
fail=0
for v in "${@:2}" "$DEFAULT"; do
  if [ "$v" = "$DEFAULT" ]; then flags=(); else flags=(--no-set-default); fi
  # already there (the action worked): no more API calls
  if have "$v" && { [ "$v" != "$DEFAULT" ] || is_default "$v"; }; then echo "compact $v: installed"; continue; fi
  if retry "compact update $v" compact update "${flags[@]}" "$v" && have "$v"; then echo "compact $v: installed"; continue; fi
  echo "::warning title=Compact::compact update $v kept failing; downloading the release directly"
  if retry "downloading compact $v" download "$v"; then
    echo "compact $v: installed from the release zip"
    if [ "$v" = "$DEFAULT" ]; then
      # what `compact update` does to make a version the default
      mkdir -p "$ROOT/bin"
      for t in compactc fixup-compact format-compact; do ln -sf "$ROOT/versions/$v/$ARCH/$t" "$ROOT/bin/$t"; done
    fi
  else
    echo "::error title=Compact::could not install compiler $v"
    fail=1
  fi
done
[ "$fail" = 0 ] || exit 1

for v in "$DEFAULT" "${@:2}"; do echo "compactc $v: $("$ROOT/versions/$v/$ARCH/compactc.bin" --version)"; done
compact compile "+$DEFAULT" --version
