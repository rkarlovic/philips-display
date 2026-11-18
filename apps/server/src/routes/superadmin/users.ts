import type { FastifyInstance } from 'fastify';
import {
  CreateUserRequest,
  IdParam,
  ListUsersQuery,
  UpdateUserRequest,
  type User,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { facultyScope, found, requireSuperAdmin } from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import { getFaculty } from '../../db/repos/faculties.js';
import {
  emailTaken,
  getFacultyUser,
  insertFacultyUser,
  listFacultyUsers,
  updateUser,
} from '../../db/repos/users.js';
import { deleteUserSessions } from '../../auth/sessions.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

const emailInUse = () => new HttpError(409, 'email_taken', 'This email is already registered');
const noFaculty = () => new HttpError(400, 'faculty_not_found', 'Faculty does not exist');

export function registerSuperAdminUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/users', async (req): Promise<User[]> => {
    const user = requireSuperAdmin(req);
    const q = parse(ListUsersQuery, req.query);
    return listFacultyUsers(db, facultyScope(user), q.facultyId);
  });

  app.post('/api/admin/users', async (req, reply): Promise<User> => {
    const actor = requireSuperAdmin(req);
    const scope = facultyScope(actor);
    const body = parse(CreateUserRequest, req.body);
    if (!getFaculty(db, scope, body.facultyId)) throw noFaculty();
    if (emailTaken(db, body.email)) throw emailInUse();
    const id = db.transaction(() => {
      const id = insertFacultyUser(db, body);
      writeAudit(
        db,
        actor,
        {
          action: 'create',
          entity: 'user',
          entityId: id,
          facultyId: body.facultyId,
          details: body,
        },
        ctx.now(),
      );
      return id;
    })();
    reply.code(201);
    return found(getFacultyUser(db, scope, id));
  });

  app.patch('/api/admin/users/:id', async (req): Promise<User> => {
    const actor = requireSuperAdmin(req);
    const scope = facultyScope(actor);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdateUserRequest, req.body);
    const before = found(getFacultyUser(db, scope, id));
    if (body.facultyId && !getFaculty(db, scope, body.facultyId)) throw noFaculty();
    if (body.email && emailTaken(db, body.email, id)) throw emailInUse();
    db.transaction(() => {
      updateUser(db, id, body);
      // Deactivating, or moving to another faculty, ends the user's sessions.
      const movedFaculty = body.facultyId !== undefined && body.facultyId !== before.facultyId;
      if (body.active === false || movedFaculty) deleteUserSessions(db, id);
      writeAudit(
        db,
        actor,
        {
          action: 'update',
          entity: 'user',
          entityId: id,
          facultyId: body.facultyId ?? before.facultyId,
          details: body,
        },
        ctx.now(),
      );
    })();
    return found(getFacultyUser(db, scope, id));
  });
}
