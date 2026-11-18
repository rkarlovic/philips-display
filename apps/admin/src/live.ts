import { useEffect, useRef } from 'react';
import type { ServerToAdmin } from '@slidecast/shared';

/**
 * Live display status over /api/live (session cookie). Reconnects with backoff;
 * `onReconnect` lets the page refetch whatever it may have missed.
 */
export function useLive(onMessage: (msg: ServerToAdmin) => void, onReconnect: () => void): void {
  const handlers = useRef({ onMessage, onReconnect });
  handlers.current = { onMessage, onReconnect };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let backoff = 1000;
    let timer: number | undefined;
    let first = true;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/api/live`);
      ws.onopen = () => {
        backoff = 1000;
        if (!first) handlers.current.onReconnect();
        first = false;
      };
      ws.onmessage = (ev) => {
        try {
          handlers.current.onMessage(JSON.parse(String(ev.data)) as ServerToAdmin);
        } catch {
          // ignore
        }
      };
      ws.onclose = (ev) => {
        if (stopped || ev.code === 4001) return;
        timer = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);
}
