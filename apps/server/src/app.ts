import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import type { ApiError } from '@slidecast/shared';
import type { AppContext } from './context.js';
import type { SessionUser } from './authz/index.js';
import { SESSION_COOKIE, getSessionUser } from './auth/sessions.js';
import { HttpError } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerFacultyRoutes } from './routes/admin/faculties.js';
import { registerMediaRoutes } from './routes/admin/media.js';
import { registerPlaylistRoutes } from './routes/admin/playlists.js';
import { registerSuperAdminFacultyRoutes } from './routes/superadmin/faculties.js';
import { registerSuperAdminUserRoutes } from './routes/superadmin/users.js';
import { registerSuperAdminAuditRoutes } from './routes/superadmin/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | null;
  }
}

function isClientError(err: unknown): err is { statusCode: number; message: string } {
  const e = err as { statusCode?: unknown; message?: unknown } | null;
  return (
    typeof e?.statusCode === 'number' &&
    e.statusCode >= 400 &&
    e.statusCode < 500 &&
    typeof e.message === 'string'
  );
}

export async function buildApp(
  ctx: AppContext,
  opts: { logger?: FastifyServerOptions['logger'] } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: false });

  await app.register(cookie, { secret: ctx.config.sessionSecret });
  await app.register(multipart, {
    limits: { fileSize: ctx.config.maxUploadMb * 1024 * 1024, files: 1, fields: 5 },
  });

  // Content-addressed media files: immutable, cache forever. URLs are unguessable hashes.
  await app.register(fastifyStatic, {
    root: ctx.store.mediaDir,
    prefix: '/media/',
    decorateReply: false,
    index: false,
    list: false,
    immutable: true,
    maxAge: '365d',
  });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  // Resolve the session for every API request.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    req.sessionToken = unsigned.value;
    req.user = getSessionUser(ctx.db, unsigned.value, ctx.now());
  });

  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let body: ApiError = { error: 'internal', message: 'Internal server error' };
    if (err instanceof HttpError) {
      status = err.statusCode;
      body = { ...err.extra, error: err.code, message: err.message };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: 'bad_request',
        message: 'Invalid input',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (isClientError(err)) {
      // Fastify's own 4xx errors (bad JSON, body too large, ...).
      status = err.statusCode;
      body = { error: 'bad_request', message: err.message };
    } else {
      req.log.error(err);
    }
    reply.code(status).send(body);
  });

  registerAuthRoutes(app, ctx);
  registerFacultyRoutes(app, ctx);
  registerMediaRoutes(app, ctx);
  registerPlaylistRoutes(app, ctx);
  registerSuperAdminFacultyRoutes(app, ctx);
  registerSuperAdminUserRoutes(app, ctx);
  registerSuperAdminAuditRoutes(app, ctx);

  app.get('/api/health', async () => ({ ok: true }));

  // Built admin UI at /admin (single-page app; unknown /admin/* paths get index.html).
  const hasAdmin = fs.existsSync(ctx.config.adminDistDir);
  if (hasAdmin) {
    await app.register(fastifyStatic, { root: ctx.config.adminDistDir, prefix: '/admin/' });
  }
  app.get('/', async (_req, reply) => reply.redirect('/admin/'));
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));

  app.setNotFoundHandler((req, reply) => {
    if (hasAdmin && req.method === 'GET' && req.url.startsWith('/admin/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    const body: ApiError = { error: 'not_found', message: 'Not found' };
    return reply.code(404).send(body);
  });

  return app;
}
