import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
/** Challenges answered (each once), kept until they expire; past this the oldest go. Only valid signatures land here. */
const MAX_USED_CHALLENGES = 100_000;
const SESSION_MS = 7 * 24 * 3_600_000;
/** Sessions kept per device: the newest ones (an app keeps one; a background run may log in beside it). */
export const MAX_SESSIONS_PER_DEVICE = 5;
const MAC_BYTES = 32;
const NONCE_BYTES = 16;

/** Who a challenge was made for: a device by its id, or a family's recovery key by the family's id. */
type Owner = { kind: 'device' | 'recovery'; id: string };

@Injectable()
export class AuthService {
  /**
   * Challenges are stateless: `<owner>:<expiry>:` plus a nonce and an HMAC over both, with a key that lives only in
   * this process (a restart just fails the logins of the last two minutes). Nothing is stored per challenge, so
   * nobody can push a phone's challenge out by asking for many in its name.
   */
  private readonly key = randomBytes(32);
  /** Challenges already answered, so each logs in once. */
  private readonly used = new Map<string, number>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async challenge(who: { deviceId: string } | { recoverySignKey: string }): Promise<ChallengeResponse> {
    let owner: Owner | undefined;
    if ('deviceId' in who) {
      const [device] = await this.db
        .select({ id: schema.devices.id })
        .from(schema.devices)
        .where(and(eq(schema.devices.id, who.deviceId), eq(schema.devices.active, true)));
      if (device) owner = { kind: 'device', id: device.id };
    } else {
      const [family] = await this.db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.recoverySignKey, who.recoverySignKey));
      if (family) owner = { kind: 'recovery', id: family.id };
    }
    if (!owner) throw new NotFoundException('Unknown device or recovery key');
    const expiresAt = Date.now() + CHALLENGE_MS;
    const body = Buffer.concat([Buffer.from(`${owner.kind}:${owner.id}:${expiresAt}:`), randomBytes(NONCE_BYTES)]);
    return { challenge: Buffer.concat([body, this.mac(body)]).toString('base64url'), expiresAt };
  }

  private mac(body: Buffer) {
    return createHmac('sha256', this.key).update(body).digest();
  }

  /** The owner and expiry of a challenge this process made, or null. */
  private open(challenge: string): (Owner & { expiresAt: number }) | null {
    const bytes = Buffer.from(challenge, 'base64url');
    if (bytes.length <= MAC_BYTES + NONCE_BYTES) return null;
    const body = bytes.subarray(0, bytes.length - MAC_BYTES);
    if (!timingSafeEqual(this.mac(body), bytes.subarray(body.length))) return null;
    const [kind, id, expiry] = body.subarray(0, body.length - NONCE_BYTES).toString().split(':');
    if ((kind !== 'device' && kind !== 'recovery') || !id) return null;
    return { kind, id, expiresAt: Number(expiry) };
  }

  /** Marks `challenge` answered; false if it already was. */
  private use(challenge: string, expiresAt: number) {
    const now = Date.now();
    // All live equally long, so insertion order is expiry order.
    for (const [k, until] of this.used) {
      if (until >= now && this.used.size < MAX_USED_CHALLENGES) break;
      this.used.delete(k);
    }
    if (this.used.has(challenge)) return false;
    this.used.set(challenge, expiresAt);
    return true;
  }

  async verify(challenge: string, signature: string): Promise<VerifyResponse> {
    const opened = this.open(challenge);
    if (!opened || opened.expiresAt < Date.now()) throw new UnauthorizedException('Challenge expired');
    let pending: { familyId: string; deviceId: string; signKey: string } | undefined;
    if (opened.kind === 'device') {
      const [device] = await this.db.select().from(schema.devices).where(eq(schema.devices.id, opened.id));
      if (device) pending = { familyId: device.familyId, deviceId: device.id, signKey: device.signKey };
    } else {
      const [family] = await this.db.select().from(schema.families).where(eq(schema.families.id, opened.id));
      if (family?.recoverySignKey) pending = { familyId: family.id, deviceId: RECOVERY, signKey: family.recoverySignKey };
    }
    if (!pending) throw new UnauthorizedException('Not a member of this family any more');
    if (!verify(fromBase64(pending.signKey), authMessage(challenge), fromBase64(signature))) {
      throw new UnauthorizedException('Bad signature');
    }
    if (!this.use(challenge, opened.expiresAt)) throw new UnauthorizedException('Challenge expired');
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
}
