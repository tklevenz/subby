import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

/** An APNs auth key (Certificates, IDs & Profiles → Keys, with "Apple Push Notifications service"). */
export type ApnsConfig = {
  /** The key's id (10 characters, shown with the key). */
  keyId: string;
  /** The Apple developer team id. */
  teamId: string;
  /** The `.p8` key (PEM). */
  privateKey: string;
  /** The app's bundle id. */
  topic: string;
  /** Production APNs; tokens from App Store and TestFlight builds. */
  url: string;
  /** Sandbox APNs; tokens from development-signed builds. */
  sandboxUrl: string;
};

export type ApnsResult = { sent: true } | { sent: false; gone: boolean; status: number; reason?: string };

/** Apple accepts a provider token for an hour and refuses new ones more often than every 20 minutes. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Sends background pushes ("sync now", nothing shown) over HTTP/2 with a token signed by the `.p8` key (ES256),
 * one connection per host, reused. A token Apple doesn't know in production is tried in the sandbox (builds signed
 * for development get sandbox tokens), so the app needn't say which it is.
 */
export class ApnsSender {
  private readonly key: KeyObject;
  private jwt: { value: string; at: number } | null = null;
  private readonly sessions = new Map<string, ClientHttp2Session>();

  constructor(private readonly config: ApnsConfig) {
    this.key = createPrivateKey(config.privateKey);
  }

  async wake(token: string): Promise<ApnsResult> {
    const prod = await this.send(this.config.url, token);
    if (prod.sent || prod.reason !== 'BadDeviceToken') return prod;
    return this.send(this.config.sandboxUrl, token);
  }

  close() {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }

  private providerToken() {
    const now = Date.now();
    if (this.jwt && now - this.jwt.at < TOKEN_TTL_MS) return this.jwt.value;
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${part({ alg: 'ES256', kid: this.config.keyId })}.${part({ iss: this.config.teamId, iat: Math.floor(now / 1000) })}`;
    const sig = sign('sha256', Buffer.from(input), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.jwt = { value: `${input}.${sig}`, at: now };
    return this.jwt.value;
  }

  private session(url: string) {
    const open = this.sessions.get(url);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(url);
    const drop = () => {
      if (this.sessions.get(url) === session) this.sessions.delete(url);
    };
    session.on('error', drop);
    session.on('close', drop);
    session.on('goaway', drop);
    session.unref();
    this.sessions.set(url, session);
    return session;
  }

  private send(url: string, token: string): Promise<ApnsResult> {
    return new Promise((resolve, reject) => {
      const req = this.session(url).request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${encodeURIComponent(token)}`,
        authorization: `bearer ${this.providerToken()}`,
        'apns-topic': this.config.topic,
        // A background push: the app runs its task, nothing is shown. Apple requires priority 5 for these.
        'apns-push-type': 'background',
        'apns-priority': '5',
        'content-type': 'application/json',
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.close(constants.NGHTTP2_CANCEL));
      let status = 0;
      let body = '';
      req.on('response', (headers) => (status = Number(headers[constants.HTTP2_HEADER_STATUS])));
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (body += chunk));
      req.on('error', reject);
      req.on('close', () => {
        if (!status) return reject(new Error('APNs closed the request without an answer'));
        if (status === 200) return resolve({ sent: true });
        let reason: string | undefined;
        try {
          reason = (JSON.parse(body) as { reason?: string }).reason;
        } catch {}
        // 410: the app was uninstalled or the token expired. 400 BadDeviceToken (in both environments): not a token.
        resolve({ sent: false, gone: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered', status, reason });
      });
      req.end(JSON.stringify({ aps: { 'content-available': 1 }, kind: 'sync' }));
    });
  }
}
