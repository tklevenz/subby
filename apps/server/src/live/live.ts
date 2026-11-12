import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { LiveMessage } from '@subby/shared/sync';
import proxyAddr from '@fastify/proxy-addr';
import { AuthService, RECOVERY } from '../auth/auth.service';
import { CONFIG, type Config } from '../config';
import { LIVE_LIMIT, RateLimiter } from '../common/rateLimit';

/** Connected app sockets per family. In memory: one server instance (use Postgres LISTEN/NOTIFY to scale out). */
@Injectable()
export class LiveBus {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(familyId: string, socket: WebSocket) {
    const set = this.sockets.get(familyId) ?? new Set();
    set.add(socket);
    this.sockets.set(familyId, set);
  }

  remove(socket: WebSocket) {
    for (const [familyId, set] of this.sockets) {
      if (set.delete(socket) && set.size === 0) this.sockets.delete(familyId);
    }
  }

  /** Notifies every open app in the family. Messages carry no data; apps then pull or re-read. */
  publish(familyId: string, message: LiveMessage) {
    const text = JSON.stringify(message);
    for (const socket of this.sockets.get(familyId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
  }

  /** Closes every socket of a deleted family. */
  closeFamily(familyId: string) {
    for (const socket of this.sockets.get(familyId) ?? []) socket.close(4401, 'Family deleted');
  }

  /** Closes the sockets of a removed device. */
  closeDevice(familyId: string, deviceId: string) {
    for (const socket of this.sockets.get(familyId) ?? []) {
      if ((socket as WebSocket & { deviceId?: string }).deviceId === deviceId) socket.close(4401, 'Removed');
    }
  }
}

const MAX_SOCKETS_PER_DEVICE = 4;

/** `/v1/live?token=…`: server → app notifications while the app is open. */
// Apps never send anything but pongs: a small message limit (ws allows 100 MB by default).
@WebSocketGateway({ path: '/v1/live', maxPayload: 4096 })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly heartbeat = setInterval(() => this.ping(), 30_000);
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly all = new Set<WebSocket>();
  /** Upgrades don't pass Fastify's hooks, so the per-IP limit for opening sockets lives here. */
  private readonly limiter = new RateLimiter();
  private readonly clientIp: (req: IncomingMessage) => string;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    // The client's IP as Fastify sees it (`request.ip`): behind the proxies TRUST_PROXY names, X-Forwarded-For.
    const trust = config.trustProxy ? proxyAddr.compile(config.trustProxy.split(',').map((v) => v.trim())) : null;
    this.clientIp = (req) => (trust ? proxyAddr(req, trust) : (req.socket.remoteAddress ?? ''));
  }

  // Nest drops the promise this returns: an error here (the database unreachable for a moment) must be caught, or
  // it's an unhandled rejection, which ends the whole process.
  async handleConnection(socket: WebSocket, req: IncomingMessage) {
    try {
      await this.connect(socket, req);
    } catch (e) {
      console.warn('[live] connection failed', e);
      socket.close(1011, 'Try again');
    }
  }

  private async connect(socket: WebSocket, req: IncomingMessage) {
    // Before the token's database lookup: a script opening sockets in a loop is stopped here.
    if (this.config.rateLimit && this.limiter.take(`live:${this.clientIp(req)}`, LIVE_LIMIT)) return socket.close(1013, 'Too many connections, try again later');
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? undefined;
    const auth = await this.auth.authenticate(token);
    if (!auth || auth.deviceId === RECOVERY) return socket.close(4401, 'Unauthorized');
    // Gone while we checked the token: its close already fired, so it must not be tracked (it would never leave).
    if (socket.readyState !== socket.OPEN) return;
    // An app keeps one socket; a few allow for reconnects overlapping. Past that, the oldest go.
    const mine = [...this.all].filter((s) => (s as WebSocket & { deviceId?: string }).deviceId === auth.deviceId);
    for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_SOCKETS_PER_DEVICE - 1)))) {
      old.terminate();
      this.handleDisconnect(old);
    }
    (socket as WebSocket & { deviceId?: string }).deviceId = auth.deviceId;
    this.all.add(socket);
    this.alive.set(socket, true);
    socket.on('pong', () => this.alive.set(socket, true));
    this.bus.add(auth.familyId, socket);
  }

  handleDisconnect(socket: WebSocket) {
    this.all.delete(socket);
    this.bus.remove(socket);
  }

  // Shutting down: drop every socket now (apps reconnect). Otherwise the HTTP server waits for upgraded sockets,
  // and ws keeps a closing one for up to 30 s, so a restart would hang until Docker kills the process.
  onModuleDestroy() {
    clearInterval(this.heartbeat);
    for (const socket of this.all) socket.terminate();
    this.all.clear();
  }

  // Drops sockets that stopped answering (phones switching networks rarely close cleanly).
  private ping() {
    for (const socket of this.all) {
      if (!this.alive.get(socket)) {
        socket.terminate();
        this.handleDisconnect(socket);
        continue;
      }
      this.alive.set(socket, false);
      socket.ping();
    }
  }
}
