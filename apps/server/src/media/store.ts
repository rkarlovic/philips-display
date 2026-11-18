import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Content-addressed file store in data/media: files are named `<sha256>.<ext>`,
 * immutable and safe to cache forever. Identical content is stored once.
 */
export class MediaStore {
  readonly mediaDir: string;
  readonly tmpDir: string;

  constructor(dataDir: string) {
    this.mediaDir = path.join(dataDir, 'media');
    this.tmpDir = path.join(dataDir, 'tmp');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  pathOf(name: string): string {
    return path.join(this.mediaDir, name);
  }

  async putBuffer(data: Buffer, ext: string): Promise<string> {
    const name = `${crypto.createHash('sha256').update(data).digest('hex')}.${ext}`;
    const target = this.pathOf(name);
    if (!fs.existsSync(target)) {
      const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.part`;
      await fs.promises.writeFile(tmp, data);
      await fs.promises.rename(tmp, target);
    }
    return name;
  }

  /** Moves a file into the store (the source is consumed). */
  async moveFile(src: string, ext: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(src), hash);
    const name = `${hash.digest('hex')}.${ext}`;
    const target = this.pathOf(name);
    if (fs.existsSync(target)) {
      await fs.promises.rm(src, { force: true });
    } else {
      await fs.promises.rename(src, target);
    }
    return name;
  }

  async remove(name: string): Promise<void> {
    // Names come from the DB, but stay defensive: only plain file names inside mediaDir.
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(name)) return;
    await fs.promises.rm(this.pathOf(name), { force: true });
  }

  tmpPath(name: string): string {
    return path.join(this.tmpDir, name);
  }
}
