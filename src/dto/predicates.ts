import type { ZodDto } from './dto.types.js';

import { ZOD_DTO_SYMBOL } from './symbols.js';

/**
 * Runtime guard: is `value` a class returned by `createZodDto`?
 *
 * Used by the validation pipe (Phase 2c), the serializer interceptor (2d),
 * and the doc merger (2e) to discriminate zod-nest DTOs from plain
 * constructors, class-validator DTOs, primitives, and any other metatypes
 * NestJS exposes via `ArgumentMetadata`.
 */
export const isZodDto = (value: unknown): value is ZodDto =>
  typeof value === 'function' &&
  (value as unknown as Record<symbol, unknown>)[ZOD_DTO_SYMBOL] === true;
