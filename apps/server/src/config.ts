export type Config = {
  databaseUrl: string;
  port: number;
  /** `self`: self-hosted, no limits, no push. `hosted`: the official Kindred Sync service. */
  mode: 'self' | 'hosted';
  migrationsFolder: string;
};

export function loadConfig(env: NodeJS.ProcessEnv, migrationsFolder: string): Config {
  const mode = env.MODE ?? 'self';
  if (mode !== 'self' && mode !== 'hosted') throw new Error(`MODE must be "self" or "hosted", got "${mode}"`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return { databaseUrl: env.DATABASE_URL, port: Number(env.PORT ?? 8787), mode, migrationsFolder };
}

export const CONFIG = Symbol('CONFIG');
