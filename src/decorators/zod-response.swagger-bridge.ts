import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import type { Type } from '@nestjs/common';
import type { ApiResponseOptions } from '@nestjs/swagger';
import type { ZodDto } from '../dto/dto.types.js';
import type {
  ResponseStatusWildcard,
  ResponseVariant,
  ZodResponseDescription,
} from '../response/metadata.js';

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
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<unknown>,
): void => {
  const base = { status: effectiveStatus, ...extractDescriptionFields(variant.description) };

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
  const schema: TupleSchema = {
    type: 'array',
    prefixItems: dtos.map((d) => ({ $ref: getSchemaPath(asDtoFunction(d)) })),
    items: false,
  };
  ApiResponse(buildApiResponseOptions(base, { schema }))(target, propertyKey, descriptor);
};
