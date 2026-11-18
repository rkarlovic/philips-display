# SlideCast

Self-hosted, campus-network-only digital signage for Philips Q-Line displays.
See [CLAUDE.md](CLAUDE.md) for the full design.

## Quick start

Requirements: Node.js 22 LTS and pnpm. LibreOffice is optional (needed for PowerPoint from milestone 2).

```bash
pnpm install
cp .env.example .env   # then set SESSION_SECRET, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD
pnpm build
pnpm start             # first run creates data/ and the database
```

Open `http://<server-ip>:8080/admin/`.

- **Super admin:** log in with `SUPERADMIN_EMAIL`. A password field appears; use `SUPERADMIN_PASSWORD`.
- **Faculty users:** the super admin adds their emails under _Korisnici / Users_; they log in with the email only.

## Development

```bash
pnpm dev        # server on :8080 (watch) + admin UI on http://localhost:5173/admin/
pnpm test       # vitest + i18n key check
pnpm test:e2e   # Playwright: player + admin in a real browser (first: pnpm exec playwright install chromium)
pnpm test:soak  # player memory over time; PW_CHANNEL=msedge|chrome for real H.264, SOAK_MINUTES=240 for release checks
pnpm lint && pnpm typecheck
```

## Status

- **Milestone 1 (foundation):** monorepo, SQLite + migrations, email login, super admin,
  faculties and users, faculty scoping with cross-faculty tests, audit log, CI on Windows/macOS/Linux.
- **Milestone 2 (media + playlists):** uploads (PDF, PPTX, PNG/JPG/WebP, MP4) with per-faculty
  quotas; background processing to content-addressed WebP pages / H.264 video; university media
  (read-only for faculties); looping playlists with per-item durations and page ranges; a preview
  player in the admin UI that plays exactly what a display will play.

- **Milestone 3 (displays + player):** pairing by on-screen code, per-display default playlist,
  live push over WebSocket, rotation/fit, live status (online, now playing, paused) and remote
  next/prev/pause/resume/reload. The player (`/player`) is a tiny ES2019 page for the display's
  old built-in Chromium; it keeps looping when the server is down and reconnects by itself.
  Setting up a display: [docs/display-setup.md](docs/display-setup.md).

PowerPoint needs LibreOffice on the server (found automatically, or set `SOFFICE_PATH`).
Videos must be H.264 MP4; other codecs are rejected with a hint to re-export.
