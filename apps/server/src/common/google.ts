import { createSign } from 'node:crypto';

/** A Google service account (a key file from the Cloud console or Firebase). */
export type GoogleServiceAccount = {
  clientEmail: string;
  privateKey: string;
  /** Where the signed JWT is traded for an access token (the key's `token_uri`). */
  tokenUri: string;
};

/**
 * OAuth access tokens for one service account and scope, from a JWT signed with its key (`node:crypto`, no
 * Google SDK); reused until shortly before they expire.
 */
export class GoogleAuth {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: GoogleServiceAccount,
    private readonly scope: string,
  ) {}

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 5 * 60_000) return this.cached.token;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.account.clientEmail,
      scope: this.scope,
      aud: this.account.tokenUri,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.privateKey, 'base64url');
    const res = await fetch(this.account.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    if (!res.ok) throw new Error(`Google OAuth answered ${res.status}: ${await res.text().catch(() => '')}`);
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
    return access_token;
  }
}

/** Reads a service-account key file's fields (throws naming the file if it isn't one). */
export function serviceAccountFrom(path: string, key: Record<string, string | undefined>): GoogleServiceAccount & { projectId: string } {
  if (!key.project_id || !key.client_email || !key.private_key) throw new Error(`${path} isn't a service-account key`);
  return { projectId: key.project_id, clientEmail: key.client_email, privateKey: key.private_key, tokenUri: key.token_uri ?? 'https://oauth2.googleapis.com/token' };
}
