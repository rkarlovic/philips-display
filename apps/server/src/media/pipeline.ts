import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { MediaErrorCode, MediaKind } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import {
  getMediaKind,
  isFileReferenced,
  listProcessingMedia,
  setMediaFailed,
  setMediaReady,
  type ProcessedPage,
} from '../db/repos/media.js';
import { ORIGINAL_EXT } from './detect.js';
import { makeThumb, processImage } from './image.js';
import { JobQueue, TimeoutError } from './jobs.js';
import { renderPdf } from './pdf.js';
import { convertToPdf } from './pptx.js';
import type { MediaStore } from './store.js';
import { probeVideo, videoPoster } from './video.js';

/** A failure with a code the admin UI can explain. */
export class MediaFailure extends Error {
  constructor(
    readonly code: MediaErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

type Lane = 'office' | 'default';

const TIMEOUT_MS: Record<MediaKind, number> = {
  image: 60_000,
  pdf: 5 * 60_000,
  pptx: 10 * 60_000,
  video: 2 * 60_000,
};

const DEFAULT_ERROR: Record<MediaKind, MediaErrorCode> = {
  image: 'corrupt',
  pdf: 'corrupt',
  pptx: 'pptx_conversion',
  video: 'corrupt',
};

export interface PipelineOptions {
  db: Db;
  store: MediaStore;
  pdfDpi: number;
  soffice: string | null;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
}

/**
 * Turns uploaded originals (data/tmp/media-<id>.<ext>) into display-ready files.
 * Upload returns immediately; this runs in the background and sets status ready/failed.
 */
export class MediaPipeline {
  private readonly queue: JobQueue<Lane>;
  /** Settable after construction (the app logger exists only once the app is built). */
  log: PipelineOptions['log'];

  constructor(private readonly opts: PipelineOptions) {
    this.log = opts.log;
    this.queue = new JobQueue<Lane>({ office: 1, default: 2 }, (err) => {
      if (!(err instanceof TimeoutError)) this.log?.error({ err }, 'media job crashed');
    });
  }

  get pptxEnabled(): boolean {
    return this.opts.soffice != null;
  }

  originalPath(id: number, kind: MediaKind): string {
    return this.opts.store.tmpPath(`media-${id}.${ORIGINAL_EXT[kind]}`);
  }

  enqueue(id: number, kind: MediaKind): void {
    const lane: Lane = kind === 'pptx' ? 'office' : 'default';
    this.queue.add(lane, TIMEOUT_MS[kind], (signal) => {
      signal.addEventListener('abort', () => setMediaFailed(this.opts.db, id, 'timeout'), {
        once: true,
      });
      return this.process(id, kind, signal);
    });
  }

  /** On startup: re-queue interrupted jobs whose original is still there. */
  recover(): void {
    for (const m of listProcessingMedia(this.opts.db)) {
      if (fs.existsSync(this.originalPath(m.id, m.kind))) this.enqueue(m.id, m.kind);
      else setMediaFailed(this.opts.db, m.id, 'interrupted');
    }
  }

  onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  private async process(id: number, kind: MediaKind, signal: AbortSignal): Promise<void> {
    const { db, store } = this.opts;
    const log = this.log;
    const original = this.originalPath(id, kind);
    const written: string[] = [];
    const put = async (data: Buffer, ext: string) => {
      const name = await store.putBuffer(data, ext);
      written.push(name);
      return name;
    };
    const workDir = store.tmpPath(`job-${id}`);
    let keepOriginal = false;

    try {
      // Deleted while waiting in the queue: nothing to do.
      if (getMediaKind(db, id) === undefined) return;

      if (kind === 'image') {
        const img = await processImage(original);
        const file = await put(img.data, 'webp');
        const thumb = await put(await makeThumb(img.data), 'webp');
        this.finish(id, signal, {
          thumbFile: thumb,
          pages: [{ file, thumbFile: thumb, width: img.width, height: img.height }],
        });
      } else if (kind === 'pdf' || kind === 'pptx') {
        let pdf = original;
        if (kind === 'pptx') {
          if (!this.opts.soffice) throw new MediaFailure('pptx_unavailable');
          await fs.promises.mkdir(workDir, { recursive: true });
          pdf = await convertToPdf(this.opts.soffice, original, workDir, {
            timeoutMs: TIMEOUT_MS.pptx,
            signal,
          });
        }
        const pages: ProcessedPage[] = [];
        await renderPdf(pdf, { dpi: this.opts.pdfDpi, signal }, async (p) => {
          const file = await put(p.data, 'webp');
          const thumbFile = await put(await makeThumb(p.data), 'webp');
          pages.push({ file, thumbFile, width: p.width, height: p.height });
        });
        if (pages.length === 0) throw new MediaFailure('no_pages');
        this.finish(id, signal, { thumbFile: pages[0]!.thumbFile, pages });
      } else {
        const info = await probeVideo(original, signal);
        if (info.videoCodec !== 'h264') {
          throw new MediaFailure('video_codec', `codec ${info.videoCodec}`);
        }
        await fs.promises.mkdir(workDir, { recursive: true });
        const png = await videoPoster(
          original,
          info.durationMs,
          path.join(workDir, 'poster.png'),
          signal,
        );
        const thumb = await put(await makeThumb(png), 'webp');
        signal.throwIfAborted();
        const videoFile = await store.moveFile(original, 'mp4');
        written.push(videoFile);
        keepOriginal = true; // it now lives in the store
        this.finish(id, signal, {
          thumbFile: thumb,
          videoFile,
          durationMs: info.durationMs,
          pages: [],
        });
      }
      log?.info({ mediaId: id, kind }, 'media ready');
    } catch (err) {
      const code: MediaErrorCode = signal.aborted
        ? 'timeout'
        : err instanceof MediaFailure
          ? err.code
          : DEFAULT_ERROR[kind];
      log?.warn({ mediaId: id, kind, code, err: String(err) }, 'media processing failed');
      try {
        setMediaFailed(db, id, code);
      } catch {
        // row may be gone
      }
    } finally {
      if (!keepOriginal) await fs.promises.rm(original, { force: true });
      await fs.promises.rm(workDir, { recursive: true, force: true });
      // Remove files that ended up unreferenced (failure, or media deleted meanwhile).
      for (const name of new Set(written)) {
        if (!isFileReferenced(db, name)) await store.remove(name);
      }
    }
  }

  private finish(id: number, signal: AbortSignal, result: Parameters<typeof setMediaReady>[2]) {
    signal.throwIfAborted();
    if (getMediaKind(this.opts.db, id) === undefined) return; // deleted meanwhile
    setMediaReady(this.opts.db, id, result);
  }
}
