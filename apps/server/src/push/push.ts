import { Body, Controller, Delete, HttpCode, Inject, Injectable, Put, UseGuards, type OnModuleDestroy } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { RegisterPushSchema } from '@kindred-log/shared/sync';
import { CONFIG, type Config } from '../config';
import { DB, schema, type Db } from '../db/db';
import { parse } from '../common/validate';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';

/** Writes within this window become one ping per phone. */
const COALESCE_MS = 2000;

type ExpoTicket = { status: 'ok' | 'error'; details?: { error?: string } };

/**
 * Hosted only: wakes the family's other phones with a content-free "sync now" push when new data arrives, so
 * they sync (and re-plan reminders) in the background. The ping carries no data; the phone pulls the
 * encrypted records itself. Sent through the Expo push service, which sees the push token and the timing.
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  /** Per family: the devices that wrote since the last ping, and the pending timer. */
  private readonly pending = new Map<string, { writers: Set<string>; timer: NodeJS.Timeout }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  get enabled() {
    return this.config.push.kind === 'expo';
  }

  onModuleDestroy() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  async register(auth: AuthContext, token: string) {
    if (!this.enabled) return; // nothing would be sent, so don't keep the token
    const row = { deviceId: auth.deviceId, familyId: auth.familyId, token, updatedAt: Date.now() };
    await this.db.insert(schema.pushTokens).values(row).onConflictDoUpdate({ target: schema.pushTokens.deviceId, set: row });
  }

  async unregister(auth: AuthContext) {
    await this.db.delete(schema.pushTokens).where(eq(schema.pushTokens.deviceId, auth.deviceId));
  }

  /** `writer` changed the family's data; its own phone doesn't need waking. */
  changed(familyId: string, writer: string) {
    if (!this.enabled) return;
    const entry = this.pending.get(familyId);
    if (entry) {
      entry.writers.add(writer);
      return;
    }
    const writers = new Set([writer]);
    const timer = setTimeout(() => {
      this.pending.delete(familyId);
      // Two phones writing at once each need the other's change, so only a lone writer is skipped.
      const skip = writers.size === 1 ? [...writers][0]! : null;
      void this.send(familyId, skip).catch((e: unknown) => console.warn('Push failed', e));
    }, COALESCE_MS);
    timer.unref();
    this.pending.set(familyId, { writers, timer });
  }

  /** Sends now (also used by tests instead of waiting for the coalescing window). */
  async send(familyId: string, skipDevice: string | null) {
    if (this.config.push.kind !== 'expo') return 0;
    const tokens = await this.db
      .select({ deviceId: schema.pushTokens.deviceId, token: schema.pushTokens.token })
      .from(schema.pushTokens)
      .where(and(eq(schema.pushTokens.familyId, familyId), ...(skipDevice ? [ne(schema.pushTokens.deviceId, skipDevice)] : [])));
    if (!tokens.length) return 0;

    // Data-only: no title or body, so nothing is shown; iOS needs content-available to wake the app.
    const messages = tokens.map((t) => ({ to: t.token, data: { kind: 'sync' }, priority: 'high', _contentAvailable: true }));
    const res = await fetch(this.config.push.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.config.push.accessToken ? { authorization: `Bearer ${this.config.push.accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`Expo push service answered ${res.status}`);
    const { data: tickets = [] } = (await res.json()) as { data?: ExpoTicket[] };

    // Tokens of uninstalled apps are dropped so we stop sending to them.
    const gone = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map((t) => t.deviceId);
    if (gone.length) await this.db.delete(schema.pushTokens).where(inArray(schema.pushTokens.deviceId, gone));
    return tokens.length;
  }
}

@Controller('v1/push')
@UseGuards(DeviceGuard)
export class PushController {
  constructor(@Inject(PushService) private readonly push: PushService) {}

  /** Registers (or replaces) this phone's push token. Accepted on every server; only hosted ones send. */
  @Put('token')
  @HttpCode(204)
  async register(@Auth() auth: AuthContext, @Body() body: unknown) {
    await this.push.register(auth, parse(RegisterPushSchema, body).token);
  }

  @Delete('token')
  @HttpCode(204)
  async unregister(@Auth() auth: AuthContext) {
    await this.push.unregister(auth);
  }
}
