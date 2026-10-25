import type {
  Category,
  Region,
  Shipper,
  Supplier,
} from '@northwind/api-client';
import { z } from 'zod';
import { compact, Ref } from './common';

export const CategoryRow = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const ShipperRow = z.object({
  code: z.string(),
  name: z.string(),
  phone: z.string().optional(),
});

export const SupplierRow = z.object({
  code: z.string(),
  name: z.string(),
  contact: z.object({
    name: z.string(),
    title: z.string().optional(),
    phone: z.string().optional(),
  }),
  city: z.string(),
  country: z.string(),
  homePage: z.string().optional(),
});

export const RegionRow = z.object({
  code: z.string(),
  name: z.string(),
  territories: z.array(Ref).describe('Territory codes (5 digits) and names'),
});

export const presentCategory = (c: Category): z.infer<typeof CategoryRow> =>
  compact({ code: c.code, name: c.name, description: c.description });

export const presentShipper = (s: Shipper): z.infer<typeof ShipperRow> =>
  compact({ code: s.code, name: s.companyName, phone: s.phone });

export const presentSupplier = (s: Supplier): z.infer<typeof SupplierRow> =>
  compact({
    code: s.code,
    name: s.companyName,
    contact: compact({
      name: s.contact.name,
      title: s.contact.title,
      phone: s.contact.phone,
    }),
    city: s.address.city,
    country: s.address.country,
    homePage: s.homePage,
  });

export const presentRegion = (r: Region): z.infer<typeof RegionRow> => ({
  code: r.code,
  name: r.name,
  territories: r.territories.map((t) => ({ code: t.code, name: t.name })),
});
