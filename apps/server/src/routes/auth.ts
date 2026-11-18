import type { FastifyInstance } from 'fastify';
import { LoginRequest, UpdateMeRequest, type Me } from '@slidecast/shared';
import type { AppContext } from '../context.js';
import { requireUser } from '../authz/index.js';
import { writeAudit } from '../audit/index.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  getSessionUser,
} from '../auth/sessions.js';
import { HttpError } from '../errors.js';
import { parse } from '../validate.js';

const MESSAGES = {
  not_registered: 'Not registered, contact IT',
  password_required: 'Password required',
  invalid_credentials: 'Wrong email or password',
} as const;

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.post('/api/auth/login', async (req, reply): Promise<Me> => {
    const body = parse(LoginRequest, req.body);
    const result = await ctx.auth.authenticate(body);
    if (!result.ok) throw new HttpError(401, result.error, MESSAGES[result.error]);

    const now = ctx.now();
    const token = createSession(db, result.userId, now);
    const user = getSessionUser(db, token, now);
    if (!user) throw new HttpError(401, 'not_registered', MESSAGES.not_registered);
    writeAudit(db, user, { action: 'login', entity: 'session', entityId: user.id }, now);

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      signed: true,
      maxAge: SESSION_TTL_MS / 1000,
    });
    return user;
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.sessionToken;
    if (token) {
      if (req.user) {
        writeAudit(
          db,
          req.user,
          { action: 'logout', entity: 'session', entityId: req.user.id },
          ctx.now(),
        );
      }
      deleteSession(db, token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req): Promise<Me> => requireUser(req));

  app.patch('/api/auth/me', async (req): Promise<Me> => {
    const user = requireUser(req);
    const body = parse(UpdateMeRequest, req.body);
    db.prepare('UPDATE users SET locale = ? WHERE id = ?').run(body.locale, user.id);
    return { ...user, locale: body.locale };
  });
}
