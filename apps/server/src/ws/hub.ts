/**
 * Live connections: one WebSocket per display (player), plus admin UI sockets.
 * Pushes only to the displays/admins concerned. In-memory: after a server restart,
 * players reconnect on their own.
 */
import type { WebSocket } from 'ws';
import type { Display, ServerToAdmin, ServerToPlayer } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import { canAccessFaculty, type FacultyScope } from '../authz/index.js';
import { getActiveDisplay } from '../db/repos/displays.js';
import { resolveManifest } from '../playback/resolver.js';

const OPEN = 1;
const PING_MS = 30_000;
/** A player that has not sent anything for this long is considered gone. */
const DEAD_MS = 75_000;

interface PlayerConn {
  socket: WebSocket;
  lastHeard: number;
}

interface AdminConn {
  socket: WebSocket;
  scope: FacultyScope;
}

export class Hub {
  private readonly players = new Map<number, PlayerConn>();
  private readonly admins = new Set<AdminConn>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: { db: Db; timezone: string }) {}

  // ---------- players ----------

  attachPlayer(displayId: number, socket: WebSocket): void {
    const old = this.players.get(displayId);
    if (old && old.socket !== socket) old.socket.close(4000, 'replaced by a newer connection');
    this.players.set(displayId, { socket, lastHeard: Date.now() });
    socket.on('close', () => {
      if (this.players.get(displayId)?.socket === socket) {
        this.players.delete(displayId);
        this.broadcastDisplay(displayId);
      }
    });
    this.broadcastDisplay(displayId);
  }

  heardFrom(displayId: number): void {
    const conn = this.players.get(displayId);
    if (conn) conn.lastHeard = Date.now();
  }

  isOnline(displayId: number): boolean {
    return this.players.get(displayId)?.socket.readyState === OPEN;
  }

  sendToDisplay(displayId: number, msg: ServerToPlayer): boolean {
    const conn = this.players.get(displayId);
    if (!conn || conn.socket.readyState !== OPEN) return false;
    conn.socket.send(JSON.stringify(msg));
    return true;
  }

  disconnectDisplay(displayId: number, code: number, reason: string): void {
    const conn = this.players.get(displayId);
    if (!conn) return;
    this.players.delete(displayId);
    conn.socket.close(code, reason);
  }

  /** Tell these displays to fetch their manifest again (if it actually changed). */
  manifestChanged(displayIds: Iterable<number>): void {
    for (const id of new Set(displayIds)) {
      if (!this.isOnline(id)) continue;
      const manifest = resolveManifest(this.opts.db, id, { timezone: this.opts.timezone });
      if (manifest) this.sendToDisplay(id, { type: 'manifest_changed', version: manifest.version });
    }
  }

  // ---------- admin UI ----------

  attachAdmin(socket: WebSocket, scope: FacultyScope): void {
    const conn = { socket, scope };
    this.admins.add(conn);
    socket.on('close', () => this.admins.delete(conn));
  }

  toDisplay(record: Omit<Display, 'online'>): Display {
    return { ...record, online: this.isOnline(record.id) };
  }

  /** Push the current state of one display to every admin who may see it. */
  broadcastDisplay(displayId: number): void {
    const record = getActiveDisplay(this.opts.db, displayId);
    if (!record) return;
    const msg: ServerToAdmin = { type: 'display', display: this.toDisplay(record) };
    this.sendToAdmins(msg, (scope) => canAccessFaculty(scope, record.facultyId));
  }

  displayRemoved(displayId: number, facultyId: number): void {
    this.sendToAdmins({ type: 'display_removed', id: displayId }, (scope) =>
      canAccessFaculty(scope, facultyId),
    );
  }

  /** Pending (unpaired) displays are visible to the super admin only. */
  pendingChanged(): void {
    this.sendToAdmins({ type: 'pending_changed' }, (scope) => scope.all);
  }

  private sendToAdmins(msg: ServerToAdmin, allowed: (scope: FacultyScope) => boolean): void {
    const data = JSON.stringify(msg);
    for (const a of this.admins) {
      if (a.socket.readyState === OPEN && allowed(a.scope)) a.socket.send(data);
    }
  }

  // ---------- heartbeat ----------

  start(): void {
    this.timer = setInterval(() => this.heartbeat(), PING_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    for (const [, c] of this.players) c.socket.terminate();
    for (const a of this.admins) a.socket.terminate();
    this.players.clear();
    this.admins.clear();
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const [id, conn] of this.players) {
      if (now - conn.lastHeard > DEAD_MS) {
        conn.socket.terminate(); // 'close' handler marks it offline
        continue;
      }
      this.sendToDisplay(id, { type: 'ping' });
    }
    for (const a of this.admins) if (a.socket.readyState === OPEN) a.socket.ping();
  }
}
