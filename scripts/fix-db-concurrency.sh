#!/bin/bash
# Fix SQLite contention: web + worker + bot all open the same file, and Prisma's
# default socket timeout (5s) plus no WAL makes concurrent writes fail with
# "Socket timeout (the database failed to respond to a query ...)".
#
# WAL lets readers and one writer coexist; connection_limit=1 per process stops
# the pool from piling up locks; socket_timeout gives slow queries room.
#
#   cd /root/diary-app && bash fix-db-concurrency.sh
set -uo pipefail

cd /root/diary-app
DB=/root/diary-data/diary.db

echo "== 1/5 journal mode before =="
python3 - <<'PY'
import sqlite3
c = sqlite3.connect('/root/diary-data/diary.db')
print("journal_mode =", c.execute("PRAGMA journal_mode").fetchone()[0])
print("busy_timeout =", c.execute("PRAGMA busy_timeout").fetchone()[0])
c.close()
PY

echo "== 2/5 enable WAL (persists in the file) =="
python3 - <<'PY'
import sqlite3
c = sqlite3.connect('/root/diary-data/diary.db')
print("set ->", c.execute("PRAGMA journal_mode=WAL").fetchone()[0])
c.execute("PRAGMA wal_autocheckpoint=1000")
c.close()
PY

echo "== 3/5 point DATABASE_URL at WAL-safe settings =="
# connection_limit=1  -> one connection per process, no lock pile-up
# socket_timeout=30   -> tolerate a slow writer instead of erroring at 5s
NEWURL='DATABASE_URL="file:/root/diary-data/diary.db?connection_limit=1&socket_timeout=30"'
if grep -q '^DATABASE_URL=' .env; then
  sed -i "s|^DATABASE_URL=.*|$NEWURL|" .env
else
  echo "$NEWURL" >> .env
fi
grep '^DATABASE_URL=' .env

echo "== 4/5 restart the three processes =="
pm2 restart ecosystem.config.cjs --update-env 2>/dev/null || pm2 restart all --update-env
sleep 8
pm2 status

echo "== 5/5 verify =="
python3 - <<'PY'
import sqlite3
c = sqlite3.connect('/root/diary-data/diary.db')
print("journal_mode now =", c.execute("PRAGMA journal_mode").fetchone()[0])
c.close()
PY
echo "login: $(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:80/login)"
echo DB_FIX_DONE
