import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { lt } from 'drizzle-orm';
import { DB, schema, type Db } from '../db/db';

const EVERY_MS = 60 * 60 * 1000;
/** Invites stay a day past expiry, so a slow phone still sees "expired" rather than "unknown code". */
const INVITE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Hourly: deletes expired sessions and old invites, which nothing reads any more. */
@Injectable()
export class Housekeeping implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

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
    return { sessions: sessions.length, invites: invites.length };
  }
}
