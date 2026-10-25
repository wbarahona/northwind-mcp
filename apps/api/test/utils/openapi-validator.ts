import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Schema = Record<string, unknown>;

interface Spec {
  paths: Record<
    string,
    Record<string, { operationId: string; responses: Record<string, Response> }>
  >;
  components: { schemas: Record<string, Schema> };
}
interface Response {
  content?: Record<string, { schema: Schema }>;
}

/**
 * Validates real API responses against the committed apps/api/openapi.json. Strict: every
 * object with listed properties rejects undocumented ones, so drift in either direction
 * (a documented field missing, or an undocumented one returned) fails.
 */
export class OpenApiValidator {
  private readonly spec: Spec;
  private readonly ajv = new Ajv({ strict: false, allErrors: true });
  private readonly cache = new Map<string, ValidateFunction>();

  constructor(path = join(__dirname, '..', '..', 'openapi.json')) {
    this.spec = JSON.parse(readFileSync(path, 'utf8')) as Spec;
    addFormats(this.ajv);
    this.ajv.addSchema(
      {
        components: {
          schemas: mapValues(this.spec.components.schemas, toJsonSchema),
        },
      },
      'spec',
    );
  }

  /** Throws with every mismatch if `body` doesn't match the operation's documented response. */
  assertResponse(operationId: string, status: number, body: unknown): void {
    const validate = this.validator(operationId, status);
    if (!validate(body)) {
      const problems = (validate.errors ?? [])
        .map(
          (e) =>
            `${e.instancePath || '(root)'} ${e.message ?? ''} ${JSON.stringify(e.params)}`,
        )
        .join('\n  ');
      throw new Error(
        `${operationId} ${status} response doesn't match openapi.json:\n  ${problems}`,
      );
    }
  }

  private validator(operationId: string, status: number): ValidateFunction {
    const key = `${operationId} ${status}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const operation = Object.values(this.spec.paths)
      .flatMap((methods) => Object.values(methods))
      .find((op) => op.operationId === operationId);
    const content = operation?.responses[String(status)]?.content;
    const schema = content && Object.values(content)[0]?.schema;
    if (!schema)
      throw new Error(
        `openapi.json documents no ${status} body for ${operationId}`,
      );

    const validate = this.ajv.compile(toJsonSchema(schema));
    this.cache.set(key, validate);
    return validate;
  }
}

/** OpenAPI 3.0 schema → JSON Schema: `nullable`, ref paths, strict objects. */
function toJsonSchema(input: unknown): Schema {
  if (Array.isArray(input)) return input.map(toJsonSchema) as unknown as Schema;
  if (!input || typeof input !== 'object') return input as Schema;

  const {
    nullable,
    example: _example,
    ...rest
  } = input as Schema & { nullable?: boolean };
  const schema = mapValues(rest, (value, key) =>
    key === '$ref' && typeof value === 'string'
      ? value.replace('#/components/', 'spec#/components/')
      : toJsonSchema(value),
  );

  if (schema.properties && schema.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }
  if (!nullable) return schema;

  // `allOf: [$ref]` + nullable: the reference or null. Plain types: add "null".
  if (schema.allOf) {
    const { type: _type, ...withoutType } = schema;
    return { anyOf: [withoutType, { type: 'null' }] };
  }
  return { ...schema, type: [schema.type, 'null'] };
}

function mapValues<T>(
  object: Record<string, T>,
  fn: (value: T, key: string) => unknown,
): Schema {
  return Object.fromEntries(
    Object.entries(object).map(([k, v]) => [k, fn(v, k)]),
  );
}
