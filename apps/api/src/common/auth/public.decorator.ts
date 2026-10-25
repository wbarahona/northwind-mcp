import { applyDecorators, SetMetadata } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opens a route or controller to callers without an API key.
 * Also clears the OpenAPI security requirement so Swagger shows it as unauthenticated.
 */
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), clearOpenApiSecurity());

function clearOpenApiSecurity(): ClassDecorator & MethodDecorator {
  return (
    target: object,
    _key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    const decorated = (descriptor?.value as object | undefined) ?? target;
    Reflect.defineMetadata(DECORATORS.API_SECURITY, [], decorated);
  };
}
