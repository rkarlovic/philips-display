/** Super admin only: pairing, new setup tokens, revoking displays. */
import type { FastifyInstance } from 'fastify';
import {
  IdParam,
  PairDisplayRequest,
  WS_CLOSE_UNAUTHORIZED,
  type DisplaySetup,
  type PendingDisplay,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { facultyScope, found, requireSuperAdmin } from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import { hashToken, randomToken } from '../../auth/tokens.js';
import {
  activateDisplay,
  deleteDisplay,
  findPendingIdByCode,
  getDisplay,
  getDisplayAnyStatus,
  listPending,
  replaceToken,
} from '../../db/repos/displays.js';
import { getFaculty } from '../../db/repos/faculties.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

const setupPath = (token: string) => `/player/?token=${encodeURIComponent(token)}`;

export function registerSuperAdminDisplayRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.get('/api/admin/displays/pending', async (req): Promise<PendingDisplay[]> => {
    requireSuperAdmin(req);
    return listPending(db);
  });

  app.post('/api/admin/displays/pair', async (req, reply): Promise<DisplaySetup> => {
    const user = requireSuperAdmin(req);
    const scope = facultyScope(user);
    const body = parse(PairDisplayRequest, req.body);
    if (!getFaculty(db, scope, body.facultyId)) {
      throw new HttpError(400, 'faculty_not_found', 'Faculty does not exist');
    }
    const id = findPendingIdByCode(db, body.code);
    if (!id) throw new HttpError(404, 'pairing_code_invalid', 'No display is showing this code');

    const token = randomToken();
    db.transaction(() => {
      activateDisplay(db, id, {
        facultyId: body.facultyId,
        name: body.name,
        location: body.location,
        rotation: body.rotation,
        fit: body.fit,
        tokenHash: hashToken(token),
        handoffToken: token,
        now: ctx.now().toISOString(),
      });
      writeAudit(
        db,
        user,
        {
          action: 'pair',
          entity: 'display',
          entityId: id,
          facultyId: body.facultyId,
          details: { ...body, code: undefined },
        },
        ctx.now(),
      );
    })();
    hub.pendingChanged();
    hub.broadcastDisplay(id);
    reply.code(201);
    return {
      display: hub.toDisplay(found(getDisplay(db, scope, id))),
      setupPath: setupPath(token),
    };
  });

  /** Issues a new device token (the old one stops working) and returns the setup URL. */
  app.post('/api/admin/displays/:id/token', async (req): Promise<DisplaySetup> => {
    const user = requireSuperAdmin(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const display = found(getDisplay(db, scope, id));
    const token = randomToken();
    db.transaction(() => {
      replaceToken(db, id, hashToken(token));
      writeAudit(
        db,
        user,
        { action: 'new_token', entity: 'display', entityId: id, facultyId: display.facultyId },
        ctx.now(),
      );
    })();
    hub.disconnectDisplay(id, WS_CLOSE_UNAUTHORIZED, 'token replaced');
    return {
      display: hub.toDisplay(found(getDisplay(db, scope, id))),
      setupPath: setupPath(token),
    };
  });

  /** Revokes and removes a display (paired or pending). The player returns to pairing. */
  app.delete('/api/admin/displays/:id', async (req, reply) => {
    const user = requireSuperAdmin(req);
    const { id } = parse(IdParam, req.params);
    const row = getDisplayAnyStatus(db, id);
    if (!row) throw new HttpError(404, 'not_found', 'Not found');
    db.transaction(() => {
      writeAudit(
        db,
        user,
        {
          action: 'revoke',
          entity: 'display',
          entityId: id,
          facultyId: row.faculty_id,
          details: { name: row.name, status: row.status },
        },
        ctx.now(),
      );
      deleteDisplay(db, id);
    })();
    hub.disconnectDisplay(id, WS_CLOSE_UNAUTHORIZED, 'revoked');
    if (row.faculty_id != null) hub.displayRemoved(id, row.faculty_id);
    else hub.pendingChanged();
    return reply.code(204).send();
  });
}
