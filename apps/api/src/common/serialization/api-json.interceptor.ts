import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { toApiJson } from './to-api-json';

/** Applies `toApiJson` to every successful response body. */
@Injectable()
export class ApiJsonInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        map((body: unknown) =>
          body instanceof StreamableFile ? body : toApiJson(body),
        ),
      );
  }
}
