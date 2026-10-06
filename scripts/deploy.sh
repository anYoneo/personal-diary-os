#!/usr/bin/env bash
#
# One-command deploy for the diary — run this ON THE VPS.
#
#   cd ~/personal-diary-os && bash scripts/deploy.sh
#
# It is idempotent: safe to run on a fresh checkout and safe to re-run after a
# `git pull`. It never deletes an existing diary — deploy-migrate refuses to
# touch a database that already has the owner account.
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${DEPLOY_MODE:-docker}"          # docker | pm2
BRANCH="${DEPLOY_BRANCH:-main}"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
[ -f "$(git rev-parse --show-toplevel 2>/dev/null)/package.json" ] 2>/dev/null || true
[ -f package.json ] || die "Run this from the repository root (package.json not found)."
[ -d node_modules ] || [ "$MODE" = "pm2" ] || true

if [ ! -f .env.production ]; then
  die "Missing .env.production. Copy it from the template and fill it in:
    cp .env.production.example .env.production && nano .env.production"
fi

# A diary served over plain HTTP cannot use a `secure` cookie.
if grep -qE '^APP_URL="?http://' .env.production && ! grep -qE '^COOKIE_SECURE="?false' .env.production; then
  die "APP_URL is plain http:// but COOKIE_SECURE is not \"false\".
       Login would appear to work and then bounce back to /login.
       Add this line to .env.production:  COOKIE_SECURE=\"false\""
fi

say "Latest code from origin/$BRANCH"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git fetch --quiet origin "$BRANCH" 2>/dev/null || true
  git checkout --quiet "$BRANCH" 2>/dev/null || true
  git pull --ff-only --quiet 2>/dev/null || echo "  (no remote or already current — continuing)"
fi

case "$MODE" in
  # ── Docker ────────────────────────────────────────────────────────────────
  docker)
    command -v docker >/dev/null 2>&1 || die "docker not found. Run scripts/vps-bootstrap.sh first."

    # Compose substitutes ${VAR} from .env, not from .env.production.
    WEB_BIND="$(grep -E '^WEB_BIND=' .env.production 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
    WEB_PORT="$(grep -E '^WEB_PORT=' .env.production 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
    export WEB_BIND="${WEB_BIND:-127.0.0.1}"
    export WEB_PORT="${WEB_PORT:-3111}"
    say "Web will bind ${WEB_BIND}:${WEB_PORT}"

    say "Building the image"
    docker compose build

    say "Applying the schema and seeding the owner"
    docker compose run --rm -T web node scripts/deploy-migrate.mjs

    say "Starting web + worker + bot"
    docker compose up -d --remove-orphans

    say "Waiting for health"
    for i in $(seq 1 30); do
      if curl -fsS "http://127.0.0.1:${WEB_PORT}/login" >/dev/null 2>&1; then
        echo "  web is answering on 127.0.0.1:${WEB_PORT}"
        break
      fi
      [ "$i" = 30 ] && die "web did not answer on 127.0.0.1:${WEB_PORT} after 60s.
       Check:  docker compose logs --tail=50 web"
      sleep 2
    done
    ;;

  # ── pm2 ───────────────────────────────────────────────────────────────────
  pm2)
    command -v node >/dev/null 2>&1 || die "node not found. Run scripts/vps-bootstrap.sh first."
    command -v pm2  >/dev/null 2>&1 || die "pm2 not found. Install: npm i -g pm2"

    say "Installing dependencies"
    npm ci

    say "Generating the Prisma client"
    npx prisma generate

    say "Building"
    npm run build

    say "Applying the schema and seeding the owner"
    node scripts/deploy-migrate.mjs

    say "Starting web + worker + bot under pm2"
    pm2 startOrReload scripts/ecosystem.config.cjs
    pm2 save
    pm2 status
    ;;
  *)
    die "Unknown DEPLOY_MODE '$MODE' (expected 'docker' or 'pm2')."
    ;;
esac

# ── Verify ───────────────────────────────────────────────────────────────────
say "Verifying end-to-end over HTTP"
BASE_URL="http://127.0.0.1:${WEB_PORT:-3111}" node scripts/verify-deploy.mjs

PW="$(grep -E '^ADMIN_PASSWORD=' .env.production | cut -d= -f2- | tr -d '"')"
EMAIL="$(grep -E '^ADMIN_EMAIL=' .env.production | cut -d= -f2- | tr -d '"')"

cat <<EOF

────────────────────────────────────────────────────────────
Deployed. Next:

  • Open the app:      ${APP_URL:-see APP_URL in .env.production}
  • Log in as:         ${EMAIL}
  • Check the workers: $( [ "$MODE" = docker ] && echo "docker compose logs -f worker bot" || echo "pm2 logs" )

ADMIN_PASSWORD starts with: ${PW:0:3}…  (only you know the rest)
EOF
