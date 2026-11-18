/**
 * Endpoints used by the display's built-in browser. No session: a display authenticates
 * with its device token (Authorization: Bearer … over HTTP, `hello` message over WS).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import {
  PlayerMessage,
  WS_CLOSE_UNAUTHORIZED,
  type Manifest,
  type PairRequestResponse,
  type PairStatusResponse,
} from '@slidecast/shared';
import type { AppContext } from '../../context.js';
import { hashToken, pairingCode, randomToken } from '../../auth/tokens.js';
import {
  createPendingDisplay,
  findByClaim,
  findDisplayIdByTokenHash,
  pairingCodeInUse,
  purgeStalePending,
  setReportedState,
  setUserAgent,
  takeHandoffToken,
  touchDisplay,
} from '../../db/repos/displays.js';
import { resolveManifest } from '../../playback/resolver.js';
import { HttpError, notFound } from '../../errors.js';

/** Unpaired displays not seen for a day are forgotten. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** A new socket must authenticate within this time. */
const HELLO_TIMEOUT_MS = 10_000;

const userAgentOf = (req: FastifyRequest) =>
  (req.headers['user-agent'] ?? '').slice(0, 300) || null;

export function registerPlayerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;
  const iso = () => ctx.now().toISOString();

  const displayFromBearer = (req: FastifyRequest): number => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const id = token ? findDisplayIdByTokenHash(db, hashToken(token)) : undefined;
    if (!id) throw new HttpError(401, 'unauthorized', 'Unknown or revoked display token');
    return id;
  };

  app.post('/api/player/pair', async (req): Promise<PairRequestResponse> => {
    purgeStalePending(db, new Date(ctx.now().getTime() - PENDING_TTL_MS).toISOString());
    let code = pairingCode();
    while (pairingCodeInUse(db, code)) code = pairingCode();
    const claim = randomToken();
    createPendingDisplay(db, {
      code,
      claimHash: hashToken(claim),
      userAgent: userAgentOf(req),
      now: iso(),
    });
    hub.pendingChanged();
    return { code, claim };
  });

  app.get('/api/player/pair-status', async (req): Promise<PairStatusResponse> => {
    const claim = String(req.headers['x-pairing-claim'] ?? '');
    const row = claim ? findByClaim(db, hashToken(claim)) : undefined;
    if (!row) throw notFound(); // expired or unknown: the player asks for a new code
    if (row.status === 'pending') {
      touchDisplay(db, row.id, iso());
      return { status: 'pending', code: row.pairing_code ?? '' };
    }
    const token = takeHandoffToken(db, row.id);
    if (!token) throw notFound();
    return { status: 'paired', token };
  });

  app.get('/api/player/manifest', async (req): Promise<Manifest> => {
    const id = displayFromBearer(req);
    const manifest = resolveManifest(db, id, { timezone: ctx.config.timezone });
    if (!manifest) throw new HttpError(401, 'unauthorized', 'Display not active');
    touchDisplay(db, id, iso());
    return manifest;
  });

  app.get('/api/player/ws', { websocket: true }, (socket: WebSocket, req) => {
    let displayId: number | null = null;
    const helloTimer = setTimeout(() => {
      if (displayId == null) socket.close(WS_CLOSE_UNAUTHORIZED, 'hello expected');
    }, HELLO_TIMEOUT_MS);

    socket.on('close', () => clearTimeout(helloTimer));
    socket.on('message', (raw: Buffer) => {
      let msg: PlayerMessage;
      try {
        msg = PlayerMessage.parse(JSON.parse(raw.toString()));
      } catch {
        return; // ignore malformed messages
      }

      if (displayId == null) {
        if (msg.type !== 'hello') return;
        const id = findDisplayIdByTokenHash(db, hashToken(msg.token));
        if (!id) {
          socket.close(WS_CLOSE_UNAUTHORIZED, 'unknown or revoked token');
          return;
        }
        displayId = id;
        clearTimeout(helloTimer);
        setUserAgent(db, id, userAgentOf(req));
        touchDisplay(db, id, iso());
        hub.attachPlayer(id, socket);
        // Bring a reconnecting player up to date right away.
        const manifest = resolveManifest(db, id, { timezone: ctx.config.timezone });
        if (manifest && manifest.version !== msg.manifestVersion) {
          hub.sendToDisplay(id, { type: 'manifest_changed', version: manifest.version });
        }
        return;
      }

      hub.heardFrom(displayId);
      if (msg.type === 'status') {
        setReportedState(db, displayId, msg.state, iso());
        hub.broadcastDisplay(displayId);
      }
    });
  });
}
