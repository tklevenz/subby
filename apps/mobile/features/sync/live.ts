import { sessionFor, syncSettings } from './state';

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

function scheduleRetry(onNotify: () => void) {
  retry = setTimeout(() => void openLive(onNotify), Math.min(30_000, 1000 * 2 ** attempts++));
}

/** While the app is open: the server pings on every change, and `onNotify` (a sync request) runs right away. */
export async function openLive(onNotify: () => void) {
  const settings = syncSettings();
  if (!settings || socket) return;
  try {
    const url = await sessionFor(settings).liveUrl();
    socket = new WebSocket(url);
    socket.onopen = () => (attempts = 0);
    socket.onmessage = onNotify;
    socket.onclose = (e) => {
      socket = null;
      if (e.code === 4401 || !syncSettings()) return;
      // Reconnect with backoff (phones lose connections all the time).
      scheduleRetry(onNotify);
    };
  } catch {
    scheduleRetry(onNotify);
  }
}

export function closeLive() {
  if (retry) clearTimeout(retry);
  retry = null;
  const s = socket;
  socket = null;
  if (s) {
    s.onclose = null;
    s.close();
  }
}
