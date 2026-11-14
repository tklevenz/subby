import { Transform } from 'node:stream';
import { PayloadTooLargeException } from '@nestjs/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService, AuthContext } from '../auth/auth.service';
import { bearer } from '../auth/auth.guard';

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

/** A request no route matches is never open. */
const isOpen = (request: FastifyRequest) => request.routeOptions.url !== undefined && OPEN_ROUTES.has(`${request.method} ${request.routeOptions.url}`);

/** Requests that never carry a body here. Fastify still reads one on OPTIONS, so it's refused before. */
const BODILESS = new Set(['GET', 'HEAD', 'OPTIONS']);
const hasBody = (request: FastifyRequest) => Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined;

// Nest's own exception: its error handler answers anything else with a 500.
const tooLarge = () => new PayloadTooLargeException('Request body is too large');

/** What the gate found, for the route's guard (so the session is looked up once). */
export type GatedRequest = FastifyRequest & { auth?: AuthContext };

/**
 * Refuses a body before reading it unless the request may send one: anything but the open routes needs a valid
 * session first (the large bodies, sync pushes and photos, come only from members), the open routes take at most
 * OPEN_BODY_LIMIT, and GET, HEAD and OPTIONS take none. Without this, anyone could make the server read and parse
 * 16 MB per request. It also looks up the session of any request that brings a token, once, for the per-phone
 * limits and the route's guard, which still decides what the session may do.
 */
export function installBodyGate(fastify: FastifyInstance, auth: AuthService) {
  fastify.addHook('onRequest', async (request: GatedRequest, reply) => {
    const bodiless = BODILESS.has(request.method);
    if (bodiless && hasBody(request)) {
      await reply.code(400).send({ statusCode: 400, message: `${request.method} requests take no body` });
      return;
    }
    if (isOpen(request)) {
      if (Number(request.headers['content-length'] ?? 0) > OPEN_BODY_LIMIT) await reply.code(413).send({ statusCode: 413, message: tooLarge().message });
      return;
    }
    const token = bearer(request.headers.authorization);
    const session = token ? await auth.authenticate(token) : null;
    if (!session && !bodiless) {
      await reply.code(401).send({ statusCode: 401, message: 'Unauthorized' });
      return;
    }
    if (session) request.auth = session;
  });
  // A body sent without a length (chunked) is counted as it arrives.
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (!isOpen(request)) return payload;
    let received = 0;
    return payload.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          done(received > OPEN_BODY_LIMIT ? tooLarge() : null, chunk);
        },
      }),
    );
  });
}
