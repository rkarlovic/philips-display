import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './run.js';

/** Usual install locations, per OS. */
function candidates(): string[] {
  switch (process.platform) {
    case 'win32': {
      const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(
        (r): r is string => !!r,
      );
      return roots.map((r) => path.join(r, 'LibreOffice', 'program', 'soffice.exe'));
    }
    case 'darwin':
      return ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];
    default:
      return [
        '/usr/bin/soffice',
        '/usr/local/bin/soffice',
        '/usr/lib/libreoffice/program/soffice',
        '/opt/libreoffice/program/soffice',
        '/snap/bin/libreoffice',
      ];
  }
}

function onPath(): string[] {
  const names = process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice'];
  return (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((dir) => names.map((n) => path.join(dir, n)));
}

/** On Windows, soffice.com waits for the conversion and reports errors; prefer it. */
function preferConsole(exe: string): string {
  if (process.platform !== 'win32') return exe;
  const com = exe.replace(/soffice\.exe$/i, 'soffice.com');
  return fs.existsSync(com) ? com : exe;
}

/** Finds LibreOffice: SOFFICE_PATH, then the usual install paths, then PATH. */
export function findSoffice(configured: string | undefined): string | null {
  const list = [...(configured ? [configured] : []), ...candidates(), ...onPath()];
  const found = list.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  return found ? preferConsole(found) : null;
}

/** Converts a PPTX to PDF in `workDir` (with its own LibreOffice profile) and returns the PDF path. */
export async function convertToPdf(
  soffice: string,
  input: string,
  workDir: string,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  const profile = path.join(workDir, 'lo-profile');
  await fs.promises.mkdir(profile, { recursive: true });
  await run(
    soffice,
    [
      '--headless',
      '--invisible',
      '--nodefault',
      '--norestore',
      '--nolockcheck',
      '--nologo',
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      workDir,
      input,
    ],
    opts,
  );
  const pdf = path.join(workDir, `${path.parse(input).name}.pdf`);
  if (!fs.existsSync(pdf)) throw new Error('LibreOffice produced no PDF');
  return pdf;
}
