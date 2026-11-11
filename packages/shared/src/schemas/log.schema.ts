import { z } from 'zod';
import { PhotoBlobSchema } from './child.schema';

// All quantities are stored in canonical units (ml, g, cm, °C, seconds, epoch ms)
// and converted for display only (see domain/units.ts).

// Tags were dropped (2026-11-11): unused. A `tags` field from an older app passes through untouched (unknown fields do).
const base = {
  notes: z.string().optional(),
};

export const DIAPER_COLORS = [
  'black', 'brown', 'gray', 'green', 'orange', 'red', 'white', 'yellow',
] as const;

export type DiaperColor = (typeof DIAPER_COLORS)[number];

export const DIAPER_CONDITIONS = ['wet', 'dirty', 'both', 'dry'] as const;
export type DiaperCondition = (typeof DIAPER_CONDITIONS)[number];

/** Whether the diaper had a stool (dirty or both): the only ones a color is asked for. */
export const hasStool = (condition: DiaperCondition): boolean => condition === 'dirty' || condition === 'both';

export const DiaperPayloadSchema = z.object({
  type: z.literal('diaper'),
  condition: z.enum(DIAPER_CONDITIONS),
  color: z.enum(DIAPER_COLORS).optional(),
  amount: z.number().nonnegative().optional(),
  ...base,
});

export const FeedPayloadSchema = z.object({
  type: z.literal('feed'),
  method: z.enum(['bottle', 'breast', 'solids']),
  milkType: z.enum(['breast_milk', 'formula', 'fortified']).optional(),
  amountMl: z.number().nonnegative().optional(),
  leftSeconds: z.number().int().nonnegative().optional(),
  rightSeconds: z.number().int().nonnegative().optional(),
  lastSide: z.enum(['left', 'right']).optional(),
  // Live breastfeeding timer state (only while the entry is running; see domain/feedTimer.ts).
  timerSide: z.enum(['left', 'right']).optional(),
  timerSideSince: z.number().int().optional(),
  foods: z.array(z.string()).optional(),
  reaction: z.string().optional(),
  allergen: z.boolean().optional(),
  feeder: z.enum(['parent', 'self']).optional(),
  ...base,
});

export const SleepPayloadSchema = z.object({
  type: z.literal('sleep'),
  nap: z.boolean().optional(),
  ...base,
});

export const PumpingPayloadSchema = z.object({
  type: z.literal('pumping'),
  amountMl: z.number().nonnegative().optional(),
  leftMl: z.number().nonnegative().optional(),
  rightMl: z.number().nonnegative().optional(),
  ...base,
});

export const GrowthPayloadSchema = z.object({
  type: z.literal('growth'),
  weightG: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  headCm: z.number().positive().optional(),
  ...base,
});

export const TemperaturePayloadSchema = z.object({
  type: z.literal('temperature'),
  celsius: z.number(),
  ...base,
});

export const MEDICATION_UNITS = ['mg', 'ml', 'tablets', 'drops'] as const;
export type MedicationUnit = (typeof MEDICATION_UNITS)[number];

export const MedicationPayloadSchema = z.object({
  type: z.literal('medication'),
  name: z.string().min(1),
  dose: z.number().nonnegative().optional(),
  unit: z.enum(MEDICATION_UNITS).optional(),
  nextDoseIntervalMin: z.number().int().positive().optional(),
  ...base,
});

export const PottyPayloadSchema = z.object({
  type: z.literal('potty'),
  result: z.enum(['pee', 'poo', 'both', 'none']),
  location: z.enum(['potty', 'toilet', 'other']).optional(),
  accident: z.boolean().optional(),
  ...base,
});

export const ACTIVITY_KINDS = ['tummy_time', 'bath', 'play', 'outdoor', 'reading', 'other'] as const;

export const ActivityPayloadSchema = z.object({
  type: z.literal('activity'),
  kind: z.enum(ACTIVITY_KINDS),
  milestone: z.string().optional(),
  ...base,
});

export const MilestonePayloadSchema = z.object({
  type: z.literal('milestone'),
  key: z.string().optional(), // id from the bundled checklist
  custom: z.string().optional(),
  ...base,
});

export const NotePayloadSchema = z.object({
  type: z.literal('note'),
  text: z.string().min(1),
  photoUri: z.string().optional(),
  photoBlob: PhotoBlobSchema.optional(),
  ...base,
});

export const LogPayloadSchema = z.discriminatedUnion('type', [
  DiaperPayloadSchema,
  FeedPayloadSchema,
  SleepPayloadSchema,
  PumpingPayloadSchema,
  GrowthPayloadSchema,
  TemperaturePayloadSchema,
  MedicationPayloadSchema,
  PottyPayloadSchema,
  ActivityPayloadSchema,
  MilestonePayloadSchema,
  NotePayloadSchema,
]);

/**
 * For data from elsewhere (other phones, backups): each known field has the right primitive type (a string, a
 * number, a list of strings…), and required ones are there, so screens can rely on them; values aren't checked
 * (enums are any string, no ranges or minimums, null counts as missing) and unknown fields pass, so nothing
 * unusual that a phone stored, or a newer app, gets dropped.
 */
export const LenientPayloadSchema = z.discriminatedUnion(
  'type',
  LogPayloadSchema.options.map((schema) =>
    z.object(Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, loosen(field as z.ZodType)]))).loose(),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
);

function loosen(field: z.ZodType): z.ZodType {
  const def = field.def as { type: string; innerType?: z.ZodType; element?: z.ZodType };
  switch (def.type) {
    case 'optional':
      // null counts as missing, and comes out as missing (screens test `!== undefined`).
      return z.preprocess((v) => (v === null ? undefined : v), loosen(def.innerType!).optional());
    case 'string':
    case 'enum':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(loosen(def.element!));
    default:
      return field; // the type literal, and objects (a photo reference) as they are
  }
}

export const LOG_TYPES = [
  'diaper', 'feed', 'sleep', 'pumping', 'growth', 'temperature',
  'medication', 'potty', 'activity', 'milestone', 'note',
] as const;

export const LogTypeSchema = z.enum(LOG_TYPES);

export const LogEntrySchema = z.object({
  id: z.uuid(),          // UUIDv7
  childId: z.uuid(),     // UUIDv7
  logType: LogTypeSchema,
  startedAt: z.number().int(),    // Unix timestamp (ms) - when the event occurred / began
  // TIMED_LOG_TYPES: always set once complete (= startedAt for instant ones like a bottle), null = running timer.
  // Other types: always null.
  endedAt: z.number().int().nullable(),
  updatedAt: z.number().int(),    // Unix timestamp (ms) - for Last-Write-Wins sync
  isDeleted: z.boolean().default(false),
  syncStatus: z.enum(['pending', 'synced']).default('pending'),
  importRef: z.string().nullable(), // e.g. "babybuddy:host:feedings:123" for idempotent imports
  createdBy: z.string().nullable(), // reserved for multi-user sync
  payload: LogPayloadSchema,
});

/** Log types that span a duration and can run as a live timer. */
export const TIMED_LOG_TYPES: readonly LogType[] = ['sleep', 'feed', 'pumping', 'activity'];

export type LogType = z.infer<typeof LogTypeSchema>;
export type LogPayload = z.infer<typeof LogPayloadSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type PayloadOf<T extends LogType> = Extract<LogPayload, { type: T }>;
