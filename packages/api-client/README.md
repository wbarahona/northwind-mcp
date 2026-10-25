# @northwind/api-client

Typed client for the Northwind API. Types are generated from [`apps/api/openapi.json`](../../apps/api/openapi.json) by [openapi-typescript](https://openapi-ts.dev); requests go through [openapi-fetch](https://openapi-ts.dev/openapi-fetch/).

```ts
import {
  createNorthwindClient,
  NorthwindApiError,
  unwrap,
} from '@northwind/api-client';

const api = createNorthwindClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.NORTHWIND_API_KEY!,
});

// Paths, parameters, bodies and responses are type-checked against the spec.
const { data, error } = await api.GET('/v1/orders', {
  params: { query: { customerId: 'ALFKI', status: 'pending' } },
});

// Or get the data directly and an exception with the Problem Details on failure.
try {
  const order = await unwrap(
    api.POST('/v1/orders', {
      body: {
        customerId: 'ALFKI',
        employeeId: 'EMP-001',
        lines: [{ productId: 'PRD-001', quantity: 2 }],
      },
    }),
  );
  console.log(order.code, order.totals.total); // "ORD-11078" "36.00"
} catch (e) {
  if (e instanceof NorthwindApiError)
    console.error(e.message, e.problem.errors);
}
```

Friendly type names are exported for the main shapes: `Order`, `OrderSummary`, `Customer`, `Product`, `Employee`, `ProblemDetails`, … All generated types are available as `paths`, `operations` and `components`.

## Regenerating

`src/schema.ts` is generated; don't edit it.

```sh
pnpm openapi          # from the repo root: regenerates apps/api/openapi.json, then this client
pnpm openapi:check    # fails if either is out of date
```

Generated with `--default-non-nullable false`, so request fields that have a server-side default (like `discount`) stay optional.
