import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MODEL_DEFINITIONS } from '@northwind/db';

/**
 * Registers every Northwind model once, globally, so feature modules can
 * `@InjectModel(ModelName.Order)` without their own `forFeature()`.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([...MODEL_DEFINITIONS])],
  exports: [MongooseModule],
})
export class DatabaseModule {}
