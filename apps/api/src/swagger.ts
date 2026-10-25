import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { API_KEY_HEADER } from './common/auth/api-key.guard';
import { ProblemDetailsDto } from './common/errors/problem-details.dto';

export const API_KEY_SCHEME = 'api-key';

/** Read once by API clients (and LLMs using this spec as tools), so endpoints needn't repeat it. */
const API_GUIDE = `The classic Northwind Traders sample database (a food import/export company), modernized.
Dates are shifted when the data is seeded so the latest order is about a week before the seed date;
questions like "last quarter" have real answers.

**Conventions**
- **IDs:** every record has an ObjectId \`id\` and a readable \`code\` (customers \`ALFKI\`, orders \`ORD-10248\`,
  products \`PRD-001\`, categories \`CAT-01\`, employees \`EMP-001\`, suppliers \`SUP-001\`, shippers \`SHP-01\`,
  regions \`REG-01\`). Paths and \`…Id\` fields accept either; codes are case-insensitive.
- **Copied references:** orders and products embed \`{ id, code, name | companyName }\` of related records, so
  most questions need one call. Follow \`code\` to fetch the full record.
- **Money** is a decimal string with two decimals (\`"18.00"\`); discounts are rates between 0 and 1 (\`"0.15"\`).
  Order revenue (\`totals.net\`) is after discounts and before freight.
- **Dates** are ISO 8601 in UTC. Date-range filters take \`from\` (inclusive) and \`to\` (exclusive).
- **Lists** return \`{ data, meta: { page, limit, total, totalPages } }\`; \`limit\` is at most 100. Unknown query
  parameters are rejected.
- **Deleted** customers, suppliers, employees and shippers are hidden from lists but still readable by id.
- **Errors** are RFC 9457 Problem Details (\`application/problem+json\`): \`detail\` says what went wrong and
  \`errors[]\` lists invalid fields by path (e.g. \`lines.1.productId\`).
- **Auth:** send the \`x-api-key\` header on every request except \`/health\`.`;

const TAGS: [string, string][] = [
  [
    'orders',
    'Customer orders and their lines: place, change while pending, ship. Totals are computed.',
  ],
  [
    'analytics',
    'Sales reports: revenue over time and by category, product, customer, employee, country; shipping performance.',
  ],
  ['customers', 'Companies that buy from Northwind, with contact and address.'],
  [
    'products',
    'The catalog: price, stock, category and supplier. Includes low-stock reorder report.',
  ],
  ['categories', 'Product categories (Beverages, Condiments, …).'],
  ['suppliers', 'Companies Northwind buys products from.'],
  ['employees', 'Sales staff, their managers and territories.'],
  ['shippers', 'Shipping companies used to deliver orders.'],
  ['regions', 'Sales regions and their territories (read-only).'],
  ['health', 'Service status.'],
];

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Northwind API')
    .setDescription(API_GUIDE)
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: API_KEY_HEADER },
      API_KEY_SCHEME,
    )
    .addSecurityRequirements(API_KEY_SCHEME);
  for (const [name, description] of TAGS) builder.addTag(name, description);
  const config = builder.build();

  return SwaggerModule.createDocument(app, config, {
    extraModels: [ProblemDetailsDto],
    // Method names (listCustomers, createOrder) become operationIds, and later MCP tool names.
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}

/** Swagger UI at /docs, raw spec at /openapi.json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'openapi.json',
    swaggerOptions: { persistAuthorization: true },
  });
}
