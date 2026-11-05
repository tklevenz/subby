import { execFileSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A stand-in for Apple's StoreKit signing: a root CA, a "WWDR" intermediate and a leaf with Apple's marker
 * extensions, made with the openssl CLI. `sign` makes a JWS like StoreKit 2's `jwsRepresentation`.
 */
export function appleTestSigner(opts: { markers?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kl-apple-'));
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const markers = opts.markers ?? true;
  try {
    for (const name of ['root', 'int', 'leaf']) run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}.key`);
    writeFileSync(join(dir, 'int.ext'), `basicConstraints=critical,CA:true\n${markers ? '1.2.840.113635.100.6.2.1=ASN1:NULL\n' : ''}`);
    writeFileSync(join(dir, 'leaf.ext'), `basicConstraints=critical,CA:false\n${markers ? '1.2.840.113635.100.6.11.1=ASN1:NULL\n' : ''}`);
    writeFileSync(join(dir, 'root.ext'), 'basicConstraints=critical,CA:true\n');
    run('req', '-new', '-key', 'root.key', '-subj', '/CN=Test Root CA', '-out', 'root.csr');
    run('x509', '-req', '-in', 'root.csr', '-signkey', 'root.key', '-days', '30', '-sha256', '-extfile', 'root.ext', '-out', 'root.pem');
    run('req', '-new', '-key', 'int.key', '-subj', '/CN=Test WWDR', '-out', 'int.csr');
    run('x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'int.ext', '-out', 'int.pem');
    run('req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test StoreKit', '-out', 'leaf.csr');
    run('x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'leaf.ext', '-out', 'leaf.pem');
    const der = (pem: string) => run('x509', '-in', pem, '-outform', 'der').toString('base64');
    const x5c = [der('leaf.pem'), der('int.pem'), der('root.pem')];
    const rootPem = readFileSync(join(dir, 'root.pem'), 'utf8');
    const leafKey = readFileSync(join(dir, 'leaf.key'), 'utf8');
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    return {
      rootPem,
      sign(payload: object) {
        const unsigned = `${b64({ alg: 'ES256', x5c })}.${b64(payload)}`;
        return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: leafKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
