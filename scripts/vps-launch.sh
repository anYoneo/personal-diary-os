#!/bin/bash
# One short line so the tmux session cannot wrap it. Kept on the VM.
rm -f /root/apply.log
setsid nohup bash /root/vps-apply.sh > /root/apply.log 2>&1 < /dev/null &
echo "started; log at /root/apply.log"
