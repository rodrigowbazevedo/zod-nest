import { z } from 'zod';

import type { ZodNestRegistry } from '../../schema/registry.js';
import type { SchemaRefResolution } from './zod-schema-ref.js';

import { isOptionalProp } from '../../schema/composition.js';
import { ZodNestError } from '../../schema/errors.js';
import { defaultRegistry, registerSchema } from '../../schema/registry.js';
import { resolveSchemaRef } from './zod-schema-ref.js';

const isZodObject = (schema: z.ZodType): schema is z.ZodObject => schema._zod.def.type === 'object';

export interface ExpandedParam {
  readonly name: string;
  readonly required: boolean;
  readonly resolution: SchemaRefResolution;
}

export interface ExpandObjectSchemaOptions {
  readonly id?: string;
  readonly registry?: ZodNestRegistry;
  /**
   * When `true`, every expanded property is marked `required` regardless of
   * its Zod optionality — path params can't be optional in OpenAPI.
   */
  readonly forceRequired?: boolean;
  /** Decorator name used in error messages, e.g. `@ZodQuery`. */
  readonly decoratorName: string;
}

/**
 * Expand a Zod object schema into one parameter entry per property. Used by
 * `@ZodQuery`, `@ZodParam`, `@ZodHeaders`, and `@ZodCookies` — they all
 * project an object schema onto N named OpenAPI parameters.
 *
 * Registers the root schema (when it has an id) so `components.schemas[id]`
 * holds the full object body for cross-referencing. Each property's schema
 * goes through `resolveSchemaRef` independently: named properties become
 * `$ref`s, anonymous properties inline.
 *
 * Throws `ZodNestError` when the schema is not a `z.object` — non-object
 * schemas can't be represented as a flat list of named params in OpenAPI.
 */
export const expandObjectSchema = (
  schema: z.ZodType,
  options: ExpandObjectSchemaOptions,
): ExpandedParam[] => {
  if (!isZodObject(schema)) {
    throw new ZodNestError(
      `${options.decoratorName} requires a \`z.object({...})\` schema (got \`${schema._zod.def.type}\`). ` +
        `Each property of the object becomes one OpenAPI parameter. ` +
        `For non-object body shapes (intersections, unions, primitives), use \`@ZodBody\` instead.`,
    );
  }
  const registry = options.registry ?? defaultRegistry;
  // Register the root if it has an id — it isn't referenced by the per-property
  // expansion below, so it'll only land in `components.schemas` when something
  // else references it (`@ZodBody`, another decorator, a manual `$ref`).
  // Idempotent + harmless when the schema is anonymous.
  registerSchema(schema, registry, { id: options.id });
  const { shape } = schema;
  const result: ExpandedParam[] = [];
  for (const name of Object.keys(shape)) {
    const propSchema = shape[name];
    if (propSchema === undefined) {
      continue;
    }
    const resolution = resolveSchemaRef(propSchema, { registry });
    const required = options.forceRequired === true || !isOptionalProp(propSchema);
    result.push({ name, required, resolution });
  }
  return result;
};

/**
 * Resolve the JSON Schema body for a single expanded parameter. `$ref` for
 * named property schemas, otherwise the inline JSON Schema body.
 */
export const paramSchemaBody = (
  resolution: SchemaRefResolution,
): { $ref: string } | Record<string, unknown> =>
  resolution.kind === 'ref' ? resolution.ref : resolution.schema;
