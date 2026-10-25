import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Error as MongooseError, mongo } from 'mongoose';
import { toProblem } from './problem-details.filter';
import {
  flattenValidationErrors,
  ValidationException,
} from './validation.exception';

describe('toProblem', () => {
  it('maps HttpExceptions to their status with the message as detail', () => {
    expect(
      toProblem(new NotFoundException('Customer "ZZZZZ" was not found.')),
    ).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Customer "ZZZZZ" was not found.',
    });
  });

  it('keeps extra exception body fields as extension members', () => {
    const problem = toProblem(
      new ServiceUnavailableException({
        status: 'error',
        details: { mongodb: { status: 'down' } },
      }),
    );

    expect(problem).toMatchObject({
      status: 503,
      details: { mongodb: { status: 'down' } },
    });
  });

  it('includes field errors for validation failures', () => {
    const problem = toProblem(
      new ValidationException([{ field: 'limit', messages: ['too big'] }]),
    );

    expect(problem).toMatchObject({
      status: 400,
      errors: [{ field: 'limit', messages: ['too big'] }],
    });
  });

  it('maps Mongo duplicate keys to 409 naming the value', () => {
    const duplicate = new mongo.MongoServerError({
      message: 'E11000 duplicate key error',
      code: 11000,
      keyValue: { code: 'ALFKI' },
    });

    expect(toProblem(duplicate)).toMatchObject({
      status: 409,
      detail: 'A record with code "ALFKI" already exists.',
    });
  });

  it('maps concurrent-edit version errors to 409', () => {
    const conflict = new MongooseError.VersionError(
      { _doc: { _id: 'x' } } as never,
      0,
      ['freight'],
    );

    expect(toProblem(conflict)).toMatchObject({
      status: 409,
      detail: expect.stringMatching(/retry/),
    });
  });

  it('maps Mongoose cast errors to 400', () => {
    const cast = new MongooseError.CastError('ObjectId', 'nope', 'customerId');

    expect(toProblem(cast)).toMatchObject({
      status: 400,
      detail: 'Invalid value for "customerId".',
    });
  });

  it('hides unknown errors behind a generic 500', () => {
    expect(toProblem(new Error('secret internals'))).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
    });
  });
});

describe('flattenValidationErrors', () => {
  it('builds dotted paths for nested errors', () => {
    const errors = flattenValidationErrors([
      {
        property: 'shipTo',
        children: [
          {
            property: 'postalCode',
            constraints: { isString: 'must be a string' },
          },
        ],
      },
      {
        property: 'freight',
        constraints: { min: 'too small', isDecimal: 'not a decimal' },
      },
    ]);

    expect(errors).toEqual([
      { field: 'shipTo.postalCode', messages: ['must be a string'] },
      { field: 'freight', messages: ['too small', 'not a decimal'] },
    ]);
  });
});
