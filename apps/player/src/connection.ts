/**
 * Talks to the server: fetches the manifest and keeps a WebSocket open for pushes.
 * If the server or network is down, the player keeps looping what it has and
 * reconnects with backoff (1 s … 30 s).
 */
import type { DisplayCommand, DisplayState, Manifest, ServerToPlayer } from '@slidecast/shared';

/** Same as WS_CLOSE_UNAUTHORIZED in @slidecast/shared (not imported: keeps zod out of the bundle). */
const CLOSE_UNAUTHORIZED = 4001;
const SILENCE_MS = 70_000;
const MANIFEST_RETRY_MS = 15_000;

export interface ConnectionHandlers {
  currentVersion: () => string | null;
  onManifest: (m: Manifest) => void;
  onCommand: (c: DisplayCommand) => void;
  onUnauthorized: () => void;
  onOnline: (online: boolean) => void;
}

export class Connection {
  private ws: WebSocket | null = null;
  private backoffMs = 1000;
  private lastHeard = 0;
  private watchdog: number | undefined;
  private reconnectTimer: number | undefined;
  private manifestRetry: number | undefined;
  private fetching = false;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly h: ConnectionHandlers,
  ) {}

  start(): void {
    void this.fetchManifest();
    this.connect();
    this.watchdog = window.setInterval(() => {
      if (
        this.ws &&
        this.ws.readyState === WebSocket.OPEN &&
        Date.now() - this.lastHeard > SILENCE_MS
      ) {
        this.ws.close(); // half-open connection: reconnect
      }
    }, 10_000);
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.watchdog);
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.manifestRetry);
    if (this.ws) this.ws.close();
  }

  sendStatus(state: DisplayState): void {
    this.send({ type: 'status', state });
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  async fetchManifest(): Promise<void> {
    if (this.fetching || this.stopped) return;
    this.fetching = true;
    window.clearTimeout(this.manifestRetry);
    try {
      const res = await fetch('/api/player/manifest', {
        headers: { Authorization: `Bearer ${this.token}` },
        cache: 'no-store',
      });
      if (res.status === 401) return this.h.onUnauthorized();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as Manifest;
      if (manifest.version !== this.h.currentVersion()) this.h.onManifest(manifest);
    } catch {
      // Offline: keep playing what we have; try again later.
      this.manifestRetry = window.setTimeout(() => void this.fetchManifest(), MANIFEST_RETRY_MS);
    } finally {
      this.fetching = false;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/api/player/ws`);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;

    ws.onopen = () => {
      this.lastHeard = Date.now();
      this.backoffMs = 1000;
      ws.send(
        JSON.stringify({
          type: 'hello',
          token: this.token,
          manifestVersion: this.h.currentVersion(),
        }),
      );
      this.h.onOnline(true);
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.lastHeard = Date.now();
      let msg: ServerToPlayer;
      try {
        msg = JSON.parse(String(ev.data)) as ServerToPlayer;
      } catch {
        return;
      }
      if (msg.type === 'ping') this.send({ type: 'pong' });
      else if (msg.type === 'manifest_changed') {
        if (msg.version !== this.h.currentVersion()) void this.fetchManifest();
      } else if (msg.type === 'command') this.h.onCommand(msg.command);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws === ws) this.ws = null;
      this.h.onOnline(false);
      if (ev.code === CLOSE_UNAUTHORIZED) return this.h.onUnauthorized();
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.backoffMs + Math.random() * 500;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }
}
