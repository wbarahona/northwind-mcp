import {
  applyDecorators,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';
import { Types } from 'mongoose';

/** A Mongo filter that matches one document by `_id` or by readable `code`. */
export type IdOrCodeFilter = { _id: Types.ObjectId } | { code: string };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const CODE = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

export function toIdOrCodeFilter(value: string): IdOrCodeFilter {
  const trimmed = value.trim();
  if (OBJECT_ID.test(trimmed)) return { _id: new Types.ObjectId(trimmed) };

  // Codes are stored upper-case; accept any case from callers ("alfki" -> "ALFKI").
  const code = trimmed.toUpperCase();
  if (!CODE.test(code)) {
    throw new BadRequestException(
      `"${value}" is neither a valid ObjectId nor a valid code.`,
    );
  }
  return { code };
}

/** `@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter` */
@Injectable()
export class ParseIdOrCodePipe implements PipeTransform<
  string,
  IdOrCodeFilter
> {
  transform(value: string): IdOrCodeFilter {
    return toIdOrCodeFilter(value);
  }
}

/** Documents an `:id` path param that accepts an ObjectId or a code. */
export const ApiIdOrCodeParam = (example: string, name = 'id') =>
  applyDecorators(
    ApiParam({
      name,
      description: 'MongoDB ObjectId or readable code (case-insensitive).',
      schema: { type: 'string' },
      example,
    }),
  );
