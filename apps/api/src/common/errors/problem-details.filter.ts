import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { Error as MongooseError, mongo } from 'mongoose';
import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetailsDto,
} from './problem-details.dto';
import { ValidationException } from './validation.exception';

/** Turns every error into an RFC 9457 Problem Details response. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = toProblem(exception);
    problem.instance = request.originalUrl;

    if (problem.status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}

export function toProblem(exception: unknown): ProblemDetailsDto {
  if (exception instanceof ValidationException) {
    return {
      ...problem(HttpStatus.BAD_REQUEST, exception.message),
      errors: exception.errors,
    };
  }

  if (exception instanceof HttpException) {
    return {
      ...httpExceptionExtensions(exception),
      ...problem(exception.getStatus(), httpExceptionDetail(exception)),
    };
  }

  if (exception instanceof mongo.MongoServerError && exception.code === 11000) {
    const keyValue = (exception.keyValue ?? {}) as Record<string, unknown>;
    const fields = Object.entries(keyValue).map(
      ([key, value]) => `${key} ${JSON.stringify(value)}`,
    );
    return problem(
      HttpStatus.CONFLICT,
      fields.length > 0
        ? `A record with ${fields.join(', ')} already exists.`
        : 'A record with the same unique value already exists.',
    );
  }

  if (exception instanceof MongooseError.ValidationError) {
    return {
      ...problem(HttpStatus.BAD_REQUEST, 'One or more fields are invalid.'),
      errors: Object.entries(exception.errors).map(([field, error]) => ({
        field,
        messages: [error.message],
      })),
    };
  }

  if (exception instanceof MongooseError.VersionError) {
    return problem(
      HttpStatus.CONFLICT,
      'The record was changed by another request at the same time. Fetch it again and retry.',
    );
  }

  if (exception instanceof MongooseError.CastError) {
    return problem(
      HttpStatus.BAD_REQUEST,
      `Invalid value for "${exception.path}".`,
    );
  }

  return problem(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'An unexpected error occurred.',
  );
}

function problem(status: number, detail: string): ProblemDetailsDto {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
  };
}

/** Nest exceptions carry either a string or `{ message: string | string[] }`. */
function httpExceptionDetail(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;

  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string') return message;
  return exception.message;
}

/**
 * Keeps extra fields from an exception body as RFC 9457 extension members,
 * e.g. the per-dependency `details` of a failed health check.
 */
function httpExceptionExtensions(
  exception: HttpException,
): Record<string, unknown> {
  const body = exception.getResponse();
  if (typeof body !== 'object' || body === null) return {};

  const {
    statusCode: _statusCode,
    message: _message,
    error: _error,
    ...rest
  } = body as Record<string, unknown>;
  return rest;
}
