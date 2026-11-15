import type { FastifyInstance } from 'fastify';
import type { GatedRequest } from '../common/bodyGate';
import type { Metrics } from '../common/metrics';

/**
 * Photo transfers at once. An upload is held in memory whole until it's stored (up to 20 MB), and a client sending
 * or reading slowly keeps its transfer open, so these are bounded per phone, per family and for the whole server
 * (production is a 1 GB machine). The app transfers one photo at a time.
 */
export const BLOB_TRANSFERS_PER_DEVICE = 2;
/** A family's phones together: one family can't hold the server's slots (it would take several). */
export const BLOB_TRANSFERS_PER_FAMILY = 3;
export const BLOB_UPLOADS_AT_ONCE = 8;
/** Downloads are streamed, so they hold little memory each. */
export const BLOB_DOWNLOADS_AT_ONCE = 32;
/**
 * A transfer moving less than `bytes` in `ms` (while the body comes in, or the photo goes out) is cut off, so a client
 * that stalls or trickles can't keep its slot (the server's request timeout is 5 minutes). 16 KB in 10 s is 1.6 KB/s.
 */
export const BLOB_STALL = { ms: 10_000, bytes: 16 * 1024 };

type Kind = 'upload' | 'download';
type Limits = { perDevice: number; perFamily: number; upload: number; download: number };

export class TransferSlots {
  private readonly held = new Map<string, number>();
  private readonly running: Record<Kind, number> = { upload: 0, download: 0 };

  constructor(
    private readonly limits: Limits = {
      perDevice: BLOB_TRANSFERS_PER_DEVICE,
      perFamily: BLOB_TRANSFERS_PER_FAMILY,
      upload: BLOB_UPLOADS_AT_ONCE,
      download: BLOB_DOWNLOADS_AT_ONCE,
    },
  ) {}

  /** A slot for a transfer of `familyId`'s `deviceId` and its release, or why there's none. */
  take(familyId: string, deviceId: string, kind: Kind): (() => void) | 'device' | 'family' | 'server' {
    const device = `d:${familyId}/${deviceId}`;
    const family = `f:${familyId}`;
    if ((this.held.get(device) ?? 0) >= this.limits.perDevice) return 'device';
    if ((this.held.get(family) ?? 0) >= this.limits.perFamily) return 'family';
    if (this.running[kind] >= this.limits[kind]) return 'server';
    for (const k of [device, family]) this.held.set(k, (this.held.get(k) ?? 0) + 1);
    this.running[kind]++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running[kind]--;
      for (const k of [device, family]) {
        const left = (this.held.get(k) ?? 1) - 1;
        if (left > 0) this.held.set(k, left);
        else this.held.delete(k);
      }
    };
  }

  /** Transfers running now, for tests. */
  get size() {
    return this.running.upload + this.running.download;
  }
}

const BUSY = {
  device: { retryAfter: '2', message: 'Too many photo transfers from this phone at once' },
  family: { retryAfter: '2', message: "Too many photo transfers from this family's phones at once" },
  server: { retryAfter: '5', message: 'Too many photo transfers at once, try again shortly' },
} as const;

/**
 * Takes a slot for each photo upload or download in onRequest, after the session is known and before the body is
 * read; a request without one gets a 429 with Retry-After. The slot is given back when the response closes (sent, or
 * the client went away), and a transfer that stalls is cut off (`BLOB_STALL`).
 */
export function installBlobTransferLimits(fastify: FastifyInstance, metrics: Metrics, slots = new TransferSlots(), stall = BLOB_STALL) {
  fastify.addHook('onRequest', async (request: GatedRequest, reply) => {
    if (request.routeOptions.url !== '/v1/blobs/:id' || !request.auth) return;
    const kind = request.method === 'PUT' ? 'upload' : request.method === 'GET' ? 'download' : null;
    if (!kind) return;
    // The client may have gone while its session was looked up: then `close` has fired already and wouldn't again.
    if (reply.raw.closed || reply.raw.destroyed) return;
    const slot = slots.take(request.auth.familyId, request.auth.deviceId, kind);
    if (typeof slot === 'function') {
      const socket = request.raw.socket;
      let moved = socket.bytesRead + socket.bytesWritten;
      // Watched while bytes should flow: the body coming in, or the photo going out (not while it's stored or looked up).
      const watch = setInterval(() => {
        const now = socket.bytesRead + socket.bytesWritten;
        const flowing = kind === 'upload' ? !request.raw.complete : reply.raw.headersSent;
        if (flowing && now - moved < stall.bytes) {
          metrics.count('blob_stalled');
          socket.destroy();
        }
        moved = now;
      }, stall.ms);
      watch.unref();
      reply.raw.once('close', () => {
        clearInterval(watch);
        slot();
      });
      return;
    }
    metrics.count(`blob_busy_${slot}`);
    // 429 either way: a full server is not an error, and 5xx would set off the monitor's alert.
    await reply.code(429).header('retry-after', BUSY[slot].retryAfter).send({ statusCode: 429, message: BUSY[slot].message });
  });
  return slots;
}
