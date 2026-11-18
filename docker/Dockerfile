# SlideCast server image: API + admin UI + player, with LibreOffice for PowerPoint.
# Build from the repo root:  docker build -f docker/Dockerfile -t slidecast .

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable

# Dependencies first (cached unless the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
COPY apps/player/package.json apps/player/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 # Keep only what the server needs at runtime.
 && pnpm install --prod --frozen-lockfile \
 && rm -rf apps/admin/src apps/player/src apps/server/src apps/server/test e2e docs

# ---------- runtime ----------
FROM node:22-bookworm-slim
# LibreOffice (headless, Impress only) for PPTX -> PDF, plus fonts that render
# Office documents close to the original (CLAUDE.md §11).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress-nogui \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data /app/backups && chown node:node /data /app/backups

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Europe/Zagreb
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
