import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import type { Type } from '@nestjs/common';
import type { ApiResponseOptions } from '@nestjs/swagger';
import type { ZodDto } from '../dto/dto.types.js';
import type {
  ResponseStatusWildcard,
  ResponseVariant,
  ZodResponseDescription,
} from '../response/metadata.js';

import { DEFAULT_CONTENT_TYPE } from '../response/stream.js';

/**
 * Minimal shape for an OpenAPI 3.1 tuple schema. `@nestjs/swagger`'s
 * `SchemaObject` is modelled against OpenAPI 3.0 and doesn't declare
 * `prefixItems`. Building the literal here lets us avoid an `as` cast on
 * each `prefixItems` entry; the final assignment into `ApiResponseOptions.schema`
 * carries a single documented cast because that field's type is the 3.0
 * `SchemaObject`.
 */
interface TupleSchema {
  type: 'array';
  prefixItems: { $ref: string }[];
  items: false;
}

interface DescriptionFields {
  description?: string;
  headers?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

const extractDescriptionFields = (desc: ZodResponseDescription | undefined): DescriptionFields => {
  if (desc === undefined) {
    return {};
  }
  if (typeof desc === 'string') {
    return { description: desc };
  }
  const out: DescriptionFields = { description: desc.description };
  if (desc.headers !== undefined) {
    out.headers = desc.headers;
  }
  if (desc.links !== undefined) {
    out.links = desc.links;
  }
  return out;
};

/**
 * `ZodDto` is the static side of a class produced by `createZodDto` — its
 * `new ()` signature satisfies `Type<unknown>`, but the structural intersection
 * with our static members (`schema`, `Output`, etc.) confuses TS into
 * rejecting a direct assignment to `ApiResponseOptions.type`. Narrow to
 * `Type<unknown>` (`@nestjs/common`'s constructor alias) at the boundary.
 */
const asDtoFunction = (dto: ZodDto): Type<unknown> => dto as unknown as Type<unknown>;

/**
 * `@nestjs/swagger`'s `ApiResponseOptions.headers` is typed against the
 * OpenAPI 3.0 `HeadersObject` (`Record<string, HeaderObject | ReferenceObject>`).
 * `ZodResponseDescription.headers` keeps `Record<string, unknown>` so users
 * can pass through 3.1 / extension shapes without fighting the type. Cast
 * at the boundary; runtime contents flow through `@nestjs/swagger` unchanged.
 */
const buildApiResponseOptions = (
  base: { status: number | ResponseStatusWildcard } & DescriptionFields,
  body: { type: Type<unknown>; isArray?: true } | { schema: TupleSchema },
): ApiResponseOptions => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see header / schema comments above
  return { ...base, ...body } as any;
};

const buildTupleSchema = (dtos: readonly ZodDto[]): TupleSchema => ({
  type: 'array',
  prefixItems: dtos.map((d) => ({ $ref: getSchemaPath(asDtoFunction(d)) })),
  items: false,
});

/**
 * OpenAPI schema for a non-JSON response body, keyed by `ResponseVariant.kind`:
 * single → a bare `$ref`; array → an `array` of `$ref`; tuple → a 3.1
 * `prefixItems` tuple. Each `$ref` targets the class name `@nestjs/swagger`
 * registers via `ApiExtraModels`; `applyZodNest` later rewrites it to the real
 * DTO id and replaces the placeholder body with the Zod-derived schema.
 */
type ContentSchema = { $ref: string } | { type: 'array'; items: { $ref: string } } | TupleSchema;

/**
 * Build an `ApiResponseOptions` payload that pins a custom media-type key via
 * `content` (rather than `type` / `isArray`, which `@nestjs/swagger` always
 * wraps in `application/json`). Used for streamed / binary responses.
 */
const buildContentResponseOptions = (
  base: { status: number | ResponseStatusWildcard } & DescriptionFields,
  contentType: string,
  schema: ContentSchema,
): ApiResponseOptions => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 3.1 schema shapes (prefixItems) + the headers shape don't fit @nestjs/swagger's 3.0 types; see comments above
  return { ...base, content: { [contentType]: { schema } } } as any;
};

/**
 * Emit `@ApiResponse(...)` for a non-`application/json` content type. Registers
 * the variant's DTO(s) with `ApiExtraModels` so they land in
 * `components.schemas`, then references them by `$ref` under the custom media
 * type — the same placeholder-then-rewrite contract the tuple path relies on.
 */
const applyCustomContentResponse = (
  variant: ResponseVariant,
  base: { status: number | ResponseStatusWildcard } & DescriptionFields,
  contentType: string,
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<unknown>,
): void => {
  if (variant.kind === 'single') {
    const dto = variant.dto as ZodDto;
    ApiExtraModels(asDtoFunction(dto))(target, propertyKey, descriptor);
    const schema: ContentSchema = { $ref: getSchemaPath(asDtoFunction(dto)) };
    ApiResponse(buildContentResponseOptions(base, contentType, schema))(
      target,
      propertyKey,
      descriptor,
    );
    return;
  }

  const dtos = variant.dto as readonly ZodDto[];
  ApiExtraModels(...dtos.map(asDtoFunction))(target, propertyKey, descriptor);

  if (variant.kind === 'array') {
    // `buildArrayKind` guarantees `dtos.length === 1` for `array` kind.
    const [dto] = dtos;
    if (dto === undefined) {
      throw new TypeError('[zod-nest] array response variant has no DTO.');
    }
    const schema: ContentSchema = {
      type: 'array',
      items: { $ref: getSchemaPath(asDtoFunction(dto)) },
    };
    ApiResponse(buildContentResponseOptions(base, contentType, schema))(
      target,
      propertyKey,
      descriptor,
    );
    return;
  }

  // tuple
  ApiResponse(buildContentResponseOptions(base, contentType, buildTupleSchema(dtos)))(
    target,
    propertyKey,
    descriptor,
  );
};

/**
 * Build an `ApiResponseOptions` payload for a `ResponseVariant` and apply
 * `@ApiResponse(...)` (plus `@ApiExtraModels(...)` for tuples) to the
 * handler. This is the swagger-side half of the composite `@ZodResponse`
 * decorator — the variant has already been registered for runtime
 * validation; this writes the matching OpenAPI doc entry.
 *
 * Tuple variants emit a raw `schema: { type: 'array', prefixItems: [...] }`
 * with one `$ref` per slot, and call `ApiExtraModels(...)` so `@nestjs/swagger`
 * registers each tuple-slot DTO in `components.schemas`. `applyZodNest` then
 * replaces the placeholder bodies with the real Zod-derived schemas.
 */
export const applySwaggerResponseDecorator = (
  variant: ResponseVariant,
  effectiveStatus: number | ResponseStatusWildcard,
  effectiveContentType: string,
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<unknown>,
): void => {
  const base = { status: effectiveStatus, ...extractDescriptionFields(variant.description) };

  if (effectiveContentType !== DEFAULT_CONTENT_TYPE) {
    applyCustomContentResponse(
      variant,
      base,
      effectiveContentType,
      target,
      propertyKey,
      descriptor,
    );
    return;
  }

  if (variant.kind === 'single') {
    const dto = variant.dto as ZodDto;
    ApiResponse(buildApiResponseOptions(base, { type: asDtoFunction(dto) }))(
      target,
      propertyKey,
      descriptor,
    );
    return;
  }

  if (variant.kind === 'array') {
    const dtos = variant.dto as readonly ZodDto[];
    // `buildArrayKind` guarantees `dtos.length === 1` for `array` kind.
    const dto = dtos[0]!;
    ApiResponse(buildApiResponseOptions(base, { type: asDtoFunction(dto), isArray: true }))(
      target,
      propertyKey,
      descriptor,
    );
    return;
  }

  // tuple
  const dtos = variant.dto as readonly ZodDto[];
  ApiExtraModels(...dtos.map(asDtoFunction))(target, propertyKey, descriptor);
  ApiResponse(buildApiResponseOptions(base, { schema: buildTupleSchema(dtos) }))(
    target,
    propertyKey,
    descriptor,
  );
};
