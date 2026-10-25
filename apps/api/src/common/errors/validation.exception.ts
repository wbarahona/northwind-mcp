import { BadRequestException, type ValidationError } from '@nestjs/common';

export interface FieldError {
  /** Dotted path to the offending field, e.g. `shipTo.postalCode` or `lines.0.quantity`. */
  field: string;
  messages: string[];
}

/** A 400 that carries per-field messages; rendered as Problem Details with an `errors` array. */
export class ValidationException extends BadRequestException {
  constructor(readonly errors: FieldError[]) {
    super('One or more fields are invalid.');
  }

  /** Used as the global ValidationPipe `exceptionFactory`. */
  static fromValidationErrors(errors: ValidationError[]): ValidationException {
    return new ValidationException(flattenValidationErrors(errors));
  }
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own: FieldError[] = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}
