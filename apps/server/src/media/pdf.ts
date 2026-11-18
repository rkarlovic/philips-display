import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
import { MAX_LONG } from './image.js';

const require = createRequire(import.meta.url);
// pdfjs wants forward slashes and a trailing slash for its data directories, on every OS.
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const dataUrl = (dir: string) => path.join(pdfjsRoot, dir).split(path.sep).join('/') + '/';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | undefined;
const loadPdfJs = () => (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

export interface RenderedPage {
  data: Buffer; // WebP
  width: number;
  height: number;
}

/**
 * Renders every page of a PDF to WebP at `dpi`, capped to 3840 px on the long edge.
 * Pages are handed to `onPage` one by one so memory stays flat for long documents.
 */
export async function renderPdf(
  file: string,
  opts: { dpi: number; signal?: AbortSignal },
  onPage: (page: RenderedPage, pageNo: number) => Promise<void>,
): Promise<number> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await fs.promises.readFile(file));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: dataUrl('standard_fonts'),
    cMapUrl: dataUrl('cmaps'),
    cMapPacked: true,
    verbosity: 0,
  }).promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      opts.signal?.throwIfAborted();
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = opts.dpi / 72;
      const longEdge = Math.max(base.width, base.height);
      if (longEdge * scale > MAX_LONG) scale = MAX_LONG / longEdge;
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
      const webp = await canvas.encode('webp', 85);
      page.cleanup();
      await onPage({ data: webp, width, height }, n);
    }
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}
