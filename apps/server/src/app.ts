import 'reflect-metadata';
import { Controller, Get, Inject, Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { CONFIG, type Config } from './config';
import { DB, openDb } from './db/db';
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
import { BLOB_STORE, openBlobStore } from './blobs/store';
import { PushController, PushService } from './push/push';
import { MAX_BLOB_BYTES } from '@kindred-log/shared/sync';

export const PROTOCOL_VERSION = 1;

/** GET /v1/info: lets the app check that a custom server URL really is a Kindred Sync server. */
@Controller('v1')
class InfoController {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  @Get('info')
  info() {
    return { service: 'kindred-sync', protocol: PROTOCOL_VERSION, mode: this.config.mode, push: this.config.push.kind !== 'none' };
  }
}

@Module({})
class AppModule {
  static with(config: Config, db: unknown): DynamicModule {
    return {
      module: AppModule,
      controllers: [InfoController, AuthController, FamiliesController, KeysController, InvitesController, SyncController, BlobsController, PushController],
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
        LiveBus,
        LiveGateway,
      ],
    };
  }
}

/** Builds the server (migrating the database first). Used by main.ts and the end-to-end tests. */
export async function createApp(config: Config) {
  const { db, close } = await openDb(config.databaseUrl, config.migrationsFolder);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.with(config, db),
    // Records are small, but a first upload of a long history comes in 500-record batches.
    new FastifyAdapter({ bodyLimit: 16 * 1024 * 1024 }),
    { logger: ['error', 'warn'] },
  );
  // Encrypted files arrive as raw bytes.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_BLOB_BYTES + 1 }, (_req, body, done) => done(null, body));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  const originalClose = app.close.bind(app);
  app.close = async () => {
    await originalClose();
    await close();
  };
  return app;
}
