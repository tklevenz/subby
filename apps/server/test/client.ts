import { randomUUID } from 'node:crypto';
import {
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
  decryptFile,
  encryptFile,
  fromBase64,
  movedFamilyLog,
  newIdentity,
  newSymmetricKey,
  openFamilyKey,
  pairingCode,
  recoveryIdentity,
  seal,
  sign,
  toBase64,
  verifyDeviceLog,
  verifyMovedLog,
  withinEpoch,
  type DeviceLogEntry,
  type DeviceLogState,
  type IdentityKeys,
} from '@subby/shared/crypto';
import {
  authMessage,
  checkClaimMac,
  claimHashOf,
  claimKeyOf,
  claimMac,
  newInviteSecret,
  UnsealedRecordError,
  openRecord,
  sealRecord,
  type InviteQr,
  type InviteResponse,
  type KeysResponse,
  type LiveMessage,
  type MovedBody,
  type PullResponse,
  type PushResponse,
  type RecordKind,
  type SyncRecord,
  type VerifyResponse,
} from '@subby/shared/sync';

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

  /** Ids of pulled records refused as not genuine (see `pull`). */
  rejected: string[] = [];

  /**
   * Pulls every page since the last seq and decrypts it. Refuses (and lists in `rejected`) what can't be genuine:
   * a seq outside the page, a record of an old epoch past the seq the log closed it at, an unsealed tombstone.
   */
  async pull() {
    const out: { record: SyncRecord; body: unknown }[] = [];
    for (;;) {
      const since = this.lastSeq;
      const page = await this.request<PullResponse>('GET', `/v1/sync/pull?since=${since}&limit=200`);
      for (const { seq, ...record } of page.records) {
        if (seq <= since || seq > page.seq || !withinEpoch(this.state!, record.epoch, seq)) {
          this.rejected.push(record.id);
          continue;
        }
        try {
          out.push({ record, body: openRecord(this.familyKeys, record) });
        } catch (e) {
          if (!(e instanceof UnsealedRecordError)) throw e;
          this.rejected.push(record.id);
        }
      }
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

  /** Removes several devices with one new epoch (the app does this for the lost phones after a recovery). */
  async removeDevices(deviceIds: string[]) {
    for (const deviceId of deviceIds) await this.append({ type: 'remove', deviceId });
    await this.rotate();
  }

  /**
   * Starts the next epoch: its log entry commits to the new key, which is sealed to every member left, and closes
   * the old epochs at the seq this client has pulled to. The server takes it only if that's the family's latest,
   * so this pulls first (and again if another phone pushed in between).
   */
  async rotate() {
    const key = newSymmetricKey();
    const epoch = this.state!.epoch + 1;
    const sealed: Record<string, string> = {};
    for (const [id, member] of this.state!.members) sealed[id] = toBase64(seal(member.boxKey, key));
    if (this.state!.recovery) sealed[RECOVERY_SIGNER] = toBase64(seal(this.state!.recovery.boxKey, key));
    let entry: DeviceLogEntry;
    for (let attempt = 1; ; attempt++) {
      await this.pull();
      entry = appendEntry(this.state, this.log.length, this.me, { type: 'epoch', deviceId: this.deviceId, familyKey: { epoch, key }, closedSeq: this.lastSeq }, Date.now());
      try {
        await this.request('POST', '/v1/keys/rotate', { entry, sealed });
        break;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 409) || attempt === 3) throw e;
      }
    }
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

  // --- moving to another server (the app's features/sync/move.ts) ------------------------------------------

  /**
   * Moves the family to `server`: a new family there with the same phones and recovery key, the photos `blobs`
   * uploaded under their ids and keys, then a `moved` record for the old family, and this phone leaves it.
   * Returns this phone in the new family; its records still have to be pushed there.
   */
  async moveTo(server: string, blobs: { id: string; key: string; data: Uint8Array }[] = []) {
    await this.pull();
    await this.refresh();
    const key = newSymmetricKey();
    const log = movedFamilyLog(this.state!, this.me, key, Date.now());
    const next = new TestClient(server);
    next.deviceId = this.deviceId;
    next.identity = this.identity;
    const familyId = randomUUID();
    await next.request('POST', '/v1/families', { familyId, entry: log[0], sealedKey: toBase64(seal(this.identity.box.publicKey, key)) });
    await next.login();
    for (const entry of log.slice(1)) await next.request('POST', '/v1/families/me/log', { entry });
    const state = verifyDeviceLog(log);
    for (const [id, m] of state.members) {
      if (id !== this.deviceId) await next.request('POST', '/v1/keys/grant', { recipient: id, keys: [{ epoch: 1, sealed: toBase64(seal(m.boxKey, key)) }] });
    }
    if (state.recovery) await next.request('POST', '/v1/keys/grant', { recipient: RECOVERY_SIGNER, keys: [{ epoch: 1, sealed: toBase64(seal(state.recovery.boxKey, key)) }] });
    for (const b of blobs) {
      const res = await fetch(`${server}/v1/blobs/${b.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${next.token}` },
        body: encryptFile(fromBase64(b.key), b.data) as Uint8Array<ArrayBuffer>,
      });
      if (!res.ok) throw new HttpError(res.status, res.statusText);
    }
    const moved: MovedBody = { server, familyId, from: this.deviceId, seq: this.lastSeq, entries: log.length };
    await this.push([this.seal('moved', familyId, moved)]);
    await this.append({ type: 'remove', deviceId: this.deviceId });
    await next.refresh();
    return next;
  }

  /**
   * Another phone moved the family: finds its `moved` record, checks the new log against the old one, and joins
   * the new family as itself. Returns this phone there, and the ids it wrote to the old family after the move.
   */
  async follow() {
    const pulled = await this.pull();
    const record = pulled.find((p) => p.record.kind === 'moved');
    if (!record) throw new Error('No move to follow');
    const move = record.body as MovedBody;
    const next = new TestClient(move.server);
    next.deviceId = this.deviceId;
    next.identity = this.identity;
    await next.login();
    const { entries } = await next.request<{ entries: DeviceLogEntry[] }>('GET', '/v1/families/me/log');
    const { entries: oldEntries } = await this.request<{ entries: DeviceLogEntry[] }>('GET', '/v1/families/me/log');
    verifyMovedLog(oldEntries, entries, move.from, this.deviceId, move.entries);
    await next.refresh();
    const resend: string[] = [];
    const since = this.lastSeq;
    this.lastSeq = move.seq;
    for (const p of await this.pull()) if (p.record.deviceId === this.deviceId && p.record.kind !== 'moved') resend.push(p.record.id);
    this.lastSeq = since;
    await this.refresh();
    await this.append({ type: 'remove', deviceId: this.deviceId });
    return { next, resend };
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
