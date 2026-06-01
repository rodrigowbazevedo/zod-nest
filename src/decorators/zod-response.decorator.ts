import { z } from 'zod';

import type { ZodDto } from '../dto/dto.types.js';
import type {
  ResponseStatusWildcard,
  ResponseVariant,
  ResponseVariantKind,
  ZodResponseDescription,
} from '../response/metadata.js';

import { isZodDto } from '../dto/predicates.js';
import { resolveEffectiveStatus } from '../response/default-status.js';
import { appendResponseVariant } from '../response/metadata.js';
import { DEFAULT_STREAM_MATCHER, resolveContentType } from '../response/stream.js';
import { applySwaggerResponseDecorator } from './zod-response.swagger-bridge.js';

/**
 * Accepted shapes for `@ZodResponse({ type })`:
 * - `Dto` → validates as `Dto.schema` (single-DTO response).
 * - `[Dto]` (length 1) → validates as `z.array(Dto.schema)`; matches Nest's
 *   `@ApiResponse({ isArray: true })` convention without minting a separate
 *   `*sDto` id.
 * - `[A, B, ...]` (length ≥ 2) → validates as `z.tuple([A.schema, B.schema, ...])`;
 *   surfaces as an OpenAPI 3.1 `prefixItems` tuple via `applyZodNest`.
 *
 * Empty arrays and non-DTO elements throw `TypeError` at decoration time
 * so typos surface at module load, not the first request.
 */
export type ZodResponseType = ZodDto | readonly [ZodDto, ...ZodDto[]];

/**
 * Accepted shapes for `@ZodResponse({ status })`:
 * - `number` — exact match against `response.statusCode` (most common case).
 * - `'1XX'` / `'2XX'` / `'3XX'` / `'4XX'` / `'5XX'` — OpenAPI 3.1 range key;
 *   `'2XX'` matches 200–299, etc. Considered only after no exact numeric
 *   variant matches the observed status.
 * - `'default'` — sugar for the handler's method default status. Collapsed
 *   to `undefined` when the variant is built, so `resolveEffectiveStatus`
 *   walks the same `@HttpCode → method-default` chain as an omitted `status`.
 *   This deliberately does NOT implement a catch-all-fallback semantic; it
 *   names the canonical-success card explicitly, matching what consumers
 *   already write in `@ApiResponse({ status: 'default' })`.
 */
export type ResponseStatusInput = number | ResponseStatusWildcard | 'default';

export interface ZodResponseOptions {
  status?: ResponseStatusInput;
  type: ZodResponseType;
  description?: ZodResponseDescription;
  passthroughOnError?: boolean;
  /**
   * Response content type, used as the OpenAPI media-type key (`@ApiResponse`
   * `content`). Defaults to `'application/json'`. Set a stream type
   * (`'text/event-stream'`, `'application/x-ndjson'`, …) to document a streamed
   * body; combined with `stream` it also turns off response validation.
   */
  contentType?: string;
  /**
   * When `true`, the response is written directly to the buffer and
   * `ZodSerializerInterceptor` skips validation. When unset, it is inferred:
   * a stream-typed `contentType` (or a stream-typed `@Header('Content-Type', …)`)
   * implies `true`. See `DEFAULT_STREAM_CONTENT_TYPES`.
   */
  stream?: boolean;
}

interface BuiltKind {
  kind: ResponseVariantKind;
  dto: ZodDto | readonly ZodDto[];
  validationSchema: z.ZodType;
}

type NonEmptyDtoArray = readonly [ZodDto, ...ZodDto[]];

const buildArrayKind = (dtos: NonEmptyDtoArray): BuiltKind => {
  for (const [index, element] of dtos.entries()) {
    if (!isZodDto(element)) {
      throw new TypeError(
        `[zod-nest] @ZodResponse({ type }) element [${index}] is not a zod-nest DTO ` +
          '(class returned by createZodDto). Wrap raw schemas with createZodDto first.',
      );
    }
  }
  const [head, ...rest] = dtos;
  if (rest.length === 0) {
    return { kind: 'array', dto: [head], validationSchema: z.array(head.schema) };
  }
  const tupleSchemas: [z.ZodType, ...z.ZodType[]] = [head.schema, ...rest.map((d) => d.schema)];
  return { kind: 'tuple', dto: dtos, validationSchema: z.tuple(tupleSchemas) };
};

const buildKind = (type: ZodResponseType): BuiltKind => {
  if (Array.isArray(type)) {
    if (type.length === 0) {
      throw new TypeError(
        '[zod-nest] @ZodResponse({ type: [] }) is invalid — provide at least one DTO.',
      );
    }
    // After the length check, `type` is guaranteed non-empty; the static
    // `readonly [ZodDto, ...ZodDto[]]` annotation reflects this so the
    // destructure in `buildArrayKind` doesn't need a runtime undefined guard.
    return buildArrayKind(type as NonEmptyDtoArray);
  }
  if (!isZodDto(type)) {
    throw new TypeError(
      '[zod-nest] @ZodResponse({ type }) must be a zod-nest DTO class (from createZodDto) ' +
        'or an array of such classes.',
    );
  }
  return { kind: 'single', dto: type, validationSchema: type.schema };
};

/**
 * Normalise the user-facing `status` input into the variant-internal shape:
 * `'default'` collapses to `undefined` so the matcher treats it the same as
 * an omitted status (resolve to `defaultStatusFor(handler)` at request time).
 * Numbers and `'NXX'` wildcards pass through untouched.
 */
const normaliseStatus = (
  status: ResponseStatusInput | undefined,
): number | ResponseStatusWildcard | undefined => {
  if (status === 'default') {
    return undefined;
  }
  return status;
};

/**
 * Method-only decorator. Declares a typed response variant for the handler
 * AND applies the equivalent `@ApiResponse(...)` from `@nestjs/swagger` so
 * the OpenAPI document carries the response shape — no need for consumers
 * to hand-write `@ApiResponse` alongside `@ZodResponse`.
 *
 * Stack multiple decorations to declare per-status types; runtime lookup
 * is by `ZodSerializerInterceptor`'s two-pass matcher (exact numeric, then
 * `'NXX'` wildcard). The wrapped Zod schema (array / tuple) is built once
 * at decoration time — no per-request schema construction.
 *
 * **Decorator-ordering note.** TypeScript decorators apply bottom-up, so
 * `@ZodResponse` (typically written above `@Get` / `@HttpCode` /
 * `@Header(...)`) runs *before* those siblings have written their
 * `HTTP_CODE_METADATA` / `METHOD_METADATA` / `HEADERS_METADATA`. The
 * `@ApiResponse(...)` call is therefore always deferred via `queueMicrotask`,
 * so by the time it reads sibling metadata — the effective status *and* the
 * effective content type (including `@Header('Content-Type', …)` inference) —
 * everything has settled. The document is built much later
 * (`SwaggerModule.createDocument`), so the deferral is invisible to output.
 * See `docs/responses.md → "Decorator ordering & the microtask trick"`.
 */
export const ZodResponse = (opts: ZodResponseOptions): MethodDecorator => {
  const built = buildKind(opts.type);
  const status = normaliseStatus(opts.status);
  return (target, propertyKey, descriptor) => {
    const handler = descriptor.value;
    if (typeof handler !== 'function') {
      throw new TypeError('[zod-nest] @ZodResponse can only be applied to methods.');
    }
    const variant: ResponseVariant = {
      status,
      kind: built.kind,
      dto: built.dto,
      validationSchema: built.validationSchema,
      description: opts.description,
      passthroughOnError: opts.passthroughOnError ?? false,
      contentType: opts.contentType,
      stream: opts.stream,
    };
    appendResponseVariant(handler, variant);

    // `TypedPropertyDescriptor<unknown>` matches what the swagger bridge
    // expects; `MethodDecorator`'s descriptor parameter is `TypedPropertyDescriptor<T>`
    // for the inferred return type, structurally compatible at runtime.
    const swaggerDescriptor = descriptor as TypedPropertyDescriptor<unknown>;
    // Always defer: sibling `@HttpCode` / route method / `@Header` metadata is
    // not yet written when this decorator applies. The default stream matcher
    // is used here — module options (`streamContentTypes`) don't exist at
    // decoration time; they extend only the interceptor's runtime check.
    queueMicrotask(() => {
      const effectiveStatus = resolveEffectiveStatus(variant, handler);
      const contentType = resolveContentType(variant, handler, DEFAULT_STREAM_MATCHER);
      applySwaggerResponseDecorator(
        variant,
        effectiveStatus,
        contentType,
        target,
        propertyKey,
        swaggerDescriptor,
      );
    });
  };
};
