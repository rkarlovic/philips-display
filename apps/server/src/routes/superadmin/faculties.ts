import type { FastifyInstance } from 'fastify';
import {
  CreateFacultyRequest,
  IdParam,
  UpdateFacultyRequest,
  type Faculty,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { facultyScope, found, requireSuperAdmin } from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import {
  countFacultyUsers,
  deleteFaculty,
  facultyHasContent,
  facultyNameExists,
  getFaculty,
  insertFaculty,
  listFaculties,
  updateFaculty,
} from '../../db/repos/faculties.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

const nameTaken = () => new HttpError(409, 'faculty_name_taken', 'A faculty with this name exists');

export function registerSuperAdminFacultyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/faculties', async (req): Promise<Faculty[]> => {
    const user = requireSuperAdmin(req);
    return listFaculties(db, facultyScope(user));
  });

  app.post('/api/admin/faculties', async (req, reply): Promise<Faculty> => {
    const user = requireSuperAdmin(req);
    const body = parse(CreateFacultyRequest, req.body);
    if (facultyNameExists(db, body.name)) throw nameTaken();
    const id = db.transaction(() => {
      const id = insertFaculty(db, {
        name: body.name,
        storageQuotaMb: body.storageQuotaMb ?? null,
      });
      writeAudit(
        db,
        user,
        { action: 'create', entity: 'faculty', entityId: id, facultyId: id, details: body },
        ctx.now(),
      );
      return id;
    })();
    reply.code(201);
    return found(getFaculty(db, facultyScope(user), id));
  });

  app.patch('/api/admin/faculties/:id', async (req): Promise<Faculty> => {
    const user = requireSuperAdmin(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdateFacultyRequest, req.body);
    found(getFaculty(db, facultyScope(user), id));
    if (body.name && facultyNameExists(db, body.name, id)) throw nameTaken();
    db.transaction(() => {
      updateFaculty(db, id, body);
      writeAudit(
        db,
        user,
        { action: 'update', entity: 'faculty', entityId: id, facultyId: id, details: body },
        ctx.now(),
      );
    })();
    return found(getFaculty(db, facultyScope(user), id));
  });

  app.delete('/api/admin/faculties/:id', async (req, reply) => {
    const user = requireSuperAdmin(req);
    const { id } = parse(IdParam, req.params);
    const faculty = found(getFaculty(db, facultyScope(user), id));
    if (countFacultyUsers(db, id) > 0) {
      throw new HttpError(409, 'faculty_has_users', 'Remove or move the faculty users first');
    }
    if (facultyHasContent(db, id)) {
      throw new HttpError(409, 'faculty_not_empty', 'Delete the faculty media and playlists first');
    }
    db.transaction(() => {
      // Audit first, with facultyId null: the faculty row is about to disappear.
      writeAudit(
        db,
        user,
        {
          action: 'delete',
          entity: 'faculty',
          entityId: id,
          facultyId: null,
          details: { name: faculty.name },
        },
        ctx.now(),
      );
      deleteFaculty(db, id);
    })();
    return reply.code(204).send();
  });
}
