#!/usr/bin/env bash
# Redeploy the diary on the dalang.io VPS.
#
#   bash scripts/vps-update.sh          # from this machine (Windows/Git Bash)
#
# Why this exists rather than just running dalang-deploy.sh remotely: dalang
# exec runs in a persistent tmux session that cannot hold a multi-minute build,
# and a command longer than ~60 chars gets line-wrapped with the wrap newlines
# executed, wedging the session in an unclosed quote. So the work is started
# detached and the log is polled separately.
set -uo pipefail

VM="${VM:-diary-vm}"
export PATH="$HOME/bin:$PATH"

echo "== packaging current HEAD =="
TARBALL="C:/Users/you/AppData/Local/Temp/diary.tar.gz"
rm -f "$TARBALL"
git archive --format=tar.gz -o "$TARBALL" HEAD
ls -l "$TARBALL"

echo "== uploading =="
dalang scp "$TARBALL" "$VM:/root/diary.tar.gz"
dalang scp scripts/vps-apply.sh "$VM:/root/vps-apply.sh"

echo "== starting detached deploy =="
# Short command only: the launcher itself is on the VM.
dalang exec "$VM" "bash /root/vps-launch.sh"

echo
echo "Deploy started. It takes ~8 minutes (npm ci + a full Next build)."
echo "Watch progress:"
echo "  dalang exec $VM \"tail -c 600 /root/apply.log\""
echo "Then verify from outside:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://<your-subdomain>.svc.dalang.io/register"
