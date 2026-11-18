/** Faculty-scoped read access: a faculty user sees only their own faculty. */
import type { FastifyInstance } from 'fastify';
import { IdParam, type Faculty } from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { facultyScope, found, requireUser } from '../../authz/index.js';
import { getFaculty, listFaculties } from '../../db/repos/faculties.js';
import { parse } from '../../validate.js';

export function registerFacultyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/faculties', async (req): Promise<Faculty[]> => {
    const scope = facultyScope(requireUser(req));
    return listFaculties(ctx.db, scope);
  });

  app.get('/api/faculties/:id', async (req): Promise<Faculty> => {
    const scope = facultyScope(requireUser(req));
    const { id } = parse(IdParam, req.params);
    return found(getFaculty(ctx.db, scope, id));
  });
}
