/** Media library: faculty-scoped; university media is visible read-only to faculty users. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import {
  IdParam,
  ListMediaQuery,
  UpdateMediaRequest,
  UploadMediaQuery,
  type Capabilities,
  type Media,
  type MediaDetail,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import {
  assertWritable,
  facultyScope,
  found,
  ownerForCreate,
  requireUser,
} from '../../authz/index.js';
import { writeAudit } from '../../audit/index.js';
import { getFaculty } from '../../db/repos/faculties.js';
import {
  deleteMediaRow,
  facultyUsedBytes,
  getMedia,
  getMediaPages,
  insertMedia,
  isFileReferenced,
  isMediaUsed,
  listMedia,
  playlistsUsingMedia,
  renameMedia,
  type MediaRecord,
} from '../../db/repos/media.js';
import { EXTENSIONS, detectKind, readHead } from '../../media/detect.js';
import { HttpError } from '../../errors.js';
import { parse } from '../../validate.js';

const MB = 1024 * 1024;

/** Strip the internal `files` field before sending. */
const publicMedia = ({ files: _files, ...m }: MediaRecord): Media => m;

/** Keeps only the base name, without control characters. Never used as a path. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

export function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, store, pipeline, config } = ctx;

  app.get('/api/capabilities', async (req): Promise<Capabilities> => {
    requireUser(req);
    const kinds = pipeline.pptxEnabled
      ? Object.values(EXTENSIONS)
      : Object.entries(EXTENSIONS)
          .filter(([k]) => k !== 'pptx')
          .map(([, v]) => v);
    return {
      pptx: pipeline.pptxEnabled,
      maxUploadMb: config.maxUploadMb,
      acceptedExtensions: kinds.flat(),
    };
  });

  app.get('/api/media', async (req): Promise<Media[]> => {
    const scope = facultyScope(requireUser(req));
    const q = parse(ListMediaQuery, req.query);
    return listMedia(db, scope, q.owner).map(publicMedia);
  });

  app.get('/api/media/:id', async (req): Promise<MediaDetail> => {
    const scope = facultyScope(requireUser(req));
    const { id } = parse(IdParam, req.params);
    const m = found(getMedia(db, scope, id));
    return {
      ...publicMedia(m),
      pages: getMediaPages(db, id).map(({ file: _f, ...p }) => p),
      usedIn: playlistsUsingMedia(db, scope, id),
    };
  });

  app.post('/api/media', async (req, reply): Promise<Media> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const q = parse(UploadMediaQuery, req.query);
    const facultyId = ownerForCreate(scope, q.facultyId);
    if (facultyId != null && !getFaculty(db, scope, facultyId)) {
      throw new HttpError(400, 'faculty_not_found', 'Faculty does not exist');
    }
    if (!req.isMultipart()) throw new HttpError(400, 'bad_request', 'Expected multipart upload');

    const tmp = store.tmpPath(`upload-${crypto.randomBytes(8).toString('hex')}`);
    try {
      const file = await req.file({ limits: { fileSize: config.maxUploadMb * MB, files: 1 } });
      if (!file) throw new HttpError(400, 'bad_request', 'No file in upload');
      try {
        await streamPipeline(file.file, fs.createWriteStream(tmp));
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new HttpError(413, 'file_too_large', `Maximum upload is ${config.maxUploadMb} MB`);
        }
        throw err;
      }
      if (file.file.truncated) {
        throw new HttpError(413, 'file_too_large', `Maximum upload is ${config.maxUploadMb} MB`);
      }

      const originalName = cleanName(file.filename);
      const size = (await fs.promises.stat(tmp)).size;
      const kind = detectKind(await readHead(tmp), originalName);
      if (!kind) throw new HttpError(415, 'unsupported_file', 'Unsupported or damaged file');
      if (kind === 'pptx' && !pipeline.pptxEnabled) {
        throw new HttpError(422, 'pptx_unavailable', 'Install LibreOffice to enable PowerPoint');
      }
      if (facultyId != null) {
        const quota = getFaculty(db, scope, facultyId)?.storageQuotaMb;
        if (quota != null && facultyUsedBytes(db, facultyId) + size > quota * MB) {
          throw new HttpError(413, 'quota_exceeded', 'Faculty storage quota exceeded');
        }
      }

      const id = db.transaction(() => {
        const id = insertMedia(db, { facultyId, kind, originalName, size, uploadedBy: user.id });
        writeAudit(
          db,
          user,
          {
            action: 'create',
            entity: 'media',
            entityId: id,
            facultyId,
            details: { originalName, kind, size },
          },
          ctx.now(),
        );
        return id;
      })();
      await fs.promises.rename(tmp, pipeline.originalPath(id, kind));
      pipeline.enqueue(id, kind);

      reply.code(202);
      return publicMedia(found(getMedia(db, scope, id)));
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  });

  app.patch('/api/media/:id', async (req): Promise<Media> => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const body = parse(UpdateMediaRequest, req.body);
    const m = found(getMedia(db, scope, id));
    assertWritable(scope, m.facultyId);
    const name = cleanName(body.originalName);
    db.transaction(() => {
      renameMedia(db, id, name);
      writeAudit(
        db,
        user,
        {
          action: 'update',
          entity: 'media',
          entityId: id,
          facultyId: m.facultyId,
          details: { originalName: name },
        },
        ctx.now(),
      );
    })();
    return publicMedia(found(getMedia(db, scope, id)));
  });

  app.delete('/api/media/:id', async (req, reply) => {
    const user = requireUser(req);
    const scope = facultyScope(user);
    const { id } = parse(IdParam, req.params);
    const m = found(getMedia(db, scope, id));
    assertWritable(scope, m.facultyId);
    if (isMediaUsed(db, id)) {
      throw new HttpError(409, 'media_in_use', 'Media is used in playlists', {
        usedIn: playlistsUsingMedia(db, scope, id),
      });
    }
    const files = db.transaction(() => {
      writeAudit(
        db,
        user,
        {
          action: 'delete',
          entity: 'media',
          entityId: id,
          facultyId: m.facultyId,
          details: { originalName: m.originalName },
        },
        ctx.now(),
      );
      return deleteMediaRow(db, id);
    })();
    for (const f of files) if (!isFileReferenced(db, f)) await store.remove(f);
    return reply.code(204).send();
  });
}
