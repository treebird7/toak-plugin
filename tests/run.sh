#!/bin/bash
# Zero-dependency test entry point. Node 22's built-in runner, no package.json,
# no install step — the same command CI runs.
set -euo pipefail
cd "$(dirname "$0")/.."

MIN_MAJOR=20
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt "$MIN_MAJOR" ]; then
  echo "toak-plugin tests need node >= $MIN_MAJOR (found $(node --version))" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  exec node --test "$@"
fi
exec node --test tests/*.test.js
