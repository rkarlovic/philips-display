/** Faculty-scoped display management and remote control. */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  DisplayCommandRequest,
  IdParam,
  UpdateDisplayRequest,
  type Display,
  type DisplayCommandResult,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import {
  facultyScope,
  forbiddenUnlessSuperAdmin,
  found,
  playlistFitsDisplay,
  requireUser,
} from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import { getDisplay, listDisplays, updateDisplay } from '../../db/repos/displays.js';
import { getFaculty } from '../../db/repos/faculties.js';
import { getPlaylist } from '../../db/repos/playlists.js';
import { deleteSchedulesNotFitting } from '../../db/repos/schedules.js';
import { HttpError, unauthorized } from '../../errors.js';
import { parse } from '../../validate.js';

const ADMIN_ONLY_FIELDS = ['name', 'location', 'rotation', 'fit', 'facultyId'] as const;

export function registerDisplayRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.get('/api/displays', async (req): Promise<Display[]> => {
    const scope = facultyScope(requireUser(req));
    return listDisplays(db, scope).map((d) => hub.toDisplay(d));
  });

  app.get('/api/displays/:id', async (req): Promise<Display> => {
    const scope = facultyScope(requireUser(req));
    const { id } = parse(IdParam, req.params);
    return hub.toDisplay(found(getDisplay(db, scope, id)));
  });

  app.patch('/api/displays/:id', async (req): Promise<Display> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdateDisplayRequest, req.body);
    const display = found(getDisplay(db, scope, id));

    // Faculty users may only pick the default playlist; the rest is IT's job.
    if (ADMIN_ONLY_FIELDS.some((f) => body[f] !== undefined)) forbiddenUnlessSuperAdmin(user);

    const facultyId = body.facultyId ?? display.facultyId;
    if (body.facultyId !== undefined && !getFaculty(db, scope, body.facultyId)) {
      throw new HttpError(400, 'faculty_not_found', 'Faculty does not exist');
    }

    let defaultPlaylistId = body.defaultPlaylistId;
    if (defaultPlaylistId != null) {
      const pl = getPlaylist(db, scope, defaultPlaylistId);
      if (!pl || !playlistFitsDisplay(pl.facultyId, facultyId)) {
        throw new HttpError(400, 'playlist_not_found', 'Playlist not found');
      }
    } else if (defaultPlaylistId === undefined && facultyId !== display.facultyId) {
      // Moved to another faculty: drop a default playlist that belongs to the old one.
      const current =
        display.defaultPlaylistId != null
          ? getPlaylist(db, { all: true }, display.defaultPlaylistId)
          : undefined;
      if (current && !playlistFitsDisplay(current.facultyId, facultyId)) defaultPlaylistId = null;
    }

    db.transaction(() => {
      updateDisplay(db, id, { ...body, defaultPlaylistId });
      // Moved to another faculty: its schedules with the old faculty's playlists go too.
      if (facultyId !== display.facultyId) deleteSchedulesNotFitting(db, id, facultyId);
      writeAudit(
        db,
        user,
        { action: 'update', entity: 'display', entityId: id, facultyId, details: body },
        ctx.now(),
      );
    })();
    if (facultyId !== display.facultyId) hub.displayRemoved(id, display.facultyId);
    hub.broadcastDisplay(id);
    hub.manifestChanged([id]);
    ctx.scheduler.reschedule();
    return hub.toDisplay(found(getDisplay(db, scope, id)));
  });

  app.post('/api/displays/:id/command', async (req): Promise<DisplayCommandResult> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const { command } = parse(DisplayCommandRequest, req.body);
    const display = found(getDisplay(db, scope, id));
    const delivered = hub.sendToDisplay(id, { type: 'command', command });
    writeAudit(
      db,
      user,
      {
        action: 'command',
        entity: 'display',
        entityId: id,
        facultyId: display.facultyId,
        details: { command, delivered },
      },
      ctx.now(),
    );
    return { delivered };
  });

  /** Live display status for the admin UI (session cookie auth). */
  app.get('/api/live', { websocket: true }, (socket: WebSocket, req) => {
    if (!req.user) {
      socket.close(4001, unauthorized().message);
      return;
    }
    // The UI loads the current state over REST; this socket only carries changes.
    hub.attachAdmin(socket, facultyScope(req.user));
  });
}
