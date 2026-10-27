import { Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { fromBase64 } from '@kindred-log/shared/crypto';
import { ClaimInviteSchema, CreateInviteSchema, InviteStatusSchema, type InviteResponse } from '@kindred-log/shared/sync';
import { DB, schema, type Db } from '../db/db';
import { parse } from '../common/validate';
import { safeEqual, sha256b64 } from '../common/hash';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { LiveBus } from '../live/live';

const INVITE_MS = 10 * 60_000;
type Invite = typeof schema.invites.$inferSelect;

/**
 * Pairing a new device: the inviter creates an invite (QR), the new device claims it with keys derived from
 * the QR secret, the inviter checks the pairing code and approves by appending an `add` entry to the log.
 */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LiveBus) private readonly live: LiveBus,
  ) {}

  async create(auth: AuthContext, inviteId: string, claimHash: string) {
    await this.db.insert(schema.invites).values({
      id: inviteId,
      familyId: auth.familyId,
      claimHash,
      expiresAt: new Date(Date.now() + INVITE_MS),
    });
    return { inviteId, expiresAt: Date.now() + INVITE_MS };
  }

  async claim(id: string, claim: { claimKey: string; deviceId: string; signKey: string; boxKey: string; mac: string }) {
    const invite = await this.checked(id, claim.claimKey);
    const { claimKey: _, ...claimant } = claim;
    // Conditional, so two phones claiming the same code at once can't both succeed.
    const [won] = await this.db
      .update(schema.invites)
      .set({ status: 'claimed', claimant })
      .where(and(eq(schema.invites.id, id), eq(schema.invites.status, 'open'), gt(schema.invites.expiresAt, new Date())))
      .returning({ id: schema.invites.id });
    if (!won) throw new ConflictException('This code was already used or has expired');
    this.live.publish(invite.familyId, { type: 'invite', inviteId: id, status: 'claimed' });
    return this.response({ ...invite, status: 'claimed', claimant });
  }

  /** The inviter polls (or gets a live message) to see the claimant's keys. */
  async forInviter(auth: AuthContext, id: string) {
    const [invite] = await this.db
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.id, id), eq(schema.invites.familyId, auth.familyId)));
    if (!invite) throw new NotFoundException();
    return this.response(invite);
  }

  /** The new device polls until the inviter approved it, then logs in as a member. */
  async forClaimant(id: string, claimKey: string) {
    return this.response(await this.checked(id, claimKey));
  }

  private async checked(id: string, claimKey: string) {
    const [invite] = await this.db.select().from(schema.invites).where(eq(schema.invites.id, id));
    if (!invite || !safeEqual(sha256b64(fromBase64(claimKey)), invite.claimHash)) throw new NotFoundException('Unknown code');
    return invite;
  }

  private response(invite: Invite): InviteResponse {
    const expired = invite.status !== 'approved' && invite.expiresAt < new Date();
    return { status: expired ? 'expired' : invite.status, familyId: invite.familyId, claimant: invite.claimant ?? null };
  }
}

@Controller('v1/invites')
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Post()
  @UseGuards(DeviceGuard)
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { inviteId, claimHash } = parse(CreateInviteSchema, body);
    return this.invites.create(auth, inviteId, claimHash);
  }

  @Get(':id')
  @UseGuards(DeviceGuard)
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invites.forInviter(auth, id);
  }

  /** No auth: the claim key from the QR code is the credential. */
  @Post(':id/claim')
  @HttpCode(200)
  claim(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.invites.claim(id, parse(ClaimInviteSchema, body));
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.invites.forClaimant(id, parse(InviteStatusSchema, body).claimKey);
  }
}
