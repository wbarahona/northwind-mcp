import { parseIsoDate } from './dates';
import { loadRawData } from './raw';
import { transform } from './transform';

describe('transform (real Northwind data)', () => {
  const anchor = parseIsoDate('2026-10-22');
  const { documents, report } = transform(loadRawData(), anchor);

  it('produces every row', () => {
    expect({
      categories: documents.categories.length,
      customers: documents.customers.length,
      employees: documents.employees.length,
      orders: documents.orders.length,
      orderLines: documents.orders.flatMap((o) => o.lines).length,
      products: documents.products.length,
      regions: documents.regions.length,
      territories: documents.regions.flatMap((r) => r.territories).length,
      shippers: documents.shippers.length,
      suppliers: documents.suppliers.length,
    }).toEqual({
      categories: 8,
      customers: 91,
      employees: 9,
      orders: 830,
      orderLines: 2155,
      products: 77,
      regions: 4,
      territories: 53,
      shippers: 3,
      suppliers: 29,
    });
  });

  it('builds order 10248 with historical prices and copied references', () => {
    const order = documents.orders.find((o) => o.code === 'ORD-10248');

    expect(order).toMatchObject({
      customer: { code: 'VINET', companyName: 'Vins et alcools Chevalier' },
      employee: { code: 'EMP-005', name: 'Steven Buchanan' },
      shipper: { code: 'SHP-03', companyName: 'Federal Shipping' },
      freight: '32.38',
      shipTo: { city: 'Reims', country: 'France', countryCode: 'FR' },
      lines: [
        {
          product: { code: 'PRD-011', name: 'Queso Cabrales' },
          unitPrice: '14',
          quantity: 12,
        },
        { product: { code: 'PRD-042' }, unitPrice: '9.8', quantity: 10 },
        { product: { code: 'PRD-072' }, unitPrice: '34.8', quantity: 5 },
      ],
    });
    // Thursday 1996-07-04 stays a Thursday.
    expect(order?.orderDate.getUTCDay()).toBe(4);
  });

  it('keeps every reference consistent with the referenced document', () => {
    const ids = (docs: { _id: unknown; code: string }[]) =>
      new Map(docs.map((d) => [d.code, String(d._id)]));
    const customers = ids(documents.customers);
    const employees = ids(documents.employees);
    const products = ids(documents.products);

    for (const order of documents.orders) {
      expect(String(order.customer._id)).toBe(
        customers.get(order.customer.code),
      );
      expect(String(order.employee._id)).toBe(
        employees.get(order.employee.code),
      );
      for (const line of order.lines) {
        expect(String(line.product._id)).toBe(products.get(line.product.code));
      }
    }
  });

  it('places no order in the future and shifts by whole weeks', () => {
    expect(report.dateShiftDays % 7).toBe(0);
    const latest = Math.max(
      ...documents.orders.map((o) => o.orderDate.getTime()),
    );
    expect(latest).toBeLessThan(anchor.getTime());
  });

  it('shifts employee birth and hire dates by the same amount, keeping ages', () => {
    const nancy = documents.employees.find((e) => e.code === 'EMP-001');
    const ageAtHireYears =
      ((nancy?.hireDate?.getTime() ?? 0) - (nancy?.birthDate?.getTime() ?? 0)) /
      (365.25 * 86_400_000);

    // Born 1948-12-08, hired 1992-05-01 in the original data.
    expect(ageAtHireYears).toBeCloseTo(43.4, 1);
    expect(nancy?.reportsTo).toMatchObject({
      code: 'EMP-002',
      name: 'Andrew Fuller',
    });
  });

  it('modernizes contact data', () => {
    const alfki = documents.customers.find((c) => c.code === 'ALFKI');
    expect(alfki?.contact).toEqual({
      name: 'Maria Anders',
      title: 'Sales Representative',
      email: 'maria.anders@alfreds-futterkiste.example',
      phone: '+49300074321',
    });

    const all = [...documents.customers, ...documents.suppliers];
    expect(all.every((c) => c.contact.email?.endsWith('.example'))).toBe(true);
    expect(all.every((c) => /^[A-Z]{2}$/.test(c.address.countryCode))).toBe(
      true,
    );
    expect(
      documents.employees.every((e) => !e.address.street.includes('\n')),
    ).toBe(true);
  });

  it('sets counters to the highest legacy number per sequence', () => {
    expect(documents.counters).toEqual({
      categories: 8,
      employees: 9,
      orders: 11077,
      products: 77,
      regions: 4,
      shippers: 3,
      suppliers: 29,
    });
  });
});
