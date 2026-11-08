import 'reflect-metadata';
import { Controller, Get, Inject, Module, ServiceUnavailableException, type DynamicModule } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { CONFIG, type Config } from './config';
import { DB, openDb, type Db } from './db/db';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DeviceGuard, DeviceOrRecoveryGuard } from './auth/auth.guard';
import { FamiliesController } from './families/families.controller';
import { FamiliesService } from './families/families.service';
import { KeysController } from './keys/keys.controller';
import { KeysService } from './keys/keys.service';
import { InvitesController, InvitesService } from './invites/invites';
import { SyncController, SyncService } from './sync/sync';
import { Entitlements } from './sync/entitlements';
import { LiveBus, LiveGateway } from './live/live';
import { BlobsController, BlobsService } from './blobs/blobs';
import { BLOB_STORE, openBlobStore, type BlobStore } from './blobs/store';
import { PushController, PushService } from './push/push';
import { Housekeeping } from './common/housekeeping';
import { PurchasesController, PurchasesService } from './purchases/purchases';
import { installRateLimits } from './common/rateLimit';
import { MAX_BLOB_BYTES } from '@subby/shared/sync';

export const PROTOCOL_VERSION = 1;

/** GET /v1/info: lets the app check that a custom server URL really is a Subby Sync server. */
@Controller('v1')
class InfoController {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  @Get('info')
  info() {
    return {
      service: 'kindred-sync',
      protocol: PROTOCOL_VERSION,
      mode: this.config.mode,
      push: this.config.push.kind !== 'none',
      // Dev builds of the app offer the pretend store only when the server takes it.
      testPurchases: this.config.mode === 'hosted' && this.config.stores.test,
    };
  }
}

/**
 * GET /healthz, for the uptime monitor: 200 when the database answers and photo storage is usable, else 503 with
 * which one failed. Checked at most every 10 s, so a busy pinger can't turn it into load on the bucket.
 */
@Controller()
class HealthController {
  private last: { at: number; result: { db: boolean; blobs: boolean } } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
  ) {}

  @Get('healthz')
  async health() {
    if (!this.last || Date.now() - this.last.at > 10_000) {
      const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
      const [db, blobs] = await Promise.all([ok(this.db.execute(sql`select 1`)), ok(this.blobs.check())]);
      this.last = { at: Date.now(), result: { db, blobs } };
    }
    const { db, blobs } = this.last.result;
    if (!db || !blobs) throw new ServiceUnavailableException({ ok: false, db, blobs });
    return { ok: true, db, blobs };
  }
}

@Module({})
class AppModule {
  static with(config: Config, db: unknown): DynamicModule {
    return {
      module: AppModule,
      controllers: [InfoController, HealthController, AuthController, FamiliesController, KeysController, InvitesController, SyncController, BlobsController, PushController, PurchasesController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: DB, useValue: db },
        { provide: BLOB_STORE, useValue: openBlobStore(config.blobs) },
        BlobsService,
        PushService,
        AuthService,
        DeviceGuard,
        DeviceOrRecoveryGuard,
        FamiliesService,
        KeysService,
        InvitesService,
        SyncService,
        Entitlements,
        PurchasesService,
        LiveBus,
        LiveGateway,
        Housekeeping,
      ],
    };
  }
}

/** Builds the server (migrating the database first). Used by main.ts and the end-to-end tests. */
export async function createApp(config: Config) {
  const { db, close } = await openDb(config.databaseUrl, config.migrationsFolder);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.with(config, db),
    new FastifyAdapter({
      // Records are small, but a first upload of a long history comes in 500-record batches.
      bodyLimit: 16 * 1024 * 1024,
      // On shutdown, cut every connection, not only idle ones: one that opened but hasn't sent a request yet
      // would otherwise hold the restart for the 60 s header timeout. Sync requests are safe to retry.
      forceCloseConnections: true,
      trustProxy: config.trustProxy,
    }),
    { logger: ['error', 'warn'] },
  );
  const fastify = app.getHttpAdapter().getInstance();
  if (config.rateLimit) installRateLimits(fastify);
  // Encrypted files arrive as raw bytes.
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_BLOB_BYTES + 1 }, (_req, body, done) => done(null, body));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  const originalClose = app.close.bind(app);
  app.close = async () => {
    await originalClose();
    await close();
  };
  return app;
}
