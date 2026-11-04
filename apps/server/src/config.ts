import { readFileSync } from 'node:fs';

export type Config = {
  databaseUrl: string;
  port: number;
  /** `self`: self-hosted, no limits, no push. `hosted`: the official Subby Sync service. */
  mode: 'self' | 'hosted';
  migrationsFolder: string;
  /** Where encrypted files (photos) go: a local folder, or S3-compatible object storage. */
  blobs: BlobStoreConfig;
  /** Background "sync now" pings through Firebase Cloud Messaging. On by default for hosted. */
  push: { kind: 'none' } | FcmConfig;
};

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
  const key = JSON.parse(readFileSync(env.FCM_SERVICE_ACCOUNT, 'utf8')) as Record<string, string | undefined>;
  if (!key.project_id || !key.client_email || !key.private_key) throw new Error(`${env.FCM_SERVICE_ACCOUNT} isn't a service-account key`);
  return {
    kind,
    projectId: key.project_id,
    clientEmail: key.client_email,
    privateKey: key.private_key,
    tokenUri: key.token_uri ?? 'https://oauth2.googleapis.com/token',
    sendUrl: `https://fcm.googleapis.com/v1/projects/${key.project_id}/messages:send`,
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
  const mode = env.MODE ?? 'self';
  if (mode !== 'self' && mode !== 'hosted') throw new Error(`MODE must be "self" or "hosted", got "${mode}"`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return { databaseUrl: env.DATABASE_URL, port: Number(env.PORT ?? 8787), mode, migrationsFolder, blobs: blobStoreConfig(env), push: pushConfig(env, mode) };
}

export const CONFIG = Symbol('CONFIG');
