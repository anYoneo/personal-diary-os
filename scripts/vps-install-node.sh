#!/bin/bash
# Install Node.js from the official tarball (no apt repo — Ubuntu 26.04 is too new
# for the nodesource/docker repos to carry it yet).
set -euo pipefail

cd /tmp
echo "== fetching index =="
curl -fsSL https://nodejs.org/dist/index.json -o index.json

# Newest LTS release, x64
VER=$(grep -o '"version":"v[0-9.]*","date":"[^"]*","files":\[[^]]*\],"npm":"[^"]*","v8":"[^"]*","uv":"[^"]*","zlib":"[^"]*","openssl":"[^"]*","modules":"[^"]*","lts":"[A-Za-z]' index.json \
      | sed 's/"version":"v\([0-9.]*\)".*"lts":"[A-Za-z]/\1/' | head -1)

if [ -z "$VER" ]; then
  # Fallback: first version whose lts field is a name (not false)
  VER=$(python3 - <<'PY'
import json
d = json.load(open('index.json'))
for r in d:
    if r.get('lts'):
        print(r['version'].lstrip('v')); break
PY
)
fi

echo "== latest LTS: v$VER =="
FILE="node-v${VER}-linux-x64.tar.xz"
URL="https://nodejs.org/dist/v${VER}/${FILE}"

echo "== downloading $FILE =="
curl -fsSLO "$URL"
ls -lh "$FILE"

echo "== extracting to /usr/local =="
tar -xJf "$FILE" -C /usr/local --strip-components=1 \
    --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
rm -f "$FILE"

echo "== installed =="
node -v
npm -v
echo "NODE_INSTALL_DONE"
