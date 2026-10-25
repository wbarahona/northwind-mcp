import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ModelName, type Order } from '@northwind/db';
import { IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { type Model, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { toApiJson } from '../src/common/serialization/to-api-json';
import {
  type IdOrCodeFilter,
  ParseIdOrCodePipe,
} from '../src/common/ids/id-or-code';
import {
  paginate,
  PaginationQueryDto,
  parseSort,
  toSkip,
} from '../src/common/pagination/pagination';
import { E2E_API_KEY as API_KEY } from './global-setup';

class AddressDto {
  @IsString()
  city: string;
}

class ProbeBodyDto {
  @IsInt()
  @Min(1)
  quantity: number;

  @ValidateNested()
  @Type(() => AddressDto)
  shipTo: AddressDto;
}

/** Test-only routes that exercise the shared plumbing before real resources exist. */
@Controller('probe')
class ProbeController {
  @Get('money')
  money() {
    return {
      _id: new Types.ObjectId('65f1a2b3c4d5e6f708192a3b'),
      unitPrice: Types.Decimal128.fromString('18.00'),
      lines: [{ total: Types.Decimal128.fromString('1.5E+3') }],
    };
  }

  @Get('items')
  items(@Query() query: PaginationQueryDto) {
    const sort = parseSort(query.sort, ['code'], { code: 1 });
    // Entries, not an object: the serializer would rename the spec's `_id` key.
    return {
      ...paginate([{ skip: toSkip(query) }], 45, query),
      sort: Object.entries(sort),
    };
  }

  @Get('items/:id')
  item(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return filter;
  }

  @Post('validate')
  validate(@Body() body: ProbeBodyDto) {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2');
  }
}

describe('API skeleton (e2e)', () => {
  let app: INestApplication<App>;

  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('x-api-key', API_KEY);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = configureApp(
      moduleRef.createNestApplication<INestApplication<App>>(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("doesn't advertise the framework", async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  describe('health', () => {
    it('runs against the in-memory database, not the dev one', () => {
      expect(process.env.MONGO_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:\d+\//);
      expect(process.env.MONGO_URI).not.toContain(':27017/');
    });

    it('is public and reports MongoDB up', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        info: { mongodb: { status: 'up' } },
      });
    });
  });

  describe('database', () => {
    it('registers every model and builds indexes on boot', async () => {
      const orders = app.get<Model<Order>>(getModelToken(ModelName.Order));
      await orders.init(); // resolves once autoIndex has finished

      const indexes = await orders.listIndexes();
      expect(indexes.map((index): unknown => index.key)).toContainEqual({
        code: 1,
      });
      for (const name of Object.values(ModelName)) {
        expect(app.get(getModelToken(name))).toBeDefined();
      }
    });

    it('serializes a stored order with decimal strings and ids', async () => {
      const orders = app.get<Model<Order>>(getModelToken(ModelName.Order));
      const ref = (code: string, label: 'name' | 'companyName') => ({
        _id: new Types.ObjectId(),
        code,
        [label]: code,
      });
      const order = await orders.create({
        code: 'ORD-90001',
        customer: ref('VINET', 'companyName'),
        employee: ref('EMP-005', 'name'),
        orderDate: new Date('2026-01-05'),
        freight: '32.38',
        shipTo: {
          name: 'Vins et alcools Chevalier',
          street: "59 rue de l'Abbaye",
          city: 'Reims',
          country: 'France',
          countryCode: 'FR',
        },
        lines: [
          { product: ref('PRD-011', 'name'), unitPrice: '14', quantity: 12 },
        ],
      });

      const json = JSON.parse(
        JSON.stringify(toApiJson(await orders.findById(order._id).lean())),
      );

      expect(json).toMatchObject({
        id: order._id.toHexString(),
        code: 'ORD-90001',
        customer: {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          code: 'VINET',
        },
        freight: '32.38',
        lines: [{ unitPrice: '14.00', discount: '0', lineTotal: '168.00' }],
        totals: { subtotal: '168.00', net: '168.00', total: '200.38' },
        status: 'pending',
        orderDate: '2026-01-05T00:00:00.000Z',
      });
      expect(json).not.toHaveProperty('_id');
      await orders.deleteOne({ _id: order._id });
    });
  });

  describe('auth', () => {
    it('rejects a missing key with Problem Details', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/probe/money')
        .expect(401);

      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing x-api-key header.',
        instance: '/v1/probe/money',
      });
    });

    it('rejects a wrong key', async () => {
      await request(app.getHttpServer())
        .get('/v1/probe/money')
        .set('x-api-key', 'nope')
        .expect(401);
    });
  });

  describe('serialization', () => {
    it('renders Decimal128 as plain strings and _id as id', async () => {
      const res = await authed('get', '/v1/probe/money').expect(200);

      expect(res.body).toEqual({
        id: '65f1a2b3c4d5e6f708192a3b',
        unitPrice: '18.00',
        lines: [{ total: '1500' }],
      });
    });
  });

  describe('pagination', () => {
    it('applies defaults', async () => {
      const res = await authed('get', '/v1/probe/items').expect(200);

      expect(res.body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 45,
        totalPages: 3,
      });
      expect(res.body.sort).toEqual([
        ['code', 1],
        ['_id', 1],
      ]);
    });

    it('converts query strings to numbers', async () => {
      const res = await authed(
        'get',
        '/v1/probe/items?page=3&limit=10&sort=-code',
      ).expect(200);

      expect(res.body.data).toEqual([{ skip: 20 }]);
      expect(res.body.sort).toEqual([
        ['code', -1],
        ['_id', 1],
      ]);
    });

    it.each([
      ['limit=101', 'limit'],
      ['page=0', 'page'],
      ['sort=secret', 'sort'],
      ['unknownParam=1', 'unknownParam'],
    ])('rejects %s', async (query, field) => {
      const res = await authed('get', `/v1/probe/items?${query}`).expect(400);

      expect(res.body.errors).toEqual([expect.objectContaining({ field })]);
    });
  });

  describe('id-or-code params', () => {
    it('accepts a code case-insensitively', async () => {
      const res = await authed('get', '/v1/probe/items/alfki').expect(200);
      expect(res.body).toEqual({ code: 'ALFKI' });
    });

    it('accepts an ObjectId', async () => {
      const res = await authed(
        'get',
        '/v1/probe/items/65f1a2b3c4d5e6f708192a3b',
      ).expect(200);
      expect(res.body).toEqual({ id: '65f1a2b3c4d5e6f708192a3b' });
    });

    it('rejects anything else', async () => {
      await authed('get', '/v1/probe/items/not%20valid!').expect(400);
    });
  });

  describe('errors', () => {
    it('reports nested validation errors by field path', async () => {
      const res = await authed('post', '/v1/probe/validate')
        .send({ quantity: 0, shipTo: { city: 5 }, extra: true })
        .expect(400);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'quantity' }),
          expect.objectContaining({ field: 'shipTo.city' }),
          expect.objectContaining({ field: 'extra' }),
        ]),
      );
    });

    it('returns Problem Details for malformed JSON', async () => {
      const res = await authed('post', '/v1/probe/validate')
        .set('content-type', 'application/json')
        .send('{"quantity": ')
        .expect(400);

      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
    });

    it('returns 404 Problem Details for unknown routes', async () => {
      const res = await authed('get', '/v1/nope').expect(404);
      expect(res.body).toMatchObject({ status: 404, instance: '/v1/nope' });
    });

    it('hides internal error messages', async () => {
      const res = await authed('get', '/v1/probe/boom').expect(500);

      expect(res.body.detail).toBe('An unexpected error occurred.');
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });
  });

  describe('OpenAPI', () => {
    it('serves the spec with API key security, except on public routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/openapi.json')
        .expect(200);
      const spec = res.body as {
        security: unknown;
        paths: Record<string, { get?: { security?: unknown } }>;
        components: {
          securitySchemes: unknown;
          schemas: Record<string, unknown>;
        };
      };

      expect(spec.security).toEqual([{ 'api-key': [] }]);
      expect(spec.components.securitySchemes).toEqual({
        'api-key': { type: 'apiKey', in: 'header', name: 'x-api-key' },
      });
      expect(spec.paths['/health']?.get?.security).toEqual([]);
      expect(spec.paths['/v1/probe/money']?.get?.security).toBeUndefined();
      expect(spec.components.schemas).toHaveProperty('ProblemDetailsDto');
    });

    it('derives parameter docs from JSDoc and class-validator via the Swagger plugin', async () => {
      const res = await request(app.getHttpServer())
        .get('/openapi.json')
        .expect(200);
      const params = (
        res.body as {
          paths: Record<string, { get: { parameters: unknown[] } }>;
        }
      ).paths['/v1/probe/items']?.get.parameters;

      expect(params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Items per page.',
            schema: expect.objectContaining({
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
            }),
          }),
        ]),
      );
    });

    it('gives every operation a summary and a unique, tool-friendly operationId', async () => {
      const res = await request(app.getHttpServer())
        .get('/openapi.json')
        .expect(200);
      const operations = Object.entries(
        res.body.paths as Record<
          string,
          Record<string, { operationId: string; summary?: string }>
        >,
      )
        .filter(([path]) => !path.startsWith('/v1/probe'))
        .flatMap(([, methods]) => Object.values(methods));
      const ids = operations.map((op) => op.operationId);

      expect(ids).toEqual(
        expect.arrayContaining(['listCustomers', 'createOrder', 'shipOrder']),
      );
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => /^[a-z][A-Za-z]+$/.test(id))).toBe(true);
      expect(
        operations.filter((op) => !op.summary).map((op) => op.operationId),
      ).toEqual([]);
    });

    it('documents nested order types and money formats', async () => {
      const res = await request(app.getHttpServer())
        .get('/openapi.json')
        .expect(200);
      const order = res.body.components.schemas.OrderDto;

      expect(order.properties.lines).toMatchObject({
        type: 'array',
        items: { $ref: '#/components/schemas/OrderLineDto' },
      });
      expect(order.properties.shipTo).toEqual({
        $ref: '#/components/schemas/ShipToDto',
      });
      expect(order.properties.totals).toEqual({
        $ref: '#/components/schemas/OrderTotalsDto',
      });
      expect(
        res.body.components.schemas.OrderTotalsDto.properties.net,
      ).toMatchObject({
        type: 'string',
        pattern: '^\\d+\\.\\d{2}$',
      });
    });

    it('serves Swagger UI', async () => {
      await request(app.getHttpServer())
        .get('/docs')
        .expect(200)
        .expect('content-type', /html/);
    });
  });
});
