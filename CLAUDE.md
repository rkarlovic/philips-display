# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

> **Working name:** `SlideCast` (placeholder; rename freely)

---

## 1. What this project is

A self-hosted, campus-network-only alternative to Philips Wave (wave.ppds.com) for
**Philips Q-Line 65BDL4050Q/00** professional displays (Android 10 SoC with a
built-in Chromium-based browser), built for a **university with several faculties**.

- One location (one campus network), **~10–40 displays**, a few per faculty.
- Each **faculty logs in and sees and manages only its own displays and content**.
- A **super admin** (university IT) manages faculties, users and displays, and can send
  **shared university content** to all or selected faculties.
- Content (PDF, PowerPoint, images, video) plays as an **auto-advancing loop**: every
  page/slide/image stays on screen for N seconds, and after the last item the playlist
  starts again from the beginning.

```
 Faculty user / super admin              Server (one, always-on)                       Philips displays
 ┌─────────────────────┐   HTTP     ┌──────────────────────────────────┐  HTTP + WS  ┌──────────────────┐
 │  Admin UI (browser) │ ─────────► │ API, login, SQLite, media pipeline│ ◄────────► │ Player page      │
 │  upload, playlists, │            │ scheduler, announcements         │             │ (built-in browser│
 │  schedules, control │            │                                  │             │  full screen)    │
 └─────────────────────┘            └──────────────────────────────────┘             └──────────────────┘
```

- **Admin UI** (`/admin`) opens in any browser on the campus network. No install.
- **Player** (`/player`) runs on each display in its built-in browser, set as the boot source.
- Admin devices and displays never talk directly; everything goes through the server.
- The **server decides what each display plays** (schedules, announcements). The player is dumb:
  it plays the manifest it is given.

Deliberately much simpler than Wave: no cloud, no fleet analytics, no firmware management.

---

## 2. Confirmed decisions

| Topic | Decision |
|---|---|
| Location / network | One campus network; every display can reach the server IP |
| Scale | 10–40 displays, several faculties, a few displays each |
| Roles | **Super admin** + **faculty users** (see §6) |
| Login | **Email only, no password** for faculty users (separation, not security; see §6). Super admin uses email + one password from env. Auth layer designed so passwords or **SSO (OIDC/SAML, e.g. AAI@EduHr)** can be added later |
| Security | Low priority for v1: keep accounts separated, do not build hardening beyond what is listed |
| File types | PDF, PPTX, PNG/JPG/WebP, MP4 |
| Playback | Auto-advance with timer (default per playlist, override per item) + endless loop |
| v1 features | Remote next/prev/pause, scheduling, shared university content (mixed-in **and** takeover) |
| Display power on/off | **Not part of the app.** Use the display's own on/off timer settings if needed |
| Offline | Player keeps looping already-loaded content if the server/network goes down |
| Orientation | Mostly landscape, some portrait → per-display rotation setting |
| Admin UI language | Croatian (default) + English, switchable |
| Stack | Node.js + TypeScript everywhere |
| Server host | **Any machine:** Windows, macOS or Linux, x64 or ARM (incl. Raspberry Pi 4/5), as a plain Node process **or** via Docker (see §3.1) |
| Timezone | `Europe/Zagreb` (configurable), used for all schedules |

---

## 3. Tech stack

- **Runtime:** Node.js 22 LTS, TypeScript (strict), pnpm workspaces.
- **Server:** Fastify, `@fastify/websocket`, `@fastify/multipart`, `@fastify/static`,
  `@fastify/cookie` + server-side sessions (stored in SQLite).
- **DB:** SQLite via `better-sqlite3`, plain numbered SQL migrations, zod validation.
  (SQLite is enough for 40 displays; keep repo modules thin so Postgres is possible later.)
- **Super admin password:** argon2id (`@node-rs/argon2`) hash of `SUPERADMIN_PASSWORD` from env.
- **Media processing** (npm packages with prebuilt binaries, so nothing to install by hand):
  - **PDF → images:** `pdfjs-dist` + `@napi-rs/canvas`, one image per page.
  - **Images:** sharp → WebP, max 3840×2160, plus thumbnails.
  - **Video:** stored as-is (expect H.264/AAC MP4); `ffprobe-static` / `ffmpeg-static` for duration and poster frame. No transcoding in v1.
  - **PPTX → PDF:** LibreOffice headless (`soffice --headless --convert-to pdf`), then the PDF path.
    This is the **only external dependency** (see §3.1).

### 3.1 Runs on any machine

- Supported hosts: Windows 10/11, macOS, Linux; x64 and ARM64. Node 22 LTS is the only hard requirement.
- Use only dependencies that ship **prebuilt binaries for all of these platforms**
  (`better-sqlite3`, `sharp`, `@napi-rs/canvas`, `@node-rs/argon2`, `ffmpeg-static`). Adding
  anything that needs a compiler or a system package requires asking first.
- **LibreOffice is optional.** On startup the server looks for `soffice` (`SOFFICE_PATH` env, then
  the usual install paths on each OS, then `PATH`). If missing: PPTX upload is disabled, and the
  admin UI says "Install LibreOffice to enable PowerPoint, or export to PDF". Everything else works.
  The Docker image always includes it.
- No OS-specific code: paths via `node:path`, no shell scripts at runtime (spawn binaries with
  argument arrays), file names case-insensitive-safe, line endings handled by `.gitattributes`.
- Start the same way everywhere: `pnpm start` (or a single `npx`-style start script), first run
  creates `data/` and runs migrations. `docs/deployment.md` covers running as a service on
  Windows (NSSM or Task Scheduler), Linux (systemd), macOS (launchd), plus Docker.
- CI runs the test suite on Windows, macOS and Linux.
- **Admin UI:** React + Vite + TypeScript, react-i18next (`hr`, `en`), minimal CSS, mobile-first.
- **Player:** vanilla TypeScript, no framework, Vite `build.target: 'es2019'` (see §8).
- **Tests:** Vitest (unit + API), Playwright (admin + player).
- **Lint/format:** ESLint + Prettier.

---

## 4. Repository layout

```
/
├── CLAUDE.md
├── package.json / pnpm-workspace.yaml / .env.example
├── docker/                 Dockerfile (node + libreoffice + fonts), compose file
├── docs/                   display-setup.md, deployment.md
├── apps/
│   ├── server/src/
│   │   ├── auth/           sessions, email login, AuthProvider interface (password/SSO later)
│   │   ├── authz/          role + faculty scoping helpers (the ONLY place access rules live)
│   │   ├── routes/         admin/*.ts, superadmin/*.ts, player/*.ts
│   │   ├── media/          pptx.ts, pdf.ts, image.ts, video.ts, jobs.ts (in-process queue)
│   │   ├── playback/       resolver.ts (what should display X play now?), scheduler.ts
│   │   ├── ws/             hub.ts (display connections, targeted push)
│   │   ├── audit/          audit log writer
│   │   └── db/             migrations/*.sql, repos/*.ts
│   ├── admin/              React admin UI
│   └── player/             vanilla TS player
├── packages/shared/        types + zod schemas for REST and WS messages
└── data/                   (gitignored) db.sqlite, media/, tmp/
```

---

## 5. Domain model

- **Faculty**: `id`, `name`, `storage_quota_mb` (nullable).
- **User**: `id`, `email` (unique, stored lowercase), `display_name`, `role`
  (`super_admin` | `faculty_user`), `faculty_id` (null for super admin), `locale`, `active`,
  `auth_provider` (`email` for now), `password_hash` + `external_id` (nullable, for later).
- **Display**: `id`, `faculty_id`, `name`, `location`, `token_hash`, `rotation` (0/90/180/270),
  `fit` (`contain` | `cover`), `default_playlist_id`, `last_seen_at`,
  `reported_state` (current item, paused, errors).
- **Media**: `id`, `faculty_id` (null = university/shared media), `kind` (`pdf` | `pptx` | `image` | `video`),
  `original_name`, `size`, `status` (`processing` | `ready` | `failed`), `error`, `uploaded_by`.
  - PDFs and PPTX expand to **MediaPages** (`media_id`, `page_no`, `file`, `width`, `height`).
- **Playlist**: `id`, `faculty_id` (null = university playlist), `name`,
  `default_duration_sec` (default 10), `transition` (`none` | `fade`). Always loops.
- **PlaylistItem**: `playlist_id`, `position`, `media_id`, `duration_sec` (nullable = playlist default;
  for PDF/PPTX it applies **per page/slide**; video plays to its end unless set), `page_from`, `page_to`.
- **Schedule**: `id`, `display_id`, `playlist_id`, `weekdays` (bitmask), `start_time`, `end_time`,
  `date_from`, `date_to` (nullable), `priority`.
- **Announcement** (super admin only): `id`, `playlist_id` (university playlist), `mode`
  (`mix` | `takeover`), `target` (all / faculty ids / display ids), `starts_at`, `ends_at`,
  `mix_every_n_items` (for `mix`, default: once per loop).
- **AuditLog**: `at`, `user_id`, `faculty_id`, `action`, `entity`, `entity_id`, `details_json`.

---

## 6. Roles and tenancy (critical; get this right first)

**Login (v1, deliberately simple):**
- Faculty user types their **email** → if it is on the list of active users, they are logged in
  to their faculty. No password, no email verification. Unknown email → "Not registered, contact IT".
- This gives **separation, not security**: anyone who knows a faculty email can log in as it.
  That is accepted for v1. Don't add passwords, magic links or rate limiting unless asked.
- Super admin logs in with email **+ password** (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` in env),
  because that account can change every faculty's displays.
- Login goes through an `AuthProvider` interface so passwords or SSO can be added later without
  touching the rest of the code.

**Super admin** (university IT):
- Creates faculties and adds faculty user emails; deactivates users.
- **Pairs displays** and assigns each to a faculty; edits name/rotation; revokes displays.
- Uploads university media, builds university playlists, creates announcements (mix or takeover).
- Sees everything, including the audit log; can act on any faculty's displays.

**Faculty user**:
- Sees **only their faculty's** displays, media, playlists and schedules. Other faculties'
  data must be invisible (404, not 403, so ids are not leaked).
- Uploads media, builds playlists, sets each display's default playlist and schedules,
  and uses next/prev/pause/reload.
- Can *see* that a university announcement is active on their display, but cannot change it.

Rules:
- **Every** query for faculty-owned data goes through `authz/` helpers that add the faculty
  filter. Never write a raw route query that skips them.
- A playlist may only contain media from the same faculty (or university media, read-only).
- Cross-faculty access tests are mandatory for every new route (`test/authz/*.test.ts`).
- Every create/update/delete and every display command is written to the audit log.

---

## 7. Playback resolution (server-side, `playback/resolver.ts`)

For a given display at time *t*:

1. Active **takeover** announcement targeting it (latest `starts_at` wins) → play only that.
2. Else, the active **schedule** with the highest priority (ties → most recently created).
3. Else, the display's **default playlist**.
4. Else, a neutral idle screen (faculty name + clock, no content).
5. Then insert any active **mix** announcements into the resulting loop
   (every `mix_every_n_items`, or once per loop).

The resolver outputs a flat **manifest**: ordered `{ type: 'image' | 'video', url, durationSec }`
items with PDF/PPTX pages already expanded, plus `version`, `rotation`, `fit`, `transition`.

`playback/scheduler.ts` computes the next time any display's manifest changes
(schedule/announcement boundaries) and sets a timer; on fire, and on any relevant edit, it
re-resolves and pushes `manifest_changed` **only to affected displays**. Pure, unit-tested
functions with an injectable clock; all times in the configured timezone (watch DST).

---

## 8. The Philips display: constraints that must shape the code

- **Old Chromium.** The built-in browser is an old Chromium build. In the player: ES2019
  output, no top-level await, avoid newer CSS (`:has()`, container queries, `dvh`). Test with an
  old Chromium when possible, and on the real display before calling any player change done.
- **Low-power SoC, 4K panel.** The viewport is often 1920×1080 even on the 4K panel. Keep the DOM tiny
  (two layers, crossfade by opacity), **preload the next item**, release old images/videos.
  The player must run for weeks without reloading; there is a soak test (`pnpm test:soak`).
- **Plain HTTP means no secure context.** Over `http://<lan-ip>`, Service Workers and Cache Storage
  are unavailable, so don't design around them. Offline = keep the current manifest and loaded media
  in memory, keep looping, reconnect with backoff. (If IT later serves the player over HTTPS with a
  trusted certificate, a Service Worker cache becomes possible.)
- **Autoplay:** videos are `muted playsinline autoplay`.
- **No keyboard/mouse:** pairing must work by just looking at the screen.
- **Rotation:** applied by the player with CSS transform from the manifest (portrait displays).
- **When a display is switched off** (remote or its own timer), the browser stops. On power-on the
  boot source reopens `/player`, which reconnects with its stored token.
- One-time setup per display (documented in `docs/display-setup.md`): browser source URL =
  `http://<server>:<port>/player`, browser as boot-on source, optionally the display's own on/off
  timer. The **server** needs a fixed IP (DHCP reservation); displays don't. Use the official user
  manual for exact menu paths; don't write them from memory.

---

## 9. Pairing

1. A new display opens `/player` with no token → server creates a *pending* display; the player
   shows a large **6-character code** and the server address.
2. Super admin enters the code, picks the faculty, names the display, sets rotation → the server
   issues a random **device token** (stored hashed).
3. The player saves the token in `localStorage`. Fallback: the admin UI shows `/player?token=…`
   to type into the display's browser URL setting.
4. Revoking a display invalidates the token; the player returns to the pairing screen.

---

## 10. API and messages (contracts live in `packages/shared`)

- Auth: `POST /api/auth/login` (`{ email }`, plus `password` only for the super admin),
  `POST /api/auth/logout`, `GET /api/auth/me`. Session cookie (`HttpOnly`, `SameSite=Lax`).
- Faculty-scoped: `/api/displays`, `/api/media` (multipart, streaming to disk, per-faculty quota),
  `/api/playlists` (+ `PUT /:id/items`), `/api/schedules`,
  `POST /api/displays/:id/command` → `next | prev | pause | resume | reload`.
- Super admin only: `/api/admin/faculties`, `/api/admin/users`, `/api/admin/displays/pair`,
  `/api/admin/announcements`, `/api/admin/audit`.
- Player: `GET /api/player/manifest` (token auth), WebSocket `/api/player/ws`.
  Server → player: `manifest_changed`, `command`, `ping`. Player → server: `hello`, `status`, `pong`.
- Media files are content-addressed (`/media/<hash>.webp`), immutable and cacheable. Access checks
  apply to the admin API; media URLs are unguessable.
- The admin UI gets live display status (online, now playing, paused) over its own WS.

---

## 11. Media pipeline details

- Upload returns at once with `status: processing`; jobs run in an in-process queue
  (LibreOffice concurrency **1**, others 2), each with a timeout; failures set `status: failed` + `error`.
- PPTX: animations and transitions are lost; each slide becomes a static page. Include common
  fonts in the Docker image (Liberation, Carlito, Caladea, DejaVu) so slides render close to the original.
  Show the generated pages in the admin UI so users can check them.
- PDF render scale: configurable (`PDF_DPI`, default 150, capped to 3840 px on the long edge).
- Deleting media that is used in a playlist is refused (list where it's used).

---

## 12. Commands

```bash
pnpm install
pnpm dev            # server + admin + player in watch mode
pnpm test           # vitest (unit, API, authz)
pnpm test:e2e       # playwright
pnpm test:soak      # long-running player memory test
pnpm lint && pnpm typecheck
pnpm build
pnpm start          # production; first run creates data/ and runs migrations
docker compose -f docker/docker-compose.yml up -d
```

Env vars (documented in `.env.example`): `PORT` (8080), `DATA_DIR` (./data), `SESSION_SECRET`,
`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `TZ` (Europe/Zagreb), `MAX_UPLOAD_MB` (500),
`PDF_DPI` (150), `SOFFICE_PATH` (optional).

---

## 13. Rules for working in this repo

- **Keep it simple.** If a feature needs a new service, queue system or framework, stop and ask.
- **Tenancy first:** no route without an authz helper and a cross-faculty test.
- Shared types/schemas only in `packages/shared`; never duplicate API shapes.
- Validate every input with zod; never trust filenames; store under generated ids.
- Time logic (schedules, announcements) is pure and takes an injected clock; test DST changes.
- Player: no framework, no polyfill bloat, memory-flat over the soak test.
- DB changes only through new numbered migrations.
- All admin UI strings through i18n (`hr` and `en`, both complete; CI fails on missing keys).
- No internet-dependent features (CDNs, Google Fonts, analytics). Everything is served locally.
- Must work on Windows, macOS and Linux, x64 and ARM (see §3.1).

---

## 14. Scope and milestones

1. **Foundation:** monorepo, DB, email login, super admin + faculties + users, authz tests,
   CI on Windows/macOS/Linux.
2. **Media + playlists:** uploads, PDF/PPTX/image/video pipeline, playlists with timer + loop.
3. **Displays + player:** pairing, per-display default playlist, live push, rotation, status,
   next/prev/pause/reload. **Test on a real 65BDL4050Q here.**
4. **Scheduling:** per-display schedules, resolver + scheduler.
5. **Announcements:** university content, mix and takeover.
6. **Finishing:** audit log UI, quotas, backup/restore of `data/`, Docker image, deployment docs.

**Later (do not build unless asked):** passwords or SSO (OIDC/SAML) / LDAP login, display power
on/off over LAN (Philips SICP), Android wrapper APK for real offline caching, display groups,
web-page/URL items, screenshots of what a display shows, HTTPS setup, faculty-admin role.

**Out of scope:** cloud hosting, Wave/CMND integration, video transcoding, multiple locations.
