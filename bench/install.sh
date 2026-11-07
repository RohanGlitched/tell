#!/usr/bin/env bash
# Copyright (C) 2026 Rohan Borade
# SPDX-License-Identifier: Apache-2.0
#
# Installs the pinned versions of every tool in the benchmark, and Midnight's
# examples at the pinned commit. Linux x86-64 (or WSL), Node 22 or 24, git,
# curl, python3. No sudo, no accounts, no paid services.
#
#   BENCH_TOOLS=bench/.tools BENCH_EXAMPLES=bench/.corpus/midnight-examples bash bench/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
T="${BENCH_TOOLS:-bench/.tools}"
E="${BENCH_EXAMPLES:-bench/.corpus/midnight-examples}"
mkdir -p "$T" "$(dirname "$E")"

clone() { # repo dir commit
  [ -d "$2/.git" ] || git clone -q "https://github.com/$1.git" "$2"
  git -C "$2" fetch -q origin
  git -C "$2" -c advice.detachedHead=false checkout -q "$3"
}
check() { # file sha256
  echo "$2  $1" | sha256sum -c --quiet - || { echo "checksum mismatch: $1" >&2; exit 1; }
}

# Nightshade v0.1.1: the release package, installed as its README says
NS_TGZ="$T/nightshade-compact-0.1.1.tgz"
[ -f "$NS_TGZ" ] || curl -fsSL https://github.com/DicksonWu654/nightshade/releases/download/v0.1.1/nightshade-compact-0.1.1.tgz -o "$NS_TGZ"
check "$NS_TGZ" fee7af6cb124d677e7b62c90da22466dd2c0b5819de9625c11de398635a0a3d6
npm install --prefix "$T/nightshade" --no-audit --no-fund "$(realpath "$NS_TGZ")" >/dev/null
"$T/nightshade/node_modules/.bin/nightshade" --version

# Nightshade's source repository, for its published regression corpus (tests/corpus), which
# bench/nightshade-corpus.mjs runs Tell on. Not used to run Nightshade itself.
clone DicksonWu654/nightshade "$T/nightshade-src" 9ef4aeaa943ab244f59ab48855317c45f0267d72

# compact-guard: no releases; source at the last commit on master (Oct 19, 2026)
clone KAMEVETRICS/compact-guard "$T/compact-guard" 152b05d
(cd "$T/compact-guard" && npm ci --no-audit --no-fund >/dev/null && npm run build -w packages/analyzer -w packages/cli >/dev/null)
node "$T/compact-guard/packages/cli/bin/compact-guard.js" --version

# compact-lint: no dependencies; source at the head of main (Oct 1, 2026)
clone wbaxterh/compact-lint "$T/compact-lint" 812a6cc

# OpenZeppelin compact-security-detectors-sdk: release v0.0.3 binary. A source build
# fails today because the tree-sitter-compact submodule repository is no longer public.
OZ_ZIP="$T/compact-scanner-ubuntu-latest-v0.0.3.zip"
[ -f "$OZ_ZIP" ] || curl -fsSL https://github.com/OpenZeppelin/compact-security-detectors-sdk/releases/download/v0.0.3/compact-scanner-ubuntu-latest-v0.0.3.zip -o "$OZ_ZIP"
check "$OZ_ZIP" b318cc613032f5fcada48622fb011a062173cfa5a9050f0646e0a708722fbcb2
mkdir -p "$T/compact-scanner"
python3 -I -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$OZ_ZIP" "$T/compact-scanner"
chmod +x "$T/compact-scanner/compact-scanner"
"$T/compact-scanner/compact-scanner" metadata | head -5

# Midnight's examples at the pinned commit
clone midnightntwrk/midnight-examples "$E" 377495c5efbd5b1f3123f5aee2776c3694b05eda

# Tell itself needs the repository's node_modules and the Compact compilers it selects
# (0.31.1 for the zoo and cases, 0.36.0 for examples written for language 0.28):
#   npm ci && compact update 0.31.1 && compact update 0.36.0
echo "installed into $T and $E"
