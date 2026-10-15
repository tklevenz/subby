import { z } from 'zod';

export const DiaperPayloadSchema = z.object({
  type: z.literal('diaper'),
  condition: z.enum(['wet', 'dirty', 'both']),
  notes: z.string().optional(),
});

export const FeedPayloadSchema = z.object({
  type: z.literal('feed'),
  method: z.enum(['bottle', 'breast_left', 'breast_right', 'breast_both', 'solids']),
  amountMl: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

export const SleepPayloadSchema = z.object({
  type: z.literal('sleep'),
  endedAt: z.number().int().nullable(), // null means baby is currently sleeping
  notes: z.string().optional(),
});

export const LogPayloadSchema = z.discriminatedUnion('type', [
  DiaperPayloadSchema,
  FeedPayloadSchema,
  SleepPayloadSchema,
]);

export const LogEntrySchema = z.object({
  id: z.string().uuid(),          // UUIDv7
  childId: z.string().uuid(),     // UUIDv7
  logType: z.enum(['diaper', 'feed', 'sleep']),
  startedAt: z.number().int(),    // Unix timestamp (ms) - when the feed/sleep/diaper occurred
  updatedAt: z.number().int(),    // Unix timestamp (ms) - for Last-Write-Wins sync
  isDeleted: z.boolean().default(false),
  syncStatus: z.enum(['pending', 'synced']).default('pending'),
  payload: LogPayloadSchema,
});

export type LogPayload = z.infer<typeof LogPayloadSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
