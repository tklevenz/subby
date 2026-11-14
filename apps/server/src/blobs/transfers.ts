import type { FastifyInstance } from 'fastify';
import type { GatedRequest } from '../common/bodyGate';
import type { Metrics } from '../common/metrics';

/**
 * Photo transfers at once. An upload is held in memory whole until it's stored (up to 20 MB), and a client sending
 * or reading slowly keeps its transfer open, so these are bounded per phone and for the whole server (production is a
 * 1 GB machine). The app transfers one photo at a time.
 */
export const BLOB_TRANSFERS_PER_DEVICE = 4;
export const BLOB_UPLOADS_AT_ONCE = 8;
/** Downloads are streamed, so they hold little memory each. */
export const BLOB_DOWNLOADS_AT_ONCE = 32;

type Kind = 'upload' | 'download';

export class TransferSlots {
  private readonly perDevice = new Map<string, number>();
  private readonly running: Record<Kind, number> = { upload: 0, download: 0 };

  constructor(
    private readonly limits = { perDevice: BLOB_TRANSFERS_PER_DEVICE, upload: BLOB_UPLOADS_AT_ONCE, download: BLOB_DOWNLOADS_AT_ONCE },
  ) {}

  /** A slot for `device`'s transfer and its release, or why there's none. */
  take(device: string, kind: Kind): (() => void) | 'device' | 'server' {
    const mine = this.perDevice.get(device) ?? 0;
    if (mine >= this.limits.perDevice) return 'device';
    if (this.running[kind] >= this.limits[kind]) return 'server';
    this.perDevice.set(device, mine + 1);
    this.running[kind]++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running[kind]--;
      const left = (this.perDevice.get(device) ?? 1) - 1;
      if (left > 0) this.perDevice.set(device, left);
      else this.perDevice.delete(device);
    };
  }

  /** Transfers running now, for tests. */
  get size() {
    return this.running.upload + this.running.download;
  }
}

/**
 * Takes a slot for each photo upload or download in onRequest, after the session is known and before the body is
 * read; a request without one gets a 429 with Retry-After. The slot is given back when the response closes (sent, or
 * the client went away).
 */
export function installBlobTransferLimits(fastify: FastifyInstance, metrics: Metrics, slots = new TransferSlots()) {
  fastify.addHook('onRequest', async (request: GatedRequest, reply) => {
    if (request.routeOptions.url !== '/v1/blobs/:id' || !request.auth) return;
    const kind = request.method === 'PUT' ? 'upload' : request.method === 'GET' ? 'download' : null;
    if (!kind) return;
    const slot = slots.take(`${request.auth.familyId}/${request.auth.deviceId}`, kind);
    if (typeof slot === 'function') {
      reply.raw.once('close', slot);
      return;
    }
    metrics.count(slot === 'device' ? 'blob_busy_device' : 'blob_busy_server');
    // 429 either way: a full server is not an error, and 5xx would set off the monitor's alert.
    await reply
      .code(429)
      .header('retry-after', slot === 'device' ? '2' : '5')
      .send({ statusCode: 429, message: slot === 'device' ? 'Too many photo transfers from this phone at once' : 'Too many photo transfers at once, try again shortly' });
  });
  return slots;
}
