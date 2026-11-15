import Fastify from 'fastify';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { GatedRequest } from '../src/common/bodyGate';
import { Metrics } from '../src/common/metrics';
import { TransferSlots, installBlobTransferLimits } from '../src/blobs/transfers';

/** The photo transfer limits on a bare Fastify, with a session lookup that takes `lookupMs` (as the body gate's does). */
async function server(lookupMs = 0, stall = { ms: 200, bytes: 1024 }) {
  const app = Fastify();
  app.addHook('onRequest', async (request: GatedRequest) => {
    await new Promise((r) => setTimeout(r, lookupMs));
    request.auth = { familyId: 'f', deviceId: 'd' };
  });
  const slots = installBlobTransferLimits(app, new Metrics(null as never, null as never), new TransferSlots(), stall);
  app.put('/v1/blobs/:id', async (request) => ({ bytes: (request.body as Buffer).length }));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 10_000_000 }, (_r, body, done) => done(null, body));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  return { app, slots, port };
}

const until = async (ok: () => boolean, ms = 3000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
};

const head = (length: number) => `PUT /v1/blobs/x HTTP/1.1\r\nHost: t\r\nContent-Type: application/octet-stream\r\nContent-Length: ${length}\r\n\r\n`;

describe('photo transfer slots', () => {
  let app: Awaited<ReturnType<typeof server>>['app'] | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("aren't kept by a client that left while its session was looked up", async () => {
    const s = await server(150);
    app = s.app;
    for (let i = 0; i < 4; i++) {
      const socket = connect(s.port, '127.0.0.1');
      socket.on('error', () => {});
      socket.write(`${head(100)}ab`);
      setTimeout(() => socket.destroy(), 20);
    }
    await new Promise((r) => setTimeout(r, 400));
    expect(s.slots.size).toBe(0);
  });

  it('are taken back from a transfer that stalls', async () => {
    const s = await server();
    app = s.app;
    const socket = connect(s.port, '127.0.0.1');
    let closed = false;
    socket.on('error', () => {});
    socket.on('close', () => (closed = true));
    socket.write(`${head(1_000_000)}${'x'.repeat(100)}`);
    // A trickle: a few bytes now and then.
    const trickle = setInterval(() => socket.writable && socket.write('x'), 50);
    try {
      await until(() => s.slots.size === 1, 1000);
      expect(s.slots.size).toBe(1);
      await until(() => closed);
      expect(closed).toBe(true);
      expect(s.slots.size).toBe(0);
    } finally {
      clearInterval(trickle);
      socket.destroy();
    }
  });

  it("don't cut off a transfer that keeps moving", async () => {
    const s = await server(0, { ms: 200, bytes: 1024 });
    app = s.app;
    const total = 200_000;
    const res = await fetch(`http://127.0.0.1:${s.port}/v1/blobs/x`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      duplex: 'half',
      body: new ReadableStream({
        async start(c) {
          // 20 KB every 100 ms for a second: slower than a burst, faster than the stall rate.
          for (let sent = 0; sent < total; sent += 20_000) {
            c.enqueue(new Uint8Array(20_000));
            await new Promise((r) => setTimeout(r, 100));
          }
          c.close();
        },
      }),
    } as RequestInit);
    expect(await res.json()).toEqual({ bytes: total });
    await until(() => s.slots.size === 0);
    expect(s.slots.size).toBe(0);
  });
});
