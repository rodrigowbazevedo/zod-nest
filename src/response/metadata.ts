import type { z } from 'zod';
import type { ZodDto } from '../dto/dto.types.js';

/**
 * Public metadata key for the array of `ResponseVariant` records attached
 * to handler methods by `@ZodResponse(...)`. Symbol.for() so external
 * consumers (e.g. custom interceptors or doc builders) can read the same
 * registry across realms.
 */
export const ZOD_RESPONSES_METADATA_KEY = Symbol.for('zod-nest.responses');

export type ResponseVariantKind = 'single' | 'array' | 'tuple';

/**
 * OpenAPI 3.1 range keys accepted by `@ZodResponse({ status })`. Matched
 * by `ZodSerializerInterceptor` after exact numeric matches fail —
 * `'2XX'` covers 200–299, `'4XX'` covers 400–499, and so on.
 */
export type ResponseStatusWildcard = '1XX' | '2XX' | '3XX' | '4XX' | '5XX';

/**
 * Description payload accepted by `@ZodResponse(...)` and passed through to
 * `applyZodNest`'s `@ApiResponse(...)` emitter. String form is shorthand for
 * `{ description }`; the object form lets users declare OpenAPI response
 * `headers` / `links` alongside the description.
 */
export type ZodResponseDescription =
  | string
  | {
      description: string;
      headers?: Record<string, unknown>;
      links?: Record<string, unknown>;
    };

/**
 * One variant record per `@ZodResponse(...)` call. `dto` is kept alongside
 * `validationSchema` so `applyZodNest` can emit `@ApiResponse({ type })`
 * without unwrapping the runtime-only `z.array(...)` / `z.tuple([...])` wrapper.
 *
 * `status` is `undefined` when the user didn't pass one explicitly OR when
 * the user wrote `'default'` (the decorator collapses both to `undefined` —
 * they mean the same thing: "resolve to the method's default status at
 * request time"). The effective status is resolved lazily by
 * `resolveEffectiveStatus(variant, handler)` because `@ZodResponse` runs
 * *before* NestJS' route decorators (`@Get`, `@Post`, ...) under
 * TypeScript's bottom-up application order, so `METHOD_METADATA` is not
 * yet set when the decorator evaluates.
 *
 * A wildcard string (`'2XX'` / `'4XX'` / ...) is kept verbatim — the
 * matcher in `ZodSerializerInterceptor` handles range comparison.
 */
export interface ResponseVariant {
  status: number | ResponseStatusWildcard | undefined;
  kind: ResponseVariantKind;
  dto: ZodDto | readonly ZodDto[];
  validationSchema: z.ZodType;
  description?: ZodResponseDescription;
  passthroughOnError: boolean;
}

export const getResponseVariants = (handler: object): readonly ResponseVariant[] | undefined => {
  const meta = Reflect.getMetadata(ZOD_RESPONSES_METADATA_KEY, handler) as
    | ResponseVariant[]
    | undefined;
  return meta;
};

/**
 * Append a variant to the handler's metadata array. Implemented as a
 * prepend so the runtime ordering matches author order in the source —
 * TS decorators apply bottom-up, so the last-applied decorator (top of
 * the source) needs to land at the head of the array.
 */
export const appendResponseVariant = (handler: object, variant: ResponseVariant): void => {
  const existing =
    (Reflect.getMetadata(ZOD_RESPONSES_METADATA_KEY, handler) as ResponseVariant[] | undefined) ??
    [];
  Reflect.defineMetadata(ZOD_RESPONSES_METADATA_KEY, [variant, ...existing], handler);
};
