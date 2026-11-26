import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./state', () => ({
  syncSettings: () => ({ server: 'https://sync.example.com' }),
  sessionFor: () => ({ live: async () => ({ url: 'wss://sync.example.com/v1/live', token: 'tok' }) }),
}));

/** A WebSocket that records how it was opened; the test opens and closes it as the server would. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(
    readonly url: string,
    _protocols?: unknown,
    readonly options?: { headers?: Record<string, string> },
  ) {
    FakeSocket.all.push(this);
  }
  closed = false;
  close() {
    this.closed = true;
  }
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

  describe('heartbeats', () => {
    const ping = () => last().onmessage!({ data: JSON.stringify({ type: 'ping' }) });

    it("syncs on changes, not on heartbeats", async () => {
      const notify = vi.fn();
      await openLive(notify);
      last().onopen!();
      ping();
      expect(notify).not.toHaveBeenCalled();
      last().onmessage!({ data: JSON.stringify({ type: 'seq', seq: 5 }) });
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('replaces a socket that went quiet after heartbeats, and syncs once the new one is open', async () => {
      vi.useFakeTimers();
      try {
        const notify = vi.fn();
        await openLive(notify);
        const first = last();
        first.onopen!();
        ping();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeSocket.all).toHaveLength(1); // still within the allowance
        ping();
        await vi.advanceTimersByTimeAsync(80_000);
        expect(first.closed).toBe(true);
        expect(FakeSocket.all).toHaveLength(2);
        expect(notify).not.toHaveBeenCalled();
        last().onopen!();
        expect(notify).toHaveBeenCalledTimes(1); // whatever the dead socket missed
      } finally {
        vi.useRealTimers();
      }
    });

    it('trusts a quiet socket on a server without heartbeats (older)', async () => {
      vi.useFakeTimers();
      try {
        await openLive(() => {});
        last().onopen!();
        last().onmessage!({ data: JSON.stringify({ type: 'seq', seq: 1 }) });
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(FakeSocket.all).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('syncs after reconnecting from a dropped socket', async () => {
      vi.useFakeTimers();
      try {
        const notify = vi.fn();
        await openLive(notify);
        last().onopen!();
        last().onclose!({ code: 1006 });
        await vi.advanceTimersByTimeAsync(2000);
        expect(FakeSocket.all).toHaveLength(2);
        last().onopen!();
        expect(notify).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('opens nothing when the app left while the token was fetched', async () => {
    const opened = openLive(() => {});
    closeLive();
    await opened;
    expect(FakeSocket.all).toHaveLength(0);
  });
});
