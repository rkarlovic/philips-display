import sharp from 'sharp';

// sharp's cache keeps input files open; on Windows that blocks deleting originals (EBUSY).
sharp.cache(false);

/** Long edge / short edge limits for display images (4K). */
export const MAX_LONG = 3840;
export const MAX_SHORT = 2160;
const THUMB = 480;

export interface EncodedImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Re-encodes an uploaded image as WebP, auto-rotated (EXIF) and capped to 4K. */
export async function processImage(input: string | Buffer): Promise<EncodedImage> {
  const meta = await sharp(input).metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? 0;
  const h = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!w || !h) throw new Error('image has no dimensions');
  const portrait = h > w;
  const { data, info } = await sharp(input)
    .rotate()
    .resize({
      width: portrait ? MAX_SHORT : MAX_LONG,
      height: portrait ? MAX_LONG : MAX_SHORT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
}
