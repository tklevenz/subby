import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '../auth/auth.service';

/** A token bucket: up to `burst` requests at once, refilled at `perMinute`. */
export type Limit = { burst: number; perMinute: number };

/**
 * Per-client request limits, in memory (one server instance, like auth challenges and live sockets).
 * Keyed by rule and client (`clientKey`): behind a reverse proxy, set TRUST_PROXY so the IP is the client's, not the
 * proxy's. Generous enough for a family behind one home router; meant to stop scripts, not people.
 *
 * Rules name the router's route pattern, not the URL: the router reads URLs its own way (it stops at `#` and `;`
 * and decodes percent-escapes), and parsing them again here let `/v1/families#x` past the family limit.
 */
export const RULES: { name: string; method: string; route: string; limit: Limit }[] = [
  // Unauthenticated, and each one costs a signature check or a database write.
  { name: 'auth', method: 'POST', route: '/v1/auth/challenge', limit: { burst: 30, perMinute: 30 } },
  { name: 'auth', method: 'POST', route: '/v1/auth/verify', limit: { burst: 30, perMinute: 30 } },
  { name: 'family', method: 'POST', route: '/v1/families', limit: { burst: 10, perMinute: 10 / 60 } },
  // The device log: each entry is checked and kept for good. A move or a recovery appends one per phone.
  { name: 'log', method: 'POST', route: '/v1/families/me/log', limit: { burst: 60, perMinute: 20 } },
  // Only after the server was restored from a backup.
  { name: 'logRestore', method: 'POST', route: '/v1/families/me/log/restore', limit: { burst: 5, perMinute: 1 } },
  // After a removal (retried up to three times when another phone pushed in between).
  { name: 'rotate', method: 'POST', route: '/v1/keys/rotate', limit: { burst: 10, perMinute: 2 } },
  { name: 'invite', method: 'POST', route: '/v1/invites', limit: { burst: 20, perMinute: 20 / 60 } },
  { name: 'claim', method: 'POST', route: '/v1/invites/:id/claim', limit: { burst: 10, perMinute: 10 } },
  // The joining phone polls every 2 s.
  { name: 'inviteStatus', method: 'POST', route: '/v1/invites/:id/status', limit: { burst: 60, perMinute: 60 } },
  // A first sync uploads every photo, one request each.
  { name: 'blob', method: 'PUT', route: '/v1/blobs/:id', limit: { burst: 300, perMinute: 120 } },
  // Up to 16 MB each. A first upload of a long history is a few dozen.
  { name: 'push', method: 'POST', route: '/v1/sync/push', limit: { burst: 200, perMinute: 60 } },
  // Each one is checked with the store.
  { name: 'purchase', method: 'POST', route: '/v1/purchases', limit: { burst: 30, perMinute: 30 / 60 } },
  { name: 'pushToken', method: 'PUT', route: '/v1/push/token', limit: { burst: 20, perMinute: 20 / 60 } },
];
/** Everything else (sync pull pages, keys, blob downloads), and requests no route matches. */
export const DEFAULT_LIMIT: Limit = { burst: 600, perMinute: 600 };
/** Every request of one phone, whatever its IP (on top of the per-IP rules). */
export const DEVICE_LIMIT: Limit = { burst: 600, perMinute: 600 };

/** The rule for a request, by its method and the route the router matched (undefined: no route). */
export function ruleFor(method: string, route: string | undefined): { name: string; limit: Limit } {
  return (route !== undefined && RULES.find((r) => r.method === method && r.route === route)) || { name: 'default', limit: DEFAULT_LIMIT };
}

/**
 * Whom a bucket belongs to: an IPv4 address as is, an IPv6 address by its /64. A home or mobile network gets a
 * whole /64, so a client can pick any address in it.
 */
export function clientKey(ip: string, prefix: 64 | 48 = 64): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!ip.includes(':')) return ip;
  const address = ip.split('%')[0]!; // without a zone (fe80::1%en0)
  const groups = (part: string) => (part ? part.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g])) : []);
  const [head, tail] = address.split('::') as [string, string | undefined];
  const h = groups(head);
  const all = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - groups(tail).length)).fill('0'), ...groups(tail)];
  return `${all
    .slice(0, prefix / 16)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/${prefix}`;
}

/** Opening a live socket (`/v1/live`): an app keeps one, reconnecting when it comes back or changes networks. */
export const LIVE_LIMIT: Limit = { burst: 30, perMinute: 30 };

/** Bounded: past `maxKeys`, the least recently used client is forgotten (it starts again with a full bucket). */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly maxKeys = 100_000) {}

  /** Takes one request from `key`'s bucket. Returns 0 if allowed, else the seconds until one is free. */
  take(key: string, { burst, perMinute }: Limit, now = Date.now()): number {
    const perMs = perMinute / 60_000;
    const prev = this.buckets.get(key);
    const tokens = prev ? Math.min(burst, prev.tokens + (now - prev.at) * perMs) : burst;
    // Delete and set again, so the Map's order is least recently used first.
    this.buckets.delete(key);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: now });
      return Math.max(1, Math.ceil((1 - tokens) / perMs / 1000));
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return 0;
  }

  get size() {
    return this.buckets.size;
  }
}

const tooMany = (reply: FastifyReply, wait: number) =>
  reply.code(429).header('retry-after', String(wait)).send({ statusCode: 429, message: 'Too many requests, try again later' });

/**
 * The open routes that create something or check a secret: also limited per IPv6 /48 (a site's whole allocation, so
 * a VPS can't spread over its 65,536 /64s), at this many times the rule.
 */
const WIDE_RULES = new Set(['auth', 'family', 'claim']);
const WIDE_FACTOR = 4;

/**
 * Answers 429 with Retry-After once a client is over its limit. Runs first, before any database lookup. Each rule
 * has its own limiter, so clients flooding one rule (or the default) can't push others' buckets out of memory.
 */
export function installRateLimits(fastify: FastifyInstance, limiterFor: (rule: string) => RateLimiter = perRule()) {
  fastify.addHook('onRequest', async (request, reply) => {
    const { name, limit } = ruleFor(request.method, request.routeOptions.url);
    const limiter = limiterFor(name);
    let wait = limiter.take(clientKey(request.ip), limit);
    if (!wait && WIDE_RULES.has(name) && request.ip.includes(':') && !clientKey(request.ip).includes('.')) {
      wait = limiter.take(clientKey(request.ip, 48), { burst: limit.burst * WIDE_FACTOR, perMinute: limit.perMinute * WIDE_FACTOR });
    }
    if (wait) await tooMany(reply, wait);
  });
}

/** A limiter per rule name, made on first use. */
export function perRule(maxKeys?: number): (rule: string) => RateLimiter {
  const limiters = new Map<string, RateLimiter>();
  return (rule) => {
    let limiter = limiters.get(rule);
    if (!limiter) limiters.set(rule, (limiter = new RateLimiter(maxKeys)));
    return limiter;
  };
}

/**
 * The per-phone limit, once the session is known (after the body gate looked it up), so a phone spreading its
 * requests over many addresses is still counted as one.
 */
export function installDeviceLimits(fastify: FastifyInstance, limiter = new RateLimiter()) {
  fastify.addHook('onRequest', async (request: FastifyRequest & { auth?: AuthContext }, reply) => {
    if (!request.auth) return;
    const wait = limiter.take(`device:${request.auth.familyId}/${request.auth.deviceId}`, DEVICE_LIMIT);
    if (wait) await tooMany(reply, wait);
  });
}
