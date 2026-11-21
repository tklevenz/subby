import { z } from 'zod';

/**
 * A photo as synced: the encrypted file's id on the sync server and the key it was encrypted with
 * (base64url). Lives inside the encrypted record; `photoUri` is this device's local copy.
 */
export const PhotoBlobSchema = z.object({ id: z.uuid(), key: z.string() });
export type PhotoBlob = z.infer<typeof PhotoBlobSchema>;

/** A real calendar day (no 2026-02-31: ages and charts are computed from it). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }, 'Not a calendar date');

export const ChildSchema = z.object({
  id: z.uuid(),          // UUIDv7
  name: z.string().min(1),
  birthDate: isoDate,
  birthTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  dueDate: isoDate.nullable(),    // stored (e.g. from imports) but not used; ages are from birthDate
  sex: z.enum(['female', 'male', 'other']).nullable(),
  photoUri: z.string().nullable(),
  /** Set once the photo is uploaded (or for a photo from another phone not downloaded yet). */
  photoBlob: PhotoBlobSchema.nullish(),
  updatedAt: z.number().int(),
  isDeleted: z.boolean().default(false),
  syncStatus: z.enum(['pending', 'synced']).default('pending'),
  importRef: z.string().nullable(),
});

export type Child = z.infer<typeof ChildSchema>;
