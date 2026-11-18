/**
 * SlideCast player: runs full screen in the display's built-in browser.
 *   no token  → pairing screen
 *   token     → play the manifest the server gives, forever
 * Token sources: `?token=` in the URL (fallback setup), else localStorage.
 */
import './style.css';
import { Connection } from './connection.js';
import { Engine } from './engine.js';
import { startPairing } from './pairing.js';
import { clearToken, loadToken, saveToken } from './storage.js';

const root = document.getElementById('root')!;
const STATUS_EVERY_MS = 60_000;

function tokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return null;
  // Remove it from the address bar only if it was persisted; otherwise a reload needs it.
  if (saveToken(token)) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return token;
}

function backToPairing(): void {
  clearToken();
  // A clean page: drops every timer, socket and media element of the old session.
  window.location.replace(window.location.pathname);
}

function play(token: string): void {
  let online = false;
  const engine = new Engine(root, (state) => conn.sendStatus(state));
  const conn = new Connection(token, {
    currentVersion: () => engine.version,
    onManifest: (m) => engine.load(m),
    onCommand: (c) => engine.command(c),
    onUnauthorized: backToPairing,
    onOnline: (o) => {
      online = o;
      document.body.classList.toggle('offline', !o);
      if (o) conn.sendStatus(engine.state());
    },
  });
  conn.start();
  window.setInterval(() => {
    if (online) conn.sendStatus(engine.state());
  }, STATUS_EVERY_MS);
}

const token = tokenFromUrl() ?? loadToken();
if (token) {
  play(token);
} else {
  const stop = startPairing(root, (newToken) => {
    stop();
    saveToken(newToken);
    play(newToken);
  });
}
