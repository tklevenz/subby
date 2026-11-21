import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/auth/auth.service';
import { DEFAULT_LIMIT, DEVICE_LIMIT, RULES, RateLimiter, clientKey, installDeviceLimits, installRateLimits, perRule, ruleFor } from '../src/common/rateLimit';

describe('rate limits', () => {
  it('allows a burst, then refills at the given rate', () => {
    const limiter = new RateLimiter();
    const limit = { burst: 3, perMinute: 6 }; // one every 10 s
    for (let i = 0; i < 3; i++) expect(limiter.take('a', limit, 0)).toBe(0);
    expect(limiter.take('a', limit, 0)).toBe(10);
    expect(limiter.take('a', limit, 5_000)).toBe(5);
    expect(limiter.take('a', limit, 10_000)).toBe(0);
    expect(limiter.take('a', limit, 10_000)).toBeGreaterThan(0);
  });

  it('counts each key on its own', () => {
    const limiter = new RateLimiter();
    const limit = { burst: 1, perMinute: 1 };
    expect(limiter.take('a', limit, 0)).toBe(0);
    expect(limiter.take('a', limit, 0)).toBeGreaterThan(0);
    expect(limiter.take('b', limit, 0)).toBe(0);
  });

  it('never refills past the burst', () => {
    const limiter = new RateLimiter();
    const limit = { burst: 2, perMinute: 60 };
    limiter.take('a', limit, 0);
    for (let i = 0; i < 2; i++) expect(limiter.take('a', limit, 3_600_000)).toBe(0);
    expect(limiter.take('a', limit, 3_600_000)).toBeGreaterThan(0);
  });

  it('forgets the least recently used client past its size', () => {
    const limiter = new RateLimiter(2);
    const limit = { burst: 1, perMinute: 1 };
    limiter.take('a', limit, 0);
    limiter.take('b', limit, 0);
    limiter.take('a', limit, 0); // refused, but a is now the most recent
    limiter.take('c', limit, 0);
    expect(limiter.size).toBe(2);
    expect(limiter.take('b', limit, 0)).toBe(0); // b was dropped, so it starts full
    expect(limiter.take('c', limit, 0)).toBeGreaterThan(0);
  });

  it("picks the rule by method and the router's route pattern", () => {
    expect(ruleFor('POST', '/v1/auth/challenge').name).toBe('auth');
    expect(ruleFor('POST', '/v1/auth/verify').name).toBe('auth');
    expect(ruleFor('POST', '/v1/families').name).toBe('family');
    expect(ruleFor('POST', '/v1/families/me/log').name).toBe('log');
    expect(ruleFor('POST', '/v1/families/me/log/restore').name).toBe('logRestore');
    expect(ruleFor('POST', '/v1/keys/rotate').name).toBe('rotate');
    expect(ruleFor('POST', '/v1/sync/push').name).toBe('push');
    expect(ruleFor('POST', '/v1/invites/:id/claim').name).toBe('claim');
    expect(ruleFor('PUT', '/v1/blobs/:id').name).toBe('blob');
    expect(ruleFor('GET', '/v1/blobs/:id').limit).toBe(DEFAULT_LIMIT);
    expect(ruleFor('GET', '/v1/sync/pull').name).toBe('default');
    // A URL no route matched: the default rule.
    expect(ruleFor('POST', undefined).name).toBe('default');
  });

  it('keys IPv4 clients by address and IPv6 clients by their /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('2001:db8:1:2::1', 48)).toBe('2001:db8:1::/48');
    expect(clientKey('2001:db8:1:2:3::')).toBe('2001:db8:1:2::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(clientKey('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64');
  });

  it('counts each phone on its own, whatever its IP', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (request: FastifyRequest & { auth?: AuthContext }) => {
      const device = request.headers['x-device'];
      if (typeof device === 'string') request.auth = { familyId: 'f', deviceId: device };
    });
    installDeviceLimits(app);
    app.get('/', async () => 'ok');
    const get = (device?: string) => app.inject({ url: '/', headers: { ...(device ? { 'x-device': device } : {}), 'x-forwarded-for': String(Math.random()) } });
    for (let i = 0; i < DEVICE_LIMIT.burst; i++) expect((await get('a')).statusCode).toBe(200);
    const refused = await get('a');
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await get('b')).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    await app.close();
  });
});

describe('per-IP rules', () => {
  const serve = async (ip: () => string) => {
    const app = Fastify({ trustProxy: false });
    app.addHook('onRequest', async (request) => {
      Object.defineProperty(request, 'ip', { value: ip() });
    });
    installRateLimits(app, perRule(4));
    app.post('/v1/families', async () => ({ ok: true }));
    app.get('/v1/sync/pull', async () => ({ ok: true }));
    await app.ready();
    return app;
  };

  it("keep their own buckets: a flood elsewhere doesn't evict them", async () => {
    let n = 0;
    let ip = '203.0.113.7';
    const app = await serve(() => ip);
    const family = RULES.find((r) => r.name === 'family')!.limit.burst;
    for (let i = 0; i < family; i++) expect((await app.inject({ method: 'POST', url: '/v1/families' })).statusCode).toBe(200);
    // Many clients on the default rule, more than a limiter keeps.
    for (; n < 20; n++) {
      ip = `198.51.100.${n}`;
      await app.inject({ method: 'GET', url: '/v1/sync/pull' });
    }
    ip = '203.0.113.7';
    expect((await app.inject({ method: 'POST', url: '/v1/families' })).statusCode).toBe(429);
    await app.close();
  });

  it('limit creating families per IPv6 /48 too, not only per /64', async () => {
    let n = 0;
    const app = await serve(() => `2001:db8:1:${(n++).toString(16)}::1`);
    const family = RULES.find((r) => r.name === 'family')!.limit.burst;
    const codes: number[] = [];
    for (let i = 0; i < family * 4 + 1; i++) codes.push((await app.inject({ method: 'POST', url: '/v1/families' })).statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(family * 4);
    expect(codes.at(-1)).toBe(429);
    await app.close();
  });
});
