import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { toIdOrCodeFilter } from './id-or-code';

describe('toIdOrCodeFilter', () => {
  it('treats 24 hex chars as an ObjectId', () => {
    const filter = toIdOrCodeFilter('65f1a2b3c4d5e6f708192a3b');

    expect(filter).toEqual({
      _id: new Types.ObjectId('65f1a2b3c4d5e6f708192a3b'),
    });
  });

  it('upper-cases codes', () => {
    expect(toIdOrCodeFilter(' alfki ')).toEqual({ code: 'ALFKI' });
    expect(toIdOrCodeFilter('ord-10248')).toEqual({ code: 'ORD-10248' });
  });

  it('rejects values that cannot be a code', () => {
    expect(() => toIdOrCodeFilter('{"$ne":null}')).toThrow(BadRequestException);
    expect(() => toIdOrCodeFilter('')).toThrow(BadRequestException);
  });
});
