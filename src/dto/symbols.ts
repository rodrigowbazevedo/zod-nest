/**
 * Runtime detection marker placed on every class returned by `createZodDto`.
 * Used by `ZodValidationPipe`, `ZodSerializerInterceptor`, and `applyZodNest`
 * to discriminate zod-nest DTO classes from regular constructors.
 */
export const ZOD_DTO_SYMBOL: unique symbol = Symbol.for('zod-nest.dto');
