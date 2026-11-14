import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, notInArray } from 'drizzle-orm';
import { fromBase64, verify } from '@subby/shared/crypto';
import { authMessage, type ChallengeResponse, type VerifyResponse } from '@subby/shared/sync';
import { DB, schema, type Db } from '../db/db';
import { sha256b64 } from '../common/hash';
import { familyTransaction } from '../db/lock';

export const RECOVERY = 'recovery';
/** Who is calling: a member device, or the recovery key (`deviceId === 'recovery'`). */
export type AuthContext = { familyId: string; deviceId: string };

const CHALLENGE_MS = 2 * 60_000;
/** Open challenges at most (in memory); past it the oldest go, so a flood of requests can't grow the map. */
const MAX_CHALLENGES = 100_000;
/**
 * Open challenges per device (or recovery key); past it its oldest go. Anyone can ask for challenges for a device id
 * they know, so without this one client could push everyone's out of the map and fail their logins.
 */
export const MAX_CHALLENGES_PER_DEVICE = 4;
const SESSION_MS = 7 * 24 * 3_600_000;
/** Sessions kept per device: the newest ones (an app keeps one; a background run may log in beside it). */
export const MAX_SESSIONS_PER_DEVICE = 5;

type Pending = { familyId: string; deviceId: string; signKey: string; expiresAt: number };
const deviceKey = (p: Pick<Pending, 'familyId' | 'deviceId'>) => `${p.familyId}/${p.deviceId}`;

@Injectable()
export class AuthService {
  // One-time challenges live in memory (single instance). They expire after two minutes.
  private readonly challenges = new Map<string, Pending>();
  /** Each device's open challenges, oldest first. */
  private readonly byDevice = new Map<string, string[]>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async challenge(who: { deviceId: string } | { recoverySignKey: string }): Promise<ChallengeResponse> {
    let pending: Omit<Pending, 'expiresAt'> | undefined;
    if ('deviceId' in who) {
      const [device] = await this.db
        .select()
        .from(schema.devices)
        .where(and(eq(schema.devices.id, who.deviceId), eq(schema.devices.active, true)));
      if (device) pending = { familyId: device.familyId, deviceId: device.id, signKey: device.signKey };
    } else {
      const [family] = await this.db.select().from(schema.families).where(eq(schema.families.recoverySignKey, who.recoverySignKey));
      if (family) pending = { familyId: family.id, deviceId: RECOVERY, signKey: who.recoverySignKey };
    }
    if (!pending) throw new NotFoundException('Unknown device or recovery key');

    this.prune();
    // This device's oldest go first, then (a flood from many devices) the oldest overall: insertion order is age order.
    const owner = deviceKey(pending);
    for (let mine = this.byDevice.get(owner) ?? []; mine.length >= MAX_CHALLENGES_PER_DEVICE; mine = this.byDevice.get(owner) ?? []) this.forget(mine[0]!);
    for (const k of this.challenges.keys()) {
      if (this.challenges.size < MAX_CHALLENGES) break;
      this.forget(k);
    }
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + CHALLENGE_MS;
    this.challenges.set(challenge, { ...pending, expiresAt });
    this.byDevice.set(owner, [...(this.byDevice.get(owner) ?? []), challenge]);
    return { challenge, expiresAt };
  }

  private forget(challenge: string) {
    const pending = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    if (!pending) return;
    const owner = deviceKey(pending);
    const left = (this.byDevice.get(owner) ?? []).filter((c) => c !== challenge);
    if (left.length) this.byDevice.set(owner, left);
    else this.byDevice.delete(owner);
  }

  /** Open challenges, for tests. */
  get pendingChallenges() {
    return this.challenges.size;
  }

  async verify(challenge: string, signature: string): Promise<VerifyResponse> {
    const pending = this.challenges.get(challenge);
    this.forget(challenge);
    if (!pending || pending.expiresAt < Date.now()) throw new UnauthorizedException('Challenge expired');
    if (!verify(fromBase64(pending.signKey), authMessage(challenge), fromBase64(signature))) {
      throw new UnauthorizedException('Bad signature');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_MS;
    await familyTransaction(this.db, pending.familyId, async (tx, family) => {
      // Still a member (or still the recovery key)? A removal between challenge and verify deleted the sessions,
      // and must not be followed by a new one. Locked, so a removal can't commit in between either.
      const current =
        pending.deviceId === RECOVERY
          ? family.recoverySignKey === pending.signKey
          : (
              await tx
                .select({ id: schema.devices.id })
                .from(schema.devices)
                .where(and(eq(schema.devices.id, pending.deviceId), eq(schema.devices.familyId, pending.familyId), eq(schema.devices.active, true)))
            ).length > 0;
      if (!current) throw new UnauthorizedException('Not a member of this family any more');
      await tx.insert(schema.sessions).values({
        tokenHash: sha256b64(token),
        familyId: pending.familyId,
        deviceId: pending.deviceId,
        expiresAt: new Date(expiresAt),
      });
      // Only the newest few per device: logging in over and over can't fill the table. (All last equally long, so
      // the latest expiry is the newest.)
      const mine = and(eq(schema.sessions.familyId, pending.familyId), eq(schema.sessions.deviceId, pending.deviceId));
      const keep = tx
        .select({ tokenHash: schema.sessions.tokenHash })
        .from(schema.sessions)
        .where(mine)
        .orderBy(desc(schema.sessions.expiresAt))
        .limit(MAX_SESSIONS_PER_DEVICE);
      await tx.delete(schema.sessions).where(and(mine, notInArray(schema.sessions.tokenHash, keep)));
    });
    return { token, expiresAt, familyId: pending.familyId, deviceId: pending.deviceId };
  }

  /** Resolves a bearer token. Sessions of removed devices are deleted on removal, so they fail here. */
  async authenticate(token: string | undefined): Promise<AuthContext | null> {
    // Tokens are 32 random bytes in base64url: anything else is refused without a database query.
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [session] = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.tokenHash, sha256b64(token)), gt(schema.sessions.expiresAt, new Date())));
    return session ? { familyId: session.familyId, deviceId: session.deviceId } : null;
  }

  private prune() {
    const now = Date.now();
    // All live equally long, so insertion order is expiry order: stop at the first one still valid.
    for (const [k, v] of this.challenges) {
      if (v.expiresAt >= now) break;
      this.forget(k);
    }
  }
}
