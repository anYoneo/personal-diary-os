#!/usr/bin/env bash
#
# Idempotent host preparation for Ubuntu on Oracle Cloud Always Free (ARM).
#
#   sudo bash scripts/oracle-bootstrap.sh
#
# Installs Docker (with the compose plugin), creates the data directory that
# holds the diary, and configures the firewall. It is safe to re-run.
#
# Deliberate choices:
#   - No 3111 port is ever opened to the internet. The web app binds to
#     loopback and public traffic arrives through the tunnel only.
#   - The data directory is created with mode 700; the diary is private.
set -euo pipefail

DATA_DIR="${DIARY_DATA_DIR:-/home/ubuntu/diary-data}"
APP_USER="${SUDO_USER:-ubuntu}"
PORT="${PORT:-3111}"

echo "==> Preparing $DATA_DIR (owned by $APP_USER)"
mkdir -p "$DATA_DIR"
chown -R "$APP_USER":"$APP_USER" "$DATA_DIR"
chmod 700 "$DATA_DIR"

if command -v docker >/dev/null 2>&1; then
  echo "==> Docker already present: $(docker --version)"
else
  echo "==> Installing Docker Engine + compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  usermod -aG docker "$APP_USER"
  echo "    $APP_USER added to the docker group (re-login for it to take effect)."
fi

echo "==> Firewall: allowing SSH + HTTPS, NOT the app port"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp  >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ufw status | head -20 || true
else
  echo "    ufw not present; leaving the host firewall alone."
  echo "    (Oracle's own Security List / NSG still governs inbound traffic.)"
fi

cat <<EOF

==> Host is ready.

Next steps, in order:

 1. Put this project on the host (git clone or scp).
 2. Create .env.production from .env.example, then set:
      DATABASE_URL="file:$DATA_DIR/diary.db"
      ADMIN_EMAIL / ADMIN_PASSWORD        (your login)
      SESSION_SECRET                       (long random string)
      APP_URL                              (your public https URL)
      DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID / DISCORD_GUILD_ID
      DISCORD_NOTIFY_CHANNEL_ID
      (leave DISCORD_CAPTURE_DMS unset unless you own this bot outright)
 3. Initialise the database:
      docker compose --env-file .env.production run --rm web node scripts/deploy-migrate.mjs
 4. Start everything:
      docker compose --env-file .env.production up -d --build
 5. Check it:
      curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$PORT/login

 The app listens on 127.0.0.1:$PORT only. Expose it with a tunnel:
   - Cloudflare Tunnel (needs a domain whose nameservers point at Cloudflare)
   - Tailscale Funnel (needs no domain at all: tailscale funnel $PORT)

EOF
