# Deploying SlideCast

One server on the campus network serves the admin UI (`/admin`), the player for the displays
(`/player`) and all media. It runs on **Windows, macOS or Linux (x64 or ARM, e.g. Raspberry Pi 4/5)**
as a plain Node.js process, or with **Docker**.

## Requirements

- A machine that is always on, with a **fixed IP address** (ask IT for a DHCP reservation).
  The displays and admins reach it at `http://SERVER-IP:8080`.
- Firewall: allow inbound TCP **8080** (or your `PORT`) from the campus network.
- Disk: room for the media (uploads + rendered pages) and backups.
- Either **Node.js 22 LTS + pnpm**, or **Docker**.
- Optional: **LibreOffice** for PowerPoint uploads. Without it, everything else works and the
  admin UI asks users to export to PDF. The Docker image includes it.

## Configuration (`.env`)

Copy `.env.example` to `.env` in the repo root and set at least:

| Variable                                  | Meaning                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `SESSION_SECRET`                          | Long random string (≥ 16 characters). Changing it logs everyone out.       |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | The IT super admin account. Changing the password takes effect on restart. |
| `PORT`                                    | Default 8080.                                                              |
| `DATA_DIR`                                | Database + media. Default `./data` (relative to the repo root).            |
| `TZ`                                      | Time zone for schedules and announcements, default `Europe/Zagreb`.        |
| `MAX_UPLOAD_MB`, `PDF_DPI`                | Upload limit (500) and PDF render quality (150).                           |
| `SOFFICE_PATH`                            | Only if LibreOffice is installed somewhere unusual.                        |

Keep `.env` private: it holds the super admin password.

## Option A: plain Node.js (all operating systems)

```bash
pnpm install
pnpm build
pnpm start          # first run creates data/ and the database
```

The start message lists the URLs, and says whether LibreOffice was found.

### Run it as a service

So it starts on boot and restarts after a crash.

**Windows: NSSM** (<https://nssm.cc>, a small free tool):

```bat
nssm install SlideCast "C:\Program Files\nodejs\node.exe" "C:\slidecast\apps\server\dist\index.js"
nssm set SlideCast AppDirectory C:\slidecast
nssm set SlideCast AppStdout C:\slidecast\slidecast.log
nssm set SlideCast AppStderr C:\slidecast\slidecast.log
nssm set SlideCast Start SERVICE_AUTO_START
nssm start SlideCast
```

**Windows: Task Scheduler** (no extra tool): create a task "At startup", run whether the user
is logged on or not, action `C:\Program Files\nodejs\node.exe` with argument
`apps\server\dist\index.js` and "Start in" `C:\slidecast`. Under Settings, enable
"If the task fails, restart every 1 minute".

**Linux: systemd** (`/etc/systemd/system/slidecast.service`):

```ini
[Unit]
Description=SlideCast
After=network-online.target
Wants=network-online.target

[Service]
User=slidecast
WorkingDirectory=/opt/slidecast
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now slidecast
journalctl -u slidecast -f      # logs
```

**macOS: launchd** (`/Library/LaunchDaemons/hr.university.slidecast.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>hr.university.slidecast</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string><string>apps/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/opt/slidecast</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/opt/slidecast/slidecast.log</string>
  <key>StandardErrorPath</key><string>/opt/slidecast/slidecast.log</string>
</dict></plist>
```

```bash
sudo launchctl load -w /Library/LaunchDaemons/hr.university.slidecast.plist
```

## Option B: Docker

```bash
cp .env.example .env              # then edit it
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs -f
```

- Data lives in the `slidecast-data` volume (mounted at `/data`); `DATA_DIR` is set for you.
- LibreOffice and the Office-compatible fonts (Liberation, Carlito, Caladea, DejaVu) are included.
- The container has a health check and restarts automatically (`restart: unless-stopped`).
- Works on x64 and ARM64 hosts (build on the target machine, or use `docker buildx`).

## Backups

A backup is a plain folder with `db.sqlite`, `media/` and `manifest.json`. It is **safe to run
while the server is running**: it takes a consistent database snapshot, copies the media,
and checks that every file the database needs is in the backup.

```bash
pnpm backup                       # → backups/slidecast-backup-YYYYMMDD-HHMMSS
pnpm backup --keep 14             # …and delete all but the newest 14
pnpm backup --out D:\Backups      # somewhere else (another disk is better)
```

Docker: `docker compose -f docker/docker-compose.yml exec slidecast node apps/server/dist/cli/backup.js --keep 14`
(written to `backups/` next to the repo on the host).

**Schedule it daily:** Windows Task Scheduler (`pnpm backup --keep 14`, start in the repo folder),
Linux cron (`30 2 * * * cd /opt/slidecast && /usr/bin/node apps/server/dist/cli/backup.js --keep 14`),
or a launchd job on macOS. Copy the backups folder to another machine or disk as well.

### Restore

1. **Stop the server** (the restore refuses to run while it is up).
2. `pnpm restore backups/slidecast-backup-20260301-023000` shows what it will do;
   add `--yes` to do it.
3. Start the server. Restoring a backup from an older SlideCast version works; the new
   migrations are applied on start.

The current data folder is not deleted: it is moved to `data-before-restore-<time>`. Delete it
once you are happy with the restore.

## Updating SlideCast

1. `pnpm backup`
2. `git pull` (or copy the new release over the folder, keeping `.env`, `data/` and `backups/`)
3. `pnpm install && pnpm build`
4. Restart the service. Database migrations run automatically on start.

Displays reconnect by themselves; a player page that changed is picked up on its next reload
(the display's on/off timer, or **Ponovno učitaj / Reload** on the Displays page).

## Checks after installing

- `http://SERVER-IP:8080/api/health` returns `{"ok":true}`.
- Log in at `/admin` as the super admin; create a faculty and a user.
- Open `/player` on one display and pair it (see [display-setup.md](display-setup.md)).
