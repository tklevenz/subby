import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Validates a request body against a shared protocol schema; 400 with the failing paths otherwise. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return result.data;
}

/**
 * A non-negative integer query parameter; `fallback` when missing, 400 when it's anything else. At most `max`
 * (a 32-bit Postgres integer by default, so a huge value is a 400, not a database error).
 */
export function queryInt(value: string | undefined, fallback: number, max = 2 ** 31 - 1): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,15}$/.test(value) || Number(value) > max) throw new BadRequestException(`Expected a whole number up to ${max}, got "${value}"`);
  return Number(value);
}
