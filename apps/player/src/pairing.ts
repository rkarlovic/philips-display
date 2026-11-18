/**
 * Pairing screen: no keyboard or mouse on the display, so everything is readable
 * from across the room. The super admin types the code into the admin UI.
 */
import type { PairRequestResponse, PairStatusResponse } from '@slidecast/shared';
import { clear, el } from './dom.js';

const POLL_MS = 3000;
const RETRY_MS = 5000;

export function startPairing(root: HTMLElement, onPaired: (token: string) => void): () => void {
  let stopped = false;
  let timer: number | undefined;

  clear(root);
  const box = el('div', 'pairing');
  const title = el('div', 'pairing-title', 'SlideCast');
  const label = el('div', 'pairing-label', 'Kod za uparivanje · Pairing code');
  const code = el('div', 'pairing-code', '······');
  const hint = el(
    'div',
    'pairing-hint',
    `Upišite kod u SlideCast admin (Ekrani → Upari) · Enter it in SlideCast admin (Displays → Pair)`,
  );
  const server = el('div', 'pairing-server', `Server: ${window.location.host}`);
  const status = el('div', 'pairing-status', '');
  box.appendChild(title);
  box.appendChild(label);
  box.appendChild(code);
  box.appendChild(hint);
  box.appendChild(server);
  box.appendChild(status);
  root.appendChild(box);

  const later = (fn: () => void, ms: number) => {
    if (!stopped) timer = window.setTimeout(fn, ms);
  };

  const request = async () => {
    try {
      const res = await fetch('/api/player/pair', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PairRequestResponse;
      code.textContent = `${data.code.slice(0, 3)} ${data.code.slice(3)}`;
      status.textContent = '';
      later(() => void poll(data.claim), POLL_MS);
    } catch {
      status.textContent = 'Spajanje na poslužitelj… · Connecting to server…';
      later(() => void request(), RETRY_MS);
    }
  };

  const poll = async (claim: string) => {
    try {
      const res = await fetch('/api/player/pair-status', {
        headers: { 'X-Pairing-Claim': claim },
        cache: 'no-store',
      });
      if (res.status === 404) return void request(); // expired: get a new code
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PairStatusResponse;
      if (data.status === 'paired') {
        stopped = true;
        onPaired(data.token);
        return;
      }
      status.textContent = '';
      later(() => void poll(claim), POLL_MS);
    } catch {
      status.textContent = 'Spajanje na poslužitelj… · Connecting to server…';
      later(() => void poll(claim), RETRY_MS);
    }
  };

  void request();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
