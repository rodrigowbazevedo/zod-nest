import { z } from 'zod';

import type { ZodDto } from '../dto/dto.types.js';
import type {
  ResponseVariant,
  ResponseVariantKind,
  ZodResponseDescription,
} from '../response/metadata.js';

import { isZodDto } from '../dto/predicates.js';
import { appendResponseVariant } from '../response/metadata.js';

/**
 * Accepted shapes for `@ZodResponse({ type })`:
 * - `Dto` → validates as `Dto.schema` (single-DTO response).
 * - `[Dto]` (length 1) → validates as `z.array(Dto.schema)`; matches Nest's
 *   `@ApiResponse({ isArray: true })` convention without minting a separate
 *   `*sDto` id.
 * - `[A, B, ...]` (length ≥ 2) → validates as `z.tuple([A.schema, B.schema, ...])`;
 *   surfaces as an OpenAPI 3.1 `prefixItems` tuple in Phase 2e.
 *
 * Empty arrays and non-DTO elements throw `TypeError` at decoration time
 * so typos surface at module load, not the first request.
 */
export type ZodResponseType = ZodDto | readonly [ZodDto, ...ZodDto[]];

export interface ZodResponseOptions {
  status?: number;
  type: ZodResponseType;
  description?: ZodResponseDescription;
  passthroughOnError?: boolean;
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
 * Method-only decorator. Declares a typed response variant for the handler.
 * Stack multiple decorations to declare per-status types; lookup at runtime
 * is by `response.statusCode === variant.status`.
 *
 * The wrapped Zod schema (array / tuple) is built once at decoration time
 * and stored on the variant record — no per-request schema construction.
 */
export const ZodResponse = (opts: ZodResponseOptions): MethodDecorator => {
  const built = buildKind(opts.type);
  return (_target, _propertyKey, descriptor) => {
    const handler = descriptor.value;
    if (typeof handler !== 'function') {
      throw new TypeError('[zod-nest] @ZodResponse can only be applied to methods.');
    }
    const variant: ResponseVariant = {
      status: opts.status,
      kind: built.kind,
      dto: built.dto,
      validationSchema: built.validationSchema,
      description: opts.description,
      passthroughOnError: opts.passthroughOnError ?? false,
    };
    appendResponseVariant(handler, variant);
  };
};
