import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../../config/env';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  const config = {
    get: () => ['key-one', 'key-two'],
  } as unknown as ConfigService<Env, true>;

  function contextWith(headers: Record<string, string>, isPublic = false) {
    const reflector = {
      getAllAndOverride: () => isPublic,
    } as unknown as Reflector;
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          header: (name: string) => headers[name.toLowerCase()],
        }),
      }),
    } as unknown as ExecutionContext;
    return { guard: new ApiKeyGuard(reflector, config), context };
  }

  it('accepts any configured key', () => {
    const { guard, context } = contextWith({ 'x-api-key': 'key-two' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a missing key', () => {
    const { guard, context } = contextWith({});
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Missing x-api-key header.'),
    );
  });

  it('rejects an unknown key', () => {
    const { guard, context } = contextWith({ 'x-api-key': 'key-three' });
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid API key.'),
    );
  });

  it('lets @Public() routes through without a key', () => {
    const { guard, context } = contextWith({}, true);
    expect(guard.canActivate(context)).toBe(true);
  });
});
