import Fastify from 'fastify';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { installBodyGate } from '../src/common/bodyGate';
import type { AuthService } from '../src/auth/auth.service';

/** The body gate on a bare Fastify, with every bearer token a session of its own phone. */
async function server(budget: { perDevice: number; bytes: number }, stall = { ms: 60_000, bytes: 1024 }) {
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
  const auth = { authenticate: async (token: string) => ({ familyId: 'f', deviceId: token }) } as unknown as AuthService;
  installBodyGate(app, auth, budget, stall);
  app.post('/v1/sync/push', async () => ({ ok: true }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  return { app, port };
}

/** Starts a push of `length` bytes and sends only part of it, so it stays in flight. */
function slowPush(port: number, device: string, length: number) {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {});
  socket.write(`POST /v1/sync/push HTTP/1.1\r\nHost: t\r\nAuthorization: Bearer ${device}\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n\r\n{"x":"`);
  return socket;
}

const push = (port: number, device: string, size = 100 * 1024) =>
  fetch(`http://127.0.0.1:${port}/v1/sync/push`, {
    method: 'POST',
    headers: { authorization: `Bearer ${device}`, 'content-type': 'application/json' },
    body: JSON.stringify({ x: 'x'.repeat(size) }),
  });

describe('large bodies in flight', () => {
  let app: Awaited<ReturnType<typeof server>>['app'] | undefined;
  const sockets: ReturnType<typeof connect>[] = [];
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.destroy();
    await app?.close();
    app = undefined;
  });

  it('are limited per phone and by size for the whole server, and given back when done', async () => {
    const s = await server({ perDevice: 2, bytes: 3 * 1024 * 1024 });
    app = s.app;
    sockets.push(slowPush(s.port, 'a', 1024 * 1024), slowPush(s.port, 'a', 1024 * 1024));
    await new Promise((r) => setTimeout(r, 100));
    expect((await push(s.port, 'a')).status).toBe(429);
    // Another phone fits while the budget lasts, then not.
    sockets.push(slowPush(s.port, 'b', 1024 * 1024));
    await new Promise((r) => setTimeout(r, 100));
    expect((await push(s.port, 'c')).status).toBe(429);
    // Small bodies never count.
    expect((await push(s.port, 'c', 10)).status).toBe(200);
    for (const socket of sockets.splice(0)) socket.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect((await push(s.port, 'a')).status).toBe(200);
  });

  it('cuts off a large body that trickles in, giving its budget back', async () => {
    const s = await server({ perDevice: 1, bytes: 3 * 1024 * 1024 }, { ms: 200, bytes: 1024 });
    app = s.app;
    let closed = false;
    const socket = slowPush(s.port, 'a', 1024 * 1024);
    socket.on('close', () => (closed = true));
    sockets.push(socket);
    await new Promise((r) => setTimeout(r, 100));
    expect((await push(s.port, 'a')).status).toBe(429);
    await new Promise((r) => setTimeout(r, 600));
    expect(closed).toBe(true);
    expect((await push(s.port, 'a')).status).toBe(200);
  });
});
