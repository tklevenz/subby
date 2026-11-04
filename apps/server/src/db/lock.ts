import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, type Tx } from './db';

/** Serializes writes per family (log appends, key rotation, sync seq, logins). */
export async function lockFamily(tx: Tx, familyId: string) {
  const [family] = await tx.select().from(schema.families).where(eq(schema.families.id, familyId)).for('update');
  if (!family) throw new BadRequestException('Unknown family');
  return family;
}
