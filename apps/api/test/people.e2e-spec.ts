import { createTestApp, type TestApp } from './utils/test-app';

describe('People: customers and employees (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  const newCustomer = (overrides: object = {}) => ({
    companyName: 'Blue Moon Bakery',
    contact: {
      name: 'Ana Ruiz',
      email: 'ana@blue-moon.example',
      phone: '+34911234567',
    },
    address: { street: 'Calle Mayor 1', city: 'Madrid', countryCode: 'es' },
    ...overrides,
  });

  describe('customers', () => {
    it('gets a customer by code in any case', async () => {
      const res = await t.api.get('/v1/customers/alfki').expect(200);

      expect(res.body).toMatchObject({
        code: 'ALFKI',
        companyName: 'Alfreds Futterkiste',
        contact: { name: 'Maria Anders', phone: '+49300074321' },
        address: { city: 'Berlin', country: 'Germany', countryCode: 'DE' },
        deletedAt: null,
      });
    });

    it('filters by country and city, and searches names', async () => {
      const germany = await t.api
        .get('/v1/customers?country=germany')
        .expect(200);
      expect(germany.body.meta.total).toBe(11);

      const london = await t.api
        .get('/v1/customers?country=GB&city=london')
        .expect(200);
      expect(london.body.meta.total).toBe(6);

      const search = await t.api.get('/v1/customers?q=Anders').expect(200);
      expect(search.body.data.map((c: { code: string }) => c.code)).toContain(
        'ALFKI',
      );
    });

    it("lists a customer's orders, newest first, without line items", async () => {
      const res = await t.api.get('/v1/customers/ALFKI/orders').expect(200);
      const dates = res.body.data.map(
        (o: { orderDate: string }) => o.orderDate,
      );

      expect(res.body.meta.total).toBe(6);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(res.body.data[0]).not.toHaveProperty('lines');
      expect(res.body.data[0].totals).toEqual(
        expect.objectContaining({ total: expect.any(String) }),
      );
    });

    it('derives a code from the company name, and the next free one on collision', async () => {
      const first = await t.api
        .post('/v1/customers', newCustomer())
        .expect(201);
      const second = await t.api
        .post('/v1/customers', newCustomer())
        .expect(201);

      expect(first.body).toMatchObject({
        code: 'BLUMO',
        address: { country: 'Spain', countryCode: 'ES' },
      });
      expect(second.body.code).toBe('BLUMA');
    });

    it('accepts an explicit code, rejecting one already in use', async () => {
      await t.api
        .post('/v1/customers', newCustomer({ code: 'moonb' }))
        .expect(201);
      const taken = await t.api
        .post('/v1/customers', newCustomer({ code: 'ALFKI' }))
        .expect(409);

      expect(taken.body.detail).toBe(
        'A record with code "ALFKI" already exists.',
      );
    });

    it('validates nested contact and address fields', async () => {
      const res = await t.api
        .post(
          '/v1/customers',
          newCustomer({ contact: { email: 'nope' }, address: { city: 'X' } }),
        )
        .expect(400);
      const fields = res.body.errors.map((e: { field: string }) => e.field);

      expect(fields).toEqual(
        expect.arrayContaining([
          'contact.name',
          'contact.email',
          'address.street',
          'address.countryCode',
        ]),
      );
    });

    it('applies a new company name to pending orders only', async () => {
      // ERNSH has pending (unshipped) orders in the classic data.
      await t.api
        .patch('/v1/customers/ERNSH', { companyName: 'Ernst Handel AG' })
        .expect(200);

      const pending = await t.api
        .get('/v1/customers/ERNSH/orders?status=pending')
        .expect(200);
      const shipped = await t.api
        .get('/v1/customers/ERNSH/orders?status=shipped&limit=1')
        .expect(200);
      expect(pending.body.meta.total).toBeGreaterThan(0);
      expect(
        pending.body.data.every(
          (o: { customer: { companyName: string } }) =>
            o.customer.companyName === 'Ernst Handel AG',
        ),
      ).toBe(true);
      expect(shipped.body.data[0].customer.companyName).toBe('Ernst Handel');
    });

    it('soft-deletes customers and stops them from placing orders', async () => {
      await t.api.delete('/v1/customers/BLUMA').expect(200);
      const again = await t.api.delete('/v1/customers/BLUMA').expect(200);
      expect(again.body.deletedAt).toEqual(expect.any(String));

      const order = await t.api
        .post('/v1/orders', {
          customerId: 'BLUMA',
          employeeId: 'EMP-001',
          lines: [{ productId: 'PRD-001', quantity: 1 }],
        })
        .expect(400);
      expect(order.body.errors).toEqual([
        {
          field: 'customerId',
          messages: ['Customer "BLUMA" has been deleted.'],
        },
      ]);
    });
  });

  describe('employees', () => {
    it('lists employees without notes, and gets one with notes', async () => {
      const list = await t.api.get('/v1/employees').expect(200);
      expect(list.body.meta.total).toBe(9);
      expect(list.body.data[0]).not.toHaveProperty('notes');

      const one = await t.api.get('/v1/employees/EMP-001').expect(200);
      expect(one.body.notes).toEqual(expect.any(String));
      expect(one.body.reportsTo).toMatchObject({
        code: 'EMP-002',
        name: 'Andrew Fuller',
      });
    });

    it('lists direct reports and filters by territory', async () => {
      const reports = await t.api
        .get('/v1/employees/EMP-002/reports')
        .expect(200);
      expect(reports.body.meta.total).toBe(5);

      const territory = await t.api
        .get('/v1/employees?territory=06897')
        .expect(200);
      expect(territory.body.data.map((e: { code: string }) => e.code)).toEqual([
        'EMP-001',
      ]);
    });

    it('hires an employee with a manager and territories', async () => {
      const res = await t.api
        .post('/v1/employees', {
          firstName: 'Lena',
          lastName: 'Park',
          hireDate: '2026-10-01',
          address: {
            street: '1 Pike St',
            city: 'Seattle',
            region: 'WA',
            countryCode: 'US',
          },
          reportsToId: 'EMP-005',
          territoryCodes: ['98004', '98052'],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        code: 'EMP-010',
        hireDate: '2026-10-01T00:00:00.000Z',
        reportsTo: { code: 'EMP-005', name: 'Steven Buchanan' },
        territories: [
          { code: '98004', name: 'Bellevue', regionCode: 'REG-02' },
          { code: '98052', name: 'Redmond', regionCode: 'REG-02' },
        ],
      });
    });

    it('rejects unknown territories and reporting cycles', async () => {
      const territory = await t.api
        .patch('/v1/employees/EMP-010', { territoryCodes: ['00000'] })
        .expect(400);
      expect(territory.body.errors[0]).toEqual({
        field: 'territoryCodes',
        messages: ['Unknown territory code(s): 00000.'],
      });

      // EMP-002 manages EMP-005, who manages EMP-010: EMP-002 can't report to EMP-010.
      const cycle = await t.api
        .patch('/v1/employees/EMP-002', { reportsToId: 'EMP-010' })
        .expect(400);
      expect(cycle.body.detail).toMatch(/cannot report to themselves/);
      await t.api
        .patch('/v1/employees/EMP-010', { reportsToId: 'EMP-010' })
        .expect(400);
    });

    it('applies a new name to direct reports and pending orders', async () => {
      await t.api
        .patch('/v1/employees/EMP-005', { lastName: 'Buchanan-Lee' })
        .expect(200);

      const report = await t.api.get('/v1/employees/EMP-010').expect(200);
      expect(report.body.reportsTo.name).toBe('Steven Buchanan-Lee');
    });

    it('refuses to delete a manager with active reports', async () => {
      const res = await t.api.delete('/v1/employees/EMP-005').expect(409);
      expect(res.body.detail).toMatch(/direct report/);

      await t.api
        .patch('/v1/employees/EMP-010', { reportsToId: null })
        .expect(200);
      await t.api.delete('/v1/employees/EMP-010').expect(200);
    });
  });
});
