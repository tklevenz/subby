import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ChallengeRequestSchema, VerifyRequestSchema } from '@kindred-log/shared/sync';
import { parse } from '../common/validate';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('challenge')
  @HttpCode(200)
  challenge(@Body() body: unknown) {
    return this.auth.challenge(parse(ChallengeRequestSchema, body));
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() body: unknown) {
    const { challenge, signature } = parse(VerifyRequestSchema, body);
    return this.auth.verify(challenge, signature);
  }
}
