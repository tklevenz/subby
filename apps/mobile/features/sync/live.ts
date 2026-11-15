import { sessionFor, syncSettings } from './state';

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let confirm: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(onNotify: () => void) {
  retry = setTimeout(() => void openLive(onNotify), Math.min(30_000, 1000 * 2 ** attempts++));
}

/**
 * Servers that read the live token only from the URL (older ones). The token goes in a header, since proxies
 * log URLs; a server that refuses it there gets one more try with it in the URL, and is remembered.
 */
const tokenInUrl = new Set<string>();
const URL_ONLY_AFTER_MS = 5000;
/** React Native's WebSocket takes headers as a third argument (the DOM typings the app compiles with don't know it). */
const HeaderSocket = WebSocket as unknown as new (url: string, protocols: null, options: { headers: Record<string, string> }) => WebSocket;

/** While the app is open: the server pings on every change, and `onNotify` (a sync request) runs right away. */
export async function openLive(onNotify: () => void, inUrl?: boolean) {
  const settings = syncSettings();
  if (!settings || socket) return;
  try {
    const { url, token } = await sessionFor(settings).live();
    const legacy = inUrl ?? tokenInUrl.has(settings.server);
    socket = legacy ? new WebSocket(`${url}?token=${encodeURIComponent(token)}`) : new HeaderSocket(url, null, { headers: { authorization: `Bearer ${token}` } });
    // A socket opens before the server has checked the token (it closes one it refuses with 4401 right after), so a
    // server counts as URL-only once the socket with the token in the URL has stayed open for a while. Otherwise a
    // stale token, refused either way, would mark a current server as URL-only.
    socket.onopen = () => {
      attempts = 0;
      if (legacy) confirm = setTimeout(() => tokenInUrl.add(settings.server), URL_ONLY_AFTER_MS);
    };
    socket.onmessage = onNotify;
    socket.onclose = (e) => {
      if (confirm) clearTimeout(confirm);
      confirm = null;
      socket = null;
      if (e.code === 4401 && !legacy) return void openLive(onNotify, true);
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
  if (confirm) clearTimeout(confirm);
  confirm = null;
  const s = socket;
  socket = null;
  if (s) {
    s.onclose = null;
    s.close();
  }
}
