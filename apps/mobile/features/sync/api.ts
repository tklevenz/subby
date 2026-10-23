import { sign, toBase64, type DeviceLogEntry, type IdentityKeys } from '@kindred-log/shared/crypto';
import {
  authMessage,
  type ChallengeResponse,
  type KeysResponse,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
  type VerifyResponse,
} from '@kindred-log/shared/sync';

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Normalizes what people type: no trailing slash, https:// assumed when no scheme is given. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function call<T>(server: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncHttpError(0, `Can't reach ${server}`);
  }
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new SyncHttpError(res.status, json.message ?? `Server error ${res.status}`);
  return json as T;
}

/** Checks that a URL is a Kindred Sync server this app can talk to. */
export async function checkServer(server: string) {
  const info = await call<{ service?: string; protocol?: number; mode?: string }>(server, 'GET', '/v1/info');
  if (info.service !== 'kindred-sync') throw new Error('That address is not a Kindred Sync server');
  if (info.protocol !== 1) throw new Error('This server needs a newer version of the app');
  return info;
}

export const createFamily = (server: string, body: { familyId: string; entry: DeviceLogEntry; sealedKey: string }) =>
  call<{ familyId: string }>(server, 'POST', '/v1/families', body);

/**
 * An authenticated session for one device. Logs in by signing a challenge, and logs in again once when
 * the token expired or was revoked.
 */
export class SyncSession {
  private token: string | null = null;

  constructor(
    readonly server: string,
    readonly deviceId: string,
    private readonly identity: IdentityKeys,
  ) {}

  async login(): Promise<VerifyResponse> {
    const { challenge } = await call<ChallengeResponse>(this.server, 'POST', '/v1/auth/challenge', { deviceId: this.deviceId });
    const res = await call<VerifyResponse>(this.server, 'POST', '/v1/auth/verify', {
      challenge,
      signature: toBase64(sign(this.identity, authMessage(challenge))),
    });
    this.token = res.token;
    return res;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) await this.login();
    try {
      return await call<T>(this.server, method, path, body, this.token!);
    } catch (e) {
      if (!(e instanceof SyncHttpError) || e.status !== 401) throw e;
      await this.login();
      return call<T>(this.server, method, path, body, this.token!);
    }
  }

  log = () => this.request<{ entries: DeviceLogEntry[] }>('GET', '/v1/families/me/log');
  keys = () => this.request<KeysResponse>('GET', '/v1/keys');
  push = (records: SyncRecord[]) => this.request<PushResponse>('POST', '/v1/sync/push', { records });
  pull = (since: number) => this.request<PullResponse>('GET', `/v1/sync/pull?since=${since}&limit=500`);

  /** WebSocket URL for live notifications (needs a fresh token). */
  async liveUrl() {
    if (!this.token) await this.login();
    return `${this.server.replace(/^http/i, 'ws')}/v1/live?token=${encodeURIComponent(this.token!)}`;
  }
}
