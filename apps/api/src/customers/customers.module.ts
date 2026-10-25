import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [OrdersModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
