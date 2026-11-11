import { t } from '@subby/shared/i18n';
import { fetch as expoFetch } from 'expo/fetch';
import { seal, sign, toBase64, type DeviceLogEntry, type IdentityKeys } from '@subby/shared/crypto';
import {
  authMessage,
  type ChallengeResponse,
  type KeysResponse,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
  type VerifyResponse,
} from '@subby/shared/sync';

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Whether `e` is an HTTP error from the server, with one of `statuses` (any status when none are given; 0 is "unreachable"). */
export const isHttpError = (e: unknown, ...statuses: number[]): e is SyncHttpError =>
  e instanceof SyncHttpError && (statuses.length === 0 || statuses.includes(e.status));

/** Records per pull page. */
const PULL_PAGE = 500;

/** The official Subby Sync server (hosted, paid after the trial). Any other address is a self-hosted one. */
export const OFFICIAL_SERVER = 'https://sync.subby.baby';
export const isOfficialServer = (server: string) => normalizeServerUrl(server) === OFFICIAL_SERVER;

/** How a server is named to people: "Subby Sync" for the official one, else its address without the scheme. */
export const serverLabel = (server: string) => (isOfficialServer(server) ? 'Subby Sync' : server.replace(/^https?:\/\//, ''));

/** A family key (or any key) sealed to a public box key, as the server stores it. */
export const sealTo = (boxKey: Uint8Array, key: Uint8Array) => toBase64(seal(boxKey, key));

/** Every family key by epoch, sealed to one recipient, in the shape `grant` takes. */
export const sealEpochs = (boxKey: Uint8Array, keys: Iterable<[number, Uint8Array]>) =>
  [...keys].map(([epoch, key]) => ({ epoch, sealed: sealTo(boxKey, key) }));

/** Normalizes what people type: no trailing slash, https:// assumed when no scheme is given. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function call<T>(server: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
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
    throw new SyncHttpError(0, t('sync.error.unreachable', { server }));
  }
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new SyncHttpError(res.status, json.message ?? t('sync.error.server', { status: String(res.status) }));
  return json as T;
}

/** Checks that a URL is a Subby Sync server this app can talk to. */
export async function checkServer(server: string) {
  const info = await call<{ service?: string; protocol?: number; mode?: string; push?: boolean; testPurchases?: boolean }>(server, 'GET', '/v1/info');
  if (info.service !== 'subby-sync') throw new Error(t('sync.error.notSubby'));
  if (info.protocol !== 1) throw new Error(t('sync.error.newerApp'));
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

  /** Sends with the current token (logging in first if there is none), and once more after a new login on a 401. */
  private async authed<R>(send: (token: string) => Promise<R>): Promise<R> {
    if (!this.token) await this.login();
    try {
      return await send(this.token!);
    } catch (e) {
      if (!isHttpError(e, 401)) throw e;
      await this.login();
      return send(this.token!);
    }
  }

  request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.authed((token) => call<T>(this.server, method, path, body, token));
  }

  log = () => this.request<{ entries: DeviceLogEntry[] }>('GET', '/v1/families/me/log');
  /** Gives back log entries the server lost (restored from a backup), signed as they were. */
  restoreLog = (entries: DeviceLogEntry[]) => this.request<{ index: number }>('POST', '/v1/families/me/log/restore', { entries });
  /** Appends a signed entry to the family's device log. */
  appendLog = (entry: DeviceLogEntry) => this.request<{ index: number }>('POST', '/v1/families/me/log', { entry });
  keys = () => this.request<KeysResponse>('GET', '/v1/keys');
  /** Seals family keys to a member (or the recovery key). */
  grant = (recipient: string, keys: { epoch: number; sealed: string }[]) => this.request<unknown>('POST', '/v1/keys/grant', { recipient, keys });
  /** Starts a new epoch: the signed entry and the new key sealed to every member and the recovery key. */
  rotate = (entry: DeviceLogEntry, sealed: Record<string, string>) => this.request<unknown>('POST', '/v1/keys/rotate', { entry, sealed });
  /** Deletes the family and everything the server holds for it. */
  deleteFamily = () => this.request<unknown>('DELETE', '/v1/families/me');
  push = (records: SyncRecord[]) => this.request<PushResponse>('POST', '/v1/sync/push', { records });
  pull = (since: number) => this.request<PullResponse>('GET', `/v1/sync/pull?since=${since}&limit=${PULL_PAGE}`);

  /** Uploads an encrypted file. Uses expo/fetch, which sends and receives raw bytes natively. */
  putBlob = (id: string, data: Uint8Array) =>
    this.raw((token) =>
      expoFetch(`${this.server}/v1/blobs/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
        body: data as Uint8Array<ArrayBuffer>,
      }),
    ).then(() => undefined);

  /** Downloads an encrypted file; null when the server no longer has it (its record moved on). */
  getBlob = async (id: string): Promise<Uint8Array | null> => {
    try {
      const res = await this.raw((token) => expoFetch(`${this.server}/v1/blobs/${id}`, { headers: { authorization: `Bearer ${token}` } }));
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (isHttpError(e, 404)) return null;
      throw e;
    }
  };

  private raw<R extends { ok: boolean; status: number }>(send: (token: string) => Promise<R>): Promise<R> {
    return this.authed(async (token) => {
      let res: R;
      try {
        res = await send(token);
      } catch {
        throw new SyncHttpError(0, t('sync.error.unreachable', { server: this.server }));
      }
      if (!res.ok) throw new SyncHttpError(res.status, t('sync.error.server', { status: String(res.status) }));
      return res;
    });
  }

  /** WebSocket URL for live notifications (needs a fresh token). */
  async liveUrl() {
    if (!this.token) await this.login();
    return `${this.server.replace(/^http/i, 'ws')}/v1/live?token=${encodeURIComponent(this.token!)}`;
  }
}
