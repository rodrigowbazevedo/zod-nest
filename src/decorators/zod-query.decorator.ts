import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

import { type ZodNestRegistry } from '../schema/registry.js';
import { expandObjectSchema, paramSchemaBody } from './internal/zod-param-expand.js';

export interface ZodQueryOptions {
  /** Forces this id on the root schema, overriding any `.meta({ id })`. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
}

/**
 * Method-level decorator that expands a `z.object` schema into one
 * `@ApiQuery` entry per property. Each property's schema is independently
 * resolved — named properties (`.meta({ id })`) become `$ref`s,
 * anonymous properties inline.
 *
 * The user remains responsible for binding the actual query values to the
 * handler, typically via `@Query(new ZodValidationPipe(schema)) q: z.infer<typeof schema>`.
 */
export const ZodQuery = (schema: z.ZodType, options?: ZodQueryOptions): MethodDecorator => {
  const expanded = expandObjectSchema(schema, {
    id: options?.id,
    registry: options?.registry,
    decoratorName: '@ZodQuery',
  });
  return applyDecorators(
    ...expanded.map(({ name, required, resolution }) =>
      ApiQuery({ name, schema: paramSchemaBody(resolution), required }),
    ),
  );
};
