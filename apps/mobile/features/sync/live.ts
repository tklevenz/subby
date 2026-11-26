import type { LiveMessage } from '@subby/shared/sync';
import { LIVE_HEARTBEAT_MS } from '@subby/shared/sync';
import { sessionFor, syncSettings } from './state';

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let confirm: ReturnType<typeof setTimeout> | null = null;
/** Counts up on every close, so an open still waiting for its token gives up when the app left meanwhile. */
let generation = 0;
let opening = false;
/** The socket went away while the app was open: changes may have been missed, so sync once it's back. */
let missed = false;

/**
 * A socket the server dropped can look open for ever: React Native's Android WebSocket has no read timeout and
 * answers the server's pings without telling JS. Servers that send heartbeats (`LIVE_HEARTBEAT_MS`) let the app
 * notice: no message for this long and the socket is replaced. Servers without them (older) are trusted as before.
 */
const STALE_AFTER_MS = LIVE_HEARTBEAT_MS * 2.5;
let watchdog: ReturnType<typeof setTimeout> | null = null;

function stopWatchdog() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

function scheduleRetry(onNotify: () => void) {
  missed = true;
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
  if (!settings || socket || opening) return;
  const gen = generation;
  opening = true;
  try {
    const { url, token } = await sessionFor(settings).live();
    if (gen !== generation) return; // the app left while the token was fetched
    const legacy = inUrl ?? tokenInUrl.has(settings.server);
    const ws = legacy ? new WebSocket(`${url}?token=${encodeURIComponent(token)}`) : new HeaderSocket(url, null, { headers: { authorization: `Bearer ${token}` } });
    socket = ws;
    // A socket opens before the server has checked the token (it closes one it refuses with 4401 right after), so a
    // server counts as URL-only once the socket with the token in the URL has stayed open for a while. Otherwise a
    // stale token, refused either way, would mark a current server as URL-only.
    ws.onopen = () => {
      attempts = 0;
      if (legacy) confirm = setTimeout(() => tokenInUrl.add(settings.server), URL_ONLY_AFTER_MS);
      if (missed) {
        missed = false;
        onNotify();
      }
    };
    ws.onmessage = (m: { data?: unknown }) => {
      let message: Partial<LiveMessage> | null = null;
      try {
        message = JSON.parse(String(m.data)) as Partial<LiveMessage>;
      } catch {
        // Not JSON: treat it like any other change notice.
      }
      // Heard from the server: the socket is alive. Watched only once the server has shown it sends heartbeats.
      if (message?.type === 'ping' || watchdog) {
        stopWatchdog();
        watchdog = setTimeout(() => {
          if (socket !== ws) return;
          drop();
          missed = true;
          attempts = 0;
          void openLive(onNotify);
        }, STALE_AFTER_MS);
      }
      if (message?.type === 'ping') return;
      onNotify();
    };
    ws.onclose = (e) => {
      if (socket !== ws) return;
      if (confirm) clearTimeout(confirm);
      confirm = null;
      stopWatchdog();
      socket = null;
      if (e.code === 4401 && !legacy) return void openLive(onNotify, true);
      if (e.code === 4401 || !syncSettings()) return;
      // Reconnect with backoff (phones lose connections all the time).
      scheduleRetry(onNotify);
    };
  } catch (e) {
    if (gen !== generation) return;
    scheduleRetry(onNotify);
  } finally {
    opening = false;
  }
}

/** Closes the current socket without the reconnect its own close would start. */
function drop() {
  if (confirm) clearTimeout(confirm);
  confirm = null;
  stopWatchdog();
  const s = socket;
  socket = null;
  if (s) {
    s.onclose = null;
    s.close();
  }
}

export function closeLive() {
  generation++;
  if (retry) clearTimeout(retry);
  retry = null;
  missed = false; // coming back to the foreground syncs anyway
  drop();
}
