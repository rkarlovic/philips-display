import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Runs a binary with an argument array (never a shell), with a timeout and abort signal.
 * Rejects with the tail of stderr on a non-zero exit.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cap = 2 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < cap) stderr += d.toString();
    });

    const kill = () => child.kill('SIGKILL');
    const timer = setTimeout(kill, opts.timeoutMs);
    opts.signal?.addEventListener('abort', kill, { once: true });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', kill);
      if (code === 0) return resolve({ stdout, stderr });
      const name = path.basename(cmd);
      reject(
        new Error(
          `${name} failed (${sig ?? `exit ${code}`}): ${stderr.trim().split('\n').slice(-5).join(' | ')}`,
        ),
      );
    });
  });
}
