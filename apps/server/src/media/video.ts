import { createRequire } from 'node:module';
import fs from 'node:fs';
import { run } from './run.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string | null;
const ffprobePath = (require('ffprobe-static') as { path: string }).path;

export interface VideoInfo {
  durationMs: number;
  videoCodec: string;
  width: number;
  height: number;
}

interface ProbeOutput {
  format?: { duration?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
}

export async function probeVideo(file: string, signal?: AbortSignal): Promise<VideoInfo> {
  const { stdout } = await run(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeoutMs: 30_000, signal },
  );
  const info = JSON.parse(stdout) as ProbeOutput;
  const v = info.streams?.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('no video stream');
  const duration = Number(info.format?.duration);
  return {
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
    videoCodec: v.codec_name ?? 'unknown',
    width: v.width ?? 0,
    height: v.height ?? 0,
  };
}

/** Grabs one frame (at 1 s, or the middle of short clips) as PNG. */
export async function videoPoster(
  file: string,
  durationMs: number,
  outPng: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform');
  const at = Math.min(1, durationMs / 2000).toFixed(2);
  await run(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', file, '-frames:v', '1', outPng],
    { timeoutMs: 60_000, signal },
  );
  try {
    return await fs.promises.readFile(outPng);
  } finally {
    await fs.promises.rm(outPng, { force: true });
  }
}

export const ffmpegBinary = () => ffmpegPath;
