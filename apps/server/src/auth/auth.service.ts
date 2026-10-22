import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { fromBase64, verify } from '@kindred-log/shared/crypto';
import { authMessage, type ChallengeResponse, type VerifyResponse } from '@kindred-log/shared/sync';
import { DB, schema, type Db } from '../db/db';
import { sha256b64 } from '../common/hash';

export const RECOVERY = 'recovery';
/** Who is calling: a member device, or the recovery key (`deviceId === 'recovery'`). */
export type AuthContext = { familyId: string; deviceId: string };

const CHALLENGE_MS = 2 * 60_000;
const SESSION_MS = 7 * 24 * 3_600_000;

type Pending = { familyId: string; deviceId: string; signKey: string; expiresAt: number };

@Injectable()
export class AuthService {
  // One-time challenges live in memory (single instance). They expire after two minutes.
  private readonly challenges = new Map<string, Pending>();

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
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + CHALLENGE_MS;
    this.challenges.set(challenge, { ...pending, expiresAt });
    return { challenge, expiresAt };
  }

  async verify(challenge: string, signature: string): Promise<VerifyResponse> {
    const pending = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    if (!pending || pending.expiresAt < Date.now()) throw new UnauthorizedException('Challenge expired');
    if (!verify(fromBase64(pending.signKey), authMessage(challenge), fromBase64(signature))) {
      throw new UnauthorizedException('Bad signature');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_MS;
    await this.db.insert(schema.sessions).values({
      tokenHash: sha256b64(token),
      familyId: pending.familyId,
      deviceId: pending.deviceId,
      expiresAt: new Date(expiresAt),
    });
    return { token, expiresAt, familyId: pending.familyId, deviceId: pending.deviceId };
  }

  /** Resolves a bearer token. Sessions of removed devices are deleted on removal, so they fail here. */
  async authenticate(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const [session] = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.tokenHash, sha256b64(token)), gt(schema.sessions.expiresAt, new Date())));
    return session ? { familyId: session.familyId, deviceId: session.deviceId } : null;
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.challenges) if (v.expiresAt < now) this.challenges.delete(k);
  }
}
