import { Body, Controller, Delete, HttpCode, Inject, Injectable, Put, UseGuards, type OnModuleDestroy } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { RegisterPushSchema } from '@subby/shared/sync';
import { CONFIG, type Config } from '../config';
import { GoogleAuth } from '../common/google';
import { DB, schema, type Db } from '../db/db';
import { parse } from '../common/validate';
import { Metrics } from '../common/metrics';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';

/** Writes within this window become one ping per phone. */
const COALESCE_MS = 2000;

/**
 * Wakes the family's other phones with a content-free "sync now" push when new data arrives, so they sync (and
 * re-plan reminders) in the background. The ping carries no data; the phone pulls the encrypted records itself.
 * Sent straight to Firebase Cloud Messaging, which sees the push token and the timing. Only phones running an app
 * built with the same Firebase project can be reached (so the official app needs the official server).
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  /** Per family: the devices that wrote since the last ping, and the pending timer. */
  private readonly pending = new Map<string, { writers: Set<string>; timer: NodeJS.Timeout }>();
  private readonly auth: GoogleAuth | null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Metrics) private readonly metrics: Metrics,
  ) {
    const fcm = config.push;
    this.auth = fcm.kind === 'fcm' ? new GoogleAuth(fcm, 'https://www.googleapis.com/auth/firebase.messaging') : null;
  }

  get enabled() {
    return this.config.push.kind === 'fcm';
  }

  onModuleDestroy() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  async register(auth: AuthContext, token: string, platform: 'android' | 'ios') {
    if (!this.enabled) return; // nothing would be sent, so don't keep the token
    const row = { deviceId: auth.deviceId, familyId: auth.familyId, token, platform, updatedAt: Date.now() };
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
      void this.send(familyId, skip).catch((e: unknown) => {
        this.metrics.count('push_error');
        console.warn('Push failed', e);
      });
    }, COALESCE_MS);
    timer.unref();
    this.pending.set(familyId, { writers, timer });
  }

  /** Sends now (also used by tests instead of waiting for the coalescing window). Returns how many were sent. */
  async send(familyId: string, skipDevice: string | null) {
    const fcm = this.config.push;
    if (fcm.kind !== 'fcm') return 0;
    // iOS tokens are APNs tokens: not sent to yet.
    const tokens = await this.db
      .select({ deviceId: schema.pushTokens.deviceId, token: schema.pushTokens.token })
      .from(schema.pushTokens)
      .where(
        and(
          eq(schema.pushTokens.familyId, familyId),
          eq(schema.pushTokens.platform, 'android'),
          ...(skipDevice ? [ne(schema.pushTokens.deviceId, skipDevice)] : []),
        ),
      );
    return this.deliver(tokens);
  }

  /**
   * Wakes a phone that another one just removed (its token is already gone from the table), so it syncs, finds
   * out and tells its owner, instead of only noticing whenever it next runs. Nothing about the family is sent.
   */
  wakeRemoved(token: { deviceId: string; token: string }) {
    if (this.config.push.kind !== 'fcm') return;
    void this.deliver([token]).catch((e: unknown) => {
      this.metrics.count('push_error');
      console.warn('Push failed', e);
    });
  }

  private async deliver(tokens: { deviceId: string; token: string }[]) {
    const fcm = this.config.push;
    if (fcm.kind !== 'fcm' || !tokens.length) return 0;
    const access = await this.auth!.token();
    const results = await Promise.all(
      tokens.map(async (t) => {
        // Data-only and high priority: nothing is shown, and Android lets the app run its task right away.
        const res = await fetch(fcm.sendUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
          body: JSON.stringify({ message: { token: t.token, data: { kind: 'sync' }, android: { priority: 'high' } } }),
        });
        if (res.ok) return { ...t, sent: true, gone: false };
        // 404: the app was uninstalled or the token expired. 400: the message is always the same, so it's the
        // token (e.g. an Expo token from an older app, or garbage). Either way it's of no use any more.
        if (res.status !== 404 && res.status !== 400) console.warn(`FCM answered ${res.status}`, await res.text().catch(() => ''));
        return { ...t, sent: false, gone: res.status === 404 || res.status === 400 };
      }),
    );

    const gone = results.filter((r) => r.gone).map((r) => r.deviceId);
    this.metrics.count('push_sent', results.filter((r) => r.sent).length);
    this.metrics.count('push_failed', results.filter((r) => !r.sent && !r.gone).length);
    this.metrics.count('push_token_dropped', gone.length);
    if (gone.length) await this.db.delete(schema.pushTokens).where(inArray(schema.pushTokens.deviceId, gone));
    return results.filter((r) => r.sent).length;
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
    const { token, platform } = parse(RegisterPushSchema, body);
    await this.push.register(auth, token, platform);
  }

  @Delete('token')
  @HttpCode(204)
  async unregister(@Auth() auth: AuthContext) {
    await this.push.unregister(auth);
  }
}
