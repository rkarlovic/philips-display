/** Per-display schedules (faculty-scoped through the display). */
import type { FastifyInstance } from 'fastify';
import {
  CreateScheduleRequest,
  IdParam,
  UpdateScheduleRequest,
  type Schedule,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { facultyScope, found, playlistFitsDisplay, requireUser } from '../../authz/index.js';
import type { FacultyScope } from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import { getDisplay } from '../../db/repos/displays.js';
import { getPlaylist } from '../../db/repos/playlists.js';
import {
  deleteSchedule,
  getSchedule,
  insertSchedule,
  listSchedulesForDisplay,
  updateSchedule,
  type ScheduleRecord,
  type ScheduleValues,
} from '../../db/repos/schedules.js';
import { isActive } from '../../playback/schedule.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

export function registerScheduleRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, scheduler } = ctx;
  const tz = ctx.config.timezone;

  const toSchedule = (r: ScheduleRecord): Schedule => ({
    id: r.id,
    displayId: r.displayId,
    playlistId: r.playlistId,
    playlistName: r.playlistName,
    weekdays: r.weekdays,
    startTime: r.startTime,
    endTime: r.endTime,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    priority: r.priority,
    createdAt: r.createdAt,
    activeNow: isActive(r, ctx.now().getTime(), tz),
  });

  /** The playlist must be visible to the caller and fit the display's faculty. */
  const checkPlaylist = (scope: FacultyScope, playlistId: number, displayFacultyId: number) => {
    const pl = getPlaylist(db, scope, playlistId);
    if (!pl || !playlistFitsDisplay(pl.facultyId, displayFacultyId)) {
      throw new HttpError(400, 'playlist_not_found', 'Playlist not found');
    }
  };

  /** A schedule change may change what the display plays now, and when it changes next. */
  const changed = (displayId: number) => {
    hub.manifestChanged([displayId]);
    hub.broadcastDisplay(displayId);
    scheduler.reschedule();
  };

  app.get('/api/displays/:id/schedules', async (req): Promise<Schedule[]> => {
    const scope = facultyScope(requireUser(req));
    const { id } = parse(IdParam, req.params);
    found(getDisplay(db, scope, id));
    return listSchedulesForDisplay(db, id).map(toSchedule);
  });

  app.post('/api/displays/:id/schedules', async (req, reply): Promise<Schedule> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const body = parse(CreateScheduleRequest, req.body);
    const display = found(getDisplay(db, scope, id));
    checkPlaylist(scope, body.playlistId, display.facultyId);

    const scheduleId = db.transaction(() => {
      const sid = insertSchedule(db, id, body, ctx.now().toISOString());
      writeAudit(
        db,
        user,
        {
          action: 'create',
          entity: 'schedule',
          entityId: sid,
          facultyId: display.facultyId,
          details: { displayId: id, ...body },
        },
        ctx.now(),
      );
      return sid;
    })();
    changed(id);
    reply.code(201);
    return toSchedule(found(getSchedule(db, scope, scheduleId)));
  });

  app.patch('/api/schedules/:id', async (req): Promise<Schedule> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdateScheduleRequest, req.body);
    const current = found(getSchedule(db, scope, id));

    const next: ScheduleValues = {
      playlistId: body.playlistId ?? current.playlistId,
      weekdays: body.weekdays ?? current.weekdays,
      startTime: body.startTime ?? current.startTime,
      endTime: body.endTime ?? current.endTime,
      dateFrom: body.dateFrom !== undefined ? body.dateFrom : current.dateFrom,
      dateTo: body.dateTo !== undefined ? body.dateTo : current.dateTo,
      priority: body.priority ?? current.priority,
    };
    if (next.dateFrom && next.dateTo && next.dateFrom > next.dateTo) {
      throw new HttpError(400, 'bad_request', 'dateFrom must be <= dateTo');
    }
    if (body.playlistId !== undefined) checkPlaylist(scope, next.playlistId, current.facultyId);

    db.transaction(() => {
      updateSchedule(db, id, next);
      writeAudit(
        db,
        user,
        {
          action: 'update',
          entity: 'schedule',
          entityId: id,
          facultyId: current.facultyId,
          details: body,
        },
        ctx.now(),
      );
    })();
    changed(current.displayId);
    return toSchedule(found(getSchedule(db, scope, id)));
  });

  app.delete('/api/schedules/:id', async (req, reply) => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const current = found(getSchedule(db, scope, id));
    db.transaction(() => {
      writeAudit(
        db,
        user,
        {
          action: 'delete',
          entity: 'schedule',
          entityId: id,
          facultyId: current.facultyId,
          details: { displayId: current.displayId, playlistId: current.playlistId },
        },
        ctx.now(),
      );
      deleteSchedule(db, id);
    })();
    changed(current.displayId);
    return reply.code(204).send();
  });
}
