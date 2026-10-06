#!/bin/bash
# Deploy / redeploy the diary on a dalang.io VPS (no Docker, no public IP).
#
#   cd /root/diary-app && bash scripts/dalang-deploy.sh
#
# Reproduces exactly what was verified working on 2026-10-05:
#   Node tarball -> npm ci -> prisma generate -> build -> schema+seed ->
#   SQLite WAL + timeout settings -> pm2 (web on :80, worker, bot)
#
# Idempotent. deploy-migrate refuses to touch a database that already has the
# owner account, so re-running never destroys the diary.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

DATA_DIR="${DIARY_DATA_DIR:-/root/diary-data}"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

say "0/7 preflight"
[ -f .env ] || { echo "Missing .env — copy .env.production.example and fill it in."; exit 1; }
command -v node >/dev/null || { echo "No node. Run scripts/vps-install-node.sh first."; exit 1; }
node -v; npm -v
mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR"

# dalang.io's Cloudflare front reaches the VM on port 80; there is no public IP.
export DIARY_DATA_DIR="$DATA_DIR" WEB_PORT=80 WEB_HOST=0.0.0.0

# APP_URL must be in the environment that pm2 captures, because the keep-alive
# process reads it to find the public URL it has to keep warm. Read it out of
# .env rather than sourcing the file (values may contain quotes and spaces).
if [ -z "${APP_URL:-}" ]; then
  APP_URL="$(sed -n 's/^[[:space:]]*APP_URL[[:space:]]*=[[:space:]]*//p' .env | head -1 | tr -d '"' | tr -d "'" | tr -d '\r')"
fi
export APP_URL
echo "APP_URL=$APP_URL"

# Install BEFORE NODE_ENV=production is set, and say --include=dev explicitly:
# npm skips devDependencies when NODE_ENV=production, but this app needs several
# of them on the server (tailwindcss + @tailwindcss/postcss to build, tsx to run
# the worker and the bot). Installing "production only" yields a build failure
# and pm2 processes that cannot start.
say "1/7 dependencies"
npm ci --include=dev

export NODE_ENV=production

say "2/7 prisma client"
npx prisma generate

say "3/7 build"
# Clear the Turbopack cache. A stale .next from an earlier failed build gets
# reused verbatim, so a fixed config can still produce the old error (we hit
# exactly that: the PostCSS failure persisted after the root was corrected).
rm -rf .next node_modules/.cache/turbopack
npm run build

# Fail here, loudly, BEFORE touching pm2: a failed build used to fall through to
# "pm2 delete all", which took down a perfectly healthy running app and left it
# serving 502s with no production build.
if [ ! -f .next/BUILD_ID ]; then
  echo "BUILD FAILED — .next/BUILD_ID is missing. The running app is untouched."
  exit 1
fi
echo "build ok ($(cat .next/BUILD_ID))"

say "4/7 schema + owner account"
node scripts/deploy-migrate.mjs

# Several processes share one SQLite file. Without these, Prisma's 5s default
# socket timeout fires under concurrent writes ("Socket timeout ...").
say "5/7 sqlite concurrency settings"
node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRawUnsafe("PRAGMA journal_mode=WAL")
  .then(r => { console.log("journal_mode:", r[0].journal_mode); return p.$disconnect(); })
  .catch(e => { console.error("wal:", String(e).slice(0,120)); process.exit(1); });
'
if ! grep -q 'socket_timeout' .env; then
  python3 - <<'PY'
import re
p = '.env'
s = open(p).read()
s = re.sub(r'^DATABASE_URL=.*$',
           'DATABASE_URL="file:/root/diary-data/diary.db?connection_limit=1&socket_timeout=30"',
           s, count=1, flags=re.M)
open(p, 'w').write(s)
PY
  grep '^DATABASE_URL=' .env
fi

say "6/7 pm2"
command -v pm2 >/dev/null || npm install -g pm2
# ecosystem.config.cjs lives in scripts/, so run pm2 from there.
cd "$APP_DIR/scripts"
pm2 delete all >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
sleep 8
pm2 status

say "7/7 health"
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:80/login || true)
  [ "$CODE" = "200" ] && { echo "web OK on :80 (HTTP $CODE)"; break; }
  sleep 3
done
echo "worker: $(tail -1 /root/.pm2/logs/diary-worker-out.log 2>/dev/null)"
echo "bot:    $(tail -1 /root/.pm2/logs/diary-bot-out.log 2>/dev/null)"
# The keep-alive process is what stops the first click of the day from waiting
# ~7s for the Cloudflare -> VM path to come back; say whether it is actually up.
echo "keepalive: $(tail -1 /root/.pm2/logs/diary-keepalive-out.log 2>/dev/null)"
echo
echo "Deployed. Public URL is the value of APP_URL in .env."
echo DALANG_DEPLOY_DONE
