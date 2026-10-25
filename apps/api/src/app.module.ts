import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { ApiKeyGuard } from './common/auth/api-key.guard';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { ValidationException } from './common/errors/validation.exception';
import { ApiJsonInterceptor } from './common/serialization/api-json.interceptor';
import { type Env, NodeEnv, validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CategoriesModule } from './categories/categories.module';
import { CustomersModule } from './customers/customers.module';
import { EmployeesModule } from './employees/employees.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { RegionsModule } from './regions/regions.module';
import { ShippersModule } from './shippers/shippers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Relative to the working directory: an app-level .env first, then the repo root one.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        const defaultLevel = {
          test: 'silent',
          production: 'info',
          development: 'debug',
        }[nodeEnv];
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }) ?? defaultLevel,
            transport:
              nodeEnv === NodeEnv.Development
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
            redact: ['req.headers["x-api-key"]'],
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url === '/health',
            },
          },
        };
      },
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGO_URI', { infer: true }),
        // Building indexes is the seed's job in production; in dev/test, keep them in sync on boot.
        autoIndex:
          config.get('NODE_ENV', { infer: true }) !== NodeEnv.Production,
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
          limit: config.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
    DatabaseModule,
    HealthModule,
    AnalyticsModule,
    CategoriesModule,
    CustomersModule,
    EmployeesModule,
    OrdersModule,
    ProductsModule,
    RegionsModule,
    ShippersModule,
    SuppliersModule,
  ],
  providers: [
    // Guards run in order: rate-limit first, then authenticate.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) =>
          ValidationException.fromValidationErrors(errors),
      }),
    },
    { provide: APP_INTERCEPTOR, useClass: ApiJsonInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
