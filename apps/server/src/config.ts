export type Config = {
  databaseUrl: string;
  port: number;
  /** `self`: self-hosted, no limits, no push. `hosted`: the official Kindred Sync service. */
  mode: 'self' | 'hosted';
  migrationsFolder: string;
  /** Where encrypted files (photos) go: a local folder, or S3-compatible object storage. */
  blobs: BlobStoreConfig;
  /** Background "sync now" pings. On by default for hosted, off for self-hosted (no push credentials). */
  push: { kind: 'none' } | { kind: 'expo'; url: string; accessToken?: string };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function pushConfig(env: NodeJS.ProcessEnv, mode: Config['mode']): Config['push'] {
  const kind = env.PUSH ?? (mode === 'hosted' ? 'expo' : 'none');
  if (kind === 'none') return { kind };
  if (kind !== 'expo') throw new Error(`PUSH must be "expo" or "none", got "${kind}"`);
  return { kind, url: env.EXPO_PUSH_URL ?? EXPO_PUSH_URL, accessToken: env.EXPO_ACCESS_TOKEN };
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
