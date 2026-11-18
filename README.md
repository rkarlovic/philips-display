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
pnpm lint && pnpm typecheck
```

## Status

Milestone 1 (foundation) is done: monorepo, SQLite + migrations, email login, super admin,
faculties and users, faculty scoping with cross-faculty tests, audit log, CI on Windows/macOS/Linux.
