import { fetch as expoFetch } from 'expo/fetch';
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
  const info = await call<{ service?: string; protocol?: number; mode?: string; push?: boolean }>(server, 'GET', '/v1/info');
  if (info.service !== 'kindred-sync') throw new Error('That address is not a Kindred Sync server');
  if (info.protocol !== 1) throw new Error('This server needs a newer version of the app');
  return info;
}

export const createFamily = (server: string, body: { familyId: string; entry: DeviceLogEntry; sealedKey: string }) =>
  call<{ familyId: string }>(server, 'POST', '/v1/families', body);

/**
 * An authenticated session for one device (or, with `asRecovery`, for the recovery key, which may only
 * read the log and keys and enroll a phone). Logs in by signing a challenge, and logs in again once when
 * the token expired or was revoked.
 */
export class SyncSession {
  private token: string | null = null;

  constructor(
    readonly server: string,
    readonly deviceId: string,
    private readonly identity: IdentityKeys,
    private readonly asRecovery = false,
  ) {}

  async login(): Promise<VerifyResponse> {
    const who = this.asRecovery ? { recoverySignKey: toBase64(this.identity.sign.publicKey) } : { deviceId: this.deviceId };
    const { challenge } = await call<ChallengeResponse>(this.server, 'POST', '/v1/auth/challenge', who);
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

  /** Uploads an encrypted file. Uses expo/fetch, which sends and receives raw bytes natively. */
  putBlob = (id: string, data: Uint8Array) =>
    this.raw(() =>
      expoFetch(`${this.server}/v1/blobs/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${this.token}` },
        body: data as Uint8Array<ArrayBuffer>,
      }),
    ).then(() => undefined);

  /** Downloads an encrypted file; null when the server no longer has it (its record moved on). */
  getBlob = async (id: string): Promise<Uint8Array | null> => {
    try {
      const res = await this.raw(() => expoFetch(`${this.server}/v1/blobs/${id}`, { headers: { authorization: `Bearer ${this.token}` } }));
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof SyncHttpError && e.status === 404) return null;
      throw e;
    }
  };

  private async raw<R extends { ok: boolean; status: number }>(send: () => Promise<R>): Promise<R> {
    if (!this.token) await this.login();
    const attempt = async () => {
      let res: R;
      try {
        res = await send();
      } catch {
        throw new SyncHttpError(0, `Can't reach ${this.server}`);
      }
      if (!res.ok) throw new SyncHttpError(res.status, `Server error ${res.status}`);
      return res;
    };
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof SyncHttpError) || e.status !== 401) throw e;
      await this.login();
      return attempt();
    }
  }

  /** WebSocket URL for live notifications (needs a fresh token). */
  async liveUrl() {
    if (!this.token) await this.login();
    return `${this.server.replace(/^http/i, 'ws')}/v1/live?token=${encodeURIComponent(this.token!)}`;
  }
}
