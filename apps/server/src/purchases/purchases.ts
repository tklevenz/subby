import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { PurchaseSchema, productKind, type EntitlementResponse } from '@kindred-log/shared/sync';
import { CONFIG, type Config } from '../config';
import { DB, schema, type Db } from '../db/db';
import { lockFamily } from '../db/lock';
import { parse } from '../common/validate';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { LiveBus } from '../live/live';
import { Entitlements } from '../sync/entitlements';
import { AppStore, GooglePlay, PurchasePending, PurchaseRefused, TestStore, testPurchaseId, type Store } from './stores';

/** Google keeps voided purchases for 30 days; the first check after a start looks that far back. */
const VOIDED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class PurchasesService {
  readonly google: GooglePlay | null;
  readonly apple: AppStore | null;
  readonly test: TestStore | null;
  private voidedCheckedAt: number | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(LiveBus) private readonly live: LiveBus,
  ) {
    this.google = config.stores.google ? new GooglePlay(config.stores.google) : null;
    this.apple = config.stores.apple ? new AppStore(config.stores.apple) : null;
    this.test = config.stores.test ? new TestStore() : null;
  }

  /**
   * Records a purchase made (or restored) on this phone, after the store confirms it.
   * - An unlock follows the phone that sends it: a restore on a new phone moves it there (one phone at a time).
   * - A slot belongs to the buyer's family, for good. Sending it again is fine; from another family it's refused.
   */
  async record(auth: AuthContext, purchase: z.infer<typeof PurchaseSchema>): Promise<EntitlementResponse> {
    if (this.config.mode !== 'hosted') throw new BadRequestException('Sync is free on this server: nothing to buy');
    const kind = productKind(purchase.product)!;
    const store: Store | null = purchase.store === 'google' ? this.google : purchase.store === 'apple' ? this.apple : this.test;
    const name = { google: 'the Play Store', apple: 'the App Store', test: 'the test store' }[purchase.store];
    if (!store) throw new ServiceUnavailableException(`Purchases from ${name} aren't set up on this server`);

    let verified;
    try {
      verified = await store.verify(purchase.product, purchase.token);
    } catch (e) {
      if (e instanceof PurchasePending) throw new ConflictException(e.message);
      if (e instanceof PurchaseRefused) throw new ForbiddenException(e.message);
      throw e;
    }
    // A slot is bought for this phone's family, so it must come from this phone (an unlock may be restored anywhere).
    if (kind === 'slot' && verified.accountId && verified.accountId !== auth.deviceId) {
      throw new ForbiddenException('This purchase was made on another phone');
    }

    const movedFrom = await this.db.transaction(async (tx) => {
      await lockFamily(tx, auth.familyId);
      const [existing] = await tx.select().from(schema.purchases).where(eq(schema.purchases.id, verified.id));
      if (existing?.revoked) throw new ForbiddenException('This purchase was refunded');
      if (existing && existing.kind !== kind) throw new BadRequestException('This purchase is for another product');
      if (!existing) {
        await tx.insert(schema.purchases).values({
          id: verified.id,
          store: purchase.store,
          kind,
          deviceId: auth.deviceId,
          familyId: kind === 'slot' ? auth.familyId : null,
        });
        return null;
      }
      if (kind === 'slot') {
        if (existing.familyId !== auth.familyId) throw new ConflictException('This purchase was already given to another family');
        return null;
      }
      if (existing.deviceId === auth.deviceId) return null;
      await tx.update(schema.purchases).set({ deviceId: auth.deviceId }).where(eq(schema.purchases.id, verified.id));
      return existing.deviceId;
    });

    // Stored first, so a failure here only means the store is told again next time.
    await store.finish(purchase.product, purchase.token, kind).catch((e: unknown) => console.warn('Couldn’t finish a purchase with the store', e));
    this.live.publish(auth.familyId, { type: 'entitlement' });
    if (movedFrom) await this.notifyDevices([movedFrom]);
    return this.entitlements.forDevice(auth.familyId, auth.deviceId);
  }

  /** Marks purchases refunded (or no longer), and tells the families affected. */
  async setRevoked(ids: string[], revoked: boolean) {
    if (!ids.length) return 0;
    const changed = await this.db
      .update(schema.purchases)
      .set({ revoked })
      .where(and(inArray(schema.purchases.id, ids), eq(schema.purchases.revoked, !revoked)))
      .returning({ deviceId: schema.purchases.deviceId, familyId: schema.purchases.familyId });
    for (const familyId of new Set(changed.flatMap((c) => (c.familyId ? [c.familyId] : [])))) this.live.publish(familyId, { type: 'entitlement' });
    await this.notifyDevices(changed.filter((c) => !c.familyId).map((c) => c.deviceId));
    return changed.length;
  }

  /** Hourly (Housekeeping): Google has no push for refunds without Pub/Sub, so it's asked. */
  async checkVoided(now = Date.now()) {
    if (!this.google || this.config.mode !== 'hosted') return 0;
    const since = this.voidedCheckedAt ? this.voidedCheckedAt - 60 * 60 * 1000 : now - VOIDED_WINDOW_MS;
    const ids = await this.google.voidedSince(since);
    this.voidedCheckedAt = now;
    return this.setRevoked(ids, true);
  }

  /** App Store Server Notifications V2 (set as the server URL in App Store Connect). */
  async appleNotification(signedPayload: string) {
    if (!this.apple || this.config.mode !== 'hosted') return;
    let change;
    try {
      change = this.apple.notification(signedPayload);
    } catch (e) {
      if (e instanceof PurchaseRefused) throw new BadRequestException(e.message);
      throw e;
    }
    if (change) await this.setRevoked([change.id], change.revoked);
  }

  private async notifyDevices(deviceIds: string[]) {
    if (!deviceIds.length) return;
    const families = await this.db.select({ familyId: schema.devices.familyId }).from(schema.devices).where(inArray(schema.devices.id, deviceIds));
    for (const familyId of new Set(families.map((f) => f.familyId))) this.live.publish(familyId, { type: 'entitlement' });
  }
}

@Controller('v1')
export class PurchasesController {
  constructor(
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
  ) {}

  @Get('entitlement')
  @UseGuards(DeviceGuard)
  entitlement(@Auth() auth: AuthContext) {
    return this.entitlements.forDevice(auth.familyId, auth.deviceId);
  }

  @Post('purchases')
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  record(@Auth() auth: AuthContext, @Body() body: unknown) {
    return this.purchases.record(auth, parse(PurchaseSchema, body));
  }

  /** TEST_PURCHASES=1 only: refunds a test purchase, to try what a refund does to the app. */
  @Post('purchases/test/refund')
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  async testRefund(@Auth() auth: AuthContext, @Body() body: unknown) {
    if (!this.purchases.test) throw new NotFoundException();
    const { token } = parse(z.object({ token: z.string().min(1).max(200) }), body);
    await this.purchases.setRevoked([testPurchaseId(token)], true);
    return this.entitlements.forDevice(auth.familyId, auth.deviceId);
  }

  /** Apple calls this; the payload is signed by Apple, so no auth. */
  @Post('purchases/apple/notifications')
  @HttpCode(200)
  async apple(@Body() body: unknown) {
    const { signedPayload } = parse(z.object({ signedPayload: z.string().min(1).max(64 * 1024) }), body);
    await this.purchases.appleNotification(signedPayload);
    return {};
  }
}
