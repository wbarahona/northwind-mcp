import type { Employee, EmployeeSummary } from '@northwind/api-client';
import { z } from 'zod';
import { Address, compact, Day, day, Ref } from './common';

const fullName = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;

const Territory = z.object({
  code: z.string().describe('5-digit territory code'),
  name: z.string(),
  region: z.string().describe('Region code, e.g. REG-01'),
});

export const EmployeeRow = z.object({
  code: z.string(),
  name: z.string(),
  title: z.string().optional(),
  reportsTo: Ref.optional().describe('Manager'),
  hireDate: Day.optional(),
  city: z.string(),
  country: z.string(),
  territories: z.array(z.string()).describe('Territory names'),
  deleted: z.string().optional().describe('Set when the employee has left'),
});

export const EmployeeView = z.object({
  code: z.string(),
  name: z.string(),
  title: z.string().optional(),
  titleOfCourtesy: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  extension: z.string().optional(),
  birthDate: Day.optional(),
  hireDate: Day.optional(),
  address: Address.omit({ name: true }),
  reportsTo: Ref.optional().describe('Manager'),
  directReports: z.array(Ref).describe('Employees who report to this one'),
  territories: z.array(Territory),
  notes: z.string().optional(),
  deleted: z.string().optional().describe('Set when the employee has left'),
});
export type EmployeeView = z.infer<typeof EmployeeView>;

const managerRef = (e: EmployeeSummary) =>
  e.reportsTo ? { code: e.reportsTo.code, name: e.reportsTo.name } : undefined;

export function presentEmployeeRow(
  e: EmployeeSummary,
): z.infer<typeof EmployeeRow> {
  return compact({
    code: e.code,
    name: fullName(e),
    title: e.title,
    reportsTo: managerRef(e),
    hireDate: e.hireDate && day(e.hireDate),
    city: e.address.city,
    country: e.address.country,
    territories: e.territories.map((t) => t.name),
    deleted: e.deletedAt && day(e.deletedAt),
  });
}

export function presentEmployee(
  e: Employee,
  directReports: EmployeeSummary[],
): EmployeeView {
  return compact({
    code: e.code,
    name: fullName(e),
    title: e.title,
    titleOfCourtesy: e.titleOfCourtesy,
    email: e.email,
    phone: e.phone,
    extension: e.extension,
    birthDate: e.birthDate && day(e.birthDate),
    hireDate: e.hireDate && day(e.hireDate),
    address: compact({
      street: e.address.street,
      city: e.address.city,
      region: e.address.region,
      postalCode: e.address.postalCode,
      country: e.address.country,
      countryCode: e.address.countryCode,
    }),
    reportsTo: managerRef(e),
    directReports: directReports.map((r) => ({
      code: r.code,
      name: fullName(r),
    })),
    territories: e.territories.map((t) => ({
      code: t.code,
      name: t.name,
      region: t.regionCode,
    })),
    notes: e.notes,
    deleted: e.deletedAt && day(e.deletedAt),
  });
}
