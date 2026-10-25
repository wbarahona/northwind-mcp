import { applyDecorators } from '@nestjs/common';
import {
  ApiProperty,
  type ApiPropertyOptions,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsDto,
} from './errors/problem-details.dto';

export const MONEY_PATTERN = '^\\d+\\.\\d{2}$';

/** Documents a money value: a decimal string with exactly 2 decimals. */
export const ApiMoney = (example: string, options: ApiPropertyOptions = {}) =>
  ApiProperty({
    type: String,
    pattern: MONEY_PATTERN,
    example,
    ...options,
  });

const PROBLEM_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid input; `errors` lists each field.',
  401: 'Missing or invalid x-api-key.',
  404: 'The resource (or a referenced one) was not found.',
  409: 'The request conflicts with the current state (e.g. editing a shipped order).',
  429: 'Too many requests.',
};

/** Documents Problem Details error responses for the given status codes. */
export const ApiProblemResponses = (...statuses: number[]) =>
  applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: PROBLEM_DESCRIPTIONS[status] ?? 'Error.',
        content: {
          [PROBLEM_CONTENT_TYPE]: {
            schema: { $ref: getSchemaPath(ProblemDetailsDto) },
          },
        },
      }),
    ),
  );
