import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** An answer the client should retry after `retryAfter` seconds (429 or 503, with Retry-After). */
export class RetryLater extends HttpException {
  constructor(
    status: 429 | 503,
    message: string,
    readonly retryAfter: number,
  ) {
    super({ statusCode: status, message }, status);
  }
}

type PgError = { code: string; table_name?: string; constraint_name?: string };
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** The Postgres error behind `e` (drizzle wraps it as the cause of a DrizzleQueryError), if any. */
function postgresError(e: unknown): PgError | null {
  for (let cur = e, depth = 0; cur && typeof cur === 'object' && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const c = cur as Partial<PgError> & { severity?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code) && 'severity' in c) return c as PgError;
  }
  return null;
}

/**
 * An error for the log, without its message: the class names down the `cause` chain, error codes (Postgres code,
 * table and constraint; Node's ECONNREFUSED…), and the stack frames. Messages can carry ids and request data
 * (drizzle's is "Failed query: <sql> params: <values>"), and nothing in the log may name a family, a phone or a record.
 */
export function describeError(e: unknown): string {
  const parts: string[] = [];
  for (let cur = e, depth = 0; cur !== undefined && cur !== null && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    if (typeof cur !== 'object') {
      parts.push(typeof cur);
      break;
    }
    const c = cur as { code?: unknown; table_name?: unknown; constraint_name?: unknown };
    const fields = [
      typeof c.code === 'string' && SAFE_CODE.test(c.code) ? c.code : null,
      typeof c.table_name === 'string' && SAFE_CODE.test(c.table_name) ? `table=${c.table_name}` : null,
      typeof c.constraint_name === 'string' && SAFE_CODE.test(c.constraint_name) ? `constraint=${c.constraint_name}` : null,
    ].filter(Boolean);
    parts.push([cur.constructor?.name || 'Object', ...fields].join(' '));
  }
  const stack = e instanceof Error && typeof e.stack === 'string' ? e.stack.split('\n').filter((l) => /^\s+at /.test(l)).slice(0, 12) : [];
  return [parts.join(' ← '), ...stack].join('\n');
}

/** For the background jobs' `console.warn(…)`: what failed, and `describeError`. */
export function logError(what: string, e: unknown) {
  console.warn(`${what}: ${describeError(e)}`);
}

/** How a database error the client caused is answered (instead of a 500). */
function fromPostgres(pg: PgError): { status: number; message: string; retryAfter?: number } | null {
  if (pg.code === '23505') return { status: 409, message: 'Already exists' };
  // Data exceptions: a value Postgres can't store (a NUL character, out of range…).
  if (pg.code.startsWith('22')) return { status: 400, message: 'Invalid value' };
  // Waited too long for a lock or a statement (the connection's lock_timeout and statement_timeout), or no connection.
  if (pg.code === '55P03' || pg.code === '57014' || pg.code === '53300') return { status: 503, message: 'The server is busy, try again shortly', retryAfter: 5 };
  return null;
}

/**
 * Every error answered over HTTP. HttpExceptions (and Fastify's own 4xx, e.g. invalid JSON) are answered as Nest
 * would. Anything else is a 500, logged with `describeError` and the route pattern only, never the error message
 * (Nest's default filter logs the whole exception, with drizzle's query parameters).
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      logError('Unhandled error', exception);
      return;
    }
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    let status = 500;
    let body: unknown = { statusCode: 500, message: 'Internal server error' };
    let retryAfter: number | undefined;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body = typeof res === 'string' ? { statusCode: status, message: res } : res;
      if (exception instanceof RetryLater) retryAfter = exception.retryAfter;
    } else {
      const fastifyStatus = (exception as { statusCode?: unknown } | null)?.statusCode;
      const pg = postgresError(exception);
      const mapped = pg ? fromPostgres(pg) : null;
      if (typeof fastifyStatus === 'number' && fastifyStatus >= 400 && fastifyStatus < 500) {
        status = fastifyStatus;
        body = { statusCode: status, message: (exception as Error).message };
      } else if (mapped) {
        ({ status, retryAfter } = mapped);
        body = { statusCode: status, message: mapped.message };
      }
    }
    const route = `${request.method} ${request.routeOptions?.url ?? 'unmatched'}`;
    if (status >= 500 && !(exception instanceof HttpException && status !== 500)) {
      console.error(`${status} ${route}: ${describeError(exception)}`);
    } else if (!(exception instanceof HttpException) && status < 500 && postgresError(exception)) {
      // A database error answered as the client's (a duplicate, a value Postgres can't store): logged anyway, since
      // one the code didn't expect is a server bug that the client only sees as a conflict.
      console.warn(`${status} ${route} from the database: ${describeError(exception)}`);
    }
    if (retryAfter !== undefined) void reply.header('retry-after', String(retryAfter));
    // A route may have set another type (photos are octet-stream); errors are always JSON.
    void reply.status(status).type('application/json; charset=utf-8').send(body);
  }
}
