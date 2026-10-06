#!/usr/bin/env bash
#
# Host preparation for a plain Ubuntu VPS (dalang.io, Oracle, Contabo, …).
#
#   sudo bash scripts/vps-bootstrap.sh
#
# Idempotent — safe to re-run. Does four things:
#   1. installs Docker Engine + the compose plugin (so you can use the image)
#   2. installs Node 22 + pm2 for the light, no-Docker path
#   3. creates the diary data directory (mode 700, outside the app tree)
#   4. opens ONLY SSH in the host firewall — never the app port
#
# Why both paths: Docker is convenient and reproducible; pm2 writes far less to
# a small boot volume. Pick one; the script prepares either.
#
# Env overrides:
#   DIARY_DATA_DIR=/home/ubuntu/diary-data   APP_USER=ubuntu
set -euo pipefail

DATA_DIR="${DIARY_DATA_DIR:-/home/ubuntu/diary-data}"
APP_USER="${SUDO_USER:-ubuntu}"
NODE_MAJOR="${NODE_MAJOR:-22}"

echo "==> Diary data directory: $DATA_DIR (owner $APP_USER, mode 700)"
mkdir -p "$DATA_DIR"
chown -R "$APP_USER":"$APP_USER" "$DATA_DIR"
chmod 700 "$DATA_DIR"

# ── Docker (optional path) ───────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  echo "==> Docker already installed: $(docker --version)"
else
  echo "==> Installing Docker Engine + compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  # Handle both Debian and Ubuntu codenames.
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
  DISTRO="$(. /etc/os-release && echo "${ID:-ubuntu}")"
  curl -fsSL "https://download.docker.com/linux/${DISTRO}/gpg" \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/${DISTRO} ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  usermod -aG docker "$APP_USER" || true
  echo "    $APP_USER added to the docker group — log out and back in for it to apply."
fi

# ── Node 22 + pm2 (light path) ──────────────────────────────────────────────
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v\([0-9]*\).*/\1/')" -ge "$NODE_MAJOR" ]; then
  echo "==> Node already installed: $(node -v)"
else
  echo "==> Installing Node ${NODE_MAJOR}.x"
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "==> pm2 already installed: $(pm2 -v)"
else
  echo "==> Installing pm2"
  npm install -g pm2
fi

# ── Tailscale (gives SSH + a private HTTPS URL with no public IP) ────────────
if command -v tailscale >/dev/null 2>&1; then
  echo "==> Tailscale already installed: $(tailscale version | head -1)"
else
  echo "==> Installing Tailscale (for SSH and a private HTTPS address)"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo
echo "=============================================================="
echo " NEXT STEP — run this BY HAND (it needs a browser):"
echo
echo "   sudo tailscale up"
echo
echo "   It prints ONE URL. Open that URL in the browser on your own"
echo "   laptop and approve this machine. Afterwards it has a private"
echo "   IP, and from your laptop you can:"
echo "       ssh $(whoami)@<tailscale-ip>"
echo "   to send the project over (see DEPLOY-DALANG.md, step 1)."
echo "=============================================================="

# ── Firewall ────────────────────────────────────────────────────────────────
echo "==> Firewall: SSH only — the app port is never opened"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ufw status | head -10 || true
else
  echo "    ufw not present — leaving the firewall alone."
fi

cat <<EOF

==> Host ready.

Get the code onto the box, then choose ONE path.

── Path A: Docker (recommended) ──────────────────────────────────────────────
  cp .env.production.example .env.production     # fill it in
  docker compose run --rm web node scripts/deploy-migrate.mjs
  docker compose up -d --build
  npm run verify:deploy

── Path B: pm2 (lighter on a small disk) ─────────────────────────────────────
  npm ci && npx prisma generate && npm run build
  node scripts/deploy-migrate.mjs
  pm2 start scripts/ecosystem.config.cjs
  pm2 save && pm2 startup

── Required in .env.production ───────────────────────────────────────────────
  DATABASE_URL="file:$DATA_DIR/diary.db"
  APP_URL                                 public URL (used in Discord links)
  SESSION_SECRET                          long random string
  ADMIN_EMAIL / ADMIN_PASSWORD            your login
  DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID / DISCORD_GUILD_ID
  DISCORD_NOTIFY_CHANNEL_ID
  COOKIE_SECURE="false"                   ONLY if you serve over plain HTTP

── dalang.io specifics ───────────────────────────────────────────────────────
  - No public IP by default: the free subdomain maps to PORT 80.
    Path A: set WEB_BIND=0.0.0.0 WEB_PORT=80 in .env.production
    Path B: change "-p 3111 -H 127.0.0.1" to "-p 80 -H 0.0.0.0" in the pm2 config
  - Serving over plain HTTP means COOKIE_SECURE="false", otherwise login
    silently never persists.
  - Install Tailscale for SSH + a private pane:
      curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up

EOF
