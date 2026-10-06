#!/bin/bash
# Deploy the keep-alive process without a rebuild.
set -e
cd /root/diary-app || exit 1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

if [ -f .env ]; then set -a; . ./.env; set +a; fi
export APP_URL="${APP_URL:-https://diary.example.com}"
export WEB_HOST="${WEB_HOST:-0.0.0.0}"
export WEB_PORT="${WEB_PORT:-80}"

echo "APP_URL=$APP_URL"
echo "WEB=$WEB_HOST:$WEB_PORT"

# 1. Make sure the web/worker/bot processes are declared (idempotent).
pm2 start scripts/ecosystem.config.cjs --update-env
# 2. Add the keep-alive process explicitly (start, not restart: it is new).
pm2 start scripts/ecosystem.config.cjs --only diary-keepalive --update-env
sleep 6
pm2 save
echo "--- pm2 status ---"
pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).forEach(p=>console.log(p.name, p.pm2_env.status, "restarts="+p.pm2_env.restart_time))}catch(e){console.log("parse fail")}})'
echo "--- keepalive log (tail) ---"
pm2 logs diary-keepalive --lines 8 --nostream 2>/dev/null | tail -10
