import { createTestApp, type TestApp } from './utils/test-app';

describe('Catalog: products, categories, suppliers, shippers, regions (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  describe('products', () => {
    it('lists the 77 products with decimal prices and copied references', async () => {
      const res = await t.api.get('/v1/products?limit=1').expect(200);

      expect(res.body.meta).toEqual({
        page: 1,
        limit: 1,
        total: 77,
        totalPages: 77,
      });
      expect(res.body.data[0]).toMatchObject({
        code: 'PRD-001',
        name: 'Chai',
        unitPrice: '18.00',
        category: { code: 'CAT-01', name: 'Beverages' },
        supplier: { code: 'SUP-001', companyName: 'Exotic Liquids' },
        discontinued: false,
      });
      expect(res.body.data[0]).not.toHaveProperty('_id');
    });

    it('filters by category code (any case), price range and stock, sorted by price', async () => {
      const res = await t.api
        .get(
          '/v1/products?categoryId=cat-04&minPrice=20&maxPrice=40&inStock=true&sort=-unitPrice',
        )
        .expect(200);
      const prices = res.body.data.map((p: { unitPrice: string }) =>
        Number(p.unitPrice),
      );

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every(
          (p: { category: { code: string } }) => p.category.code === 'CAT-04',
        ),
      ).toBe(true);
      expect(prices.every((p: number) => p >= 20 && p <= 40)).toBe(true);
      expect(prices).toEqual([...prices].sort((a, b) => b - a));
    });

    it('lists the 8 discontinued products', async () => {
      const res = await t.api.get('/v1/products?discontinued=true').expect(200);
      expect(res.body.meta.total).toBe(8);
    });

    it('finds products by text search', async () => {
      const res = await t.api.get('/v1/products?q=queso').expect(200);
      const names = res.body.data.map((p: { name: string }) => p.name);

      expect(names).toEqual(
        expect.arrayContaining(['Queso Cabrales', 'Queso Manchego La Pastora']),
      );
    });

    it('rejects malformed filters with field errors', async () => {
      const res = await t.api
        .get('/v1/products?discontinued=maybe&minPrice=1.234')
        .expect(400);
      const fields = res.body.errors.map((e: { field: string }) => e.field);

      expect(fields).toEqual(
        expect.arrayContaining(['discontinued', 'minPrice']),
      );
    });

    it('creates a product with the next code, resolving references by code', async () => {
      const res = await t.api
        .post('/v1/products', {
          name: 'Cold Brew',
          categoryId: 'CAT-01',
          supplierId: 'sup-001',
          unitPrice: 4.5,
          unitsInStock: 12,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        code: 'PRD-078',
        unitPrice: '4.50',
        unitsInStock: 12,
        unitsOnOrder: 0,
        category: { code: 'CAT-01', name: 'Beverages' },
        supplier: { code: 'SUP-001' },
      });
    });

    it('reports an unknown reference on its field', async () => {
      const res = await t.api
        .post('/v1/products', {
          name: 'Ghost',
          categoryId: 'CAT-99',
          supplierId: 'SUP-001',
          unitPrice: '1.00',
        })
        .expect(400);

      expect(res.body.errors).toEqual([
        { field: 'categoryId', messages: ['Category "CAT-99" was not found.'] },
      ]);
    });

    it('refuses to delete a product that has orders, but deletes an unused one', async () => {
      const used = await t.api.delete('/v1/products/PRD-001').expect(409);
      expect(used.body.detail).toMatch(/discontinued/);

      await t.api.delete('/v1/products/PRD-078').expect(200);
      await t.api.get('/v1/products/PRD-078').expect(404);
    });
  });

  describe('categories', () => {
    it('renames a category on every product in it', async () => {
      await t.api
        .patch('/v1/categories/CAT-01', { name: 'Drinks' })
        .expect(200);

      const res = await t.api
        .get('/v1/categories/CAT-01/products?limit=100')
        .expect(200);
      expect(res.body.meta.total).toBe(12);
      expect(
        res.body.data.every(
          (p: { category: { name: string } }) => p.category.name === 'Drinks',
        ),
      ).toBe(true);
    });

    it('rejects a duplicate category name with 409', async () => {
      const res = await t.api
        .post('/v1/categories', { name: 'Seafood' })
        .expect(409);
      expect(res.body.detail).toBe(
        'A record with name "Seafood" already exists.',
      );
    });

    it('deletes only empty categories', async () => {
      await t.api.delete('/v1/categories/CAT-02').expect(409);

      const created = await t.api
        .post('/v1/categories', { name: 'Frozen Foods' })
        .expect(201);
      // Like SQL identity columns, a failed create can use up a number, so don't assume CAT-09.
      expect(created.body.code).toMatch(/^CAT-\d{2}$/);
      await t.api.delete(`/v1/categories/${created.body.id}`).expect(200);
    });

    it('returns 404 for an unknown category', async () => {
      const res = await t.api.get('/v1/categories/CAT-99/products').expect(404);
      expect(res.body.detail).toBe('Category "CAT-99" was not found.');
    });
  });

  describe('suppliers', () => {
    it('filters by country code or name', async () => {
      const byCode = await t.api.get('/v1/suppliers?country=jp').expect(200);
      const byName = await t.api.get('/v1/suppliers?country=Japan').expect(200);

      expect(byCode.body.meta.total).toBe(2);
      expect(byName.body.data).toEqual(byCode.body.data);
    });

    it('renames a supplier on its products and lists them', async () => {
      await t.api
        .patch('/v1/suppliers/SUP-001', { companyName: 'Exotic Liquids Ltd' })
        .expect(200);

      const res = await t.api.get('/v1/suppliers/SUP-001/products').expect(200);
      expect(
        res.body.data.map(
          (p: { supplier: { companyName: string } }) => p.supplier.companyName,
        ),
      ).toEqual([
        'Exotic Liquids Ltd',
        'Exotic Liquids Ltd',
        'Exotic Liquids Ltd',
      ]);
    });

    it('fills in the country name from the code and rejects unknown codes', async () => {
      const base = {
        companyName: 'Andes Coffee',
        contact: { name: 'Rosa Quispe' },
        address: { street: 'Av. Sol 100', city: 'Cusco', countryCode: 'pe' },
        homePage: 'https://andes-coffee.example',
      };
      const res = await t.api.post('/v1/suppliers', base).expect(201);
      expect(res.body).toMatchObject({
        code: 'SUP-030',
        address: { country: 'Peru', countryCode: 'PE' },
      });

      const bad = await t.api
        .post('/v1/suppliers', {
          ...base,
          address: { ...base.address, countryCode: 'QQ' },
        })
        .expect(400);
      expect(bad.body.errors[0].field).toBe('address.countryCode');
    });

    it('soft-deletes: hidden from lists, still readable, unusable for new products', async () => {
      await t.api.delete('/v1/suppliers/SUP-030').expect(200);

      const list = await t.api.get('/v1/suppliers?limit=100').expect(200);
      expect(list.body.meta.total).toBe(29);
      const withDeleted = await t.api
        .get('/v1/suppliers?includeDeleted=true&limit=100')
        .expect(200);
      expect(withDeleted.body.meta.total).toBe(30);

      const one = await t.api.get('/v1/suppliers/SUP-030').expect(200);
      expect(one.body.deletedAt).toEqual(expect.any(String));

      const product = await t.api
        .post('/v1/products', {
          name: 'X',
          categoryId: 'CAT-01',
          supplierId: 'SUP-030',
          unitPrice: '1',
        })
        .expect(400);
      expect(product.body.errors[0].messages[0]).toMatch(/has been deleted/);

      await t.api
        .patch('/v1/suppliers/SUP-030', { companyName: 'Y' })
        .expect(409);
    });
  });

  describe('shippers and regions', () => {
    it('lists the three shippers with E.164 phones', async () => {
      const res = await t.api.get('/v1/shippers').expect(200);
      expect(res.body.data.map((s: { phone: string }) => s.phone)).toEqual([
        '+15035559831',
        '+15035553199',
        '+15035559931',
      ]);
    });

    it('rejects a phone that is not E.164', async () => {
      const res = await t.api
        .post('/v1/shippers', { companyName: 'Fast', phone: '555-1234' })
        .expect(400);
      expect(res.body.errors[0].field).toBe('phone');
    });

    it('creates, renames and soft-deletes a shipper', async () => {
      const created = await t.api
        .post('/v1/shippers', {
          companyName: 'Nordic Freight',
          phone: '+4722334455',
        })
        .expect(201);
      expect(created.body).toMatchObject({ code: 'SHP-04', deletedAt: null });

      // A pending order using the shipper picks up its new name.
      const order = await t.api
        .post('/v1/orders', {
          customerId: 'ALFKI',
          employeeId: 'EMP-001',
          shipperId: 'SHP-04',
          lines: [{ productId: 'PRD-001', quantity: 1 }],
        })
        .expect(201);
      await t.api
        .patch('/v1/shippers/SHP-04', { companyName: 'Nordic Freight AS' })
        .expect(200);
      const renamed = await t.api
        .get(`/v1/orders/${order.body.code}`)
        .expect(200);
      expect(renamed.body.shipper.companyName).toBe('Nordic Freight AS');

      await t.api.delete('/v1/shippers/SHP-04').expect(200);
      const listed = await t.api.get('/v1/shippers').expect(200);
      expect(listed.body.meta.total).toBe(3);
      const ship = await t.api
        .post(`/v1/orders/${order.body.code}/ship`, { shipperId: 'SHP-04' })
        .expect(400);
      expect(ship.body.errors[0].messages[0]).toMatch(/has been deleted/);
      await t.api
        .patch('/v1/shippers/SHP-04', { phone: '+4722334456' })
        .expect(409);
    });

    it('lists regions with their territories', async () => {
      const res = await t.api.get('/v1/regions').expect(200);
      const territories = res.body.data.flatMap(
        (r: { territories: unknown[] }) => r.territories,
      );

      expect(res.body.data.map((r: { name: string }) => r.name)).toEqual([
        'Eastern',
        'Western',
        'Northern',
        'Southern',
      ]);
      expect(territories).toHaveLength(53);
    });
  });
});
