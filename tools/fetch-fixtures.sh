#!/bin/sh
# Fetch execution-spec-tests' released fixtures into fixtures/ (gitignored): about 250 MB compressed,
# 4.7 GB unpacked. The version is pinned so a pass count means the same thing tomorrow.
#
#     sh tools/fetch-fixtures.sh
set -eu
version=v5.4.0
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$root/fixtures"
cd "$root/fixtures"
if [ -f .version ] && [ "$(cat .version)" = "$version" ]; then echo "fixtures $version already here"; exit 0; fi
curl -fsSL -o fixtures.tar.gz "https://github.com/ethereum/execution-spec-tests/releases/download/$version/fixtures_stable.tar.gz"
tar -xzf fixtures.tar.gz --strip-components=1
rm fixtures.tar.gz
echo "$version" > .version
echo "fixtures $version in $root/fixtures"
