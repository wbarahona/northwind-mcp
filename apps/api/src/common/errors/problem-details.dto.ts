import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorDto {
  /** Dotted path to the offending field, e.g. `shipTo.postalCode`. */
  @ApiProperty({ example: 'limit' })
  field: string;

  @ApiProperty({ example: ['limit must not be greater than 100'] })
  messages: string[];
}

/** RFC 9457 "Problem Details for HTTP APIs" — the body of every error response. */
export class ProblemDetailsDto {
  /** Problem type URI. `about:blank` means the HTTP status says it all. */
  @ApiProperty({ example: 'about:blank' })
  type: string;

  /** Short summary; the HTTP status phrase for `about:blank`. */
  @ApiProperty({ example: 'Not Found' })
  title: string;

  @ApiProperty({ example: 404 })
  status: number;

  /** Human-readable explanation specific to this occurrence. */
  @ApiPropertyOptional({ example: 'Customer "ZZZZZ" was not found.' })
  detail?: string;

  /** The request path that produced the problem. */
  @ApiPropertyOptional({ example: '/v1/customers/ZZZZZ' })
  instance?: string;

  /** Per-field messages, present on validation errors. */
  @ApiPropertyOptional({ type: [FieldErrorDto] })
  errors?: FieldErrorDto[];
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
