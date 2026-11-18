/** University announcements: super admin only (CLAUDE.md §6). */
import type { FastifyInstance } from 'fastify';
import {
  CreateAnnouncementRequest,
  IdParam,
  UpdateAnnouncementRequest,
  type Announcement,
  type AnnouncementStatus,
  type AnnouncementTarget,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { found, requireSuperAdmin } from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import {
  deleteAnnouncement,
  existingIds,
  getAnnouncement,
  insertAnnouncement,
  listAnnouncements,
  targetedDisplayIds,
  updateAnnouncement,
  type AnnouncementRecord,
  type AnnouncementValues,
} from '../../db/repos/announcements.js';
import { getPlaylist } from '../../db/repos/playlists.js';
import { isoToLocalDateTime, localDateTimeToIso } from '../../playback/time.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

export function registerSuperAdminAnnouncementRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, scheduler } = ctx;
  const tz = ctx.config.timezone;

  const statusOf = (a: AnnouncementRecord): AnnouncementStatus => {
    const now = ctx.now().toISOString();
    if (a.startsAt > now) return 'scheduled';
    if (a.endsAt != null && a.endsAt <= now) return 'ended';
    return 'active';
  };

  const toApi = (a: AnnouncementRecord): Announcement => ({
    ...a,
    startsAtLocal: isoToLocalDateTime(a.startsAt, tz),
    endsAtLocal: a.endsAt ? isoToLocalDateTime(a.endsAt, tz) : null,
    status: statusOf(a),
    displayCount: targetedDisplayIds(db, a.target).length,
  });

  const checkPlaylist = (playlistId: number) => {
    const pl = getPlaylist(db, { all: true }, playlistId);
    if (!pl) throw new HttpError(400, 'playlist_not_found', 'Playlist not found');
    if (pl.facultyId != null) {
      throw new HttpError(400, 'university_playlist_required', 'Use a university playlist');
    }
  };

  const checkTarget = (target: AnnouncementTarget) => {
    if (target.kind === 'all') return;
    const [table, ids] =
      target.kind === 'faculties'
        ? (['faculties', target.facultyIds] as const)
        : (['displays', target.displayIds] as const);
    const found = existingIds(db, table, ids);
    if (ids.some((id) => !found.has(id))) {
      throw new HttpError(400, 'bad_request', `Unknown ${table} in target`);
    }
  };

  const toInstants = (startsAt: string, endsAt: string | null) => {
    const s = localDateTimeToIso(startsAt, tz);
    const e = endsAt ? localDateTimeToIso(endsAt, tz) : null;
    if (e != null && e <= s)
      throw new HttpError(400, 'bad_request', 'endsAt must be after startsAt');
    return { startsAt: s, endsAt: e };
  };

  /** Push to every display the announcement reaches (before and after a change). */
  const changed = (...targets: AnnouncementTarget[]) => {
    const ids = new Set(targets.flatMap((t) => targetedDisplayIds(db, t)));
    hub.manifestChanged(ids);
    for (const id of ids) hub.broadcastDisplay(id);
    scheduler.reschedule();
  };

  app.get('/api/admin/announcements', async (req): Promise<Announcement[]> => {
    requireSuperAdmin(req);
    return listAnnouncements(db).map(toApi);
  });

  app.post('/api/admin/announcements', async (req, reply): Promise<Announcement> => {
    const user = requireSuperAdmin(req);
    const body = parse(CreateAnnouncementRequest, req.body);
    checkPlaylist(body.playlistId);
    checkTarget(body.target);
    const values: AnnouncementValues = { ...body, ...toInstants(body.startsAt, body.endsAt) };
    const id = db.transaction(() => {
      const id = insertAnnouncement(db, values, user.id);
      writeAudit(
        db,
        user,
        { action: 'create', entity: 'announcement', entityId: id, facultyId: null, details: body },
        ctx.now(),
      );
      return id;
    })();
    changed(values.target);
    reply.code(201);
    return toApi(found(getAnnouncement(db, id)));
  });

  app.patch('/api/admin/announcements/:id', async (req): Promise<Announcement> => {
    const user = requireSuperAdmin(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdateAnnouncementRequest, req.body);
    const current = found(getAnnouncement(db, id));
    if (body.playlistId !== undefined) checkPlaylist(body.playlistId);
    if (body.target) checkTarget(body.target);

    const startsLocal = body.startsAt ?? isoToLocalDateTime(current.startsAt, tz);
    const endsLocal =
      body.endsAt !== undefined
        ? body.endsAt
        : current.endsAt
          ? isoToLocalDateTime(current.endsAt, tz)
          : null;
    const values: AnnouncementValues = {
      title: body.title ?? current.title,
      playlistId: body.playlistId ?? current.playlistId,
      mode: body.mode ?? current.mode,
      target: body.target ?? current.target,
      mixEveryNItems:
        body.mixEveryNItems !== undefined ? body.mixEveryNItems : current.mixEveryNItems,
      // Untouched times keep their exact stored instant.
      ...(body.startsAt === undefined && body.endsAt === undefined
        ? { startsAt: current.startsAt, endsAt: current.endsAt }
        : toInstants(startsLocal, endsLocal)),
    };
    db.transaction(() => {
      updateAnnouncement(db, id, values);
      writeAudit(
        db,
        user,
        { action: 'update', entity: 'announcement', entityId: id, facultyId: null, details: body },
        ctx.now(),
      );
    })();
    changed(current.target, values.target);
    return toApi(found(getAnnouncement(db, id)));
  });

  /** Ends an active announcement right now. */
  app.post('/api/admin/announcements/:id/end', async (req): Promise<Announcement> => {
    const user = requireSuperAdmin(req);
    const { id } = parse(IdParam, req.params);
    const current = found(getAnnouncement(db, id));
    const status = statusOf(current);
    if (status === 'scheduled') {
      throw new HttpError(400, 'bad_request', 'Not started yet; delete it instead');
    }
    if (status === 'active') {
      db.transaction(() => {
        updateAnnouncement(db, id, { ...current, endsAt: ctx.now().toISOString() });
        writeAudit(
          db,
          user,
          { action: 'end', entity: 'announcement', entityId: id, facultyId: null },
          ctx.now(),
        );
      })();
      changed(current.target);
    }
    return toApi(found(getAnnouncement(db, id)));
  });

  app.delete('/api/admin/announcements/:id', async (req, reply) => {
    const user = requireSuperAdmin(req);
    const { id } = parse(IdParam, req.params);
    const current = found(getAnnouncement(db, id));
    db.transaction(() => {
      writeAudit(
        db,
        user,
        {
          action: 'delete',
          entity: 'announcement',
          entityId: id,
          facultyId: null,
          details: { title: current.title },
        },
        ctx.now(),
      );
      deleteAnnouncement(db, id);
    })();
    changed(current.target);
    return reply.code(204).send();
  });
}
