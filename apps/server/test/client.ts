import { randomUUID } from 'node:crypto';
import {
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
  decryptFile,
  encryptFile,
  fromBase64,
  newIdentity,
  newSymmetricKey,
  openFamilyKey,
  pairingCode,
  recoveryIdentity,
  seal,
  sign,
  toBase64,
  verifyDeviceLog,
  type DeviceLogEntry,
  type DeviceLogState,
  type IdentityKeys,
} from '@kindred-log/shared/crypto';
import {
  authMessage,
  checkClaimMac,
  claimHashOf,
  claimKeyOf,
  claimMac,
  newInviteSecret,
  openRecord,
  sealRecord,
  type InviteQr,
  type InviteResponse,
  type KeysResponse,
  type LiveMessage,
  type PullResponse,
  type PushResponse,
  type RecordKind,
  type SyncRecord,
  type VerifyResponse,
} from '@kindred-log/shared/sync';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`${status}: ${message}`);
  }
}

/**
 * A simulated app: the whole client side of the protocol on top of the shared crypto. The real app's sync
 * engine follows the same steps.
 */
export class TestClient {
  deviceId: string = randomUUID();
  identity: IdentityKeys = newIdentity();
  familyId = '';
  token = '';
  familyKeys = new Map<number, Uint8Array>();
  currentEpoch = 1;
  lastSeq = 0;
  log: DeviceLogEntry[] = [];
  /** From the last refresh: members that lack some epochs (see `heal`). */
  missing: KeysResponse['missing'] = [];
  state: DeviceLogState | null = null;

  constructor(readonly server: string) {}

  async request<T>(method: string, path: string, body?: unknown, token = this.token): Promise<T> {
    const res = await fetch(`${this.server}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status, (json as { message?: string }).message ?? res.statusText);
    return json as T;
  }

  private get me(): { id: string; keys: IdentityKeys } {
    return { id: this.deviceId, keys: this.identity };
  }

  private keysOf(k: IdentityKeys) {
    return { sign: k.sign.publicKey, box: k.box.publicKey };
  }

  // --- family & auth ------------------------------------------------------------------------------------

  async createFamily() {
    this.familyId = randomUUID();
    const key = newSymmetricKey();
    const entry = appendEntry(
      null,
      0,
      this.me,
      { type: 'create', deviceId: this.deviceId, keys: this.keysOf(this.identity), familyKey: { epoch: 1, key } },
      Date.now(),
    );
    await this.request('POST', '/v1/families', {
      familyId: this.familyId,
      entry,
      sealedKey: toBase64(seal(this.identity.box.publicKey, key)),
    });
    await this.login();
    await this.refresh();
  }

  async login(identity = this.identity, who: { deviceId: string } | { recoverySignKey: string } = { deviceId: this.deviceId }) {
    const { challenge } = await this.request<{ challenge: string }>('POST', '/v1/auth/challenge', who, '');
    const res = await this.request<VerifyResponse>(
      'POST',
      '/v1/auth/verify',
      { challenge, signature: toBase64(sign(identity, authMessage(challenge))) },
      '',
    );
    this.token = res.token;
    this.familyId = res.familyId;
    return res;
  }

  /**
   * Re-reads and verifies the device log (it must continue the one seen before), then opens the family keys
   * sealed for this device, each checked against the log's commitment. The current epoch comes from the log.
   */
  async refresh(identity = this.identity) {
    const { entries } = await this.request<{ entries: DeviceLogEntry[] }>('GET', '/v1/families/me/log');
    assertLogContinues(entries, this.log.length ? { length: this.log.length, head: this.state!.head } : null);
    const state = verifyDeviceLog(entries);
    const keys = await this.request<KeysResponse>('GET', '/v1/keys');
    for (const k of keys.keys) {
      if (!this.familyKeys.has(k.epoch)) this.familyKeys.set(k.epoch, openFamilyKey(identity, state, k.epoch, fromBase64(k.sealed)));
    }
    this.state = state;
    this.log = entries;
    this.currentEpoch = state.epoch;
    this.missing = keys.missing;
  }

  /**
   * What every sync run does after refreshing: finish what another phone left half done. Grants epochs a member
   * lacks (sealed to its key from the verified log, never one the server names), and starts the epoch the log
   * says is owed (after a removal or a replaced recovery key).
   */
  async heal() {
    for (const { recipient, epochs } of this.missing) {
      const member = recipient === RECOVERY_SIGNER ? this.state!.recovery : this.state!.members.get(recipient);
      const keys = epochs.filter((e) => this.familyKeys.has(e));
      if (!member || !keys.length) continue;
      await this.request('POST', '/v1/keys/grant', {
        recipient,
        keys: keys.map((epoch) => ({ epoch, sealed: toBase64(seal(member.boxKey, this.familyKeys.get(epoch)!)) })),
      });
    }
    if (this.state!.rotationDue) await this.rotate();
    await this.refresh();
  }

  async append(change: Parameters<typeof appendEntry>[3], signer = this.me) {
    const entry = appendEntry(this.state, this.log.length, signer, change, Date.now());
    await this.request('POST', '/v1/families/me/log', { entry });
    this.log = [...this.log, entry];
    this.state = verifyDeviceLog(this.log);
  }

  /** Seals every epoch this client holds for another member (or the recovery key). */
  async grantAll(recipient: string, boxKey: Uint8Array) {
    const keys = [...this.familyKeys].map(([epoch, key]) => ({ epoch, sealed: toBase64(seal(boxKey, key)) }));
    await this.request('POST', '/v1/keys/grant', { recipient, keys });
  }

  // --- sync ---------------------------------------------------------------------------------------------

  seal(kind: RecordKind, id: string, body: unknown, opts: { deleted?: boolean; updatedAt?: number; blobs?: string[] } = {}): SyncRecord {
    const meta = { id, kind, updatedAt: opts.updatedAt ?? Date.now(), deviceId: this.deviceId, deleted: opts.deleted ?? false };
    const record = sealRecord(this.familyKeys.get(this.currentEpoch)!, this.currentEpoch, meta, body);
    return opts.blobs ? { ...record, blobs: opts.blobs } : record;
  }

  // --- blobs (photos) -----------------------------------------------------------------------------------

  /** Encrypts a file with a fresh key, uploads it and returns the reference that goes inside a record. */
  async uploadFile(data: Uint8Array) {
    const id = randomUUID();
    const key = newSymmetricKey();
    const res = await fetch(`${this.server}/v1/blobs/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${this.token}` },
      body: encryptFile(key, data) as Uint8Array<ArrayBuffer>,
    });
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return { id, key: toBase64(key) };
  }

  async downloadFile(ref: { id: string; key: string }) {
    const res = await fetch(`${this.server}/v1/blobs/${ref.id}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return decryptFile(fromBase64(ref.key), new Uint8Array(await res.arrayBuffer()));
  }

  push(records: SyncRecord[]) {
    return this.request<PushResponse>('POST', '/v1/sync/push', { records });
  }

  /** Pulls every page since the last seq and decrypts it. */
  async pull() {
    const out: { record: SyncRecord; body: unknown }[] = [];
    for (;;) {
      const page = await this.request<PullResponse>('GET', `/v1/sync/pull?since=${this.lastSeq}&limit=200`);
      for (const { seq: _, ...record } of page.records) out.push({ record, body: openRecord(this.familyKeys, record) });
      this.lastSeq = page.seq;
      if (!page.more) return out;
    }
  }

  // --- pairing ------------------------------------------------------------------------------------------

  /** Inviter: creates an invite and returns what the QR code shows, plus the secret kept on screen. */
  async invite(): Promise<{ qr: InviteQr; secret: Uint8Array }> {
    const secret = newInviteSecret();
    const inviteId = randomUUID();
    await this.request('POST', '/v1/invites', { inviteId, claimHash: claimHashOf(claimKeyOf(secret)) });
    return {
      secret,
      qr: { v: 1, s: this.server, i: inviteId, k: toBase64(secret), d: this.deviceId, p: toBase64(this.identity.sign.publicKey) },
    };
  }

  /** New device: claims the invite with its keys; returns the pairing code its screen shows. */
  async claim(qr: InviteQr) {
    const secret = fromBase64(qr.k);
    const { sign: signKey, box: boxKey } = this.keysOf(this.identity);
    await this.request(
      'POST',
      `/v1/invites/${qr.i}/claim`,
      {
        claimKey: toBase64(claimKeyOf(secret)),
        deviceId: this.deviceId,
        signKey: toBase64(signKey),
        boxKey: toBase64(boxKey),
        mac: claimMac(secret, this.deviceId, signKey, boxKey),
      },
      '',
    );
    return pairingCode(fromBase64(qr.p), signKey, secret);
  }

  /** Inviter: checks the claim, returns its pairing code, and (after the user confirms) adds the device. */
  async reviewClaim(inviteId: string, secret: Uint8Array) {
    const invite = await this.request<InviteResponse>('GET', `/v1/invites/${inviteId}`);
    const claimant = invite.claimant!;
    if (!checkClaimMac(secret, claimant)) throw new Error('Claim was tampered with');
    const code = pairingCode(this.identity.sign.publicKey, fromBase64(claimant.signKey), secret);
    const approve = async () => {
      await this.append({ type: 'add', deviceId: claimant.deviceId, keys: { sign: fromBase64(claimant.signKey), box: fromBase64(claimant.boxKey) } });
      await this.grantAll(claimant.deviceId, fromBase64(claimant.boxKey));
    };
    return { code, approve };
  }

  /** New device: once approved, logs in and checks that the inviter from the QR code really is a member. */
  async finishJoin(qr: InviteQr) {
    const status = await this.request<InviteResponse>('POST', `/v1/invites/${qr.i}/status`, { claimKey: toBase64(claimKeyOf(fromBase64(qr.k))) }, '');
    if (status.status !== 'approved') return false;
    await this.login();
    await this.refresh();
    const inviter = this.state!.members.get(qr.d);
    if (!inviter || toBase64(inviter.signKey) !== qr.p) throw new Error('Inviter is not in the device log');
    return true;
  }

  // --- removal & recovery -------------------------------------------------------------------------------

  /** Removes a device and starts a new key epoch sealed to everyone left. */
  async removeDevice(deviceId: string) {
    await this.append({ type: 'remove', deviceId });
    await this.rotate();
  }

  /** Starts the next epoch: its log entry commits to the new key, which is sealed to every member left. */
  async rotate() {
    const key = newSymmetricKey();
    const epoch = this.state!.epoch + 1;
    const entry = appendEntry(this.state, this.log.length, this.me, { type: 'epoch', deviceId: this.deviceId, familyKey: { epoch, key } }, Date.now());
    const sealed: Record<string, string> = {};
    for (const [id, member] of this.state!.members) sealed[id] = toBase64(seal(member.boxKey, key));
    if (this.state!.recovery) sealed[RECOVERY_SIGNER] = toBase64(seal(this.state!.recovery.boxKey, key));
    await this.request('POST', '/v1/keys/rotate', { entry, sealed });
    this.log = [...this.log, entry];
    this.state = verifyDeviceLog(this.log);
    this.familyKeys.set(epoch, key);
    this.currentEpoch = epoch;
  }

  async setRecovery(words: string) {
    const recovery = recoveryIdentity(words);
    await this.append({ type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: this.keysOf(recovery) });
    await this.grantAll(RECOVERY_SIGNER, recovery.box.publicKey);
  }

  /** A fresh install with only the recovery words: log in as the recovery key, enroll itself, log in as itself. */
  async recover(words: string) {
    const recovery = recoveryIdentity(words);
    await this.login(recovery, { recoverySignKey: toBase64(recovery.sign.publicKey) });
    await this.refresh(recovery);
    await this.append(
      { type: 'add', deviceId: this.deviceId, keys: this.keysOf(this.identity) },
      { id: RECOVERY_SIGNER, keys: recovery },
    );
    await this.grantAll(this.deviceId, this.identity.box.publicKey);
    this.familyKeys.clear();
    await this.login();
    await this.refresh();
  }

  // --- live ---------------------------------------------------------------------------------------------

  /** Opens the live socket; resolves once connected. */
  async live() {
    const messages: LiveMessage[] = [];
    const ws = new WebSocket(`${this.server.replace(/^http/, 'ws')}/v1/live?token=${this.token}`);
    ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)) as LiveMessage);
    let closeCode = 0;
    ws.onclose = (e) => (closeCode = e.code);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('socket error'));
    });
    return { messages, close: () => ws.close(), closeCode: () => closeCode };
  }
}
