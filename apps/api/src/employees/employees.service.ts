import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type Counter,
  type Employee,
  type EmployeeTerritory,
  ModelName,
  nextCode,
  type Order,
  type Region,
} from '@northwind/db';
import type { Connection, Model, QueryFilter, Types } from 'mongoose';
import { toAddress } from '../common/crud/address';
import {
  containsInsensitive,
  describe,
  findDocumentOrFail,
  findOneOrFail,
  findPage,
  refFilter,
  resolveReference,
} from '../common/crud/crud';
import {
  activeFilter,
  assertNotDeleted,
  softDelete,
} from '../common/crud/soft-delete';
import { ValidationException } from '../common/errors/validation.exception';
import type { IdOrCodeFilter } from '../common/ids/id-or-code';
import type {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { EMPLOYEE_SORT } from './employees.dto';

const fullName = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(ModelName.Employee)
    private readonly employees: Model<Employee>,
    @InjectModel(ModelName.Region) private readonly regions: Model<Region>,
    @InjectModel(ModelName.Order) private readonly orders: Model<Order>,
    @InjectModel(ModelName.Counter) private readonly counters: Model<Counter>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  list(query: ListEmployeesQueryDto) {
    const filter: QueryFilter<Employee> = {
      ...activeFilter(query.includeDeleted),
    };
    if (query.q) {
      filter.$or = [
        { firstName: containsInsensitive(query.q) },
        { lastName: containsInsensitive(query.q) },
      ];
    }
    if (query.reportsToId)
      Object.assign(filter, refFilter('reportsTo', query.reportsToId));
    if (query.territory) filter['territories.code'] = query.territory;

    return findPage(this.employees, filter, query, {
      sortable: EMPLOYEE_SORT.fields,
      defaultSort: EMPLOYEE_SORT.default,
      projection: { notes: 0 },
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.employees, filter, 'Employee');
  }

  async create(dto: CreateEmployeeDto) {
    const { reportsToId, territoryCodes, ...fields } = dto;
    const employee = await this.employees.create({
      ...fields,
      code: await nextCode(this.counters, 'employees'),
      address: toAddress(dto.address),
      reportsTo: reportsToId ? await this.managerRef(reportsToId) : null,
      territories: await this.resolveTerritories(territoryCodes ?? []),
    });
    return employee.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateEmployeeDto) {
    const employee = await findDocumentOrFail(
      this.employees,
      filter,
      'Employee',
    );
    assertNotDeleted(employee, 'Employee');
    const { reportsToId, territoryCodes, ...fields } = dto;
    const oldName = fullName(employee);

    if (reportsToId !== undefined) {
      employee.reportsTo =
        reportsToId === null ? null : await this.managerRef(reportsToId);
      if (employee.reportsTo)
        await this.assertNoCycle(employee._id, employee.reportsTo._id);
    }
    if (territoryCodes !== undefined) {
      employee.territories = await this.resolveTerritories(territoryCodes);
    }
    employee.set({
      ...fields,
      ...(fields.address && { address: toAddress(fields.address) }),
    });
    const newName = fullName(employee);

    await this.connection.transaction(async (session) => {
      await employee.save({ session });
      if (newName !== oldName) {
        await this.orders.updateMany(
          { status: 'pending', 'employee._id': employee._id },
          { $set: { 'employee.name': newName } },
          { session },
        );
        await this.employees.updateMany(
          { 'reportsTo._id': employee._id },
          { $set: { 'reportsTo.name': newName } },
          { session },
        );
      }
    });
    return employee.toObject();
  }

  /** Soft delete; refused while active employees still report to this one. */
  async remove(filter: IdOrCodeFilter) {
    const employee = await findDocumentOrFail(
      this.employees,
      filter,
      'Employee',
    );
    const reports = await this.employees.countDocuments({
      'reportsTo._id': employee._id,
      deletedAt: null,
    });
    if (reports > 0 && !employee.deletedAt) {
      throw new ConflictException(
        `${describe('Employee', filter)} still has ${reports} direct report(s). ` +
          'Assign them another manager first.',
      );
    }
    return softDelete(employee);
  }

  private async managerRef(idOrCode: string) {
    const manager = await resolveReference(
      this.employees,
      idOrCode,
      'reportsToId',
      'Employee',
    );
    return { _id: manager._id, code: manager.code, name: fullName(manager) };
  }

  /** Walks up the management chain from the new manager; reaching the employee is a cycle. */
  private async assertNoCycle(
    employeeId: Types.ObjectId,
    managerId: Types.ObjectId,
  ) {
    let current: Types.ObjectId | undefined = managerId;
    for (let depth = 0; current && depth < 100; depth++) {
      if (current.equals(employeeId)) {
        throw new BadRequestException(
          'An employee cannot report to themselves, directly or through their reports.',
        );
      }
      const next: Pick<Employee, 'reportsTo'> | null = await this.employees
        .findById(current, { reportsTo: 1 })
        .lean();
      current = next?.reportsTo?._id;
    }
  }

  private async resolveTerritories(
    codes: string[],
  ): Promise<EmployeeTerritory[]> {
    if (codes.length === 0) return [];
    const regions = await this.regions
      .find({ 'territories.code': { $in: codes } })
      .lean();
    const found = new Map(
      regions.flatMap((region) =>
        region.territories.map(
          (t) => [t.code, { ...t, regionCode: region.code }] as const,
        ),
      ),
    );
    const missing = codes.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw new ValidationException([
        {
          field: 'territoryCodes',
          messages: [`Unknown territory code(s): ${missing.join(', ')}.`],
        },
      ]);
    }
    return codes
      .map((code) => found.get(code)!)
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}
