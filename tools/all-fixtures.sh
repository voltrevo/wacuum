#!/bin/sh
# Every fixture suite for every fork this client runs, and the fork transitions: the numbers the README
# quotes. About half an hour. Writes dist/all-fixtures.txt as well as printing it.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist/all-fixtures.txt"
: > "$out"
for fork in Cancun Prague Osaka; do
  for suite in state block engine build; do
    r=$(sh "$root/tools/${suite}tests.sh" "$fork" | tail -1)
    echo "$fork $suite: $r" | tee -a "$out"
  done
done
for n in CancunToPragueAtTime15k PragueToOsakaAtTime15k OsakaToBPO1AtTime15k BPO1ToBPO2AtTime15k BPO2ToBPO3AtTime15k BPO3ToBPO4AtTime15k; do
  for suite in block engine; do
    r=$(sh "$root/tools/${suite}tests.sh" "$n" | tail -1)
    echo "$n $suite: $r" | tee -a "$out"
  done
done
