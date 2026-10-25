import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModelName, type Region } from '@northwind/db';
import type { Model } from 'mongoose';
import { findOneOrFail, findPage } from '../common/crud/crud';
import type { IdOrCodeFilter } from '../common/ids/id-or-code';
import type { ListRegionsQueryDto } from './regions.dto';
import { REGION_SORT } from './regions.dto';

@Injectable()
export class RegionsService {
  constructor(
    @InjectModel(ModelName.Region) private readonly regions: Model<Region>,
  ) {}

  list(query: ListRegionsQueryDto) {
    return findPage(this.regions, {}, query, {
      sortable: REGION_SORT.fields,
      defaultSort: REGION_SORT.default,
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.regions, filter, 'Region');
  }
}
