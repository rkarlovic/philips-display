/** Playlists: faculty-scoped; university playlists are super-admin only (for now). */
import type { FastifyInstance } from 'fastify';
import {
  CreatePlaylistRequest,
  IdParam,
  PutPlaylistItemsRequest,
  UpdatePlaylistRequest,
  type Playlist,
  type PlaylistDetail,
  type PlaylistPreview,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import {
  facultyScope,
  found,
  mediaFitsPlaylist,
  ownerForCreate,
  requireUser,
} from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import { getFaculty } from '../../db/repos/faculties.js';
import {
  deletePlaylist,
  getPlaylist,
  getPlaylistItems,
  insertPlaylist,
  listPlaylists,
  mediaOwners,
  replacePlaylistItems,
  touchPlaylist,
  updatePlaylist,
} from '../../db/repos/playlists.js';
import { expandPlaylist } from '../../playback/manifest.js';
import { displaysUsingPlaylist } from '../../db/repos/displays.js';
import { announcementsUsingPlaylist } from '../../db/repos/announcements.js';
import { displayIdsForPlaylist } from '../../playback/affected.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

export function registerPlaylistRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  const detail = (p: Playlist): PlaylistDetail => ({ ...p, items: getPlaylistItems(db, p.id) });

  /** Displays playing this playlist get `manifest_changed` (only if their manifest changed). */
  const pushToDisplays = (playlistId: number) =>
    ctx.hub.manifestChanged(displayIdsForPlaylist(db, playlistId, ctx.now()));

  app.get('/api/playlists', async (req): Promise<Playlist[]> => {
    const scope = facultyScope(requireUser(req));
    return listPlaylists(db, scope);
  });

  app.post('/api/playlists', async (req, reply): Promise<PlaylistDetail> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const body = parse(CreatePlaylistRequest, req.body);
    const facultyId = ownerForCreate(scope, body.facultyId);
    if (facultyId != null && !getFaculty(db, scope, facultyId)) {
      throw new HttpError(400, 'faculty_not_found', 'Faculty does not exist');
    }
    const id = db.transaction(() => {
      const id = insertPlaylist(db, {
        facultyId,
        name: body.name,
        defaultDurationSec: body.defaultDurationSec,
        transition: body.transition,
      });
      writeAudit(
        db,
        user,
        { action: 'create', entity: 'playlist', entityId: id, facultyId, details: body },
        ctx.now(),
      );
      return id;
    })();
    reply.code(201);
    return detail(found(getPlaylist(db, scope, id)));
  });

  app.get('/api/playlists/:id', async (req): Promise<PlaylistDetail> => {
    const scope = facultyScope(requireUser(req));
    const { id } = parse(IdParam, req.params);
    return detail(found(getPlaylist(db, scope, id)));
  });

  app.patch('/api/playlists/:id', async (req): Promise<PlaylistDetail> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdatePlaylistRequest, req.body);
    const p = found(getPlaylist(db, scope, id));
    db.transaction(() => {
      updatePlaylist(db, id, body);
      writeAudit(
        db,
        user,
        {
          action: 'update',
          entity: 'playlist',
          entityId: id,
          facultyId: p.facultyId,
          details: body,
        },
        ctx.now(),
      );
    })();
    pushToDisplays(id);
    return detail(found(getPlaylist(db, scope, id)));
  });

  app.put('/api/playlists/:id/items', async (req): Promise<PlaylistDetail> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const body = parse(PutPlaylistItemsRequest, req.body);
    const p = found(getPlaylist(db, scope, id));

    // Every item must be media of the playlist's own faculty, or university media.
    // Anything else is reported exactly like a missing id.
    const owners = mediaOwners(db, [...new Set(body.items.map((i) => i.mediaId))]);
    for (const item of body.items) {
      if (!owners.has(item.mediaId) || !mediaFitsPlaylist(owners.get(item.mediaId)!, p.facultyId)) {
        throw new HttpError(400, 'media_not_found', `Media ${item.mediaId} not found`);
      }
    }

    const items = body.items.map((i) => ({
      mediaId: i.mediaId,
      durationSec: i.durationSec ?? null,
      pageFrom: i.pageFrom ?? null,
      pageTo: i.pageTo ?? null,
    }));
    db.transaction(() => {
      replacePlaylistItems(db, id, items);
      touchPlaylist(db, id);
      writeAudit(
        db,
        user,
        {
          action: 'update_items',
          entity: 'playlist',
          entityId: id,
          facultyId: p.facultyId,
          details: { items },
        },
        ctx.now(),
      );
    })();
    pushToDisplays(id);
    return detail(found(getPlaylist(db, scope, id)));
  });

  app.delete('/api/playlists/:id', async (req, reply) => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const p = found(getPlaylist(db, scope, id));
    const usedBy = [...displaysUsingPlaylist(db, id), ...announcementsUsingPlaylist(db, id)];
    if (usedBy.length > 0) {
      throw new HttpError(409, 'playlist_in_use', 'Playlist is used by displays or announcements', {
        usedIn: usedBy,
      });
    }
    db.transaction(() => {
      writeAudit(
        db,
        user,
        {
          action: 'delete',
          entity: 'playlist',
          entityId: id,
          facultyId: p.facultyId,
          details: { name: p.name },
        },
        ctx.now(),
      );
      deletePlaylist(db, id);
    })();
    return reply.code(204).send();
  });

  /** The flat loop exactly as a display would play it (used by the admin preview). */
  app.get('/api/playlists/:id/preview', async (req): Promise<PlaylistPreview> => {
    const scope = facultyScope(requireUser(req));
    const { id } = parse(IdParam, req.params);
    const p = found(getPlaylist(db, scope, id));
    return { playlistId: p.id, transition: p.transition, items: expandPlaylist(db, p) };
  });
}
