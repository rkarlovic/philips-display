import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import type { Display, DisplaySetup, Manifest } from '@slidecast/shared';

/** Full pairing flow, like a real display + super admin. Returns the device token. */
export async function pairDisplay(
  app: FastifyInstance,
  superCookie: string,
  facultyId: number,
  name = 'Lobby screen',
  extra: Record<string, unknown> = {},
): Promise<{ display: Display; token: string; setup: DisplaySetup }> {
  const req = (await app.inject({ method: 'POST', url: '/api/player/pair' })).json() as {
    code: string;
    claim: string;
  };
  const paired = await app.inject({
    method: 'POST',
    url: '/api/admin/displays/pair',
    headers: { cookie: superCookie },
    payload: { code: req.code, facultyId, name, ...extra },
  });
  if (paired.statusCode !== 201) throw new Error(`pair failed: ${paired.body}`);
  const status = await app.inject({
    url: '/api/player/pair-status',
    headers: { 'x-pairing-claim': req.claim },
  });
  const token = (status.json() as { token: string }).token;
  const setup = paired.json() as DisplaySetup;
  return { display: setup.display, token, setup };
}

export async function manifestFor(app: FastifyInstance, token: string): Promise<Manifest> {
  const res = await app.inject({
    url: '/api/player/manifest',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.statusCode !== 200) throw new Error(`manifest ${res.statusCode}`);
  return res.json() as Manifest;
}

/** Collects JSON messages from a socket; `next` waits for one matching `pred`. */
export function inbox(ws: WebSocket) {
  const received: { type: string; [k: string]: unknown }[] = [];
  const waiters: {
    pred: (m: (typeof received)[number]) => boolean;
    resolve: (m: (typeof received)[number]) => void;
  }[] = [];
  let closed: { code: number } | null = null;
  const closeWaiters: ((c: { code: number }) => void)[] = [];

  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString()) as (typeof received)[number];
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg);
    else received.push(msg);
  });
  ws.on('close', (code: number) => {
    closed = { code };
    closeWaiters.splice(0).forEach((w) => w(closed!));
  });

  return {
    received,
    next(pred: (m: (typeof received)[number]) => boolean = () => true, timeoutMs = 3000) {
      const i = received.findIndex(pred);
      if (i >= 0) return Promise.resolve(received.splice(i, 1)[0]!);
      return new Promise<(typeof received)[number]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for message')),
          timeoutMs,
        );
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    /** Resolves to true if nothing matching arrives within `ms`. */
    async silent(pred: (m: (typeof received)[number]) => boolean, ms = 300) {
      try {
        await this.next(pred, ms);
        return false;
      } catch {
        return true;
      }
    },
    closed(timeoutMs = 3000) {
      if (closed) return Promise.resolve(closed);
      return new Promise<{ code: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
        closeWaiters.push((c) => {
          clearTimeout(timer);
          resolve(c);
        });
      });
    },
  };
}

/** Opens a player socket and authenticates it. */
export async function connectPlayer(
  app: FastifyInstance,
  token: string,
  manifestVersion: string | null = null,
) {
  const ws = await app.injectWS('/api/player/ws');
  const box = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', token, manifestVersion }));
  return { ws, box };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
