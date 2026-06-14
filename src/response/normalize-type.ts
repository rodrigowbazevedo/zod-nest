import type { z } from 'zod';
import type { ZodDto } from '../dto/dto.types.js';

import { createZodDto } from '../dto/create-zod-dto.js';
import { isZodDto, isZodSchema } from '../dto/predicates.js';
import { ANON_RESPONSE_PREFIX, resolveAnonId } from '../schema/anon-id.js';
import { defaultRegistry, registerSchema } from '../schema/registry.js';

/**
 * Cache of `raw schema -> output DTO` so the same schema instance reused across
 * routes maps to one DTO (and therefore one OpenAPI component id). Without it,
 * an un-`.meta({ id })`'d schema would mint a fresh anonymous id per route.
 * WeakMap so the synthesised DTO is GC'd once the schema is. Mirrors the
 * `outputCache` pattern in `src/dto/output-dto.ts`.
 */
const responseDtoCache = new WeakMap<z.ZodType, ZodDto>();

const schemaToOutputDto = (schema: z.ZodType): ZodDto => {
  const cached = responseDtoCache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  // `createZodDto(schema)` as a plain expression is always type-safe — TS2509
  // ("base constructor return type is not an object type") only fires when the
  // result is used in an `extends` clause, never here. This is what lets a
  // raw union / intersection schema flow through unchanged.
  //
  // `createZodDto`'s anonymous-id fallback keys off the class name, which here
  // is the shared base "ZodDtoBase" — so an unnamed schema would not get a
  // unique id. Resolve the id ourselves: `.meta({ id })` when present, else a
  // generated synthetic id registered as `anonymous`.
  const namedId = registerSchema(schema);
  if (namedId !== undefined) {
    const dto = createZodDto(schema).Output;
    responseDtoCache.set(schema, dto);
    return dto;
  }
  // No resolvable id: register a synthetic anonymous id so the body is emitted
  // (under the document's `strict` / `override`) and referenced by `$ref`.
  // `applyZodNest`'s `inlineAnonymousBodies` pass inlines that body into the
  // response and prunes the synthetic component, so it never reaches the doc.
  const anonId = resolveAnonId(schema, ANON_RESPONSE_PREFIX);
  registerSchema(schema, defaultRegistry, { id: anonId, anonymous: true });
  const dto = createZodDto(schema, { id: anonId }).Output;
  responseDtoCache.set(schema, dto);
  return dto;
};

/**
 * Normalise one `@ZodResponse({ type })` entry into a `ZodDto`:
 * - a `ZodDto` is returned as-is (the caller already chose `.Output` or not);
 * - a raw Zod schema is wrapped as `createZodDto(schema).Output` — output IO,
 *   because a response body is output-only — and cached per schema instance;
 * - anything else throws `TypeError` at decoration time so typos surface at
 *   module load, not on the first request.
 *
 * `index` is supplied when the entry came from an array/tuple `type`, so the
 * thrown message can point at the offending slot.
 */
export const toResponseDto = (entry: unknown, index?: number): ZodDto => {
  if (isZodDto(entry)) {
    return entry;
  }
  if (isZodSchema(entry)) {
    return schemaToOutputDto(entry);
  }
  const where =
    index === undefined ? '@ZodResponse({ type })' : `@ZodResponse({ type }) element [${index}]`;
  throw new TypeError(
    `[zod-nest] ${where} must be a zod-nest DTO class (from createZodDto), ` +
      'a Zod schema, or a non-empty array of those.',
  );
};
