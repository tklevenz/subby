import { readFileSync } from 'node:fs';
import { serviceAccountFrom, type GoogleServiceAccount } from './common/google';
import { APPLE_ROOT_CA_G3 } from './purchases/appleRoot';

export type Config = {
  databaseUrl: string;
  port: number;
  /** `self`: self-hosted, no quotas or payment, no push. `hosted`: the official Subby Sync service. */
  mode: 'self' | 'hosted';
  migrationsFolder: string;
  /** Where encrypted files (photos) go: a local folder, or S3-compatible object storage. */
  blobs: BlobStoreConfig;
  /** Background "sync now" pings through Firebase Cloud Messaging. On by default for hosted. */
  push: { kind: 'none' } | FcmConfig;
  /** Per-client request limits (`common/rateLimit.ts`). On unless RATE_LIMIT=off. */
  rateLimit: boolean;
  /**
   * Which reverse proxies to believe about the client's IP (X-Forwarded-For), as Fastify's `trustProxy`: false
   * (none, the default), or proxy addresses/ranges such as `uniquelocal` (private networks: Caddy in the same compose).
   */
  trustProxy: false | string;
  /** Verifying store purchases (hosted only); a store left out can't be bought from. */
  stores: { google: GooglePlayConfig | null; apple: AppStoreConfig | null; test: boolean };
  /** Port for `GET /metrics` on the container's own 127.0.0.1 (`common/metrics.ts`); left out, none is opened. */
  metricsPort?: number;
};

/** Google Play: a service account with access to the app in the Play Console (View financial data, Manage orders). */
export type GooglePlayConfig = GoogleServiceAccount & {
  packageName: string;
  /** The Android Publisher API (a fake in tests). */
  apiUrl: string;
};

/** The App Store: StoreKit 2 transactions and server notifications are signed; checked against Apple's root. */
export type AppStoreConfig = {
  bundleId: string;
  /** PEM root certificates to accept (Apple Root CA - G3; a test CA in tests). */
  roots: string[];
  /** Refuse sandbox (TestFlight, Xcode) purchases unless allowed, e.g. while dogfooding. */
  allowSandbox: boolean;
};

const APP_ID = 'baby.subby.app';

function storesConfig(env: NodeJS.ProcessEnv): Config['stores'] {
  let google: GooglePlayConfig | null = null;
  if (env.GOOGLE_PLAY_SERVICE_ACCOUNT) {
    const account = serviceAccountFrom(env.GOOGLE_PLAY_SERVICE_ACCOUNT, JSON.parse(readFileSync(env.GOOGLE_PLAY_SERVICE_ACCOUNT, 'utf8')));
    google = { ...account, packageName: env.GOOGLE_PLAY_PACKAGE || APP_ID, apiUrl: 'https://androidpublisher.googleapis.com/androidpublisher/v3' };
  }
  const apple: AppStoreConfig | null =
    env.APPLE_IAP === 'off' ? null : { bundleId: env.APPLE_BUNDLE_ID || APP_ID, roots: [APPLE_ROOT_CA_G3], allowSandbox: env.APPLE_ALLOW_SANDBOX === '1' };
  // A pretend store for testing the app's unlock flow end to end. Never on the official server.
  const test = env.TEST_PURCHASES === '1';
  if (test) console.warn('TEST_PURCHASES=1: anyone can unlock sync here without paying. Never use this on a public server.');
  return { google, apple, test };
}

function trustProxy(value: string | undefined): Config['trustProxy'] {
  if (!value || value === 'false') return false;
  if (value === 'true') throw new Error("TRUST_PROXY=true would let any client pick its IP: give the proxy's addresses, e.g. uniquelocal");
  return value;
}

/** From a Firebase service-account key (Project settings → Service accounts). */
export type FcmConfig = {
  kind: 'fcm';
  projectId: string;
  clientEmail: string;
  privateKey: string;
  /** Where the signed JWT is traded for an access token (the key's `token_uri`). */
  tokenUri: string;
  /** FCM HTTP v1 send endpoint. */
  sendUrl: string;
};

function pushConfig(env: NodeJS.ProcessEnv, mode: Config['mode']): Config['push'] {
  const kind = env.PUSH || (mode === 'hosted' ? 'fcm' : 'none');
  if (kind === 'none') return { kind };
  if (kind !== 'fcm') throw new Error(`PUSH must be "fcm" or "none", got "${kind}"`);
  if (!env.FCM_SERVICE_ACCOUNT) throw new Error('FCM_SERVICE_ACCOUNT (the path to a Firebase service-account key) is required with PUSH=fcm');
  const account = serviceAccountFrom(env.FCM_SERVICE_ACCOUNT, JSON.parse(readFileSync(env.FCM_SERVICE_ACCOUNT, 'utf8')));
  return {
    kind,
    ...account,
    sendUrl: `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
  };
}

export type BlobStoreConfig =
  | { kind: 'disk'; dir: string }
  | { kind: 's3'; bucket: string; region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string };

function blobStoreConfig(env: NodeJS.ProcessEnv): BlobStoreConfig {
  const kind = env.BLOB_STORE || 'disk';
  if (kind === 'disk') return { kind, dir: env.BLOB_DIR ?? './data/blobs' };
  if (kind !== 's3') throw new Error(`BLOB_STORE must be "disk" or "s3", got "${kind}"`);
  if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required with BLOB_STORE=s3');
  return {
    kind,
    bucket: env.S3_BUCKET,
    // Empty counts as unset (docker compose passes unset variables as "").
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    // Left out, the AWS SDK's default credential chain applies (env, profile, instance role).
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv, migrationsFolder: string): Config {
  // `||`, not `??`: Compose passes unset variables as empty strings (PORT="" would be port 0, a random one).
  const mode = env.MODE || 'self';
  if (mode !== 'self' && mode !== 'hosted') throw new Error(`MODE must be "self" or "hosted", got "${mode}"`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.RATE_LIMIT && env.RATE_LIMIT !== 'on' && env.RATE_LIMIT !== 'off') throw new Error(`RATE_LIMIT must be "on" or "off", got "${env.RATE_LIMIT}"`);
  return {
    databaseUrl: env.DATABASE_URL,
    port: Number(env.PORT || 8787),
    mode,
    migrationsFolder,
    blobs: blobStoreConfig(env),
    push: pushConfig(env, mode),
    rateLimit: env.RATE_LIMIT !== 'off',
    trustProxy: trustProxy(env.TRUST_PROXY),
    stores: storesConfig(env),
    metricsPort: env.METRICS_PORT === 'off' ? undefined : Number(env.METRICS_PORT || 8788),
  };
}

export const CONFIG = Symbol('CONFIG');
