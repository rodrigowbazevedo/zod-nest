import { z } from 'zod';

import { type ZodNestRegistry } from '../schema/registry.js';
import { expandObjectSchema, paramSchemaBody } from './internal/zod-param-expand.js';

export interface ZodCookiesOptions {
  /** Forces this id on the root schema, overriding any `.meta({ id })`. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
}

/**
 * `@nestjs/swagger`'s metadata key for accumulated parameter objects. Each
 * entry is `{ name, in, schema, required, ... }`. Mirrored verbatim from
 * `@nestjs/swagger/dist/constants.js`'s `DECORATORS.API_PARAMETERS` —
 * inlined as a string literal so we don't reach into the package's deep
 * import paths.
 */
const API_PARAMETERS_KEY = 'swagger/apiParameters';

interface CookieParameter {
  readonly name: string;
  readonly in: 'cookie';
  readonly required: boolean;
  readonly schema: { readonly $ref: string } | Record<string, unknown>;
}

/**
 * Method-level decorator that expands a `z.object` schema into one
 * cookie-parameter entry per property in the OpenAPI operation. There is no
 * `@ApiCookie` decorator in `@nestjs/swagger`, so we write directly to the
 * `swagger/apiParameters` metadata key the explorer reads — the same key
 * `@ApiQuery` / `@ApiParam` / `@ApiHeader` populate via their helper.
 */
export const ZodCookies = (schema: z.ZodType, options?: ZodCookiesOptions): MethodDecorator => {
  const expanded = expandObjectSchema(schema, {
    id: options?.id,
    registry: options?.registry,
    decoratorName: '@ZodCookies',
  });
  const newEntries: CookieParameter[] = expanded.map(({ name, required, resolution }) => ({
    name,
    in: 'cookie',
    required,
    schema: paramSchemaBody(resolution),
  }));
  return (_target, _propertyKey, descriptor: PropertyDescriptor): void => {
    const handler = descriptor.value as object | undefined;
    if (handler === undefined) {
      return;
    }
    const existing: unknown[] = Reflect.getMetadata(API_PARAMETERS_KEY, handler) ?? [];
    Reflect.defineMetadata(API_PARAMETERS_KEY, [...existing, ...newEntries], handler);
  };
};
