import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/auth/public.decorator';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Check API health',
    description:
      'Reports whether the API is up and can reach MongoDB. No API key required.',
  })
  @HealthCheck()
  checkHealth() {
    return this.health.check([() => this.mongoose.pingCheck('mongodb')]);
  }
}
