import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./state', () => ({
  syncSettings: () => ({ server: 'https://sync.example.com' }),
  sessionFor: () => ({ live: async () => ({ url: 'wss://sync.example.com/v1/live', token: 'tok' }) }),
}));

/** A WebSocket that records how it was opened; the test opens and closes it as the server would. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(
    readonly url: string,
    _protocols?: unknown,
    readonly options?: { headers?: Record<string, string> },
  ) {
    FakeSocket.all.push(this);
  }
  close() {}
}
vi.stubGlobal('WebSocket', FakeSocket);

const { closeLive, openLive } = await import('./live');
const settle = () => new Promise((r) => setTimeout(r, 0));
const last = () => FakeSocket.all.at(-1)!;

describe('the live socket', () => {
  afterEach(() => {
    closeLive();
    FakeSocket.all = [];
  });

  it('sends the token in a header, and keeps doing so after a token refused either way', async () => {
    await openLive(() => {});
    expect(last().url).not.toContain('token=');
    expect(last().options?.headers?.authorization).toBe('Bearer tok');
    // A stale token: the server accepts the upgrade, then closes with 4401. The app tries once with it in the URL,
    // which the server refuses the same way.
    last().onopen!();
    last().onclose!({ code: 4401 });
    await settle();
    expect(last().url).toContain('?token=tok');
    last().onopen!();
    last().onclose!({ code: 4401 });
    await settle();
    // With a new token, the header again: the server never said it only reads the URL.
    await openLive(() => {});
    expect(last().url).not.toContain('token=');
  });

  it('remembers a server that only reads the token from the URL', async () => {
    vi.useFakeTimers();
    try {
      await openLive(() => {});
      last().onopen!();
      last().onclose!({ code: 4401 });
      await vi.advanceTimersByTimeAsync(0);
      expect(last().url).toContain('?token=tok');
      last().onopen!();
      // Still open after a while: this server took the token from the URL.
      await vi.advanceTimersByTimeAsync(10_000);
      last().onclose!({ code: 1006 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(last().url).toContain('?token=tok');
    } finally {
      vi.useRealTimers();
    }
  });
});
