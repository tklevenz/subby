import { createServer, type Server } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { count, isNotNull, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DB, schema, type Db } from '../db/db';
import { Entitlements } from '../sync/entitlements';

type Counts = { requests: number; client: number; server: number; ms: number };

/**
 * Counters for running the server (LAUNCH.md S7), in memory since the process started: requests per route and
 * outcome, pushes, purchase checks. Routes are the router's patterns (`/v1/blobs/:id`), never the URL itself, and
 * nothing names a family, a phone or an IP. Served as Prometheus text on a port bound to the container's own
 * loopback (`metricsPort`), so neither Caddy nor the internet can reach it; `monitor.sh` reads it with
 * `docker compose exec`.
 */
@Injectable()
export class Metrics {
  readonly startedAt = Date.now();
  private readonly routes = new Map<string, Counts>();
  private readonly events = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
  ) {}

  /** One answered request. `route` is the matched pattern, or null for a URL no route has (scanners, mostly). */
  request(method: string, route: string | null, status: number, ms: number) {
    const key = route ? `${method} ${route}` : 'unmatched';
    const c = this.routes.get(key) ?? { requests: 0, client: 0, server: 0, ms: 0 };
    c.requests++;
    if (status >= 500) c.server++;
    else if (status >= 400) c.client++;
    c.ms += ms;
    this.routes.set(key, c);
  }

  /** Counts something that happened, e.g. `push_sent`, `purchase_refused`. */
  count(event: string, n = 1) {
    if (n) this.events.set(event, (this.events.get(event) ?? 0) + n);
  }

  /** Counts each answered request (after the response, rate-limited ones included). */
  install(fastify: FastifyInstance) {
    fastify.addHook('onResponse', async (request, reply) => {
      this.request(request.method, request.routeOptions.url ?? null, reply.statusCode, reply.elapsedTime);
    });
  }

  /** Totals over the whole server, for the daily summary: how many, never which. */
  async totals(now = Date.now()) {
    const [families] = await this.db.select({ n: count() }).from(schema.families);
    const [blobs] = await this.db.select({ n: count(), bytes: sum(schema.blobs.size) }).from(schema.blobs);
    const [records] = await this.db.select({ n: count() }).from(schema.records);
    const [tokens] = await this.db.select({ n: count() }).from(schema.pushTokens);
    const [recovery] = await this.db.select({ n: count() }).from(schema.families).where(isNotNull(schema.families.recoverySignKey));
    const access: Record<string, number> = {};
    for (const { id } of await this.db.select({ id: schema.families.id }).from(schema.families)) {
      for (const d of (await this.entitlements.family(id, now)).devices) access[d.access] = (access[d.access] ?? 0) + 1;
    }
    return {
      families: families!.n,
      phones: access,
      recoveryKeys: recovery!.n,
      records: records!.n,
      photos: blobs!.n,
      photoBytes: Number(blobs!.bytes ?? 0),
      pushTokens: tokens!.n,
    };
  }

  /** Prometheus text format. With `totals`, also the database totals (a few queries per family: once a day). */
  async render(withTotals: boolean): Promise<string> {
    const lines = [`subby_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`, `subby_started_at ${Math.round(this.startedAt / 1000)}`];
    const label = (s: string) => s.replace(/["\\\n]/g, '_');
    for (const [key, c] of [...this.routes].sort(([a], [b]) => a.localeCompare(b))) {
      const l = `route="${label(key)}"`;
      lines.push(`subby_requests{${l}} ${c.requests}`, `subby_requests_4xx{${l}} ${c.client}`, `subby_requests_5xx{${l}} ${c.server}`, `subby_request_ms_sum{${l}} ${Math.round(c.ms)}`);
    }
    const all = [...this.routes.values()].reduce((a, c) => ({ requests: a.requests + c.requests, client: a.client + c.client, server: a.server + c.server }), { requests: 0, client: 0, server: 0 });
    lines.push(`subby_requests_total ${all.requests}`, `subby_requests_4xx_total ${all.client}`, `subby_requests_5xx_total ${all.server}`);
    for (const [event, n] of [...this.events].sort(([a], [b]) => a.localeCompare(b))) lines.push(`subby_${event}_total ${n}`);
    if (withTotals) {
      const t = await this.totals();
      lines.push(`subby_families ${t.families}`, `subby_recovery_keys ${t.recoveryKeys}`, `subby_records ${t.records}`, `subby_photos ${t.photos}`, `subby_photo_bytes ${t.photoBytes}`, `subby_push_tokens ${t.pushTokens}`);
      for (const [access, n] of Object.entries(t.phones).sort()) lines.push(`subby_phones{access="${access}"} ${n}`);
    }
    return lines.join('\n') + '\n';
  }

  /** Serves `GET /metrics` (and `/metrics?totals=1`) on 127.0.0.1 only. */
  listen(port: number): Promise<Server> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'GET' || url.pathname !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      this.render(url.searchParams.get('totals') === '1').then(
        (body) => res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(body),
        (e: unknown) => {
          console.warn('Metrics failed', e);
          res.writeHead(500).end();
        },
      );
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server));
    });
  }
}
