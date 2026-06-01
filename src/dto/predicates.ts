import { z } from 'zod';

import type { ZodDto } from './dto.types.js';

import { ZOD_DTO_SYMBOL } from './symbols.js';

/**
 * Runtime guard: is `value` a class returned by `createZodDto`?
 *
 * Used by `ZodValidationPipe`, `ZodSerializerInterceptor`, and `applyZodNest`
 * to discriminate zod-nest DTOs from plain
 * constructors, class-validator DTOs, primitives, and any other metatypes
 * NestJS exposes via `ArgumentMetadata`.
 */
export const isZodDto = (value: unknown): value is ZodDto =>
  typeof value === 'function' &&
  (value as unknown as Record<symbol, unknown>)[ZOD_DTO_SYMBOL] === true;

/**
 * Runtime guard: is `value` a Zod schema (any `z.*` type)?
 *
 * Used by `@ZodResponse` to accept a raw schema in place of a DTO — including
 * `z.discriminatedUnion` / `z.union` / `z.intersection`, which can't be wrapped
 * with `createZodDto` (their `z.infer` is a union, so `class … extends
 * createZodDto(schema)` fails to typecheck with TS2509). `instanceof z.ZodType`
 * holds for every schema built through the same `zod` module instance.
 */
export const isZodSchema = (value: unknown): value is z.ZodType => value instanceof z.ZodType;
