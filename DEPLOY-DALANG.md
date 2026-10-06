# Deploy ke VPS dalang.io — runbook

Konteks: VPS dalang.io **tidak punya IP publik**. Panel memberi Web Terminal. Karena itu semua
langkah di bawah dijalankan **dari dalam Web Terminal**, dan akses jarak jauh diselesaikan dengan
Tailscale.

Keputusan yang sudah diambil:
- **Runtime: Docker** — RAM ≥4 GB, jadi tidak ada alasan berhemat.
- **Jaringan: Tailscale** — HTTPS otomatis, cookie tetap `secure`, SSH dari laptop ikut dapat.
- **Port app tetap 3111 di loopback.** Tidak perlu ubah apa pun di `docker-compose.yml`.

---

## Prasyarat — cek di panel dalang.io

1. **OS: Ubuntu 24.04 LTS** (atau 22.04). Kalau bukan Ubuntu/Debian, beri tahu saya — skrip
   bootstrap perlu disesuaikan.
2. **RAM ≥ 4 GB, disk ≥ 20 GB.**
3. **Buka Web Terminal** dan pastikan kamu jadi root, atau bisa `sudo`.

Konfirmasi cepat di Web Terminal:

```bash
cat /etc/os-release | head -2     # harusnya Ubuntu
free -h | head -2                 # RAM
df -h / | tail -1                 # disk
whoami                            # root, atau user dengan sudo
```

---

## Langkah 1 — Tailscale dulu (ini juga jalan keluar untuk SSH)

Kuncinya: jangan kirim kode dulu. **Bikin jalur SSH-nya lebih dulu** — hanya perlu satu baris.

Di **Web Terminal** dalang.io, ketik:

```bash
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
```

Tailscale mencetak **satu URL**. Buka URL itu di browser **laptop** kamu, login, lalu approve mesin
ini. Setelah selesai, kembali ke Web Terminal:

```bash
tailscale ip -4        # catat IP 100.x.y.z — ini alamat SSH-mu
tailscale status
```

**Di laptop** — pasang Tailscale kalau belum ada (Windows: unduh dari tailscale.com/download),
login dengan akun yang sama, lalu tes:

```bash
ssh ubuntu@<IP-100.x.y.z>
```

Kalau sudah bisa masuk tanpa Web Terminal, semua langkah berikutnya jauh lebih nyaman.

> **Kalau perintah `curl … | sh` diblokir** (Web Terminal kadang membatasi): tampilkan isi
> `/c/Users/you/AppData/Local/Temp/first-contact.sh` di laptop (`cat` file itu, 140 baris),
> salin seluruhnya, tempel ke Web Terminal. Blok itu memasang Docker + Node + pm2 + Tailscale
> sekaligus, jadi kamu bisa langsung lompat ke Langkah 3.

---

## Langkah 2 — kirim kodenya lewat scp

Karena jalurnya sudah ada, ukuran file tidak lagi masalah.

**Di laptop:**

```bash
T="$(cygpath -u "$LOCALAPPDATA")/Temp/diary-deploy.tar.gz"
scp "$T" ubuntu@<IP-100.x.y.z>:~/diary-deploy.tar.gz
```

**Di VPS:**

```bash
cd ~ && tar -xzf diary-deploy.tar.gz && cd personal-diary-os && ls DEPLOY-DALANG.md scripts/deploy.sh
```

> Sudah diverifikasi: tarball 223 KB, 165 file, **tanpa secret**, dan semua `.sh` di dalamnya
> bergaris akhir LF. Kalau CRLF lolos ke Linux, skripnya mati dengan
> `bad interpreter: /bin/bash^M` — itu sebabnya ada `.gitattributes`.

**Alternatif tanpa scp:** unggah `diary-deploy.tar.gz` lewat File Manager panel dalang.io, atau
salin file itu ke `G:\My Drive` lalu unduh dari sana.

---

## Langkah 3 — siapkan host

```bash
cd ~/personal-diary-os
sudo bash scripts/vps-bootstrap.sh
```

Skrip ini idempoten (aman diulang). Yang dilakukan:
- install Docker Engine + plugin compose
- install Node 22 + pm2 (cadangan, tidak dipakai)
- install Tailscale
- buat direktori data diary dengan **mode 700** (hanya pemilik yang bisa membaca)
- firewall: **hanya SSH** yang dibuka — port app tidak pernah terbuka ke internet

Verifikasi:

```bash
docker --version && docker compose version
ls -ld /home/ubuntu/diary-data      # harus drwx------ (700)
```

> Catatan: kalau kamu login sebagai `root` bukan `ubuntu`, jalankan
> `sudo DIARY_DATA_DIR=/root/diary-data APP_USER=root bash scripts/vps-bootstrap.sh`.

---

## Langkah 4 — isi `.env.production`

```bash
cd ~/personal-diary-os
cp .env.production.example .env.production
nano .env.production
```

Isi yang **wajib**:

```bash
DATABASE_URL="file:/data/diary.db"        # sudah benar, jangan diubah (volume Docker)
SESSION_SECRET="..."                      # generate di bawah
ADMIN_EMAIL="you@example.com"
ADMIN_PASSWORD="..."                      # password panjang, ini kunci diary-mu
TIMEZONE="Asia/Jakarta"

# Discord — salin nilainya dari .env lokal di laptop
DISCORD_BOT_TOKEN="..."
DISCORD_APPLICATION_ID="..."
DISCORD_GUILD_ID="..."
DISCORD_NOTIFY_CHANNEL_ID="..."
DISCORD_CAPTURE_DMS="false"

APP_URL="https://<nama-vps>.<tailnet>.ts.net"

# JANGAN diset: biarkan default supaya cookie tetap secure (kita pakai HTTPS Tailscale)
# COOKIE_SECURE tidak perlu ada sama sekali
# WEB_BIND / WEB_PORT juga tidak perlu — default 127.0.0.1:3111 sudah benar
```

Generate `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Kunci file ini supaya tidak terbaca orang lain:

```bash
chmod 600 .env.production
```

Di laptop, untuk melihat nilai Discord yang perlu disalin (nilai tidak akan ditampilkan penuh):

```bash
cd /c/Users/you/personal-diary-os && grep -E "^(DISCORD_[A-Z_]+)=" .env | sed 's/=.*/=<ada>/'
```

---

## Langkah 5 — deploy

```bash
cd ~/personal-diary-os
bash scripts/deploy.sh
```

Skrip akan: build image → terapkan schema + seed akun pemilik → jalankan web + worker + bot →
tunggu sehat → jalankan verifikasi 7 pemeriksaan.

Yang harus muncul di akhir:

```
  PASS  GET /login — 200
  PASS  POST /api/auth/login — session cookie issued
  PASS  POST /api/entries — 201
  PASS  PATCH keeps tags (autosave summary)
  PASS  autosave preserved type/mood/important
  PASS  DELETE /api/entries/:id — 200
  PASS  GET /api/entries unauthenticated — 401
All deployment checks passed.
```

Cek status:

```bash
docker compose ps                       # semua Up, diary-web healthy
docker compose logs --tail=30 worker bot
```

---

## Langkah 6 — pilih mode akses Tailscale

Tailscale sudah aktif sejak Langkah 1. Sekarang tentukan siapa yang boleh membuka diary.

| | `tailscale serve` | `tailscale funnel` |
|---|---|---|
| Siapa yang bisa buka | **hanya perangkat di tailnet-mu** | **seluruh internet** |
| Sumber daya | gratis, tanpa batas bandwidth | dibatasi bandwidth |
| Halaman login terlihat publik? | **tidak** | **ya** |
| HTTPS | ✓ | ✓ |
| Cocok untuk diary | **✓ disarankan** | hanya kalau kamu perlu buka dari perangkat yang tak bisa pasang Tailscale |

**Catatan jujur:** `funnel` membuat halaman login diary-mu bisa diakses siapa pun di internet.
Password tetap diperlukan untuk masuk, tapi ini bertentangan dengan prinsip "PRIVATE and PERSONAL"
di spec-mu. **Saya sarankan `serve`**: install Tailscale di HP dan laptop, lalu diary hanya terbuka
di perangkatmu sendiri.

### Pakai `serve` (disarankan)

**Di VPS:**

```bash
sudo tailscale serve --bg 3111
sudo tailscale serve status
```

Di laptop dan HP: install Tailscale, login dengan akun yang sama. Buka URL yang muncul di
`serve status` — misalnya `https://diary-vps.tailnet-xxxx.ts.net`.

Salin URL itu ke `APP_URL` di `.env.production`, lalu:

```bash
docker compose restart web
```

### Kalau tetap mau `funnel`

Batasan yang sering menggagalkan orang: **Funnel hanya boleh port 443, 8443, dan 10000.**
(Funnel tidak bisa di 3111 — karena itu kita pakai `serve` yang meneruskan ke 3111.)

```bash
sudo tailscale funnel --bg 3111      # otomatis pakai port 443
sudo tailscale funnel status
```

Lalu set `APP_URL` ke URL funnel itu dan restart:

```bash
docker compose restart web
```

---

## Langkah 7 — verifikasi end-to-end

Dari laptop (setelah Tailscale tersambung):

```bash
curl -I https://<nama-vps>.<tailnet>.ts.net/login     # harus 200, bukan 308/401
```

Buka di browser, login dengan `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Tes yang bermakna:

1. Tulis satu entri → refresh → entri masih ada
2. Ubah mood/type → autosave tidak menghapus tag
3. Cari entri tadi → ketemu
4. Kirim pesan ke Discord → notifikasi muncul

Di VPS, buktikan data tidak hilang saat rebuild:

```bash
docker compose down && docker compose up -d
docker compose exec web ls -l /data/diary.db
```

---

## Troubleshooting

**Login berhasil tapi balik ke `/login` terus**
Cookie `secure` ditolak. Pastikan `APP_URL` benar-benar `https://` (Tailscale menyediakan HTTPS).
Kalau kamu memakai HTTP polos, tambahkan `COOKIE_SECURE="false"`.

**`deploy.sh` menolak dengan "plain http://"**
Itu guard yang bekerja. Pakai URL `https://…ts.net`, atau set `COOKIE_SECURE="false"` kalau memang
sadar memakai HTTP.

**`tailscale serve` bilang HTTPS tidak aktif**
Jalankan `sudo tailscale cert <nama-vps>.<tailnet>.ts.net`, atau aktifkan HTTPS di admin console
Tailscale → DNS.

**Web tidak menjawab**
```bash
docker compose logs --tail=50 web
```

**Build kehabisan memori**
Tambahkan swap:
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

**Worker/bot tidak mengirim notifikasi Discord**
```bash
docker compose logs --tail=50 worker
```
Pastikan `DISCORD_NOTIFY_CHANNEL_ID` benar dan bot punya izin kirim di channel itu.

---

## Update kode nanti

```bash
cd ~/personal-diary-os
bash scripts/deploy.sh          # idempotent: build ulang, data diary tidak disentuh
```

`scripts/deploy-migrate.mjs` **menolak menghapus** diary yang sudah punya akun pemilik — jadi tidak
ada risiko kehilangan entri saat redeploy.

## Backup

Diary-mu adalah satu file. Salin keluar secara berkala:

```bash
docker compose exec web sh -c 'ls -l /data/diary.db'
docker run --rm -v personal-diary-os_diary-data:/d -v "$PWD":/out alpine \
  cp /d/diary.db "/out/diary-backup-$(date +%F).db"
```

Simpan hasilnya di luar VPS. Ini diary satu-satunya — jangan andalkan satu disk.
