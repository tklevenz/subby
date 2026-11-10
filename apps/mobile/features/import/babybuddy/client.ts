import { t } from '@subby/shared/i18n';
import type { BBChild, BBEndpoint, BBRecords } from '@subby/shared';

type Page<T> = { count: number; next: string | null; results: T[] };

export class BBError extends Error {}

/** Normalize user input like "bb.example.com/" to "https://bb.example.com". */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '').replace(/\/api$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Host part of a base URL (used in import refs, so re-imports from the same server match). */
export const hostOf = (baseUrl: string) => baseUrl.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

/** Minimal read-only Baby Buddy REST client (token auth, limit/offset paging). */
export class BBClient {
  readonly baseUrl: string;
  readonly host: string;

  constructor(url: string, private readonly token: string) {
    this.baseUrl = normalizeBaseUrl(url);
    this.host = hostOf(this.baseUrl);
  }

  private async get<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}/api/${pathOrUrl}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Token ${this.token.trim()}`, Accept: 'application/json' } });  // i18n-ignore
    } catch {
      throw new BBError(t('bb.error.unreachable', { host: this.host }));
    }
    if (res.status === 401 || res.status === 403) throw new BBError(t('bb.error.rejected'));
    if (res.status === 404) throw new BBError(t('bb.error.notBB', { host: this.host }));
    if (!res.ok) throw new BBError(t('bb.error.http', { status: String(res.status) }));
    try {
      return (await res.json()) as T;
    } catch {
      throw new BBError(t('bb.error.notData', { host: this.host }));
    }
  }

  /** Verifies URL + token. */
  async profile(): Promise<unknown> {
    return this.get('profile');
  }

  async children(): Promise<BBChild[]> {
    const all: BBChild[] = [];
    for await (const page of this.pagesOf<BBChild>('children', 100)) all.push(...page.results);
    return all;
  }

  async count(endpoint: BBEndpoint): Promise<number> {
    return (await this.get<Page<unknown>>(`${endpoint}/?limit=1`)).count;
  }

  /** Most recent `limit` records (Baby Buddy lists newest first). */
  async sample<E extends BBEndpoint>(endpoint: E, limit = 50): Promise<BBRecords[E][]> {
    return (await this.get<Page<BBRecords[E]>>(`${endpoint}/?limit=${limit}`)).results;
  }

  /** All records of an endpoint, page by page (following `next`). */
  pages<E extends BBEndpoint>(endpoint: E, pageSize = 500): AsyncGenerator<Page<BBRecords[E]>> {
    return this.pagesOf<BBRecords[E]>(endpoint, pageSize);
  }

  private async *pagesOf<T>(path: string, pageSize: number): AsyncGenerator<Page<T>> {
    let offset: number | null = 0;
    while (offset !== null) {
      const page: Page<T> = await this.get(`${path}/?limit=${pageSize}&offset=${offset}`);
      yield page;
      offset = nextOffset(page.next, offset);
    }
  }
}

/**
 * The offset of the next page, from Baby Buddy's `next` link. Only its offset is used: behind a reverse proxy BB may
 * report its internal origin (e.g. http://), and the token must never follow a link elsewhere. null at the end, or
 * when the link doesn't move forward (so a broken server can't loop the import).
 */
export function nextOffset(next: string | null, current: number): number | null {
  if (!next) return null;
  // A regex, not URL.searchParams (not available in every React Native version).
  const match = /[?&]offset=(\d{1,15})(?:&|#|$)/.exec(next);
  const offset = match ? Number(match[1]) : NaN;
  return offset > current ? offset : null;
}
