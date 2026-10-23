import { z } from 'zod';

/**
 * A photo as synced: the encrypted file's id on the sync server and the key it was encrypted with
 * (base64url). Lives inside the encrypted record; `photoUri` is this device's local copy.
 */
export const PhotoBlobSchema = z.object({ id: z.string().uuid(), key: z.string() });
export type PhotoBlob = z.infer<typeof PhotoBlobSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const ChildSchema = z.object({
  id: z.string().uuid(),          // UUIDv7
  name: z.string().min(1),
  birthDate: isoDate,
  birthTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
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
