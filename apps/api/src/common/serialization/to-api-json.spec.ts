import { model, Schema, Types } from 'mongoose';
import { toApiJson } from './to-api-json';

describe('toApiJson', () => {
  const id = new Types.ObjectId('65f1a2b3c4d5e6f708192a3b');

  it('converts BSON values and renames _id at every level', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const lean = {
      _id: id,
      __v: 0,
      code: 'ORD-10248',
      orderDate: date,
      freight: Types.Decimal128.fromString('32.38'),
      customer: { _id: id, code: 'VINET' },
      lines: [
        { unitPrice: Types.Decimal128.fromString('14.00'), quantity: 12 },
      ],
    };

    expect(toApiJson(lean)).toEqual({
      id: '65f1a2b3c4d5e6f708192a3b',
      code: 'ORD-10248',
      orderDate: date,
      freight: '32.38',
      customer: { id: '65f1a2b3c4d5e6f708192a3b', code: 'VINET' },
      lines: [{ unitPrice: '14.00', quantity: 12 }],
    });
  });

  it('handles Mongoose documents', () => {
    const Product = model(
      'ToApiJsonProduct',
      new Schema({ unitPrice: Schema.Types.Decimal128 }),
    );
    const doc = new Product({ _id: id, unitPrice: '18.00' });

    expect(toApiJson(doc)).toEqual({
      id: '65f1a2b3c4d5e6f708192a3b',
      unitPrice: '18.00',
    });
  });

  it('passes primitives and null through', () => {
    expect(toApiJson({ a: null, b: 'x', c: 1, d: true })).toEqual({
      a: null,
      b: 'x',
      c: 1,
      d: true,
    });
  });
});
