import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env';
import { IS_PUBLIC_KEY } from './public.decorator';

export const API_KEY_HEADER = 'x-api-key';

/** Global guard: every route needs a valid `x-api-key` unless marked `@Public()`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keyDigests: Buffer[];

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.keyDigests = config.get('API_KEYS', { infer: true }).map(sha256);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const provided = context
      .switchToHttp()
      .getRequest<Request>()
      .header(API_KEY_HEADER);
    if (!provided) {
      throw new UnauthorizedException(`Missing ${API_KEY_HEADER} header.`);
    }

    // Compare fixed-length digests in constant time so response timing doesn't leak key contents.
    const digest = sha256(provided);
    if (!this.keyDigests.some((known) => timingSafeEqual(known, digest))) {
      throw new UnauthorizedException('Invalid API key.');
    }
    return true;
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
