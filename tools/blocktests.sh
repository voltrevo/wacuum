#!/bin/sh
# Run every blockchain test for a fork (Cancun by default), four processes at a time, and print the totals.
# Each failure is printed with its test name; pass a directory or file after the fork to narrow it.
#
#     sh tools/blocktests.sh                       # every Cancun test under fixtures/blockchain_tests
#     sh tools/blocktests.sh Prague fixtures/blockchain_tests/prague
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
fork=${1:-Cancun}
where=${2:-$root/fixtures/blockchain_tests}
wac build --allow-read "$root/tools/blocktest.wac" -o "$root/dist/blocktest" >/dev/null
find "$where" -name '*.json' | sort | xargs -n 50 -P 4 wac "$root/dist/blocktest.wasm" --fork "$fork" > "$root/dist/blocktests.log" 2>&1 || true
grep '^FAIL' "$root/dist/blocktests.log" || true
grep 'passed,' "$root/dist/blocktests.log" | awk '{p += $1; f += $3} END {print p " passed, " f " failed"}'
