import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { GrantKeysSchema, RotateKeysSchema } from '@kindred-log/shared/sync';
import type { DeviceLogEntry } from '@kindred-log/shared/crypto';
import { parse } from '../common/validate';
import { Auth, DeviceGuard, DeviceOrRecoveryGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { KeysService } from './keys.service';

@Controller('v1/keys')
export class KeysController {
  constructor(@Inject(KeysService) private readonly keys: KeysService) {}

  @Get()
  @UseGuards(DeviceOrRecoveryGuard)
  mine(@Auth() auth: AuthContext) {
    return this.keys.mine(auth);
  }

  /** The recovery key may grant too: that's how a recovered phone gets the family keys. */
  @Post('grant')
  @HttpCode(200)
  @UseGuards(DeviceOrRecoveryGuard)
  grant(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { recipient, keys } = parse(GrantKeysSchema, body);
    return this.keys.grant(auth, recipient, keys);
  }

  @Post('rotate')
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  rotate(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { entry, sealed } = parse(RotateKeysSchema, body);
    return this.keys.rotate(auth, entry as DeviceLogEntry, sealed);
  }
}
