import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { INACTIVE_DELETE_DAYS, INACTIVE_WARN_DAYS } from '@subby/shared/sync';
import { Metrics } from './metrics';
import { CONFIG, type Config } from '../config';
import { DB, schema, type Db } from '../db/db';
import { FamiliesService } from '../families/families.service';
import { PurchasesService } from '../purchases/purchases';
import { PushService } from '../push/push';

const EVERY_MS = 60 * 60 * 1000;
/** Invites stay a day past expiry, so a slow phone still sees "expired" rather than "unknown code". */
const INVITE_GRACE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A quiet family's phones are woken at most this often during its last month. */
const PING_EVERY_MS = 7 * DAY_MS;

/**
 * Hourly: deletes expired sessions and old invites, which nothing reads any more, and checks Google for refunds.
 * Hosted: deletes families no phone has synced for a year, after waking their phones during the last month.
 */
@Injectable()
export class Housekeeping implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
    @Inject(FamiliesService) private readonly families: FamiliesService,
    @Inject(PushService) private readonly push: PushService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Metrics) private readonly metrics: Metrics,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run().catch((e: unknown) => console.warn('Housekeeping failed', e)), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = Date.now()) {
    const sessions = await this.db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date(now))).returning({ t: schema.sessions.tokenHash });
    const invites = await this.db.delete(schema.invites).where(lt(schema.invites.expiresAt, new Date(now - INVITE_GRACE_MS))).returning({ id: schema.invites.id });
    const refunds = await this.purchases.checkVoided(now).catch((e: unknown) => {
      this.metrics.count('refund_check_failed');
      console.warn('Checking Google Play refunds failed', e);
      return 0;
    });
    const inactive = await this.inactiveFamilies(now);
    this.metrics.count('purchase_refunded', refunds);
    this.metrics.count('family_inactive_pinged', inactive.pinged);
    this.metrics.count('family_inactive_deleted', inactive.deleted);
    return { sessions: sessions.length, invites: invites.length, refunds, ...inactive };
  }

  /**
   * Hosted only (D5, LAUNCH.md S4): a family no phone has synced for `INACTIVE_DELETE_DAYS` is deleted with all its
   * data, gifted slots included (the website and the app's warning say so). From `INACTIVE_WARN_DAYS` its Android
   * phones get a sync push each week: a phone that's still installed syncs, and that keeps the family. (Phones
   * also warn themselves then, with a local notification each sync schedules.)
   */
  private async inactiveFamilies(now: number) {
    if (this.config.mode !== 'hosted') return { pinged: 0, deleted: 0 };
    const { families: f } = schema;
    const gone = await this.db.select({ id: f.id }).from(f).where(lt(f.lastActiveAt, new Date(now - INACTIVE_DELETE_DAYS * DAY_MS)));
    for (const { id } of gone) await this.families.delete(id);
    const quiet = await this.db
      .select({ id: f.id })
      .from(f)
      .where(and(lt(f.lastActiveAt, new Date(now - INACTIVE_WARN_DAYS * DAY_MS)), or(isNull(f.inactivityPingedAt), lt(f.inactivityPingedAt, new Date(now - PING_EVERY_MS)))));
    for (const { id } of quiet) {
      await this.db.update(f).set({ inactivityPingedAt: new Date(now) }).where(eq(f.id, id));
      await this.push.send(id, null).catch((e: unknown) => console.warn('Waking a quiet family failed', e));
    }
    return { pinged: quiet.length, deleted: gone.length };
  }
}
