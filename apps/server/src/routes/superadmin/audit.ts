import type { FastifyInstance } from 'fastify';
import { ListAuditQuery, type AuditEntry } from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { requireSuperAdmin } from '../../authz/index.js';
import { listAudit } from '../../audit/index.js';
import { parse } from '../../validate.js';

export function registerSuperAdminAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/audit', async (req): Promise<AuditEntry[]> => {
    requireSuperAdmin(req);
    const q = parse(ListAuditQuery, req.query);
    return listAudit(ctx.db, q);
  });
}
