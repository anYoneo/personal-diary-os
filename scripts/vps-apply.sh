#!/bin/bash
# Apply an uploaded tarball to the running diary app and redeploy.
# Runs ON the VM. Idempotent. Keeps .env and the database untouched.
set -uo pipefail

APP=/root/diary-app
TARBALL=/root/diary.tar.gz

echo "== 1/3 verify upload =="
test -s "$TARBALL" || { echo "tarball missing"; exit 1; }
ls -l "$TARBALL"

echo "== 2/3 extract over the app (.env and node_modules are not in the archive) =="
# -C is required: a git archive tarball has no top-level folder and would
# otherwise spill its contents into the target directory (it once landed in /root
# and broke the build -- see next.config.ts).
tar xzf "$TARBALL" -C "$APP"
test -f "$APP/.env" && echo ".env present"
test -d "$APP/node_modules" && echo "node_modules present"
test -f "$APP/src/app/register/page.tsx" && echo "register page present"
test -f "$APP/src/app/api/auth/register/route.ts" && echo "register endpoint present"

echo "== 3/3 redeploy =="
cd "$APP"
bash scripts/dalang-deploy.sh
echo "VPS_APPLY_DONE"
