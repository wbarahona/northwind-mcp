import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiIdOrCodeParam,
  type IdOrCodeFilter,
  ParseIdOrCodePipe,
} from '../common/ids/id-or-code';
import { ApiProblemResponses } from '../common/openapi';
import { ApiPaginatedResponse } from '../common/pagination/pagination';
import { ListRegionsQueryDto, RegionDto } from './regions.dto';
import { RegionsService } from './regions.service';

@ApiTags('regions')
@ApiProblemResponses(400, 401, 429)
@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List sales regions with their territories',
    description:
      'Read-only: Eastern, Western, Northern and Southern, each with its territories.',
  })
  @ApiPaginatedResponse(RegionDto)
  listRegions(@Query() query: ListRegionsQueryDto) {
    return this.regions.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a region by id or code',
    description:
      'Code like REG-01 or the ObjectId, with its territories (code and name).',
  })
  @ApiIdOrCodeParam('REG-01')
  @ApiOkResponse({ type: RegionDto })
  @ApiProblemResponses(404)
  getRegion(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.regions.get(filter);
  }
}
