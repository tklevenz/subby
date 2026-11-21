import { Transform } from 'node:stream';
import { PayloadTooLargeException } from '@nestjs/common';
import { MAX_BLOB_BYTES, MAX_REQUEST_BYTES } from '@subby/shared/sync';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService, AuthContext } from '../auth/auth.service';
import { bearer } from '../auth/auth.guard';
import { BLOB_STALL } from '../blobs/transfers';

/**
 * The routes that take a body without a session, by method and the router's route pattern (never the URL, which
 * the router reads its own way: see `rateLimit.ts`). Each has its own credential in the body (a self-signed entry,
 * a claim key, a challenge signature, Apple's signature), and none needs more than a few kilobytes.
 */
const OPEN_ROUTES = new Set([
  'POST /v1/auth/challenge',
  'POST /v1/auth/verify',
  'POST /v1/families',
  'POST /v1/invites/:id/claim',
  'POST /v1/invites/:id/status',
  'POST /v1/purchases/apple/notifications',
]);
/** Bodies on those routes: far above what they carry (an Apple notification is the largest, ~10 KB). */
export const OPEN_BODY_LIMIT = 64 * 1024;

/**
 * Member routes that take more than OPEN_BODY_LIMIT: a push (a first upload of a long history), a photo, giving back
 * a lost log, and sealing every epoch's key to every member. Every other member route takes OPEN_BODY_LIMIT too.
 */
const LARGE_ROUTES = new Map([
  ['POST /v1/sync/push', MAX_REQUEST_BYTES],
  ['PUT /v1/blobs/:id', MAX_BLOB_BYTES + 1],
  ['POST /v1/families/me/log/restore', 2 * 1024 * 1024],
  ['POST /v1/keys/grant', 1024 * 1024],
  ['POST /v1/keys/rotate', 1024 * 1024],
]);
/** Only photos arrive as raw bytes. */
const RAW_ROUTE = 'PUT /v1/blobs/:id';

/**
 * Large bodies held in memory at once (photos have their own slots, `transfers.ts`): per phone, and for the whole
 * server by their declared size (a chunked one counts as its route's limit), so a few slow 16 MB pushes can't run the
 * server out of memory (production gives Node 320 MB). The app pushes one batch at a time.
 */
export const LARGE_BODIES_PER_DEVICE = 2;
export const LARGE_BODY_BUDGET = 64 * 1024 * 1024;

const routeOf = (request: FastifyRequest) => `${request.method} ${request.routeOptions.url}`;
/** The most this request's body may be. */
const limitOf = (request: FastifyRequest) => (request.routeOptions.url === undefined ? OPEN_BODY_LIMIT : (LARGE_ROUTES.get(routeOf(request)) ?? OPEN_BODY_LIMIT));

/** A request no route matches is never open. */
const isOpen = (request: FastifyRequest) => request.routeOptions.url !== undefined && OPEN_ROUTES.has(`${request.method} ${request.routeOptions.url}`);

/** Requests that never carry a body here. Fastify still reads one on OPTIONS, so it's refused before. */
const BODILESS = new Set(['GET', 'HEAD', 'OPTIONS']);
const hasBody = (request: FastifyRequest) => Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined;
const declaredLength = (request: FastifyRequest) => (request.headers['content-length'] === undefined ? null : Number(request.headers['content-length']));

// Nest's own exception: its error handler answers anything else with a 500.
const tooLarge = () => new PayloadTooLargeException('Request body is too large');

/** What the gate found, for the route's guard (so the session is looked up once). */
export type GatedRequest = FastifyRequest & { auth?: AuthContext };

/**
 * Refuses a body before reading it unless the request may send one: anything but the open routes needs a valid
 * session first, every route takes at most its limit (OPEN_BODY_LIMIT unless it's one of LARGE_ROUTES; raw bytes only
 * for photos), large bodies in flight are limited (`LARGE_BODY_BUDGET`), and GET, HEAD and OPTIONS take none. Without
 * this, anyone could make the server read and parse 16 MB per request (a session only takes creating a family). It also looks up the session of any request that brings a token, once, for the per-phone
 * limits and the route's guard, which still decides what the session may do.
 */
export function installBodyGate(
  fastify: FastifyInstance,
  auth: AuthService,
  budget = { perDevice: LARGE_BODIES_PER_DEVICE, bytes: LARGE_BODY_BUDGET },
  stall = BLOB_STALL,
) {
  const inFlight = new Map<string, number>();
  let bytesInFlight = 0;
  fastify.addHook('onRequest', async (request: GatedRequest, reply) => {
    const bodiless = BODILESS.has(request.method);
    if (bodiless && hasBody(request)) {
      await reply.code(400).send({ statusCode: 400, message: `${request.method} requests take no body` });
      return;
    }
    const limit = limitOf(request);
    const declared = declaredLength(request);
    if (!bodiless && declared !== null && declared > limit) {
      await reply.code(413).send({ statusCode: 413, message: tooLarge().message });
      return;
    }
    if (!bodiless && hasBody(request) && /^application\/octet-stream/i.test(request.headers['content-type'] ?? '') && routeOf(request) !== RAW_ROUTE) {
      await reply.code(415).send({ statusCode: 415, message: 'This route takes JSON' });
      return;
    }
    if (isOpen(request)) return;
    const token = bearer(request.headers.authorization);
    const session = token ? await auth.authenticate(token) : null;
    if (!session && !bodiless) {
      await reply.code(401).send({ statusCode: 401, message: 'Unauthorized' });
      return;
    }
    if (!session) return;
    request.auth = session;

    // A large body (not a photo: those have their slots) holds part of the budget until its response closes.
    if (bodiless || limit <= OPEN_BODY_LIMIT || routeOf(request) === RAW_ROUTE || !hasBody(request)) return;
    if (declared !== null && declared <= OPEN_BODY_LIMIT) return; // small, whatever the route
    if (reply.raw.closed || reply.raw.destroyed) return;
    const device = `${session.familyId}/${session.deviceId}`;
    const size = declared ?? limit;
    if ((inFlight.get(device) ?? 0) >= budget.perDevice || bytesInFlight + size > budget.bytes) {
      await reply.code(429).header('retry-after', '2').send({ statusCode: 429, message: 'Too many large requests at once, try again shortly' });
      return;
    }
    inFlight.set(device, (inFlight.get(device) ?? 0) + 1);
    bytesInFlight += size;
    // A body that trickles in is cut off, as photos are (`BLOB_STALL`): it can't hold the budget for the whole
    // request timeout.
    const socket = request.raw.socket;
    let read = socket.bytesRead;
    const watch = setInterval(() => {
      if (!request.raw.complete && socket.bytesRead - read < stall.bytes) socket.destroy();
      read = socket.bytesRead;
    }, stall.ms);
    watch.unref();
    reply.raw.once('close', () => {
      clearInterval(watch);
      bytesInFlight -= size;
      const left = (inFlight.get(device) ?? 1) - 1;
      if (left > 0) inFlight.set(device, left);
      else inFlight.delete(device);
    });
  });
  // A body sent without a length (chunked), or longer than it said, is counted as it arrives.
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    const limit = limitOf(request);
    let received = 0;
    return payload.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          done(received > limit ? tooLarge() : null, chunk);
        },
      }),
    );
  });
}
