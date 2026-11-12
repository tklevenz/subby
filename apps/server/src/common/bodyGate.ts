import { Transform } from 'node:stream';
import { PayloadTooLargeException } from '@nestjs/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService, AuthContext } from '../auth/auth.service';
import { bearer } from '../auth/auth.guard';
import { routedPath } from './rateLimit';

/**
 * The routes that take a body without a session. Each has its own credential in the body (a self-signed entry,
 * a claim key, a challenge signature, Apple's signature), and none needs more than a few kilobytes.
 */
const OPEN_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/v1\/auth\/(challenge|verify)$/ },
  { method: 'POST', path: /^\/v1\/families$/ },
  { method: 'POST', path: /^\/v1\/invites\/[^/]+\/(claim|status)$/ },
  { method: 'POST', path: /^\/v1\/purchases\/apple\/notifications$/ },
];
/** Bodies on those routes: far above what they carry (an Apple notification is the largest, ~10 KB). */
export const OPEN_BODY_LIMIT = 64 * 1024;

const isOpen = (request: FastifyRequest) => {
  const path = routedPath(request.url);
  return OPEN_ROUTES.some((r) => r.method === request.method && r.path.test(path));
};

// Nest's own exception: its error handler answers anything else with a 500.
const tooLarge = () => new PayloadTooLargeException('Request body is too large');

/** What the gate found, for the route's guard (so the session is looked up once). */
export type GatedRequest = FastifyRequest & { auth?: AuthContext };

/**
 * Refuses a body before reading it unless the request may send one: anything but the open routes needs a valid
 * session first (the large bodies, sync pushes and photos, come only from members), and the open routes take at
 * most OPEN_BODY_LIMIT. Without this, anyone could make the server read and parse 16 MB per request.
 * The route's guard still decides what the session may do.
 */
export function installBodyGate(fastify: FastifyInstance, auth: AuthService) {
  fastify.addHook('onRequest', async (request: GatedRequest, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    if (isOpen(request)) {
      if (Number(request.headers['content-length'] ?? 0) > OPEN_BODY_LIMIT) await reply.code(413).send({ statusCode: 413, message: tooLarge().message });
      return;
    }
    const session = await auth.authenticate(bearer(request.headers.authorization));
    if (!session) {
      await reply.code(401).send({ statusCode: 401, message: 'Unauthorized' });
      return;
    }
    request.auth = session;
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
