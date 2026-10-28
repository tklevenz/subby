import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

/**
 * Whether a family may sync. Self-hosted servers have no limits. On the hosted service this is where the
 * Subby Sync subscription will be checked (store billing is a later step); until then everyone may sync.
 */
@Injectable()
export class Entitlements {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async canSync(_familyId: string): Promise<boolean> {
    if (this.config.mode === 'self') return true;
    return true;
  }

  /** Whether a family may store another encrypted file of `bytes` (hosted storage quotas go here). */
  async canStore(_familyId: string, _bytes: number): Promise<boolean> {
    if (this.config.mode === 'self') return true;
    return true;
  }
}
