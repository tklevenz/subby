import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT, RateLimiter, ruleFor } from '../src/common/rateLimit';

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

  it('picks the rule by method and path, ignoring the query', () => {
    expect(ruleFor('POST', '/v1/auth/challenge').name).toBe('auth');
    expect(ruleFor('POST', '/v1/auth/verify').name).toBe('auth');
    expect(ruleFor('POST', '/v1/families').name).toBe('family');
    expect(ruleFor('POST', '/v1/families/me/log').name).toBe('default');
    expect(ruleFor('POST', '/v1/invites/abc/claim').name).toBe('claim');
    expect(ruleFor('PUT', '/v1/blobs/abc').name).toBe('blob');
    expect(ruleFor('GET', '/v1/blobs/abc').limit).toBe(DEFAULT_LIMIT);
    expect(ruleFor('GET', '/v1/sync/pull?since=5').name).toBe('default');
  });
});
