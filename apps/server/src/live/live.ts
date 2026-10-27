import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { LiveMessage } from '@kindred-log/shared/sync';
import { AuthService, RECOVERY } from '../auth/auth.service';

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

  /** Closes the sockets of a removed device. */
  closeDevice(familyId: string, deviceId: string) {
    for (const socket of this.sockets.get(familyId) ?? []) {
      if ((socket as WebSocket & { deviceId?: string }).deviceId === deviceId) socket.close(4401, 'Removed');
    }
  }
}

/** `/v1/live?token=…`: server → app notifications while the app is open. */
@WebSocketGateway({ path: '/v1/live' })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly heartbeat = setInterval(() => this.ping(), 30_000);
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly all = new Set<WebSocket>();

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  async handleConnection(socket: WebSocket, req: IncomingMessage) {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? undefined;
    const auth = await this.auth.authenticate(token);
    if (!auth || auth.deviceId === RECOVERY) return socket.close(4401, 'Unauthorized');
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
        continue;
      }
      this.alive.set(socket, false);
      socket.ping();
    }
  }
}
