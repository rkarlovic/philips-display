import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { run } from '../src/media/run.js';
import { ffmpegBinary } from '../src/media/video.js';
import { findSoffice } from '../src/media/pptx.js';

export async function png(width: number, height: number, color = '#3366cc'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

/** A valid PDF with `pages` Letter pages, each saying "Page N" in Helvetica. */
export function makePdf(pages: number): Buffer {
  const bodies = new Map<number, string>();
  bodies.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  bodies.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: string[] = [];
  let next = 4;
  for (let i = 1; i <= pages; i++) {
    const pageId = next++;
    const contentId = next++;
    kids.push(`${pageId} 0 R`);
    const stream = `BT /F1 48 Tf 72 700 Td (Page ${i}) Tj ET`;
    bodies.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    bodies.set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  bodies.set(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`);

  const count = next - 1;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id <= count; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${bodies.get(id)}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= count; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function tmpFile(ext: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slidecast-fx-'));
  return path.join(dir, `fixture.${ext}`);
}

/** Two-second test video. `codec`: 'libx264' (accepted) or 'mpeg4' (rejected). */
export async function makeVideo(codec: 'libx264' | 'mpeg4' = 'libx264'): Promise<Buffer> {
  const out = await tmpFile('mp4');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i'];
  args.push('testsrc=size=320x180:rate=25', '-t', '2', '-c:v', codec);
  if (codec === 'libx264') args.push('-pix_fmt', 'yuv420p');
  args.push(out);
  await run(ffmpegBinary()!, args, { timeoutMs: 60_000 });
  const data = await fs.promises.readFile(out);
  await fs.promises.rm(path.dirname(out), { recursive: true, force: true });
  return data;
}

export const soffice = findSoffice(process.env['SOFFICE_PATH']);

/**
 * A two-slide PPTX, made by LibreOffice from a flat ODP (needs LibreOffice).
 * Only used when `soffice` was found.
 */
export async function makePptx(): Promise<Buffer> {
  if (!soffice) throw new Error('LibreOffice not available');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slidecast-pptx-'));
  const slide = (n: number) => `
    <draw:page draw:name="s${n}" draw:master-page-name="Default">
      <draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="4cm">
        <draw:text-box><text:p>Slide ${n}</text:p></draw:text-box>
      </draw:frame>
    </draw:page>`;
  const fodp = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.presentation">
  <office:master-styles><style:master-page style:name="Default"/></office:master-styles>
  <office:body><office:presentation>${slide(1)}${slide(2)}</office:presentation></office:body>
</office:document>`;
  const src = path.join(dir, 'deck.fodp');
  await fs.promises.writeFile(src, fodp);
  await run(
    soffice,
    [
      '--headless',
      '--norestore',
      `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
      '--convert-to',
      'pptx',
      '--outdir',
      dir,
      src,
    ],
    { timeoutMs: 120_000 },
  );
  const data = await fs.promises.readFile(path.join(dir, 'deck.pptx'));
  await fs.promises.rm(dir, { recursive: true, force: true });
  return data;
}

/** Builds a multipart/form-data request with one file field. */
export function multipartFile(filename: string, data: Buffer) {
  const boundary = `----slidecast${crypto.randomBytes(8).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export async function upload(
  app: FastifyInstance,
  cookie: string,
  filename: string,
  data: Buffer,
  query = '',
) {
  const mp = multipartFile(filename, data);
  return app.inject({
    method: 'POST',
    url: `/api/media${query}`,
    payload: mp.payload,
    headers: { ...mp.headers, cookie },
  });
}
