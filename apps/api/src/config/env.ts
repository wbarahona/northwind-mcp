import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsIP,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Environment variables the API accepts. Validated once at startup. */
export class Env {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  /**
   * Interface to listen on. The default keeps the API on this machine; the Docker image
   * sets 0.0.0.0, the container's own interface (Compose still publishes it on 127.0.0.1).
   */
  @IsIP(undefined, {
    message: 'HOST must be an IP address such as 127.0.0.1 or 0.0.0.0',
  })
  HOST = '127.0.0.1';

  @Matches(/^mongodb(\+srv)?:\/\/.+/, {
    message:
      'MONGO_URI must be a mongodb:// or mongodb+srv:// connection string',
  })
  MONGO_URI: string;

  /** Comma-separated in the environment, an array once validated. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty({ message: 'API_KEYS must contain at least one key' })
  @IsString({ each: true })
  API_KEYS: string[];

  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: LogLevel;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_TTL_MS = 60_000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 300;
}

/** Used as `ConfigModule.forRoot({ validate })`: fails fast with every problem listed. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { exposeDefaultValues: true });
  const errors = validateSync(env);

  if (errors.length > 0) {
    const problems = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new Error(
      `Invalid environment configuration:\n  - ${problems.join('\n  - ')}`,
    );
  }

  return env;
}
