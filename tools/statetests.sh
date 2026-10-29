#!/bin/sh
# Run every state test for a fork (Cancun by default), four processes at a time, and print the totals.
# Each failure is printed with its test name; pass a directory or file after the fork to narrow it.
#
#     sh tools/statetests.sh                         # every Cancun case under fixtures/state_tests
#     sh tools/statetests.sh Cancun fixtures/state_tests/cancun
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
fork=${1:-Cancun}
where=${2:-$root/fixtures/state_tests}
wac build --allow-read "$root/tools/statetest.wac" -o "$root/dist/statetest" >/dev/null
find "$where" -name '*.json' | sort | xargs -n 100 -P 4 wac "$root/dist/statetest.wasm" --fork "$fork" > "$root/dist/statetests.log" 2>&1 || true
grep '^FAIL' "$root/dist/statetests.log" || true
grep 'passed,' "$root/dist/statetests.log" | awk '{p += $1; f += $3} END {print p " passed, " f " failed"}'
