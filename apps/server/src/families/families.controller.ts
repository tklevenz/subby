import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { AppendLogSchema, CreateFamilySchema, RestoreLogSchema } from '@subby/shared/sync';
import type { DeviceLogEntry } from '@subby/shared/crypto';
import { parse, queryInt } from '../common/validate';
import { Auth, DeviceGuard, DeviceOrRecoveryGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { FamiliesService } from './families.service';

@Controller('v1/families')
export class FamiliesController {
  constructor(@Inject(FamiliesService) private readonly families: FamiliesService) {}

  /** No auth: the self-signed `create` entry proves the device holds its key. */
  @Post()
  create(@Body() body: unknown) {
    const { familyId, entry, sealedKey } = parse(CreateFamilySchema, body);
    return this.families.create(familyId, entry as DeviceLogEntry, sealedKey);
  }

  @Get('me/log')
  @UseGuards(DeviceOrRecoveryGuard)
  log(@Auth() auth: AuthContext, @Query('since') since?: string) {
    return this.families.log(auth.familyId, queryInt(since, 0));
  }

  /** Devices append adds, removes and recovery changes; the recovery key can only add (checked by the log rules). */
  @Post('me/log')
  @UseGuards(DeviceOrRecoveryGuard)
  append(@Auth() auth: AuthContext, @Body() body: unknown) {
    return this.families.append(auth, parse(AppendLogSchema, body).entry as DeviceLogEntry);
  }

  /** A phone gives back log entries this server lost (restored from a backup). */
  @Post('me/log/restore')
  @UseGuards(DeviceGuard)
  restore(@Auth() auth: AuthContext, @Body() body: unknown) {
    return this.families.restore(auth, parse(RestoreLogSchema, body).entries as DeviceLogEntry[]);
  }

  /** Deletes the family and all its data from the server. Any member, or the recovery key (a family whose phones are lost). */
  @Delete('me')
  @HttpCode(204)
  @UseGuards(DeviceOrRecoveryGuard)
  async remove(@Auth() auth: AuthContext) {
    await this.families.delete(auth.familyId);
  }
}
