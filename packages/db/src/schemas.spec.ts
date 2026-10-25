import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, Types } from 'mongoose';
import { nextCode } from './codes';
import { type NorthwindModels, registerModels } from './models';

describe('schemas (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let models: NorthwindModels;

  const categoryRef = {
    _id: new Types.ObjectId(),
    code: 'CAT-01',
    name: 'Beverages',
  };
  const supplierRef = {
    _id: new Types.ObjectId(),
    code: 'SUP-001',
    companyName: 'Exotic Liquids',
  };
  const address = {
    street: 'Obere Str. 57',
    city: 'Berlin',
    postalCode: '12209',
    country: 'Germany',
    countryCode: 'de',
  };

  const productRef = (code: string) => ({
    _id: new Types.ObjectId(),
    code,
    name: `Product ${code}`,
  });

  /** Classic Northwind order 10248, with prices as the API would receive them. */
  const order10248 = () => ({
    code: 'ORD-10248',
    customer: {
      _id: new Types.ObjectId(),
      code: 'VINET',
      companyName: 'Vins et alcools Chevalier',
    },
    employee: {
      _id: new Types.ObjectId(),
      code: 'EMP-005',
      name: 'Steven Buchanan',
    },
    shipper: {
      _id: new Types.ObjectId(),
      code: 'SHP-03',
      companyName: 'Federal Shipping',
    },
    orderDate: new Date('2026-01-05'),
    requiredDate: new Date('2026-02-02'),
    shippedDate: null as Date | null,
    freight: '32.38',
    shipTo: {
      name: 'Vins et alcools Chevalier',
      street: "59 rue de l'Abbaye",
      city: 'Reims',
      postalCode: '51100',
      country: 'France',
      countryCode: 'FR',
    },
    lines: [
      { product: productRef('PRD-011'), unitPrice: '14', quantity: 12 },
      { product: productRef('PRD-042'), unitPrice: 9.8, quantity: 10 },
      {
        product: productRef('PRD-072'),
        unitPrice: '34.80',
        quantity: 5,
        discount: '0.1500',
      },
    ],
  });

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    connection = await mongoose
      .createConnection(mongo.getUri('northwind-db-test'))
      .asPromise();
    models = registerModels(connection);
    await Promise.all(
      Object.values(models).map((model) => model.syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  describe('indexes', () => {
    const indexKeys = async (model: keyof NorthwindModels) =>
      (await models[model].listIndexes()).map((index) => ({
        key: index.key as Record<string, unknown>,
        unique: index.unique === true,
      }));

    it('creates a unique code index on every collection except counters', async () => {
      for (const name of Object.keys(models) as (keyof NorthwindModels)[]) {
        if (name === 'Counter') continue;
        expect(await indexKeys(name)).toContainEqual({
          key: { code: 1 },
          unique: true,
        });
      }
    });

    it('creates the query indexes from the plan', async () => {
      expect(await indexKeys('Order')).toEqual(
        expect.arrayContaining([
          { key: { 'customer._id': 1, orderDate: -1 }, unique: false },
          { key: { 'employee._id': 1, orderDate: -1 }, unique: false },
          { key: { orderDate: -1 }, unique: false },
          { key: { 'lines.product._id': 1 }, unique: false },
          { key: { status: 1, requiredDate: 1 }, unique: false },
        ]),
      );
      expect(await indexKeys('Product')).toEqual(
        expect.arrayContaining([
          { key: { 'category._id': 1 }, unique: false },
          { key: { 'supplier._id': 1 }, unique: false },
          { key: { _fts: 'text', _ftsx: 1 }, unique: false },
        ]),
      );
      expect(await indexKeys('Customer')).toContainEqual({
        key: { _fts: 'text', _ftsx: 1 },
        unique: false,
      });
    });
  });

  describe('orders', () => {
    it('computes line totals, totals and status on save', async () => {
      const order = await models.Order.create(order10248());
      const json = JSON.parse(JSON.stringify(order.toObject())) as {
        lines: {
          unitPrice: unknown;
          discount: unknown;
          lineTotal: unknown;
        }[];
        totals: unknown;
        status: string;
      };

      // Money normalized to 2 decimals, rates to their shortest form.
      expect(
        json.lines.map((l) => [l.unitPrice, l.discount, l.lineTotal]),
      ).toEqual([
        [
          { $numberDecimal: '14.00' },
          { $numberDecimal: '0' },
          { $numberDecimal: '168.00' },
        ],
        [
          { $numberDecimal: '9.80' },
          { $numberDecimal: '0' },
          { $numberDecimal: '98.00' },
        ],
        [
          { $numberDecimal: '34.80' },
          { $numberDecimal: '0.15' },
          { $numberDecimal: '147.90' },
        ],
      ]);
      expect(json.totals).toEqual({
        subtotal: { $numberDecimal: '440.00' },
        discount: { $numberDecimal: '26.10' },
        net: { $numberDecimal: '413.90' },
        freight: { $numberDecimal: '32.38' },
        total: { $numberDecimal: '446.28' },
      });
      expect(json.status).toBe('pending');
    });

    it('recomputes when lines change and marks shipped orders', async () => {
      const order = await models.Order.create({
        ...order10248(),
        code: 'ORD-10249',
      });
      order.lines.pop();
      order.shippedDate = new Date('2026-01-10');
      await order.save();

      expect(order.totals.net.toString()).toBe('266.00');
      expect(order.status).toBe('shipped');
    });

    it('computes totals in insertMany too (used by the seed)', async () => {
      const [order] = await models.Order.insertMany([
        { ...order10248(), code: 'ORD-10250' },
      ]);

      expect(order?.totals.total.toString()).toBe('446.28');
    });

    it('rejects a save based on a stale copy (optimistic concurrency)', async () => {
      const { _id } = await models.Order.create({
        ...order10248(),
        code: 'ORD-10252',
      });
      const first = await models.Order.findById(_id).orFail();
      const second = await models.Order.findById(_id).orFail();

      first.set('freight', '1.00');
      await first.save();
      second.set('freight', '2.00');

      await expect(second.save()).rejects.toThrow(mongoose.Error.VersionError);
    });

    it('keeps the _id of copied references instead of generating one', async () => {
      const input = order10248();
      const order = await models.Order.create({ ...input, code: 'ORD-10251' });

      expect(order.customer._id).toEqual(input.customer._id);
      expect(order.lines[0]?.product._id).toEqual(input.lines[0]?.product._id);
    });

    it.each([
      ['negative price', { 0: { unitPrice: '-1' } }, 'lines.0.unitPrice'],
      ['3-decimal price', { 0: { unitPrice: '1.005' } }, 'lines.0.unitPrice'],
      ['zero quantity', { 0: { quantity: 0 } }, 'lines.0.quantity'],
      ['fractional quantity', { 0: { quantity: 1.5 } }, 'lines.0.quantity'],
      ['discount above 1', { 0: { discount: '1.2' } }, 'lines.0.discount'],
    ])('rejects a %s', async (_label, patch, path) => {
      const input = order10248();
      Object.assign(input.lines[0]!, patch[0]);

      await expect(
        models.Order.create({ ...input, code: 'ORD-20000' }),
      ).rejects.toMatchObject({ errors: { [path]: expect.anything() } });
    });

    it('rejects orders with no lines or duplicate products', async () => {
      const empty = { ...order10248(), code: 'ORD-20001', lines: [] };
      await expect(models.Order.create(empty)).rejects.toThrow(
        /at least one line/,
      );

      const input = order10248();
      input.lines[1]!.product = input.lines[0]!.product;
      await expect(
        models.Order.create({ ...input, code: 'ORD-20002' }),
      ).rejects.toThrow(/only once per order/);
    });
  });

  describe('codes and value objects', () => {
    it('upper-cases codes and country codes, lower-cases emails', async () => {
      const customer = await models.Customer.create({
        code: 'alfki',
        companyName: 'Alfreds Futterkiste',
        contact: {
          name: 'Maria Anders',
          email: 'Maria.Anders@Alfreds-Futterkiste.example',
        },
        address,
      });

      expect(customer.code).toBe('ALFKI');
      expect(customer.address.countryCode).toBe('DE');
      expect(customer.contact.email).toBe(
        'maria.anders@alfreds-futterkiste.example',
      );
      expect(customer.deletedAt).toBeNull();
    });

    it.each([
      ['Customer', { code: 'ALFK1' }, 'code'],
      ['Customer', { contact: { name: 'X', email: 'nope' } }, 'contact.email'],
      [
        'Customer',
        { address: { ...address, countryCode: 'DEU' } },
        'address.countryCode',
      ],
      ['Product', { code: 'PRD-7' }, 'code'],
    ] as const)('%s rejects invalid %j', async (model, patch, path) => {
      const valid = {
        Customer: {
          code: 'BLAUS',
          companyName: 'Blauer See',
          contact: { name: 'Hanna Moos' },
          address,
        },
        Product: {
          code: 'PRD-001',
          name: 'Chai',
          category: categoryRef,
          supplier: supplierRef,
          unitPrice: '18',
        },
      }[model];

      await expect(
        models[model].validate({ ...valid, ...patch }),
      ).rejects.toMatchObject({ errors: { [path]: expect.anything() } });
    });

    it('enforces unique codes at the database level', async () => {
      const product = {
        code: 'PRD-001',
        name: 'Chai',
        category: categoryRef,
        supplier: supplierRef,
        unitPrice: '18',
      };
      await models.Product.create(product);

      await expect(models.Product.create(product)).rejects.toMatchObject({
        code: 11000,
        keyValue: { code: 'PRD-001' },
      });
    });

    it('allows several regions without territories but no shared territory', async () => {
      await models.Region.create([
        { code: 'REG-01', name: 'Eastern' },
        { code: 'REG-02', name: 'Western' },
      ]);
      await models.Region.create({
        code: 'REG-03',
        name: 'Northern',
        territories: [{ code: '06897', name: 'Wilton' }],
      });

      await expect(
        models.Region.create({
          code: 'REG-04',
          name: 'Southern',
          territories: [{ code: '06897', name: 'Wilton' }],
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('nextCode', () => {
    it('hands out unique, sequential codes under concurrency', async () => {
      await models.Counter.create({ _id: 'orders', seq: 11077 });

      const codes = await Promise.all(
        Array.from({ length: 20 }, () => nextCode(models.Counter, 'orders')),
      );

      expect(new Set(codes).size).toBe(20);
      expect([...codes].sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `ORD-${11078 + i}`),
      );
    });

    it('starts a new sequence at 1', async () => {
      expect(await nextCode(models.Counter, 'shippers')).toBe('SHP-01');
    });
  });
});
