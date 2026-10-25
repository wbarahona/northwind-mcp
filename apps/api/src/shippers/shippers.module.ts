import { Module } from '@nestjs/common';
import { ShippersController } from './shippers.controller';
import { ShippersService } from './shippers.service';

@Module({
  controllers: [ShippersController],
  providers: [ShippersService],
})
export class ShippersModule {}
