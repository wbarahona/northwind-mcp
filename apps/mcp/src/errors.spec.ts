import { NorthwindApiError } from '@northwind/api-client';
import { describeFailure, toolFieldName } from './errors';

describe('toolFieldName', () => {
  it.each([
    ['customerId', 'customer'],
    ['lines.0.productId', 'lines[0].product'],
    ['lines.12.quantity', 'lines[12].quantity'],
    ['shipTo.countryCode', 'shipTo.countryCode'],
    ['requiredDate', 'requiredDate'],
    ['id', 'id'],
  ])('%s → %s', (api, tool) => {
    expect(toolFieldName(api)).toBe(tool);
  });
});

describe('describeFailure', () => {
  const URL = 'http://api.test';

  it('spells out field errors with tool field names, and hints at discontinued products', () => {
    const error = new NorthwindApiError(400, {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'One or more fields are invalid.',
      errors: [
        {
          field: 'lines.0.productId',
          messages: ["PRD-005 (Chef Anton's Gumbo Mix) is discontinued."],
        },
      ],
    });

    expect(describeFailure(error, URL)).toBe(
      "400 Bad Request: One or more fields are invalid. (lines[0].product: PRD-005 (Chef Anton's Gumbo Mix) is discontinued.) " +
        'Discontinued products cannot be ordered; use find_products to choose an active one.',
    );
  });

  it('passes conflicts through as the API words them', () => {
    const error = new NorthwindApiError(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail:
        'Order ORD-10248 was shipped on 2024-12-24 and can no longer be changed.',
    });

    expect(describeFailure(error, URL)).toBe(
      '409 Conflict: Order ORD-10248 was shipped on 2024-12-24 and can no longer be changed.',
    );
  });

  it('treats a bad key as a setup problem', () => {
    const error = new NorthwindApiError(401, {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
    });

    expect(describeFailure(error, URL)).toMatch(/setup problem/);
  });

  it('explains network failures and timeouts', () => {
    expect(describeFailure(new TypeError('fetch failed'), URL)).toBe(
      'The Northwind API is not reachable at http://api.test. Is it running (pnpm dev)?',
    );
    expect(
      describeFailure(new DOMException('slow', 'TimeoutError'), URL),
    ).toMatch(/did not answer in time/);
    expect(describeFailure(new Error('boom'), URL)).toBe('boom');
  });
});
