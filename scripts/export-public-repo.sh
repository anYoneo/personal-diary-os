#!/usr/bin/env bash
# Build a clean, publishable copy of this repo — no history, no private details.
#
# The working tree stays private: it keeps the real VPS name, the live URL, the
# owner's email and the machine paths that the deploy scripts need. This script
# exports only the tracked files from HEAD into a sibling directory, strips the
# infrastructure details, and verifies the result, so the published repo can
# never drift from what you actually run.
#
#   bash scripts/export-public-repo.sh              # -> ../personal-diary-os-public
#   OUT=/somewhere/else bash scripts/export-public-repo.sh
#
# The output is NOT a clone: it has no .git, so it cannot leak history. Commit
# and push it yourself (or from the destination directory).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
OUT="${OUT:-$(dirname "$REPO")/personal-diary-os-public}"

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: the working tree has uncommitted changes; the export uses HEAD only" >&2
fi

echo "== exporting tracked files from HEAD =="
rm -rf "$OUT"
mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
echo "   $(git ls-files | wc -l) tracked files -> $OUT"

# The redaction values are deliberately not tracked, so they travel separately.
if [ ! -f .publish-redactions.json ]; then
  echo "missing .publish-redactions.json — see the header of scripts/sanitize-export.mjs" >&2
  exit 1
fi
cp .publish-redactions.json "$OUT/.publish-redactions.json"

echo "== committing the export is your job (it has no .git) =="
ls -a "$OUT" | grep -q '^\.git$' && { echo "refusing: export contains .git" >&2; exit 1; }

echo "== redacting private infrastructure details =="
(cd "$OUT" && node scripts/sanitize-export.mjs)

echo "== verifying the export =="
(cd "$OUT" && node scripts/sanitize-export.mjs --check)

echo "== scanning for secrets (both directions) =="
PATTERNS='gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY'
if grep -rIlE "$PATTERNS" "$OUT" 2>/dev/null | head -5 | grep -q .; then
  echo "refusing: secret-looking content found:" >&2
  grep -rIlE "$PATTERNS" "$OUT" 2>/dev/null | head -5 >&2
  exit 1
fi
echo "   no token-shaped strings"

# The redaction values are private in their own right, so they must not ship.
for private_file in .publish-redactions.json .env .env.local; do
  if [ -f "$OUT/$private_file" ] && [ "$private_file" != ".publish-redactions.json" ]; then
    echo "refusing: $private_file reached the export" >&2
    exit 1
  fi
done
if [ -f "$OUT/.env" ] || [ -f "$OUT/.env.local" ]; then
  echo "refusing: an .env file reached the export" >&2
  exit 1
fi
echo "   no .env files"

# Nothing in the export may still quote this machine's private values, so read
# the config and grep for each of them one last time.
echo "== independent check: no private value survives =="
# node is a native program: it needs a Windows path, not the MSYS one.
OUT_NATIVE="$(cygpath -w "$OUT" 2>/dev/null || echo "$OUT")"
node -e '
const fs = require("node:fs");
const dir = process.argv[1];
const cfg = JSON.parse(fs.readFileSync(dir + "\\.publish-redactions.json", "utf8"));
const values = [cfg.appUrl, cfg.vm, cfg.ownerEmail, cfg.windowsUser, cfg.ownerDiscordId];
fs.writeFileSync(dir + "\\.private-values.txt", values.join("\n"));
' "$OUT_NATIVE"
while IFS= read -r value; do
  [ -z "$value" ] && continue
  # Exclude the config (it defines the values) and the scratch list; both are
  # removed from the export immediately after this check. The `|| true` matters:
  # under `set -e`, a command substitution whose pipeline finds nothing returns 1
  # and would abort the script right here.
  survivors="$(grep -rIl -- "$value" "$OUT" 2>/dev/null | grep -vE "\.private-values\.txt|\.publish-redactions\.json$" || true)"
  if [ -n "$survivors" ]; then
    echo "refusing: the export still contains a private value" >&2
    echo "$survivors" | head -3 >&2
    exit 1
  fi
done < "$OUT/.private-values.txt"
rm -f "$OUT/.private-values.txt" "$OUT/.publish-redactions.json"
echo "   clean"

echo
echo "ready: $OUT"
echo
echo "next:"
echo "  1. create an EMPTY private repo on GitHub (no README, no .gitignore)"
echo "  2. cd \"$OUT\""
echo "  3. git init -b main && git add -A && git commit -m 'Initial public release'"
echo "  4. git remote add origin git@github.com:<you>/<repo>.git"
echo "  5. git push -u origin main"
