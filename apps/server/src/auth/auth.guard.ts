import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService, RECOVERY, type AuthContext } from './auth.service';

type AuthedRequest = FastifyRequest & { auth?: AuthContext };

export const bearer = (header: string | undefined) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

/** Member devices only. */
@Injectable()
export class DeviceGuard implements CanActivate {
  protected allowRecovery = false;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    // The body gate (common/bodyGate.ts) already looked up the session of a request with a body.
    const auth = req.auth ?? (await this.auth.authenticate(bearer(req.headers.authorization)));
    if (!auth) throw new UnauthorizedException();
    if (auth.deviceId === RECOVERY && !this.allowRecovery) throw new ForbiddenException('Not allowed with the recovery key');
    req.auth = auth;
    return true;
  }
}

/** Member devices, or the recovery key enrolling a new device. */
@Injectable()
export class DeviceOrRecoveryGuard extends DeviceGuard {
  protected override allowRecovery = true;
}

export const Auth = createParamDecorator((_: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<AuthedRequest>().auth!;
});
