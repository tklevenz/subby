import type { FastifyInstance } from 'fastify';

/** A token bucket: up to `burst` requests at once, refilled at `perMinute`. */
export type Limit = { burst: number; perMinute: number };

/**
 * Per-client request limits, in memory (one server instance, like auth challenges and live sockets).
 * Keyed by rule and client IP: behind a reverse proxy, set TRUST_PROXY so the IP is the client's, not the proxy's.
 * Generous enough for a family behind one home router; meant to stop scripts, not people.
 */
export const RULES: { name: string; method: string; path: RegExp; limit: Limit }[] = [
  // Unauthenticated, and each one costs a signature check or a database write.
  { name: 'auth', method: 'POST', path: /^\/v1\/auth\/(challenge|verify)$/, limit: { burst: 30, perMinute: 30 } },
  { name: 'family', method: 'POST', path: /^\/v1\/families$/, limit: { burst: 10, perMinute: 10 / 60 } },
  { name: 'invite', method: 'POST', path: /^\/v1\/invites$/, limit: { burst: 20, perMinute: 20 / 60 } },
  { name: 'claim', method: 'POST', path: /^\/v1\/invites\/[^/]+\/claim$/, limit: { burst: 10, perMinute: 10 } },
  // The joining phone polls every 2 s.
  { name: 'inviteStatus', method: 'POST', path: /^\/v1\/invites\/[^/]+\/status$/, limit: { burst: 60, perMinute: 60 } },
  // A first sync uploads every photo at once, one request each.
  { name: 'blob', method: 'PUT', path: /^\/v1\/blobs\/[^/]+$/, limit: { burst: 300, perMinute: 120 } },
  // Each one is checked with the store.
  { name: 'purchase', method: 'POST', path: /^\/v1\/purchases$/, limit: { burst: 30, perMinute: 30 / 60 } },
  { name: 'pushToken', method: 'PUT', path: /^\/v1\/push\/token$/, limit: { burst: 20, perMinute: 20 / 60 } },
];
/** Everything else (sync push and pull pages, keys, the log, blob downloads). */
export const DEFAULT_LIMIT: Limit = { burst: 600, perMinute: 600 };

export function ruleFor(method: string, url: string): { name: string; limit: Limit } {
  const path = url.split('?')[0];
  return RULES.find((r) => r.method === method && r.path.test(path)) ?? { name: 'default', limit: DEFAULT_LIMIT };
}

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

/** Answers 429 with Retry-After once a client is over its limit. */
export function installRateLimits(fastify: FastifyInstance, limiter = new RateLimiter()) {
  fastify.addHook('onRequest', async (request, reply) => {
    const { name, limit } = ruleFor(request.method, request.url);
    const wait = limiter.take(`${name}:${request.ip}`, limit);
    if (!wait) return;
    await reply
      .code(429)
      .header('retry-after', String(wait))
      .send({ statusCode: 429, message: 'Too many requests, try again later' });
  });
}
