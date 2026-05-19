import { z } from 'zod';

import { type ZodNestRegistry } from '../schema/registry.js';
import { API_PARAMETERS_KEY } from './internal/constants.js';
import { expandObjectSchema, paramSchemaBody } from './internal/zod-param-expand.js';

export interface ZodHeadersOptions {
  /** Forces this id on the root schema, overriding any `.meta({ id })`. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
}

interface HeaderParameter {
  readonly name: string;
  readonly in: 'header';
  readonly required: boolean;
  readonly schema: { readonly $ref: string } | Record<string, unknown>;
}

/**
 * Method-level decorator that expands a `z.object` schema into one
 * header-parameter entry per property. Required-ness derives from each
 * property's Zod optionality.
 *
 * Writes directly to the `swagger/apiParameters` metadata key the explorer
 * reads. We bypass `@ApiHeader` because it injects a default `type: 'string'`
 * onto the schema (`api-header.decorator.js`), which pollutes our `$ref`
 * objects and inline JSON Schemas. The raw-metadata path keeps our schema
 * bodies intact.
 */
export const ZodHeaders = (schema: z.ZodType, options?: ZodHeadersOptions): MethodDecorator => {
  const expanded = expandObjectSchema(schema, {
    id: options?.id,
    registry: options?.registry,
    decoratorName: '@ZodHeaders',
  });
  const newEntries: HeaderParameter[] = expanded.map(({ name, required, resolution }) => ({
    name,
    in: 'header',
    required,
    schema: paramSchemaBody(resolution),
  }));
  return (_target, _propertyKey, descriptor) => {
    const handler = descriptor.value;
    if (typeof handler !== 'function') {
      throw new TypeError('[zod-nest] @ZodHeaders can only be applied to methods.');
    }
    const existing: unknown[] = Reflect.getMetadata(API_PARAMETERS_KEY, handler) ?? [];
    Reflect.defineMetadata(API_PARAMETERS_KEY, [...existing, ...newEntries], handler);
  };
};
