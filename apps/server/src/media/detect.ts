import fs from 'node:fs';
import path from 'node:path';
import type { MediaKind } from '@slidecast/shared';

export const EXTENSIONS: Record<MediaKind, string[]> = {
  pdf: ['.pdf'],
  pptx: ['.pptx'],
  image: ['.png', '.jpg', '.jpeg', '.webp'],
  video: ['.mp4', '.m4v'],
};

/** Extension of the stored original for each kind. */
export const ORIGINAL_EXT: Record<MediaKind, string> = {
  pdf: 'pdf',
  pptx: 'pptx',
  image: 'img',
  video: 'mp4',
};

/** Reads the first bytes of a file. */
export async function readHead(file: string, bytes = 1024): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Decides the media kind from the file name AND its content (magic bytes).
 * Both must agree; anything else is rejected.
 */
export function detectKind(head: Buffer, originalName: string): MediaKind | null {
  const ext = path.extname(originalName).toLowerCase();
  const kind = (Object.keys(EXTENSIONS) as MediaKind[]).find((k) => EXTENSIONS[k].includes(ext));
  if (!kind) return null;

  const ascii = (start: number, end: number) => head.subarray(start, end).toString('latin1');
  switch (kind) {
    case 'pdf':
      return head.includes(Buffer.from('%PDF-')) ? kind : null;
    case 'pptx':
      return head.length >= 4 && head.readUInt32BE(0) === 0x504b0304 ? kind : null; // ZIP
    case 'image': {
      const png = head.length >= 8 && head.readUInt32BE(0) === 0x89504e47;
      const jpg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const webp = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
      return png || jpg || webp ? kind : null;
    }
    case 'video':
      return ascii(4, 8) === 'ftyp' ? kind : null;
  }
}
